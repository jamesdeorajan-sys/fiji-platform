/* Bula Happiness - recent-booking DISCOVERY by polling (read-only against NAT). Strict flag BULA_SOURCE_DISCOVERY (default OFF; also needs BULA_SOURCE_SYNC).
 * Flow: NAT saves a booking normally -> this poll asks NAT's read-only discovery route for ids after a watermark (ids/status/created_at only)
 *       -> each unseen id goes through the EXISTING idempotent mirror (syncRealBookingEvent, which re-reads the booking through the protected source reader)
 *       -> bulaOnSourceSync does the snapshot/jobs/welcome grant exactly as before.
 * Safety: GET only, redirects never followed, bounded pages, overlap window (re-reading is harmless: already-linked ids are skipped), the watermark never passes a
 * transiently-failing booking, a booking the mirror REFUSES (e.g. no email) is recorded in bula_source_refusals for staff and counted - it is never silently dropped,
 * no guest journey is created for it, no email is invented and nothing is sent. Never throws. Writes only Bula/Marau mirror tables. */
import { loadConfig } from './config.js';
import { bulaOnSourceSync } from './source_adapter.js';
import { syncRealBookingEvent } from '../worker/real_booking_sync.js';
import { validatedRoot } from '../worker/nadi_source_client.js';

export const OVERLAP = 20, PAGE = 50, MAX_PAGES = 4, MAX_ATTEMPTS = 10, SWEEP_LIMIT = 20, SWEEP_MIN_AGE_MS = 15 * 60e3;
const STATUSES = new Set(['pending', 'accepted', 'en_route', 'completed', 'cancelled']);
const RETRYABLE = /^(SOURCE_READ_FAILED|BOOKING_CLAIM_CONTENDED|UNEXPECTED_ERROR|SOURCE_BOOKING_NOT_FOUND)$/;
const RETRYABLE_SQL = "('SOURCE_READ_FAILED','BOOKING_CLAIM_CONTENDED','UNEXPECTED_ERROR','SOURCE_BOOKING_NOT_FOUND')";
const intOk = (n) => Number.isSafeInteger(n) && n >= 0;

async function discoveryGet(env, query) {
  const root = validatedRoot(env.NADI_SOURCE_BASE_URL); const f = env.NADI_SOURCE_FETCH || ((...a) => fetch(...a));
  const res = await f(`${root}/admin/bookings/recent${query}`, { method: 'GET', headers: { authorization: `Bearer ${env.NADI_SOURCE_ADMIN_TOKEN}` }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
  if (res.status !== 200) throw new Error(`DISCOVERY_HTTP_${res.status}`);
  let d; try { d = await res.json(); } catch { throw new Error('DISCOVERY_NON_JSON'); }
  if (!d || d.ok !== true || !Array.isArray(d.items) || !intOk(d.next_after) || !intOk(d.max_id) || typeof d.has_more !== 'boolean' || d.items.length > 100) throw new Error('DISCOVERY_MALFORMED');
  for (const it of d.items) if (!it || !Number.isSafeInteger(it.id) || it.id <= 0 || typeof it.created_at !== 'string' || !STATUSES.has(it.status)) throw new Error('DISCOVERY_MALFORMED');
  return d;
}
const signalFor = (it) => (it.status === 'pending' || it.status === 'accepted') ? { event_type: 'created', new_status: it.status, source_event_id: it.id, booking_id: it.id } : { event_type: it.status, new_status: it.status, source_event_id: it.id, booking_id: it.id };

/** Upsert an OPEN refusal (a resolved one stays resolved but keeps counting). Field names only - no guest data. */
export async function recordRefusal(db, ref, reason, detail, status, nowMs) {
  await db.prepare(`INSERT INTO bula_source_refusals (source_booking_ref, reason, detail, source_status, first_seen_at, last_seen_at, attempts) VALUES (?,?,?,?,?,?,1)
    ON CONFLICT(source_booking_ref) DO UPDATE SET reason = excluded.reason, detail = excluded.detail, source_status = excluded.source_status, last_seen_at = excluded.last_seen_at, attempts = attempts + 1`).bind(ref, reason, detail, status, nowMs, nowMs).run();
  return (await db.prepare('SELECT attempts FROM bula_source_refusals WHERE source_booking_ref = ?').bind(ref).first()).attempts;
}
const missingFields = (b) => b ? ['guest_email', 'guest_phone'].filter((k) => !(typeof b[k] === 'string' && b[k].trim())).map((k) => `missing:${k}`).join(',') || null : null;

async function processItem(env, it, deps, nowMs) {
  const ref = String(it.id);
  if (await env.DB.prepare('SELECT 1 x FROM marau_real_booking_links WHERE source_booking_ref = ?').bind(ref).first()) return { kind: 'already_mirrored' };
  const known = await env.DB.prepare('SELECT state FROM bula_source_refusals WHERE source_booking_ref = ?').bind(ref).first();
  let last = null; const inner = deps.reader; const reader = async (r) => { last = await inner(r); return last; }; reader.provenance = inner.provenance;
  let r; try { r = await syncRealBookingEvent(env, ref, signalFor(it), { ...deps, reader }); } catch { r = { ok: false, reason: 'UNEXPECTED_ERROR' }; }
  if (r.ok) {
    if (known) await env.DB.prepare("UPDATE bula_source_refusals SET state = 'resolved', resolved_at = ?, resolved_by = 'auto:mirrored' WHERE source_booking_ref = ? AND state = 'open'").bind(nowMs, ref).run();
    await bulaOnSourceSync({ ...env, BULA_SOURCE_READER: reader }, ref, nowMs);
    return { kind: 'mirrored', isNew: !known };
  }
  const detail = r.reason === 'MISSING_GUEST_CONTACT' ? missingFields(last) : (typeof r.detail === 'string' && /^SOURCE_[A-Za-z0-9_]{1,80}$/.test(r.detail) ? r.detail : null);   // codes only
  const attempts = await recordRefusal(env.DB, ref, String(r.reason || 'REFUSED').slice(0, 60), detail, it.status, nowMs);
  const retry = RETRYABLE.test(String(r.reason)) && attempts < MAX_ATTEMPTS;
  return { kind: retry ? 'retry' : 'refused', reason: r.reason, isNew: !known };
}

/** One poll. Returns counts only. */
export async function pollSourceDiscovery(env, deps, nowMs = Date.now()) {
  const cfg = loadConfig(env);
  if (!cfg.sourceDiscoveryEnabled) return { skipped: 'discovery_disabled' };
  if (!cfg.sourceSyncEnabled) return { skipped: 'source_sync_disabled' };
  if (!env.NADI_SOURCE_BASE_URL || !env.NADI_SOURCE_ADMIN_TOKEN || !deps || typeof deps.reader !== 'function') return { skipped: 'source_not_configured' };
  const fail = async (code) => { try { await env.DB.prepare('UPDATE bula_source_discovery_state SET last_poll_at = ?, last_error = ?, consecutive_failures = consecutive_failures + 1 WHERE id = 1').bind(nowMs, code.slice(0, 40)).run(); } catch { /* best effort */ } return { ok: false, error: code }; };
  try {
    const st = await env.DB.prepare('SELECT * FROM bula_source_discovery_state WHERE id = 1').first();
    if (!st) { // first run: start from "now" - history is not mirrored by discovery
      const d = await discoveryGet(env, ''); await env.DB.prepare('INSERT OR IGNORE INTO bula_source_discovery_state (id, watermark, floor_id, bootstrapped_at, last_poll_at, last_ok_at) VALUES (1,?,?,?,?,?)').bind(d.max_id, d.max_id, nowMs, nowMs, nowMs).run();
      return { ok: true, bootstrapped: true, watermark: d.max_id };
    }
    let cur = Math.max(st.floor_id, st.watermark - OVERLAP), top = st.watermark, hold = null; const seen = new Set(); const c = { discovered: 0, duplicates: 0, alreadyMirrored: 0, mirrored: 0, refused: 0, retry: 0, newRefusals: 0 };
    for (let page = 0; page < MAX_PAGES; page++) {
      const d = await discoveryGet(env, `?after=${cur}&limit=${PAGE}`);
      for (const it of [...d.items].sort((a, b) => a.id - b.id)) {
        if (seen.has(it.id)) { c.duplicates++; continue; } seen.add(it.id);
        const o = await processItem(env, it, deps, nowMs);
        if (o.kind === 'already_mirrored') c.alreadyMirrored++;
        else { c.discovered++; if (o.kind === 'mirrored') c.mirrored++; else if (o.kind === 'refused') { c.refused++; if (o.isNew) c.newRefusals++; } else { c.retry++; if (hold === null || it.id < hold) hold = it.id; } }
      }
      top = Math.max(top, d.next_after); cur = d.next_after; if (!d.has_more) break;
    }
    // PARKED-RETRY SWEEP: a retryable failure that outlived the window/attempt cap is NEVER abandoned - it is retried here (bounded per run, spaced out) until it mirrors or staff mark it handled.
    c.swept = 0; c.sweptMirrored = 0;
    const { results: parked } = await env.DB.prepare(`SELECT source_booking_ref ref, source_status status FROM bula_source_refusals WHERE state = 'open' AND reason IN ${RETRYABLE_SQL} AND last_seen_at <= ? ORDER BY first_seen_at LIMIT ?`).bind(nowMs - SWEEP_MIN_AGE_MS, SWEEP_LIMIT).all();
    for (const p of parked) { const id = Number(p.ref); if (!Number.isSafeInteger(id) || seen.has(id) || !STATUSES.has(p.status)) continue; const o = await processItem(env, { id, status: p.status, created_at: '' }, deps, nowMs); c.swept++; if (o.kind === 'mirrored') c.sweptMirrored++; }
    const wm = hold !== null ? Math.min(top, Math.max(st.watermark, hold - 1)) : top;   // never past a booking that must be retried
    await env.DB.prepare('UPDATE bula_source_discovery_state SET watermark = ?, last_poll_at = ?, last_ok_at = ?, last_error = NULL, consecutive_failures = 0, discovered_total = discovered_total + ? WHERE id = 1').bind(wm, nowMs, nowMs, c.discovered - c.retry).run();
    return { ok: true, watermark: wm, ...c };
  } catch (e) { const m = String(e && e.message || ''); return fail(/^DISCOVERY_[A-Z0-9_]+$/.test(m) ? m : 'POLL_FAILED'); }
}

/** Staff view: counts + the open refusals (references, reasons, field NAMES - no contact details). */
export async function refusalSummary(db) {
  const { results } = await db.prepare("SELECT source_booking_ref ref, reason, detail, source_status status, first_seen_at firstSeenAt, last_seen_at lastSeenAt, attempts, CASE WHEN reason IN ('SOURCE_READ_FAILED','BOOKING_CLAIM_CONTENDED','UNEXPECTED_ERROR','SOURCE_BOOKING_NOT_FOUND') THEN 1 ELSE 0 END retrying FROM bula_source_refusals WHERE state = 'open' ORDER BY first_seen_at LIMIT 100").all();
  const n = (await db.prepare("SELECT COUNT(*) n FROM bula_source_refusals WHERE state = 'open'").first()).n;
  const st = await db.prepare('SELECT watermark, last_poll_at lastPollAt, last_ok_at lastOkAt, consecutive_failures failures, discovered_total discoveredTotal FROM bula_source_discovery_state WHERE id = 1').first();
  return { open: n, items: results, discovery: st || null };
}
export async function resolveRefusal(db, ref, actor, note, nowMs) {
  const r = await db.prepare("UPDATE bula_source_refusals SET state = 'resolved', resolved_at = ?, resolved_by = ?, resolution_note = ? WHERE source_booking_ref = ? AND state = 'open'").bind(nowMs, `${actor.staffId}(${actor.role})`, String(note || '').slice(0, 300), ref).run();
  if (!r.meta.changes) return { ok: false, code: 'not_open' };
  await db.prepare('INSERT INTO bula_audit (at, actor, action, subject, detail) VALUES (?,?,?,?,?)').bind(nowMs, `${actor.staffId}(${actor.role})`, 'source_refusal_resolved', ref, String(note || '').slice(0, 300)).run();
  return { ok: true };
}
