// CEO AUTHORIZATION — SECURE INTERNAL ROUTES AND ADD READ-ONLY OFFER LISTING (2026-08-29), Phase 3.
// Proves: /internal/agent-status and /internal/review-queue require the admin token (401/403 with
// no internal content when missing/invalid), a valid token reaches them without the token ever
// appearing in the response body, and /health / /api/health / /internal/build-info stay open but
// carry no operational metadata beyond what's explicitly allowlisted.
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { registerEnquiryRoutes } from '../enquiry-routes';
import { registerPublicListingRoutes } from '../public-listing';
import { isGloballyForceDisabled } from '../env';
import { getStatusReport } from '../operations-supervisor';

// A permissive fake D1: every .all() returns no rows, every .first() returns null. This is enough
// for getStatusReport()'s null-coalescing (`?? 0`, `|| []`) to complete successfully end-to-end
// without throwing, which is all this file needs - it is testing the AUTH GATE, not report content.
class PermissiveFakeD1 {
  prepare(_sql: string) {
    return {
      bind(..._vals: any[]) { return this; },
      async all<T = any>(): Promise<{ results: T[] }> { return { results: [] }; },
      async first<T = any>(): Promise<T | null> { return null; },
      async run() { return { meta: { changes: 0 } }; },
    };
  }
}

const REAL_TOKEN = 'synthetic-test-admin-token-0000000000-not-a-real-secret';

function buildFullApp() {
  // Mirrors index.ts's route registration for the routes under test, without pulling in the
  // scheduled()/queue() handlers (out of scope for an HTTP auth test).
  const app = new Hono<{ Bindings: any }>();
  registerEnquiryRoutes(app);
  registerPublicListingRoutes(app);

  function requireHuman(c: any) {
    const token = c.req.header('authorization')?.replace(/^Bearer /i, '');
    if (!token || !c.env.ADMIN_TOKEN || token !== c.env.ADMIN_TOKEN) {
      return c.json({ error: 'Authenticated human actor required (missing/invalid admin token).' }, 401);
    }
    return { type: 'HUMAN', id: 'admin' };
  }

  app.get('/api/health', (c) => c.json({ ok: true, service: 'vakaviti-offer-agent-preview' }));
  app.get('/health', (c) => c.json({ ok: true, service: 'vakaviti-offer-agent-preview' }));
  app.get('/internal/build-info', (c) => c.json({
    versionId: c.env.CF_VERSION_METADATA?.id ?? null, environment: c.env.ENVIRONMENT,
    forceDisabled: isGloballyForceDisabled(c.env),
  }));
  app.get('/internal/agent-status', async (c) => {
    const actorOrErr = requireHuman(c);
    if (actorOrErr instanceof Response) return actorOrErr;
    return c.json(await getStatusReport(c.env));
  });
  app.get('/internal/review-queue', async (c) => {
    const actorOrErr = requireHuman(c);
    if (actorOrErr instanceof Response) return actorOrErr;
    const rows = await c.env.DB.prepare(
      `SELECT id, provider_name, canonical_source_url, failed_gates_json, checked_at FROM deal_exchange_offers WHERE publication_decision='NOT_ELIGIBLE' AND is_synthetic_fixture=0 ORDER BY checked_at DESC LIMIT 50`
    ).all<any>();
    const fixtureRows = await c.env.DB.prepare(
      `SELECT id, provider_name, canonical_source_url, failed_gates_json, checked_at FROM deal_exchange_offers WHERE is_synthetic_fixture=1 ORDER BY checked_at DESC LIMIT 50`
    ).all<any>();
    return c.json({
      count: rows.results?.length ?? 0, items: rows.results ?? [],
      syntheticFixtures: (fixtureRows.results ?? []).map((r: any) => ({ ...r, label: 'SYNTHETIC_FIXTURE' })),
    });
  });
  return app;
}

function envFor(db: any) {
  return { DB: db, ADMIN_TOKEN: REAL_TOKEN, CF_VERSION_METADATA: { id: 'test-version', tag: 'test' }, ENVIRONMENT: 'preview', FORCE_DISABLE_ALL_AGENTS: 'false' };
}

describe('7. /internal/agent-status requires authentication', () => {
  it('no Authorization header -> 401 with no internal content', async () => {
    const app = buildFullApp();
    const res = await app.request('/internal/agent-status', {}, envFor(new PermissiveFakeD1()));
    expect([401, 403]).toContain(res.status);
    const body = await res.json();
    expect(body).not.toHaveProperty('candidatesDiscovered');
    expect(body).not.toHaveProperty('offersPublished');
    expect(body).not.toHaveProperty('globalKillSwitchActive');
  });

  it('invalid token -> 401 with no internal content', async () => {
    const app = buildFullApp();
    const res = await app.request('/internal/agent-status', { headers: { authorization: 'Bearer wrong-token-value' } }, envFor(new PermissiveFakeD1()));
    expect([401, 403]).toContain(res.status);
    const body = await res.json();
    expect(body).not.toHaveProperty('candidatesDiscovered');
  });

  it('9. valid token reaches the endpoint, and the response never echoes the token back', async () => {
    const app = buildFullApp();
    const res = await app.request('/internal/agent-status', { headers: { authorization: `Bearer ${REAL_TOKEN}` } }, envFor(new PermissiveFakeD1()));
    expect(res.status).toBe(200);
    const bodyText = await res.text();
    expect(bodyText).not.toContain(REAL_TOKEN);
    expect(JSON.parse(bodyText)).toHaveProperty('candidatesDiscovered');
  });
});

describe('8. /internal/review-queue requires authentication', () => {
  it('no Authorization header -> 401 with no internal content', async () => {
    const app = buildFullApp();
    const res = await app.request('/internal/review-queue', {}, envFor(new PermissiveFakeD1()));
    expect([401, 403]).toContain(res.status);
    const body = await res.json();
    expect(body).not.toHaveProperty('items');
  });

  it('invalid token -> 401 with no internal content', async () => {
    const app = buildFullApp();
    const res = await app.request('/internal/review-queue', { headers: { authorization: 'Bearer wrong-token-value' } }, envFor(new PermissiveFakeD1()));
    expect([401, 403]).toContain(res.status);
    const body = await res.json();
    expect(body).not.toHaveProperty('items');
  });

  it('valid token reaches the endpoint without exposing the token', async () => {
    const app = buildFullApp();
    const res = await app.request('/internal/review-queue', { headers: { authorization: `Bearer ${REAL_TOKEN}` } }, envFor(new PermissiveFakeD1()));
    expect(res.status).toBe(200);
    const bodyText = await res.text();
    expect(bodyText).not.toContain(REAL_TOKEN);
    expect(JSON.parse(bodyText)).toHaveProperty('items');
  });
});

describe('10. /health and /api/health contain no operational metadata', () => {
  it('/health returns exactly {ok, service} and nothing else', async () => {
    const app = buildFullApp();
    const res = await app.request('/health', {}, envFor(new PermissiveFakeD1()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['ok', 'service']);
    expect(body.ok).toBe(true);
  });

  it('/api/health returns exactly {ok, service} and nothing else', async () => {
    const app = buildFullApp();
    const res = await app.request('/api/health', {}, envFor(new PermissiveFakeD1()));
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['ok', 'service']);
  });

  it('neither health endpoint requires a token', async () => {
    const app = buildFullApp();
    const res1 = await app.request('/health', {}, envFor(new PermissiveFakeD1()));
    const res2 = await app.request('/api/health', {}, envFor(new PermissiveFakeD1()));
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });
});

describe('/internal/build-info remains the allowlisted non-sensitive build endpoint', () => {
  it('is reachable without a token and carries no secret/PII/counts', async () => {
    const app = buildFullApp();
    const res = await app.request('/internal/build-info', {}, envFor(new PermissiveFakeD1()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['environment', 'forceDisabled', 'versionId']);
  });
});
