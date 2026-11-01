// Failure-path tests for the deployment runner. A FAKE spawn is used: nothing here touches Cloudflare, the network, or a real wrangler.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { main, verifyBundle, runProc, TARGET, quoteWin, diagnose, redact } from './run_acceptance.mjs';

const COMMIT = 'a'.repeat(40);
const GOOD_CFG = () => ({ name: TARGET.worker, main: 'worker.js', compatibility_date: '2026-07-19', account_id: TARGET.account, workers_dev: true,
  d1_databases: [{ binding: 'DB', database_name: TARGET.dbName, database_id: TARGET.dbId }], triggers: { crons: ['0 6 * * *', '*/15 * * * *'] },
  vars: { BULA_SYNTHETIC_TEST: 'on', BULA_CHECKOUT_ENABLED: 'on', BULA_CREDITS_ENABLED: 'on', BULA_EDITION_PUBLISH_ENABLED: 'on', BULA_FAULT_HARNESS: 'on', BULA_OUTBOX_ENABLED: 'off', BULA_EMAIL_SEND_ENABLED: 'off', BULA_POLICY_VERSION: 'p', BULA_BUILD: 'unset', BULA_COMMIT: 'unset' } });
const h = (s) => crypto.createHash('sha256').update(s).digest('hex');
function mkBundle(over = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bula-b-')); const files = { 'worker.js': 'export default {}', 'schema.sql': 'CREATE TABLE t(x);', 'hosted_acceptance.mjs': '// stub', 'wrangler.json': JSON.stringify(over.cfg || GOOD_CFG()) };
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(d, f), c);
  const sums = Object.fromEntries(Object.entries(files).map(([f, c]) => [f, h(c)])); fs.writeFileSync(path.join(d, 'BUNDLE.json'), JSON.stringify({ commit: COMMIT, sha256: { ...sums, ...(over.sums || {}) } })); return d;
}
/** fake spawn: records every call; behaviour per call is chosen by `plan(callInfo)` */
function harness({ plan = () => ({}), evidence = (home) => ({ commit: COMMIT, failed: 0, results: [{ name: 'a', pass: true }] }) } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bula-h-')); const calls = []; const logs = []; const errs = [];
  const spawn = (cmd, args, opts = {}) => {
    const kind = cmd === 'npx' ? `wrangler:${args[2]}${args[3] === 'put' ? '-put' : ''}` : cmd === 'npm' ? 'npm' : (args[0] === '-e' ? 'qr' : (opts.env && opts.env.MODE === 'phone' ? 'phone' : 'accept'));
    calls.push({ kind, cmd, args, input: opts.input }); const p = plan({ kind, calls }) || {}; if (p.result) return p.result;
    if (kind === 'wrangler:d1' && args.some((a) => /probe\.sql/.test(a))) return { status: 0, stdout: JSON.stringify([{ results: (opts.__tables || ['bula_offers', 'bula_audit', 'bula_holds', 'marau_test_bookings', 'guest_sessions']).map((n) => ({ name: n })), success: true }]), stderr: '' };
    if (kind === 'wrangler:deploy') return { status: 0, stdout: 'Deployed https://marau-bula-acceptance.example.workers.dev', stderr: '' };
    if (kind === 'accept') { const ev = evidence(home); if (ev) fs.writeFileSync(path.join(home, 'evidence.json'), JSON.stringify(ev)); return { status: 0, stdout: 'ok', stderr: '' }; }
    if (kind === 'phone') { fs.writeFileSync(path.join(home, 'phone-link.txt'), 'https://x/bula#tok=SECRET'); return { status: 0, stdout: 'phone ready', stderr: '' }; }
    if (kind === 'qr') { fs.writeFileSync(path.join(home, 'phone-qr.png'), 'png'); return { status: 0, stdout: '', stderr: '' }; }
    return { status: 0, stdout: '', stderr: '' };
  };
  return { home, calls, logs, errs, deps: { home, spawn, log: (...a) => logs.push(a.join(' ')), err: (...a) => errs.push(a.join(' ')), win: false } };
}
const run = (B, H, step = 'all') => main([B, step], H.deps);
const cloud = (calls) => calls.filter((c) => c.kind.startsWith('wrangler'));

test('HAPPY PATH: verify → secrets → schema → deploy → acceptance → phone → QR; exit 0; secrets only via stdin; QR after acceptance', async () => {
  const H = harness(); const code = await run(mkBundle(), H); assert.equal(code, 0, H.errs.join('|'));
  assert.deepEqual(H.calls.map((c) => c.kind), ['wrangler:d1', 'wrangler:secret-put', 'wrangler:deploy', 'accept', 'phone', 'npm', 'qr']);
  const sec = JSON.parse(fs.readFileSync(path.join(H.home, 'secrets.json'), 'utf8')); const put = H.calls.find((c) => c.kind === 'wrangler:secret-put');
  assert.equal(put.input.trim(), sec.admin); assert.ok(!JSON.stringify(H.calls.map((c) => c.args)).includes(sec.admin), 'admin secret must never be in argv'); assert.ok(!H.logs.join('\n').includes(sec.admin));
  assert.ok(fs.existsSync(path.join(H.home, 'phone-qr.png'))); assert.match(sec.admin, /^[0-9a-f]{64}$/);
  for (const t of Object.values(sec.staff)) assert.match(t, /^[0-9a-f]{64}$/);
  assert.equal((fs.statSync(path.join(H.home, 'secrets.json')).mode & 0o077), 0, 'secrets file private');
});
test('acceptance FAILS (non-zero exit) → `all` exits non-zero, NO phone link, NO QR, no npm install', async () => {
  const H = harness({ plan: ({ kind }) => (kind === 'accept' ? { result: { status: 1, stdout: 'FAIL race', stderr: '' } } : {}) }); const code = await run(mkBundle(), H);
  assert.notEqual(code, 0); assert.ok(!H.calls.some((c) => ['phone', 'npm', 'qr'].includes(c.kind))); assert.ok(!fs.existsSync(path.join(H.home, 'phone-qr.png'))); assert.ok(!fs.existsSync(path.join(H.home, 'phone-link.txt'))); assert.match(H.errs.join('\n'), /acceptance FAILED/);
});
test('acceptance exits 0 but evidence says failures / is missing / is for another commit / is empty → still a failure, no QR', async () => {
  for (const [label, ev] of [['failed>0', () => ({ commit: COMMIT, failed: 1, results: [{ pass: false }] })], ['missing', () => null], ['other commit', () => ({ commit: 'b'.repeat(40), failed: 0, results: [{ pass: true }] })], ['empty', () => ({ commit: COMMIT, failed: 0, results: [] })], ['one false', () => ({ commit: COMMIT, failed: 0, results: [{ pass: true }, { pass: false }] })]]) {
    const H = harness({ evidence: ev }); assert.notEqual(await run(mkBundle(), H), 0, label); assert.ok(!H.calls.some((c) => c.kind === 'qr' || c.kind === 'phone'), label);
  }
});
test('stale evidence from an earlier run cannot satisfy this run (moved aside, not deleted)', async () => {
  const H = harness({ evidence: () => null }); fs.writeFileSync(path.join(H.home, 'evidence.json'), JSON.stringify({ commit: COMMIT, failed: 0, results: [{ pass: true }] }));
  assert.notEqual(await run(mkBundle(), H), 0); assert.ok(fs.readdirSync(H.home).some((f) => f.startsWith('evidence.json.stale-')));
});
test('subprocess failures count as failures: launch error, signal interruption, missing exit code, non-zero — at every stage', async () => {
  const bad = { 'launch error': { error: Object.assign(new Error('spawn npx ENOENT'), { code: 'ENOENT' }), status: null }, 'SIGINT': { status: null, signal: 'SIGINT' }, 'no exit code': { status: null }, 'undefined status': {}, 'exit 3': { status: 3, stdout: '', stderr: 'boom' } };
  for (const stage of ['wrangler:d1', 'wrangler:secret-put', 'wrangler:deploy', 'accept']) for (const [label, result] of Object.entries(bad)) {
    const H = harness({ plan: ({ kind }) => (kind === stage ? { result } : {}) }); const code = await run(mkBundle(), H); assert.notEqual(code, 0, `${stage}/${label}`); assert.ok(!H.calls.some((c) => c.kind === 'qr'), `${stage}/${label}: no QR`);
    const idx = ['wrangler:d1', 'wrangler:secret-put', 'wrangler:deploy', 'accept'].indexOf(stage); assert.ok(!H.calls.some((c) => ['wrangler:d1', 'wrangler:secret-put', 'wrangler:deploy', 'accept'].indexOf(c.kind) > idx), `${stage}/${label}: later stages must not run`);
  }
  const t = (r) => runProc(() => r, 'x', []); assert.equal(t({ status: 0, stdout: 'ok' }).ok, true); assert.equal(runProc(() => { throw new Error('EACCES'); }, 'x', []).ok, false); assert.equal(runProc(() => null, 'x', []).ok, false);
});
test('phone/QR stage failures are failures too (link install failure, QR file missing, spawn error)', async () => {
  for (const [kind, result] of [['npm', { status: 1 }], ['qr', { status: null, signal: 'SIGTERM' }], ['phone', { error: new Error('x'), status: null }], ['qr', { status: 0, stdout: '' }]]) {
    const H = harness({ plan: (c) => (c.kind === kind ? { result } : {}) }); if (kind === 'qr' && result.status === 0) { /* exit 0 but no file written by fake */ } const code = await run(mkBundle(), H); assert.notEqual(code, 0, kind);
  }
});
test('PREFLIGHT: any hash mismatch / missing hash / missing file stops BEFORE any Cloudflare (or any) subprocess', async () => {
  const cases = [['tampered worker', (d) => fs.writeFileSync(path.join(d, 'worker.js'), 'export default { evil: 1 }')], ['tampered schema', (d) => fs.appendFileSync(path.join(d, 'schema.sql'), 'DROP TABLE t;')], ['tampered config', (d) => fs.appendFileSync(path.join(d, 'wrangler.json'), ' ')], ['tampered acceptance script', (d) => fs.appendFileSync(path.join(d, 'hosted_acceptance.mjs'), '//x')], ['file missing', (d) => fs.rmSync(path.join(d, 'schema.sql'))]];
  for (const [label, tamper] of cases) { const d = mkBundle(); tamper(d); const H = harness(); assert.notEqual(await run(d, H), 0, label); assert.equal(H.calls.length, 0, `${label}: nothing may be spawned`); }
  const d = mkBundle({ sums: { 'schema.sql': undefined } }); const meta = JSON.parse(fs.readFileSync(path.join(d, 'BUNDLE.json'), 'utf8')); delete meta.sha256['schema.sql']; fs.writeFileSync(path.join(d, 'BUNDLE.json'), JSON.stringify(meta)); const H = harness(); assert.notEqual(await run(d, H), 0); assert.equal(H.calls.length, 0);
  const H2 = harness(); assert.notEqual(await run(path.join(os.tmpdir(), 'bula-does-not-exist'), H2), 0); assert.equal(H2.calls.length, 0);
});
test('PREFLIGHT: configuration must target ONLY marau-bula-acceptance + the new database, email off, no routes — every violation stops before any subprocess', async () => {
  const mut = { 'other worker name': (c) => { c.name = 'marau-stage1-preview'; }, 'other database id': (c) => { c.d1_databases[0].database_id = 'e0c81ade-dc9f-477f-b370-bd5fd85a4f1f'; }, 'other database name': (c) => { c.d1_databases[0].database_name = 'marau-stage1-test-db'; },
    'second database': (c) => { c.d1_databases.push({ binding: 'DB2', database_name: 'nadi-marketplace-db', database_id: '0ec1cd84-fcda-4f7f-8337-0fb70fe1a512' }); }, 'routes': (c) => { c.routes = [{ pattern: 'x.vakaviti.ai/*', zone_name: 'vakaviti.ai' }]; }, 'route': (c) => { c.route = 'x.vakaviti.ai/*'; },
    'custom domain': (c) => { c.routes = [{ pattern: 'x.vakaviti.ai', custom_domain: true }]; }, 'kv binding': (c) => { c.kv_namespaces = [{ binding: 'K', id: 'x' }]; }, 'service binding': (c) => { c.services = [{ binding: 'S', service: 'nadi-worker' }]; },
    'email sending on': (c) => { c.vars.BULA_EMAIL_SEND_ENABLED = 'on'; }, 'email flag missing': (c) => { delete c.vars.BULA_EMAIL_SEND_ENABLED; }, 'outbox on': (c) => { c.vars.BULA_OUTBOX_ENABLED = 'on'; }, 'secret in vars': (c) => { c.vars.MARAU_ADMIN_TEST_TOKEN = 'x'; }, 'unknown var': (c) => { c.vars.SOMETHING = 'x'; },
    'workers_dev off': (c) => { c.workers_dev = false; }, 'extra cron': (c) => { c.triggers.crons.push('* * * * *'); }, 'wrong account': (c) => { c.account_id = '0'.repeat(32); }, 'different main': (c) => { c.main = '../other/worker.js'; } };
  for (const [label, f] of Object.entries(mut)) { const cfg = GOOD_CFG(); f(cfg); const d = mkBundle({ cfg }); const H = harness(); assert.notEqual(await run(d, H), 0, label); assert.equal(H.calls.length, 0, `${label}: nothing may be spawned`); assert.match(H.errs.join('\n'), /STOPPED/, label); }
  assert.doesNotThrow(() => verifyBundle(mkBundle()));
});
test('each single step also verifies first (schema/deploy/lockdown/phone refuse a tampered bundle); unknown step and missing args are errors; lockdown turns every feature flag off', async () => {
  for (const step of ['schema', 'deploy', 'lockdown', 'accept', 'phone', 'prepare']) { const d = mkBundle(); fs.appendFileSync(path.join(d, 'worker.js'), '//t'); const H = harness(); assert.notEqual(await run(d, H, step), 0, step); assert.equal(H.calls.length, 0, step); }
  const H = harness(); assert.equal(await run(mkBundle(), H, 'bogus'), 2); assert.equal(await main([], H.deps), 2);
  const L = harness(); assert.equal(await run(mkBundle(), L, 'lockdown'), 0); const dep = L.calls.find((c) => c.kind === 'wrangler:deploy'); const vars = dep.args.filter((a, i) => dep.args[i - 1] === '--var');
  for (const f of ['BULA_CHECKOUT_ENABLED', 'BULA_CREDITS_ENABLED', 'BULA_EDITION_PUBLISH_ENABLED', 'BULA_FAULT_HARNESS', 'BULA_SYNTHETIC_TEST']) assert.ok(vars.includes(`${f}:off`), f);
});
test('phone step alone refuses without passing evidence for this bundle', async () => {
  const H = harness(); assert.notEqual(await run(mkBundle(), H, 'phone'), 0); assert.ok(!H.calls.some((c) => c.kind === 'phone' || c.kind === 'qr'));
});

test('RESUME: does NOT re-apply the schema; probes the target DB read-only, redeploys, re-runs acceptance, preserves the earlier failed evidence, QR only after a pass', async () => {
  const H = harness(); fs.writeFileSync(path.join(H.home, 'evidence.json'), JSON.stringify({ commit: 'b'.repeat(40), failed: 1, results: [{ pass: false }] }));
  const code = await run(mkBundle(), H, 'resume'); assert.equal(code, 0, H.errs.join('|'));
  assert.ok(!H.calls.some((c) => c.args.includes('schema.sql')), 'schema.sql must not be executed'); assert.ok(H.calls.some((c) => c.args.some((a) => /probe\.sql/.test(a)) && c.args.includes('--remote')));
  assert.deepEqual(H.calls.map((c) => c.kind).filter((k) => k !== 'wrangler:d1'), ['wrangler:secret-put', 'wrangler:deploy', 'accept', 'phone', 'npm', 'qr']);
  const kept = fs.readdirSync(H.home).filter((f) => f.startsWith('evidence.json.stale-')); assert.equal(kept.length, 1); assert.equal(JSON.parse(fs.readFileSync(path.join(H.home, kept[0]), 'utf8')).failed, 1);
});
test('RESUME refuses (nothing deployed) when the schema is absent or the probe fails; resume with failing acceptance exits non-zero with no QR', async () => {
  const H1 = harness({ plan: ({ kind, calls }) => (kind === 'wrangler:d1' ? { result: { status: 0, stdout: JSON.stringify([{ results: [{ name: 'bula_offers' }] }]), stderr: '' } } : {}) }); assert.notEqual(await run(mkBundle(), H1, 'resume'), 0); assert.ok(!H1.calls.some((c) => c.kind === 'wrangler:deploy'));
  const H2 = harness({ plan: ({ kind }) => (kind === 'wrangler:d1' ? { result: { status: null, signal: 'SIGINT' } } : {}) }); assert.notEqual(await run(mkBundle(), H2, 'resume'), 0); assert.ok(!H2.calls.some((c) => c.kind === 'wrangler:deploy'));
  const H3 = harness({ plan: ({ kind }) => (kind === 'accept' ? { result: { status: 1, stdout: 'FAIL', stderr: '' } } : {}) }); assert.notEqual(await run(mkBundle(), H3, 'resume'), 0); assert.ok(!H3.calls.some((c) => c.kind === 'qr' || c.kind === 'phone'));
  const d = mkBundle(); fs.appendFileSync(path.join(d, 'worker.js'), '//t'); const H4 = harness(); assert.notEqual(await run(d, H4, 'resume'), 0); assert.equal(H4.calls.length, 0);
});

test('CRASH 3221226505 (0xC0000409) at the schema probe: failure is reported, a REDACTED diagnostic is saved (hex code, wrangler_started, reached_cloudflare), nothing deploys, secrets+evidence untouched', async () => {
  const H = harness({ plan: ({ kind, calls }) => (kind === 'wrangler:d1' ? { result: { status: 3221226505, stdout: '', stderr: 'Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) for james@example.com' } } : {}) });
  fs.writeFileSync(path.join(H.home, 'secrets.json'), JSON.stringify({ admin: 'a'.repeat(64), staff: { ceo: 'b'.repeat(64), ops: 'c'.repeat(64), approver: 'd'.repeat(64) } })); fs.writeFileSync(path.join(H.home, 'evidence.json'), '{"keep":1}'); const before = fs.readFileSync(path.join(H.home, 'secrets.json'), 'utf8');
  assert.notEqual(await run(mkBundle(), H, 'resume'), 0); assert.ok(!H.calls.some((c) => c.kind === 'wrangler:deploy' || c.kind === 'wrangler:secret-put'));
  const d = fs.readdirSync(path.join(H.home, 'diagnostics')).filter((f) => f.startsWith('diag-')); assert.equal(d.length, 1); const j = JSON.parse(fs.readFileSync(path.join(H.home, 'diagnostics', d[0]), 'utf8'));
  assert.equal(j.exit_code, 3221226505); assert.equal(j.exit_code_hex, '0xC0000409'); assert.equal(j.wrangler_started, false); assert.equal(j.reached_cloudflare, false); assert.ok(!JSON.stringify(j).includes('james@example.com')); assert.ok(!JSON.stringify(j).includes('a'.repeat(64)));
  assert.equal(fs.readFileSync(path.join(H.home, 'secrets.json'), 'utf8'), before, 'secrets file byte-identical'); assert.equal(fs.readFileSync(path.join(H.home, 'evidence.json'), 'utf8'), '{"keep":1}', 'evidence untouched when the run stops before acceptance');
});
test('existing secrets are never rewritten by any step (content AND mtime preserved)', async () => {
  const H = harness(); const f = path.join(H.home, 'secrets.json'); fs.writeFileSync(f, JSON.stringify({ admin: 'a'.repeat(64), staff: { ceo: 'b'.repeat(64), ops: 'c'.repeat(64), approver: 'd'.repeat(64) } })); const old = new Date(Date.now() - 86400000); fs.utimesSync(f, old, old); const m0 = fs.statSync(f).mtimeMs;
  assert.equal(await run(mkBundle(), H, 'resume'), 0); assert.equal(fs.statSync(f).mtimeMs, m0); assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).admin, 'a'.repeat(64));
});
test('Windows quoting: SQL/paths with spaces, quotes and parentheses survive cmd.exe splitting; plain tokens untouched; the probe passes SQL via a FILE (no spaces on the command line)', async () => {
  assert.equal(quoteWin('wrangler.json'), 'wrangler.json'); assert.equal(quoteWin('--remote'), '--remote'); assert.equal(quoteWin('C:\\Users\\James\\.bula-acceptance\\probe.sql'), 'C:\\Users\\James\\.bula-acceptance\\probe.sql');
  assert.equal(quoteWin("SELECT name FROM t WHERE x IN ('a','b')"), "\"SELECT name FROM t WHERE x IN ('a','b')\""); assert.equal(quoteWin('C:\\Users\\Jane Doe\\x.sql'), '"C:\\Users\\Jane Doe\\x.sql"'); assert.equal(quoteWin('say "hi"'), '"say \\"hi\\""');
  const H = harness(); assert.equal(await run(mkBundle(), H, 'resume'), 0); const probe = H.calls.find((c) => c.args.some((a) => /probe\.sql/.test(a))); assert.ok(probe.args.every((a) => !/\s/.test(a) || a.length < 2)); assert.match(fs.readFileSync(path.join(H.home, 'probe.sql'), 'utf8'), /sqlite_master/);
  assert.deepEqual(diagnose('x', { out: '', reason: 'exit code 5', code: 5 }).exit_code_hex, '0x5'); assert.equal(redact('Bearer abc.def and me@x.io'), 'Bearer *** and <email>');
});
test('`diagnose` step: read-only environment report (versions, wrangler login state, schema probe), redacted, saved; no deploy or schema write', async () => {
  const H = harness({ plan: ({ kind, calls }) => ({}) }); assert.equal(await run(mkBundle(), H, 'diagnose'), 0, H.errs.join('|')); assert.ok(!H.calls.some((c) => ['wrangler:deploy', 'wrangler:secret-put'].includes(c.kind) || c.args.includes('schema.sql')));
  const f = fs.readdirSync(path.join(H.home, 'diagnostics')).find((n) => n.startsWith('environment-')); assert.ok(f); const j = JSON.parse(fs.readFileSync(path.join(H.home, 'diagnostics', f), 'utf8')); assert.ok(j.node && j.schema_probe === 'ok');
});
