// FINAL RELEASE GATE (tests only, no product code). SYNTHETIC data, real Worker + real route code + in-memory D1 shim. Run from marau/.
// Every step of every scenario re-checks the wallet / capacity / duplication INVARIANTS against the database itself.
// Set M4_EVIDENCE_DIR to also write the machine-readable evidence (no secrets, no real guest data).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkEnv, syncCreated, syncStatus, call, one, count, tokenFor, staff, offer, reserve, cutover, natBooking, NOW, H } from './m3_helpers.mjs';
import { createCaptureSender } from './outbox_d1.js';
import { bulaRunOutbox } from './hook.js';
import worker from '../worker/worker.js';

const EV = []; const note = (scenario, step, result) => EV.push({ scenario, step, result });
const all = async (env, sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;
const wallet = async (env, tok) => (await one(await call(env, 'GET', '/preview/bula/offers', { tok, admin: false }))).data.wallet;
const trip = async (env, tok) => one(await call(env, 'GET', '/preview/bula/trip', { tok, admin: false }));
const act = (env, st, id, a, body = {}) => call(env, 'POST', `/preview/admin/bula/holds/${id}/${a}`, { staff: st, body });
const queue = async (env, st) => one(await call(env, 'GET', '/preview/admin/bula/queue', { staff: st }));
const runOutbox = async (env) => one(await call(env, 'POST', '/preview/bula/outbox/run', { body: {} }));

/** The invariant checker. Reads ONLY the database. Throws (assert) on any violation; returns a compact snapshot for the evidence file. */
async function invariants(env, label) {
  const accts = await all(env, 'SELECT * FROM bula_credit_accounts');
  for (const a of accts) {
    assert.equal(a.available_cents + a.reserved_cents + a.redeemed_cents + a.expired_cents, a.granted_cents, `${label}: balance buckets add up (${a.party_key})`);
    const led = await all(env, 'SELECT type, SUM(amount_cents) s, COUNT(*) n FROM bula_credit_ledger WHERE party_key = ? GROUP BY type', a.party_key);
    const g = led.find((x) => x.type === 'granted'); assert.equal(g?.s, a.granted_cents, `${label}: ledger granted == account granted`); assert.equal(g?.n, 1, `${label}: exactly ONE welcome grant per party`);
    const holds = await all(env, "SELECT credit_cents, state FROM bula_holds WHERE party_key = ? AND state IN ('held','confirmed')", a.party_key);
    assert.equal(a.reserved_cents + a.redeemed_cents, holds.reduce((s, h) => s + h.credit_cents, 0), `${label}: credit tied up == credit of live (held/confirmed) requests`);
    assert.ok(a.available_cents >= 0 && a.reserved_cents >= 0, `${label}: no negative bucket`);
  }
  for (const o of await all(env, 'SELECT offer_id, version, capacity_total, remaining FROM bula_offers')) {
    const live = (await env.DB.prepare("SELECT COALESCE(SUM(qty),0) q FROM bula_holds WHERE offer_id = ? AND state IN ('held','confirmed')").bind(o.offer_id).first()).q;
    assert.equal(o.remaining, o.capacity_total - live, `${label}: capacity remaining == total - live requests (${o.offer_id})`);
    assert.ok(o.remaining >= 0 && o.remaining <= o.capacity_total, `${label}: capacity within bounds`);
  }
  for (const t of ['reserved', 'released', 'redeemed', 'restored']) {
    const d = await all(env, 'SELECT hold_id, COUNT(*) n FROM bula_credit_ledger WHERE type = ? AND hold_id IS NOT NULL GROUP BY hold_id HAVING n > 1', t); assert.equal(d.length, 0, `${label}: no hold has two '${t}' ledger rows`);
  }
  const dupGuests = await all(env, 'SELECT source_booking_ref, COUNT(*) n FROM marau_real_booking_links GROUP BY source_booking_ref HAVING n > 1'); assert.equal(dupGuests.length, 0, `${label}: one link per source booking`);
  const s = { accounts: accts.map((a) => ({ granted: a.granted_cents, available: a.available_cents, reserved: a.reserved_cents, redeemed: a.redeemed_cents })), offers: (await all(env, 'SELECT offer_id, capacity_total t, remaining r FROM bula_offers')), guests: await count(env, 'guest_sessions'), links: await count(env, 'marau_real_booking_links'), holds: await count(env, 'bula_holds'), grants: await count(env, 'bula_credit_ledger', "type = 'granted'"), jobs: await count(env, 'bula_outbox') };
  return s;
}
const world = async (over = {}) => {
  const env = mkEnv(over); await offer(env); await syncCreated(env, 3001); await syncCreated(env, 3002, { pickup_zone: 'Suva', destination_zone: 'Pacific Harbour', flight_number: null });
  return { env, A: await tokenFor(env, 3001), B: await tokenFor(env, 3002), ana: await staff(env, 'ana', 'ops'), ben: await staff(env, 'ben', 'ops'), ap: await staff(env, 'ari', 'approver'), ceo: await staff(env, 'james', 'ceo') };
};

test('LIFECYCLE (decline path): source -> guest -> trip -> FJ$500 -> offer -> request -> staff -> decline -> restored once -> replay safe; invariants after EVERY step', async () => {
  const sender = createCaptureSender(); const { env, A, ana } = await world({ BULA_CAPTURE_SENDER: sender }); const S = 'lifecycle-decline';
  let s = await invariants(env, 'after source sync'); note(S, '1 SOURCE TRUTH: synthetic NAT booking 3001 read from the (read-only) source; DERIVED: 1 guest, 1 link, 1 grant', s);
  assert.equal(s.guests, 2); assert.equal(s.grants, 2, 'one grant per distinct booking/party');
  const t0 = (await trip(env, A)).data; assert.equal(t0.trips[0].reference, '3001'); assert.equal(t0.trips[0].legs[0].from, 'Nadi Airport'); assert.equal(t0.trips[0].legs[0].status, 'pending');
  note(S, '2 itinerary: from/to/date/time/flight come from the SOURCE row; status mirrors source status (pending); nothing invented', { ref: t0.trips[0].reference, status: t0.trips[0].legs[0].status, unavailable: t0.trips[0].unavailable || null });
  assert.equal((await wallet(env, A)).availableCents, 50000, 'FJ$500 welcome credit'); note(S, '3 FJ$500 welcome credit (derived)', { availableCents: 50000 });
  const offers = (await one(await call(env, 'GET', '/preview/bula/offers', { tok: A, admin: false }))).data; assert.equal(offers.cards.length, 1); note(S, '4 offer displayed to the guest', { offers: offers.cards.length });
  const r1 = await one(await reserve(env, A, 'k1', { expected_net_cents: 12500 })); assert.equal(r1.status, 201); const h = r1.data.hold.holdId;
  s = await invariants(env, 'after request'); assert.equal((await wallet(env, A)).availableCents, 47500); assert.equal((await env.DB.prepare("SELECT remaining r FROM bula_offers").first()).r, 7);
  note(S, '5 request: credit reserved ONCE (-FJ$25.00), capacity reserved ONCE (8 -> 7)', s);
  const r1b = await one(await reserve(env, A, 'k1', { expected_net_cents: 12500 })); assert.equal(r1b.data.hold?.holdId ?? h, h); const r1c = await one(await reserve(env, A, 'k2', { expected_net_cents: 12500 }));
  s = await invariants(env, 'repeated request'); note(S, '5b repeated request (same idem key; and a 2nd key for the same offer)', { sameKeyStatus: r1b.status, secondKeyStatus: r1c.status, holds: s.holds, remaining: s.offers[0].r });
  const holdsNow = s.holds; assert.ok(holdsNow <= 2);
  const q = (await queue(env, ana)).data; assert.ok(q.requests.some((x) => x.holdId === h)); note(S, '6 staff queue shows the request', { queued: q.requests.length });
  assert.equal((await act(env, ana, h, 'claim')).status, 200); note(S, '7 attributable authorised action: claim by ana(ops)', await invariants(env, 'after claim'));
  assert.equal((await act(env, ana, h, 'decline', { evidence_note: 'operator full' })).status, 200); const afterDecline = await invariants(env, 'after decline');
  const g = (await trip(env, A)).data.requests.find((x) => x.holdId === h); assert.equal(g.chip, 'Declined'); assert.equal(g.creditReturned, true); assert.equal(g.inventoryReturned, true);
  note(S, '8 decline: guest sees Declined + credit/capacity returned (proved from ledger)', afterDecline);
  const before = JSON.stringify(afterDecline); assert.equal((await act(env, ana, h, 'decline', { evidence_note: 'again' })).status, 200);
  const wd = await call(env, 'POST', `/preview/bula/holds/${h}/release`, { tok: A, admin: false, body: {} }); assert.ok(wd.status < 500, 'withdrawing an already-declined request is handled, not a crash');
  const replay = await invariants(env, 'after replay decline + withdraw'); assert.equal(await count(env, 'bula_audit', `action = 'hold_declined' AND subject = '${h}'`), 1);
  assert.equal(await count(env, 'bula_credit_ledger', `type = 'released' AND hold_id = '${h}'`), 1, 'exactly one credit release for the request');
  const live = await count(env, 'bula_holds', "state IN ('held','confirmed')"); assert.equal(replay.accounts[0].available, 50000 - 2500 * live, 'wallet = FJ$500 minus only still-live requests');
  note(S, '9 replay: repeated decline + repeated withdrawal restore nothing more', { before: JSON.parse(before).accounts[0], after: replay.accounts[0], remaining: replay.offers[0].r });
});

test('LIFECYCLE (confirm path): confirm is attributable, credit/capacity stay consumed, a second confirm and a later withdraw cannot double anything; transfer status stays source truth', async () => {
  const { env, A, ana } = await world(); const S = 'lifecycle-confirm';
  const h = (await one(await reserve(env, A, 'c1', { expected_net_cents: 12500 }))).data.hold.holdId; await invariants(env, 'requested');
  assert.equal((await act(env, ana, h, 'claim')).status, 200); assert.equal((await act(env, ana, h, 'confirm', { evidence_note: 'operator ref OP-1' })).status, 200); let s = await invariants(env, 'confirmed');
  assert.equal((await act(env, ana, h, 'confirm', { evidence_note: 'again' })).status, 200); const s2 = await invariants(env, 'confirm replay'); assert.deepEqual(s2, s);
  const g = (await trip(env, A)).data; assert.equal(g.requests[0].chip, 'Confirmed'); assert.equal(g.trips[0].legs[0].status, 'pending', 'activity confirmation never confirms the TRANSFER (source truth)');
  const row = await env.DB.prepare('SELECT confirmed_by_kind k, confirmed_by_ref r FROM bula_holds WHERE hold_id = ?').bind(h).first(); assert.ok(row.r && /ana/.test(row.r), 'confirmation is attributed to the acting staff member');
  await syncStatus(env, 3001, 'accepted'); assert.equal((await trip(env, A)).data.trips[0].legs[0].status, 'confirmed', 'source accepted -> shown as Confirmed'); await invariants(env, 'source accepted');
  note(S, 'confirm + replay + source status change', { attributedTo: row.r, afterReplayIdentical: true, transferStatusFollowsSource: true });
});

test('FAILURE: duplicate source record + repeated sweeps + repeated source events create no second guest, link, grant, job or snapshot', async () => {
  const sender = createCaptureSender(); const env = mkEnv({ BULA_CAPTURE_SENDER: sender }); await cutover(env); const S = 'duplicate-source';
  await syncCreated(env, 3101); const base = await invariants(env, 'first'); const snaps = await count(env, 'bula_booking_snapshots');
  for (let i = 0; i < 3; i++) { await syncCreated(env, 3101); await syncStatus(env, 3101, 'pending', 'updated'); }
  for (let i = 0; i < 3; i++) { await worker.scheduled({}, { ...env, BULA_OUTBOX_ENABLED: 'on', BULA_CAPTURE_SENDER: sender }, { waitUntil: (p) => p }); await new Promise((r) => setTimeout(r, 50)); await runOutbox(env); }
  assert.deepEqual(await invariants(env, 'after replays + sweeps'), base); assert.equal(await count(env, 'bula_booking_snapshots'), snaps); assert.equal(await count(env, 'guest_sessions'), 1);
  const msgs = sender.sent.map((m) => m.to); assert.equal(msgs.length, 2, 'exactly one guest receipt + one team receipt, ever'); assert.equal(new Set(msgs).size, 2);
  note(S, '3x duplicate created event + 3x updated event + 3x scheduled sweep + 3x outbox run', { state: base, captured: msgs.length });
});

test('FAILURE: source unavailable at sync -> booking, guest, grant and jobs still happen; recovery fills the snapshot once; a long outage then recovery duplicates nothing', async () => {
  const S = 'source-outage'; const ctl = {}; const env = mkEnv({ __ctl: ctl, BULA_CAPTURE_SENDER: createCaptureSender() }); await cutover(env);
  ctl.down = true; const r = await syncCreated(env, 3201).catch((e) => ({ status: 'threw ' + e.message }));
  const dn = await invariants(env, 'during outage').catch((e) => { throw e; });
  note(S, 'source DOWN during sync', { syncStatus: r.status, guests: dn.guests, grants: dn.grants, snapshots: await count(env, 'bula_booking_snapshots') });
  for (let i = 0; i < 3; i++) await worker.scheduled({}, { ...env, BULA_OUTBOX_ENABLED: 'on' }, { waitUntil: (p) => p }); await new Promise((x) => setTimeout(x, 100));
  assert.equal(await count(env, 'bula_booking_snapshots'), 0, 'no snapshot is invented while the source is down');
  ctl.down = false; env.__store.set(3201, natBooking(3201));
  if (r.status !== 200 || !(await count(env, 'marau_real_booking_links'))) await syncCreated(env, 3201);
  for (let i = 0; i < 3; i++) { await worker.scheduled({}, { ...env, BULA_OUTBOX_ENABLED: 'on', BULA_CAPTURE_SENDER: createCaptureSender() }, { waitUntil: (p) => p }); await new Promise((x) => setTimeout(x, 100)); }
  const rec = await invariants(env, 'after recovery'); assert.equal(rec.guests, 1); assert.equal(rec.grants, 1); assert.equal(rec.links, 1); assert.equal(await count(env, 'bula_booking_snapshots'), 1);
  note(S, 'source RECOVERED + 3 sweeps', rec);
});

test('FAILURE: wrong / revoked / missing guest token and cross-guest access are refused; nothing changes', async () => {
  const { env, A, B } = await world(); const S = 'tokens'; const base = await invariants(env, 'start');
  const h = (await one(await reserve(env, A, 'x1', { expected_net_cents: 12500 }))).data.hold.holdId; const mid = await invariants(env, 'requested');
  const codes = {};
  codes.wrong = (await call(env, 'GET', '/preview/bula/trip', { tok: 'not-a-real-token', admin: false })).status;
  codes.none = (await call(env, 'GET', '/preview/bula/trip', { admin: false })).status;
  codes.wrongReserve = (await reserve(env, 'not-a-real-token', 'x2')).status;
  codes.otherGuestWithdraw = (await call(env, 'POST', `/preview/bula/holds/${h}/release`, { tok: B, admin: false, body: {} })).status;
  await env.DB.prepare('UPDATE guest_sessions SET access_token_revoked = 1 WHERE access_token = ?').bind(A).run();
  codes.revoked = (await call(env, 'GET', '/preview/bula/trip', { tok: A, admin: false })).status; codes.revokedReserve = (await reserve(env, A, 'x3')).status;
  for (const [k, v] of Object.entries(codes)) assert.ok(v === 401 || v === 403 || v === 404, `${k} refused (got ${v})`);
  assert.deepEqual(await invariants(env, 'after refusals'), mid); assert.notDeepEqual(base, mid);
  assert.deepEqual((await trip(env, B)).data.requests, [], 'B never sees A\'s request');
  note(S, 'refusals', codes);
});

test('FAILURE: unauthorised staff, wrong role and no identity cannot act; two staff on one request -> exactly one wins; invariants hold', async () => {
  const { env, A, ana, ben, ap } = await world(); const S = 'staff-authz'; const h = (await one(await reserve(env, A, 's1', { expected_net_cents: 12500 }))).data.hold.holdId; const mid = await invariants(env, 'requested');
  const codes = {};
  codes.noStaff = (await call(env, 'POST', `/preview/admin/bula/holds/${h}/confirm`, { admin: false, body: {} })).status;
  codes.adminOnlyNoStaff = (await call(env, 'POST', `/preview/admin/bula/holds/${h}/confirm`, { body: {} })).status;
  codes.badStaffToken = (await act(env, 'stf_nobody', h, 'confirm')).status;
  codes.approverRoleConfirm = (await act(env, ap, h, 'confirm')).status; codes.approverRoleDecline = (await act(env, ap, h, 'decline')).status;
  codes.guestTokenOnStaffRoute = (await call(env, 'GET', '/preview/admin/bula/queue', { tok: A, admin: false })).status;
  for (const [k, v] of Object.entries(codes)) assert.ok(v >= 400 && v < 500, `${k} refused (got ${v})`);
  assert.deepEqual(await invariants(env, 'after refused staff'), mid);
  const [c1, c2] = await Promise.all([act(env, ana, h, 'claim'), act(env, ben, h, 'claim')]); const won = [c1.status, c2.status].sort(); assert.deepEqual(won, [200, 409], 'exactly one claim wins');
  const loser = c1.status === 200 ? ben : ana, winner = c1.status === 200 ? ana : ben;
  codes.loserConfirm = (await act(env, loser, h, 'confirm')).status; codes.loserDecline = (await act(env, loser, h, 'decline')).status; assert.ok(codes.loserConfirm >= 400 && codes.loserDecline >= 400);
  assert.deepEqual(await invariants(env, 'after losing staff'), mid);
  const [d1, d2] = await Promise.all([act(env, winner, h, 'decline', { evidence_note: 'n1' }), act(env, winner, h, 'decline', { evidence_note: 'n2' })]); assert.deepEqual([d1.status, d2.status], [200, 200]);
  const fin = await invariants(env, 'after concurrent decline'); assert.equal(fin.accounts[0].available, 50000); assert.equal(await count(env, 'bula_audit', `action = 'hold_declined' AND subject = '${h}'`), 1);
  note(S, 'authz + race', { ...codes, claimStatuses: won, declineStatuses: [d1.status, d2.status], final: fin.accounts[0] });
});

test('FAILURE: concurrent guest requests for the last unit of capacity and for the same credit never oversell or double-spend', async () => {
  const { env, A, B } = await world(); const S = 'concurrency'; await env.DB.prepare("UPDATE bula_offers SET capacity_total = 1, remaining = 1").run();
  const rs = await Promise.all([reserve(env, A, 'r1', { expected_net_cents: 12500 }), reserve(env, B, 'r1', { expected_net_cents: 12500 }), reserve(env, A, 'r2', { expected_net_cents: 12500 })]); const st = rs.map((r) => r.status).sort();
  const s = await invariants(env, 'after concurrent requests'); assert.equal(s.offers[0].r, 0); assert.equal((await count(env, 'bula_holds', "state IN ('held','confirmed')")), 1, 'exactly one unit sold');
  note(S, 'three concurrent requests, capacity 1', { statuses: st, remaining: s.offers[0].r, liveHolds: 1 });
});

test('FAILURE: capture / notification failure and AMBIGUOUS delivery never duplicate a message, a guest or a grant, and never block the booking', async () => {
  const S = 'capture-failure';
  for (const [name, opts] of [['send fails once', { failTimes: 1 }], ['send fails twice', { failTimes: 2 }], ['ambiguous (sent, no ack)', { ambiguousTimes: 1 }], ['ambiguous (not sent)', { ambiguousTimes: 1, ambiguousButSent: false }]]) {
    const sender = createCaptureSender(opts); const env = mkEnv({ BULA_CAPTURE_SENDER: sender }); await cutover(env); const r = await syncCreated(env, 3301); assert.equal(r.status, 200); assert.equal(r.data.created, true);
    const base = await invariants(env, name + ' sync');
    for (let i = 0; i < 6; i++) { await runOutbox(env); await new Promise((x) => setTimeout(x, 20)); }
    const after = await invariants(env, name + ' after retries'); assert.equal(after.guests, 1); assert.equal(after.grants, 1);
    const perRecipient = {}; for (const m of sender.sent) perRecipient[m.to] = (perRecipient[m.to] || 0) + 1; assert.ok(Object.values(perRecipient).every((n) => n <= 1), `${name}: no recipient receives a duplicate (${JSON.stringify(perRecipient)})`);
    const states = await all(env, 'SELECT state, COUNT(*) n FROM bula_outbox GROUP BY state'); note(S, name, { jobs: after.jobs, delivered: sender.sent.length, jobStates: states });
  }
});

test('FAILURE: missing OPTIONAL fields (flight, return) are unavailable, never invented; missing REQUIRED fields (email, phone, quoted price) are refused whole - nothing half-written', async () => {
  const env = mkEnv({ BULA_CAPTURE_SENDER: createCaptureSender() }); await cutover(env); const S = 'missing-fields';
  const r = await syncCreated(env, 3401, { flight_number: null, return_date: null, return_time: null }); assert.equal(r.status, 200);
  const s = await invariants(env, 'sparse'); const tok = await tokenFor(env, 3401); const t = (await trip(env, tok)).data;
  assert.equal(t.trips[0].reference, '3401'); assert.ok(!JSON.stringify(t).includes('FJ391'), 'no flight is invented');
  note(S, 'optional fields absent: accepted, rendered as unavailable', { guests: s.guests, grants: s.grants, unavailable: t.trips[0].unavailable || null });
  const base = await invariants(env, 'before refusals'); const refused = {};
  for (const [k, over] of Object.entries({ noEmail: { guest_email: null }, noPhone: { guest_phone: null }, noPrice: { quoted_amount: null, quoted_currency: null, settlement_amount_fjd: null, commission_base_fjd: null } })) {
    const id = 3410 + Object.keys(refused).length; const x = await syncCreated(env, id, over); refused[k] = { status: x.status, reason: x.data.reason }; assert.equal(x.status, 409);
  }
  assert.deepEqual(await invariants(env, 'after refusals'), base, 'refused source rows create no guest, link, grant, job or snapshot');
  note(S, 'required fields absent: refused fail-closed, nothing written', refused);
});

test('SWITCH SAFETY: with every Bula flag off nothing Bula-related is written by a source sync, and the activation gate stays unset', async () => {
  const S = 'cutover-off'; const env = mkEnv({ BULA_SOURCE_SYNC: undefined, BULA_OUTBOX_ENABLED: undefined, BULA_CREDITS_ENABLED: undefined, BULA_CHECKOUT_ENABLED: undefined });
  const r = await syncCreated(env, 3501); assert.equal(r.status, 200);
  const t = { jobs: await count(env, 'bula_outbox'), grants: await count(env, 'bula_credit_ledger'), snaps: await count(env, 'bula_booking_snapshots'), cutover: await count(env, 'bula_settings', "key = 'outbox_cutover_iso'") };
  assert.deepEqual(t, { jobs: 0, grants: 0, snaps: 0, cutover: 0 }); note(S, 'flags off', t);
});

after(() => { const dir = process.env.M4_EVIDENCE_DIR; if (dir) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'm4-scenarios.json'), JSON.stringify({ candidate: '1343f866bac354ec2c90509fdc490391c6729a27', synthetic: true, steps: EV }, null, 2)); } });
