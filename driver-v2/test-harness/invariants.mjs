// Global safety invariants evaluated over the WHOLE isolated database. Any violation throws (a FAILED gate, never waived).
import { LIFECYCLE, FORBIDDEN_PRE_ASSIGNMENT_KEYS } from '../src/constants.js';

export function checkInvariants(w) {
  const { db } = w; const v = [];
  // I1: at most one ACCEPTED offer per booking; assigned booking <=> exactly one ACCEPTED offer by that same driver
  for (const r of db.q(`SELECT booking_id, COUNT(*) n FROM driver_offers WHERE state = 'ACCEPTED' GROUP BY booking_id HAVING n > 1`)) v.push(`I1 double-ACCEPTED offers on booking ${r.booking_id}`);
  for (const b of db.q(`SELECT id, assigned_driver_id FROM bookings WHERE assigned_driver_id IS NOT NULL`)) {
    const acc = db.q(`SELECT driver_id FROM driver_offers WHERE booking_id = ? AND state = 'ACCEPTED'`, b.id);
    if (acc.length !== 1 || acc[0].driver_id !== b.assigned_driver_id) v.push(`I1 booking ${b.id} assigned to ${b.assigned_driver_id} without matching single ACCEPTED offer`);
    // I2: assignment never exists without its required critical audit events; exactly one assignment event
    const ev = (t) => db.q1(`SELECT COUNT(*) n FROM booking_events WHERE booking_id = ? AND event_type = ?`, b.id, t).n;
    if (ev('DRIVER_ASSIGNED') !== 1 || ev('ASSIGNMENT_PERSISTED') !== 1 || ev('DRIVER_DECISION') < 1) v.push(`I2 booking ${b.id} assigned without exactly-one critical audit trail`);
    // I3: no open offer survives on an assigned booking
    if (db.q1(`SELECT COUNT(*) n FROM driver_offers WHERE booking_id = ? AND state IN ('OFFERED','VIEWED')`, b.id).n) v.push(`I3 open offers on assigned booking ${b.id}`);
    // I4: lifecycle events are a gapless prefix of the canonical order, one each
    const stages = db.q(`SELECT event_type FROM booking_events WHERE booking_id = ? AND event_type IN (${LIFECYCLE.map(() => '?').join(',')}) ORDER BY id`, b.id, ...LIFECYCLE).map((x) => x.event_type);
    if (JSON.stringify(stages) !== JSON.stringify(LIFECYCLE.slice(0, stages.length))) v.push(`I4 booking ${b.id} lifecycle out of order: ${stages.join('>')}`);
    // I5: coarse status consistent with the furthest stage
    const last = stages[stages.length - 1]; const st = db.q1(`SELECT status FROM bookings WHERE id = ?`, b.id).status;
    const want = last === 'COMPLETED' ? 'completed' : last === 'DRIVER_ASSIGNED' ? 'accepted' : 'en_route';
    if (st !== want) v.push(`I5 booking ${b.id} status ${st} but stage ${last}`);
  }
  // I6: unassigned bookings are never completed/cancelled by dispatch
  for (const r of db.q(`SELECT id, status FROM bookings WHERE assigned_driver_id IS NULL AND status <> 'pending'`)) v.push(`I6 unassigned booking ${r.id} has status ${r.status}`);
  // I7: financial state untouched
  if (w.walletChecksum() !== w._walletBaseline) v.push('I7 wallet / commission state changed');
  if (db.q1(`SELECT COUNT(*) n FROM wallet_transactions`).n) v.push('I7 wallet_transactions rows exist');
  // I8: no real send ever
  for (const i of w.notifier.intents) if (!i.suppressed || i.real_send) v.push(`I8 non-suppressed send ${i.kind}`);
  // I9: PII never stored in offers / events / attempts
  const blob = JSON.stringify([db.q('SELECT * FROM driver_offers'), db.q('SELECT * FROM booking_events'), db.q('SELECT * FROM driver_broadcast_attempts'), db.q('SELECT * FROM driver_evidence')]);
  for (const c of Object.values(w.canary)) if (blob.includes(c)) v.push(`I9 PII canary stored in offer/event/attempt/evidence tables: ${c}`);
  if (v.length) throw new Error(`INVARIANT VIOLATION(S):\n - ${v.join('\n - ')}`);
  return true;
}

export function assertNoPreAssignmentPII(payload, canary) {
  const s = JSON.stringify(payload);
  for (const c of Object.values(canary)) if (s.includes(c)) throw new Error(`PII canary leaked pre-assignment: ${c}`);
  const walk = (o, p = '') => { if (o && typeof o === 'object') for (const [k, val] of Object.entries(o)) { if (FORBIDDEN_PRE_ASSIGNMENT_KEYS.includes(k)) throw new Error(`forbidden key ${p}${k}`); walk(val, `${p}${k}.`); } };
  walk(payload);
  return true;
}
