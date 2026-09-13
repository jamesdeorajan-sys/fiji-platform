/* Issue #54 Stage 1 (SHADOW MODE) — production adapter.
 *
 * Connects REAL confirmed bookings (from the real nadi-dispatch-api
 * `bookings` / `booking_events` tables — see
 * nadi-marketplace/worker/worker.js: createBookingRecord, logBookingEvent,
 * handleDriverAcceptBooking, handleAdminManualAssign) into the Smart Return
 * ledger, in READ/SHADOW mode only.
 *
 * This module makes NO network or database call itself — it is pure
 * mapping/validation logic over rows the caller already has. Whoever has
 * real D1 read access runs the query documented below and passes the rows
 * in; this module never needs production credentials of its own beyond the
 * shadow HMAC secret (see OPAQUE LINKAGE below), and is fully unit-tested
 * without touching anything live (see test/production_adapter.test.js).
 *
 * ── CEO SAFETY-CORRECTION ROUND (2026-09-14) ───────────────────────────
 * Four defects fixed from the prior version, all covered by the test file:
 *   1. Opaque linkage was an UNKEYED hash, and worse, the raw booking id /
 *      a `sourceSite:bookingId` string leaked directly into
 *      movement_id/idempotency_key/booking_reference regardless of the
 *      hash. Replaced with a single keyed HMAC-SHA-256 opaque reference
 *      (computeOpaqueBookingRef), reused consistently everywhere a
 *      booking-identifying string was needed, with NO fallback and NO
 *      hardcoded secret — see "fails closed" below.
 *   2. Fiji-local pickup_date/pickup_time were being read as if already
 *      UTC (naive `+ "Z"`). Replaced with a real Pacific/Fiji ->UTC
 *      instant conversion (zonedTimeToUtcIso), using only Intl (no new
 *      dependency), refined once around DST boundaries, and failing
 *      closed (null, never a guessed instant) on anything malformed.
 *   3. isHumanConfirmedBooking() checked event_type/new_status/actor but
 *      never that the event actually belongs to THIS booking. Added an
 *      explicit booking.id === bookingEvent.booking_id check (type-safe
 *      via String() on both sides, so a numeric-vs-string DB driver
 *      difference doesn't falsely reject a real match, but a genuine
 *      mismatch — including a different booking's real accept event —
 *      always fails).
 *   4. Failure results (and therefore the shadow report's skipped_bookings
 *      list) previously carried the raw booking.id. Every failure path
 *      now carries only the opaque shadowRef (computed wherever a secret
 *      is available, even for a booking that turns out not to be
 *      human-confirmed) or nothing at all when no ref could be computed.
 *
 * ── AUTHORITATIVE TRIGGER (Milestone 36, CORRECTED 2026-09-14) ──────────
 * CEO P0 correction: the trigger is NOT bookings.status. The mission's
 * first pass repurposed `bookings.status = 'human_confirmed'`, which was
 * rejected — bookings.status is load-bearing for the existing operational
 * driver-accept flow (handleDriverAcceptBooking/handleAdminManualAssign in
 * worker.js both do `WHERE ... AND status = 'pending'` compare-and-swap
 * UPDATEs), and overwriting it would have silently blocked any
 * human-confirmed booking from ever being accepted by a driver.
 *
 * The real trigger is now two ADDITIVE, orthogonal columns
 * (migrations/milestone36-human-confirmed-status.sql):
 *   bookings.human_confirmed_at  — non-null once confirmed, set exactly
 *     once by POST /admin/bookings/:id/human-confirm
 *     (handleAdminHumanConfirm() in worker.js) — admin-only
 *     (requireAdmin(), the same gate as every other /admin/* action),
 *     never reachable by a driver, a guest, or any automated process.
 *   bookings.human_confirmed_by  — always the literal 'admin'.
 * bookings.status is never read as a precondition and never written by
 * this action, in either direction — a booking can be human-confirmed
 * while still 'pending' (and go on to be accepted by a driver completely
 * normally afterward) or after it has already reached 'accepted'/
 * 'en_route'/'completed'/'cancelled'. Every human_confirmed booking_events
 * row this adapter will ever see has actor === 'admin' exactly — a
 * literal in the handler, never read from the request — so
 * HUMAN_ACTOR_PATTERN below matches only that, not the broader
 * driver:<id>|admin pattern the OLDER 'accepted' trigger needed. Its
 * new_status is always NULL (human confirmation never changes
 * bookings.status, so there is nothing to record as "new") —
 * isHumanConfirmedBooking() below does not check new_status at all.
 *
 * This deliberately replaces the earlier round's use of `bookings.status
 * = 'accepted'` (reached via handleDriverAcceptBooking or
 * handleAdminManualAssign) as the trigger. That older 'accepted' state
 * conflated two different real-world facts — "a driver/admin has been
 * operationally assigned to this job" and "a human has confirmed this
 * booking is genuinely happening and ready to be evaluated" — which
 * happened to always be true together for every path that set it, but
 * was never a purpose-built confirmation signal. human_confirmed is
 * additive on the backend — the old pending/accepted/en_route/completed/
 * cancelled operational lifecycle is completely untouched and still
 * exists in parallel for its own purpose; this adapter simply no longer
 * keys off it, and must never be keyed off pending, accepted,
 * assigned_driver_id, or any notification-sent signal.
 *
 * Never triggers on booking creation, a quote, a page view, or a
 * notification being sent — human_confirmed's own admin-only gate makes
 * that true by construction, same as before.
 *
 * ── OPAQUE LINKAGE ──────────────────────────────────────────────────────
 * computeOpaqueBookingRef(booking, sourceSite, shadowSecret) is
 *   HMAC-SHA-256(key = shadowSecret, message = "smart-return-booking-ref:v1:<sourceSite>:<booking.id>")
 * truncated to 32 hex chars (128 bits — ample collision resistance for an
 * internal join key) and prefixed `sr_`. Deterministic ONLY because it is
 * keyed — without the key, no one can compute or reverse it, and the same
 * booking id under a DIFFERENT key produces an unrelated value (see the
 * "different key -> different ref" test). `shadowSecret` is an injected
 * dependency (raw bytes, e.g. a Uint8Array) with NO default and NO
 * fallback: if absent, mapConfirmedBookingToMovementInput() returns
 * `{ ok: false, reason: 'SHADOW_SECRET_NOT_CONFIGURED' }` for every row
 * rather than inventing or hardcoding a key. The secret itself is never
 * read, logged, or included in any return value from this module.
 *
 * ── READ-ONLY SQL THIS ADAPTER IS DESIGNED AGAINST ─────────────────────
 * (documented, not executed by this module or by this branch — no D1
 * binding exists here)
 *
 *   SELECT b.*, be.actor, be.booking_id AS event_booking_id, be.created_at AS confirmed_at
 *   FROM bookings b
 *   JOIN booking_events be ON be.booking_id = b.id
 *   WHERE b.human_confirmed_at IS NOT NULL
 *     AND be.event_type = 'human_confirmed'
 *     AND be.actor = 'admin'
 *   ORDER BY be.created_at DESC;
 *
 * ── KNOWN GAP: THE REAL bookings TABLE HAS NO TRIP-DURATION FIELD ──────
 * createBookingRecord() never captures an estimated trip duration or
 * planned dropoff time. mapConfirmedBookingToMovementInput() therefore
 * never sets estimated_duration_minutes/planned_dropoff_datetime, so
 * matcher.js correctly reports operational_feasibility =
 * HOLD_UNKNOWN_TIMING for every candidate pairing rather than guessing
 * FEASIBLE. Working as designed, not a bug in this adapter.
 *
 * ── PRIVACY ─────────────────────────────────────────────────────────────
 * mapConfirmedBookingToMovementInput() never reads guest_name, guest_phone,
 * guest_email, flight_number, or notes off the real booking row into the
 * movement it produces. The only identifier carried through anywhere —
 * movement_id, idempotency_key, booking_reference, booking_contact_ref —
 * is the single opaque shadowRef described above; model.js's own
 * ingestion validation independently re-checks booking_contact_ref
 * doesn't look like an email or phone number.
 */
import { normalizeMovementInput } from './model.js';

// The event_type this adapter's trigger looks for — NOT a bookings.status
// value (there is no such status; see AUTHORITATIVE TRIGGER above).
export const HUMAN_CONFIRMED_EVENT_TYPE = 'human_confirmed';
export const SHADOW_REF_HMAC_DOMAIN = 'smart-return-booking-ref:v1';

const HUMAN_ACCEPT_EVENT_TYPE = HUMAN_CONFIRMED_EVENT_TYPE;
// handleAdminHumanConfirm() (worker.js) writes actor: 'admin' as a literal
// — always, never read from the request — and there is no driver/guest/
// cron route to this event type at all (see this file's AUTHORITATIVE
// TRIGGER header). Matching ONLY 'admin' here (not the broader
// driver:<id>|admin pattern the older 'accepted' trigger needed) means a
// human_confirmed event carrying any other actor — including a real
// driver:<id> — is treated as a spoofing/corruption signal and rejected,
// not accepted. A future automated actor (e.g. 'system' or 'cron') also
// deliberately does not match.
const HUMAN_ACTOR_PATTERN = /^admin$/;

// Zones the real bookings table uses to represent Nadi International
// Airport — used only to derive arrival_or_departure, never feasibility
// or pricing.
const AIRPORT_ZONE_IDENTIFIERS = new Set(['NAN', 'NADI_AIRPORT']);

const FIJI_TIME_ZONE = 'Pacific/Fiji';

/**
 * True only when ALL of the following real facts hold — deliberately NEVER
 * checks booking.status, assigned_driver_id, or any notification-sent
 * signal (see AUTHORITATIVE TRIGGER above):
 *   (a) booking.human_confirmed_at is non-null (the admin action ran and
 *       wrote its timestamp);
 *   (b) the supplied bookingEvent is a real human_confirmed event, i.e.
 *       event_type === 'human_confirmed';
 *   (c) it was actioned by admin (the only real actor this event type can
 *       ever have — HUMAN_ACTOR_PATTERN);
 *   (d) it actually belongs to THIS booking — proven by
 *       booking.id === bookingEvent.booking_id, compared as strings so a
 *       numeric-vs-string DB driver difference can't cause a false
 *       rejection, but never fuzzy/substring-matched.
 * new_status is deliberately not checked — the real handler always writes
 * it as NULL (human confirmation never changes bookings.status).
 */
export function isHumanConfirmedBooking(booking, bookingEvent) {
  if (!booking || booking.human_confirmed_at == null) return false;
  if (!bookingEvent) return false;
  if (bookingEvent.event_type !== HUMAN_ACCEPT_EVENT_TYPE) return false;
  if (typeof bookingEvent.actor !== 'string' || !HUMAN_ACTOR_PATTERN.test(bookingEvent.actor)) return false;
  if (booking.id == null || bookingEvent.booking_id == null) return false;
  if (String(booking.id) !== String(bookingEvent.booking_id)) return false;
  return true;
}

function normalizeKeyBytes(shadowSecret) {
  if (shadowSecret == null) return null;
  if (typeof shadowSecret === 'string') {
    if (shadowSecret.length === 0) return null;
    return new TextEncoder().encode(shadowSecret);
  }
  if (ArrayBuffer.isView(shadowSecret) || shadowSecret instanceof ArrayBuffer) {
    const bytes = shadowSecret instanceof ArrayBuffer ? new Uint8Array(shadowSecret) : new Uint8Array(shadowSecret.buffer, shadowSecret.byteOffset, shadowSecret.byteLength);
    if (bytes.byteLength === 0) return null;
    return bytes;
  }
  return null;
}

/**
 * Opaque, keyed reference for joining a shadow movement back to its real
 * booking without ever carrying the raw booking id, a sourceSite:id
 * string, or any guest-identifying field. Returns null (fails closed)
 * whenever no usable secret is supplied — this function never invents or
 * hardcodes one, and the caller (mapConfirmedBookingToMovementInput) must
 * treat a null return as a hard stop, not proceed with an unkeyed
 * fallback.
 */
// model.js's own CONTACT_REF_LOOKS_LIKE_PII guard rejects anything
// matching /\d[\d\s().-]{6,}\d/ (an 8+ character run that could be a phone
// number). A raw 32-char hex digest is ~62.5% digit characters (10 of 16
// symbols), so a random 8+ consecutive-digit run inside it is a real,
// observed failure (not hypothetical — caught via repeated live-shadow
// report runs where roughly 1 in ~20-50 refs tripped it). Breaking the
// digest into 6-char chunks joined by a literal 'g' (never itself produced
// by a hex digest, and not a digit/space/paren/dot/dash) makes this
// impossible by construction: no run of matching-class characters can ever
// reach the required minimum of 8, regardless of what the hash outputs.
const OPAQUE_REF_CHUNK_LEN = 6;
const OPAQUE_REF_CHUNK_SEPARATOR = 'g';

function chunkHexDigest(hex) {
  const chunks = [];
  for (let i = 0; i < hex.length; i += OPAQUE_REF_CHUNK_LEN) {
    chunks.push(hex.slice(i, i + OPAQUE_REF_CHUNK_LEN));
  }
  return chunks.join(OPAQUE_REF_CHUNK_SEPARATOR);
}

export async function computeOpaqueBookingRef(booking, sourceSite, shadowSecret) {
  const keyBytes = normalizeKeyBytes(shadowSecret);
  if (!keyBytes || booking?.id == null) return null;
  const message = `${SHADOW_REF_HMAC_DOMAIN}:${sourceSite}:${booking.id}`;
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const hex = Array.from(new Uint8Array(sigBuf), (b) => b.toString(16).padStart(2, '0')).join('');
  return `sr_${chunkHexDigest(hex.slice(0, 32))}`;
}

function deriveArrivalOrDeparture(booking) {
  const pickupIsAirport = AIRPORT_ZONE_IDENTIFIERS.has(booking.pickup_zone);
  const destIsAirport = AIRPORT_ZONE_IDENTIFIERS.has(booking.destination_zone);
  if (pickupIsAirport && !destIsAirport) return 'arrival';
  if (destIsAirport && !pickupIsAirport) return 'departure';
  // Neither side is a recognized airport zone (or, degenerately, both are)
  // — never guessed from anything else. Caller reports this as a distinct
  // CANNOT_DETERMINE_ARRIVAL_OR_DEPARTURE skip.
  return null;
}

// Matches the real bookings/negotiation_requests validation range exactly
// (see handleNegotiationCreate: 'passengers must be an integer between 1
// and 20') — never widened here.
const REAL_PASSENGER_BOUNDS = { min: 1, max: 20 };

/**
 * Extracts a real passenger count from a joined negotiation_requests row
 * (see this file's "MINIMUM INPUT TRUTH" section for exactly why this is
 * the only real source that exists, and only for the negotiated-booking
 * subset). Returns null — never a guessed default — for a missing row,
 * missing field, or a value outside the real backend's own validation
 * bounds. Never invents a value for the majority of bookings that have no
 * negotiation_requests row at all.
 */
export function derivePassengerCountFromNegotiationRequest(negotiationRequest) {
  if (!negotiationRequest || negotiationRequest.passengers == null) return null;
  const n = Number(negotiationRequest.passengers);
  if (!Number.isInteger(n) || n < REAL_PASSENGER_BOUNDS.min || n > REAL_PASSENGER_BOUNDS.max) return null;
  return n;
}

// Google Routes API's Duration proto is JSON-serialized as a string like
// "1234s" (always seconds, always this exact suffix) — see
// callGoogleRoutesApi's X-Goog-FieldMask: 'routes.duration' in
// nadi-marketplace/worker/worker.js. Anything else is not this format and
// must fail closed rather than being guess-parsed.
const GOOGLE_DURATION_RE = /^(\d+(?:\.\d+)?)s$/;

/**
 * Parses the real Google Routes API duration string (as cached in
 * geocoded_addresses.duration_text for the custom-address quote path —
 * see this file's "MINIMUM INPUT TRUTH" section) into minutes. Returns
 * null for anything not in that exact format, including plausible-looking
 * free text — this must never become a guessed duration.
 */
export function deriveDurationMinutesFromGoogleRoutesDuration(durationText) {
  if (typeof durationText !== 'string') return null;
  const match = GOOGLE_DURATION_RE.exec(durationText.trim());
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds / 60;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Converts a Fiji-LOCAL wall-clock date/time into the real UTC instant it
 * represents, using Intl (no new dependency, no hardcoded fixed offset —
 * works correctly whether or not Pacific/Fiji is in a DST period for the
 * given date, per whatever the runtime's own IANA tzdata says).
 *
 * Algorithm: read the input as a naive UTC timestamp, ask Intl what wall
 * clock time Pacific/Fiji would show AT that instant (which reveals the
 * zone's offset from UTC around that time), subtract that offset from the
 * naive timestamp to get a first real-UTC candidate, then re-derive the
 * offset AT that candidate and re-subtract if it changed — the standard
 * one-refinement fixup for a local-time-to-UTC conversion that might land
 * near a DST transition. Returns null (never a guessed instant) for any
 * malformed input or if the named zone can't be resolved at all.
 */
export function zonedTimeToUtcIso(dateStr, timeStr, timeZone = FIJI_TIME_ZONE) {
  if (typeof dateStr !== 'string' || typeof timeStr !== 'string') return null;
  if (!DATE_RE.test(dateStr) || !TIME_RE.test(timeStr)) return null;

  const naiveUtcMs = Date.parse(`${dateStr}T${timeStr}:00Z`);
  if (Number.isNaN(naiveUtcMs)) return null;

  let offsetMinutesAt;
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    offsetMinutesAt = (utcMs) => {
      const parts = dtf.formatToParts(new Date(utcMs));
      const get = (t) => Number(parts.find((p) => p.type === t)?.value);
      const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
      if (!Number.isFinite(asIfUtc)) throw new Error('unresolvable offset');
      return (asIfUtc - utcMs) / 60000;
    };
  } catch {
    return null; // unrecognized/unsupported timeZone — fail closed, never guess a fixed offset
  }

  let offsetMin;
  try {
    offsetMin = offsetMinutesAt(naiveUtcMs);
  } catch {
    return null;
  }
  let candidateMs = naiveUtcMs - offsetMin * 60000;

  try {
    const offsetMin2 = offsetMinutesAt(candidateMs);
    if (offsetMin2 !== offsetMin) {
      candidateMs = naiveUtcMs - offsetMin2 * 60000;
    }
  } catch {
    return null;
  }

  if (!Number.isFinite(candidateMs)) return null;
  return new Date(candidateMs).toISOString();
}

/**
 * Maps one real, already-human-confirmed booking + its confirming event
 * into a Smart Return movement input, or returns a typed refusal instead
 * of ever fabricating a missing field or leaking a raw identifier. Never
 * throws for an expected data gap — a batch of real rows will always
 * contain some with a gap, and the caller (the live-shadow report) needs
 * to count and name each one, not have the whole run die on the first bad
 * row.
 *
 * `shadowSecret` is REQUIRED to produce any linked output at all — see
 * computeOpaqueBookingRef's own header for why there is no fallback.
 *
 * `passengerCount` is an explicit override because the real `bookings`
 * table (see createBookingRecord) does not store passenger count at all
 * today — a genuine upstream data gap, not a Smart Return safety gate. If
 * the caller has it from another source (see
 * derivePassengerCountFromNegotiationRequest for the one real source that
 * exists) it can be supplied; if not, this returns
 * MISSING_PASSENGER_COUNT rather than defaulting to 1.
 *
 * `estimatedDurationMinutes` is the same pattern for trip duration — the
 * real `bookings`/`zones` tables have no duration field either (see
 * deriveDurationMinutesFromGoogleRoutesDuration for the one real source
 * that exists, for the custom-address quote path only). Left null when
 * not supplied, so matcher.js correctly reports HOLD_UNKNOWN_TIMING
 * rather than a guessed FEASIBLE — never fabricated here.
 */
export async function mapConfirmedBookingToMovementInput(booking, bookingEvent, { sourceSite, passengerCount, shadowSecret, now, estimatedDurationMinutes } = {}) {
  const humanConfirmed = isHumanConfirmedBooking(booking, bookingEvent);

  // Computed whenever possible (even for a booking that turns out NOT to
  // be human-confirmed) so ops can still locate the real booking behind
  // any skip reason without this report ever naming its raw id. Only a
  // missing/unusable secret, or a missing booking.id, leaves this null.
  const shadowRef = await computeOpaqueBookingRef(booking, sourceSite, shadowSecret);

  if (!humanConfirmed) {
    return { ok: false, reason: 'NOT_HUMAN_CONFIRMED', shadowRef };
  }
  if (!shadowRef) {
    // Either no secret was supplied, or booking.id was missing — either
    // way, nothing safe to link this row to. shadowRef is always null
    // here (a missing secret is the only way a HUMAN_CONFIRMED booking
    // with a real booking.id reaches this branch).
    return { ok: false, reason: 'SHADOW_SECRET_NOT_CONFIGURED', shadowRef: null };
  }
  if (passengerCount == null) {
    return { ok: false, reason: 'MISSING_PASSENGER_COUNT', shadowRef };
  }
  const arrivalOrDeparture = deriveArrivalOrDeparture(booking);
  if (!arrivalOrDeparture) {
    return { ok: false, reason: 'CANNOT_DETERMINE_ARRIVAL_OR_DEPARTURE', shadowRef };
  }
  const pickupDatetime = zonedTimeToUtcIso(booking.pickup_date, booking.pickup_time, FIJI_TIME_ZONE);
  if (!pickupDatetime) {
    return { ok: false, reason: 'MISSING_OR_INVALID_PICKUP_DATETIME', shadowRef };
  }
  if (estimatedDurationMinutes != null && (!Number.isFinite(estimatedDurationMinutes) || estimatedDurationMinutes <= 0)) {
    return { ok: false, reason: 'INVALID_DURATION_OVERRIDE', shadowRef };
  }

  try {
    const movementInput = normalizeMovementInput({
      movement_id: `mv_${shadowRef}`,
      // Deterministic per booking (stable shadowRef -> stable key), so a
      // re-run against the same real booking is idempotent — but derived
      // entirely from the opaque ref, never from sourceSite+raw id
      // directly.
      idempotency_key: `${SHADOW_REF_HMAC_DOMAIN}:${shadowRef}`,
      booking_reference: shadowRef,
      source_site: sourceSite,
      origin: booking.pickup_zone,
      pickup_zone: booking.pickup_zone,
      destination: booking.destination_zone,
      dropoff_zone: booking.destination_zone,
      pickup_datetime: pickupDatetime,
      arrival_or_departure: arrivalOrDeparture,
      passenger_count: passengerCount,
      estimated_duration_minutes: estimatedDurationMinutes ?? null,
      vehicle_class: String(booking.vehicle_type || '').toUpperCase(),
      customer_price: booking.quoted_amount,
      // operator_payout / absolute_floor are deliberately NOT sourced from
      // anywhere on the booking row here — this adapter has no real
      // operator-cost figures to supply, and inventing one would be
      // exactly the guessed-economics failure mode this whole system
      // exists to prevent. Left null so the matcher's own
      // commercial_pricing_status gate HOLDs on economics honestly.
      operator_payout: null,
      absolute_floor: null,
      booking_status: 'CONFIRMED',
      human_confirmation_status: 'CONFIRMED',
      assigned_operator: booking.assigned_driver_id != null ? `driver:${booking.assigned_driver_id}` : null,
      booking_contact_ref: shadowRef,
      test_data: false,
      created_at: booking.created_at ?? null,
    }, now ? { now } : undefined);
    return { ok: true, movementInput, shadowRef };
  } catch (err) {
    return { ok: false, reason: 'VALIDATION_ERROR', shadowRef, detail: err.message };
  }
}
