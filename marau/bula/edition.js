/* Bula Happiness — 18:00 Pacific/Fiji daily edition logic (ISOLATED, pure, no I/O).
 * Edition for Fiji service date D becomes visible at D-1 18:00 Fiji wall-clock.
 * Uses the existing Marau Fiji-time helpers (Intl tzdata), never host/Sydney time. */
import { fijiWallClockToUtcIso, getFijiOffsetMinutesAt } from '../worker/fiji_time.js';

export const RELEASE_HOUR_FIJI = 18;
const pad = (n) => String(n).padStart(2, '0');

export function fijiYmd(utcMs) {
  const d = new Date(utcMs + getFijiOffsetMinutesAt(utcMs) * 60000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}
export function ymdString({ y, m, d }) { return `${y}-${pad(m)}-${pad(d)}`; }
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
/** UTC ms at which the edition for `serviceDate` (YYYY-MM-DD, Fiji) is released. */
export function releaseInstantMs(serviceDate) {
  return Date.parse(fijiWallClockToUtcIso(`${addDays(serviceDate, -1)}T${pad(RELEASE_HOUR_FIJI)}:00`));
}
export function isEditionVisible(serviceDate, nowMs) { return nowMs >= releaseInstantMs(serviceDate); }
/** The newest service date whose edition is visible now (tomorrow from 18:00 Fiji, else today). */
export function latestVisibleServiceDate(nowMs) {
  const f = fijiYmd(nowMs); const today = ymdString(f);
  return f.h >= RELEASE_HOUR_FIJI ? addDays(today, 1) : today;
}

/** Offer lifecycle for editions: draft -> approved -> scheduled -> published -> expired/withdrawn. */
export function offerBookable(offer, nowMs) {
  if (offer.status !== 'published') return { ok: false, reason: 'not_published' };
  if (!(offer.remaining > 0)) return { ok: false, reason: 'sold_out' };
  if (nowMs >= Date.parse(offer.bookingCutoffUtc)) return { ok: false, reason: 'past_cutoff' };
  if (!isEditionVisible(offer.serviceDate, nowMs)) return { ok: false, reason: 'not_yet_released' };
  return { ok: true };
}

/** Idempotent publisher with catch-up: publishes every approved offer whose release time has
 *  passed and whose cutoff has NOT (never publishes stale inventory after a missed run). */
export function runPublisher(offers, nowMs, audit = []) {
  for (const o of offers) {
    if (o.status === 'approved' || o.status === 'scheduled') {
      if (nowMs >= Date.parse(o.bookingCutoffUtc)) { o.status = 'expired'; audit.push({ offer: o.id, to: 'expired', at: nowMs, why: 'missed_run_stale' }); continue; }
      if (!o.approvedBy || !o.approvedAt) continue; // never publish unapproved rows
      if (isEditionVisible(o.serviceDate, nowMs)) { o.status = 'published'; audit.push({ offer: o.id, to: 'published', at: nowMs }); }
      else if (o.status === 'approved') { o.status = 'scheduled'; audit.push({ offer: o.id, to: 'scheduled', at: nowMs }); }
    } else if (o.status === 'published' && nowMs >= Date.parse(o.bookingCutoffUtc)) {
      o.status = 'expired'; audit.push({ offer: o.id, to: 'expired', at: nowMs });
    }
  }
  return audit;
}
/** Guest view: honest empty state when nothing is bookable. */
export function editionView(offers, nowMs) {
  const items = offers.filter((o) => offerBookable(o, nowMs).ok);
  return items.length ? { empty: false, items } : { empty: true, message: 'No approved offers are available right now. Check back after 6 pm Fiji time for tomorrow’s offers.' };
}
