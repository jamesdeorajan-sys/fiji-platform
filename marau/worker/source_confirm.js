/* Marau Stage 1 (PREVIEW/TEST ONLY) — round 27: the next bounded
 * integration slice named in the production release package
 * (`docs/MARAU_STAGE1_PRODUCTION_RELEASE_PACKAGE.md`, round 26) — a
 * staff confirmation that reaches the AUTHORITATIVE source, not just
 * Marau's own mirror.
 *
 * Rounds 19-22 already proved a full confirm workflow, but against
 * `marau_synthetic_source_bookings` via a direct, same-process D1
 * UPDATE (worker.js's `handleStaffDecideBooking`). That is provably
 * atomic and cannot lose its own result — the caller and the writer are
 * the same process, in the same statement. A REAL cross-system
 * integration is not like that: it is an HTTP call to a different
 * Worker, and an HTTP call can genuinely commit its write and then have
 * its RESPONSE lost — a timeout, a dropped connection, a proxy that
 * cuts the reply — a failure mode a same-process UPDATE cannot exercise
 * no matter how it is fault-injected. This module is the client-side
 * half of that integration: it calls out through an injected `client`
 * (synthetic in every test today; a real authenticated HTTP client
 * later, without redesigning anything here), and is built around the
 * assumption that ANY call to it can fail after already succeeding.
 *
 * The recovery rule, in one sentence: on any ambiguous outcome (the
 * call threw, timed out, or otherwise never returned a definite
 * answer), READ the source's own current, authoritative state before
 * concluding anything — never assume failure, and never blindly retry
 * the write. This is the exact "recover the original decision, not
 * invent a new one" discipline round 21/22 already established for
 * Marau's own synthetic-source confirm — applied here to a call that
 * can leave the network in the middle.
 *
 * A durable LOCAL ledger (`marau_source_confirm_outcomes`, migration
 * 0033, UNIQUE on source_booking_ref) is the second half of the
 * guarantee: once a decision for a given reservation is known — either
 * because the call itself returned a definite answer, or because a
 * recovery read discovered one — it is written EXACTLY ONCE, ever.
 * Every later call for the same reservation, from any caller, with any
 * arguments, reads that one row back instead of deciding anything again
 * — this is what makes "a retry must recover the original decision
 * without duplicate assignment, notification, or changed operator
 * attribution" true by construction, not by hoping a well-behaved
 * caller never retries.
 *
 * What this module deliberately does NOT do: it never mints or touches
 * a Marau guest link, and it never updates Marau's own guest-facing
 * mirror. Guest-link minting is `guest_sessions`' own existing,
 * already-built mechanism (round 14) — entirely decoupled, so a failure
 * there can never block or be blocked by this module. Refreshing
 * Marau's mirror is `real_booking_sync.js`'s own existing
 * `syncRealBookingEvent`/`reconcileRealBooking` — reused unmodified,
 * called by whatever wires this module in, immediately after, as a
 * SEPARATE step (see `test/marau_source_confirm_integration.test.mjs`'s
 * end-to-end test for the full sequence). Keeping these three concerns
 * (confirm-at-source, mint-guest-link, refresh-mirror) as genuinely
 * separate function calls, never a shared transaction, is what makes
 * each one's failure independent of the others' success.
 */

/**
 * The injected client's contract (a synthetic double in every test
 * today):
 *   - getReservation(sourceBookingRef) => Promise<{ status, assigned_driver_id } | null>
 *     A plain, side-effect-free read. Always safe to call, any number
 *     of times, including as part of recovering from an ambiguous
 *     write outcome.
 *   - confirmReservation(sourceBookingRef, { driverId }) => Promise<{ won: boolean, current: { status, assigned_driver_id } }>
 *     The one real write. May REJECT to simulate "the call never
 *     returned a definite answer" (network loss, timeout) — this
 *     module treats a rejection as ambiguous, never as a known
 *     failure, and always recovers via getReservation before deciding
 *     anything.
 */

async function loadExistingOutcome(env, sourceBookingRef) {
  return env.DB.prepare('SELECT * FROM marau_source_confirm_outcomes WHERE source_booking_ref = ?').bind(sourceBookingRef).first();
}

async function recordOutcome(env, { sourceBookingRef, outcome, intendedDriverId, confirmedDriverId, operator, recoveredViaReadback, decidedAt }) {
  // UNIQUE(source_booking_ref) is the actual guarantee here, not this
  // function's own care — a concurrent duplicate INSERT fails atomically
  // at the database layer and the caller falls back to reading the row
  // that won, exactly the same pattern rounds 15-19 already established
  // for `marau_real_booking_links`/mirror ownership.
  try {
    await env.DB
      .prepare(
        `INSERT INTO marau_source_confirm_outcomes
          (source_booking_ref, outcome, intended_driver_id, confirmed_driver_id, operator, recovered_via_readback, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(sourceBookingRef, outcome, String(intendedDriverId), confirmedDriverId == null ? null : String(confirmedDriverId), operator ?? null, recoveredViaReadback ? 1 : 0, decidedAt)
      .run();
  } catch (err) {
    // Someone else's concurrent attempt already recorded the durable
    // outcome first — read it back rather than treating this as an
    // error. Never re-throw: the row that exists now IS the answer.
    if (!/UNIQUE/i.test(String(err && err.message))) throw err;
  }
  return loadExistingOutcome(env, sourceBookingRef);
}

function outcomeResult(row) {
  return {
    ok: row.outcome === 'confirmed',
    outcome: row.outcome,
    confirmed_driver_id: row.confirmed_driver_id,
    operator: row.operator,
    recovered_via_readback: row.recovered_via_readback === 1,
    decided_at: row.decided_at,
  };
}

/**
 * Reads the source's own current state and decides, from THAT truth
 * alone, whether "our" intended assignment is what actually happened —
 * the recovery path both the ambiguous-write case and the
 * already-locally-ledgered-miss case share.
 */
async function recoverFromSourceState(env, client, { sourceBookingRef, driverId, operator, nowIso }) {
  const current = await client.getReservation(sourceBookingRef);
  if (!current) return { ok: false, reason: 'SOURCE_RESERVATION_NOT_FOUND' };

  if (current.status === 'pending') {
    // Genuinely never wrote anything — safe for the caller to retry.
    return { ok: false, reason: 'NOT_YET_CONFIRMED_AT_SOURCE' };
  }

  const confirmedByUs = String(current.assigned_driver_id) === String(driverId);
  const row = await recordOutcome(env, {
    sourceBookingRef,
    outcome: confirmedByUs ? 'confirmed' : 'conflict',
    intendedDriverId: driverId,
    confirmedDriverId: current.assigned_driver_id,
    operator: confirmedByUs ? operator : null, // never falsely attribute someone else's outcome to this operator
    recoveredViaReadback: true,
    decidedAt: nowIso(),
  });
  return outcomeResult(row);
}

/**
 * The one entry point this module exposes. `driverId`/`operator` are
 * only ever CONSULTED on the very first decision for a given
 * `sourceBookingRef` — every later call, regardless of what it passes,
 * reads the durable ledger back unchanged.
 */
export async function confirmReservationAtSource(env, client, { sourceBookingRef, driverId, operator, nowIso }) {
  if (!sourceBookingRef) return { ok: false, reason: 'MISSING_SOURCE_BOOKING_REF' };
  if (driverId == null) return { ok: false, reason: 'MISSING_DRIVER_ID' };
  if (!operator || !String(operator).trim()) return { ok: false, reason: 'MISSING_OPERATOR' };
  if (typeof client?.confirmReservation !== 'function' || typeof client?.getReservation !== 'function') {
    return { ok: false, reason: 'MISSING_SOURCE_CLIENT' };
  }

  // Fast idempotent path — zero network calls for any retry once a
  // decision is already durably known, from any caller, for any reason.
  const existing = await loadExistingOutcome(env, sourceBookingRef);
  if (existing) return outcomeResult(existing);

  let response;
  try {
    response = await client.confirmReservation(sourceBookingRef, { driverId });
  } catch {
    // THE CRITICAL CASE: the call may have already committed at the
    // source — its response is simply lost. Never assume failure; read
    // the source's own truth before deciding anything.
    return recoverFromSourceState(env, client, { sourceBookingRef, driverId, operator, nowIso });
  }

  if (response && response.won === true) {
    const row = await recordOutcome(env, {
      sourceBookingRef,
      outcome: 'confirmed',
      intendedDriverId: driverId,
      confirmedDriverId: driverId,
      operator,
      recoveredViaReadback: false,
      decidedAt: nowIso(),
    });
    return outcomeResult(row);
  }

  // A definite, non-ambiguous "someone/something else already won" —
  // read the source's own current state (never trust our own guessed
  // driverId as the outcome) and record it as a conflict, never a
  // confirmation.
  const current = response && response.current;
  const row = await recordOutcome(env, {
    sourceBookingRef,
    outcome: 'conflict',
    intendedDriverId: driverId,
    confirmedDriverId: current ? current.assigned_driver_id : null,
    operator: null,
    recoveredViaReadback: false,
    decidedAt: nowIso(),
  });
  return outcomeResult(row);
}
