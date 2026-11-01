// Hosted acceptance orchestrator (run on a machine where `wrangler` is logged in to the Vakaviti Cloudflare account — e.g. James's PC).
//   node run_acceptance.mjs <bundleDir> <step>        steps: prepare | schema | deploy | accept | lockdown | all
// bundleDir contains: wrangler.json (generated), worker.js (bundle), schema.sql (ordered migrations), BUNDLE.json (commit + sha256).
// SECRETS: generated with crypto.randomBytes into <home>/.bula-acceptance/secrets.json (mode 0600), pushed to Cloudflare through wrangler's STDIN
// (never argv, never env echo, never printed). The phone link is written ONLY to a local file/QR PNG. Evidence output is redacted.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto'; import { spawnSync } from 'node:child_process';
const [bundle, step = 'all'] = process.argv.slice(2); if (!bundle) { console.error('usage: node run_acceptance.mjs <bundleDir> <prepare|schema|deploy|accept|lockdown|all>'); process.exit(2); }
const B = path.resolve(bundle); const META = JSON.parse(fs.readFileSync(path.join(B, 'BUNDLE.json'), 'utf8'));
const HOME = path.join(os.homedir(), '.bula-acceptance'); const SEC = path.join(HOME, 'secrets.json'); const STATE = path.join(HOME, 'state.json');
fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
const rnd = () => crypto.randomBytes(32).toString('hex');
const load = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const save = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2), { mode: 0o600 });
const wr = (args, input) => { const r = spawnSync('npx', ['--yes', 'wrangler@3', ...args], { cwd: B, input, encoding: 'utf8', shell: process.platform === 'win32' }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
function prepare() { const s = load(SEC, null) || { admin: rnd(), staff: { ceo: rnd(), ops: rnd(), approver: rnd() }, created: new Date().toISOString() }; save(SEC, s); console.log('secrets ready at', SEC, '(not printed)'); return s; }
function schema() { const r = wr(['d1', 'execute', 'bula-acceptance-synthetic-1', '--remote', '--yes', '--file', 'schema.sql', '-c', 'wrangler.json']); console.log(r.code === 0 ? 'schema applied to bula-acceptance-synthetic-1 ONLY' : 'schema FAILED\n' + r.out.slice(-1500)); if (r.code) process.exit(1); }
function deploy(flagsOff = false) {
  const s = prepare(); const p = wr(['secret', 'put', 'MARAU_ADMIN_TEST_TOKEN', '-c', 'wrangler.json'], s.admin + '\n'); if (p.code) { console.error('secret put failed\n' + p.out.slice(-800).replace(s.admin, '***')); process.exit(1); }
  const vars = [`BULA_BUILD:${META.commit.slice(0, 12)}`, `BULA_COMMIT:${META.commit}`]; if (flagsOff) for (const f of ['BULA_CHECKOUT_ENABLED', 'BULA_CREDITS_ENABLED', 'BULA_EDITION_PUBLISH_ENABLED', 'BULA_FAULT_HARNESS', 'BULA_SYNTHETIC_TEST']) vars.push(`${f}:off`);
  const d = wr(['deploy', '-c', 'wrangler.json', ...vars.flatMap((v) => ['--var', v])]); console.log(d.out.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((l) => !/token|secret/i.test(l)).slice(-12).join('\n'));
  if (d.code) process.exit(1); const m = /https:\/\/marau-bula-acceptance\.[\w-]+\.workers\.dev/.exec(d.out); const st = load(STATE, {}); st.url = m ? m[0] : st.url; st.deployed = { commit: META.commit, at: new Date().toISOString(), flagsOff }; save(STATE, st); console.log('URL', st.url);
}
async function accept() {
  const s = prepare(), st = load(STATE, {}); if (!st.url) { console.error('deploy first'); process.exit(1); }
  const r = spawnSync(process.execPath, [path.join(B, 'hosted_acceptance.mjs')], { encoding: 'utf8', env: { ...process.env, BASE: st.url, SECRETS_FILE: SEC, STATE_FILE: STATE, OUT_DIR: HOME } });
  process.stdout.write(r.stdout.split('\n').filter((l) => !/tok_|stf_|"access_token"/.test(l)).join('\n')); process.stderr.write(r.stderr.slice(-600)); console.log('evidence file:', path.join(HOME, 'evidence.json')); if (step !== 'all') process.exit(r.status || 0); return r.status || 0;
}
function phone() {
  const s = prepare(), st = load(STATE, {}); if (!st.url) { console.error('deploy first'); process.exit(1); }
  const r = spawnSync(process.execPath, [path.join(B, 'hosted_acceptance.mjs')], { encoding: 'utf8', env: { ...process.env, BASE: st.url, SECRETS_FILE: SEC, OUT_DIR: HOME, MODE: 'phone' } }); process.stdout.write(r.stdout.split('\n').filter((l) => !/tok_/.test(l)).join('\n')); if (r.status) { process.stderr.write(r.stderr.slice(-500)); process.exit(1); }
  const inst = spawnSync('npm', ['install', '--prefix', HOME, '--no-audit', '--no-fund', 'qrcode@1'], { encoding: 'utf8', shell: process.platform === 'win32' }); if (inst.status) { console.log('QR package unavailable; open phone-link.txt and send the link to your phone yourself'); return; }
  const qr = path.join(HOME, 'node_modules', 'qrcode'); const code = `const Q=require(${JSON.stringify(qr)});const fs=require('fs');const u=fs.readFileSync(${JSON.stringify(path.join(HOME, 'phone-link.txt'))},'utf8').trim();Q.toFile(${JSON.stringify(path.join(HOME, 'phone-qr.png'))},u,{width:480},e=>{if(e)process.exit(1)})`;
  const q = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' }); console.log(q.status ? 'QR failed' : 'QR image: ' + path.join(HOME, 'phone-qr.png') + '  (open it and scan with the iPhone camera; do not share it)');
}
const run = { phone, prepare, schema, deploy: () => deploy(false), accept, lockdown: () => deploy(true) };
if (step === 'all') { prepare(); schema(); deploy(false); await accept(); phone(); } else if (run[step]) await run[step](); else { console.error('unknown step'); process.exit(2); }
