/* Bula Happiness — thin Worker integration (flag-gated; every flag defaults OFF). Never throws into a booking path.
 * NOTE: the booking read here is the Marau SYNTHETIC booking table through real Worker code — it is not a live NAT saved-booking
 * integration. A live source would supply `deps.sourceSnapshot` from the read-only nadi_booking_reader. */
import { loadConfig } from './config.js';
import { dispatch, reconcileAmbiguous, liveSenderDisabled, createAuditCaptureSender } from './outbox_d1.js';
import { processSavedBooking, reconcileAll } from './recovery.js';
import { runPublisher } from './offers_d1.js';
import { sweepExpired, expireGrants } from './inventory_credit.js';
import { sourceSnapshotDep } from './source_adapter.js';
import { pollSourceDiscovery } from './source_discovery.js';

export async function bulaOnSavedBooking(env, clientBookingRef, nowMs = Date.now()) {
  const cfg = loadConfig(env); if (!cfg.outboxEnabled) return { skipped: 'outbox_disabled' };
  const b = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE client_booking_ref = ?').bind(clientBookingRef).first();
  if (!b) return { skipped: 'no_booking' };
  const failed = await processSavedBooking(env.DB, cfg, b, nowMs);
  if (failed.length) console.error('[bula] partial save-step failure; sweep will repair:', failed.join(','));
  return { enqueued: !failed.includes('jobs'), failed };
}
export async function bulaRunOutbox(env, nowMs = Date.now()) {
  const cfg = loadConfig(env); if (!cfg.outboxEnabled) return { skipped: 'outbox_disabled' };
  const sender = env.BULA_CAPTURE_SENDER || (cfg.emailCaptureEnabled ? createAuditCaptureSender(env.DB) : liveSenderDisabled);     // there is no live sender in this candidate
  let repaired = { jobs: 0, grants: 0, snapshots: 0 }; try { repaired = await reconcileAll(env.DB, cfg, nowMs, { sourceSnapshot: sourceSnapshotDep(env, cfg, nowMs) }); } catch (e) { console.error('[bula] reconcile failed; dispatch continues'); }
  const resolved = await reconcileAmbiguous(env.DB, sender, nowMs);
  const stats = await dispatch(env.DB, cfg, sender, { workerId: `w-${nowMs}`, nowMs });
  return { reconciled: repaired.jobs, repaired, resolved, ...stats };
}
/** Cloudflare cron entry. Everything is behind flags that default OFF; each step is idempotent and safe to repeat (catch-up after an outage). */
export async function bulaScheduled(env, nowMs = Date.now(), opts = {}) {
  const cfg = loadConfig(env); const r = {};
  if (cfg.sourceDiscoveryEnabled) { try { r.discovery = await pollSourceDiscovery(env, opts.syncDeps, nowMs); } catch { r.discovery = { ok: false, error: 'POLL_FAILED' }; } }   // read-only against NAT; never blocks the rest
  if (cfg.editionPublishEnabled) r.publish = await runPublisher(env.DB, cfg, nowMs, `cron:${nowMs}`);
  if (cfg.checkoutEnabled) { r.holdsSettled = await sweepExpired(env.DB, nowMs); if (cfg.creditsEnabled) r.grantsExpired = await expireGrants(env.DB, nowMs); }
  if (cfg.outboxEnabled) r.outbox = await bulaRunOutbox(env, nowMs);
  return r;
}
/** Non-sensitive build metadata (names/ids only). BULA_BUILD / BULA_COMMIT are set at deploy time. */
export function bulaVersion(env) { return { app: 'marau-bula', build: env.BULA_BUILD || 'unset', commit: env.BULA_COMMIT || 'unset', schema: 'marau-0043+bula-0046' }; }
export function bulaWithBuild(pageHtml, env) {
  const v = bulaVersion(env); const i = pageHtml.lastIndexOf('</body>'); if (i < 0) return pageHtml;
  const esc = (x) => String(x).replace(/[^\w.-]/g, '');
  return `${pageHtml.slice(0, i)}<div id="app-build" data-build="${esc(v.build)}" style="position:fixed;right:6px;bottom:2px;font:10px system-ui;opacity:.45;pointer-events:none">build ${esc(v.build)}</div>${pageHtml.slice(i)}`;
}
