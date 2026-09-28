import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv, synthGuest, seedActiveOffer } from './fixtures.mjs';
import worker from '../worker/worker.js';
installNetworkGuard();
async function call(env, path, body, token = env.MARAU_ADMIN_TEST_TOKEN) {
  const r = await worker.fetch(new Request('https://preview.test/preview/' + path, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  }), env);
  return { status: r.status, data: await r.json() };
}
async function request(env, offer) {
  const guest = await call(env, 'bookings', synthGuest());
  const r = await call(env, `deals/${offer.offer_id}/request`, null, guest.data.access_token);
  assert.ok(r.data.request_id);
  return r.data.request_id;
}
async function setup() {
  const env = makeEnv(); const { offer } = await seedActiveOffer(env);
  return { env, offer, id: await request(env, offer) };
}
const decide = (env, id, action) => call(env, `admin/deal-requests/${id}/${action}`);
function gate() {
  let release, reached; const ready = new Promise(r => reached = r); const wait = new Promise(r => release = r);
  return { ready, release, async pause() { reached(); await wait; } };
}
function pauseSQL(env, pattern) {
  const g = gate(); let used = false; const base = env.DB;
  function wrap(stmt, sql) {
    return { ...stmt, bind(...args) { return wrap(stmt.bind(...args), sql); }, async run() {
      if (!used && pattern.test(sql)) { used = true; await g.pause(); }
      return stmt.run();
    } };
  }
  return { ...g, env: { ...env, DB: { ...base, prepare(sql) { return wrap(base.prepare(sql), sql); } } } };
}
async function state(env, id, offer) {
  const one = (sql, ...args) => env.DB.prepare(sql).bind(...args).first();
  return {
    request: await one('SELECT * FROM deal_requests WHERE request_id=?', id),
    offer: await one('SELECT * FROM smart_offers WHERE offer_id=?', offer.offer_id),
    claim: await one('SELECT * FROM deal_decision_claims WHERE request_id=?', id),
    allocations: (await env.DB.prepare("SELECT * FROM vehicle_allocations WHERE subject_type='DEAL_REQUEST' AND subject_id=?").bind(id).all()).results,
    movements: (await env.DB.prepare('SELECT * FROM vehicle_time_claims WHERE claimed_by_request_id=?').bind(id).all()).results,
    journal: (await env.DB.prepare('SELECT * FROM confirmation_attempts WHERE request_id=? ORDER BY rowid').bind(id).all()).results
  };
}
function confirmed(s) {
  assert.equal(s.request.status, 'CONFIRMED'); assert.equal(s.offer.status, 'FILLED');
  assert.equal(s.allocations.length, 1); assert.equal(s.movements.length, 1); assert.ok(s.claim);
}
function rolledBack(s) {
  assert.equal(s.request.status, 'REQUESTED'); assert.equal(s.offer.status, 'ACTIVE');
  assert.equal(s.allocations.length, 0); assert.equal(s.movements.length, 0); assert.equal(s.claim, null);
}

test('same offer: recovery of a request that never held it cannot undo the confirmed owner', async () => {
  const { env, id, offer } = await setup(); const other = await request(env, offer);
  const g = gate(); const pending = decide({ ...env, __TEST_PAUSE_AFTER_CLAIM_BEFORE_JOURNAL__: g.pause }, id, 'confirm');
  await g.ready;
  try {
    assert.equal((await decide(env, other, 'confirm')).status, 200);
    const before = await state(env, other, offer);
    await decide(env, id, 'reconcile-confirmation');
    assert.deepEqual(await state(env, other, offer), before);
    confirmed(await state(env, other, offer));
  } finally { g.release(); await pending; }
});

test('stale recovery takeover cannot cross the committed confirmation boundary', async () => {
  const { env, id, offer } = await setup(); const g = gate();
  const original = decide({ ...env, __TEST_PAUSE_AFTER_HOLD__: g.pause }, id, 'confirm'); await g.ready;
  const p = pauseSQL(env, /UPDATE deal_decision_claims SET attempt_token/);
  const recovery = decide(p.env, id, 'reconcile-confirmation'); await p.ready;
  g.release(); assert.equal((await original).status, 200);
  const before = await state(env, id, offer);
  p.release(); await recovery;
  const s = await state(env, id, offer); confirmed(s); assert.equal(s.journal[0].phase, 'DONE');
  assert.deepEqual(s, before, 'even terminal decision ownership must remain unchanged');
});

test('staggered recovery cannot overwrite a completed journal after losing ownership', async () => {
  const { env, id, offer } = await setup(); const g = gate();
  const original = decide({ ...env, __TEST_PAUSE_AFTER_HOLD__: g.pause }, id, 'confirm'); await g.ready;
  const p = pauseSQL(env, /UPDATE confirmation_attempts SET phase\s*=\s*(?:'ROLLED_BACK'|\?)/);
  const first = decide(p.env, id, 'reconcile-confirmation'); await p.ready;
  try {
    assert.equal((await decide(env, id, 'reconcile-confirmation')).data.resolved, 'ROLLED_BACK_TO_REQUESTED');
    assert.equal((await decide(env, id, 'confirm')).status, 200);
    const before = await state(env, id, offer);
    p.release(); const result = await first;
    assert.notEqual(result.data.resolved, 'ROLLED_BACK_TO_REQUESTED');
    assert.deepEqual(await state(env, id, offer), before);
  } finally { p.release(); g.release(); await original; }
});

test('recovery committing confirmation reports success even if the DONE audit fails', async () => {
  const { env, id, offer } = await setup();
  const p = pauseSQL(env, /UPDATE deal_requests SET status = 'CONFIRMED'/);
  const original = decide(p.env, id, 'confirm'); await p.ready;
  env.DB.exec("CREATE TRIGGER fail_done BEFORE UPDATE ON confirmation_attempts WHEN NEW.phase='DONE' BEGIN SELECT RAISE(ABORT,'blocked'); END;");
  try {
    const recovery = await decide(env, id, 'reconcile-confirmation');
    assert.equal(recovery.status, 200); assert.equal(recovery.data.resolved, 'CONFIRMED'); assert.ok(recovery.data.audit_warning);
    confirmed(await state(env, id, offer));
    env.DB.exec('DROP TRIGGER fail_done');
    assert.equal((await decide(env, id, 'reconcile-confirmation')).data.audit_repaired, true);
    assert.equal((await state(env, id, offer)).journal[0].phase, 'DONE');
  } finally { p.release(); await original; }
});

test('failed rollback journal write retains stable identity and can be retried', async () => {
  const { env, id, offer } = await setup(); const g = gate();
  const original = decide({ ...env, __TEST_PAUSE_AFTER_HOLD__: g.pause }, id, 'confirm'); await g.ready;
  env.DB.exec("CREATE TRIGGER fail_rollback_audit BEFORE UPDATE ON confirmation_attempts WHEN NEW.phase='ROLLED_BACK' BEGIN SELECT RAISE(ABORT,'blocked'); END;");
  try {
    await decide(env, id, 'reconcile-confirmation');
    const interrupted = await state(env, id, offer);
    assert.ok(interrupted.claim); assert.equal(interrupted.claim.journal_attempt_id, interrupted.journal[0].attempt_id);
    env.DB.exec('DROP TRIGGER fail_rollback_audit');
    assert.equal((await decide(env, id, 'reconcile-confirmation')).data.resolved, 'ROLLED_BACK_TO_REQUESTED');
    const s = await state(env, id, offer); rolledBack(s); assert.equal(s.journal[0].phase, 'ROLLED_BACK');
  } finally { g.release(); await original; }
});

test('zero affected audit rows are reported and terminal repair never falsely succeeds', async () => {
  const { env, id, offer } = await setup();
  env.DB.exec("CREATE TRIGGER ignore_done BEFORE UPDATE ON confirmation_attempts WHEN NEW.phase='DONE' BEGIN SELECT RAISE(IGNORE); END;");
  const result = await decide(env, id, 'confirm');
  assert.equal(result.status, 200); assert.ok(result.data.audit_warning); confirmed(await state(env, id, offer));
  const repair = await decide(env, id, 'reconcile-confirmation');
  assert.notEqual(repair.data.audit_repaired, true); assert.ok(repair.data.audit_warning);
  confirmed(await state(env, id, offer));
});

test('staggered recovery final-status write cannot claim success after a newer recovery commits', async () => {
  const { env, id, offer } = await setup();
  const originalPause = pauseSQL(env, /UPDATE deal_requests SET status = 'CONFIRMED'/);
  const original = decide(originalPause.env, id, 'confirm'); await originalPause.ready;
  const recoveryPause = pauseSQL(env, /UPDATE deal_requests SET status = 'CONFIRMED'/);
  const first = decide(recoveryPause.env, id, 'reconcile-confirmation'); await recoveryPause.ready;
  try {
    assert.equal((await decide(env, id, 'reconcile-confirmation')).data.resolved, 'CONFIRMED');
    const before = await state(env, id, offer); confirmed(before);
    recoveryPause.release();
    assert.notEqual((await first).data.resolved, 'CONFIRMED');
    assert.deepEqual(await state(env, id, offer), before);
  } finally { recoveryPause.release(); originalPause.release(); await original; }
});

test('silently ignored compensation cannot free the claim or report rollback success', async () => {
  const { env, id, offer } = await setup(); const g = gate();
  const original = decide({ ...env, __TEST_PAUSE_AFTER_HOLD__: g.pause }, id, 'confirm'); await g.ready;
  env.DB.exec("CREATE TRIGGER ignore_revert BEFORE UPDATE ON smart_offers WHEN OLD.status='HELD' AND NEW.status='ACTIVE' BEGIN SELECT RAISE(IGNORE); END;");
  try {
    assert.equal((await decide(env, id, 'reconcile-confirmation')).status, 500);
    const s = await state(env, id, offer);
    assert.equal(s.request.status, 'REQUESTED'); assert.equal(s.offer.status, 'HELD');
    assert.equal(s.allocations.length, 0); assert.equal(s.movements.length, 0);
    assert.ok(s.claim); assert.equal(s.claim.journal_attempt_id, s.journal[0].attempt_id);
    assert.equal(s.journal[0].phase, 'ROLLBACK_FAILED');
    env.DB.exec('DROP TRIGGER ignore_revert');
    assert.equal((await decide(env, id, 'reconcile-confirmation')).data.resolved, 'ROLLED_BACK_TO_REQUESTED');
    rolledBack(await state(env, id, offer));
  } finally { g.release(); await original; }
});

test('missing journal never hides owned HELD resources', async () => {
  const { env, id, offer } = await setup(); const g = gate();
  const original = decide({ ...env, __TEST_PAUSE_AFTER_HOLD__: g.pause }, id, 'confirm'); await g.ready;
  env.DB.exec('DELETE FROM confirmation_attempts');
  try {
    assert.equal((await decide(env, id, 'reconcile-confirmation')).data.resolved, 'ROLLED_BACK_TO_REQUESTED');
    rolledBack(await state(env, id, offer));
  } finally { g.release(); await original; }
});

test('legacy HELD offer without provable resource ownership stays flagged for manual recovery', async () => {
  const { env, id, offer } = await setup(); const g = gate();
  const original = decide({ ...env, __TEST_PAUSE_AFTER_HOLD__: g.pause }, id, 'confirm'); await g.ready;
  env.DB.exec('UPDATE smart_offers SET marau_attempt_id=NULL');
  try {
    const result = await decide(env, id, 'reconcile-confirmation');
    assert.equal(result.status, 500); assert.equal(result.data.reconciliation_needed, true);
    const s = await state(env, id, offer);
    assert.equal(s.request.status, 'REQUESTED'); assert.equal(s.offer.status, 'HELD'); assert.ok(s.claim);
    assert.equal(s.allocations.length, 0); assert.equal(s.movements.length, 0);
    assert.equal(s.journal[0].phase, 'ROLLBACK_FAILED');
  } finally { g.release(); await original; }
});

test('superseded decline cannot delete the recovery owner’s terminal decision claim', async () => {
  const { env, id, offer } = await setup();
  const p = pauseSQL(env, /UPDATE deal_requests SET status = 'DECLINED'/);
  const original = decide(p.env, id, 'decline'); await p.ready;
  assert.equal((await decide(env, id, 'reconcile-confirmation')).data.resolved, 'DECLINED');
  const before = await state(env, id, offer);
  p.release(); assert.equal((await original).status, 409);
  assert.deepEqual(await state(env, id, offer), before);
  assert.equal(before.request.status, 'DECLINED'); assert.equal(before.offer.status, 'ACTIVE');
  assert.equal(before.allocations.length, 0); assert.equal(before.movements.length, 0); assert.ok(before.claim);
});
