/* Marau Stage 1 (PREVIEW ONLY) — round 17: finishes source freshness.
 * Fixes a cross-path bug rounds 13-16's own fixes never actually closed
 * — Codex's round-16 review confirmed 416/416 tests passing, no
 * shared-engine changes, then reproduced two further, more fundamental
 * repros directly. Rounds 13-16's own corrections (verified-ownership
 * reuse, no-duplicate-guest-entry, revocation, price validation, the
 * evidenced event/status contract, terminal-state stickiness, linkage
 * recovery) all still stand; this header documents what changed THIS
 * round and why.
 *
 * ── ROUND 17 — THE BUG TERMINAL-STATE STICKINESS DIDN'T CATCH ──────────
 * Round 16 fixed cross-path REVIVAL of a terminal status (cancelled
 * reverting to confirmed). It did NOT fix cross-path staleness of
 * ordinary FIELD DATA (pickup/destination/price) while status stays
 * non-terminal — because round 16's fencing (`source_write_generation`)
 * only guards against a write computed from a STALE READ (a genuine
 * TOCTOU race). It does nothing when a caller's OWN read was perfectly
 * fresh at read time, but the PAYLOAD it read — an event or a snapshot,
 * both trusted verbatim for pickup_zone/destination_zone/vehicle_type/
 * pickup_datetime/quoted_amount — was itself stale (e.g. an event
 * delivered late, still carrying whatever the booking looked like when
 * that event first fired, not what it looks like now). Two repros
 * confirmed this directly:
 *   A. Apply snapshot seq=10: en_route, "New hotel", 14:00, $80. Deliver
 *      an OLDER accepted event id=2 carrying "Old hotel", 09:00, $45 —
 *      not terminal, generation matches (a fresh read right before the
 *      write), so it applied cleanly and REVERTED every field.
 *   B. Apply a current en_route event id=3: "New hotel", 14:00, $80.
 *      Apply an older CAPTURED accepted snapshot seq=1 carrying "Old
 *      hotel", 09:00, $45 — same story, other direction.
 *
 * "Terminal-state stickiness does not solve source freshness" (as
 * instructed) — it only ever protected the one field (`status`) that
 * happens to have real terminal values; pickup/destination/price have
 * no such concept and can legitimately change while status stays the
 * same the whole time. Comparing "generation" or "event id" or
 * "snapshot sequence" can never fix this either, because none of them
 * say anything about whether the PAYLOAD attached to a given signal is
 * itself current — they only say whether the WRITE beat a race.
 *
 * ── THE FIX: EVENTS/SNAPSHOTS ARE SIGNALS, NEVER PAYLOAD ───────────────
 * The only way to guarantee a written value is current is to READ it at
 * the moment of writing — never trust a value attached to a message that
 * might have been queued, retried, or replayed. This module's public
 * API no longer accepts a caller-supplied `sourceBooking` object as the
 * thing to WRITE. Instead:
 *   1. `syncRealBookingEvent`/`reconcileRealBooking` take a bare SIGNAL
 *      (`{ event_type, source_event_id, booking_id }` for an event; just
 *      a `snapshotSequence` for reconciliation) — informational only,
 *      never a source of field data.
 *   2. **Acquire per-booking ownership BEFORE reading the source**
 *      (`acquireBookingClaim` — migration 0028, a real, database-
 *      enforced mutual-exclusion primitive: only one claim can exist per
 *      `source_booking_ref` at a time, PRIMARY KEY-enforced, not
 *      application-logic-enforced). This serializes every read+apply for
 *      a given booking — no second caller can be mid-flight for the same
 *      booking while a claim is held, closing the remaining window a
 *      bare fencing check can't (a genuinely concurrent second reader
 *      reading AFTER the first's write but attaching an even-older
 *      payload of its own).
 *   3. **Read the CURRENT authoritative source through an injected
 *      reader** (`deps.reader(sourceBookingRef)`) — supplied by the
 *      caller, never invented or cached by this module. In production
 *      this would be a real, read-only query against `bookings`; in
 *      every test and demonstration here it is a synthetic authoritative
 *      store the test itself controls and can mutate between calls to
 *      simulate the real system changing.
 *   4. **Apply using the freshly-read data**, gated by statement-level
 *      ownership/generation fencing (`source_write_generation`) and
 *      terminal-state stickiness (both round 16, kept as defense in
 *      depth — claims already prevent same-booking concurrent writers,
 *      but a bug in the claim logic should not become a silent data
 *      corruption).
 *   5. **A retry or takeover always re-reads** — there is no code path
 *      anywhere in this module that writes a `sourceBooking` value it
 *      did not JUST obtain from `deps.reader` inside the current claim.
 *      Recovering an interrupted first-sync (round 14/16's fault-
 *      injection scenarios) still re-reads fresh via the same reader
 *      before writing anything, rather than reusing whatever payload the
 *      original, interrupted call happened to receive.
 *   6. **Reconciliation goes through the identical mechanism**
 *      (`reconcileRealBooking`) — same claim, same reader, same apply
 *      function. `snapshotSequence` is now purely a caller-supplied,
 *      informational ordering marker for provenance display (the
 *      reader's freshness is what actually guarantees correctness, not
 *      the sequence number), exactly as instructed: "the mirror
 *      generation is read after stale source data has already been
 *      supplied" is precisely the class of bug this closes by removing
 *      "supplied source data" from the equation entirely.
 *
 * Claim takeover: a claim past its own `expires_at` may be atomically
 * taken over (an `UPDATE ... WHERE expires_at < ?`, re-validated at
 * write time, the same atomic-guard pattern used everywhere else in this
 * module) — a crashed or interrupted holder must never permanently block
 * a booking. Takeover always leads into the SAME read-via-injected-
 * reader path; it never inherits or reuses the abandoned attempt's own
 * data.
 *
 * This does not remove or weaken any prior correction:
 * verified-ownership session reuse (round 13/15), no-duplicate-guest-
 * entry, revocation (round 13, untouched), the evidenced event/status
 * pairing set (round 15 — now used only as a cheap pre-filter on the
 * SIGNAL's own shape, since the actually-applied status always comes
 * from the fresh read), price validation (round 15, now applied to
 * fresh-read data), the server-only provenance/partial-unique-index
 * ownership mechanism (round 15), and terminal-state stickiness (round
 * 16) are all still enforced, just now operating on data that is
 * guaranteed current at write time.
 */

import { cryptoRandomId } from '../../smart-return-trigger-fill/src/model.js';

// Every real event_type this round directly confirmed exists in the
// current REPOSITORY source (30c6187) — repository inspection, not proof
// of the currently deployed revision (see round 15's explicit caveat,
// unchanged).
export const REAL_EVENT_TYPES = Object.freeze(['created', 'accepted', 'en_route', 'completed', 'cancelled']);

// Used only as a cheap, early SIGNAL sanity check now (round 17) — the
// field values actually written always come from the fresh read, never
// from the signal itself. Still a real, evidence-backed closed set (see
// round 15's citations), rejecting an internally-inconsistent signal
// before ever acquiring a claim or reading anything.
const LEGITIMATE_EVENT_STATUS_PAIRS = new Set([
  'created:pending',
  'created:accepted',
  'accepted:accepted',
  'en_route:en_route',
  'completed:completed',
  'cancelled:cancelled',
]);

function isLegitimateEventStatusPair(eventType, newStatus) {
  return LEGITIMATE_EVENT_STATUS_PAIRS.has(`${eventType}:${newStatus}`);
}

function isRecognizedRealEventType(eventType) {
  return REAL_EVENT_TYPES.includes(eventType);
}

// Real, source-system terminal states (round 16, unchanged) — kept as
// defense-in-depth even though claim-based serialization already
// prevents same-booking concurrent writers.
const TERMINAL_SOURCE_STATUSES = new Set(['cancelled', 'completed']);

const DEFAULT_CLAIM_TTL_MS = 30_000;

/**
 * The ONLY status mapping this module is authorized to apply — unchanged
 * from round 15/16, now always evaluated against a FRESHLY-READ
 * `sourceBooking.status`, never a signal's own `new_status`.
 */
export function mapRealStatusToMarauStatus(sourceStatus) {
  if (sourceStatus === 'pending') return 'pending';
  if (sourceStatus === 'accepted' || sourceStatus === 'en_route' || sourceStatus === 'completed') return 'confirmed';
  if (sourceStatus === 'cancelled') return 'cancelled';
  return null;
}

/**
 * Validates an EVENT SIGNAL's own shape — event_type/new_status
 * consistency (a cheap sanity pre-filter, not a source of applied data),
 * a real durable `source_event_id`, and that `booking_id` is present
 * (its match against the FRESHLY-READ booking's own id is checked later,
 * after the read — see `syncRealBookingEvent`).
 */
export function validateSourceEvent(signal) {
  if (!signal || typeof signal !== 'object') return 'MISSING_EVENT';
  if (!isRecognizedRealEventType(signal.event_type)) return 'UNRECOGNIZED_EVENT_TYPE';
  if (!isLegitimateEventStatusPair(signal.event_type, signal.new_status)) return 'EVENT_STATUS_MISMATCH';
  if (!Number.isInteger(signal.source_event_id) || signal.source_event_id <= 0) return 'MISSING_OR_INVALID_SOURCE_EVENT_ID';
  if (signal.booking_id == null) return 'MISSING_EVENT_BOOKING_ID';
  return null;
}

/**
 * FINDING (round 15, unchanged) — validates the RAW quoted_amount
 * value's type/shape before any numeric coercion, now applied to
 * freshly-read data.
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

function composeSourcePickupDatetime(sourceBooking) {
  if (sourceBooking.pickup_datetime) return sourceBooking.pickup_datetime;
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

async function findOwnedMirrorRow(env, sourceBookingRef) {
  return env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ? AND source_sync_owned = 1').bind(sourceBookingRef).first();
}

/**
 * "Acquire ownership BEFORE reading the source." A real, database-
 * enforced mutual-exclusion primitive (migration 0028) — the PRIMARY KEY
 * on `source_booking_ref` is what makes this atomic, not application
 * logic. A claim past its own `expires_at` may be atomically taken over
 * (a crashed/interrupted holder must never permanently block a
 * booking); a live, unexpired claim held by someone else is reported as
 * contended.
 */
export async function acquireBookingClaim(env, sourceBookingRef, { nowIso, claimTtlMs = DEFAULT_CLAIM_TTL_MS } = {}) {
  const now = nowIso();
  const claimToken = `claim_${cryptoRandomId()}`;
  const expiresAt = new Date(new Date(now).getTime() + claimTtlMs).toISOString();

  try {
    await env.DB
      .prepare('INSERT INTO marau_real_booking_sync_claims (source_booking_ref, claim_token, claimed_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(sourceBookingRef, claimToken, now, expiresAt)
      .run();
    return { ok: true, claimToken, tookOver: false };
  } catch (err) {
    if (!/UNIQUE constraint failed/i.test(err.message || '')) throw err;
  }

  // A claim row already exists — atomically take it over ONLY if it has
  // genuinely expired, re-validated at write time (the same
  // atomic-guard pattern used throughout this module).
  const takeover = await env.DB
    .prepare('UPDATE marau_real_booking_sync_claims SET claim_token = ?, claimed_at = ?, expires_at = ? WHERE source_booking_ref = ? AND expires_at < ?')
    .bind(claimToken, now, expiresAt, sourceBookingRef, now)
    .run();
  if (takeover.meta.changes === 1) return { ok: true, claimToken, tookOver: true };
  return { ok: false, reason: 'BOOKING_CLAIM_CONTENDED' };
}

/** Releases a held claim — only the actual holder (matching token) can release it. */
export async function releaseBookingClaim(env, sourceBookingRef, claimToken) {
  await env.DB.prepare('DELETE FROM marau_real_booking_sync_claims WHERE source_booking_ref = ? AND claim_token = ?').bind(sourceBookingRef, claimToken).run();
}

/**
 * Creates a session + mirror row for a real booking this module has
 * never seen before, OR recovers an already-owned row if one exists
 * (interrupted retry / claim takeover). `sourceBooking` here is ALWAYS
 * the just-obtained fresh read — never a caller-cached value. Never
 * looks up or trusts `client_booking_ref` for ownership — only
 * `source_booking_ref + source_sync_owned = 1`, backed by a genuine
 * SQLite partial unique index (round 15, unchanged).
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
      sourceBooking.status,
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

  // Lost a race (should be rare under claim-based serialization, but
  // kept as defense-in-depth — see this file's header) — clean up our
  // own now-unused session and recover via the real owner, found the
  // SAME safe way, never by client_booking_ref.
  await env.DB.prepare('DELETE FROM guest_link_requests WHERE new_session_id = ? OR candidate_session_id = ?').bind(session.session_id, session.session_id).run();
  await env.DB.prepare('DELETE FROM guest_sessions WHERE session_id = ?').bind(session.session_id).run();
  const winnerRow = await findOwnedMirrorRow(env, sourceBookingRef);
  if (!winnerRow) return { ok: false, reason: 'LOST_RACE_BUT_WINNER_ROW_MISSING' };
  const winnerSession = await env.DB.prepare('SELECT * FROM guest_sessions WHERE session_id = ?').bind(winnerRow.guest_session_id).first();
  return { ok: true, recovered: true, created: false, session: winnerSession, existingBookingRow: winnerRow };
}

/**
 * Applies freshly-read `sourceBooking` data to an already-fetched
 * `existingBookingRow`, ATOMICALLY — terminal-state stickiness and
 * generation fencing (round 16) both live inside the UPDATE's own WHERE
 * clause, defense-in-depth alongside claim-based serialization (round
 * 17). Because `sourceBooking` is ALWAYS a value this call chain just
 * obtained from the injected reader (never a caller-cached payload),
 * this is what actually fixes both round-17 repros — the fields written
 * are always whatever is true right now, never whatever an old
 * event/snapshot happened to carry.
 */
async function applyFreshRead(env, existingBookingRow, sourceBooking, { nowIso, marauStatus, pickupDatetime, quotedAmount, provenance }) {
  if (TERMINAL_SOURCE_STATUSES.has(existingBookingRow.source_status)) {
    return { ok: true, applied: false, reason: 'TERMINAL_STATE_LOCKED', current_source_status: existingBookingRow.source_status, marau_booking_id: existingBookingRow.id };
  }

  const now = nowIso();
  const expectedGeneration = existingBookingRow.source_write_generation;
  const updateResult = await env.DB
    .prepare(
      `UPDATE marau_test_bookings SET
         status = ?, pickup_zone = ?, destination_zone = ?, vehicle_type = ?, pickup_datetime = ?, quoted_amount = ?,
         updated_at = ?, source_status = ?, source_assigned_driver_id = ?, source_event_type = ?, source_event_id = ?, source_snapshot_sequence = ?, source_synced_at = ?,
         source_write_generation = source_write_generation + 1,
         sync_state = 'IN_LATEST_FEED', sync_last_error = NULL
       WHERE id = ?
         AND source_write_generation = ?
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
      provenance.eventType,
      provenance.eventId,
      provenance.snapshotSequence,
      now,
      existingBookingRow.id,
      expectedGeneration
    )
    .run();

  if (updateResult.meta.changes === 0) {
    const current = await env.DB.prepare('SELECT status, source_status, source_write_generation FROM marau_test_bookings WHERE id = ?').bind(existingBookingRow.id).first();
    if (!current) return { ok: true, applied: false, reason: 'MARAU_BOOKING_MISSING', marau_booking_id: existingBookingRow.id };
    const reason = TERMINAL_SOURCE_STATUSES.has(current.source_status) ? 'TERMINAL_STATE_LOCKED' : 'GENERATION_CONFLICT';
    return { ok: true, applied: false, reason, current_source_status: current.source_status, current_generation: current.source_write_generation, marau_booking_id: existingBookingRow.id };
  }

  return { ok: true, applied: true, marau_booking_id: existingBookingRow.id, status: marauStatus };
}

/**
 * The single, shared claim-acquire → fresh-read → find/create-or-apply
 * → release flow, used identically by both the event-triggered and
 * reconciliation-triggered entry points (see this file's header, point
 * 6 — "route reconciliation through the same mechanism").
 */
async function refreshRealBooking(env, sourceBookingRef, provenance, { deps }) {
  const { createSessionAndOfferLink, nowIso, normalizePickupDatetime, reader } = deps;
  if (typeof reader !== 'function') return { ok: false, reason: 'MISSING_SOURCE_READER' };

  const claim = await acquireBookingClaim(env, sourceBookingRef, { nowIso });
  if (!claim.ok) return claim;

  try {
    // FRESH READ — the entire point of this round's fix. Never the
    // caller's own attached payload.
    const sourceBooking = await reader(sourceBookingRef);
    if (!sourceBooking || sourceBooking.id == null) return { ok: false, reason: 'SOURCE_BOOKING_NOT_FOUND' };

    if (provenance.expectedBookingId != null && String(provenance.expectedBookingId) !== String(sourceBooking.id)) {
      return { ok: false, reason: 'BOOKING_EVENT_MISMATCH' };
    }

    if (typeof sourceBooking.status !== 'string') return { ok: false, reason: 'MISSING_SOURCE_STATUS' };
    const marauStatus = mapRealStatusToMarauStatus(sourceBooking.status);
    if (marauStatus == null) return { ok: false, reason: 'UNRECOGNIZED_SOURCE_STATUS' };

    const tripDetails = validateTripDetails(sourceBooking, normalizePickupDatetime);
    if (tripDetails.reason) return { ok: false, reason: tripDetails.reason };
    const { pickupDatetime, quotedAmount } = tripDetails;

    const existingLink = await env.DB.prepare('SELECT * FROM marau_real_booking_links WHERE source_booking_ref = ?').bind(sourceBookingRef).first();

    if (existingLink) {
      const existingBookingRow = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ? AND source_sync_owned = 1').bind(existingLink.marau_booking_id).first();
      if (!existingBookingRow) return { ok: false, reason: 'LINKED_MARAU_BOOKING_MISSING' };
      const applied = await applyFreshRead(env, existingBookingRow, sourceBooking, { nowIso, marauStatus, pickupDatetime, quotedAmount, provenance });
      return { ...applied, claim_took_over: claim.tookOver };
    }

    const created = await createOrRecoverOwnedRow(env, sourceBookingRef, sourceBooking, {
      nowIso,
      createSessionAndOfferLink,
      marauStatus,
      pickupDatetime,
      quotedAmount,
      provenance,
    });
    if (!created.ok) return created;
    if (created.created) {
      return { ok: true, created: true, session: created.session, marau_booking_id: created.existingBookingRow.id, link_offer: created.link_offer, status: marauStatus, claim_took_over: claim.tookOver };
    }

    // Recovered (interrupted retry or claim takeover) — apply the JUST
    // freshly-read data (never the original, possibly-abandoned
    // attempt's own payload) through the same atomic path.
    const applied = await applyFreshRead(env, created.existingBookingRow, sourceBooking, { nowIso, marauStatus, pickupDatetime, quotedAmount, provenance });
    return { ...applied, recovered: true, created: false, session: created.session, claim_took_over: claim.tookOver };
  } finally {
    await releaseBookingClaim(env, sourceBookingRef, claim.claimToken);
  }
}

/**
 * Event-triggered entry point. `signal` is `{ event_type, new_status,
 * source_event_id, booking_id }` — validated as a signal shape only
 * (round 15's evidenced pairing set, a cheap pre-filter); NONE of its
 * fields are ever written to the mirror. The actually-applied data
 * always comes from `deps.reader(sourceBookingRef)`, read fresh AFTER
 * the per-booking claim is held.
 */
export async function syncRealBookingEvent(env, sourceBookingRef, signal, deps) {
  const validationError = validateSourceEvent(signal);
  if (validationError) return { ok: false, reason: validationError };

  return refreshRealBooking(
    env,
    sourceBookingRef,
    { eventType: signal.event_type, eventId: signal.source_event_id, snapshotSequence: null, expectedBookingId: signal.booking_id },
    { deps }
  );
}

/**
 * Reconciliation-triggered entry point — the identical mechanism as
 * `syncRealBookingEvent` (this file's header, point 6). `snapshotSequence`
 * is a caller-supplied, purely informational ordering marker for
 * provenance display; it plays NO role in correctness — the injected
 * reader's freshness is what guarantees that.
 */
export async function reconcileRealBooking(env, sourceBookingRef, { snapshotSequence, deps }) {
  if (!Number.isInteger(snapshotSequence) || snapshotSequence <= 0) return { ok: false, reason: 'MISSING_OR_INVALID_SNAPSHOT_SEQUENCE' };
  return refreshRealBooking(env, sourceBookingRef, { eventType: 'snapshot', eventId: null, snapshotSequence, expectedBookingId: null }, { deps });
}

/**
 * A reconciliation pass reads only a subset of real bookings — a booking
 * this preview already mirrors can legitimately be absent from that pass
 * simply because it moved outside the pass's own filter, NOT because it
 * was cancelled. Records that fact in `sync_state` only — a documented,
 * deliberate no-op on `status`, never a cancellation inference (round 13
 * correction 7, unchanged).
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
