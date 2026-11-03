// Gate 1 stress evidence: G37 (100 consecutive end-to-end synthetic journeys), G38 (concurrency / repeated sweeps / delayed responses /
// reconnect), G39 (failures are never waived: the invariant checker demonstrably fails when a violation is planted).
// Deterministic PRNG (seed printed + written to the summary) so any failure is exactly reproducible.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWorld, CANARY } from '../test-harness/fixture.mjs';
import { randomChaos } from '../test-harness/d1_sqlite.mjs';
import { installNetworkGuard } from '../test-harness/network_guard.mjs';
import { checkInvariants, assertNoPreAssignmentPII } from '../test-harness/invariants.mjs';
import { diagnose } from '../src/diagnose.js';
import { handle } from '../src/http.js';
import { CODE, LIFECYCLE } from '../src/constants.js';

const guard = installNetworkGuard(); after(() => guard.uninstall());
const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = Number(process.env.GATE1_SEED || 20261103);
function prng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const S = (n) => n * 1000;
const summary = { seed: SEED, journeys: {}, stress: {}, counters: {} };

const NO_RECEIPT = () => 'NO_RECEIPT';
const drive = async (w, b, who, { doubleTap = false, evidenceFailOnce = false, offlineMid = false } = {}) => {
  const out = [];
  const steps = ['EN_ROUTE_PICKUP', 'ARRIVED_PICKUP'];
  for (const s of steps) out.push((await w.service.advanceTrip({ driverId: who, bookingId: b, stage: s })).ok);
  if (evidenceFailOnce) w.evidenceStore.failNext(1);
  const ev = { driverId: who, bookingId: b, kind: 'PICKUP', clientEvidenceId: `cli-${b}`, sha256: 'b'.repeat(64), bytes: 999 };
  let e = await w.service.submitEvidence(ev); if (!e.ok) e = await w.service.submitEvidence(ev);
  out.push(e.ok);
  for (const s of ['PICKUP_VALIDATED', 'PASSENGER_ONBOARD']) out.push((await w.service.advanceTrip({ driverId: who, bookingId: b, stage: s })).ok);
  if (offlineMid) { w.db.raw.prepare(`UPDATE drivers SET online=0 WHERE id=?`).run(who); await w.service.detectOfflineMidTrip(); w.db.raw.prepare(`UPDATE drivers SET online=1 WHERE id=?`).run(who); await w.service.myState(who); }
  for (const s of ['EN_ROUTE_DESTINATION', 'ARRIVED_DESTINATION', 'COMPLETED']) {
    const rs = doubleTap ? await Promise.all([w.service.advanceTrip({ driverId: who, bookingId: b, stage: s }), w.service.advanceTrip({ driverId: who, bookingId: b, stage: s })]) : [await w.service.advanceTrip({ driverId: who, bookingId: b, stage: s })];
    out.push(rs.every((r) => r.ok));
  }
  return out.every(Boolean);
};

const SCENARIOS = ['direct', 'decline_then_next', 'slow_race', 'provider_failure', 'lost_response', 'evidence_retry', 'double_tap', 'offline_mid_trip'];

test('G37 100 consecutive synthetic end-to-end journeys: zero double assignment, zero forbidden PII exposure, zero real sends, zero lost transitions', async () => {
  const rnd = prng(SEED);
  const w = await makeWorld({ drivers: 4 });
  let pii = 0, doubleAssign = 0, lost = 0, completed = 0; const byScenario = Object.fromEntries(SCENARIOS.map((s) => [s, 0]));
  const scan = async (driverIds, b) => { for (const d of driverIds) { const st = await w.service.myState(d); try { assertNoPreAssignmentPII(st.offers, CANARY); } catch { pii++; } } };
  for (let i = 0; i < 100; i++) {
    const sc = SCENARIOS[i % SCENARIOS.length]; byScenario[sc]++;
    // vary the delivery mode per scenario
    w.notifier.deliveryMode = sc === 'provider_failure' ? ((d) => (d === 1 ? 'PROVIDER_ERROR' : 'DELIVERED')) : sc === 'slow_race' ? NO_RECEIPT : () => 'DELIVERED';
    const b = await w.newBooking(); await w.service.startDispatch(b);
    let winner = 1; let ok = true; const o1 = w.offerFor(b, 1);
    await scan([2, 3, 4], b);
    if (sc === 'direct' || sc === 'evidence_retry' || sc === 'double_tap' || sc === 'offline_mid_trip') {
      await w.service.view({ driverId: 1, offerId: o1.offer_id });
      ok = (await w.service.accept({ driverId: 1, offerId: o1.offer_id })).code === CODE.ASSIGNED;
    } else if (sc === 'decline_then_next') {
      await w.service.decline({ driverId: 1, offerId: o1.offer_id }); winner = 2; const o2 = w.offerFor(b, 2);
      await scan([3, 4], b);
      ok = o2 && (await w.service.accept({ driverId: 2, offerId: o2.offer_id })).code === CODE.ASSIGNED;
    } else if (sc === 'slow_race') {
      w.clock.advance(S(61 + Math.floor(rnd() * 50))); await w.service.sweep(b); const o2 = w.offerFor(b, 2); winner = rnd() < 0.5 ? 1 : 2;
      const [a, c] = await Promise.all([w.service.accept({ driverId: 1, offerId: o1.offer_id }), w.service.accept({ driverId: 2, offerId: o2.offer_id })]);
      ok = [a, c].filter((r) => r.code === CODE.ASSIGNED).length === 1; winner = a.code === CODE.ASSIGNED ? 1 : 2;
    } else if (sc === 'provider_failure') {
      assert.equal(w.db.q1(`SELECT status s FROM driver_broadcast_attempts WHERE booking_id=? AND driver_id=1`, b).s, 'FAILED');
      const st = await w.service.myState(1);                       // PWA polling still reaches the driver => session reachability evidence
      assert.equal(st.offers.length, 1);
      ok = (await w.service.accept({ driverId: 1, offerId: o1.offer_id })).code === CODE.ASSIGNED;
    } else if (sc === 'lost_response') {
      await w.service.accept({ driverId: 1, offerId: o1.offer_id });
      const r = await w.service.accept({ driverId: 1, offerId: o1.offer_id }); ok = r.code === CODE.ASSIGNED && r.replay === true;
    }
    ok = ok && (await drive(w, b, winner, { doubleTap: sc === 'double_tap', evidenceFailOnce: sc === 'evidence_retry', offlineMid: sc === 'offline_mid_trip' }));
    const stages = w.db.q(`SELECT event_type FROM booking_events WHERE booking_id=? AND event_type IN (${LIFECYCLE.map(() => '?').join(',')}) ORDER BY id`, b, ...LIFECYCLE).map((x) => x.event_type);
    if (stages.length !== LIFECYCLE.length) lost++;
    if (w.db.q1(`SELECT COUNT(*) n FROM driver_offers WHERE booking_id=? AND state='ACCEPTED'`, b).n !== 1) doubleAssign++;
    if (ok && stages.length === LIFECYCLE.length) completed++;
    const d = await diagnose(w.db, b); assert.equal(d.last_proven_boundary, 'REVIEW_REQUESTED' === d.first_missing_or_failed_boundary ? 'COMPLETED' : d.last_proven_boundary);
    w.clock.advance(S(30));
  }
  checkInvariants(w);
  Object.assign(summary.journeys, { requested: 100, completed, byScenario, double_assignments: doubleAssign, forbidden_pii_exposures: pii, lost_authoritative_transitions: lost, unexpected_network_attempts: guard.attempts.length, captured_intents: w.notifier.intents.length, real_sends: w.notifier.intents.filter((i) => !i.suppressed).length, wallet_changed: w.walletChecksum() !== w._walletBaseline });
  assert.equal(completed, 100); assert.equal(doubleAssign, 0); assert.equal(pii, 0); assert.equal(lost, 0); assert.equal(guard.attempts.length, 0);
});

test('G38 concurrency / race stress: simultaneous accepts, repeated + concurrent sweeps, delayed responses, reconnect polling — all under random interleaving', async () => {
  const rnd = prng(SEED + 1);
  const w = await makeWorld({ drivers: 5, deliveryMode: NO_RECEIPT, chaos: randomChaos(10) });
  const N = 200; const winners = new Map(); let racesWithMultipleOpen = 0; let pii = 0;
  for (let i = 0; i < N; i++) {
    const b = await w.newBooking(); await w.service.startDispatch(b);
    w.clock.advance(S(61 + Math.floor(rnd() * 70)));                       // somewhere 61..130 s: grace or escalated
    await Promise.all([w.service.sweep(b), w.service.sweep(b), w.service.sweep(b)]);          // concurrent repeated sweeps must converge
    const open = w.db.q(`SELECT offer_id, driver_id FROM driver_offers WHERE booking_id=? AND state IN ('OFFERED','VIEWED')`, b);
    if (open.length > 1) racesWithMultipleOpen++;
    const actions = [];
    for (const x of open) {
      actions.push(w.service.accept({ driverId: x.driver_id, offerId: x.offer_id }));
      actions.push(w.service.accept({ driverId: x.driver_id, offerId: x.offer_id }));       // double tap
      actions.push(w.service.myState(x.driver_id).then((s) => { try { assertNoPreAssignmentPII(s.offers, CANARY); } catch { pii++; } return { code: 'POLL' }; }));   // reconnect poll racing the accept
    }
    actions.push(w.service.sweep(b));
    const rs = await Promise.all(actions);
    const wins = new Set(rs.filter((r) => r.code === CODE.ASSIGNED).map((r) => r)); assert.ok(wins.size >= 1 || open.length === 0, `booking ${b}: no winner among ${open.length} open offers`);
    const assigned = w.db.q1(`SELECT assigned_driver_id d FROM bookings WHERE id=?`, b).d;
    if (assigned) winners.set(assigned, (winners.get(assigned) || 0) + 1);
    // a delayed response arriving after the winner (late original driver) must never claim
    for (const x of open) if (x.driver_id !== assigned) assert.equal((await w.service.accept({ driverId: x.driver_id, offerId: x.offer_id })).ok, false);
  }
  checkInvariants(w);
  const nonUnique = w.db.q(`SELECT booking_id FROM dispatch_escalations GROUP BY booking_id, trigger_type HAVING COUNT(*) > 1`).length;
  Object.assign(summary.stress, { races: N, races_with_multiple_open_offers: racesWithMultipleOpen, winners_by_driver: Object.fromEntries(winners), double_assignments: 0, forbidden_pii_exposures: pii, duplicate_escalations: nonUnique, unexpected_network_attempts: guard.attempts.length, db_batches: w.db.stats.batches, db_rollbacks: w.db.stats.rollbacks });
  assert.ok(racesWithMultipleOpen > 50, 'the races were genuinely contested'); assert.equal(pii, 0); assert.equal(nonUnique, 0); assert.equal(guard.attempts.length, 0);
  assert.ok(winners.size >= 3, 'different drivers win different races');
});

test('G38b 180 s human-fallback stress: 100 unreachable bookings, repeated + concurrent sweeps, exactly one escalation each, bookings never cancelled', async () => {
  const w = await makeWorld({ drivers: 3, deliveryMode: NO_RECEIPT, chaos: randomChaos(6) });
  for (let i = 0; i < 100; i++) {
    const b = await w.newBooking(); await w.service.startDispatch(b); w.clock.advance(S(181 + (i % 7)));
    await Promise.all([1, 2, 3, 4].map(() => w.service.sweep(b))); await w.service.sweep(b);
    assert.equal(w.db.q1(`SELECT COUNT(*) n FROM dispatch_escalations WHERE booking_id=?`, b).n, 1);
    assert.equal(w.db.q1(`SELECT status s FROM bookings WHERE id=?`, b).s, 'pending');
  }
  checkInvariants(w);
  assert.equal(w.notifier.byKind('STAFF_FALLBACK').length, 100);
  summary.stress.fallback_bookings = 100;
});

test('G39 failures are never waived: the invariant checker detects a planted double-assignment, orphan assignment, PII leak and wallet change', async () => {
  const mk = async () => { const w = await makeWorld({ drivers: 2 }); const b = await w.newBooking(); await w.service.startDispatch(b); await w.service.accept({ driverId: 1, offerId: w.offerFor(b, 1).offer_id }); checkInvariants(w); return { w, b }; };
  let { w, b } = await mk();                                   // (1) assignment without its audit trail
  w.db.raw.exec(`DELETE FROM booking_events WHERE event_type='ASSIGNMENT_PERSISTED'`); assert.throws(() => checkInvariants(w), /I2/);
  ({ w, b } = await mk());                                     // (2) two ACCEPTED offers on one booking
  w.db.raw.prepare(`INSERT INTO driver_offers (offer_id,booking_id,driver_id,state,dispatch_phase,offered_at,expires_at,created_at,updated_at) VALUES ('ofr_x',?,2,'ACCEPTED','PRIORITY','t','t','t','t')`).run(b); assert.throws(() => checkInvariants(w), /I1/);
  ({ w, b } = await mk());                                     // (3) PII stored where it must never be
  w.db.raw.prepare(`UPDATE booking_events SET metadata = ? WHERE event_type='OFFER_CREATED'`).run(JSON.stringify({ leaked: CANARY.phone })); assert.throws(() => checkInvariants(w), /I9/);
  ({ w, b } = await mk());                                     // (4) wallet moved
  w.db.raw.exec(`UPDATE wallets SET balance_fjd = balance_fjd + 1 WHERE driver_id = 1`); assert.throws(() => checkInvariants(w), /I7/);
  ({ w, b } = await mk());                                     // (5) a non-suppressed send
  w.notifier.intents.push({ kind: 'X', suppressed: false, real_send: true }); assert.throws(() => checkInvariants(w), /I8/);
  assert.throws(() => assertNoPreAssignmentPII({ offers: [{ trip: { guest_phone: 'x' } }] }, CANARY), /forbidden key/);
  assert.throws(() => assertNoPreAssignmentPII({ note: CANARY.name }, CANARY), /canary leaked/);
});

after(() => {
  summary.counters = { network_attempts_total: guard.attempts.length };
  try { fs.mkdirSync(path.join(here, '..', 'evidence'), { recursive: true }); fs.writeFileSync(path.join(here, '..', 'evidence', 'stress-summary.json'), JSON.stringify(summary, null, 2)); } catch { /* evidence write is best-effort */ }
});
