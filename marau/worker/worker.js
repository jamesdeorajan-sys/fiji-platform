/* Marau Stage 1 (PREVIEW ONLY) — API + guest app + ops interface.
 *
 * ISOLATION: this Worker has no production binding of any kind. Its D1
 * binding (env.DB) must point at a dedicated, isolated test database —
 * never nadi-marketplace-db. It never calls a real WhatsApp API, a real
 * AI provider, or any other external network endpoint: WhatsApp handoffs
 * are constructed and returned as data for the guest app to show in a
 * mock panel, never sent by this Worker and never navigated to; AI
 * assistance is the fully deterministic, no-network module in
 * ./ai_assist.js. See docs/MARAU_STAGE1_REVIEW_PACKAGE.md for the full
 * isolation statement, exact SHAs and migration list this was built and
 * tested against, and docs/MARAU_STAGE1_CODEX_FIXES.md for the five
 * findings fixed in this revision.
 *
 * Reuses (never replaces) Issue #54's existing engine: the movement
 * ledger, matcher, pricing guardrails and offer state machine all come
 * from ../../smart-return-trigger-fill/src/*.js, unmodified except for
 * the async-store defect fix (see that package's own commit history).
 */
import { createD1Store } from '../../smart-return-trigger-fill/src/db.js';
import { discoverOffer, validateOffer, activateOffer, holdOffer, fillOffer, expireOffer } from '../../smart-return-trigger-fill/src/offers.js';
import { cryptoRandomId } from '../../smart-return-trigger-fill/src/model.js';
import { buildAssistResponse } from './ai_assist.js';
import { GUEST_APP_HTML, ADMIN_APP_HTML } from './pages.js';
import { evaluateOfferEligibility } from './offer_eligibility.js';
import { composeDealHandoffMessage, composeTripHandoffMessage } from './whatsapp_handoff.js';
import { findPayloadMismatch } from './booking_conflict.js';
import { claimVehicleAllocation, releaseVehicleAllocation, findVehicleWindow } from './vehicle_allocation.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' };
const LINK_REQUEST_TTL_MS = 10 * 60 * 1000; // 10 minutes, mirrors the deal-hold-adjacent language elsewhere

function nowIso() {
  return new Date().toISOString();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function html(text, status = 200) {
  return new Response(text, { status, headers: HTML_HEADERS });
}

// Third independent review, finding 4 — home-screen installation. A real
// manifest.json + icon is what makes "Add to Home Screen" an actual
// browser-offered PWA install (short_name "Marau" alone, per the design
// reference's own instruction that it needs to fit under a home-screen
// icon) rather than just a plain bookmark. The icon is a placeholder
// rendering of the same brand mark used in the app header (a real
// production icon set should replace it before any real launch — see
// docs/MARAU_STAGE1_CODEX_FIXES_ROUND3.md).
const MANIFEST_JSON = JSON.stringify({
  name: 'Marau by Vakaviti AI',
  short_name: 'Marau',
  description: 'Your Vakaviti trip, deals and driver updates.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#F2F6F5',
  theme_color: '#0F5E63',
  icons: [
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
  ],
});

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
  <rect width="192" height="192" rx="40" fill="#0F5E63"/>
  <rect x="20" y="120" width="152" height="18" rx="9" fill="#F3C33C" transform="rotate(-8 96 129)"/>
</svg>`;

function MANIFEST_RESPONSE() {
  return new Response(MANIFEST_JSON, { headers: { 'content-type': 'application/manifest+json; charset=utf-8' } });
}

function ICON_RESPONSE() {
  return new Response(ICON_SVG, { headers: { 'content-type': 'image/svg+xml; charset=utf-8' } });
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

function sixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
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

async function createGuestSession(env, { guest_email, guest_phone, whatsapp_available }) {
  const session = {
    session_id: `gs_${cryptoRandomId()}`,
    guest_contact_key: normalizePhone(guest_phone),
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

/**
 * FIX (P0): a booking submission used to hand out an EXISTING session's
 * access token whenever the supplied phone alone matched one — a new
 * booking could silently inherit a stranger's session (and their prior
 * bookings) just by guessing/knowing their phone number. Every
 * submission now ALWAYS gets its own brand-new session. If a phone match
 * against a DIFFERENT, still-valid session exists, this also opens a
 * `guest_link_requests` row so the two can be linked later — but only
 * after the NEW session's holder proves they can read a verification
 * code that is itself only ever readable by someone already
 * authenticated as the OLD session (see handleListLinkRequests). Nothing
 * here grants access to the old session's data.
 */
async function createSessionAndOfferLink(env, body) {
  const contactKey = normalizePhone(body.guest_phone);
  const session = await createGuestSession(env, body);

  const candidate = await env.DB
    .prepare('SELECT * FROM guest_sessions WHERE guest_contact_key = ? AND access_token_revoked = 0 AND session_id != ? ORDER BY created_at DESC LIMIT 1')
    .bind(contactKey, session.session_id)
    .first();

  let linkOffer = null;
  if (candidate) {
    const linkRequestId = `link_${cryptoRandomId()}`;
    const expiresAt = new Date(Date.now() + LINK_REQUEST_TTL_MS).toISOString();
    await env.DB
      .prepare(
        `INSERT INTO guest_link_requests (link_request_id, new_session_id, candidate_session_id, verification_code, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`
      )
      .bind(linkRequestId, session.session_id, candidate.session_id, sixDigitCode(), expiresAt, nowIso())
      .run();
    linkOffer = {
      link_request_id: linkRequestId,
      message:
        'We found an earlier Marau session on this phone number. To see those bookings here too, open that earlier session’s access link and check for a verification code there, then confirm it from this one.',
      expires_at: expiresAt,
    };
  }

  return { session, linkOffer };
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

/**
 * FIX (second review, finding 2 — concurrency): the old version SELECTed
 * for an existing booking, and ONLY IF NOT FOUND created a session and
 * did a plain INSERT. Two truly simultaneous submissions of the SAME
 * client_booking_ref both saw "not found," both created their OWN
 * session, and both attempted the plain INSERT — one succeeded, the
 * other threw an UNCAUGHT UNIQUE-constraint error (client_booking_ref is
 * UNIQUE), leaving an orphaned, never-referenced guest_sessions row
 * behind for the loser. This version ALWAYS creates a session first (the
 * FK requires one to exist before the booking row can), then attempts an
 * `INSERT OR IGNORE` — the winner is decided atomically by SQLite/D1
 * itself, never by an earlier read. Whichever request loses that race
 * DELETEs its own now-unused session (and any link-offer row opened
 * against it) rather than leaving it behind.
 *
 * FIX (third independent review, finding 1 — authorization): the round-2
 * fix allowed direct access to a matching resubmit within a 60-second
 * "retry grace window" of the original save. Codex replayed a FRESH
 * reference/payload within that window and still got the access token —
 * proving a time window is not proof of anything: an attacker who
 * captured the reference and payload can replay them just as easily
 * inside the window as outside it. Timing plays NO role in this decision
 * any more. The only two ways a resubmit ever gets direct access back
 * are:
 *   - the caller presents the SAME `attempt_secret` the ORIGINAL request
 *     carried (see client_idempotency.js) — a separate, client-generated
 *     random value, never returned in any response, never derived from
 *     or combined with the public-looking reference/payload, so knowing
 *     one never reveals the other. This is the "separate secure
 *     attempt/recovery capability."
 *   - the caller already presents a valid Authorization bearer for that
 *     EXACT session (harmless — "authenticated ownership," they already
 *     have full access).
 * Otherwise: NO access_token is returned, regardless of how quickly the
 * resubmit followed the original. A `recovery_offer` is issued instead,
 * reusing the SAME verified-ownership linking mechanism as a phone match
 * (see createSessionAndOfferLink/handleListLinkRequests/handleConfirmLink)
 * — the verification code is only ever readable by whoever already holds
 * the ORIGINAL session's own token, so a bare replay of public-looking
 * reference+details data (with or without the right attempt_secret) gets
 * a session with zero bookings and nothing usable until the real code is
 * supplied.
 */
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
  const attemptSecret = typeof body.attempt_secret === 'string' && body.attempt_secret ? body.attempt_secret : null;

  const { session, linkOffer } = await createSessionAndOfferLink(env, body);

  const insertResult = await env.DB
    .prepare(
      `INSERT OR IGNORE INTO marau_test_bookings
        (client_booking_ref, guest_session_id, guest_email, guest_phone, pickup_zone, destination_zone, vehicle_type, pickup_datetime, quoted_amount, status, attempt_secret, test_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 1, ?, ?)`
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
      attemptSecret,
      nowIso(),
      nowIso()
    )
    .run();

  if (insertResult.meta.changes === 1) {
    return json(
      {
        booking_reference: clientBookingRef,
        status: 'pending',
        message: 'Awaiting human confirmation',
        access_token: session.access_token,
        was_new_booking: true,
        demonstration_data: true,
        link_offer: linkOffer,
      },
      201
    );
  }

  // We lost the race for this client_booking_ref (or it was a genuine,
  // simple retry of an already-existing one) — our own session was never
  // actually used for anything real. Clean it up rather than leaving an
  // orphan. Any guest_link_requests row referencing this session — as
  // EITHER new_session_id (our own cross-phone link offer) OR
  // candidate_session_id (the OTHER, concurrently-racing request may have
  // found OUR session as its own phone-match candidate before we lost the
  // ref race) — must be deleted first, since either column is a foreign
  // key on this session; deleting the session before that would fail the
  // constraint rather than cleanly remove it.
  await env.DB.prepare('DELETE FROM guest_link_requests WHERE new_session_id = ? OR candidate_session_id = ?').bind(session.session_id, session.session_id).run();
  await env.DB.prepare('DELETE FROM guest_sessions WHERE session_id = ?').bind(session.session_id).run();

  const existingBooking = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE client_booking_ref = ?').bind(clientBookingRef).first();
  const comparison = findPayloadMismatch(existingBooking, body);
  if (!comparison.matches) {
    return json(
      {
        error: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
        detail: 'This booking reference was already used for a different booking.',
        mismatched_fields: comparison.mismatched_fields,
      },
      409
    );
  }

  const presentedToken = bearerToken(request);
  const presentedSession = presentedToken
    ? await env.DB.prepare('SELECT * FROM guest_sessions WHERE access_token = ? AND access_token_revoked = 0').bind(presentedToken).first()
    : null;
  const ownsExistingSession = Boolean(presentedSession) && presentedSession.session_id === existingBooking.guest_session_id;
  const matchesAttemptSecret =
    Boolean(attemptSecret) && Boolean(existingBooking.attempt_secret) && attemptSecret === existingBooking.attempt_secret;

  if (matchesAttemptSecret || ownsExistingSession) {
    const existingSession = ownsExistingSession
      ? presentedSession
      : await env.DB.prepare('SELECT * FROM guest_sessions WHERE session_id = ?').bind(existingBooking.guest_session_id).first();
    return json(
      {
        booking_reference: existingBooking.client_booking_ref,
        status: existingBooking.status,
        message: 'Awaiting human confirmation',
        access_token: existingSession.access_token,
        was_new_booking: false,
        demonstration_data: true,
      },
      200
    );
  }

  // Neither proof of ownership was presented — do NOT hand back access to
  // an existing trip just because the caller knew (or guessed, or
  // replayed) the reference and matching field values, no matter how
  // quickly. Offer recovery instead, through the same verified-ownership
  // mechanism a phone match uses: a fresh, otherwise-empty session that
  // can only ever be merged with the real trip once the code — readable
  // solely via the ORIGINAL session's own token — is supplied.
  const recoverySession = await createGuestSession(env, body);
  const linkRequestId = `link_${cryptoRandomId()}`;
  const expiresAt = new Date(Date.now() + LINK_REQUEST_TTL_MS).toISOString();
  await env.DB
    .prepare(
      `INSERT INTO guest_link_requests (link_request_id, new_session_id, candidate_session_id, verification_code, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`
    )
    .bind(linkRequestId, recoverySession.session_id, existingBooking.guest_session_id, sixDigitCode(), expiresAt, nowIso())
    .run();

  return json(
    {
      booking_reference: existingBooking.client_booking_ref,
      status: existingBooking.status,
      message: 'This request was already recorded. If this is your booking, open your original access link, check for a verification code there, and confirm it from this device to regain access.',
      was_new_booking: false,
      demonstration_data: true,
      recovery_offer: {
        link_request_id: linkRequestId,
        access_token: recoverySession.access_token,
        expires_at: expiresAt,
      },
    },
    200
  );
}

/**
 * FIX (second review, finding 6 — the omitted sixth finding): the trip
 * view used to return only `bookings`. It now also returns the guest's
 * OWN deal requests in every state (REQUESTED, CONFIRMED, DECLINED,
 * WITHDRAWN), each carrying the AUTHORITATIVE current offer fields
 * (joined live from smart_offers, not copied at request time) alongside
 * the PRICE PROVENANCE the guest actually saw when they requested it
 * (`requested_price`/`requested_floor` — see migration 0015 and
 * handleRequestDeal), and `source_movement_id` so the shadow-leg source
 * this deal traces back to is never lost ("preserved source lineage").
 */
async function handleGetTrip(request, env) {
  const session = await requireGuestSession(request, env);
  if (!session) return json({ error: 'unauthorized — invalid or revoked access token' }, 401);

  const { results: bookings } = await env.DB
    .prepare('SELECT * FROM marau_test_bookings WHERE guest_session_id = ? ORDER BY pickup_datetime ASC')
    .bind(session.session_id)
    .all();

  const { results: dealRequests } = await env.DB
    .prepare(
      `SELECT dr.request_id, dr.status, dr.requested_price, dr.requested_floor, dr.created_at, dr.decided_at,
              o.offer_id, o.origin_zone, o.destination_zone, o.vehicle_class, o.source_movement_id,
              o.status AS offer_status, o.smart_match_price AS current_smart_match_price, o.standard_price AS current_standard_price,
              o.expires_at AS offer_expires_at
       FROM deal_requests dr
       JOIN smart_offers o ON o.offer_id = dr.offer_id
       WHERE dr.guest_session_id = ?
       ORDER BY dr.created_at DESC`
    )
    .bind(session.session_id)
    .all();

  return json({
    guest_email: session.guest_email,
    guest_phone: session.guest_phone,
    whatsapp_available: session.whatsapp_available === 1 ? true : session.whatsapp_available === 0 ? false : null,
    bookings,
    deal_requests: dealRequests.map((r) => ({
      request_id: r.request_id,
      status: r.status,
      offer_id: r.offer_id,
      source_movement_id: r.source_movement_id,
      origin_zone: r.origin_zone,
      destination_zone: r.destination_zone,
      vehicle_class: r.vehicle_class,
      requested_price: r.requested_price,
      requested_floor: r.requested_floor,
      current_price: r.current_smart_match_price ?? r.current_standard_price,
      offer_status: r.offer_status,
      offer_expires_at: r.offer_expires_at,
      created_at: r.created_at,
      decided_at: r.decided_at,
    })),
  });
}

async function handleRevokeTrip(request, env) {
  const session = await requireGuestSession(request, env);
  if (!session) return json({ error: 'unauthorized — invalid or revoked access token' }, 401);
  await env.DB.prepare('UPDATE guest_sessions SET access_token_revoked = 1 WHERE session_id = ?').bind(session.session_id).run();
  return json({ revoked: true });
}

// ---------------------------------------------------------------------
// Verified-ownership linking (P0 fix). Delivery is MOCKED: the
// verification code is only ever readable by GET /preview/trip/link-requests,
// which requires the CANDIDATE (old) session's own access token — i.e.
// only whoever already holds the earlier session can ever see the code,
// standing in for "only the real phone/email owner receives it" without
// a real SMS/email provider. It is NEVER included in the booking
// response that triggered it (see handleCreateBooking above).
// ---------------------------------------------------------------------

async function handleListLinkRequests(request, env) {
  const session = await requireGuestSession(request, env);
  if (!session) return json({ error: 'unauthorized — invalid or revoked access token' }, 401);

  const now = nowIso();
  await env.DB
    .prepare(`UPDATE guest_link_requests SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at <= ? AND candidate_session_id = ?`)
    .bind(now, session.session_id)
    .run();

  const { results } = await env.DB
    .prepare(`SELECT * FROM guest_link_requests WHERE candidate_session_id = ? AND status = 'PENDING' ORDER BY created_at DESC`)
    .bind(session.session_id)
    .all();

  return json({
    link_requests: results.map((r) => ({
      link_request_id: r.link_request_id,
      verification_code: r.verification_code,
      expires_at: r.expires_at,
      note: 'PREVIEW MOCK DELIVERY — in production this code is sent to the phone/email being verified, never returned this way to the requester.',
    })),
  });
}

async function handleRevokeLinkRequest(request, env, linkRequestId) {
  const session = await requireGuestSession(request, env);
  if (!session) return json({ error: 'unauthorized — invalid or revoked access token' }, 401);

  const linkRequest = await env.DB.prepare('SELECT * FROM guest_link_requests WHERE link_request_id = ?').bind(linkRequestId).first();
  if (!linkRequest || linkRequest.candidate_session_id !== session.session_id) {
    return json({ error: 'link request not found' }, 404);
  }
  if (linkRequest.status !== 'PENDING') {
    return json({ error: 'ALREADY_DECIDED', current_status: linkRequest.status }, 409);
  }
  await env.DB.prepare(`UPDATE guest_link_requests SET status = 'REVOKED' WHERE link_request_id = ?`).bind(linkRequestId).run();
  return json({ link_request_id: linkRequestId, status: 'REVOKED' });
}

async function handleConfirmLink(request, env) {
  const session = await requireGuestSession(request, env);
  if (!session) return json({ error: 'unauthorized — invalid or revoked access token' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  if (!body || !body.link_request_id || !body.verification_code) {
    return json({ error: 'link_request_id and verification_code are required' }, 400);
  }

  const linkRequest = await env.DB.prepare('SELECT * FROM guest_link_requests WHERE link_request_id = ?').bind(body.link_request_id).first();
  if (!linkRequest || linkRequest.new_session_id !== session.session_id) {
    return json({ error: 'link request not found for this session' }, 404);
  }
  if (linkRequest.status !== 'PENDING') {
    return json({ error: 'ALREADY_DECIDED', current_status: linkRequest.status }, 409);
  }
  if (linkRequest.expires_at <= nowIso()) {
    await env.DB.prepare(`UPDATE guest_link_requests SET status = 'EXPIRED' WHERE link_request_id = ?`).bind(body.link_request_id).run();
    return json({ error: 'LINK_REQUEST_EXPIRED' }, 409);
  }
  if (String(body.verification_code) !== linkRequest.verification_code) {
    return json({ error: 'INVALID_CODE' }, 400);
  }

  await env.DB
    .prepare('UPDATE marau_test_bookings SET guest_session_id = ? WHERE guest_session_id = ?')
    .bind(session.session_id, linkRequest.candidate_session_id)
    .run();
  await env.DB.prepare('UPDATE guest_sessions SET access_token_revoked = 1 WHERE session_id = ?').bind(linkRequest.candidate_session_id).run();
  await env.DB
    .prepare(`UPDATE guest_link_requests SET status = 'VERIFIED', verified_at = ? WHERE link_request_id = ?`)
    .bind(nowIso(), body.link_request_id)
    .run();

  return json({ link_request_id: body.link_request_id, status: 'VERIFIED', merged_into_session_id: session.session_id });
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
// Deals (public browse; authenticated request). Every touchpoint uses
// the SAME evaluateOfferEligibility() — see offer_eligibility.js for the
// fix this closes (expired/VALIDATED-only offers no longer surface).
// ---------------------------------------------------------------------

async function handleListDeals(env) {
  const now = nowIso();
  const { results } = await env.DB.prepare(`SELECT * FROM smart_offers ORDER BY earliest_pickup ASC`).all();

  const deals = results
    .filter((o) => evaluateOfferEligibility(o, now).eligible)
    .map((o) => ({
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

  const eligibility = evaluateOfferEligibility(offer, nowIso());
  if (!eligibility.eligible) {
    if (eligibility.reason === 'EXPIRED' && offer.status !== 'EXPIRED' && offer.status !== 'FILLED') {
      await expireOffer(store, offerId);
    }
    return json({ error: 'STALE_OR_UNAPPROVED_OFFER', reason: eligibility.reason, detail: eligibility.detail }, 409);
  }

  const idempotencyKey = `${session.session_id}:${offerId}`;
  const requestId = `dr_${cryptoRandomId()}`;
  // Snapshot the exact price/floor the guest was shown and agreed to —
  // "approved-price provenance" (second review, finding 5). Confirmation
  // re-checks the offer's CURRENT price/floor against this snapshot and
  // refuses to confirm if either has moved since the request.
  const requestedPrice = offer.smart_match_price ?? offer.standard_price;
  const insertResult = await env.DB
    .prepare(
      `INSERT OR IGNORE INTO deal_requests
        (request_id, offer_id, guest_session_id, idempotency_key, status, whatsapp_handoff_prepared, requested_price, requested_floor, test_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'REQUESTED', 1, ?, ?, 1, ?, ?)`
    )
    .bind(requestId, offerId, session.session_id, idempotencyKey, requestedPrice, offer.absolute_floor, nowIso(), nowIso())
    .run();

  const dealRequest = await env.DB.prepare('SELECT * FROM deal_requests WHERE idempotency_key = ?').bind(idempotencyKey).first();
  const opsNumber = env.MARAU_OPS_WHATSAPP_TEST_NUMBER || '+15556414099';
  const whatsappHandoff = composeDealHandoffMessage({ opsNumber, dealRequestId: dealRequest.request_id, offer });

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
// WhatsApp handoff (mock only — see whatsapp_handoff.js). FIX: the main
// "Talk to our team" button used to only show a toast; it now composes a
// real message (booking reference + trip details) shown in the guest
// app's mock panel, exactly like the deal handoff, and neither one ever
// navigates to WhatsApp.
// ---------------------------------------------------------------------

async function handleTripWhatsappHandoff(request, env) {
  const session = await requireGuestSession(request, env);
  if (!session) return json({ error: 'unauthorized — invalid or revoked access token' }, 401);

  const { results: bookings } = await env.DB
    .prepare('SELECT * FROM marau_test_bookings WHERE guest_session_id = ? ORDER BY pickup_datetime ASC')
    .bind(session.session_id)
    .all();
  const soonest = bookings[0] || null;
  const opsNumber = env.MARAU_OPS_WHATSAPP_TEST_NUMBER || '+15556414099';

  return json({ whatsapp_handoff: composeTripHandoffMessage({ opsNumber, booking: soonest }) });
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
  const { results: offers } = await env.DB.prepare(`SELECT * FROM smart_offers`).all();

  return json(buildAssistResponse({ question: body.question, bookings, offers, nowIso: nowIso() }));
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

/**
 * The concurrency-critical path. Two layers of exclusivity, both
 * required, both rolled back on any later failure so a failed attempt
 * never leaves a phantom lock:
 *   1. vehicle_time_claims (0010) — the SAME movement can't be claimed
 *      by two different offers (unchanged from the original build).
 *   2. vehicle_allocations (0014) — the SAME real vehicle can't have two
 *      OVERLAPPING windows claimed at all, regardless of which movement
 *      or offer they came from, and regardless of whether the other side
 *      is an offer or an ordinary booking (see handleAdminDecideBooking).
 * A movement with no recorded vehicle_windows row is UNKNOWN and blocks
 * confirmation outright (checked before either claim is attempted).
 *
 * FIX (third independent review, finding 2 — mutual exclusion): a
 * concurrent confirm and decline against the SAME request both used to
 * check `status !== 'REQUESTED'` via a plain SELECT-then-UPDATE with no
 * atomicity between the check and either write — both could pass the
 * read, both could then write, and BOTH could return 200 with
 * contradictory outcomes, potentially leaving deal_requests.status
 * disagreeing with what actually happened to the offer/vehicle. The
 * REQUEST's own status transition to CONFIRMED is now itself the FIRST
 * atomic write below (a single `UPDATE ... WHERE status = 'REQUESTED'`),
 * racing directly against handleAdminDeclineDealRequest's identical CAS
 * — SQLite/D1 serialize writes, so only one of the two can ever win; the
 * loser gets a clean 409 immediately, before touching anything else.
 *
 * FIX (third independent review, finding 3 — durable recovery): the
 * round-2 rollback() compensated the offer/allocation/claim state but had
 * no durable record of what it was attempting, and if a compensating
 * write ITSELF failed, the result was indistinguishable from "nothing
 * happened" — nothing prevented an automatic retry against a
 * half-compensated state. Every attempt that gets past the CAS above now
 * writes a `confirmation_attempts` row (migration 0018) and updates its
 * `phase` as it proceeds. rollback() independently try/catches EACH
 * compensating write (one failing step never blocks the others), and
 * only reverts the REQUEST's own status back to REQUESTED if every
 * compensating write fully succeeded (phase ROLLED_BACK) — genuinely
 * safe to retry. If any compensating write itself throws, phase becomes
 * ROLLBACK_FAILED with the failure detail recorded, deliberately WITHOUT
 * reverting the request's status (its true state can't be safely
 * assumed), and the response says so explicitly
 * (`reconciliation_needed: true`) rather than implying it's safe to
 * retry. Two test-only hooks (never present on any real env) reproduce
 * both scenarios: `__TEST_INJECT_FAILURE_BEFORE_FINAL_UPDATE__` (the main
 * operation fails after every real side effect has already happened) and
 * `__TEST_FAIL_ROLLBACK_STEP__` (a named compensating write also fails
 * during recovery from that).
 *
 * FIX (second review, finding 5 — stale price): re-checks the offer's
 * CURRENT price/floor against the snapshot taken at request time
 * (deal_requests.requested_price/requested_floor — see handleRequestDeal
 * and migration 0015) BEFORE claiming anything. A price or floor that
 * moved since the guest saw and requested it is never silently honoured.
 */
async function handleAdminConfirmDealRequest(env, requestId) {
  const store = createD1Store({ SMART_RETURN_DB: env.DB });
  const now = nowIso();

  const dealRequest = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requestId).first();
  if (!dealRequest) return json({ error: 'deal request not found' }, 404);
  if (dealRequest.status !== 'REQUESTED') {
    return json({ error: 'ALREADY_DECIDED', current_status: dealRequest.status }, 409);
  }

  const offer = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(dealRequest.offer_id).first();
  if (!offer) return json({ error: 'offer no longer exists' }, 404);

  const eligibility = evaluateOfferEligibility(offer, now);
  if (!eligibility.eligible) {
    if (eligibility.reason === 'EXPIRED' && offer.status !== 'EXPIRED' && offer.status !== 'FILLED') {
      await expireOffer(store, offer.offer_id);
    }
    return json({ error: 'STALE_OR_UNAPPROVED_OFFER', reason: eligibility.reason, detail: eligibility.detail }, 409);
  }

  const currentPrice = offer.smart_match_price ?? offer.standard_price;
  if (dealRequest.requested_price != null && currentPrice !== dealRequest.requested_price) {
    return json(
      { error: 'PRICE_CHANGED_SINCE_REQUEST', detail: `price was ${dealRequest.requested_price} when requested, is now ${currentPrice}` },
      409
    );
  }
  if (dealRequest.requested_floor != null && offer.absolute_floor !== dealRequest.requested_floor) {
    return json(
      { error: 'PRICE_CHANGED_SINCE_REQUEST', detail: `absolute_floor was ${dealRequest.requested_floor} when requested, is now ${offer.absolute_floor}` },
      409
    );
  }

  const vehicleWindow = await findVehicleWindow(env, 'MOVEMENT', offer.source_movement_id);
  if (!vehicleWindow) {
    return json(
      { error: 'VEHICLE_UNKNOWN', detail: 'No recorded vehicle/availability for this offer’s movement — cannot safely confirm.' },
      409
    );
  }

  // The mutual-exclusion gate (finding 2): only one of a concurrent
  // confirm/decline pair can ever win this write.
  const claimDecision = await env.DB
    .prepare(`UPDATE deal_requests SET status = 'CONFIRMED', decided_by = ?, decided_at = ?, updated_at = ? WHERE request_id = ? AND status = 'REQUESTED'`)
    .bind('marau-ops-preview', now, now, requestId)
    .run();
  if (claimDecision.meta.changes !== 1) {
    return json({ error: 'ALREADY_DECIDED', detail: 'Another decision (confirm or decline) already won this request.' }, 409);
  }

  const attemptId = `ca_${cryptoRandomId()}`;
  await env.DB
    .prepare(`INSERT INTO confirmation_attempts (attempt_id, request_id, offer_id, phase, created_at, updated_at) VALUES (?, ?, ?, 'STARTED', ?, ?)`)
    .bind(attemptId, requestId, offer.offer_id, now, now)
    .run();

  async function setAttemptPhase(phase, errorDetail) {
    await env.DB
      .prepare(`UPDATE confirmation_attempts SET phase = ?, error_detail = ?, updated_at = ? WHERE attempt_id = ?`)
      .bind(phase, errorDetail ?? null, nowIso(), attemptId)
      .run();
  }

  let claimedMovement = false;
  let allocationId = null;

  // Fully compensates every write this attempt made, and reports whether
  // compensation itself fully succeeded — durably, in confirmation_attempts.
  // Each step is independently try/caught so one failing compensating
  // write never prevents the others from running, and this function
  // never touches any offer_id/request_id/movement_id other than this
  // attempt's own.
  async function rollback() {
    const failures = [];
    try {
      if (env.__TEST_FAIL_ROLLBACK_STEP__ === 'offer_status') throw new Error('INJECTED_ROLLBACK_FAILURE(offer_status)');
      await store.casOfferStatus(offer.offer_id, 'FILLED', 'ACTIVE');
      await store.casOfferStatus(offer.offer_id, 'HELD', 'ACTIVE');
    } catch (e) {
      failures.push('offer_status: ' + e.message);
    }
    if (allocationId) {
      try {
        if (env.__TEST_FAIL_ROLLBACK_STEP__ === 'allocation') throw new Error('INJECTED_ROLLBACK_FAILURE(allocation)');
        await releaseVehicleAllocation(env, allocationId);
      } catch (e) {
        failures.push('allocation: ' + e.message);
      }
    }
    if (claimedMovement) {
      try {
        if (env.__TEST_FAIL_ROLLBACK_STEP__ === 'movement_claim') throw new Error('INJECTED_ROLLBACK_FAILURE(movement_claim)');
        await env.DB.prepare('DELETE FROM vehicle_time_claims WHERE source_movement_id = ? AND claimed_by_request_id = ?').bind(offer.source_movement_id, requestId).run();
      } catch (e) {
        failures.push('movement_claim: ' + e.message);
      }
    }
    if (failures.length > 0) {
      await setAttemptPhase('ROLLBACK_FAILED', failures.join('; '));
      return { fullyRolledBack: false };
    }
    // Every side-effect compensation succeeded — only now is it safe to
    // revert the request's own status, making it genuinely retryable.
    try {
      await env.DB
        .prepare(`UPDATE deal_requests SET status = 'REQUESTED', decided_by = NULL, decided_at = NULL, updated_at = ? WHERE request_id = ?`)
        .bind(nowIso(), requestId)
        .run();
      await setAttemptPhase('ROLLED_BACK', null);
      return { fullyRolledBack: true };
    } catch (e) {
      await setAttemptPhase('ROLLBACK_FAILED', 'request_status_revert: ' + e.message);
      return { fullyRolledBack: false };
    }
  }

  try {
    await setAttemptPhase('CLAIMING_MOVEMENT');
    const claimResult = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO vehicle_time_claims (source_movement_id, claimed_by_offer_id, claimed_by_request_id, claimed_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(offer.source_movement_id, offer.offer_id, requestId, now)
      .run();
    if (claimResult.meta.changes !== 1) {
      // A clean, expected rejection — not a system failure. Nothing else
      // was touched yet, so reverting the request's own status is a
      // single direct write, not a full rollback().
      await env.DB
        .prepare(`UPDATE deal_requests SET status = 'REQUESTED', decided_by = NULL, decided_at = NULL, updated_at = ? WHERE request_id = ?`)
        .bind(nowIso(), requestId)
        .run();
      await setAttemptPhase('ROLLED_BACK', 'VEHICLE_TIME_ALREADY_CLAIMED');
      return json(
        { error: 'VEHICLE_TIME_ALREADY_CLAIMED', detail: 'This exact movement has already been claimed by another offer.' },
        409
      );
    }
    claimedMovement = true;

    await setAttemptPhase('CLAIMING_VEHICLE');
    allocationId = `va_${cryptoRandomId()}`;
    const allocation = await claimVehicleAllocation(env, {
      allocationId,
      vehicleId: vehicleWindow.vehicle_id,
      windowStart: vehicleWindow.window_start,
      windowEnd: vehicleWindow.window_end,
      subjectType: 'DEAL_REQUEST',
      subjectId: requestId,
      nowIso: now,
    });
    if (!allocation.success) {
      allocationId = null; // nothing was actually inserted — see claimVehicleAllocation's own contract
      const result = await rollback();
      return json(
        {
          error: 'VEHICLE_TIME_ALREADY_CLAIMED',
          detail: 'This vehicle already has an overlapping commitment during this window.',
          reconciliation_needed: !result.fullyRolledBack,
        },
        409
      );
    }

    await setAttemptPhase('HOLDING_OFFER');
    const held = await holdOffer(store, offer.offer_id);
    if (!held.success) {
      const result = await rollback();
      return json({ error: 'OFFER_STATE_CONFLICT', detail: held.reason, reconciliation_needed: !result.fullyRolledBack }, 409);
    }

    await setAttemptPhase('FILLING_OFFER');
    const filled = await fillOffer(store, offer.offer_id, { movement_id: offer.source_movement_id });
    if (!filled.success) {
      const result = await rollback();
      return json({ error: 'OFFER_STATE_CONFLICT', detail: filled.reason || 'fill failed', reconciliation_needed: !result.fullyRolledBack }, 409);
    }

    // Test-only fault injection, exercised by the round-3 durable-recovery
    // regression — never set on any real env.
    if (typeof env.__TEST_INJECT_FAILURE_BEFORE_FINAL_UPDATE__ === 'function') {
      env.__TEST_INJECT_FAILURE_BEFORE_FINAL_UPDATE__();
    }

    await setAttemptPhase('DONE');

    return json({
      request_id: requestId,
      status: 'CONFIRMED',
      offer: filled.offer,
      vehicle_allocation: { allocation_id: allocationId, vehicle_id: vehicleWindow.vehicle_id, window_start: vehicleWindow.window_start, window_end: vehicleWindow.window_end },
    });
  } catch (err) {
    const result = await rollback();
    return json(
      {
        error: 'CONFIRMATION_FAILED',
        detail: result.fullyRolledBack
          ? 'The confirmation could not be completed and has been fully rolled back — safe to retry.'
          : 'The confirmation failed AND compensation could not fully complete — this request needs manual reconciliation (see confirmation_attempts). Do not retry automatically.',
        reconciliation_needed: !result.fullyRolledBack,
      },
      500
    );
  }
}

async function handleAdminDeclineDealRequest(env, requestId) {
  const now = nowIso();
  // Same mutual-exclusion gate as confirm (finding 2): a single
  // conditional UPDATE, racing directly against
  // handleAdminConfirmDealRequest's identical CAS on the same row.
  const result = await env.DB
    .prepare(`UPDATE deal_requests SET status = 'DECLINED', decided_by = ?, decided_at = ?, updated_at = ? WHERE request_id = ? AND status = 'REQUESTED'`)
    .bind('marau-ops-preview', now, now, requestId)
    .run();
  if (result.meta.changes !== 1) {
    const dealRequest = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requestId).first();
    if (!dealRequest) return json({ error: 'deal request not found' }, 404);
    return json({ error: 'ALREADY_DECIDED', current_status: dealRequest.status }, 409);
  }
  return json({ request_id: requestId, status: 'DECLINED' });
}

async function handleAdminListBookings(env) {
  const { results } = await env.DB.prepare('SELECT * FROM marau_test_bookings ORDER BY created_at DESC').all();
  return json({ bookings: results });
}

/**
 * FIX (third independent review, finding 6 — reverted round-2 policy):
 * round 2 introduced 'confirmed_unallocated' so an unallocated booking
 * confirmation was never silently conflated with an allocated one. This
 * review found that itself needs an explicit operational decision from
 * James before it exists as a policy at all — a system should not
 * quietly start granting a NEW kind of confirmation (even a distinctly
 * labelled one) without that sign-off. Confirming an ordinary booking
 * with no recorded vehicle now simply REFUSES
 * (409 VEHICLE_ALLOCATION_DECISION_PENDING) and the booking stays
 * 'pending' — unchanged confirmation policy until James approves one.
 * The 'confirmed_unallocated' value is left in migration 0016's CHECK
 * constraint (harmless — it is simply never written by this handler
 * again) so a future approved policy doesn't need another table
 * recreation to reintroduce it.
 */
async function handleAdminDecideBooking(env, bookingId, decision) {
  const booking = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(bookingId).first();
  if (!booking) return json({ error: 'booking not found' }, 404);
  if (booking.status !== 'pending') return json({ error: 'ALREADY_DECIDED', current_status: booking.status }, 409);

  const now = nowIso();

  if (decision !== 'confirm') {
    await env.DB.prepare('UPDATE marau_test_bookings SET status = ?, updated_at = ? WHERE id = ?').bind('declined', now, bookingId).run();
    return json({ id: bookingId, status: 'declined' });
  }

  const vehicleWindow = await findVehicleWindow(env, 'BOOKING', String(bookingId));
  if (!vehicleWindow) {
    return json(
      {
        error: 'VEHICLE_ALLOCATION_DECISION_PENDING',
        detail:
          'No vehicle is on record for this booking. Confirming an ordinary booking with no known vehicle needs an explicit operational decision from James before that policy exists — the booking remains pending.',
      },
      409
    );
  }

  const allocationId = `va_${cryptoRandomId()}`;
  const allocation = await claimVehicleAllocation(env, {
    allocationId,
    vehicleId: vehicleWindow.vehicle_id,
    windowStart: vehicleWindow.window_start,
    windowEnd: vehicleWindow.window_end,
    subjectType: 'BOOKING',
    subjectId: String(bookingId),
    nowIso: now,
  });
  if (!allocation.success) {
    return json(
      { error: 'VEHICLE_TIME_ALREADY_CLAIMED', detail: 'This vehicle already has an overlapping commitment during this window.' },
      409
    );
  }

  await env.DB.prepare('UPDATE marau_test_bookings SET status = ?, updated_at = ? WHERE id = ?').bind('confirmed', now, bookingId).run();
  return json({ id: bookingId, status: 'confirmed', vehicle_allocation: allocationId });
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
      // Third independent review, finding 4: home-screen installation is
      // approved Stage 1 scope, independent of (deferred) credits — a
      // real manifest + icon is what makes "Add to Home Screen" an actual
      // browser-offered install rather than just a bookmark shortcut.
      if (method === 'GET' && pathname === '/manifest.json') return MANIFEST_RESPONSE();
      if (method === 'GET' && pathname === '/icon.svg') return ICON_RESPONSE();

      if (method === 'POST' && pathname === '/preview/bookings') return handleCreateBooking(request, env);
      if (method === 'GET' && pathname === '/preview/trip') return handleGetTrip(request, env);
      if (method === 'POST' && pathname === '/preview/trip/revoke') return handleRevokeTrip(request, env);
      if (method === 'POST' && pathname === '/preview/trip/whatsapp-handoff') return handleTripWhatsappHandoff(request, env);

      if (method === 'GET' && pathname === '/preview/trip/link-requests') return handleListLinkRequests(request, env);
      const revokeLinkMatch = pathname.match(/^\/preview\/trip\/link-requests\/([^/]+)\/revoke$/);
      if (method === 'POST' && revokeLinkMatch) return handleRevokeLinkRequest(request, env, revokeLinkMatch[1]);
      if (method === 'POST' && pathname === '/preview/trip/link') return handleConfirmLink(request, env);

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
