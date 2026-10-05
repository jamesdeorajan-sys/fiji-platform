// Fiji Dash - analytics must never block booking (issue #59). Separable from fare-display work.
// Run: node --test ftt-booking-site/analytics-optional.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'src', 'index.html'), 'utf8');

function helperSource() {
  const m = app.match(/function trackBookingFunnel\(eventType\) \{[\s\S]*?\n\}\n/);
  assert.ok(m, 'trackBookingFunnel helper must exist');
  return m[0];
}

test('no unqualified trackFunnelEvent call remains; all 11 go through the guarded helper', () => {
  const code = app.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'); // drop whole-line comments only
  assert.doesNotMatch(code, /(?<![\w.])trackFunnelEvent\s*\??\.?\(/, 'bare trackFunnelEvent call would throw ReferenceError when the client script is missing');
  assert.equal((code.match(/\btrackBookingFunnel\(/g) || []).length, 11 + 1, '11 call sites + the definition');
  for (const ev of ['route_selected', 'vehicle_selected', 'details_opened', 'confirm_clicked', 'booking_post_started', 'booking_post_failed', 'booking_post_succeeded', 'booking_page_view', 'whatsapp_opened']) {
    assert.match(code, new RegExp(`trackBookingFunnel\\('${ev}'\\)`), ev);
  }
});

function run(windowObj) {
  const ctx = vm.createContext({ window: windowObj });
  vm.runInContext(helperSource() + '\nthis.__t = trackBookingFunnel;', ctx);
  return ctx.__t;
}

test('analytics MISSING: helper is a silent no-op (identifier never declared)', () => {
  const t = run({});
  assert.doesNotThrow(() => t('confirm_clicked'));
});

test('analytics THROWING: helper swallows the error', () => {
  const t = run({ trackFunnelEvent() { throw new Error('boom'); } });
  assert.doesNotThrow(() => t('confirm_clicked'));
});

test('analytics WORKING: event is forwarded exactly once with its type', () => {
  const seen = [];
  const t = run({ trackFunnelEvent: (e) => seen.push(e) });
  t('route_selected');
  assert.deepEqual(seen, ['route_selected']);
});

test('analytics defined as a non-function is ignored', () => {
  const t = run({ trackFunnelEvent: 'nope' });
  assert.doesNotThrow(() => t('x'));
});

test('app.js cache key was bumped so browsers holding the old bare-call app.js refetch (JS is cached 1h+)', () => {
  assert.match(html, /app\.js\?v=20261005-momi-final-fare/);
  assert.doesNotMatch(html, /app\.js\?v=20260926-submit-timeout-recovery/);
});
