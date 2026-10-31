/* Bula Happiness — staff-approved offers + 18:00 Pacific/Fiji editions on D1 (ISOLATED).
 * Prices, discounts, credit limits and capacity are entered/approved by named STAFF only. Nothing here calls a model;
 * an AI actor is rejected outright. The guest view only ever returns stored, approved values. */
import { fijiWallClockToUtcIso } from '../worker/fiji_time.js';
import { latestVisibleServiceDate, ymdString, fijiYmd } from './edition.js';
import { priceWithCredit, dollarsToCents } from './money.js';

export const CSV_COLUMNS = ['offer_id', 'title', 'operator_id', 'service_date', 'service_time', 'pickup_zones', 'pricing_basis', 'offer_price_fjd', 'max_credit_fjd', 'capacity_unit', 'capacity_quantity',
  'booking_cutoff', 'inclusions', 'exclusions', 'min_spend_fjd', 'cancellation_terms', 'credit_restore_hours_before', 'inventory_restore_hours_before', 'funding_party', 'operator_payout_fjd', 'instant_confirm', 'operator_contract_id'];
const staffOnly = (actor) => { if (!/^staff:[\w .@-]{2,}$/.test(actor || '')) throw new Error('STAFF_ACTOR_REQUIRED'); };

export function parseCsv(text) { // RFC4180: quotes, escaped quotes, commas/newlines inside quotes
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else f += c; }
  row.push(f); if (row.some((x) => x.trim() !== '')) rows.push(row); return rows;
}
const int = (v, name, { min = 0, optional = false } = {}) => { if (optional && String(v).trim() === '') return null; if (!/^\d+$/.test(String(v).trim()) || +v < min) throw new Error(`${name} must be a whole number >= ${min}`); return +v; };
/** One row -> normalised offer or throws with a precise message. Never invents a value; every field is required unless stated. */
export function rowToOffer(r, nowMs) {
  const need = (k) => { const v = (r[k] ?? '').trim(); if (!v) throw new Error(`${k} is required`); return v; };
  const id = need('offer_id'); if (/^EXAMPLE/i.test(id) || /^EXAMPLE/i.test(r.title || '')) throw new Error('example row - replace with a real offer or delete');
  const date = need('service_date'); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('service_date must be YYYY-MM-DD (Fiji date)');
  const time = need('service_time'); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('service_time must be HH:MM 24h (Fiji time)');
  const cutoff = need('booking_cutoff'); const cm = /^(\d{4}-\d{2}-\d{2})[ T]((?:[01]\d|2[0-3]):[0-5]\d)$/.exec(cutoff);
  if (!cm) throw new Error('booking_cutoff must be YYYY-MM-DD HH:MM (Fiji time)');
  const start = Date.parse(fijiWallClockToUtcIso(`${date}T${time}`)); const cut = Date.parse(fijiWallClockToUtcIso(`${cm[1]}T${cm[2]}`));
  if (!(cut <= start)) throw new Error('booking_cutoff must be at or before the service start');
  const basis = need('pricing_basis'); if (!['person', 'party', 'vehicle'].includes(basis)) throw new Error('pricing_basis must be person, party or vehicle');
  const price = dollarsToCents(need('offer_price_fjd')); if (price <= 0) throw new Error('offer_price_fjd must be > 0');
  const maxCredit = dollarsToCents(need('max_credit_fjd')); if (maxCredit > price) throw new Error('max_credit_fjd cannot exceed offer_price_fjd');
  const payout = dollarsToCents(need('operator_payout_fjd')); const funding = need('funding_party'); if (!['operator', 'vakaviti', 'shared'].includes(funding)) throw new Error('funding_party must be operator, vakaviti or shared');
  const ic = need('instant_confirm').toLowerCase(); if (!['yes', 'no'].includes(ic)) throw new Error('instant_confirm must be yes or no');
  const contract = (r.operator_contract_id || '').trim() || null; if (ic === 'yes' && !contract) throw new Error('instant_confirm=yes needs operator_contract_id (an authorised operator acceptance contract)');
  return { offer_id: id, title: need('title'), operator_id: need('operator_id'), service_date: date, service_start_utc: start, pickup_zones: need('pickup_zones').split(';').map((x) => x.trim()).filter(Boolean).join(','),
    pricing_basis: basis, price_cents: price, max_credit_cents: maxCredit, capacity_unit: need('capacity_unit'), capacity_total: int(need('capacity_quantity'), 'capacity_quantity', { min: 1 }),
    booking_cutoff_utc: cut, inclusions: need('inclusions'), exclusions: (r.exclusions || '').trim(), min_spend_cents: (r.min_spend_fjd || '').trim() ? dollarsToCents(r.min_spend_fjd) : 0,
    cancellation_terms: need('cancellation_terms'), credit_restore_hours_before: int(r.credit_restore_hours_before ?? '', 'credit_restore_hours_before', { optional: true }),
    inventory_restore_hours_before: int(r.inventory_restore_hours_before ?? '', 'inventory_restore_hours_before', { optional: true }), funding_party: funding, operator_payout_cents: payout,
    instant_confirm: ic === 'yes' ? 1 : 0, operator_contract_id: contract };
}
/** All-or-nothing CSV import into DRAFTS. Never approves, never publishes. */
export async function importCsv(db, text, actor, nowMs) {
  staffOnly(actor); const rows = parseCsv(text); if (!rows.length) return { created: 0, errors: [{ row: 0, error: 'empty file' }] };
  const head = rows[0].map((h) => h.trim()); const missing = CSV_COLUMNS.filter((c) => !head.includes(c)); if (missing.length) return { created: 0, errors: [{ row: 1, error: `missing columns: ${missing.join(', ')}` }] };
  const offers = [], errors = [], seen = new Set();
  rows.slice(1).forEach((cells, i) => { const r = Object.fromEntries(head.map((h, j) => [h, cells[j] ?? '']));
    try { const o = rowToOffer(r, nowMs); if (seen.has(o.offer_id)) throw new Error('duplicate offer_id in file'); seen.add(o.offer_id); offers.push(o); } catch (e) { errors.push({ row: i + 2, error: e.message }); } });
  if (errors.length) return { created: 0, errors };
  const dup = []; for (const o of offers) if (await db.prepare('SELECT 1 x FROM bula_offers WHERE offer_id = ?').bind(o.offer_id).first()) dup.push({ row: 0, error: `offer_id already exists: ${o.offer_id}` });
  if (dup.length) return { created: 0, errors: dup };
  await db.batch([...offers.flatMap((o) => { const k = Object.keys(o); return [
    db.prepare(`INSERT INTO bula_offers (${k.join(',')}, remaining, status, version, created_by, created_at, updated_at, test_data) VALUES (${k.map(() => '?').join(',')}, ?, 'draft', 1, ?, ?, ?, 0)`).bind(...k.map((x) => o[x]), o.capacity_total, actor, nowMs, nowMs),
    db.prepare('INSERT INTO bula_audit (at, actor, action, subject, detail) VALUES (?,?,?,?,?)').bind(nowMs, actor, 'offer_draft_imported', o.offer_id, null)]; })]);
  return { created: offers.length, errors: [] };
}
export async function approveOffer(db, offerId, actor, nowMs) {
  staffOnly(actor);
  const r = await db.prepare("UPDATE bula_offers SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE offer_id = ? AND status = 'draft' AND created_by != ?").bind(actor, nowMs, nowMs, offerId, actor).run();
  if (r.meta.changes !== 1) return { ok: false, code: 'not_draft_or_self_approval' };   // two-person rule: creator cannot approve their own row
  await db.prepare('INSERT INTO bula_audit (at, actor, action, subject) VALUES (?,?,?,?)').bind(nowMs, actor, 'offer_approved', offerId).run(); return { ok: true };
}
/** Any change after approval drops the offer back to draft, bumps version (in-flight checkouts then fail 'offer_changed'). */
export async function editOffer(db, offerId, patch, actor, nowMs) {
  staffOnly(actor); const allowed = ['price_cents', 'max_credit_cents', 'booking_cutoff_utc', 'inclusions', 'exclusions', 'cancellation_terms', 'operator_payout_cents'];
  const keys = Object.keys(patch); if (!keys.length || keys.some((k) => !allowed.includes(k))) return { ok: false, code: 'field_not_editable' };
  const r = await db.prepare(`UPDATE bula_offers SET ${keys.map((k) => `${k} = ?`).join(', ')}, version = version + 1, status = CASE WHEN status IN ('approved','scheduled','published') THEN 'draft' ELSE status END, approved_by = NULL, approved_at = NULL, updated_at = ? WHERE offer_id = ?`).bind(...keys.map((k) => patch[k]), nowMs, offerId).run();
  await db.prepare('INSERT INTO bula_audit (at, actor, action, subject, detail) VALUES (?,?,?,?,?)').bind(nowMs, actor, 'offer_edited', offerId, keys.join(',')).run(); return { ok: r.meta.changes === 1 };
}
export async function withdrawOffer(db, offerId, actor, nowMs) {
  staffOnly(actor); const r = await db.prepare("UPDATE bula_offers SET status = 'withdrawn', withdrawn_by = ?, withdrawn_at = ?, updated_at = ? WHERE offer_id = ? AND status NOT IN ('withdrawn','expired')").bind(actor, nowMs, nowMs, offerId).run();
  await db.prepare('INSERT INTO bula_audit (at, actor, action, subject) VALUES (?,?,?,?)').bind(nowMs, actor, 'offer_withdrawn', offerId).run(); return { ok: r.meta.changes === 1 };
}
/** Idempotent publisher with catch-up. Safe to run every minute or after an outage. Never publishes unapproved or past-cutoff rows. */
export async function runPublisher(db, cfg, nowMs, runId = `run-${nowMs}`) {
  if (!cfg.editionPublishEnabled && !cfg.syntheticTest) return { skipped: 'edition_publish_disabled' };
  const latest = latestVisibleServiceDate(nowMs);
  const res = await db.batch([
    db.prepare("UPDATE bula_offers SET status = 'expired', updated_at = ? WHERE status IN ('approved','scheduled','published') AND booking_cutoff_utc <= ?").bind(nowMs, nowMs),
    db.prepare("UPDATE bula_offers SET status = 'published', published_at = ?, updated_at = ? WHERE status IN ('approved','scheduled') AND approved_by IS NOT NULL AND booking_cutoff_utc > ? AND service_date <= ?").bind(nowMs, nowMs, nowMs, latest),
    db.prepare("UPDATE bula_offers SET status = 'scheduled', updated_at = ? WHERE status = 'approved' AND approved_by IS NOT NULL AND service_date > ?").bind(nowMs, latest),
    db.prepare("INSERT OR IGNORE INTO bula_editions (service_date, published_at, offer_count, run_id) SELECT ?, ?, COUNT(*), ? FROM bula_offers WHERE service_date = ? AND status = 'published' HAVING COUNT(*) > 0").bind(latest, nowMs, runId, latest),
  ]);
  return { serviceDate: latest, expired: res[0].meta.changes, published: res[1].meta.changes, scheduled: res[2].meta.changes };
}
/** Guest cards: only stored, approved values; remaining stock is the live count; credit shown against THIS guest's balance. */
export async function listEdition(db, cfg, nowMs, partyKey = null) {
  const latest = latestVisibleServiceDate(nowMs);
  const { results } = await db.prepare("SELECT * FROM bula_offers WHERE status = 'published' AND remaining > 0 AND booking_cutoff_utc > ? AND service_date <= ? ORDER BY service_date, service_start_utc").bind(nowMs, latest).all();
  const acct = partyKey && cfg.creditsEnabled ? await db.prepare('SELECT available_cents a, expires_at e FROM bula_credit_accounts WHERE party_key = ?').bind(partyKey).first() : null;
  const avail = acct && (acct.e == null || acct.e > nowMs) ? acct.a : 0;
  if (!results.length) return { empty: true, message: 'No offers are available right now. Tomorrow’s offers are released at 6 pm Fiji time.', cards: [] };
  return { empty: false, cards: results.map((o) => ({ offerId: o.offer_id, version: o.version, title: o.title, serviceDate: o.service_date, serviceStartUtc: o.service_start_utc, pricingBasis: o.pricing_basis,
    capacityUnit: o.capacity_unit, remaining: o.remaining, bookingCutoffUtc: o.booking_cutoff_utc, inclusions: o.inclusions, exclusions: o.exclusions, cancellationTerms: o.cancellation_terms,
    instantConfirm: !!o.instant_confirm, ...priceWithCredit({ offerPriceCents: o.price_cents, maxCreditCents: o.max_credit_cents, availableCents: avail, minSpendCents: o.min_spend_cents }) })) };
}
