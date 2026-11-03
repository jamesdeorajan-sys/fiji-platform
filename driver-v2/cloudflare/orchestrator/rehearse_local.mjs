// LOCAL rehearsal of the full staged orchestration: the REAL orchestrator + REAL Cloudflare driver logic, with
//   * the Cloudflare API replaced by the in-memory fake cloud, and
//   * every `wrangler ... --remote` command translated to its LOCAL equivalent (workerd + local SQLite D1 on 127.0.0.1).
// Nothing here can reach Cloudflare. Scenarios:  happy | inject-B (corrupts the local DB after stage A so stage B's checkpoint must fail; stage C must be skipped and cleanup must run)
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn, execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { runStagedProof } from './orchestrator.mjs'; import { makeFakeCloud } from './fake_cloud.mjs'; import { makeCloudflareDriver } from './cloudflare_driver.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)); const PKG = path.join(here, '..'); const scenario = process.argv[2] || 'happy'; const port = Number(process.env.GATE15_LOCAL_PORT || 8793);
for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) delete process.env[k];
Object.assign(process.env, { WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' });
const WR = process.env.WRANGLER_BIN || 'npx'; const WR_PRE = process.env.WRANGLER_BIN ? [] : ['--yes', 'wrangler@4.156.2'];
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'g15-rehearsal-')); const outDir = path.join(PKG, '..', 'evidence', 'gate15', `rehearsal-${scenario}`);
fs.rmSync(outDir, { recursive: true, force: true });
const cloud = makeFakeCloud(); let dev = null, token = null; const localLog = [];
const wl = (args) => { const out = execFileSync(WR, [...WR_PRE, ...args], { cwd: PKG, env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return out; };
const exec = async (argv, { input } = {}) => {
  localLog.push(argv.slice(0, 2).join(' '));
  try {
    if (argv[0] === 'd1') {   // translate the pinned REMOTE command to the local DB (the binding name, not the remote id)
      const rest = argv.slice(3).filter((a) => a !== '--remote'); const out = wl(['d1', 'execute', 'DB', '--local', '--persist-to', work, ...rest]);
      if (argv.includes('gate15_d1_schema.sql')) cloud.effects.schema(); if (argv.includes('gate15_teardown.sql')) cloud.effects.removeSchema(); return { code: 0, stdout: out, stderr: '' };
    }
    if (argv[0] === 'secret') { token = input.trim(); cloud.effects.secret(); return { code: 0, stdout: '', stderr: '' }; }
    if (argv[0] === 'deploy') {
      dev = spawn(WR, [...WR_PRE, 'dev', '--local', '--persist-to', work, '--port', String(port), '--ip', '127.0.0.1', '--var', `GATE15_CONTROL_TOKEN:${token}`], { cwd: PKG, env: process.env, stdio: ['ignore', fs.openSync(path.join(work, 'dev.log'), 'a'), 'inherit'] });
      for (let i = 0; i < 90; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/healthz`); if (r.ok) break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 1000)); }
      cloud.effects.deploy(); return { code: 0, stdout: '', stderr: '' };
    }
    if (argv[0] === 'rollback') { if (dev) { dev.kill('SIGTERM'); dev = null; } cloud.effects.rollback(argv[1]); return { code: 0, stdout: '', stderr: '' }; }
  } catch (e) { return { code: 1, stdout: '', stderr: String(e.message).slice(0, 300) }; }
  return { code: 1, stdout: '', stderr: 'unmapped' };
};
const cf = { accountId: 'rehearsal-acct', get: (p) => cloud.get(p), post: (p, b) => cloud.post(p, b), delete: (p) => cloud.delete(p) };
const driver = makeCloudflareDriver({ cf, exec, packageRoot: PKG, evidenceDir: fs.mkdirSync(outDir, { recursive: true }) || outDir, env: { CLOUDFLARE_ACCOUNT_ID: 'rehearsal', CLOUDFLARE_API_TOKEN: 'none', GATE15_ACCOUNT_SUBDOMAIN: 'rehearsal' }, loopbackBaseUrl: `http://127.0.0.1:${port}` });
const realRun = driver.runProof.bind(driver); let injected = false;
driver.runProof = async (o) => {
  if (scenario === 'inject-B' && o.stage === 'B' && !injected) { injected = true;   // external corruption (NOT done by the package): a non-synthetic booking appears in the isolated DB
    wl(['d1', 'execute', 'DB', '--local', '--persist-to', work, '--command', "INSERT INTO bookings (id, booking_ref, pickup_zone, destination_zone, vehicle_type, quoted_currency, quoted_amount, payment_method, status) VALUES (4242,'REAL-LOOKING-4242','NAN','DEN','sedan','FJD',1,'cash','pending')"]); localLog.push('INJECTED non-synthetic booking before stage B'); }
  return realRun(o);
};
const t0 = Date.now();
try {
  const v = await runStagedProof(driver, { outDir, env: {}, log: (m) => console.log(m) });
  const summary = { scenario, verdict: v.verdict, reason: v.reason, duration_s: Math.round((Date.now() - t0) / 1000), stages: v.stages, teardown_order: v.teardown?.order, teardown_all_ok: v.teardown?.all_ok, production_untouched: v.diff?.production_untouched, diff_clean: v.diff?.clean, injected, local_commands: localLog, steps: v.steps.map((s) => `${s.status} ${s.name}`) };
  fs.writeFileSync(path.join(outDir, 'REHEARSAL-SUMMARY.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ scenario, verdict: v.verdict, reason: v.reason, duration_s: summary.duration_s }));
  const expected = scenario === 'happy' ? 'PASS' : 'FAILED/HOLD'; process.exitCode = v.verdict === expected ? 0 : 1;
} finally { if (dev) dev.kill('SIGTERM'); fs.rmSync(work, { recursive: true, force: true }); }
