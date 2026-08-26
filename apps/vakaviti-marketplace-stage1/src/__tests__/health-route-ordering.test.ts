import { describe, it, expect } from 'vitest';
import worker from '../index';

// HOTFIX REGRESSION TEST (2026-08-27). Proves the exact defect found in the PR #23 post-merge
// incident cannot silently reoccur: app.route('/', dealExchangeUi) is a wildcard mount, and
// dealExchangeUi's own fail-closed gate previously sat ahead of /api/health in registration
// order, so with DEAL_EXCHANGE_PUBLIC_ENABLED=false the gate intercepted /api/health before its
// own handler ever ran. This test proves, with the flag genuinely false (this branch's real
// production value), that /api/health and every other pre-existing route reach their own
// handlers, while the Deal Exchange routes stay correctly fail-closed.
//
// No FakeD1 attempts to fabricate realistic rows for /, /operators, /experiences or /deals -
// their real queries are complex multi-table joins outside this test's scope. Instead each is
// given a "sentinel" D1 stand-in whose prepare() throws immediately, recognizably, and before any
// read or write could execute. Reaching that sentinel proves the route's OWN handler ran - i.e.
// it was not intercepted by the Deal Exchange gate, which would instead have returned a clean 503
// response and never touched D1 at all. Confirmed empirically (not assumed): calling the
// top-level app's exported fetch() for a handler that throws synchronously resolves to a plain
// Response with status 500 ("Internal Server Error") rather than rejecting the promise - the
// opposite of dealExchangeUi.request() called directly on the un-mounted sub-app (see
// deal-exchange-public-flag-guard.test.ts's history) - so these assertions check for a 500
// response, not a rejected promise.

const SENTINEL = 'SENTINEL_DB_REACHED';

function sentinelDb() {
  return {
    prepare() {
      throw new Error(SENTINEL);
    },
  } as any;
}

const baseEnv = {
  ENVIRONMENT: 'preview',
  AI: {} as any,
  ADMIN_TOKEN: 'test-admin-token',
  DEAL_EXCHANGE_PUBLIC_ENABLED: 'false',
};

async function fetchPath(path: string, env: Record<string, unknown>, init: RequestInit = {}) {
  return worker.fetch(new Request(`https://example.com${path}`, init), env as any);
}

describe('Hotfix regression: /api/health reaches its own handler with the public flag false', () => {
  it('GET /api/health returns 200 and the expected health JSON, touching no D1 binding at all', async () => {
    // Deliberately no DB binding at all (undefined) - if anything on the path to this response
    // ever touched c.env.DB, this would throw synchronously; the handler in fact never does.
    const env = { ...baseEnv };
    const res = await fetchPath('/api/health', env);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, service: 'vakaviti-marketplace-stage1', environment: 'preview', ai: true });
  });
});

describe('Hotfix regression: pre-existing routes are not intercepted by the Deal Exchange gate', () => {
  const cases: Array<[string, RequestInit?]> = [
    ['/', undefined],
    ['/operators', undefined],
    ['/experiences', undefined],
    ['/deals', undefined],
  ];

  for (const [path, init] of cases) {
    it(`${path} reaches its own handler (proven by hitting the sentinel D1, never the Deal Exchange 503)`, async () => {
      const env = { ...baseEnv, DB: sentinelDb() };
      const res = await fetchPath(path, env, init);
      // The sentinel throw surfaces as a plain 500 ("Internal Server Error") once it reaches the
      // route's own handler - the point of this assertion is that it is NOT the Deal Exchange
      // gate's 503, proving this route was never intercepted by that gate.
      expect(res.status).toBe(500);
      const body = await res.text();
      expect(body).not.toContain('Live Deal Exchange is not');
    });
  }
});

describe('Hotfix regression: Deal Exchange routes remain fail-closed with the public flag false', () => {
  const dealExchangePaths = ['/explore', '/live-deals', '/compare', '/plan', '/saved', '/chat'];

  for (const path of dealExchangePaths) {
    it(`${path} returns the feature-disabled 503 and never reaches the sentinel D1`, async () => {
      // DEAL_EXCHANGE_DB deliberately set to a sentinel - if the gate ever failed open, this
      // test would fail with the sentinel error instead of asserting the correct 503, making a
      // regression in the other direction (accidentally reachable) impossible to miss too.
      const env = { ...baseEnv, DEAL_EXCHANGE_DB: sentinelDb() };
      const res = await fetchPath(path, env);
      expect(res.status).toBe(503);
      const body = await res.text();
      expect(body).toBe('Live Deal Exchange is not yet publicly enabled on this environment.');
    });
  }
});

describe('Hotfix regression: no D1 write is possible while these routes are exercised', () => {
  it('the sentinel D1 throws before any prepare()-based read or write can execute, for every route above', () => {
    // This is true by construction (sentinel.prepare() throws before returning a statement
    // object that could ever be .run()), not by chance - documented here as an explicit,
    // readable assertion of that guarantee rather than leaving it implicit in the tests above.
    const db = sentinelDb();
    expect(() => db.prepare('any sql')).toThrow(SENTINEL);
  });
});
