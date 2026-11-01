// SYNTHETIC. M2: edit revalidation, capacity-unit/pricing-basis, strict CSV, atomic audit, CEO named path, source snapshot contract, scheduled handler.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { openD1 } from './test_db.mjs';
import { cfg, FIJI, seedOffer } from './fixtures.mjs';
import { importCsv, approveOffer, editOffer, withdrawOffer, runPublisher, listEdition, parseCsv, validateOfferRow, CSV_COLUMNS } from './offers_d1.js';
import { reserve, grantWelcome } from './inventory_credit.js';
import { issueStaffActor } from './authority.js';
import { snapshotFromSource, snapshotFromMarauRow, saveSnapshot } from './source_snapshot.js';
import { bulaScheduled } from './hook.js';
import { createTestD1 } from '../test/d1_sqlite_shim.mjs';
import worker from '../worker/worker.js';
import { createNadiBookingReader } from '../worker/nadi_booking_reader.js';
const OPS = issueStaffActor({ staffId: 'ana', role: 'ops' }), CEO = issueStaffActor({ staffId: 'james', role: 'ceo' }), APP = issueStaffActor({ staffId: 'ap', role: 'approver' }), ED = issueStaffActor({ staffId: 'ed', role: 'editor' });
const mem = (o) => openD1(':memory:', { init: true, ...o });
const T0 = FIJI('2026-11-01T10:00:00'), C = cfg({ editionPublishEnabled: true, syntheticTest: false });
const H = CSV_COLUMNS.join(',');
const row = (o = {}) => { const d = { offer_id: 'SYN-1', title: 'SYNTHETIC Cruise', operator_id: 'op_syn', service_date: '2026-11-03', service_time: '09:00', pickup_zones: 'Denarau', pricing_basis: 'person', offer_price_fjd: '150.00', max_credit_fjd: '25', capacity_unit: 'seat', capacity_quantity: '4',
  booking_cutoff: '2026-11-02 22:00', inclusions: 'Lunch', exclusions: '', min_spend_fjd: '', cancellation_terms: 'Free 24h before', credit_restore_hours_before: '24', inventory_restore_hours_before: '24', funding_party: 'vakaviti', operator_payout_fjd: '120', instant_confirm: 'no', operator_contract_id: '', ...o };
  return CSV_COLUMNS.map((c) => (/[",\n]/.test(d[c]) ? `"${d[c].replace(/"/g, '""')}"` : d[c])).join(','); };

test('capacity unit must match pricing basis (a party/vehicle price can never be a per-seat inventory unit)', async () => {
  const db = mem();
  const r = await importCsv(db, [H, row({ offer_id: 'A', pricing_basis: 'party', capacity_unit: 'seat' }), row({ offer_id: 'B', pricing_basis: 'vehicle', capacity_unit: 'seat' }), row({ offer_id: 'C', pricing_basis: 'party', capacity_unit: 'party' })].join('\n'), OPS, T0);
  assert.equal(r.created, 0); assert.equal(r.errors.length, 2); assert.ok(r.errors.every((e) => /capacity_unit|pricing_basis/i.test(e.error)));
  assert.equal((await importCsv(db, [H, row({ offer_id: 'C', pricing_basis: 'party', capacity_unit: 'party' })].join('\n'), OPS, T0)).created, 1);
});
test('strict CSV: duplicate / unknown / missing headers, cell-count mismatch, impossible dates and unterminated quotes are rejected with nothing written', async () => {
  const db = mem(); const n = async () => (await db.prepare('SELECT COUNT(*) n FROM bula_offers').first()).n;
  const bad = [[H + ',offer_id', row()], [H + ',surprise', row() + ',x'], [CSV_COLUMNS.slice(1).join(','), row().split(',').slice(1).join(',')], [H, row() + ',extra'], [H, row({ service_date: '2026-02-31' })], [H, row({ booking_cutoff: '2026-13-01 10:00' })], [H, row().replace('SYNTHETIC Cruise', '"unterminated')]];
  for (const [h, r] of bad) { const out = await importCsv(db, `${h}\n${r}`, OPS, T0); assert.equal(out.created, 0, h.slice(0, 30)); }
  assert.equal(await n(), 0); assert.equal((await db.prepare('SELECT COUNT(*) n FROM bula_audit').first()).n, 0);
  assert.throws(() => parseCsv('a,b\n"x,1\n'), /quote/i);
});
test('editOffer revalidates the WHOLE offer (cutoff after start, credit above price, payout above price, basis flip) and leaves the offer untouched on rejection', async () => {
  const db = mem(); await seedOffer(db, { status: 'draft', approved_by: null, approved_at: null });
  const before = await db.prepare('SELECT * FROM bula_offers WHERE offer_id=?').bind('O1').first();
  for (const patch of [{ booking_cutoff_utc: before.service_start_utc + 1 }, { max_credit_cents: before.price_cents + 1 }, { operator_payout_cents: before.price_cents + 1 }, { price_cents: 1000 }, { price_cents: 0 }, { price_cents: 1.5 }, { pricing_basis: 'party' }]) {
    const r = await editOffer(db, 'O1', patch, OPS, T0); assert.equal(r.ok, false, JSON.stringify(patch)); }
  assert.deepEqual(await db.prepare('SELECT * FROM bula_offers WHERE offer_id=?').bind('O1').first(), before);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM bula_audit WHERE action LIKE 'offer_edit%'").first()).n, 0);
  assert.equal((await editOffer(db, 'O1', { price_cents: 17000 }, OPS, T0)).ok, true);
  assert.equal((await editOffer(db, 'O1', { price_cents: 17000 }, ED, T0)).ok, true);                              // editor may edit
  await assert.rejects(() => editOffer(db, 'O1', { price_cents: 17000 }, APP, T0), /ROLE_NOT_PERMITTED/);          // approver may not
});
test('edit uses optimistic concurrency, drops to draft, bumps the version; an existing hold keeps its ORIGINAL snapshot price', async () => {
  const db = mem(); const now = FIJI('2026-11-02T19:00:00'); await seedOffer(db, {}); await grantWelcome(db, C, { partyKey: 'trip:A', actor: 'system', source: 's', nowMs: now });
  const r = await reserve(db, C, { partyKey: 'trip:A', idemKey: 'k', offerId: 'O1', qty: 1, expectedVersion: 1, nowMs: now, ttlMs: 3600e3 }); assert.equal(r.ok, true);
  assert.equal((await editOffer(db, 'O1', { price_cents: 20000 }, CEO, now)).ok, true);
  const o = await db.prepare('SELECT status, version, price_cents FROM bula_offers WHERE offer_id=?').bind('O1').first(); assert.deepEqual([o.status, o.version, o.price_cents], ['draft', 2, 20000]);
  assert.equal((await db.prepare('SELECT price_cents FROM bula_holds WHERE hold_id=?').bind(r.holdId).first()).price_cents, 15000);
  const stale = await reserve(db, C, { partyKey: 'trip:B', idemKey: 'k2', offerId: 'O1', qty: 1, expectedVersion: 1, nowMs: now, ttlMs: 3600e3 }); assert.equal(stale.ok, false);
});
test('ATOMIC AUDIT: a fault between the mutation and its audit row rolls the mutation back (approve, edit, withdraw, import)', async () => {
  for (const [name, act] of [['approve', (db) => approveOffer(db, 'O1', CEO, T0)], ['edit', (db) => editOffer(db, 'O1', { price_cents: 16000 }, CEO, T0)], ['withdraw', (db) => withdrawOffer(db, 'O1', CEO, T0)]]) {
    const db = mem(); await seedOffer(db, { status: name === 'approve' ? 'draft' : 'approved', approved_by: null, approved_at: null, created_by: 'x', booking_cutoff_utc: T0 + 3600e3, service_start_utc: T0 + 7200e3, service_date: '2026-11-01' });
    const snap = JSON.stringify(await db.prepare('SELECT * FROM bula_offers').all()); db.fault.after = 1;                  // crash after the first statement of the batch
    await assert.rejects(() => act(db), undefined, name); db.fault.after = null;
    assert.equal(JSON.stringify(await db.prepare('SELECT * FROM bula_offers').all()), snap, `${name}: offer unchanged`); assert.equal((await db.prepare('SELECT COUNT(*) n FROM bula_audit').first()).n, 0, `${name}: no audit without mutation`);
  }
  const db = mem(); db.fault.after = 1; await assert.rejects(() => importCsv(db, [H, row(), row({ offer_id: 'SYN-2' })].join('\n'), OPS, T0)); db.fault.after = null;
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM bula_offers').first()).n, 0); assert.equal((await db.prepare('SELECT COUNT(*) n FROM bula_audit').first()).n, 0);
});
test('approval roles: a second named person approves; the CEO may self-approve ONLY on a distinctly audited path; ops/editor and strings cannot approve', async () => {
  const db = mem(); const t = T0; await importCsv(db, [H, row()].join('\n'), OPS, t);
  await assert.rejects(() => approveOffer(db, 'SYN-1', OPS, t), /ROLE_NOT_PERMITTED/); await assert.rejects(() => approveOffer(db, 'SYN-1', ED, t), /ROLE_NOT_PERMITTED/); await assert.rejects(() => approveOffer(db, 'SYN-1', 'staff:james', t), /STAFF_IDENTITY_REQUIRED/);
  assert.equal((await approveOffer(db, 'SYN-1', APP, t)).path, 'second_person');
  await importCsv(db, [H, row({ offer_id: 'SYN-2' })].join('\n'), CEO, t); assert.equal((await approveOffer(db, 'SYN-2', CEO, t)).path, 'ceo_self_approval');
  const a = (await db.prepare("SELECT action, actor FROM bula_audit WHERE action LIKE 'offer_approved%' ORDER BY seq").all()).results; assert.deepEqual(a.map((x) => x.action), ['offer_approved', 'offer_approved_ceo_self_approval']); assert.equal(a[1].actor, 'james(ceo)');
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM bula_offers WHERE status='approved' AND approved_by IS NULL").first()).n, 0);          // no anonymous / silent approval
});
test('instant_confirm offers cannot be approved without an approved, in-scope operator contract', async () => {
  const db = mem(); await importCsv(db, [H, row({ instant_confirm: 'yes', operator_contract_id: 'C1' })].join('\n'), OPS, T0);
  assert.equal((await approveOffer(db, 'SYN-1', APP, T0)).code, 'contract_unresolved');
  await db.prepare("INSERT INTO marau_staff_identities (token, operator_name, created_at) VALUES ('t','james','x')").run(); await db.prepare("INSERT INTO bula_staff_roles (staff_id, token, display_name, role, active, created_by, created_at) VALUES ('james','t','James','ceo',1,'admin',0)").run();
  await db.prepare("INSERT INTO bula_operator_contracts (contract_id, operator_id, status, scope_offer_ids, valid_from, valid_to, approved_by_staff_id, approved_at) VALUES ('C1','op_syn','active',NULL,?,?,'james',?)").bind(T0 - 1, T0 + 1e9, T0).run();
  assert.equal((await approveOffer(db, 'SYN-1', APP, T0)).ok, true);
});
test('today vs tomorrow: a same-day still-bookable offer is shown (group today) separately from tomorrow\'s 6pm release', async () => {
  const db = mem(); const now = FIJI('2026-11-02T19:00:00');
  await seedOffer(db, { offer_id: 'TODAY', service_date: '2026-11-02', service_start_utc: FIJI('2026-11-03T08:00:00') - 24 * 3600e3 + 2 * 3600e3 * 0 + 6 * 3600e3, booking_cutoff_utc: FIJI('2026-11-02T22:00:00') });
  await seedOffer(db, { offer_id: 'TOMORROW' });
  const e = await listEdition(db, C, now); const g = Object.fromEntries(e.cards.map((c) => [c.offerId, c.group])); assert.deepEqual(g, { TODAY: 'today', TOMORROW: 'tomorrow' });
});
test('SOURCE CONTRACT: snapshot mirrors source values exactly with provenance; fields the source lacks stay NULL/not_in_source; no fare is recomputed; whole-cent only; version bumps only on change', async () => {
  const db = mem(); const prov = { kind: 'nadi_dispatch_api', reader: 'nadi_booking_reader', read_only: true };
  const full = snapshotFromSource('B1', { source_booking_ref: 'N-9', quoted_currency: 'FJD', quoted_amount: 45.5, flight_number: 'FJ391', passengers: 3, luggage_count: 4, add_ons: 'child seat', discount_amount: 5 }, prov, T0);
  assert.deepEqual([full.currency, full.total_minor, full.flight_number, full.passengers, full.luggage, full.add_ons, full.discount_minor], ['FJD', 4550, 'FJ391', 3, 4, 'child seat', 500]); assert.ok(Object.values(full.availability).every((v) => v === 'source'));
  const today = snapshotFromSource('B2', { quoted_currency: 'FJD', quoted_amount: 45, flight_number: 'FJ1' }, prov, T0);                       // today's real source shape
  assert.deepEqual([today.passengers, today.luggage, today.add_ons, today.discount_minor], [null, null, null, null]); assert.equal(today.availability.passengers, 'not_in_source'); assert.equal(today.availability.discount_minor, 'not_in_source');
  const frac = snapshotFromSource('B3', { quoted_currency: 'FJD', quoted_amount: 45.005 }, prov, T0); assert.equal(frac.total_minor, null); assert.equal(frac.availability.total_minor, 'rejected_not_whole_cents');
  assert.deepEqual(await saveSnapshot(db, full), { version: 1, changed: true }); assert.deepEqual(await saveSnapshot(db, full), { version: 1, changed: false });
  assert.deepEqual(await saveSnapshot(db, { ...full, total_minor: 5000 }), { version: 2, changed: true });
  const stored = await db.prepare('SELECT * FROM bula_booking_snapshots WHERE booking_ref=?').bind('B1').first(); assert.equal(stored.total_minor, 5000); assert.match(stored.provenance_json, /read_only/);
  assert.equal(snapshotFromMarauRow({ client_booking_ref: 'S', quoted_amount: 30 }, T0, 'FJD').provenance.kind, 'marau_synthetic_form');
});
const schedEnv = (over = {}) => ({ DB: createTestD1({ migrationsDirs: [path.join(process.cwd(), '..', 'smart-return-trigger-fill', 'migrations'), path.join(process.cwd(), 'migrations'), path.join(process.cwd(), 'bula', 'migrations')] }), ...over });
test('SCHEDULED handler: all flags OFF = no-op; ON at 17:59 publishes nothing visible, at 18:00 publishes tomorrow once; repeat and catch-up are idempotent', async () => {
  const off = schedEnv(); await seedOffer(off.DB, { status: 'approved', approved_by: 'james' }); assert.deepEqual(await bulaScheduled(off, FIJI('2026-11-02T18:00:00')), {});
  assert.equal((await off.DB.prepare("SELECT status FROM bula_offers").first()).status, 'approved');
  const on = schedEnv({ BULA_EDITION_PUBLISH_ENABLED: 'on', BULA_POLICY_VERSION: 'p1' }); await seedOffer(on.DB, { status: 'approved', approved_by: 'james' });
  const a = await bulaScheduled(on, FIJI('2026-11-02T17:59:00')); assert.equal(a.publish.published, 0);
  const b = await bulaScheduled(on, FIJI('2026-11-02T18:00:00')); assert.equal(b.publish.published, 1); const c = await bulaScheduled(on, FIJI('2026-11-02T18:00:30')); assert.equal(c.publish.published, 0);
  const d = await bulaScheduled(on, FIJI('2026-11-02T21:00:00')); assert.equal(d.publish.published, 0);
  const via = await worker.scheduled({ cron: '0 6 * * *', scheduledTime: Date.now() }, schedEnv(), { waitUntil() {} }); void via;       // Worker-level handler runs and does not throw with flags off
});

test('SOURCE CONTRACT (reader -> snapshot): optional passengers/luggage/add-ons/discount pass through when the source supplies them, are null today, and a wrong type fails closed', async () => {
  const body = (extra = {}) => ({ ok: true, booking: { id: 7, status: 'pending', client_booking_ref: 'B7', quoted_currency: 'FJD', quoted_amount: 170, flight_number: 'FJ391', ...extra } });
  const rd = (b) => createNadiBookingReader({ baseUrl: 'https://dispatch.example.test', adminToken: 't', fetchImpl: async () => ({ status: 200, headers: { get: () => null }, json: async () => b }) });
  const today = snapshotFromSource('B7', await rd(body())('7'), rd.provenance ?? { kind: 'nadi_dispatch_api' }, T0);
  assert.deepEqual([today.total_minor, today.flight_number, today.passengers, today.discount_minor], [17000, 'FJ391', null, null]); assert.equal(today.availability.luggage, 'not_in_source');
  const future = snapshotFromSource('B7', await rd(body({ passengers: 3, luggage_count: 5, add_ons: 'child seat', discount_amount: 10 }))('7'), { kind: 'nadi_dispatch_api' }, T0);
  assert.deepEqual([future.passengers, future.luggage, future.add_ons, future.discount_minor, future.total_minor], [3, 5, 'child seat', 1000, 17000]);   // total is the source's saved total, not recomputed from the discount
  for (const bad of [{ passengers: 'three' }, { add_ons: { x: 1 } }, { discount_amount: 'ten' }]) await assert.rejects(() => rd(body(bad))('7'), /SOURCE_MALFORMED_FIELD_/);
});
