/* Marau (PREVIEW/TEST ONLY) - human sales and contact: who can reach a guest, how, who owns it, and what may be sent.
 *
 * Staff-visible only. Nothing here is ever returned by a public endpoint, and nothing here sends a message: it records
 * facts and answers "may this be sent, and over what channel" so a human (or later tooling) decides.
 *
 *  - Both phone and email are required at booking (validated server-side in worker.js via contact_policy.js).
 *  - WhatsApp availability is a separate recorded fact (true / false / unknown) that never blocks a booking.
 *  - A guest without WhatsApp is followed up by EMAIL, and a NAMED staff owner (a real staff identity) can be assigned;
 *    anyone lacking WhatsApp and an owner is surfaced in the attention queue rather than left to fall through.
 *  - ESSENTIAL trip communication is always permitted. PROMOTIONAL messages require an explicit 'granted' consent, which is
 *    never assumed (default 'unknown'), can be withdrawn by the guest at any time, and is evidenced by an append-only log.
 */
import { followUpPlan, maySend } from './contact_policy.js';

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
      essential_messages: 'booking confirmations, driver details, schedule changes, cancellations and safety notices are always sent - they do not depend on marketing consent',
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
    return results.map((g) => {
      const plan = followUpPlan({ whatsappAvailable: g.whatsapp_available, owner: g.follow_up_owner });
      const attention = [];
      if (g.whatsapp_available === 0 && !g.follow_up_owner) attention.push('no_whatsapp_and_no_named_owner');
      if (g.offers_open > 0) attention.push('offer_requests_awaiting_a_human');
      if (g.withdrawn_offer_guests > 0) attention.push('confirmed_offer_was_withdrawn');
      if (g.credits_earned > 0) attention.push('earned_credit_ready_to_apply');
      if (g.credits_need_staff > 0) attention.push('credit_reversal_needs_staff_decision');
      return {
        session_id: g.session_id,
        contact: { phone: g.guest_phone, email: g.guest_email, whatsapp_available: g.whatsapp_available === 1 ? true : g.whatsapp_available === 0 ? false : null },
        follow_up: plan,
        marketing_consent: g.marketing_consent,
        trips: { bookings: g.bookings, next_pickup: g.next_pickup },
        offers: { open: g.offers_open, confirmed: g.offers_confirmed, fulfilled: g.offers_fulfilled },
        referral: { friends_joined: g.friends_joined, credits_earned: g.credits_earned },
        attention,
      };
    });
  }

  async function listGuests(request, env, url) {
    const st = await staffOr401(request, env); if (st.error) return st.error;
    let guests = await guestSummaries(env);
    if (url.searchParams.get('attention') === '1') guests = guests.filter((g) => g.attention.length > 0);
    return json({ guests, demonstration_data: true });
  }

  async function checkMessage(request, env) {
    const st = await staffOr401(request, env); if (st.error) return st.error;
    let b;
    try { b = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
    const [g] = await guestSummaries(env, { sessionId: String(b.session_id || '') });
    if (!g) return json({ error: 'guest not found' }, 404);
    const allowed = maySend({ purpose: String(b.purpose || ''), marketingConsent: g.marketing_consent });
    return json({
      allowed, purpose: b.purpose, channel: g.follow_up.channel,
      reason: allowed ? 'permitted' : g.marketing_consent === 'granted' ? 'unrecognised purpose' : `promotional messages need marketing consent 'granted' (this guest: '${g.marketing_consent}')`,
      nothing_was_sent: true,
    });
  }

  async function editionRecipients(request, env, editionId) {
    const st = await staffOr401(request, env); if (st.error) return st.error;
    const ed = await env.DB.prepare('SELECT edition_id, status FROM marau_deal_editions WHERE edition_id = ?').bind(editionId).first();
    if (!ed) return json({ error: 'edition not found' }, 404);
    const guests = await guestSummaries(env);
    const eligible = guests.filter((g) => maySend({ purpose: 'deal_edition', marketingConsent: g.marketing_consent }));
    return json({
      edition_id: editionId, edition_status: ed.status,
      promotional_eligible: eligible.map((g) => ({ session_id: g.session_id, channel: g.follow_up.channel })),
      excluded_without_consent: guests.length - eligible.length,
      note: 'a deal edition is promotional: only guests who granted marketing consent are eligible. Every guest can still BROWSE all offers in the app at any time. Nothing is sent.',
      nothing_was_sent: true,
    });
  }

  async function route(request, env, url) {
    const m = request.method; const p = url.pathname;
    if (m === 'GET' && p === '/preview/trip/contact') return guestGet(request, env);
    if (m === 'POST' && p === '/preview/trip/contact') return guestUpdate(request, env);
    let x = p.match(/^\/preview\/admin\/guests\/(gs_[^/]+)\/follow-up-owner$/); if (m === 'POST' && x) return assignOwner(request, env, x[1]);
    x = p.match(/^\/preview\/admin\/guests\/(gs_[^/]+)\/whatsapp$/); if (m === 'POST' && x) return staffRecordWhatsapp(request, env, x[1]);
    if (m === 'GET' && p === '/preview/admin/guests') return listGuests(request, env, url);
    if (m === 'POST' && p === '/preview/admin/messages/check') return checkMessage(request, env);
    x = p.match(/^\/preview\/admin\/editions\/([^/]+)\/recipients$/); if (m === 'GET' && x) return editionRecipients(request, env, decodeURIComponent(x[1]));
    return null;
  }

  return { route, setConsent };
}
