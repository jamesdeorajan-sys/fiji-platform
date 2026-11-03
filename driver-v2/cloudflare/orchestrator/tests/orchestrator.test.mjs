import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { runStagedProof, TEARDOWN_STEPS } from '../orchestrator.mjs';
import { makeFakeCloud } from '../fake_cloud.mjs';
import { makeCloudflareDriver, assertCommandSafe, assertMutationPathSafe, CMD, MutationGuardError } from '../cloudflare_driver.mjs';
import { verifyIsolatedD1, assertNoIdentityOverrides, PreconditionError } from '../identity.mjs';
import { diffSnapshots } from '../diff.mjs';
import { takeSnapshot } from '../snapshot.mjs';
import { ISOLATED } from '../../src/safety.js';

const here = path.dirname(fileURLToPath(import.meta.url)); const PKG = path.join(here, '..', '..');
const ENV = { CLOUDFLARE_ACCOUNT_ID: 'acct123', CLOUDFLARE_API_TOKEN: 'x', GATE15_ACCOUNT_SUBDOMAIN: 'acme' };

function rig({ cloud = makeFakeCloud(), failStage = '', failPhase = '', failCmd = null, mutateProductionAt = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-')); const log = path.join(dir, 'proof.log'); fs.writeFileSync(log, '');
  process.env.FAKE_LOG = log; process.env.FAKE_FAIL_STAGE = failStage; process.env.FAKE_FAIL_PHASE = failPhase;
  const cmds = []; const order = [];
  const cfRec = { accountId: 'acct123', get: (p) => cloud.get(p), post: (p, b) => { assertMutationPathSafe('POST', p); order.push(`POST ${p.split('/').pop()}:${b.enabled}`); return cloud.post(p, b); }, delete: (p) => { assertMutationPathSafe('DELETE', p); order.push('DELETE secret'); return cloud.delete(p); } };
  const exec = async (argv, opts) => {
    cmds.push({ argv, hasStdin: opts?.input != null }); const j = argv.join(' '); order.push(`wrangler ${argv[0]} ${argv[1]}`);
    if (failCmd && j.includes(failCmd)) return { code: 1, stdout: '', stderr: 'boom' };
    if (argv[0] === 'd1') { if (j.includes('gate15_d1_schema')) cloud.effects.schema(); if (j.includes('gate15_teardown')) cloud.effects.removeSchema(); return { code: 0, stdout: j.includes('SELECT marker') ? `[{"results":[{"marker":"${ISOLATED.MARKER}"}]}]` : '[{"results":[{"n": 0}]}]', stderr: '' }; }
    if (argv[0] === 'secret') cloud.effects.secret(); if (argv[0] === 'deploy') cloud.effects.deploy(); if (argv[0] === 'rollback') cloud.effects.rollback(argv[1]);
    return { code: 0, stdout: '', stderr: '' };
  };
  const driver = makeCloudflareDriver({ cf: cfRec, exec, packageRoot: PKG, evidenceDir: dir, runProofScript: path.join(here, 'fake_proof.mjs'), env: ENV });
  const mutatingDriver = new Proxy(driver, { get(t, k) { const v = t[k]; if (mutateProductionAt && k === mutateProductionAt.method) return async (...a) => { const r = await v(...a); cloud.effects.touchProduction(mutateProductionAt.kind); return r; }; return v; } });
  return { dir, cloud, cmds, order, driver: mutatingDriver, proofLog: () => fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)), run: () => runStagedProof(mutatingDriver, { outDir: path.join(dir, 'out'), env: {} }) };
}
const mutatingCalls = (c) => c.calls.filter(([m]) => m !== 'GET');

test('O1 happy path: PASS, ordered stages 10->50->200, every evidence file, teardown clean, isolated resources restored, production identical', async () => {
  const r = rig(); const v = await r.run();
  assert.equal(v.verdict, 'PASS', JSON.stringify(v.steps.filter((s) => s.status !== 'ok')));
  assert.deepEqual(r.proofLog().map((p) => `${p.phase}:${p.stage}:${p.races}`), ['functional:x:0', 'race:A:10', 'race:B:50', 'race:C:200', 'checkpoint:FINAL:0']);
  const names = v.steps.map((s) => s.name); const idx = (n) => names.indexOf(n);
  const expected = ['preflight', 'before_snapshot', 'isolated_d1_identity', 'apply_isolated_schema', 'create_isolated_control_secret', 'deploy_isolated_worker', 'enable_workers_dev_isolated_only', 'functional_proof', 'stage_A_10_races', 'stage_B_50_races', 'stage_C_200_races', 'final_invariant_readback', 'after_evidence', ...TEARDOWN_STEPS.map((t) => 'teardown_' + t), 'verdict'];
  assert.deepEqual(names, expected);
  for (const f of ['00-preflight', '01-before-snapshot', '02-d1-identity', '10-functional', '11-stage-A-10-races', '12-stage-B-50-races', '13-stage-C-200-races', '20-final-invariant', '21-after-evidence', '30-teardown', '31-post-teardown-snapshot', '32-production-diff', '99-verdict']) assert.ok(fs.existsSync(path.join(r.dir, 'out', f + '.json')), f);
  assert.deepEqual(v.teardown.order, TEARDOWN_STEPS); assert.equal(v.diff.clean, true);
  assert.equal(r.cloud.S.iso.workers_dev, false); assert.deepEqual(r.cloud.S.iso.secrets, []); assert.deepEqual(r.cloud.S.iso.bindings, []); assert.equal(r.cloud.S.iso.schema, false);
});

test('O2 teardown order is exactly: workers.dev off, delete secret, drop schema, restore shell, verify, evidence, compare', async () => {
  const r = rig(); await r.run(); const o = r.order; const after = o.slice(o.indexOf('POST subdomain:false'));
  assert.deepEqual(after.slice(0, 5), ['POST subdomain:false', 'DELETE secret', 'wrangler d1 execute', 'wrangler d1 execute', 'wrangler rollback shell-v1']);   // d1 x2 = teardown SQL + empty-check
});

for (const [stage, later] of [['A', ['B', 'C']], ['B', ['C']], ['C', []]]) test(`O3-${stage} failure in stage ${stage}: later stages never run, teardown runs, verdict FAILED/HOLD, worker not left exposed`, async () => {
  const r = rig({ failStage: stage }); const v = await r.run();
  assert.equal(v.verdict, 'FAILED/HOLD'); assert.match(v.reason, new RegExp(`stage_${stage}`));
  const ran = r.proofLog().map((p) => p.stage); for (const l of later) assert.ok(!ran.includes(l), `stage ${l} must not run`);
  for (const l of later) assert.equal(v.steps.find((s) => s.name.startsWith(`stage_${l}_`)).status, 'SKIPPED');
  assert.equal(v.steps.find((s) => s.name === 'failure_evidence').status, 'ok'); assert.ok(fs.existsSync(path.join(r.dir, 'out', '21-failure-evidence.json')));
  assert.equal(v.teardown.all_ok, true); assert.equal(r.cloud.S.iso.workers_dev, false); assert.deepEqual(r.cloud.S.iso.secrets, []); assert.deepEqual(r.cloud.S.iso.bindings, []);
  assert.equal(v.diff.production_untouched, true);
});

test('O4 functional failure: no race stage runs at all, teardown runs', async () => {
  const r = rig({ failPhase: 'functional' }); const v = await r.run(); assert.equal(v.verdict, 'FAILED/HOLD');
  assert.deepEqual(r.proofLog().map((p) => p.phase), ['functional']); assert.equal(v.teardown.all_ok, true);
});

test('O5 failure at each mutation step (schema, secret, deploy) still tears down and returns FAILED/HOLD', async () => {
  for (const failCmd of ['gate15_d1_schema', 'secret put', 'deploy --name']) {
    const r = rig({ failCmd }); const v = await r.run(); assert.equal(v.verdict, 'FAILED/HOLD', failCmd); assert.equal(r.proofLog().length, 0);
    assert.equal(v.teardown.steps.length, 7, failCmd); assert.equal(r.cloud.S.iso.workers_dev, false);
  }
});

test('O6 BEFORE snapshot cannot be captured -> STOPPED_NO_MUTATION: zero mutating calls, zero wrangler commands', async () => {
  const r = rig({ cloud: makeFakeCloud({ failGet: '/zones' }) }); const v = await r.run();
  assert.equal(v.verdict, 'STOPPED_NO_MUTATION'); assert.equal(v.mutation_began, false); assert.equal(mutatingCalls(r.cloud).length, 0); assert.equal(r.cmds.length, 0); assert.equal(r.proofLog().length, 0);
});
test('O6b BEFORE snapshot missing any single required read stops with no mutation', async () => {
  for (const f of ['/workers/scripts/nadi-dispatch-api/secrets', '/workers/domains', '/d1/database?', `${ISOLATED.WORKER_NAME}/settings`]) { const r = rig({ cloud: makeFakeCloud({ failGet: f }) }); const v = await r.run(); assert.equal(v.verdict, 'STOPPED_NO_MUTATION', f); assert.equal(r.cmds.length + mutatingCalls(r.cloud).length, 0, f); }
});
test('O7 unknown shell version id -> STOP, no mutation', async () => {
  const c = makeFakeCloud(); c.S.iso.deployments = []; const r = rig({ cloud: c }); const v = await r.run(); assert.equal(v.verdict, 'STOPPED_NO_MUTATION'); assert.match(v.reason, /SHELL_VERSION_UNKNOWN/); assert.equal(r.cmds.length, 0);
});
test('O7b isolated worker not pristine at start (has secret) -> STOP, no mutation', async () => {
  const c = makeFakeCloud(); c.S.iso.secrets = ['LEFTOVER']; const r = rig({ cloud: c }); const v = await r.run(); assert.equal(v.verdict, 'STOPPED_NO_MUTATION'); assert.equal(r.cmds.length, 0);
});

test('O8 D1 identity mismatches terminate before ANY write (wrong uuid, production uuid, missing, duplicate)', async () => {
  const cases = [{ uuid: '11111111-2222-3333-4444-555555555555' }, { uuid: '0ec1cd84-fcda-4f7f-8337-0fb70fe1a512' }, { name: 'nadi-marketplace-db' }];
  for (const o of cases) { const r = rig({ cloud: makeFakeCloud({ d1Override: o }) }); const v = await r.run(); assert.equal(v.verdict, 'STOPPED_NO_MUTATION', JSON.stringify(o)); assert.equal(r.cmds.length, 0); assert.equal(mutatingCalls(r.cloud).length, 0); assert.equal(v.mutation_began, false); }
});
test('O8b identity function: exact match only; arbitrary / production / duplicate / case-games refused', () => {
  const ok = { name: ISOLATED.D1_NAME, uuid: ISOLATED.D1_UUID }; assert.deepEqual(verifyIsolatedD1([ok]), ok);
  assert.throws(() => verifyIsolatedD1([]), /NOT_FOUND/); assert.throws(() => verifyIsolatedD1([ok, ok]), /NOT_FOUND_EXACTLY_ONCE/);
  assert.throws(() => verifyIsolatedD1([{ ...ok, uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }]), /UUID_MISMATCH/);
  assert.throws(() => verifyIsolatedD1([ok, { name: 'nadi-marketplace-db', uuid: '0ec1cd84-fcda-4f7f-8337-0fb70fe1a512' }]), /PRODUCTION_D1_NAME_REFUSED/);
  assert.throws(() => verifyIsolatedD1([{ name: ISOLATED.D1_NAME, uuid: '0EC1CD84-FCDA-4F7F-8337-0FB70FE1A512' }]), /PRODUCTION_D1_UUID_REFUSED/);
  assert.throws(() => verifyIsolatedD1([{ name: ISOLATED.D1_NAME.toUpperCase(), uuid: ISOLATED.D1_UUID }]), /NOT_FOUND/);
});
test('O9 a manually supplied D1 id/name in the environment cannot bypass the check (refused outright, no mutation)', async () => {
  for (const k of ['GATE15_D1_ID', 'GATE15_D1_UUID', 'D1_DATABASE_ID', 'CLOUDFLARE_D1_DATABASE_ID']) assert.throws(() => assertNoIdentityOverrides({ [k]: 'whatever' }), /IDENTITY_OVERRIDE_REFUSED/);
  const r = rig(); const v = await runStagedProof(r.driver, { outDir: path.join(r.dir, 'o2'), env: { GATE15_D1_UUID: ISOLATED.D1_UUID } }); assert.equal(v.verdict, 'STOPPED_NO_MUTATION'); assert.equal(r.cmds.length, 0);
});
test('O9b teardown re-verifies identity before the schema-removal write (identity drift mid-run => no teardown D1 write, flagged HOLD)', async () => {
  const r = rig(); const orig = r.cloud.get.bind(r.cloud); let armed = false;
  const drv = r.driver; const od = drv.disableWorkersDev; r.driver.disableWorkersDev = async () => { armed = true; return od(); };
  r.cloud.get = async (p) => { const x = await orig(p); if (armed && p.includes('/d1/database?name=')) return { result: [{ name: ISOLATED.D1_NAME, uuid: '99999999-9999-9999-9999-999999999999' }] }; return x; };
  const v = await r.run(); assert.notEqual(v.verdict, 'PASS'); assert.equal(v.teardown.steps.find((s) => s.step === TEARDOWN_STEPS[2]).ok, false);
  assert.ok(!r.cmds.some((c) => c.argv.join(' ').includes('gate15_teardown')), 'no D1 teardown write after identity drift');
});

test('O10 teardown continues past a failed step and the run cannot PASS', async () => {
  const r = rig({ failCmd: 'gate15_teardown' }); const v = await r.run(); assert.equal(v.teardown.steps.length, 7); assert.equal(v.teardown.steps[2].ok, false); assert.equal(v.teardown.steps[3].ok, true);
  assert.notEqual(v.verdict, 'PASS');
});

for (const kind of ['worker', 'route', 'secret', 'schedule', 'd1']) test(`O11 unexplained production change (${kind}) -> HOLD / INVESTIGATE, never PASS`, async () => {
  const r = rig({ mutateProductionAt: { method: 'deployWorker', kind } }); const v = await r.run(); assert.equal(v.verdict, 'HOLD / INVESTIGATE'); assert.equal(v.diff.production_untouched, false);
});
test('O11b production change AFTER a stage failure still reports HOLD / INVESTIGATE (more severe than FAILED/HOLD)', async () => {
  const r = rig({ failStage: 'A', mutateProductionAt: { method: 'deployWorker', kind: 'secret' } }); assert.equal((await r.run()).verdict, 'HOLD / INVESTIGATE');
});
test('O12 diff: isolated leftovers (workers.dev on / secret / binding / schedule) block PASS but are not attributed to production', async () => {
  const c = makeFakeCloud(); const b = await takeSnapshot(c, 'a', 'b'); c.S.iso.workers_dev = true; c.S.iso.secrets = ['GATE15_CONTROL_TOKEN']; c.S.iso.bindings = [{ name: 'DB', type: 'd1' }]; const a = await takeSnapshot(c, 'a', 'a');
  const d = diffSnapshots(b, a); assert.equal(d.clean, false); assert.equal(d.production_untouched, true); assert.equal(d.problems.length, 3);
});
test('O13 diff: a route pointing at the isolated worker, or a new custom domain, is flagged', async () => {
  const c = makeFakeCloud(); const b = await takeSnapshot(c, 'a', 'b'); c.S.routes.push({ pattern: 'x/*', script: ISOLATED.WORKER_NAME }); c.S.domains.push({ hostname: 'h', service: ISOLATED.WORKER_NAME, environment: 'production' });
  const d = diffSnapshots(b, await takeSnapshot(c, 'a', 'a')); assert.equal(d.production_untouched, false); assert.ok(d.problems.some((p) => /ZONE ROUTES/.test(p)) && d.problems.some((p) => /DOMAINS/.test(p)));
});

test('O14 command capture: no wrangler argv or API mutation ever names a production identifier; every mutation carries only pinned names; no secret value in argv', async () => {
  const r = rig(); await r.run(); const prod = ['nadi-marketplace-db', 'nadi-dispatch-api', '0ec1cd84-fcda-4f7f-8337-0fb70fe1a512', 'vakaviti-kb', 'fiji-chat-widget'];
  assert.ok(r.cmds.length >= 7);
  for (const c of r.cmds) { const j = c.argv.join(' '); for (const p of prod) assert.ok(!j.includes(p), j); assert.doesNotMatch(j, /[0-9a-f]{64}/); if (c.argv[0] === 'd1') { assert.equal(c.argv[2], ISOLATED.D1_NAME); assert.ok(c.argv.includes('--remote')); } else assert.equal(c.argv[c.argv.indexOf('--name') + 1], ISOLATED.WORKER_NAME); }
  assert.ok(r.cmds.find((c) => c.argv[0] === 'secret').hasStdin);
  for (const [m, p] of mutatingCalls(r.cloud)) { assert.ok(p.includes(`/workers/scripts/${ISOLATED.WORKER_NAME}/`), p); for (const q of prod) assert.ok(!p.includes(q)); assert.ok(/subdomain$|GATE15_CONTROL_TOKEN$/.test(p)); }
  assert.equal(mutatingCalls(r.cloud).filter(([, p]) => p.endsWith('subdomain')).length, 2);   // enabled once, disabled once, nothing else
  const base = r.proofLog().map((p) => p.base); assert.ok(base.every((b) => b === 'https://driver-v2-gate15-isolated.acme.workers.dev'));
});
test('O15 guards refuse hostile commands/paths directly', () => {
  assert.throws(() => assertCommandSafe(['d1', 'execute', 'nadi-marketplace-db', '--remote']), MutationGuardError);
  assert.throws(() => assertCommandSafe(['d1', 'execute', ISOLATED.D1_NAME]), MutationGuardError);               // missing --remote pin
  assert.throws(() => assertCommandSafe(['deploy', '--name', 'nadi-dispatch-api']), MutationGuardError);
  assert.throws(() => assertCommandSafe(['secret', 'put', 'X']), MutationGuardError);
  assert.throws(() => assertMutationPathSafe('POST', '/accounts/a/workers/scripts/nadi-dispatch-api/subdomain'), MutationGuardError);
  assert.throws(() => assertMutationPathSafe('DELETE', '/accounts/a/d1/database/fe5eba69-b654-40cb-bf80-4b9a37c03f0c'), MutationGuardError);   // deleting the D1 itself is not expressible
  assert.throws(() => assertMutationPathSafe('DELETE', `/accounts/a/workers/scripts/${ISOLATED.WORKER_NAME}`), MutationGuardError);              // deleting the Worker itself is not expressible
  assert.doesNotThrow(() => { for (const f of Object.values(CMD)) assertCommandSafe(f('0123456789abcdef')); });
});
