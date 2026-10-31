/* Bula Happiness — thin Worker integration (flag-gated; every flag defaults OFF). Never throws into a booking path. */
import { loadConfig } from './config.js';
import { enqueueSavedBooking, reconcileMissing, dispatch, reconcileAmbiguous, liveSenderDisabled } from './outbox_d1.js';
import { grantWelcome } from './inventory_credit.js';

export async function bulaOnSavedBooking(env, clientBookingRef, nowMs = Date.now()) {
  const cfg = loadConfig(env); if (!cfg.outboxEnabled) return { skipped: 'outbox_disabled' };
  const b = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE client_booking_ref = ?').bind(clientBookingRef).first();
  if (!b) return { skipped: 'no_booking' };
  await enqueueSavedBooking(env.DB, cfg, b, nowMs);
  if (cfg.creditsEnabled) { try { await grantWelcome(env.DB, cfg, { partyKey: `trip:${clientBookingRef}`, actor: 'system', source: 'saved-booking', nowMs }); } catch (e) { console.error('[bula] grant failed', e && e.code); } }
  return { enqueued: true };
}
export async function bulaRunOutbox(env, nowMs = Date.now()) {
  const cfg = loadConfig(env); if (!cfg.outboxEnabled) return { skipped: 'outbox_disabled' };
  const sender = env.BULA_CAPTURE_SENDER || liveSenderDisabled;     // there is no live sender in this candidate
  const reconciled = await reconcileMissing(env.DB, cfg, nowMs);
  const resolved = await reconcileAmbiguous(env.DB, sender, nowMs);
  const stats = await dispatch(env.DB, cfg, sender, { workerId: `w-${nowMs}`, nowMs });
  return { reconciled, resolved, ...stats };
}
