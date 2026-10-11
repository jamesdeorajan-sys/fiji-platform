// Chat launcher clearance (2026-10-11): on small screens the launcher fades out while the topmost page element under it is a control, and returns when the spot is clear.
// Runs the REAL chat-widget.js in a vm against a small DOM double. Run: node --test test/chat-clearance.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../src/chat-widget.js', import.meta.url), 'utf8').replace(/\r/g, '');
const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8').replace(/\r/g, '');

function env({ narrow = true, stack = [] } = {}) {
  const ids = {}; const listeners = { window: {}, document: {} }; const timers = [];
  const mk = (id) => ({ id, _w: false, listeners: {}, style: {}, children: [], classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); }, contains(c) { return this.s.has(c); } },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, appendChild(c) { this.children.push(c); }, setAttribute() {}, focus() {}, scrollIntoView() {}, contains(x) { return x && x._widget === true; },
    getBoundingClientRect() { return { left: 300, top: 700, width: 54, height: 54 }; } });
  const widgetKids = ['ftt-chat-launcher', 'ftt-chat-panel', 'ftt-chat-close', 'ftt-chat-send', 'ftt-chat-input', 'ftt-chat-messages', 'ftt-chat-whatsapp', 'ftt-chat-tooltip', 'ftt-chat-typing'];
  const document = {
    readyState: 'complete', documentElement: mk('html'), head: mk('head'), body: { appendChild(el) { ids[el.id] = el; el._widget = true; widgetKids.forEach((k) => { ids[k] = mk(k); ids[k]._widget = true; }); } },
    getElementById: (id) => ids[id] || null, createElement: () => mk(''), querySelector: () => null, querySelectorAll: () => [],
    addEventListener(t, f) { (listeners.document[t] = listeners.document[t] || []).push(f); },
    elementsFromPoint: () => stack,
  };
  const ctx = { document, console, setTimeout: (f) => { timers.push(f); return timers.length; }, setInterval: () => 1, clearTimeout() {}, fetch: async () => ({ json: async () => ({}) }), JSON, Math, Date, Promise,
    window: null, requestAnimationFrame: (f) => { f(); return 1; }, matchMedia: () => ({ matches: narrow, addEventListener() {} }), 
    addEventListener(t, f) { (listeners.window[t] = listeners.window[t] || []).push(f); }, localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null, setItem() {} }, location: { href: 'https://x/' }, navigator: {} };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
  const widget = ids['ftt-chat-widget'];
  const flush = () => { for (let i = 0; i < 20 && timers.length; i++) { const q = timers.splice(0); q.forEach((f) => f()); } };
  return { ctx, widget, ids, listeners, flush, timers, html: document.documentElement, setStack(s) { stack.length = 0; s.forEach((x) => stack.push(x)); } };
}
const page = (match, extra = {}) => ({ closest: (sel) => (match ? { sel } : null), ...extra });
const inWidget = { _widget: true, closest: () => ({}) };

test('STATIC: the widget is otherwise unchanged: same launcher, same panel, same fixed corner; the only additions are the clearance CSS, setupClearance() and its one call', () => {
  assert.ok(src.includes('setupClearance();') && src.includes('function setupClearance()') && src.includes('.ftt-yield'));
  assert.ok(src.includes('position: fixed;\n      bottom: 20px;\n      right: 20px;'), 'launcher position unchanged');
  assert.ok(src.includes('@media (max-width: 480px) {\n      #ftt-chat-widget { bottom: 16px; right: 16px; }'), 'existing mobile rules unchanged');
  assert.match(html, /<script src="chat-widget\.js\?v=20261011-clearance"><\/script>/, 'cache key bumped so phones fetch the new widget');
});

test('YIELDS: on a phone, when a control (field, selector, button, summary) is topmost under the launcher, the launcher gets ftt-yield; it returns when the spot is clear', () => {
  const e = env({ stack: [inWidget, page(true)] }); e.flush();
  assert.equal(e.widget.classList.contains('ftt-yield'), true, 'control under the launcher: step aside');
  e.setStack([inWidget, page(false)]); e.listeners.window.scroll[0](); e.flush();
  assert.equal(e.widget.classList.contains('ftt-yield'), false, 'clear spot: launcher is back');
});

test('ONLY THE TOPMOST PAGE ELEMENT counts, and the widget itself is skipped', () => {
  const e = env({ stack: [inWidget, page(false), page(true)] }); e.flush();   // plain element on top of a control underneath: not covering a control
  assert.equal(e.widget.classList.contains('ftt-yield'), false);
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
