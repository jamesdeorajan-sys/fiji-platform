// Driver PWA v2 — GATE 1.5 isolated proof Worker entry. PACKAGE ONLY (not deployed by this repository).
// No scheduled handler. No outbound network. No messaging. Single D1 binding verified at runtime before any request is served.
import { createDriverService } from '../../src/service.js';
import { handle } from '../../src/http.js';
import { assertEnvShape, assertHostAllowed, assertIsolatedDatabase, IsolationError } from './safety.js';
import { D1CaptureNotifier, D1CaptureEvidenceStore } from './d1_capture.js';
import { handleControl } from './control.js';

try { globalThis.fetch = () => { throw new Error('GATE15_NO_OUTBOUND_NETWORK'); }; } catch { /* some runtimes freeze the global; the static scan + absence of any client code still hold */ }

const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default {
  async fetch(request, env) {
    try {
      assertEnvShape(env);
      assertHostAllowed(new URL(request.url).hostname);
      await assertIsolatedDatabase(env.DB);
    } catch (e) {
      if (e instanceof IsolationError) return json({ ok: false, code: e.code, reason: e.reason }, 503);
      return json({ ok: false, code: 'ISOLATION_ASSERTION_FAILED', reason: 'UNEXPECTED' }, 503);
    }
    const service = createDriverService({
      db: env.DB,
      clock: { now: () => Date.now() },                       // REAL server clock, always
      notifier: new D1CaptureNotifier(env.DB),
      evidenceStore: new D1CaptureEvidenceStore(),
      config: { realPhoneMode: false, financialEffectsEnabled: false },
    });
    const url = new URL(request.url);
    if (url.pathname.startsWith('/__gate15/')) return handleControl(request, env, service);
    if (url.pathname === '/healthz') return json({ ok: true, isolated: true }, 200);
    return handle(request, { service });
  },
};
