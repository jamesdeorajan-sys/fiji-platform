/* Issue #54 Stage 1 (SHADOW MODE) — production adapter.
 *
 * Connects REAL confirmed bookings (from the real nadi-dispatch-api
 * `bookings` / `booking_events` tables — see
 * nadi-marketplace/worker/worker.js: createBookingRecord, logBookingEvent,
 * handleDriverAcceptBooking, handleAdminManualAssign) into the Smart Return
 * ledger, in READ/SHADOW mode only.
 *
 * This module makes NO network or database call itself — it is pure
 * mapping/validation logic over rows the caller already has. That
 * separation is deliberate: whoever has real D1 read access runs the query
 * documented below and passes the rows in; this module never needs
 * production credentials of its own, and can be fully unit-tested without
 * them (see test/production_adapter.test.js).
 *
 * ── AUTHORITATIVE TRIGGER ──────────────────────────────────────────────
 * The mission's "HUMAN_CONFIRMED" state maps to `bookings.status =
 * 'accepted'`, reached ONLY via one of three real code paths, every one of
 * which requires an explicit human action and logs it to `booking_events`:
 *   - handleDriverAcceptBooking()      -> actor: `driver:<id>`  (a real
 *     driver tapping Accept in the driver app)
 *   - handleAdminManualAssign() Path A -> actor: 'admin'        (ops staff
 *     manually assigning an existing pending booking)
 *   - handleAdminManualAssign() Path B -> actor: 'admin'        (ops staff
 *     creating a booking directly for a WhatsApp-arranged trip)
 * There is no code path anywhere in the real worker that sets
 * status='accepted' without one of these three human actions — confirmed
 * by grep across every `status = 'accepted'` occurrence in worker.js, not
 * assumed. This is a safer, more specific signal than a generic "confirmed"
 * flag: it's tied to the exact event log entry that proves a human acted,
 * not just a status column that could in principle be flipped by a future
 * automated process without anyone revisiting this adapter.
 *
 * Never triggers on: booking creation ('pending'), a quote, a page view, or
 * a notification being sent — none of those produce a `booking_events` row
 * with event_type/new_status 'accepted', so isHumanConfirmedBooking()
 * returns false for all of them by construction, not by a separate
 * denylist.
 *
 * ── READ-ONLY SQL THIS ADAPTER IS DESIGNED AGAINST ─────────────────────
 * (documented, not executed by this module or by this branch — no D1
 * binding exists here; see docs/CEO_RELEASE_REPORT.md for why)
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
 * createBookingRecord() (nadi-marketplace/worker/worker.js) never captures
 * an estimated trip duration or planned dropoff time — confirmed by
 * reading its full parameter list, not assumed. mapConfirmedBookingToMovementInput()
 * therefore never sets estimated_duration_minutes/planned_dropoff_datetime,
 * which means model.js's estimateSourceCompletionMs() (correctly) returns
 * null for every real movement this adapter produces, and matcher.js
 * (correctly) reports operational_feasibility = HOLD_UNKNOWN_TIMING for
 * every candidate pairing rather than guessing FEASIBLE. This is the
 * safety model working as designed, not a bug in this adapter — but it
 * does mean a real live-shadow run will show 0 FEASIBLE / 0 READY matches
 * until either the real booking flow starts capturing an estimated
 * duration at HUMAN_CONFIRMED time, or a separately-verified duration
 * source is deliberately wired in (out of scope for this minimal
 * adapter — see the live-shadow report's own notes on this).
 *
 * ── PRIVACY ─────────────────────────────────────────────────────────────
 * mapConfirmedBookingToMovementInput() never reads guest_name, guest_phone,
 * guest_email, flight_number, or notes off the real booking row into the
 * movement it produces — see the field-by-field mapping below. The only
 * identifier carried through is an opaque booking_contact_ref (see
 * generateOpaqueContactRef), which model.js's own ingestion validation
 * independently re-checks doesn't look like an email or phone number.
 */
import { normalizeMovementInput } from './model.js';

export const HUMAN_CONFIRMED_BOOKING_STATUS = 'accepted';

const HUMAN_ACCEPT_EVENT_TYPE = 'accepted';
// Matches exactly the two real actor shapes ever written by
// logBookingEvent() for an accept transition: 'admin' or 'driver:<id>'.
// A future automated actor (e.g. 'system' or 'cron') deliberately does NOT
// match, so an automated confirmation path introduced later fails closed
// here rather than silently starting to trigger shadow evaluation.
const HUMAN_ACTOR_PATTERN = /^(admin|driver:\d+)$/;

// Zones the real bookings table uses to represent Nadi International
// Airport (see ftt-booking-site/src/index.html's own `<option value="NAN">`
// and nadi-marketplace's zone table) — used only to derive
// arrival_or_departure, never to infer feasibility or pricing.
const AIRPORT_ZONE_IDENTIFIERS = new Set(['NAN', 'NADI_AIRPORT']);

/**
 * True only for a booking whose CURRENT status is 'accepted' AND whose
 * supplied confirming event is a real accept transition actioned by a
 * human (driver or admin). Both conditions are required — a stray
 * accept-shaped event on a booking that has since moved to 'pending' again
 * (shouldn't happen, but never trusted blindly) does not qualify, and a
 * currently-accepted booking with no supplied confirming event does not
 * qualify either (this adapter never infers confirmation from status
 * alone — it requires the actual audit-log proof).
 */
export function isHumanConfirmedBooking(booking, bookingEvent) {
  if (!booking || booking.status !== HUMAN_CONFIRMED_BOOKING_STATUS) return false;
  if (!bookingEvent) return false;
  if (bookingEvent.event_type !== HUMAN_ACCEPT_EVENT_TYPE) return false;
  if (bookingEvent.new_status !== HUMAN_CONFIRMED_BOOKING_STATUS) return false;
  if (typeof bookingEvent.actor !== 'string' || !HUMAN_ACTOR_PATTERN.test(bookingEvent.actor)) return false;
  return true;
}

// Portable (Node + Workers runtime, zero dependencies) deterministic
// non-cryptographic hash (FNV-1a, 32-bit, hex-encoded). This only needs to
// be an opaque, stable JOIN key for internal shadow-ledger use — never a
// security boundary — so a fast, dependency-free hash is the right tool,
// not crypto.subtle (which is async and would force this whole module
// async for no real benefit here).
function fnv1aHex(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Opaque reference for joining a shadow movement back to its real booking
 * without ever carrying guest_name/guest_phone/guest_email/flight_number.
 * Deterministic (same booking -> same ref every time, so idempotent
 * re-runs and later manual lookups both work) but derived ONLY from the
 * source_site + booking id — never from any guest-identifying field, so it
 * cannot be reversed into a phone number or email even in principle.
 */
export function generateOpaqueContactRef(booking, sourceSite) {
  return `bkref_${fnv1aHex(`${sourceSite}:${booking.id}`)}`;
}

function deriveArrivalOrDeparture(booking) {
  const pickupIsAirport = AIRPORT_ZONE_IDENTIFIERS.has(booking.pickup_zone);
  const destIsAirport = AIRPORT_ZONE_IDENTIFIERS.has(booking.destination_zone);
  if (pickupIsAirport && !destIsAirport) return 'arrival';
  if (destIsAirport && !pickupIsAirport) return 'departure';
  // Neither side is a recognized airport zone (or, degenerately, both are)
  // — this adapter never guesses between arrival/departure from anything
  // else (route shape, time of day, etc.). Caller reports this as a
  // distinct CANNOT_DETERMINE_ARRIVAL_OR_DEPARTURE skip, never a silent
  // default.
  return null;
}

function combinePickupDateTime(booking) {
  if (booking.pickup_date && booking.pickup_time) {
    return new Date(`${booking.pickup_date}T${booking.pickup_time}:00Z`).toISOString();
  }
  // No separate date/time on this booking (shouldn't happen for a real
  // accepted booking, but never fabricated) — falls through to null, which
  // normalizeMovementInput() will itself reject as invalid rather than this
  // adapter silently substituting `created_at` or "now" as a guess.
  return null;
}

/**
 * Maps one real, already-human-confirmed booking + its confirming event
 * into a Smart Return movement input, or returns a typed refusal instead
 * of ever fabricating a missing field. Never throws for an expected data
 * gap — a batch of real rows will always contain some with a gap, and the
 * caller (the live-shadow report) needs to count and name each one, not
 * have the whole run die on the first bad row.
 *
 * `passengerCount` is an explicit override because the real `bookings`
 * table (see createBookingRecord in nadi-marketplace/worker/worker.js) does
 * not store passenger count at all today — a genuine upstream data gap,
 * not a Smart Return safety gate. If the caller has it from another source
 * (e.g. a joined funnel/attribution event) it can be supplied; if not, this
 * returns MISSING_PASSENGER_COUNT rather than defaulting to 1.
 */
export function mapConfirmedBookingToMovementInput(booking, bookingEvent, { sourceSite, passengerCount, now } = {}) {
  if (!isHumanConfirmedBooking(booking, bookingEvent)) {
    return { ok: false, reason: 'NOT_HUMAN_CONFIRMED', bookingId: booking?.id ?? null };
  }
  if (passengerCount == null) {
    return { ok: false, reason: 'MISSING_PASSENGER_COUNT', bookingId: booking.id };
  }
  const arrivalOrDeparture = deriveArrivalOrDeparture(booking);
  if (!arrivalOrDeparture) {
    return { ok: false, reason: 'CANNOT_DETERMINE_ARRIVAL_OR_DEPARTURE', bookingId: booking.id };
  }
  const pickupDatetime = combinePickupDateTime(booking);
  if (!pickupDatetime) {
    return { ok: false, reason: 'MISSING_PICKUP_DATETIME', bookingId: booking.id };
  }

  try {
    const movementInput = normalizeMovementInput({
      movement_id: `mv_prod_${sourceSite}_${booking.id}`,
      // source_site + real booking id is a stable, unique, idempotent key
      // across re-runs of the live-shadow report — re-evaluating the same
      // confirmed booking twice must never create a second movement.
      idempotency_key: `${sourceSite}:${booking.id}`,
      booking_reference: String(booking.id),
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
      // anywhere on the booking row itself here — this adapter has no real
      // operator-cost figures to supply, and inventing one would be
      // exactly the guessed-economics failure mode this whole system
      // exists to prevent. Left null so the matcher's own
      // commercial_pricing_status gate HOLDs on economics honestly, same
      // as it would for any other candidate with no known cost basis.
      operator_payout: null,
      absolute_floor: null,
      booking_status: 'CONFIRMED',
      human_confirmation_status: 'CONFIRMED',
      assigned_operator: booking.assigned_driver_id != null ? `driver:${booking.assigned_driver_id}` : null,
      booking_contact_ref: generateOpaqueContactRef(booking, sourceSite),
      // Real production data, never synthetic canary data.
      test_data: false,
      created_at: booking.created_at ?? null,
    }, now ? { now } : undefined);
    return { ok: true, movementInput };
  } catch (err) {
    return { ok: false, reason: 'VALIDATION_ERROR', bookingId: booking.id, detail: err.message };
  }
}
