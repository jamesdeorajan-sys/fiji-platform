/* Marau Stage 1 (PREVIEW ONLY) — round 14: fixes five bounded findings
 * from Codex's independent review of round 13's real-booking sync module
 * (commit 41c9ba4, 401/401 verified passing, no shared-engine changes).
 * Round 13's own corrections (1-7, see that round's header, preserved
 * below for provenance) still stand; this header only documents what
 * changed THIS round and why.
 *
 * This module still makes NO real network or database call — pure
 * mapping/validation/write logic over rows the caller already has,
 * exactly like smart-return-trigger-fill/src/production_adapter.js.
 *
 * ── ROUND 14, FINDING 1 — immediate access on SAVE, not on acceptance ──
 * Round 13 wrongly conflated two different things under "confirmed-only
 * ingestion": Smart Return's own policy (system B only ever ingests a
 * CONFIRMED movement — unrelated to this module, untouched, still true)
 * and Marau's own access-granting timing (system A -> this module's
 * mirror), which round 12/13 had never actually been told to gate on
 * acceptance. The real requirement, restated directly this round: "A
 * saved NAT/FijiDash booking must produce secure pending Trip access
 * without duplicate guest entry or waiting for acceptance." A real
 * booking's own 'created' event (new_status 'pending') now runs through
 * the SAME first-sync path as any other event — it creates a session +
 * a Marau mirror row with Marau's own 'pending' status immediately, no
 * different in spirit from Marau's own guest-submitted form's immediate
 * access. The Marau-only test form is not, and was never meant to be,
 * how a REAL guest gets in — this module is.
 *
 * ── ROUND 14, FINDING 2 — atomic ordering, durable version ─────────────
 * Round 13's ordering check was READ-then-WRITE: SELECT the existing row,
 * compare event_ordinal, THEN UPDATE unconditionally. Codex's repro:
 * pause event 2 (a later, in-flight accept) after its SELECT but before
 * its UPDATE; apply event 3 (a cancellation) to completion; resume event
 * 2's UPDATE. Because event 2's UPDATE never re-checked the ordering
 * condition at write time, it silently overwrote event 3's cancellation
 * with its own, now-stale, confirmed state — a real, demonstrated bug.
 * Fixed by moving the ordering check INTO the UPDATE's own WHERE clause
 * (`WHERE id = ? AND (source_event_id IS NULL OR source_event_id < ?)`),
 * checked and applied by SQLite/D1 as a single atomic statement — no
 * interleaving of two calls can ever let a stale write win, regardless of
 * when either call's JS resumes. `applyEventIfNewer` below is exported
 * specifically so a test can reproduce the exact TOCTOU shape
 * deterministically (capture a stale row snapshot, apply a later event
 * fully, then attempt to apply using the stale snapshot) without relying
 * on real thread timing. Separately: round 13's `event_ordinal` was an
 * invented per-test-run counter, not a real, durable version — "a
 * per-run invented counter is insufficient" is correct. This round uses
 * `source_event_id`, meant to be populated from the real
 * `booking_events.id` (a genuine, durable, monotonic auto-increment
 * PRIMARY KEY in the real schema — see migration 0025's own header).
 *
 * ── ROUND 14, FINDING 3 — recoverable, idempotent first sync ───────────
 * Round 13's first-sync path did three separate writes (create session,
 * insert booking, insert link row) with NO recovery if the LAST one
 * failed: cleanup only ran on a lost client_booking_ref RACE, never on a
 * mid-sequence failure. Codex's repro (fault-inject the link-row INSERT,
 * retry after removing the fault) reproduced exactly the reported
 * symptom: DUPLICATE_CLIENT_BOOKING_REF on retry, one orphaned unlinked
 * booking, two sessions. Fixed by checking for the DETERMINISTIC,
 * derived `client_booking_ref` (`REAL-SYNC-<source_booking_ref>`) BEFORE
 * ever creating a new session: if a booking already exists under that
 * ref (a prior attempt got that far before its own link-row insert
 * failed), this round reuses its EXISTING session/booking and simply
 * (idempotently) ensures the link row exists and re-applies the current
 * event — no second session, ever. This is INTERNAL recovery of this
 * sync job's own prior, already-legitimately-created state; it is never
 * access granted to an external caller merely by presenting a reference
 * or matching contact details — nothing here is reachable from any
 * guest-facing endpoint, and verified ownership (correction 1, round 13)
 * is completely unchanged. The SAME recovery path also now handles a
 * genuine concurrent first-delivery race (two simultaneous first syncs
 * for the same source booking): the loser cleans up its own now-unused
 * session (same established pattern as worker.js's own
 * handleCreateBooking) and recovers via the winner's row, never leaving
 * an orphan and never creating two live sessions for one real booking.
 *
 * ── ROUND 14, FINDING 4 — authoritative field changes, not status-only ─
 * Round 13's update path only ever touched status/provenance columns.
 * Codex's finding: a later source snapshot with a changed pickup time,
 * route, vehicle or price must actually update the guest's Trip. Fixed:
 * `applyEventIfNewer` now writes pickup_zone/destination_zone/
 * vehicle_type/pickup_datetime/quoted_amount from the CURRENT
 * `sourceBooking` snapshot on every apply (first sync AND every
 * subsequent event) — gated by the exact same validated, atomic,
 * ordered `source_event_id` check as everything else, so a change is
 * only ever applied from a genuinely newer, validated snapshot, never a
 * stale or unvalidated one.
 *
 * ── ROUND 14, FINDING 5 — validate the COMPLETE event before any write ──
 * Round 13 validated `event_type` alone; a recognized `event_type` with
 * an inconsistent `new_status` (e.g. `event_type: 'accepted',
 * new_status: 'garbage'`) still advanced `source_event_ordinal` and
 * provenance fields, because `mapRealStatusToMarauStatus('garbage')`
 * returning `null` only skipped the STATUS write, not the whole event.
 * Fixed: `validateSourceEvent` now checks event_type/new_status
 * CONSISTENCY (via `EVENT_TYPE_TO_STATUS`, the one real, explicit
 * mapping this module is authorized to assume), a real, durable
 * `source_event_id`, and booking association (`sourceEvent.booking_id`,
 * when supplied, must match `sourceBooking.id` — mirroring
 * `production_adapter.js`'s own `isHumanConfirmedBooking` check) — ALL
 * before any read or write happens. Any failure here returns a typed
 * result with NOTHING touched in the database — trivially true, since
 * validation runs strictly before the first DB call.
 */

// Every real event_type this round directly confirmed exists in the
// current real worker source (30c6187) — 'created' is the booking's own
// initial insert (new_status always 'pending'), now itself synced
// immediately (see FINDING 1 above).
export const REAL_EVENT_TYPES = Object.freeze(['created', 'accepted', 'en_route', 'completed', 'cancelled']);

// The ONE real, explicit event_type -> new_status mapping this module is
// authorized to assume — used to VALIDATE a supplied event's internal
// consistency, not to guess a missing value. A mismatch (e.g. event_type
// 'accepted' with new_status 'garbage') is rejected outright before any
// write, per FINDING 5.
const EVENT_TYPE_TO_STATUS = Object.freeze({
  created: 'pending',
  accepted: 'accepted',
  en_route: 'en_route',
  completed: 'completed',
  cancelled: 'cancelled',
});

/**
 * The ONLY status mapping this module is authorized to apply.
 * 'pending' maps to Marau's own 'pending' (immediate access, unconfirmed
 * — FINDING 1). 'accepted', 'en_route' and 'completed' all mean "a human
 * has confirmed this booking" from Marau's guest-facing point of view —
 * Marau does not yet have any status finer than 'confirmed' to
 * distinguish "still en route" from "trip completed" (a new,
 * currently-undecided product decision, not something this sync module
 * invents). 'cancelled' maps to Marau's own 'cancelled'. Nothing maps to
 * 'confirmed_unallocated' — see round 13's correction 4, still in force.
 */
export function mapRealStatusToMarauStatus(sourceStatus) {
  if (sourceStatus === 'pending') return 'pending';
  if (sourceStatus === 'accepted' || sourceStatus === 'en_route' || sourceStatus === 'completed') return 'confirmed';
  if (sourceStatus === 'cancelled') return 'cancelled';
  return null; // anything unrecognized — never synced, never guessed
}

function isRecognizedRealEventType(eventType) {
  return REAL_EVENT_TYPES.includes(eventType);
}

/**
 * Validates a (sourceBooking, sourceEvent) pair COMPLETELY before this
 * module ever touches the database — event_type/new_status consistency,
 * a real durable source_event_id, and booking association. Returns a
 * typed failure reason, or null when the event is fully valid. Called
 * first, unconditionally, in syncRealBookingEvent — see FINDING 5.
 */
export function validateSourceEvent(sourceBooking, sourceEvent) {
  if (!sourceBooking || sourceBooking.id == null) return 'MISSING_SOURCE_BOOKING_ID';
  if (!sourceEvent || typeof sourceEvent !== 'object') return 'MISSING_EVENT';
  if (!isRecognizedRealEventType(sourceEvent.event_type)) return 'UNRECOGNIZED_EVENT_TYPE';
  const expectedStatus = EVENT_TYPE_TO_STATUS[sourceEvent.event_type];
  if (sourceEvent.new_status !== expectedStatus) return 'EVENT_STATUS_MISMATCH';
  if (!Number.isInteger(sourceEvent.source_event_id) || sourceEvent.source_event_id <= 0) return 'MISSING_OR_INVALID_SOURCE_EVENT_ID';
  if (sourceEvent.booking_id != null && String(sourceEvent.booking_id) !== String(sourceBooking.id)) return 'BOOKING_EVENT_MISMATCH';
  return null;
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
  if (!Number.isFinite(Number(sourceBooking.quoted_amount))) return { reason: 'MISSING_QUOTED_AMOUNT' };
  return { pickupDatetime };
}

/**
 * Applies ONE already-validated event to an already-fetched
 * `existingBookingRow`, ATOMICALLY: the ordering check
 * (`source_event_id IS NULL OR source_event_id < ?`) lives inside the
 * UPDATE's own WHERE clause, so it is re-evaluated by SQLite/D1 against
 * whatever the row's CURRENT state actually is at write time — never
 * against the possibly-stale `existingBookingRow` snapshot the caller
 * read earlier. This is what makes the round-14 TOCTOU fix (FINDING 2)
 * hold regardless of how the caller's own async code is interleaved;
 * exported so a test can reproduce the exact "stale read, later write"
 * shape deterministically (capture a snapshot, apply a newer event to
 * completion via syncRealBookingEvent, then call this directly with the
 * stale snapshot and prove it is correctly rejected).
 *
 * Also writes pickup_zone/destination_zone/vehicle_type/pickup_datetime/
 * quoted_amount from the current `sourceBooking` snapshot on every call
 * — FINDING 4: an authoritative later snapshot's changed trip details
 * really do reach the guest's Trip, gated by the same atomic ordering.
 */
export async function applyEventIfNewer(env, existingBookingRow, sourceBooking, sourceEvent, { nowIso, marauStatus, pickupDatetime }) {
  const now = nowIso();
  const updateResult = await env.DB
    .prepare(
      `UPDATE marau_test_bookings SET
         status = ?, pickup_zone = ?, destination_zone = ?, vehicle_type = ?, pickup_datetime = ?, quoted_amount = ?,
         updated_at = ?, source_status = ?, source_assigned_driver_id = ?, source_event_type = ?, source_event_id = ?, source_synced_at = ?,
         sync_state = 'IN_LATEST_FEED', sync_last_error = NULL
       WHERE id = ? AND (source_event_id IS NULL OR source_event_id < ?)`
    )
    .bind(
      marauStatus,
      sourceBooking.pickup_zone,
      sourceBooking.destination_zone,
      sourceBooking.vehicle_type,
      pickupDatetime,
      Number(sourceBooking.quoted_amount),
      now,
      sourceEvent.new_status,
      sourceBooking.assigned_driver_id != null ? String(sourceBooking.assigned_driver_id) : null,
      sourceEvent.event_type,
      sourceEvent.source_event_id,
      now,
      existingBookingRow.id,
      sourceEvent.source_event_id
    )
    .run();

  if (updateResult.meta.changes === 0) {
    const current = await env.DB.prepare('SELECT source_event_id, status FROM marau_test_bookings WHERE id = ?').bind(existingBookingRow.id).first();
    return {
      ok: true,
      applied: false,
      reason: 'STALE_OR_DUPLICATE_EVENT',
      current_source_event_id: current ? current.source_event_id : null,
      marau_booking_id: existingBookingRow.id,
    };
  }

  return { ok: true, applied: true, marau_booking_id: existingBookingRow.id, status: marauStatus };
}

/**
 * Syncs ONE real booking event into Marau's isolated mirror — see this
 * file's header for the full round-14 correction of each finding.
 * `sourceBooking` is shaped like a real `bookings` row (see
 * docs/MARAU_STAGE1_REAL_BOOKING_SYNC.md); `sourceEvent` is shaped like
 * one real `booking_events` row plus this module's own required
 * `source_event_id` (meant to be populated from the real
 * `booking_events.id`, not invented — see migration 0025).
 *
 * `deps` carries the reused worker.js functions (createGuestSession —
 * kept in the signature for interface stability even though this
 * module's own recovery paths no longer call it directly outside the
 * genuine-first-attempt branch — createSessionAndOfferLink, nowIso) plus
 * `normalizePickupDatetime` from fiji_time.js.
 *
 * Returns a typed result — never throws for an EXPECTED condition (a
 * batch of real events will always contain some out-of-order, malformed,
 * or interrupted ones; the caller needs to count and report each, not
 * have the whole run die on the first bad one). It DOES let a genuine
 * unexpected database error (e.g. a fault-injected trigger on the very
 * last write of a first sync) propagate — see FINDING 3's header: that
 * propagation, followed by a caller retry, is the supported recovery
 * path, not something this function should swallow.
 */
export async function syncRealBookingEvent(env, sourceBooking, sourceEvent, deps) {
  const { createSessionAndOfferLink, nowIso, normalizePickupDatetime } = deps;

  const validationError = validateSourceEvent(sourceBooking, sourceEvent);
  if (validationError) return { ok: false, reason: validationError };

  const tripDetails = validateTripDetails(sourceBooking, normalizePickupDatetime);
  if (tripDetails.reason) return { ok: false, reason: tripDetails.reason };
  const { pickupDatetime } = tripDetails;

  const sourceBookingRef = String(sourceBooking.source_booking_ref || sourceBooking.id);
  const marauStatus = mapRealStatusToMarauStatus(sourceEvent.new_status); // never null after validateSourceEvent passes

  const existingLink = await env.DB.prepare('SELECT * FROM marau_real_booking_links WHERE source_booking_ref = ?').bind(sourceBookingRef).first();

  if (existingLink) {
    const existingBookingRow = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(existingLink.marau_booking_id).first();
    if (!existingBookingRow) return { ok: false, reason: 'LINKED_MARAU_BOOKING_MISSING' };
    return applyEventIfNewer(env, existingBookingRow, sourceBooking, sourceEvent, { nowIso, marauStatus, pickupDatetime });
  }

  if (!sourceBooking.guest_email || !sourceBooking.guest_phone) return { ok: false, reason: 'MISSING_GUEST_CONTACT' };

  const clientBookingRef = `REAL-SYNC-${sourceBookingRef}`;

  // RECOVERY CHECK (FINDING 3) — a deterministic, derived ref, looked up
  // BEFORE ever creating a new session. If a booking already exists
  // under it, an earlier attempt (this call's own prior try, or a
  // concurrent racing one) already got this far; reuse its session and
  // booking row exactly, ensure the link row exists (idempotent), and
  // re-apply the current event through the SAME atomic, ordered path —
  // never create a second session for one real booking.
  const priorAttemptRow = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE client_booking_ref = ?').bind(clientBookingRef).first();
  if (priorAttemptRow) {
    const now = nowIso();
    await env.DB
      .prepare('INSERT OR IGNORE INTO marau_real_booking_links (source_booking_ref, guest_session_id, marau_booking_id, created_at) VALUES (?, ?, ?, ?)')
      .bind(sourceBookingRef, priorAttemptRow.guest_session_id, priorAttemptRow.id, now)
      .run();
    const session = await env.DB.prepare('SELECT * FROM guest_sessions WHERE session_id = ?').bind(priorAttemptRow.guest_session_id).first();
    const applied = await applyEventIfNewer(env, priorAttemptRow, sourceBooking, sourceEvent, { nowIso, marauStatus, pickupDatetime });
    return { ...applied, recovered: true, created: false, session };
  }

  // Genuinely first attempt.
  const { session, linkOffer } = await createSessionAndOfferLink(env, {
    guest_email: sourceBooking.guest_email,
    guest_phone: sourceBooking.guest_phone,
    whatsapp_available: sourceBooking.whatsapp_available ?? null,
  });

  const now = nowIso();
  const insertResult = await env.DB
    .prepare(
      `INSERT OR IGNORE INTO marau_test_bookings
        (client_booking_ref, guest_session_id, guest_email, guest_phone, pickup_zone, destination_zone, vehicle_type, pickup_datetime, quoted_amount, status, test_data, created_at, updated_at,
         source_booking_ref, source_status, source_assigned_driver_id, source_event_type, source_event_id, source_synced_at, sync_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'IN_LATEST_FEED')`
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
      Number(sourceBooking.quoted_amount),
      marauStatus,
      now,
      now,
      sourceBookingRef,
      sourceEvent.new_status,
      sourceBooking.assigned_driver_id != null ? String(sourceBooking.assigned_driver_id) : null,
      sourceEvent.event_type,
      sourceEvent.source_event_id,
      now
    )
    .run();

  if (insertResult.meta.changes !== 1) {
    // Lost a genuine concurrent race against ANOTHER first-sync attempt
    // for the SAME source booking (two simultaneous deliveries) — clean
    // up our own now-unused session (mirrors worker.js's own
    // handleCreateBooking cleanup pattern exactly), then recover via the
    // winner's row.
    await env.DB.prepare('DELETE FROM guest_link_requests WHERE new_session_id = ? OR candidate_session_id = ?').bind(session.session_id, session.session_id).run();
    await env.DB.prepare('DELETE FROM guest_sessions WHERE session_id = ?').bind(session.session_id).run();
    const winnerRow = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE client_booking_ref = ?').bind(clientBookingRef).first();
    if (!winnerRow) return { ok: false, reason: 'LOST_RACE_BUT_WINNER_ROW_MISSING' };
    await env.DB
      .prepare('INSERT OR IGNORE INTO marau_real_booking_links (source_booking_ref, guest_session_id, marau_booking_id, created_at) VALUES (?, ?, ?, ?)')
      .bind(sourceBookingRef, winnerRow.guest_session_id, winnerRow.id, now)
      .run();
    const winnerSession = await env.DB.prepare('SELECT * FROM guest_sessions WHERE session_id = ?').bind(winnerRow.guest_session_id).first();
    const applied = await applyEventIfNewer(env, winnerRow, sourceBooking, sourceEvent, { nowIso, marauStatus, pickupDatetime });
    return { ...applied, recovered: true, created: false, session: winnerSession };
  }

  const marauBookingRow = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE client_booking_ref = ?').bind(clientBookingRef).first();

  // Deliberately NOT wrapped in try/catch: if this specific write fails
  // (e.g. a fault-injected trigger), the session and booking row already
  // durably exist, and the caller's retry will hit the priorAttemptRow
  // recovery branch above — never creating a second session. Letting the
  // error propagate here is what makes "remove the trigger and retry"
  // the correct, supported recovery action.
  await env.DB
    .prepare('INSERT INTO marau_real_booking_links (source_booking_ref, guest_session_id, marau_booking_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(sourceBookingRef, session.session_id, marauBookingRow.id, now)
    .run();

  return { ok: true, created: true, session, marau_booking_id: marauBookingRow.id, link_offer: linkOffer, status: marauStatus };
}

/**
 * A sync PASS reads only a subset of real bookings (e.g. "everything
 * currently accepted", per docs/FIRST_READ_ONLY_RUN_PLAN.md's own Step 1
 * query) — a booking this preview already mirrors can legitimately be
 * absent from that pass simply because it moved on to a status outside
 * the query's own filter, or because of a transient read issue, NOT
 * because it was cancelled. This records that fact in `sync_state` only
 * — a documented, deliberate no-op on `status`, never a cancellation
 * inference (round 13 correction 7, unchanged this round). Call this for
 * every currently-linked real booking whose source_booking_ref did NOT
 * appear in the latest pass.
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
