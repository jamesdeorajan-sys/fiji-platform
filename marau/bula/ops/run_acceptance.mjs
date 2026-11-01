// Hosted acceptance orchestrator for the ISOLATED synthetic candidate (Worker marau-bula-acceptance + D1 6c54341a-…). Run where `wrangler` is logged in (James's PC).
//   node run_acceptance.mjs <bundleDir> <step>      steps: verify | prepare | schema | deploy | accept | phone | lockdown | all
// Safety: NOTHING touches Cloudflare until (1) every bundle file matches BUNDLE.json sha256 and (2) the generated wrangler.json is proven to target ONLY the
// acceptance Worker + database (allowlisted keys; no routes/zones/custom domains/other bindings; email sending off). Any subprocess launch error, signal
// interruption, missing exit code or non-zero exit is a FAILURE. `all` exits non-zero on any failure and creates the phone QR only after acceptance passed.
// Secrets: crypto.randomBytes into ~/.bula-acceptance/secrets.json (0600); given to wrangler on STDIN only; never printed.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto'; import { spawnSync } from 'node:child_process'; import { pathToFileURL } from 'node:url';

export const TARGET = Object.freeze({ worker: 'marau-bula-acceptance', dbName: 'bula-acceptance-synthetic-1', dbId: '6c54341a-6c21-4314-b514-bb44ed5fa1b5', account: '595101df2c562b3c65595420d43f9fe1' });
const HASHED = ['worker.js', 'schema.sql', 'wrangler.json', 'hosted_acceptance.mjs'];
const TOP_KEYS = new Set(['name', 'main', 'compatibility_date', 'account_id', 'workers_dev', 'd1_databases', 'triggers', 'vars']);
const FLAG_VARS = new Set(['BULA_SYNTHETIC_TEST', 'BULA_CHECKOUT_ENABLED', 'BULA_CREDITS_ENABLED', 'BULA_EDITION_PUBLISH_ENABLED', 'BULA_FAULT_HARNESS', 'BULA_OUTBOX_ENABLED', 'BULA_EMAIL_SEND_ENABLED']);
const OTHER_VARS = new Set(['BULA_POLICY_VERSION', 'BULA_BUILD', 'BULA_COMMIT']);
const OFF = (v) => v === 'off';

export class Fail extends Error { constructor(msg) { super(msg); this.name = 'Fail'; } }
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** (1)+(2): returns the validated {meta, config} or throws Fail. Never spawns anything. */
export function verifyBundle(B) {
  let meta; try { meta = JSON.parse(fs.readFileSync(path.join(B, 'BUNDLE.json'), 'utf8')); } catch (e) { throw new Fail('BUNDLE.json missing or unreadable'); }
  if (!/^[0-9a-f]{40}$/.test(meta.commit || '')) throw new Fail('BUNDLE.json has no valid commit');
  for (const f of HASHED) { const want = meta.sha256 && meta.sha256[f]; if (!want) throw new Fail(`BUNDLE.json has no hash for ${f}`); let got; try { got = sha(path.join(B, f)); } catch { throw new Fail(`bundle file missing: ${f}`); } if (got !== want) throw new Fail(`hash mismatch: ${f}`); }
  let c; try { c = JSON.parse(fs.readFileSync(path.join(B, 'wrangler.json'), 'utf8')); } catch { throw new Fail('wrangler.json is not valid JSON'); }
  for (const k of Object.keys(c)) if (!TOP_KEYS.has(k)) throw new Fail(`wrangler.json has a disallowed key "${k}" (routes, zones, services and other bindings are not permitted)`);
  if (c.name !== TARGET.worker) throw new Fail(`Worker name must be ${TARGET.worker}`);
  if (c.account_id !== TARGET.account) throw new Fail('account_id is not the expected Vakaviti account');
  if (c.main !== 'worker.js') throw new Fail('main must be the bundled worker.js');
  if (c.workers_dev !== true) throw new Fail('workers_dev must be true (workers.dev only)');
  const d = c.d1_databases; if (!Array.isArray(d) || d.length !== 1 || d[0].binding !== 'DB' || d[0].database_id !== TARGET.dbId || d[0].database_name !== TARGET.dbName || Object.keys(d[0]).some((k) => !['binding', 'database_id', 'database_name'].includes(k))) throw new Fail(`exactly one D1 binding to ${TARGET.dbName} (${TARGET.dbId}) is required`);
  const cr = c.triggers; if (!cr || Object.keys(cr).join() !== 'crons' || JSON.stringify(cr.crons) !== JSON.stringify(['0 6 * * *', '*/15 * * * *'])) throw new Fail('triggers must be exactly the two expected crons and nothing else');
  const v = c.vars || {}; for (const [k, val] of Object.entries(v)) { if (!FLAG_VARS.has(k) && !OTHER_VARS.has(k)) throw new Fail(`unexpected var ${k}`); if (typeof val !== 'string') throw new Fail(`var ${k} must be a string`); if (/(secret|token|key|password)/i.test(k)) throw new Fail(`var ${k} looks like a secret`); }
  if (!OFF(v.BULA_EMAIL_SEND_ENABLED)) throw new Fail('BULA_EMAIL_SEND_ENABLED must be "off"'); if (!OFF(v.BULA_OUTBOX_ENABLED)) throw new Fail('BULA_OUTBOX_ENABLED must be "off"');
  return { meta, config: c };
}

/** Every subprocess goes through here: launch error / signal / missing code / non-zero => ok:false with a reason. */
export function runProc(spawn, cmd, args, opts = {}) {
  let r; try { r = spawn(cmd, args, { encoding: 'utf8', ...opts }); } catch (e) { return { ok: false, reason: `launch error: ${e && e.message}`, out: '' }; }
  const out = ((r && r.stdout) || '') + ((r && r.stderr) || '');
  if (!r) return { ok: false, reason: 'no result from subprocess', out };
  if (r.error) return { ok: false, reason: `launch error: ${r.error.code || r.error.message}`, out };
  if (r.signal) return { ok: false, reason: `interrupted by ${r.signal}`, out };
  if (typeof r.status !== 'number') return { ok: false, reason: 'no exit code', out };
  if (r.status !== 0) return { ok: false, reason: `exit code ${r.status}`, out, code: r.status };
  return { ok: true, out, code: 0 };
}

export function makeRunner({ B, home = path.join(os.homedir(), '.bula-acceptance'), spawn = spawnSync, log = console.log, err = console.error, win = process.platform === 'win32', node = process.execPath } = {}) {
  const SEC = path.join(home, 'secrets.json'), STATE = path.join(home, 'state.json'), EVID = path.join(home, 'evidence.json');
  const rnd = () => crypto.randomBytes(32).toString('hex');
  const load = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const save = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2), { mode: 0o600 });
  const wr = (args, input) => runProc(spawn, 'npx', ['--yes', 'wrangler@3', ...args], { cwd: B, input, shell: win });
  let verified = null;
  const need = () => { if (!verified) throw new Fail('bundle not verified'); return verified; };
  const R = {
    verify() { verified = verifyBundle(B); log(`bundle verified: commit ${verified.meta.commit} — targets only ${TARGET.worker} / ${TARGET.dbName}; email sending off; no routes`); },
    prepare() { need(); fs.mkdirSync(home, { recursive: true, mode: 0o700 }); const s = load(SEC, null) || { admin: rnd(), staff: { ceo: rnd(), ops: rnd(), approver: rnd() }, created: new Date().toISOString() }; save(SEC, s); log('secrets ready (not printed):', SEC); return s; },
    schema() { need(); const r = wr(['d1', 'execute', TARGET.dbName, '--remote', '--yes', '--file', 'schema.sql', '-c', 'wrangler.json']); if (!r.ok) throw new Fail(`schema step failed (${r.reason})\n${r.out.slice(-1200)}`); log(`schema applied to ${TARGET.dbName} ONLY`); },
    deploy(flagsOff = false) {
      const { meta } = need(); const s = R.prepare(); const p = wr(['secret', 'put', 'MARAU_ADMIN_TEST_TOKEN', '-c', 'wrangler.json'], s.admin + '\n'); if (!p.ok) throw new Fail(`secret put failed (${p.reason})\n${p.out.slice(-600).split(s.admin).join('***')}`);
      const vars = [`BULA_BUILD:${meta.commit.slice(0, 12)}`, `BULA_COMMIT:${meta.commit}`]; if (flagsOff) for (const f of ['BULA_CHECKOUT_ENABLED', 'BULA_CREDITS_ENABLED', 'BULA_EDITION_PUBLISH_ENABLED', 'BULA_FAULT_HARNESS', 'BULA_SYNTHETIC_TEST']) vars.push(`${f}:off`);
      const d = wr(['deploy', '-c', 'wrangler.json', ...vars.flatMap((x) => ['--var', x])]); if (!d.ok) throw new Fail(`deploy failed (${d.reason})\n${d.out.slice(-800).split(s.admin).join('***')}`);
      const m = /https:\/\/marau-bula-acceptance\.[\w-]+\.workers\.dev/.exec(d.out); if (!m) throw new Fail('deploy output did not contain the workers.dev URL'); const st = load(STATE, {}); st.url = m[0]; st.deployed = { commit: meta.commit, at: new Date().toISOString(), flagsOff }; save(STATE, st); log('URL', st.url);
    },
    /** runs the hosted checks; passes only if exit 0 AND a fresh evidence file for THIS commit shows zero failures. */
    accept() {
      const { meta } = need(); const s = R.prepare(); const st = load(STATE, {}); if (!st.url) throw new Fail('deploy first'); const startedAt = Date.now();
      if (fs.existsSync(EVID)) fs.renameSync(EVID, `${EVID}.stale-${startedAt}`);               // never leave stale evidence that could be mistaken for this run (kept, not deleted)
      const r = runProc(spawn, node, [path.join(B, 'hosted_acceptance.mjs')], { env: { ...process.env, BASE: st.url, SECRETS_FILE: SEC, STATE_FILE: STATE, OUT_DIR: home } });
      log((r.out || '').split('\n').filter((l) => !/tok_|stf_|"access_token"/.test(l)).join('\n').split(s.admin).join('***'));
      if (!r.ok) throw new Fail(`hosted acceptance FAILED (${r.reason})`);
      const ev = load(EVID, null); if (!ev || !Array.isArray(ev.results) || !ev.results.length) throw new Fail('hosted acceptance wrote no evidence');
      if (ev.failed !== 0 || ev.results.some((x) => !x.pass)) throw new Fail(`hosted acceptance reported ${ev.failed} failing check(s)`);
      if (ev.commit !== meta.commit && ev.commit !== meta.commit.slice(0, 12)) throw new Fail(`evidence is for commit ${ev.commit}, bundle is ${meta.commit}`);
      log(`hosted acceptance PASSED: ${ev.results.length}/${ev.results.length}; evidence: ${EVID}`); return ev;
    },
    phone() {
      need(); const ev = load(EVID, null); const { meta } = need(); if (!ev || ev.failed !== 0 || !ev.results || !ev.results.length || (ev.commit !== meta.commit && ev.commit !== meta.commit.slice(0, 12))) throw new Fail('refusing to create a phone link: no passing hosted-acceptance evidence for this bundle');
      const st = load(STATE, {}); if (!st.url) throw new Fail('deploy first');
      for (const f of ['phone-link.txt', 'phone-qr.png']) { const p = path.join(home, f); if (fs.existsSync(p)) fs.renameSync(p, `${p}.stale-${Date.now()}`); }
      const r = runProc(spawn, node, [path.join(B, 'hosted_acceptance.mjs')], { env: { ...process.env, BASE: st.url, SECRETS_FILE: SEC, OUT_DIR: home, MODE: 'phone' } }); log((r.out || '').split('\n').filter((l) => !/tok_/.test(l)).join('\n')); if (!r.ok) throw new Fail(`phone setup failed (${r.reason})`);
      if (!fs.existsSync(path.join(home, 'phone-link.txt'))) throw new Fail('phone setup produced no link');
      const inst = runProc(spawn, 'npm', ['install', '--prefix', home, '--no-audit', '--no-fund', 'qrcode@1'], { shell: win }); if (!inst.ok) throw new Fail(`QR package install failed (${inst.reason}); the link is in ${path.join(home, 'phone-link.txt')} (local only)`);
      const qr = path.join(home, 'node_modules', 'qrcode'); const code = `const Q=require(${JSON.stringify(qr)});const fs=require('fs');const u=fs.readFileSync(${JSON.stringify(path.join(home, 'phone-link.txt'))},'utf8').trim();Q.toFile(${JSON.stringify(path.join(home, 'phone-qr.png'))},u,{width:480},e=>{if(e)process.exit(1)})`;
      const q = runProc(spawn, node, ['-e', code]); if (!q.ok || !fs.existsSync(path.join(home, 'phone-qr.png'))) throw new Fail(`QR generation failed (${q.reason || 'no file'})`); log('QR image:', path.join(home, 'phone-qr.png'), '(scan with the iPhone camera; do not share it)');
    },
  };
  return R;
}

/** Returns the process exit code (0 only on full success). */
export async function main(argv, deps = {}) {
  const [bundle, step = 'all'] = argv; const err = deps.err || console.error;
  if (!bundle) { err('usage: node run_acceptance.mjs <bundleDir> <verify|prepare|schema|deploy|accept|phone|lockdown|all>'); return 2; }
  const R = makeRunner({ B: path.resolve(bundle), ...deps });
  try {
    R.verify();                                                    // BEFORE anything else, for every step
    if (step === 'verify') return 0;
    if (step === 'all') { R.prepare(); R.schema(); R.deploy(false); R.accept(); R.phone(); return 0; }
    const one = { prepare: R.prepare, schema: R.schema, deploy: () => R.deploy(false), accept: R.accept, phone: R.phone, lockdown: () => R.deploy(true) }[step];
    if (!one) { err('unknown step'); return 2; } one(); return 0;
  } catch (e) { err(e instanceof Fail ? `STOPPED: ${e.message}` : `STOPPED (unexpected): ${e && e.message}`); return 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { process.exit(await main(process.argv.slice(2))); }
