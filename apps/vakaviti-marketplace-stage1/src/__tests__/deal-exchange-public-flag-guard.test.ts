import { describe, it, expect } from 'vitest';
import { dealExchangeUi } from '../deal-exchange-ui';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// PRODUCTION INTEGRATION BRANCH - Phase 2 structural safety proof (2026-08-26). This branch
// changes only wrangler.toml configuration (new production DEAL_EXCHANGE_DB, PUBLIC_ENABLED set
// to "false") and adds regression guards - it deliberately makes no application-code change, so
// this test proves a property of code that was already QA-proven on PR #22 (cea9fb5d), not new
// behavior. It closes a real gap: the 103/32 QA-run tests exercised the QA bypass path
// extensively, but nothing directly proved the disabled-flag path never reaches the database -
// which is exactly the path this integration branch will actually run in production.

function throwingDb(label: string) {
  return {
    prepare() {
      throw new Error(`DB_TOUCHED_BEFORE_GATE:${label}`);
    },
  } as any;
}

describe('Production integration test: public routes fail closed before any D1 access', () => {
  it('returns 503 and never touches D1 when DEAL_EXCHANGE_DB is entirely absent', async () => {
    const res = await dealExchangeUi.request('/live-deals', {}, { ENVIRONMENT: 'production' } as any);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('not configured on this environment');
  });

  it('returns 503 and never touches a bound D1 when DEAL_EXCHANGE_PUBLIC_ENABLED is "false"', async () => {
    const env = {
      ENVIRONMENT: 'production',
      DEAL_EXCHANGE_DB: throwingDb('flag-false'),
      DEAL_EXCHANGE_PUBLIC_ENABLED: 'false',
    } as any;
    const res = await dealExchangeUi.request('/live-deals', {}, env);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('not yet publicly enabled');
  });

  it('returns 503 and never touches a bound D1 when DEAL_EXCHANGE_PUBLIC_ENABLED is unset', async () => {
    const env = {
      ENVIRONMENT: 'production',
      DEAL_EXCHANGE_DB: throwingDb('flag-unset'),
    } as any;
    const res = await dealExchangeUi.request('/live-deals', {}, env);
    expect(res.status).toBe(503);
  });

  it('correctly reports qaModeActive for the real [env.qa] shape, via the one route mounted ahead of the disabled-flag gate', async () => {
    // /internal/build-info is mounted before the gate (see deal-exchange-ui.ts) and touches no D1
    // binding at all, so it is the one safe route to exercise the real [env.qa] shape with -
    // DEAL_EXCHANGE_QA_DB + QA_TEST_MODE='true', no DEAL_EXCHANGE_DB. Listing routes such as
    // /live-deals are never exercised under this shape in any real deployment (the actual QA
    // Worker deliberately has no DEAL_EXCHANGE_DB to serve them - see wrangler.toml's [env.qa] -
    // so this test does not attempt that combination.
    const env = {
      ENVIRONMENT: 'qa',
      DEAL_EXCHANGE_QA_DB: throwingDb('qa-env'),
      QA_TEST_MODE: 'true',
    } as any;
    const res = await dealExchangeUi.request('/internal/build-info', {}, env);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.qaModeActive).toBe(true);
  });

  it('/internal/qa-cleanup is blocked by the disabled-flag gate before it ever reaches its own handler (no DB bound, production)', async () => {
    // With no DEAL_EXCHANGE_DB bound at all, the same fail-closed gate that blocks every other
    // route blocks this one too - the request never reaches /internal/qa-cleanup's own handler,
    // so this is a 503 ("not configured"), not that handler's own 404. That is a stronger, earlier
    // block, not a weaker one - see the next two tests for the exact scenario that reaches the
    // route's own 404 check.
    const env = { ENVIRONMENT: 'production' } as any;
    const res = await dealExchangeUi.request('/internal/qa-cleanup', { method: 'POST' }, env);
    expect(res.status).toBe(503);
  });

  it('/internal/qa-cleanup is blocked by the disabled-flag gate before it ever reaches its own handler (production DB bound, flag false - this branch\'s actual configuration)', async () => {
    const env = {
      ENVIRONMENT: 'production',
      DEAL_EXCHANGE_DB: throwingDb('prod-cleanup-attempt'),
      DEAL_EXCHANGE_PUBLIC_ENABLED: 'false',
    } as any;
    const res = await dealExchangeUi.request('/internal/qa-cleanup', { method: 'POST' }, env);
    expect(res.status).toBe(503);
  });

  it('/internal/qa-cleanup only reaches its own handler when the disabled-flag gate is passed (DB bound, flag true, no QA vars) - and even then returns 404, never running the cleanup', async () => {
    // This is the exact scenario src/deal-exchange-ui.ts's own comment above the route describes
    // ("404 outside the QA environment, not even a 503 that confirms the route exists at all") -
    // it requires the global gate to be passed first (DB bound AND flag==='true'), which only ever
    // happens on the ordinary PR-branch preview, never on this production-integration branch
    // (where the flag is hard-set to "false" - see the two tests above).
    const env = {
      ENVIRONMENT: 'preview',
      DEAL_EXCHANGE_DB: throwingDb('ordinary-preview-cleanup-attempt'),
      DEAL_EXCHANGE_PUBLIC_ENABLED: 'true',
    } as any;
    const res = await dealExchangeUi.request('/internal/qa-cleanup', { method: 'POST' }, env);
    expect(res.status).toBe(404);
  });
});

describe('Production integration test: the disabled-flag guard is registered ahead of every route (source inspection)', () => {
  it('the fail-closed middleware appears before the first route handler in deal-exchange-ui.ts', () => {
    const src = readFileSync(fileURLToPath(new URL('../deal-exchange-ui.ts', import.meta.url)), 'utf8');
    const guardIndex = src.indexOf("dealExchangeUi.use('*'");
    expect(guardIndex).toBeGreaterThan(-1);
    const firstRouteIndex = src.search(/dealExchangeUi\.(get|post)\(\s*'\/(?!internal\/build-info)/);
    expect(firstRouteIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(firstRouteIndex);
  });
});
