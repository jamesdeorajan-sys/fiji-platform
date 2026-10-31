/* SUPERSEDED reference model (in-memory). Kept for history; the D1-backed inventory_credit.js / outbox_d1.js replace it and fix the review findings (scoped idempotency, authority, cancel policy, durable leases). Do not wire this file. */
/* Bula Happiness — welcome promotional-credit ledger (ISOLATED, in-memory reference implementation).
 * Integer FJD cents. Append-only entries; balances derived; never negative.
 * NOT an earned reward: separate grant type, separate from referral/payment-evidence rules. */
export const DEFAULT_WELCOME_CENTS = 50000; // FJ$500 — synthetic pilot value; live value is James's release setting
export class CreditError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

export function createLedger({ policyVersion = 'welcome-v0-synthetic' } = {}) {
  const entries = []; const grants = new Map(); const holds = new Map(); // holdId -> {cents,state,expiresAtMs,bookingRef}
  const push = (e) => { entries.push(Object.freeze({ seq: entries.length + 1, policyVersion, ...e })); };
  const sum = (party, pred) => entries.filter((e) => e.party === party && pred(e)).reduce((a, e) => a + e.cents, 0);

  function sweep(nowMs) { // expire stale holds back to the balance
    for (const [id, h] of holds) if (h.state === 'reserved' && nowMs >= h.expiresAtMs) { h.state = 'expired'; push({ type: 'hold_expired', party: h.party, holdId: id, cents: 0, at: nowMs }); }
  }
  function balance(party, nowMs = Date.now()) {
    sweep(nowMs);
    const granted = sum(party, (e) => e.type === 'granted');
    const expired = sum(party, (e) => e.type === 'grant_expired');
    const redeemed = [...holds.values()].filter((h) => h.party === party && h.state === 'redeemed').reduce((a, h) => a + h.cents, 0);
    const reserved = [...holds.values()].filter((h) => h.party === party && h.state === 'reserved').reduce((a, h) => a + h.cents, 0);
    return { granted, redeemed, reserved, expired, available: granted - expired - redeemed - reserved };
  }
  return {
    entries: () => entries.slice(), balance,
    /** One grant per explicitly identified trip/party key; replay returns the original. */
    grantWelcome({ partyKey, cents = DEFAULT_WELCOME_CENTS, actor, source, bookingRef, nowMs = Date.now() }) {
      if (!partyKey) throw new CreditError('party_required');
      if (!Number.isInteger(cents) || cents <= 0) throw new CreditError('bad_amount');
      if (grants.has(partyKey)) return { granted: false, replay: true, entryId: grants.get(partyKey) };
      push({ type: 'granted', party: partyKey, cents, actor, source, bookingRef, at: nowMs });
      grants.set(partyKey, entries.length); return { granted: true, replay: false, entryId: entries.length };
    },
    expireGrant({ partyKey, cents, actor, nowMs = Date.now() }) {
      const b = balance(partyKey, nowMs); const c = Math.min(cents, b.available);
      if (c > 0) push({ type: 'grant_expired', party: partyKey, cents: c, actor, at: nowMs }); return c;
    },
    reserve({ partyKey, holdId, cents, ttlMs = 10 * 60000, bookingRef, nowMs = Date.now() }) {
      if (!Number.isInteger(cents) || cents < 0) throw new CreditError('bad_amount');
      const ex = holds.get(holdId); if (ex) return { ok: ex.state === 'reserved' || ex.state === 'redeemed', replay: true, state: ex.state };
      if (cents > balance(partyKey, nowMs).available) throw new CreditError('insufficient_balance');
      holds.set(holdId, { party: partyKey, cents, state: 'reserved', expiresAtMs: nowMs + ttlMs, bookingRef });
      push({ type: 'reserved', party: partyKey, holdId, cents: 0, amount: cents, bookingRef, at: nowMs }); return { ok: true, replay: false, state: 'reserved' };
    },
    redeem(holdId, nowMs = Date.now()) { // idempotent: repeated callbacks never double-debit
      const h = holds.get(holdId); if (!h) throw new CreditError('unknown_hold');
      if (h.state === 'redeemed') return { ok: true, replay: true };
      sweep(nowMs); if (h.state !== 'reserved') throw new CreditError('hold_not_active');
      h.state = 'redeemed'; push({ type: 'redeemed', party: h.party, holdId, cents: 0, amount: h.cents, bookingRef: h.bookingRef, at: nowMs }); return { ok: true, replay: false };
    },
    release(holdId, nowMs = Date.now()) { // failed checkout
      const h = holds.get(holdId); if (!h) throw new CreditError('unknown_hold');
      if (h.state !== 'reserved') return { ok: true, replay: true, state: h.state };
      h.state = 'released'; push({ type: 'released', party: h.party, holdId, cents: 0, amount: h.cents, at: nowMs }); return { ok: true, replay: false, state: 'released' };
    },
    restore(holdId, nowMs = Date.now()) { // booking cancelled after redemption; once only
      const h = holds.get(holdId); if (!h) throw new CreditError('unknown_hold');
      if (h.state === 'restored') return { ok: true, replay: true };
      if (h.state !== 'redeemed') throw new CreditError('not_redeemed');
      h.state = 'restored'; push({ type: 'restored', party: h.party, holdId, cents: 0, amount: h.cents, at: nowMs }); return { ok: true, replay: false };
    },
  };
}
/** Credit applied = min(per-offer max, balance, offer price). Operator payout & original quote untouched. */
export function priceWithCredit({ offerPriceCents, maxCreditCents, availableCents }) {
  const credit = Math.max(0, Math.min(maxCreditCents, availableCents, offerPriceCents));
  return { offerPriceCents, creditCents: credit, netPayableCents: offerPriceCents - credit };
}
