// Issue #59 - default-deny network guard for the offline test suite (Codex independent review).
//
// These files drive the REAL worker.js against a real (in-memory) D1, but the outside world - Meta's Graph API in
// particular - must never actually be reached. Every test that touches a code path capable of sending a WhatsApp
// message installs its OWN fetch mock (the `meta()`/`metaCapture()` pattern repeated across these files) and
// restores it afterwards. The gap this closes: if a test forgets to mock a path, restores its mock too early (see
// the fixed leak in driver_broadcast_recovery.test.mjs - `m.restore()` was called before
// POST /driver/bookings/:id/accept, which sends a real guest WhatsApp message on the way to its response), or the
// Worker code itself swallows a network error into a normal-looking failure result (sendHealthAlertWhatsApp's own
// try/catch returns `{attempted:true, ok:false, error:'Send failed.'}` rather than throwing back out) - a leaked
// real network call could go completely unnoticed by that test's own assertions.
//
// installNetworkGuard() sets globalThis.fetch to a function that (a) THROWS, so any code path that doesn't itself
// swallow the error still fails loudly and immediately, and (b) independently RECORDS the attempt in a module-level
// log, so a leak is caught even when Worker code does swallow the error. A file-scoped `after()` hook asserts that
// log is empty once every test in the file has finished, failing the whole run if not - this is what makes "even
// if Worker code catches it" true: the assertion does not depend on any single test noticing.
//
// Every test-specific mock in this directory must restore to the GUARD (via `restoreNetworkGuard()`, or simply by
// capturing `globalThis.fetch` as `original` AFTER `installNetworkGuard()` has already run at module load - both
// patterns already used here resolve to the same function) - never to some other, unguarded fetch.
import { after } from 'node:test';
import assert from 'node:assert/strict';

const leaks = [];
let guardFetch = null;

function describeCall(url, opts) {
  const method = (opts && opts.method) || 'GET';
  const target = typeof url === 'string' ? url : (url && url.url) || String(url);
  return `${method} ${target}`;
}

export function installNetworkGuard() {
  if (guardFetch) { globalThis.fetch = guardFetch; return guardFetch; } // idempotent if called twice in one file
  guardFetch = async (url, opts) => {
    const detail = describeCall(url, opts);
    leaks.push(detail);
    throw new Error(`UNMOCKED NETWORK CALL blocked by the offline-suite network guard: ${detail}`);
  };
  globalThis.fetch = guardFetch;
  after(() => {
    assert.deepEqual(leaks, [], `${leaks.length} unmocked outbound network call(s) were attempted during this file's tests (see list above) - even a caught/swallowed one is a real leak and must be mocked`);
  });
  return guardFetch;
}

// For a mock helper that wants to hand back control explicitly rather than relying on capture-at-install-time.
export function restoreNetworkGuard() {
  if (!guardFetch) throw new Error('installNetworkGuard() was not called in this file');
  globalThis.fetch = guardFetch;
}

export function networkGuardLeakCount() {
  return leaks.length;
}
