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

  it('does not use the disabled-flag path when the dedicated QA environment is active', async () => {
    // Mirrors the real [env.qa] shape: DEAL_EXCHANGE_QA_DB + QA_TEST_MODE='true', no
    // DEAL_EXCHANGE_DB, no DEAL_EXCHANGE_PUBLIC_ENABLED - the QA bypass this route already relies
    // on for the QA-only worker (verified extensively by the 32-test Playwright QA run).
    const env = {
      ENVIRONMENT: 'qa',
      DEAL_EXCHANGE_QA_DB: throwingDb('qa-env'),
      QA_TEST_MODE: 'true',
    } as any;
    const res = await dealExchangeUi.request('/live-deals', {}, env);
    const body = await res.text();
    expect(body).not.toContain('not configured on this environment');
    expect(body).not.toContain('not yet publicly enabled');
  });

  it('/internal/qa-cleanup returns 404 (not merely unauthorized) outside the dedicated QA environment', async () => {
    const env = { ENVIRONMENT: 'production' } as any;
    const res = await dealExchangeUi.request('/internal/qa-cleanup', { method: 'POST' }, env);
    expect(res.status).toBe(404);
  });

  it('/internal/qa-cleanup stays unreachable even when only DEAL_EXCHANGE_DB (production) is bound, no QA vars', async () => {
    const env = {
      ENVIRONMENT: 'production',
      DEAL_EXCHANGE_DB: throwingDb('prod-cleanup-attempt'),
      DEAL_EXCHANGE_PUBLIC_ENABLED: 'false',
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
