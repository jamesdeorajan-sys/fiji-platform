/* Marau (PREVIEW/TEST ONLY) - human sales and contact: who can reach a guest, how, who owns it, and what may be sent.
 *
 * Staff-visible only. Nothing here is ever returned by a public endpoint, and nothing here sends a message: it records
 * facts and answers "may this be sent, and over what channel" so a human (or later tooling) decides.
 *
 *  - Both phone and email are required at booking (validated server-side in worker.js via contact_policy.js).
 *  - WhatsApp availability is a separate recorded fact (true / false / unknown) that never blocks a booking.
 *  - A guest without WhatsApp is followed up by EMAIL, and a NAMED staff owner (a real staff identity) can be assigned;
 *    anyone lacking WhatsApp and an owner is surfaced in the attention queue rather than left to fall through.
 *  - ESSENTIAL trip communication does not need marketing consent - but it is NOT blanket delivery permission: every send is
 *    still subject to recipient, channel capability and suppression checks (sendDecision). PROMOTIONAL messages additionally
 *    require an explicit 'granted' consent, which is
 *    never assumed (default 'unknown'), can be withdrawn by the guest at any time, and is evidenced by an append-only log.
 */
import { followUpPlan, followUpChannel, maySend, sendDecision, validatePhone, validateEmail } from './contact_policy.js';
import { normalizePickupDatetime } from './fiji_time.js';
import { legStatusBasis } from './leg_type.js';

export function createGuestContact(deps) {
  const { json, requireStaffIdentity, requireGuestSession, nowIso } = deps;

  async function staffOr401(request, env) {
    const staff = await requireStaffIdentity(request, env);
    if (!staff) return { error: json({ error: 'unauthorized - a valid staff identity token (x-marau-staff-token) is required' }, 401) };
    return { operator: staff.operatorName };
  }

  async function setConsent(env, sessionId, to, { source, actor }) {
    const cur = await env.DB.prepare('SELECT marketing_consent FROM guest_sessions WHERE session_id = ?').bind(sessionId).first();
    if (!cur) return { changed: false };
    if (cur.marketing_consent === to) return { changed: false, value: to };
    const now = nowIso();
    await env.DB.prepare('UPDATE guest_sessions SET marketing_consent = ?, marketing_consent_at = ?, marketing_consent_source = ? WHERE session_id = ?').bind(to, now, source, sessionId).run();
    await env.DB.prepare('INSERT INTO marau_consent_events (guest_session_id, from_value, to_value, source, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(sessionId, cur.marketing_consent, to, source, actor, now).run();
    return { changed: true, value: to };
  }

  // ----------------------------------------------------------------- guest

  async function guestGet(request, env) {
    const s = await requireGuestSession(request, env);
    if (!s) return json({ error: 'unauthorized - invalid or revoked access token' }, 401);
    const row = await env.DB.prepare('SELECT whatsapp_available, marketing_consent, marketing_consent_at FROM guest_sessions WHERE session_id = ?').bind(s.session_id).first();
    const owner = await env.DB.prepare('SELECT owner FROM marau_follow_up_owners WHERE guest_session_id = ?').bind(s.session_id).first();
    return json({
      whatsapp_available: row.whatsapp_available === 1 ? true : row.whatsapp_available === 0 ? false : null,
      marketing_consent: row.marketing_consent,
      marketing_consent_at: row.marketing_consent_at,
      essential_messages: 'trip messages (confirmations, driver details, changes, cancellations, safety) do not depend on marketing consent. We send them over the contact details you gave us, so please keep them correct.',
      contact_person: owner ? owner.owner : null,
      demonstration_data: true,
    });
  }

  async function guestUpdate(request, env) {
    const s = await requireGuestSession(request, env);
    if (!s) return json({ error: 'unauthorized - invalid or revoked access token' }, 401);
    let b;
    try { b = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
    const errors = [];
    if (b.whatsapp_available !== undefined && b.whatsapp_available !== null && typeof b.whatsapp_available !== 'boolean') errors.push('whatsapp_available must be true, false or null (unknown)');
    if (b.marketing_consent !== undefined && !['granted', 'withheld'].includes(b.marketing_consent)) errors.push("marketing_consent must be 'granted' or 'withheld' (the guest can never set it back to 'unknown')");
    if (errors.length) return json({ error: 'validation failed', details: errors }, 400);
    if (b.whatsapp_available !== undefined) {
      await env.DB.prepare('UPDATE guest_sessions SET whatsapp_available = ? WHERE session_id = ?').bind(b.whatsapp_available === null ? null : b.whatsapp_available ? 1 : 0, s.session_id).run();
    }
    if (b.marketing_consent !== undefined) await setConsent(env, s.session_id, b.marketing_consent, { source: 'guest_settings', actor: `guest:${s.session_id}` });
    return guestGet(request, env);
  }

  // ----------------------------------------------------------------- staff

  async function assignOwner(request, env, sessionId) {
    const st = await staffOr401(request, env); if (st.error) return st.error;
    let b;
    try { b = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
    const owner = String(b.owner || '').trim();
    const named = await env.DB.prepare('SELECT 1 AS ok FROM marau_staff_identities WHERE operator_name = ?').bind(owner).first();
    if (!named) return json({ error: 'OWNER_MUST_BE_A_NAMED_STAFF_MEMBER', detail: 'the owner must match an existing staff identity' }, 400);
    const guest = await env.DB.prepare('SELECT 1 AS ok FROM guest_sessions WHERE session_id = ?').bind(sessionId).first();
    if (!guest) return json({ error: 'guest not found' }, 404);
    await env.DB.prepare(`INSERT INTO marau_follow_up_owners (guest_session_id, owner, assigned_by, assigned_at) VALUES (?, ?, ?, ?)
                          ON CONFLICT(guest_session_id) DO UPDATE SET owner = excluded.owner, assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at`)
      .bind(sessionId, owner, st.operator, nowIso()).run();
    return json({ ok: true, owner, assigned_by: st.operator, demonstration_data: true });
  }

  async function staffRecordWhatsapp(request, env, sessionId) {
    const st = await staffOr401(request, env); if (st.error) return st.error;
    let b;
    try { b = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
    if (typeof b.whatsapp_available !== 'boolean') return json({ error: 'whatsapp_available must be true or false' }, 400);
    const r = await env.DB.prepare('UPDATE guest_sessions SET whatsapp_available = ? WHERE session_id = ?').bind(b.whatsapp_available ? 1 : 0, sessionId).run();
    if (r.meta.changes !== 1) return json({ error: 'guest not found' }, 404);
    return json({ ok: true, whatsapp_available: b.whatsapp_available, recorded_by: st.operator, demonstration_data: true });
  }

  async function guestSummaries(env, { sessionId = null } = {}) {
    const now = nowIso();
    const where = sessionId ? 'WHERE gs.session_id = ?' : '';
    const stmt = env.DB.prepare(
      `SELECT gs.session_id, gs.guest_phone, gs.guest_email, gs.whatsapp_available, gs.marketing_consent, gs.marketing_consent_at, gs.created_at, fo.owner AS follow_up_owner,
              (SELECT COUNT(*) FROM marau_test_bookings b WHERE b.guest_session_id = gs.session_id) AS bookings,
              (SELECT MIN(b.pickup_datetime) FROM marau_test_bookings b WHERE b.guest_session_id = gs.session_id AND b.status != 'cancelled' AND b.pickup_datetime > ?) AS next_pickup,
              (SELECT COUNT(*) FROM marau_offer_requests r WHERE r.guest_session_id = gs.session_id AND r.status = 'requested') AS offers_open,
              (SELECT COUNT(*) FROM marau_offer_requests r WHERE r.guest_session_id = gs.session_id AND r.status = 'confirmed') AS offers_confirmed,
              (SELECT COUNT(*) FROM marau_offer_requests r WHERE r.guest_session_id = gs.session_id AND r.status = 'fulfilled') AS offers_fulfilled,
              (SELECT COUNT(*) FROM marau_offer_requests r JOIN marau_experience_offers o ON o.offer_id = r.offer_id WHERE r.guest_session_id = gs.session_id AND o.status = 'withdrawn' AND r.status IN ('confirmed', 'fulfilled')) AS withdrawn_offer_guests,
              (SELECT COUNT(*) FROM marau_referrals rf WHERE rf.referrer_session_id = gs.session_id AND rf.status IN ('attributed', 'capped')) AS friends_joined,
              (SELECT COUNT(*) FROM marau_reward_credits c WHERE c.beneficiary_session_id = gs.session_id AND c.status = 'earned') AS credits_earned,
              (SELECT COUNT(*) FROM marau_reward_credits c WHERE c.beneficiary_session_id = gs.session_id AND c.needs_manual_adjustment = 1) AS credits_need_staff
       FROM guest_sessions gs LEFT JOIN marau_follow_up_owners fo ON fo.guest_session_id = gs.session_id ${where} ORDER BY gs.created_at DESC LIMIT 200`
    );
    const { results } = await (sessionId ? stmt.bind(now, sessionId) : stmt.bind(now)).all();
    // RC4: an uncertain return is a PILOT attention item, independent of reward credits. Staff see the facts they must check, and the
    // basis their verdict will be tied to.
    const { results: uncertainRows } = await env.DB.prepare(
      `SELECT b.id, b.guest_session_id, b.client_booking_ref, b.pickup_datetime, b.pickup_zone, b.destination_zone, b.source_status,
              (SELECT a.pickup_datetime FROM marau_test_bookings a WHERE a.source_booking_ref = b.source_booking_ref AND a.leg_key = 'arrival') AS arrival_pickup_datetime
       FROM marau_test_bookings b WHERE b.status_uncertainty IS NOT NULL ORDER BY b.pickup_datetime`
    ).all();
    const uncertainBySession = new Map();
    for (const u of uncertainRows) {
      const list = uncertainBySession.get(u.guest_session_id) || [];
      list.push({ booking_id: u.id, reference: u.client_booking_ref, return_pickup_datetime: u.pickup_datetime, pickup_zone: u.pickup_zone, destination_zone: u.destination_zone, source_status: u.source_status, arrival_pickup_datetime: u.arrival_pickup_datetime,
        itinerary_basis: legStatusBasis({ source_status: u.source_status, return_pickup_datetime: u.pickup_datetime, return_pickup_zone: u.pickup_zone, return_destination_zone: u.destination_zone, arrival_pickup_datetime: u.arrival_pickup_datetime }) });
      uncertainBySession.set(u.guest_session_id, list);
    }
    return results.map((g) => {
      const plan = followUpPlan({ whatsappAvailable: g.whatsapp_available, owner: g.follow_up_owner });
      const attention = [];
      if (g.whatsapp_available === 0 && !g.follow_up_owner) attention.push('no_whatsapp_and_no_named_owner');
      if (g.offers_open > 0) attention.push('offer_requests_awaiting_a_human');
      if (g.withdrawn_offer_guests > 0) attention.push('confirmed_offer_was_withdrawn');
      if (g.credits_earned > 0) attention.push('earned_credit_ready_to_apply');
      if (g.credits_need_staff > 0) attention.push('credit_reversal_needs_staff_decision');
      const uncertainReturns = uncertainBySession.get(g.session_id) || [];
      if (uncertainReturns.length > 0) attention.push('return_status_needs_verification');
      return {
        session_id: g.session_id,
        contact: {
          phone: g.guest_phone, email: g.guest_email, whatsapp_available: g.whatsapp_available === 1 ? true : g.whatsapp_available === 0 ? false : null,
          // COLLECTED + well-formed is all Marau can say. It has never confirmed that either address actually receives anything.
          details_valid: { phone: Boolean(validatePhone(g.guest_phone)), email: Boolean(validateEmail(g.guest_email)) },
          deliverability: { status: 'unverified', note: 'details were collected and are well-formed; that is not proof a message will arrive - nothing has been sent or verified' },
        },
        follow_up: plan,
        marketing_consent: g.marketing_consent,
        trips: { bookings: g.bookings, next_pickup: g.next_pickup },
        offers: { open: g.offers_open, confirmed: g.offers_confirmed, fulfilled: g.offers_fulfilled },
        referral: { friends_joined: g.friends_joined, credits_earned: g.credits_earned },
        attention,
        uncertain_returns: uncertainReturns,
      };
    });
  }

  async function listGuests(request, env, url) {
    const st = await staffOr401(request, env); if (st.error) return st.error;
    let guests = await guestSummaries(env);
    if (url.searchParams.get('attention') === '1') guests = guests.filter((g) => g.attention.length > 0);
    return json({ guests, demonstration_data: true });
  }

  async function activeSuppressions(env, sessionId = null) {
    const stmt = env.DB.prepare(`SELECT id, guest_session_id, channel, kind, reason, recorded_by, created_at FROM marau_suppressions WHERE lifted_at IS NULL ${sessionId ? 'AND guest_session_id = ?' : ''}`);
    const { results } = await (sessionId ? stmt.bind(sessionId) : stmt).all();
    return results;
  }

  function decisionFor(g, purpose, channel, suppressions) {
    return sendDecision({
      purpose, channel, marketingConsent: g.marketing_consent, whatsappAvailable: g.contact.whatsapp_available,
      phone: g.contact.phone, email: g.contact.email, hasBookingRelationship: g.trips.bookings > 0,
      suppressions: suppressions.filter((s) => s.guest_session_id === g.session_id),
    });
  }

  async function checkMessage(request, env) {
    const st = await staffOr401(request, env); if (st.error) return st.error;
    let b;
    try { b = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
    const [g] = await guestSummaries(env, { sessionId: String(b.session_id || '') });
    if (!g) return json({ error: 'guest not found' }, 404);
    const purpose = String(b.purpose || '');
    const d = decisionFor(g, purpose, b.channel ? String(b.channel) : undefined, await activeSuppressions(env, g.session_id));
    return json({
      allowed: d.allowed, purpose, channel: d.channel, reasons: d.reasons, suggested_channel: d.suggested_channel, deliverability: d.deliverability,
      reason: d.allowed ? 'permitted' : [d.reasons.includes('no_marketing_consent') ? `promotional messages need marketing consent 'granted' (this guest: '${g.marketing_consent}')` : null, ...d.reasons.filter((r) => r !== 'no_marketing_consent')].filter(Boolean).join('; '),
      note: 'permission to send is not proof of delivery: contact details are collected and well-formed, never verified',
      nothing_was_sent: true,
    });
  }

  async function addSuppression(request, env, sessionId) {
    const st = await staffOr401(request, env); if (st.error) return st.error;
    let b;
    try { b = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
    if (!['whatsapp', 'email', 'phone'].includes(b.channel)) return json({ error: "channel must be 'whatsapp', 'email' or 'phone'" }, 400);
    if (!['delivery_failure', 'marketing_opt_out'].includes(b.kind)) return json({ error: "kind must be 'delivery_failure' or 'marketing_opt_out'" }, 400);
    const guest = await env.DB.prepare('SELECT 1 AS ok FROM guest_sessions WHERE session_id = ?').bind(sessionId).first();
    if (!guest) return json({ error: 'guest not found' }, 404);
    const r = await env.DB.prepare('INSERT INTO marau_suppressions (guest_session_id, channel, kind, reason, recorded_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(sessionId, b.channel, b.kind, b.reason ? String(b.reason).slice(0, 200) : null, st.operator, nowIso()).run();
    return json({ ok: true, suppression_id: r.meta.last_row_id, recorded_by: st.operator, demonstration_data: true }, 201);
  }

  async function liftSuppression(request, env, id) {
    const st = await staffOr401(request, env); if (st.error) return st.error;
    const r = await env.DB.prepare('UPDATE marau_suppressions SET lifted_at = ?, lifted_by = ? WHERE id = ? AND lifted_at IS NULL').bind(nowIso(), st.operator, Number(id)).run();
    if (r.meta.changes === 1) return json({ ok: true, lifted_by: st.operator, demonstration_data: true });
    const row = await env.DB.prepare('SELECT lifted_by FROM marau_suppressions WHERE id = ?').bind(Number(id)).first();
    if (!row) return json({ error: 'suppression not found' }, 404);
    return json({ ok: true, repeated: true, original_operator: row.lifted_by, demonstration_data: true });
  }

  /** Everything that needs a human, grouped by NAMED owner - with an explicit unassigned queue so nothing falls through. */
  async function followUpQueue(request, env) {
    const st = await staffOr401(request, env); if (st.error) return st.error;
    const items = [];
    const push = (kind, r, since, detail) => items.push({ kind, session_id: r.session_id, reference: r.reference || null, channel: followUpChannel(r.whatsapp_available), fallback: followUpChannel(r.whatsapp_available) === 'email' ? 'phone' : 'email', owner: r.owner || null, since, detail, deliverability: 'unverified' });
    const q = async (sql) => (await env.DB.prepare(sql).all()).results;
    for (const r of await q(`SELECT gs.session_id, gs.whatsapp_available, fo.owner, q.reference AS reference, q.created_at AS since FROM marau_offer_requests q JOIN guest_sessions gs ON gs.session_id = q.guest_session_id LEFT JOIN marau_follow_up_owners fo ON fo.guest_session_id = gs.session_id WHERE q.status = 'requested'`)) push('offer_request_awaiting_a_human', r, r.since, 'confirm or decline');
    for (const r of await q(`SELECT gs.session_id, gs.whatsapp_available, fo.owner, c.credit_id AS reference, c.earned_at AS since FROM marau_reward_credits c JOIN guest_sessions gs ON gs.session_id = c.beneficiary_session_id LEFT JOIN marau_follow_up_owners fo ON fo.guest_session_id = gs.session_id WHERE c.status = 'earned'`)) push('earned_credit_ready_to_apply', r, r.since, 'apply to the holder\'s return transfer');
    for (const r of await q(`SELECT gs.session_id, gs.whatsapp_available, fo.owner, c.credit_id AS reference, c.reversed_at AS since FROM marau_reward_credits c JOIN guest_sessions gs ON gs.session_id = c.beneficiary_session_id LEFT JOIN marau_follow_up_owners fo ON fo.guest_session_id = gs.session_id WHERE c.needs_manual_adjustment = 1`)) push('credit_reversal_needs_staff_decision', r, r.since, 'a discount was given and the purchase was reversed');
    for (const r of await q(`SELECT gs.session_id, gs.whatsapp_available, fo.owner, q.reference AS reference, q.updated_at AS since FROM marau_offer_requests q JOIN marau_experience_offers o ON o.offer_id = q.offer_id JOIN guest_sessions gs ON gs.session_id = q.guest_session_id LEFT JOIN marau_follow_up_owners fo ON fo.guest_session_id = gs.session_id WHERE o.status = 'withdrawn' AND q.status IN ('confirmed', 'fulfilled')`)) push('confirmed_offer_was_withdrawn', r, r.since, 'tell the guest and arrange an alternative or refund');
    items.sort((a, b) => String(a.since).localeCompare(String(b.since)));
    const unassigned = items.filter((i) => !i.owner);
    const byOwner = {};
    for (const i of items.filter((x) => x.owner)) (byOwner[i.owner] = byOwner[i.owner] || []).push(i);
    return json({ unassigned, by_owner: byOwner, counts: { total: items.length, unassigned: unassigned.length }, demonstration_data: true });
  }

  async function editionRecipients(request, env, editionId) {
    const st = await staffOr401(request, env); if (st.error) return st.error;
    const ed = await env.DB.prepare('SELECT edition_id, status FROM marau_deal_editions WHERE edition_id = ?').bind(editionId).first();
    if (!ed) return json({ error: 'edition not found' }, 404);
    const guests = await guestSummaries(env);
    const suppressions = await activeSuppressions(env);
    const eligible = []; const excluded = {};
    for (const g of guests) {
      const d = decisionFor(g, 'deal_edition', undefined, suppressions);
      if (d.allowed) eligible.push({ session_id: g.session_id, channel: d.channel });
      else if (d.suggested_channel) eligible.push({ session_id: g.session_id, channel: d.suggested_channel });
      else for (const reason of new Set(d.reasons)) excluded[reason] = (excluded[reason] || 0) + 1;
    }
    return json({
      edition_id: editionId, edition_status: ed.status,
      promotional_eligible: eligible,
      excluded_without_consent: guests.length - eligible.length, // kept for compatibility: everyone not eligible, for any reason
      excluded_by_reason: excluded,
      level: 'grouping only: an edition is a prepared set of offers plus this recipient PREVIEW - nothing generates, schedules or delivers it',
      note: 'a deal edition is promotional: only guests who granted marketing consent, on a usable unsuppressed channel, are eligible. Every guest can still BROWSE all offers in the app at any time. Nothing is sent.',
      nothing_was_sent: true,
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // HUMAN-LED DEALS PILOT. Staff review a published edition, check live offer availability, pick consent-eligible recipients and
  // RECORD what a person did by hand. Nothing in this section sends, schedules or delivers anything; every response says so.
  //
  // THE TIMING CONTRACT (what this app can and cannot do):
  //   * It CANNOT technically prevent a person from sending a message outside it. Nothing here can stop a phone.
  //   * Immediately before staff prepare/copy a message, POST .../check RE-CHECKS consent, suppression, offer availability and edition
  //     expiry, and hands out the message text ONLY when every one holds.
  //   * A prepared entry is INVALIDATED (stale_reason) the moment a relevant fact changes - on the next read, check or prepare.
  //   * A send that a person actually made is RECORDED AS IT HAPPENED, even if consent changed or the edition expired afterwards. It is
  //     flagged 'contrary_to_eligibility' with the reasons - never refused, never hidden, and never confused with 'not_sent'.
  // ---------------------------------------------------------------------------------------------------------------
  const PILOT_LEVEL = 'manual pilot: a human reviews the edition and sends by hand outside Marau; Marau records review, recipients and outcomes only - nothing is generated, scheduled, sent or delivered';
  const CANNOT_PREVENT = 'this app cannot technically prevent an external manual send; it only withholds the message text when the facts say do not send, invalidates stale entries, and records what actually happened';
  const SEND_TRANSITIONS = { prepared: ['sent_manually', 'not_sent'], sent_manually: ['replied', 'bounced', 'opted_out'], replied: ['opted_out'], not_sent: [], bounced: [], opted_out: [] };
  const FIJI_SLOT_END_HOUR = { morning: 14, afternoon: 24 };

  async function editionRow(env, editionId) {
    return env.DB.prepare('SELECT edition_id, fiji_date, slot, status FROM marau_deal_editions WHERE edition_id = ?').bind(editionId).first();
  }

  /** The instant an edition stops being sendable: the end of its slot in FIJI time (morning 14:00, afternoon midnight). */
  function editionEndsAt(ed) {
    const end = FIJI_SLOT_END_HOUR[ed.slot];
    if (end === 24) {
      const d = new Date(`${ed.fiji_date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1);
      return normalizePickupDatetime(`${d.toISOString().slice(0, 10)}T00:00`);
    }
    return normalizePickupDatetime(`${ed.fiji_date}T${String(end).padStart(2, '0')}:00`);
  }
  const editionExpired = (ed) => new Date(editionEndsAt(ed)).getTime() <= Date.now();

  async function editionAvailability(env, editionId) {
    const now = nowIso();
    const { results } = await env.DB.prepare(
      `SELECT o.offer_id, o.title, o.status, o.book_by, o.expires_at, o.capacity, o.price_per_place_cents, s.verification_status,
              (SELECT COALESCE(SUM(r.places), 0) FROM marau_offer_requests r WHERE r.offer_id = o.offer_id AND (r.status IN ('confirmed', 'fulfilled') OR (r.status = 'requested' AND r.hold_expires_at > ?))) AS taken
       FROM marau_edition_offers eo JOIN marau_experience_offers o ON o.offer_id = eo.offer_id JOIN marau_suppliers s ON s.supplier_id = o.supplier_id
       WHERE eo.edition_id = ? ORDER BY eo.position, o.offer_id`
    ).bind(now, editionId).all();
    return results.map((o) => {
      const left = Math.max(0, o.capacity - o.taken);
      const state = o.status === 'withdrawn' ? 'withdrawn' : (o.status !== 'published' || o.verification_status !== 'verified') ? 'unavailable'
        : o.expires_at <= now ? 'expired' : o.book_by <= now ? 'deadline_passed' : left === 0 ? 'sold_out' : 'open';
      return { offer_id: o.offer_id, title: o.title, state, places_left: left, price_fjd: o.price_per_place_cents / 100 };
    });
  }
  const openBasis = (offers) => offers.filter((o) => o.state === 'open').map((o) => o.offer_id).sort().join(',');

  async function recipientPlan(env) {
    const guests = await guestSummaries(env);
    const suppressions = await activeSuppressions(env);
    const eligible = []; const excluded = {};
    for (const g of guests) {
      const d = decisionFor(g, 'deal_edition', undefined, suppressions);
      const channel = d.allowed ? d.channel : d.suggested_channel;
      if (channel) eligible.push({ session_id: g.session_id, channel, contact: { phone: g.contact.phone, email: g.contact.email } });
      else for (const reason of new Set(d.reasons)) excluded[reason] = (excluded[reason] || 0) + 1;
    }
    return { eligible, excluded };
  }

  /** The facts that decide whether THIS prepared entry may be copied/sent right now. [] = all hold. */
  async function sendBlockers(env, ed, offers, row) {
    const reasons = [];
    if (editionExpired(ed)) reasons.push('edition_expired');
    if (!offers.some((o) => o.state === 'open')) reasons.push('no_open_offer');
    const [g] = await guestSummaries(env, { sessionId: row.guest_session_id });
    const d = decisionFor(g, 'deal_edition', row.channel, await activeSuppressions(env, row.guest_session_id));
    if (!d.allowed) for (const r of d.reasons) reasons.push(r);
    return reasons;
  }

  /**
   * Invalidate prepared entries whose facts changed. Idempotent; the FIRST reason sticks until the entry is re-prepared. Runs on every
   * review view, send list, prepare, check and outcome - so a stale list is never presented as current.
   */
  async function invalidateStale(env, ed, offers) {
    const { results: rows } = await env.DB.prepare(`SELECT * FROM marau_edition_sends WHERE edition_id = ? AND status = 'prepared' AND stale_reason IS NULL`).bind(ed.edition_id).all();
    const basis = openBasis(offers);
    for (const row of rows) {
      let reasons = await sendBlockers(env, ed, offers, row);
      if (!reasons.length && row.offers_basis !== basis) reasons = ['offer_availability_changed'];
      if (reasons.length) await env.DB.prepare(`UPDATE marau_edition_sends SET stale_reason = ?, stale_at = ? WHERE id = ? AND status = 'prepared' AND stale_reason IS NULL`).bind(reasons.join(','), nowIso(), row.id).run();
    }
  }

  const reviewShape = (r) => (r ? { decision: r.decision, reviewed_by: r.reviewed_by, reviewed_at: r.reviewed_at, note: r.note, availability: JSON.parse(r.availability_snapshot) } : null);
  const sendShape = (r) => ({
    session_id: r.guest_session_id, channel: r.channel, status: r.status, prepared_by: r.prepared_by, prepared_at: r.prepared_at, updated_by: r.updated_by, updated_at: r.updated_at, note: r.note,
    stale_reason: r.stale_reason || null, stale_at: r.stale_at || null, checked_by: r.checked_by || null, checked_at: r.checked_at || null, message_copied_at: r.message_copied_at || null,
    sent_eligibility: r.sent_eligibility || null, sent_eligibility_reasons: r.sent_eligibility_reasons ? r.sent_eligibility_reasons.split(',') : [],
  });

  async function reviewView(request, env, editionId) {
    const st = await staffOr401(request, env); if (st.error) return st.error;
    const ed = await editionRow(env, editionId);
    if (!ed) return json({ error: 'edition not found' }, 404);
    const offers = await editionAvailability(env, editionId);
    await invalidateStale(env, ed, offers);
    const plan = await recipientPlan(env);
    const { results: sends } = await env.DB.prepare('SELECT guest_session_id, status, stale_reason FROM marau_edition_sends WHERE edition_id = ?').bind(editionId).all();
    const sendBy = Object.fromEntries(sends.map((x) => [x.guest_session_id, x]));
    const rev = await env.DB.prepare('SELECT * FROM marau_edition_reviews WHERE edition_id = ?').bind(editionId).first();
    return json({
      edition: { ...ed, expired: editionExpired(ed), ends_at: editionEndsAt(ed) }, offers, sendable_offers: offers.filter((o) => o.state === 'open').map((o) => o.offer_id),
      recipients: plan.eligible.map((r) => ({ ...r, send_status: sendBy[r.session_id] ? sendBy[r.session_id].status : null, stale_reason: sendBy[r.session_id] ? sendBy[r.session_id].stale_reason || null : null })),
      excluded_by_reason: plan.excluded, review: reviewShape(rev),
      level: PILOT_LEVEL, app_cannot_prevent_external_send: CANNOT_PREVENT, nothing_was_sent: true, demonstration_data: true,
    });
  }

  async function recordReview(request, env, editionId) {
    const st = await staffOr401(request, env); if (st.error) return st.error;
    let b; try { b = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
    if (!['approved_for_manual_send', 'needs_changes'].includes(b.decision)) return json({ error: "decision must be 'approved_for_manual_send' or 'needs_changes'" }, 400);
    const ed = await editionRow(env, editionId);
    if (!ed) return json({ error: 'edition not found' }, 404);
    if (ed.status !== 'published') return json({ error: 'EDITION_NOT_PUBLISHED', detail: 'only a published edition can be reviewed for a manual send' }, 409);
    const offers = await editionAvailability(env, editionId);
    if (b.decision === 'approved_for_manual_send') {
      if (editionExpired(ed)) return json({ error: 'EDITION_EXPIRED', ends_at: editionEndsAt(ed) }, 409);
      if (!offers.some((o) => o.state === 'open')) return json({ error: 'EDITION_HAS_NO_OPEN_OFFERS', offers }, 409);
    }
    await env.DB.prepare(
      `INSERT INTO marau_edition_reviews (edition_id, decision, reviewed_by, reviewed_at, note, availability_snapshot) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(edition_id) DO UPDATE SET decision = excluded.decision, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, note = excluded.note, availability_snapshot = excluded.availability_snapshot`
    ).bind(editionId, b.decision, st.operator, nowIso(), b.note ? String(b.note).slice(0, 300) : null, JSON.stringify(offers)).run();
    const rev = await env.DB.prepare('SELECT * FROM marau_edition_reviews WHERE edition_id = ?').bind(editionId).first();
    return json({ ok: true, review: reviewShape(rev), level: PILOT_LEVEL, nothing_was_sent: true, demonstration_data: true });
  }

  async function prepareSends(request, env, editionId) {
    const st = await staffOr401(request, env); if (st.error) return st.error;
    const ed = await editionRow(env, editionId);
    if (!ed) return json({ error: 'edition not found' }, 404);
    if (ed.status !== 'published') return json({ error: 'EDITION_NOT_PUBLISHED' }, 409);
    if (editionExpired(ed)) return json({ error: 'EDITION_EXPIRED', ends_at: editionEndsAt(ed) }, 409);
    const rev = await env.DB.prepare('SELECT decision FROM marau_edition_reviews WHERE edition_id = ?').bind(editionId).first();
    if (!rev || rev.decision !== 'approved_for_manual_send') return json({ error: 'EDITION_NOT_REVIEWED', detail: 'a staff review approving this edition for a manual send is required first' }, 409);
    const offers = await editionAvailability(env, editionId);
    if (!offers.some((o) => o.state === 'open')) return json({ error: 'EDITION_HAS_NO_OPEN_OFFERS' }, 409);
    await invalidateStale(env, ed, offers);
    const basis = openBasis(offers);
    const plan = await recipientPlan(env);
    let prepared = 0; let already = 0; let refreshed = 0;
    for (const r of plan.eligible) {
      const res = await env.DB.prepare('INSERT OR IGNORE INTO marau_edition_sends (edition_id, guest_session_id, channel, status, prepared_by, prepared_at, offers_basis) VALUES (?, ?, ?, \'prepared\', ?, ?, ?)').bind(editionId, r.session_id, r.channel, st.operator, nowIso(), basis).run();
      if (res.meta.changes === 1) { prepared += 1; continue; }
      // an entry that was invalidated is REFRESHED against today's facts (channel and offers); a still-valid one is left alone
      const up = await env.DB.prepare(`UPDATE marau_edition_sends SET channel = ?, offers_basis = ?, stale_reason = NULL, stale_at = NULL, prepared_by = ?, prepared_at = ?, checked_at = NULL, checked_by = NULL, message_copied_at = NULL
                                       WHERE edition_id = ? AND guest_session_id = ? AND status = 'prepared' AND stale_reason IS NOT NULL`).bind(r.channel, basis, st.operator, nowIso(), editionId, r.session_id).run();
      if (up.meta.changes === 1) refreshed += 1; else already += 1;
    }
    return json({ ok: true, prepared, already_prepared: already, refreshed, level: PILOT_LEVEL, nothing_was_sent: true, demonstration_data: true });
  }

  function composeMessageText(ed, offers) {
    const lines = offers.filter((o) => o.state === 'open').map((o) => `- ${o.title}: FJ$${Number(o.price_fjd).toFixed(2)} per place (${o.places_left} left)`);
    return `Marau deals (${ed.slot}, ${ed.fiji_date}):\n${lines.join('\n')}\nReply here to request a place - a person will confirm with you. Reply STOP and we will not send deals again.`;
  }

  /** Immediately before staff prepare/copy a message: recheck everything, hand out the text only if all of it holds. */
  async function preSendCheck(request, env, editionId, sessionId) {
    const st = await staffOr401(request, env); if (st.error) return st.error;
    const ed = await editionRow(env, editionId);
    if (!ed) return json({ error: 'edition not found' }, 404);
    const row = await env.DB.prepare('SELECT * FROM marau_edition_sends WHERE edition_id = ? AND guest_session_id = ?').bind(editionId, sessionId).first();
    if (!row) return json({ error: 'no prepared send for this guest and edition' }, 404);
    if (row.status !== 'prepared') return json({ error: 'INVALID_STATE', status: row.status, detail: 'only a prepared entry can be checked for copying' }, 409);
    const offers = await editionAvailability(env, editionId);
    const reasons = await sendBlockers(env, ed, offers, row);
    if (reasons.length) {
      await env.DB.prepare(`UPDATE marau_edition_sends SET stale_reason = COALESCE(stale_reason, ?), stale_at = COALESCE(stale_at, ?) WHERE id = ?`).bind(reasons.join(','), nowIso(), row.id).run();
      return json({ error: 'NOT_ELIGIBLE_TO_SEND', eligible: false, reasons, detail: 'the facts no longer allow this message; no text is provided', app_cannot_prevent_external_send: CANNOT_PREVENT, nothing_was_sent: true, demonstration_data: true }, 409);
    }
    await invalidateStale(env, ed, offers);
    const fresh = await env.DB.prepare('SELECT * FROM marau_edition_sends WHERE id = ?').bind(row.id).first();
    if (fresh.stale_reason) return json({ error: 'PREPARED_ENTRY_STALE', stale_reason: fresh.stale_reason, detail: 'a fact changed since this list was prepared; prepare the list again', nothing_was_sent: true }, 409);
    const now = nowIso();
    await env.DB.prepare('UPDATE marau_edition_sends SET checked_at = ?, checked_by = ?, message_copied_at = ? WHERE id = ?').bind(now, st.operator, now, row.id).run();
    return json({ ok: true, eligible: true, channel: row.channel, checked_at: now, checked_by: st.operator, message_text: composeMessageText(ed, offers), level: PILOT_LEVEL, app_cannot_prevent_external_send: CANNOT_PREVENT, nothing_was_sent: true, demonstration_data: true });
  }

  async function recordOutcome(request, env, editionId, sessionId) {
    const st = await staffOr401(request, env); if (st.error) return st.error;
    let b; try { b = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
    const to = String(b.status || '');
    if (!['sent_manually', 'not_sent', 'replied', 'bounced', 'opted_out'].includes(to)) return json({ error: 'status must be sent_manually, not_sent, replied, bounced or opted_out' }, 400);
    const note = b.note ? String(b.note).slice(0, 300) : null;
    const ed = await editionRow(env, editionId);
    if (!ed) return json({ error: 'edition not found' }, 404);
    const row = await env.DB.prepare('SELECT * FROM marau_edition_sends WHERE edition_id = ? AND guest_session_id = ?').bind(editionId, sessionId).first();
    if (!row) return json({ error: 'no prepared send for this guest and edition' }, 404);
    if (row.status === to) return json({ ok: true, repeated: true, send: sendShape(row), sent_contrary_to_eligibility: row.sent_eligibility === 'contrary_to_eligibility', nothing_was_sent: true, demonstration_data: true });
    if (!SEND_TRANSITIONS[row.status].includes(to)) return json({ error: 'INVALID_TRANSITION', from: row.status, to }, 409);
    // HONEST RECORDING: a person who says they sent it sent it. The facts at THIS moment are evaluated and stored with the record; a send
    // made when they no longer held is recorded as such ('contrary_to_eligibility' + reasons), never refused and never hidden.
    let eligibility = null; let reasons = [];
    if (to === 'sent_manually') {
      reasons = await sendBlockers(env, ed, await editionAvailability(env, editionId), row);
      eligibility = reasons.length ? 'contrary_to_eligibility' : 'eligible';
    }
    const now = nowIso();
    const res = await env.DB.prepare('UPDATE marau_edition_sends SET status = ?, updated_by = ?, updated_at = ?, note = COALESCE(?, note), sent_eligibility = COALESCE(?, sent_eligibility), sent_eligibility_reasons = COALESCE(?, sent_eligibility_reasons) WHERE id = ? AND status = ?')
      .bind(to, st.operator, now, note, eligibility, reasons.length ? reasons.join(',') : null, row.id, row.status).run();
    const cur = await env.DB.prepare('SELECT * FROM marau_edition_sends WHERE id = ?').bind(row.id).first();
    if (res.meta.changes !== 1) {
      if (cur.status === to) return json({ ok: true, repeated: true, send: sendShape(cur), sent_contrary_to_eligibility: cur.sent_eligibility === 'contrary_to_eligibility', nothing_was_sent: true, demonstration_data: true });
      return json({ error: 'INVALID_TRANSITION', from: cur.status, to }, 409);
    }
    await env.DB.prepare('INSERT INTO marau_edition_send_events (send_id, from_status, to_status, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(row.id, row.status, to, st.operator, [note, eligibility === 'contrary_to_eligibility' ? `CONTRARY TO ELIGIBILITY: ${reasons.join(',')}` : null].filter(Boolean).join(' | ') || null, now).run();
    if (to === 'bounced') {
      await env.DB.prepare('INSERT INTO marau_suppressions (guest_session_id, channel, kind, reason, recorded_by, created_at) VALUES (?, ?, \'delivery_failure\', ?, ?, ?)').bind(sessionId, row.channel, note || 'bounced after a manual edition send', st.operator, now).run();
    }
    if (to === 'opted_out') {
      await setConsent(env, sessionId, 'withheld', { source: 'edition_reply', actor: st.operator });
      await env.DB.prepare('INSERT INTO marau_suppressions (guest_session_id, channel, kind, reason, recorded_by, created_at) VALUES (?, ?, \'marketing_opt_out\', ?, ?, ?)').bind(sessionId, row.channel, note || 'opted out in reply to a manual edition send', st.operator, now).run();
    }
    return json({
      ok: true, send: sendShape(cur), sent_contrary_to_eligibility: eligibility === 'contrary_to_eligibility',
      ...(eligibility === 'contrary_to_eligibility' ? { warning: 'recorded as sent CONTRARY TO ELIGIBILITY - the facts did not allow this send when it was recorded', reasons } : {}),
      note: CANNOT_PREVENT, nothing_was_sent: true, demonstration_data: true,
    });
  }

  async function listSends(request, env, editionId) {
    const st = await staffOr401(request, env); if (st.error) return st.error;
    const ed = await editionRow(env, editionId);
    if (!ed) return json({ error: 'edition not found' }, 404);
    await invalidateStale(env, ed, await editionAvailability(env, editionId));
    const { results } = await env.DB.prepare('SELECT * FROM marau_edition_sends WHERE edition_id = ? ORDER BY id').bind(editionId).all();
    const summary = { prepared: 0, sent_manually: 0, not_sent: 0, replied: 0, bounced: 0, opted_out: 0, stale: 0, sent_contrary_to_eligibility: 0 };
    for (const r of results) {
      summary[r.status] += 1;
      if (r.status === 'prepared' && r.stale_reason) summary.stale += 1;
      if (r.sent_eligibility === 'contrary_to_eligibility') summary.sent_contrary_to_eligibility += 1;
    }
    return json({ sends: results.map(sendShape), summary, level: PILOT_LEVEL, app_cannot_prevent_external_send: CANNOT_PREVENT, nothing_was_sent: true, demonstration_data: true });
  }

  async function route(request, env, url) {
    const m = request.method; const p = url.pathname;
    if (m === 'GET' && p === '/preview/trip/contact') return guestGet(request, env);
    if (m === 'POST' && p === '/preview/trip/contact') return guestUpdate(request, env);
    let x = p.match(/^\/preview\/admin\/guests\/(gs_[^/]+)\/follow-up-owner$/); if (m === 'POST' && x) return assignOwner(request, env, x[1]);
    x = p.match(/^\/preview\/admin\/guests\/(gs_[^/]+)\/whatsapp$/); if (m === 'POST' && x) return staffRecordWhatsapp(request, env, x[1]);
    if (m === 'GET' && p === '/preview/admin/guests') return listGuests(request, env, url);
    if (m === 'POST' && p === '/preview/admin/messages/check') return checkMessage(request, env);
    x = p.match(/^\/preview\/admin\/guests\/(gs_[^/]+)\/suppressions$/); if (m === 'POST' && x) return addSuppression(request, env, x[1]);
    x = p.match(/^\/preview\/admin\/suppressions\/(\d+)\/lift$/); if (m === 'POST' && x) return liftSuppression(request, env, x[1]);
    if (m === 'GET' && p === '/preview/admin/follow-ups') return followUpQueue(request, env);
    x = p.match(/^\/preview\/admin\/editions\/([^/]+)\/recipients$/); if (m === 'GET' && x) return editionRecipients(request, env, decodeURIComponent(x[1]));
    x = p.match(/^\/preview\/admin\/editions\/([^/]+)\/review$/); if (x) { if (m === 'GET') return reviewView(request, env, decodeURIComponent(x[1])); if (m === 'POST') return recordReview(request, env, decodeURIComponent(x[1])); }
    x = p.match(/^\/preview\/admin\/editions\/([^/]+)\/sends$/); if (m === 'GET' && x) return listSends(request, env, decodeURIComponent(x[1]));
    x = p.match(/^\/preview\/admin\/editions\/([^/]+)\/sends\/prepare$/); if (m === 'POST' && x) return prepareSends(request, env, decodeURIComponent(x[1]));
    x = p.match(/^\/preview\/admin\/editions\/([^/]+)\/sends\/(gs_[^/]+)\/outcome$/); if (m === 'POST' && x) return recordOutcome(request, env, decodeURIComponent(x[1]), x[2]);
    x = p.match(/^\/preview\/admin\/editions\/([^/]+)\/sends\/(gs_[^/]+)\/check$/); if (m === 'POST' && x) return preSendCheck(request, env, decodeURIComponent(x[1]), x[2]);
    return null;
  }

  return { route, setConsent };
}
