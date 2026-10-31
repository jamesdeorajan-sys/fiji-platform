// SYNTHETIC only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openD1 } from './test_db.mjs';
import { cfg, FIJI } from './fixtures.mjs';
import { importCsv, approveOffer, editOffer, withdrawOffer, runPublisher, listEdition, parseCsv, CSV_COLUMNS } from './offers_d1.js';
import { grantWelcome, reserve } from './inventory_credit.js';

const C = cfg({ editionPublishEnabled: true, syntheticTest: false, creditsEnabled: true, checkoutEnabled: true });
const mem = () => openD1(':memory:', { init: true });
const TEMPLATE = fs.readFileSync(new URL('./OFFER-ENTRY-TEMPLATE.csv', import.meta.url), 'utf8');
const H = CSV_COLUMNS.join(',');
const row = (o = {}) => { const d = { offer_id: 'SYN-1', title: 'SYNTHETIC Cruise', operator_id: 'op_syn', service_date: '2026-11-03', service_time: '09:00', pickup_zones: 'Denarau;Nadi', pricing_basis: 'person', offer_price_fjd: '150.00', max_credit_fjd: '25', capacity_unit: 'seat', capacity_quantity: '2',
  booking_cutoff: '2026-11-02 22:00', inclusions: 'Lunch, snorkel', exclusions: '', min_spend_fjd: '', cancellation_terms: 'Free 24h before', credit_restore_hours_before: '24', inventory_restore_hours_before: '24', funding_party: 'vakaviti', operator_payout_fjd: '120', instant_confirm: 'no', operator_contract_id: '', ...o };
  return CSV_COLUMNS.map((c) => (/[",\n]/.test(d[c]) ? `"${d[c].replace(/"/g, '""')}"` : d[c])).join(','); };
const csv = (...rows) => [H, ...rows].join('\n');
const T0 = FIJI('2026-11-01T10:00:00');

test('template has every required column and its example row is REJECTED (no placeholder can be published)', async () => {
  assert.deepEqual(parseCsv(TEMPLATE)[0], CSV_COLUMNS); const db = mem();
  const r = await importCsv(db, TEMPLATE, 'staff:james', T0); assert.equal(r.created, 0); assert.match(r.errors[0].error, /example row/);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM bula_offers').first()).n, 0);
});
test('import is all-or-nothing, draft-only, validates money/dates/instant-confirm, and AI/non-staff actors are refused', async () => {
  const db = mem();
  const bad = await importCsv(db, csv(row(), row({ offer_id: 'SYN-2', offer_price_fjd: '15O' }), row({ offer_id: 'SYN-3', instant_confirm: 'yes' }), row({ offer_id: 'SYN-4', booking_cutoff: '2026-11-03 10:00' }), row({ offer_id: 'SYN-5', max_credit_fjd: '999' }), row({ offer_id: 'SYN-6', service_time: '9am' })), 'staff:james', T0);
  assert.equal(bad.created, 0); assert.equal(bad.errors.length, 5); assert.equal((await db.prepare('SELECT COUNT(*) n FROM bula_offers').first()).n, 0);
  assert.match(bad.errors.map((e) => e.error).join('|'), /operator_contract_id/);
  await assert.rejects(() => importCsv(db, csv(row()), 'ai:assistant', T0), /STAFF_ACTOR_REQUIRED/);
  const ok = await importCsv(db, csv(row(), row({ offer_id: 'SYN-2', title: 'Quote, "inside"' })), 'staff:ana', T0); assert.equal(ok.created, 2);
  const o = await db.prepare("SELECT * FROM bula_offers WHERE offer_id = 'SYN-1'").first();
  assert.deepEqual([o.status, o.price_cents, o.max_credit_cents, o.remaining, o.pickup_zones, o.service_start_utc, o.booking_cutoff_utc], ['draft', 15000, 2500, 2, 'Denarau,Nadi', FIJI('2026-11-03T09:00:00'), FIJI('2026-11-02T22:00:00')]);
  assert.equal((await db.prepare("SELECT title FROM bula_offers WHERE offer_id='SYN-2'").first()).title, 'Quote, "inside"');
  assert.equal((await importCsv(db, csv(row()), 'staff:ana', T0)).errors[0].error, 'offer_id already exists: SYN-1');
});
test('drafts are never published; creator cannot self-approve; approval is audited', async () => {
  const db = mem(); await importCsv(db, csv(row()), 'staff:ana', T0);
  assert.equal((await runPublisher(db, C, FIJI('2026-11-02T18:30:00'))).published, 0);
  assert.equal((await approveOffer(db, 'SYN-1', 'staff:ana', T0)).code, 'not_draft_or_self_approval'); await assert.rejects(() => approveOffer(db, 'SYN-1', 'ai:x', T0), /STAFF_ACTOR/);
  assert.equal((await approveOffer(db, 'SYN-1', 'staff:james', T0)).ok, true);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM bula_audit WHERE action='offer_approved'").first()).n, 1);
});
test('18:00 Fiji release: 17:59 nothing visible, 18:00 visible, publisher idempotent', async () => {
  const db = mem(); await importCsv(db, csv(row()), 'staff:ana', T0); await approveOffer(db, 'SYN-1', 'staff:james', T0);
  const a = await runPublisher(db, C, FIJI('2026-11-02T17:59:00')); assert.deepEqual([a.published, a.scheduled], [0, 1]);
  const e1 = await listEdition(db, C, FIJI('2026-11-02T17:59:00')); assert.equal(e1.empty, true); assert.match(e1.message, /6 pm Fiji/);
  const b = await runPublisher(db, C, FIJI('2026-11-02T18:00:00')); assert.equal(b.published, 1); assert.equal((await runPublisher(db, C, FIJI('2026-11-02T18:00:30'))).published, 0);
  assert.equal((await listEdition(db, C, FIJI('2026-11-02T18:00:00'))).cards.length, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM bula_editions').first()).n, 1);
});
test('31 Dec -> 1 Jan: the 1 Jan edition appears at 18:00 on 31 Dec, not before', async () => {
  const db = mem(); await importCsv(db, csv(row({ offer_id: 'NY', service_date: '2027-01-01', booking_cutoff: '2026-12-31 22:00' })), 'staff:ana', T0); await approveOffer(db, 'NY', 'staff:james', T0);
  await runPublisher(db, C, FIJI('2026-12-31T17:59:59')); assert.equal((await listEdition(db, C, FIJI('2026-12-31T17:59:59'))).empty, true);
  await runPublisher(db, C, FIJI('2026-12-31T18:00:00')); assert.equal((await listEdition(db, C, FIJI('2026-12-31T18:00:00'))).cards[0].serviceDate, '2027-01-01');
});
test('missed run: a late publisher run catches up for live offers, expires stale ones, never publishes past cutoff', async () => {
  const db = mem(); await importCsv(db, csv(row(), row({ offer_id: 'STALE', booking_cutoff: '2026-11-02 19:00' })), 'staff:ana', T0);
  for (const id of ['SYN-1', 'STALE']) await approveOffer(db, id, 'staff:james', T0);
  const r = await runPublisher(db, C, FIJI('2026-11-02T21:00:00'));       // scheduler was down at 18:00
  assert.deepEqual([r.published, r.expired], [1, 1]); const st = (id) => db.prepare('SELECT status FROM bula_offers WHERE offer_id = ?').bind(id).first();
  assert.equal((await st('STALE')).status, 'expired'); assert.equal((await st('SYN-1')).status, 'published');
});
test('withdrawn offers vanish from the edition and cannot be reserved; edit after publish drops to draft and bumps version', async () => {
  const db = mem(); await importCsv(db, csv(row(), row({ offer_id: 'W' })), 'staff:ana', T0); for (const id of ['SYN-1', 'W']) await approveOffer(db, id, 'staff:james', T0);
  const now = FIJI('2026-11-02T19:00:00'); await runPublisher(db, C, now); assert.equal((await listEdition(db, C, now)).cards.length, 2);
  await withdrawOffer(db, 'W', 'staff:james', now); assert.equal((await listEdition(db, C, now)).cards.length, 1);
  assert.equal((await reserve(db, C, { partyKey: 'p', idemKey: '1', offerId: 'W', expectedVersion: 1, nowMs: now })).code, 'not_published');
  assert.equal((await editOffer(db, 'SYN-1', { price_cents: 16000 }, 'staff:james', now)).ok, true);
  const o = await db.prepare("SELECT status, version, approved_by FROM bula_offers WHERE offer_id='SYN-1'").first(); assert.deepEqual([o.status, o.version, o.approved_by], ['draft', 2, null]);
  assert.equal((await listEdition(db, C, now)).empty, true); assert.equal((await editOffer(db, 'SYN-1', { capacity_total: 99 }, 'staff:james', now)).code, 'field_not_editable');
});
test('cards show price, applicable credit for THIS guest, net payable, live remaining stock, unit, date and cutoff — and only real values', async () => {
  const db = mem(); await importCsv(db, csv(row()), 'staff:ana', T0); await approveOffer(db, 'SYN-1', 'staff:james', T0); const now = FIJI('2026-11-02T19:00:00'); await runPublisher(db, C, now);
  await grantWelcome(db, C, { partyKey: 'trip:A', actor: 'system', source: 's', nowMs: now });
  const c = (await listEdition(db, C, now, 'trip:A')).cards[0];
  assert.deepEqual([c.offerPriceCents, c.creditCents, c.netPayableCents, c.remaining, c.capacityUnit, c.serviceDate, c.bookingCutoffUtc], [15000, 2500, 12500, 2, 'seat', '2026-11-03', FIJI('2026-11-02T22:00:00')]);
  const anon = (await listEdition(db, C, now)).cards[0]; assert.deepEqual([anon.creditCents, anon.netPayableCents], [0, 15000]);
  await reserve(db, C, { partyKey: 'trip:A', idemKey: '1', offerId: 'SYN-1', expectedVersion: 1, nowMs: now });
  assert.equal((await listEdition(db, C, now)).cards[0].remaining, 1);                    // live stock, no fabricated scarcity
  const off = await listEdition(db, { ...C, editionPublishEnabled: false }, now); assert.equal(off.cards.length, 1);
  assert.equal((await runPublisher(db, { ...C, editionPublishEnabled: false }, now)).skipped, 'edition_publish_disabled');
});
