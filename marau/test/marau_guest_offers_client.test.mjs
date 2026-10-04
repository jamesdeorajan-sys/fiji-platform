/* Marau (PREVIEW/TEST ONLY) - the guest offers/referral/contact CLIENT, executed from the text actually SERVED in
 * GUEST_APP_HTML (never an imported copy - the lesson of round 25's nested-escaping bug), plus structural checks that the
 * page wires it in without any private data on the public referral surfaces. Evidence label: LOCAL, AUTHOR-RUN.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUEST_APP_HTML } from '../worker/pages.js';
import { formatFijiCurrency } from '../worker/guest_display.js';

function loadServedClient() {
  const start = GUEST_APP_HTML.indexOf('function createOffersClient(deps)');
  assert.ok(start !== -1, 'createOffersClient is present in the served page');
  const end = GUEST_APP_HTML.indexOf('\n}\n', start) + 3;
  const source = GUEST_APP_HTML.slice(start, end);
  return new Function(`${source}\nreturn createOffersClient;`)();
}

function makeClient(overrides = {}) {
  const store = new Map();
  const create = loadServedClient();
  return create({
    authFetch: async () => ({ ok: true, data: {} }), toast: () => {}, renderMockWhatsApp: () => {}, formatFijiCurrency,
    els: {}, storage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) }, ...overrides,
  });
}

const offer = (over = {}) => ({
  offer_id: 'off_1', title: 'Synthetic snorkel morning', description: null, location: 'Mamanuca reef', inclusions: ['boat', 'lunch'],
  starts_at_fiji: { day: 'Tuesday, Oct 13', time: '9:00 AM' }, price_per_place_fjd: 120, places_left: 3, capacity: 4, state: 'open',
  supplier: { name: 'Synthetic Reef Tours', verified: true }, suggested_for_you: false, in_editions: [], my_request: null, ...over,
});

test('the served page contains the offers client, with no backticks in the emitted HTML and a valid Offers tab/view', () => {
  assert.equal(GUEST_APP_HTML.includes('`'), false, 'the served page must contain no backtick (it would have terminated the outer template literal)');
  assert.match(GUEST_APP_HTML, /data-view="offers"/);
  assert.match(GUEST_APP_HTML, /id="view-offers"/);
  for (const id of ['offersNearTrip', 'myOffersPanel', 'referralPanel', 'contactPanel', 'offersEditions', 'offersList', 'refBanner', 'f-consent', 'f-leg']) assert.match(GUEST_APP_HTML, new RegExp(`id="${id}"`));
  // The consent box ships UNTICKED and the invitation banner ships hidden.
  assert.equal(/id="f-consent"[^>]*checked/.test(GUEST_APP_HTML), false);
  assert.match(GUEST_APP_HTML, /id="refBanner"[^>]*display:none/);
});

test('every server-supplied string is escaped before it reaches innerHTML', () => {
  const c = makeClient();
  const html = c.offerCardHtml(offer({ title: '<img src=x onerror=alert(1)>', location: '"><script>alert(2)</script>', inclusions: ['<b>x</b>'], supplier: { name: "O'Reilly & Sons", verified: true } }));
  assert.equal(html.includes('<img src=x'), false);
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<b>x</b>'), false);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /O&#39;Reilly &amp; Sons/);
  const row = c.requestRowHtml({ request_id: 'req_1', title: '<i>t</i>', reference: 'OFR-ABC123', location: 'x', places: 2, total_fjd: 240, status: 'requested', starts_at_fiji: { day: 'd', time: 't' } });
  assert.equal(row.includes('<i>t</i>'), false);
  assert.match(row, /OFR-ABC123/);
});

test('an open offer shows a request control with a bounded places picker; sold-out and closed offers do not', () => {
  const c = makeClient();
  const open = c.offerCardHtml(offer({ places_left: 3 }));
  assert.match(open, /data-request-offer="off_1"/);
  assert.match(open, /<option value="3">3 places<\/option>/);
  assert.equal(open.includes('<option value="4">'), false, 'never offers more places than are left');
  assert.match(open, /Nothing is charged/);
  assert.match(open, /FJ\$120\.00<\/b> <span class="small muted">per place, all inclusive/);
  for (const state of ['sold_out', 'deadline_passed']) assert.equal(c.offerCardHtml(offer({ state, places_left: 0 })).includes('data-request-offer'), false, state);
  const mine = c.offerCardHtml(offer({ my_request: { reference: 'OFR-ABC123', status: 'confirmed', places: 2, total_fjd: 240 } }));
  assert.equal(mine.includes('data-request-offer'), false, 'a guest with a live request is not offered a second one');
  assert.match(mine, /OFR-ABC123/);
  assert.match(mine, /Confirmed by our team/);
  assert.match(c.offerCardHtml(offer({ suggested_for_you: true, in_editions: ['morning'] })), /Suggested for your stay[\s\S]*Morning deal/);
});

test('the request retry key is stable per offer, so a double tap or reload re-sends the SAME request', () => {
  const c = makeClient();
  const first = c.requestRefFor('off_1');
  assert.equal(c.requestRefFor('off_1'), first);
  assert.notEqual(c.requestRefFor('off_2'), first);
  assert.match(first, /^orq_/);
});

test('fare breakdown: original fare, credit and amount due are three separate lines; nothing is shown without a credit', () => {
  const c = makeClient();
  assert.equal(c.fareHtml(null), '');
  assert.equal(c.fareHtml({ original_fare_fjd: 100, referral_credit_fjd: 0, amount_due_fjd: 100 }), '');
  const html = c.fareHtml({ original_fare_fjd: 100, referral_credit_fjd: 10, amount_due_fjd: 90, adjustment_status: 'applied' });
  assert.match(html, /Original fare <b[^>]*>FJ\$100\.00/);
  assert.match(html, /Referral credit <b[^>]*>- FJ\$10\.00/);
  assert.match(html, /Amount due <span[^>]*>FJ\$90\.00/);
  assert.match(html, /original quote and your driver's payout are unchanged/);
  assert.match(c.fareHtml({ original_fare_fjd: 100, referral_credit_fjd: 10, amount_due_fjd: 90, adjustment_status: 'reversal_pending_staff' }), /reviewing this credit/);
});

test('referral card: shows only the public link and QR, says nothing about the trip, and never promises a reward that is not switched on', () => {
  const c = makeClient();
  const off = c.referralHtml({ share_url: 'https://myfiji.app/r/ABCD2345', qr_svg_url: 'https://myfiji.app/preview/referral/qr.svg?code=ABCD2345', friends_joined: 1, credits: [], policy: { rewards_active: false, message: 'Referral rewards are not switched on yet. You can still share the link.' } });
  assert.match(off, /not switched on yet/);
  assert.equal(/earn FJ\$/.test(off), false, 'no reward amount is promised while rewards are off');
  assert.match(off, /never your trip, name or contact details/);
  assert.match(off, /1 friend has joined/);
  const on = c.referralHtml({ share_url: 'https://x/r/ABCD2345', qr_svg_url: 'https://x/q', friends_joined: 0, policy: { rewards_active: true, reward_fjd: 10, cap_fjd: 20 }, credits: [{ credit_id: 'cr_1', status: 'earned', amount_fjd: 10 }, { credit_id: 'cr_2', status: 'applied', amount_fjd: 10, needs_staff_attention: true }] });
  assert.match(on, /earn FJ\$10\.00 off your return transfer \(up to FJ\$20\.00/);
  assert.match(on, /Earned - ready for your return transfer/);
  assert.match(on, /our team will be in touch/);
});

test('contact card: WhatsApp availability and promotional consent are separate controls; essential messages are stated as always sent', () => {
  const c = makeClient();
  const html = c.contactHtml({ whatsapp_available: false, marketing_consent: 'unknown', essential_messages: 'booking confirmations are always sent', contact_person: 'Ana (ops)' });
  assert.match(html, /id="ctWa"/);
  assert.match(html, /id="ctMk"/);
  assert.equal(/id="ctMk"[^>]*checked/.test(html), false, 'unknown consent renders unticked');
  assert.match(html, /we will email you instead/);
  assert.match(html, /always sent/);
  assert.match(html, /Ana \(ops\)/);
  assert.match(c.contactHtml({ whatsapp_available: true, marketing_consent: 'granted', essential_messages: 'x', contact_person: null }), /id="ctMk"[^>]*checked/);
});

test('editions: morning/afternoon sections only appear when prepared; otherwise a plain note, and browsing is never hidden', () => {
  const c = makeClient();
  const o1 = offer({ offer_id: 'off_a', title: 'Alpha' });
  const html = c.editionsHtml({ editions: { current_slot: 'morning', next_slot: 'afternoon', morning: ['off_a'], afternoon: [] } }, { off_a: o1 });
  assert.match(html, /Morning deals <span class="pill">Live now/);
  assert.equal(html.includes('Afternoon deals'), false);
  assert.match(c.editionsHtml({ editions: { current_slot: null, next_slot: 'morning', morning: [], afternoon: [] } }, {}), /go live later today \(Fiji time\)\. Everything is still open to browse/);
});

// ---- found in the real guest-browser run: a failed network call left the Request button disabled with no message ----

test('NETWORK FAILURE: a failed request re-enables the button and says nothing was sent; no unhandled rejection; loaders survive an offline refresh', async () => {
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    const toasts = [];
    let handler = null;
    const btn = { disabled: false, getAttribute: () => 'off_1', addEventListener: (ev, fn) => { if (ev === 'click') handler = fn; } };
    const root = { innerHTML: '', querySelectorAll: (sel) => (sel === '[data-request-offer]' ? [btn] : []), querySelector: () => null };
    let online = true;
    const authFetch = async (path) => {
      if (!online) throw new TypeError('Failed to fetch');
      if (path === '/preview/offers') return { ok: true, data: { offers: [offer()], editions: { current_slot: null, next_slot: null, morning: [], afternoon: [] } } };
      return { ok: true, data: {} };
    };
    const c = makeClient({ authFetch, toast: (m) => toasts.push(m), els: { offersList: root } });
    await c.loadOffers();
    assert.equal(typeof handler, 'function', 'the Request button is wired');
    online = false;
    handler();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(btn.disabled, false, 'the button must not stay disabled after a network failure');
    assert.ok(toasts.some((m) => /no connection|nothing was sent|try again/i.test(m)), `the guest is told what happened (toasts: ${JSON.stringify(toasts)})`);
    // An offline refresh must resolve (keep what is on screen) rather than reject.
    await assert.doesNotReject(() => c.loadOffers());
    await assert.doesNotReject(() => c.loadReferral());
    await assert.doesNotReject(() => c.loadContact());
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(unhandled.map(String), [], 'no unhandled promise rejection');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('EXPIRED / SOLD OUT / CLOSED: the guest reads a plain sentence (never a machine code) and the offer list refreshes so the stale card disappears', async () => {
  const cases = [
    [{ error: 'OFFER_EXPIRED' }, /ended|expired/i],
    [{ error: 'SOLD_OUT', places_left: 0 }, /sold out/i],
    [{ error: 'BOOKING_DEADLINE_PASSED' }, /closed/i],
    [{ error: 'OFFER_NOT_AVAILABLE', detail: 'this offer is withdrawn or not currently available' }, /no longer available|withdrawn/i],
    [{ error: 'INSUFFICIENT_CAPACITY', places_left: 2, requested: 4 }, /2/],
    [{ error: 'SOMETHING_NEW_AND_UNMAPPED' }, /could not|try again/i],
  ];
  for (const [data, expected] of cases) {
    const toasts = []; const paths = [];
    let handler = null;
    const btn = { disabled: false, getAttribute: () => 'off_1', addEventListener: (ev, fn) => { if (ev === 'click') handler = fn; } };
    const root = { innerHTML: '', querySelectorAll: (sel) => (sel === '[data-request-offer]' ? [btn] : []), querySelector: () => null };
    const authFetch = async (path) => { paths.push(path); if (path === '/preview/offers') return { ok: true, data: { offers: [offer()], editions: { current_slot: null, next_slot: null, morning: [], afternoon: [] } } }; return { ok: false, status: 410, data }; };
    const c = makeClient({ authFetch, toast: (m) => toasts.push(m), els: { offersList: root } });
    await c.loadOffers();
    handler();
    await new Promise((r) => setTimeout(r, 20));
    const msg = toasts[toasts.length - 1];
    assert.match(msg, expected, JSON.stringify(data));
    assert.equal(/[A-Z]{3,}_[A-Z]{3,}/.test(msg), false, `a raw machine code reached the guest: ${msg}`);
    assert.equal(btn.disabled, false);
    assert.equal(paths.filter((p) => p === '/preview/offers').length, 2, 'the offer list is refreshed after a refusal');
  }
});

test('PRIVATE LINK SWITCH: opening a DIFFERENT private link in an already-open tab (a hash change, no page load) reloads onto it instead of keeping the previous guest on screen', () => {
  const marker = "window.addEventListener('hashchange'";
  const start = GUEST_APP_HTML.indexOf(marker);
  assert.ok(start !== -1, 'the app listens for a private-link hash change');
  const closer = '\n  });';
  const end = GUEST_APP_HTML.indexOf(closer, start) + closer.length;
  const body = GUEST_APP_HTML.slice(start, end);
  let handler = null; let reloads = 0;
  const run = ({ stored, hash }) => {
    reloads = 0;
    const loc = { hash, reload: () => { reloads += 1; } };
    const store = { getItem: () => stored };
    new Function('window', 'location', 'sessionStorage', 'localStorage', 'getCookie', body)({ addEventListener: (ev, fn) => { if (ev === 'hashchange') handler = fn; } }, loc, store, store, () => stored);
    handler();
    return reloads;
  };
  assert.equal(run({ stored: 'tok_AAA', hash: '#tok=tok_AAA' }), 0, 'the same private link does not reload');
  assert.equal(run({ stored: 'tok_AAA', hash: '' }), 0, 'clearing the link does not reload');
  assert.equal(run({ stored: 'tok_AAA', hash: '#tok=tok_BBB' }), 1, 'a DIFFERENT private link reloads');
  assert.equal(run({ stored: null, hash: '#tok=tok_BBB' }), 1, 'a link when nothing is stored reloads (it will be adopted on load)');
});
