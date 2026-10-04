/* Marau (PREVIEW/TEST ONLY) - the page scripts must work AFTER Wrangler's real bundling, not just when run unbundled.
 *
 * REPRODUCED DEFECT (found by the real guest-browser acceptance run on preview 3b261fd3, also true of the previously
 * deployed 83e9b919): the guest app and /staff embed client code with Function.prototype.toString(). Wrangler's esbuild step
 * injects `__name(fn, "name")` helper calls into those function bodies, and `__name` does not exist in the page, so the page
 * script threw "ReferenceError: __name is not defined" at load - every view stayed hidden. Every earlier test ran the
 * UNBUNDLED source, which is why 335 passing tests could not see it. This test bundles with the real `wrangler deploy
 * --dry-run` (offline; nothing is deployed), loads the bundled Worker, extracts the served client functions from the SERVED
 * HTML and instantiates them with stub dependencies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installNetworkGuard } from './network_guard.mjs';

installNetworkGuard();

function bundle() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'marau-bundle-'));
  execFileSync('npx', ['wrangler', 'deploy', '--dry-run', '--outdir', out], { cwd: process.cwd(), env: { ...process.env, CLOUDFLARE_API_TOKEN: '' }, shell: true, stdio: 'pipe', timeout: 120_000 });
  return path.join(out, 'worker.js');
}

function extractFunction(pageText, name) {
  const start = pageText.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `${name} is present in the served page`);
  const end = pageText.indexOf('\n}\n', start) + 3;
  return pageText.slice(start, end);
}

test('BUNDLED: the served guest-app and staff-console client functions instantiate without ReferenceError after real bundling', async (t) => {
  let file;
  try { file = bundle(); } catch (err) { t.skip(`wrangler dry-run bundling unavailable here: ${String(err.message).slice(0, 120)}`); return; }
  const bundled = (await import(pathToFileURL(file).href)).default;
  const get = async (p) => (await bundled.fetch(new Request('http://marau.test' + p), { DB: null, MARAU_ADMIN_TEST_TOKEN: 'x' })).text();

  const guestPage = await get('/');
  const staffPage = await get('/staff');
  // 1. Wherever the bundler left __name(...) calls in a served page, the page itself must define __name EARLIER.
  for (const [label, page] of [['/', guestPage], ['/staff', staffPage]]) {
    const firstCall = page.search(/[^.\w]__name\s*\(/);
    const shim = page.indexOf('var __name = function');
    if (firstCall !== -1) assert.ok(shim !== -1 && shim < firstCall, `${label}: served script calls __name before (or without) defining it`);
  }
  // 2. The served client functions actually run.
  const store = new Map();
  const stubEl = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, setAttribute() {}, querySelectorAll: () => [], querySelector: () => null, set innerHTML(v) {}, get innerHTML() { return ''; } });
  const stubDoc = { getElementById: stubEl, querySelectorAll: () => [], querySelector: () => null, createElement: stubEl, addEventListener() {} };
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  // The page's OWN shim, exactly as served, precedes the client code just as it does in the browser.
  const shimOf = (page) => page.slice(page.indexOf('var __name = function'), page.indexOf('};', page.indexOf('var __name = function')) + 2);
  const offers = new Function(`${shimOf(guestPage)}\n${extractFunction(guestPage, 'createOffersClient')}\nreturn createOffersClient;`);
  assert.doesNotThrow(() => offers()({ authFetch: async () => ({ ok: true, data: {} }), toast() {}, renderMockWhatsApp() {}, formatFijiCurrency: (n) => String(n), els: {}, storage, document: stubDoc }), 'createOffersClient');
  const staffConsole = new Function(`${shimOf(staffPage)}\n${extractFunction(staffPage, 'createStaffConsole')}\nreturn createStaffConsole;`);
  assert.doesNotThrow(() => staffConsole()({ document: stubDoc, storage, fetchImpl: async () => ({ json: async () => ({}) }), prompt: () => null }), 'createStaffConsole');
});
