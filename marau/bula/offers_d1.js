/* Bula Happiness — staff-approved offers + 18:00 Pacific/Fiji editions on D1.
 * Prices, discounts, credit limits and capacity are entered/approved by VERIFIED STAFF only (actors minted by the route layer
 * after authentication; strings/plain objects are rejected). No model is ever called. Every mutation and its audit row commit in ONE batch. */
import { fijiWallClockToUtcIso, getFijiOffsetMinutesAt } from '../worker/fiji_time.js';
import { latestVisibleServiceDate, ymdString, fijiYmd } from './edition.js';
import { priceWithCredit, dollarsToCents } from './money.js';
import { requireRole } from './authority.js';

export const CSV_COLUMNS = ['offer_id', 'title', 'operator_id', 'service_date', 'service_time', 'pickup_zones', 'pricing_basis', 'offer_price_fjd', 'max_credit_fjd', 'capacity_unit', 'capacity_quantity',
  'booking_cutoff', 'inclusions', 'exclusions', 'min_spend_fjd', 'cancellation_terms', 'credit_restore_hours_before', 'inventory_restore_hours_before', 'funding_party', 'operator_payout_fjd', 'instant_confirm', 'operator_contract_id'];
/** Pricing basis -> the only capacity unit it can consume. A "person" price consumes seats = people; a party/vehicle price consumes exactly one unit. */
export const BASIS_UNIT = Object.freeze({ person: 'seat', party: 'party', vehicle: 'vehicle' });
export const ROLE_POLICY = Object.freeze({
  import: ['ceo', 'ops', 'editor'], edit: ['ceo', 'ops', 'editor'], approve: ['ceo', 'approver'], withdraw: ['ceo', 'approver', 'ops'],
  confirm: ['ceo', 'ops'], cancel: ['ceo', 'ops'], refundCredit: ['ceo'], publish: ['ceo', 'ops'], contracts: ['ceo'], staffAdmin: [] /* admin credential only */,
});
const audit = (db, at, actor, action, subject, detail = null) => db.prepare('INSERT INTO bula_audit (at, actor, action, subject, detail) VALUES (?,?,?,?,?)').bind(at, `${actor.staffId}(${actor.role})`, action, subject, detail);
const ASSERT = (db) => [db.prepare('INSERT INTO bula_assert(ok) SELECT CASE WHEN changes() = 1 THEN 1 ELSE 0 END'), db.prepare('DELETE FROM bula_assert')];

export function parseCsv(text) { // RFC4180; throws on an unterminated quote
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') { if (f !== '') throw new Error('malformed CSV: quote inside an unquoted field'); q = true; }
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else f += c; }
  if (q) throw new Error('malformed CSV: unterminated quote');
  row.push(f); if (row.some((x) => x.trim() !== '')) rows.push(row); return rows;
}
const isRealDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return false; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; };
const isRealTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const safeInt = (v) => Number.isSafeInteger(v);

/** ONE validator for every path (CSV import, edit, approve). Returns a list of problems; empty = valid. */
export function validateOfferRow(o) {
  const e = [];
  for (const k of ['offer_id', 'title', 'operator_id', 'pickup_zones', 'capacity_unit', 'inclusions', 'cancellation_terms']) if (typeof o[k] !== 'string' || !o[k].trim()) e.push(`${k} is required`);
  if (!['person', 'party', 'vehicle'].includes(o.pricing_basis)) e.push('pricing_basis must be person, party or vehicle');
  else if (o.capacity_unit !== BASIS_UNIT[o.pricing_basis]) e.push(`capacity_unit must be "${BASIS_UNIT[o.pricing_basis]}" when pricing_basis is ${o.pricing_basis}`);
  for (const k of ['price_cents', 'max_credit_cents', 'operator_payout_cents', 'min_spend_cents', 'capacity_total', 'remaining', 'service_start_utc', 'booking_cutoff_utc']) if (!safeInt(o[k])) e.push(`${k} must be a safe integer`);
  if (safeInt(o.price_cents) && o.price_cents <= 0) e.push('offer price must be > 0');
  if (safeInt(o.max_credit_cents) && safeInt(o.price_cents) && (o.max_credit_cents < 0 || o.max_credit_cents > o.price_cents)) e.push('max credit must be between 0 and the offer price');
  if (safeInt(o.operator_payout_cents) && safeInt(o.price_cents) && (o.operator_payout_cents < 0 || o.operator_payout_cents > o.price_cents)) e.push('operator payout must be between 0 and the offer price');
  if (safeInt(o.min_spend_cents) && o.min_spend_cents < 0) e.push('min spend cannot be negative');
  if (safeInt(o.capacity_total) && o.capacity_total < 1) e.push('capacity must be >= 1');
  if (safeInt(o.remaining) && safeInt(o.capacity_total) && (o.remaining < 0 || o.remaining > o.capacity_total)) e.push('remaining must be between 0 and capacity');
  if (safeInt(o.booking_cutoff_utc) && safeInt(o.service_start_utc) && o.booking_cutoff_utc > o.service_start_utc) e.push('booking cutoff must be at or before the service start');
  if (!isRealDate(o.service_date)) e.push('service_date must be a real date YYYY-MM-DD');
  if (!['operator', 'vakaviti', 'shared'].includes(o.funding_party)) e.push('funding_party must be operator, vakaviti or shared');
  for (const k of ['credit_restore_hours_before', 'inventory_restore_hours_before']) if (o[k] != null && !(safeInt(o[k]) && o[k] >= 0)) e.push(`${k} must be a whole number >= 0 or blank`);
  if (o.instant_confirm === 1 && !o.operator_contract_id) e.push('instant_confirm needs operator_contract_id');
  if (![0, 1].includes(o.instant_confirm)) e.push('instant_confirm must be yes or no');
  if (safeInt(o.service_start_utc) && isRealDate(o.service_date)) { // stored Fiji date must agree with the stored start instant
    const f = fijiYmd(o.service_start_utc); if (ymdString(f) !== o.service_date) e.push('service_date does not match service start');
  }
  return e;
}
/** CSV row (text, FJ$ dollars) -> offer object. Throws with a precise message. Never invents a value. */
export function rowToOffer(r) {
  const need = (k) => { const v = (r[k] ?? '').trim(); if (!v) throw new Error(`${k} is required`); return v; };
  const id = need('offer_id'); if (/^EXAMPLE/i.test(id) || /^EXAMPLE/i.test(r.title || '')) throw new Error('example row - replace with a real offer or delete');
  const date = need('service_date'); if (!isRealDate(date)) throw new Error('service_date must be a real date YYYY-MM-DD (Fiji date)');
  const time = need('service_time'); if (!isRealTime(time)) throw new Error('service_time must be HH:MM 24h (Fiji time)');
  const cutoff = need('booking_cutoff'); const cm = /^(\d{4}-\d{2}-\d{2})[ T]((?:[01]\d|2[0-3]):[0-5]\d)$/.exec(cutoff);
  if (!cm || !isRealDate(cm[1])) throw new Error('booking_cutoff must be a real date and time YYYY-MM-DD HH:MM (Fiji time)');
  const start = Date.parse(fijiWallClockToUtcIso(`${date}T${time}`)); const cut = Date.parse(fijiWallClockToUtcIso(`${cm[1]}T${cm[2]}`));
  const wholeOrBlank = (k) => { const v = (r[k] ?? '').trim(); if (v === '') return null; if (!/^\d{1,5}$/.test(v)) throw new Error(`${k} must be a whole number or blank`); return +v; };
  const cap = (r.capacity_quantity ?? '').trim(); if (!/^\d{1,6}$/.test(cap) || +cap < 1) throw new Error('capacity_quantity must be a whole number >= 1');
  const ic = need('instant_confirm').toLowerCase(); if (!['yes', 'no'].includes(ic)) throw new Error('instant_confirm must be yes or no');
  const o = { offer_id: id, title: need('title'), operator_id: need('operator_id'), service_date: date, service_start_utc: start, pickup_zones: need('pickup_zones').split(';').map((x) => x.trim()).filter(Boolean).join(','),
    pricing_basis: need('pricing_basis'), price_cents: dollarsToCents(need('offer_price_fjd')), max_credit_cents: dollarsToCents(need('max_credit_fjd')), capacity_unit: need('capacity_unit'), capacity_total: +cap, remaining: +cap,
    booking_cutoff_utc: cut, inclusions: need('inclusions'), exclusions: (r.exclusions || '').trim(), min_spend_cents: (r.min_spend_fjd || '').trim() ? dollarsToCents(r.min_spend_fjd) : 0,
    cancellation_terms: need('cancellation_terms'), credit_restore_hours_before: wholeOrBlank('credit_restore_hours_before'), inventory_restore_hours_before: wholeOrBlank('inventory_restore_hours_before'),
    funding_party: need('funding_party'), operator_payout_cents: dollarsToCents(need('operator_payout_fjd')), instant_confirm: ic === 'yes' ? 1 : 0, operator_contract_id: (r.operator_contract_id || '').trim() || null };
  const problems = validateOfferRow(o); if (problems.length) throw new Error(problems.join('; ')); return o;
}
/** All-or-nothing CSV import into DRAFTS (offers + audit rows in ONE batch). Never approves, never publishes. */
export async function importCsv(db, text, actor, nowMs) {
  requireRole(actor, ROLE_POLICY.import);
  let rows; try { rows = parseCsv(text); } catch (e) { return { created: 0, errors: [{ row: 0, error: e.message }] }; }
  if (!rows.length) return { created: 0, errors: [{ row: 0, error: 'empty file' }] };
  const head = rows[0].map((h) => h.trim());
  if (new Set(head).size !== head.length) return { created: 0, errors: [{ row: 1, error: `duplicate column headers: ${head.filter((h, i) => head.indexOf(h) !== i).join(', ')}` }] };
  const missing = CSV_COLUMNS.filter((c) => !head.includes(c)); if (missing.length) return { created: 0, errors: [{ row: 1, error: `missing columns: ${missing.join(', ')}` }] };
  const unknown = head.filter((c) => !CSV_COLUMNS.includes(c)); if (unknown.length) return { created: 0, errors: [{ row: 1, error: `unknown columns: ${unknown.join(', ')}` }] };
  const offers = [], errors = [], seen = new Set();
  rows.slice(1).forEach((cells, i) => {
    if (cells.length !== head.length) { errors.push({ row: i + 2, error: `expected ${head.length} cells, found ${cells.length}` }); return; }
    const r = Object.fromEntries(head.map((h, j) => [h, cells[j]]));
    try { const o = rowToOffer(r); if (seen.has(o.offer_id)) throw new Error('duplicate offer_id in file'); seen.add(o.offer_id); offers.push(o); } catch (e) { errors.push({ row: i + 2, error: e.message }); } });
  if (errors.length) return { created: 0, errors };
  for (const o of offers) if (await db.prepare('SELECT 1 x FROM bula_offers WHERE offer_id = ?').bind(o.offer_id).first()) errors.push({ row: 0, error: `offer_id already exists: ${o.offer_id}` });
  if (errors.length) return { created: 0, errors };
  await db.batch(offers.flatMap((o) => { const k = Object.keys(o); return [
    db.prepare(`INSERT INTO bula_offers (${k.join(',')}, status, version, created_by, created_at, updated_at, test_data) VALUES (${k.map(() => '?').join(',')}, 'draft', 1, ?, ?, ?, 0)`).bind(...k.map((x) => o[x]), actor.staffId, nowMs, nowMs),
    audit(db, nowMs, actor, 'offer_draft_imported', o.offer_id)]; }));
  return { created: offers.length, errors: [] };
}
/** Approval policy (explicit): roles ceo|approver. A non-CEO cannot approve their own row; the CEO may, on a named, audited path. */
export async function approveOffer(db, offerId, actor, nowMs) {
  requireRole(actor, ROLE_POLICY.approve);
  const o = await db.prepare('SELECT * FROM bula_offers WHERE offer_id = ?').bind(offerId).first();
  if (!o || o.status !== 'draft') return { ok: false, code: 'not_draft' };
  const self = o.created_by === actor.staffId; if (self && actor.role !== 'ceo') return { ok: false, code: 'self_approval_requires_ceo' };
  const problems = validateOfferRow(o); if (problems.length) return { ok: false, code: 'invalid', errors: problems };
  if (nowMs >= o.booking_cutoff_utc) return { ok: false, code: 'past_cutoff' };
  if (o.instant_confirm === 1 && !(await resolveContract(db, o, nowMs))) return { ok: false, code: 'contract_unresolved' };   // instant confirmation needs an approved, in-scope operator contract
  try {
    await db.batch([db.prepare("UPDATE bula_offers SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE offer_id = ? AND status = 'draft' AND version = ?").bind(actor.staffId, nowMs, nowMs, offerId, o.version), ...ASSERT(db),
      audit(db, nowMs, actor, self ? 'offer_approved_ceo_self_approval' : 'offer_approved', offerId, `version=${o.version}`)]);
  } catch (e) { if (/bula_assert|CHECK/.test(String(e.message))) return { ok: false, code: 'changed_concurrently' }; throw e; }
  return { ok: true, path: self ? 'ceo_self_approval' : 'second_person' };
}
const EDITABLE = { price_cents: 'int', max_credit_cents: 'int', operator_payout_cents: 'int', min_spend_cents: 'int', booking_cutoff_utc: 'int', inclusions: 'str', exclusions: 'str', cancellation_terms: 'str', credit_restore_hours_before: 'int?', inventory_restore_hours_before: 'int?' };
/** Edit = validate the COMPLETE resulting offer, bump version, drop approval/publication, audit in the same batch. Existing hold snapshots are untouched. */
export async function editOffer(db, offerId, patch, actor, nowMs) {
  requireRole(actor, ROLE_POLICY.edit);
  const keys = Object.keys(patch || {}); if (!keys.length || keys.some((k) => !(k in EDITABLE))) return { ok: false, code: 'field_not_editable' };
  const o = await db.prepare('SELECT * FROM bula_offers WHERE offer_id = ?').bind(offerId).first(); if (!o) return { ok: false, code: 'unknown_offer' };
  if (['withdrawn', 'expired'].includes(o.status)) return { ok: false, code: `offer_${o.status}` };
  for (const k of keys) { const t = EDITABLE[k], v = patch[k]; if (t === 'int' && !safeInt(v)) return { ok: false, code: 'invalid', errors: [`${k} must be a safe integer`] }; if (t === 'str' && typeof v !== 'string') return { ok: false, code: 'invalid', errors: [`${k} must be text`] }; if (t === 'int?' && v != null && !safeInt(v)) return { ok: false, code: 'invalid', errors: [`${k} must be a whole number or null`] }; }
  const merged = { ...o, ...patch }; const problems = validateOfferRow(merged); if (problems.length) return { ok: false, code: 'invalid', errors: problems };
  try {
    await db.batch([db.prepare(`UPDATE bula_offers SET ${keys.map((k) => `${k} = ?`).join(', ')}, version = version + 1, status = CASE WHEN status IN ('approved','scheduled','published') THEN 'draft' ELSE status END, approved_by = NULL, approved_at = NULL, updated_at = ? WHERE offer_id = ? AND version = ?`).bind(...keys.map((k) => patch[k]), nowMs, offerId, o.version), ...ASSERT(db),
      audit(db, nowMs, actor, 'offer_edited', offerId, `${keys.join(',')};from_version=${o.version}`)]);
  } catch (e) { if (/bula_assert|CHECK/.test(String(e.message))) return { ok: false, code: 'changed_concurrently' }; throw e; }
  return { ok: true, version: o.version + 1 };
}
export async function withdrawOffer(db, offerId, actor, nowMs) {
  requireRole(actor, ROLE_POLICY.withdraw);
  try { await db.batch([db.prepare("UPDATE bula_offers SET status = 'withdrawn', withdrawn_by = ?, withdrawn_at = ?, version = version + 1, updated_at = ? WHERE offer_id = ? AND status NOT IN ('withdrawn','expired')").bind(actor.staffId, nowMs, nowMs, offerId), ...ASSERT(db), audit(db, nowMs, actor, 'offer_withdrawn', offerId)]); }
  catch (e) { if (/bula_assert|CHECK/.test(String(e.message))) return { ok: false, code: 'not_withdrawable' }; throw e; }
  return { ok: true };
}
/** Idempotent publisher with catch-up. Safe every minute or after an outage. Never publishes unapproved or past-cutoff rows. */
export async function runPublisher(db, cfg, nowMs, runId = `run-${nowMs}`) {
  if (!cfg.editionPublishEnabled) return { skipped: 'edition_publish_disabled' };
  const latest = latestVisibleServiceDate(nowMs);
  const res = await db.batch([
    db.prepare("UPDATE bula_offers SET status = 'expired', updated_at = ? WHERE status IN ('approved','scheduled','published') AND booking_cutoff_utc <= ?").bind(nowMs, nowMs),
    db.prepare("UPDATE bula_offers SET status = 'published', published_at = ?, updated_at = ? WHERE status IN ('approved','scheduled') AND approved_by IS NOT NULL AND booking_cutoff_utc > ? AND service_date <= ?").bind(nowMs, nowMs, nowMs, latest),
    db.prepare("UPDATE bula_offers SET status = 'scheduled', updated_at = ? WHERE status = 'approved' AND approved_by IS NOT NULL AND service_date > ?").bind(nowMs, latest),
    db.prepare("INSERT OR IGNORE INTO bula_editions (service_date, published_at, offer_count, run_id) SELECT ?, ?, COUNT(*), ? FROM bula_offers WHERE service_date = ? AND status = 'published' HAVING COUNT(*) > 0").bind(latest, nowMs, runId, latest),
  ]);
  return { serviceDate: latest, expired: res[0].meta.changes, published: res[1].meta.changes, scheduled: res[2].meta.changes };
}
/** Guest cards, separated into "today" (still bookable, released yesterday evening) and "tomorrow" (released at 18:00). */
export async function listEdition(db, cfg, nowMs, partyKey = null) {
  const latest = latestVisibleServiceDate(nowMs); const today = ymdString(fijiYmd(nowMs));
  const { results } = await db.prepare("SELECT * FROM bula_offers WHERE status = 'published' AND remaining > 0 AND booking_cutoff_utc > ? AND service_date <= ? ORDER BY service_date, service_start_utc").bind(nowMs, latest).all();
  const acct = partyKey && cfg.creditsEnabled ? await db.prepare('SELECT available_cents a, expires_at e FROM bula_credit_accounts WHERE party_key = ?').bind(partyKey).first() : null;
  const avail = acct && (acct.e == null || acct.e > nowMs) ? acct.a : 0;
  const cards = results.map((o) => ({ offerId: o.offer_id, version: o.version, title: o.title, serviceDate: o.service_date, group: o.service_date === today ? 'today' : 'tomorrow', serviceStartUtc: o.service_start_utc, pricingBasis: o.pricing_basis,
    capacityUnit: o.capacity_unit, remaining: o.remaining, bookingCutoffUtc: o.booking_cutoff_utc, pickupZones: o.pickup_zones, inclusions: o.inclusions, exclusions: o.exclusions, cancellationTerms: o.cancellation_terms,
    instantConfirm: !!o.instant_confirm, minSpendCents: o.min_spend_cents, unitPriceCents: o.price_cents, maxCreditCents: o.max_credit_cents, ...priceWithCredit({ offerPriceCents: o.price_cents, maxCreditCents: o.max_credit_cents, availableCents: avail, minSpendCents: o.min_spend_cents }) }));
  return { empty: !cards.length, today, latest, message: cards.length ? null : 'No offers are available right now. Tomorrow’s offers are released at 6 pm Fiji time.', cards,
    nextReleaseUtc: Date.parse(fijiWallClockToUtcIso(`${ymdString(fijiYmd(nowMs + (fijiYmd(nowMs).h >= 18 ? 24 * 3600e3 : 0)))}T18:00`)) };
}

/** A contract id string is only meaningful if it resolves to an ACTIVE, in-date contract of the SAME operator whose scope covers this offer. */
export async function resolveContract(db, offer, nowMs) {
  if (!offer.operator_contract_id) return null;
  return await db.prepare(`SELECT contract_id FROM bula_operator_contracts WHERE contract_id = ? AND status = 'active' AND operator_id = ? AND valid_from <= ? AND valid_to >= ?
    AND (scope_offer_ids IS NULL OR instr(',' || scope_offer_ids || ',', ',' || ? || ',') > 0)`).bind(offer.operator_contract_id, offer.operator_id, nowMs, nowMs, offer.offer_id).first();
}
