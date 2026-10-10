// Fiji-time pickup handling (2026-10-11): date minimum and "tomorrow" default, past-pickup warning, restored-pickup expiry all use Pacific/Fiji, whatever the device's time zone.
// Runs the REAL fiji-pickup.js. Run: node --test test/fiji-pickup.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const srcPath = fileURLToPath(new URL('../src/fiji-pickup.js', import.meta.url));
const src = readFileSync(srcPath, 'utf8').replace(/\r/g, '');
const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8').replace(/\r/g, '');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const load = (extra = {}) => { const c = { Intl, Date, window: {}, isNaN, Math, ...extra }; vm.createContext(c); vm.runInContext(src, c); return c; };
const F = load().window.NadiFijiTime;
const J = (x) => JSON.parse(JSON.stringify(x));                          // the module lives in another vm realm: compare plain data
const Z = (iso) => Date.parse(iso);                                    // instants are given in UTC; Fiji is UTC+12 (no daylight saving in 2026)

test('SCOPE: no network, no storage, no Worker contact, nothing blocked or disabled', () => {
  for (const banned of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'localStorage', 'sessionStorage', 'preventDefault', '.disabled', 'catalogue_ref', 'api.fijidash', 'api.nadiairport', 'workers.dev']) assert.ok(!code.includes(banned), 'must not contain ' + banned);
  assert.match(html, /<script src="fiji-pickup\.js\?v=20261011-fiji"><\/script>/);
  assert.ok(html.indexOf('src="fiji-pickup.js') < html.indexOf('src="app.js'), 'loaded before app.js, on its own line');
});

test('FIJI CLOCK: instants map to the Fiji date and time (UTC+12), including the day rollover at 12:00 UTC', () => {
  assert.deepEqual(J(F.now(Z('2026-10-10T23:29:00Z'))), { date: '2026-10-11', time: '11:29' });        // the phone check: Sydney 10:29 = Fiji 11:29
  assert.deepEqual(J(F.now(Z('2026-10-10T11:59:00Z'))), { date: '2026-10-10', time: '23:59' });
  assert.deepEqual(J(F.now(Z('2026-10-10T12:00:00Z'))), { date: '2026-10-11', time: '00:00' });
  assert.deepEqual(J(F.now(Z('2026-12-31T12:30:00Z'))), { date: '2027-01-01', time: '00:30' });
  let n = 0; for (let t = Z('2026-01-01T00:00:00Z'); t < Z('2027-01-01T00:00:00Z'); t += 7 * 3600 * 1000 + 13 * 60000) {   // across 2026: Intl agrees with plain UTC+12 arithmetic
    const iso = new Date(t + 12 * 3600 * 1000).toISOString(); assert.deepEqual(J(F.now(t)), { date: iso.slice(0, 10), time: iso.slice(11, 16) }); n++;
  }
  assert.ok(n > 1200);
});

test('DEFAULT IS TOMORROW IN FIJI: at 23:29 UTC on 10 Oct (Fiji 11:29, 11 Oct) the default is 12 Oct, not the UTC-based 11 Oct that produced a pickup already in the past', () => {
  const t = Z('2026-10-10T23:29:00Z');
  assert.equal(F.today(t), '2026-10-11'); assert.equal(F.tomorrow(t), '2026-10-12');
  const oldDefault = new Date(t + 86400000).toISOString().split('T')[0];                      // what app.js computed: the UTC date + 1
  assert.equal(oldDefault, '2026-10-11'); assert.ok(F.hasPassed(oldDefault, '10:00', t), 'the old default WAS a passed pickup in Fiji');
  assert.ok(!F.hasPassed(F.tomorrow(t), '10:00', t), 'the new default never is');
  assert.equal(F.addDays('2026-02-28', 1), '2026-03-01'); assert.equal(F.addDays('2026-12-31', 1), '2027-01-01'); assert.equal(F.addDays('2028-02-28', 1), '2028-02-29');
});

test('PAST-PICKUP RULE: strictly earlier than the current Fiji minute; same-hour and same-minute requests stay available; no lead time', () => {
  const t = Z('2026-10-10T23:29:40Z');                                                         // Fiji Sun 11 Oct 11:29:40
  assert.equal(F.hasPassed('2026-10-11', '11:28', t), true, 'one minute earlier has passed');
  assert.equal(F.hasPassed('2026-10-11', '10:00', t), true);
  assert.equal(F.hasPassed('2026-10-11', '11:29', t), false, 'the current minute is not passed (no lead time)');
  assert.equal(F.hasPassed('2026-10-11', '11:30', t), false, 'a pickup 31 seconds ahead is allowed');
  assert.equal(F.hasPassed('2026-10-11', '11:59', t), false, 'later in the same hour is allowed');
  assert.equal(F.hasPassed('2026-10-12', '00:00', t), false); assert.equal(F.hasPassed('2026-10-10', '23:59', t), true);
  assert.equal(F.hasPassed('2026-10-10', '', t), true, 'a date alone: passed only if before today in Fiji'); assert.equal(F.hasPassed('2026-10-11', '', t), false);
  for (const bad of [['', '10:00'], ['2026-13-40', '10:00'], ['soon', '10:00'], [null, null], [undefined, '10:00'], ['2026-10-11', '25:99']]) assert.doesNotThrow(() => F.hasPassed(bad[0], bad[1], t));
  assert.equal(F.hasPassed('2026-13-40', '10:00', t), false, 'unparseable input never raises a warning');
});

// ---- page wiring against a DOM double -------------------------------------------------------------------------------------
function page(nowMs, { date = '', time = '10:00' } = {}) {
  const mk = (id) => ({ id, value: '', min: '', hidden: false, textContent: '', listeners: {}, children: [], addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, setAttribute() {},
    insertBefore(n) { this.children.unshift(n); }, appendChild(n) { this.children.push(n); } });
  const d = mk('travelDate'), t = mk('travelTime'), step4 = mk('step4'); d.value = date; t.value = time;
  const row = { parentNode: { insertBefore(n) { row.sibling = n; } }, nextSibling: null }; t.closest = (sel) => (sel === '.field-row' ? row : null);
  const els = { travelDate: d, travelTime: t, step4 };
  const docListeners = {};
  const doc = { readyState: 'complete', head: { appendChild() {} }, getElementById: (id) => els[id] || null, createElement: () => mk(''), addEventListener(ty, f) { (docListeners[ty] = docListeners[ty] || []).push(f); } };
  const FakeDate = class extends Date { constructor(...a) { if (a.length) super(...a); else super(nowMs); } static now() { return nowMs; } };
  const c = { Intl, Date: FakeDate, window: {}, document: doc, isNaN, Math, setInterval: () => 1, setTimeout: (f) => f() }; vm.createContext(c); vm.runInContext(src, c);
  return { d, t, step4, row, api: c.window.NadiFijiTime, fire(el, type) { (el.listeners[type] || []).forEach((f) => f()); }, docListeners };
}

test('PAGE: minimum is today in Fiji and the default is tomorrow in Fiji (the intended "tomorrow", on the Fiji clock)', () => {
  const p = page(Z('2026-10-10T23:29:00Z'));
  assert.equal(p.d.min, '2026-10-11'); assert.equal(p.d.value, '2026-10-12');
  const q = page(Z('2026-10-10T05:00:00Z'));                                                  // Fiji 17:00 on 10 Oct
  assert.equal(q.d.min, '2026-10-10'); assert.equal(q.d.value, '2026-10-11');
});

test('WARNING: a past pickup shows a clear Fiji warning at the form AND on the review step; nothing the guest entered is changed; fixing it clears it', () => {
  const p = page(Z('2026-10-10T23:29:00Z'));
  p.d.value = '2026-10-11'; p.t.value = '09:15'; p.fire(p.d, 'change');
  const [formWarn, reviewWarn] = [p.row.sibling, p.step4.children[0]];
  assert.ok(formWarn && reviewWarn, 'one under the date/time row, one at the top of the review step');
  for (const w of [formWarn, reviewWarn]) {
    assert.equal(w.hidden, false);
    assert.match(w.textContent, /^Please check your Fiji pickup date and time\. Sun 11 October 2026 at 09:15 has already passed in Fiji \(it is now 11:29 on Sun 11 October 2026 in Fiji\)\. We have not changed what you entered\.$/);
  }
  assert.equal(p.d.value, '2026-10-11'); assert.equal(p.t.value, '09:15', 'the guest\'s date and time are untouched (09:15 is not any default, so a rewrite would show)');
  p.t.value = '11:45'; p.fire(p.t, 'input'); assert.equal(formWarn.hidden, true); assert.equal(reviewWarn.hidden, true); assert.equal(formWarn.textContent, '');
  p.t.value = '11:29'; p.fire(p.t, 'change'); assert.equal(formWarn.hidden, true, 'the current minute is a legitimate same-hour request');
});

test('NO WARNING for the default or any later pickup; the check also re-runs on page clicks (steps change) so the review step is current', () => {
  const p = page(Z('2026-10-10T23:29:00Z'));
  assert.equal(p.row.sibling.hidden, true, 'the default (tomorrow 10:00 Fiji) is never warned about');
  p.d.value = '2026-10-11'; p.t.value = '09:00'; p.docListeners.click.forEach((f) => f()); assert.equal(p.step4.children[0].hidden, false, 'a click re-evaluates');
});

// ---- the same journey on devices set to Sydney, Auckland, Los Angeles (and Fiji, UTC) -----------------------------------
const ZONES = ['Australia/Sydney', 'Pacific/Auckland', 'America/Los_Angeles', 'Pacific/Fiji', 'UTC'];
const CHILD = `
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(process.env.FIJI_SRC, 'utf8');
const out = { tzOffsetMin: new Date(Date.UTC(2026, 9, 11, 0, 0)).getTimezoneOffset(), local: new Date(Date.UTC(2026, 9, 10, 23, 29)).toString().slice(16, 24) };
const c = { Intl, Date, window: {}, isNaN, Math }; vm.createContext(c); vm.runInContext(src, c); const F = c.window.NadiFijiTime;
const instants = ['2026-10-10T23:29:00Z', '2026-10-10T11:59:00Z', '2026-10-10T12:00:00Z', '2026-10-11T07:30:00Z', '2026-12-31T12:00:00Z', '2027-03-14T09:15:00Z'].map(Date.parse);
out.results = instants.map((t) => ({ now: F.now(t), today: F.today(t), tomorrow: F.tomorrow(t),
  passed: [['2026-10-11', '10:00'], ['2026-10-11', '11:29'], ['2026-10-11', '11:30'], ['2026-10-10', '23:59'], ['2026-10-12', '00:00'], ['2026-10-11', '']].map(([d, h]) => F.hasPassed(d, h, t)) }));
console.log(JSON.stringify(out));`;

test('DEVICE TIME ZONE DOES NOT MATTER: the same instants and journeys give identical results on devices set to Sydney, Auckland, Los Angeles, Fiji and UTC', () => {
  const runs = ZONES.map((tz) => {
    const r = spawnSync(process.execPath, ['-e', CHILD], { env: { ...process.env, TZ: tz, FIJI_SRC: srcPath }, encoding: 'utf8' });
    assert.equal(r.status, 0, tz + ': ' + r.stderr); return { tz, ...JSON.parse(r.stdout) };
  });
  const offsets = Object.fromEntries(runs.map((r) => [r.tz, r.tzOffsetMin]));
  assert.equal(new Set(Object.values(offsets)).size, ZONES.length, 'the child processes really ran in different zones: ' + JSON.stringify(offsets));   // Sydney -660, Auckland -780, LA 420, Fiji -720, UTC 0
  assert.equal(offsets['Australia/Sydney'], -660); assert.equal(offsets['Pacific/Auckland'], -780); assert.equal(offsets['America/Los_Angeles'], 420);
  const ref = JSON.stringify(runs[0].results);
  for (const r of runs) assert.equal(JSON.stringify(r.results), ref, r.tz + ' differs from ' + runs[0].tz);
  assert.deepEqual(runs[0].results[0].now, { date: '2026-10-11', time: '11:29' });
  assert.deepEqual(runs[0].results[0].passed, [true, false, false, true, false, false], 'at 23:29Z: 11 Oct 10:00 has passed in Fiji, 11:29/11:30 have not');
});

test('THE OLD BEHAVIOUR WAS DEVICE-DEPENDENT (why this matters): the UTC-based default differed from the Fiji-based one for part of every day', () => {
  let differing = 0; for (let h = 0; h < 24; h++) { const t = Z('2026-10-10T00:00:00Z') + h * 3600 * 1000; if (new Date(t + 86400000).toISOString().split('T')[0] !== F.tomorrow(t)) differing++; }
  assert.equal(differing, 12, 'for 12 of every 24 hours the UTC-based "tomorrow" is not tomorrow in Fiji');
});

test('ORDER: although the script is loaded BEFORE app.js, the Fiji minimum and default win over app.js\'s own UTC-based default (initialisation runs after every DOMContentLoaded handler)', () => {
  const nowMs = Z('2026-10-10T23:29:00Z');
  const mk = (id) => ({ id, value: '', min: '', hidden: false, textContent: '', listeners: {}, children: [], addEventListener() {}, setAttribute() {}, insertBefore() {}, appendChild() {}, closest: () => null, parentNode: { appendChild() {} } });
  const d = mk('travelDate'), t = mk('travelTime'); const els = { travelDate: d, travelTime: t };
  const domReady = [], timers = [];
  const doc = { readyState: 'loading', head: { appendChild() {} }, getElementById: (id) => els[id] || null, createElement: () => mk(''), addEventListener(ty, f) { if (ty === 'DOMContentLoaded') domReady.push(f); } };
  const FakeDate = class extends Date { constructor(...a) { if (a.length) super(...a); else super(nowMs); } static now() { return nowMs; } };
  const c = { Intl, Date: FakeDate, window: {}, document: doc, isNaN, Math, setInterval: () => 1, setTimeout: (f) => { timers.push(f); return 1; } }; vm.createContext(c);
  vm.runInContext(src, c);                                                                  // this file's script tag comes first...
  domReady.push(() => { d.min = new Date().toISOString().split('T')[0]; d.value = new Date(nowMs + 86400000).toISOString().split('T')[0]; });   // ...then app.js registers its handler (the UTC-based code, verbatim in effect)
  domReady.forEach((f) => f());                                                             // DOMContentLoaded: this file's handler (queues a timer), then app.js's handler
  assert.equal(d.value, '2026-10-11', 'app.js has just set its UTC-based default (a passed pickup in Fiji)');
  timers.forEach((f) => f());                                                               // the zero-delay timer runs after both handlers
  assert.equal(d.min, '2026-10-11'); assert.equal(d.value, '2026-10-12', 'the Fiji default replaced it');
});
