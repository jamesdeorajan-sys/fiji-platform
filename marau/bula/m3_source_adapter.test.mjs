// SYNTHETIC. Saved-booking adapter: NAT/FijiDash-shaped fixtures -> real-booking sync -> Bula snapshot + receipt jobs + welcome grant. Real Worker. Run from marau/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkEnv, syncCreated, syncStatus, call, one, count, tokenFor, cutover, natBooking, staff, offer, ADMIN as ADMINK } from './m3_helpers.mjs';
import worker from '../worker/worker.js';
import { bulaRunOutbox } from './hook.js';
import { createCaptureSender } from './outbox_d1.js';

const totals = async (env) => ({ guests: await count(env, 'guest_sessions'), mirror: await count(env, 'marau_test_bookings'), jobs: await count(env, 'bula_outbox'), grants: await count(env, 'bula_credit_ledger', "type = 'granted'"), snaps: await count(env, 'bula_booking_snapshots'), links: await count(env, 'marau_real_booking_links') });

test('a saved synthetic transfer produces ONE guest, TWO receipt jobs, ONE welcome grant and a source snapshot with real provenance', async () => {
  const env = mkEnv(); const r = await syncCreated(env, 1042); assert.equal(r.status, 200); assert.equal(r.data.created, true);
  const t = await totals(env); assert.deepEqual(t, { guests: 1, mirror: 1, jobs: 2, grants: 1, snaps: 1, links: 1 });
  const snap = await env.DB.prepare('SELECT * FROM bula_booking_snapshots').first();
  assert.equal(snap.source_kind, 'nadi_dispatch_api'); assert.equal(snap.currency, 'FJD'); assert.equal(snap.total_minor, 8500); assert.equal(snap.flight_number, 'FJ391');
  const av = JSON.parse(snap.availability_json); assert.equal(av.flight_number, 'source'); assert.equal(av.passengers, 'not_in_source'); assert.equal(av.luggage, 'not_in_source'); assert.equal(av.add_ons, 'not_in_source'); assert.equal(av.discount_minor, 'not_in_source');
  assert.equal(JSON.parse(snap.provenance_json).read_only, true);
  assert.deepEqual((await env.DB.prepare('SELECT recipient_kind k, state FROM bula_outbox ORDER BY k').all()).results.map((x) => `${x.k}:${x.state}`), ['guest:queued', 'staff:queued']);
  assert.ok(env.__fetch.calls.every((c) => c.method === 'GET'), 'the source is only ever READ');
});

test('REPLAY: the same event, a later status event, a reconcile and an outbox sweep create no second guest, grant, job or snapshot version', async () => {
  const env = mkEnv(); await cutover(env); await syncCreated(env, 7); const before = await totals(env);
  for (let i = 0; i < 3; i++) await call(env, 'POST', '/preview/admin/synthetic-source/7/sync-event', { body: { event_type: 'created', new_status: 'pending', source_event_id: 100 + i, booking_id: 7 } });
  await call(env, 'POST', '/preview/admin/synthetic-source/7/reconcile', { body: { snapshot_sequence: 5 } });
  await syncStatus(env, 7, 'accepted');
  const sender = createCaptureSender(); await bulaRunOutbox({ ...env, BULA_CAPTURE_SENDER: sender, BULA_SOURCE_READER: undefined }, Date.now()); await bulaRunOutbox({ ...env, BULA_CAPTURE_SENDER: sender }, Date.now() + 1000);
  assert.deepEqual(await totals(env), before);
  assert.equal((await env.DB.prepare('SELECT version v FROM bula_booking_snapshots').first()).v, 1, 'unchanged source -> no new snapshot version');
  assert.equal(sender.sent.length, 2, 'exactly one guest and one team receipt, ever');
});

test('a source CHANGE versions the snapshot once; the receipts are not re-sent', async () => {
  const env = mkEnv(); await syncCreated(env, 8); await syncStatus(env, 8, 'accepted');
  env.__store.set(8, { ...env.__store.get(8), quoted_amount: 90, flight_number: 'FJ392' });
  await call(env, 'POST', '/preview/admin/synthetic-source/8/reconcile', { body: { snapshot_sequence: 9 } });
  const s = await env.DB.prepare('SELECT version, total_minor, flight_number FROM bula_booking_snapshots').first(); assert.equal(s.version, 2); assert.equal(s.total_minor, 9000); assert.equal(s.flight_number, 'FJ392');
  assert.equal(await count(env, 'bula_outbox'), 2); assert.equal(await count(env, 'guest_sessions'), 1);
});

test('SEPARATELY SWITCHABLE: adapter flag off, or outbox flag off -> the transfer is mirrored exactly as before and Bula writes nothing', async () => {
  for (const off of [{ BULA_SOURCE_SYNC: undefined }, { BULA_OUTBOX_ENABLED: undefined }, { BULA_SOURCE_SYNC: 'off' }, { BULA_SOURCE_SYNC: 'yes' }]) {
    const env = mkEnv(off); const r = await syncCreated(env, 11); assert.equal(r.status, 200); assert.equal(r.data.created, true);
    const t = await totals(env); assert.equal(t.mirror, 1); assert.equal(t.guests, 1); assert.equal(t.jobs, 0); assert.equal(t.grants, 0); assert.equal(t.snaps, 0, JSON.stringify(off));
  }
});

test('RECOVERABLE: if the source cannot be read for the snapshot, the booking, jobs and grant still happen; the sweep adds the snapshot later with source provenance (never as a form)', async () => {
  const env = mkEnv({ __ctl: { failOnCall: 2 } });   // call 1 = the sync's own read; call 2 = the adapter's snapshot read
  await cutover(env); const r = await syncCreated(env, 21); assert.equal(r.status, 200); assert.equal(r.data.created, true);
  let t = await totals(env); assert.equal(t.jobs, 2); assert.equal(t.grants, 1); assert.equal(t.snaps, 0, 'no snapshot yet - and NOT a mislabelled form snapshot');
  await bulaRunOutbox({ ...env, BULA_CAPTURE_SENDER: createCaptureSender(), BULA_SOURCE_READER: env.__reader }, Date.now());   // reader absent on this path -> still no mislabel
  assert.equal((await totals(env)).snaps, 0, 'without a source reader the sweep must refuse to guess');
  // the Worker's scheduled/route entry supplies the reader; the sweep now repairs it
  const { default: worker } = await import('../worker/worker.js'); await worker.scheduled({}, { ...env, BULA_OUTBOX_ENABLED: 'on', BULA_CAPTURE_SENDER: createCaptureSender() }, { waitUntil: (p) => p });
  await new Promise((r2) => setTimeout(r2, 200));
  t = await totals(env); assert.equal(t.snaps, 1); const s = await env.DB.prepare('SELECT source_kind FROM bula_booking_snapshots').first(); assert.equal(s.source_kind, 'nadi_dispatch_api');
  assert.equal(t.jobs, 2); assert.equal(t.grants, 1); assert.equal(t.guests, 1);
});

test('UNABLE TO BLOCK OR FAIL A VALID BOOKING: broken Bula tables / a down source do not change the sync result or lose the transfer', async () => {
  const env = mkEnv(); await env.DB.prepare('DROP TABLE bula_outbox').run(); await env.DB.prepare('DROP TABLE bula_booking_snapshots').run();
  const r = await syncCreated(env, 31); assert.equal(r.status, 200); assert.equal(r.data.created, true); assert.equal(await count(env, 'marau_test_bookings'), 1); assert.equal(await count(env, 'marau_real_booking_links'), 1);
  const env2 = mkEnv({ __ctl: { down: false } }); env2.__fetch.calls.length = 0;
  const r2 = await syncCreated(env2, 32); assert.equal(r2.status, 200);
});

test('no phone/email lookup: a different booking with the SAME guest phone gets its own guest and its own party (the sync links by source ref only)', async () => {
  const env = mkEnv(); await syncCreated(env, 41, { guest_phone: '+15550109999', guest_email: 'same@example.test' }); await syncCreated(env, 42, { guest_phone: '+15550109999', guest_email: 'same@example.test' });
  assert.equal(await count(env, 'marau_real_booking_links'), 2); const gs = (await env.DB.prepare('SELECT DISTINCT guest_session_id s FROM marau_real_booking_links').all()).results.length;
  assert.equal(await count(env, 'bula_credit_ledger', "type = 'granted'"), gs);
});

test('optional contract fields flow through only when the source supplies them (passengers via negotiation); luggage / add-ons / discount stay unavailable', async () => {
  const env = mkEnv(); await syncCreated(env, 51, { passengers: 3, flight_number: null });
  const s = await env.DB.prepare('SELECT * FROM bula_booking_snapshots').first(); const av = JSON.parse(s.availability_json);
  assert.equal(s.passengers, 3); assert.equal(av.passengers, 'source'); assert.equal(av.flight_number, 'not_in_source'); assert.equal(s.flight_number, null); assert.equal(av.luggage, 'not_in_source'); assert.equal(av.discount_minor, 'not_in_source');
});

test('SWITCH-OFF: with BULA_SOURCE_SYNC off the sweep neither repairs nor creates anything for source-mirrored bookings; ordinary form bookings are still repaired', async () => {
  const env = mkEnv({ BULA_SOURCE_SYNC: undefined }); await cutover(env); await syncCreated(env, 61);   // mirrored while the adapter is off -> nothing from Bula
  const form = await one(await call(env, 'POST', '/preview/bookings', { admin: false, body: (await import('../test/fixtures.mjs')).synthGuest({ leg_type: 'arrival' }) }));   // a Marau form booking: outbox flag on -> hook enqueues
  assert.equal(form.status, 201); const before = await totals(env);
  await env.DB.prepare('DELETE FROM bula_outbox').run(); await env.DB.prepare('DELETE FROM bula_credit_ledger').run(); await env.DB.prepare('DELETE FROM bula_credit_accounts').run();   // simulate a crash that lost the form booking's Bula work
  await bulaRunOutbox({ ...env, BULA_CAPTURE_SENDER: createCaptureSender() }, Date.now()); const t = await totals(env);
  assert.equal(await count(env, 'bula_outbox', "booking_ref LIKE 'REAL-SYNC-%'"), 0, 'no jobs for the source row'); assert.equal(await count(env, 'bula_booking_snapshots', "booking_ref LIKE 'REAL-SYNC-%'"), 0, 'no snapshot for the source row');
  assert.ok(await count(env, 'bula_outbox', "booking_ref NOT LIKE 'REAL-SYNC-%'") >= 2, 'the form booking IS repaired'); assert.equal(await count(env, 'bula_credit_ledger', "party_key LIKE 'trip:REAL-SYNC-%'"), 0);
  const on = { ...env, BULA_SOURCE_SYNC: 'on' }; await bulaRunOutbox({ ...on, BULA_CAPTURE_SENDER: createCaptureSender(), BULA_SOURCE_READER: env.__reader }, Date.now());
  assert.ok(await count(env, 'bula_outbox', "booking_ref LIKE 'REAL-SYNC-%'") >= 2, 'switching it back on resumes the repair');
});

test('HOSTED CAPTURE: BULA_EMAIL_CAPTURE records would-be emails once each (audit rows), the live sender stays disabled, and only the CEO can read them', async () => {
  const env = mkEnv({ BULA_EMAIL_CAPTURE: 'on' }); await offer(env); await syncCreated(env, 71, { guest_email: 'cap@example.test' });
  await call(env, 'POST', '/preview/bula/outbox/run', { body: {} }); await call(env, 'POST', '/preview/bula/outbox/run', { body: {} });
  assert.equal(await count(env, 'bula_audit', "action = 'email_captured'"), 2); const ceo = await staff(env, 'james', 'ceo'), ops = await staff(env, 'ana', 'ops');
  const cap = await one(await call(env, 'GET', '/preview/admin/bula/source-sync/71/captured', { staff: ceo })); assert.equal(cap.data.captured.length, 2); assert.ok(cap.data.captured.some((m) => /#tok=/.test(m.text)));
  assert.equal((await call(env, 'GET', '/preview/admin/bula/source-sync/71/captured', { staff: ops })).status, 403);
  const st = (await one(await call(env, 'GET', '/preview/admin/bula/source-sync/71', { staff: ceo }))).data; assert.deepEqual([st.guestSessions, st.mirrorRows, st.welcomeGrants, st.captured, st.snapshot.version], [1, 1, 1, 2, 1]);
  const noCapture = mkEnv({}); await syncCreated(noCapture, 72); await call(noCapture, 'POST', '/preview/bula/outbox/run', { body: {} });
  assert.equal(await count(noCapture, 'bula_audit', "action = 'email_captured'"), 0, 'capture off -> nothing captured; the live sender is disabled so jobs fail, never send');
});

test('CUTOVER route: CEO only, set once, never moved or overwritten; fault harness fails the Nth source read only with the harness flag AND admin key', async () => {
  const env = mkEnv({ BULA_FAULT_HARNESS: 'on' }); const ceo = await staff(env, 'james', 'ceo'), ops = await staff(env, 'ana', 'ops');
  assert.equal((await call(env, 'POST', '/preview/admin/bula/outbox/cutover', { staff: ops, body: {} })).status, 403);
  const a = await one(await call(env, 'POST', '/preview/admin/bula/outbox/cutover', { staff: ceo, body: {} })); const b = await one(await call(env, 'POST', '/preview/admin/bula/outbox/cutover', { staff: ceo, body: {} }));
  assert.deepEqual([a.status, a.data.set, b.status, b.data.set, a.data.cutover === b.data.cutover], [201, true, 200, false, true]);
  const hdr = { 'x-bula-harness-key': ADMINK, 'x-bula-source-fail-on-call': '2' }; env.__store.set(81, natBooking(81));
  const f = async (e, h, id = 81) => (await e.DB.prepare('SELECT 1').first(), worker.fetch(new Request(`http://marau.test/preview/admin/synthetic-source/${id}/sync-event`, { method: 'POST', headers: { authorization: `Bearer ${ADMINK}`, 'content-type': 'application/json', ...h }, body: JSON.stringify({ event_type: 'created', new_status: 'pending', source_event_id: 901, booking_id: id }) }), e));
  const r = await f(env, hdr); assert.equal(r.status, 200); assert.equal(await count(env, 'bula_booking_snapshots'), 0, 'adapter read failed on call 2'); assert.equal(await count(env, 'bula_outbox'), 2);
  const off = mkEnv({}); off.__store.set(82, natBooking(82)); const r2 = await f(off, { ...hdr }, 82); assert.equal(r2.status, 200); assert.equal(await count(off, 'bula_booking_snapshots'), 1, 'harness flag off -> header ignored');
});
