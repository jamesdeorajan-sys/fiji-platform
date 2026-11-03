// Staged remote-proof orchestrator (state machine). It talks ONLY to an injected `driver`; the real Cloudflare driver is never run in this package build.
//   preflight -> BEFORE snapshot -> isolated D1 identity -> [mutation begins] schema -> control secret -> deploy -> workers.dev ON
//   -> functional -> race 10 + checkpoint -> race 50 + checkpoint -> race 200 + checkpoint -> final invariant -> after evidence
//   -> teardown (7 ordered steps) -> post-teardown snapshot -> production diff -> verdict
// Any failure after mutation begins: failure evidence -> skip remaining stress stages -> teardown immediately -> post-teardown evidence -> diff -> FAILED/HOLD.
// Failure BEFORE mutation (preflight / BEFORE snapshot / identity): STOP, nothing was changed, no teardown needed.
import fs from 'node:fs'; import path from 'node:path';
import { ISOLATED } from '../src/safety.js';
import { verifyIsolatedD1, verifyIsolatedD1ByUuid, assertNoIdentityOverrides, PreconditionError } from './identity.mjs';
import { diffSnapshots } from './diff.mjs';

export const STAGES = Object.freeze([{ id: 'A', races: 10, file: '11-stage-A-10-races.json' }, { id: 'B', races: 50, file: '12-stage-B-50-races.json' }, { id: 'C', races: 200, file: '13-stage-C-200-races.json' }]);
export const TEARDOWN_STEPS = Object.freeze(['1_disable_workers_dev', '2_delete_control_secret', '3_remove_gate15_schema_and_data', '4_restore_zero_binding_shell', '5_verify_no_schedule_route_domain', '6_final_resource_evidence', '7_compare_production_before_after']);

export async function runStagedProof(driver, { outDir, env = process.env, log = () => {} } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const R = { verdict: null, reason: null, mutation_began: false, stages: {}, teardown: null, diff: null, steps: [] };
  const save = (name, obj) => fs.writeFileSync(path.join(outDir, name), JSON.stringify(obj, null, 2) + '\n');
  const step = (name, status, extra) => { R.steps.push({ name, status, at: new Date().toISOString(), ...(extra || {}) }); log(`${status.padEnd(7)} ${name}`); };
  let before = null, failure = null;

  // ---- phase 1: NO MUTATION POSSIBLE ----
  try {
    assertNoIdentityOverrides(env);
    const pf = await driver.preflight(); if (!pf || pf.ok !== true) throw new PreconditionError('PREFLIGHT_FAILED', JSON.stringify(pf && pf.problems));
    save('00-preflight.json', pf); step('preflight', 'ok');
  } catch (e) { return finish(R, save, 'STOPPED_NO_MUTATION', `preflight: ${e.message}`, step); }
  try {
    before = await driver.snapshot('before'); if (!before || before.ok !== true) throw new PreconditionError('BEFORE_SNAPSHOT_FAILED', JSON.stringify(before && before.missing));
    const shell = await driver.shellVersion(); if (!shell) throw new PreconditionError('SHELL_VERSION_UNKNOWN', 'cannot restore the zero-binding shell later without its version id');
    if ((before.isolated.bindings || []).length || before.isolated.workers_dev_enabled || (before.isolated.secrets || []).length || (before.isolated.schedules || []).length) throw new PreconditionError('ISOLATED_WORKER_NOT_IN_SHELL_STATE', 'refusing to start from a non-pristine isolated worker');
    before.isolated_shell_version = shell; save('01-before-snapshot.json', before); step('before_snapshot', 'ok');
  } catch (e) { return finish(R, save, 'STOPPED_NO_MUTATION', `before snapshot: ${e.message}`, step); }
  try {
    const byName = await driver.lookupD1ByName(); const a = verifyIsolatedD1(byName);
    const byId = await driver.lookupD1ByUuid(); const b = verifyIsolatedD1ByUuid(byId);
    if (a.uuid !== b.uuid || a.name !== b.name) throw new PreconditionError('D1_LOOKUPS_DISAGREE');
    save('02-d1-identity.json', { required: { name: ISOLATED.D1_NAME, uuid: ISOLATED.D1_UUID }, resolved: a, verified: true }); step('isolated_d1_identity', 'ok');
  } catch (e) { return finish(R, save, 'STOPPED_NO_MUTATION', `identity: ${e.message}`, step); }

  // ---- phase 2: MUTATION (isolated resources only). From the first call below, teardown is mandatory. ----
  R.mutation_began = true;
  const mut = async (name, fn) => { if (failure) return null; try { const out = await fn(); step(name, 'ok'); return out; } catch (e) { failure = { at: name, message: String(e.message || e).slice(0, 300) }; step(name, 'FAILED', { message: failure.message }); return null; } };
  await mut('apply_isolated_schema', () => driver.applySchema());
  await mut('create_isolated_control_secret', () => driver.createControlSecret());
  await mut('deploy_isolated_worker', () => driver.deployWorker());
  await mut('enable_workers_dev_isolated_only', () => driver.enableWorkersDev());
  const proof = async (name, file, opts) => mut(name, async () => { const r = await driver.runProof(opts); save(file, r); R.stages[name] = { ok: r.ok, checks_failed: r.checks_failed, checks_total: r.checks_total }; if (!r.ok) throw new Error(`assertions failed in ${name}: ${(r.failed_checks || []).slice(0, 3).join(' | ')}`); return r; });
  await proof('functional_proof', '10-functional.json', { phase: 'functional' });
  for (const s of STAGES) {
    if (failure) { step(`stage_${s.id}_${s.races}_races`, 'SKIPPED', { reason: `earlier failure at ${failure.at}` }); R.stages[`stage_${s.id}`] = { skipped: true }; continue; }
    await proof(`stage_${s.id}_${s.races}_races`, s.file, { phase: 'race', races: s.races, stage: s.id });
  }
  await proof('final_invariant_readback', '20-final-invariant.json', { phase: 'checkpoint', stage: 'FINAL' });

  // ---- phase 3: evidence + MANDATORY teardown (also after failure) ----
  const evTag = failure ? 'failure' : 'after';
  try { save(`21-${evTag}-evidence.json`, await driver.captureEvidence(evTag)); step(`${evTag}_evidence`, 'ok'); } catch (e) { step(`${evTag}_evidence`, 'FAILED', { message: String(e.message).slice(0, 200) }); }
  const td = []; const tstep = async (id, fn) => { try { const d = await fn(); td.push({ step: id, ok: true, ...(d || {}) }); step(`teardown_${id}`, 'ok'); return true; } catch (e) { td.push({ step: id, ok: false, message: String(e.message || e).slice(0, 300) }); step(`teardown_${id}`, 'FAILED', { message: String(e.message).slice(0, 200) }); return false; } };
  await tstep(TEARDOWN_STEPS[0], () => driver.disableWorkersDev());
  await tstep(TEARDOWN_STEPS[1], () => driver.deleteControlSecret());
  await tstep(TEARDOWN_STEPS[2], async () => { verifyIsolatedD1(await driver.lookupD1ByName()); verifyIsolatedD1ByUuid(await driver.lookupD1ByUuid()); return driver.removeSchema(); });   // identity re-verified before ANY teardown write
  await tstep(TEARDOWN_STEPS[3], () => driver.restoreShell(before.isolated_shell_version));
  await tstep(TEARDOWN_STEPS[4], async () => { const v = await driver.verifyNoScheduleRouteDomain(); if (!v.ok) throw new Error(JSON.stringify(v.problems)); return v; });
  let after = null; await tstep(TEARDOWN_STEPS[5], async () => { after = await driver.snapshot('after'); if (!after.ok) throw new Error(`post-teardown snapshot incomplete: ${JSON.stringify(after.missing)}`); save('31-post-teardown-snapshot.json', after); });
  await tstep(TEARDOWN_STEPS[6], async () => { if (!after) throw new Error('no post-teardown snapshot to compare'); R.diff = diffSnapshots(before, after); save('32-production-diff.json', R.diff); if (!R.diff.clean) throw new Error(`differences: ${R.diff.problems.join('; ')}`); });
  R.teardown = { steps: td, all_ok: td.every((t) => t.ok), order: td.map((t) => t.step) }; save('30-teardown.json', R.teardown);

  // ---- verdict ----
  let verdict, reason;
  if (!R.diff || !R.diff.production_untouched) { verdict = 'HOLD / INVESTIGATE'; reason = 'production-untouched could not be proven (unexplained difference or no comparison)'; }
  else if (failure) { verdict = 'FAILED/HOLD'; reason = `${failure.at}: ${failure.message}`; }
  else if (!R.teardown.all_ok || !R.diff.clean) { verdict = 'HOLD / INVESTIGATE'; reason = 'teardown or isolated-resource restoration incomplete'; }
  else { verdict = 'PASS'; reason = 'all stages green, teardown complete, production untouched'; }
  return finish(R, save, verdict, reason, step, failure);
}

function finish(R, save, verdict, reason, step, failure) {
  R.verdict = verdict; R.reason = reason; R.failure = failure || null; step('verdict', verdict, { reason });
  save('99-verdict.json', R); return R;
}
