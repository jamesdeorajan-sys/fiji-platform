/* SUPERSEDED reference model (in-memory). Kept for history; the D1-backed inventory_credit.js / outbox_d1.js replace it and fix the review findings (scoped idempotency, authority, cancel policy, durable leases). Do not wire this file. */
/* Bula Happiness — bounded reservation of inventory + credit (ISOLATED reference implementation).
 * Single-threaded critical section = atomic here; the D1 version must use one conditional UPDATE/transaction
 * (see bula/README.md). Revalidates offer version, price and balance at checkout. */
import { offerBookable } from './edition.js';
import { priceWithCredit } from './ledger.js';

export function createCheckout({ ledger, offers, newId = (() => { let n = 0; return () => `H${++n}`; })() }) {
  const holds = new Map(); const byIdem = new Map();
  const find = (id) => offers.find((o) => o.id === id);
  return {
    holds: () => [...holds.values()],
    reserve({ idemKey, offerId, partyKey, qty = 1, expectedVersion, expectedNetCents, nowMs, ttlMs = 10 * 60000 }) {
      if (byIdem.has(idemKey)) return { ...byIdem.get(idemKey), replay: true };
      const o = find(offerId); if (!o) return { ok: false, code: 'unknown_offer' };
      const b = offerBookable(o, nowMs); if (!b.ok) return { ok: false, code: b.reason };
      if (o.version !== expectedVersion) return { ok: false, code: 'offer_changed' };
      if (!Number.isInteger(qty) || qty < 1 || o.remaining < qty) return { ok: false, code: 'insufficient_inventory' };
      const avail = ledger.balance(partyKey, nowMs).available;
      const p = priceWithCredit({ offerPriceCents: o.priceCents * qty, maxCreditCents: o.maxCreditCents * qty, availableCents: avail });
      if (expectedNetCents !== undefined && p.netPayableCents !== expectedNetCents) return { ok: false, code: 'price_changed', ...p };
      const holdId = newId();
      try { ledger.reserve({ partyKey, holdId, cents: p.creditCents, ttlMs, nowMs }); } catch (e) { return { ok: false, code: e.code || 'credit_failed' }; }
      o.remaining -= qty; // inventory taken only after credit held; both or neither
      const hold = { holdId, offerId, partyKey, qty, state: 'held', expiresAtMs: nowMs + ttlMs, snapshot: { ...p, offerVersion: o.version, serviceDate: o.serviceDate, title: o.title } };
      holds.set(holdId, hold); const r = { ok: true, holdId, ...p }; byIdem.set(idemKey, r); return r;
    },
    /** Confirmation only on server-verified evidence (never a bare link click). */
    confirm(holdId, nowMs) {
      const h = holds.get(holdId); if (!h) return { ok: false, code: 'unknown_hold' };
      if (h.state === 'confirmed') return { ok: true, replay: true };
      if (h.state !== 'held' || nowMs >= h.expiresAtMs) { this.release(holdId, nowMs); return { ok: false, code: 'hold_expired' }; }
      ledger.redeem(holdId, nowMs); h.state = 'confirmed'; return { ok: true, replay: false, snapshot: h.snapshot };
    },
    release(holdId, nowMs) { // failed payment / timeout: give back inventory + credit once
      const h = holds.get(holdId); if (!h || h.state !== 'held') return { ok: true, replay: true };
      h.state = 'released'; find(h.offerId).remaining += h.qty; ledger.release(holdId, nowMs); return { ok: true };
    },
    sweep(nowMs) { for (const h of holds.values()) if (h.state === 'held' && nowMs >= h.expiresAtMs) this.release(h.holdId, nowMs); },
    cancel(holdId, nowMs) { // cancellation of a confirmed booking: restore once
      const h = holds.get(holdId); if (!h || h.state !== 'confirmed') return { ok: false, code: 'not_confirmed' };
      h.state = 'cancelled'; find(h.offerId).remaining += h.qty; ledger.restore(holdId, nowMs); return { ok: true };
    },
  };
}
