// Driver PWA v2 Gate 1 — stable machine-readable contract. UI wording is NOT the diagnostic contract; these codes are.

export const WINDOW = Object.freeze({
  PRIORITY_MS: 60_000,       // KPI / fast-response window — NOT destructive expiry
  GRACE_END_MS: 120_000,     // CONNECTIVITY_GRACE ends
  DEADLINE_MS: 180_000,      // automated dispatch envelope; >= this => HUMAN_FALLBACK_REQUIRED
  ESCALATION_FANOUT: 2,      // extra drivers introduced per escalated sweep (first valid accept still wins)
});

export const PHASE = Object.freeze({
  PRIORITY: 'PRIORITY',
  CONNECTIVITY_GRACE: 'CONNECTIVITY_GRACE',
  ESCALATED_DISPATCH: 'ESCALATED_DISPATCH',
  HUMAN_FALLBACK_REQUIRED: 'HUMAN_FALLBACK_REQUIRED',
});

export const OFFER_STATE = Object.freeze({
  OFFERED: 'OFFERED', VIEWED: 'VIEWED', ACCEPTED: 'ACCEPTED', DECLINED: 'DECLINED', TIMED_OUT: 'TIMED_OUT', SUPERSEDED: 'SUPERSEDED',
});

export const CODE = Object.freeze({
  OK: 'OK',
  ASSIGNED: 'ASSIGNED',
  ASSIGNMENT_ALREADY_TAKEN: 'ASSIGNMENT_ALREADY_TAKEN',
  OFFER_EXPIRED: 'OFFER_EXPIRED',
  DRIVER_DECLINED: 'DRIVER_DECLINED',
  DRIVER_OFFLINE: 'DRIVER_OFFLINE',
  DRIVER_OUTSIDE_ZONE: 'DRIVER_OUTSIDE_ZONE',
  NOTIFICATION_PROVIDER_ERROR: 'NOTIFICATION_PROVIDER_ERROR',
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  EVIDENCE_UPLOAD_FAILED: 'EVIDENCE_UPLOAD_FAILED',
  HUMAN_FALLBACK_REQUIRED: 'HUMAN_FALLBACK_REQUIRED',
  SUPERSEDED: 'SUPERSEDED',
  // Additional stable codes introduced by the implementation (declared, not hidden):
  OFFER_NOT_FOUND: 'OFFER_NOT_FOUND',               // identical for "unknown" and "not yours" (anti-ID-guessing)
  NOT_ASSIGNED_DRIVER: 'NOT_ASSIGNED_DRIVER',       // trip/evidence access by a driver who did not win the booking
  AUDIT_PERSIST_FAILED: 'AUDIT_PERSIST_FAILED',     // critical audit event could not be persisted => transition refused
  EVIDENCE_REQUIRED: 'EVIDENCE_REQUIRED',           // PICKUP_VALIDATED without stored pickup evidence
  TEST_DRIVER_MODE_REFUSED: 'TEST_DRIVER_MODE_REFUSED',
  FINANCIAL_EFFECTS_DISABLED: 'FINANCIAL_EFFECTS_DISABLED',
  NON_SYNTHETIC_BOOKING_REFUSED: 'NON_SYNTHETIC_BOOKING_REFUSED',
  DRIVER_HAS_ACTIVE_TRIP: 'DRIVER_HAS_ACTIVE_TRIP',   // Gate 1.5 CEO decision: a driver with an ACTIVE assigned trip is not eligible for a new immediate offer
});

// Detailed trip lifecycle (booking_events). Coarse bookings.status stays pending|accepted|en_route|completed.
export const LIFECYCLE = Object.freeze([
  'DRIVER_ASSIGNED', 'EN_ROUTE_PICKUP', 'ARRIVED_PICKUP', 'PICKUP_VALIDATED', 'PASSENGER_ONBOARD',
  'EN_ROUTE_DESTINATION', 'ARRIVED_DESTINATION', 'COMPLETED',
]);
// Gate 1.5: coarse bookings.status values that mean "driver is occupied with a guest" (first launch; no future/scheduled stacking).
export const ACTIVE_TRIP_STATUSES = Object.freeze(['accepted', 'en_route']);
export const REVIEW_HOOKS = Object.freeze(['REVIEW_REQUESTED', 'REVIEW_RECEIVED']);

// Coarse production status implied by a lifecycle stage (stable production status model is NOT widened).
export const COARSE_STATUS = Object.freeze({ DRIVER_ASSIGNED: 'accepted', EN_ROUTE_PICKUP: 'en_route', COMPLETED: 'completed' });

// Root-cause boundary model (AGENT_SYNC diagnostic addendum), in order.
export const BOUNDARIES = Object.freeze([
  'BOOKING_SAVED', 'DISPATCH_ELIGIBLE', 'OFFER_CREATED', 'DRIVER_NOTIFICATION_ATTEMPTED', 'DRIVER_NOTIFICATION_DELIVERED',
  'OFFER_VIEWED', 'DRIVER_DECISION', 'ASSIGNMENT_CLAIM', 'ASSIGNMENT_PERSISTED',
  'PICKUP_EN_ROUTE', 'PICKUP_ARRIVED', 'PICKUP_VALIDATED', 'PASSENGER_ONBOARD',
  'DESTINATION_EN_ROUTE', 'DESTINATION_ARRIVED', 'COMPLETED', 'REVIEW_REQUESTED', 'REVIEW_RECEIVED',
]);
export const EVENT_TO_BOUNDARY = Object.freeze({
  BOOKING_SAVED: 'BOOKING_SAVED', DISPATCH_ELIGIBLE: 'DISPATCH_ELIGIBLE', OFFER_CREATED: 'OFFER_CREATED',
  DRIVER_NOTIFICATION_ATTEMPTED: 'DRIVER_NOTIFICATION_ATTEMPTED', DRIVER_NOTIFICATION_DELIVERED: 'DRIVER_NOTIFICATION_DELIVERED',
  OFFER_VIEWED: 'OFFER_VIEWED', DRIVER_DECISION: 'DRIVER_DECISION', ASSIGNMENT_CLAIM: 'ASSIGNMENT_CLAIM', ASSIGNMENT_PERSISTED: 'ASSIGNMENT_PERSISTED',
  EN_ROUTE_PICKUP: 'PICKUP_EN_ROUTE', ARRIVED_PICKUP: 'PICKUP_ARRIVED', PICKUP_VALIDATED: 'PICKUP_VALIDATED', PASSENGER_ONBOARD: 'PASSENGER_ONBOARD',
  EN_ROUTE_DESTINATION: 'DESTINATION_EN_ROUTE', ARRIVED_DESTINATION: 'DESTINATION_ARRIVED', COMPLETED: 'COMPLETED',
  REVIEW_REQUESTED: 'REVIEW_REQUESTED', REVIEW_RECEIVED: 'REVIEW_RECEIVED',
});

// The ONLY driver identity the controlled real-phone fixture may ever represent (TEST DRIVER MODE).
export const TEST_DRIVER_ID = 1;
// Synthetic booking ids live in a range that real NAT/FD bookings (small sequential integers) cannot reach.
export const SYNTHETIC_BOOKING_ID_FLOOR = 9_000_000_000;
export const SYNTHETIC_REF_PREFIX = 'SYN-GATE1-';

// Fields that must NEVER reach an unassigned driver's client.
export const FORBIDDEN_PRE_ASSIGNMENT_KEYS = Object.freeze([
  'guest_name', 'guest_phone', 'guest_email', 'flight_number', 'pickup_notes', 'phone', 'email', 'contact',
]);
