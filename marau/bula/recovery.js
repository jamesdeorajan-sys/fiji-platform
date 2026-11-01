/* Bula Happiness — partial-failure recovery. The save path runs three INDEPENDENT steps (snapshot, email jobs, welcome grant);
 * any may fail without failing the booking. This sweep re-derives what is missing from durable state and repairs it idempotently
 * (unique keys make a second run a no-op), so a crash between any two steps loses nothing and duplicates nothing. */
import { enqueueSavedBooking, reconcileMissing } from './outbox_d1.js';
import { grantWelcome } from './inventory_credit.js';
import { saveSnapshot, snapshotFromMarauRow } from './source_snapshot.js';

export async function partyKeyFor(db, b) {
  const first = await db.prepare('SELECT client_booking_ref FROM marau_test_bookings WHERE guest_session_id = ? AND parent_booking_id IS NULL ORDER BY id LIMIT 1').bind(b.guest_session_id).first();
  return `trip:${first ? first.client_booking_ref : b.client_booking_ref}`;
}
/** One saved booking: each step isolated; returns which steps failed (never throws). */
export async function processSavedBooking(db, cfg, b, nowMs, deps = {}) {
  const failed = [];
  try { if (deps.sourceSnapshot) await saveSnapshot(db, await deps.sourceSnapshot(b)); else await saveSnapshot(db, snapshotFromMarauRow(b, nowMs, cfg.defaultCurrency)); } catch (e) { failed.push('snapshot'); }
  try { await enqueueSavedBooking(db, cfg, b, nowMs); } catch (e) { failed.push('jobs'); }
  if (cfg.creditsEnabled) { try { await grantWelcome(db, cfg, { partyKey: await partyKeyFor(db, b), actor: 'system', source: 'saved-booking', bookingRef: b.client_booking_ref, nowMs }); } catch (e) { failed.push('grant'); } }
  return failed;
}
/** Sweep: bookings saved after the cutover that are missing jobs, a grant or a snapshot. Pre-cutover bookings are never touched. */
export async function reconcileAll(db, cfg, nowMs, deps = {}) {
  const cut = await db.prepare("SELECT value FROM bula_settings WHERE key = 'outbox_cutover_iso'").first(); if (!cut) return { jobs: 0, grants: 0, snapshots: 0 };
  const jobs = await reconcileMissing(db, cfg, nowMs); let grants = 0, snapshots = 0;
  const { results } = await db.prepare('SELECT * FROM marau_test_bookings b WHERE created_at >= ? AND parent_booking_id IS NULL').bind(cut.value).all();
  for (const b of results) { try {
    if (!(await db.prepare('SELECT 1 x FROM bula_booking_snapshots WHERE booking_ref = ?').bind(b.client_booking_ref).first())) { try { await saveSnapshot(db, deps.sourceSnapshot ? await deps.sourceSnapshot(b) : snapshotFromMarauRow(b, nowMs, cfg.defaultCurrency)); snapshots++; } catch {} }
    if (cfg.creditsEnabled) { const pk = await partyKeyFor(db, b); if (!(await db.prepare('SELECT 1 x FROM bula_credit_accounts WHERE party_key = ?').bind(pk).first())) { try { const g = await grantWelcome(db, cfg, { partyKey: pk, actor: 'system', source: 'reconcile', bookingRef: b.client_booking_ref, nowMs }); if (g.granted) grants++; } catch {} } }
  } catch (e) { /* one booking's repair failing must not stop the others or the email dispatch; the next sweep retries */ }
  }
  return { jobs, grants, snapshots };
}
