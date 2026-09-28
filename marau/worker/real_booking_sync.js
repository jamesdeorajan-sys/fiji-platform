/* Marau Stage 1 (PREVIEW ONLY) — round 16: fixes two bounded blockers
 * from Codex's independent review of round 15 (commit 35f887f, 406/406
 * verified passing, no shared-engine changes). Rounds 13-15's own
 * corrections still stand and are unchanged except where noted below;
 * this header documents only what changed THIS round and why.
 *
 * ── ROUND 16, FINDING 1 — one coherent cross-path authority contract ───
 * Round 15 tracked event-driven ordering (`source_event_id`) and
 * snapshot-driven ordering (`source_snapshot_sequence`) as two
 * completely SEPARATE counters, each compared only against its OWN prior
 * value. That let either path blindly overwrite whatever the OTHER path
 * most recently wrote — an event-id and a snapshot-sequence are not
 * comparable numbers at all; "newer on one axis" says nothing about
 * freshness on the other. Two repros confirmed this directly:
 *   A. Apply a cancelled SNAPSHOT (`source_status` becomes 'cancelled',
 *      `source_snapshot_sequence` set). Deliver an OLDER accepted EVENT
 *      — `source_event_id` was still NULL (no event had ever applied to
 *      this row), so "`source_event_id IS NULL`" trivially admitted ANY
 *      event, silently reviving the cancelled booking as confirmed.
 *   B. Capture an accepted SNAPSHOT (read, not yet applied). Apply a
 *      NEWER cancelled EVENT (`source_event_id` set, status cancelled).
 *      Apply the OLDER captured snapshot — `source_snapshot_sequence`
 *      was still NULL, so it too was trivially admitted, silently
 *      reviving the cancelled booking as confirmed AGAIN, from the other
 *      direction.
 *
 * Per instruction, the fix does NOT compare the two unrelated counters
 * against each other. Instead it has two complementary layers:
 *   1. TERMINAL-STATE STICKINESS (the actual fix for both repros above,
 *      and the primary cross-path authority rule): 'cancelled' and
 *      'completed' are REAL terminal states in the source system itself
 *      — see this file's own citation, already established in round 13,
 *      of `handleAdminCancelBooking`'s real comment: "Blocked from
 *      'completed' or already-'cancelled' — both are real terminal
 *      states, not something a cancel action should ever override."
 *      Once `source_status` (a VALUE both paths read/write identically,
 *      not a counter) reaches either value, from EITHER path, no future
 *      apply from EITHER path may change it — checked first, inside the
 *      same atomic UPDATE's WHERE clause, before any per-path counter
 *      check. This one rule fixes both repros without ever comparing an
 *      event id to a snapshot sequence.
 *   2. SHARED GENERATION FENCING (`source_write_generation`, migration
 *      0027) — a single counter incremented by ONE successful write from
 *      EITHER path, used as an optimistic-concurrency fencing token: a
 *      write is only accepted if the row's CURRENT generation still
 *      matches what the caller observed when it read the row. This is
 *      the "serialized authoritative reads with ownership fencing"
 *      mechanism named in the instruction — it does not, and cannot,
 *      establish which of two genuinely incomparable sources (an event
 *      vs. a snapshot, neither of which carries the other's kind of
 *      version) is "more true," but it DOES guarantee no write is ever
 *      based on a stale read from EITHER path, closing the remaining
 *      TOCTOU gap for the non-terminal case that terminal-stickiness
 *      alone doesn't cover. Within-path ordering (`source_event_id` for
 *      events, `source_snapshot_sequence` for snapshots — rounds 14/15,
 *      unchanged) still runs alongside both of the above, in the SAME
 *      atomic WHERE clause, so an out-of-order-delivered (but
 *      freshly-read, non-racing) event or snapshot is still correctly
 *      rejected even when generation fencing alone would have allowed
 *      it.
 *
 * ── ROUND 16, FINDING 2 — snapshot recovery must repair linkage too ────
 * Round 15's `applySourceSnapshot` looked up an existing OWNED row
 * directly (`findOwnedMirrorRow`) and, if found, went straight to
 * applying the snapshot — it never checked whether `marau_real_booking_links`
 * actually had a row for it. Codex's repro: fault-inject the link-row
 * INSERT during a first snapshot sync (real `CREATE TRIGGER ...
 * RAISE(ABORT)`), so the mirror row is created (with
 * `source_sync_owned = 1`) but its link row is missing; remove the fault
 * and retry the SAME snapshot. Because `findOwnedMirrorRow` already
 * found the orphaned row, the retry skipped straight to the ordinary
 * "is this snapshot newer" check, which correctly reported
 * `STALE_OR_DUPLICATE_SNAPSHOT` (same sequence as before) — reported
 * `ok: true` while the link row remained permanently missing. Fixed by
 * restructuring `applySourceSnapshot` to check `marau_real_booking_links`
 * FIRST, exactly like `syncRealBookingEvent` already does — when no link
 * exists yet, it now always routes through `createOrRecoverOwnedRow`
 * (the SAME shared repair path both functions use), which idempotently
 * ensures the link row exists whether the owned row is brand new or
 * already there from an earlier interrupted attempt, before ever
 * applying the current snapshot. Never creates an extra session, never
 * adopts a guest-created row (FINDING 1 from round 15, unchanged), and
 * never touches `access_token_revoked` — repair only ever re-links an
 * EXISTING session to its own row, it does not re-create or un-revoke
 * anything.
 *
 * ── ROUND 15, FINDING 1 (P0) — server-controlled provenance, never a
 *    guest-writable column ───────────────────────────────────────────────
 * Round 13/14's first-sync recovery path identified "an earlier attempt
 * of THIS sync" by looking up `marau_test_bookings` by `client_booking_ref
 * = 'REAL-SYNC-<source_booking_ref>'` alone. That column is directly
 * settable by any guest via the public /preview/bookings endpoint.
 * Codex's repro: a guest predicts the naming scheme, POSTs their own
 * booking under `client_booking_ref: 'REAL-SYNC-9001'` with THEIR OWN
 * contact details; when the real sync later runs for source booking
 * id=9001 belonging to a DIFFERENT guest, the recovery/lost-race logic
 * found the first guest's row, wrongly believed it was this module's own
 * earlier attempt, and attached the second guest's real booking data —
 * and access — to the FIRST guest's session. A deterministic, guessable
 * client_booking_ref is not proof a row was created by this module.
 *
 * Fixed with a server-only provenance marker (`source_sync_owned`,
 * migration 0026) that NO guest-facing endpoint ever sets (confirmed:
 * handleCreateBooking's own INSERT column list has no `source_sync_owned`
 * or `source_booking_ref` at all — a guest literally cannot write either
 * column, regardless of what `client_booking_ref` they choose). Every
 * lookup this module uses to decide "is this row already mine" now
 * queries `source_booking_ref = ? AND source_sync_owned = 1` — NEVER
 * `client_booking_ref` — and `client_booking_ref` itself is generated
 * with a fresh random component per attempt (no longer a fixed,
 * guessable string), so a guest cannot even pre-collide with it on
 * purpose. Race-safety no longer depends on `client_booking_ref`'s own
 * uniqueness at all: a genuine SQLite PARTIAL UNIQUE INDEX
 * (`idx_marau_test_bookings_source_owned`, `WHERE source_sync_owned = 1`)
 * guarantees, at the database level, that at most one row can EVER be
 * source_sync_owned for a given source_booking_ref — covering
 * pre-existing collisions, concurrent first-creation races, and
 * interrupted-recovery retries with the SAME mechanism. This module
 * still never adopts a guest-created row or session under any
 * circumstance — the ownership check is unconditional and structural,
 * not a best-effort heuristic.
 *
 * ── ROUND 15, FINDING 2 — reject invalid prices BEFORE coercion ────────
 * Round 13/14's quoted_amount check was `Number.isFinite(Number(raw))` —
 * `Number(null)` is `0`, `Number('')` is `0`, `Number(false)` is `0`, all
 * of which are finite and silently became a real price of 0.00.
 * `validateQuotedAmount` now inspects the RAW value's type/shape first
 * (null/undefined/blank-string/boolean/non-numeric-string all rejected
 * outright) before ever coercing to a number, and still rejects negative
 * or non-finite numeric values. An explicit, deliberate `0` (a real,
 * legitimately free/comped fare — Marau's own validateBookingInput
 * already allows this: `Number(body.quoted_amount) >= 0`) is preserved,
 * matching the existing contract exactly. Runs strictly before any
 * database write, so a rejection leaves the full previous state
 * unchanged (same discipline as round 14's finding 5).
 *
 * ── ROUND 15, FINDING 3 — the real source-event contract, corrected ────
 * Round 13/14's `EVENT_TYPE_TO_STATUS` assumed `event_type: 'created'`
 * always pairs with `new_status: 'pending'`. Reading the CITED real
 * source revision (30c6187) directly again this round: `createBookingRecord`
 * (the shared insert path) accepts a `status` PARAMETER (default
 * `'pending'`, not hardcoded), and `logBookingEvent({ eventType:
 * 'created', ..., newStatus: status })` uses that same variable — so a
 * `created` event's `new_status` is NOT always `'pending'`. Direct
 * evidence of a legitimate `created`+`accepted` pairing: the
 * WhatsApp-negotiated-booking path explicitly calls
 * `createBookingRecord(env, { ..., assignedDriverId: driverId, status:
 * 'accepted', actor: 'admin' })` — a booking created ALREADY accepted,
 * with its driver pre-assigned, no separate accept step ever happens for
 * it. `LEGITIMATE_EVENT_STATUS_PAIRS` below is an explicit SET of every
 * (event_type, new_status) pairing this round found direct evidence for
 * in the real source — `created:pending`, `created:accepted`,
 * `accepted:accepted`, `en_route:en_route`, `completed:completed`,
 * `cancelled:cancelled` — deliberately NOT a looser rule that would also
 * accept an unevidenced combination (e.g. `created:cancelled`,
 * `accepted:en_route`) "just in case." Booking association
 * (`sourceEvent.booking_id === sourceBooking.id`) is now REQUIRED, not
 * optional — a missing `booking_id` is rejected outright
 * (`MISSING_EVENT_BOOKING_ID`), matching how `production_adapter.js`'s
 * own `isHumanConfirmedBooking` treats this as a mandatory proof, not an
 * optional nicety.
 *
 * ── ROUND 15, FINDING 4 — the missing-event reliability gap ────────────
 * The real `logBookingEvent` (30c6187) wraps its own INSERT in a bare
 * try/catch that only `console.warn`s on failure — a real `bookings` row
 * save (including the VERY FIRST `created` event) can succeed with NO
 * corresponding `booking_events` row ever existing. An event-only sync
 * (everything above) can therefore permanently miss a booking's creation
 * (no Marau session ever granted at all) or a later detail change, with
 * no retry mechanism anywhere in the real system to catch it. This is a
 * genuine, currently-open reliability gap in the real system as read —
 * the real `bookings` table also has no generic `updated_at`/version
 * column a reconciliation pass could fall back on (confirmed: every real
 * `UPDATE bookings SET ...` statement in the current source touches only
 * the specific changed columns, never a version/timestamp column).
 *
 * `applySourceSnapshot` below is the documented, demonstrated fallback:
 * a periodic reconciliation pass reads a real booking's CURRENT full row
 * directly (independent of whether any `booking_events` row exists for
 * it at all) and applies it via this function, gated by
 * `source_snapshot_sequence` — a SEPARATE ordering column from
 * `source_event_id` (migration 0026), explicitly never conflated with
 * it. `snapshotSequence` MUST be supplied by the caller as a genuinely
 * durable value (e.g. a persisted `reconciliation_runs.id`, written once
 * per pass before ever reading `bookings`) — this module does NOT invent
 * or derive one internally, per instruction. `applySourceSnapshot` can
 * also perform the FIRST sync of a booking whose own `created` event
 * never logged (using the SAME collision-safe, server-only-provenance
 * mechanism as finding 1 — there is exactly one ownership path in this
 * module, shared by both the event-driven and snapshot-driven callers).
 *
 * **Explicit distinction, per instruction:** everything in this file's
 * header about the real system's behavior is REPOSITORY SOURCE
 * INSPECTION — a direct read of commit `30c6187` in this repo's git
 * history (`git log --all`). It has NOT been verified against whatever
 * revision is actually deployed to the live `nadi-dispatch-api` Worker
 * right now; a repository commit is not proof of what code is currently
 * running in production, which could differ (a rollback, a hotfix
 * deployed without a corresponding commit, or a newer un-pulled commit).
 * Confirming the deployed revision would require live, authenticated
 * inspection of the running Worker (e.g. `wrangler deployments list`
 * against the real account, or a live, read-only API probe) — this
 * round does not do that; it corrects the module's understanding of the
 * REPOSITORY's own source, nothing more.
 */

import { cryptoRandomId } from '../../smart-return-trigger-fill/src/model.js';

// Every real event_type this round directly confirmed exists in the
// current REPOSITORY source (30c6187) — see FINDING 4's explicit
// repo-vs-deployed distinction above.
export const REAL_EVENT_TYPES = Object.freeze(['created', 'accepted', 'en_route', 'completed', 'cancelled']);

// The explicit, evidence-backed set of legitimate (event_type, new_status)
// pairings — see FINDING 3 above for the direct source citations behind
// each one. Deliberately a closed set, not a looser rule.
const LEGITIMATE_EVENT_STATUS_PAIRS = new Set([
  'created:pending', // ordinary booking creation (createBookingRecord's default status)
  'created:accepted', // WhatsApp-negotiated booking, created already-accepted with a pre-assigned driver
  'accepted:accepted', // driver self-accept / admin manual-assign of a previously-pending booking
  'en_route:en_route',
  'completed:completed',
  'cancelled:cancelled',
]);

function isLegitimateEventStatusPair(eventType, newStatus) {
  return LEGITIMATE_EVENT_STATUS_PAIRS.has(`${eventType}:${newStatus}`);
}

// ROUND 16, FINDING 1 — real, source-system terminal states. Once
// `source_status` reaches either value, from EITHER path, nothing may
// ever change it again. See this file's header for the full rationale
// and the real source's own comment this is grounded in.
const TERMINAL_SOURCE_STATUSES = new Set(['cancelled', 'completed']);

/**
 * The ONLY status mapping this module is authorized to apply. 'pending'
 * maps to Marau's own 'pending' (immediate access, unconfirmed).
 * 'accepted', 'en_route' and 'completed' all mean "a human has confirmed
 * this booking" from Marau's guest-facing point of view — Marau has no
 * status finer than 'confirmed' today. 'cancelled' maps to Marau's own
 * 'cancelled'. Nothing maps to 'confirmed_unallocated' (round 13
 * correction 4, unchanged).
 */
export function mapRealStatusToMarauStatus(sourceStatus) {
  if (sourceStatus === 'pending') return 'pending';
  if (sourceStatus === 'accepted' || sourceStatus === 'en_route' || sourceStatus === 'completed') return 'confirmed';
  if (sourceStatus === 'cancelled') return 'cancelled';
  return null;
}

function isRecognizedRealEventType(eventType) {
  return REAL_EVENT_TYPES.includes(eventType);
}

/**
 * Validates a (sourceBooking, sourceEvent) pair COMPLETELY before this
 * module ever touches the database. FINDING 3: event_type/new_status
 * must be one of the explicit, evidenced LEGITIMATE_EVENT_STATUS_PAIRS,
 * and booking_id is now REQUIRED (not optional) proof of association.
 */
export function validateSourceEvent(sourceBooking, sourceEvent) {
  if (!sourceBooking || sourceBooking.id == null) return 'MISSING_SOURCE_BOOKING_ID';
  if (!sourceEvent || typeof sourceEvent !== 'object') return 'MISSING_EVENT';
  if (!isRecognizedRealEventType(sourceEvent.event_type)) return 'UNRECOGNIZED_EVENT_TYPE';
  if (!isLegitimateEventStatusPair(sourceEvent.event_type, sourceEvent.new_status)) return 'EVENT_STATUS_MISMATCH';
  if (!Number.isInteger(sourceEvent.source_event_id) || sourceEvent.source_event_id <= 0) return 'MISSING_OR_INVALID_SOURCE_EVENT_ID';
  if (sourceEvent.booking_id == null) return 'MISSING_EVENT_BOOKING_ID';
  if (String(sourceEvent.booking_id) !== String(sourceBooking.id)) return 'BOOKING_EVENT_MISMATCH';
  return null;
}

/**
 * FINDING 2 — validates the RAW quoted_amount value's type/shape before
 * any numeric coercion. null/undefined/blank-string/boolean/non-numeric
 * are all rejected outright (none of these coerce to a meaningful price,
 * even though several coerce to a silently-wrong 0 via bare `Number()`).
 * A deliberate, explicit 0 — a real, legitimate free/comped fare — is
 * preserved, matching worker.js's own validateBookingInput contract
 * (`Number(body.quoted_amount) >= 0`) exactly. Negative and non-finite
 * values are rejected.
 */
function validateQuotedAmount(raw) {
  if (raw === null || raw === undefined) return { reason: 'MISSING_QUOTED_AMOUNT' };
  if (typeof raw === 'boolean') return { reason: 'INVALID_QUOTED_AMOUNT' };
  if (typeof raw === 'string' && raw.trim() === '') return { reason: 'MISSING_QUOTED_AMOUNT' };
  if (typeof raw !== 'number' && typeof raw !== 'string') return { reason: 'INVALID_QUOTED_AMOUNT' };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { reason: 'INVALID_QUOTED_AMOUNT' };
  if (n < 0) return { reason: 'INVALID_QUOTED_AMOUNT' };
  return { value: n };
}

/**
 * Composes a real bookings row's Fiji-local pickup_date/pickup_time into
 * the same shape normalizePickupDatetime already accepts (reused
 * directly — no new date-math written for this module; see fiji_time.js).
 */
function composeSourcePickupDatetime(sourceBooking) {
  if (sourceBooking.pickup_datetime) return sourceBooking.pickup_datetime; // already composed/zoned upstream
  if (!sourceBooking.pickup_date || !sourceBooking.pickup_time) return null;
  return `${sourceBooking.pickup_date}T${sourceBooking.pickup_time}`;
}

function validateTripDetails(sourceBooking, normalizePickupDatetime) {
  if (!sourceBooking.pickup_zone || !sourceBooking.destination_zone || !sourceBooking.vehicle_type) return { reason: 'MISSING_TRIP_DETAILS' };
  const pickupDatetimeRaw = composeSourcePickupDatetime(sourceBooking);
  if (!pickupDatetimeRaw) return { reason: 'MISSING_OR_INVALID_PICKUP_DATETIME' };
  let pickupDatetime;
  try {
    pickupDatetime = normalizePickupDatetime(pickupDatetimeRaw);
  } catch {
    return { reason: 'MISSING_OR_INVALID_PICKUP_DATETIME' };
  }
  const priceResult = validateQuotedAmount(sourceBooking.quoted_amount);
  if (priceResult.reason) return { reason: priceResult.reason };
  return { pickupDatetime, quotedAmount: priceResult.value };
}

/**
 * Looks up the ONE row (if any) this module itself has ever created for
 * a given real source booking — via the server-only provenance marker
 * ONLY, never client_booking_ref. See FINDING 1.
 */
async function findOwnedMirrorRow(env, sourceBookingRef) {
  return env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ? AND source_sync_owned = 1').bind(sourceBookingRef).first();
}

/**
 * Applies ONE already-validated event to an already-fetched
 * `existingBookingRow`, ATOMICALLY — the ordering check
 * (`source_event_id IS NULL OR source_event_id < ?`) lives inside the
 * UPDATE's own WHERE clause, re-evaluated by SQLite/D1 against the row's
 * CURRENT state at write time, never a possibly-stale earlier read (round
 * 14, finding 2 — unchanged this round). Also writes pickup_zone/
 * destination_zone/vehicle_type/pickup_datetime/quoted_amount from the
 * current `sourceBooking` snapshot on every call (round 14, finding 4 —
 * unchanged).
 */
export async function applyEventIfNewer(env, existingBookingRow, sourceBooking, sourceEvent, { nowIso, marauStatus, pickupDatetime, quotedAmount }) {
  // Fast, non-atomic pre-check purely for a clear, specific return
  // reason — the AUTHORITATIVE guard is the same condition repeated
  // inside the UPDATE's own WHERE clause below, which is what actually
  // protects against a concurrent write racing in between this read and
  // that write.
  if (TERMINAL_SOURCE_STATUSES.has(existingBookingRow.source_status)) {
    return { ok: true, applied: false, reason: 'TERMINAL_STATE_LOCKED', current_source_status: existingBookingRow.source_status, marau_booking_id: existingBookingRow.id };
  }

  const now = nowIso();
  const expectedGeneration = existingBookingRow.source_write_generation;
  const updateResult = await env.DB
    .prepare(
      `UPDATE marau_test_bookings SET
         status = ?, pickup_zone = ?, destination_zone = ?, vehicle_type = ?, pickup_datetime = ?, quoted_amount = ?,
         updated_at = ?, source_status = ?, source_assigned_driver_id = ?, source_event_type = ?, source_event_id = ?, source_synced_at = ?,
         source_write_generation = source_write_generation + 1,
         sync_state = 'IN_LATEST_FEED', sync_last_error = NULL
       WHERE id = ?
         AND source_write_generation = ?
         AND (source_event_id IS NULL OR source_event_id < ?)
         AND source_status NOT IN ('cancelled', 'completed')`
    )
    .bind(
      marauStatus,
      sourceBooking.pickup_zone,
      sourceBooking.destination_zone,
      sourceBooking.vehicle_type,
      pickupDatetime,
      quotedAmount,
      now,
      sourceEvent.new_status,
      sourceBooking.assigned_driver_id != null ? String(sourceBooking.assigned_driver_id) : null,
      sourceEvent.event_type,
      sourceEvent.source_event_id,
      now,
      existingBookingRow.id,
      expectedGeneration,
      sourceEvent.source_event_id
    )
    .run();

  if (updateResult.meta.changes === 0) {
    return rejectedApplyResult(env, existingBookingRow.id, expectedGeneration, 'source_event_id');
  }

  return { ok: true, applied: true, marau_booking_id: existingBookingRow.id, status: marauStatus };
}

/**
 * Shared, precise-reason reporting for a rejected atomic apply (event or
 * snapshot) — re-reads the row's CURRENT state to distinguish WHY the
 * WHERE clause matched zero rows: a real terminal-state lock (round 16
 * finding 1's primary fix), a generation-fencing conflict (a concurrent
 * write from either path happened since the caller's own read — the
 * secondary anti-TOCTOU layer), or a genuine same-path stale/duplicate
 * replay (rounds 14/15's ordering checks, still enforced).
 */
async function rejectedApplyResult(env, marauBookingId, expectedGeneration, orderingColumn) {
  const current = await env.DB.prepare(`SELECT ${orderingColumn}, status, source_status, source_write_generation FROM marau_test_bookings WHERE id = ?`).bind(marauBookingId).first();
  if (!current) return { ok: true, applied: false, reason: 'MARAU_BOOKING_MISSING', marau_booking_id: marauBookingId };
  const reason = TERMINAL_SOURCE_STATUSES.has(current.source_status)
    ? 'TERMINAL_STATE_LOCKED'
    : current.source_write_generation !== expectedGeneration
      ? 'GENERATION_CONFLICT'
      : orderingColumn === 'source_event_id'
        ? 'STALE_OR_DUPLICATE_EVENT'
        : 'STALE_OR_DUPLICATE_SNAPSHOT';
  return {
    ok: true,
    applied: false,
    reason,
    current_source_status: current.source_status,
    current_generation: current.source_write_generation,
    [`current_${orderingColumn}`]: current[orderingColumn],
    marau_booking_id: marauBookingId,
  };
}

/**
 * Creates a session + mirror row for a real booking this module has
 * never seen before, OR recovers an already-owned row if one exists
 * (interrupted retry / concurrent race — FINDING 1's single, shared
 * ownership path, used by both syncRealBookingEvent and
 * applySourceSnapshot). `marauStatus`/`pickupDatetime`/`quotedAmount`
 * have already been validated by the caller. Never looks up or trusts
 * `client_booking_ref` for ownership — only `source_booking_ref +
 * source_sync_owned = 1`, and the database's own partial unique index
 * makes a genuine concurrent double-creation impossible regardless of
 * application-level timing.
 */
async function createOrRecoverOwnedRow(env, sourceBookingRef, sourceBooking, { nowIso, createSessionAndOfferLink, marauStatus, pickupDatetime, quotedAmount, provenance }) {
  if (!sourceBooking.guest_email || !sourceBooking.guest_phone) return { ok: false, reason: 'MISSING_GUEST_CONTACT' };

  const priorOwnedRow = await findOwnedMirrorRow(env, sourceBookingRef);
  if (priorOwnedRow) {
    const now = nowIso();
    const session = await env.DB.prepare('SELECT * FROM guest_sessions WHERE session_id = ?').bind(priorOwnedRow.guest_session_id).first();
    await env.DB
      .prepare('INSERT OR IGNORE INTO marau_real_booking_links (source_booking_ref, guest_session_id, marau_booking_id, created_at) VALUES (?, ?, ?, ?)')
      .bind(sourceBookingRef, priorOwnedRow.guest_session_id, priorOwnedRow.id, now)
      .run();
    return { ok: true, recovered: true, created: false, session, existingBookingRow: priorOwnedRow };
  }

  const { session, linkOffer } = await createSessionAndOfferLink(env, {
    guest_email: sourceBooking.guest_email,
    guest_phone: sourceBooking.guest_phone,
    whatsapp_available: sourceBooking.whatsapp_available ?? null,
  });

  // No longer a fixed, guessable string — a fresh random component per
  // attempt (FINDING 1). client_booking_ref's own uniqueness is now only
  // collision-avoidance for the INSERT; it carries no provenance meaning.
  const clientBookingRef = `REAL-SYNC-${sourceBookingRef}-${cryptoRandomId().slice(0, 8)}`;
  const now = nowIso();
  const insertResult = await env.DB
    .prepare(
      `INSERT OR IGNORE INTO marau_test_bookings
        (client_booking_ref, guest_session_id, guest_email, guest_phone, pickup_zone, destination_zone, vehicle_type, pickup_datetime, quoted_amount, status, test_data, created_at, updated_at,
         source_booking_ref, source_status, source_assigned_driver_id, source_event_type, source_event_id, source_snapshot_sequence, source_synced_at, sync_state, source_sync_owned, source_write_generation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'IN_LATEST_FEED', 1, 1)`
    )
    .bind(
      clientBookingRef,
      session.session_id,
      sourceBooking.guest_email,
      sourceBooking.guest_phone,
      sourceBooking.pickup_zone,
      sourceBooking.destination_zone,
      sourceBooking.vehicle_type,
      pickupDatetime,
      quotedAmount,
      marauStatus,
      now,
      now,
      sourceBookingRef,
      provenance.status,
      sourceBooking.assigned_driver_id != null ? String(sourceBooking.assigned_driver_id) : null,
      provenance.eventType,
      provenance.eventId,
      provenance.snapshotSequence,
      now
    )
    .run();

  if (insertResult.meta.changes === 1) {
    const marauBookingRow = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE client_booking_ref = ?').bind(clientBookingRef).first();
    await env.DB
      .prepare('INSERT INTO marau_real_booking_links (source_booking_ref, guest_session_id, marau_booking_id, created_at) VALUES (?, ?, ?, ?)')
      .bind(sourceBookingRef, session.session_id, marauBookingRow.id, now)
      .run();
    return { ok: true, created: true, session, link_offer: linkOffer, existingBookingRow: marauBookingRow };
  }

  // INSERT OR IGNORE reported 0 changes — either the (astronomically
  // unlikely) random client_booking_ref collided with an unrelated row,
  // or — far more likely — we genuinely lost a concurrent race against
  // ANOTHER first-sync attempt for the SAME source booking, which the
  // database's own partial unique index on source_booking_ref (WHERE
  // source_sync_owned = 1) just resolved in the OTHER caller's favor.
  // Clean up our own now-unused session (mirrors worker.js's own
  // handleCreateBooking cleanup pattern) and recover via the real owner
  // — found the SAME safe way, never by client_booking_ref.
  await env.DB.prepare('DELETE FROM guest_link_requests WHERE new_session_id = ? OR candidate_session_id = ?').bind(session.session_id, session.session_id).run();
  await env.DB.prepare('DELETE FROM guest_sessions WHERE session_id = ?').bind(session.session_id).run();
  const winnerRow = await findOwnedMirrorRow(env, sourceBookingRef);
  if (!winnerRow) return { ok: false, reason: 'LOST_RACE_BUT_WINNER_ROW_MISSING' };
  const winnerSession = await env.DB.prepare('SELECT * FROM guest_sessions WHERE session_id = ?').bind(winnerRow.guest_session_id).first();
  return { ok: true, recovered: true, created: false, session: winnerSession, existingBookingRow: winnerRow };
}

/**
 * Syncs ONE real booking EVENT into Marau's isolated mirror — the
 * primary, event-driven path. See this file's header for the full
 * round-15 correction of each finding.
 */
export async function syncRealBookingEvent(env, sourceBooking, sourceEvent, deps) {
  const { createSessionAndOfferLink, nowIso, normalizePickupDatetime } = deps;

  const validationError = validateSourceEvent(sourceBooking, sourceEvent);
  if (validationError) return { ok: false, reason: validationError };

  const tripDetails = validateTripDetails(sourceBooking, normalizePickupDatetime);
  if (tripDetails.reason) return { ok: false, reason: tripDetails.reason };
  const { pickupDatetime, quotedAmount } = tripDetails;

  const sourceBookingRef = String(sourceBooking.source_booking_ref || sourceBooking.id);
  const marauStatus = mapRealStatusToMarauStatus(sourceEvent.new_status); // never null after validateSourceEvent passes

  const existingLink = await env.DB.prepare('SELECT * FROM marau_real_booking_links WHERE source_booking_ref = ?').bind(sourceBookingRef).first();

  if (existingLink) {
    const existingBookingRow = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ? AND source_sync_owned = 1').bind(existingLink.marau_booking_id).first();
    if (!existingBookingRow) return { ok: false, reason: 'LINKED_MARAU_BOOKING_MISSING' };
    return applyEventIfNewer(env, existingBookingRow, sourceBooking, sourceEvent, { nowIso, marauStatus, pickupDatetime, quotedAmount });
  }

  const created = await createOrRecoverOwnedRow(env, sourceBookingRef, sourceBooking, {
    nowIso,
    createSessionAndOfferLink,
    marauStatus,
    pickupDatetime,
    quotedAmount,
    provenance: { status: sourceEvent.new_status, eventType: sourceEvent.event_type, eventId: sourceEvent.source_event_id, snapshotSequence: null },
  });
  if (!created.ok) return created;

  if (created.created) {
    return { ok: true, created: true, session: created.session, marau_booking_id: created.existingBookingRow.id, link_offer: created.link_offer, status: marauStatus };
  }

  // Recovered an existing owned row (interrupted retry or a lost
  // concurrent race) — apply this event through the SAME atomic, ordered
  // path as any other, in case it is actually newer than what the
  // recovered row already has.
  const applied = await applyEventIfNewer(env, created.existingBookingRow, sourceBooking, sourceEvent, { nowIso, marauStatus, pickupDatetime, quotedAmount });
  return { ...applied, recovered: true, created: false, session: created.session };
}

/**
 * FINDING 4 — reconciliation-only fallback for a real booking whose
 * relevant booking_events row (creation OR a later change) never logged
 * at all. Reads the booking's CURRENT full state directly — no
 * sourceEvent, no event-type/new_status validation (there is no event to
 * validate) — and applies it gated by `snapshotSequence`, a value the
 * CALLER must supply as a genuinely durable, monotonically increasing
 * number (e.g. a persisted reconciliation-run id) — this function never
 * invents one. Shares the exact same server-only-provenance ownership
 * mechanism as syncRealBookingEvent (FINDING 1) for first discovery, and
 * a SEPARATE ordering column (`source_snapshot_sequence`, never
 * `source_event_id`) for updates to an already-owned row, so a snapshot
 * pass can never be mistaken for (or corrupt the ordering of) a genuine
 * event-driven application.
 */
export async function applySourceSnapshot(env, sourceBooking, { snapshotSequence, deps }) {
  if (!Number.isInteger(snapshotSequence) || snapshotSequence <= 0) return { ok: false, reason: 'MISSING_OR_INVALID_SNAPSHOT_SEQUENCE' };
  if (!sourceBooking || sourceBooking.id == null) return { ok: false, reason: 'MISSING_SOURCE_BOOKING_ID' };
  if (typeof sourceBooking.status !== 'string') return { ok: false, reason: 'MISSING_SOURCE_STATUS' };

  const { createSessionAndOfferLink, nowIso, normalizePickupDatetime } = deps;
  const marauStatus = mapRealStatusToMarauStatus(sourceBooking.status);
  if (marauStatus == null) return { ok: false, reason: 'UNRECOGNIZED_SOURCE_STATUS' };

  const tripDetails = validateTripDetails(sourceBooking, normalizePickupDatetime);
  if (tripDetails.reason) return { ok: false, reason: tripDetails.reason };
  const { pickupDatetime, quotedAmount } = tripDetails;

  const sourceBookingRef = String(sourceBooking.source_booking_ref || sourceBooking.id);

  // ROUND 16, FINDING 2: check the link table FIRST, exactly like
  // syncRealBookingEvent does — NOT findOwnedMirrorRow first. A row can
  // legitimately exist (source_sync_owned = 1) from an earlier attempt
  // whose link-row insert failed; going straight to "apply the snapshot"
  // on that row (round 15's bug) skips repairing the missing link
  // forever. Routing through createOrRecoverOwnedRow whenever no link
  // exists yet — the SAME repair path syncRealBookingEvent already
  // uses — fixes this for both a genuinely first sync AND an interrupted
  // retry, with one code path.
  const existingLink = await env.DB.prepare('SELECT * FROM marau_real_booking_links WHERE source_booking_ref = ?').bind(sourceBookingRef).first();

  if (existingLink) {
    const existingBookingRow = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ? AND source_sync_owned = 1').bind(existingLink.marau_booking_id).first();
    if (!existingBookingRow) return { ok: false, reason: 'LINKED_MARAU_BOOKING_MISSING' };
    return applySnapshotIfNewer(env, existingBookingRow, sourceBooking, { nowIso, marauStatus, pickupDatetime, quotedAmount, snapshotSequence });
  }

  const created = await createOrRecoverOwnedRow(env, sourceBookingRef, sourceBooking, {
    nowIso,
    createSessionAndOfferLink,
    marauStatus,
    pickupDatetime,
    quotedAmount,
    provenance: { status: sourceBooking.status, eventType: 'snapshot', eventId: null, snapshotSequence },
  });
  if (!created.ok) return created;
  if (created.created) {
    return { ok: true, created: true, session: created.session, marau_booking_id: created.existingBookingRow.id, link_offer: created.link_offer, status: marauStatus, via: 'snapshot' };
  }

  // Recovered (link repaired, session/row reused, per FINDING 2) — apply
  // the current snapshot through the SAME atomic, ordered path as any
  // other, in case it is actually newer than what the recovered row
  // already has.
  const applied = await applySnapshotIfNewer(env, created.existingBookingRow, sourceBooking, { nowIso, marauStatus, pickupDatetime, quotedAmount, snapshotSequence });
  return { ...applied, recovered: true, created: false, session: created.session, via: 'snapshot' };
}

async function applySnapshotIfNewer(env, existingBookingRow, sourceBooking, { nowIso, marauStatus, pickupDatetime, quotedAmount, snapshotSequence }) {
  if (TERMINAL_SOURCE_STATUSES.has(existingBookingRow.source_status)) {
    return { ok: true, applied: false, reason: 'TERMINAL_STATE_LOCKED', current_source_status: existingBookingRow.source_status, marau_booking_id: existingBookingRow.id, via: 'snapshot' };
  }

  const now = nowIso();
  const expectedGeneration = existingBookingRow.source_write_generation;
  const updateResult = await env.DB
    .prepare(
      `UPDATE marau_test_bookings SET
         status = ?, pickup_zone = ?, destination_zone = ?, vehicle_type = ?, pickup_datetime = ?, quoted_amount = ?,
         updated_at = ?, source_status = ?, source_assigned_driver_id = ?, source_event_type = 'snapshot', source_snapshot_sequence = ?, source_synced_at = ?,
         source_write_generation = source_write_generation + 1,
         sync_state = 'IN_LATEST_FEED', sync_last_error = NULL
       WHERE id = ?
         AND source_write_generation = ?
         AND (source_snapshot_sequence IS NULL OR source_snapshot_sequence < ?)
         AND source_status NOT IN ('cancelled', 'completed')`
    )
    .bind(
      marauStatus,
      sourceBooking.pickup_zone,
      sourceBooking.destination_zone,
      sourceBooking.vehicle_type,
      pickupDatetime,
      quotedAmount,
      now,
      sourceBooking.status,
      sourceBooking.assigned_driver_id != null ? String(sourceBooking.assigned_driver_id) : null,
      snapshotSequence,
      now,
      existingBookingRow.id,
      expectedGeneration,
      snapshotSequence
    )
    .run();

  if (updateResult.meta.changes === 0) {
    const rejected = await rejectedApplyResult(env, existingBookingRow.id, expectedGeneration, 'source_snapshot_sequence');
    return { ...rejected, via: 'snapshot' };
  }

  return { ok: true, applied: true, marau_booking_id: existingBookingRow.id, status: marauStatus, via: 'snapshot' };
}

/**
 * A sync PASS reads only a subset of real bookings — a booking this
 * preview already mirrors can legitimately be absent from that pass
 * simply because it moved on to a status outside the pass's own filter,
 * NOT because it was cancelled. Records that fact in `sync_state` only —
 * a documented, deliberate no-op on `status`, never a cancellation
 * inference (round 13 correction 7, unchanged).
 */
export async function markMissingFromLatestFeed(env, sourceBookingRef, { nowIso: nowIsoFn }) {
  const link = await env.DB.prepare('SELECT * FROM marau_real_booking_links WHERE source_booking_ref = ?').bind(sourceBookingRef).first();
  if (!link) return { ok: false, reason: 'NOT_LINKED' };
  await env.DB
    .prepare(`UPDATE marau_test_bookings SET sync_state = 'MISSING_FROM_LATEST_FEED', updated_at = ? WHERE id = ?`)
    .bind(nowIsoFn(), link.marau_booking_id)
    .run();
  return { ok: true };
}
