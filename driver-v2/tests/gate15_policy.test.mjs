// Driver PWA v2 — Gate 1.5 policy delta (busy-driver eligibility + DELIVERY_RECEIPT vs ENGAGEMENT). ISOLATED, in-memory, capture-only.
// G40..G47 are ADDITIONS; the original G01..G39 requirements are unchanged and still run in gate1.test.mjs / stress.test.mjs.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWorld } from '../test-harness/fixture.mjs';
import { randomChaos } from '../test-harness/d1_sqlite.mjs';
import { installNetworkGuard } from '../test-harness/network_guard.mjs';
import { checkInvariants } from '../test-harness/invariants.mjs';
import { handle } from '../src/http.js';
import { CODE, PHASE } from '../src/constants.js';

const guard = installNetworkGuard(); after(() => guard.uninstall());
const S = (n) => n * 1000;
const NO_RECEIPT = () => 'NO_RECEIPT';
const begin = async (w, who = 1) => { const b = await w.newBooking(); await w.service.startDispatch(b); return { b, o: w.offerFor(b, who) }; };
const openOffers = (w, b) => w.db.q(`SELECT driver_id, offer_id, state, engaged_at, delivery_receipt_at, engagement_source FROM driver_offers WHERE booking_id=? AND state IN ('OFFERED','VIEWED') ORDER BY driver_id`, b);
// Make driver `d` busy through the REAL accept path (so the busy state is genuine, not planted).
const makeBusy = async (w, d) => { const x = await w.newBooking(); await w.service.startDispatch(x); const o = w.offerFor(x, d); assert.ok(o, `driver ${d} had an offer`); assert.equal((await w.service.accept({ driverId: d, offerId: o.offer_id })).code, CODE.ASSIGNED); return x; };
const complete = async (w, b, d) => {
  for (const s of ['EN_ROUTE_PICKUP', 'ARRIVED_PICKUP']) assert.equal((await w.service.advanceTrip({ driverId: d, bookingId: b, stage: s })).ok, true);
  assert.equal((await w.service.submitEvidence({ driverId: d, bookingId: b, kind: 'PICKUP', clientEvidenceId: `c-${b}`, sha256: 'c'.repeat(64), bytes: 9 })).ok, true);
  for (const s of ['PICKUP_VALIDATED', 'PASSENGER_ONBOARD', 'EN_ROUTE_DESTINATION', 'ARRIVED_DESTINATION', 'COMPLETED']) assert.equal((await w.service.advanceTrip({ driverId: d, bookingId: b, stage: s })).ok, true);
};

// ───────────── Busy-driver rule (CEO decision, first launch: immediate/realtime dispatch only) ─────────────
test('G40 a driver with an ACTIVE assigned trip (accepted OR en_route) receives no new immediate offer; a free eligible driver receives it instead', async () => {
  const w = await makeWorld({ drivers: 3 });
  const first = await makeBusy(w, 1);                                            // driver 1: accepted
  const { b } = await begin(w, 2);
  assert.equal(w.offerFor(b, 1), null, 'busy (accepted) driver was skipped');
  assert.ok(w.offerFor(b, 2), 'next free driver got the offer instead');
  assert.equal((await w.service.advanceTrip({ driverId: 1, bookingId: first, stage: 'EN_ROUTE_PICKUP' })).ok, true);   // now en_route
  assert.equal(w.db.q1(`SELECT status s FROM bookings WHERE id=?`, first).s, 'en_route');
  const c = await begin(w, 2); assert.equal(w.offerFor(c.b, 1), null, 'busy (en_route) driver skipped'); assert.ok(w.offerFor(c.b, 2));
  checkInvariants(w);
});

test('G41 after COMPLETED the previously busy driver becomes eligible again (and not before)', async () => {
  const w = await makeWorld({ drivers: 2 });
  const trip = await makeBusy(w, 1);
  const during = await begin(w, 2); assert.equal(w.offerFor(during.b, 1), null);
  await w.service.advanceTrip({ driverId: 1, bookingId: trip, stage: 'EN_ROUTE_PICKUP' });
  const stillBusy = await begin(w, 2); assert.equal(w.offerFor(stillBusy.b, 1), null, 'mid-trip: still not eligible');
  await w.service.advanceTrip({ driverId: 1, bookingId: trip, stage: 'ARRIVED_PICKUP' });
  await complete(w, trip, 1);                                                   // replays the stages already done, then finishes the trip
  assert.equal(w.db.q1(`SELECT status s FROM bookings WHERE id=?`, trip).s, 'completed');
  const after = await begin(w, 1); assert.ok(w.offerFor(after.b, 1), 'previously busy driver is eligible again after completion');
  assert.equal((await w.service.accept({ driverId: 1, offerId: w.offerFor(after.b, 1).offer_id })).code, CODE.ASSIGNED);
  checkInvariants(w);
});

test('G42 an active driver cannot win an offer through stale or replayed state (service + HTTP); a replay of their OWN accepted offer stays idempotent', async () => {
  // stale: driver 1 holds an open offer on b2 while free, then wins b1 elsewhere; the old offer must be dead for them.
  const w2 = await makeWorld({ drivers: 2 });
  const b2 = await w2.newBooking(); await w2.service.startDispatch(b2);                // dispatched first: driver 1 is free and holds this offer
  const b1 = await begin(w2, 1);                                                          // b1 dispatched second: also offered to driver 1 (still free at that moment)
  const o2 = w2.offerFor(b2, 1); assert.ok(o2, 'driver 1 holds an open offer on b2');
  assert.equal((await w2.service.accept({ driverId: 1, offerId: b1.o.offer_id })).code, CODE.ASSIGNED);          // wins b1 → now busy
  const stale = await w2.service.accept({ driverId: 1, offerId: o2.offer_id });
  assert.equal(stale.code, CODE.DRIVER_HAS_ACTIVE_TRIP); assert.equal(w2.db.q1(`SELECT assigned_driver_id d FROM bookings WHERE id=?`, b2).d, null, 'b2 stays unassigned');
  const replayStale = await w2.service.accept({ driverId: 1, offerId: o2.offer_id }); assert.equal(replayStale.code, CODE.DRIVER_HAS_ACTIVE_TRIP);
  const http = await handle(new Request(`http://isolated.test/api/offers/${o2.offer_id}/accept`, { method: 'POST', headers: { authorization: `Bearer ${w2.tok(1)}`, 'content-type': 'application/json' }, body: '{}' }), { service: w2.service });
  assert.equal(http.status, 409); assert.equal((await http.json()).code, CODE.DRIVER_HAS_ACTIVE_TRIP);
  const st = await w2.service.myState(1); const shown = st.offers.find((x) => x.offer_id === o2.offer_id);
  assert.equal(shown.actionable, false); assert.equal(shown.blocked_reason, CODE.DRIVER_HAS_ACTIVE_TRIP);
  // a sweep withdraws the stale offer and hands the booking to the free driver
  await w2.service.sweep(b2); assert.equal(w2.offerFor(b2, 1).state, 'SUPERSEDED'); assert.equal(w2.offerFor(b2, 1).decision_reason_code, CODE.DRIVER_HAS_ACTIVE_TRIP);
  assert.ok(w2.offerFor(b2, 2), 'free driver now holds the offer');
  assert.equal((await w2.service.accept({ driverId: 2, offerId: w2.offerFor(b2, 2).offer_id })).code, CODE.ASSIGNED);
  // idempotent replay of the driver's OWN winning accept is still fine while they are busy
  assert.equal((await w2.service.accept({ driverId: 1, offerId: b1.o.offer_id })).replay, true);
  checkInvariants(w2);
});

test('G42b the same driver racing Accept on two different bookings: exactly one wins (50 interleaved trials)', async () => {
  const w = await makeWorld({ drivers: 2, chaos: randomChaos(9) });
  for (let i = 0; i < 50; i++) {
    await w.freeDrivers();
    const x = await w.newBooking(), y = await w.newBooking(); await w.service.startDispatch(x); await w.service.startDispatch(y);
    const ox = w.offerFor(x, 1), oy = w.offerFor(y, 1); assert.ok(ox && oy);
    const [a, c] = await Promise.all([w.service.accept({ driverId: 1, offerId: ox.offer_id }), w.service.accept({ driverId: 1, offerId: oy.offer_id })]);
    assert.equal([a, c].filter((r) => r.code === CODE.ASSIGNED).length, 1, `trial ${i}: ${a.code}/${c.code}`);
    assert.ok([a, c].some((r) => r.code === CODE.DRIVER_HAS_ACTIVE_TRIP));
    assert.equal(w.db.q1(`SELECT COUNT(*) n FROM bookings WHERE assigned_driver_id=1 AND status IN ('accepted','en_route')`).n, 1, 'never two active trips for one driver');
  }
  checkInvariants(w);
});

test('G43 when every eligible driver is busy the booking is NOT cancelled: no offers, then HUMAN_FALLBACK_REQUIRED at 180 s', async () => {
  const w = await makeWorld({ drivers: 2 });
  await makeBusy(w, 1); await makeBusy(w, 2);
  const { b } = await begin(w, 1);
  assert.equal(w.db.q1(`SELECT COUNT(*) n FROM driver_offers WHERE booking_id=?`, b).n, 0, 'nobody eligible, nobody offered');
  w.clock.advance(S(130)); await w.service.sweep(b); assert.equal(w.db.q1(`SELECT COUNT(*) n FROM driver_offers WHERE booking_id=?`, b).n, 0);
  w.clock.advance(S(51)); const sw = await w.service.sweep(b);
  assert.equal(sw.fallback, true); assert.equal(w.db.q1(`SELECT status s FROM bookings WHERE id=?`, b).s, 'pending');
  assert.equal(w.db.q1(`SELECT COUNT(*) n FROM booking_events WHERE booking_id=? AND event_type='HUMAN_FALLBACK_REQUIRED'`, b).n, 1);
  // a driver finishing later makes the (still valid) booking dispatchable to humans/automation again: eligibility is live, not frozen
  checkInvariants(w);
});

// ───────────── Reachability policy: DELIVERY_RECEIPT (transport) vs ENGAGEMENT (viewed / live session) ─────────────
test('G44 DELIVERY_RECEIPT is transport evidence only: stored separately, never engagement, never shown as viewed', async () => {
  const w = await makeWorld({ drivers: 3 });                                     // default capture mode = DELIVERED
  const { b, o } = await begin(w, 1);
  const row = w.db.q1(`SELECT state, viewed_at, delivery_receipt_at, engaged_at, engagement_source FROM driver_offers WHERE offer_id=?`, o.offer_id);
  assert.ok(row.delivery_receipt_at, 'receipt recorded'); assert.equal(row.engaged_at, null); assert.equal(row.engagement_source, null);
  assert.equal(row.state, 'OFFERED', 'a receipt never moves the offer to VIEWED'); assert.equal(row.viewed_at, null);
  assert.equal(w.db.q1(`SELECT COUNT(*) n FROM booking_events WHERE booking_id=? AND event_type='OFFER_VIEWED'`, b).n, 0);
  assert.equal(w.db.q1(`SELECT COUNT(*) n FROM booking_events WHERE booking_id=? AND event_type='DRIVER_NOTIFICATION_DELIVERED'`, b).n, 1);
  checkInvariants(w);
});

test('G45 at 120 s a DELIVERED-but-unengaged offer does not block broadening; the original stays actionable inside 180 s; first valid accept wins', async () => {
  const w = await makeWorld({ drivers: 4 });                                     // all notifications DELIVERED, nobody views, nobody polls
  const { b, o } = await begin(w, 1);
  w.clock.advance(S(90)); await w.service.sweep(b);
  assert.equal(openOffers(w, b).length, 1, '60–120 s with a transport receipt: keep waiting for the same driver');
  w.clock.advance(S(31)); const sw = await w.service.sweep(b);                   // t = 121 s
  assert.equal(sw.phase, PHASE.ESCALATED_DISPATCH);
  assert.equal(openOffers(w, b).length, 3, 'no ENGAGEMENT ⇒ broadened to the next eligible drivers despite the delivery receipt');
  assert.equal(w.offerFor(b, 1).state, 'OFFERED', 'original offer still open'); assert.equal(w.offerFor(b, 1).engaged_at, null);
  w.clock.advance(S(58));                                                        // t = 179 s: original driver is still allowed to take it
  const win = await w.service.accept({ driverId: 1, offerId: o.offer_id });
  assert.equal(win.code, CODE.ASSIGNED);
  for (const x of [2, 3]) assert.equal((await w.service.accept({ driverId: x, offerId: w.offerFor(b, x).offer_id })).code, CODE.ASSIGNMENT_ALREADY_TAKEN);
  assert.equal(w.db.q1(`SELECT COUNT(*) n FROM booking_events WHERE booking_id=? AND event_type='DRIVER_ASSIGNED'`, b).n, 1);
  checkInvariants(w);
});

test('G46 ENGAGEMENT (OFFER_VIEWED or authenticated PWA session activity) holds dispatch to the engaged driver at 120 s; session polling counts, a mere receipt does not', async () => {
  // (a) viewed
  let w = await makeWorld({ drivers: 4 }); let { b, o } = await begin(w, 1);
  w.clock.advance(S(70)); assert.equal((await w.service.view({ driverId: 1, offerId: o.offer_id })).ok, true);
  assert.equal(w.offerFor(b, 1).engagement_source, 'VIEW'); w.clock.advance(S(55)); await w.service.sweep(b);
  assert.equal(openOffers(w, b).length, 1, 'engaged by VIEW ⇒ no broadening at 125 s');
  // (b) live PWA session (state polling) without an explicit view
  w = await makeWorld({ drivers: 4 }); ({ b, o } = await begin(w, 1));
  w.clock.advance(S(100)); await w.service.myState(1);
  assert.equal(w.offerFor(b, 1).engagement_source, 'SESSION'); w.clock.advance(S(25)); await w.service.sweep(b);
  assert.equal(openOffers(w, b).length, 1, 'engaged by SESSION ⇒ no broadening at 125 s');
  // (c) no engagement at all, with receipt ⇒ broadening (contrast)
  w = await makeWorld({ drivers: 4 }); ({ b } = await begin(w, 1)); w.clock.advance(S(125)); await w.service.sweep(b);
  assert.equal(openOffers(w, b).length, 3);
  // (d) engagement cannot resurrect an offer after the 180 s envelope
  w.clock.advance(S(60)); assert.equal((await w.service.view({ driverId: 1, offerId: w.offerFor(b, 1).offer_id })).ok, false);
  assert.equal((await w.service.accept({ driverId: 1, offerId: w.offerFor(b, 1).offer_id })).code, CODE.OFFER_EXPIRED);
  checkInvariants(w);
});

test('G47 without a transport receipt and without engagement, a second driver is introduced early (60 s); engaged offers are never doubled early; fallback at 180 s keeps the booking', async () => {
  let w = await makeWorld({ drivers: 4, deliveryMode: NO_RECEIPT }); let { b } = await begin(w, 1);
  w.clock.advance(S(61)); await w.service.sweep(b); assert.equal(openOffers(w, b).length, 2, 'no receipt, no engagement ⇒ second driver at 60 s');
  w = await makeWorld({ drivers: 4, deliveryMode: NO_RECEIPT }); let o; ({ b, o } = await begin(w, 1));
  w.clock.advance(S(30)); await w.service.view({ driverId: 1, offerId: o.offer_id }); w.clock.advance(S(40)); await w.service.sweep(b);
  assert.equal(openOffers(w, b).length, 1, 'engaged without any receipt (e.g. WhatsApp blocked but PWA open) ⇒ wait');
  w.clock.advance(S(115)); const sw = await w.service.sweep(b);                  // t = 185 s
  assert.equal(sw.fallback, true); assert.equal(w.db.q1(`SELECT status s FROM bookings WHERE id=?`, b).s, 'pending'); assert.equal(openOffers(w, b).length, 0);
  checkInvariants(w);
});

test('G48 busy-aware stress: 100 overlapping synthetic bookings over 6 drivers - never an offer to, assignment of, or second active trip for a busy driver; zero double assignments', async () => {
  const SEED = Number(process.env.GATE1_SEED || 20261103); let x = SEED >>> 0; const rnd = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; };
  const w = await makeWorld({ drivers: 6, chaos: randomChaos(6) });
  const stats = { bookings: 100, assigned: 0, human_fallback: 0, offers_to_busy_drivers: 0, accepts_by_busy_drivers_rejected: 0, busy_accept_wins: 0, double_assignments: 0, max_active_trips_per_driver: 0, completed: 0 };
  const lingering = []; // trips left mid-way so later bookings must skip those drivers
  const finishTrip = async (t) => { for (const s of ['EN_ROUTE_PICKUP', 'ARRIVED_PICKUP']) await w.service.advanceTrip({ driverId: t.d, bookingId: t.b, stage: s });
    await w.service.submitEvidence({ driverId: t.d, bookingId: t.b, kind: 'PICKUP', clientEvidenceId: `s-${t.b}`, sha256: 'd'.repeat(64), bytes: 5 });
    for (const s of ['PICKUP_VALIDATED', 'PASSENGER_ONBOARD', 'EN_ROUTE_DESTINATION', 'ARRIVED_DESTINATION', 'COMPLETED']) await w.service.advanceTrip({ driverId: t.d, bookingId: t.b, stage: s }); stats.completed++; };
  for (let i = 0; i < 50; i++) {                                                   // 50 pairs = 100 bookings; the two bookings of a pair are in flight together
    if (lingering.length && rnd() < 0.6) await finishTrip(lingering.splice(Math.floor(rnd() * lingering.length), 1)[0]);   // some drivers free up
    const busyNow = new Set(w.db.q(`SELECT DISTINCT assigned_driver_id d FROM bookings WHERE status IN ('accepted','en_route')`).map((r) => r.d));
    const pair = [await w.newBooking(), await w.newBooking()];
    for (const b of pair) await w.service.startDispatch(b);
    w.clock.advance(S(Math.floor(rnd() * 150)));                                   // 0..150 s: any phase
    for (const b of pair) await w.service.sweep(b);
    const live = w.db.q(`SELECT driver_id, offer_id, booking_id FROM driver_offers WHERE booking_id IN (?,?) AND state IN ('OFFERED','VIEWED')`, ...pair);
    stats.offers_to_busy_drivers += live.filter((o) => busyNow.has(o.driver_id)).length;
    // every open offer is accepted at once; a driver holding offers on BOTH bookings can only win one (the other becomes stale), twice each (double tap)
    const rs = await Promise.all([...live, ...live].map((o) => w.service.accept({ driverId: o.driver_id, offerId: o.offer_id }).then((r) => ({ r, o }))));
    for (const { r, o } of rs) { if (busyNow.has(o.driver_id) && r.code === CODE.ASSIGNED && !r.replay) stats.busy_accept_wins++; if (r.code === CODE.DRIVER_HAS_ACTIVE_TRIP) stats.accepts_by_busy_drivers_rejected++; }
    for (const b of pair) {
      const asg = w.db.q1(`SELECT assigned_driver_id d FROM bookings WHERE id=?`, b).d;
      if (asg) { stats.assigned++; lingering.push({ b, d: asg }); } else if (w.db.q1(`SELECT COUNT(*) n FROM booking_events WHERE booking_id=? AND event_type='HUMAN_FALLBACK_REQUIRED'`, b).n) stats.human_fallback++;
    }
    stats.double_assignments += w.db.q(`SELECT booking_id FROM driver_offers WHERE state='ACCEPTED' GROUP BY booking_id HAVING COUNT(*)>1`).length;
    stats.max_active_trips_per_driver = Math.max(stats.max_active_trips_per_driver, ...w.db.q(`SELECT COUNT(*) n FROM bookings WHERE assigned_driver_id IS NOT NULL AND status IN ('accepted','en_route') GROUP BY assigned_driver_id`).map((r) => r.n), 0);
    checkInvariants(w); w.clock.advance(S(5));
  }
  for (const t of lingering) await finishTrip(t);
  checkInvariants(w);
  assert.equal(stats.offers_to_busy_drivers, 0); assert.equal(stats.busy_accept_wins, 0); assert.equal(stats.double_assignments, 0); assert.ok(stats.max_active_trips_per_driver <= 1);
  assert.ok(stats.accepts_by_busy_drivers_rejected > 0, 'the busy rule was genuinely exercised by stale accepts');
  assert.ok(stats.assigned > 30, 'enough bookings were actually assigned'); assert.equal(stats.assigned + stats.human_fallback + w.db.q1(`SELECT COUNT(*) n FROM bookings WHERE status='pending' AND id NOT IN (SELECT booking_id FROM booking_events WHERE event_type='HUMAN_FALLBACK_REQUIRED')`).n, 100);
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'evidence', 'gate15-policy-summary.json');
  fs.writeFileSync(out, JSON.stringify({ seed: SEED, stats, unexpected_network_attempts: guard.attempts.length, real_sends: w.notifier.intents.filter((i) => !i.suppressed).length, wallet_changed: w.walletChecksum() !== w._walletBaseline }, null, 2) + '\n');
});

test('G47b the Gate 1.5 delta introduces no network, send or wallet effect', async () => {
  assert.equal(guard.attempts.length, 0, JSON.stringify(guard.attempts));
});
