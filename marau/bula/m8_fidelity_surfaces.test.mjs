// Source-fidelity review: no Bula API, email or UI turns SOURCE_MISSING / NOT_APPLICABLE into an apparently real guest fact. SYNTHETIC only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderGuest } from './outbox_d1.js';
import { renderGuestEmail } from './outbox.js';
import { setup, poll, add, boot, TOKEN } from './disc_helpers.mjs';
import { call, one, count, tokenFor } from './m3_helpers.mjs';
import { loadConfig } from './config.js';

const cfg = loadConfig({ BULA_SYNTHETIC_TEST: 'on', BULA_GUEST_ORIGIN: 'https://guest.synthetic.test' }); const sess = { access_token: 'tok', whatsapp_available: null };
const base = { client_booking_ref: 'R', source_booking_ref: '9', source_sync_owned: 1, status: 'pending', guest_email: 'g@example.test', pickup_zone: 'A', destination_zone: 'B', vehicle_type: 'sedan', pickup_datetime: '2026-11-20T01:30:00.000Z', quoted_amount: 85, source_currency: 'FJD' };

test('GUEST EMAIL: absent flight / passengers / luggage / add-ons / discount produce NO line at all (no "undefined", "null", 0, 1 or "none")', () => {
  const t = renderGuest(base, sess, cfg).message.text;
  for (const l of ['Flight', 'Passengers', 'Luggage', 'Add-ons', 'Discount']) assert.ok(!t.includes(l), l); assert.ok(!/undefined|null|NaN/.test(t));
  const full = renderGuest({ ...base, flight_number: 'FJ391', passengers: 3, luggage: 2 }, sess, cfg).message.text; assert.match(full, /Flight: FJ391/); assert.match(full, /Passengers: 3/);
});
test('GUEST EMAIL: a source-mirrored booking with NO currency is BLOCKED, never given a default currency; a non-source preview row keeps its legacy default', () => {
  assert.equal(renderGuest({ ...base, source_currency: null }, sess, cfg).blocked, 'missing_currency');
  assert.ok(renderGuest({ ...base, source_sync_owned: 0, source_currency: null }, sess, { ...cfg, defaultCurrency: 'FJD' }).message);
  for (const m of [{ pickup_datetime: null }, { quoted_amount: null }, { pickup_zone: null }]) assert.match(renderGuest({ ...base, ...m }, sess, cfg).blocked, /^missing_/);
});
test('LEGACY receipt template prints no passengers line when none is known', () => {
  const j = { payload: { bookingRef: 'R', status: 'pending', pickupFijiLocal: 'x', from: 'A', to: 'B', currency: 'FJD', priceCents: 100, guestEmail: 'g@example.test' } };
  const t = renderGuestEmail(j, { privateTripUrl: 'https://x.test/t' }).text; assert.ok(!/Passengers|undefined|null/.test(t));
});
test('TRIP API end to end: a booking with no flight - flight, passengers, luggage, add-ons and discount are all { available:false } and carry no value; price keeps its source currency', async () => {
  const t = setup(); await boot(t); add(t.store, 3, { flight_number: null }); await poll(t.env);
  const tok = await tokenFor(t.env, 3); const r = await one(await call(t.env, 'GET', '/preview/bula/trip', { tok, admin: false })); assert.equal(r.status, 200);
  const d = r.data.trips[0].details; for (const k of ['flightNumber', 'passengers', 'luggage', 'addOns', 'discount']) assert.deepEqual(d[k], { available: false }, k);
  assert.equal(d.total.available, true); assert.equal(d.total.value.currency, 'FJD'); assert.equal(d.total.value.cents, 8500);
  assert.ok(!JSON.stringify(r.data).match(/"passengers":\s*[0-9]|"luggage":\s*[0-9]/));
});
test('TRIP API: a return that the source does not carry is not invented (one leg, no return leg)', async () => {
  const t = setup(); await boot(t); add(t.store, 3, { return_date: null, return_time: null }); await poll(t.env);
  const r = await one(await call(t.env, 'GET', '/preview/bula/trip', { tok: await tokenFor(t.env, 3), admin: false })); assert.equal(r.data.trips[0].legs.length, 1);
});
test('UI source review: every detail row falls back to the fixed text "Not available from your booking record"; no numeric/text default literal sits beside passengers/luggage/flight/add-ons/discount; an unknown currency is labelled, not assumed', () => {
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  assert.match(ui, /x\[1\]\|\|'Not available from your booking record'/);
  for (const k of ['Flight number', 'Passengers', 'Luggage', 'Add-ons', 'Discount', 'Quoted total']) assert.ok(new RegExp(`\\['${k}',D\\.\\w+&&D\\.\\w+\\.available\\?[^\\]]*:null\\]`).test(ui), k);
  assert.match(ui, /currency not provided/); assert.doesNotMatch(ui, /passengers\|\|\s*\d|luggage\|\|\s*\d|\|\|'FJD'/);
});
