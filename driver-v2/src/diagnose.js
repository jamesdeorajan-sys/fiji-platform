// Diagnostic read for ONE booking: last proven boundary, first missing/failed boundary, stable reason code, responsible subsystem,
// retry state, human-fallback flag. Correlation is booking_id + offer_id + driver_id + actor + timestamp — never guest PII.
import { BOUNDARIES, EVENT_TO_BOUNDARY, CODE } from './constants.js';

const SUBSYSTEM = {
  BOOKING_SAVED: 'BOOKING_INTAKE', DISPATCH_ELIGIBLE: 'DISPATCH', OFFER_CREATED: 'DISPATCH',
  DRIVER_NOTIFICATION_ATTEMPTED: 'NOTIFICATION', DRIVER_NOTIFICATION_DELIVERED: 'NOTIFICATION',
  OFFER_VIEWED: 'DRIVER_CLIENT', DRIVER_DECISION: 'DRIVER_DECISION', ASSIGNMENT_CLAIM: 'ASSIGNMENT', ASSIGNMENT_PERSISTED: 'ASSIGNMENT',
  PICKUP_EN_ROUTE: 'TRIP', PICKUP_ARRIVED: 'TRIP', PICKUP_VALIDATED: 'EVIDENCE', PASSENGER_ONBOARD: 'TRIP',
  DESTINATION_EN_ROUTE: 'TRIP', DESTINATION_ARRIVED: 'TRIP', COMPLETED: 'TRIP', REVIEW_REQUESTED: 'REVIEW_HOOK', REVIEW_RECEIVED: 'REVIEW_HOOK',
};

export async function diagnose(db, bookingId) {
  const evs = (await db.prepare(`SELECT id, event_type, previous_status, new_status, actor, metadata, created_at FROM booking_events WHERE booking_id = ? ORDER BY id`).bind(bookingId).all()).results;
  const offers = (await db.prepare(`SELECT offer_id, driver_id, state, dispatch_phase, offered_at, viewed_at, decision_at, decision_reason_code FROM driver_offers WHERE booking_id = ? ORDER BY offered_at, offer_id`).bind(bookingId).all()).results;
  const attempts = (await db.prepare(`SELECT driver_id, offer_id, attempt_no, status, provider_reason_code, created_at FROM driver_broadcast_attempts WHERE booking_id = ? ORDER BY id`).bind(bookingId).all()).results;
  const esc = (await db.prepare(`SELECT trigger_type, state, created_at FROM dispatch_escalations WHERE booking_id = ?`).bind(bookingId).all()).results;

  const timeline = evs.map((e) => {
    const m = JSON.parse(e.metadata || '{}');
    return { seq: e.id, at: e.created_at, event: e.event_type, boundary: EVENT_TO_BOUNDARY[e.event_type] ?? null, actor: e.actor,
      offer_id: m.offer_id ?? null, driver_id: m.driver_id ?? null, reason_code: m.reason_code ?? null, phase: m.phase ?? null, retry_state: m.retry_state ?? null, decision: m.decision ?? null };
  });

  const proven = new Map();
  // A decline is an outcome of one offer (listed under `offers` with its reason code); it does not advance the booking journey.
  for (const t of timeline) if (t.boundary && !(t.event === 'DRIVER_DECISION' && t.decision === 'DECLINED') && !proven.has(t.boundary)) proven.set(t.boundary, t);
  const failedNotif = timeline.filter((t) => t.event === 'DRIVER_NOTIFICATION_FAILED');
  const fallback = timeline.find((t) => t.event === 'HUMAN_FALLBACK_REQUIRED') || null;

  const boundaries = BOUNDARIES.map((b) => {
    const p = proven.get(b);
    if (p) return { boundary: b, state: 'PROVEN', at: p.at, offer_id: p.offer_id, driver_id: p.driver_id, reason_code: p.reason_code };
    if (b === 'DRIVER_NOTIFICATION_DELIVERED' && failedNotif.length) { const f = failedNotif[failedNotif.length - 1]; return { boundary: b, state: 'FAILED', at: f.at, offer_id: f.offer_id, driver_id: f.driver_id, reason_code: f.reason_code || CODE.NOTIFICATION_PROVIDER_ERROR }; }
    return { boundary: b, state: 'MISSING', at: null, offer_id: null, driver_id: null, reason_code: null };
  });

  let lastProven = null; for (const b of boundaries) if (b.state === 'PROVEN') lastProven = b;
  // Where the journey is BROKEN = the first boundary AFTER the last proven one that is not proven.
  // Anything un-proven upstream of that (e.g. a delivery receipt that never arrived although the driver reached the PWA anyway)
  // is surfaced separately as `upstream_gaps` so it is visible without misdirecting triage.
  const lastIdx = lastProven ? boundaries.findIndex((x) => x.boundary === lastProven.boundary) : -1;
  const next = boundaries.find((b, i) => i > lastIdx && b.state !== 'PROVEN') || null;
  const upstreamGaps = boundaries.filter((b, i) => i < lastIdx && b.state !== 'PROVEN').map((b) => ({ boundary: b.boundary, state: b.state, reason_code: b.reason_code }));

  const openOffers = offers.filter((o) => ['OFFERED', 'VIEWED'].includes(o.state));
  let reason = next?.reason_code || null;
  let subsystem = next ? SUBSYSTEM[next.boundary] : null;
  let retry = 'NONE';
  if (fallback) { reason = CODE.HUMAN_FALLBACK_REQUIRED; subsystem = 'DISPATCH'; retry = 'HUMAN'; }
  else if (next && next.state === 'FAILED') retry = 'RETRYABLE';
  else if (openOffers.length && next && ['DRIVER_DECISION', 'OFFER_VIEWED', 'DRIVER_NOTIFICATION_DELIVERED'].includes(next.boundary)) { reason = reason || 'AWAITING_DRIVER'; retry = 'WAITING'; }
  else if (!next) { reason = null; retry = 'NONE'; }
  // surface the decisive offer outcome codes (decline / expiry / superseded) so "why" is a code, not prose
  const outcomes = offers.map((o) => ({ offer_id: o.offer_id, driver_id: o.driver_id, state: o.state, phase: o.dispatch_phase, reason_code: o.decision_reason_code }));
  const attemptsView = attempts.map((a) => ({ driver_id: a.driver_id, offer_id: a.offer_id, attempt_no: a.attempt_no, status: a.status, reason_code: a.provider_reason_code }));

  return {
    booking_id: bookingId,
    last_proven_boundary: lastProven?.boundary ?? null,
    first_missing_or_failed_boundary: next?.boundary ?? null,
    reason_code: reason,
    responsible_subsystem: subsystem,
    retry_state: retry,
    human_fallback_invoked: !!fallback || esc.some((e) => e.trigger_type === 'HUMAN_FALLBACK_REQUIRED'),
    upstream_gaps: upstreamGaps, offers: outcomes, delivery_attempts: attemptsView, boundaries, timeline,
  };
}
