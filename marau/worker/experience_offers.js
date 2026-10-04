/* Marau (PREVIEW/TEST ONLY) - staff-managed experience offers: the October revenue journey.
 *
 *   verified supplier + named fulfilment owner -> staff-authored offer (location, Fiji date/time, capacity, inclusions,
 *   all-inclusive FJD price) -> publish -> shown beside the guest's trip -> guest REQUEST (holds places, no payment) ->
 *   HUMAN confirmation -> fulfilment -> (referral qualification, slice 3).
 *
 * Guarantees, each enforced where it cannot be bypassed and each covered by test/marau_experience_offers.test.mjs:
 *   - Nothing publishes without a VERIFIED supplier and a named fulfilment owner (atomic conditional UPDATE).
 *   - OVERSELLING is impossible: capacity is checked INSIDE the single INSERT that creates a request (one SQLite/D1
 *     statement is atomic), counting live holds + confirmed + fulfilled places.
 *   - DUPLICATE requests are impossible: a partial unique index allows one live request per guest per offer, and a
 *     client retry key is idempotent per guest session (same key + same request -> the same request; different -> 409).
 *   - Unattended requests cannot lock inventory: a hold lapses at hold_expires_at and the request becomes 'expired'.
 *   - Booking deadline, expiry and withdrawal are explicit and separate. Withdrawal closes the offer and declines open
 *     requests; already-CONFIRMED guests are NOT silently cancelled - they are listed for a human to handle.
 *   - Every staff action needs the shared admin credential AND an authenticated per-staff identity token; the operator
 *     recorded is derived from that token, never from the request body.
 *   - Guests can browse EVERY published offer at any time. Personalisation only re-orders and flags; it never filters.
 *   - No guest or supplier-cost data is ever returned by a public/guest endpoint.
 *   - Nothing is sent. WhatsApp enquiry text is composed for an in-page mock panel only.
 */
import { followUpPlan } from './contact_policy.js';

export const OFFER_DEFAULTS = Object.freeze({
  holdHours: 12,
  maxPlacesPerRequest: 8,
  // Fiji local hour at which each prepared edition goes live.
  editionStartHourFiji: Object.freeze({ morning: 7, afternoon: 14 }),
  // A trip-relevant offer is "suggested" when it starts within this many days after the last trip leg of the stay.
  stayWindowDaysAfterLastTrip: 3,
});

const MS_HOUR = 3600_000;
const LIVE_REQUEST_STATUSES = ['requested', 'confirmed', 'fulfilled'];

function toCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
const fjd = (cents) => (cents == null ? null : cents / 100);

/** Pure: which prepared edition is live at this instant, in Fiji local time. Used by handlers and tests alike. */
export function editionSlotAt(utcMs, toFijiWallClock, config = OFFER_DEFAULTS) {
  const wall = toFijiWallClock(new Date(utcMs).toISOString()); // 'YYYY-MM-DDTHH:MM' in Fiji local time
  const fijiDate = wall.slice(0, 10);
  const hour = Number(wall.slice(11, 13));
  const { morning, afternoon } = config.editionStartHourFiji;
  let current = null;
  let next = 'morning';
  if (hour >= afternoon) { current = 'afternoon'; next = null; }
  else if (hour >= morning) { current = 'morning'; next = 'afternoon'; }
  return { fiji_date: fijiDate, fiji_hour: hour, current_slot: current, next_slot: next };
}

export function createExperienceOffers(deps) {
  const {
    json, requireStaffIdentity, requireGuestSession, nowIso, cryptoRandomId,
    normalizePickupDatetime, toFijiWallClock, formatFijiDateTime, composeOfferHandoffMessage, hooks = {},
  } = deps;

  const idFor = (prefix) => `${prefix}_${cryptoRandomId()}`;
  const holdHours = (env) => Number(env.MARAU_OFFER_HOLD_HOURS) > 0 ? Number(env.MARAU_OFFER_HOLD_HOURS) : OFFER_DEFAULTS.holdHours;

  async function logEvent(env, { offerId = null, requestId = null, type, actor, detail = null }) {
    await env.DB
      .prepare('INSERT INTO marau_offer_events (offer_id, request_id, event_type, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(offerId, requestId, type, actor, detail ? JSON.stringify(detail) : null, nowIso())
      .run();
  }

  // Lazily releases lapsed holds so places return to inventory. Cheap and idempotent; run before any read/mutation.
  async function expireLapsedHolds(env) {
    const now = nowIso();
    await env.DB
      .prepare(`UPDATE marau_offer_requests SET status = 'expired', decision_note = 'hold lapsed without a human decision', updated_at = ? WHERE status = 'requested' AND hold_expires_at <= ?`)
      .bind(now, now)
      .run();
  }

  const TAKEN_SQL = (offerAlias) => `(SELECT COALESCE(SUM(r.places), 0) FROM marau_offer_requests r WHERE r.offer_id = ${offerAlias}.offer_id AND (r.status IN ('confirmed', 'fulfilled') OR (r.status = 'requested' AND r.hold_expires_at > ?)))`;

  async function staffOr401(request, env) {
    const staff = await requireStaffIdentity(request, env);
    if (!staff) return { error: json({ error: 'unauthorized - a valid staff identity token (x-marau-staff-token) is required' }, 401) };
    return { operator: staff.operatorName };
  }

  async function readJson(request) {
    try { return { body: await request.json() }; } catch { return { error: json({ error: 'invalid JSON body' }, 400) }; }
  }

  // ---------------------------------------------------------------- suppliers

  async function createSupplier(request, env) {
    const s = await staffOr401(request, env); if (s.error) return s.error;
    const j = await readJson(request); if (j.error) return j.error;
    const name = String(j.body.name || '').trim();
    const owner = String(j.body.fulfilment_owner || '').trim();
    if (name.length < 2 || name.length > 120) return json({ error: 'name must be 2-120 characters' }, 400);
    if (owner.length < 2 || owner.length > 100) return json({ error: 'fulfilment_owner (the named staff member responsible for delivery) is required' }, 400);
    const supplierId = idFor('sup');
    const now = nowIso();
    await env.DB.prepare(`INSERT INTO marau_suppliers (supplier_id, name, fulfilment_owner, verification_status, created_by, created_at, updated_at) VALUES (?, ?, ?, 'unverified', ?, ?, ?)`)
      .bind(supplierId, name, owner, s.operator, now, now).run();
    await logEvent(env, { type: 'supplier_created', actor: s.operator, detail: { supplier_id: supplierId } });
    return json({ ok: true, supplier_id: supplierId, verification_status: 'unverified', demonstration_data: true }, 201);
  }

  async function setSupplierVerification(request, env, supplierId, target) {
    const s = await staffOr401(request, env); if (s.error) return s.error;
    const now = nowIso();
    const res = await env.DB
      .prepare(`UPDATE marau_suppliers SET verification_status = ?, verified_by = ?, verified_at = ?, updated_at = ? WHERE supplier_id = ? AND verification_status != ?`)
      .bind(target, s.operator, now, now, supplierId, target).run();
    const row = await env.DB.prepare('SELECT supplier_id, name, fulfilment_owner, verification_status, verified_by, verified_at FROM marau_suppliers WHERE supplier_id = ?').bind(supplierId).first();
    if (!row) return json({ error: 'supplier not found' }, 404);
    if (res.meta.changes === 1) await logEvent(env, { type: `supplier_${target}`, actor: s.operator, detail: { supplier_id: supplierId } });
    return json({ ok: true, changed: res.meta.changes === 1, supplier: row, demonstration_data: true });
  }

  // ------------------------------------------------------------------- offers

  function validateOfferInput(body, nowMs) {
    const errors = [];
    const title = String(body.title || '').trim();
    const location = String(body.location || '').trim();
    const inclusions = Array.isArray(body.inclusions) ? body.inclusions.map((x) => String(x).trim()).filter(Boolean).join('\n') : String(body.inclusions || '').trim();
    if (title.length < 3 || title.length > 120) errors.push('title must be 3-120 characters');
    if (location.length < 2 || location.length > 120) errors.push('location is required');
    if (!inclusions) errors.push('inclusions are required (what the price covers)');
    const capacity = Number(body.capacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) errors.push('capacity must be a whole number of places, 1-500');
    const price = toCents(body.price_per_place_fjd);
    if (price == null || price <= 0 || price > 10_000_000) errors.push('price_per_place_fjd must be a positive FJD amount (the all-inclusive total for one place)');
    const cost = body.cost_per_place_fjd == null ? 0 : toCents(body.cost_per_place_fjd);
    if (cost == null || cost < 0) errors.push('cost_per_place_fjd must be zero or a positive FJD amount (staff only)');
    if (price != null && cost != null && cost > price) errors.push('cost_per_place_fjd cannot exceed the price (it would sell at a loss)');
    let startsAt = null; let bookBy = null; let expiresAt = null;
    try { startsAt = body.starts_at ? normalizePickupDatetime(body.starts_at) : null; } catch { startsAt = null; }
    if (!startsAt || Number.isNaN(new Date(startsAt).getTime())) errors.push('starts_at must be a valid date-time (naive values are Fiji local time)');
    else {
      try { bookBy = body.book_by ? normalizePickupDatetime(body.book_by) : new Date(new Date(startsAt).getTime() - 6 * MS_HOUR).toISOString(); } catch { bookBy = null; }
      try { expiresAt = body.expires_at ? normalizePickupDatetime(body.expires_at) : startsAt; } catch { expiresAt = null; }
      if (!bookBy || Number.isNaN(new Date(bookBy).getTime())) errors.push('book_by must be a valid date-time');
      if (!expiresAt || Number.isNaN(new Date(expiresAt).getTime())) errors.push('expires_at must be a valid date-time');
      if (bookBy && expiresAt && !(new Date(bookBy) <= new Date(expiresAt))) errors.push('book_by must not be after expires_at');
      if (expiresAt && !(new Date(expiresAt) <= new Date(startsAt))) errors.push('expires_at must not be after starts_at');
      if (bookBy && !(new Date(bookBy).getTime() > nowMs)) errors.push('book_by must be in the future');
    }
    return { errors, value: { title, location, inclusions, capacity, price, cost, startsAt, bookBy, expiresAt, description: body.description ? String(body.description).trim().slice(0, 1000) : null } };
  }

  async function createOffer(request, env) {
    const s = await staffOr401(request, env); if (s.error) return s.error;
    const j = await readJson(request); if (j.error) return j.error;
    const supplier = await env.DB.prepare('SELECT * FROM marau_suppliers WHERE supplier_id = ?').bind(String(j.body.supplier_id || '')).first();
    if (!supplier) return json({ error: 'supplier not found' }, 404);
    const { errors, value } = validateOfferInput(j.body, Date.now());
    const owner = String(j.body.fulfilment_owner || supplier.fulfilment_owner || '').trim();
    if (!owner) errors.push('a named fulfilment_owner is required');
    if (errors.length) return json({ error: 'validation failed', details: errors }, 400);
    const offerId = idFor('off');
    const now = nowIso();
    await env.DB.prepare(
      `INSERT INTO marau_experience_offers (offer_id, supplier_id, title, description, location, inclusions, starts_at, capacity, price_per_place_cents, cost_per_place_cents, book_by, expires_at, fulfilment_owner, status, created_by, test_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, 1, ?, ?)`
    ).bind(offerId, supplier.supplier_id, value.title, value.description, value.location, value.inclusions, value.startsAt, value.capacity, value.price, value.cost, value.bookBy, value.expiresAt, owner, s.operator, now, now).run();
    await logEvent(env, { offerId, type: 'offer_created', actor: s.operator });
    return json({ ok: true, offer_id: offerId, status: 'draft', demonstration_data: true }, 201);
  }

  async function publishOffer(request, env, offerId) {
    const s = await staffOr401(request, env); if (s.error) return s.error;
    const now = nowIso();
    const res = await env.DB.prepare(
      `UPDATE marau_experience_offers SET status = 'published', published_by = ?, published_at = ?, updated_at = ?
       WHERE offer_id = ? AND status = 'draft' AND TRIM(fulfilment_owner) != '' AND book_by > ? AND expires_at > ?
         AND EXISTS (SELECT 1 FROM marau_suppliers s WHERE s.supplier_id = marau_experience_offers.supplier_id AND s.verification_status = 'verified')`
    ).bind(s.operator, now, now, offerId, now, now).run();
    if (res.meta.changes === 1) {
      await logEvent(env, { offerId, type: 'offer_published', actor: s.operator });
      return json({ ok: true, status: 'published', demonstration_data: true });
    }
    const o = await env.DB.prepare('SELECT o.status, o.book_by, o.expires_at, o.fulfilment_owner, s.verification_status FROM marau_experience_offers o JOIN marau_suppliers s ON s.supplier_id = o.supplier_id WHERE o.offer_id = ?').bind(offerId).first();
    if (!o) return json({ error: 'offer not found' }, 404);
    if (o.status === 'published') return json({ ok: true, status: 'published', already: true, demonstration_data: true });
    if (o.status !== 'draft') return json({ error: 'OFFER_NOT_PUBLISHABLE', status: o.status }, 409);
    if (o.verification_status !== 'verified') return json({ error: 'SUPPLIER_NOT_VERIFIED', detail: 'an offer can only be published for a verified supplier' }, 409);
    if (!String(o.fulfilment_owner || '').trim()) return json({ error: 'FULFILMENT_OWNER_MISSING' }, 409);
    return json({ error: 'OFFER_DEADLINE_ALREADY_PASSED', detail: 'book_by / expires_at are no longer in the future' }, 409);
  }

  async function withdrawOffer(request, env, offerId) {
    const s = await staffOr401(request, env); if (s.error) return s.error;
    const j = await readJson(request); if (j.error) return j.error;
    const reason = String(j.body.reason || '').trim();
    if (reason.length < 3) return json({ error: 'a withdrawal reason is required' }, 400);
    const now = nowIso();
    const res = await env.DB.prepare(`UPDATE marau_experience_offers SET status = 'withdrawn', withdrawn_by = ?, withdrawn_at = ?, withdrawn_reason = ?, updated_at = ? WHERE offer_id = ? AND status IN ('draft', 'published')`)
      .bind(s.operator, now, reason.slice(0, 300), now, offerId).run();
    const offer = await env.DB.prepare('SELECT status FROM marau_experience_offers WHERE offer_id = ?').bind(offerId).first();
    if (!offer) return json({ error: 'offer not found' }, 404);
    // Offer is now closed to new requests and to confirmations. Open (unconfirmed) requests are declined; CONFIRMED guests
    // are deliberately left for a human to contact - never silently cancelled.
    const declined = await env.DB.prepare(`UPDATE marau_offer_requests SET status = 'declined', decided_by = ?, decided_at = ?, decision_note = 'offer withdrawn', updated_at = ? WHERE offer_id = ? AND status = 'requested'`)
      .bind(s.operator, now, now, offerId).run();
    const confirmed = await env.DB.prepare(`SELECT COUNT(*) AS n FROM marau_offer_requests WHERE offer_id = ? AND status IN ('confirmed', 'fulfilled')`).bind(offerId).first();
    if (res.meta.changes === 1) await logEvent(env, { offerId, type: 'offer_withdrawn', actor: s.operator, detail: { reason, declined_open_requests: declined.meta.changes } });
    return json({ ok: true, status: offer.status, changed: res.meta.changes === 1, declined_open_requests: declined.meta.changes, confirmed_guests_needing_human_follow_up: confirmed.n, demonstration_data: true });
  }

  // -------------------------------------------------------------- public view

  function publicOfferShape(o, takenPlaces, nowMs) {
    const placesLeft = Math.max(0, o.capacity - takenPlaces);
    const deadlinePassed = new Date(o.book_by).getTime() <= nowMs;
    const state = deadlinePassed ? 'deadline_passed' : placesLeft === 0 ? 'sold_out' : 'open';
    return {
      offer_id: o.offer_id,
      title: o.title,
      description: o.description,
      location: o.location,
      inclusions: o.inclusions.split('\n'),
      starts_at: o.starts_at,
      starts_at_fiji: formatFijiDateTime(o.starts_at),
      price_per_place_fjd: fjd(o.price_per_place_cents),
      price_basis: 'all-inclusive total price for one place, FJD; nothing is charged by Marau - the team confirms and arranges payment with you',
      places_left: placesLeft,
      capacity: o.capacity,
      book_by: o.book_by,
      expires_at: o.expires_at,
      state,
      supplier: { name: o.supplier_name, verified: true },
    };
  }

  async function listPublic(request, env) {
    await expireLapsedHolds(env);
    const now = nowIso();
    const nowMs = Date.now();
    const { results: offers } = await env.DB.prepare(
      `SELECT o.*, s.name AS supplier_name, ${TAKEN_SQL('o')} AS taken
       FROM marau_experience_offers o JOIN marau_suppliers s ON s.supplier_id = o.supplier_id
       WHERE o.status = 'published' AND s.verification_status = 'verified' AND o.expires_at > ?
       ORDER BY o.starts_at ASC`
    ).bind(now, now).all();

    // Optional personalisation: a stale or missing token is simply anonymous - browsing never breaks.
    let session = null;
    if ((request.headers.get('authorization') || request.headers.get('cookie'))) session = await requireGuestSession(request, env).catch(() => null);
    let stay = null; let mine = new Map();
    if (session) {
      const { results: trips } = await env.DB.prepare(`SELECT pickup_datetime FROM marau_test_bookings WHERE guest_session_id = ? AND status != 'cancelled' ORDER BY pickup_datetime ASC`).bind(session.session_id).all();
      if (trips.length) stay = { from: trips[0].pickup_datetime, to: new Date(new Date(trips[trips.length - 1].pickup_datetime).getTime() + OFFER_DEFAULTS.stayWindowDaysAfterLastTrip * 24 * MS_HOUR).toISOString() };
      const { results: reqs } = await env.DB.prepare(`SELECT request_id, reference, offer_id, places, total_cents, status FROM marau_offer_requests WHERE guest_session_id = ? AND status IN ('requested', 'confirmed', 'fulfilled')`).bind(session.session_id).all();
      mine = new Map(reqs.map((r) => [r.offer_id, r]));
    }

    const slot = editionSlotAt(nowMs, toFijiWallClock);
    const { results: editionRows } = await env.DB.prepare(
      `SELECT e.slot, eo.offer_id, eo.position FROM marau_deal_editions e JOIN marau_edition_offers eo ON eo.edition_id = e.edition_id WHERE e.fiji_date = ? AND e.status = 'published' ORDER BY e.slot, eo.position`
    ).bind(slot.fiji_date).all();
    const editions = { morning: [], afternoon: [] };
    for (const r of editionRows) editions[r.slot].push(r.offer_id);

    const items = offers.map((o) => {
      const shape = publicOfferShape(o, o.taken, nowMs);
      const suggested = Boolean(stay && o.starts_at >= stay.from && o.starts_at <= stay.to);
      const r = mine.get(o.offer_id);
      return {
        ...shape,
        suggested_for_you: suggested,
        in_editions: ['morning', 'afternoon'].filter((k) => editions[k].includes(o.offer_id)),
        my_request: r ? { request_id: r.request_id, reference: r.reference, places: r.places, total_fjd: fjd(r.total_cents), status: r.status } : null,
      };
    });
    // Personalisation re-orders (suggested first, then by start) - it NEVER removes anything.
    if (session) items.sort((a, b) => Number(b.suggested_for_you) - Number(a.suggested_for_you) || (a.starts_at < b.starts_at ? -1 : 1));
    return json({
      offers: items,
      browse_all: true,
      personalised: Boolean(session),
      editions: { fiji_date: slot.fiji_date, current_slot: slot.current_slot, next_slot: slot.next_slot, morning: editions.morning, afternoon: editions.afternoon },
      demonstration_data: true,
    });
  }

  // ------------------------------------------------------- guest requests

  function requestShape(r) {
    return {
      request_id: r.request_id, reference: r.reference, offer_id: r.offer_id, places: r.places,
      price_per_place_fjd: fjd(r.price_per_place_cents), total_fjd: fjd(r.total_cents),
      status: r.status, hold_expires_at: r.hold_expires_at, created_at: r.created_at,
    };
  }

  async function classifyRequestFailure(env, offerId, places, nowMs) {
    const o = await env.DB.prepare(
      `SELECT o.status, o.book_by, o.expires_at, o.capacity, s.verification_status, ${TAKEN_SQL('o')} AS taken
       FROM marau_experience_offers o JOIN marau_suppliers s ON s.supplier_id = o.supplier_id WHERE o.offer_id = ?`
    ).bind(nowIso(), offerId).first();
    if (!o) return json({ error: 'OFFER_NOT_FOUND' }, 404);
    if (o.status !== 'published' || o.verification_status !== 'verified') return json({ error: 'OFFER_NOT_AVAILABLE', detail: 'this offer is withdrawn or not currently available' }, 410);
    if (new Date(o.expires_at).getTime() <= nowMs) return json({ error: 'OFFER_EXPIRED' }, 410);
    if (new Date(o.book_by).getTime() <= nowMs) return json({ error: 'BOOKING_DEADLINE_PASSED' }, 409);
    const left = Math.max(0, o.capacity - o.taken);
    if (left === 0) return json({ error: 'SOLD_OUT', places_left: 0 }, 409);
    return json({ error: 'INSUFFICIENT_CAPACITY', places_left: left, requested: places }, 409);
  }

  async function requestOffer(request, env, offerId) {
    const session = await requireGuestSession(request, env);
    if (!session) return json({ error: 'unauthorized - invalid or revoked access token' }, 401);
    const j = await readJson(request); if (j.error) return j.error;
    const places = j.body.places === undefined ? 1 : Number(j.body.places);
    if (!Number.isInteger(places) || places < 1 || places > OFFER_DEFAULTS.maxPlacesPerRequest) return json({ error: `places must be a whole number from 1 to ${OFFER_DEFAULTS.maxPlacesPerRequest}` }, 400);
    const clientRef = j.body.client_request_ref ? String(j.body.client_request_ref).slice(0, 80) : null;

    await expireLapsedHolds(env);

    // Idempotent retry: the same client key always returns the same request, never a second one.
    if (clientRef) {
      const prior = await env.DB.prepare('SELECT * FROM marau_offer_requests WHERE guest_session_id = ? AND client_request_ref = ?').bind(session.session_id, clientRef).first();
      if (prior) {
        if (prior.offer_id !== offerId || prior.places !== places) return json({ error: 'CLIENT_REQUEST_REF_REUSED_WITH_DIFFERENT_REQUEST' }, 409);
        return json({ ok: true, existing: true, request: requestShape(prior), demonstration_data: true }, 200);
      }
    }
    // A live request for this offer already exists: return it (the unique index would refuse a second anyway).
    const live = await env.DB.prepare(`SELECT * FROM marau_offer_requests WHERE guest_session_id = ? AND offer_id = ? AND status IN ('requested', 'confirmed', 'fulfilled')`).bind(session.session_id, offerId).first();
    if (live) return json({ ok: true, existing: true, request: requestShape(live), demonstration_data: true }, 200);

    const now = nowIso();
    const nowMs = Date.now();
    const holdUntilMs = nowMs + holdHours(env) * MS_HOUR;
    const requestId = idFor('req');
    let inserted;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const reference = `OFR-${cryptoRandomId().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
      try {
        inserted = await env.DB.prepare(
          `INSERT INTO marau_offer_requests (request_id, reference, offer_id, guest_session_id, places, price_per_place_cents, total_cents, client_request_ref, status, hold_expires_at, created_at, updated_at)
           SELECT ?, ?, o.offer_id, ?, ?, o.price_per_place_cents, o.price_per_place_cents * ?, ?, 'requested', MIN(?, o.expires_at), ?, ?
           FROM marau_experience_offers o JOIN marau_suppliers s ON s.supplier_id = o.supplier_id
           WHERE o.offer_id = ? AND o.status = 'published' AND s.verification_status = 'verified'
             AND o.book_by > ? AND o.expires_at > ?
             AND (o.capacity - ${TAKEN_SQL('o')}) >= ?`
        ).bind(requestId, reference, session.session_id, places, places, clientRef, new Date(holdUntilMs).toISOString(), now, now, offerId, now, now, now, places).run();
        break;
      } catch (err) {
        const msg = String(err && err.message);
        if (/UNIQUE/i.test(msg) && /reference/i.test(msg)) continue; // vanishingly rare reference collision: draw another
        if (/UNIQUE/i.test(msg)) {
          // A concurrent identical request from this guest won the race: return it.
          const winner = await env.DB.prepare(`SELECT * FROM marau_offer_requests WHERE guest_session_id = ? AND offer_id = ? AND status IN ('requested', 'confirmed', 'fulfilled')`).bind(session.session_id, offerId).first();
          if (winner) return json({ ok: true, existing: true, request: requestShape(winner), demonstration_data: true }, 200);
        }
        throw err;
      }
    }
    if (!inserted || inserted.meta.changes !== 1) return classifyRequestFailure(env, offerId, places, nowMs);

    const row = await env.DB.prepare('SELECT * FROM marau_offer_requests WHERE request_id = ?').bind(requestId).first();
    await logEvent(env, { offerId, requestId, type: 'request_created', actor: `guest:${session.session_id}`, detail: { places } });
    return json({
      ok: true, existing: false, request: requestShape(row),
      message: 'Your request is in. Nothing is charged. A member of the team will confirm it with you personally.',
      demonstration_data: true,
    }, 201);
  }

  async function guestCancel(request, env, requestId) {
    const session = await requireGuestSession(request, env);
    if (!session) return json({ error: 'unauthorized - invalid or revoked access token' }, 401);
    await expireLapsedHolds(env);
    const now = nowIso();
    const prior = await env.DB.prepare('SELECT status FROM marau_offer_requests WHERE request_id = ? AND guest_session_id = ?').bind(requestId, session.session_id).first();
    const res = await env.DB.prepare(
      `UPDATE marau_offer_requests SET status = 'cancelled_by_guest', updated_at = ?
       WHERE request_id = ? AND guest_session_id = ? AND status IN ('requested', 'confirmed')
         AND EXISTS (SELECT 1 FROM marau_experience_offers o WHERE o.offer_id = marau_offer_requests.offer_id AND o.book_by > ?)`
    ).bind(now, requestId, session.session_id, now).run();
    const row = await env.DB.prepare('SELECT * FROM marau_offer_requests WHERE request_id = ? AND guest_session_id = ?').bind(requestId, session.session_id).first();
    if (!row) return json({ error: 'request not found' }, 404);
    if (res.meta.changes === 1) {
      await logEvent(env, { offerId: row.offer_id, requestId, type: 'request_cancelled_by_guest', actor: `guest:${session.session_id}` });
      if (hooks.onRequestTransition) await hooks.onRequestTransition(env, { request: row, from: prior && prior.status, to: 'cancelled_by_guest', operator: null });
      return json({ ok: true, request: requestShape(row), demonstration_data: true });
    }
    if (row.status === 'cancelled_by_guest') return json({ ok: true, already: true, request: requestShape(row), demonstration_data: true });
    if (['requested', 'confirmed'].includes(row.status)) return json({ error: 'CANCELLATION_WINDOW_CLOSED', detail: 'the booking deadline has passed - please ask the team to cancel for you' }, 409);
    return json({ error: 'REQUEST_NOT_CANCELLABLE', status: row.status }, 409);
  }

  async function guestHandoff(request, env, requestId) {
    const session = await requireGuestSession(request, env);
    if (!session) return json({ error: 'unauthorized - invalid or revoked access token' }, 401);
    const row = await env.DB.prepare(
      `SELECT r.*, o.title, o.location, o.starts_at FROM marau_offer_requests r JOIN marau_experience_offers o ON o.offer_id = r.offer_id WHERE r.request_id = ? AND r.guest_session_id = ?`
    ).bind(requestId, session.session_id).first();
    if (!row) return json({ error: 'request not found' }, 404);
    return json({ handoff: composeOfferHandoffMessage({ opsNumber: env.MARAU_OPS_WHATSAPP_TEST_NUMBER, request: row, offer: row }), demonstration_data: true });
  }

  /** Used by GET /preview/trip so offers sit beside the trip. Guest-safe: no cost, no staff names. */
  async function offerRequestsForSession(env, sessionId) {
    await expireLapsedHolds(env);
    const { results } = await env.DB.prepare(
      `SELECT r.*, o.title, o.location, o.starts_at, o.status AS offer_status FROM marau_offer_requests r JOIN marau_experience_offers o ON o.offer_id = r.offer_id WHERE r.guest_session_id = ? ORDER BY r.created_at DESC`
    ).bind(sessionId).all();
    return results.map((r) => ({
      ...requestShape(r), title: r.title, location: r.location, starts_at: r.starts_at, starts_at_fiji: formatFijiDateTime(r.starts_at), offer_status: r.offer_status,
    }));
  }

  // ----------------------------------------------------------- staff requests

  async function listOffersStaff(request, env) {
    const s = await staffOr401(request, env); if (s.error) return s.error;
    await expireLapsedHolds(env);
    const now = nowIso();
    const { results } = await env.DB.prepare(
      `SELECT o.*, sp.name AS supplier_name, sp.verification_status, ${TAKEN_SQL('o')} AS taken,
              (SELECT COUNT(*) FROM marau_offer_requests r WHERE r.offer_id = o.offer_id AND r.status = 'requested') AS open_requests,
              (SELECT COUNT(*) FROM marau_offer_requests r WHERE r.offer_id = o.offer_id AND r.status = 'confirmed') AS confirmed_requests
       FROM marau_experience_offers o JOIN marau_suppliers sp ON sp.supplier_id = o.supplier_id ORDER BY o.created_at DESC`
    ).bind(now).all();
    return json({
      offers: results.map((o) => ({
        offer_id: o.offer_id, title: o.title, status: o.status, supplier: o.supplier_name, supplier_verification: o.verification_status, fulfilment_owner: o.fulfilment_owner,
        starts_at: o.starts_at, book_by: o.book_by, expires_at: o.expires_at, capacity: o.capacity, places_taken: o.taken, places_left: Math.max(0, o.capacity - o.taken),
        price_per_place_fjd: fjd(o.price_per_place_cents), cost_per_place_fjd: fjd(o.cost_per_place_cents), open_requests: o.open_requests, confirmed_requests: o.confirmed_requests,
        withdrawn_reason: o.withdrawn_reason,
      })),
      demonstration_data: true,
    });
  }

  async function listRequestsStaff(request, env, url) {
    const s = await staffOr401(request, env); if (s.error) return s.error;
    await expireLapsedHolds(env);
    const status = url.searchParams.get('status');
    const where = status ? 'WHERE r.status = ?' : '';
    const stmt = env.DB.prepare(
      `SELECT r.*, o.title, o.status AS offer_status, o.fulfilment_owner, o.starts_at, gs.guest_phone, gs.guest_email, gs.whatsapp_available, fo.owner AS follow_up_owner,
              (SELECT COALESCE(SUM(CASE WHEN p.event_type = 'paid' THEN p.amount_cents ELSE 0 END), 0) FROM marau_offer_payments p WHERE p.request_id = r.request_id) AS paid_cents,
              (SELECT COALESCE(SUM(CASE WHEN p.event_type = 'refunded' THEN p.amount_cents ELSE 0 END), 0) FROM marau_offer_payments p WHERE p.request_id = r.request_id) AS refunded_cents
       FROM marau_offer_requests r JOIN marau_experience_offers o ON o.offer_id = r.offer_id JOIN guest_sessions gs ON gs.session_id = r.guest_session_id
       LEFT JOIN marau_follow_up_owners fo ON fo.guest_session_id = r.guest_session_id
       ${where} ORDER BY r.created_at DESC LIMIT 200`
    );
    const { results } = await (status ? stmt.bind(status) : stmt).all();
    return json({
      requests: results.map((r) => ({
        ...requestShape(r), title: r.title, offer_status: r.offer_status, fulfilment_owner: r.fulfilment_owner, starts_at: r.starts_at,
        decided_by: r.decided_by, decision_note: r.decision_note, fulfilled_by: r.fulfilled_by,
        needs_human_follow_up: r.offer_status === 'withdrawn' && ['confirmed', 'fulfilled'].includes(r.status),
        // STAFF-ONLY contact facts, needed to serve the guest. Never returned by any guest/public endpoint.
        contact: { phone: r.guest_phone, email: r.guest_email, whatsapp_available: r.whatsapp_available === 1 ? true : r.whatsapp_available === 0 ? false : null },
        follow_up: followUpPlan({ whatsappAvailable: r.whatsapp_available, owner: r.follow_up_owner }),
        payment: { paid_fjd: fjd(r.paid_cents), refunded_fjd: fjd(r.refunded_cents), net_paid_fjd: fjd(r.paid_cents - r.refunded_cents), status: r.refunded_cents > 0 ? 'refunded' : r.paid_cents >= r.total_cents ? 'paid_in_full' : r.paid_cents > 0 ? 'part_paid' : 'unpaid' },
      })),
      demonstration_data: true,
    });
  }

  const TRANSITIONS = {
    confirm: {
      to: 'confirmed',
      // A live hold on a still-published offer from a verified supplier. A lapsed hold cannot be confirmed: its places may
      // already belong to someone else, and confirming it could oversell.
      sql: `UPDATE marau_offer_requests SET status = 'confirmed', decided_by = ?, decided_at = ?, decision_note = ?, hold_expires_at = NULL, updated_at = ?
            WHERE request_id = ? AND status = 'requested' AND hold_expires_at > ?
              AND EXISTS (SELECT 1 FROM marau_experience_offers o JOIN marau_suppliers sp ON sp.supplier_id = o.supplier_id WHERE o.offer_id = marau_offer_requests.offer_id AND o.status = 'published' AND sp.verification_status = 'verified' AND o.expires_at > ?)`,
      bindExtra: (now) => [now, now],
    },
    decline: {
      to: 'declined',
      sql: `UPDATE marau_offer_requests SET status = 'declined', decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ? WHERE request_id = ? AND status = 'requested'`,
      bindExtra: () => [],
    },
    fulfil: {
      to: 'fulfilled',
      sql: `UPDATE marau_offer_requests SET status = 'fulfilled', fulfilled_by = ?, fulfilled_at = ?, decision_note = COALESCE(?, decision_note), updated_at = ? WHERE request_id = ? AND status = 'confirmed'`,
      bindExtra: () => [],
    },
    cancel: {
      to: 'cancelled_by_staff',
      // Also reverses a fulfilled request (a refund/failed delivery) - slice 3 reverses any referral credit it earned.
      sql: `UPDATE marau_offer_requests SET status = 'cancelled_by_staff', decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ? WHERE request_id = ? AND status IN ('requested', 'confirmed', 'fulfilled')`,
      bindExtra: () => [],
    },
  };

  async function staffTransition(request, env, requestId, action) {
    const s = await staffOr401(request, env); if (s.error) return s.error;
    const spec = TRANSITIONS[action];
    if (!spec) return json({ error: 'unknown action' }, 404);
    const j = await readJson(request); const body = j.body || {};
    const note = body.note ? String(body.note).trim().slice(0, 300) : null;
    if (action === 'cancel' && (!note || note.length < 3)) return json({ error: 'a cancellation reason is required' }, 400);
    await expireLapsedHolds(env);
    const before = await env.DB.prepare('SELECT * FROM marau_offer_requests WHERE request_id = ?').bind(requestId).first();
    if (!before) return json({ error: 'request not found' }, 404);
    const now = nowIso();
    const res = await env.DB.prepare(spec.sql).bind(s.operator, now, note, now, requestId, ...spec.bindExtra(now)).run();
    const row = await env.DB.prepare('SELECT * FROM marau_offer_requests WHERE request_id = ?').bind(requestId).first();
    if (res.meta.changes === 1) {
      await logEvent(env, { offerId: row.offer_id, requestId, type: `request_${spec.to}`, actor: s.operator, detail: { from: before.status, note } });
      if (hooks.onRequestTransition) await hooks.onRequestTransition(env, { request: row, from: before.status, to: spec.to, operator: s.operator });
      return json({ ok: true, changed: true, request: requestShape(row), operator: s.operator, demonstration_data: true });
    }
    // Not applied: an exact repeat of the same decision is reported, never re-applied, and never re-attributed.
    if (row.status === spec.to) return json({ ok: true, changed: false, repeated: true, request: requestShape(row), original_operator: row.decided_by || row.fulfilled_by, demonstration_data: true });
    if (action === 'confirm' && row.status === 'expired') return json({ error: 'HOLD_EXPIRED', detail: 'the hold lapsed; ask the guest to request again so places are not oversold' }, 409);
    if (action === 'confirm' && row.status === 'requested') return json({ error: 'OFFER_NO_LONGER_CONFIRMABLE', detail: 'the offer is withdrawn, expired, or its supplier is no longer verified' }, 409);
    return json({ error: 'INVALID_TRANSITION', from: row.status, action }, 409);
  }

  // ----------------------------------------------------------------- payment evidence

  const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'other'];
  const NET_PAID_SQL = `(SELECT COALESCE(SUM(CASE event_type WHEN 'paid' THEN amount_cents ELSE -amount_cents END), 0) FROM marau_offer_payments WHERE request_id = ?)`;

  /**
   * Staff record evidence that a guest PAID for (or was REFUNDED for) a purchase. Marau collects nothing: this is a record of
   * what a named human saw, and it is the only thing that can satisfy a "paid in full" reward policy. Idempotent per
   * (request, event_key); paid can never exceed the total, a refund can never exceed what was paid - both enforced INSIDE the
   * one INSERT, so concurrent or out-of-order events cannot over-record.
   */
  async function recordPayment(request, env, requestId) {
    const s = await staffOr401(request, env); if (s.error) return s.error;
    const j = await readJson(request); const b = j.body || {};
    const errors = [];
    if (!['paid', 'refunded'].includes(b.event)) errors.push("event must be 'paid' or 'refunded'");
    const cents = toCents(b.amount_fjd);
    if (!(cents > 0 && cents <= 10_000_000)) errors.push('amount_fjd must be a positive FJD amount');
    if (!PAYMENT_METHODS.includes(b.method)) errors.push(`method must be one of ${PAYMENT_METHODS.join(', ')}`);
    const eventKey = typeof b.event_key === 'string' ? b.event_key.trim() : '';
    if (eventKey.length < 1 || eventKey.length > 80) errors.push('event_key (a unique id for this payment event, so a retry cannot double-record) is required');
    if (errors.length) return json({ error: 'validation failed', details: errors }, 400);
    const reference = b.reference ? String(b.reference).trim().slice(0, 80) : null;

    const req = await env.DB.prepare('SELECT * FROM marau_offer_requests WHERE request_id = ?').bind(requestId).first();
    if (!req) return json({ error: 'request not found' }, 404);
    if (!['confirmed', 'fulfilled', 'cancelled_by_guest', 'cancelled_by_staff'].includes(req.status)) {
      return json({ error: 'REQUEST_NOT_PAYABLE', status: req.status, detail: 'payment evidence can only be recorded for a confirmed purchase (or one later cancelled)' }, 409);
    }
    // An exact repeat of an event already recorded is a replay, whatever the running totals now allow.
    const prior0 = await env.DB.prepare('SELECT * FROM marau_offer_payments WHERE request_id = ? AND event_key = ?').bind(requestId, eventKey).first();
    if (prior0) return replayPayment(env, requestId, prior0, b.event, cents);
    const boundSql = b.event === 'paid'
      ? `${NET_PAID_SQL} + ? <= (SELECT total_cents FROM marau_offer_requests WHERE request_id = ?)`
      : `? <= ${NET_PAID_SQL}`;
    const boundArgs = b.event === 'paid' ? [requestId, cents, requestId] : [cents, requestId];
    const paymentId = idFor('pay');
    let inserted;
    try {
      inserted = await env.DB.prepare(
        `INSERT INTO marau_offer_payments (payment_id, request_id, event_type, amount_cents, method, reference, event_key, recorded_by, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${boundSql}`
      ).bind(paymentId, requestId, b.event, cents, b.method, reference, eventKey, s.operator, nowIso(), ...boundArgs).run();
    } catch (err) {
      if (!/UNIQUE/i.test(String(err && err.message))) throw err;
      const prior = await env.DB.prepare('SELECT * FROM marau_offer_payments WHERE request_id = ? AND event_key = ?').bind(requestId, eventKey).first();
      return replayPayment(env, requestId, prior, b.event, cents); // a concurrent identical event won the insert
    }
    if (inserted.meta.changes !== 1) {
      const t = await paymentTotals(env, requestId);
      return b.event === 'paid'
        ? json({ error: 'OVERPAYMENT', detail: 'this would record more than the purchase total', total_fjd: fjd(req.total_cents), net_paid_fjd: t.net_paid_fjd }, 409)
        : json({ error: 'REFUND_EXCEEDS_PAYMENT', detail: 'a refund cannot exceed what has been recorded as paid', net_paid_fjd: t.net_paid_fjd }, 409);
    }
    await logEvent(env, { offerId: req.offer_id, requestId, type: `payment_${b.event}`, actor: s.operator, detail: { amount_fjd: fjd(cents), method: b.method, event_key: eventKey } });
    if (hooks.onRequestTransition) await hooks.onRequestTransition(env, { request: req, from: req.status, to: req.status, operator: s.operator });
    const row = await env.DB.prepare('SELECT * FROM marau_offer_payments WHERE payment_id = ?').bind(paymentId).first();
    return json({ ok: true, payment: paymentShape(row), totals: await paymentTotals(env, requestId), demonstration_data: true });
  }

  async function replayPayment(env, requestId, prior, event, cents) {
    if (prior && prior.event_type === event && prior.amount_cents === cents) {
      return json({ ok: true, repeated: true, original_operator: prior.recorded_by, payment: paymentShape(prior), totals: await paymentTotals(env, requestId), demonstration_data: true });
    }
    return json({ error: 'EVENT_KEY_REUSED', detail: 'that event_key was already used for a different payment event' }, 409);
  }

  const paymentShape = (p) => ({ payment_id: p.payment_id, event: p.event_type, amount_fjd: fjd(p.amount_cents), method: p.method, reference: p.reference, recorded_by: p.recorded_by, recorded_at: p.created_at });

  async function paymentTotals(env, requestId) {
    const r = await env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN event_type = 'paid' THEN amount_cents END), 0) AS paid, COALESCE(SUM(CASE WHEN event_type = 'refunded' THEN amount_cents END), 0) AS refunded FROM marau_offer_payments WHERE request_id = ?`
    ).bind(requestId).first();
    return { paid_fjd: fjd(r.paid), refunded_fjd: fjd(r.refunded), net_paid_fjd: fjd(r.paid - r.refunded) };
  }

  // ---------------------------------------------------------------- editions

  async function upsertEdition(request, env) {
    const s = await staffOr401(request, env); if (s.error) return s.error;
    const j = await readJson(request); if (j.error) return j.error;
    const fijiDate = String(j.body.fiji_date || '');
    const slot = String(j.body.slot || '');
    const offerIds = Array.isArray(j.body.offer_ids) ? j.body.offer_ids.map(String) : [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fijiDate)) return json({ error: 'fiji_date must be YYYY-MM-DD (Fiji calendar date)' }, 400);
    if (!['morning', 'afternoon'].includes(slot)) return json({ error: "slot must be 'morning' or 'afternoon'" }, 400);
    if (offerIds.length < 1 || offerIds.length > 12) return json({ error: 'an edition features 1-12 offers' }, 400);
    for (const id of offerIds) {
      const o = await env.DB.prepare('SELECT 1 AS ok FROM marau_experience_offers WHERE offer_id = ?').bind(id).first();
      if (!o) return json({ error: 'OFFER_NOT_FOUND', offer_id: id }, 404);
    }
    const editionId = `${fijiDate}:${slot}`;
    const now = nowIso();
    const existing = await env.DB.prepare('SELECT status FROM marau_deal_editions WHERE edition_id = ?').bind(editionId).first();
    if (existing && existing.status === 'published') return json({ error: 'EDITION_ALREADY_PUBLISHED', detail: 'a published edition is immutable; prepare a correction by withdrawing offers instead' }, 409);
    if (!existing) await env.DB.prepare(`INSERT INTO marau_deal_editions (edition_id, fiji_date, slot, status, created_by, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?, ?)`).bind(editionId, fijiDate, slot, s.operator, now, now).run();
    await env.DB.prepare('DELETE FROM marau_edition_offers WHERE edition_id = ?').bind(editionId).run();
    for (const [i, id] of offerIds.entries()) await env.DB.prepare('INSERT INTO marau_edition_offers (edition_id, offer_id, position) VALUES (?, ?, ?)').bind(editionId, id, i).run();
    await env.DB.prepare('UPDATE marau_deal_editions SET updated_at = ? WHERE edition_id = ?').bind(now, editionId).run();
    await logEvent(env, { type: 'edition_prepared', actor: s.operator, detail: { edition_id: editionId, offers: offerIds.length } });
    return json({ ok: true, edition_id: editionId, status: 'draft', demonstration_data: true }, existing ? 200 : 201);
  }

  async function publishEdition(request, env, editionId) {
    const s = await staffOr401(request, env); if (s.error) return s.error;
    const now = nowIso();
    const bad = await env.DB.prepare(
      `SELECT eo.offer_id FROM marau_edition_offers eo JOIN marau_experience_offers o ON o.offer_id = eo.offer_id WHERE eo.edition_id = ? AND (o.status != 'published' OR o.expires_at <= ?)`
    ).bind(editionId, now).first();
    if (bad) return json({ error: 'EDITION_CONTAINS_UNPUBLISHED_OFFER', offer_id: bad.offer_id }, 409);
    const res = await env.DB.prepare(`UPDATE marau_deal_editions SET status = 'published', published_by = ?, published_at = ?, updated_at = ? WHERE edition_id = ? AND status = 'draft'`).bind(s.operator, now, now, editionId).run();
    const row = await env.DB.prepare('SELECT edition_id, fiji_date, slot, status FROM marau_deal_editions WHERE edition_id = ?').bind(editionId).first();
    if (!row) return json({ error: 'edition not found' }, 404);
    if (res.meta.changes === 1) await logEvent(env, { type: 'edition_published', actor: s.operator, detail: { edition_id: editionId } });
    return json({ ok: true, changed: res.meta.changes === 1, edition: row, demonstration_data: true });
  }

  // ------------------------------------------------------------------ report

  async function report(request, env) {
    const s = await staffOr401(request, env); if (s.error) return s.error;
    await expireLapsedHolds(env);
    const { results } = await env.DB.prepare(
      `SELECT r.status, COUNT(*) AS n, SUM(r.places) AS places, SUM(r.total_cents) AS total_cents,
              SUM(r.places * (r.price_per_place_cents - o.cost_per_place_cents)) AS contribution_cents
       FROM marau_offer_requests r JOIN marau_experience_offers o ON o.offer_id = r.offer_id GROUP BY r.status`
    ).all();
    const by = Object.fromEntries(results.map((r) => [r.status, r]));
    const sum = (statuses, key) => statuses.reduce((a, st) => a + ((by[st] && by[st][key]) || 0), 0);
    const requestsTotal = results.reduce((a, r) => a + r.n, 0);
    const pay = await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN event_type = 'paid' THEN amount_cents ELSE -amount_cents END), 0) AS net FROM marau_offer_payments`).first();
    const extra = hooks.reportExtras ? await hooks.reportExtras(env) : {};
    return json({
      // Each figure is labelled for exactly what it is. QUOTED VALUE IS NOT COLLECTED REVENUE; nothing here is paid.
      requests_total: requestsTotal,
      requests_open_awaiting_human: (by.requested && by.requested.n) || 0,
      requests_confirmed: (by.confirmed && by.confirmed.n) || 0,
      requests_fulfilled: (by.fulfilled && by.fulfilled.n) || 0,
      requests_declined_cancelled_expired: sum(['declined', 'cancelled_by_guest', 'cancelled_by_staff', 'expired'], 'n'),
      quoted_value_open_fjd: fjd(sum(['requested'], 'total_cents')),
      confirmed_sales_value_fjd: fjd(sum(['confirmed', 'fulfilled'], 'total_cents')),
      fulfilled_sales_value_fjd: fjd(sum(['fulfilled'], 'total_cents')),
      payment_evidenced_net_fjd: fjd(pay.net),
      expected_contribution_fjd_before_rewards: fjd(sum(['confirmed', 'fulfilled'], 'contribution_cents')),
      realised_contribution_fjd_before_rewards: fjd(sum(['fulfilled'], 'contribution_cents')),
      ...extra,
      labels: {
        quoted_value: 'what open requests would be worth if confirmed - NOT revenue',
        confirmed_sales: 'requests a human has confirmed (payment not collected by Marau)',
        payment_evidenced: 'payments minus refunds that a named staff member recorded as seen - evidence, not a bank reconciliation',
        contribution: 'price minus supplier cost per place, before any referral reward funding',
      },
      demonstration_data: true,
    });
  }

  // ----------------------------------------------------------- staff listings

  async function listSuppliers(request, env) {
    const s = await staffOr401(request, env); if (s.error) return s.error;
    const { results } = await env.DB.prepare('SELECT supplier_id, name, fulfilment_owner, verification_status, verified_by, verified_at FROM marau_suppliers ORDER BY created_at DESC').all();
    return json({ suppliers: results, demonstration_data: true });
  }

  async function listEditions(request, env) {
    const s = await staffOr401(request, env); if (s.error) return s.error;
    const { results } = await env.DB.prepare(
      `SELECT e.edition_id, e.fiji_date, e.slot, e.status, e.published_by, o.offer_id, o.title FROM marau_deal_editions e
       LEFT JOIN marau_edition_offers eo ON eo.edition_id = e.edition_id LEFT JOIN marau_experience_offers o ON o.offer_id = eo.offer_id
       ORDER BY e.fiji_date DESC, e.slot ASC, eo.position ASC LIMIT 200`
    ).all();
    const by = new Map();
    for (const r of results) {
      if (!by.has(r.edition_id)) by.set(r.edition_id, { edition_id: r.edition_id, fiji_date: r.fiji_date, slot: r.slot, status: r.status, published_by: r.published_by, offers: [] });
      if (r.offer_id) by.get(r.edition_id).offers.push({ offer_id: r.offer_id, title: r.title });
    }
    return json({ editions: [...by.values()], demonstration_data: true });
  }

  // ------------------------------------------------------------------ router

  /** Returns a Response for an experience-offer route, or null when the path is not one of ours. */
  async function route(request, env, url) {
    const m = request.method; const p = url.pathname;
    // guest / public
    if (m === 'GET' && p === '/preview/offers') return listPublic(request, env);
    let x = p.match(/^\/preview\/offers\/(off_[^/]+)\/request$/); if (m === 'POST' && x) return requestOffer(request, env, x[1]);
    x = p.match(/^\/preview\/offers\/requests\/(req_[^/]+)\/cancel$/); if (m === 'POST' && x) return guestCancel(request, env, x[1]);
    x = p.match(/^\/preview\/offers\/requests\/(req_[^/]+)\/whatsapp-handoff$/); if (m === 'POST' && x) return guestHandoff(request, env, x[1]);
    // staff (the router has already required the shared admin credential for /preview/admin/*)
    if (m === 'POST' && p === '/preview/admin/suppliers') return createSupplier(request, env);
    if (m === 'GET' && p === '/preview/admin/suppliers') return listSuppliers(request, env);
    if (m === 'GET' && p === '/preview/admin/editions') return listEditions(request, env);
    x = p.match(/^\/preview\/admin\/suppliers\/(sup_[^/]+)\/(verify|suspend)$/); if (m === 'POST' && x) return setSupplierVerification(request, env, x[1], x[2] === 'verify' ? 'verified' : 'suspended');
    if (m === 'POST' && p === '/preview/admin/offers') return createOffer(request, env);
    if (m === 'GET' && p === '/preview/admin/offers') return listOffersStaff(request, env);
    if (m === 'GET' && p === '/preview/admin/offers/report') return report(request, env);
    if (m === 'GET' && p === '/preview/admin/offers/requests') return listRequestsStaff(request, env, url);
    x = p.match(/^\/preview\/admin\/offers\/(off_[^/]+)\/(publish|withdraw)$/); if (m === 'POST' && x) return x[2] === 'publish' ? publishOffer(request, env, x[1]) : withdrawOffer(request, env, x[1]);
    x = p.match(/^\/preview\/admin\/offers\/requests\/(req_[^/]+)\/payment$/); if (m === 'POST' && x) return recordPayment(request, env, x[1]);
    x = p.match(/^\/preview\/admin\/offers\/requests\/(req_[^/]+)\/(confirm|decline|fulfil|cancel)$/); if (m === 'POST' && x) return staffTransition(request, env, x[1], x[2]);
    if (m === 'POST' && p === '/preview/admin/editions') return upsertEdition(request, env);
    x = p.match(/^\/preview\/admin\/editions\/([^/]+)\/publish$/); if (m === 'POST' && x) return publishEdition(request, env, decodeURIComponent(x[1]));
    return null;
  }

  return { route, offerRequestsForSession, expireLapsedHolds };
}
