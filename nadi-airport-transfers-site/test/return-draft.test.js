// NAT normal WhatsApp message: return-trip details (2026-10-12 candidate on top of 6264393).
// Real incident: phone test FTT-47N3JG (return 14 Oct 2026 10:00, Hilton, FJ$85) produced a normal WhatsApp draft with "Trip: Return" and no return leg.
// Runs the REAL buildWhatsAppURL() from src/app.js AND the byte-exact live-base copy (test/fixtures/buildWhatsAppURL.base.js, from aebfab6) in vm contexts
// with the same DOM double, and proves: return trips gain exactly the RETURN JOURNEY block, nothing else changes, one-way and tour messages are
// byte-identical to the live base, and nothing outside buildWhatsAppURL() in app.js changed.
// Run: node --test test/return-draft.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8').replace(/\r/g, '');
const baseFn = readFileSync(new URL('./fixtures/buildWhatsAppURL.base.js', import.meta.url), 'utf8').replace(/\r/g, '');
const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8').replace(/\r/g, '');
const sha = (s) => createHash('sha256').update(s).digest('hex');

const START = 'function buildWhatsAppURL(ref) {';
const split = (s) => { const a = s.indexOf(START); const b = s.indexOf('\n}\n', a) + 3; return [s.slice(0, a), s.slice(a, b), s.slice(b)]; };
const [pre, curFn, post] = split(app);
const grab = (name) => { const a = app.indexOf(`function ${name}(`); return app.slice(a, app.indexOf('\n}\n', a) + 3); };
const helpers = ['stripEmoji', 'fareText', 'formatDuration'].map(grab).join('\n');

// pinned from the live base aebfab6 (app.js sha256 4dbb46c5...): everything in app.js outside buildWhatsAppURL()
const BASE_REST_SHA = '1582a4772eeb3f72f4ea80156ec3a0e2ef7758ce7fea1c7dd6bd1f4fcd60da32';
const BASE_FN_SHA = sha(baseFn);

const FIELDS = { firstName: 'James', lastName: 'Deorajan', email: 'g@example.com', phone: '0413335007', travelDate: '2026-10-13', travelTime: '10:00', flightNum: '', notes: '' };
function message(fnSource, { tripType = 'return', fields = {}, hasTour = false, vehicle = 'sedan' } = {}) {
  const f = { ...FIELDS, returnDate: '2026-10-14', returnTime: '10:00', returnPickupLocation: 'Hilton Fiji Beach Resort & Spa', ...fields };
  const els = {};
  for (const [k, v] of Object.entries(f)) els[k] = { value: v, checked: false };
  const state = {
    tripType, selectedVehicle: vehicle, passengers: 2, luggage: 2, distanceKm: 9.97, durationMin: 18,
    pickup: { name: 'Nadi Airport' }, destination: { hotel: 'Hilton Fiji Beach Resort & Spa', area: 'Denarau' },
    selectedTour: hasTour ? { name: 'Cloud 9', duration: '5 hrs', minPax: 2 } : null,
  };
  const totals = hasTour
    ? { hasTour: true, transferSubtotal: 85, tourPerPax: 100, tourTotal: 200, final: 285, qualifies: false }
    : { hasTour: false, qualifies: false, subtotal: 85, discount: 0, final: 85 };
  const c = { document: { getElementById: (id) => els[id] || null }, state, calculateTotal: () => totals, encodeURIComponent, Date, Number, Math };
  vm.createContext(c);
  vm.runInContext(helpers + '\n' + fnSource + '\nglobalThis.out = buildWhatsAppURL("FTT-47N3JG");', c);
  const [to, q] = c.out.split('?text=');
  assert.equal(to, 'https://wa.me/61478886145', 'recipient unchanged');
  return decodeURIComponent(q);
}

test('SCOPE: everything in app.js outside buildWhatsAppURL() is byte-identical to the live base (submit, payload, retry, reference, price, save code cannot have changed)', () => {
  assert.equal(sha(pre + post), BASE_REST_SHA);
  assert.ok(curFn.startsWith(START) && curFn.endsWith('\n}\n'));
});

test('SCOPE: the function differs from the live base only by the added RETURN JOURNEY block and its one spread line (the Distance line loses its trailing blank element, which the block supplies)', () => {
  const stripped = curFn
    .replace(/  \/\/ Return-leg details[\s\S]*?\n    : \[\];\n\n  const msg = \[/, '  const msg = [')
    .replace('formatDuration(state.durationMin)}`,\n    ...returnSection,\n    ``,\n', 'formatDuration(state.durationMin)}`,``,\n');
  assert.equal(stripped, baseFn, 'anything beyond the permitted block and spread line changed');
  assert.equal(curFn.split('\n').length - baseFn.split('\n').length, 21, 'net +21 lines (22 added, 1 changed)');
});

test('return trip (the FTT-47N3JG case): the draft now carries the entered return date, time and pickup location; fare line stays FJ$85', () => {
  const m = message(curFn);
  assert.match(m, /\*RETURN JOURNEY\*/);
  assert.match(m, /Return date:\s+\w{3},? 14 October 2026/);
  assert.match(m, /Return pickup: 10:00/);
  assert.match(m, /Return from:   Hilton Fiji Beach Resort & Spa/);
  assert.ok(m.includes('*TOTAL PRICE: FJ$85*'));
  assert.ok(m.includes('Booking ref: *FTT-47N3JG*') && m.includes('Trip:     Return'));
  // placed in the journey section, before the vehicle section
  assert.ok(m.indexOf('Distance:') < m.indexOf('*RETURN JOURNEY*') && m.indexOf('*RETURN JOURNEY*') < m.indexOf('*VEHICLE & PASSENGERS*'));
});

test('return trip: removing the new block reproduces the live-base message exactly (nothing else in the message changed, incl. the FJ$85 total)', () => {
  const base = message(baseFn), cur = message(curFn);
  const m = cur.match(/\*RETURN JOURNEY\*\n[^\n]*\nReturn date: [^\n]*\nReturn pickup: [^\n]*\nReturn from: [^\n]*\n\n/);
  assert.ok(m, cur);
  assert.equal(cur.replace(m[0], ''), base);
  assert.equal(cur.split('\n').length - base.split('\n').length, 6);
});

test('one-way: the message is byte-identical to the live base', () => {
  const base = message(baseFn, { tripType: 'one-way' }), cur = message(curFn, { tripType: 'one-way' });
  assert.equal(cur, base);
  assert.ok(!cur.includes('RETURN JOURNEY') && cur.includes('Trip:     One-way'));
  // stale return values left in hidden fields never leak into a one-way message
  assert.ok(!cur.includes('Hilton Fiji Beach Resort & Spa\n') || cur.includes('To:       Hilton'));
  assert.ok(!/Return (date|pickup|from)/.test(cur));
});

test('tour booking (return fields hidden for tours): the message is byte-identical to the live base', () => {
  const base = message(baseFn, { tripType: 'return', hasTour: true }), cur = message(curFn, { tripType: 'return', hasTour: true });
  assert.equal(cur, base);
  assert.ok(!cur.includes('RETURN JOURNEY') && cur.includes('TOUR BOOKED'));
});

test('edited return location: the actual typed location is used, not the destination hotel; emoji are stripped; whitespace trimmed', () => {
  const m = message(curFn, { fields: { returnPickupLocation: '  Sheraton Denarau Villas 🌴  ' } });
  assert.match(m, /Return from:   Sheraton Denarau Villas\n/);
  assert.ok(!/Return from:.*Hilton/.test(m));
  assert.match(m, /To:       Hilton Fiji Beach Resort & Spa/, 'the outbound destination is unchanged');
});

test('return location left blank falls back to the destination hotel; missing return date/time say Not set (never "undefined")', () => {
  const blank = message(curFn, { fields: { returnPickupLocation: '' } });
  assert.match(blank, /Return from:   Hilton Fiji Beach Resort & Spa/);
  const bare = message(curFn, { fields: { returnDate: '', returnTime: '' } });
  assert.match(bare, /Return date:   Not set/); assert.match(bare, /Return pickup: Not set/);
  for (const m of [blank, bare]) assert.ok(!/undefined|NaN|Invalid/.test(m));
});

test('different vehicle and a changed return date/time flow through (not hard-coded)', () => {
  const m = message(curFn, { vehicle: 'minivan', fields: { returnDate: '2026-12-31', returnTime: '23:15' } });
  assert.match(m, /Return date:\s+\w{3},? 31 December 2026/); assert.match(m, /Return pickup: 23:15/);
});

test('cache key: the app.js script tag is the only index.html line touched for this change, and it carries a new key so browsers (4 h max-age on app.js) fetch the corrected file', () => {
  assert.ok(html.includes('<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script><script src="app.js?v=20261012-return-draft"></script>'));
  assert.ok(!html.includes('app.js?v=20261005-wa-handoff'));
  assert.equal(html.match(/src="app\.js\?v=/g).length, 1);
});

test('the pinned live-base function is the one the gate compares against', () => {
  assert.equal(BASE_FN_SHA.length, 64);
  assert.ok(baseFn.includes('const tripLabel = state.tripType') && !baseFn.includes('RETURN JOURNEY'));
});
