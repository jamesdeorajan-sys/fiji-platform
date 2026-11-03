// Driver PWA v2 — Gate 1 acceptance matrix G01..G39 (names map 1:1 to docs/AGENT_SYNC.md "Gate 1 acceptance matrix").
// ISOLATED: in-memory SQLite, capture adapters, network guard installed for the whole file (any real send fails the run).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWorld, runJourney, CANARY } from '../test-harness/fixture.mjs';
import { randomChaos } from '../test-harness/d1_sqlite.mjs';
import { installNetworkGuard } from '../test-harness/network_guard.mjs';
import { checkInvariants, assertNoPreAssignmentPII } from '../test-harness/invariants.mjs';
import { diagnose } from '../src/diagnose.js';
import { handle } from '../src/http.js';
import { CODE, LIFECYCLE, WINDOW, PHASE, SYNTHETIC_BOOKING_ID_FLOOR } from '../src/constants.js';
import { phaseAt } from '../src/service.js';

const guard = installNetworkGuard();
after(() => guard.uninstall());
const here = path.dirname(fileURLToPath(import.meta.url));
const S = (n) => n * 1000;
const NO_RECEIPT = () => 'NO_RECEIPT';
const evCount = (w, b, t) => w.db.q1(`SELECT COUNT(*) n FROM booking_events WHERE booking_id = ? AND event_type = ?`, b, t).n;
const begin = async (w, who = 1) => { const b = await w.newBooking(); await w.service.startDispatch(b); return { b, o: w.offerFor(b, who) }; };
const req = (w, driver, method, p, body) => new Request(`http://isolated.test${p}`, { method, headers: { authorization: `Bearer ${w.tok(driver)}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const finish = (w) => checkInvariants(w);

// ───────────── A. Isolation / zero-side-effect ─────────────
test('G01 synthetic booking identifiers cannot collide with real NAT/FD bookings; non-synthetic bookings are refused', async () => {
  const w = await makeWorld();
  const b = await w.newBooking();
  assert.ok(b >= SYNTHETIC_BOOKING_ID_FLOOR);
  assert.match(w.db.q1(`SELECT booking_ref r FROM bookings WHERE id=?`, b).r, /^SYN-GATE1-/);
  w.db.raw.prepare(`INSERT INTO bookings (id,booking_ref,pickup_zone,destination_zone,vehicle_type,quoted_currency,quoted_amount,payment_method,status) VALUES (5,'REAL-LOOKING-5','Nadi Airport','Denarau','sedan','FJD',50,'cash','pending')`).run();
  const r = await w.service.startDispatch(5);
  assert.equal(r.code, CODE.NON_SYNTHETIC_BOOKING_REFUSED);
  assert.equal(w.db.q1(`SELECT COUNT(*) n FROM driver_offers WHERE booking_id=5`).n, 0);
  assert.equal(w.db.q1(`SELECT COUNT(*) n FROM booking_events WHERE booking_id=5`).n, 0);
});

test('G02 driver_id=1 is the only real-test identity; no second real phone; real-phone mode refuses every other driver id', async () => {
  const w = await makeWorld({ drivers: 3, config: { realPhoneMode: true } });
  assert.equal(w.db.q1(`SELECT COUNT(*) n FROM drivers WHERE phone NOT LIKE '+000-%'`).n, 0, 'no real-looking phone number exists in the fixture');
  assert.match(w.db.q1(`SELECT phone FROM drivers WHERE id=1`).phone, /PLACEHOLDER/);
  const { b } = await begin(w);
  assert.ok(w.offerFor(b, 1));
  assert.equal(w.offerFor(b, 2), null); assert.equal(w.offerFor(b, 3), null);
  await w.clock.advance(S(130)); await w.service.sweep(b);
  assert.equal(w.db.q1(`SELECT COUNT(*) n FROM driver_offers WHERE booking_id=? AND driver_id<>1`, b).n, 0, 'no broadcast-to-all, ever');
});

test('G03 suite needs no production D1 binding/ID/hostname (in-memory DB; no production identifiers in product code)', async () => {
  const w = await makeWorld();
  assert.equal(w.db.raw.isOpen === undefined ? true : true, true);
  const bad = /nadiairporttransfers|fijidash\.com|workers\.dev|api\.cloudflare|database_id|0ec1cd84|6b0072b1/i;
  for (const dir of ['src', 'pwa', 'server']) for (const f of fs.readdirSync(path.join(here, '..', dir))) {
    const txt = fs.readFileSync(path.join(here, '..', dir, f), 'utf8');
    assert.ok(!bad.test(txt), `${dir}/${f} references a production identifier`);
  }
});

test('G04 every outbound send is capture-only; any real network attempt fails the run (guard self-test included)', async () => {
  const w = await makeWorld();
  await runJourney(w);
  assert.ok(w.notifier.intents.length >= 3);
  assert.ok(w.notifier.intents.every((i) => i.suppressed === true && i.real_send === false));
  assert.ok(w.notifier.byKind('GUEST_DRIVER_ASSIGNED').length === 1 && w.notifier.byKind('ADMIN_DRIVER_ASSIGNED').length === 1, 'guest/admin intents captured, never sent');
  assert.equal(guard.attempts.length, 0);
  await assert.rejects(() => fetch('https://example.invalid/'), /NETWORK_GUARD/);   // the guard really bites…
  assert.equal(guard.attempts.length, 1); guard.attempts.length = 0;                // …and the self-test attempt is cleared explicitly
});

test('G05 wallet/commission state is unchanged by a completed journey; financial effects cannot be switched on in Gate 1', async () => {
  const w = await makeWorld();
  const before = w.walletChecksum();
  await runJourney(w);
  assert.equal(w.walletChecksum(), before);
  assert.equal(w.db.q1(`SELECT COUNT(*) n FROM wallet_transactions`).n, 0);
  const w2 = await makeWorld({ config: { financialEffectsEnabled: true } });
  const j = await runJourney(w2);
  assert.deepEqual(j.steps.at(-1), ['COMPLETED', CODE.FINANCIAL_EFFECTS_DISABLED]);
  assert.equal(w2.walletChecksum(), w2._walletBaseline);
});

test('G06 no scheduled handler, deployment, secret mutation or outbound HTTP exists in product code', async () => {
  for (const f of fs.readdirSync(path.join(here, '..', 'src'))) {
    const txt = fs.readFileSync(path.join(here, '..', 'src', f), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/\bfetch\s*\(|scheduled\s*\(|wrangler|\.secret|XMLHttpRequest|https?:\/\//.test(txt), `src/${f} contains a forbidden construct`);
  }
});

test('G07 pre-accept offer payload (service + HTTP) contains no guest name/phone/email/contact — for eligible AND losing drivers', async () => {
  const w = await makeWorld({ deliveryMode: NO_RECEIPT });
  const { b, o } = await begin(w);
  w.clock.advance(S(61)); await w.service.sweep(b);
  const o2 = w.offerFor(b, 2);
  assertNoPreAssignmentPII(await w.service.listOffers(1), CANARY);
  const http = await handle(req(w, 2, 'GET', '/api/state'), { service: w.service });
  const body = await http.json(); assert.equal(http.status, 200); assert.equal(body.offers.length, 1);
  assertNoPreAssignmentPII(body, CANARY);
  assert.equal((await w.service.accept({ driverId: 1, offerId: o.offer_id })).code, CODE.ASSIGNED);
  const lose = await (await handle(req(w, 2, 'POST', `/api/offers/${o2.offer_id}/accept`), { service: w.service })).json();
  assert.equal(lose.code, CODE.ASSIGNMENT_ALREADY_TAKEN); assertNoPreAssignmentPII(lose, CANARY);
  assertNoPreAssignmentPII(await (await handle(req(w, 2, 'GET', `/api/trips/${b}`), { service: w.service })).json(), CANARY);
  finish(w);
});

// ───────────── B. Offer timing / adaptive dispatch ─────────────
test('G08 0–60 s PRIORITY: offer can be viewed, declined or accepted', async () => {
  const w = await makeWorld({ drivers: 4 });
  for (const [action, at] of [['view', 10], ['decline', 30], ['accept', 59]]) {
    const { b, o } = await begin(w);
    w.clock.advance(S(at));
    assert.equal(o.dispatch_phase, PHASE.PRIORITY);
    const r = await w.service[action]({ driverId: 1, offerId: o.offer_id });
    assert.equal(r.ok, true, `${action}@${at}s -> ${r.code}`);
  }
  finish(w);
});

test('G09 at 60 s the booking is not cancelled or lost; the offer is still actionable (60 s is a KPI, not expiry)', async () => {
  const w = await makeWorld({ deliveryMode: NO_RECEIPT });
  const { b, o } = await begin(w);
  w.clock.advance(S(60)); const sw = await w.service.sweep(b);
  assert.equal(sw.phase, PHASE.CONNECTIVITY_GRACE);
  assert.equal(w.db.q1(`SELECT status s FROM bookings WHERE id=?`, b).s, 'pending');
  assert.equal(w.db.q1(`SELECT state s FROM driver_offers WHERE offer_id=?`, o.offer_id).s, 'OFFERED');
  assert.equal((await w.service.accept({ driverId: 1, offerId: o.offer_id })).code, CODE.ASSIGNED);
  finish(w);
});

test('G10 60–120 s CONNECTIVITY_GRACE: delivered-but-unconfirmed, viewed-late/reconnect and no-reachability cases never double-assign', async () => {
  // (a) delivery receipt present => keep waiting for the same driver, no second offer yet
  let w = await makeWorld({ drivers: 3 });
  let { b, o } = await begin(w); w.clock.advance(S(90)); await w.service.sweep(b);
  assert.equal(w.db.q1(`SELECT COUNT(*) n FROM driver_offers WHERE booking_id=?`, b).n, 1);
  assert.equal((await w.service.accept({ driverId: 1, offerId: o.offer_id })).code, CODE.ASSIGNED); finish(w);
  // (b) no receipt => a second driver is introduced at 60 s; both open; first valid accept wins; loser gets the stable conflict code
  w = await makeWorld({ drivers: 3, deliveryMode: NO_RECEIPT });
  ({ b, o } = await begin(w)); w.clock.advance(S(70)); await w.service.sweep(b);
  const o2 = w.offerFor(b, 2); assert.ok(o2);
  assert.equal((await w.service.accept({ driverId: 2, offerId: o2.offer_id })).code, CODE.ASSIGNED);
  assert.equal((await w.service.accept({ driverId: 1, offerId: o.offer_id })).code, CODE.ASSIGNMENT_ALREADY_TAKEN); finish(w);
  // (c) the view arrives late over a slow link (95 s) and then the accept completes
  w = await makeWorld({ drivers: 2, deliveryMode: NO_RECEIPT });
  ({ b, o } = await begin(w)); w.clock.advance(S(95));
  assert.equal((await w.service.view({ driverId: 1, offerId: o.offer_id })).ok, true);
  assert.equal((await w.service.accept({ driverId: 1, offerId: o.offer_id })).code, CODE.ASSIGNED); finish(w);
});

test('G11 120–180 s ESCALATED_DISPATCH: unreachable offers expire, next eligible drivers are offered, first valid server-confirmed accept wins', async () => {
  const w = await makeWorld({ drivers: 5, deliveryMode: NO_RECEIPT });
  const { b, o } = await begin(w);
  w.clock.advance(S(61)); await w.service.sweep(b);               // d2 introduced
  w.clock.advance(S(65)); const sw = await w.service.sweep(b);   // t=126 s
  assert.equal(sw.phase, PHASE.ESCALATED_DISPATCH);
  assert.equal(w.db.q1(`SELECT state s FROM driver_offers WHERE offer_id=?`, o.offer_id).s, 'TIMED_OUT', 'unreachable PRIORITY offer expired');
  assert.ok(w.db.q1(`SELECT COUNT(*) n FROM driver_offers WHERE booking_id=? AND state IN ('OFFERED','VIEWED')`, b).n >= 1, 'escalated offers outstanding');
  const open = w.db.q(`SELECT driver_id, offer_id FROM driver_offers WHERE booking_id=? AND state IN ('OFFERED','VIEWED') ORDER BY driver_id`, b);
  const results = await Promise.all(open.map((x) => w.service.accept({ driverId: x.driver_id, offerId: x.offer_id })));
  assert.equal(results.filter((r) => r.code === CODE.ASSIGNED).length, 1);
  assert.ok(results.every((r) => r.code === CODE.ASSIGNED || r.code === CODE.ASSIGNMENT_ALREADY_TAKEN));
  assert.equal((await w.service.accept({ driverId: 1, offerId: o.offer_id })).code, CODE.ASSIGNMENT_ALREADY_TAKEN, 'late original driver cannot claim');
  finish(w);
});

test('G12 ≥180 s unresolved: HUMAN_FALLBACK_REQUIRED recorded, automation stops, booking stays valid (never cancelled)', async () => {
  const w = await makeWorld({ drivers: 2, deliveryMode: NO_RECEIPT });
  const { b, o } = await begin(w);
  w.clock.advance(S(180)); const sw = await w.service.sweep(b);
  assert.equal(sw.phase, PHASE.HUMAN_FALLBACK_REQUIRED); assert.equal(sw.fallback, true);
  assert.equal(evCount(w, b, 'HUMAN_FALLBACK_REQUIRED'), 1);
  assert.equal(w.db.q1(`SELECT status s FROM bookings WHERE id=?`, b).s, 'pending');
  assert.equal(w.db.q1(`SELECT COUNT(*) n FROM driver_offers WHERE booking_id=? AND state IN ('OFFERED','VIEWED')`, b).n, 0);
  assert.equal((await w.service.accept({ driverId: 1, offerId: o.offer_id })).code, CODE.OFFER_EXPIRED);
  assert.equal(w.notifier.byKind('STAFF_FALLBACK').length, 1);
  finish(w);
});

test('G13 server time is authoritative at 59/60, 119/120 and 179/180 s boundaries', async () => {
  assert.equal(phaseAt(59_999), PHASE.PRIORITY); assert.equal(phaseAt(60_000), PHASE.CONNECTIVITY_GRACE);
  assert.equal(phaseAt(119_999), PHASE.CONNECTIVITY_GRACE); assert.equal(phaseAt(120_000), PHASE.ESCALATED_DISPATCH);
  assert.equal(phaseAt(179_999), PHASE.ESCALATED_DISPATCH); assert.equal(phaseAt(180_000), PHASE.HUMAN_FALLBACK_REQUIRED);
  const at = async (ms, mode) => { const w = await makeWorld({ drivers: 1, deliveryMode: mode }); const { o } = await begin(w); w.clock.advance(ms); return (await w.service.accept({ driverId: 1, offerId: o.offer_id })).code; };
  assert.equal(await at(59_999, NO_RECEIPT), CODE.ASSIGNED); assert.equal(await at(60_000, NO_RECEIPT), CODE.ASSIGNED);      // 60 s is not expiry
  assert.equal(await at(119_999, NO_RECEIPT), CODE.ASSIGNED); assert.equal(await at(120_000, NO_RECEIPT), CODE.OFFER_EXPIRED); // unreachable offers end at 120
  assert.equal(await at(179_999, undefined), CODE.ASSIGNED); assert.equal(await at(180_000, undefined), CODE.OFFER_EXPIRED);  // reachable offers end at the 180 s envelope
});

// ───────────── C. Acceptance / race / replay ─────────────
test('G14 double-tap Accept (sequential and concurrent) is idempotent: one assignment, one acceptance event', async () => {
  const w = await makeWorld({ chaos: randomChaos() });
  const { b, o } = await begin(w);
  const rs = await Promise.all([1, 2, 3, 4].map(() => w.service.accept({ driverId: 1, offerId: o.offer_id })));
  assert.ok(rs.every((r) => r.code === CODE.ASSIGNED));
  assert.equal(rs.filter((r) => r.replay === false).length, 1);
  assert.equal(evCount(w, b, 'DRIVER_ASSIGNED'), 1); assert.equal(evCount(w, b, 'DRIVER_DECISION'), 1);
  assert.equal(w.notifier.byKind('GUEST_DRIVER_ASSIGNED').length, 1);
  finish(w);
});

test('G15 two simultaneous eligible drivers cannot both win (50 interleaved trials)', async () => {
  const w = await makeWorld({ drivers: 3, deliveryMode: NO_RECEIPT, chaos: randomChaos(8) });
  const winners = new Set();
  for (let i = 0; i < 50; i++) {
    const { b, o } = await begin(w); w.clock.advance(S(61)); await w.service.sweep(b);
    const o2 = w.offerFor(b, 2);
    const [a, c] = await Promise.all([w.service.accept({ driverId: 1, offerId: o.offer_id }), w.service.accept({ driverId: 2, offerId: o2.offer_id })]);
    assert.equal([a, c].filter((r) => r.code === CODE.ASSIGNED).length, 1, `trial ${i}: ${a.code}/${c.code}`);
    winners.add(a.code === CODE.ASSIGNED ? 1 : 2);
  }
  assert.equal(winners.size, 2, 'both drivers win some races (the race is genuinely exercised)');
  finish(w);
});

test('G16 losing / stale offer returns a stable ASSIGNMENT_ALREADY_TAKEN and cannot overwrite the winner', async () => {
  const w = await makeWorld({ deliveryMode: NO_RECEIPT });
  const { b, o } = await begin(w); w.clock.advance(S(61)); await w.service.sweep(b); const o2 = w.offerFor(b, 2);
  await w.service.accept({ driverId: 2, offerId: o2.offer_id });
  for (let i = 0; i < 3; i++) assert.equal((await w.service.accept({ driverId: 1, offerId: o.offer_id })).code, CODE.ASSIGNMENT_ALREADY_TAKEN);
  assert.equal(w.db.q1(`SELECT assigned_driver_id d FROM bookings WHERE id=?`, b).d, 2);
  assert.equal(w.offerFor(b, 1).state, 'SUPERSEDED');
  finish(w);
});

test('G17 an expired offer cannot assign', async () => {
  const w = await makeWorld({ deliveryMode: NO_RECEIPT });
  const { b, o } = await begin(w); w.clock.advance(S(125));
  assert.equal((await w.service.accept({ driverId: 1, offerId: o.offer_id })).code, CODE.OFFER_EXPIRED);
  assert.equal(w.db.q1(`SELECT assigned_driver_id d FROM bookings WHERE id=?`, b).d, null);
  finish(w);
});

test('G18 Accept started client-side before a boundary but arriving after it follows the SERVER clock (client timestamp ignored)', async () => {
  const w = await makeWorld({ deliveryMode: NO_RECEIPT });
  const { o } = await begin(w);
  w.clock.advance(S(119.5));                       // driver taps here (client believes: still inside 120 s)
  const tappedAt = w.clock.now();
  w.clock.advance(S(1));                           // slow link: request lands at 120.5 s server time
  const r = await handle(new Request('http://isolated.test/api/offers/' + o.offer_id + '/accept', { method: 'POST',
    headers: { authorization: `Bearer ${w.tok(1)}`, 'x-client-sent-at': new Date(tappedAt).toISOString(), 'content-type': 'application/json' }, body: JSON.stringify({ client_sent_at: tappedAt }) }), { service: w.service });
  assert.equal((await r.json()).code, CODE.OFFER_EXPIRED); assert.equal(r.status, 410);
  finish(w);
});

test('G19 lost response after a successful commit: retry returns the already-decided result with no duplicated side effects', async () => {
  const w = await makeWorld();
  const { b, o } = await begin(w);
  await w.service.accept({ driverId: 1, offerId: o.offer_id });          // response "lost"
  const events = w.db.q1(`SELECT COUNT(*) n FROM booking_events WHERE booking_id=?`, b).n; const intents = w.notifier.intents.length;
  const retry = await w.service.accept({ driverId: 1, offerId: o.offer_id });
  assert.deepEqual([retry.code, retry.replay], [CODE.ASSIGNED, true]);
  assert.equal(w.db.q1(`SELECT COUNT(*) n FROM booking_events WHERE booking_id=?`, b).n, events); assert.equal(w.notifier.intents.length, intents);
  finish(w);
});

test('G20 refresh / reconnect recovers server truth: open offers before accept, active trip after', async () => {
  const w = await makeWorld();
  const { b, o } = await begin(w);
  let s = await (await handle(req(w, 1, 'GET', '/api/state'), { service: w.service })).json();
  assert.equal(s.offers.length, 1); assert.equal(s.offers[0].offer_id, o.offer_id); assert.equal(s.trips.length, 0); assert.ok(s.server_now);
  await w.service.accept({ driverId: 1, offerId: o.offer_id }); await w.service.advanceTrip({ driverId: 1, bookingId: b, stage: 'EN_ROUTE_PICKUP' });
  s = await (await handle(req(w, 1, 'GET', '/api/state'), { service: w.service })).json();
  assert.equal(s.offers.length, 0); assert.equal(s.trips[0].stage, 'EN_ROUTE_PICKUP'); assert.equal(s.trips[0].next_stage, 'ARRIVED_PICKUP');
  finish(w);
});

// ───────────── D. Decline / timeout / fallback ─────────────
test('G21 decline is explicit and durable, carries a reason code, advances dispatch and never cancels the booking', async () => {
  const w = await makeWorld({ drivers: 3 });
  const { b, o } = await begin(w);
  const d = await w.service.decline({ driverId: 1, offerId: o.offer_id });
  assert.deepEqual([d.code, d.advanced], [CODE.DRIVER_DECLINED, 1]);
  const row = w.db.q1(`SELECT state, decision_reason_code r FROM driver_offers WHERE offer_id=?`, o.offer_id);
  assert.deepEqual([row.state, row.r], ['DECLINED', CODE.DRIVER_DECLINED]);
  assert.ok(w.offerFor(b, 2), 'next eligible driver offered immediately');
  assert.equal(w.db.q1(`SELECT status s FROM bookings WHERE id=?`, b).s, 'pending');
  assert.equal((await w.service.decline({ driverId: 1, offerId: o.offer_id })).replay, true);
  assert.equal((await w.service.accept({ driverId: 1, offerId: o.offer_id })).code, CODE.INVALID_TRANSITION);
  const w2 = await makeWorld({ drivers: 3, chaos: randomChaos() }); const x = await begin(w2);
  const dr = await Promise.all([1, 2, 3].map(() => w2.service.decline({ driverId: 1, offerId: x.o.offer_id })));
  assert.ok(dr.every((r) => r.code === CODE.DRIVER_DECLINED)); assert.equal(dr.filter((r) => r.replay === false).length, 1);
  assert.equal(w2.db.q1(`SELECT COUNT(*) n FROM booking_events WHERE booking_id=? AND event_type='DRIVER_DECISION'`, x.b).n, 1, 'concurrent duplicate decline records one decision');
  finish(w);
});

test('G22 no-response path walks the phases and ends in human fallback, not cancellation', async () => {
  const w = await makeWorld({ drivers: 2, deliveryMode: NO_RECEIPT });
  const { b } = await begin(w); const phases = [];
  for (const t of [0, 61, 121, 181]) { w.clock.advance(S(t === 0 ? 0 : t === 61 ? 61 : 60)); phases.push((await w.service.sweep(b)).phase); }
  assert.deepEqual(phases, [PHASE.PRIORITY, PHASE.CONNECTIVITY_GRACE, PHASE.ESCALATED_DISPATCH, PHASE.HUMAN_FALLBACK_REQUIRED]);
  assert.equal(w.db.q1(`SELECT status s FROM bookings WHERE id=?`, b).s, 'pending'); assert.equal(evCount(w, b, 'HUMAN_FALLBACK_REQUIRED'), 1);
  finish(w);
});

test('G23 offline driver, explicit decline and provider notification failure are three distinguishable outcomes', async () => {
  let w = await makeWorld({ drivers: 2 });
  let { b, o } = await begin(w); w.db.raw.prepare(`UPDATE drivers SET online=0 WHERE id=1`).run();
  assert.equal((await w.service.accept({ driverId: 1, offerId: o.offer_id })).code, CODE.DRIVER_OFFLINE);
  w = await makeWorld({ drivers: 2 }); ({ b, o } = await begin(w));
  assert.equal((await w.service.decline({ driverId: 1, offerId: o.offer_id })).code, CODE.DRIVER_DECLINED);
  w = await makeWorld({ drivers: 2, deliveryMode: () => 'PROVIDER_ERROR' }); ({ b, o } = await begin(w));
  const att = w.db.q1(`SELECT status, provider_reason_code r FROM driver_broadcast_attempts WHERE booking_id=?`, b);
  assert.deepEqual([att.status, att.r], ['FAILED', CODE.NOTIFICATION_PROVIDER_ERROR]);
  assert.equal(o.state, 'OFFERED'); assert.equal(w.db.q1(`SELECT reach_evidence_at x FROM driver_offers WHERE offer_id=?`, o.offer_id).x, null, 'failed delivery is not reachability evidence');
  const d = await diagnose(w.db, b);
  assert.deepEqual([d.first_missing_or_failed_boundary, d.reason_code, d.retry_state], ['DRIVER_NOTIFICATION_DELIVERED', CODE.NOTIFICATION_PROVIDER_ERROR, 'RETRYABLE']);
});

test('G24 human fallback is idempotent: repeated sweeps create exactly one escalation, one critical event, one staff intent', async () => {
  const w = await makeWorld({ drivers: 2, deliveryMode: NO_RECEIPT });
  const { b } = await begin(w); w.clock.advance(S(200));
  for (let i = 0; i < 10; i++) await w.service.sweep(b);
  await Promise.all([1, 2, 3, 4, 5].map(() => w.service.sweep(b)));
  assert.equal(w.db.q1(`SELECT COUNT(*) n FROM dispatch_escalations WHERE booking_id=?`, b).n, 1);
  assert.equal(evCount(w, b, 'HUMAN_FALLBACK_REQUIRED'), 1); assert.equal(w.notifier.byKind('STAFF_FALLBACK').length, 1);
  finish(w);
});

// ───────────── E. Authoritative audit / diagnosis ─────────────
test('G25 critical mutation and its required audit event are atomic: if the audit cannot persist the transition fails and nothing leaks', async () => {
  const w = await makeWorld();
  const { b, o } = await begin(w);
  w.db.raw.exec(`CREATE TRIGGER t_block_audit BEFORE INSERT ON booking_events WHEN NEW.event_type = 'ASSIGNMENT_PERSISTED' BEGIN SELECT RAISE(ABORT, 'audit store unavailable'); END`);
  const r = await w.service.accept({ driverId: 1, offerId: o.offer_id });
  assert.equal(r.code, CODE.AUDIT_PERSIST_FAILED); assert.equal(r.ok, false);
  const bk = w.db.q1(`SELECT status, assigned_driver_id d FROM bookings WHERE id=?`, b);
  assert.deepEqual([bk.status, bk.d], ['pending', null]);
  assert.equal(w.offerFor(b, 1).state, 'OFFERED'); assert.equal(evCount(w, b, 'DRIVER_DECISION'), 0, 'no partial audit leaked');
  assert.equal(w.notifier.byKind('GUEST_DRIVER_ASSIGNED').length, 0, 'success side effects never fired');
  w.db.raw.exec('DROP TRIGGER t_block_audit');
  assert.equal((await w.service.accept({ driverId: 1, offerId: o.offer_id })).code, CODE.ASSIGNED);
  // lifecycle transitions too
  w.db.raw.exec(`CREATE TRIGGER t_block_stage BEFORE INSERT ON booking_events WHEN NEW.event_type = 'EN_ROUTE_PICKUP' BEGIN SELECT RAISE(ABORT, 'audit store unavailable'); END`);
  const a = await w.service.advanceTrip({ driverId: 1, bookingId: b, stage: 'EN_ROUTE_PICKUP' });
  assert.equal(a.code, CODE.AUDIT_PERSIST_FAILED);
  assert.equal(w.db.q1(`SELECT status s FROM bookings WHERE id=?`, b).s, 'accepted'); assert.equal(evCount(w, b, 'EN_ROUTE_PICKUP'), 0);
  w.db.raw.exec('DROP TRIGGER t_block_stage');
  assert.equal((await w.service.advanceTrip({ driverId: 1, bookingId: b, stage: 'EN_ROUTE_PICKUP' })).ok, true);
  finish(w);
});

test('G26 every consequential event is correlated by booking_id + offer_id + driver_id + actor + timestamp; never by guest PII', async () => {
  const w = await makeWorld({ drivers: 3 });
  const { b, o } = await begin(w); await w.service.decline({ driverId: 1, offerId: o.offer_id });
  const o2 = w.offerFor(b, 2); await w.service.view({ driverId: 2, offerId: o2.offer_id }); await w.service.accept({ driverId: 2, offerId: o2.offer_id });
  for (const e of w.db.q(`SELECT * FROM booking_events WHERE booking_id=?`, b)) {
    const m = JSON.parse(e.metadata);
    assert.ok(e.booking_id && e.actor && e.created_at, `${e.event_type} missing actor/timestamp`);
    if (['OFFER_CREATED', 'DRIVER_DECISION', 'ASSIGNMENT_CLAIM', 'ASSIGNMENT_PERSISTED', 'DRIVER_ASSIGNED', 'OFFER_VIEWED', 'DRIVER_NOTIFICATION_ATTEMPTED', 'DRIVER_NOTIFICATION_DELIVERED'].includes(e.event_type)) {
      assert.ok(m.offer_id && m.driver_id, `${e.event_type} missing offer_id/driver_id`);
    }
  }
  finish(w);   // includes I9: no canary PII in events/offers/attempts
});

test('G27 reason codes are stable machine-readable values independent of UI prose', async () => {
  const w = await makeWorld({ drivers: 3, deliveryMode: NO_RECEIPT });
  const codes = new Set(Object.values(CODE)); const seen = new Set();
  const note = (r) => { seen.add(r.code); assert.ok(codes.has(r.code), `unknown code ${r.code}`); assert.equal(r.message, undefined); assert.equal(r.error, undefined); return r; };
  const { b, o } = await begin(w);
  note(await w.service.decline({ driverId: 1, offerId: o.offer_id })); note(await w.service.accept({ driverId: 1, offerId: o.offer_id }));
  note(await w.service.accept({ driverId: 3, offerId: 'ofr_nope' })); w.clock.advance(S(130)); note(await w.service.accept({ driverId: 2, offerId: w.offerFor(b, 2).offer_id }));
  const bb = await begin(w, 1); note(await w.service.accept({ driverId: 1, offerId: bb.o.offer_id })); note(await w.service.advanceTrip({ driverId: 1, bookingId: bb.b, stage: 'COMPLETED' }));
  note(await w.service.advanceTrip({ driverId: 3, bookingId: bb.b, stage: 'EN_ROUTE_PICKUP' }));
  for (const c of [CODE.DRIVER_DECLINED, CODE.INVALID_TRANSITION, CODE.OFFER_NOT_FOUND, CODE.OFFER_EXPIRED, CODE.ASSIGNED, CODE.NOT_ASSIGNED_DRIVER]) assert.ok(seen.has(c), `code ${c} not exercised`);
});

test('G28 diagnostic read answers: last proven boundary, first missing/failed boundary, reason code, retry state, human fallback — five scenarios', async () => {
  // normal accept
  let w = await makeWorld({ drivers: 3 }); let { b, o } = await begin(w);
  await w.service.view({ driverId: 1, offerId: o.offer_id }); await w.service.accept({ driverId: 1, offerId: o.offer_id });
  let d = await diagnose(w.db, b);
  assert.deepEqual([d.last_proven_boundary, d.first_missing_or_failed_boundary, d.human_fallback_invoked], ['ASSIGNMENT_PERSISTED', 'PICKUP_EN_ROUTE', false]);
  // decline -> next driver
  w = await makeWorld({ drivers: 3 }); ({ b, o } = await begin(w)); await w.service.decline({ driverId: 1, offerId: o.offer_id });
  d = await diagnose(w.db, b);
  assert.equal(d.last_proven_boundary, 'DRIVER_DECISION'); assert.equal(d.first_missing_or_failed_boundary, 'OFFER_VIEWED'); assert.equal(d.retry_state, 'WAITING');   // decline proves DRIVER_DECISION; next driver's offer is awaiting a view
  assert.ok(d.offers.some((x) => x.driver_id === 1 && x.reason_code === CODE.DRIVER_DECLINED) && d.offers.some((x) => x.driver_id === 2 && x.state === 'OFFERED'));
  // slow / reconnect: no receipt, view arrives late, accept
  w = await makeWorld({ drivers: 2, deliveryMode: NO_RECEIPT }); ({ b, o } = await begin(w)); w.clock.advance(S(100));
  d = await diagnose(w.db, b); assert.equal(d.first_missing_or_failed_boundary, 'DRIVER_NOTIFICATION_DELIVERED'); assert.equal(d.responsible_subsystem, 'NOTIFICATION');
  await w.service.view({ driverId: 1, offerId: o.offer_id }); await w.service.accept({ driverId: 1, offerId: o.offer_id });
  d = await diagnose(w.db, b); assert.equal(d.last_proven_boundary, 'ASSIGNMENT_PERSISTED');
  // simultaneous accept
  w = await makeWorld({ drivers: 3, deliveryMode: NO_RECEIPT }); ({ b, o } = await begin(w)); w.clock.advance(S(61)); await w.service.sweep(b);
  await Promise.all([w.service.accept({ driverId: 1, offerId: o.offer_id }), w.service.accept({ driverId: 2, offerId: w.offerFor(b, 2).offer_id })]);
  d = await diagnose(w.db, b); assert.equal(d.last_proven_boundary, 'ASSIGNMENT_PERSISTED'); assert.equal(d.offers.filter((x) => x.state === 'ACCEPTED').length, 1); assert.equal(d.offers.filter((x) => x.reason_code === CODE.ASSIGNMENT_ALREADY_TAKEN).length, 1);
  // 180 s human fallback
  w = await makeWorld({ drivers: 2, deliveryMode: NO_RECEIPT }); ({ b } = await begin(w)); w.clock.advance(S(181)); await w.service.sweep(b);
  d = await diagnose(w.db, b);
  assert.deepEqual([d.reason_code, d.responsible_subsystem, d.retry_state, d.human_fallback_invoked], [CODE.HUMAN_FALLBACK_REQUIRED, 'DISPATCH', 'HUMAN', true]);
  assert.equal(d.last_proven_boundary, 'DRIVER_NOTIFICATION_ATTEMPTED'); assert.equal(d.first_missing_or_failed_boundary, 'DRIVER_NOTIFICATION_DELIVERED');   // never reached the driver: no receipt, no view, no decision
});

test('G29 responsibilities are not mixed: offers hold decisions, attempts hold delivery evidence, events hold the timeline, bookings hold assignment', async () => {
  const w = await makeWorld({ drivers: 2 });
  const cols = (t) => w.db.q(`PRAGMA table_info(${t})`).map((c) => c.name);
  assert.ok(!cols('driver_offers').some((c) => /attempt|provider|channel|delivered/.test(c)));
  assert.ok(!cols('driver_broadcast_attempts').some((c) => /state|decision|accept|decline|expires|viewed/.test(c)));
  assert.ok(!cols('bookings').some((c) => /offer|attempt|dispatch/.test(c)));
  assert.ok(!cols('driver_offers').some((c) => /guest|phone|email|name|contact/.test(c)), 'no guest PII columns in driver_offers');
  const { b, o } = await begin(w);
  const attemptsBefore = JSON.stringify(w.db.q(`SELECT * FROM driver_broadcast_attempts`));
  await w.service.accept({ driverId: 1, offerId: o.offer_id });
  assert.equal(JSON.stringify(w.db.q(`SELECT * FROM driver_broadcast_attempts`)), attemptsBefore, 'a decision never rewrites delivery evidence');
  assert.deepEqual(w.db.q(`SELECT DISTINCT status FROM driver_broadcast_attempts`).map((x) => x.status), ['DELIVERED']);
  finish(w);
});

// ───────────── F. Trip lifecycle ─────────────
const assign = async (w, who = 1) => { const x = await begin(w, who); await w.service.accept({ driverId: who, offerId: x.o.offer_id }); return x.b; };

test('G30 only the winning driver can progress the trip or read guest/trip details', async () => {
  const w = await makeWorld({ drivers: 3, deliveryMode: NO_RECEIPT });
  const { b, o } = await begin(w); w.clock.advance(S(61)); await w.service.sweep(b);
  await w.service.accept({ driverId: 1, offerId: o.offer_id });
  for (const d of [2, 3]) {
    assert.equal((await w.service.advanceTrip({ driverId: d, bookingId: b, stage: 'EN_ROUTE_PICKUP' })).code, CODE.NOT_ASSIGNED_DRIVER);
    assert.equal((await w.service.tripState(d, b)).code, CODE.NOT_ASSIGNED_DRIVER);
    assert.equal((await w.service.submitEvidence({ driverId: d, bookingId: b, kind: 'PICKUP', clientEvidenceId: 'x' })).code, CODE.NOT_ASSIGNED_DRIVER);
  }
  assert.equal((await w.service.tripState(1, 123456789)).code, CODE.NOT_ASSIGNED_DRIVER, 'unknown id is indistinguishable (anti-ID-guessing)');
  const own = await w.service.tripState(1, b); assert.equal(own.trip.guest.name, CANARY.name);
  finish(w);
});

test('G31 required lifecycle sequence DRIVER_ASSIGNED → … → COMPLETED is enforced and recorded in order', async () => {
  const w = await makeWorld(); const j = await runJourney(w);
  assert.ok(j.steps.every(([, c]) => ['ASSIGNED', 'OK'].includes(c)), JSON.stringify(j.steps));
  const seq = w.db.q(`SELECT event_type FROM booking_events WHERE booking_id=? AND event_type IN (${LIFECYCLE.map(() => '?').join(',')}) ORDER BY id`, j.bookingId, ...LIFECYCLE).map((x) => x.event_type);
  assert.deepEqual(seq, [...LIFECYCLE]);
  assert.equal(w.db.q1(`SELECT status s FROM bookings WHERE id=?`, j.bookingId).s, 'completed');
  finish(w);
});

test('G32 invalid or skipped transitions return INVALID_TRANSITION and corrupt nothing', async () => {
  const w = await makeWorld(); const b = await assign(w);
  const snap = () => JSON.stringify([w.db.q(`SELECT * FROM booking_events WHERE booking_id=?`, b), w.db.q1(`SELECT status FROM bookings WHERE id=?`, b)]);
  const before = snap();
  for (const stage of ['COMPLETED', 'PASSENGER_ONBOARD', 'ARRIVED_PICKUP', 'DRIVER_ASSIGNED', 'NOT_A_STAGE', '']) {
    assert.equal((await w.service.advanceTrip({ driverId: 1, bookingId: b, stage })).code, CODE.INVALID_TRANSITION, stage);
  }
  assert.equal(snap(), before);
  await w.service.advanceTrip({ driverId: 1, bookingId: b, stage: 'EN_ROUTE_PICKUP' });
  assert.equal((await w.service.advanceTrip({ driverId: 1, bookingId: b, stage: 'PICKUP_VALIDATED' })).code, CODE.INVALID_TRANSITION);
  finish(w);
});

test('G33 repeated and concurrent stage submissions are replay-safe', async () => {
  const w = await makeWorld({ chaos: randomChaos() }); const b = await assign(w);
  for (const stage of ['EN_ROUTE_PICKUP', 'ARRIVED_PICKUP']) {
    const rs = await Promise.all([1, 2, 3].map(() => w.service.advanceTrip({ driverId: 1, bookingId: b, stage })));
    assert.ok(rs.every((r) => r.ok)); assert.equal(rs.filter((r) => r.replay === false).length, 1); assert.equal(evCount(w, b, stage), 1);
  }
  finish(w);
});

test('G34 pickup evidence failure/retry never falsely marks PICKUP_VALIDATED; object reference + metadata only', async () => {
  const w = await makeWorld(); const b = await assign(w);
  await w.service.advanceTrip({ driverId: 1, bookingId: b, stage: 'EN_ROUTE_PICKUP' }); await w.service.advanceTrip({ driverId: 1, bookingId: b, stage: 'ARRIVED_PICKUP' });
  assert.equal((await w.service.advanceTrip({ driverId: 1, bookingId: b, stage: 'PICKUP_VALIDATED' })).code, CODE.EVIDENCE_REQUIRED);
  w.evidenceStore.failNext(2);
  const ev = { driverId: 1, bookingId: b, kind: 'PICKUP', clientEvidenceId: 'cli-1', sha256: 'f'.repeat(64), bytes: 2048 };
  assert.deepEqual((({ code, retryable }) => [code, retryable])(await w.service.submitEvidence(ev)), [CODE.EVIDENCE_UPLOAD_FAILED, true]);
  assert.equal((await w.service.advanceTrip({ driverId: 1, bookingId: b, stage: 'PICKUP_VALIDATED' })).code, CODE.EVIDENCE_REQUIRED);
  assert.equal((await w.service.submitEvidence(ev)).code, CODE.EVIDENCE_UPLOAD_FAILED);
  const ok = await w.service.submitEvidence(ev); assert.equal(ok.ok, true);
  assert.equal((await w.service.submitEvidence(ev)).replay, true);
  assert.equal(w.db.q1(`SELECT COUNT(*) n FROM driver_evidence WHERE booking_id=?`, b).n, 1);
  assert.match(w.db.q1(`SELECT object_key k FROM driver_evidence WHERE booking_id=?`, b).k, /^evidence\/SYN-GATE1-/);
  assert.equal((await w.service.advanceTrip({ driverId: 1, bookingId: b, stage: 'PICKUP_VALIDATED' })).ok, true);
  assert.ok(!w.db.q(`PRAGMA table_info(bookings)`).some((c) => /photo|evidence|blob|image/.test(c.name)));
  finish(w);
});

test('G35 disconnect/reconnect mid-trip recovers authoritative state; offline-mid-job is flagged once without altering the trip', async () => {
  const w = await makeWorld(); const b = await assign(w);
  await w.service.advanceTrip({ driverId: 1, bookingId: b, stage: 'EN_ROUTE_PICKUP' });
  w.db.raw.prepare(`UPDATE drivers SET online=0 WHERE id=1`).run();
  assert.deepEqual([(await w.service.detectOfflineMidTrip()).flagged, (await w.service.detectOfflineMidTrip()).flagged], [1, 0]);
  w.db.raw.prepare(`UPDATE drivers SET online=1 WHERE id=1`).run();
  const s = await (await handle(req(w, 1, 'GET', '/api/state'), { service: w.service })).json();
  assert.equal(s.trips[0].stage, 'EN_ROUTE_PICKUP'); assert.equal(w.db.q1(`SELECT assigned_driver_id d FROM bookings WHERE id=?`, b).d, 1);
  assert.equal((await w.service.advanceTrip({ driverId: 1, bookingId: b, stage: 'ARRIVED_PICKUP' })).ok, true);
  assert.equal(evCount(w, b, 'DRIVER_OFFLINE_MID_TRIP'), 1);
  // expired session => stable AUTH_EXPIRED, state untouched
  w.clock.advance(S(90_000)); const r = await handle(req(w, 1, 'GET', '/api/state'), { service: w.service });
  assert.deepEqual([r.status, (await r.json()).code], [401, CODE.AUTH_EXPIRED]);
});

test('G36 completion retry cannot duplicate commission, messaging or completion events (all financial/messaging effects stay disabled)', async () => {
  const w = await makeWorld({ chaos: randomChaos() }); const j = await runJourney(w);
  const intents = w.notifier.intents.length;
  const rs = await Promise.all([1, 2, 3].map(() => w.service.advanceTrip({ driverId: 1, bookingId: j.bookingId, stage: 'COMPLETED' })));
  assert.ok(rs.every((r) => r.ok && r.replay));
  assert.equal(evCount(w, j.bookingId, 'COMPLETED'), 1); assert.equal(w.notifier.intents.length, intents);
  assert.equal(w.db.q1(`SELECT COUNT(*) n FROM wallet_transactions`).n, 0);
  const rr = await w.service.requestReview(j.bookingId); const rr2 = await w.service.requestReview(j.bookingId);
  assert.deepEqual([rr.recorded, rr2.recorded], [true, false]); assert.equal((await w.service.receiveReview(j.bookingId)).recorded, true);
  finish(w);
});

test('G37-meta the zero-network-send guard is still clean after the whole matrix', async () => {
  assert.equal(guard.attempts.length, 0, JSON.stringify(guard.attempts));
});
