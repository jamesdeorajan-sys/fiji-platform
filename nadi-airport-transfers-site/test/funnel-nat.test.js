// NAT on-site funnel events (funnel-nat.js): observe-only, no guest data, only event names the funnel Worker accepts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../src/funnel-nat.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
// The funnel Worker's accepted values (funnel-events-worker/worker.js ALLOWED_EVENTS / ALLOWED_PLATFORMS).
const ALLOWED = new Set(['booking_page_view', 'route_selected', 'vehicle_selected', 'details_opened', 'confirm_clicked', 'booking_post_started', 'booking_post_succeeded', 'booking_post_failed', 'human_notification_sent', 'whatsapp_opened']);
const KEYS = ['event_type', 'platform', 'session_id', 'first_source', 'first_medium', 'first_campaign', 'first_content', 'first_referrer', 'first_landing_path', 'route_slug'];

function el(id, extra = {}) {
  return { id, value: '', style: { display: '' }, hidden: false, offsetParent: {}, textContent: '', disabled: false, checked: false, classList: { contains: () => false }, closest: () => null, ...extra };
}
function page({ path = '/', search = '?utm_source=google&utm_medium=organic', referrer = 'https://www.google.com/' } = {}) {
  const els = { booking: el('booking'), pickup: el('pickup'), destination: el('destination'), step3: el('step3', { style: { display: 'none' } }), bulaSuccess: el('bulaSuccess', { style: { display: 'none' } }), bulaRef: el('bulaRef'), bulaLeadText: el('bulaLeadText') };
  const listeners = {}; const observers = [];
  const store = {};
  const document = { readyState: 'complete', referrer, getElementById: (id) => els[id] || null, querySelector: () => null, addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); } };
  const c = {
    window: {}, document, location: { pathname: path, search }, URLSearchParams, JSON, Array, Object, Uint8Array, Math, Blob: class { constructor(p) { this.p = p; } },
    sessionStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
    crypto: { randomUUID: () => 'sid-1' }, navigator: { sendBeacon: () => { throw new Error('must not send in tests'); } }, fetch: () => { throw new Error('must not fetch in tests'); },
    MutationObserver: class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} },
  };
  c.window.__NAT_FUNNEL_CAPTURE = [];
  c.window.window = c.window;
  vm.createContext(c);
  // make `window.x` and bare globals the same object, as in a browser
  vm.runInContext('Object.assign(globalThis, window); window = globalThis;', c);
  vm.runInContext(SRC, c);
  const fire = (type, target) => (listeners[type] || []).forEach((fn) => fn({ target }));
  const mutate = () => observers.forEach((o) => o.cb([]));
  return { c, els, fire, mutate, events: () => c.__NAT_FUNNEL_CAPTURE.map((e) => e.event_type), payloads: () => c.__NAT_FUNNEL_CAPTURE };
}

test('wiring: the home page loads funnel-nat.js once, after app.js; no other page loads it', () => {
  assert.equal(HTML.split('funnel-nat.js').length, 2);
  assert.ok(HTML.indexOf('funnel-nat.js') > HTML.indexOf('app.js?v='));
});

test('observe-only: the script never calls or references booking functions, prices or the booking API', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'); // code only, comments removed
  for (const f of ['submitNadiBooking', 'confirmBooking', 'bookingRequest', 'calculateTotal', 'state.', 'NADI_API_BASE', 'api.nadiairporttransfers.com', 'quoted_amount', 'firstName', 'email', 'phone', 'notes']) assert.ok(!code.includes(f), 'funnel-nat.js references ' + f);
  assert.ok(!APP.includes('funnel'), 'app.js is untouched by the funnel candidate');
});

test('happy path: the whole funnel produces the allowed events in order, with no guest data', () => {
  const p = page();
  p.els.pickup.value = 'NAN'; p.fire('change', p.els.pickup);
  p.els.destination.value = 'HILTON_DENARAU'; p.fire('change', p.els.destination);
  p.fire('change', { classList: { contains: (c) => c === 'vehicle-radio' }, checked: true });
  p.els.step3.style.display = 'block'; p.mutate();
  p.fire('click', { closest: (s) => (s === '.btn-confirm' ? {} : null) });
  p.els.bulaRef.textContent = 'Booking #305 · Ref: FTT-ABC123'; p.els.bulaLeadText.textContent = 'Your request is saved online, but your transfer is not confirmed yet.'; p.els.bulaSuccess.style.display = 'block'; p.mutate();
  p.fire('click', { closest: (s) => (s === '#bulaWaBtn' ? { href: 'https://wa.me/61478886145?text=x' } : null) });
  assert.deepEqual(p.events(), ['booking_page_view', 'route_selected', 'vehicle_selected', 'details_opened', 'confirm_clicked', 'booking_post_started', 'booking_post_succeeded', 'whatsapp_opened']);
  for (const e of p.payloads()) {
    assert.ok(ALLOWED.has(e.event_type), e.event_type);
    assert.equal(e.platform, 'nadi');
    assert.deepEqual(Object.keys(e).sort(), [...KEYS].sort(), 'only the funnel Worker fields, no guest data');
    assert.equal(e.session_id, 'sid-1');
    assert.equal(e.first_source, 'google'); assert.equal(e.first_landing_path, '/');
  }
  assert.ok(!JSON.stringify(p.payloads()).includes('FTT-ABC123') && !JSON.stringify(p.payloads()).includes('305'), 'no booking id or reference is sent');
});

test('outcomes: failed save, retry that succeeds, WhatsApp-only path; repeated mutations do not duplicate events', () => {
  const p = page();
  p.fire('click', { closest: (s) => (s === '.btn-confirm' ? {} : null) });
  p.els.bulaLeadText.textContent = 'We could not confirm that your request was saved online.'; p.els.bulaSuccess.style.display = 'block'; p.mutate(); p.mutate();
  p.fire('click', { closest: (s) => (s === '.btn-confirm' ? {} : null) }); // the guest retries
  p.els.bulaRef.textContent = 'Booking #306 · Ref: FTT-X'; p.mutate(); p.mutate();
  assert.deepEqual(p.events(), ['booking_page_view', 'confirm_clicked', 'booking_post_started', 'booking_post_failed', 'confirm_clicked', 'booking_post_started', 'booking_post_succeeded']);
  const q = page();
  q.fire('click', { closest: (s) => (s === '.btn-confirm' ? {} : null) });
  q.els.bulaLeadText.textContent = 'This request has not been saved online. Your reservation details are ready to send on WhatsApp.'; q.els.bulaSuccess.style.display = 'block'; q.mutate();
  assert.deepEqual(q.events(), ['booking_page_view', 'confirm_clicked'], 'no save attempted -> no post events');
});

test('route attribution and robustness: route slug from utm_content; storage failures and missing elements never throw', () => {
  const p = page({ search: '?utm_source=organic&utm_content=hilton-fiji-beach-resort', referrer: '' });
  assert.equal(p.payloads()[0].route_slug, 'hilton-fiji-beach-resort');
  assert.equal(p.payloads()[0].first_referrer, null);
  const c = { window: { __NAT_FUNNEL_CAPTURE: [] }, document: { readyState: 'complete', referrer: '', getElementById: () => null, addEventListener() {} }, location: { pathname: '/x', search: '' }, URLSearchParams, JSON, Object, Array, Math, Uint8Array, sessionStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, crypto: {}, navigator: {}, MutationObserver: class { observe() {} } };
  vm.createContext(c); vm.runInContext('Object.assign(globalThis, window); window = globalThis;', c);
  assert.doesNotThrow(() => vm.runInContext(SRC, c));
  assert.equal(c.__NAT_FUNNEL_CAPTURE.length, 0, 'no booking form on the page -> no events');
});

test('deep link / restored draft: a route already filled in on arrival records route_selected once', () => {
  const p = page({ search: '?pickup=NAN&dest=NAVITI_RESORT&utm_content=naviti-resort' });
  // page() runs the script immediately with empty fields; simulate the page having prefilled them before the script ran
  const q = (() => {
    const els = { booking: { id: 'booking' }, pickup: { id: 'pickup', value: 'NAN' }, destination: { id: 'destination', value: 'NAVITI_RESORT' } };
    const c = { window: { __NAT_FUNNEL_CAPTURE: [] }, document: { readyState: 'complete', referrer: '', getElementById: (id) => els[id] || null, addEventListener() {} }, location: { pathname: '/', search: '?pickup=NAN&dest=NAVITI_RESORT' }, URLSearchParams, JSON, Object, Array, Math, Uint8Array, Blob: class {}, sessionStorage: { getItem: () => null, setItem() {} }, crypto: { randomUUID: () => 's' }, navigator: {}, MutationObserver: class { observe() {} } };
    vm.createContext(c); vm.runInContext('Object.assign(globalThis, window); window = globalThis;', c); vm.runInContext(SRC, c);
    return c.__NAT_FUNNEL_CAPTURE.map((e) => e.event_type);
  })();
  assert.deepEqual(q, ['booking_page_view', 'route_selected']);
  // an empty form on arrival does not record a route
  assert.deepEqual(p.events(), ['booking_page_view']);
  // and a later change does not record it twice
  p.els.pickup.value = 'NAN'; p.els.destination.value = 'NAVITI_RESORT'; p.fire('change', p.els.destination); p.fire('change', p.els.destination);
  assert.deepEqual(p.events(), ['booking_page_view', 'route_selected']);
});

test('WhatsApp hand-off: only the booking hand-off button counts (as FijiDash), once per save attempt; general WhatsApp links neither count nor block it', () => {
  const generalWa = { closest: (s) => (s === 'a[href]' ? { href: 'https://wa.me/61478886145' } : null) }; // header / footer / FAQ link
  const handoff = { closest: (s) => (s === '#bulaWaBtn' ? { href: 'https://wa.me/61478886145?text=x' } : null) };
  const confirm = { closest: (s) => (s === '.btn-confirm' ? {} : null) };
  const p = page();
  p.fire('click', generalWa); p.fire('click', generalWa);
  assert.deepEqual(p.events(), ['booking_page_view'], 'general WhatsApp contact is not a booking hand-off');
  p.fire('click', confirm);
  p.els.bulaRef.textContent = 'Booking #307 · Ref: FTT-Y'; p.els.bulaSuccess.style.display = 'block'; p.mutate();
  p.fire('click', handoff); p.fire('click', handoff);
  assert.deepEqual(p.events(), ['booking_page_view', 'confirm_clicked', 'booking_post_started', 'booking_post_succeeded', 'whatsapp_opened'], 'a double tap counts once');
  p.fire('click', confirm); p.fire('click', handoff); // "Book another transfer" in the same tab: its own attempt and its own hand-off
  assert.deepEqual(p.events().slice(-2), ['confirm_clicked', 'whatsapp_opened']);
});
