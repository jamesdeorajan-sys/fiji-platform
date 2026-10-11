// Chat launcher clearance (2026-10-11): on small screens the launcher fades out while the topmost page element under it is a control, and returns when the spot is clear.
// Runs the REAL chat-widget.js in a vm against a small DOM double. Run: node --test test/chat-clearance.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../src/chat-widget.js', import.meta.url), 'utf8').replace(/\r/g, '');
const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8').replace(/\r/g, '');

function env({ narrow = true, stack = [], controls = [], roots = [] } = {}) {
  const ids = {}; const listeners = { window: {}, document: {} }; const timers = [];
  const mk = (id) => ({ id, _w: false, listeners: {}, style: {}, children: [], classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); }, contains(c) { return this.s.has(c); } },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, appendChild(c) { this.children.push(c); }, setAttribute() {}, focus() {}, scrollIntoView() {}, contains(x) { return x && x._widget === true; },
    getBoundingClientRect() { return { left: 300, top: 700, right: 354, bottom: 754, width: 54, height: 54 }; } });
  const widgetKids = ['ftt-chat-launcher', 'ftt-chat-panel', 'ftt-chat-close', 'ftt-chat-send', 'ftt-chat-input', 'ftt-chat-messages', 'ftt-chat-whatsapp', 'ftt-chat-tooltip', 'ftt-chat-typing'];
  const document = {
    readyState: 'complete', documentElement: mk('html'), head: mk('head'), body: { appendChild(el) { ids[el.id] = el; el._widget = true; widgetKids.forEach((k) => { ids[k] = mk(k); ids[k]._widget = true; }); } },
    getElementById: (id) => ids[id] || null, createElement: () => mk(''), querySelector: () => null,
    // the exact-overlap check asks for the controls and for the result-card roots; the old `stack` helper is kept for the existing tests (page(true) = a control covering the launcher)
    querySelectorAll: (sel) => (String(sel).includes('a[href]') ? [...stack.filter((x) => x && x._control), ...controls] : String(sel).includes('bula-success') ? roots : []),
    addEventListener(t, f) { (listeners.document[t] = listeners.document[t] || []).push(f); },
  };
  const ctx = { document, console, setTimeout: (f) => { timers.push(f); return timers.length; }, setInterval: () => 1, clearTimeout() {}, fetch: async () => ({ json: async () => ({}) }), JSON, Math, Date, Promise,
    window: null, requestAnimationFrame: (f) => { f(); return 1; }, matchMedia: () => ({ matches: narrow, addEventListener() {} }), 
    addEventListener(t, f) { (listeners.window[t] = listeners.window[t] || []).push(f); }, localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null, setItem() {} }, location: { href: 'https://x/' }, navigator: {} };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
  const widget = ids['ftt-chat-widget'];
  const flush = () => { for (let i = 0; i < 20 && timers.length; i++) { const q = timers.splice(0); q.forEach((f) => f()); } };
  return { ctx, widget, ids, listeners, flush, timers, html: document.documentElement, setStack(s) { stack.length = 0; s.forEach((x) => stack.push(x)); }, setControls(c) { controls.length = 0; c.forEach((x) => controls.push(x)); }, setRoots(r) { roots.length = 0; r.forEach((x) => roots.push(x)); } };
}
const page = (match, extra = {}) => ({ _control: !!match, getClientRects: () => [{ left: 310, top: 710, right: 340, bottom: 740 }], childNodes: [], closest: (sel) => (match ? { sel } : null), ...extra });   // match = a control sitting on the launcher
const inWidget = { _widget: true, closest: () => ({}) };

test('STATIC: the widget is otherwise unchanged: same launcher, same panel, same fixed corner; the only additions are the clearance CSS, setupClearance() and its one call', () => {
  assert.ok(src.includes('setupClearance();') && src.includes('function setupClearance()') && src.includes('.ftt-yield'));
  assert.ok(src.includes('position: fixed;\n      bottom: 20px;\n      right: 20px;'), 'launcher position unchanged');
  assert.ok(src.includes('@media (max-width: 480px) {\n      #ftt-chat-widget { bottom: 16px; right: 16px; }'), 'existing mobile rules unchanged');
  assert.match(html, /<script src="chat-widget\.js\?v=20261011-clearance2"><\/script>/, 'cache key bumped so phones fetch the new widget');
});

test('YIELDS: on a phone, when a control (field, selector, button, summary) is topmost under the launcher, the launcher gets ftt-yield; it returns when the spot is clear', () => {
  const e = env({ stack: [inWidget, page(true)] }); e.flush();
  assert.equal(e.widget.classList.contains('ftt-yield'), true, 'control under the launcher: step aside');
  e.setStack([inWidget, page(false)]); e.listeners.window.scroll[0](); e.flush();
  assert.equal(e.widget.classList.contains('ftt-yield'), false, 'clear spot: launcher is back');
});

test('ANY overlapping control counts (a plain element on top of it no longer hides it from the check), and the widget itself is skipped', () => {
  const e = env({ stack: [inWidget, page(false), page(true)] }); e.flush();
  assert.equal(e.widget.classList.contains('ftt-yield'), true, 'exact rule: the control overlaps the footprint whatever is stacked above it');
  e.setStack([inWidget, inWidget]); e.listeners.window.scroll[0](); e.flush(); assert.equal(e.widget.classList.contains('ftt-yield'), false);
});

test('NEVER YIELDS on a wide screen, and never while the chat panel is open', () => {
  const wide = env({ narrow: false, stack: [inWidget, page(true)] }); wide.flush(); assert.equal(wide.widget.classList.contains('ftt-yield'), false);
  const open = env({ stack: [inWidget, page(true)] }); open.flush(); assert.equal(open.widget.classList.contains('ftt-yield'), true);
  open.ids['ftt-chat-launcher'].listeners.click[0]();                             // guest opens the chat
  open.listeners.window.scroll[0](); open.flush(); assert.equal(open.widget.classList.contains('ftt-yield'), false, 'an open chat stays visible');
});

test('RE-EVALUATES on scroll, resize, click, input and change (and every second): the booking steps change what is under the launcher without any scroll', () => {
  const e = env({ stack: [inWidget, page(false)] }); e.flush();
  for (const [kind, type] of [['window', 'scroll'], ['window', 'resize'], ['document', 'input'], ['document', 'change']]) {
    e.setStack([inWidget, page(true)]); e.listeners[kind][type][0](); e.flush(); assert.equal(e.widget.classList.contains('ftt-yield'), true, type);
    e.setStack([inWidget, page(false)]); e.listeners[kind][type][0](); e.flush(); assert.equal(e.widget.classList.contains('ftt-yield'), false, type + ' back');
  }
  e.setStack([inWidget, page(true)]); e.listeners.document.click[0](); e.flush(); assert.equal(e.widget.classList.contains('ftt-yield'), true, 'click (after the page has reacted)');
});

test('HIDDEN MEANS HIDDEN: while yielding the launcher is invisible, cannot be tapped and cannot be reached by keyboard (visibility:hidden), and it is only ever hidden by this rule', () => {
  assert.match(src, /#ftt-chat-widget\.ftt-yield \{ opacity: 0; visibility: hidden; pointer-events: none;/);
  assert.equal((src.match(/ftt-yield/g) || []).length >= 3, true);
  assert.ok(!/ftt-chat-launcher[^\n]*display: none/.test(src.replace(/#ftt-chat-tooltip \{ display: none; \}/, '')), 'the launcher is never removed with display:none');
});

test('THE THROTTLE DOES NOT DEPEND ON PAINTING: the clearance check is driven by a timer, not requestAnimationFrame (which does not run while a page is not being painted)', () => {
  const body = src.slice(src.indexOf('function setupClearance()'), src.indexOf('// ─── Initialise')).replace(/\/\/.*$/gm, '');   // comments may name it
  assert.ok(!/requestAnimationFrame/.test(body), 'setupClearance must not use requestAnimationFrame');
  assert.match(body, /setTimeout\(evaluate, 80\)/);
});

test('CONTACT ROUTE: while the launcher is tucked away <html> carries ftt-chat-yielded (so the page can show its own WhatsApp link); it is removed when the launcher returns, when the panel opens and on wide screens', () => {
  const e = env({ stack: [inWidget, page(true)] }); e.flush();
  assert.equal(e.html.classList.contains('ftt-chat-yielded'), true, 'hidden: flag on');
  e.setStack([inWidget, page(false)]); e.listeners.window.scroll[0](); e.flush();
  assert.equal(e.widget.classList.contains('ftt-yield'), false); assert.equal(e.html.classList.contains('ftt-chat-yielded'), false, 'back: flag off');
  const wide = env({ narrow: false, stack: [inWidget, page(true)] }); wide.flush(); assert.equal(wide.html.classList.contains('ftt-chat-yielded'), false);
  const open = env({ stack: [inWidget, page(true)] }); open.flush(); open.ids['ftt-chat-launcher'].listeners.click[0](); open.listeners.window.scroll[0](); open.flush();
  assert.equal(open.html.classList.contains('ftt-chat-yielded'), false, 'panel open: flag off');
});

test('CONTACT ROUTE CSS: the header link is revealed ONLY on phones and ONLY while yielded, as a >=44px icon; no invisible blocking: the hidden launcher is visibility:hidden + pointer-events:none, and nothing else stays behind', () => {
  const css = src.slice(src.indexOf('Clearance (2026-10-11)'), src.indexOf('`;', src.indexOf('Clearance (2026-10-11)')));
  assert.match(css, /@media \(max-width: 600px\) \{[\s\S]*html\.ftt-chat-yielded \.nav-phone \{ display: flex;[^}]*min-width: 44px; min-height: 44px;/);
  assert.equal((css.match(/ftt-chat-yielded/g) || []).length, 3, 'only the nav-phone rules use it');
  assert.match(css, /html\.ftt-chat-yielded \.nav-phone ~ \.btn-nav \{ display: none; \}/, 'Book Now makes room for the icon, and only next to a .nav-phone link (never on FijiDash)');
  assert.match(css, /#ftt-chat-widget\.ftt-yield \{ opacity: 0; visibility: hidden; pointer-events: none;/);
});

// ═══ EXACT OVERLAP (2026-10-11 correction, found on a real phone at 393x659): the previous check sampled nine points INSIDE the launcher, so a control or a line of text overlapping only its outer
// edge band (up to ~11 px) went unnoticed, and plain text (the result-card instructions) was never protected. The check is now geometric: the launcher's whole footprint against every rectangle. ═══
// Launcher footprint in these tests: left 300, top 700, right 354, bottom 754 (54 x 54), grown by 2 px on every side -> 298..356 x 698..756.
const ctl = (left, top, right, bottom, extra = {}) => ({ _control: true, getClientRects: () => [{ left, top, right, bottom }], childNodes: [], ...extra });
const textEl = (rects, extra = {}) => ({ getClientRects: () => rects, childNodes: [{ nodeType: 3, nodeValue: 'Opening WhatsApp alone does not send your request.' }], ...extra });
const cardWith = (...els) => ({ getClientRects: () => [{ left: 0, top: 0, right: 393, bottom: 2000 }], childNodes: [], querySelectorAll: () => els });
const yields = (e) => e.widget.classList.contains('ftt-yield');

test('EDGE OVERLAPS: a control that overlaps ONLY the launcher\'s outer edge band is detected: 1 px, 3 px and 8 px slivers on every side and every corner', () => {
  // [description, left, top, right, bottom]: each rectangle shares a thin sliver of area with the footprint (including the 2 px margin)
  const slivers = [['bottom edge, 1 px', 100, 600, 500, 699], ['bottom edge, 3 px', 100, 600, 500, 701], ['bottom edge, 8 px', 100, 600, 500, 708],
    ['top edge, 3 px', 100, 752, 500, 900], ['top edge, 8 px', 100, 747, 500, 900], ['right edge, 3 px', 100, 600, 301, 900], ['right edge, 8 px', 100, 600, 308, 900],
    ['left edge, 3 px', 351, 600, 600, 900], ['left edge, 8 px', 346, 600, 600, 900],
    ['top-left corner of the box, 1 px', 100, 100, 299, 699], ['bottom-right corner of the box, 1 px', 355, 755, 600, 900], ['top-right corner of the box, 1 px', 355, 100, 600, 699], ['bottom-left corner of the box, 1 px', 100, 755, 299, 900]];
  for (const [what, l, t, r, b] of slivers) {
    const e = env(); e.setControls([ctl(l, t, r, b)]); e.flush(); assert.equal(yields(e), true, what);
  }
});

test('NO FALSE ALARM: controls clearly outside the footprint (even 5 px away) do not hide the launcher', () => {
  for (const [what, l, t, r, b] of [['5 px above', 100, 600, 500, 693], ['5 px below', 100, 761, 500, 900], ['5 px to the left', 100, 600, 293, 900], ['5 px to the right', 361, 600, 600, 900], ['far away', 0, 0, 50, 50]]) {
    const e = env(); e.setControls([ctl(l, t, r, b)]); e.flush(); assert.equal(yields(e), false, what);
  }
});

test('RESULT-CARD INSTRUCTIONS: a line of text in a result card is protected like a control, including a 3 px overlap of one wrapped line; text outside result cards is not', () => {
  const para = textEl([{ left: 40, top: 600, right: 350, bottom: 640 }, { left: 40, top: 640, right: 350, bottom: 699 }]);      // two wrapped lines: the second ends 1 px inside the footprint
  const e = env(); e.setRoots([cardWith(para)]); e.flush(); assert.equal(yields(e), true, 'second line overlaps the footprint by 1 px');
  const clear = textEl([{ left: 40, top: 600, right: 350, bottom: 640 }, { left: 40, top: 640, right: 350, bottom: 690 }]);       // ends 8 px above
  const f = env(); f.setRoots([cardWith(clear)]); f.flush(); assert.equal(yields(f), false, 'clear of the footprint');
  const g = env(); g.setRoots([cardWith(textEl([{ left: 330, top: 745, right: 380, bottom: 760 }]))]); g.flush(); assert.equal(yields(g), true, 'a short line just touching the lower-right of the footprint');
  const noText = { getClientRects: () => [{ left: 300, top: 700, right: 354, bottom: 754 }], childNodes: [{ nodeType: 3, nodeValue: '   ' }] };   // an empty wrapper is not text
  const h = env(); h.setRoots([cardWith(noText)]); h.flush(); assert.equal(yields(h), false, 'whitespace-only element');
  const i = env(); i.setRoots([cardWith(textEl([{ left: 0, top: 0, right: 0, bottom: 0 }]))]); i.flush(); assert.equal(yields(i), false, 'an empty box');
});

test('HIDDEN THINGS ARE IGNORED: display:none (no rectangles), visibility/content-visibility (checkVisibility false) and a hidden result card never hide the launcher', () => {
  const e = env(); e.setControls([{ _control: true, getClientRects: () => [], childNodes: [] }]); e.flush(); assert.equal(yields(e), false, 'no rectangles (display:none)');
  const f = env(); f.setControls([ctl(300, 700, 354, 754, { checkVisibility: () => false })]); f.flush(); assert.equal(yields(f), false, 'checkVisibility() false');
  const g = env(); g.setControls([ctl(300, 700, 354, 754, { checkVisibility: () => true })]); g.flush(); assert.equal(yields(g), true, 'checkVisibility() true');
  const h = env(); h.setRoots([{ getClientRects: () => [], childNodes: [], querySelectorAll: () => [textEl([{ left: 300, top: 700, right: 354, bottom: 754 }])] }]); h.flush(); assert.equal(yields(h), false, 'a result card that is not shown');
});

test('THE WIDGET\'S OWN ELEMENTS never count; the speech-bubble tooltip is part of the footprint only while it is showing', () => {
  const own = ctl(300, 700, 354, 754, { _widget: true }); const e = env(); e.setControls([own]); e.flush(); assert.equal(yields(e), false, 'a control inside the widget');
  const f = env(); f.ids['ftt-chat-tooltip'].offsetParent = {}; f.ids['ftt-chat-tooltip'].getBoundingClientRect = () => ({ left: 120, top: 700, right: 290, bottom: 750, width: 170, height: 50 });
  f.setControls([ctl(150, 690, 250, 720)]); f.flush(); assert.equal(yields(f), true, 'a control under the visible tooltip');
  const g = env(); g.ids['ftt-chat-tooltip'].offsetParent = null; g.ids['ftt-chat-tooltip'].getBoundingClientRect = () => ({ left: 120, top: 700, right: 290, bottom: 750, width: 170, height: 50 });
  g.setControls([ctl(150, 690, 250, 720)]); g.flush(); assert.equal(yields(g), false, 'tooltip not showing: not part of the footprint');
});

test('STILL UNCHANGED: never on a wide screen, never while the chat is open, the launcher returns the moment the overlap ends (including a 1 px one)', () => {
  const wide = env({ narrow: false }); wide.setControls([ctl(300, 700, 354, 754)]); wide.flush(); assert.equal(yields(wide), false);
  const e = env(); e.setControls([ctl(100, 600, 500, 699)]); e.flush(); assert.equal(yields(e), true);
  e.setControls([ctl(100, 600, 500, 697)]); e.listeners.window.scroll[0](); e.flush(); assert.equal(yields(e), false, 'the control moved 2 px up: clear again');
  assert.match(src, /CLEARANCE_AVOID = 'a\[href\],button,input,select,textarea,summary,label,\[role="button"\],\[onclick\],\.field-input,\.typeahead-trigger,\.vehicle-card,\.vehicle-detail-card'/, 'the set of controls is the same as before');
  assert.ok(!/elementsFromPoint|probes/.test(src.slice(src.indexOf('function setupClearance()'), src.indexOf('setupClearance();', src.indexOf('function setupClearance()') + 10))), 'no sampled probe points remain');
});

test('NO BLIND SPOT (randomised): for 1500 random rectangles, controls AND result-card text lines, the launcher yields exactly when an independent area-overlap calculation says they share area with the 298..356 x 698..756 footprint', () => {
  let seed = 20261011; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let yes = 0, no = 0;
  for (let i = 0; i < 1500; i++) {
    const w = 1 + Math.floor(rnd() * 90), h = 1 + Math.floor(rnd() * 60), l = Math.floor(200 + rnd() * 260), t = Math.floor(600 + rnd() * 260), r = l + w, b = t + h;
    const expected = r > 298 && l < 356 && b > 698 && t < 756;                    // independent of the widget: positive shared area with the footprint (launcher 300..354 x 700..754 grown by 2)
    const e = env(); if (i % 2) e.setControls([ctl(l, t, r, b)]); else e.setRoots([cardWith(textEl([{ left: l, top: t, right: r, bottom: b }]))]);
    e.flush(); assert.equal(yields(e), expected, `${i % 2 ? 'control' : 'text'} ${l},${t},${r},${b}`); expected ? yes++ : no++;
  }
  assert.ok(yes > 200 && no > 200, 'both outcomes are well represented: ' + yes + '/' + no);
});
