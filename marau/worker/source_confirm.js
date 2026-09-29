/* Marau Stage 1 (PREVIEW/TEST ONLY) — round 28: Codex independently
 * verified round 27 (461/461), then reproduced three real defects in
 * the design this file's round-27 version shipped. All three, plus
 * three further hardening requirements, are fixed here. Nothing about
 * the OVERALL shape changes (still an injected `client`, still a
 * durable local ledger, still "never assume failure on an ambiguous
 * outcome") — every fix below narrows or corrects a specific claim the
 * round-27 version made too loosely.
 *
 * ── FIX 1 — a cancelled reservation must never read back as confirmed ──
 * Round 27's recovery logic only ever asked "is the source's status
 * still 'pending'?" — anything else was treated as a candidate
 * confirmation, and success was decided purely by comparing
 * `assigned_driver_id`. A reservation that was CANCELLED after a
 * driver had already been assigned (a real, ordinary sequence — see
 * the real system's own `accepted -> cancelled` transition, verified
 * against its source this round) still has a non-null
 * `assigned_driver_id`, so a driver-id match alone would have reported
 * it as a successful confirmation. Fixed: `classifyDefiniteOutcome`
 * below explicitly checks for `status === 'cancelled'` FIRST, before
 * ever comparing driver ids, and records a distinct terminal outcome
 * (`source_cancelled`) that can never be mistaken for `confirmed`.
 *
 * ── FIX 2 — a durable operation identity, not driver-id equality ──
 * Two different attempts (different operators, different callers) can
 * coincidentally target the SAME driver — round 27's "is
 * `current.assigned_driver_id === driverId`?" check could not tell
 * those apart, and would attribute a recovered outcome to whichever
 * attempt happened to be asking. Fixed: every attempt now gets a
 * locally-generated `attempt_id`, RESERVED in Marau's own durable
 * ledger BEFORE the source is ever called (see `reserveAttempt`), then
 * threaded through to the source itself, which is expected to persist
 * it alongside the driver id and operator AT THE SAME COMMIT as the
 * assignment (see the client contract below, and §"What production
 * does not yet support" for the real gap this implies). Recovery now
 * checks `current.confirmation_attempt_id === row.attempt_id` — an
 * exact, unambiguous identity match — never driver-id equality alone.
 *
 * ── FIX 3 — a ledger write failure must never lose a real source
 *    success ──
 * Round 27 recorded the ENTIRE outcome in one INSERT, executed AFTER
 * the source call resolved. A fault on that one INSERT (reproduced
 * with a real SQLite trigger rejecting it) meant a genuinely successful
 * source confirmation could be lost from Marau's own point of view.
 * Fixed by splitting the write in two, mirroring the already-proven
 * round-22 pattern for the SYNTHETIC-source confirm workflow exactly:
 * (a) a PRIMARY row, reserved upfront and then transitioned via a
 * single atomic UPDATE at the moment of the actual decision — this is
 * the row whose identity and attribution survive regardless of
 * anything that happens afterward; (b) a SECONDARY, best-effort audit
 * insert (`marau_source_confirm_decision_log`), never allowed to throw
 * past the caller, and REPAIRED (inserted if still missing) on every
 * later call for the same reservation — including the fast,
 * already-decided path — so removing the fault and retrying recovers
 * both the original decision AND completes the secondary log, without
 * ever re-deciding.
 *
 * ── FIX 4 — a lost response AND an unavailable readback must be
 *    reported honestly, never guessed ──
 * If the confirm call throws AND the recovery readback also throws (or
 * returns nothing), round 27 had no path for this — it would have
 * propagated an exception. Fixed: this is reported as a genuine,
 * distinct `unresolved` outcome — never silently treated as success or
 * failure — and the reservation is left exactly as it was so a LATER
 * retry, from any caller, continues trying to resolve the SAME
 * attempt. Separately: a readback that DOES succeed but shows the
 * source still `pending` is also NOT treated as confident proof the
 * write never landed — an in-flight request can still commit after a
 * pending read — so this, too, is reported as `unresolved` rather than
 * "safe to retry with a fresh write." Only a DEFINITE, non-pending
 * readback (accepted-by-us, accepted-by-someone-else, or cancelled)
 * ever produces a terminal outcome.
 *
 * ── FIX 5 — operator identity comes from authenticated staff context ──
 * Round 27 accepted `operator` as a plain, caller-supplied display-name
 * field — anyone holding the admin token could attribute a decision to
 * any name at all. This module itself is unchanged in shape (it still
 * just takes an `operator` string), but the WIRING in worker.js no
 * longer reads that string from the request body — it is now derived
 * from `requireStaffIdentity`, a per-operator bearer token looked up
 * against `marau_staff_identities` (migration 0034), never spoofable
 * by a caller-chosen field. See worker.js's own handler for the wiring
 * and `test/marau_source_confirm_integration.test.mjs` for isolated
 * test identities demonstrating it.
 *
 * ── FIX 6 — genuine concurrency, asserted precisely ──
 * See the test file's concurrency tests: two truly concurrent
 * (`Promise.all`) confirm attempts for the same reservation now
 * converge on exactly one reserved attempt (the loser of the RESERVE
 * race defers to the winner's own attempt_id/operator, never creating
 * a second competing reservation), exactly one real assignment at the
 * source, exactly one notification-equivalent side effect, and the
 * SAME operator attribution regardless of which caller's HTTP request
 * happens to resolve last.
 *
 * ── What this module still does NOT do ──
 * It never mints or touches a Marau guest link, and it never updates
 * Marau's own guest-facing mirror — both remain genuinely separate,
 * already-built mechanisms (guest_sessions; real_booking_sync.js),
 * called by whoever wires this module in, never by this module itself.
 */

/**
 * The injected client's contract (a synthetic double in every test
 * today — see "What production does not yet support" below for what a
 * REAL implementation of this contract would require that the actual
 * deployed source does not currently have):
 *
 *   - getReservation(sourceBookingRef) =>
 *       Promise<{ status, assigned_driver_id, confirmation_attempt_id, confirmed_operator } | null>
 *     A plain, side-effect-free read, safe to call any number of times.
 *   - confirmReservation(sourceBookingRef, { driverId, attemptId, operator }) =>
 *       Promise<{ won: boolean, current: { status, assigned_driver_id, confirmation_attempt_id, confirmed_operator } }>
 *     The one real write. Expected to persist `attemptId` and
 *     `operator` ATOMICALLY, in the same commit as the driver
 *     assignment, so a later `getReservation` can recover them even if
 *     this call's own response never reaches the caller. May REJECT to
 *     simulate a lost response — this module always treats a rejection
 *     as ambiguous, never as a known failure.
 *
 * ── What production does not yet support ──
 * `nadi-dispatch-api`'s real `handleAdminManualAssign` (read directly
 * from its source this round, the same code confirmed live-deployed in
 * round 26) accepts only `{ driver_id, booking_id }` and returns
 * `{ ok, won, booking }` — IT HAS NO CONCEPT OF AN IDEMPOTENCY/ATTEMPT
 * IDENTITY AND DOES NOT PERSIST ONE. Its own compare-and-swap UPDATE
 * genuinely prevents a double-assignment, but a caller cannot currently
 * ask it "was MY specific attempt the one that committed?" — only
 * "who currently holds this booking?" A real client satisfying this
 * module's contract would need `nadi-dispatch-api` to be extended to
 * accept and durably store a caller-supplied attempt/idempotency value
 * (and, separately, an authenticated operator identity — see fix 5's
 * note above; the real system also has no per-operator field on
 * `bookings`/`booking_events`, only a generic `actor: 'admin'`).
 * **The synthetic client in worker.js is not a proof that a real
 * client can be swapped in unchanged — it demonstrates the CALLER'S
 * recovery logic against a contract the real source does not yet
 * implement.** This gap is also recorded in
 * docs/MARAU_STAGE1_PRODUCTION_RELEASE_PACKAGE.md.
 */

async function loadOutcomeRow(env, sourceBookingRef) {
  return env.DB.prepare('SELECT * FROM marau_source_confirm_outcomes WHERE source_booking_ref = ?').bind(sourceBookingRef).first();
}

function cryptoRandomSuffix() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function terminalResult(row) {
  return {
    ok: row.status === 'confirmed',
    status: row.status,
    confirmed_driver_id: row.confirmed_driver_id,
    operator: row.operator,
    attempt_id: row.attempt_id,
    recovered_via_readback: row.recovered_via_readback === 1,
    decided_at: row.decided_at,
  };
}

function unresolvedResult(row, reason) {
  return {
    ok: false,
    status: 'unresolved',
    unresolved: true,
    attempt_id: row.attempt_id,
    operator: row.operator,
    reason,
  };
}

/**
 * Best-effort SECONDARY audit log — never allowed to throw past the
 * caller. The PRIMARY row (marau_source_confirm_outcomes) is already
 * the durable source of truth by the time this is called; a failure
 * here must never be confused with the decision itself failing (fix 3).
 */
async function recordDecisionLogIfMissing(env, { sourceBookingRef, attemptId, status, nowIso }) {
  try {
    const existing = await env.DB
      .prepare('SELECT 1 FROM marau_source_confirm_decision_log WHERE source_booking_ref = ? AND attempt_id = ?')
      .bind(sourceBookingRef, attemptId)
      .first();
    if (existing) return { ok: true, already_recorded: true };
    await env.DB
      .prepare('INSERT INTO marau_source_confirm_decision_log (source_booking_ref, attempt_id, status, logged_at) VALUES (?, ?, ?, ?)')
      .bind(sourceBookingRef, attemptId, status, nowIso())
      .run();
    return { ok: true, already_recorded: false };
  } catch (err) {
    return { ok: false, reason: 'DECISION_LOG_INSERT_FAILED', detail: String(err && err.message) };
  }
}

/**
 * Reserves a durable attempt identity BEFORE the source is ever called
 * — fix 2's core mechanism. A concurrent racer's INSERT loses to the
 * UNIQUE constraint on source_booking_ref and simply reads back the
 * winner's row rather than treating that as an error (fix 6).
 */
async function reserveAttempt(env, { sourceBookingRef, driverId, operator, nowIso }) {
  const attemptId = `attempt_${cryptoRandomSuffix()}`;
  try {
    await env.DB
      .prepare(
        `INSERT INTO marau_source_confirm_outcomes (source_booking_ref, attempt_id, status, intended_driver_id, operator, reserved_at) VALUES (?, ?, 'reserved', ?, ?, ?)`
      )
      .bind(sourceBookingRef, attemptId, String(driverId), operator, nowIso())
      .run();
    return { ok: true, row: await loadOutcomeRow(env, sourceBookingRef) };
  } catch (err) {
    if (/UNIQUE/i.test(String(err && err.message))) {
      return { ok: true, row: await loadOutcomeRow(env, sourceBookingRef) };
    }
    // Fix 3's own scenario, at the earliest possible point: nothing
    // durable exists yet for this reservation locally. Honest,
    // retryable failure — never a false success, never an uncaught
    // exception.
    return { ok: false, reason: 'LEDGER_RESERVE_FAILED', detail: String(err && err.message) };
  }
}

async function finalizeOutcome(env, row, { status, confirmedDriverId, recoveredViaReadback, nowIso }) {
  const now = nowIso();
  await env.DB
    .prepare(
      `UPDATE marau_source_confirm_outcomes
         SET status = ?, confirmed_driver_id = ?, recovered_via_readback = ?, decided_at = ?
       WHERE source_booking_ref = ? AND attempt_id = ? AND status IN ('reserved', 'unresolved')`
    )
    .bind(status, confirmedDriverId ?? null, recoveredViaReadback ? 1 : 0, now, row.source_booking_ref, row.attempt_id)
    .run();
  await recordDecisionLogIfMissing(env, { sourceBookingRef: row.source_booking_ref, attemptId: row.attempt_id, status, nowIso });
  const finalRow = await loadOutcomeRow(env, row.source_booking_ref);
  return terminalResult(finalRow);
}

/**
 * Classifies a DEFINITE (non-pending) source read — fix 1 (cancelled
 * first, before any driver comparison) and fix 2 (attempt_id, never
 * driver_id, proves ownership) both live here.
 */
function classifyDefiniteOutcome(row, current) {
  if (!current) return { status: 'unresolved', reason: 'SOURCE_RESERVATION_NOT_FOUND' };
  if (current.status === 'cancelled') {
    return { status: 'source_cancelled', confirmedDriverId: current.assigned_driver_id ?? null };
  }
  const ownedByThisAttempt = current.confirmation_attempt_id === row.attempt_id;
  if (current.status === 'accepted' && ownedByThisAttempt) {
    return { status: 'confirmed', confirmedDriverId: current.assigned_driver_id };
  }
  // Accepted by a different attempt, or any other non-pending,
  // non-cancelled state that isn't ours — never a confirmation.
  return { status: 'conflict', confirmedDriverId: current.assigned_driver_id ?? null };
}

async function recoverViaReadback(env, client, row, nowIso) {
  let current;
  try {
    current = await client.getReservation(row.source_booking_ref);
  } catch {
    // Fix 4: the write's own response AND the recovery read are BOTH
    // unavailable. Never guess — report honestly, change nothing.
    return unresolvedResult(row, 'SOURCE_UNAVAILABLE_FOR_RECOVERY');
  }
  if (!current) return unresolvedResult(row, 'SOURCE_RESERVATION_NOT_FOUND');
  if (current.status === 'pending') {
    // Fix 4: a pending read alone does not prove an in-flight request
    // cannot still commit — left unresolved, never confidently
    // reported as "safe to retry with a fresh write."
    return unresolvedResult(row, 'SOURCE_STATE_STILL_PENDING_AFTER_LOST_RESPONSE');
  }
  const classified = classifyDefiniteOutcome(row, current);
  return finalizeOutcome(env, row, { ...classified, recoveredViaReadback: true, nowIso });
}

async function resolveAttempt(env, client, row, nowIso) {
  const { source_booking_ref: sourceBookingRef, attempt_id: attemptId, intended_driver_id: driverId, operator } = row;

  let response;
  try {
    response = await client.confirmReservation(sourceBookingRef, { driverId, attemptId, operator });
  } catch {
    // THE CRITICAL CASE: the call may have already committed at the
    // source — its response is simply lost. Never assume failure.
    return recoverViaReadback(env, client, row, nowIso);
  }

  if (response && response.won === true) {
    return finalizeOutcome(env, row, { status: 'confirmed', confirmedDriverId: driverId, recoveredViaReadback: false, nowIso });
  }

  const classified = classifyDefiniteOutcome(row, response && response.current);
  return finalizeOutcome(env, row, { ...classified, recoveredViaReadback: false, nowIso });
}

/**
 * The one entry point this module exposes. `driverId`/`operator` are
 * only ever consulted to CREATE the very first reservation for a given
 * `sourceBookingRef` — every later call, regardless of what it passes,
 * resolves (or returns) the ALREADY-reserved attempt's own values.
 */
export async function confirmReservationAtSource(env, client, { sourceBookingRef, driverId, operator, nowIso }) {
  if (!sourceBookingRef) return { ok: false, reason: 'MISSING_SOURCE_BOOKING_REF' };
  if (driverId == null) return { ok: false, reason: 'MISSING_DRIVER_ID' };
  if (!operator || !String(operator).trim()) return { ok: false, reason: 'MISSING_OPERATOR' };
  if (typeof client?.confirmReservation !== 'function' || typeof client?.getReservation !== 'function') {
    return { ok: false, reason: 'MISSING_SOURCE_CLIENT' };
  }

  let row = await loadOutcomeRow(env, sourceBookingRef);
  if (!row) {
    const reserved = await reserveAttempt(env, { sourceBookingRef, driverId, operator, nowIso });
    if (!reserved.ok) return reserved;
    row = reserved.row;
  }

  if (row.status === 'confirmed' || row.status === 'conflict' || row.status === 'source_cancelled') {
    // Fast idempotent path — repairs a missing secondary audit row
    // (fix 3's exact scenario) without ever re-deciding anything.
    await recordDecisionLogIfMissing(env, { sourceBookingRef: row.source_booking_ref, attemptId: row.attempt_id, status: row.status, nowIso });
    return terminalResult(row);
  }

  // status is 'reserved' or 'unresolved' — resolved using the
  // reservation's OWN durable driverId/operator/attemptId, never this
  // call's own (possibly different) arguments.
  return resolveAttempt(env, client, row, nowIso);
}
