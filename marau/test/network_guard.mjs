// Marau Stage 1 (PREVIEW ONLY) — default-deny network guard for the
// offline test suite. Adapted from the same pattern already proven in
// nadi-marketplace/worker/network_guard.mjs (Issue #59): every test file
// that imports installNetworkGuard() gets globalThis.fetch replaced with
// a function that THROWS on any call and independently RECORDS it, with a
// file-scoped after() assertion that the log is empty. This is what makes
// "no real WhatsApp send, no real AI provider call, no other external
// network endpoint" an enforced property of the test suite rather than a
// claim about the code — even a caught/swallowed leak fails the run.
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
  if (guardFetch) {
    globalThis.fetch = guardFetch;
    return guardFetch;
  }
  guardFetch = async (url, opts) => {
    const detail = describeCall(url, opts);
    leaks.push(detail);
    throw new Error(`UNMOCKED NETWORK CALL blocked by the Marau offline-suite network guard: ${detail}`);
  };
  globalThis.fetch = guardFetch;
  after(() => {
    assert.deepEqual(
      leaks,
      [],
      `${leaks.length} unmocked outbound network call(s) were attempted during this file's tests — Marau Stage 1 must never send a real WhatsApp message or call a real AI provider`
    );
  });
  return guardFetch;
}
