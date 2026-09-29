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
import { humanizeVehicleClassLabel } from './guest_display.js';
import { syncRealBookingEvent, reconcileRealBooking } from './real_booking_sync.js';
import { confirmReservationAtSource } from './source_confirm.js';

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

// FIX (iPhone installation blocker, round 24): James's own real device
// showed the guest link correctly loading his confirmed Trip in Safari,
// but the SAME guest's freshly-installed home-screen icon opened
// straight to the synthetic-entry screen — the standalone container's
// own localStorage did not carry the token the Safari tab had just set,
// even though both are nominally the same origin (screenshot evidence,
// 2026-09-29). This is a real, previously-undocumented gap between
// "localStorage set from a browser tab" and "localStorage visible to
// the SEPARATE container iOS launches a home-screen web app from" — see
// pages.js's own getToken()/setToken() for the client-side half of this
// fix (a cookie is now ALSO written there, as an independent third
// recovery path never assumed to work, only tried). This function is
// the corresponding SERVER-side fallback: used ONLY by
// requireGuestSession (guest auth), never requireAdmin/bearerToken's
// other callers — admin/staff auth is completely untouched. Reads the
// SAME opaque access_token a guest already has via the ordinary
// Authorization header; nothing about server-side validation, expiry,
// or revocation changes — access_token_revoked is still checked exactly
// the same way regardless of which of the two places the token arrived
// from. Never derives or infers a token from a booking reference, email,
// or phone match — cookie or header, it is always the caller's own
// already-issued access_token, verbatim.
function guestCookieToken(request) {
  const header = request.headers.get('cookie') || '';
  const match = header.match(/(?:^|;\s*)marau_tok=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
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
  // FIX (round 24): the ordinary Authorization header is tried FIRST,
  // unchanged — the cookie is only ever a fallback for the specific
  // installed-standalone-app scenario where the client's own JS-visible
  // storage came up empty (see guestCookieToken's own header comment).
  const token = bearerToken(request) || guestCookieToken(request);
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
      // Mobile-copy finding 4: this used to assert "Confirmed by operator
      // before travel" for an offer that has NOT actually been confirmed
      // yet — nothing about seeing this deal means an operator has
      // agreed to it. Finding 2: the vehicle class is humanized the same
      // way everywhere else guest-facing.
      conditions: `Requires operator confirmation. Capacity ${o.capacity}. Vehicle: ${humanizeVehicleClassLabel(o.vehicle_class)}.`,
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

  // P0 FIX (round 20): a staff review token — a genuine decision
  // capability — was being minted here and returned DIRECTLY in the
  // response to this SAME endpoint's own caller: the GUEST who just
  // requested the deal (requireGuestSession above proves that, not
  // requireAdmin). Any guest could read their own response, extract the
  // token, and call /preview/staff/review/decide on their OWN request —
  // a complete staff-authorization bypass. The token is still minted
  // here (it is genuinely tied to THIS request's own creation moment),
  // but it is NEVER included in the guest-facing response — it is only
  // ever surfaced via handleAdminListDealRequests (admin-token gated),
  // which is where a real "compose the ops alert" step would read it
  // from in production. See that function and handleStaffReviewDecide
  // (now itself also staff-auth-gated, not token-possession-gated) for
  // the rest of this fix.
  await mintStaffReviewToken(env, 'deal_request', dealRequest.request_id);

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

async function handleAdminListDealRequests(request, env) {
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

  // P0 FIX (round 20) — this is the ONLY place a staff review link is
  // ever surfaced: an admin-token-gated endpoint, never the guest's own
  // request/response. One row per request_id, the most recently minted
  // still-unexpired token (mintStaffReviewToken is called once per
  // handleRequestDeal call, so a genuine retry can leave more than one).
  const { results: tokenRows } = await env.DB
    .prepare(
      `SELECT t1.subject_id, t1.token FROM marau_staff_review_tokens t1
       WHERE t1.subject_type = 'deal_request' AND t1.expires_at > ?
         AND t1.created_at = (SELECT MAX(t2.created_at) FROM marau_staff_review_tokens t2 WHERE t2.subject_type = 'deal_request' AND t2.subject_id = t1.subject_id AND t2.expires_at > ?)`
    )
    .bind(nowIso(), nowIso())
    .all();
  const reviewTokenByRequestId = new Map(tokenRows.map((t) => [t.subject_id, t.token]));
  const origin = new URL(request.url).origin;

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
    const reviewToken = reviewTokenByRequestId.get(r.request_id);
    const review_link = reviewToken ? `${origin}/preview/staff/review?token=${reviewToken}` : null;
    const stalled = stalledByRequest.get(r.request_id);
    if (stalled) {
      return { ...r, review_link, reconciliation_needed: true, stalled_phase: stalled.phase, stalled_detail: stalled.error_detail };
    }
    if (r.status === 'REQUESTED' && claimedRequestIds.has(r.request_id)) {
      return { ...r, review_link, reconciliation_needed: true, stalled_phase: null, stalled_detail: 'A decision claim exists but no confirmation attempt record was ever created for it.' };
    }
    return { ...r, review_link, reconciliation_needed: false };
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
 * Thrown whenever a resource-mutating statement in the confirm flow
 * discovers, via its OWN affected-row count (or an immediate follow-up
 * ownership check when the statement's own condition can't distinguish
 * "lost ownership" from "genuine business conflict"), that this attempt
 * no longer owns `attempt_token` in `deal_decision_claims` — a concurrent
 * `reconcile-confirmation` call has taken over. The caller MUST treat
 * this as "ownership has been taken away" and abort immediately without
 * any further writes — never fall back to its own rollback(), which
 * would race whoever now legitimately owns the attempt.
 */
class ConfirmationFencedError extends Error {
  constructor(atStep) {
    super(`FENCED: lost ownership at step "${atStep}" — a concurrent admin reconciliation already took over this attempt`);
    this.atStep = atStep;
  }
}

/**
 * Marau-only adapter retaining the shared engine's status transitions.
 * SQL checks pending request, current owner, and immutable offer owner
 * together. Recovery can rotate its token without losing resource identity.
 */
function createOwnershipFencedStore(env, requestId, attemptToken) {
  return {
    async getOffer(offerId) {
      return env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offerId).first();
    },
    async casOfferStatus(offerId, expectedStatus, nextStatus, patch = {}) {
      const acquiring = expectedStatus === 'ACTIVE' && nextStatus === 'HELD';
      const patchCols = Object.keys(patch);
      // Resource identity is immutable across recovery takeovers. A request
      // ownership token alone is NOT proof that this attempt held this offer.
      const marker = nextStatus === 'ACTIVE' ? 'NULL' :
        '(SELECT journal_attempt_id FROM deal_decision_claims WHERE request_id = ? AND attempt_token = ?)';
      const sets = ['status = ?', 'updated_at = ?', `marau_attempt_id = ${marker}`, ...patchCols.map(c => `${c} = ?`)];
      const args = [nextStatus, nowIso(), ...(nextStatus === 'ACTIVE' ? [] : [requestId, attemptToken]),
        ...patchCols.map(c => patch[c]), offerId, expectedStatus, requestId, attemptToken];
      const result = await env.DB.prepare(`UPDATE smart_offers SET ${sets.join(', ')}
        WHERE offer_id = ? AND status = ? AND EXISTS (
          SELECT 1 FROM deal_decision_claims c JOIN deal_requests r ON r.request_id = c.request_id
          WHERE c.request_id = ? AND c.attempt_token = ? AND r.status = 'REQUESTED'
            AND c.journal_attempt_id IS NOT NULL
            AND ${acquiring ? 'smart_offers.marau_attempt_id IS NULL' : 'smart_offers.marau_attempt_id = c.journal_attempt_id'}
        )`).bind(...args).run();
      const offer = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offerId).first();
      return { success: result.meta.changes === 1, offer };
    },
  };
}

/**
 * A single, reusable ownership-verification read — used whenever a
 * resource-mutating statement's own affected-row count is zero and the
 * caller needs to distinguish "lost ownership" (abort via
 * ConfirmationFencedError) from "a genuine, expected business conflict"
 * (proceed with the normal rejection/rollback path instead).
 */
async function stillOwnsAttempt(env, requestId, attemptToken) {
  const row = await env.DB.prepare('SELECT 1 FROM deal_decision_claims WHERE request_id = ? AND attempt_token = ?').bind(requestId, attemptToken).first();
  return Boolean(row);
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
  const attemptToken = `at_${cryptoRandomId()}`;
  const claim = await env.DB
    .prepare(`INSERT OR IGNORE INTO deal_decision_claims (request_id, decision, claimed_at, attempt_token, journal_attempt_id) SELECT ?, 'CONFIRM', ?, ?, ? WHERE EXISTS (SELECT 1 FROM deal_requests WHERE request_id = ? AND status = 'REQUESTED')`)
    .bind(requestId, now, attemptToken, attemptToken, requestId)
    .run();
  if (claim.meta.changes !== 1) {
    return json(interruptedOrAlreadyDecidedResponse(await describeStuckClaim(env, requestId)), 409);
  }

  // From here on, this attempt exclusively owns `attemptToken`. Any early
  // return before the journal/resource writes begin must release
  // ownership via THIS SAME ownership-checked delete (requirement:
  // "enforce ownership … on … claim release") — never a bare
  // unconditional DELETE, so a reconciler that has ALREADY taken over in
  // some vanishingly narrow window is never undone by us.
  async function releaseOwnership() {
    const result = await env.DB
      .prepare(`DELETE FROM deal_decision_claims WHERE request_id = ? AND attempt_token = ?`)
      .bind(requestId, attemptToken)
      .run();
    return result.meta.changes === 1;
  }

  const offer = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(dealRequest.offer_id).first();
  if (!offer) {
    await releaseOwnership();
    return json({ error: 'offer no longer exists' }, 404);
  }

  const eligibility = evaluateOfferEligibility(offer, now);
  if (!eligibility.eligible) {
    if (eligibility.reason === 'EXPIRED' && offer.status !== 'EXPIRED' && offer.status !== 'FILLED') {
      await expireOffer(store, offer.offer_id);
    }
    await releaseOwnership();
    return json({ error: 'STALE_OR_UNAPPROVED_OFFER', reason: eligibility.reason, detail: eligibility.detail }, 409);
  }

  const currentPrice = offer.smart_match_price ?? offer.standard_price;
  if (dealRequest.requested_price != null && currentPrice !== dealRequest.requested_price) {
    await releaseOwnership();
    return json(
      { error: 'PRICE_CHANGED_SINCE_REQUEST', detail: `price was ${dealRequest.requested_price} when requested, is now ${currentPrice}` },
      409
    );
  }
  if (dealRequest.requested_floor != null && offer.absolute_floor !== dealRequest.requested_floor) {
    await releaseOwnership();
    return json(
      { error: 'PRICE_CHANGED_SINCE_REQUEST', detail: `absolute_floor was ${dealRequest.requested_floor} when requested, is now ${offer.absolute_floor}` },
      409
    );
  }

  const vehicleWindow = await findVehicleWindow(env, 'MOVEMENT', offer.source_movement_id);
  if (!vehicleWindow) {
    await releaseOwnership();
    return json(
      { error: 'VEHICLE_UNKNOWN', detail: 'No recorded vehicle/availability for this offer’s movement — cannot safely confirm.' },
      409
    );
  }

  // A narrowly-scoped, ownership-fenced adapter for the SHARED Issue #54
  // engine's own hold/fill transitions — see createOwnershipFencedStore's
  // own doc comment. The shared engine's state-machine rules
  // (holdOffer/fillOffer in smart-return-trigger-fill/src/offers.js) are
  // completely unchanged; only the store they write through is swapped.
  const fencedStore = createOwnershipFencedStore(env, requestId, attemptToken);
  const ownership = { requestId, attemptToken };

  let claimedMovement = false;
  let allocationId = null;

  // Audit writes use stable identity and current ownership. Zero affected
  // rows are explicit failures; post-commit callers report audit repair
  // rather than invoking compensation.
  async function setPhase(toPhase, errorDetail) {
    const result = await env.DB.prepare(
      `UPDATE confirmation_attempts SET phase = ?, error_detail = ?, updated_at = ?
       WHERE attempt_id = ? AND request_id = ? AND EXISTS (
         SELECT 1 FROM deal_decision_claims WHERE request_id = ? AND attempt_token = ? AND journal_attempt_id = confirmation_attempts.attempt_id)`
    ).bind(toPhase, errorDetail ?? null, nowIso(), attemptToken, requestId, requestId, attemptToken).run();
    if (result.meta.changes === 1) return;
    if (!(await stillOwnsAttempt(env, requestId, attemptToken))) throw new ConfirmationFencedError('writing the audit phase');
    const row = await env.DB.prepare('SELECT 1 FROM confirmation_attempts WHERE attempt_id = ?').bind(attemptToken).first();
    if (!row && ['ROLLED_BACK', 'ROLLBACK_FAILED'].includes(toPhase)) return;
    throw new Error('AUDIT_WRITE_NOT_APPLIED');
  }

  // Fully compensates every write this attempt made. deal_requests.status
  // is NEVER touched here — it was never changed from 'REQUESTED' in the
  // first place — so there is nothing to revert there.
  //
  // Requirement: "compensation must verify both current recovery
  // ownership and ownership of the resource being undone." Every
  // compensating write below goes through the SAME ownership-fenced
  // primitives (fencedStore.casOfferStatus, releaseVehicleAllocation's
  // `ownership` argument, an ownership-gated movement-claim DELETE) as
  // the forward-progress writes — so a rollback triggered AFTER ownership
  // has already been taken away by a reconciler is itself unable to
  // touch anything (each compensating statement's own EXISTS clause
  // yields zero rows), rather than racing whoever now legitimately owns
  // the attempt. Each step is independently try/caught so one failing
  // compensating write never prevents the others from running.
  async function rollback() {
    const failures = [];
    try {
      if (env.__TEST_FAIL_ROLLBACK_STEP__ === 'offer_status') throw new Error('INJECTED_ROLLBACK_FAILURE(offer_status)');
      await fencedStore.casOfferStatus(offer.offer_id, 'FILLED', 'ACTIVE');
      await fencedStore.casOfferStatus(offer.offer_id, 'HELD', 'ACTIVE');
    } catch (e) {
      failures.push('offer_status: ' + e.message);
    }
    if (allocationId) {
      try {
        if (env.__TEST_FAIL_ROLLBACK_STEP__ === 'allocation') throw new Error('INJECTED_ROLLBACK_FAILURE(allocation)');
        await releaseVehicleAllocation(env, allocationId, ownership);
      } catch (e) {
        failures.push('allocation: ' + e.message);
      }
    }
    if (claimedMovement) {
      try {
        if (env.__TEST_FAIL_ROLLBACK_STEP__ === 'movement_claim') throw new Error('INJECTED_ROLLBACK_FAILURE(movement_claim)');
        await env.DB
          .prepare(
            `DELETE FROM vehicle_time_claims
             WHERE source_movement_id = ? AND claimed_by_request_id = ?
               AND EXISTS (SELECT 1 FROM deal_decision_claims c JOIN deal_requests r ON r.request_id = c.request_id WHERE c.request_id = ? AND c.attempt_token = ? AND r.status = 'REQUESTED')`
          )
          .bind(offer.source_movement_id, requestId, requestId, attemptToken)
          .run();
      } catch (e) {
        failures.push('movement_claim: ' + e.message);
      }
    }
    const remainingOffer = await env.DB.prepare('SELECT 1 FROM smart_offers WHERE offer_id = ? AND marau_attempt_id = ?').bind(offer.offer_id, attemptToken).first();
    const remainingAllocation = await env.DB.prepare("SELECT 1 FROM vehicle_allocations WHERE subject_type = 'DEAL_REQUEST' AND subject_id = ?").bind(requestId).first();
    const remainingMovement = await env.DB.prepare('SELECT 1 FROM vehicle_time_claims WHERE claimed_by_request_id = ?').bind(requestId).first();
    if (remainingOffer || remainingAllocation || remainingMovement) failures.push('resource compensation incomplete');
    if (!(await stillOwnsAttempt(env, requestId, attemptToken))) return { fullyRolledBack: false };
    if (failures.length > 0) {
      try { await setPhase('ROLLBACK_FAILED', failures.join('; ')); } catch { /* Keep the claim for recovery if its audit also fails. */ }
      // Deliberately do NOT free the decision claim — its true state
      // can't be safely assumed, so a further attempt must not be able
      // to race in. Only the admin reconcile endpoint may resolve this.
      return { fullyRolledBack: false };
    }
    // Every side-effect compensation succeeded. Record ROLLED_BACK
    // BEFORE freeing the claim — setPhase's own ownership check requires
    // the claim row to still exist, so releasing it first would make
    // this write a silent no-op (the phase would be stuck showing
    // whatever step it was on, contradicting the fully-successful
    // rollback that just happened). Then free the claim (checked: if
    // ownership was ALREADY gone by this point, this is simply a
    // harmless no-op that reports itself honestly rather than claiming
    // success it didn't achieve).
    try { await setPhase('ROLLED_BACK', null); } catch { return { fullyRolledBack: false }; }
    const released = await releaseOwnership();
    return { fullyRolledBack: released };
  }

  try {
    // Test-only pause hook, exercised by the round-6 concurrency
    // regression to reproduce Codex's exact second repro: "pause BEFORE
    // confirmation_attempts INSERT executes, after decision claim
    // acquisition." Never present on any real env.
    if (typeof env.__TEST_PAUSE_AFTER_CLAIM_BEFORE_JOURNAL__ === 'function') {
      await env.__TEST_PAUSE_AFTER_CLAIM_BEFORE_JOURNAL__();
    }

    // The journal — attempt_id IS attemptToken (the exact same value).
    // Gated on ownership too: "pause right after establishing ownership,
    // before this INSERT" (Codex's second repro) is closed here — if a
    // reconciler already took over in that exact window, this affects
    // zero rows and we detect it immediately, aborting before ANY
    // resource-mutating statement ever runs.
    const journal = await env.DB
      .prepare(
        `INSERT INTO confirmation_attempts (attempt_id, request_id, offer_id, phase, created_at, updated_at)
         SELECT ?, ?, ?, 'STARTED', ?, ?
         WHERE EXISTS (SELECT 1 FROM deal_decision_claims c JOIN deal_requests r ON r.request_id = c.request_id WHERE c.request_id = ? AND c.attempt_token = ? AND r.status = 'REQUESTED')`
      )
      .bind(attemptToken, requestId, offer.offer_id, now, now, requestId, attemptToken)
      .run();
    if (journal.meta.changes !== 1) {
      throw new ConfirmationFencedError('creating the journal (claim without a journal — safely recoverable by reconcile)');
    }

    await setPhase('CLAIMING_MOVEMENT');
    const movementClaim = await env.DB
      .prepare(
        `INSERT INTO vehicle_time_claims (source_movement_id, claimed_by_offer_id, claimed_by_request_id, claimed_at)
         SELECT ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM vehicle_time_claims WHERE source_movement_id = ?)
           AND EXISTS (SELECT 1 FROM deal_decision_claims c JOIN deal_requests r ON r.request_id = c.request_id WHERE c.request_id = ? AND c.attempt_token = ? AND r.status = 'REQUESTED')`
      )
      .bind(offer.source_movement_id, offer.offer_id, requestId, now, offer.source_movement_id, requestId, attemptToken)
      .run();
    if (movementClaim.meta.changes !== 1) {
      // The single statement's own affected-row count can't tell us
      // WHICH of its two conditions failed — re-check ownership directly
      // to distinguish "lost ownership" (abort, superseded) from "a
      // genuine, expected VEHICLE_TIME_ALREADY_CLAIMED conflict".
      if (!(await stillOwnsAttempt(env, requestId, attemptToken))) {
        throw new ConfirmationFencedError('claiming the movement');
      }
      await setPhase('ROLLED_BACK', 'VEHICLE_TIME_ALREADY_CLAIMED');
      await releaseOwnership();
      return json(
        { error: 'VEHICLE_TIME_ALREADY_CLAIMED', detail: 'This exact movement has already been claimed by another offer.' },
        409
      );
    }
    claimedMovement = true;

    await setPhase('CLAIMING_VEHICLE');

    // Test-only pause hook, exercised by the round-6 concurrency
    // regression to reproduce Codex's exact first repro: "pause BEFORE
    // vehicle_allocations INSERT executes, after phase CLAIMING_VEHICLE."
    // Never present on any real env.
    if (typeof env.__TEST_PAUSE_BEFORE_ALLOCATION__ === 'function') {
      await env.__TEST_PAUSE_BEFORE_ALLOCATION__();
    }

    allocationId = `va_${cryptoRandomId()}`;
    const allocation = await claimVehicleAllocation(env, {
      allocationId,
      vehicleId: vehicleWindow.vehicle_id,
      windowStart: vehicleWindow.window_start,
      windowEnd: vehicleWindow.window_end,
      subjectType: 'DEAL_REQUEST',
      subjectId: requestId,
      nowIso: now,
      ownership,
    });
    if (!allocation.success) {
      allocationId = null; // nothing was actually inserted — see claimVehicleAllocation's own contract
      if (!(await stillOwnsAttempt(env, requestId, attemptToken))) {
        throw new ConfirmationFencedError('claiming the vehicle allocation');
      }
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

    // Test-only pause hooks, exercised by the concurrency regressions to
    // reproduce Codex's exact repros at each specific interruption point.
    // Never present on any real env.
    if (typeof env.__TEST_PAUSE_AFTER_ALLOCATION__ === 'function') {
      await env.__TEST_PAUSE_AFTER_ALLOCATION__();
    }

    await setPhase('HOLDING_OFFER');
    const held = await holdOffer(fencedStore, offer.offer_id);
    if (!held.success) {
      // held.reason may read as a generic status mismatch even when the
      // TRUE cause is a lost ownership fence (the fenced store's own CAS
      // simply reports 0 rows changed either way) — check directly.
      if (!(await stillOwnsAttempt(env, requestId, attemptToken))) {
        throw new ConfirmationFencedError('holding the offer');
      }
      const result = await rollback();
      return json({ error: 'OFFER_STATE_CONFLICT', detail: held.reason, reconciliation_needed: !result.fullyRolledBack }, 409);
    }

    if (typeof env.__TEST_PAUSE_AFTER_HOLD__ === 'function') {
      await env.__TEST_PAUSE_AFTER_HOLD__();
    }

    await setPhase('FILLING_OFFER');
    const filled = await fillOffer(fencedStore, offer.offer_id, { movement_id: offer.source_movement_id });
    if (!filled.success) {
      if (!(await stillOwnsAttempt(env, requestId, attemptToken))) {
        throw new ConfirmationFencedError('filling the offer');
      }
      const result = await rollback();
      return json({ error: 'OFFER_STATE_CONFLICT', detail: filled.reason || 'fill failed', reconciliation_needed: !result.fullyRolledBack }, 409);
    }

    // Test-only fault injection, exercised by the durable-recovery
    // regressions — never set on any real env.
    if (typeof env.__TEST_INJECT_FAILURE_BEFORE_FINAL_UPDATE__ === 'function') {
      env.__TEST_INJECT_FAILURE_BEFORE_FINAL_UPDATE__();
    }

    // THE decisive write — ownership-fenced in the SAME atomic statement,
    // and its affected-row count is CHECKED (requirement: "return
    // CONFIRMED only when the authoritative final transition succeeded").
    // Reaching changes === 1 here is itself proof no concurrent reconcile
    // call ever took over this attempt, from start to finish.
    const finalWrite = await env.DB
      .prepare(
        `UPDATE deal_requests SET status = 'CONFIRMED', decided_by = ?, decided_at = ?, updated_at = ?
         WHERE request_id = ? AND status = 'REQUESTED'
           AND EXISTS (SELECT 1 FROM deal_decision_claims c JOIN deal_requests r ON r.request_id = c.request_id WHERE c.request_id = ? AND c.attempt_token = ? AND r.status = 'REQUESTED')`
      )
      .bind('marau-ops-preview', nowIso(), nowIso(), requestId, requestId, attemptToken)
      .run();
    if (finalWrite.meta.changes !== 1) {
      throw new ConfirmationFencedError('the final decisive status write');
    }

    // FIX (seventh independent review — "post-confirmation audit
    // failure"): THE COMMIT BOUNDARY. The instant finalWrite reports
    // changes === 1, the confirmation has unconditionally taken effect —
    // the guest booking IS confirmed, full stop. Nothing after this point
    // may compensate or undo the resources above, no matter what fails
    // next. Codex made a real SQLite trigger reject the very next
    // statement (this journal write, phase='DONE') and found the
    // response falsely claiming "fully rolled back — safe to retry" while
    // the request was, in fact, genuinely CONFIRMED with every one of its
    // resources having ALSO been compensated out from under it by the
    // (wrongly triggered) rollback() — a confirmed booking whose vehicle
    // was released and whose claims were deleted. The fix is structural:
    // this write is now in its OWN try/catch, entirely separate from the
    // main try/catch above (whose catch calls rollback()) — an audit-only
    // failure here can never reach that compensation path. A single
    // best-effort retry is attempted (a transient failure shouldn't
    // immediately become a permanent gap); if it still fails, the
    // response stays truthfully 200 CONFIRMED with an explicit
    // audit_warning — the booking, offer, and allocation are completely
    // unaffected, and the audit trail itself can be repaired later,
    // resource-free, via reconcile-confirmation's own audit-repair path
    // for an already-terminal request (see handleAdminReconcileConfirmation).
    let auditWarning = null;
    try {
      await setPhase('DONE');
    } catch (auditErr) {
      try {
        await setPhase('DONE');
      } catch (auditErr2) {
        auditWarning = `The confirmation committed successfully, but the durable audit record could not be finalized (${auditErr2.message}). This does not affect the booking, the offer, or the allocation — the audit trail can be repaired later without touching any guest-visible state.`;
      }
    }

    return json({
      request_id: requestId,
      status: 'CONFIRMED',
      offer: filled.offer,
      vehicle_allocation: { allocation_id: allocationId, vehicle_id: vehicleWindow.vehicle_id, window_start: vehicleWindow.window_start, window_end: vehicleWindow.window_end },
      ...(auditWarning ? { audit_warning: auditWarning } : {}),
    });
  } catch (err) {
    if (err instanceof ConfirmationFencedError) {
      // Ownership was taken away from under us (a concurrent
      // reconcile-confirmation call) — abort immediately. Do NOT call
      // rollback() here: reconcile already owns compensation for this
      // attempt (or will, by the time it inspects real state), and every
      // resource-mutating statement above was ITSELF ownership-fenced, so
      // nothing this attempt did after losing the fence could ever have
      // actually taken effect.
      return json(
        {
          error: 'CONFIRMATION_SUPERSEDED',
          detail: `This confirmation attempt lost ownership while ${err.atStep} — a concurrent admin reconciliation already took over. No further state was written by this attempt from that point on.`,
        },
        409
      );
    }
    const result = await rollback();
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
  const decisionToken = `dt_${cryptoRandomId()}`;
  const claim = await env.DB
    .prepare(`INSERT OR IGNORE INTO deal_decision_claims (request_id, decision, claimed_at, attempt_token) SELECT ?, 'DECLINE', ?, ? WHERE EXISTS (SELECT 1 FROM deal_requests WHERE request_id = ? AND status = 'REQUESTED')`)
    .bind(requestId, now, decisionToken, requestId)
    .run();
  if (claim.meta.changes !== 1) {
    return json(interruptedOrAlreadyDecidedResponse(await describeStuckClaim(env, requestId)), 409);
  }

  try {
    const result = await env.DB
      .prepare(`UPDATE deal_requests SET status = 'DECLINED', decided_by = ?, decided_at = ?, updated_at = ? WHERE request_id = ? AND status = 'REQUESTED' AND EXISTS (SELECT 1 FROM deal_decision_claims WHERE request_id = ? AND attempt_token = ? AND decision = 'DECLINE')`)
      .bind('marau-ops-preview', now, now, requestId, requestId, decisionToken)
      .run();
    if (result.meta.changes !== 1) {
      // Shouldn't happen given the checks above, but stay honest if it does.
      await env.DB.prepare('DELETE FROM deal_decision_claims WHERE request_id = ? AND attempt_token = ?').bind(requestId, decisionToken).run();
      return json({ error: 'ALREADY_DECIDED', current_status: (await env.DB.prepare('SELECT status FROM deal_requests WHERE request_id = ?').bind(requestId).first()).status }, 409);
    }
    return json({ request_id: requestId, status: 'DECLINED' });
  } catch (err) {
    // Nothing else was touched by a decline — freeing the claim is the
    // whole rollback.
    await env.DB.prepare('DELETE FROM deal_decision_claims WHERE request_id = ? AND attempt_token = ?').bind(requestId, decisionToken).run();
    return json({ error: 'DECLINE_FAILED', detail: 'Could not record the decline — safe to retry.' }, 500);
  }
}

/**
 * Recovery owns a replaceable token, but resource/journal identity remains
 * the original journal_attempt_id. Every write checks the current owner in
 * the same SQL statement. CONFIRMED is the commit boundary in both paths;
 * audit failures after it are repair work, never compensation work.
 */
async function handleAdminReconcileConfirmation(env, requestId) {
  const request = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requestId).first();
  if (!request) return json({ error: 'deal request not found' }, 404);
  const claim = await env.DB.prepare('SELECT * FROM deal_decision_claims WHERE request_id = ?').bind(requestId).first();
  const superseded = () => json({ resolved: 'ATTEMPT_STILL_ACTIVE', detail: 'A conditional recovery write did not apply. Re-read the current decision and owner before retrying; this call stopped writing.' }, 409);
  const journalId = claim?.journal_attempt_id;

  async function writeJournal(token, phase, error, expectedStatus) {
    if (!journalId) return false;
    const result = await env.DB.prepare(`UPDATE confirmation_attempts SET phase = ?, error_detail = ?, updated_at = ?
      WHERE attempt_id = ? AND request_id = ? AND EXISTS (
        SELECT 1 FROM deal_decision_claims c JOIN deal_requests r ON r.request_id = c.request_id
        WHERE c.request_id = ? AND c.attempt_token IS ? AND c.journal_attempt_id = confirmation_attempts.attempt_id
          AND r.status = ?)
    `).bind(phase, error ?? null, nowIso(), journalId, requestId, requestId, token, expectedStatus).run();
    if (result.meta.changes !== 1) throw new Error('AUDIT_WRITE_NOT_APPLIED_OR_SUPERSEDED');
    return true;
  }
  async function finishAudit(token, status) {
    try {
      const repaired = await writeJournal(token, status === 'CONFIRMED' ? 'DONE' : 'ROLLED_BACK', null, status);
      return repaired ? { audit_repaired: true } : { audit_warning: 'Terminal decision is intact; original journal identity is unavailable and needs review.' };
    } catch (err) {
      return { audit_warning: `Terminal decision is intact; audit repair remains outstanding: ${err.message}` };
    }
  }

  if (request.status !== 'REQUESTED') {
    // No resources may be changed after the authoritative terminal write.
    return json({ resolved: 'ALREADY_TERMINAL', status: request.status,
      ...(claim ? await finishAudit(claim.attempt_token, request.status) : {}) });
  }
  if (!claim) return json({ resolved: 'NOTHING_TO_RECONCILE' });

  const recoveryToken = `rt_${cryptoRandomId()}`;
  const takeover = await env.DB.prepare(`UPDATE deal_decision_claims SET attempt_token = ?
    WHERE request_id = ? AND attempt_token IS ? AND journal_attempt_id IS ?
      AND EXISTS (SELECT 1 FROM deal_requests WHERE request_id = ? AND status = 'REQUESTED')
  `).bind(recoveryToken, requestId, claim.attempt_token, journalId ?? null, requestId).run();
  if (takeover.meta.changes !== 1) return superseded();

  const ownership = { requestId, attemptToken: recoveryToken };
  const fencedStore = createOwnershipFencedStore(env, requestId, recoveryToken);
  async function release() {
    const result = await env.DB.prepare(`DELETE FROM deal_decision_claims
      WHERE request_id = ? AND attempt_token = ? AND EXISTS (
        SELECT 1 FROM deal_requests WHERE request_id = ? AND status = 'REQUESTED')
    `).bind(requestId, recoveryToken, requestId).run();
    return result.meta.changes === 1;
  }
  async function inspect() {
    const offer = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(request.offer_id).first();
    const movements = (await env.DB.prepare('SELECT * FROM vehicle_time_claims WHERE claimed_by_request_id = ?').bind(requestId).all()).results;
    const allocations = (await env.DB.prepare("SELECT * FROM vehicle_allocations WHERE subject_type = 'DEAL_REQUEST' AND subject_id = ?").bind(requestId).all()).results;
    const ownsOffer = Boolean(offer && journalId && offer.marau_attempt_id === journalId);
    // Legacy/unattributed held resources must not be inferred to be ours.
    const unknownOffer = Boolean(offer && ['HELD', 'FILLED'].includes(offer.status) && !offer.marau_attempt_id);
    return { offer, movements, allocations, ownsOffer, unknownOffer };
  }
  async function fail(detail) {
    if (!(await stillOwnsAttempt(env, requestId, recoveryToken))) return superseded();
    let auditWarning;
    try {
      const exists = journalId && await env.DB.prepare('SELECT 1 FROM confirmation_attempts WHERE attempt_id = ? AND request_id = ?').bind(journalId, requestId).first();
      if (exists) await writeJournal(recoveryToken, 'ROLLBACK_FAILED', detail, 'REQUESTED');
    } catch (err) { auditWarning = err.message; }
    return json({ resolved: 'RECONCILIATION_FAILED', reconciliation_needed: true, detail,
      ...(auditWarning ? { audit_warning: auditWarning } : {}) }, 500);
  }
  try {
    if (claim.decision === 'DECLINE') {
      const done = await env.DB.prepare(`UPDATE deal_requests SET status = 'DECLINED', decided_by = ?, decided_at = ?, updated_at = ?
        WHERE request_id = ? AND status = 'REQUESTED' AND EXISTS (
          SELECT 1 FROM deal_decision_claims WHERE request_id = ? AND attempt_token = ? AND decision = 'DECLINE')
      `).bind('marau-ops-preview (reconciled)', nowIso(), nowIso(), requestId, requestId, recoveryToken).run();
      // Retain terminal ownership, just as normal confirm/decline do.
      return done.meta.changes === 1 ? json({ resolved: 'DECLINED' }) : superseded();
    }

    const before = await inspect();
    if (before.ownsOffer && before.offer.status === 'FILLED' && before.movements.length === 1 && before.allocations.length === 1) {
      // Check resources again in the decisive statement, not only in the
      // earlier snapshot. A superseded reconciler cannot commit stale state.
      const done = await env.DB.prepare(`UPDATE deal_requests SET status = 'CONFIRMED', decided_by = ?, decided_at = ?, updated_at = ?
        WHERE request_id = ? AND status = 'REQUESTED' AND EXISTS (
          SELECT 1 FROM deal_decision_claims c JOIN smart_offers o ON o.offer_id = deal_requests.offer_id
          WHERE c.request_id = deal_requests.request_id AND c.attempt_token = ?
            AND c.journal_attempt_id = o.marau_attempt_id AND o.status = 'FILLED'
            AND EXISTS (SELECT 1 FROM vehicle_time_claims m WHERE m.claimed_by_request_id = c.request_id
              AND m.claimed_by_offer_id = o.offer_id AND m.source_movement_id = o.source_movement_id)
            AND EXISTS (SELECT 1 FROM vehicle_allocations a WHERE a.subject_type = 'DEAL_REQUEST' AND a.subject_id = c.request_id))
      `).bind('marau-ops-preview (reconciled)', nowIso(), nowIso(), requestId, recoveryToken).run();
      if (done.meta.changes !== 1) return superseded();
      // COMMITTED: finishAudit catches failures; no compensation follows.
      return json({ resolved: 'CONFIRMED', ...await finishAudit(recoveryToken, 'CONFIRMED') });
    }

    const failures = [];
    if (before.ownsOffer && ['HELD', 'FILLED'].includes(before.offer.status)) {
      try {
        const undone = await fencedStore.casOfferStatus(before.offer.offer_id, before.offer.status, 'ACTIVE');
        if (!undone.success) failures.push('offer compensation did not match ownership/state');
      } catch (err) { failures.push(`offer: ${err.message}`); }
    }
    for (const allocation of before.allocations) {
      try {
        const undone = await releaseVehicleAllocation(env, allocation.allocation_id, ownership);
        if (!undone.released) failures.push('allocation compensation did not match ownership');
      } catch (err) { failures.push(`allocation: ${err.message}`); }
    }
    for (const movement of before.movements) {
      try {
        const undone = await env.DB.prepare(`DELETE FROM vehicle_time_claims
          WHERE source_movement_id = ? AND claimed_by_offer_id = ? AND claimed_by_request_id = ?
            AND EXISTS (SELECT 1 FROM deal_decision_claims c JOIN deal_requests r ON r.request_id = c.request_id
              WHERE c.request_id = ? AND c.attempt_token = ? AND r.status = 'REQUESTED')
        `).bind(movement.source_movement_id, movement.claimed_by_offer_id, requestId, requestId, recoveryToken).run();
        if (undone.meta.changes !== 1) failures.push('movement compensation did not match ownership');
      } catch (err) { failures.push(`movement: ${err.message}`); }
    }
    if (!(await stillOwnsAttempt(env, requestId, recoveryToken))) return superseded();
    const after = await inspect();
    if (after.unknownOffer) failures.push('offer ownership is unproven; manual reconciliation required');
    if (after.ownsOffer || after.allocations.length || after.movements.length) failures.push('owned resources remain');
    if (failures.length) return fail(failures.join('; '));

    // Journal FIRST, claim release LAST. If the audit fails, the durable
    // identity stays discoverable for the next recovery even with no resources.
    const attempt = journalId && await env.DB.prepare('SELECT 1 FROM confirmation_attempts WHERE attempt_id = ? AND request_id = ?').bind(journalId, requestId).first();
    if (attempt) await writeJournal(recoveryToken, 'ROLLED_BACK', null, 'REQUESTED');
    if (!(await release())) return superseded();
    return json({ resolved: 'ROLLED_BACK_TO_REQUESTED' });
  } catch (err) {
    return fail(err.message);
  }
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
// Reused by worker/real_booking_sync.js (round 13) — the real-booking
// sync path deliberately calls the SAME verified-ownership session
// functions a guest's own booking submission uses, rather than
// re-implementing (and risking drifting from) that security model. See
// real_booking_sync.js's own header for why: a round-12 proposal to
// "look up or create a session by phone" would have silently reintroduced
// the exact P0 vulnerability createSessionAndOfferLink's own comment
// above documents and fixed (a matching phone number must never itself
// return an existing session's access token).
// ---------------------------------------------------------------------
export { createGuestSession, createSessionAndOfferLink, requireGuestSession, nowIso, normalizePhone };

// ---------------------------------------------------------------------
// Round 19 — hosted synthetic-source acceptance harness for
// worker/real_booking_sync.js. Test-only, admin-token gated, isolated to
// this preview's own D1. `marau_synthetic_source_bookings` (migration
// 0030) is a stand-in for the real `bookings` table that ops can
// seed/mutate over HTTP to demonstrate the sync module's injected-reader
// contract against the LIVE hosted Worker/D1 — the same demonstration
// the local test suite already does in-memory, now reachable over the
// network for hosted acceptance evidence. No production database
// binding of any kind. See docs/MARAU_STAGE1_HOSTED_SYNC_ACCEPTANCE.md.
// ---------------------------------------------------------------------

async function syntheticSourceReader(env, sourceBookingRef) {
  const row = await env.DB.prepare('SELECT * FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(sourceBookingRef).first();
  if (!row) return null;
  return {
    id: row.source_id,
    source_booking_ref: row.source_booking_ref,
    guest_email: row.guest_email,
    guest_phone: row.guest_phone,
    whatsapp_available: row.whatsapp_available === 1 ? true : row.whatsapp_available === 0 ? false : null,
    pickup_zone: row.pickup_zone,
    destination_zone: row.destination_zone,
    vehicle_type: row.vehicle_type,
    pickup_date: row.pickup_date,
    pickup_time: row.pickup_time,
    quoted_amount: row.quoted_amount,
    assigned_driver_id: row.assigned_driver_id,
    status: row.status,
  };
}

function syncDeps(env) {
  return { createGuestSession, createSessionAndOfferLink, nowIso, normalizePickupDatetime, reader: (ref) => syntheticSourceReader(env, ref) };
}

async function handleAdminSeedSyntheticSource(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const required = ['source_booking_ref', 'id', 'guest_email', 'guest_phone', 'pickup_zone', 'destination_zone', 'vehicle_type', 'pickup_date', 'pickup_time', 'status'];
  const missing = required.filter((f) => body[f] == null);
  if (missing.length) return json({ error: 'missing required fields', missing }, 400);

  const now = nowIso();
  await env.DB
    .prepare(
      `INSERT INTO marau_synthetic_source_bookings
        (source_booking_ref, source_id, guest_email, guest_phone, whatsapp_available, pickup_zone, destination_zone, vehicle_type, pickup_date, pickup_time, quoted_amount, assigned_driver_id, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_booking_ref) DO UPDATE SET
         source_id = excluded.source_id, guest_email = excluded.guest_email, guest_phone = excluded.guest_phone,
         whatsapp_available = excluded.whatsapp_available, pickup_zone = excluded.pickup_zone, destination_zone = excluded.destination_zone,
         vehicle_type = excluded.vehicle_type, pickup_date = excluded.pickup_date, pickup_time = excluded.pickup_time,
         quoted_amount = excluded.quoted_amount, assigned_driver_id = excluded.assigned_driver_id, status = excluded.status, updated_at = excluded.updated_at`
    )
    .bind(
      body.source_booking_ref,
      body.id,
      body.guest_email,
      body.guest_phone,
      body.whatsapp_available === true ? 1 : body.whatsapp_available === false ? 0 : null,
      body.pickup_zone,
      body.destination_zone,
      body.vehicle_type,
      body.pickup_date,
      body.pickup_time,
      body.quoted_amount ?? null,
      body.assigned_driver_id ?? null,
      body.status,
      now
    )
    .run();

  return json({ ok: true, source_booking_ref: body.source_booking_ref, demonstration_data: true });
}

async function handleAdminSyncEvent(request, env, sourceBookingRef) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const result = await syncRealBookingEvent(env, sourceBookingRef, body, syncDeps(env));

  // Round 21 correction: the approved staff "Review and confirm"
  // workflow concerns the INITIAL TRANSFER RESERVATION, not only an
  // additional Marau deal request. The moment a real booking first
  // lands (result.created === true — the "initial transfer reservation
  // saved" step), mint a booking-scoped review token and return a mock
  // staff alert alongside it. This response is only ever seen by the
  // caller of this ALREADY admin-token-gated endpoint — never the guest
  // (the guest's own access comes back from a completely different call
  // chain, requireGuestSession-gated, and never sees this token; see
  // handleRequestDeal's own P0 fix for the equivalent guarantee on the
  // deal-request path).
  if (result.ok && result.created) {
    const reviewToken = await mintStaffReviewToken(env, 'booking', sourceBookingRef);
    return json(
      {
        ...result,
        mock_staff_alert: {
          message: `New transfer reservation ${sourceBookingRef} awaiting confirmation. Reply or tap the review link to confirm once vehicle/driver is arranged.`,
          review_link: `${new URL(request.url).origin}/preview/staff/review?token=${reviewToken.token}`,
        },
        demonstration_data: true,
      },
      200
    );
  }

  return json({ ...result, demonstration_data: true }, result.ok ? 200 : 409);
}

async function handleAdminReconcile(request, env, sourceBookingRef) {
  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const result = await reconcileRealBooking(env, sourceBookingRef, { snapshotSequence: body.snapshot_sequence, deps: syncDeps(env) });
  return json({ ...result, demonstration_data: true }, result.ok ? 200 : 409);
}

async function handleAdminGetSyntheticSourceState(env, sourceBookingRef) {
  const source = await env.DB.prepare('SELECT * FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(sourceBookingRef).first();
  const mirror = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ? AND source_sync_owned = 1').bind(sourceBookingRef).first();
  const link = await env.DB.prepare('SELECT * FROM marau_real_booking_links WHERE source_booking_ref = ?').bind(sourceBookingRef).first();
  const claim = await env.DB.prepare('SELECT * FROM marau_real_booking_sync_claims WHERE source_booking_ref = ?').bind(sourceBookingRef).first();
  return json({ source, mirror, link, claim, demonstration_data: true });
}

// ---------------------------------------------------------------------
// Round 27 — the next bounded integration slice from
// docs/MARAU_STAGE1_PRODUCTION_RELEASE_PACKAGE.md §1c: a staff
// confirmation that reaches an AUTHORITATIVE SOURCE via an API-CLIENT
// SHAPED call (mirroring what a real, authenticated HTTP call to
// nadi-dispatch-api's own admin-gated confirm endpoint looks like —
// verified against its real source this round: `requireAdmin`, a
// compare-and-swap UPDATE, a 409 with the current row on conflict,
// exactly reproduced below), NOT the direct, same-process D1 UPDATE
// rounds 19-22's `handleStaffDecideBooking` already proved. See
// worker/source_confirm.js's own header for why this is a genuinely
// different, additional failure class (a response can be lost AFTER
// the source has already committed) that a direct UPDATE cannot
// exercise, and why the fix (a durable local outcome ledger + a
// read-before-deciding recovery rule) lives there, reusable by any
// future caller.
//
// This demonstration client still writes to `marau_synthetic_source_bookings`
// (the same isolated stand-in table rounds 19-22 already use) — the
// point of this round is the CLIENT'S SHAPE and the CALLER'S recovery
// logic, both of which carry over unchanged to a real HTTP client
// later; only `syntheticSourceApiClient` itself would be swapped out.
// `simulate_response_loss` is a request-body-level test hook (not an
// env var), admin-token-gated same as every other demonstration
// endpoint here, and reproduces the critical case named in the mission:
// the write commits, then the caller never learns the outcome.
// ---------------------------------------------------------------------

function syntheticSourceApiClient(env, { simulateResponseLoss = false } = {}) {
  return {
    async getReservation(sourceBookingRef) {
      const row = await env.DB.prepare('SELECT status, assigned_driver_id FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(sourceBookingRef).first();
      return row || null;
    },
    async confirmReservation(sourceBookingRef, { driverId }) {
      // Mirrors the REAL nadi-dispatch-api handleAdminManualAssign
      // "Path A" exactly, verified this round by reading its actual
      // deployed source: a compare-and-swap UPDATE, guarded on
      // status='pending' AND assigned_driver_id IS NULL, changes===1
      // is the only proof of a genuine win.
      const now = nowIso();
      const result = await env.DB
        .prepare(`UPDATE marau_synthetic_source_bookings SET status = 'accepted', assigned_driver_id = ?, updated_at = ? WHERE source_booking_ref = ? AND status = 'pending' AND assigned_driver_id IS NULL`)
        .bind(String(driverId), now, sourceBookingRef)
        .run();
      const won = result.meta.changes === 1;

      // The write above has ALREADY committed by this point, exactly
      // like the real system's own compare-and-swap UPDATE — dropping
      // the response now is the critical case: a genuine commit whose
      // caller never learns the outcome, not a failed write.
      if (won && simulateResponseLoss) throw new Error('SIMULATED_RESPONSE_LOSS_AFTER_COMMIT');

      const current = await env.DB.prepare('SELECT status, assigned_driver_id FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(sourceBookingRef).first();
      return { won, current };
    },
  };
}

async function handleAdminSourceApiConfirm(request, env, sourceBookingRef) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const { driver_id: driverId, operator, simulate_response_loss: simulateResponseLoss } = body;
  if (driverId == null) return json({ error: 'driver_id is required' }, 400);
  if (!operator || !String(operator).trim()) return json({ error: 'operator name/initials are required to record this decision' }, 400);

  const client = syntheticSourceApiClient(env, { simulateResponseLoss: Boolean(simulateResponseLoss) });
  const confirmResult = await confirmReservationAtSource(env, client, {
    sourceBookingRef,
    driverId,
    operator: String(operator).trim(),
    nowIso,
  });

  // Authoritative outcome recovery -> refreshed guest Trip: reuse the
  // EXISTING, unmodified sync module, called immediately rather than
  // waiting for the next reconciliation tick, so the guest's own Trip
  // reflects reality right away. A confirm outcome of 'conflict' still
  // syncs — the source's own true current state (whoever actually won)
  // is exactly what the guest should see.
  const syncResult = confirmResult.ok || confirmResult.outcome === 'conflict'
    ? await syncAfterBookingConfirmation(env, sourceBookingRef)
    : null;

  return json({ ...confirmResult, sync: syncResult, demonstration_data: true }, confirmResult.ok ? 200 : confirmResult.outcome ? 409 : 422);
}

// ---------------------------------------------------------------------
// Round 19 — staff "Review and confirm" link. A booking/deal-specific
// token (migration 0029), meant to be carried inside the EXISTING
// detailed WhatsApp alert (still fully mocked here — no real send).
// Opening the link (GET) never confirms anything; it only ever renders
// the current state and a form. Only the explicit POST decides, and it
// does so by calling the SAME existing admin handlers
// (handleAdminConfirmDealRequest / handleAdminDeclineDealRequest) —
// reusing existing staff functionality rather than duplicating it.
//
// P0 FIX (round 20): the review token alone used to be sufficient to
// decide — but round 19 also (wrongly) returned that same token directly
// to the GUEST who created the request, which meant mere possession of
// "a token" proved nothing about being staff. Even independent of that
// leak, a capability token that rides inside a message is inherently
// forwardable/screenshottable, so requiring only it to DECIDE (an
// irreversible, money-adjacent action) was never sufficient on its own.
// The token still scopes VIEWING to exactly one subject (GET, read-only,
// unauthenticated beyond the token — no risk in showing route/price
// again to whoever has the link). DECIDING now additionally requires
// real staff authentication — the same admin bearer token every other
// admin action in this preview already requires — presented either as
// a normal `Authorization: Bearer` header (API/admin-console use) or as
// an `admin_token` form field (the plain HTML page below, which cannot
// set a custom header from a bare <form> POST). The review token is
// never itself a general admin credential and never was.
//
// CORRECTED SCOPE (round 21): the approved workflow concerns the
// INITIAL TRANSFER RESERVATION (a real booking, synced via
// worker/real_booking_sync.js) — not only an additional Marau "deal
// request", which is how rounds 19/20 had scoped it. `subject_type`
// (migration 0031) is now 'deal_request' OR 'booking'; a booking
// subject's token is minted automatically the moment a real reservation
// first lands (handleAdminSyncEvent, result.created === true — the
// mock "staff booking alert" moment), and deciding it records an
// "explicit operational confirmation" in the SYNTHETIC SOURCE (never a
// direct write to the Marau mirror — the mirror only ever updates via
// the sync module's own fresh read, exactly as every correction since
// round 17 requires), then syncs so the guest's Trip reflects it.
// Confirming a reservation additionally requires a driver/vehicle to
// already be on record (mirrors handleAdminDecideBooking's own
// existing rule for ordinary bookings) and, per requirement 4, records
// the deciding `operator` (a plain staff-supplied label — this preview
// has no per-operator login; see migration 0031's own header for why
// that is not "inventing a new identity platform"). A review token's
// `subject_id` is NEVER client-suppliable at decide time — only ever
// the value already stored on the loaded, validated token row — which
// is what prevents a decision from ever being pointed at the wrong
// subject.
// ---------------------------------------------------------------------

const STAFF_REVIEW_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h — a real alert should be actioned well within this

async function mintStaffReviewToken(env, subjectType, subjectId) {
  const token = `review_${cryptoRandomId()}`;
  const now = nowIso();
  const expiresAt = new Date(Date.now() + STAFF_REVIEW_TOKEN_TTL_MS).toISOString();
  await env.DB
    .prepare('INSERT INTO marau_staff_review_tokens (token, subject_type, subject_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(token, subjectType, subjectId, now, expiresAt)
    .run();
  return { token, expires_at: expiresAt };
}

async function loadValidReviewToken(env, token) {
  if (!token) return null;
  const row = await env.DB.prepare('SELECT * FROM marau_staff_review_tokens WHERE token = ?').bind(token).first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}

// GET — never mutates anything. Renders the current subject state (a
// deal request OR, per the round-21 correction, the initial transfer
// reservation itself) and a plain HTML form.
async function handleStaffReviewPage(env, token) {
  const reviewToken = await loadValidReviewToken(env, token);
  if (!reviewToken) return html('<!doctype html><html><body><p>This review link is invalid or has expired. Ask ops to resend the alert.</p></body></html>', 404);

  if (reviewToken.subject_type === 'booking') return handleStaffReviewBookingPage(env, token, reviewToken);

  const dealRequest = await env.DB
    .prepare(
      `SELECT dr.request_id, dr.status, dr.requested_price, dr.created_at,
              o.origin_zone, o.destination_zone, o.vehicle_class, o.smart_match_price, o.standard_price
       FROM deal_requests dr JOIN smart_offers o ON o.offer_id = dr.offer_id
       WHERE dr.request_id = ?`
    )
    .bind(reviewToken.subject_id)
    .first();
  if (!dealRequest) return html('<!doctype html><html><body><p>This request no longer exists.</p></body></html>', 404);

  const price = dealRequest.smart_match_price ?? dealRequest.standard_price ?? dealRequest.requested_price;
  const already = dealRequest.status !== 'REQUESTED';
  const body = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Marau — Review request (PREVIEW)</title></head>
<body style="font-family:system-ui;max-width:480px;margin:24px auto;padding:0 16px;">
  <p style="color:#b45309;font-weight:600;">PREVIEW / DEMONSTRATION DATA — mocked staff review link, no real WhatsApp involved.</p>
  <h1>Review request ${dealRequest.request_id}</h1>
  <p><strong>Route:</strong> ${dealRequest.origin_zone} → ${dealRequest.destination_zone}</p>
  <p><strong>Vehicle:</strong> ${dealRequest.vehicle_class}</p>
  <p><strong>Price:</strong> FJ$${Number(price).toFixed(2)}</p>
  <p><strong>Current status:</strong> ${dealRequest.status}</p>
  ${already
    ? `<p>This request has already been decided (${dealRequest.status}). No further action is needed.</p>`
    : staffDecisionForm(token, ['confirm', 'decline'])}
</body></html>`;
  return html(body);
}

// Round 21 correction: the PRIMARY subject of this workflow — a real
// booking (the initial transfer reservation) synced via
// worker/real_booking_sync.js. Shows the CURRENT synthetic-source state
// (never a cached/guest-facing copy) and, only for this subject, the
// vehicle/driver fact staff must have arranged before confirming.
async function handleStaffReviewBookingPage(env, token, reviewToken) {
  const source = await env.DB.prepare('SELECT * FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(reviewToken.subject_id).first();
  if (!source) return html('<!doctype html><html><body><p>This reservation no longer exists.</p></body></html>', 404);

  const already = source.status !== 'pending';
  const driverAssigned = Boolean(source.assigned_driver_id);
  const body = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Marau — Review reservation (PREVIEW)</title></head>
<body style="font-family:system-ui;max-width:480px;margin:24px auto;padding:0 16px;">
  <p style="color:#b45309;font-weight:600;">PREVIEW / DEMONSTRATION DATA — mocked staff review link, no real WhatsApp involved.</p>
  <h1>Review reservation ${reviewToken.subject_id}</h1>
  <p><strong>Route:</strong> ${source.pickup_zone} → ${source.destination_zone}</p>
  <p><strong>Vehicle:</strong> ${source.vehicle_type}</p>
  <p><strong>Pickup:</strong> ${source.pickup_date} ${source.pickup_time}</p>
  <p><strong>Driver assigned:</strong> ${driverAssigned ? source.assigned_driver_id : 'NOT YET ASSIGNED — confirmation will be refused until a driver/vehicle is on record'}</p>
  <p><strong>Current status:</strong> ${source.status}</p>
  ${already
    ? `<p>This reservation has already been decided (${source.status}). No further action is needed.</p>`
    : staffDecisionForm(token, ['confirm'])}
</body></html>`;
  return html(body);
}

function staffDecisionForm(token, decisions) {
  const buttons = decisions.map((d) => `<button name="decision" value="${d}" style="flex:1;padding:12px;font-size:16px;">${d === 'confirm' ? 'Confirm' : 'Decline'}</button>`).join('');
  return `<form method="POST" action="/preview/staff/review/decide" style="display:flex;flex-direction:column;gap:12px;margin-top:16px;">
        <input type="hidden" name="token" value="${token}">
        <label style="font-size:14px;color:#374151;">Staff token (required to decide)
          <input type="password" name="admin_token" required style="display:block;width:100%;padding:10px;font-size:16px;margin-top:4px;">
        </label>
        <label style="font-size:14px;color:#374151;">Your name/initials (recorded against this decision)
          <input type="text" name="operator" required style="display:block;width:100%;padding:10px;font-size:16px;margin-top:4px;">
        </label>
        <div style="display:flex;gap:12px;">${buttons}</div>
      </form>
      <p style="color:#6b7280;font-size:13px;margin-top:12px;">Opening this page has not decided anything. Only submitting the form above, with a valid staff token, does.</p>`;
}

async function handleStaffReviewDecide(request, env) {
  const contentType = request.headers.get('content-type') || '';
  let token;
  let decision;
  let adminTokenField;
  let operator;
  if (contentType.includes('application/json')) {
    const body = await request.json().catch(() => ({}));
    token = body.token;
    decision = body.decision;
    adminTokenField = body.admin_token;
    operator = body.operator;
  } else {
    const form = await request.formData();
    token = form.get('token');
    decision = form.get('decision');
    adminTokenField = form.get('admin_token');
    operator = form.get('operator');
  }

  // P0 FIX (round 20): possession of the review token alone is NO LONGER
  // sufficient to decide. Real staff authentication (the admin bearer
  // token, presented via the ordinary Authorization header OR this
  // form's own admin_token field) is required in addition. The review
  // token still scopes which ONE subject this call may act on — it is
  // checked first purely to give a precise "invalid/expired link" error
  // before an auth error, and is NEVER itself treated as proof of staff
  // identity. This is the SAME protected staff mechanism every other
  // admin action in this preview already uses — no new identity
  // platform is introduced.
  const reviewToken = await loadValidReviewToken(env, token);
  if (!reviewToken) return json({ error: 'invalid or expired review token' }, 401);

  const isStaffAuthenticated = requireAdmin(request, env) || (Boolean(env.MARAU_ADMIN_TEST_TOKEN) && adminTokenField === env.MARAU_ADMIN_TEST_TOKEN);
  if (!isStaffAuthenticated) return json({ error: 'unauthorized — staff authentication required to decide' }, 401);

  // Round 21, requirement 4: record the authorised operator responsible
  // for the decision — a plain, staff-supplied identifying label (this
  // preview has no per-operator login), required and stored alongside
  // the shared admin-token check above, never a substitute for it.
  if (!operator || !String(operator).trim()) return json({ error: 'operator name/initials are required to record this decision' }, 400);

  if (reviewToken.subject_type === 'booking') return handleStaffDecideBooking(env, reviewToken, decision, String(operator).trim());

  if (decision !== 'confirm' && decision !== 'decline') return json({ error: "decision must be 'confirm' or 'decline'" }, 400);

  // Reuses the EXISTING admin handlers exactly — this token authorizes
  // ONLY this one call, on this one subject (reviewToken.subject_id —
  // NEVER a client-supplied id, which is what prevents this from ever
  // being pointed at the wrong subject); it grants no broader access.
  const result =
    decision === 'confirm'
      ? await handleAdminConfirmDealRequest(env, reviewToken.subject_id)
      : await handleAdminDeclineDealRequest(env, reviewToken.subject_id);
  if (result.status === 200) {
    await recordStaffDecision(env, { token: reviewToken.token, subjectType: 'deal_request', subjectId: reviewToken.subject_id, decision, operator });
  }
  return result;
}

// Round 21 correction — the PRIMARY subject: an "explicit operational
// confirmation" of the initial transfer reservation, recorded in the
// SYNTHETIC SOURCE (never a direct write to the Marau mirror — the
// mirror is only ever updated by the sync module's own fresh-read path,
// exactly like every other correction since round 17), followed by a
// sync so the guest's Trip reflects it. Only 'confirm' is supported for
// this subject — there is no real analogue of "decline" for a
// reservation that has already been saved.
//
// ROUND 22 FIX — the confirmation commit boundary. Codex reproduced:
// fault-inject INSERT on marau_staff_decisions, confirm a reservation —
// the source pending->accepted UPDATE and the guest-Trip sync had ALREADY
// committed by the time the (separate, THIRD) audit INSERT threw, but
// the caller received an uncaught 500 (a genuine confirmation reported
// as a failure), and a retry then hit ALREADY_DECIDED with the audit row
// permanently missing — no way to ever complete or even discover it.
//
// Corrected design, in three parts:
//   1. The authorised operator and decided-at timestamp are now written
//      DURABLY inside the SAME atomic, conditional UPDATE as the
//      source's own pending->accepted transition
//      (`confirmed_operator`/`confirmed_at`/`confirmation_token`,
//      migration 0032) — never a separate statement that could fail
//      independently of the transition it is meant to record. The
//      UPDATE's own WHERE clause re-checks `status = 'pending' AND
//      assigned_driver_id IS NOT NULL` atomically at write time (closing
//      the TOCTOU gap a separate SELECT-then-UPDATE would leave open),
//      and `meta.changes` is checked to know whether it actually applied.
//   2. Once that ONE atomic write succeeds, the source confirmation is
//      DONE and durable — nothing that happens afterward (the sync-
//      through, or the secondary marau_staff_decisions audit insert) is
//      ever allowed to surface as a top-level failure. Both are wrapped
//      and reported as their OWN sub-results
//      (`sync`/`audit`, distinguishing "source confirmation" from
//      "guest-sync completion" from "secondary audit logging" —
//      exactly as instructed) rather than letting either throw past this
//      function.
//   3. A retry that lands on an ALREADY-confirmed row (detected via the
//      durable `confirmed_operator` column, not merely `status !==
//      'pending'`, which could also mean something else entirely)
//      NEVER re-confirms and NEVER overwrites the original operator — it
//      idempotently REPAIRS whatever secondary work (sync, audit row)
//      didn't finish, reading the operator/timestamp to repair WITH from
//      the durably-stored source row, never from the retry call's own
//      (possibly different) `operator` argument.
async function handleStaffDecideBooking(env, reviewToken, decision, operator) {
  if (decision !== 'confirm') return json({ error: "only 'confirm' is supported for a reservation" }, 400);

  const sourceBookingRef = reviewToken.subject_id; // NEVER client-supplied — prevents confirming the wrong subject
  const now = nowIso();

  const updateResult = await env.DB
    .prepare(
      `UPDATE marau_synthetic_source_bookings
         SET status = 'accepted', confirmed_operator = ?, confirmed_at = ?, confirmation_token = ?, updated_at = ?
       WHERE source_booking_ref = ? AND status = 'pending' AND assigned_driver_id IS NOT NULL`
    )
    .bind(operator, now, reviewToken.token, now, sourceBookingRef)
    .run();

  if (updateResult.meta.changes === 0) {
    const current = await env.DB.prepare('SELECT * FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(sourceBookingRef).first();
    if (!current) return json({ error: 'reservation not found' }, 404);
    if (current.confirmed_operator) {
      // Genuinely already confirmed BY THIS WORKFLOW (proven by the
      // durable column the atomic UPDATE itself writes, not just an
      // arbitrary non-pending status) — repair only, never re-decide.
      return handleStaffBookingConfirmationRepair(env, current);
    }
    if (!current.assigned_driver_id) {
      return json({ error: 'DRIVER_NOT_ASSIGNED', detail: 'A vehicle/driver must be recorded before this reservation can be confirmed.' }, 409);
    }
    return json({ error: 'ALREADY_DECIDED', current_status: current.status }, 409);
  }

  // The source confirmation itself is DONE — everything below is
  // best-effort follow-through, each reported as its own sub-result,
  // never as a reason to fail this call.
  const syncResult = await syncAfterBookingConfirmation(env, sourceBookingRef);
  const auditResult = await recordStaffDecisionIfMissing(env, { token: reviewToken.token, subjectId: sourceBookingRef, operator, decidedAt: now });

  return json({ ok: true, source_booking_ref: sourceBookingRef, source_status: 'accepted', confirmed_operator: operator, sync: syncResult, audit: auditResult, demonstration_data: true });
}

// Repair path for a retry landing on an already (durably) confirmed
// reservation — reads what to repair WITH from the source row's own
// stored `confirmed_operator`/`confirmed_at`, never from this call's own
// arguments, so a retry can never silently substitute a different
// "authorised" operator for the one who actually made the decision.
async function handleStaffBookingConfirmationRepair(env, current) {
  const syncResult = await syncAfterBookingConfirmation(env, current.source_booking_ref);
  const auditResult = await recordStaffDecisionIfMissing(env, {
    token: current.confirmation_token,
    subjectId: current.source_booking_ref,
    operator: current.confirmed_operator,
    decidedAt: current.confirmed_at,
  });
  return json({
    ok: true,
    recovered: true,
    source_booking_ref: current.source_booking_ref,
    source_status: current.status,
    confirmed_operator: current.confirmed_operator,
    sync: syncResult,
    audit: auditResult,
    demonstration_data: true,
  });
}

// Sync-through: the guest's Trip is updated ONLY via the sync module's
// own fresh read of the source row — never a direct write here. Uses
// reconciliation (this is an ops-triggered refresh, not a discrete real
// booking_events row) with a wall-clock-derived monotonic sequence,
// documented as a preview-only simplification — see
// docs/MARAU_STAGE1_HOSTED_SYNC_ACCEPTANCE.md. Never allowed to throw
// past the caller — a sync failure is real and reported, but it must
// never be confused with the source confirmation itself failing (round
// 22, requirement 5: "distinguish source confirmation from guest-sync
// completion").
async function syncAfterBookingConfirmation(env, sourceBookingRef) {
  try {
    return await reconcileRealBooking(env, sourceBookingRef, { snapshotSequence: Date.now(), deps: syncDeps(env) });
  } catch (err) {
    return { ok: false, reason: 'SYNC_FAILED_AFTER_CONFIRMATION', detail: String(err && err.message) };
  }
}

// Secondary, best-effort audit log — the durable source of truth is
// already the source row's own confirmed_operator/confirmed_at
// (written atomically with the transition itself). This INSERT is
// idempotent (checked first) and never allowed to throw past the
// caller — a failure here must never be reported as the confirmation
// itself failing.
async function recordStaffDecisionIfMissing(env, { token, subjectId, operator, decidedAt }) {
  try {
    const existing = await env.DB.prepare(`SELECT 1 FROM marau_staff_decisions WHERE subject_type = 'booking' AND subject_id = ?`).bind(subjectId).first();
    if (existing) return { ok: true, already_recorded: true };
    await env.DB
      .prepare(`INSERT INTO marau_staff_decisions (token, subject_type, subject_id, decision, operator, decided_at) VALUES (?, 'booking', ?, 'confirm', ?, ?)`)
      .bind(token, subjectId, operator, decidedAt)
      .run();
    return { ok: true, already_recorded: false };
  } catch (err) {
    return { ok: false, reason: 'AUDIT_INSERT_FAILED', detail: String(err && err.message) };
  }
}

// Still used by the deal_request decide path (round 20/21, unchanged) —
// that path has no atomic-with-the-decision durable column to fall back
// on, so its own audit write staying best-effort/non-blocking is the
// smaller, sufficient fix; round 22's finding was specific to the
// booking-confirmation commit boundary.
async function recordStaffDecision(env, { token, subjectType, subjectId, decision, operator }) {
  try {
    await env.DB
      .prepare('INSERT INTO marau_staff_decisions (token, subject_type, subject_id, decision, operator, decided_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(token, subjectType, subjectId, decision, operator, nowIso())
      .run();
  } catch (err) {
    console.error('[marau-preview] deal_request staff-decision audit insert failed (non-fatal — decision already committed)', err);
  }
}

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------

export default {
  // FIX (round 19, found while wiring the synthetic-source hosted-demo
  // harness): every route below is now `return await handleFoo(...)`,
  // not a bare `return handleFoo(...)`. In an async function, `return
  // somePromise` from inside a try block does NOT route a later
  // rejection through that try's own catch — the promise is handed
  // straight to the caller of `fetch()` unhandled, bypassing this
  // router's own error handling entirely. This was a real, pre-existing
  // gap in every route, not just the new ones: the fault-injection tests
  // in earlier rounds always called the sync module directly (never
  // through this HTTP router), so nothing had ever exercised a genuine
  // thrown error reaching this `catch` over HTTP until this round's own
  // hosted-harness test did. `return await x` is otherwise behaviourally
  // identical to `return x` when nothing throws.
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

      if (method === 'POST' && pathname === '/preview/bookings') return await handleCreateBooking(request, env);
      if (method === 'GET' && pathname === '/preview/trip') return await handleGetTrip(request, env);
      if (method === 'POST' && pathname === '/preview/trip/revoke') return await handleRevokeTrip(request, env);
      if (method === 'POST' && pathname === '/preview/trip/whatsapp-handoff') return await handleTripWhatsappHandoff(request, env);

      if (method === 'GET' && pathname === '/preview/trip/link-requests') return await handleListLinkRequests(request, env);
      const revokeLinkMatch = pathname.match(/^\/preview\/trip\/link-requests\/([^/]+)\/revoke$/);
      if (method === 'POST' && revokeLinkMatch) return await handleRevokeLinkRequest(request, env, revokeLinkMatch[1]);
      if (method === 'POST' && pathname === '/preview/trip/link') return await handleConfirmLink(request, env);

      const changeReqMatch = pathname.match(/^\/preview\/bookings\/(\d+)\/change-request$/);
      if (method === 'POST' && changeReqMatch) return await handleChangeRequest(request, env, Number(changeReqMatch[1]));

      if (method === 'GET' && pathname === '/preview/deals') return await handleListDeals(env);
      const dealRequestMatch = pathname.match(/^\/preview\/deals\/([^/]+)\/request$/);
      if (method === 'POST' && dealRequestMatch) return await handleRequestDeal(request, env, dealRequestMatch[1]);

      if (method === 'POST' && pathname === '/preview/assist') return await handleAssist(request, env);

      // Round 19 — staff review link: token-gated, not admin-token-gated
      // (a review token authorizes exactly one subject, never broader
      // admin access). GET never mutates; only the POST decides.
      if (method === 'GET' && pathname === '/preview/staff/review') return await handleStaffReviewPage(env, url.searchParams.get('token'));
      if (method === 'POST' && pathname === '/preview/staff/review/decide') return await handleStaffReviewDecide(request, env);

      // ---- Admin routes: all require the test-only admin bearer token ----
      if (pathname.startsWith('/preview/admin/')) {
        if (!requireAdmin(request, env)) return json({ error: 'unauthorized — admin test token required' }, 401);

        // Round 19 — hosted synthetic-source acceptance harness (see
        // this file's own header comment above these handlers).
        if (method === 'POST' && pathname === '/preview/admin/synthetic-source') return await handleAdminSeedSyntheticSource(request, env);
        const syntheticStateMatch = pathname.match(/^\/preview\/admin\/synthetic-source\/([^/]+)$/);
        if (method === 'GET' && syntheticStateMatch) return await handleAdminGetSyntheticSourceState(env, decodeURIComponent(syntheticStateMatch[1]));
        const syntheticSyncMatch = pathname.match(/^\/preview\/admin\/synthetic-source\/([^/]+)\/sync-event$/);
        if (method === 'POST' && syntheticSyncMatch) return await handleAdminSyncEvent(request, env, decodeURIComponent(syntheticSyncMatch[1]));
        const syntheticReconcileMatch = pathname.match(/^\/preview\/admin\/synthetic-source\/([^/]+)\/reconcile$/);
        if (method === 'POST' && syntheticReconcileMatch) return await handleAdminReconcile(request, env, decodeURIComponent(syntheticReconcileMatch[1]));

        // Round 27 — the source-API-client-shaped confirm slice (see this
        // file's own header comment above handleAdminSourceApiConfirm).
        const sourceApiConfirmMatch = pathname.match(/^\/preview\/admin\/synthetic-source\/([^/]+)\/source-api-confirm$/);
        if (method === 'POST' && sourceApiConfirmMatch) return await handleAdminSourceApiConfirm(request, env, decodeURIComponent(sourceApiConfirmMatch[1]));

        if (method === 'GET' && pathname === '/preview/admin/deal-requests') return await handleAdminListDealRequests(request, env);
        const confirmMatch = pathname.match(/^\/preview\/admin\/deal-requests\/([^/]+)\/confirm$/);
        if (method === 'POST' && confirmMatch) return await handleAdminConfirmDealRequest(env, confirmMatch[1]);
        const declineMatch = pathname.match(/^\/preview\/admin\/deal-requests\/([^/]+)\/decline$/);
        if (method === 'POST' && declineMatch) return await handleAdminDeclineDealRequest(env, declineMatch[1]);
        const reconcileMatch = pathname.match(/^\/preview\/admin\/deal-requests\/([^/]+)\/reconcile-confirmation$/);
        if (method === 'POST' && reconcileMatch) return await handleAdminReconcileConfirmation(env, reconcileMatch[1]);

        if (method === 'GET' && pathname === '/preview/admin/bookings') return await handleAdminListBookings(env);
        const bookingDecisionMatch = pathname.match(/^\/preview\/admin\/bookings\/(\d+)\/(confirm|decline)$/);
        if (method === 'POST' && bookingDecisionMatch) return await handleAdminDecideBooking(env, Number(bookingDecisionMatch[1]), bookingDecisionMatch[2]);

        if (method === 'GET' && pathname === '/preview/admin/change-requests') return await handleAdminListChangeRequests(env);
        const changeDecisionMatch = pathname.match(/^\/preview\/admin\/change-requests\/([^/]+)\/(approve|reject)$/);
        if (method === 'POST' && changeDecisionMatch) return await handleAdminDecideChangeRequest(env, changeDecisionMatch[1], changeDecisionMatch[2]);
      }

      return json({ error: 'not found' }, 404);
    } catch (err) {
      console.error('[marau-preview] unhandled error', err);
      return json({ error: 'internal error', detail: String(err && err.message) }, 500);
    }
  },
};
