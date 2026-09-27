/* Marau Stage 1 (PREVIEW ONLY) — API + guest app + ops interface.
 *
 * ISOLATION: this Worker has no production binding of any kind. Its D1
 * binding (env.DB) must point at a dedicated, isolated test database —
 * never nadi-marketplace-db. It never calls a real WhatsApp API, a real
 * AI provider, or any other external network endpoint: WhatsApp handoffs
 * are constructed and returned as data for the guest app to render as a
 * link, never sent by this Worker; AI assistance is the fully
 * deterministic, no-network module in ./ai_assist.js. See
 * docs/MARAU_STAGE1_REVIEW_PACKAGE.md for the full isolation statement,
 * exact SHAs and migration list this was built and tested against.
 *
 * Reuses (never replaces) Issue #54's existing engine: the movement
 * ledger, matcher, pricing guardrails and offer state machine all come
 * from ../../smart-return-trigger-fill/src/*.js, unmodified except for
 * the async-store defect fix (see that package's own commit history).
 * This file adds only what Issue #54 never built: guest identity/session,
 * a synthetic booking flow, idempotent deal requests, the vehicle/time
 * exclusivity guard across DIFFERENT offers (vehicle_time_claims), booking
 * change requests, an authenticated ops confirm/decline interface, and
 * bounded AI assistance.
 */
import { createD1Store } from '../../smart-return-trigger-fill/src/db.js';
import { discoverOffer, validateOffer, activateOffer, holdOffer, fillOffer, expireOffer } from '../../smart-return-trigger-fill/src/offers.js';
import { cryptoRandomId } from '../../smart-return-trigger-fill/src/model.js';
import { buildAssistResponse } from './ai_assist.js';
import { GUEST_APP_HTML, ADMIN_APP_HTML } from './pages.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' };

function nowIso() {
  return new Date().toISOString();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function html(text, status = 200) {
  return new Response(text, { status, headers: HTML_HEADERS });
}

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer (.+)$/i);
  return match ? match[1] : null;
}

// Loose, deliberately permissive validation — this is synthetic preview
// data, not a real KYC check. The point being proven is that the SERVER
// enforces presence and shape at all, not that it's a production-grade
// validator (Issue #59's own open item: guest_email is client-required
// but NOT server-enforced on the real sites today — Marau fixes that gap
// for its own booking flow from the start).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9()\-.\s]{7,20}$/;

function normalizePhone(phone) {
  return String(phone).replace(/[^0-9+]/g, '');
}

function validateBookingInput(body) {
  const errors = [];
  if (!body || typeof body !== 'object') return ['request body must be a JSON object'];
  if (!body.guest_email || !EMAIL_RE.test(String(body.guest_email))) errors.push('guest_email is required and must look like an email address');
  if (!body.guest_phone || !PHONE_RE.test(String(body.guest_phone))) errors.push('guest_phone is required and must look like a phone number');
  for (const field of ['pickup_zone', 'destination_zone', 'vehicle_type', 'pickup_datetime']) {
    if (!body[field]) errors.push(`${field} is required`);
  }
  if (body.pickup_datetime && Number.isNaN(new Date(body.pickup_datetime).getTime())) {
    errors.push('pickup_datetime is not a valid date');
  }
  if (!(Number.isFinite(Number(body.quoted_amount)) && Number(body.quoted_amount) >= 0)) {
    errors.push('quoted_amount must be a non-negative number');
  }
  if (body.whatsapp_available !== undefined && body.whatsapp_available !== null && typeof body.whatsapp_available !== 'boolean') {
    errors.push('whatsapp_available must be true, false, or omitted/null (unknown) — it is recorded, never required');
  }
  return errors;
}

async function findOrCreateGuestSession(env, { guest_email, guest_phone, whatsapp_available }) {
  const contactKey = normalizePhone(guest_phone);
  const existing = await env.DB
    .prepare('SELECT * FROM guest_sessions WHERE guest_contact_key = ? AND access_token_revoked = 0 ORDER BY created_at DESC LIMIT 1')
    .bind(contactKey)
    .first();
  if (existing) return existing;

  const session = {
    session_id: `gs_${cryptoRandomId()}`,
    guest_contact_key: contactKey,
    guest_email,
    guest_phone,
    whatsapp_available: whatsapp_available === true ? 1 : whatsapp_available === false ? 0 : null,
    access_token: `tok_${cryptoRandomId()}`,
    access_token_revoked: 0,
    test_data: 1,
    created_at: nowIso(),
    last_accessed_at: null,
  };
  await env.DB
    .prepare(
      `INSERT INTO guest_sessions (session_id, guest_contact_key, guest_email, guest_phone, whatsapp_available, access_token, access_token_revoked, test_data, created_at, last_accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      session.session_id,
      session.guest_contact_key,
      session.guest_email,
      session.guest_phone,
      session.whatsapp_available,
      session.access_token,
      session.access_token_revoked,
      session.test_data,
      session.created_at,
      session.last_accessed_at
    )
    .run();
  return session;
}

async function requireGuestSession(request, env) {
  const token = bearerToken(request);
  if (!token) return null;
  const session = await env.DB
    .prepare('SELECT * FROM guest_sessions WHERE access_token = ? AND access_token_revoked = 0')
    .bind(token)
    .first();
  if (!session) return null;
  await env.DB.prepare('UPDATE guest_sessions SET last_accessed_at = ? WHERE session_id = ?').bind(nowIso(), session.session_id).run();
  return session;
}

function requireAdmin(request, env) {
  const token = bearerToken(request);
  return Boolean(token) && Boolean(env.MARAU_ADMIN_TEST_TOKEN) && token === env.MARAU_ADMIN_TEST_TOKEN;
}

// ---------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------

async function handleCreateBooking(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const errors = validateBookingInput(body);
  if (errors.length > 0) return json({ error: 'validation failed', details: errors }, 400);

  const clientBookingRef = body.client_booking_ref || `MARAU-${cryptoRandomId()}`;
  const session = await findOrCreateGuestSession(env, body);

  const insertResult = await env.DB
    .prepare(
      `INSERT OR IGNORE INTO marau_test_bookings
        (client_booking_ref, guest_session_id, guest_email, guest_phone, pickup_zone, destination_zone, vehicle_type, pickup_datetime, quoted_amount, status, test_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?)`
    )
    .bind(
      clientBookingRef,
      session.session_id,
      body.guest_email,
      body.guest_phone,
      body.pickup_zone,
      body.destination_zone,
      body.vehicle_type,
      new Date(body.pickup_datetime).toISOString(),
      Number(body.quoted_amount),
      nowIso(),
      nowIso()
    )
    .run();

  // Idempotent retry: a duplicate client_booking_ref returns the SAME
  // booking and the SAME access token, never a second row or a second
  // token — this is the "duplicate/retry recovery" acceptance criterion.
  const booking = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE client_booking_ref = ?').bind(clientBookingRef).first();

  return json(
    {
      booking_reference: booking.client_booking_ref,
      status: booking.status,
      message: 'Awaiting human confirmation',
      access_token: session.access_token,
      was_new_booking: insertResult.meta.changes === 1,
      demonstration_data: true,
    },
    insertResult.meta.changes === 1 ? 201 : 200
  );
}

async function handleGetTrip(request, env) {
  const session = await requireGuestSession(request, env);
  if (!session) return json({ error: 'unauthorized — invalid or revoked access token' }, 401);

  const { results: bookings } = await env.DB
    .prepare('SELECT * FROM marau_test_bookings WHERE guest_session_id = ? ORDER BY pickup_datetime ASC')
    .bind(session.session_id)
    .all();

  return json({
    guest_email: session.guest_email,
    guest_phone: session.guest_phone,
    whatsapp_available: session.whatsapp_available === 1 ? true : session.whatsapp_available === 0 ? false : null,
    bookings,
  });
}

async function handleRevokeTrip(request, env) {
  const session = await requireGuestSession(request, env);
  if (!session) return json({ error: 'unauthorized — invalid or revoked access token' }, 401);
  await env.DB.prepare('UPDATE guest_sessions SET access_token_revoked = 1 WHERE session_id = ?').bind(session.session_id).run();
  return json({ revoked: true });
}

async function handleChangeRequest(request, env, bookingId) {
  const session = await requireGuestSession(request, env);
  if (!session) return json({ error: 'unauthorized — invalid or revoked access token' }, 401);

  const booking = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(bookingId).first();
  if (!booking || booking.guest_session_id !== session.session_id) {
    return json({ error: 'booking not found for this session' }, 404);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  if (!body || typeof body.requested_fields !== 'object' || body.requested_fields === null) {
    return json({ error: 'requested_fields object is required' }, 400);
  }

  const changeRequestId = `chg_${cryptoRandomId()}`;
  await env.DB
    .prepare(
      `INSERT INTO booking_change_requests (change_request_id, booking_id, requested_fields_json, status, created_at)
       VALUES (?, ?, ?, 'PENDING', ?)`
    )
    .bind(changeRequestId, booking.id, JSON.stringify(body.requested_fields), nowIso())
    .run();

  return json({ change_request_id: changeRequestId, status: 'PENDING', note: 'The original booking is unchanged until an operator approves this request.' }, 201);
}

// ---------------------------------------------------------------------
// Deals (public browse; authenticated request)
// ---------------------------------------------------------------------

async function handleListDeals(env) {
  const { results } = await env.DB
    .prepare(`SELECT * FROM smart_offers WHERE status IN ('ACTIVE', 'VALIDATED') ORDER BY earliest_pickup ASC`)
    .all();

  const deals = results.map((o) => ({
    offer_id: o.offer_id,
    origin_zone: o.origin_zone,
    destination_zone: o.destination_zone,
    vehicle_class: o.vehicle_class,
    capacity: o.capacity,
    total_price: o.smart_match_price ?? o.standard_price,
    standard_price: o.standard_price,
    conditions: `Confirmed by operator before travel. Capacity ${o.capacity}. Vehicle: ${o.vehicle_class}.`,
    earliest_pickup: o.earliest_pickup,
    latest_pickup: o.latest_pickup,
    expires_at: o.expires_at,
    label: o.test_data ? 'DEMONSTRATION DATA — preview only, not a real offer' : undefined,
  }));

  return json({ deals, demonstration_data: true });
}

async function handleRequestDeal(request, env, offerId) {
  const session = await requireGuestSession(request, env);
  if (!session) return json({ error: 'unauthorized — invalid or revoked access token. Save or open a booking first.' }, 401);

  const store = createD1Store({ SMART_RETURN_DB: env.DB });
  const offer = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offerId).first();
  if (!offer) return json({ error: 'offer not found' }, 404);

  const isExpired = offer.expires_at && new Date(offer.expires_at) <= new Date();
  if (isExpired || !['ACTIVE', 'VALIDATED'].includes(offer.status)) {
    if (isExpired && offer.status !== 'EXPIRED' && offer.status !== 'FILLED') {
      await expireOffer(store, offerId);
    }
    return json({ error: 'STALE_OR_EXPIRED_OFFER', detail: `offer status is ${offer.status}, expires_at ${offer.expires_at}` }, 409);
  }

  const idempotencyKey = `${session.session_id}:${offerId}`;
  const requestId = `dr_${cryptoRandomId()}`;
  const insertResult = await env.DB
    .prepare(
      `INSERT OR IGNORE INTO deal_requests
        (request_id, offer_id, guest_session_id, idempotency_key, status, whatsapp_handoff_prepared, test_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'REQUESTED', 1, 1, ?, ?)`
    )
    .bind(requestId, offerId, session.session_id, idempotencyKey, nowIso(), nowIso())
    .run();

  const dealRequest = await env.DB.prepare('SELECT * FROM deal_requests WHERE idempotency_key = ?').bind(idempotencyKey).first();

  const opsNumber = env.MARAU_OPS_WHATSAPP_TEST_NUMBER || '+15556414099';
  const whatsappHandoff = {
    to: opsNumber,
    message: `Marau deal request ${dealRequest.request_id}: guest wants offer ${offer.offer_id} (${offer.origin_zone} -> ${offer.destination_zone}, ${offer.vehicle_class}) at ${offer.smart_match_price ?? offer.standard_price}. Reply to confirm or decline in the ops console.`,
    note: 'This message is constructed for you to send yourself — Marau never sends it automatically, and opening WhatsApp is not a confirmation.',
  };

  return json(
    {
      request_id: dealRequest.request_id,
      status: dealRequest.status,
      was_new_request: insertResult.meta.changes === 1,
      whatsapp_handoff: whatsappHandoff,
    },
    insertResult.meta.changes === 1 ? 201 : 200
  );
}

// ---------------------------------------------------------------------
// AI assist (bounded — see ./ai_assist.js)
// ---------------------------------------------------------------------

async function handleAssist(request, env) {
  const session = await requireGuestSession(request, env);
  if (!session) return json({ error: 'unauthorized — invalid or revoked access token' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { results: bookings } = await env.DB
    .prepare('SELECT * FROM marau_test_bookings WHERE guest_session_id = ? ORDER BY pickup_datetime ASC')
    .bind(session.session_id)
    .all();
  const { results: offers } = await env.DB
    .prepare(`SELECT * FROM smart_offers WHERE status IN ('ACTIVE', 'VALIDATED')`)
    .all();

  return json(buildAssistResponse({ question: body.question, bookings, offers }));
}

// ---------------------------------------------------------------------
// Admin (ops) — authenticated test interface. Confirming here is the
// ONLY thing that ever moves a deal_request to CONFIRMED or a booking to
// 'confirmed' — no messaging side effect anywhere in this Worker does
// that.
// ---------------------------------------------------------------------

async function handleAdminListDealRequests(env) {
  const { results } = await env.DB
    .prepare(
      `SELECT dr.*, o.origin_zone, o.destination_zone, o.vehicle_class, o.standard_price, o.smart_match_price, o.expires_at AS offer_expires_at, o.status AS offer_status, o.source_movement_id,
              gs.guest_email, gs.guest_phone
       FROM deal_requests dr
       JOIN smart_offers o ON o.offer_id = dr.offer_id
       JOIN guest_sessions gs ON gs.session_id = dr.guest_session_id
       ORDER BY dr.created_at DESC`
    )
    .all();
  return json({ deal_requests: results });
}

async function handleAdminConfirmDealRequest(env, requestId) {
  const store = createD1Store({ SMART_RETURN_DB: env.DB });

  const dealRequest = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requestId).first();
  if (!dealRequest) return json({ error: 'deal request not found' }, 404);
  if (dealRequest.status !== 'REQUESTED') {
    return json({ error: 'ALREADY_DECIDED', current_status: dealRequest.status }, 409);
  }

  const offer = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(dealRequest.offer_id).first();
  if (!offer) return json({ error: 'offer no longer exists' }, 404);

  const isExpired = offer.expires_at && new Date(offer.expires_at) <= new Date();
  if (isExpired || !['ACTIVE', 'VALIDATED'].includes(offer.status)) {
    if (isExpired && offer.status !== 'EXPIRED' && offer.status !== 'FILLED') {
      await expireOffer(store, offer.offer_id);
    }
    return json({ error: 'STALE_OR_EXPIRED_OFFER', detail: `offer status is ${offer.status}` }, 409);
  }

  // The exclusivity guard: claim the real vehicle/time slot BEFORE moving
  // the offer's own status. If another offer for the same
  // source_movement_id already claimed it, this throws a constraint
  // violation and nothing else in this function runs.
  try {
    await env.DB
      .prepare(
        `INSERT INTO vehicle_time_claims (source_movement_id, claimed_by_offer_id, claimed_by_request_id, claimed_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(offer.source_movement_id, offer.offer_id, dealRequest.request_id, nowIso())
      .run();
  } catch (err) {
    if (err.isConstraintViolation) {
      return json(
        {
          error: 'VEHICLE_TIME_ALREADY_CLAIMED',
          detail: 'Another offer for the same vehicle/time slot has already been confirmed. This request is unchanged — decline it or contact the guest with an alternative.',
        },
        409
      );
    }
    throw err;
  }

  // Only reachable if this request won the exclusivity claim above.
  if (offer.status === 'VALIDATED') {
    await activateOffer(store, offer.offer_id);
  }
  const held = await holdOffer(store, offer.offer_id);
  if (!held.success) {
    return json({ error: 'OFFER_STATE_CONFLICT', detail: held.reason }, 409);
  }
  const filled = await fillOffer(store, offer.offer_id, { movement_id: offer.source_movement_id });

  await env.DB
    .prepare(`UPDATE deal_requests SET status = 'CONFIRMED', decided_by = ?, decided_at = ?, updated_at = ? WHERE request_id = ?`)
    .bind('marau-ops-preview', nowIso(), nowIso(), requestId)
    .run();

  return json({
    request_id: requestId,
    status: 'CONFIRMED',
    offer: filled.offer,
  });
}

async function handleAdminDeclineDealRequest(env, requestId) {
  const dealRequest = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requestId).first();
  if (!dealRequest) return json({ error: 'deal request not found' }, 404);
  if (dealRequest.status !== 'REQUESTED') {
    return json({ error: 'ALREADY_DECIDED', current_status: dealRequest.status }, 409);
  }
  await env.DB
    .prepare(`UPDATE deal_requests SET status = 'DECLINED', decided_by = ?, decided_at = ?, updated_at = ? WHERE request_id = ?`)
    .bind('marau-ops-preview', nowIso(), nowIso(), requestId)
    .run();
  return json({ request_id: requestId, status: 'DECLINED' });
}

async function handleAdminListBookings(env) {
  const { results } = await env.DB.prepare('SELECT * FROM marau_test_bookings ORDER BY created_at DESC').all();
  return json({ bookings: results });
}

async function handleAdminDecideBooking(env, bookingId, decision) {
  const booking = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(bookingId).first();
  if (!booking) return json({ error: 'booking not found' }, 404);
  if (booking.status !== 'pending') return json({ error: 'ALREADY_DECIDED', current_status: booking.status }, 409);
  const nextStatus = decision === 'confirm' ? 'confirmed' : 'declined';
  await env.DB.prepare('UPDATE marau_test_bookings SET status = ?, updated_at = ? WHERE id = ?').bind(nextStatus, nowIso(), bookingId).run();
  return json({ id: bookingId, status: nextStatus });
}

async function handleAdminListChangeRequests(env) {
  const { results } = await env.DB
    .prepare(
      `SELECT cr.*, b.client_booking_ref, b.pickup_zone AS current_pickup_zone, b.destination_zone AS current_destination_zone, b.pickup_datetime AS current_pickup_datetime
       FROM booking_change_requests cr
       JOIN marau_test_bookings b ON b.id = cr.booking_id
       ORDER BY cr.created_at DESC`
    )
    .all();
  return json({ change_requests: results });
}

// Only these booking columns can ever be touched by an approved change
// request — guest_email/guest_phone/quoted_amount/status/client_booking_ref
// are never overwritable this way.
const CHANGEABLE_BOOKING_FIELDS = new Set(['pickup_zone', 'destination_zone', 'vehicle_type', 'pickup_datetime']);

async function handleAdminDecideChangeRequest(env, changeRequestId, decision) {
  const changeRequest = await env.DB.prepare('SELECT * FROM booking_change_requests WHERE change_request_id = ?').bind(changeRequestId).first();
  if (!changeRequest) return json({ error: 'change request not found' }, 404);
  if (changeRequest.status !== 'PENDING') return json({ error: 'ALREADY_DECIDED', current_status: changeRequest.status }, 409);

  if (decision === 'reject') {
    await env.DB
      .prepare(`UPDATE booking_change_requests SET status = 'REJECTED', decided_by = ?, decided_at = ? WHERE change_request_id = ?`)
      .bind('marau-ops-preview', nowIso(), changeRequestId)
      .run();
    return json({ change_request_id: changeRequestId, status: 'REJECTED' });
  }

  const requested = JSON.parse(changeRequest.requested_fields_json);
  const safeFields = Object.keys(requested).filter((k) => CHANGEABLE_BOOKING_FIELDS.has(k));
  if (safeFields.length === 0) {
    return json({ error: 'no changeable fields in this request' }, 400);
  }
  const setClause = safeFields.map((f) => `${f} = ?`).join(', ');
  const values = safeFields.map((f) => requested[f]);
  await env.DB
    .prepare(`UPDATE marau_test_bookings SET ${setClause}, updated_at = ? WHERE id = ?`)
    .bind(...values, nowIso(), changeRequest.booking_id)
    .run();

  await env.DB
    .prepare(`UPDATE booking_change_requests SET status = 'APPROVED', decided_by = ?, decided_at = ? WHERE change_request_id = ?`)
    .bind('marau-ops-preview', nowIso(), changeRequestId)
    .run();

  return json({ change_request_id: changeRequestId, status: 'APPROVED', applied_fields: safeFields });
}

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      if (method === 'GET' && pathname === '/health') return json({ status: 'ok', mode: 'preview' });
      if (method === 'GET' && (pathname === '/' || pathname === '/app' || pathname === '/index.html')) return html(GUEST_APP_HTML);
      if (method === 'GET' && (pathname === '/admin' || pathname === '/admin.html')) return html(ADMIN_APP_HTML);

      if (method === 'POST' && pathname === '/preview/bookings') return handleCreateBooking(request, env);
      if (method === 'GET' && pathname === '/preview/trip') return handleGetTrip(request, env);
      if (method === 'POST' && pathname === '/preview/trip/revoke') return handleRevokeTrip(request, env);

      const changeReqMatch = pathname.match(/^\/preview\/bookings\/(\d+)\/change-request$/);
      if (method === 'POST' && changeReqMatch) return handleChangeRequest(request, env, Number(changeReqMatch[1]));

      if (method === 'GET' && pathname === '/preview/deals') return handleListDeals(env);
      const dealRequestMatch = pathname.match(/^\/preview\/deals\/([^/]+)\/request$/);
      if (method === 'POST' && dealRequestMatch) return handleRequestDeal(request, env, dealRequestMatch[1]);

      if (method === 'POST' && pathname === '/preview/assist') return handleAssist(request, env);

      // ---- Admin routes: all require the test-only admin bearer token ----
      if (pathname.startsWith('/preview/admin/')) {
        if (!requireAdmin(request, env)) return json({ error: 'unauthorized — admin test token required' }, 401);

        if (method === 'GET' && pathname === '/preview/admin/deal-requests') return handleAdminListDealRequests(env);
        const confirmMatch = pathname.match(/^\/preview\/admin\/deal-requests\/([^/]+)\/confirm$/);
        if (method === 'POST' && confirmMatch) return handleAdminConfirmDealRequest(env, confirmMatch[1]);
        const declineMatch = pathname.match(/^\/preview\/admin\/deal-requests\/([^/]+)\/decline$/);
        if (method === 'POST' && declineMatch) return handleAdminDeclineDealRequest(env, declineMatch[1]);

        if (method === 'GET' && pathname === '/preview/admin/bookings') return handleAdminListBookings(env);
        const bookingDecisionMatch = pathname.match(/^\/preview\/admin\/bookings\/(\d+)\/(confirm|decline)$/);
        if (method === 'POST' && bookingDecisionMatch) return handleAdminDecideBooking(env, Number(bookingDecisionMatch[1]), bookingDecisionMatch[2]);

        if (method === 'GET' && pathname === '/preview/admin/change-requests') return handleAdminListChangeRequests(env);
        const changeDecisionMatch = pathname.match(/^\/preview\/admin\/change-requests\/([^/]+)\/(approve|reject)$/);
        if (method === 'POST' && changeDecisionMatch) return handleAdminDecideChangeRequest(env, changeDecisionMatch[1], changeDecisionMatch[2]);
      }

      return json({ error: 'not found' }, 404);
    } catch (err) {
      console.error('[marau-preview] unhandled error', err);
      return json({ error: 'internal error', detail: String(err && err.message) }, 500);
    }
  },
};
