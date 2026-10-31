/* Bula Happiness — persisted inventory + promotional-credit reservation on D1 (ISOLATED; not wired to any route).
 * Every multi-row transition is ONE db.batch() (a transaction). Impossible results abort the whole batch via CHECK
 * constraints; a guarded UPDATE that touched 0 rows aborts it via bula_assert. All state guards live in SQL, so two
 * separate connections/requests cannot both win the last place or overspend one balance, and replays are harmless. */
import { priceWithCredit } from './money.js';
import { isConfirmation, isCancellation } from './authority.js';
import { latestVisibleServiceDate } from './edition.js';

export class BulaError extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail; } }
const isRollback = (e) => /bula_assert|CHECK constraint|UNIQUE constraint|FOREIGN KEY/i.test(String(e && e.message));
const A = (db) => [db.prepare('INSERT INTO bula_assert(ok) SELECT CASE WHEN changes() = 1 THEN 1 ELSE 0 END'), db.prepare('DELETE FROM bula_assert')];
const newId = (p) => `${p}_${crypto.randomUUID()}`;
const requireOn = (cfg, flag) => { if (!cfg[flag] && !cfg.syntheticTest) throw new BulaError('DISABLED', flag); };

/* ---- welcome grant: one per explicit party key; replay returns the original --------------------------------- */
export async function grantWelcome(db, cfg, { partyKey, actor, source, nowMs, cents = cfg.welcomeCents }) {
  if (!cfg.creditsEnabled) throw new BulaError('CREDITS_DISABLED');
  if (!partyKey || !actor || !source) throw new BulaError('BAD_REQUEST');
  if (!Number.isInteger(cents) || cents <= 0) throw new BulaError('BAD_AMOUNT');
  const ex = await db.prepare('SELECT granted_cents FROM bula_credit_accounts WHERE party_key = ?').bind(partyKey).first();
  if (ex) return { granted: false, replay: true, grantedCents: ex.granted_cents };
  const expiresAt = cfg.creditTtlMs ? nowMs + cfg.creditTtlMs : null;
  try {
    await db.batch([
      db.prepare('INSERT INTO bula_credit_accounts (party_key, granted_cents, available_cents, reserved_cents, redeemed_cents, expired_cents, expires_at, policy_version, created_at, updated_at) VALUES (?,?,?,0,0,0,?,?,?,?)').bind(partyKey, cents, cents, expiresAt, cfg.policyVersion, nowMs, nowMs),
      db.prepare("INSERT INTO bula_credit_ledger (party_key,type,amount_cents,actor,source,policy_version,at) VALUES (?, 'granted', ?, ?, ?, ?, ?)").bind(partyKey, cents, actor, source, cfg.policyVersion, nowMs),
    ]);
    return { granted: true, replay: false, grantedCents: cents };
  } catch (e) { if (isRollback(e)) return { granted: false, replay: true, grantedCents: cents }; throw e; }
}
export async function balance(db, partyKey) {
  const r = await db.prepare('SELECT granted_cents granted, available_cents available, reserved_cents reserved, redeemed_cents redeemed, expired_cents expired, expires_at expiresAt FROM bula_credit_accounts WHERE party_key = ?').bind(partyKey).first();
  return r || { granted: 0, available: 0, reserved: 0, redeemed: 0, expired: 0, expiresAt: null };
}

/* ---- reserve ------------------------------------------------------------------------------------------------ */
const canon = (o) => JSON.stringify([o.offerId, o.qty, o.expectedVersion, o.expectedNetCents ?? null]);
function replayView(h, nowMs) {
  const snap = JSON.parse(h.snapshot_json);
  if (h.state === 'held' && nowMs >= h.expires_at) return { ok: false, code: 'hold_expired', holdId: h.hold_id, replay: true };
  if (h.state === 'held' || h.state === 'confirmed') return { ok: true, replay: true, state: h.state, holdId: h.hold_id, creditCents: h.credit_cents, netPayableCents: h.net_cents, snapshot: snap };
  return { ok: false, code: `hold_${h.state}`, holdId: h.hold_id, replay: true };
}
export async function reserve(db, cfg, { partyKey, idemKey, offerId, qty = 1, expectedVersion, expectedNetCents, nowMs, ttlMs = cfg.holdTtlMs }) {
  requireOn(cfg, 'checkoutEnabled');
  if (!partyKey || !idemKey) throw new BulaError('BAD_REQUEST');
  const hash = canon({ offerId, qty, expectedVersion, expectedNetCents });
  for (let attempt = 0; attempt < 4; attempt++) {
    const ex = await db.prepare('SELECT * FROM bula_holds WHERE party_key = ? AND idem_key = ?').bind(partyKey, idemKey).first();
    if (ex) {
      if (ex.request_hash !== hash) return { ok: false, code: 'idempotency_payload_mismatch' };
      if (ex.state === 'held' && nowMs >= ex.expires_at) await settle(db, ex.hold_id, 'expired', nowMs);
      return replayView(await db.prepare('SELECT * FROM bula_holds WHERE hold_id = ?').bind(ex.hold_id).first(), nowMs);
    }
    const o = await db.prepare('SELECT * FROM bula_offers WHERE offer_id = ?').bind(offerId).first();
    if (!o) return { ok: false, code: 'unknown_offer' };
    if (o.status !== 'published') return { ok: false, code: 'not_published' };
    if (nowMs >= o.booking_cutoff_utc) return { ok: false, code: 'past_cutoff' };
    if (o.service_date > latestVisibleServiceDate(nowMs)) return { ok: false, code: 'not_yet_released' };
    if (o.version !== expectedVersion) return { ok: false, code: 'offer_changed' };
    if (!Number.isInteger(qty) || qty < 1) return { ok: false, code: 'bad_quantity' };
    if (o.remaining < qty) return { ok: false, code: o.remaining === 0 ? 'sold_out' : 'insufficient_inventory' };
    const acct = cfg.creditsEnabled ? await db.prepare('SELECT available_cents a, expires_at e FROM bula_credit_accounts WHERE party_key = ?').bind(partyKey).first() : null;
    const avail = acct && (acct.e == null || acct.e > nowMs) ? acct.a : 0;
    const p = priceWithCredit({ offerPriceCents: o.price_cents * qty, maxCreditCents: o.max_credit_cents * qty, availableCents: avail, minSpendCents: o.min_spend_cents });
    if (expectedNetCents !== undefined && expectedNetCents !== p.netPayableCents) return { ok: false, code: 'price_changed', ...p };
    const holdId = newId('H');
    const snapshot = { offerId, offerVersion: o.version, title: o.title, operatorId: o.operator_id, serviceDate: o.service_date, serviceStartUtc: o.service_start_utc,
      pricingBasis: o.pricing_basis, capacityUnit: o.capacity_unit, qty, unitPriceCents: o.price_cents, maxCreditPerUnitCents: o.max_credit_cents, ...p,
      fundingParty: o.funding_party, operatorPayoutCents: o.operator_payout_cents, cancellationTerms: o.cancellation_terms,
      creditRestoreHoursBefore: o.credit_restore_hours_before, inventoryRestoreHoursBefore: o.inventory_restore_hours_before,
      instantConfirm: !!o.instant_confirm, operatorContractId: o.operator_contract_id, policyVersion: cfg.policyVersion, inclusions: o.inclusions, exclusions: o.exclusions };
    const st = [
      db.prepare("UPDATE bula_offers SET remaining = remaining - ?, updated_at = ? WHERE offer_id = ? AND version = ? AND status = 'published' AND remaining >= ? AND booking_cutoff_utc > ?").bind(qty, nowMs, offerId, expectedVersion, qty, nowMs), ...A(db),
    ];
    if (p.creditCents > 0) st.push(
      db.prepare('UPDATE bula_credit_accounts SET available_cents = available_cents - ?, reserved_cents = reserved_cents + ?, updated_at = ? WHERE party_key = ? AND available_cents >= ? AND (expires_at IS NULL OR expires_at > ?)').bind(p.creditCents, p.creditCents, nowMs, partyKey, p.creditCents, nowMs), ...A(db));
    st.push(db.prepare("INSERT INTO bula_holds (hold_id,party_key,idem_key,request_hash,offer_id,qty,state,credit_cents,price_cents,net_cents,expires_at,snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?,?, 'held', ?,?,?,?,?,?,?)")
      .bind(holdId, partyKey, idemKey, hash, offerId, qty, p.creditCents, p.offerPriceCents, p.netPayableCents, nowMs + ttlMs, JSON.stringify(snapshot), nowMs, nowMs));
    if (p.creditCents > 0) st.push(db.prepare("INSERT INTO bula_credit_ledger (party_key,type,amount_cents,hold_id,actor,source,policy_version,at) VALUES (?, 'reserved', ?, ?, ?, 'checkout', ?, ?)").bind(partyKey, p.creditCents, holdId, `guest:${partyKey}`, cfg.policyVersion, nowMs));
    try { await db.batch(st); return { ok: true, replay: false, state: 'held', holdId, creditCents: p.creditCents, netPayableCents: p.netPayableCents, snapshot }; }
    catch (e) { if (!isRollback(e)) throw e; /* lost a race: loop re-reads the truth (replay / sold_out / new balance) */ }
  }
  return { ok: false, code: 'contention_retry' };
}

/* ---- settle (failed checkout / timeout): give inventory + credit back exactly once ---------------------------- */
export async function settle(db, holdId, newState, nowMs) {
  const g = "hold_id = ? AND state = ? AND settled = 0";
  const sub = (col) => `(SELECT ${col} FROM bula_holds WHERE ${g})`;
  const ledgerType = newState === 'expired' ? 'expired_hold' : 'released';
  await db.batch([
    db.prepare(`UPDATE bula_holds SET state = ?, updated_at = ? WHERE hold_id = ? AND state = 'held' AND (? = 'released' OR expires_at <= ?)`).bind(newState, nowMs, holdId, newState, nowMs),
    db.prepare(`UPDATE bula_offers SET remaining = remaining + ${sub('qty')}, updated_at = ? WHERE offer_id = ${sub('offer_id')}`).bind(holdId, newState, nowMs, holdId, newState),
    db.prepare(`UPDATE bula_credit_accounts SET available_cents = available_cents + ${sub('credit_cents')}, reserved_cents = reserved_cents - ${sub('credit_cents')}, updated_at = ? WHERE party_key = (SELECT party_key FROM bula_holds WHERE ${g} AND credit_cents > 0)`).bind(holdId, newState, holdId, newState, nowMs, holdId, newState),
    db.prepare(`INSERT OR IGNORE INTO bula_credit_ledger (party_key,type,amount_cents,hold_id,actor,source,policy_version,at) SELECT party_key, ?, credit_cents, hold_id, 'system', 'hold_settle', ?, ? FROM bula_holds WHERE ${g} AND credit_cents > 0`).bind(ledgerType, 'settle', nowMs, holdId, newState),
    db.prepare(`UPDATE bula_holds SET settled = 1 WHERE ${g}`).bind(holdId, newState),
  ]);
}
export async function releaseFailedCheckout(db, { holdId, partyKey, nowMs }) {
  const h = await db.prepare('SELECT * FROM bula_holds WHERE hold_id = ?').bind(holdId).first();
  if (!h || h.party_key !== partyKey) return { ok: false, code: 'unknown_hold' };   // no cross-party probing
  if (h.state === 'held') await settle(db, holdId, 'released', nowMs);
  const n = await db.prepare('SELECT state FROM bula_holds WHERE hold_id = ?').bind(holdId).first();
  return { ok: n.state === 'released' || n.state === 'expired', state: n.state };
}
/** Restart/recovery sweep: any hold whose TTL passed (or whose settle was interrupted) is settled. Idempotent. */
export async function sweepExpired(db, nowMs) {
  const { results } = await db.prepare("SELECT hold_id, state FROM bula_holds WHERE (state = 'held' AND expires_at <= ?) OR (state IN ('expired','released') AND settled = 0)").bind(nowMs).all();
  for (const r of results) await settle(db, r.hold_id, r.state === 'held' ? 'expired' : r.state, nowMs);
  return results.length;
}
export async function expireGrants(db, nowMs) {
  const { results } = await db.prepare('SELECT party_key FROM bula_credit_accounts WHERE expires_at IS NOT NULL AND expires_at <= ? AND available_cents > 0').bind(nowMs).all();
  for (const r of results) await db.batch([
    db.prepare("INSERT INTO bula_credit_ledger (party_key,type,amount_cents,actor,source,policy_version,at) SELECT party_key, 'grant_expired', available_cents, 'system', 'expiry_sweep', policy_version, ? FROM bula_credit_accounts WHERE party_key = ? AND expires_at <= ? AND available_cents > 0").bind(nowMs, r.party_key, nowMs),
    db.prepare('UPDATE bula_credit_accounts SET expired_cents = expired_cents + available_cents, available_cents = 0, updated_at = ? WHERE party_key = ? AND expires_at <= ? AND available_cents > 0').bind(nowMs, r.party_key, nowMs),
  ]);
  return results.length;
}

/* ---- confirm: server-minted authority + ownership; instant only under an operator acceptance contract --------- */
export async function confirmHold(db, { holdId, partyKey, authority, bookingRef, nowMs }) {
  if (!isConfirmation(authority)) return { ok: false, code: 'no_server_authority' };
  const h = await db.prepare('SELECT * FROM bula_holds WHERE hold_id = ?').bind(holdId).first();
  if (!h || h.party_key !== partyKey) return { ok: false, code: 'unknown_hold' };
  const snap = JSON.parse(h.snapshot_json);
  if (authority.kind === 'operator_acceptance_contract' && !(snap.instantConfirm && snap.operatorContractId === authority.ref)) return { ok: false, code: 'contract_does_not_cover_offer' };
  if (h.state === 'confirmed') return { ok: true, replay: true, state: 'confirmed' };
  if (h.state === 'held' && nowMs >= h.expires_at) { await settle(db, holdId, 'expired', nowMs); return { ok: false, code: 'hold_expired' }; }
  if (h.state !== 'held') return { ok: false, code: `hold_${h.state}` };
  const ok = "hold_id = ? AND state = 'held' AND expires_at > ?";
  try {
    await db.batch([
      db.prepare(`UPDATE bula_credit_accounts SET reserved_cents = reserved_cents - ?, redeemed_cents = redeemed_cents + ?, updated_at = ? WHERE party_key = ? AND ? > 0 AND EXISTS (SELECT 1 FROM bula_holds WHERE ${ok})`).bind(h.credit_cents, h.credit_cents, nowMs, partyKey, h.credit_cents, holdId, nowMs),
      db.prepare(`INSERT OR IGNORE INTO bula_credit_ledger (party_key,type,amount_cents,hold_id,booking_ref,actor,source,policy_version,at) SELECT party_key, 'redeemed', credit_cents, hold_id, ?, ?, ?, ?, ? FROM bula_holds WHERE ${ok} AND credit_cents > 0`).bind(bookingRef ?? null, authority.verifiedBy, authority.kind, snap.policyVersion, nowMs, holdId, nowMs),
      db.prepare(`UPDATE bula_holds SET state = 'confirmed', booking_ref = ?, confirmed_at = ?, confirmed_by_kind = ?, confirmed_by_ref = ?, updated_at = ? WHERE ${ok}`).bind(bookingRef ?? null, nowMs, authority.kind, authority.ref, nowMs, holdId, nowMs),
      ...A(db),
    ]);
  } catch (e) { if (!isRollback(e)) throw e; }
  const n = await db.prepare('SELECT state FROM bula_holds WHERE hold_id = ?').bind(holdId).first();
  return n.state === 'confirmed' ? { ok: true, replay: false, state: 'confirmed', snapshot: snap } : { ok: false, code: `hold_${n.state}` };
}

/* ---- cancel: policy + authority; never revives expired credit, never resells a past/withdrawn service ---------- */
export async function cancelHold(db, { holdId, partyKey, authority, nowMs }) {
  if (!isCancellation(authority)) return { ok: false, code: 'no_server_authority' };
  const h = await db.prepare('SELECT * FROM bula_holds WHERE hold_id = ?').bind(holdId).first();
  if (!h) return { ok: false, code: 'unknown_hold' };
  if (authority.kind === 'guest_cancel' && h.party_key !== partyKey) return { ok: false, code: 'unknown_hold' };
  if (h.state === 'cancelled') return { ok: true, replay: true, state: 'cancelled', creditRestored: !!h.credit_restored, inventoryRestored: !!h.inventory_restored };
  if (h.state !== 'confirmed') return { ok: false, code: `hold_${h.state}` };
  const snap = JSON.parse(h.snapshot_json); const hoursBefore = (snap.serviceStartUtc - nowMs) / 3600000;
  const within = (n) => n != null && hoursBefore >= n;
  let restoreCredit = h.credit_cents > 0 && (authority.kind === 'operator_cancel' || (authority.refundCredit && authority.kind === 'staff_cancel') || within(snap.creditRestoreHoursBefore));
  let restoreInventory = authority.kind !== 'operator_cancel' && hoursBefore > 0 && within(snap.inventoryRestoreHoursBefore ?? snap.creditRestoreHoursBefore);
  const g = "hold_id = ? AND state = 'confirmed'"; const sub = (c) => `(SELECT ${c} FROM bula_holds WHERE ${g})`;
  const st = [];
  if (restoreCredit) st.push(
    db.prepare(`UPDATE bula_credit_accounts SET redeemed_cents = redeemed_cents - ${sub('credit_cents')}, available_cents = available_cents + ${sub('credit_cents')}, updated_at = ? WHERE party_key = ? AND (expires_at IS NULL OR expires_at > ?) AND EXISTS (SELECT 1 FROM bula_holds WHERE ${g})`).bind(holdId, holdId, nowMs, h.party_key, nowMs, holdId),
    db.prepare(`UPDATE bula_credit_accounts SET redeemed_cents = redeemed_cents - ${sub('credit_cents')}, expired_cents = expired_cents + ${sub('credit_cents')}, updated_at = ? WHERE party_key = ? AND expires_at IS NOT NULL AND expires_at <= ? AND EXISTS (SELECT 1 FROM bula_holds WHERE ${g})`).bind(holdId, holdId, nowMs, h.party_key, nowMs, holdId));
  if (restoreInventory) st.push(db.prepare(`UPDATE bula_offers SET remaining = remaining + ${sub('qty')}, updated_at = ? WHERE offer_id = ? AND status = 'published' AND service_start_utc > ? AND EXISTS (SELECT 1 FROM bula_holds WHERE ${g})`).bind(holdId, nowMs, h.offer_id, nowMs, holdId));
  if (h.credit_cents > 0) st.push(db.prepare(`INSERT OR IGNORE INTO bula_credit_ledger (party_key,type,amount_cents,hold_id,actor,source,policy_version,at) SELECT party_key, ?, credit_cents, hold_id, ?, ?, ?, ? FROM bula_holds WHERE ${g}`).bind(restoreCredit ? 'restored' : 'forfeited', authority.verifiedBy, `${authority.kind}:${authority.ref ?? ''}`, snap.policyVersion, nowMs, holdId));
  st.push(db.prepare(`UPDATE bula_holds SET state = 'cancelled', cancelled_at = ?, cancelled_by_kind = ?, cancelled_by_ref = ?, credit_restored = ?, inventory_restored = ?, updated_at = ? WHERE ${g}`).bind(nowMs, authority.kind, authority.ref, restoreCredit ? 1 : 0, restoreInventory ? 1 : 0, nowMs, holdId));
  try { await db.batch(st); } catch (e) { if (!isRollback(e)) throw e; }
  const n = await db.prepare('SELECT * FROM bula_holds WHERE hold_id = ?').bind(holdId).first();
  return n.state === 'cancelled' ? { ok: true, replay: false, state: 'cancelled', creditRestored: !!n.credit_restored, inventoryRestored: !!n.inventory_restored } : { ok: false, code: `hold_${n.state}` };
}
