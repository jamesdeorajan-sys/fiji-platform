// REAL Cloudflare driver. NOT EXECUTED in this package build (no Cloudflare credentials exist in this session, and the mission forbids remote execution).
// Defence in depth: every mutating call is checked against the pinned isolated names BEFORE it is made; there is no code path that accepts a name/UUID from outside.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { spawn } from 'node:child_process';
import { ISOLATED, PRODUCTION_DENYLIST } from '../src/safety.js';
import { takeSnapshot } from './snapshot.mjs';
import { assertPackageSafe } from '../scripts/assert_package_safe.mjs';

export class MutationGuardError extends Error {}
const FORBIDDEN = [...PRODUCTION_DENYLIST.names, ...PRODUCTION_DENYLIST.d1_ids];
// Every wrangler argv we can ever emit. Builders take NO identity parameters - names come from the pinned constants only.
export const CMD = Object.freeze({
  d1Schema:   () => ['d1', 'execute', ISOLATED.D1_NAME, '--remote', '--file', 'schema/gate15_d1_schema.sql'],
  d1Teardown: () => ['d1', 'execute', ISOLATED.D1_NAME, '--remote', '--file', 'schema/gate15_teardown.sql'],
  d1Marker:   () => ['d1', 'execute', ISOLATED.D1_NAME, '--remote', '--json', '--command', 'SELECT marker FROM gate15_identity'],
  d1Tables:   () => ['d1', 'execute', ISOLATED.D1_NAME, '--remote', '--json', '--command', "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"],
  secretPut:  () => ['secret', 'put', 'GATE15_CONTROL_TOKEN', '--name', ISOLATED.WORKER_NAME],          // value is piped on stdin, never in argv
  deploy:     () => ['deploy', '--name', ISOLATED.WORKER_NAME],
  rollback:   (versionId) => ['rollback', versionId, '--name', ISOLATED.WORKER_NAME, '--message', 'gate15 teardown: restore zero-binding shell', '--yes'],
});
export function assertCommandSafe(argv) {
  const joined = argv.join(' ');
  for (const bad of FORBIDDEN) if (joined.includes(bad)) throw new MutationGuardError(`command mentions a production identifier: ${bad}`);
  if (argv[0] === 'd1' && !(argv[2] === ISOLATED.D1_NAME && argv.includes('--remote'))) throw new MutationGuardError('d1 command must target the pinned isolated database with --remote');
  if (['secret', 'deploy', 'rollback'].includes(argv[0]) && argv[argv.indexOf('--name') + 1] !== ISOLATED.WORKER_NAME) throw new MutationGuardError('worker command must carry --name <pinned isolated worker>');
  if (argv[0] === 'rollback' && !/^[0-9a-f-]{8,}$|^[\w.-]+$/.test(argv[1])) throw new MutationGuardError('bad version id');
}
export function assertMutationPathSafe(method, p) {
  if (method === 'GET') return;
  if (!p.includes(`/workers/scripts/${ISOLATED.WORKER_NAME}/`)) throw new MutationGuardError(`${method} ${p} is not under the pinned isolated worker`);
  for (const bad of FORBIDDEN) if (p.includes(bad)) throw new MutationGuardError(`${method} path mentions ${bad}`);
}

export function makeCloudflareClient({ accountId, apiToken, fetchImpl = fetch }) {
  const base = 'https://api.cloudflare.com/client/v4';
  const call = async (method, p, body) => {
    assertMutationPathSafe(method, p);
    const r = await fetchImpl(base + p, { method, headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok || j.success === false) throw new Error(`${method} ${p.replace(accountId, '<acct>')} -> HTTP ${r.status}`);
    return j;
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), delete: (p) => call('DELETE', p), accountId };
}

export function realExec(cwd, wranglerBin = 'wrangler') {      // argv-only (no shell); stdin optional; env is passed through explicitly
  return (argv, { input = null, env = process.env } = {}) => new Promise((resolve) => {
    const c = spawn(wranglerBin, argv, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] }); let out = '', err = '';
    c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d)); c.on('close', (code) => resolve({ code, stdout: out, stderr: err }));
    if (input !== null) c.stdin.write(input); c.stdin.end();
  });
}

export function makeCloudflareDriver({ cf, exec, packageRoot, evidenceDir, nodeBin = process.execPath, runProofScript = null, env = process.env, loopbackBaseUrl = null }) {
  const A = `/accounts/${cf.accountId}`; const W = ISOLATED.WORKER_NAME; let token = null; let baseUrl = null;
  const wr = async (argv, opts) => { assertCommandSafe(argv); const r = await exec(argv, opts); if (r.code !== 0) throw new Error(`wrangler ${argv[0]} ${argv[1] || ''} exited ${r.code}`); return r; };
  return {
    async preflight() { const r = await assertPackageSafe(packageRoot); const problems = [...(r.failures || [])].map(String);
      for (const k of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']) if (!env[k]) problems.push(`${k} missing`);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(env.GATE15_ACCOUNT_SUBDOMAIN || '')) problems.push('GATE15_ACCOUNT_SUBDOMAIN missing (the account workers.dev subdomain; hostname is verified at runtime)');
      return { ok: problems.length === 0, problems, package_safe: r.ok }; },
    snapshot: (label) => takeSnapshot(cf, cf.accountId, label),
    async shellVersion() { const d = (await cf.get(`${A}/workers/scripts/${W}/deployments`)).result; const v = d?.deployments?.[0]?.versions?.[0]?.version_id; return v || null; },
    async lookupD1ByName() { return (await cf.get(`${A}/d1/database?name=${encodeURIComponent(ISOLATED.D1_NAME)}`)).result; },
    async lookupD1ByUuid() { return (await cf.get(`${A}/d1/database/${ISOLATED.D1_UUID}`)).result; },
    async applySchema() { await wr(CMD.d1Schema()); const m = await wr(CMD.d1Marker()); if (!m.stdout.includes(ISOLATED.MARKER)) throw new Error('identity marker not found after schema'); },
    async createControlSecret() { token = crypto.randomBytes(32).toString('hex'); await wr(CMD.secretPut(), { input: token + '\n' }); },
    async deployWorker() { await wr(CMD.deploy()); },
    async enableWorkersDev() { await cf.post(`${A}/workers/scripts/${W}/subdomain`, { enabled: true }); baseUrl = loopbackBaseUrl && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(loopbackBaseUrl) ? loopbackBaseUrl : `https://${W}.${env.GATE15_ACCOUNT_SUBDOMAIN}.workers.dev`; },   // loopbackBaseUrl is used ONLY by the local rehearsal and only if it is a loopback URL
    async runProof({ phase, races = 0, stage = 'x' }) {
      const out = path.join(evidenceDir, `proof-${phase}-${stage}.json`); const script = runProofScript || path.join(packageRoot, 'scripts', 'gate15_proof.mjs');
      const e = { ...process.env, GATE15_BASE_URL: baseUrl, GATE15_CONTROL_TOKEN: token, GATE15_TARGET: 'remote-isolated', GATE15_PHASE: phase, GATE15_RACES: String(races), GATE15_STAGE: stage, GATE15_OUT: out };
      const code = await new Promise((res) => { const c = spawn(nodeBin, ['--no-warnings', script], { env: e, stdio: 'ignore' }); c.on('close', res); });
      let j = null; try { j = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { /* no result file */ }
      return { ok: code === 0 && !!j && j.checks_failed === 0, exit_code: code, checks_failed: j?.checks_failed ?? null, checks_total: j?.checks_total ?? null, failed_checks: (j?.checks || []).filter((c) => !c.pass).map((c) => c.name).slice(0, 20), stages: j?.stages, summary: j?.summary, latency_ms: j?.latency_ms };
    },
    async captureEvidence(tag) { return { tag, taken_at: new Date().toISOString(), snapshot: await takeSnapshot(cf, cf.accountId, tag) }; },
    async disableWorkersDev() { await cf.post(`${A}/workers/scripts/${W}/subdomain`, { enabled: false }); },
    async deleteControlSecret() { await cf.delete(`${A}/workers/scripts/${W}/secrets/GATE15_CONTROL_TOKEN`); token = null; },
    async removeSchema() { await wr(CMD.d1Teardown()); const t = await wr(CMD.d1Tables()); if (!/"n":\s*0\b/.test(t.stdout)) throw new Error('user tables remain after teardown'); return { user_tables: 0 }; },
    async restoreShell(versionId) { await wr(CMD.rollback(versionId)); },
    async verifyNoScheduleRouteDomain() {
      const s = (await cf.get(`${A}/workers/scripts/${W}/schedules`)).result; const sch = (s?.schedules || s || []); const dom = (await cf.get(`${A}/workers/domains`)).result || [];
      const zs = (await cf.get('/zones?per_page=50')).result || []; const routes = []; for (const z of zs) for (const r of (await cf.get(`/zones/${z.id}/workers/routes`)).result || []) if (r.script === W) routes.push(r.pattern);
      const problems = []; if (sch.length) problems.push('schedules exist'); if (dom.some((d) => d.service === W)) problems.push('custom domain exists'); if (routes.length) problems.push(`routes: ${routes.join(',')}`);
      return { ok: problems.length === 0, problems };
    },
  };
}
