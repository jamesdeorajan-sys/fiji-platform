/* Bula Happiness — saved-booking ADAPTER for the existing real-booking sync (worker/real_booking_sync.js).
 *
 * What it is: the missing wire between two modules that already exist and are already verified. The sync mirrors one source booking
 * into `marau_test_bookings` (one guest session per source booking ref, never matched by phone). Bula's `processSavedBooking`
 * snapshots it, enqueues the guest/team receipt jobs and grants the one-time welcome credit. Nothing connected them.
 *
 * What it adds: NOTHING new that mutates state. It finds the mirror row through the sync's own link table (source ref -> booking),
 * builds the snapshot from the SOURCE read (so provenance and available/unavailable fields are the source's, not the Marau form's),
 * and hands both to `processSavedBooking`. Idempotence is inherited, not re-implemented:
 *   guest   - the sync links by source ref; this module never creates or looks up a session
 *   jobs    - bula_outbox.job_key is `saved-booking:<client_ref>|<kind>|<template version>`; INSERT OR IGNORE
 *   grant   - one welcome grant per party key
 *   snapshot- a new version is written only when a field actually changed
 *
 * Safety contract: separately switchable (BULA_SOURCE_SYNC, strict, default off, and the outbox flag must also be on); it NEVER
 * throws (the caller's sync/booking result is returned unchanged); a failed step is repaired by the scheduled sweep
 * (`sourceSnapshotDep` is what that sweep uses for source-owned rows); and it performs no write outside Bula's own tables.
 * No live source is connected: the reader is whatever the sync already uses (the synthetic source unless NADI_SOURCE_* is set,
 * which it is not anywhere). */
import { loadConfig } from './config.js';
import { processSavedBooking } from './recovery.js';
import { snapshotFromSource, snapshotFromMarauRow } from './source_snapshot.js';

/** Snapshot builder used by BOTH the immediate path and the repair sweep. Source-owned rows are NEVER labelled as a Marau form:
 *  if the source cannot be read right now this throws, the step is recorded as failed, and the next sweep retries. */
export function sourceSnapshotDep(env, cfg, nowMs) {
  return async (b) => {
    if (!(b.source_sync_owned === 1 && b.source_booking_ref)) return snapshotFromMarauRow(b, nowMs, cfg.defaultCurrency);
    const reader = env.BULA_SOURCE_READER;
    if (!cfg.sourceSyncEnabled || typeof reader !== 'function') throw new Error('SOURCE_SNAPSHOT_UNAVAILABLE');
    const src = await reader(b.source_booking_ref);
    if (!src) throw new Error('SOURCE_BOOKING_NOT_FOUND');
    const prov = reader.provenance || { kind: 'marau_synthetic_source', authenticated: false, read_only: true };
    return snapshotFromSource(b.client_booking_ref, src, { ...prov, source_status: src.status ?? null }, nowMs);
  };
}

/** Called after a successful sync (created, recovered, refreshed or replayed). Safe to call any number of times. */
export async function bulaOnSourceSync(env, sourceBookingRef, nowMs = Date.now()) {
  try {
    const cfg = loadConfig(env);
    if (!cfg.sourceSyncEnabled) return { skipped: 'source_sync_disabled' };
    if (!cfg.outboxEnabled) return { skipped: 'outbox_disabled' };
    const link = await env.DB.prepare('SELECT marau_booking_id FROM marau_real_booking_links WHERE source_booking_ref = ?').bind(sourceBookingRef).first();
    if (!link) return { skipped: 'not_linked' };
    const b = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ? AND source_sync_owned = 1 AND parent_booking_id IS NULL').bind(link.marau_booking_id).first();
    if (!b) return { skipped: 'no_mirror_row' };
    const failed = await processSavedBooking(env.DB, cfg, b, nowMs, { sourceSnapshot: sourceSnapshotDep(env, cfg, nowMs) });
    if (failed.length) console.error('[bula] source-sync partial failure; sweep will repair:', failed.join(','));
    return { ok: true, bookingRef: b.client_booking_ref, failed };
  } catch (e) {
    console.error('[bula] source-sync adapter failed (booking unaffected):', e && e.message);
    return { ok: false, error: 'adapter_failed' };
  }
}
