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
import { normalizePickupDatetime } from './fiji_time.js';
import { selectDefaultBooking } from './booking_selection.js';
import { ICON192_PNG_BASE64, ICON512_PNG_BASE64, ICON180_PNG_BASE64 } from './icon_assets.js';

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
// FIX (fourth independent review, finding 3 — installed-app acceptance):
// "Complete the required phone icon assets." The manifest now points at
// REAL rasterized PNGs (192/512, via Playwright rendering the same brand
// mark — see docs/screenshots/../render_icons.mjs, scratch-only, not part
// of this repo) rather than only an SVG, and a 180×180 opaque PNG is
// served for apple-touch-icon — iOS Safari does not reliably honour an
// SVG touch icon. Never embeds any private/session token here: this file
// is static and identical for every guest.
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
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function PNG_RESPONSE(base64) {
  return new Response(base64ToBytes(base64), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } });
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
      normalizePickupDatetime(body.pickup_datetime),
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

  // Normalize a raw pickup_datetime as Fiji wall-clock time HERE too (not
  // only when the change is later applied) so the stored/audited request
  // itself already reflects the correct absolute UTC instant — and since
  // normalizePickupDatetime is idempotent on already-zoned input, applying
  // it again at approval time (handleAdminDecideChangeRequest) is a safe
  // no-op, covering "unchanged-time submission" on a resubmit.
  const requestedFields = { ...body.requested_fields };
  if (requestedFields.pickup_datetime != null) {
    requestedFields.pickup_datetime = normalizePickupDatetime(requestedFields.pickup_datetime);
  }

  const changeRequestId = `chg_${cryptoRandomId()}`;
  await env.DB
    .prepare(
      `INSERT INTO booking_change_requests (change_request_id, booking_id, requested_fields_json, status, created_at)
       VALUES (?, ?, ?, 'PENDING', ?)`
    )
    .bind(changeRequestId, booking.id, JSON.stringify(requestedFields), nowIso())
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

// FIX (fourth independent review, finding 2 — pickup accuracy): this used
// to pick `bookings[0]` from an ORDER BY pickup_datetime ASC with NO
// status filter at all — an old cancelled/declined booking with an
// earlier timestamp than a real upcoming one could be summarized to
// WhatsApp as if it were the live trip. Now defaults via the SAME shared
// rule (selectDefaultBooking, ./booking_selection.js) the guest app's own
// pickup card uses, so the two can never disagree — and accepts an
// optional `booking_id` in the request body so the summary matches
// whichever booking the guest currently has selected in their switcher,
// rather than always the server's own independent default.
async function handleTripWhatsappHandoff(request, env) {
  const session = await requireGuestSession(request, env);
  if (!session) return json({ error: 'unauthorized — invalid or revoked access token' }, 401);

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { results: bookings } = await env.DB
    .prepare('SELECT * FROM marau_test_bookings WHERE guest_session_id = ? ORDER BY pickup_datetime ASC')
    .bind(session.session_id)
    .all();

  let selected = null;
  if (body && body.booking_id) {
    selected = bookings.find((b) => b.id === body.booking_id) || null;
    if (!selected) return json({ error: 'booking not found for this session' }, 404);
  } else {
    selected = selectDefaultBooking(bookings, nowIso());
  }

  const opsNumber = env.MARAU_OPS_WHATSAPP_TEST_NUMBER || '+15556414099';

  return json({ whatsapp_handoff: composeTripHandoffMessage({ opsNumber, booking: selected }) });
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

  // Surface any request whose last confirmation attempt stalled short of
  // a terminal phase — the actionable signal that admin reconciliation
  // (POST .../reconcile-confirmation) is needed, rather than a silent
  // gap only visible by querying confirmation_attempts directly.
  const { results: stalledAttempts } = await env.DB
    .prepare(
      `SELECT ca.request_id, ca.phase, ca.error_detail
       FROM confirmation_attempts ca
       WHERE ca.updated_at = (SELECT MAX(updated_at) FROM confirmation_attempts WHERE request_id = ca.request_id)
         AND ca.phase NOT IN ('DONE', 'ROLLED_BACK')`
    )
    .all();
  const stalledByRequest = new Map(stalledAttempts.map((a) => [a.request_id, a]));

  // FIX (bounded round-5 correction, finding 2 — interrupted claims
  // discoverable): a claim can exist with NO confirmation_attempts row at
  // all (an interruption before the very first audit write ever
  // happened) — the query above finds nothing for that case, which
  // previously left this list silently disagreeing with the
  // confirm/decline gate's own (now corrected) CONFIRMATION_INTERRUPTED
  // response for the exact same request. Any REQUESTED request that
  // holds a decision claim is surfaced here too, regardless of whether
  // an attempt row exists.
  const { results: openClaims } = await env.DB.prepare('SELECT request_id FROM deal_decision_claims').all();
  const claimedRequestIds = new Set(openClaims.map((c) => c.request_id));

  const enriched = results.map((r) => {
    const stalled = stalledByRequest.get(r.request_id);
    if (stalled) {
      return { ...r, reconciliation_needed: true, stalled_phase: stalled.phase, stalled_detail: stalled.error_detail };
    }
    if (r.status === 'REQUESTED' && claimedRequestIds.has(r.request_id)) {
      return { ...r, reconciliation_needed: true, stalled_phase: null, stalled_detail: 'A decision claim exists but no confirmation attempt record was ever created for it.' };
    }
    return { ...r, reconciliation_needed: false };
  });

  return json({ deal_requests: enriched });
}

/**
 * FIX (bounded round-5 correction, finding 2 — interrupted claims
 * discoverable): whenever a decision claim's own INSERT fails for a
 * request whose OWN status is still 'REQUESTED' (guaranteed by the
 * caller checking that immediately before attempting the claim), nothing
 * has actually been decided yet — the winning side is either still
 * genuinely in progress or died before finishing. This is ALWAYS an
 * interrupted-or-in-progress situation, never legitimately
 * "ALREADY_DECIDED" — that label used to leak out even when NO
 * confirmation_attempts row existed at all for the stuck claim (an
 * interruption before the very first audit write ever happened), which
 * directly contradicted the ops list's own `reconciliation_needed` flag
 * for the exact same request. This is detectable purely from claim +
 * request state; a confirmation_attempts row is not required for it to
 * be discoverable, and the response always names the same actionable
 * recovery path regardless.
 */
async function describeStuckClaim(env, requestId) {
  const priorAttempt = await env.DB
    .prepare('SELECT * FROM confirmation_attempts WHERE request_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(requestId)
    .first();
  return { requestId, priorAttempt };
}

function interruptedOrAlreadyDecidedResponse({ requestId, priorAttempt }) {
  return {
    error: 'CONFIRMATION_INTERRUPTED',
    detail: priorAttempt
      ? `A previous confirmation attempt stalled at phase ${priorAttempt.phase} and needs admin reconciliation before this request can be decided again.`
      : 'A decision claim exists for this request but no confirmation attempt record was ever created — an earlier attempt was interrupted before it could record any state. Needs admin reconciliation.',
    recovery_action: `POST /preview/admin/deal-requests/${requestId}/reconcile-confirmation`,
  };
}

/**
 * Thrown by the confirm handler's fenced phase-advance (`advance()`) when
 * the CAS `UPDATE confirmation_attempts SET phase = <next> WHERE
 * attempt_id = ? AND phase = <expected current>` affects zero rows — the
 * phase has changed under this attempt from somewhere else (an admin's
 * concurrent `reconcile-confirmation` call winning the same CAS race, or
 * this same attempt's own rollback() already having fenced it). The
 * caller MUST treat this as "ownership has been taken away" and abort
 * immediately without any further writes — never fall back to its own
 * rollback(), which would race whoever now legitimately owns the attempt.
 */
class ConfirmationFencedError extends Error {
  constructor(fromPhase, toPhase) {
    super(`FENCED: lost ownership advancing ${fromPhase} -> ${toPhase} — a concurrent reconcile or rollback already took this attempt`);
    this.fromPhase = fromPhase;
    this.toPhase = toPhase;
  }
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
 * FIX (fourth independent review, finding 1 — confirmation integrity):
 * the round-3 design's mutual-exclusion write WAS the CAS straight to
 * `deal_requests.status = 'CONFIRMED'`, made BEFORE any real side effect.
 * Codex made the very next write (`INSERT INTO confirmation_attempts`)
 * fail via a SQLite trigger and found the guest's Trip showing CONFIRMED
 * while the offer was still ACTIVE, with zero allocations and zero audit
 * rows — any failure after that CAS, however trivial, left the
 * guest-visible status lying. Fixed by using a NON-FINAL claim state:
 * `deal_decision_claims` (migration 0019) — a separate, minimal table
 * whose single PRIMARY-KEY-guarded INSERT is now the ONLY thing that
 * races confirm against decline. `deal_requests.status` stays
 * 'REQUESTED' for the ENTIRE duration of a confirm attempt and is only
 * ever written to 'CONFIRMED' as the LITERAL LAST statement, after every
 * real side effect (movement claim, vehicle allocation, offer hold/fill)
 * AND the durable confirmation_attempts audit write have already
 * succeeded — "expose CONFIRMED only after successful completion."
 *
 * The claim-audit INSERT itself is now INSIDE the try/catch, so Codex's
 * exact injection (failing that specific INSERT) is caught: nothing
 * substantive has happened yet (no movement claim, no allocation, no
 * offer touch), so rollback() only needs to release the decision claim —
 * deal_requests never left 'REQUESTED', so there is nothing to revert
 * there in the first place.
 *
 * "Close the claim/journal interruption gap": if a confirm attempt dies
 * partway (an uncaught exception outside any try/catch this file
 * controls — e.g. a worker eviction) BEFORE reaching a terminal phase,
 * `deal_decision_claims` still holds the claim (nothing deleted it), so
 * a fresh confirm attempt on the same request is correctly blocked
 * rather than allowed to race a second, overlapping attempt — and the
 * response names the exact stalled phase plus the actionable,
 * ownership-fenced (admin-only) recovery path:
 * `POST /preview/admin/deal-requests/:id/reconcile-confirmation`, which
 * inspects the REAL current state directly (not the possibly-stale phase
 * marker) and either finishes the confirmation for real or fully unwinds
 * it — never leaves it ambiguous.
 *
 * FIX (third independent review, finding 3 — durable recovery), unchanged
 * in spirit: confirmation_attempts (0018) durably tracks phase; rollback()
 * independently try/catches each compensating write. FIX (second review,
 * finding 5 — stale price): unchanged, still checked before any claim.
 */
async function handleAdminConfirmDealRequest(env, requestId) {
  const store = createD1Store({ SMART_RETURN_DB: env.DB });
  const now = nowIso();

  const dealRequest = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requestId).first();
  if (!dealRequest) return json({ error: 'deal request not found' }, 404);
  if (dealRequest.status !== 'REQUESTED') {
    return json({ error: 'ALREADY_DECIDED', current_status: dealRequest.status }, 409);
  }

  // The mutual-exclusion gate runs FIRST, before any eligibility/price/
  // vehicle pre-check — a stalled prior attempt can itself have left the
  // offer in a state (e.g. still FILLED) that would make those checks
  // fail with a confusing, unrelated error instead of naming the real
  // problem: an earlier confirmation is stuck and needs reconciliation.
  const claim = await env.DB
    .prepare(`INSERT OR IGNORE INTO deal_decision_claims (request_id, decision, claimed_at) VALUES (?, 'CONFIRM', ?)`)
    .bind(requestId, now)
    .run();
  if (claim.meta.changes !== 1) {
    return json(interruptedOrAlreadyDecidedResponse(await describeStuckClaim(env, requestId)), 409);
  }

  // From here on, this attempt holds the claim — any early return MUST
  // free it again (a clean, expected rejection is not a stalled attempt).
  const offer = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(dealRequest.offer_id).first();
  if (!offer) {
    await env.DB.prepare('DELETE FROM deal_decision_claims WHERE request_id = ?').bind(requestId).run();
    return json({ error: 'offer no longer exists' }, 404);
  }

  const eligibility = evaluateOfferEligibility(offer, now);
  if (!eligibility.eligible) {
    if (eligibility.reason === 'EXPIRED' && offer.status !== 'EXPIRED' && offer.status !== 'FILLED') {
      await expireOffer(store, offer.offer_id);
    }
    await env.DB.prepare('DELETE FROM deal_decision_claims WHERE request_id = ?').bind(requestId).run();
    return json({ error: 'STALE_OR_UNAPPROVED_OFFER', reason: eligibility.reason, detail: eligibility.detail }, 409);
  }

  const currentPrice = offer.smart_match_price ?? offer.standard_price;
  if (dealRequest.requested_price != null && currentPrice !== dealRequest.requested_price) {
    await env.DB.prepare('DELETE FROM deal_decision_claims WHERE request_id = ?').bind(requestId).run();
    return json(
      { error: 'PRICE_CHANGED_SINCE_REQUEST', detail: `price was ${dealRequest.requested_price} when requested, is now ${currentPrice}` },
      409
    );
  }
  if (dealRequest.requested_floor != null && offer.absolute_floor !== dealRequest.requested_floor) {
    await env.DB.prepare('DELETE FROM deal_decision_claims WHERE request_id = ?').bind(requestId).run();
    return json(
      { error: 'PRICE_CHANGED_SINCE_REQUEST', detail: `absolute_floor was ${dealRequest.requested_floor} when requested, is now ${offer.absolute_floor}` },
      409
    );
  }

  const vehicleWindow = await findVehicleWindow(env, 'MOVEMENT', offer.source_movement_id);
  if (!vehicleWindow) {
    await env.DB.prepare('DELETE FROM deal_decision_claims WHERE request_id = ?').bind(requestId).run();
    return json(
      { error: 'VEHICLE_UNKNOWN', detail: 'No recorded vehicle/availability for this offer’s movement — cannot safely confirm.' },
      409
    );
  }

  let attemptId = null;
  let phase = null; // the last phase THIS process successfully advanced to
  let claimedMovement = false;
  let allocationId = null;

  // FIX (bounded round-5 correction, finding 1 — confirmation/
  // reconciliation concurrency): every forward-progress phase transition
  // is now a CAS — `UPDATE ... WHERE attempt_id = ? AND phase = <the
  // phase THIS process last successfully wrote>`. Admin authentication on
  // a concurrent reconcile-confirmation call is NOT the same thing as
  // exclusive ownership of this specific in-flight attempt — Codex's
  // repro paused this handler immediately after its vehicle_allocations
  // INSERT committed, called reconcile (which fenced the phase and
  // unwound the allocation/movement claim), then resumed this handler,
  // which — before this fix — had no way to know anything had changed
  // and went on to write CONFIRMED anyway, leaving a FILLED offer with
  // zero allocations/claims behind it. Now: if reconcile (or this same
  // attempt's own rollback(), see below) wins the phase-CAS first, EVERY
  // subsequent advance() call here fails its own CAS and throws
  // ConfirmationFencedError — caught below, and the ONLY correct
  // response is to abort immediately without writing anything further
  // (never fall back to this attempt's own rollback(), which would race
  // whoever now legitimately owns the attempt).
  async function advance(toPhase, errorDetail) {
    const fromPhase = phase;
    const result = await env.DB
      .prepare(`UPDATE confirmation_attempts SET phase = ?, error_detail = ?, updated_at = ? WHERE attempt_id = ? AND phase = ?`)
      .bind(toPhase, errorDetail ?? null, nowIso(), attemptId, fromPhase)
      .run();
    if (result.meta.changes !== 1) {
      throw new ConfirmationFencedError(fromPhase, toPhase);
    }
    phase = toPhase;
  }

  // Fully compensates every write this attempt made. deal_requests.status
  // is NEVER touched here — it was never changed from 'REQUESTED' in the
  // first place (see the file header) — so there is nothing to revert
  // there. Each step is independently try/caught so one failing
  // compensating write never prevents the others from running.
  //
  // This ALSO fences itself first: a self-triggered rollback (a normal
  // business-conflict rejection, e.g. the offer got held elsewhere) must
  // not blindly compensate resources a CONCURRENT reconcile call has
  // already taken ownership of and started compensating itself — that
  // would race the same deletes/reverts twice. If the fence CAS
  // (`phase -> 'ROLLING_BACK'`) loses, this attempt has already been
  // superseded and must not touch anything further; reconcile owns it now.
  async function rollback() {
    // `phase` is still null when the confirmation_attempts row's own
    // INSERT itself never succeeded (e.g. Codex's exact repro — a
    // trigger rejecting that INSERT) — there is no row to fence at all,
    // and per the invariant that this INSERT is the very first write
    // inside the try block, nothing else could have happened yet either
    // (claimedMovement is false, allocationId is null). Fencing only
    // applies once a row genuinely exists to own.
    let holdsFence = false;
    if (phase !== null) {
      const fenced = await env.DB
        .prepare(`UPDATE confirmation_attempts SET phase = 'ROLLING_BACK', updated_at = ? WHERE attempt_id = ? AND phase = ?`)
        .bind(nowIso(), attemptId, phase)
        .run();
      if (fenced.meta.changes !== 1) {
        return { fullyRolledBack: false, supersededByReconcile: true };
      }
      phase = 'ROLLING_BACK';
      holdsFence = true;
    }

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
      if (holdsFence) {
        await env.DB.prepare(`UPDATE confirmation_attempts SET phase = 'ROLLBACK_FAILED', error_detail = ?, updated_at = ? WHERE attempt_id = ? AND phase = 'ROLLING_BACK'`).bind(failures.join('; '), nowIso(), attemptId).run();
      }
      // Deliberately do NOT free the decision claim — its true state
      // can't be safely assumed, so a further attempt must not be able
      // to race in. Only the admin reconcile endpoint may resolve this.
      return { fullyRolledBack: false };
    }
    // Every side-effect compensation succeeded — free the claim so a
    // fresh attempt can be made; deal_requests is untouched throughout
    // (still 'REQUESTED'), genuinely safe to retry.
    try {
      await env.DB.prepare('DELETE FROM deal_decision_claims WHERE request_id = ?').bind(requestId).run();
      if (holdsFence) {
        await env.DB.prepare(`UPDATE confirmation_attempts SET phase = 'ROLLED_BACK', updated_at = ? WHERE attempt_id = ? AND phase = 'ROLLING_BACK'`).bind(nowIso(), attemptId).run();
      }
      return { fullyRolledBack: true };
    } catch (e) {
      if (holdsFence) {
        await env.DB.prepare(`UPDATE confirmation_attempts SET phase = 'ROLLBACK_FAILED', error_detail = ?, updated_at = ? WHERE attempt_id = ?`).bind('claim_release: ' + e.message, nowIso(), attemptId).run();
      }
      return { fullyRolledBack: false };
    }
  }

  try {
    attemptId = `ca_${cryptoRandomId()}`;
    await env.DB
      .prepare(`INSERT INTO confirmation_attempts (attempt_id, request_id, offer_id, phase, created_at, updated_at) VALUES (?, ?, ?, 'STARTED', ?, ?)`)
      .bind(attemptId, requestId, offer.offer_id, now, now)
      .run();
    phase = 'STARTED';

    await advance('CLAIMING_MOVEMENT');
    const movementClaim = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO vehicle_time_claims (source_movement_id, claimed_by_offer_id, claimed_by_request_id, claimed_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(offer.source_movement_id, offer.offer_id, requestId, now)
      .run();
    if (movementClaim.meta.changes !== 1) {
      // A clean, expected rejection — not a system failure. Nothing else
      // was touched, so freeing the decision claim directly is enough;
      // no offer/allocation state exists yet to compensate.
      await env.DB.prepare('DELETE FROM deal_decision_claims WHERE request_id = ?').bind(requestId).run();
      await advance('ROLLED_BACK', 'VEHICLE_TIME_ALREADY_CLAIMED');
      return json(
        { error: 'VEHICLE_TIME_ALREADY_CLAIMED', detail: 'This exact movement has already been claimed by another offer.' },
        409
      );
    }
    claimedMovement = true;

    await advance('CLAIMING_VEHICLE');
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

    // Test-only pause hook, exercised by the round-5 concurrency
    // regression to reproduce Codex's exact repro: "pause immediately
    // after vehicle_allocations INSERT commits but before its awaited
    // result returns; call reconcile-confirmation; resume original
    // confirmation." Never present on any real env.
    if (typeof env.__TEST_PAUSE_AFTER_ALLOCATION__ === 'function') {
      await env.__TEST_PAUSE_AFTER_ALLOCATION__();
    }

    await advance('HOLDING_OFFER');
    const held = await holdOffer(store, offer.offer_id);
    if (!held.success) {
      const result = await rollback();
      return json({ error: 'OFFER_STATE_CONFLICT', detail: held.reason, reconciliation_needed: !result.fullyRolledBack }, 409);
    }

    await advance('FILLING_OFFER');
    const filled = await fillOffer(store, offer.offer_id, { movement_id: offer.source_movement_id });
    if (!filled.success) {
      const result = await rollback();
      return json({ error: 'OFFER_STATE_CONFLICT', detail: filled.reason || 'fill failed', reconciliation_needed: !result.fullyRolledBack }, 409);
    }

    // Test-only fault injection, exercised by the durable-recovery
    // regressions — never set on any real env.
    if (typeof env.__TEST_INJECT_FAILURE_BEFORE_FINAL_UPDATE__ === 'function') {
      env.__TEST_INJECT_FAILURE_BEFORE_FINAL_UPDATE__();
    }

    await advance('DONE');

    // ONLY NOW — after every real side effect, the fenced phase advance
    // to DONE, and the durable audit trail have fully succeeded — does
    // the guest-visible status ever change. Reaching DONE via the CAS
    // above is itself proof no concurrent reconcile call won the race.
    await env.DB
      .prepare(`UPDATE deal_requests SET status = 'CONFIRMED', decided_by = ?, decided_at = ?, updated_at = ? WHERE request_id = ? AND status = 'REQUESTED'`)
      .bind('marau-ops-preview', nowIso(), nowIso(), requestId)
      .run();

    return json({
      request_id: requestId,
      status: 'CONFIRMED',
      offer: filled.offer,
      vehicle_allocation: { allocation_id: allocationId, vehicle_id: vehicleWindow.vehicle_id, window_start: vehicleWindow.window_start, window_end: vehicleWindow.window_end },
    });
  } catch (err) {
    if (err instanceof ConfirmationFencedError) {
      // Ownership was taken away from under us (a concurrent
      // reconcile-confirmation call, or this same attempt's own
      // rollback() already fenced it) — abort immediately. Do NOT call
      // rollback() here: whoever won the fence already owns compensation
      // for this attempt, and racing it would risk double-releasing the
      // same resources.
      return json(
        {
          error: 'CONFIRMATION_SUPERSEDED',
          detail: `This confirmation attempt lost ownership advancing from ${err.fromPhase} to ${err.toPhase} — a concurrent admin reconciliation (or this attempt's own conflict-triggered rollback) already took over. No further state was written by this attempt.`,
        },
        409
      );
    }
    const result = await rollback();
    if (result.supersededByReconcile) {
      return json(
        {
          error: 'CONFIRMATION_SUPERSEDED',
          detail: 'This confirmation attempt failed and, on trying to roll itself back, found a concurrent admin reconciliation had already taken ownership. No further state was written by this attempt.',
        },
        409
      );
    }
    return json(
      {
        error: 'CONFIRMATION_FAILED',
        detail: result.fullyRolledBack
          ? 'The confirmation could not be completed and has been fully rolled back — safe to retry.'
          : 'The confirmation failed AND compensation could not fully complete — this request needs manual reconciliation. Do not retry automatically.',
        reconciliation_needed: !result.fullyRolledBack,
        recovery_action: result.fullyRolledBack ? undefined : `POST /preview/admin/deal-requests/${requestId}/reconcile-confirmation`,
      },
      500
    );
  }
}

async function handleAdminDeclineDealRequest(env, requestId) {
  const now = nowIso();
  const dealRequest = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requestId).first();
  if (!dealRequest) return json({ error: 'deal request not found' }, 404);
  if (dealRequest.status !== 'REQUESTED') {
    return json({ error: 'ALREADY_DECIDED', current_status: dealRequest.status }, 409);
  }

  // Same mutual-exclusion gate as confirm: a single cheap INSERT, racing
  // directly against handleAdminConfirmDealRequest's identical claim.
  const claim = await env.DB
    .prepare(`INSERT OR IGNORE INTO deal_decision_claims (request_id, decision, claimed_at) VALUES (?, 'DECLINE', ?)`)
    .bind(requestId, now)
    .run();
  if (claim.meta.changes !== 1) {
    return json(interruptedOrAlreadyDecidedResponse(await describeStuckClaim(env, requestId)), 409);
  }

  try {
    const result = await env.DB
      .prepare(`UPDATE deal_requests SET status = 'DECLINED', decided_by = ?, decided_at = ?, updated_at = ? WHERE request_id = ? AND status = 'REQUESTED'`)
      .bind('marau-ops-preview', now, now, requestId)
      .run();
    if (result.meta.changes !== 1) {
      // Shouldn't happen given the checks above, but stay honest if it does.
      await env.DB.prepare('DELETE FROM deal_decision_claims WHERE request_id = ?').bind(requestId).run();
      return json({ error: 'ALREADY_DECIDED', current_status: dealRequest.status }, 409);
    }
    return json({ request_id: requestId, status: 'DECLINED' });
  } catch (err) {
    // Nothing else was touched by a decline — freeing the claim is the
    // whole rollback.
    await env.DB.prepare('DELETE FROM deal_decision_claims WHERE request_id = ?').bind(requestId).run();
    return json({ error: 'DECLINE_FAILED', detail: 'Could not record the decline — safe to retry.' }, 500);
  }
}

/**
 * The actionable, ownership-fenced (admin-only) recovery path for a
 * confirmation attempt that was interrupted before reaching a terminal
 * phase. Inspects the REAL current state directly — never trusts the
 * recorded `phase` alone, which could itself be stale if the process
 * died mid-write — and always resolves to a definite outcome: either the
 * confirmation genuinely completed (just finish marking it) or it did
 * not (fully unwind whatever partial state exists). Never leaves the
 * request in an ambiguous state after running.
 *
 * FIX (bounded round-5 correction, finding 1 — confirmation/
 * reconciliation concurrency): admin authentication on THIS call is not
 * the same thing as exclusive ownership of a specific in-flight confirm
 * attempt. Before inspecting or touching ANY real state, this handler
 * must WIN a fencing CAS — `UPDATE confirmation_attempts SET phase =
 * 'RECONCILING' WHERE attempt_id = ? AND phase = <the phase just read>`
 * — against the SAME `phase` column the confirm handler's own advance()
 * calls are gated on (see handleAdminConfirmDealRequest). If this call
 * loses that race (the original attempt had already moved the phase on
 * by the time this fence is attempted), the original is still genuinely
 * progressing — this call must NOT inspect or touch anything, and
 * instead re-reads fresh state to report what actually happened. Only
 * once the fence is WON is it safe to assume the original attempt's next
 * write will fail its own CAS and abort, making concurrent inspection
 * and compensation here safe.
 */
async function handleAdminReconcileConfirmation(env, requestId) {
  const store = createD1Store({ SMART_RETURN_DB: env.DB });
  const now = nowIso();

  const dealRequest = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requestId).first();
  if (!dealRequest) return json({ error: 'deal request not found' }, 404);

  const claim = await env.DB.prepare('SELECT * FROM deal_decision_claims WHERE request_id = ?').bind(requestId).first();
  const attempt = await env.DB
    .prepare('SELECT * FROM confirmation_attempts WHERE request_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(requestId)
    .first();

  if (dealRequest.status !== 'REQUESTED') {
    return json({ resolved: 'ALREADY_TERMINAL', status: dealRequest.status });
  }
  if (!claim) {
    return json({ resolved: 'NOTHING_TO_RECONCILE', detail: 'No decision claim exists for this request — it is simply still awaiting a decision.' });
  }

  if (claim.decision === 'DECLINE') {
    // Decline has no multi-step phase progression to fence (it never
    // creates a confirmation_attempts row at all — see
    // handleAdminDeclineDealRequest) — a stalled decline can only have
    // died between the claim INSERT and its own single UPDATE, before
    // touching anything else. Safe to just finish it directly.
    await env.DB
      .prepare(`UPDATE deal_requests SET status = 'DECLINED', decided_by = ?, decided_at = ?, updated_at = ? WHERE request_id = ? AND status = 'REQUESTED'`)
      .bind('marau-ops-preview (reconciled)', now, now, requestId)
      .run();
    if (attempt) await env.DB.prepare(`UPDATE confirmation_attempts SET phase = 'DONE', updated_at = ? WHERE attempt_id = ?`).bind(now, attempt.attempt_id).run();
    return json({ resolved: 'DECLINED' });
  }

  // decision === 'CONFIRM'.
  if (!attempt) {
    // No confirmation_attempts row was ever created for this claim.
    // confirmation_attempts is the FIRST write the confirm handler makes
    // inside its try block, before any other state-touching write — so
    // if this row genuinely never exists, nothing beyond the claim
    // itself could possibly have happened yet. Safe to just free the
    // claim directly; no fencing/compensation needed. (A vanishingly
    // narrow window — a crash between the claim INSERT and this row
    // being created — is not fully closed by this fix; see
    // MARAU_STAGE1_CODEX_FIXES_ROUND5.md for the honest scope note.)
    await env.DB.prepare('DELETE FROM deal_decision_claims WHERE request_id = ?').bind(requestId).run();
    return json({ resolved: 'ROLLED_BACK_TO_REQUESTED', detail: 'No confirmation attempt record ever existed for this claim — freed for a fresh attempt.' });
  }

  // Win exclusive ownership of THIS SPECIFIC attempt generation before
  // touching anything. If we lose, the original is still genuinely
  // progressing (or finished between our read and this fence attempt) —
  // re-read fresh state rather than assume anything.
  const fence = await env.DB
    .prepare(`UPDATE confirmation_attempts SET phase = 'RECONCILING', updated_at = ? WHERE attempt_id = ? AND phase = ?`)
    .bind(now, attempt.attempt_id, attempt.phase)
    .run();
  if (fence.meta.changes !== 1) {
    const fresh = await env.DB.prepare('SELECT * FROM confirmation_attempts WHERE attempt_id = ?').bind(attempt.attempt_id).first();
    if (fresh && (fresh.phase === 'DONE' || fresh.phase === 'ROLLED_BACK')) {
      const freshRequest = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requestId).first();
      return json({
        resolved: freshRequest.status === 'REQUESTED' ? 'ROLLED_BACK_TO_REQUESTED' : 'ALREADY_TERMINAL',
        status: freshRequest.status,
        detail: 'The attempt reached a terminal outcome between being read and being fenced by this call — nothing further was done here.',
      });
    }
    return json({
      resolved: 'ATTEMPT_STILL_ACTIVE',
      detail: 'The confirmation attempt is still genuinely in progress — its phase advanced between being read and this call’s attempt to fence it. It is not stalled; no action was taken. Call again if it later appears stuck.',
    });
  }

  // We now exclusively own this attempt generation — the original's own
  // advance()/rollback() calls will fail their CAS from here on and abort
  // without writing anything further. Safe to inspect real state.
  const offer = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(dealRequest.offer_id).first();
  const movementClaimed = offer
    ? await env.DB.prepare('SELECT 1 FROM vehicle_time_claims WHERE source_movement_id = ? AND claimed_by_request_id = ?').bind(offer.source_movement_id, requestId).first()
    : null;
  const allocation = await env.DB.prepare(`SELECT * FROM vehicle_allocations WHERE subject_type = 'DEAL_REQUEST' AND subject_id = ?`).bind(requestId).first();
  const offerFilled = Boolean(offer) && offer.status === 'FILLED';

  if (offer && movementClaimed && allocation && offerFilled) {
    // Every real side effect actually succeeded — only the final marking
    // (or the audit write) was interrupted. Finish it.
    await env.DB
      .prepare(`UPDATE deal_requests SET status = 'CONFIRMED', decided_by = ?, decided_at = ?, updated_at = ? WHERE request_id = ? AND status = 'REQUESTED'`)
      .bind('marau-ops-preview (reconciled)', now, now, requestId)
      .run();
    await env.DB.prepare(`UPDATE confirmation_attempts SET phase = 'DONE', updated_at = ? WHERE attempt_id = ? AND phase = 'RECONCILING'`).bind(now, attempt.attempt_id).run();
    return json({ resolved: 'CONFIRMED' });
  }

  // Partial or nothing real actually happened — fully unwind whatever
  // DOES exist so the request becomes cleanly retryable, exactly like a
  // normal rollback(), each step independently try/caught.
  const failures = [];
  if (offer) {
    try {
      await store.casOfferStatus(offer.offer_id, 'FILLED', 'ACTIVE');
      await store.casOfferStatus(offer.offer_id, 'HELD', 'ACTIVE');
    } catch (e) {
      failures.push('offer_status: ' + e.message);
    }
  }
  if (allocation) {
    try {
      await releaseVehicleAllocation(env, allocation.allocation_id);
    } catch (e) {
      failures.push('allocation: ' + e.message);
    }
  }
  if (movementClaimed) {
    try {
      await env.DB.prepare('DELETE FROM vehicle_time_claims WHERE source_movement_id = ? AND claimed_by_request_id = ?').bind(offer.source_movement_id, requestId).run();
    } catch (e) {
      failures.push('movement_claim: ' + e.message);
    }
  }

  if (failures.length > 0) {
    await env.DB.prepare(`UPDATE confirmation_attempts SET phase = 'ROLLBACK_FAILED', error_detail = ?, updated_at = ? WHERE attempt_id = ? AND phase = 'RECONCILING'`).bind(failures.join('; '), now, attempt.attempt_id).run();
    return json({ resolved: 'RECONCILIATION_FAILED', detail: failures.join('; ') }, 500);
  }

  await env.DB.prepare('DELETE FROM deal_decision_claims WHERE request_id = ?').bind(requestId).run();
  await env.DB.prepare(`UPDATE confirmation_attempts SET phase = 'ROLLED_BACK', updated_at = ? WHERE attempt_id = ? AND phase = 'RECONCILING'`).bind(now, attempt.attempt_id).run();
  return json({ resolved: 'ROLLED_BACK_TO_REQUESTED' });
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
  // FIX (fourth independent review, finding 2 — Fiji time): a raw
  // pickup_datetime carried in a change request's requested_fields must
  // go through the SAME normalization as booking creation before being
  // applied — normalizePickupDatetime is idempotent on already-zoned
  // input, so this is safe even if the value was already normalized when
  // the change request was first submitted (covers "unchanged-time
  // submission" without a second, compounding shift).
  const values = safeFields.map((f) => (f === 'pickup_datetime' ? normalizePickupDatetime(requested[f]) : requested[f]));
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
      if (method === 'GET' && pathname === '/icon-192.png') return PNG_RESPONSE(ICON192_PNG_BASE64);
      if (method === 'GET' && pathname === '/icon-512.png') return PNG_RESPONSE(ICON512_PNG_BASE64);
      if (method === 'GET' && pathname === '/icon-180.png') return PNG_RESPONSE(ICON180_PNG_BASE64);

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
        const reconcileMatch = pathname.match(/^\/preview\/admin\/deal-requests\/([^/]+)\/reconcile-confirmation$/);
        if (method === 'POST' && reconcileMatch) return handleAdminReconcileConfirmation(env, reconcileMatch[1]);

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
