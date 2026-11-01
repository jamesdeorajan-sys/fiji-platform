// Hosted acceptance orchestrator for the ISOLATED synthetic candidate (Worker marau-bula-acceptance + D1 6c54341a-…). Run where `wrangler` is logged in (James's PC).
//   node run_acceptance.mjs <bundleDir> <step>      steps: verify | diagnose | prepare | schema | migrate | pair | deploy | accept | phone | lockdown | resume | all
// Safety: NOTHING touches Cloudflare until (1) every bundle file matches BUNDLE.json sha256 and (2) the generated wrangler.json is proven to target ONLY the
// acceptance Worker + database (allowlisted keys; no routes/zones/custom domains/other bindings; email sending off). Any subprocess launch error, signal
// interruption, missing exit code or non-zero exit is a FAILURE. `all` exits non-zero on any failure and creates the phone QR only after acceptance passed.
// Secrets: crypto.randomBytes into ~/.bula-acceptance/secrets.json (0600); given to wrangler on STDIN only; never printed.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto'; import { spawnSync } from 'node:child_process'; import { pathToFileURL } from 'node:url';

export const TARGET = Object.freeze({ worker: 'marau-bula-acceptance', dbName: 'bula-acceptance-synthetic-1', dbId: '6c54341a-6c21-4314-b514-bb44ed5fa1b5', account: '595101df2c562b3c65595420d43f9fe1' });
const HASHED = ['worker.js', 'schema.sql', 'wrangler.json', 'hosted_acceptance.mjs', 'migration_0047.sql'];
const TOP_KEYS = new Set(['name', 'main', 'compatibility_date', 'account_id', 'workers_dev', 'd1_databases', 'triggers', 'vars']);
const FLAG_VARS = new Set(['BULA_SYNTHETIC_TEST', 'BULA_CHECKOUT_ENABLED', 'BULA_CREDITS_ENABLED', 'BULA_EDITION_PUBLISH_ENABLED', 'BULA_FAULT_HARNESS', 'BULA_OUTBOX_ENABLED', 'BULA_EMAIL_SEND_ENABLED', 'BULA_DEVICE_PAIRING', 'BULA_SOURCE_SYNC', 'BULA_EMAIL_CAPTURE']);
const OTHER_VARS = new Set(['BULA_POLICY_VERSION', 'BULA_BUILD', 'BULA_COMMIT', 'BULA_CATALOGUE_HIDDEN_OPERATORS', 'BULA_CRON_ONLY_OPERATORS', 'BULA_STAFF_INBOX']);
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
  for (const k of ['BULA_SOURCE_SYNC', 'BULA_EMAIL_CAPTURE']) if (v[k] !== undefined && !OFF(v[k])) throw new Fail(`${k} must be "off" in the bundle (the source step turns it on for that step only)`);
  return { meta, config: c };
}

/** Windows cmd.exe (needed to launch npx/npm) splits unquoted arguments on spaces: quote anything that is not a plain token. */
export function quoteWin(a) { const x = String(a); return /^[A-Za-z0-9_@%+=:,./\\-]+$/.test(x) ? x : `"${x.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`; }
/** Redacted diagnostic for a failed subprocess: what ran, how it ended, whether Wrangler started and whether it reached Cloudflare (from its own output). No secrets, no emails. */
export function redact(t, secrets = []) { let o = String(t || ''); for (const x of secrets) if (x) o = o.split(x).join('***'); return o.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>').replace(/\b[0-9a-f]{32,}\b/gi, '<hex>').replace(/Bearer\s+\S+/gi, 'Bearer ***').replace(/\x1b\[[0-9;]*m/g, ''); }
export function diagnose(label, r, extra = {}) {
  const out = String(r.out || ''); const code = typeof r.code === 'number' ? r.code : null;
  return { label, at: new Date().toISOString(), reason: r.reason, exit_code: code, exit_code_hex: code === null ? null : '0x' + (code >>> 0).toString(16).toUpperCase(), signal: /interrupted by (\w+)/.exec(r.reason || '')?.[1] || null,
    wrangler_started: /wrangler|⛅|Cloudflare/i.test(out), reached_cloudflare: /api\.cloudflare\.com|\[API|Executing on remote|Resource location|Uploaded|Deployed|Total Upload|Success/i.test(out), output_bytes: out.length,
    output_tail_redacted: redact(out.slice(-1500), extra.secrets), node: process.version, platform: process.platform, ...(extra.info || {}) }; }
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
  const q = (a) => (win ? quoteWin(a) : a);
  const diagDir = path.join(home, 'diagnostics'); const keep = (label, r, extra) => { try { fs.mkdirSync(diagDir, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(diagDir, `diag-${Date.now()}-${label.replace(/\W+/g, '_')}.json`), JSON.stringify(diagnose(label, r, extra), null, 2), { mode: 0o600 }); } catch { /* diagnostics are best-effort */ } };
  const wr = (args, input, label = args.slice(0, 2).join('-')) => { const r = runProc(spawn, 'npx', ['--yes', 'wrangler@3', ...args.map(q)], { cwd: B, input, shell: win }); if (!r.ok) { const sec = load(SEC, null); keep(label, r, { secrets: sec ? [sec.admin, ...Object.values(sec.staff || {})] : [] }); } return r; };
  let verified = null;
  const need = () => { if (!verified) throw new Fail('bundle not verified'); return verified; };
  const R = {
    verify() { verified = verifyBundle(B); log(`bundle verified: commit ${verified.meta.commit} — targets only ${TARGET.worker} / ${TARGET.dbName}; email sending off; no routes`); },
    prepare() { need(); fs.mkdirSync(home, { recursive: true, mode: 0o700 }); const existing = load(SEC, null); const s = existing || { admin: rnd(), staff: { ceo: rnd(), ops: rnd(), approver: rnd() }, created: new Date().toISOString() }; if (!existing) save(SEC, s); log(existing ? 'existing secrets kept unchanged (not printed):' : 'secrets generated (not printed):', SEC); return s; },
    schema() { need(); const r = wr(['d1', 'execute', TARGET.dbName, '--remote', '--yes', '--file', 'schema.sql', '-c', 'wrangler.json']); if (!r.ok) throw new Fail(`schema step failed (${r.reason})\n${r.out.slice(-1200)}`); log(`schema applied to ${TARGET.dbName} ONLY`); },
    /** Read-only table probe of the TARGET database. Method 1 passes the SQL in a file; if that output does not show every wanted table, method 2 passes it with --command (quoted on Windows).
     *  The redacted raw output of each attempt is kept in R.lastProbe for the diagnostic. Returns {got, attempts, anyOk, anyParsed}; never relaxes anything by itself. */
    readTables(want, label) {
      need(); fs.mkdirSync(home, { recursive: true, mode: 0o700 }); const probe = path.join(home, 'probe.sql');
      const sql = `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${want.map((n) => `'${n}'`).join(',')})`; fs.writeFileSync(probe, sql + ';\n');
      const names = (j, acc = []) => { if (Array.isArray(j)) j.forEach((x) => names(x, acc)); else if (j && typeof j === 'object') { if (Array.isArray(j.results)) for (const r of j.results) if (r && typeof r.name === 'string') acc.push(r.name); for (const v of Object.values(j)) if (v && typeof v === 'object' && !Array.isArray(j.results)) names(v, acc); } return acc; };
      const parse = (out) => { const t = out.replace(/\x1b\[[0-9;]*m/g, '').trim(); const cands = [t]; const i = t.indexOf('['), k = t.lastIndexOf(']'); if (i >= 0 && k > i) cands.push(t.slice(i, k + 1)); for (const c of cands) { try { return names(JSON.parse(c)); } catch { /* next */ } } return null; };
      const attempts = []; let got = [];
      for (const [method, args] of [['file', ['--file', probe]], ['command', ['--command', sql]]]) {
        const r = wr(['d1', 'execute', TARGET.dbName, '--remote', '--yes', '--json', ...args, '-c', 'wrangler.json'], undefined, `${label}-${method}`);
        const rows = r.ok ? parse(r.out) : null; const found = rows ? want.filter((t) => rows.includes(t)) : [];
        attempts.push({ method, subprocess_ok: r.ok, reason: r.reason || null, parsed: rows !== null, tables_found: found.length, output_tail_redacted: redact(r.out || '', []).slice(-500) });
        if (found.length === want.length) { got = found; break; }
      }
      R.lastProbe = { want: want.length, attempts }; return { got, attempts, anyOk: attempts.some((a) => a.subprocess_ok), anyParsed: attempts.some((a) => a.parsed) };
    },
    /** All five base tables must be present => the base schema need not be applied again (requirement NOT relaxed). */
    schemaPresent() {
      const want = ['bula_offers', 'bula_audit', 'bula_holds', 'marau_test_bookings', 'guest_sessions']; const { got, attempts, anyOk, anyParsed } = R.readTables(want, 'schema-probe');
      if (got.length !== want.length) { const last = attempts[attempts.length - 1];
        if (!anyOk) throw new Fail(`could not read ${TARGET.dbName} (${last.reason}); a redacted diagnostic was saved in ${diagDir}`);
        if (!anyParsed) throw new Fail('schema probe returned output that could not be parsed — refusing to guess');
        throw new Fail(`schema not fully present in ${TARGET.dbName} (found ${Math.max(...attempts.map((a) => a.tables_found))}/${want.length} tables) — use the 'all' step, not 'resume'`); }
      log(`schema already present in ${TARGET.dbName} (${got.length}/${want.length} tables) — not re-applied`);
    },
    /** Additive migration 0047 (device pairing tables) applied ONLY to the target database, ONLY if its tables are absent. The file is hash-checked with the rest of the bundle. */
    migratePairing() {
      need(); const want = ['bula_pairing', 'bula_devices', 'bula_pair_failures']; const first = R.readTables(want, 'pairing-probe');
      if (first.got.length === want.length) { log(`device-pairing tables already present in ${TARGET.dbName} — migration 0047 not applied`); return; }
      if (!first.anyOk || !first.anyParsed) throw new Fail(`could not determine whether the pairing tables exist (a redacted diagnostic was saved in ${diagDir}); not applying anything`);
      const r = wr(['d1', 'execute', TARGET.dbName, '--remote', '--yes', '--file', 'migration_0047.sql', '-c', 'wrangler.json'], undefined, 'migrate-0047'); if (!r.ok) throw new Fail(`migration 0047 failed (${r.reason})\n${r.out.slice(-800)}`);
      const again = R.readTables(want, 'pairing-verify'); if (again.got.length !== want.length) throw new Fail('migration 0047 ran but the pairing tables are not all present; stopping');
      log(`migration 0047 (device pairing tables) applied to ${TARGET.dbName} ONLY`);
    },
    /** Read-only environment diagnostic (no deploy, no writes to Cloudflare). EVERY required check must pass, otherwise the step fails (non-zero exit). */
    diagnose() {
      need(); const info = {}; const failures = [];
      const v = (k, cmd, args, shell) => { const r = runProc(spawn, cmd, args, { shell }); info[k] = r.ok ? redact(r.out).trim().slice(0, 120) : `FAILED (${r.reason})`; if (!r.ok || !String(r.out).trim()) failures.push(k); };
      v('node', node, ['--version'], false);                       // node.exe is launched directly: its install path contains a space, which cmd.exe would split
      v('npm', 'npm', ['--version'], win); v('npx_wrangler', 'npx', ['--yes', 'wrangler@3', '--version'], win);
      const who = wr(['whoami'], undefined, 'whoami'); const wl = who.ok ? redact(who.out).split('\n').filter((l) => /logged in|account|oauth|scopes|not authenticated/i.test(l)).join(' | ').slice(0, 300) : `FAILED (${who.reason})`; info.whoami = wl;
      if (!who.ok || !/logged in/i.test(who.out) || /not authenticated/i.test(who.out)) failures.push('whoami');
      let probe = 'ok'; try { R.schemaPresent(); } catch (e) { probe = e.message.split('\n')[0]; failures.push('schema_probe'); } info.schema_probe = probe; info.schema_probe_attempts = R.lastProbe ? R.lastProbe.attempts : [];
      try { const t = R.readTables(['bula_pairing', 'bula_devices', 'bula_pair_failures'], 'pairing-probe'); info.pairing_tables = `${t.got.length}/3 present${t.got.length < 3 ? ' (resume applies migration 0047 once)' : ''}`; } catch (e) { info.pairing_tables = 'unknown'; }
      info.ok = failures.length === 0; info.failed_checks = failures;
      fs.mkdirSync(diagDir, { recursive: true, mode: 0o700 }); const f = path.join(diagDir, `environment-${Date.now()}.json`); fs.writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), platform: process.platform, ...info }, null, 2), { mode: 0o600 }); log('diagnostic saved:', f); log(JSON.stringify(info, null, 2));
      if (failures.length) throw new Fail(`diagnosis found failed required check(s): ${failures.join(', ')} (details in ${f})`);
    },
    /** Recovery: print a fresh ONE-TIME connect code for the existing phone guest (staff-issued; 10 minutes, single use). Needs a passing deploy; touches no schema. */
    pair() {
      need(); R.prepare(); const st = load(STATE, {}); if (!st.url) throw new Fail('deploy first');
      const r = runProc(spawn, node, [path.join(B, 'hosted_acceptance.mjs')], { env: { ...process.env, BASE: st.url, SECRETS_FILE: SEC, OUT_DIR: home, MODE: 'pair' } }); log((r.out || '').split('\n').filter((l) => /CONNECT CODE|no phone-meta|pairing code failed/.test(l)).join('\n'));
      if (!r.ok) throw new Fail(`could not create a connect code (${r.reason})`);
    },
    deploy(flagsOff = false, extraVars = []) {
      const { meta } = need(); const s = R.prepare(); const p = wr(['secret', 'put', 'MARAU_ADMIN_TEST_TOKEN', '-c', 'wrangler.json'], s.admin + '\n'); if (!p.ok) throw new Fail(`secret put failed (${p.reason})\n${p.out.slice(-600).split(s.admin).join('***')}`);
      const vars = [`BULA_BUILD:${meta.commit.slice(0, 12)}`, `BULA_COMMIT:${meta.commit}`, ...extraVars]; if (flagsOff) for (const f of ['BULA_CHECKOUT_ENABLED', 'BULA_CREDITS_ENABLED', 'BULA_EDITION_PUBLISH_ENABLED', 'BULA_FAULT_HARNESS', 'BULA_SYNTHETIC_TEST', 'BULA_DEVICE_PAIRING', 'BULA_OUTBOX_ENABLED', 'BULA_SOURCE_SYNC', 'BULA_EMAIL_CAPTURE']) vars.push(`${f}:off`);
      const d = wr(['deploy', '-c', 'wrangler.json', ...vars.flatMap((x) => ['--var', x])]); if (!d.ok) throw new Fail(`deploy failed (${d.reason})\n${d.out.slice(-800).split(s.admin).join('***')}`);
      const m = /https:\/\/marau-bula-acceptance\.[\w-]+\.workers\.dev/.exec(d.out); if (!m) throw new Fail('deploy output did not contain the workers.dev URL'); const st = load(STATE, {}); st.url = m[0]; st.deployed = { commit: meta.commit, at: new Date().toISOString(), flagsOff, extra: extraVars.length ? extraVars : undefined }; save(STATE, st); log('URL', st.url);
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
    /** Saved-booking adapter acceptance. The SAME isolated Worker is redeployed for this step ONLY with the outbox, source-sync and email-CAPTURE flags on (email sending stays off; capture writes audit rows and transmits nothing),
     *  the synthetic-source checks run, and the base flags are ALWAYS restored afterwards (even on failure). Needs passing base evidence for this commit. */
    source() {
      const { meta } = need(); const s = R.prepare(); const base = load(EVID, null);
      if (!base || base.failed !== 0 || !base.results || !base.results.length || (base.commit !== meta.commit && base.commit !== meta.commit.slice(0, 12))) throw new Fail('refusing to run the source step: no passing hosted-acceptance evidence for this commit');
      const SEV = path.join(home, 'evidence-source.json'); if (fs.existsSync(SEV)) fs.renameSync(SEV, `${SEV}.stale-${Date.now()}`);
      let failure = null;
      try {
        R.deploy(false, ['BULA_OUTBOX_ENABLED:on', 'BULA_SOURCE_SYNC:on', 'BULA_EMAIL_CAPTURE:on', 'BULA_STAFF_INBOX:team@example.invalid']); const st = load(STATE, {});
        const r = runProc(spawn, node, [path.join(B, 'hosted_acceptance.mjs')], { env: { ...process.env, BASE: st.url, SECRETS_FILE: SEC, STATE_FILE: STATE, OUT_DIR: home, MODE: 'source' } });
        log((r.out || '').split('\n').filter((l) => !/tok_|stf_|"access_token"/.test(l)).join('\n').split(s.admin).join('***'));
        if (!r.ok) failure = `source acceptance FAILED (${r.reason})`;
        else { const ev = load(SEV, null); if (!ev || !Array.isArray(ev.results) || !ev.results.length) failure = 'source acceptance wrote no evidence'; else if (ev.failed !== 0 || ev.results.some((x) => !x.pass)) failure = `source acceptance reported ${ev.failed} failing check(s)`; else if (ev.commit !== meta.commit && ev.commit !== meta.commit.slice(0, 12)) failure = `source evidence is for commit ${ev.commit}, bundle is ${meta.commit}`; else log(`source acceptance PASSED: ${ev.results.length}/${ev.results.length}; evidence: ${SEV}`); }
      } catch (e) { failure = e && e.message ? e.message : String(e); }
      try { R.deploy(false); log('base flags restored (outbox, source sync and email capture off)'); } catch (e) { throw new Fail(`${failure ? failure + ' AND ' : ''}RESTORE OF BASE FLAGS FAILED (${e.message}) — run the lockdown step now`); }
      if (failure) throw new Fail(failure);
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
  if (!bundle) { err('usage: node run_acceptance.mjs <bundleDir> <verify|diagnose|prepare|schema|migrate|deploy|accept|phone|source|pair|lockdown|resume|all>'); return 2; }
  const R = makeRunner({ B: path.resolve(bundle), ...deps });
  try {
    R.verify();                                                    // BEFORE anything else, for every step
    if (step === 'verify') return 0;
    if (step === 'all') { R.prepare(); R.schema(); R.migratePairing(); R.deploy(false); R.accept(); R.phone(); R.source(); return 0; }
    if (step === 'resume') { R.prepare(); R.schemaPresent(); R.migratePairing(); R.deploy(false); R.accept(); R.phone(); R.source(); return 0; }   // schema NOT re-applied; previous evidence is kept (renamed) by accept()
    const one = { diagnose: R.diagnose, prepare: R.prepare, schema: R.schema, migrate: R.migratePairing, pair: R.pair, deploy: () => R.deploy(false), accept: R.accept, phone: R.phone, source: R.source, lockdown: () => R.deploy(true) }[step];
    if (!one) { err('unknown step'); return 2; } one(); return 0;
  } catch (e) { err(e instanceof Fail ? `STOPPED: ${e.message}` : `STOPPED (unexpected): ${e && e.message}`); return 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { process.exit(await main(process.argv.slice(2))); }
