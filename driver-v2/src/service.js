// Driver PWA v2 — Gate 1 core service (ISOLATED; TESTED_NOT_LIVE). Pure ES module, D1-shaped `db`, injected clock/adapters.
//
// Responsibilities (never mixed):
//   bookings                   authoritative booking / assignment state (coarse status model unchanged)
//   driver_offers              dispatch offer + driver decision lifecycle (no guest PII)
//   driver_broadcast_attempts  notification delivery EVIDENCE only
//   booking_events             immutable operational timeline (+ detailed lifecycle)
//
// Server clock is authoritative everywhere: every time comparison is evaluated on the server with clock.now().
// Authoritative mutations are ONE db.batch() whose statements are guarded in SQL, so correctness never depends on
// read-then-write pre-checks (those exist only to choose a precise reason code).
import {
  WINDOW, PHASE, OFFER_STATE, CODE, LIFECYCLE, COARSE_STATUS, TEST_DRIVER_ID,
  SYNTHETIC_BOOKING_ID_FLOOR, SYNTHETIC_REF_PREFIX,
} from './constants.js';
import { defaultIds } from './adapters.js';

const OPEN = `('OFFERED','VIEWED')`;
const iso = (ms) => new Date(ms).toISOString();
const ms = (s) => Date.parse(s);
const LIFECYCLE_SQL = `(${LIFECYCLE.map((s) => `'${s}'`).join(',')})`;

export const phaseAt = (elapsedMs) =>
  elapsedMs < WINDOW.PRIORITY_MS ? PHASE.PRIORITY
    : elapsedMs < WINDOW.GRACE_END_MS ? PHASE.CONNECTIVITY_GRACE
      : elapsedMs < WINDOW.DEADLINE_MS ? PHASE.ESCALATED_DISPATCH
        : PHASE.HUMAN_FALLBACK_REQUIRED;

const EV_COLS = `booking_id, event_type, previous_status, new_status, actor, metadata, created_at`;

export function createDriverService({ db, clock, notifier, evidenceStore, ids = defaultIds, config = {} }) {
  const cfg = { realPhoneMode: false, financialEffectsEnabled: false, ...config };
  const nowMs = () => clock.now();

  // ---------- event statement builders ----------
  function evStmt({ bookingId, type, prev = null, next = null, actor, meta = {}, at, where = null, whereArgs = [], orIgnore = false }) {
    const head = `INSERT ${orIgnore ? 'OR IGNORE ' : ''}INTO booking_events (${EV_COLS})`;
    const vals = [bookingId, type, prev, next, actor, JSON.stringify(meta), iso(at)];
    return where
      ? db.prepare(`${head} SELECT ?,?,?,?,?,?,? WHERE ${where}`).bind(...vals, ...whereArgs)
      : db.prepare(`${head} VALUES (?,?,?,?,?,?,?)`).bind(...vals);
  }
  // Optional diagnostic telemetry: allowed to be best-effort. Critical lifecycle events NEVER use this.
  async function logOptional(args) {
    try { await evStmt({ ...args, at: args.at ?? nowMs() }).run(); } catch (e) { return { logged: false, error: String(e.message || e) }; }
    return { logged: true };
  }

  // ---------- loaders ----------
  async function getBooking(bookingId) {
    const b = await db.prepare(`SELECT id, booking_ref, status, assigned_driver_id, pickup_zone, destination_zone FROM bookings WHERE id = ?`).bind(bookingId).first();
    if (!b) return null;
    if (!(b.id >= SYNTHETIC_BOOKING_ID_FLOOR && String(b.booking_ref).startsWith(SYNTHETIC_REF_PREFIX))) return { refused: CODE.NON_SYNTHETIC_BOOKING_REFUSED };
    return b;
  }
  async function getRun(bookingId) { return db.prepare(`SELECT booking_id, started_at FROM dispatch_runs WHERE booking_id = ?`).bind(bookingId).first(); }
  async function getDriver(driverId) { return db.prepare(`SELECT id, name, status, zones, online, forced_offline_until FROM drivers WHERE id = ?`).bind(driverId).first(); }
  const inZone = (driver, zone) => { try { return JSON.parse(driver.zones || '[]').includes(zone); } catch { return false; } };
  const driverEligible = (driver, zone, now) =>
    driver && driver.status === 'verified' && driver.online === 1 && inZone(driver, zone) && !(driver.forced_offline_until && ms(driver.forced_offline_until) > now);

  // ---------- auth ----------
  async function authenticate(token) {
    if (!token) return { ok: false, code: CODE.AUTH_EXPIRED };
    const row = await db.prepare(
      `SELECT s.driver_id, s.expires_at, d.status FROM driver_sessions s JOIN drivers d ON d.id = s.driver_id WHERE s.token = ?`,
    ).bind(token).first();
    if (!row || row.status !== 'verified' || ms(row.expires_at) <= nowMs()) return { ok: false, code: CODE.AUTH_EXPIRED };
    return { ok: true, driverId: row.driver_id };
  }

  // ---------- dispatch ----------
  async function startDispatch(bookingId) {
    const b = await getBooking(bookingId);
    if (!b) return { ok: false, code: CODE.OFFER_NOT_FOUND };
    if (b.refused) return { ok: false, code: b.refused };
    const t = nowMs(); const actor = 'system:dispatch';
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO dispatch_runs (booking_id, started_at) VALUES (?, ?)`).bind(bookingId, iso(t)),
      evStmt({ bookingId, type: 'BOOKING_SAVED', actor, at: t, meta: { critical: false }, where: `NOT EXISTS (SELECT 1 FROM booking_events WHERE booking_id = ? AND event_type = 'BOOKING_SAVED')`, whereArgs: [bookingId] }),
      evStmt({ bookingId, type: 'DISPATCH_ELIGIBLE', actor, at: t, meta: { critical: false }, where: `NOT EXISTS (SELECT 1 FROM booking_events WHERE booking_id = ? AND event_type = 'DISPATCH_ELIGIBLE')`, whereArgs: [bookingId] }),
    ]);
    return { ok: true, ...(await sweep(bookingId)) };
  }

  async function createOffer(booking, run, driverId, phase) {
    if (cfg.realPhoneMode && driverId !== TEST_DRIVER_ID) return { created: false, code: CODE.TEST_DRIVER_MODE_REFUSED };
    const t = nowMs(); const offerId = ids.offer(); const deadline = iso(ms(run.started_at) + WINDOW.DEADLINE_MS);
    const [ins] = await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO driver_offers (offer_id, booking_id, driver_id, state, dispatch_phase, offered_at, expires_at, created_at, updated_at)
         SELECT ?, ?, ?, 'OFFERED', ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ? AND status = 'pending' AND assigned_driver_id IS NULL)`,
      ).bind(offerId, booking.id, driverId, phase, iso(t), deadline, iso(t), iso(t), booking.id),
      evStmt({ bookingId: booking.id, type: 'OFFER_CREATED', actor: 'system:dispatch', at: t, meta: { offer_id: offerId, driver_id: driverId, phase, critical: true },
        where: `EXISTS (SELECT 1 FROM driver_offers WHERE offer_id = ?)`, whereArgs: [offerId] }),
    ]);
    if (ins.meta.changes !== 1) return { created: false, code: CODE.ASSIGNMENT_ALREADY_TAKEN };
    await notifyDriver(booking, driverId, offerId);
    return { created: true, offerId };
  }

  // Delivery evidence lives in driver_broadcast_attempts; a delivery receipt is reachability evidence, NOT proof the offer was seen.
  async function notifyDriver(booking, driverId, offerId) {
    const t = nowMs();
    const prior = await db.prepare(`SELECT COUNT(*) AS n FROM driver_broadcast_attempts WHERE booking_id = ? AND driver_id = ?`).bind(booking.id, driverId).first('n');
    const attemptNo = Number(prior) + 1;
    await logOptional({ bookingId: booking.id, type: 'DRIVER_NOTIFICATION_ATTEMPTED', actor: 'system:notifier', meta: { offer_id: offerId, driver_id: driverId, attempt_no: attemptNo } });
    let status = 'SUPPRESSED_CAPTURED'; let reason = null;
    try {
      const r = await notifier.send({ kind: 'DRIVER_OFFER', channel: 'whatsapp', booking_id: booking.id, offer_id: offerId, to: { driver_id: driverId } });
      if (r.delivered) status = 'DELIVERED';
    } catch (e) { status = 'FAILED'; reason = e.code || CODE.NOTIFICATION_PROVIDER_ERROR; }
    await db.prepare(`INSERT INTO driver_broadcast_attempts (booking_id, driver_id, offer_id, attempt_no, channel, status, provider_reason_code, created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(booking.id, driverId, offerId, attemptNo, 'whatsapp', status, reason, iso(t)).run();
    if (status === 'DELIVERED') {
      await markReach(offerId, 'DELIVERY');
      await logOptional({ bookingId: booking.id, type: 'DRIVER_NOTIFICATION_DELIVERED', actor: 'system:notifier', meta: { offer_id: offerId, driver_id: driverId } });
    } else if (status === 'FAILED') {
      await logOptional({ bookingId: booking.id, type: 'DRIVER_NOTIFICATION_FAILED', actor: 'system:notifier', meta: { offer_id: offerId, driver_id: driverId, reason_code: reason, retry_state: 'RETRYABLE' } });
    }
  }

  // Reachability evidence can only keep an offer alive while it is still inside its un-evidenced window; it cannot resurrect a dead offer.
  async function markReach(offerId, source) {
    const t = nowMs();
    return db.prepare(
      `UPDATE driver_offers SET reach_evidence_at = ?, reach_evidence_source = ?, updated_at = ?
       WHERE offer_id = ? AND state IN ${OPEN} AND reach_evidence_at IS NULL AND expires_at > ? AND offered_at > ?`,
    ).bind(iso(t), source, iso(t), offerId, iso(t), iso(t - WINDOW.GRACE_END_MS)).run();
  }

  // Idempotent: repeated sweeps converge, never multiply offers or escalations.
  async function sweep(bookingId) {
    const b = await getBooking(bookingId);
    if (!b) return { ok: false, code: CODE.OFFER_NOT_FOUND };
    if (b.refused) return { ok: false, code: b.refused };
    const run = await getRun(bookingId);
    if (!run) return { ok: false, code: CODE.INVALID_TRANSITION };
    const t = nowMs(); const elapsed = t - ms(run.started_at); const phase = phaseAt(elapsed);
    const out = { ok: true, phase, created: [], expired: 0, fallback: false };
    if (b.status !== 'pending' || b.assigned_driver_id != null) { out.closed = true; return out; }

    // 1) expire what the server says is no longer actionable
    const [exp] = await db.batch([db.prepare(
      `UPDATE driver_offers SET state = 'TIMED_OUT', decision_at = ?, decision_reason_code = 'OFFER_EXPIRED', updated_at = ?
       WHERE booking_id = ? AND state IN ${OPEN} AND (expires_at <= ? OR (offered_at <= ? AND reach_evidence_at IS NULL))
         AND EXISTS (SELECT 1 FROM bookings WHERE id = ? AND status = 'pending' AND assigned_driver_id IS NULL)`,
    ).bind(iso(t), iso(t), bookingId, iso(t), iso(t - WINDOW.GRACE_END_MS), bookingId)]);
    out.expired = exp.meta.changes;
    if (exp.meta.changes) await logOptional({ bookingId, type: 'OFFERS_TIMED_OUT', actor: 'system:dispatch', meta: { count: exp.meta.changes, reason_code: CODE.OFFER_EXPIRED, phase } });

    // 2) >= 180 s: automated dispatch stops being relied on. Booking is NEVER cancelled.
    if (elapsed >= WINDOW.DEADLINE_MS) { out.fallback = await recordFallback(b, 'DEADLINE', phase); return out; }

    // 3) converge open offers toward the per-phase target
    const open = await db.prepare(`SELECT offer_id, reach_evidence_at FROM driver_offers WHERE booking_id = ? AND state IN ${OPEN}`).bind(bookingId).all();
    const evidenced = open.results.some((o) => o.reach_evidence_at);
    const target = phase === PHASE.PRIORITY ? 1
      : phase === PHASE.CONNECTIVITY_GRACE ? (evidenced ? 1 : 2)
        : 1 + WINDOW.ESCALATION_FANOUT;
    let have = open.results.length;
    if (have < target) {
      const driversRows = await db.prepare(
        `SELECT id, status, zones, online, forced_offline_until FROM drivers
         WHERE status = 'verified' AND online = 1 AND id NOT IN (SELECT driver_id FROM driver_offers WHERE booking_id = ?) ORDER BY id`,
      ).bind(bookingId).all();
      const pool = driversRows.results.filter((d) => driverEligible(d, b.pickup_zone, t));
      for (const d of pool) {
        if (have >= target) break;
        const r = await createOffer(b, run, d.id, phase);
        if (r.created) { out.created.push(r.offerId); have++; }
        else if (r.code === CODE.ASSIGNMENT_ALREADY_TAKEN) { out.closed = true; break; }
      }
      // pool exhausted with nothing open and at least one offer ever made => hand to humans now (still never cancels)
      if (have === 0 && !out.closed) {
        const ever = await db.prepare(`SELECT COUNT(*) AS n FROM driver_offers WHERE booking_id = ?`).bind(bookingId).first('n');
        if (Number(ever) > 0) out.fallback = await recordFallback(b, 'POOL_EXHAUSTED', phase);
      }
    }
    return out;
  }

  // Critical: escalation row + critical audit event are one atomic batch (event OR IGNORE: unique index makes repeats no-ops).
  async function recordFallback(booking, trigger, phase) {
    const t = nowMs();
    await db.batch([
      db.prepare(`UPDATE driver_offers SET state = 'TIMED_OUT', decision_at = ?, decision_reason_code = 'OFFER_EXPIRED', updated_at = ? WHERE booking_id = ? AND state IN ${OPEN} AND ? = 'DEADLINE'`)
        .bind(iso(t), iso(t), booking.id, trigger),
      db.prepare(`INSERT OR IGNORE INTO dispatch_escalations (booking_id, trigger_type, state, created_at) VALUES (?, 'HUMAN_FALLBACK_REQUIRED', 'OPEN', ?)`).bind(booking.id, iso(t)),
      evStmt({ bookingId: booking.id, type: 'HUMAN_FALLBACK_REQUIRED', actor: 'system:dispatch', at: t, orIgnore: true,
        meta: { reason_code: CODE.HUMAN_FALLBACK_REQUIRED, trigger, phase, critical: true, booking_preserved: true },
        where: `EXISTS (SELECT 1 FROM dispatch_escalations WHERE booking_id = ? AND trigger_type = 'HUMAN_FALLBACK_REQUIRED')`, whereArgs: [booking.id] }),
    ]);
    // Capture-only staff intent (suppressed). The booking itself is untouched (still pending, still valid for human fulfilment).
    const already = notifier.intents?.some((i) => i.kind === 'STAFF_FALLBACK' && i.booking_id === booking.id);
    if (!already) await notifier.send({ kind: 'STAFF_FALLBACK', channel: 'whatsapp', booking_id: booking.id, to: { role: 'admin' } });
    return true;
  }

  // ---------- driver-facing projections (NO guest PII before assignment) ----------
  async function touchSession(driverId) {
    const t = nowMs();
    await db.prepare(`UPDATE driver_sessions SET last_seen_at = ? WHERE driver_id = ?`).bind(iso(t), driverId).run();
    // Session activity is reachability evidence for that driver's still-actionable open offers.
    await db.prepare(
      `UPDATE driver_offers SET reach_evidence_at = ?, reach_evidence_source = 'SESSION', updated_at = ?
       WHERE driver_id = ? AND state IN ${OPEN} AND reach_evidence_at IS NULL AND expires_at > ? AND offered_at > ?`,
    ).bind(iso(t), iso(t), driverId, iso(t), iso(t - WINDOW.GRACE_END_MS)).run();
  }

  const actionable = (o, t) => ['OFFERED', 'VIEWED'].includes(o.state) && ms(o.expires_at) > t && (ms(o.offered_at) > t - WINDOW.GRACE_END_MS || !!o.reach_evidence_at);

  async function listOffers(driverId) {
    const t = nowMs();
    const rows = await db.prepare(
      `SELECT o.offer_id, o.state, o.dispatch_phase, o.offered_at, o.expires_at, o.viewed_at, o.reach_evidence_at,
              b.pickup_zone, b.destination_zone, b.distance_km, b.vehicle_type, b.quoted_currency, b.quoted_amount, b.payment_method, o.booking_id
       FROM driver_offers o JOIN bookings b ON b.id = o.booking_id
       WHERE o.driver_id = ? AND o.state IN ${OPEN} ORDER BY o.offered_at`,
    ).bind(driverId).all();
    const offers = [];
    for (const o of rows.results) {
      const run = await getRun(o.booking_id);
      offers.push({
        offer_id: o.offer_id, state: o.state, dispatch_phase: o.dispatch_phase,
        phase_now: run ? phaseAt(t - ms(run.started_at)) : null,
        offered_at: o.offered_at, expires_at: o.expires_at, viewed_at: o.viewed_at,
        actionable: actionable(o, t),
        trip: { pickup_zone: o.pickup_zone, destination_zone: o.destination_zone, distance_km: o.distance_km, vehicle_type: o.vehicle_type,
          fare: { currency: o.quoted_currency, amount: o.quoted_amount }, payment_method: o.payment_method },
      });
    }
    return offers;
  }

  async function myState(driverId) {
    await touchSession(driverId);
    const driver = await getDriver(driverId);
    const offers = await listOffers(driverId);
    const active = await db.prepare(`SELECT id FROM bookings WHERE assigned_driver_id = ? AND status IN ('accepted','en_route') ORDER BY id`).bind(driverId).all();
    const trips = [];
    for (const r of active.results) trips.push(await tripState(driverId, r.id));
    return { ok: true, code: CODE.OK, server_now: iso(nowMs()), driver: { id: driver.id, name: driver.name, online: !!driver.online }, offers, trips: trips.filter((x) => x.ok).map((x) => x.trip) };
  }

  // Only the winning assigned driver may read minimum guest/trip info. Unknown id and "not yours" are indistinguishable.
  async function tripState(driverId, bookingId) {
    const b = await db.prepare(
      `SELECT id, status, assigned_driver_id, pickup_zone, destination_zone, distance_km, vehicle_type, guest_name, guest_phone, flight_number, pickup_notes
       FROM bookings WHERE id = ?`,
    ).bind(bookingId).first();
    if (!b || b.assigned_driver_id !== driverId) return { ok: false, code: CODE.NOT_ASSIGNED_DRIVER };
    const stage = await currentStage(bookingId);
    const idx = LIFECYCLE.indexOf(stage);
    const pickupEvidence = !!(await db.prepare(`SELECT 1 AS x FROM driver_evidence WHERE booking_id = ? AND kind = 'PICKUP' LIMIT 1`).bind(bookingId).first());
    return { ok: true, code: CODE.OK, trip: {
      booking_id: b.id, status: b.status, stage, next_stage: LIFECYCLE[idx + 1] ?? null, server_now: iso(nowMs()), evidence: { pickup: pickupEvidence },
      pickup_zone: b.pickup_zone, destination_zone: b.destination_zone, distance_km: b.distance_km, vehicle_type: b.vehicle_type,
      guest: { name: b.guest_name, phone: b.guest_phone, flight_number: b.flight_number, pickup_notes: b.pickup_notes },
    } };
  }
  async function currentStage(bookingId) {
    return db.prepare(`SELECT event_type FROM booking_events WHERE booking_id = ? AND event_type IN ${LIFECYCLE_SQL} ORDER BY id DESC LIMIT 1`).bind(bookingId).first('event_type');
  }

  // ---------- offer decisions ----------
  async function loadOwnedOffer(driverId, offerId) {
    return db.prepare(`SELECT * FROM driver_offers WHERE offer_id = ? AND driver_id = ?`).bind(offerId, driverId).first();
  }
  const reply = (extra) => ({ server_now: iso(nowMs()), ...extra });

  async function view({ driverId, offerId }) {
    const o = await loadOwnedOffer(driverId, offerId);
    if (!o) return reply({ ok: false, code: CODE.OFFER_NOT_FOUND });
    const t = nowMs();
    if (!actionable(o, t) && !['ACCEPTED'].includes(o.state)) return reply({ ok: false, code: o.state === 'SUPERSEDED' ? CODE.ASSIGNMENT_ALREADY_TAKEN : CODE.OFFER_EXPIRED, offer: { offer_id: o.offer_id, state: o.state } });
    const r = await db.prepare(
      `UPDATE driver_offers SET state = CASE WHEN state = 'OFFERED' THEN 'VIEWED' ELSE state END, viewed_at = COALESCE(viewed_at, ?),
         reach_evidence_at = COALESCE(reach_evidence_at, ?), reach_evidence_source = COALESCE(reach_evidence_source, 'VIEW'), updated_at = ?
       WHERE offer_id = ? AND driver_id = ? AND state IN ${OPEN} AND expires_at > ? AND (offered_at > ? OR reach_evidence_at IS NOT NULL)`,
    ).bind(iso(t), iso(t), iso(t), offerId, driverId, iso(t), iso(t - WINDOW.GRACE_END_MS)).run();
    if (r.meta.changes === 1) await logOptional({ bookingId: o.booking_id, type: 'OFFER_VIEWED', actor: `driver:${driverId}`, meta: { offer_id: offerId, driver_id: driverId } });
    return reply({ ok: true, code: CODE.OK, replay: r.meta.changes !== 1 });
  }

  async function decline({ driverId, offerId, reasonCode = CODE.DRIVER_DECLINED }) {
    const o = await loadOwnedOffer(driverId, offerId);
    if (!o) return reply({ ok: false, code: CODE.OFFER_NOT_FOUND });
    if (o.state === OFFER_STATE.DECLINED) return reply({ ok: true, code: CODE.DRIVER_DECLINED, replay: true });
    if (o.state === OFFER_STATE.ACCEPTED) return reply({ ok: false, code: CODE.INVALID_TRANSITION });
    const t = nowMs();
    let res;
    try {
      res = await db.batch([
        db.prepare(`UPDATE driver_offers SET state = 'DECLINED', decision_at = ?, decision_reason_code = 'DRIVER_DECLINED', updated_at = ? WHERE offer_id = ? AND driver_id = ? AND state IN ${OPEN} AND expires_at > ?`)
          .bind(iso(t), iso(t), offerId, driverId, iso(t)),
        evStmt({ bookingId: o.booking_id, type: 'DRIVER_DECISION', actor: `driver:${driverId}`, at: t,
          meta: { offer_id: offerId, driver_id: driverId, decision: 'DECLINED', reason_code: CODE.DRIVER_DECLINED, critical: true },
          where: `EXISTS (SELECT 1 FROM driver_offers WHERE offer_id = ? AND state = 'DECLINED' AND decision_at = ?)
                  AND NOT EXISTS (SELECT 1 FROM booking_events WHERE booking_id = ? AND event_type = 'DRIVER_DECISION' AND json_extract(metadata, '$.offer_id') = ?)`,
          whereArgs: [offerId, iso(t), o.booking_id, offerId] }),
      ]);
    } catch (e) { return reply({ ok: false, code: CODE.AUDIT_PERSIST_FAILED, retryable: true }); }
    if (res[0].meta.changes !== 1) {
      const cur = await loadOwnedOffer(driverId, offerId);
      if (cur.state === OFFER_STATE.DECLINED) return reply({ ok: true, code: CODE.DRIVER_DECLINED, replay: true });
      return reply({ ok: false, code: cur.state === 'SUPERSEDED' ? CODE.ASSIGNMENT_ALREADY_TAKEN : CODE.OFFER_EXPIRED });
    }
    const advance = await sweep(o.booking_id);       // decline immediately advances to the next eligible driver; booking is not cancelled
    return reply({ ok: true, code: CODE.DRIVER_DECLINED, replay: false, advanced: advance.created?.length ?? 0 });
  }

  async function accept({ driverId, offerId }) {
    const o = await loadOwnedOffer(driverId, offerId);
    if (!o) return reply({ ok: false, code: CODE.OFFER_NOT_FOUND });
    const booking = await db.prepare(`SELECT id, status, assigned_driver_id, pickup_zone FROM bookings WHERE id = ?`).bind(o.booking_id).first();

    // replay / terminal states first: stable answers, never a second side effect
    if (o.state === OFFER_STATE.ACCEPTED && booking.assigned_driver_id === driverId) return reply({ ok: true, code: CODE.ASSIGNED, replay: true, booking_id: o.booking_id });
    if (booking.assigned_driver_id != null && booking.assigned_driver_id !== driverId) return reply({ ok: false, code: CODE.ASSIGNMENT_ALREADY_TAKEN, offer_state: o.state });
    if (o.state === OFFER_STATE.SUPERSEDED) return reply({ ok: false, code: CODE.ASSIGNMENT_ALREADY_TAKEN, offer_state: o.state });
    if (booking.assigned_driver_id == null && booking.status !== 'pending') return reply({ ok: false, code: CODE.SUPERSEDED, offer_state: o.state });
    if (o.state === OFFER_STATE.DECLINED) return reply({ ok: false, code: CODE.INVALID_TRANSITION });
    if (o.state === OFFER_STATE.TIMED_OUT) return reply({ ok: false, code: CODE.OFFER_EXPIRED });

    const driver = await getDriver(driverId);
    if (!driver || driver.status !== 'verified' || driver.online !== 1) return reply({ ok: false, code: CODE.DRIVER_OFFLINE });
    if (!inZone(driver, booking.pickup_zone)) return reply({ ok: false, code: CODE.DRIVER_OUTSIDE_ZONE });

    const t = nowMs(); const T = iso(t); const grace = iso(t - WINDOW.GRACE_END_MS);
    const actor = `driver:${driverId}`;
    const phase = phaseAt(t - ms((await getRun(o.booking_id)).started_at));
    const meta = (extra = {}) => ({ offer_id: offerId, driver_id: driverId, phase, critical: true, ...extra });
    // Fires only for the batch whose claim actually took effect: the offer was ACCEPTED at T *and* no assignment audit exists yet.
    // (decision_at alone is not enough: a concurrent duplicate Accept can carry the identical millisecond.)
    const wonGuard = `EXISTS (SELECT 1 FROM driver_offers WHERE offer_id = ? AND state = 'ACCEPTED' AND decision_at = ?)
                      AND NOT EXISTS (SELECT 1 FROM booking_events WHERE booking_id = ${Number(o.booking_id)} AND event_type = 'DRIVER_ASSIGNED')`;
    let res;
    try {
      res = await db.batch([
        // (1) claim: only if booking still assignable + unassigned, offer still actionable on the SERVER clock, driver still online
        db.prepare(
          `UPDATE bookings SET assigned_driver_id = ?, status = 'accepted'
           WHERE id = ? AND assigned_driver_id IS NULL AND status = 'pending'
             AND EXISTS (SELECT 1 FROM driver_offers o WHERE o.offer_id = ? AND o.driver_id = ? AND o.booking_id = bookings.id AND o.state IN ${OPEN}
                           AND o.expires_at > ? AND (o.offered_at > ? OR o.reach_evidence_at IS NOT NULL))
             AND EXISTS (SELECT 1 FROM drivers d WHERE d.id = ? AND d.online = 1 AND d.status = 'verified')`,
        ).bind(driverId, o.booking_id, offerId, driverId, T, grace, driverId),
        // (2) decision recorded only if (1) took effect for this driver
        db.prepare(
          `UPDATE driver_offers SET state = 'ACCEPTED', decision_at = ?, decision_reason_code = 'ASSIGNED', updated_at = ?
           WHERE offer_id = ? AND driver_id = ? AND state IN ${OPEN} AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = driver_offers.booking_id AND b.assigned_driver_id = ?)`,
        ).bind(T, T, offerId, driverId, driverId),
        // (3) every other open offer of this booking is superseded
        db.prepare(
          `UPDATE driver_offers SET state = 'SUPERSEDED', decision_at = ?, decision_reason_code = 'ASSIGNMENT_ALREADY_TAKEN', updated_at = ?
           WHERE booking_id = ? AND offer_id <> ? AND state IN ${OPEN} AND EXISTS (SELECT 1 FROM driver_offers w WHERE w.offer_id = ? AND w.state = 'ACCEPTED' AND w.decision_at = ?)`,
        ).bind(T, T, o.booking_id, offerId, offerId, T),
        // (4) CRITICAL audit events: same transaction as the mutation; if any cannot persist, the whole transition rolls back
        evStmt({ bookingId: o.booking_id, type: 'DRIVER_DECISION', actor, at: t, meta: meta({ decision: 'ACCEPTED', reason_code: CODE.ASSIGNED }), where: wonGuard, whereArgs: [offerId, T] }),
        evStmt({ bookingId: o.booking_id, type: 'ASSIGNMENT_CLAIM', actor, at: t, meta: meta({ reason_code: CODE.ASSIGNED }), where: wonGuard, whereArgs: [offerId, T] }),
        evStmt({ bookingId: o.booking_id, type: 'ASSIGNMENT_PERSISTED', prev: 'pending', next: 'accepted', actor, at: t, meta: meta({ reason_code: CODE.ASSIGNED }), where: wonGuard, whereArgs: [offerId, T] }),
        evStmt({ bookingId: o.booking_id, type: 'DRIVER_ASSIGNED', prev: 'pending', next: 'accepted', actor, at: t, meta: meta({ reason_code: CODE.ASSIGNED }), where: wonGuard, whereArgs: [offerId, T] }),
      ]);
    } catch (e) {
      return reply({ ok: false, code: CODE.AUDIT_PERSIST_FAILED, retryable: true, detail: String(e.message || e).slice(0, 120) });
    }
    const after = await loadOwnedOffer(driverId, offerId);
    const bk = await db.prepare(`SELECT assigned_driver_id, status FROM bookings WHERE id = ?`).bind(o.booking_id).first();
    if (after.state === OFFER_STATE.ACCEPTED && bk.assigned_driver_id === driverId) {
      // capture-only intents (suppressed): guest/admin messaging stays OFF in Gate 1
      if (res[0].meta.changes === 1) {
        await notifier.send({ kind: 'GUEST_DRIVER_ASSIGNED', channel: 'whatsapp', booking_id: o.booking_id, to: { role: 'guest' } });
        await notifier.send({ kind: 'ADMIN_DRIVER_ASSIGNED', channel: 'whatsapp', booking_id: o.booking_id, to: { role: 'admin' } });
      }
      return reply({ ok: true, code: CODE.ASSIGNED, replay: res[0].meta.changes !== 1, booking_id: o.booking_id });
    }
    if (bk.assigned_driver_id != null && bk.assigned_driver_id !== driverId) return reply({ ok: false, code: CODE.ASSIGNMENT_ALREADY_TAKEN, offer_state: after.state });
    // The booking itself is no longer assignable (e.g. cancelled by staff while the offer was open): the offer is superseded by booking state.
    if (bk.status !== 'pending') return reply({ ok: false, code: CODE.SUPERSEDED, offer_state: after.state });
    return reply({ ok: false, code: CODE.OFFER_EXPIRED, offer_state: after.state });
  }

  // ---------- trip lifecycle ----------
  async function advanceTrip({ driverId, bookingId, stage }) {
    const b = await getBooking(bookingId);
    if (!b || b.refused || b.assigned_driver_id !== driverId) return reply({ ok: false, code: CODE.NOT_ASSIGNED_DRIVER });
    const idx = LIFECYCLE.indexOf(stage);
    if (idx <= 0) return reply({ ok: false, code: CODE.INVALID_TRANSITION });
    if (stage === 'COMPLETED' && cfg.financialEffectsEnabled) return reply({ ok: false, code: CODE.FINANCIAL_EFFECTS_DISABLED });
    const cur = await currentStage(bookingId); const curIdx = LIFECYCLE.indexOf(cur);
    if (idx <= curIdx) return reply({ ok: true, code: CODE.OK, replay: true, stage });
    if (idx !== curIdx + 1) return reply({ ok: false, code: CODE.INVALID_TRANSITION, stage: cur });
    if (stage === 'PICKUP_VALIDATED') {
      const ev = await db.prepare(`SELECT 1 AS x FROM driver_evidence WHERE booking_id = ? AND kind = 'PICKUP' LIMIT 1`).bind(bookingId).first();
      if (!ev) return reply({ ok: false, code: CODE.EVIDENCE_REQUIRED, stage: cur });
    }
    const t = nowMs(); const prev = LIFECYCLE[curIdx];
    const guard = `EXISTS (SELECT 1 FROM bookings WHERE id = ? AND assigned_driver_id = ?)
                   AND EXISTS (SELECT 1 FROM booking_events WHERE booking_id = ? AND event_type = ?)
                   AND NOT EXISTS (SELECT 1 FROM booking_events WHERE booking_id = ? AND event_type = ?)
                   ${stage === 'PICKUP_VALIDATED' ? `AND EXISTS (SELECT 1 FROM driver_evidence WHERE booking_id = ? AND kind = 'PICKUP')` : ''}`;
    const gArgs = [bookingId, driverId, bookingId, prev, bookingId, stage, ...(stage === 'PICKUP_VALIDATED' ? [bookingId] : [])];
    const stmts = [evStmt({ bookingId, type: stage, prev: b.status, next: COARSE_STATUS[stage] ?? b.status, actor: `driver:${driverId}`, at: t,
      meta: { driver_id: driverId, stage, critical: true }, where: guard, whereArgs: gArgs })];
    if (COARSE_STATUS[stage]) stmts.push(db.prepare(`UPDATE bookings SET status = ? WHERE id = ? AND assigned_driver_id = ? AND EXISTS (SELECT 1 FROM booking_events WHERE booking_id = ? AND event_type = ?)`)
      .bind(COARSE_STATUS[stage], bookingId, driverId, bookingId, stage));
    let res;
    try { res = await db.batch(stmts); } catch (e) { return reply({ ok: false, code: CODE.AUDIT_PERSIST_FAILED, retryable: true }); }
    const now = await currentStage(bookingId);
    if (LIFECYCLE.indexOf(now) >= idx) return reply({ ok: true, code: CODE.OK, replay: res[0].meta.changes !== 1, stage });
    return reply({ ok: false, code: CODE.INVALID_TRANSITION, stage: now });
  }

  async function submitEvidence({ driverId, bookingId, kind, clientEvidenceId, sha256 = null, bytes = null }) {
    const b = await getBooking(bookingId);
    if (!b || b.refused || b.assigned_driver_id !== driverId) return reply({ ok: false, code: CODE.NOT_ASSIGNED_DRIVER });
    if (!['PICKUP', 'DROPOFF'].includes(kind) || !clientEvidenceId) return reply({ ok: false, code: CODE.INVALID_TRANSITION });
    const prior = await db.prepare(`SELECT evidence_id FROM driver_evidence WHERE client_evidence_id = ?`).bind(clientEvidenceId).first();
    if (prior) return reply({ ok: true, code: CODE.OK, replay: true, evidence_id: prior.evidence_id });
    const stage = await currentStage(bookingId);
    if (stage !== (kind === 'PICKUP' ? 'ARRIVED_PICKUP' : 'ARRIVED_DESTINATION')) return reply({ ok: false, code: CODE.INVALID_TRANSITION, stage });
    const evidenceId = ids.evidence(); const key = `evidence/${b.booking_ref}/${kind}/${evidenceId}`; const t = nowMs();
    try { await evidenceStore.put({ key, sha256, bytes }); }
    catch (e) {
      await logOptional({ bookingId, type: 'EVIDENCE_UPLOAD_FAILED', actor: `driver:${driverId}`, meta: { driver_id: driverId, kind, reason_code: CODE.EVIDENCE_UPLOAD_FAILED, retry_state: 'RETRYABLE' } });
      return reply({ ok: false, code: CODE.EVIDENCE_UPLOAD_FAILED, retryable: true });
    }
    try {
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO driver_evidence (evidence_id, client_evidence_id, booking_id, driver_id, kind, object_key, sha256, bytes, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
          .bind(evidenceId, clientEvidenceId, bookingId, driverId, kind, key, sha256, bytes, iso(t)),
        evStmt({ bookingId, type: `${kind}_EVIDENCE_STORED`, actor: `driver:${driverId}`, at: t, meta: { driver_id: driverId, evidence_id: evidenceId, critical: true },
          where: `EXISTS (SELECT 1 FROM driver_evidence WHERE evidence_id = ?)`, whereArgs: [evidenceId] }),
      ]);
    } catch (e) { return reply({ ok: false, code: CODE.AUDIT_PERSIST_FAILED, retryable: true }); }
    const row = await db.prepare(`SELECT evidence_id FROM driver_evidence WHERE client_evidence_id = ?`).bind(clientEvidenceId).first();
    return reply({ ok: true, code: CODE.OK, replay: row.evidence_id !== evidenceId, evidence_id: row.evidence_id });
  }

  // ---------- hooks / detectors ----------
  async function detectOfflineMidTrip() {
    const t = nowMs();
    const rows = await db.prepare(
      `SELECT b.id AS booking_id, b.assigned_driver_id AS driver_id FROM bookings b JOIN drivers d ON d.id = b.assigned_driver_id
       WHERE b.status IN ('accepted','en_route') AND d.online = 0`,
    ).all();
    let flagged = 0;
    for (const r of rows.results) {
      const [esc] = await db.batch([
        db.prepare(`INSERT OR IGNORE INTO dispatch_escalations (booking_id, trigger_type, state, created_at) VALUES (?, 'DRIVER_OFFLINE_MID_TRIP', 'OPEN', ?)`).bind(r.booking_id, iso(t)),
        evStmt({ bookingId: r.booking_id, type: 'DRIVER_OFFLINE_MID_TRIP', actor: 'system:monitor', at: t, meta: { driver_id: r.driver_id, reason_code: CODE.DRIVER_OFFLINE, critical: false },
          where: `NOT EXISTS (SELECT 1 FROM booking_events WHERE booking_id = ? AND event_type = 'DRIVER_OFFLINE_MID_TRIP')`, whereArgs: [r.booking_id] }),
      ]);
      flagged += esc.meta.changes;
    }
    return { flagged };
  }
  // Review architecture hooks only: nothing is published in Gate 1.
  async function requestReview(bookingId) {
    const t = nowMs();
    const [r] = await db.batch([evStmt({ bookingId, type: 'REVIEW_REQUESTED', actor: 'system:review', at: t, orIgnore: true, meta: { critical: false, published: false },
      where: `EXISTS (SELECT 1 FROM booking_events WHERE booking_id = ? AND event_type = 'COMPLETED')`, whereArgs: [bookingId] })]);
    return { ok: true, recorded: r.meta.changes === 1 };
  }
  async function receiveReview(bookingId) {
    const t = nowMs();
    const [r] = await db.batch([evStmt({ bookingId, type: 'REVIEW_RECEIVED', actor: 'system:review', at: t, orIgnore: true, meta: { critical: false, published: false },
      where: `EXISTS (SELECT 1 FROM booking_events WHERE booking_id = ? AND event_type = 'REVIEW_REQUESTED')`, whereArgs: [bookingId] })]);
    return { ok: true, recorded: r.meta.changes === 1 };
  }

  return { cfg, authenticate, startDispatch, sweep, listOffers, myState, tripState, view, decline, accept, advanceTrip, submitEvidence,
    detectOfflineMidTrip, requestReview, receiveReview, touchSession, _phaseAt: phaseAt };
}
