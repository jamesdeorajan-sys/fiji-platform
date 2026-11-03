// In-memory model of the Cloudflare account surface the orchestrator touches. Used by unit tests and the local rehearsal. Records every call.
import { ISOLATED } from '../src/safety.js';
const PROD = { worker: 'nadi-dispatch-api', d1: 'nadi-marketplace-db', d1uuid: '0ec1cd84-fcda-4f7f-8337-0fb70fe1a512' };
export function makeFakeCloud({ failGet = null, d1Override = null } = {}) {
  const S = {
    workers: { 'nadi-dispatch-api': { id: 'nadi-dispatch-api', modified_on: '2026-10-30T01:00:00Z', etag: 'e1' }, 'fiji-chat-widget': { id: 'fiji-chat-widget', modified_on: '2026-10-01T00:00:00Z', etag: 'e2' }, [ISOLATED.WORKER_NAME]: { id: ISOLATED.WORKER_NAME, modified_on: '2026-11-03T00:00:00Z', etag: 'iso0' } },
    d1: [{ name: PROD.d1, uuid: PROD.d1uuid, created_at: '2026-01-01', version: 'production' }, { name: ISOLATED.D1_NAME, uuid: ISOLATED.D1_UUID, created_at: '2026-11-03', version: 'production' }],
    prod: { bindings: [{ name: 'DB', type: 'd1' }], schedules: ['*/5 * * * *'], secrets: ['API_KEY'], deployments: [{ id: 'd1', created_on: '2026-10-30' }] },
    iso: { bindings: [], workers_dev: false, schedules: [], secrets: [], deployments: [{ id: 'shell-dep', versions: [{ version_id: 'shell-v1' }] }], schema: false },
    routes: [{ pattern: 'nadiairporttransfers.com/*', script: 'nadi-dispatch-api' }], domains: [{ hostname: 'api.example.test', service: 'nadi-dispatch-api', environment: 'production' }],
  };
  if (d1Override) S.d1 = S.d1.map((d) => (d.name === ISOLATED.D1_NAME ? { ...d, ...d1Override } : d));
  const calls = [];
  const isoBase = `/workers/scripts/${ISOLATED.WORKER_NAME}`;
  const cf = {
    calls, S,
    async get(p) {
      calls.push(['GET', p]); if (failGet && p.includes(failGet)) throw new Error(`simulated API failure for ${failGet}`);
      if (p.endsWith('/workers/scripts')) return { result: Object.values(S.workers) };
      if (p.includes('/d1/database?')) { const m = p.match(/[?&]name=([^&]+)/); return { result: m ? S.d1.filter((d) => d.name === decodeURIComponent(m[1])) : S.d1 }; }
      if (/\/d1\/database\/[0-9a-f-]{36}$/.test(p)) { const id = p.split('/').pop(); const d = S.d1.find((x) => x.uuid === id); if (!d) throw new Error('404 d1'); return { result: d }; }
      if (p.endsWith('/workers/domains')) return { result: S.domains };
      if (p === '/zones?per_page=50') return { result: [{ id: 'z1', name: 'nadiairporttransfers.com' }] };
      if (p === '/zones/z1/workers/routes') return { result: S.routes };
      let m = p.match(/\/workers\/scripts\/([^/]+)\/(settings|schedules|secrets|deployments|subdomain)$/);
      if (m) { const [, w, what] = m; const o = w === ISOLATED.WORKER_NAME ? S.iso : S.prod;
        if (what === 'settings') return { result: { bindings: o.bindings } }; if (what === 'schedules') return { result: { schedules: o.schedules.map((c) => ({ cron: c })) } };
        if (what === 'secrets') return { result: o.secrets.map((n) => ({ name: n })) }; if (what === 'deployments') return { result: { deployments: o.deployments } };
        if (what === 'subdomain') return { result: { enabled: !!o.workers_dev } }; }
      throw new Error(`fake cloud: unmocked GET ${p}`);
    },
    async post(p, body) { calls.push(['POST', p, body]); if (p.endsWith(`${isoBase}/subdomain`)) { S.iso.workers_dev = !!body.enabled; return { result: { enabled: S.iso.workers_dev } }; } throw new Error(`fake cloud: unmocked POST ${p}`); },
    async delete(p) { calls.push(['DELETE', p]); if (p.endsWith(`${isoBase}/secrets/GATE15_CONTROL_TOKEN`)) { S.iso.secrets = S.iso.secrets.filter((x) => x !== 'GATE15_CONTROL_TOKEN'); return { result: null }; } throw new Error(`fake cloud: unmocked DELETE ${p}`); },
  };
  // isolated-resource effects of wrangler commands (the fake exec/rehearsal driver calls these)
  cf.effects = {
    schema() { S.iso.schema = true; }, removeSchema() { S.iso.schema = false; },
    secret() { if (!S.iso.secrets.includes('GATE15_CONTROL_TOKEN')) S.iso.secrets.push('GATE15_CONTROL_TOKEN'); },
    deploy() { S.iso.bindings = [{ name: 'DB', type: 'd1' }]; S.workers[ISOLATED.WORKER_NAME] = { ...S.workers[ISOLATED.WORKER_NAME], modified_on: 'deployed', etag: 'iso1' }; S.iso.deployments.unshift({ id: 'dep2', versions: [{ version_id: 'impl-v2' }] }); },
    rollback(v) { if (v !== 'shell-v1') throw new Error('rollback to unknown version'); S.iso.bindings = []; S.workers[ISOLATED.WORKER_NAME] = { ...S.workers[ISOLATED.WORKER_NAME], modified_on: 'rolled', etag: 'iso2' }; S.iso.deployments.unshift({ id: 'dep3', versions: [{ version_id: v }] }); },
    touchProduction(kind) { if (kind === 'worker') S.workers['nadi-dispatch-api'].etag = 'CHANGED'; if (kind === 'route') S.routes.push({ pattern: 'fijidash.test/*', script: 'nadi-dispatch-api' }); if (kind === 'secret') S.prod.secrets.push('NEW_SECRET'); if (kind === 'schedule') S.prod.schedules.push('0 * * * *'); if (kind === 'd1') S.d1[0].version = 'x'; },
  };
  return cf;
}
