/* Issue #54 Stage 1 (SHADOW MODE) — shared enums, constants, and validation. */

export const SOURCE_SITES = Object.freeze([
  'nadiairporttransfers.com',
  'bookfijitransfers.com',
  'book.fijidash.com',
]);

export const ARRIVAL_OR_DEPARTURE = Object.freeze(['arrival', 'departure']);

export const BOOKING_STATUS = Object.freeze(['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED']);

export const HUMAN_CONFIRMATION_STATUS = Object.freeze(['UNCONFIRMED', 'CONFIRMED', 'REJECTED']);

export const OFFER_STATUS = Object.freeze([
  'DISCOVERED',
  'VALIDATED',
  'ACTIVE',
  'HELD',
  'FILLED',
  'EXPIRED',
]);

export const FARE_CLASS = Object.freeze({
  STANDARD: 'STANDARD',
  RETURN_LOCK: 'RETURN_LOCK',
  SMART_MATCH: 'SMART_MATCH',
  LIVE_FILL: 'LIVE_FILL',
});

export const MATCH_TYPE = Object.freeze({
  EXACT_REVERSE: 'EXACT_REVERSE',
  NEARBY_REVERSE: 'NEARBY_REVERSE',
  CORRIDOR: 'CORRIDOR',
  EXTENSION_CHAIN: 'EXTENSION_CHAIN',
  MULTI_LEG_CHAIN: 'MULTI_LEG_CHAIN',
});

export const FEASIBILITY = Object.freeze({
  FEASIBLE: 'FEASIBLE',
  INFEASIBLE: 'INFEASIBLE',
  HOLD_UNKNOWN_ECONOMICS: 'HOLD_UNKNOWN_ECONOMICS',
  // Chronological feasibility could not be determined because the source
  // movement's trip duration is unknown (no estimated_duration_minutes or
  // planned_dropoff_datetime, and placeholder geography is not allowed to
  // fill that gap — see src/geo_seed.js). Never inferred as FEASIBLE.
  HOLD_UNKNOWN_TIMING: 'HOLD_UNKNOWN_TIMING',
});

export function isHoldFeasibility(feasibility) {
  return feasibility === FEASIBILITY.HOLD_UNKNOWN_ECONOMICS || feasibility === FEASIBILITY.HOLD_UNKNOWN_TIMING;
}

export const RETURN_LOCK_MIN_DAYS_AHEAD = 7;
export const EXPERIENCE_CREDIT_VALUE_EACH = 25;
export const EXPERIENCE_CREDIT_MAX_COUNT = 2;
// CEO policy decision 2026-09-13 / corrected same day: this is the default
// minimum spend on a SEPARATE, EARN-vs-REDEEM-independent FijiTourTransfers
// TOUR booking required to redeem one AU$25 credit. It must never be
// compared against combined transfer customer_price — see
// src/pricing.js#redeemExperienceCredit.
export const DEFAULT_MIN_TOUR_SPEND_PER_CREDIT = 100;

const REQUIRED_MOVEMENT_FIELDS = [
  'booking_reference',
  'source_site',
  'origin',
  'pickup_zone',
  'destination',
  'dropoff_zone',
  'pickup_datetime',
  'arrival_or_departure',
  'passenger_count',
  'vehicle_class',
  'customer_price',
];

// CEO fix 2026-09-13: this subsystem must never carry direct customer PII.
// Ingestion rejects any payload that carries one of these field names at
// all, rather than silently dropping the value — a caller sending PII
// here has a bug that needs to be visible, not swallowed.
const PII_DENYLIST_FIELDS = [
  'customer_name', 'name', 'first_name', 'last_name',
  'customer_email', 'email',
  'customer_phone', 'phone', 'phone_number', 'mobile',
  'whatsapp_number', 'whatsapp',
];

const CONTACT_REF_LOOKS_LIKE_PII = /@|(?:\+?\d[\d\s().-]{6,}\d)/;

export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

/**
 * Normalizes and validates a raw ingestion payload into a movement record
 * shape. Throws ValidationError on any missing/invalid required field —
 * a malformed booking must fail loudly, not be silently half-recorded.
 * Does not touch pricing decisions or matching; those are separate stages.
 */
export function normalizeMovementInput(raw, { now = () => new Date().toISOString() } = {}) {
  if (!raw || typeof raw !== 'object') {
    throw new ValidationError('movement payload must be an object');
  }

  for (const field of REQUIRED_MOVEMENT_FIELDS) {
    if (raw[field] === undefined || raw[field] === null || raw[field] === '') {
      throw new ValidationError(`missing required field: ${field}`, field);
    }
  }

  for (const field of PII_DENYLIST_FIELDS) {
    if (raw[field] !== undefined) {
      throw new ValidationError(
        `movement ingestion must not carry direct PII field '${field}' — use booking_contact_ref instead`,
        field
      );
    }
  }

  if (raw.booking_contact_ref != null && CONTACT_REF_LOOKS_LIKE_PII.test(String(raw.booking_contact_ref))) {
    throw new ValidationError(
      'booking_contact_ref must be an opaque reference, not an email address or phone number',
      'booking_contact_ref'
    );
  }

  if (raw.estimated_duration_minutes != null) {
    if (!Number.isFinite(Number(raw.estimated_duration_minutes)) || Number(raw.estimated_duration_minutes) <= 0) {
      throw new ValidationError('estimated_duration_minutes must be a positive number', 'estimated_duration_minutes');
    }
  }

  if (raw.planned_dropoff_datetime != null && Number.isNaN(new Date(raw.planned_dropoff_datetime).getTime())) {
    throw new ValidationError('planned_dropoff_datetime is not a valid ISO date', 'planned_dropoff_datetime');
  }

  if (!SOURCE_SITES.includes(raw.source_site)) {
    throw new ValidationError(`unknown source_site: ${raw.source_site}`, 'source_site');
  }

  if (!ARRIVAL_OR_DEPARTURE.includes(raw.arrival_or_departure)) {
    throw new ValidationError(
      `arrival_or_departure must be one of ${ARRIVAL_OR_DEPARTURE.join(', ')}`,
      'arrival_or_departure'
    );
  }

  if (!Number.isFinite(Number(raw.passenger_count)) || Number(raw.passenger_count) <= 0) {
    throw new ValidationError('passenger_count must be a positive number', 'passenger_count');
  }

  if (!Number.isFinite(Number(raw.customer_price)) || Number(raw.customer_price) < 0) {
    throw new ValidationError('customer_price must be a non-negative number', 'customer_price');
  }

  if (raw.test_data !== true && raw.test_data !== false) {
    throw new ValidationError(
      'test_data must be explicitly true or false — no implicit default for real-looking data',
      'test_data'
    );
  }

  const nowIso = now();
  const pickup = new Date(raw.pickup_datetime);
  if (Number.isNaN(pickup.getTime())) {
    throw new ValidationError('pickup_datetime is not a valid ISO date', 'pickup_datetime');
  }

  return {
    movement_id: raw.movement_id ?? `mv_${cryptoRandomId()}`,
    idempotency_key: raw.idempotency_key ?? `${raw.source_site}:${raw.booking_reference}`,
    booking_reference: String(raw.booking_reference),
    source_site: raw.source_site,
    source_page: raw.source_page ?? null,
    attribution: raw.attribution ?? null,
    itinerary_id: raw.itinerary_id ?? null,
    linked_return_movement_id: raw.linked_return_movement_id ?? null,
    origin: raw.origin,
    pickup_zone: raw.pickup_zone,
    destination: raw.destination,
    dropoff_zone: raw.dropoff_zone,
    pickup_datetime: pickup.toISOString(),
    earliest_safe_pickup: raw.earliest_safe_pickup ?? pickup.toISOString(),
    latest_safe_pickup: raw.latest_safe_pickup ?? pickup.toISOString(),
    arrival_or_departure: raw.arrival_or_departure,
    flight_number: raw.flight_number ?? null,
    passenger_count: Number(raw.passenger_count),
    luggage_count: Number(raw.luggage_count ?? 0),
    vehicle_class: raw.vehicle_class,
    customer_price: Number(raw.customer_price),
    operator_payout: raw.operator_payout != null ? Number(raw.operator_payout) : null,
    absolute_floor: raw.absolute_floor != null ? Number(raw.absolute_floor) : null,
    booking_status: BOOKING_STATUS.includes(raw.booking_status) ? raw.booking_status : 'CONFIRMED',
    human_confirmation_status: HUMAN_CONFIRMATION_STATUS.includes(raw.human_confirmation_status)
      ? raw.human_confirmation_status
      : 'UNCONFIRMED',
    assigned_vehicle: raw.assigned_vehicle ?? null,
    assigned_operator: raw.assigned_operator ?? null,
    estimated_duration_minutes: raw.estimated_duration_minutes != null ? Number(raw.estimated_duration_minutes) : null,
    planned_dropoff_datetime: raw.planned_dropoff_datetime
      ? new Date(raw.planned_dropoff_datetime).toISOString()
      : null,
    booking_contact_ref: raw.booking_contact_ref ?? null,
    test_data: raw.test_data,
    created_at: raw.created_at ?? nowIso,
    updated_at: nowIso,
  };
}

/**
 * Best-known completion time (ms epoch) of a movement's own trip, or null
 * if unknown. Deliberately does NOT fall back to any geography-derived
 * distance/duration lookup — placeholder geography (src/geo_seed.js) is
 * not verified and must never manufacture a chronological feasibility
 * verdict. Prefers an explicit planned_dropoff_datetime; falls back to
 * pickup_datetime + estimated_duration_minutes; otherwise null.
 */
export function estimateSourceCompletionMs(movement) {
  if (movement.planned_dropoff_datetime) {
    return new Date(movement.planned_dropoff_datetime).getTime();
  }
  if (movement.estimated_duration_minutes != null) {
    return new Date(movement.pickup_datetime).getTime() + movement.estimated_duration_minutes * 60000;
  }
  return null;
}

export function cryptoRandomId() {
  // Node >=19 / Workers runtime both expose globalThis.crypto.randomUUID().
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
