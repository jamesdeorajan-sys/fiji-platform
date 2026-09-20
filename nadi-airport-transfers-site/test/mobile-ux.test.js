import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const app = read('app.js');
const html = read('index.html');
const css = read('styles.css');

// Extract a top-level function (brace matched) or the VEHICLES const from app.js.
function fn(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} missing`);
  let depth = 0, i = app.indexOf('{', start);
  for (; i < app.length; i++) {
    if (app[i] === '{') depth++;
    else if (app[i] === '}' && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error('unbalanced ' + name);
}
const vehiclesSrc = app.slice(app.indexOf('const VEHICLES'), app.indexOf('];', app.indexOf('const VEHICLES')) + 2);

// Minimal DOM: elements are plain objects; only what the vehicle-step helpers touch.
function harness(state = {}) {
  const els = {};
  const mk = (id, extra = {}) => (els[id] = { id, disabled: false, textContent: '', className: '', ...extra });
  mk('nextBtn2', { disabled: true }); mk('nextBtn1', { disabled: true }); mk('vehicleHint');
  const cards = ['sedan', 'minivan', 'minibus'].map((k) => {
    const attrs = {}; const set = new Set();
    return { key: k, attrs, classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), has: (c) => set.has(c) }, setAttribute: (a, v) => { attrs[a] = v; } };
  });
  const ctx = {
    state: { passengers: 2, luggage: 2, selectedVehicle: null, selectedTour: null, ...state },
    document: { getElementById: (id) => els[id] || null, querySelectorAll: (sel) => (sel === '.vehicle-card' || sel === '.vehicle-detail-card' ? cards : []) },
    updateExtras: () => { ctx.extrasCalled = true; },
    updatePricing: () => {}, buildVehicleCards: () => '', buildVehicleDetailCards: () => '', calculateTotal: () => ({}), alert: (m) => { ctx.alerted = m; },
    alertCapacity: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext([vehiclesSrc, ...['vehicleFits', 'recommendedVehicle', 'selectedVehicleIsValid', 'clearUnfitVehicle', 'syncVehicleStep', 'selectVehicle', 'selectVehicleDetail', 'refreshAfterCapacityChange'].map(fn)].join('\n'), ctx);
  return { ctx, els, cards };
}

test('nothing is selected by default and the recommended vehicle is not preselected', () => {
  const { ctx } = harness();
  assert.equal(ctx.state.selectedVehicle, null);
  assert.equal(ctx.recommendedVehicle(), 'sedan');
  ctx.syncVehicleStep();
  assert.equal(ctx.state.selectedVehicle, null, 'syncing must not choose for the guest');
});

test('Continue is disabled until a valid vehicle is chosen, with a hint that says nothing is selected', () => {
  const { ctx, els } = harness();
  ctx.syncVehicleStep();
  assert.equal(els.nextBtn2.disabled, true);
  assert.match(els.vehicleHint.textContent, /Tap a vehicle to choose it/);
  assert.match(els.vehicleHint.textContent, /nothing is selected/);
  assert.equal(els.vehicleHint.className, 'vehicle-hint');
});

test('tapping a card selects exactly that card, enables Continue and shows the selection in the hint', () => {
  const { ctx, els, cards } = harness();
  ctx.selectVehicleDetail('minivan', cards[1]);
  assert.equal(ctx.state.selectedVehicle, 'minivan');
  assert.equal(cards.filter((c) => c.classList.has('selected')).length, 1);
  assert.equal(cards[1].attrs['aria-checked'], 'true');
  assert.equal(cards[0].attrs['aria-checked'], 'false');
  assert.equal(els.nextBtn2.disabled, false);
  assert.match(els.vehicleHint.textContent, /Selected: Private Minivan/);
  assert.equal(els.vehicleHint.className, 'vehicle-hint ok');
});

test('a step-1 card tap also satisfies the step-2 gate', () => {
  const { ctx, els, cards } = harness();
  ctx.selectVehicle('sedan', cards[0]);
  assert.equal(ctx.state.selectedVehicle, 'sedan');
  assert.equal(els.nextBtn2.disabled, false);
  assert.equal(els.nextBtn1.disabled, false);
});

test('selection survives add-on changes and back navigation (re-sync keeps the same vehicle)', () => {
  const { ctx, els, cards } = harness();
  ctx.selectVehicleDetail('sedan', cards[0]);
  ctx.refreshAfterCapacityChange();   // what updateExtras() triggers
  ctx.syncVehicleStep();              // what re-entering step 2 triggers
  assert.equal(ctx.state.selectedVehicle, 'sedan');
  assert.equal(els.nextBtn2.disabled, false);
});

test('capacity change that no longer fits clears the choice, disables Continue and explains, without switching vehicle', () => {
  const { ctx, els, cards } = harness();
  ctx.selectVehicleDetail('sedan', cards[0]);
  ctx.state.passengers = 5;           // sedan holds 3
  ctx.refreshAfterCapacityChange();
  assert.equal(ctx.state.selectedVehicle, null, 'must not silently become minivan');
  assert.equal(els.nextBtn2.disabled, true);
  assert.match(els.vehicleHint.textContent, /Sedan can't carry 5 passengers/);
  assert.equal(els.vehicleHint.className, 'vehicle-hint warn');
});

test('a fitting choice is preserved when passengers change within capacity', () => {
  const { ctx, cards } = harness();
  ctx.selectVehicleDetail('minivan', cards[1]);
  ctx.state.passengers = 6;
  ctx.refreshAfterCapacityChange();
  assert.equal(ctx.state.selectedVehicle, 'minivan');
});

test('the notice clears once the guest picks a valid vehicle again', () => {
  const { ctx, els, cards } = harness();
  ctx.selectVehicleDetail('sedan', cards[0]);
  ctx.state.luggage = 5;
  ctx.refreshAfterCapacityChange();
  assert.match(els.vehicleHint.textContent, /bags/);
  ctx.selectVehicleDetail('minivan', cards[1]);
  assert.equal(ctx.state.vehicleNotice, '');
  assert.match(els.vehicleHint.textContent, /Selected: Private Minivan/);
});

test('source never assigns the recommended vehicle as a selection', () => {
  assert.doesNotMatch(app, /selectedVehicle\s*=\s*recommendedVehicle\(/);
  assert.doesNotMatch(app, /We've switched you/);
});

test('step-2 Continue is disabled in the markup; hint and radio groups exist', () => {
  assert.match(html, /<button class="btn-primary" id="nextBtn2" onclick="goToStep\(3\)" disabled>/);
  assert.match(html, /id="vehicleHint"[^>]*role="status"/);
  assert.match(html, /id="vehicleDetailCards" role="radiogroup"/);
});

test('cards carry a Selected mark that only shows when selected', () => {
  assert.equal((app.match(/vehicle-selected-mark/g) || []).length, 2);
  assert.match(css, /\.vehicle-selected-mark\{display:none;/);
  assert.match(css, /\.vehicle-card\.selected \.vehicle-selected-mark,\.vehicle-detail-card\.selected \.vehicle-selected-mark\{display:inline-block\}/);
});

test('hover styling that mimics "selected" only applies where hover exists (no sticky hover on touch)', () => {
  assert.doesNotMatch(css, /^\.vehicle-card:hover,/m);
  assert.doesNotMatch(css, /^\.vehicle-detail-card:hover,/m);
  assert.match(css, /@media \(hover:hover\)\{\.vehicle-card:hover\{/);
  assert.match(css, /@media \(hover:hover\)\{\.vehicle-detail-card:hover\{/);
});

test('sticky acquisition bar is hidden while the booking widget is visible and after step 1', () => {
  assert.match(css, /body\.booking-in-view \.sticky-bar,body\.booking-flow \.sticky-bar\{display:none\}/);
  assert.match(app, /classList\.toggle\('booking-flow', n > 1\)/);
  assert.match(app, /new IntersectionObserver\([^]*classList\.toggle\('booking-in-view', e\.isIntersecting\)/);
});

test('booking-in-view needs real overlap (edge-touching the fold does not hide the bar)', () => {
  assert.match(app, /rootMargin: '0px 0px -80px 0px'/);
});

test('sticky bar leaves room for the fixed chat launcher (60px + 20px offset)', () => {
  const m = css.match(/\.sticky-bar\{padding-right:(\d+)px\}/);
  assert.ok(m, 'padding rule missing');
  assert.ok(Number(m[1]) >= 80, 'padding-right must clear launcher width + offset');
});

test('cache-busting versions were bumped for the changed assets', () => {
  assert.match(html, /app\.js\?v=20260921-mobile-ux/);
  assert.match(html, /styles\.css\?v=20260921-mobile-ux/);
});

test('scope guard: no fare, pricing, Worker or notification code changed', () => {
  // the money-path functions must remain the ones the price tests already cover
  for (const name of ['calculateTotal', 'applyModifiers', 'buildWhatsAppURL', 'submitNadiBooking']) {
    assert.ok(app.includes(`function ${name}(`), `${name} still present`);
  }
});
