// READ-ONLY Cloudflare metadata snapshot (names, ids, modified_on, bindings, schedules, secret NAMES, deployments, routes, domains).
// `cf` is { get(path) } and is the ONLY thing used - there is no write method in this module. No production D1 is queried, no secret value is read.
import { ISOLATED, PRODUCTION_DENYLIST } from '../src/safety.js';

export const PRODUCTION_WORKERS_WATCHED = Object.freeze(['nadi-dispatch-api']);       // detailed (bindings/schedules/secrets/deployments) before-vs-after comparison
const unwrap = (r) => (r && r.result !== undefined ? r.result : r);

// Required reads: if ANY fails the snapshot is not ok and (for the BEFORE snapshot) the run STOPs with no mutation.
export async function takeSnapshot(cf, accountId, label, { workers = [...PRODUCTION_WORKERS_WATCHED] } = {}) {
  const A = `/accounts/${accountId}`; const missing = []; const snap = { label, taken_at: new Date().toISOString(), workers: {}, prod_workers: {}, d1: {}, zone_routes: [], domains: [], isolated: {} };
  const req = async (name, path) => { try { return unwrap(await cf.get(path)); } catch (e) { missing.push(`${name}: ${String(e.message || e).slice(0, 120)}`); return null; } };

  const ws = await req('workers list', `${A}/workers/scripts`);
  for (const w of ws || []) snap.workers[w.id] = { modified_on: w.modified_on, etag: w.etag, created_on: w.created_on };
  const d1 = await req('d1 list', `${A}/d1/database?per_page=100`);
  for (const d of d1 || []) snap.d1[d.name] = { uuid: d.uuid, created_at: d.created_at, version: d.version };       // file_size/num_tables deliberately omitted: live NAT traffic changes them
  const domains = await req('worker domains', `${A}/workers/domains`);
  snap.domains = (domains || []).map((d) => ({ hostname: d.hostname, service: d.service, environment: d.environment })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const zones = await req('zones', `/zones?per_page=50`);
  for (const z of zones || []) {
    const routes = await req(`routes ${z.name}`, `/zones/${z.id}/workers/routes`);
    for (const r of routes || []) snap.zone_routes.push({ zone: z.name, pattern: r.pattern, script: r.script || null });
  }
  snap.zone_routes.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  for (const name of workers) {
    const settings = await req(`${name} settings`, `${A}/workers/scripts/${name}/settings`);
    const sched = await req(`${name} schedules`, `${A}/workers/scripts/${name}/schedules`);
    const secrets = await req(`${name} secrets`, `${A}/workers/scripts/${name}/secrets`);
    const deps = await req(`${name} deployments`, `${A}/workers/scripts/${name}/deployments`);
    snap.prod_workers[name] = {
      bindings: (settings?.bindings || []).map((b) => ({ name: b.name, type: b.type })).sort((a, b) => a.name.localeCompare(b.name)),
      schedules: (sched?.schedules || sched || []).map((s) => s.cron).sort(),
      secrets: (Array.isArray(secrets) ? secrets : []).map((s) => s.name).sort(),
      deployments: (deps?.deployments || deps || []).map((d) => ({ id: d.id, created_on: d.created_on })),
    };
  }
  // isolated resources
  const iw = ISOLATED.WORKER_NAME;
  const iSettings = await req('isolated worker settings', `${A}/workers/scripts/${iw}/settings`);
  const iSub = await req('isolated worker subdomain', `${A}/workers/scripts/${iw}/subdomain`);
  const iSched = await req('isolated worker schedules', `${A}/workers/scripts/${iw}/schedules`);
  const iSecrets = await req('isolated worker secrets', `${A}/workers/scripts/${iw}/secrets`);
  const iD1 = await req('isolated d1 by pinned uuid', `${A}/d1/database/${ISOLATED.D1_UUID}`);
  snap.isolated = {
    worker: iw, bindings: (iSettings?.bindings || []).map((b) => ({ name: b.name, type: b.type })).sort((a, b) => a.name.localeCompare(b.name)),
    workers_dev_enabled: !!iSub?.enabled, schedules: (iSched?.schedules || iSched || []).map((s) => s.cron).sort(),
    secrets: (Array.isArray(iSecrets) ? iSecrets : []).map((s) => s.name).sort(),
    d1: iD1 ? { name: iD1.name, uuid: iD1.uuid } : null,
  };
  if (!snap.workers[iw]) missing.push(`isolated worker ${iw} not present in the account worker list`);
  if (!snap.d1[ISOLATED.D1_NAME]) missing.push(`isolated D1 ${ISOLATED.D1_NAME} not present in the account D1 list`);
  for (const bad of PRODUCTION_DENYLIST.names) if (snap.isolated.d1?.name === bad) missing.push('isolated d1 resolved to a production name');
  snap.ok = missing.length === 0; snap.missing = missing; return snap;
}
