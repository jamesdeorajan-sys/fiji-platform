// TEST-CONTROL surface for the isolated proof ONLY. Closed by default (404) unless the isolated Worker has its own GATE15_CONTROL_TOKEN secret.
// It can only create/inspect/delete SYNTHETIC rows in the isolated D1 (booking ids >= 9,000,000,000, refs SYN-GATE1-). It never sends anything.
import { SYNTHETIC_BOOKING_ID_FLOOR, SYNTHETIC_REF_PREFIX } from '../../src/constants.js';
import { ISOLATED, EXPECTED_TABLES } from './safety.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const CANARY = { name: 'CANARY-GUEST-NAME-Zxq', phone: '+000-CANARY-PHONE-7788', email: 'canary-guest@example.invalid', flight: 'CANARY-FJ-999', notes: 'CANARY-NOTE-meet-at-pillar-9' };
const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
const iso = (ms) => new Date(ms).toISOString();

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
}

export async function handleControl(request, env, service) {
  const url = new URL(request.url); const db = env.DB;
  if (!env.GATE15_CONTROL_TOKEN) return json({ ok: false, code: 'NOT_FOUND' }, 404);                       // closed by default
  if (!safeEqual(request.headers.get('x-gate15-control') || '', env.GATE15_CONTROL_TOKEN)) return json({ ok: false, code: 'NOT_FOUND' }, 404);
  const op = url.pathname.replace(/^\/__gate15\//, '');
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const one = (sql, ...b) => db.prepare(sql).bind(...b).first();
  const all = async (sql, ...b) => (await db.prepare(sql).bind(...b).all()).results;
  const exec = (sql, ...b) => db.prepare(sql).bind(...b).run();

  // ---- identity / schema ----
  if (op === 'identity') {
    const id = await one(`SELECT marker, worker_name FROM gate15_identity WHERE id = 1`);
    const tables = (await all(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)).map((r) => r.name);
    return json({ ok: true, expected_worker: ISOLATED.WORKER_NAME, expected_d1_name: ISOLATED.D1_NAME, identity_row: id, tables, expected_tables: EXPECTED_TABLES, env_keys: Object.keys(env).sort(), server_now: iso(Date.now()) });
  }

  // ---- fixture lifecycle ----
  if (op === 'reset') {
    await db.batch([
      db.prepare(`DELETE FROM wallet_transactions`), db.prepare(`DELETE FROM driver_evidence`), db.prepare(`DELETE FROM driver_offers`), db.prepare(`DELETE FROM driver_broadcast_attempts`),
      db.prepare(`DELETE FROM dispatch_escalations`), db.prepare(`DELETE FROM dispatch_runs`), db.prepare(`DELETE FROM booking_events`), db.prepare(`DELETE FROM bookings`),
      db.prepare(`DELETE FROM driver_sessions`), db.prepare(`DELETE FROM wallets`), db.prepare(`DELETE FROM drivers`), db.prepare(`DELETE FROM gate15_capture`),
      db.prepare(`DELETE FROM gate15_probe`), db.prepare(`DELETE FROM gate15_meta`), db.prepare(`DROP TRIGGER IF EXISTS gate15_fault_assign`),
    ]);
    return json({ ok: true });
  }
  if (op === 'seed') {
    const n = Math.min(Math.max(Number(body.drivers) || 6, 2), 12);
    if ((await one(`SELECT COUNT(*) AS c FROM drivers`)).c) return json({ ok: false, code: 'ALREADY_SEEDED' }, 409);
    const t0 = iso(Date.now()); const tokens = {}; const stmts = [];
    for (let id = 1; id <= n; id++) {
      const tok = `tok-gate15-${id}-${hex(12)}`; tokens[id] = tok;
      stmts.push(db.prepare(`INSERT INTO drivers (id,name,phone,status,zones,online,created_at) VALUES (?,?,?,?,?,?,?)`).bind(id, id === 1 ? 'Gate1 Test Driver 1' : `Gate1 Synthetic Driver ${id}`, id === 1 ? '+000-GATE1-PLACEHOLDER-1' : `+000-GATE1-SYNTH-${id}`, 'verified', JSON.stringify(['Nadi Airport']), 1, t0));
      stmts.push(db.prepare(`INSERT INTO driver_sessions (token,driver_id,expires_at,last_seen_at) VALUES (?,?,?,NULL)`).bind(tok, id, iso(Date.now() + 86_400_000)));
      stmts.push(db.prepare(`INSERT INTO wallets (driver_id,balance_fjd) VALUES (?,?)`).bind(id, 100 + id));
    }
    await db.batch(stmts);
    const baseline = JSON.stringify(await all(`SELECT * FROM wallets ORDER BY driver_id`));
    await exec(`INSERT OR REPLACE INTO gate15_meta (k, v) VALUES ('wallet_baseline', ?)`, baseline);
    await exec(`INSERT OR REPLACE INTO gate15_meta (k, v) VALUES ('delivery_mode', 'DELIVERED')`);
    return json({ ok: true, drivers: n, tokens });
  }
  if (op === 'tokens') { const t = {}; for (const r of await all(`SELECT driver_id, token FROM driver_sessions ORDER BY driver_id`)) t[r.driver_id] = r.token; return json({ ok: true, tokens: t }); }
  if (op === 'delivery-mode') { await exec(`INSERT OR REPLACE INTO gate15_meta (k, v) VALUES ('delivery_mode', ?)`, ['DELIVERED', 'NO_RECEIPT', 'PROVIDER_ERROR'].includes(body.mode) ? body.mode : 'DELIVERED'); return json({ ok: true }); }
  if (op === 'fault') {                                                                                      // audit-atomicity probe: make the critical DRIVER_ASSIGNED audit insert fail inside the real batch
    await exec(`DROP TRIGGER IF EXISTS gate15_fault_assign`);
    const evt = String(body.event_type || 'DRIVER_ASSIGNED'); if (!/^[A-Z_]{3,40}$/.test(evt)) return json({ ok: false, code: 'BAD_EVENT_TYPE' }, 400);
    if (body.arm) await exec(`CREATE TRIGGER gate15_fault_assign BEFORE INSERT ON booking_events WHEN NEW.event_type = '${evt}' BEGIN SELECT RAISE(ABORT, 'GATE15_INJECTED_AUDIT_FAILURE'); END`);
    return json({ ok: true, armed: !!body.arm });
  }

  // ---- synthetic bookings / time shaping (data-level time travel: the Worker still judges everything on its REAL clock) ----
  async function shift(bookingId, seconds) {
    const ms = Math.round(seconds * 1000); if (!ms) return;
    const run = await one(`SELECT started_at FROM dispatch_runs WHERE booking_id = ?`, bookingId);
    const stmts = [db.prepare(`UPDATE dispatch_runs SET started_at = ? WHERE booking_id = ?`).bind(iso(Date.parse(run.started_at) - ms), bookingId)];
    for (const o of await all(`SELECT offer_id, offered_at, expires_at FROM driver_offers WHERE booking_id = ?`, bookingId))
      stmts.push(db.prepare(`UPDATE driver_offers SET offered_at = ?, expires_at = ? WHERE offer_id = ?`).bind(iso(Date.parse(o.offered_at) - ms), iso(Date.parse(o.expires_at) - ms), o.offer_id));
    await db.batch(stmts);
  }
  const openOffers = (bookingId) => all(`SELECT driver_id, offer_id, state, dispatch_phase FROM driver_offers WHERE booking_id = ? ORDER BY driver_id`, bookingId);

  if (op === 'new-booking') {
    const next = (await one(`SELECT COALESCE(MAX(id), ?) + 1 AS id FROM bookings`, SYNTHETIC_BOOKING_ID_FLOOR)).id;
    await exec(`INSERT INTO bookings (id,booking_ref,guest_name,guest_phone,guest_email,flight_number,pickup_notes,pickup_zone,destination_zone,distance_km,vehicle_type,quoted_currency,quoted_amount,payment_method,status,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)`,
      next, `${SYNTHETIC_REF_PREFIX}${String(next - SYNTHETIC_BOOKING_ID_FLOOR).padStart(6, '0')}-${hex(3)}`, CANARY.name, CANARY.phone, CANARY.email, CANARY.flight, CANARY.notes, 'Nadi Airport', 'Denarau', 12.5, 'minivan', 'FJD', 45, 'cash', iso(Date.now()));
    const started = await service.startDispatch(next);
    if (Number(body.backdate_s) > 0) { await shift(next, Number(body.backdate_s)); await service.sweep(next); }
    return json({ ok: true, booking_id: next, started, offers: await openOffers(next) });
  }
  if (op === 'backdate') { await shift(Number(body.booking_id), Number(body.seconds)); const sw = body.sweep ? await service.sweep(Number(body.booking_id)) : null; return json({ ok: true, sweep: sw, offers: await openOffers(Number(body.booking_id)) }); }
  if (op === 'staff-set') {                                                                                   // simulates a human/staff change made OUTSIDE the offer flow (synthetic bookings only)
    const bid = Number(body.booking_id); if (!(bid >= SYNTHETIC_BOOKING_ID_FLOOR)) return json({ ok: false, code: 'NON_SYNTHETIC_BOOKING_REFUSED' }, 403);
    if (body.status === 'cancelled') { await exec(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`, bid); await exec(`INSERT OR REPLACE INTO gate15_meta (k, v) VALUES (?, '1')`, `staff:${bid}`); }
    else if (Number(body.assigned_driver_id) > 0) { await exec(`UPDATE bookings SET assigned_driver_id = ?, status = 'accepted' WHERE id = ?`, Number(body.assigned_driver_id), bid); await exec(`INSERT OR REPLACE INTO gate15_meta (k, v) VALUES (?, '1')`, `staff:${bid}`); }
    return json({ ok: true });
  }
  if (op === 'sweep') return json({ ok: true, sweep: await service.sweep(Number(body.booking_id)) });

  if (op === 'free-drivers') {                                                                                // drive every active synthetic trip to COMPLETED through the REAL service
    let freed = 0;
    for (const r of await all(`SELECT id, assigned_driver_id AS d FROM bookings WHERE status IN ('accepted','en_route') AND assigned_driver_id IS NOT NULL ORDER BY id`)) {
      for (const s of ['EN_ROUTE_PICKUP', 'ARRIVED_PICKUP', 'PICKUP_VALIDATED', 'PASSENGER_ONBOARD', 'EN_ROUTE_DESTINATION', 'ARRIVED_DESTINATION', 'COMPLETED']) {
        if (s === 'PICKUP_VALIDATED') await service.submitEvidence({ driverId: r.d, bookingId: r.id, kind: 'PICKUP', clientEvidenceId: `free-${r.id}`, sha256: 'b'.repeat(64), bytes: 1 });
        await service.advanceTrip({ driverId: r.d, bookingId: r.id, stage: s });
      }
      freed++;
    }
    return json({ ok: true, freed });
  }

  // ---- readback ----
  if (op === 'readback') {
    const b = Number(url.searchParams.get('booking_id'));
    const booking = await one(`SELECT id, status, assigned_driver_id FROM bookings WHERE id = ?`, b);
    const offers = await all(`SELECT driver_id, offer_id, state, decision_reason_code, engaged_at, delivery_receipt_at, engagement_source FROM driver_offers WHERE booking_id = ? ORDER BY driver_id`, b);
    const events = Object.fromEntries((await all(`SELECT event_type t, COUNT(*) n FROM booking_events WHERE booking_id = ? GROUP BY event_type`, b)).map((r) => [r.t, r.n]));
    const duplicateCritical = await all(`SELECT event_type t, COUNT(*) n FROM booking_events WHERE booking_id = ? AND event_type IN ('DRIVER_ASSIGNED','ASSIGNMENT_PERSISTED','ASSIGNMENT_CLAIM','HUMAN_FALLBACK_REQUIRED') GROUP BY event_type HAVING COUNT(*) > 1`, b);
    const escalations = await all(`SELECT trigger_type t, COUNT(*) n FROM dispatch_escalations WHERE booking_id = ? GROUP BY trigger_type`, b);
    const capture = Object.fromEntries((await all(`SELECT kind k, COUNT(*) n FROM gate15_capture WHERE booking_id = ? GROUP BY kind`, b)).map((r) => [r.k, r.n]));
    return json({ ok: true, capture, booking, offers, accepted_offers: offers.filter((o) => o.state === 'ACCEPTED').length, events, duplicate_critical_events: duplicateCritical, escalations, server_now: iso(Date.now()) });
  }
  if (op === 'summary') {
    const v = [];
    for (const r of await all(`SELECT booking_id FROM driver_offers WHERE state='ACCEPTED' GROUP BY booking_id HAVING COUNT(*) > 1`)) v.push(`I1 double ACCEPTED on ${r.booking_id}`);
    for (const r of await all(`SELECT b.id FROM bookings b WHERE b.assigned_driver_id IS NOT NULL AND (SELECT COUNT(*) FROM driver_offers o WHERE o.booking_id=b.id AND o.state='ACCEPTED' AND o.driver_id=b.assigned_driver_id) <> 1 AND b.id NOT IN (SELECT CAST(substr(k, 7) AS INTEGER) FROM gate15_meta WHERE k LIKE 'staff:%')`)) v.push(`I1 assigned ${r.id} without single matching ACCEPTED`);
    for (const r of await all(`SELECT b.id FROM bookings b WHERE b.assigned_driver_id IS NOT NULL AND ((SELECT COUNT(*) FROM booking_events e WHERE e.booking_id=b.id AND e.event_type='DRIVER_ASSIGNED') <> 1 OR (SELECT COUNT(*) FROM booking_events e WHERE e.booking_id=b.id AND e.event_type='ASSIGNMENT_PERSISTED') <> 1) AND b.id NOT IN (SELECT CAST(substr(k, 7) AS INTEGER) FROM gate15_meta WHERE k LIKE 'staff:%')`)) v.push(`I2 ${r.id} assigned without exactly-one audit`);
    for (const r of await all(`SELECT b.id FROM bookings b WHERE b.assigned_driver_id IS NOT NULL AND EXISTS (SELECT 1 FROM driver_offers o WHERE o.booking_id=b.id AND o.state IN ('OFFERED','VIEWED')) AND b.id NOT IN (SELECT CAST(substr(k, 7) AS INTEGER) FROM gate15_meta WHERE k LIKE 'staff:%')`)) v.push(`I3 open offers on assigned ${r.id}`);
    for (const r of await all(`SELECT id FROM bookings WHERE assigned_driver_id IS NULL AND status <> 'pending' AND id NOT IN (SELECT CAST(substr(k, 7) AS INTEGER) FROM gate15_meta WHERE k LIKE 'staff:%')`)) v.push(`I6 unassigned ${r.id} not pending`);
    for (const r of await all(`SELECT assigned_driver_id d FROM bookings WHERE assigned_driver_id IS NOT NULL AND status IN ('accepted','en_route') GROUP BY assigned_driver_id HAVING COUNT(*) > 1`)) v.push(`I10 driver ${r.d} >1 active trips`);
    const base = (await one(`SELECT v FROM gate15_meta WHERE k='wallet_baseline'`))?.v; const nowW = JSON.stringify(await all(`SELECT * FROM wallets ORDER BY driver_id`));
    const walletChanged = base != null && base !== nowW; if (walletChanged) v.push('I7 wallet changed');
    const walletTx = (await one(`SELECT COUNT(*) c FROM wallet_transactions`)).c; if (walletTx) v.push('I7 wallet_transactions rows exist');
    const realSends = (await one(`SELECT COUNT(*) c FROM gate15_capture WHERE real_send <> 0 OR suppressed <> 1`)).c; if (realSends) v.push('I8 non-suppressed capture rows');
    const pii = (await one(`SELECT (SELECT COUNT(*) FROM booking_events WHERE metadata LIKE '%CANARY-%' OR metadata LIKE '%canary-guest%') + (SELECT COUNT(*) FROM driver_broadcast_attempts WHERE provider_reason_code LIKE '%CANARY-%') + (SELECT COUNT(*) FROM driver_evidence WHERE object_key LIKE '%CANARY-%') + (SELECT COUNT(*) FROM gate15_capture WHERE kind LIKE '%CANARY-%') AS c`)).c;
    if (pii) v.push('I9 PII canary stored outside bookings');
    const realPhones = (await one(`SELECT COUNT(*) c FROM drivers WHERE phone NOT LIKE '+000-GATE1-%'`)).c; if (realPhones) v.push('NON-PLACEHOLDER driver phone present');
    const nonSynthetic = (await one(`SELECT COUNT(*) c FROM bookings WHERE id < ? OR booking_ref NOT LIKE ?`, SYNTHETIC_BOOKING_ID_FLOOR, `${SYNTHETIC_REF_PREFIX}%`)).c; if (nonSynthetic) v.push('non-synthetic booking present');
    const counts = await one(`SELECT (SELECT COUNT(*) FROM bookings) bookings, (SELECT COUNT(*) FROM driver_offers) offers, (SELECT COUNT(*) FROM booking_events) events, (SELECT COUNT(*) FROM gate15_capture) capture_rows,
                                     (SELECT COUNT(*) FROM wallet_transactions) wallet_transactions, (SELECT COUNT(*) FROM drivers) drivers`);
    const captureByKind = Object.fromEntries((await all(`SELECT kind k, COUNT(*) n FROM gate15_capture GROUP BY kind`)).map((r) => [r.k, r.n]));
    return json({ ok: v.length === 0, violations: v, counts, capture_by_kind: captureByKind, real_sends: realSends, wallet_changed: walletChanged, wallet_transactions: walletTx, non_placeholder_phones: realPhones, non_synthetic_bookings: nonSynthetic });
  }

  // ---- D1 primitive probes ----
  if (op === 'probe') {
    const out = [];
    const check = (name, pass, detail) => out.push({ name, pass: !!pass, detail });
    await exec(`DELETE FROM gate15_probe`);
    // (1) D1 batch rollback: a failing 3rd statement must undo statements 1 and 2.
    let threw = false;
    try { await db.batch([db.prepare(`INSERT INTO gate15_probe (grp, tag, n) VALUES ('rb','a',2)`), db.prepare(`INSERT INTO gate15_probe (grp, tag, n) VALUES ('rb','b',2)`), db.prepare(`INSERT INTO gate15_probe (grp, tag, n) VALUES (NULL,'c',2)`)]); } catch { threw = true; }
    const rb = (await one(`SELECT COUNT(*) c FROM gate15_probe WHERE grp='rb'`)).c;
    check('D1 batch rolls back ALL statements when one fails', threw && rb === 0, { threw, rows_left: rb });
    // (2) batch commit: all-or-nothing success path
    const okb = await db.batch([db.prepare(`INSERT INTO gate15_probe (grp, tag, n) VALUES ('ok','a',2)`), db.prepare(`INSERT INTO gate15_probe (grp, tag, n) VALUES ('ok','b',2)`)]);
    check('D1 batch commits all statements on success and reports per-statement meta.changes', okb.length === 2 && okb.every((r) => r.meta.changes === 1), okb.map((r) => r.meta.changes));
    // (3) partial unique index
    await exec(`INSERT INTO gate15_probe (grp, tag, n) VALUES ('pu','t',1)`);
    let dup = false; try { await exec(`INSERT INTO gate15_probe (grp, tag, n) VALUES ('pu','t',1)`); } catch { dup = true; }
    await exec(`INSERT INTO gate15_probe (grp, tag, n) VALUES ('pu','t',2)`); await exec(`INSERT INTO gate15_probe (grp, tag, n) VALUES ('pu','t',2)`);
    const pu = (await one(`SELECT COUNT(*) c FROM gate15_probe WHERE grp='pu'`)).c;
    check('partial UNIQUE index rejects duplicates only inside its WHERE predicate', dup && pu === 3, { duplicate_rejected: dup, rows: pu });
    // (4) INSERT OR IGNORE ... SELECT
    const g = [];
    for (let i = 0; i < 3; i++) g.push((await exec(`INSERT OR IGNORE INTO gate15_probe (grp, tag, n) SELECT 'ig','t',1 WHERE NOT EXISTS (SELECT 1 FROM gate15_probe WHERE grp='ig' AND tag='t')`)).meta.changes);
    const g2 = (await exec(`INSERT OR IGNORE INTO gate15_probe (grp, tag, n) SELECT 'ig','t',1`)).meta.changes;          // collides with the partial unique index -> ignored, no error
    const g3 = (await exec(`INSERT OR IGNORE INTO gate15_probe (grp, tag, n) SELECT 'ig','zz',1 WHERE 1 = 0`)).meta.changes;
    check('INSERT OR IGNORE ... SELECT: guarded insert is idempotent; unique collision is ignored silently; false guard inserts nothing', JSON.stringify(g) === '[1,0,0]' && g2 === 0 && g3 === 0, { guarded: g, collision: g2, false_guard: g3 });
    // (5) json_extract
    await exec(`INSERT INTO gate15_probe (grp, tag, n, payload) VALUES ('js','t',2,?)`, JSON.stringify({ offer_id: 'ofr_x1', nested: { k: 7 } }));
    const je = await one(`SELECT json_extract(payload,'$.offer_id') o, json_extract(payload,'$.nested.k') k FROM gate15_probe WHERE grp='js' AND json_extract(payload,'$.offer_id') = 'ofr_x1'`);
    check('json_extract works in SELECT and WHERE', je && je.o === 'ofr_x1' && je.k === 7, je);
    // (6) guarded INSERT inside a batch that is rolled back by a later failure
    let t2 = false; try { await db.batch([db.prepare(`INSERT INTO gate15_probe (grp,tag,n) SELECT 'gb','a',2 WHERE 1=1`), db.prepare(`INSERT INTO gate15_probe (grp,tag,n) VALUES (NULL,'x',2)`)]); } catch { t2 = true; }
    check('guarded INSERT...SELECT inside a failing batch is rolled back with it', t2 && (await one(`SELECT COUNT(*) c FROM gate15_probe WHERE grp='gb'`)).c === 0, null);
    await exec(`DELETE FROM gate15_probe`);
    return json({ ok: out.every((x) => x.pass), checks: out });
  }
  return json({ ok: false, code: 'NOT_FOUND' }, 404);
}
