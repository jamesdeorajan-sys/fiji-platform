// NAT booking source (first / last touch) sent with the booking: FijiDash's 15 fields and rules, no guest data, never breaks a booking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { undoRouteVehicle } from './route-vehicle-revert.js'; // newest candidate on top: earlier pins describe production 9eff91b and older
const SRC = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8').replace(/\r/g, '');
const FUNNEL = readFileSync(new URL('../src/funnel-nat.js', import.meta.url), 'utf8');
const block = SRC.slice(SRC.indexOf("const NAT_ATTRIBUTION_KEY"), SRC.indexOf('// Same real, unambiguous zone list'));
const submit = SRC.slice(SRC.indexOf('async function submitNadiBooking('), SRC.indexOf('// Same non-blocking, fire-and-forget escalation pattern'));
const KEYS = ['first_source', 'first_medium', 'first_campaign', 'first_content', 'first_term', 'first_referrer', 'first_landing_path', 'first_seen_at',
  'last_source', 'last_medium', 'last_campaign', 'last_content', 'last_term', 'last_referrer', 'last_landing_path'];

function page({ search = '', referrer = '', path = '/', store = {}, storage = 'ok' } = {}) {
  const ls = storage === 'ok' ? { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } }
    : { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const sb = { window: { location: { search, pathname: path, hostname: 'nadiairporttransfers.com' } }, document: { referrer }, localStorage: ls, URLSearchParams, URL, JSON, Date, String, Object };
  vm.createContext(sb); vm.runInContext(block, sb);
  return { sb, store, capture: () => vm.runInContext('captureNatAttribution()', sb), payload: () => vm.runInContext('getNatAttributionForPayload()', sb) };
}

test('Google landing: external referrer is kept as host only, landing path only (no query string)', () => {
  const p = page({ search: '?utm_source=google&utm_medium=cpc&gclid=SECRET', referrer: 'https://www.google.com/search?q=fiji+transfers', path: '/' });
  p.capture(); const a = p.payload();
  assert.deepEqual(Object.keys(a).sort(), [...KEYS].sort());
  assert.equal(a.first_source, 'google'); assert.equal(a.first_medium, 'cpc'); assert.equal(a.first_referrer, 'www.google.com'); assert.equal(a.first_landing_path, '/');
  assert.ok(!JSON.stringify(a).includes('SECRET') && !JSON.stringify(a).includes('q=fiji'), 'no query string or click id is stored');
  assert.match(a.first_seen_at, /^\d{4}-\d\d-\d\dT/);
});

test('resort route page → home page: an internal referrer keeps its path, so the route page is attributable', () => {
  const p = page({ referrer: 'https://nadiairporttransfers.com/transfer/naviti-resort?x=1#faq' });
  p.capture(); const a = p.payload();
  assert.equal(a.first_referrer, 'nadiairporttransfers.com/transfer/naviti-resort'); assert.equal(a.first_source, null);
});

test('first touch is kept; last touch moves only on a utm link or an external referrer (FijiDash rule)', () => {
  const store = {};
  page({ search: '?utm_source=facebook', referrer: 'https://l.facebook.com/', store }).capture();
  page({ referrer: 'https://nadiairporttransfers.com/transfer/hilton-fiji-beach-resort', store }).capture(); // in-site navigation: last unchanged
  let a = page({ store }).payload();
  assert.equal(a.first_source, 'facebook'); assert.equal(a.last_source, 'facebook'); assert.equal(a.last_referrer, 'l.facebook.com');
  page({ referrer: 'https://chatgpt.com/', store }).capture(); // a new external touch
  a = page({ store }).payload();
  assert.equal(a.first_source, 'facebook'); assert.equal(a.last_referrer, 'chatgpt.com');
});

test('storage blocked or corrupt: no throw, all 15 fields null, booking unaffected', () => {
  const p = page({ storage: 'blocked' });
  assert.doesNotThrow(() => p.capture());
  assert.deepEqual(Object.values(p.payload()), KEYS.map(() => null));
  const q = page({ store: { nat_attribution_v1: '{not json' } });
  assert.deepEqual(Object.values(q.payload()), KEYS.map(() => null));
});

test('the booking payload gains exactly the 15 source fields; every existing field is unchanged; no guest data in them', async () => {
  const run = async (withAttr) => {
    const calls = [];
    const fields = { firstName: { value: 'Ana' }, lastName: { value: 'Tui' }, phone: { value: '+679 999 1234' }, email: { value: 'ana@example.test' }, flightNum: { value: 'FJ910' },
      notes: { value: 'late flight' }, travelDate: { value: '2026-11-20' }, travelTime: { value: '10:30' }, 'extra-seat': { checked: false }, 'extra-surf': { checked: false } };
    const p = page({ search: '?utm_source=organic&utm_content=naviti-resort', referrer: 'https://www.bing.com/' }); p.capture();
    const sb = { document: { getElementById: (id) => fields[id] }, state: { selectedVehicle: 'sedan', tripType: 'one-way', distanceKm: 90 },
      NADI_API_BASE: 'https://api.test', JSON, Number, calculateTotal: () => ({ final: 139 }), buildOperationalNotes: () => 'notes',
      getNatAttributionForPayload: withAttr ? () => p.payload() : () => ({}),
      bookingRequest: async (url, o) => { calls.push(JSON.parse(o.body)); return { response: { ok: true, status: 201 }, data: { ok: true, booking_id: 1 } }; }, reportNadiSyncFailure: async () => {} };
    vm.createContext(sb); vm.runInContext(submit, sb);
    const r = await sb.submitNadiBooking('FTT-ABC', 'Coral Coast');
    return { r, body: calls[0] };
  };
  const base = await run(false), withA = await run(true);
  assert.equal(withA.r.ok, true);
  const extra = Object.keys(withA.body).filter((k) => !(k in base.body));
  assert.deepEqual(extra.sort(), [...KEYS].sort(), 'only the 15 source keys are added');
  for (const k of Object.keys(base.body)) assert.deepEqual(withA.body[k], base.body[k], 'unchanged: ' + k);
  const src = JSON.stringify(KEYS.map((k) => withA.body[k]));
  for (const pii of ['Ana', 'Tui', '999', 'ana@example', 'FJ910', 'late flight', 'FTT-ABC', '139']) assert.ok(!src.includes(pii), 'no guest/booking data in source fields: ' + pii);
  assert.equal(withA.body.first_content, 'naviti-resort'); assert.equal(withA.body.first_referrer, 'www.bing.com');
});

test('analytics is untouched: funnel-nat.js does not read or send the booking-source store', () => {
  assert.ok(!FUNNEL.includes('nat_attribution_v1') && !FUNNEL.includes('getNatAttributionForPayload'));
  assert.ok(SRC.includes("try { captureNatAttribution(); } catch (e) { /* never blocks page init */ }"), 'captured once at page init, guarded');
});

test('cache key: app.js is requested with a new key (4 h max-age), and that script tag is the only index.html line changed', () => {
  const html = undoRouteVehicle('index.html', readFileSync(new URL('../src/index.html', import.meta.url), 'utf8'));
  assert.equal(html.split('app.js?v=20261016-attribution').length, 2);
  assert.ok(!html.includes('app.js?v=20261012-return-draft'));
});
