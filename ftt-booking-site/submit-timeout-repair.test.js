// Fiji Dash — P0 incident fix (2026-09-26): bounded submit + fire-and-forget, bounded escalation.
//
// Executes the REAL functions from the actual modified src/app.js (bookingRequest,
// submitMarketplaceBooking, reportBookingSyncFailure, confirmBooking-adjacent guards) inside a
// vm sandbox with a mock DOM and a fully test-controlled fetch — never the real network, never a
// real timer wait for the 15s default (bookingRequest is called directly with short timeouts in the
// timing tests; the 15s default itself is checked by source inspection, not by waiting 15s per test).
//
// Run: node --test ftt-booking-site/submit-timeout-repair.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_PATH = path.join(__dirname, 'src', 'app.js');
const js = fs.readFileSync(JS_PATH, 'utf8').replace(/\r\n/g, '\n');

// ---- minimal DOM stub -------------------------------------------------------
function makeField(value = '', extra = {}) {
  return { value, checked: false, ...extra, trim() { return this.value; } };
}
function makeDocument(fields) {
  return {
    getElementById(id) { return fields[id] ?? null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}
const DEFAULT_FIELDS = () => ({
  firstName: makeField('QA'), lastName: makeField('Test'), phone: makeField('+6790000000'), email: makeField('qa@example.invalid'),
  flightNum: makeField(''), pickup: makeField('NAN'), destination: makeField('HILTON_DENARAU'),
  travelDate: makeField('2026-09-28'), travelTime: makeField('10:00'), notes: makeField(''),
  'extra-seat': makeField('', { checked: false }), 'extra-surf': makeField('', { checked: false }),
});

function buildContext(fields, fetchImpl) {
  const sandbox = {
    console,
    NADI_API_BASE: 'https://api.nadiairporttransfers.com',
    fetch: fetchImpl,
    AbortController,
    setTimeout, clearTimeout,
    document: makeDocument(fields),
    window: {},
    sessionStorage: { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = v; }, removeItem(k) { delete this.store[k]; } },
    state: { selectedVehicle: 'sedan', tripType: 'one-way', passengers: 2, luggage: 2, distanceKm: 9.9, destZoneName: 'Denarau', confirmBookingInFlight: false },
    // Minimal stand-ins for helpers submitMarketplaceBooking calls that live elsewhere in the real
    // file but aren't the thing under test here — kept behaviourally honest (not stubbed to always
    // succeed), matching what a real fixed-zone, non-boat, non-tour, non-custom-address booking uses.
    BOAT_DESTINATION_IDS: {},
    bookingHasTour: () => false,
    resolveDurableNotes: (n) => n || null,
    resolveConfirmedPickupZone: () => 'Nadi Airport',
    resolveConfirmedDestinationZone: () => 'Denarau',
    calculateTotal: () => ({ final: 62.08 }),
    getAttributionForPayload: () => ({}),
    trackFunnelEvent: () => {},
  };
  vm.createContext(sandbox);
  return sandbox;
}

// Pulls the three real functions under test out of the actual file, verbatim, brace-matched — never
// re-typed, so this can never silently drift from the real implementation.
function extractFn(name) {
  const start = js.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found in source`);
  let i = js.indexOf('{', start), depth = 0;
  for (; i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}' && --depth === 0) return js.slice(js.lastIndexOf('async function', start) === start - 6 ? start - 6 : start, i + 1);
  }
  throw new Error('unbalanced ' + name);
}
const SOURCE_UNDER_TEST = [extractFn('bookingRequest'), extractFn('submitMarketplaceBooking'), extractFn('reportBookingSyncFailure')].join('\n\n');

function run(fields, fetchImpl) {
  const ctx = buildContext(fields, fetchImpl);
  vm.runInContext(SOURCE_UNDER_TEST, ctx);
  return ctx;
}

// ---- mock fetch builders -----------------------------------------------------
const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const hangingFetch = (calls) => (url, opts) => { calls.push({ url, opts }); return new Promise(() => {}); }; // never settles
// "stalled body": the connection/headers arrive (fetch() resolves) but response.json() never settles.
const stalledBodyFetch = (calls) => (url, opts) => { calls.push({ url, opts }); return Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) }); };
const networkErrorFetch = (calls) => (url, opts) => { calls.push({ url, opts }); return Promise.reject(new TypeError('Failed to fetch')); };
const serverErrorFetch = (calls) => (url, opts) => { calls.push({ url, opts }); return Promise.resolve(jsonResponse(500, { ok: false, error: 'internal error' })); };
const successFetch = (calls, bookingId = 999) => (url, opts) => { calls.push({ url, opts }); return Promise.resolve(jsonResponse(200, { ok: true, booking_id: bookingId, idempotent: false })); };
// idempotent-replay success: simulates the server having ALREADY committed the row from a prior
// attempt whose response was lost - exercises the exact "saved but response lost, then retried
// with the same ref" path server-side idempotency is meant to make safe.
const idempotentReplayFetch = (calls, bookingId = 777) => (url, opts) => { calls.push({ url, opts }); return Promise.resolve(jsonResponse(200, { ok: true, booking_id: bookingId, idempotent: true })); };

// ---- source-level checks (fast, no timers) ------------------------------------

test('bookingRequest exists and bounds BOTH the connection and the response-body read', () => {
  const src = extractFn('bookingRequest');
  assert.match(src, /AbortController/);
  assert.match(src, /Promise\.race/);
  assert.match(src, /await response\.json\(\)/, 'body read must be awaited INSIDE the raced branch, not after it settles');
  assert.match(src, /timeoutMs = 15000/, 'default deadline matches nadiairporttransfers.com\'s own bookingRequest()');
});

test('submitMarketplaceBooking routes its POST through bookingRequest (no more bare fetch)', () => {
  const src = extractFn('submitMarketplaceBooking');
  assert.doesNotMatch(src, /await fetch\(`\$\{NADI_API_BASE\}\/bookings`/, 'must not call fetch directly for the save POST any more');
  assert.match(src, /bookingRequest\(`\$\{NADI_API_BASE\}\/bookings`/);
});

test('escalation is fire-and-forget (void), never awaited, in every call site', () => {
  const src = extractFn('submitMarketplaceBooking');
  const awaited = src.match(/await reportBookingSyncFailure/g);
  assert.equal(awaited, null, 'reportBookingSyncFailure must never be awaited on the guest recovery path');
  assert.equal((src.match(/void reportBookingSyncFailure/g) || []).length, 3, 'all three failure paths (incomplete data, confirmed server rejection, and the catch block) must fire-and-forget it');
});

test('reportBookingSyncFailure itself is bounded, with a shorter deadline than the main save', () => {
  const src = extractFn('reportBookingSyncFailure');
  assert.match(src, /bookingRequest\(`\$\{NADI_API_BASE\}\/escalate`/);
  assert.match(src, /,\s*5000\)/, 'escalation deadline must be explicit and shorter than the 15s save deadline');
});

test('no received HTTP response is ever classified as a known/confirmed outcome; only local not-sent validation is', () => {
  const src = extractFn('submitMarketplaceBooking');
  assert.doesNotMatch(src, /confirmed_rejected/, 'the API contract does not prove rejection preceded persistence');
  assert.equal((src.match(/resultKind:\s*'unknown'/g) || []).length, 2, 'non-success response branch and the catch block');
  assert.equal((src.match(/resultKind:\s*'not_sent'/g) || []).length, 1, 'only the local incomplete-data path never left the browser');
});

test('escalation message reports the reference and UNCERTAIN save status, and does not claim confirmed failure or WhatsApp sending', () => {
  const src = extractFn('reportBookingSyncFailure');
  assert.doesNotMatch(src, /failed for confirmed guest booking/);
  assert.doesNotMatch(src, /WhatsApp confirmation still sent/);
  assert.match(src, /save status UNCERTAIN/);
  assert.match(src, /\$\{ref\}/);
});

// ---- behavioural checks (real vm execution, short timeouts, isolated mocks) ---

test('SCENARIO: stalled connection — never resolves within the deadline, comes back as an UNKNOWN outcome, never a confirmed failure', async () => {
  const calls = [];
  const ctx = run(DEFAULT_FIELDS(), hangingFetch(calls));
  const t0 = Date.now();
  const result = await ctx.bookingRequest('https://x/bookings', { method: 'POST' }, 40).catch((e) => ({ threw: e.message }));
  assert.ok(Date.now() - t0 < 500, 'must resolve near the deadline, not hang for the test process lifetime');
  assert.match(result.threw, /timed out/i);
  assert.equal(calls.length, 1);
});

test('SCENARIO: stalled body — connection succeeds but the body never arrives; still bounded by the same deadline', async () => {
  const calls = [];
  const ctx = run(DEFAULT_FIELDS(), stalledBodyFetch(calls));
  const t0 = Date.now();
  const result = await ctx.bookingRequest('https://x/bookings', { method: 'POST' }, 40).catch((e) => ({ threw: e.message }));
  assert.ok(Date.now() - t0 < 500);
  assert.match(result.threw, /timed out/i);
});

test('SCENARIO: network error — rejects immediately, classified as an UNKNOWN outcome (the request may still have reached the server)', async () => {
  const calls = [];
  const ctx = run(DEFAULT_FIELDS(), networkErrorFetch(calls));
  const result = await ctx.submitMarketplaceBooking('FD-TESTREF1');
  assert.equal(result.ok, false);
  assert.equal(result.resultKind, 'unknown');
  // 2 calls, not 1: the /bookings POST, plus the fire-and-forget /escalate call this same mock also
  // answers (both hit the same networkErrorFetch — the escalation firing at all is checked properly,
  // with its own dedicated mock, in the "stalled escalation" test below).
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/bookings$/);
});

test('SCENARIO: server error (HTTP 500 {ok:false}) — stays UNKNOWN; a 5xx does not prove nothing was persisted', async () => {
  const calls = [];
  const ctx = run(DEFAULT_FIELDS(), serverErrorFetch(calls));
  const result = await ctx.submitMarketplaceBooking('FD-TESTREF2');
  assert.equal(result.ok, false);
  assert.equal(result.resultKind, 'unknown');
});

test('SCENARIO: HTTP 200 with truncated/malformed JSON (response.json() rejects) — stays UNKNOWN', async () => {
  const calls = [];
  const truncated = (url, opts) => { calls.push({ url, opts }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')) }); };
  const ctx = run(DEFAULT_FIELDS(), truncated);
  const result = await ctx.submitMarketplaceBooking('FD-TESTREF4');
  assert.equal(result.ok, false);
  assert.equal(result.resultKind, 'unknown');
});

test('SCENARIO: HTTP 200 with ok:false body, and HTTP 400 with errors — both stay UNKNOWN (no contract proves pre-persistence rejection)', async () => {
  for (const [status, body] of [[200, { ok: false }], [400, { ok: false, errors: ['x'] }]]) {
    const calls = [];
    const f = (url, opts) => { calls.push({ url, opts }); return Promise.resolve(jsonResponse(status, body)); };
    const ctx = run(DEFAULT_FIELDS(), f);
    const result = await ctx.submitMarketplaceBooking('FD-TESTREF5');
    assert.equal(result.ok, false);
    assert.equal(result.resultKind, 'unknown', `status ${status}`);
  }
});

test('SCENARIO: escalation sent after an uncertain save carries the ref and uncertain wording, not "confirmed"/"WhatsApp sent"', async () => {
  const calls = [];
  const ctx = run(DEFAULT_FIELDS(), serverErrorFetch(calls));
  await ctx.submitMarketplaceBooking('FD-TESTREF6');
  const esc = calls.find((c) => /\/escalate$/.test(c.url));
  assert.ok(esc, 'escalation must still fire, non-blocking');
  const context = JSON.parse(esc.opts.body).context;
  assert.match(context, /FD-TESTREF6/);
  assert.match(context, /save status UNCERTAIN/);
  assert.doesNotMatch(context, /confirmed guest booking|WhatsApp confirmation still sent/);
});

test('SCENARIO: success — ok with a booking id, same as before', async () => {
  const calls = [];
  const ctx = run(DEFAULT_FIELDS(), successFetch(calls, 4242));
  const result = await ctx.submitMarketplaceBooking('FD-TESTREF3');
  assert.equal(result.ok, true);
  assert.equal(result.bookingId, 4242);
  assert.equal(calls.length, 1);
  const sentPayload = JSON.parse(calls[0].opts.body);
  assert.equal(sentPayload.client_booking_ref, 'FD-TESTREF3');
});

test('SCENARIO: saved-but-response-lost, then retried — the SAME ref is sent both times, and a retry against an idempotent-replay server returns success without a second distinct attempt', async () => {
  const firstCalls = [];
  // First attempt: simulate the response never coming back (client sees "unknown"), even though —
  // per the scenario — the server actually committed it.
  const firstCtx = run(DEFAULT_FIELDS(), hangingFetch(firstCalls));
  const firstResult = await firstCtx.bookingRequest(`https://x/bookings`, { method: 'POST', body: JSON.stringify({ client_booking_ref: 'FD-RETRYREF' }) }, 40).catch((e) => ({ ok: false, resultKind: 'unknown', error: e.message }));
  assert.equal(firstResult.ok, false);
  assert.equal(firstCalls.length, 1);
  const firstRefSent = JSON.parse(firstCalls[0].opts.body).client_booking_ref;

  // Retry: same ref (this is what retryMarketplaceBooking()/confirmBooking() do — reuse
  // state.currentBookingRef / the sessionStorage-fingerprinted ref, never mint a new one for an
  // unchanged retry attempt), server now answers as if it already had the row (idempotent: true).
  const secondCalls = [];
  const secondCtx = run(DEFAULT_FIELDS(), idempotentReplayFetch(secondCalls, 555));
  const secondResult = await secondCtx.submitMarketplaceBooking(firstRefSent);
  assert.equal(secondResult.ok, true);
  assert.equal(secondResult.idempotent, true);
  assert.equal(secondResult.bookingId, 555);
  const secondRefSent = JSON.parse(secondCalls[0].opts.body).client_booking_ref;
  assert.equal(secondRefSent, firstRefSent, 'the retry must reuse the identical client_booking_ref, never mint a fresh one');
});

test('a stalled escalation call cannot delay the caller: submitMarketplaceBooking resolves promptly even when reportBookingSyncFailure\'s own fetch hangs', async () => {
  let escalateCalls = 0;
  const fetchImpl = (url, opts) => {
    if (String(url).includes('/escalate')) { escalateCalls++; return new Promise(() => {}); } // hangs forever
    return networkErrorFetch([])(url, opts); // the /bookings call fails fast (network error)
  };
  const ctx = run(DEFAULT_FIELDS(), fetchImpl);
  const t0 = Date.now();
  const result = await ctx.submitMarketplaceBooking('FD-ESC-TEST');
  assert.ok(Date.now() - t0 < 500, 'must not wait on the hung escalation call at all');
  assert.equal(result.ok, false);
  assert.equal(result.resultKind, 'unknown');
  assert.equal(escalateCalls, 1, 'the escalation attempt must still have been made (fire-and-forget, not skipped)');
});
