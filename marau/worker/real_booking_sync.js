/* Marau Stage 1 (PREVIEW ONLY) — round 13: the CORRECTED real-booking
 * sync contract. Demonstrates, against synthetic source rows and the
 * ISOLATED Marau test D1 only, exactly how a real, human-confirmed
 * booking from the real `bookings`/`booking_events` tables (traced in
 * round 12's revised production-integration plan, and confirmed against
 * the CURRENT real worker source in this round — see
 * docs/MARAU_STAGE1_REAL_BOOKING_SYNC.md) would become a guest's Marau
 * Trip, without weakening anything this codebase has already fixed.
 *
 * This module makes NO real network or database call — exactly like
 * smart-return-trigger-fill/src/production_adapter.js, it is pure
 * mapping/validation logic over rows the caller already has (real ones,
 * eventually; synthetic ones, in every test and demonstration run here).
 *
 * ── CORRECTION 1 — verified-ownership access is REUSED, never bypassed ──
 * The round-12 plan proposed "looks up or creates a guest_sessions row
 * keyed by that booking's real contact (phone)". That is exactly the P0
 * vulnerability worker.js's createSessionAndOfferLink already exists to
 * prevent (see that function's own header comment): a matching phone
 * number must never itself hand back an existing session's access token,
 * because that would let anyone who knows (or guesses, or has simply
 * seen) a guest's phone number read every booking under it. This module
 * NEVER looks a session up by phone. The only way a later sync event
 * re-associates with an existing session is an explicit prior link row
 * in `marau_real_booking_links`, keyed by the real booking's OWN stable
 * reference — never by contact details. The very first sync of a given
 * source booking calls the SAME `createSessionAndOfferLink` a guest's
 * own booking submission calls, so a genuine same-phone earlier session
 * still only ever gets the existing verified LINK OFFER (a code only the
 * earlier session's own holder can read), never direct reuse.
 *
 * ── CORRECTION 2 — Marau's own immediate-access flow is untouched ──────
 * Nothing here changes handleCreateBooking's existing behaviour (a
 * guest's own Marau booking submission still gets immediate access with
 * status 'pending', unchanged). This module is a SEPARATE path for
 * mirroring an ALREADY-real, already-confirmed-or-later booking — it
 * never runs against a real 'pending' row (see PENDING_NOT_SYNCED
 * below), keeping Issue #54/Smart Return's confirmed-only ingestion
 * philosophy and Marau's own guest-facing access flow visibly separate,
 * as instructed.
 *
 * ── CORRECTION 3 — revocation was already built; this only tests it ───
 * worker.js's requireGuestSession already rejects a revoked session on
 * every protected endpoint, and /preview/trip/revoke already sets
 * access_token_revoked. Round 12 wrongly implied this still needed
 * wiring. This module changes nothing about it — round 13's tests
 * exercise the EXISTING mechanism directly against a protected Trip
 * endpoint, not the public booking-creation endpoint (which never
 * required a token to begin with).
 *
 * ── CORRECTION 4 — no invented confirmation policy ─────────────────────
 * Round 12 proposed mapping a real accepted booking to Marau's
 * 'confirmed' OR 'confirmed_unallocated' depending on whether the real
 * row's assigned_driver_id was set. worker.js's own history (see its
 * "FIX (third independent review, finding 6)" comment on
 * handleAdminDecideBooking) already establishes that 'confirmed_unallocated'
 * is deliberately DEAD — left in migration 0016's CHECK constraint but
 * never written by any code path, because introducing it as an active
 * policy needs an explicit decision from James that was never given.
 * Separately, the real source itself makes the proposed branch
 * impossible anyway: `bookings.assigned_driver_id` and `status='accepted'`
 * are set in the SAME atomic UPDATE in every real accept path (driver
 * self-accept and admin manual-assign both do
 * `SET assigned_driver_id = ?, status = 'accepted' WHERE assigned_driver_id
 * IS NULL AND status = 'pending'`) — a real 'accepted' booking with no
 * assigned_driver_id cannot occur. mapRealStatusToMarauStatus below maps
 * 'accepted' (and any of 'en_route'/'completed', which are downstream of
 * the same acceptance) to Marau's plain 'confirmed' only, ALWAYS — never
 * 'confirmed_unallocated'. The source's own vehicle-assignment fact is
 * still recorded, but purely as an informational field
 * (`source_assigned_driver_id`), never used to select between status
 * values — exactly the "document status and vehicle allocation
 * separately, without inventing confirmation policy" instruction.
 *
 * ── CORRECTION 5 — the guest-account PII contract is its own, not the
 *    shadow movement adapter's ──────────────────────────────────────────
 * production_adapter.js's own header states it "never reads guest_name,
 * guest_phone, guest_email, flight_number, or notes off the real booking
 * row" — correct for THAT module, because the Smart Return ledger is an
 * anonymous, opaque-reference-only matching engine with no reason to
 * carry a contactable identity at all. A guest-facing Marau session is
 * the opposite: `guest_sessions.guest_email`/`guest_phone` are NOT NULL
 * columns (migration 0007) and Marau's own booking form already requires
 * both (see worker.js's validateBookingInput) precisely so a guest can be
 * securely reached and their identity linked. This module DOES carry
 * `guest_email`/`guest_phone` through, unavoidably and intentionally —
 * that is the minimum guest-data contract a real account needs. What it
 * still never carries through, matching production_adapter.js's actual
 * privacy point (not its literal field list): flight_number, notes, or
 * any other field with no guest-facing purpose in Marau today.
 *
 * ── CORRECTION 6 — traced against the CURRENT real source, not just
 *    historical documentation ───────────────────────────────────────────
 * Round 12 said the real `nadi-marketplace/worker/worker.js` was "not
 * present in this git checkout" — true only of THIS branch's own working
 * tree, not of the repository: `git log --all` finds it, current as of
 * commit 30c6187 on refs/heads/ceo/p0-notification-reconcile (2026-09-27,
 * the most recent revision across every branch). Read directly against
 * that revision (not assumed from older docs), the real status lifecycle
 * is: pending -> accepted (handleDriverAcceptBooking /
 * handleAdminManualAssign) -> en_route -> completed, OR pending/accepted
 * -> cancelled (handleAdminCancelBooking, admin-only, blocked once
 * completed/cancelled — both real terminal states). Every one of those
 * writes its own `booking_events` row with a real, distinct `event_type`
 * ('accepted', 'en_route', 'completed', 'cancelled') — richer than round
 * 12's plan assumed (which only traced 'accepted'). REAL_EVENT_TYPES
 * below reflects this directly-verified set, not a guess.
 *
 * ── CORRECTION 7 — sync semantics: ordering, failures, no inferred
 *    cancellation ──────────────────────────────────────────────────────
 * syncRealBookingEvent applies an event only if it is genuinely newer
 * than whatever this booking's mirror already recorded, using a monotonic
 * `source_event_ordinal` (never a bare wall-clock compare, which a
 * retried send or clock skew could violate) — an older or exact-duplicate
 * event is a documented no-op, never an error and never a silent
 * overwrite. A malformed or unrecognized event returns a typed failure
 * and leaves the existing mirror row completely untouched — a sync
 * failure must never corrupt or blank out the last known-good state. And
 * critically: this module has NO function that ever infers 'cancelled'
 * from a booking's mere ABSENCE from a query scoped to accepted-only (or
 * any other status subset) — `markMissingFromLatestFeed` below sets a
 * SEPARATE `sync_state` marker, never the guest-facing `status`; only an
 * explicit 'cancelled' event ever changes `status` to 'cancelled'.
 */

// Every real event_type this round directly confirmed exists in the
// current real worker source (30c6187) — 'created' is the booking's own
// initial insert, listed here for completeness but never itself synced
// (see PENDING_NOT_SYNCED below; a 'created' event's new_status is
// always 'pending').
export const REAL_EVENT_TYPES = Object.freeze(['created', 'accepted', 'en_route', 'completed', 'cancelled']);

// A real booking is only ever mirrored into a guest's Marau Trip once it
// has moved past 'pending' — mirrors the same "confirmed-only ingestion"
// discipline Smart Return itself already applies for its own shadow
// movements, kept deliberately visible and separate from Marau's own
// guest-submitted-booking flow (which grants immediate 'pending' access
// through a completely different, untouched code path).
const PENDING_NOT_SYNCED = new Set(['pending', 'created']);

/**
 * The ONLY status mapping this module is authorized to apply. 'accepted',
 * 'en_route' and 'completed' all mean "a human has confirmed this
 * booking" from Marau's guest-facing point of view — Marau does not yet
 * have any status finer than 'confirmed' to distinguish "still en route"
 * from "trip completed" (that would be a new, currently-undecided
 * product decision, not something this sync module invents). 'cancelled'
 * maps to Marau's own 'cancelled'. Nothing maps to 'confirmed_unallocated'
 * — see CORRECTION 4 above. 'declined' is never produced by this mapping
 * because no real event type corresponds to it (a real ordinary booking
 * has no human "decline" action distinct from cancel).
 */
export function mapRealStatusToMarauStatus(sourceStatus) {
  if (sourceStatus === 'accepted' || sourceStatus === 'en_route' || sourceStatus === 'completed') return 'confirmed';
  if (sourceStatus === 'cancelled') return 'cancelled';
  return null; // pending/created/anything unrecognized — never synced, never guessed
}

function isRecognizedRealEventType(eventType) {
  return REAL_EVENT_TYPES.includes(eventType);
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

/**
 * Syncs ONE real booking event into Marau's isolated mirror. `sourceBooking`
 * is shaped like a real `bookings` row (see docs/MARAU_STAGE1_REAL_BOOKING_SYNC.md
 * for the exact field list traced from the current real worker source);
 * `sourceEvent` is shaped like one real `booking_events` row
 * (`{ event_type, previous_status, new_status, actor, created_at,
 * event_ordinal }` — `event_ordinal` is this module's own monotonic
 * counter requirement, documented above, not a literal real column).
 *
 * `deps` carries the reused worker.js functions (createGuestSession,
 * createSessionAndOfferLink, nowIso) plus `normalizePickupDatetime` from
 * fiji_time.js — injected rather than imported directly so tests can
 * exercise this module against the exact same D1 shim instance a test's
 * `env` already uses, without a second import path.
 *
 * Returns a typed result — never throws for an expected condition (a
 * batch of real events will always contain some out-of-order or
 * malformed ones; the caller needs to count and report each, not have
 * the whole run die on the first bad one).
 */
export async function syncRealBookingEvent(env, sourceBooking, sourceEvent, deps) {
  const { createGuestSession, createSessionAndOfferLink, nowIso, normalizePickupDatetime } = deps;

  if (!sourceBooking || sourceBooking.id == null) return { ok: false, reason: 'MISSING_SOURCE_BOOKING_ID' };
  if (!sourceEvent || !isRecognizedRealEventType(sourceEvent.event_type)) {
    return { ok: false, reason: 'UNRECOGNIZED_EVENT_TYPE', detail: sourceEvent && sourceEvent.event_type };
  }
  if (!Number.isInteger(sourceEvent.event_ordinal)) return { ok: false, reason: 'MISSING_EVENT_ORDINAL' };

  const sourceBookingRef = String(sourceBooking.source_booking_ref || sourceBooking.id);
  const newSourceStatus = sourceEvent.new_status;
  const marauStatus = mapRealStatusToMarauStatus(newSourceStatus);

  const existingLink = await env.DB
    .prepare('SELECT * FROM marau_real_booking_links WHERE source_booking_ref = ?')
    .bind(sourceBookingRef)
    .first();

  if (!existingLink) {
    // First-ever sync of this real booking. PENDING_NOT_SYNCED: never
    // create a Marau mirror (or a session) for a real booking that is
    // still merely 'pending' — nothing to show the guest yet that Marau's
    // own flow doesn't already cover differently.
    if (marauStatus == null || PENDING_NOT_SYNCED.has(newSourceStatus)) {
      return { ok: false, reason: 'NOT_YET_SYNCABLE', source_status: newSourceStatus };
    }
    const pickupDatetimeRaw = composeSourcePickupDatetime(sourceBooking);
    if (!pickupDatetimeRaw) return { ok: false, reason: 'MISSING_OR_INVALID_PICKUP_DATETIME' };
    let pickupDatetime;
    try {
      pickupDatetime = normalizePickupDatetime(pickupDatetimeRaw);
    } catch {
      return { ok: false, reason: 'MISSING_OR_INVALID_PICKUP_DATETIME' };
    }
    if (!sourceBooking.guest_email || !sourceBooking.guest_phone) return { ok: false, reason: 'MISSING_GUEST_CONTACT' };
    if (!Number.isFinite(Number(sourceBooking.quoted_amount))) return { ok: false, reason: 'MISSING_QUOTED_AMOUNT' };

    // Reuses the EXACT same verified-ownership function a guest's own
    // booking submission calls — see CORRECTION 1. A same-phone earlier
    // session still only ever gets a link OFFER back, never direct reuse.
    const { session, linkOffer } = await createSessionAndOfferLink(env, {
      guest_email: sourceBooking.guest_email,
      guest_phone: sourceBooking.guest_phone,
      whatsapp_available: sourceBooking.whatsapp_available ?? null,
    });

    const clientBookingRef = `REAL-SYNC-${sourceBookingRef}`;
    const now = nowIso();
    const insertResult = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO marau_test_bookings
          (client_booking_ref, guest_session_id, guest_email, guest_phone, pickup_zone, destination_zone, vehicle_type, pickup_datetime, quoted_amount, status, test_data, created_at, updated_at,
           source_booking_ref, source_status, source_assigned_driver_id, source_event_type, source_event_ordinal, source_synced_at, sync_state)
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
        newSourceStatus,
        sourceBooking.assigned_driver_id != null ? String(sourceBooking.assigned_driver_id) : null,
        sourceEvent.event_type,
        sourceEvent.event_ordinal,
        now
      )
      .run();

    if (insertResult.meta.changes !== 1) return { ok: false, reason: 'DUPLICATE_CLIENT_BOOKING_REF' };
    const marauBookingRow = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE client_booking_ref = ?').bind(clientBookingRef).first();

    await env.DB
      .prepare('INSERT INTO marau_real_booking_links (source_booking_ref, guest_session_id, marau_booking_id, created_at) VALUES (?, ?, ?, ?)')
      .bind(sourceBookingRef, session.session_id, marauBookingRow.id, now)
      .run();

    return { ok: true, created: true, session, marau_booking_id: marauBookingRow.id, link_offer: linkOffer, status: marauStatus };
  }

  // A later sync event for an ALREADY-linked real booking — apply it only
  // if it is genuinely newer. Never re-derives or re-creates a session;
  // the link row is the only re-association mechanism, exactly once,
  // ever, per real booking.
  const existingBookingRow = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(existingLink.marau_booking_id).first();
  if (!existingBookingRow) return { ok: false, reason: 'LINKED_MARAU_BOOKING_MISSING' };

  if (existingBookingRow.source_event_ordinal != null && sourceEvent.event_ordinal <= existingBookingRow.source_event_ordinal) {
    return { ok: true, applied: false, reason: 'STALE_OR_DUPLICATE_EVENT', current_ordinal: existingBookingRow.source_event_ordinal };
  }

  const now = nowIso();
  const nextStatus = marauStatus ?? existingBookingRow.status; // an unrecognized/non-mapping status leaves the guest-facing status untouched
  await env.DB
    .prepare(
      `UPDATE marau_test_bookings SET status = ?, updated_at = ?,
         source_status = ?, source_assigned_driver_id = ?, source_event_type = ?, source_event_ordinal = ?, source_synced_at = ?, sync_state = 'IN_LATEST_FEED', sync_last_error = NULL
       WHERE id = ?`
    )
    .bind(
      nextStatus,
      now,
      newSourceStatus,
      sourceBooking.assigned_driver_id != null ? String(sourceBooking.assigned_driver_id) : null,
      sourceEvent.event_type,
      sourceEvent.event_ordinal,
      now,
      existingBookingRow.id
    )
    .run();

  return { ok: true, applied: true, marau_booking_id: existingBookingRow.id, status: nextStatus };
}

/**
 * A sync PASS reads only a subset of real bookings (e.g. "everything
 * currently accepted", per docs/FIRST_READ_ONLY_RUN_PLAN.md's own Step 1
 * query) — a booking this preview already mirrors can legitimately be
 * absent from that pass simply because it moved on to a status outside
 * the query's own filter, or because of a transient read issue, NOT
 * because it was cancelled. This records that fact in `sync_state` only
 * — it is a documented, deliberate no-op on `status`, never a
 * cancellation inference. Call this for every currently-linked real
 * booking whose source_booking_ref did NOT appear in the latest pass.
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
