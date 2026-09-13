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
 * ── AUTHORITATIVE TRIGGER ──────────────────────────────────────────────
 * The mission's "HUMAN_CONFIRMED" state maps to `bookings.status =
 * 'accepted'`, reached ONLY via one of three real code paths, every one of
 * which requires an explicit human action and logs it to `booking_events`:
 *   - handleDriverAcceptBooking()      -> actor: `driver:<id>`
 *   - handleAdminManualAssign() Path A -> actor: 'admin'
 *   - handleAdminManualAssign() Path B -> actor: 'admin'
 * Confirmed by grep across every `status = 'accepted'` occurrence in
 * worker.js, not assumed. Never triggers on booking creation ('pending'),
 * a quote, a page view, or a notification being sent.
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
 *   SELECT b.*, be.actor, be.created_at AS confirmed_at
 *   FROM bookings b
 *   JOIN booking_events be ON be.booking_id = b.id
 *   WHERE b.status = 'accepted'
 *     AND be.event_type = 'accepted'
 *     AND be.new_status = 'accepted'
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

export const HUMAN_CONFIRMED_BOOKING_STATUS = 'accepted';
export const SHADOW_REF_HMAC_DOMAIN = 'smart-return-booking-ref:v1';

const HUMAN_ACCEPT_EVENT_TYPE = 'accepted';
// Matches exactly the two real actor shapes ever written by
// logBookingEvent() for an accept transition: 'admin' or 'driver:<id>'. A
// future automated actor (e.g. 'system' or 'cron') deliberately does NOT
// match, so an automated confirmation path introduced later fails closed
// here rather than silently starting to trigger shadow evaluation.
const HUMAN_ACTOR_PATTERN = /^(admin|driver:\d+)$/;

// Zones the real bookings table uses to represent Nadi International
// Airport — used only to derive arrival_or_departure, never feasibility
// or pricing.
const AIRPORT_ZONE_IDENTIFIERS = new Set(['NAN', 'NADI_AIRPORT']);

const FIJI_TIME_ZONE = 'Pacific/Fiji';

/**
 * True only for a booking whose CURRENT status is 'accepted' AND whose
 * supplied confirming event (a) is a real accept transition, (b) was
 * actioned by a human, and (c) actually belongs to THIS booking — proven
 * by booking.id === bookingEvent.booking_id, compared as strings so a
 * numeric-vs-string DB driver difference can't cause a false rejection,
 * but never fuzzy/substring-matched.
 */
export function isHumanConfirmedBooking(booking, bookingEvent) {
  if (!booking || booking.status !== HUMAN_CONFIRMED_BOOKING_STATUS) return false;
  if (!bookingEvent) return false;
  if (bookingEvent.event_type !== HUMAN_ACCEPT_EVENT_TYPE) return false;
  if (bookingEvent.new_status !== HUMAN_CONFIRMED_BOOKING_STATUS) return false;
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
 * the caller has it from another source it can be supplied; if not, this
 * returns MISSING_PASSENGER_COUNT rather than defaulting to 1.
 */
export async function mapConfirmedBookingToMovementInput(booking, bookingEvent, { sourceSite, passengerCount, shadowSecret, now } = {}) {
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
