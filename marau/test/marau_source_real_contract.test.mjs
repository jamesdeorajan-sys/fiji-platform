/* Marau (PREVIEW/TEST ONLY) - the confirm flow proven against the PROPOSED REAL source contract.
 *
 * Evidence label: LOCAL, AUTHOR-RUN. Marau's real handler (POST .../source-api-confirm) calls the REAL nadi-dispatch-api
 * worker.js - the file on branch ceo/nadi-source-confirm-attempt-identity (0d0976e) - executed IN-PROCESS over an
 * in-memory SQLite with the real schema and migrations through milestone38. Nothing here reaches a network, a hosted
 * database, a production Worker, or Meta. That branch is NOT deployed and milestone38 is NOT applied anywhere, so this is
 * a contract proof, not an integration: the synthetic source is still the only source the preview ever uses.
 *
 * The real worker is located via NADI_REAL_WORKER_DIR (the `nadi-marketplace` directory of that branch). When it is not
 * present the whole file is skipped (and says so) rather than silently passing.
 *
 * Proves, against the real contract: authenticated staff identity (operator comes from Marau's staff token, never the
 * request body, and is recorded at the source as service-asserted), lost-response recovery (with and without an
 * available readback), cross-caller retries, concurrent confirmation, cancellation, progressed bookings, an undeployed
 * contract, a wrong credential, and that no guest data crosses back. Source confirmation stays separate from Marau's
 * local ledger throughout.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv } from './fixtures.mjs';
import marauWorker from '../worker/worker.js';

const guardFetch = installNetworkGuard();

const REAL_DIR = process.env.NADI_REAL_WORKER_DIR || 'C:/Users/James/AppData/Local/Temp/nadi-attempt-identity/nadi-marketplace';
const REAL_PRESENT = existsSync(path.join(REAL_DIR, 'worker', 'worker.js')) && existsSync(path.join(REAL_DIR, 'migrations', 'milestone38-confirmation-attempt-identity.sql'));
const SKIP = REAL_PRESENT ? false : `real worker not found at ${REAL_DIR} (set NADI_REAL_WORKER_DIR)`;
const realWorker = REAL_PRESENT ? (await import(pathToFileURL(path.join(REAL_DIR, 'worker', 'worker.js')).href)).default : null;

const REAL_ADMIN = 'real-source-admin-token';
const GUEST_TEMPLATE = 'vakaviti_guest_driver_assigned';
const BASE_MIGRATIONS = [
  'milestone34-booking-idempotency-and-contact-fields.sql',
  'milestone35-revenue-attribution.sql',
  'milestone36-admin-notification-retry-state.sql',
  'milestone37-driver-broadcast-claim-state.sql',
];

function d1Shim(db) {
  return {
    prepare(sql) {
      let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        async first() { const r = db.prepare(sql).get(...args); return r === undefined ? null : r; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async run() { const i = db.prepare(sql).run(...args); return { meta: { changes: i.changes, last_row_id: i.lastInsertRowid } }; },
      };
      return api;
    },
  };
}

function makeRealEnv({ withIdentityMigration = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(path.join(REAL_DIR, 'schema.sql'), 'utf8'));
  for (const f of BASE_MIGRATIONS) db.exec(readFileSync(path.join(REAL_DIR, 'migrations', f), 'utf8'));
  if (withIdentityMigration) db.exec(readFileSync(path.join(REAL_DIR, 'migrations', 'milestone38-confirmation-attempt-identity.sql'), 'utf8'));
  db.prepare(`UPDATE platform_settings SET value = ? WHERE key = 'admin_alert_phone'`).run('+6799999999');
  const drivers = [];
  for (const [i, n] of ['Alpha', 'Bravo'].entries()) {
    drivers.push(Number(db.prepare(`INSERT INTO drivers (name, phone, status, zones, online) VALUES (?, ?, 'verified', ?, 1)`).run(`Driver ${n}`, `+679900000${i}`, JSON.stringify(['Nadi Airport'])).lastInsertRowid));
  }
  return { db, drivers, env: { DB: d1Shim(db), ADMIN_TOKEN: REAL_ADMIN, WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: 'p', HEALTH_ALERT_SEND_TIMEOUT_MS: '60' } };
}

function ctx() { const jobs = []; return { waitUntil: (p) => jobs.push(p), flush: () => Promise.all(jobs.splice(0)) }; }

// Real-worker Meta stub: counts the guest "driver assigned" template precisely.
function installMetaStub() {
  const sends = [];
  globalThis.fetch = async (_u, opts) => {
    let name = 'unknown';
    try { name = JSON.parse(opts.body).template.name; } catch { /* ignore */ }
    sends.push(name);
    return { ok: true, status: 200, text: async () => JSON.stringify({ messages: [{ id: 'wamid.T' }] }) };
  };
  return { guestSends: () => sends.filter((n) => n === GUEST_TEMPLATE).length, restore: () => { globalThis.fetch = guardFetch; } };
}

let refN = 0;
async function createRealBooking(real) {
  const c = ctx();
  const res = await realWorker.fetch(new Request('https://real.test/bookings', {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
    body: JSON.stringify({ guest_name: 'Synthetic Guest', guest_phone: '+6799112233', guest_email: 'synthetic.guest@example.test', pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan', quoted_currency: 'FJD', quoted_amount: 49, payment_method: 'cash', pickup_date: '2026-10-20', pickup_time: '09:30', client_booking_ref: `FD-CT${++refN}` }),
  }), real.env, c);
  await c.flush();
  assert.equal(res.status, 201);
  return (await res.json()).booking_id;
}

// Marau -> real worker transport. `hooks` can change what Marau sees AFTER the real worker has already acted.
function makeTransport(real, hooks = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const kind = init.method === 'POST' ? 'confirm' : 'readback';
    calls.push(kind);
    if (hooks.before) await hooks.before(kind, calls.filter((k) => k === kind).length);
    const c = ctx();
    const res = await realWorker.fetch(new Request(`https://real.test${u.pathname}`, { method: init.method, headers: init.headers, body: init.body }), real.env, c);
    await c.flush();
    if (hooks.after) await hooks.after(kind, calls.filter((k) => k === kind).length, res); // may throw: response "lost" AFTER commit
    return res;
  };
  return { fetchImpl, calls };
}

function marauSetup(real, hooks) {
  const env = makeEnv();
  const transport = makeTransport(real, hooks);
  env.NADI_SOURCE_BASE_URL = 'https://real.test';
  env.NADI_SOURCE_ADMIN_TOKEN = REAL_ADMIN;
  env.NADI_SOURCE_FETCH = transport.fetchImpl;
  return { env, transport };
}

async function seedStaff(env, token, name) {
  await marauWorker.fetch(new Request('http://marau.test/preview/admin/staff-identities', { method: 'POST', headers: { authorization: `Bearer ${env.MARAU_ADMIN_TEST_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ token, operator_name: name }) }), env);
}

async function marauConfirm(env, ref, { staffToken, driverId, spoofedOperator }) {
  const headers = { authorization: `Bearer ${env.MARAU_ADMIN_TEST_TOKEN}`, 'content-type': 'application/json' };
  if (staffToken) headers['x-marau-staff-token'] = staffToken;
  const body = { driver_id: String(driverId) };
  if (spoofedOperator) body.operator = spoofedOperator;
  const res = await marauWorker.fetch(new Request(`http://marau.test/preview/admin/synthetic-source/${ref}/source-api-confirm`, { method: 'POST', headers, body: JSON.stringify(body) }), env);
  const text = await res.text();
  return { status: res.status, data: JSON.parse(text), text };
}

const realRow = (real, id) => ({ ...real.db.prepare('SELECT status, assigned_driver_id, confirmation_attempt_id, confirmed_operator, confirmed_operator_attestation FROM bookings WHERE id = ?').get(id) });
const acceptedEvents = (real, id) => real.db.prepare(`SELECT COUNT(*) n FROM booking_events WHERE booking_id = ? AND event_type = 'accepted'`).get(id).n;
const ledger = async (env, ref) => env.DB.prepare('SELECT * FROM marau_source_confirm_outcomes WHERE source_booking_ref = ?').bind(ref).first();

async function scenario(options, fn) {
  const real = makeRealEnv(options);
  const meta = installMetaStub();
  try { await fn(real, meta); } finally { meta.restore(); }
}

// ---------------------------------------------------------------------------------------------------------------

test('staff identity end to end: the operator comes from Marau\'s authenticated staff token (a spoofed body field is ignored), is recorded at the real source as service-asserted, and the guest is notified once', { skip: SKIP }, async () => {
  await scenario({}, async (real, meta) => {
    const id = await createRealBooking(real);
    const { env } = marauSetup(real);
    await seedStaff(env, 'staff-tok-ana', 'Ana (ops)');

    const noStaff = await marauConfirm(env, String(id), { driverId: real.drivers[0] });
    assert.equal(noStaff.status, 401);
    assert.equal(realRow(real, id).status, 'pending', 'no staff identity -> nothing reaches the source');

    const res = await marauConfirm(env, String(id), { staffToken: 'staff-tok-ana', driverId: real.drivers[0], spoofedOperator: 'Impersonated Name' });
    assert.equal(res.status, 200);
    assert.equal(res.data.source_kind, 'proposed-real-contract');
    assert.equal(res.data.status, 'confirmed');
    assert.equal(res.data.operator, 'Ana (ops)');

    const src = realRow(real, id);
    assert.equal(src.status, 'accepted');
    assert.equal(src.assigned_driver_id, real.drivers[0]);
    assert.equal(src.confirmed_operator, 'Ana (ops)');
    assert.equal(src.confirmed_operator_attestation, 'service-asserted');
    assert.equal(src.confirmation_attempt_id, (await ledger(env, String(id))).attempt_id, 'the source holds the very attempt id Marau reserved locally');
    assert.equal(acceptedEvents(real, id), 1);
    assert.equal(meta.guestSends(), 1);
    assert.equal(res.text.includes('Synthetic Guest') || res.text.includes('+6799112233') || res.text.includes('synthetic.guest@example.test'), false, 'no guest data crosses back into Marau');
  });
});

test('LOST RESPONSE with a working readback: the source committed, Marau never saw the answer, recovers the original decision, and a retry by a different staff member changes nothing', { skip: SKIP }, async () => {
  await scenario({}, async (real, meta) => {
    const id = await createRealBooking(real);
    const { env } = marauSetup(real, { after: async (kind, n) => { if (kind === 'confirm' && n === 1) throw new Error('SIMULATED_RESPONSE_LOSS_AFTER_COMMIT'); } });
    await seedStaff(env, 'staff-tok-ana', 'Ana (ops)');
    await seedStaff(env, 'staff-tok-bala', 'Bala (ops)');

    const first = await marauConfirm(env, String(id), { staffToken: 'staff-tok-ana', driverId: real.drivers[0] });
    assert.equal(first.status, 200);
    assert.equal(first.data.status, 'confirmed');
    assert.equal(first.data.recovered_via_readback, true);
    assert.equal(first.data.operator, 'Ana (ops)');

    const retry = await marauConfirm(env, String(id), { staffToken: 'staff-tok-bala', driverId: real.drivers[1] });
    assert.equal(retry.data.operator, 'Ana (ops)');
    assert.equal(retry.data.confirmed_driver_id, String(real.drivers[0]));

    const src = realRow(real, id);
    assert.equal(src.assigned_driver_id, real.drivers[0]);
    assert.equal(src.confirmed_operator, 'Ana (ops)');
    assert.equal(acceptedEvents(real, id), 1);
    assert.equal(meta.guestSends(), 1, 'no duplicate notification');
  });
});

test('LOST RESPONSE and an UNAVAILABLE readback: reported honestly as unresolved; a later retry by someone else resumes the SAME attempt and the source replays it - original operator, no duplicate effects', { skip: SKIP }, async () => {
  await scenario({}, async (real, meta) => {
    const id = await createRealBooking(real);
    let sourceReachable = false; // the first confirm commits, then BOTH its response and the readback are lost
    const { env, transport } = marauSetup(real, {
      after: async (kind, n) => {
        if (kind === 'confirm' && n === 1) throw new Error('SIMULATED_RESPONSE_LOSS_AFTER_COMMIT');
        if (kind === 'readback' && !sourceReachable) throw new Error('SOURCE_READBACK_UNAVAILABLE');
      },
    });
    await seedStaff(env, 'staff-tok-ana', 'Ana (ops)');
    await seedStaff(env, 'staff-tok-bala', 'Bala (ops)');

    const first = await marauConfirm(env, String(id), { staffToken: 'staff-tok-ana', driverId: real.drivers[0] });
    assert.equal(first.status, 202);
    assert.equal(first.data.status, 'unresolved');
    assert.equal((await ledger(env, String(id))).status, 'reserved');
    assert.equal(realRow(real, id).status, 'accepted', 'the source DID commit - Marau simply cannot see it yet');

    sourceReachable = true;
    const retry = await marauConfirm(env, String(id), { staffToken: 'staff-tok-bala', driverId: real.drivers[1] });
    assert.equal(retry.status, 200);
    assert.equal(retry.data.status, 'confirmed');
    assert.equal(retry.data.operator, 'Ana (ops)', 'the retrying staff member never replaces the original attribution');
    assert.equal(retry.data.confirmed_driver_id, String(real.drivers[0]));
    assert.equal(transport.calls.filter((k) => k === 'confirm').length, 2, 'the retry re-submitted the SAME attempt; the source answered it as a replay');

    assert.equal(acceptedEvents(real, id), 1);
    assert.equal(meta.guestSends(), 1);
    assert.equal(realRow(real, id).confirmed_operator, 'Ana (ops)');
  });
});

test('CONCURRENT confirmations by two staff members converge: one local reservation, one real decision, one event, one guest notification, one operator', { skip: SKIP }, async () => {
  await scenario({}, async (real, meta) => {
    const id = await createRealBooking(real);
    const { env } = marauSetup(real);
    await seedStaff(env, 'staff-tok-ana', 'Ana (ops)');
    await seedStaff(env, 'staff-tok-bala', 'Bala (ops)');

    const [a, b] = await Promise.all([
      marauConfirm(env, String(id), { staffToken: 'staff-tok-ana', driverId: real.drivers[0] }),
      marauConfirm(env, String(id), { staffToken: 'staff-tok-bala', driverId: real.drivers[1] }),
    ]);
    assert.equal(a.data.status, 'confirmed');
    assert.equal(b.data.status, 'confirmed');
    assert.equal(a.data.operator, b.data.operator, 'both callers see the same single attribution');
    assert.equal(a.data.confirmed_driver_id, b.data.confirmed_driver_id);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM marau_source_confirm_outcomes WHERE source_booking_ref = ?').bind(String(id)).first();
    assert.equal(rows.n, 1);
    assert.equal(acceptedEvents(real, id), 1);
    assert.equal(meta.guestSends(), 1);
    assert.equal(realRow(real, id).confirmed_operator, a.data.operator);
  });
});

test('CANCELLATION: cancelled in the window between commit and recovery is reported source_cancelled (never confirmed); a booking cancelled beforehand is not confirmable', { skip: SKIP }, async () => {
  await scenario({}, async (real, meta) => {
    const racing = await createRealBooking(real);
    const { env } = marauSetup(real, {
      after: async (kind, n) => {
        if (kind === 'confirm' && n === 1) {
          const c = ctx();
          await realWorker.fetch(new Request(`https://real.test/admin/bookings/${racing}/cancel`, { method: 'POST', headers: { authorization: `Bearer ${REAL_ADMIN}`, 'content-type': 'application/json' }, body: '{}' }), real.env, c);
          await c.flush();
          throw new Error('SIMULATED_RESPONSE_LOSS_AFTER_CANCELLATION');
        }
      },
    });
    await seedStaff(env, 'staff-tok-ana', 'Ana (ops)');
    const res = await marauConfirm(env, String(racing), { staffToken: 'staff-tok-ana', driverId: real.drivers[0] });
    assert.equal(res.data.status, 'source_cancelled');
    assert.equal(res.data.ok, false);
    assert.equal(realRow(real, racing).status, 'cancelled');
    assert.equal(realRow(real, racing).assigned_driver_id, real.drivers[0], 'the cancelled booking still carries its driver - status is what must be trusted');

    const before = await createRealBooking(real);
    const c = ctx();
    await realWorker.fetch(new Request(`https://real.test/admin/bookings/${before}/cancel`, { method: 'POST', headers: { authorization: `Bearer ${REAL_ADMIN}`, 'content-type': 'application/json' }, body: '{}' }), real.env, c);
    const res2 = await marauConfirm(env, String(before), { staffToken: 'staff-tok-ana', driverId: real.drivers[0] });
    assert.equal(res2.data.status, 'source_cancelled');
    assert.equal(realRow(real, before).confirmation_attempt_id, null);
    assert.equal(meta.guestSends(), 1, 'only the first booking was ever confirmed and notified');
  });
});

test('PROGRESSED bookings: confirmed, then en_route / completed before Marau recovers - still reported as the confirmation that happened', { skip: SKIP }, async () => {
  for (const advanced of ['en_route', 'completed']) {
    await scenario({}, async (real) => {
      const id = await createRealBooking(real);
      const { env } = marauSetup(real, {
        after: async (kind, n) => {
          if (kind === 'confirm' && n === 1) {
            real.db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(advanced, id);
            throw new Error('SIMULATED_RESPONSE_LOSS_AFTER_PROGRESSION');
          }
        },
      });
      await seedStaff(env, 'staff-tok-ana', 'Ana (ops)');
      const res = await marauConfirm(env, String(id), { staffToken: 'staff-tok-ana', driverId: real.drivers[0] });
      assert.equal(res.data.status, 'confirmed', `a booking now ${advanced} was still confirmed through this attempt`);
      assert.equal(res.data.operator, 'Ana (ops)');
      assert.equal(realRow(real, id).status, advanced, 'current status is the source\'s own - historical outcome and current status are distinct');
    });
  }
});

test('the contract NOT deployed (no milestone38): Marau reports unresolved, nothing is assigned at the source, nothing is notified', { skip: SKIP }, async () => {
  await scenario({ withIdentityMigration: false }, async (real, meta) => {
    const id = await createRealBooking(real);
    const { env } = marauSetup(real);
    await seedStaff(env, 'staff-tok-ana', 'Ana (ops)');
    const res = await marauConfirm(env, String(id), { staffToken: 'staff-tok-ana', driverId: real.drivers[0] });
    assert.equal(res.status, 202);
    assert.equal(res.data.status, 'unresolved');
    assert.equal(real.db.prepare('SELECT status FROM bookings WHERE id = ?').get(id).status, 'pending');
    assert.equal(meta.guestSends(), 0);
  });
});

test('a wrong source credential is unresolved, not a guessed outcome - nothing is assigned', { skip: SKIP }, async () => {
  await scenario({}, async (real, meta) => {
    const id = await createRealBooking(real);
    const { env } = marauSetup(real);
    env.NADI_SOURCE_ADMIN_TOKEN = 'wrong-token';
    await seedStaff(env, 'staff-tok-ana', 'Ana (ops)');
    const res = await marauConfirm(env, String(id), { staffToken: 'staff-tok-ana', driverId: real.drivers[0] });
    assert.equal(res.status, 202);
    assert.equal(res.data.status, 'unresolved');
    assert.equal(realRow(real, id).status, 'pending');
    assert.equal(meta.guestSends(), 0);
  });
});

test('without NADI_SOURCE_BASE_URL the preview still uses the SYNTHETIC source and says so', async () => {
  const env = makeEnv();
  await marauWorker.fetch(new Request('http://marau.test/preview/admin/synthetic-source', { method: 'POST', headers: { authorization: `Bearer ${env.MARAU_ADMIN_TEST_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ source_booking_ref: 'syn-1', id: 1, guest_email: 'a@example.test', guest_phone: '+15005550001', pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'Sedan', pickup_date: '2026-11-01', pickup_time: '09:00', status: 'pending' }) }), env);
  await seedStaff(env, 'staff-tok-ana', 'Ana (ops)');
  const res = await marauConfirm(env, 'syn-1', { staffToken: 'staff-tok-ana', driverId: 'drv_1' });
  assert.equal(res.data.source_kind, 'synthetic');
});
