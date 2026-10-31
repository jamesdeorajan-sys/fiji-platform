// SYNTHETIC only. Persisted inventory + credit on a real SQLite engine through the D1-shaped batch API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openD1 } from './test_db.mjs';
import { cfg, seedOffer, NOW, FIJI } from './fixtures.mjs';
import { grantWelcome, balance, reserve, confirmHold, cancelHold, releaseFailedCheckout, sweepExpired, expireGrants } from './inventory_credit.js';
import { issueConfirmationAuthority, issueCancellationAuthority } from './authority.js';

const mem = () => openD1(':memory:', { init: true });
const C = cfg();
const staffOk = (ref = 'staff-ev-1') => issueConfirmationAuthority({ kind: 'staff_confirmation', ref, verifiedBy: 'staff:james' });
const stock = async (db, id = 'O1') => (await db.prepare('SELECT remaining FROM bula_offers WHERE offer_id = ?').bind(id).first()).remaining;
const invariant = async (db) => {
  const bad = await db.prepare('SELECT party_key FROM bula_credit_accounts WHERE available_cents + reserved_cents + redeemed_cents + expired_cents != granted_cents OR available_cents < 0').all();
  assert.equal(bad.results.length, 0);
  const o = await db.prepare('SELECT offer_id FROM bula_offers WHERE remaining < 0 OR remaining > capacity_total').all(); assert.equal(o.results.length, 0);
};

test('acceptance: FJ$500 grant, FJ$150 offer with FJ$25 credit -> pay FJ$125, balance FJ$475 after confirm', async () => {
  const db = mem(); await seedOffer(db);
  await grantWelcome(db, C, { partyKey: 'trip:A', actor: 'system', source: 'saved-booking', nowMs: NOW });
  const r = await reserve(db, C, { partyKey: 'trip:A', idemKey: 'k1', offerId: 'O1', expectedVersion: 1, expectedNetCents: 12500, nowMs: NOW });
  assert.equal(r.ok, true); assert.equal(r.netPayableCents, 12500); assert.equal(r.creditCents, 2500);
  assert.equal((await balance(db, 'trip:A')).available, 47500); // reserved already out of 'available'
  assert.equal((await balance(db, 'trip:A')).reserved, 2500);
  const c = await confirmHold(db, { holdId: r.holdId, partyKey: 'trip:A', authority: staffOk(), bookingRef: 'BK-1', nowMs: NOW + 1000 });
  assert.equal(c.ok, true); const b = await balance(db, 'trip:A');
  assert.deepEqual([b.available, b.reserved, b.redeemed], [47500, 0, 2500]); assert.equal(await stock(db), 9); await invariant(db);
});
test('welcome grant replay/duplicate never grants twice; disabled flag refuses', async () => {
  const db = mem(); await grantWelcome(db, C, { partyKey: 'trip:A', actor: 'a', source: 's', nowMs: NOW });
  const r = await grantWelcome(db, C, { partyKey: 'trip:A', actor: 'a', source: 's', nowMs: NOW + 5 });
  assert.equal(r.replay, true); assert.equal((await balance(db, 'trip:A')).granted, 50000);
  await assert.rejects(() => grantWelcome(db, { ...C, creditsEnabled: false }, { partyKey: 'x', actor: 'a', source: 's', nowMs: NOW }), /CREDITS_DISABLED/);
});
test('idempotency: same party+key+payload replays the SAME hold; changed payload and cross-party reuse are not served', async () => {
  const db = mem(); await seedOffer(db); for (const p of ['trip:A', 'trip:B']) await grantWelcome(db, C, { partyKey: p, actor: 'a', source: 's', nowMs: NOW });
  const base = { idemKey: 'K', offerId: 'O1', expectedVersion: 1, nowMs: NOW };
  const a1 = await reserve(db, C, { partyKey: 'trip:A', ...base }); const a2 = await reserve(db, C, { partyKey: 'trip:A', ...base });
  assert.equal(a2.holdId, a1.holdId); assert.equal(a2.replay, true); assert.equal(await stock(db), 9);
  assert.equal((await reserve(db, C, { partyKey: 'trip:A', ...base, qty: 2 })).code, 'idempotency_payload_mismatch');
  const b = await reserve(db, C, { partyKey: 'trip:B', ...base }); assert.notEqual(b.holdId, a1.holdId); assert.equal(await stock(db), 8);
});
test('replay after expiry/release/cancel reports the TRUE state, never a stale success', async () => {
  const db = mem(); await seedOffer(db); await grantWelcome(db, C, { partyKey: 'trip:A', actor: 'a', source: 's', nowMs: NOW });
  const base = { partyKey: 'trip:A', idemKey: 'K', offerId: 'O1', expectedVersion: 1 };
  const r = await reserve(db, C, { ...base, nowMs: NOW, ttlMs: 1000 });
  const late = await reserve(db, C, { ...base, nowMs: NOW + 5000 });
  assert.equal(late.ok, false); assert.equal(late.code, 'hold_expired'); assert.equal(await stock(db), 10); assert.equal((await balance(db, 'trip:A')).available, 50000);
  const again = await reserve(db, C, { ...base, nowMs: NOW + 6000 }); assert.equal(again.code, 'hold_expired');
  const r2 = await reserve(db, C, { ...base, idemKey: 'K2', nowMs: NOW }); await releaseFailedCheckout(db, { holdId: r2.holdId, partyKey: 'trip:A', nowMs: NOW + 1 });
  assert.equal((await reserve(db, C, { ...base, idemKey: 'K2', nowMs: NOW + 2 })).code, 'hold_released'); await invariant(db);
});
test('partial / insufficient / zero balance, min-spend, zero stock, cutoff, unpublished', async () => {
  const db = mem(); await seedOffer(db); await seedOffer(db, { offer_id: 'O2', min_spend_cents: 99999 }); await seedOffer(db, { offer_id: 'O3', remaining: 0 }); await seedOffer(db, { offer_id: 'O4', status: 'withdrawn' });
  await grantWelcome(db, C, { partyKey: 'trip:P', cents: 1000, actor: 'a', source: 's', nowMs: NOW });
  const p = await reserve(db, C, { partyKey: 'trip:P', idemKey: '1', offerId: 'O1', expectedVersion: 1, nowMs: NOW }); assert.equal(p.creditCents, 1000); assert.equal(p.netPayableCents, 14000);
  const z = await reserve(db, C, { partyKey: 'trip:P', idemKey: '2', offerId: 'O1', expectedVersion: 1, nowMs: NOW }); assert.equal(z.creditCents, 0); assert.equal(z.netPayableCents, 15000);
  const m = await reserve(db, C, { partyKey: 'trip:Q', idemKey: '3', offerId: 'O2', expectedVersion: 1, nowMs: NOW }); assert.equal(m.creditCents, 0);
  assert.equal((await reserve(db, C, { partyKey: 'trip:Q', idemKey: '4', offerId: 'O3', expectedVersion: 1, nowMs: NOW })).code, 'sold_out');
  assert.equal((await reserve(db, C, { partyKey: 'trip:Q', idemKey: '5', offerId: 'O4', expectedVersion: 1, nowMs: NOW })).code, 'not_published');
  assert.equal((await reserve(db, C, { partyKey: 'trip:Q', idemKey: '6', offerId: 'O1', expectedVersion: 1, nowMs: FIJI('2026-11-02T22:00:00') })).code, 'past_cutoff');
  assert.equal((await reserve(db, C, { partyKey: 'trip:Q', idemKey: '7', offerId: 'O1', expectedVersion: 1, nowMs: FIJI('2026-11-02T17:59:00') })).code, 'not_yet_released'); await invariant(db);
});
test('offer version/price changed during checkout is refused; operator payout and snapshot are persisted', async () => {
  const db = mem(); await seedOffer(db, { version: 2 }); await grantWelcome(db, C, { partyKey: 'trip:A', actor: 'a', source: 's', nowMs: NOW });
  assert.equal((await reserve(db, C, { partyKey: 'trip:A', idemKey: '1', offerId: 'O1', expectedVersion: 1, nowMs: NOW })).code, 'offer_changed');
  assert.equal((await reserve(db, C, { partyKey: 'trip:A', idemKey: '2', offerId: 'O1', expectedVersion: 2, expectedNetCents: 9999, nowMs: NOW })).code, 'price_changed');
  const r = await reserve(db, C, { partyKey: 'trip:A', idemKey: '3', offerId: 'O1', expectedVersion: 2, nowMs: NOW });
  for (const k of ['operatorId', 'pricingBasis', 'capacityUnit', 'fundingParty', 'operatorPayoutCents', 'cancellationTerms', 'creditRestoreHoursBefore', 'serviceStartUtc', 'policyVersion', 'inclusions']) assert.notEqual(r.snapshot[k], undefined, k);
  assert.equal(r.snapshot.operatorPayoutCents, 12000);
});
test('confirm needs server-minted authority + ownership; a browser-shaped object cannot confirm; instant only under a covering contract', async () => {
  const db = mem(); await seedOffer(db); await seedOffer(db, { offer_id: 'OI', instant_confirm: 1, operator_contract_id: 'CT-1' });
  const r = await reserve(db, C, { partyKey: 'trip:A', idemKey: '1', offerId: 'O1', expectedVersion: 1, nowMs: NOW });
  const forged = { kind: 'staff_confirmation', ref: 'x', verifiedBy: 'me' };
  assert.equal((await confirmHold(db, { holdId: r.holdId, partyKey: 'trip:A', authority: forged, nowMs: NOW })).code, 'no_server_authority');
  assert.equal((await confirmHold(db, { holdId: r.holdId, partyKey: 'trip:B', authority: staffOk(), nowMs: NOW })).code, 'unknown_hold');
  const contract = issueConfirmationAuthority({ kind: 'operator_acceptance_contract', ref: 'CT-1', verifiedBy: 'system:contract' });
  assert.equal((await confirmHold(db, { holdId: r.holdId, partyKey: 'trip:A', authority: contract, nowMs: NOW })).code, 'contract_does_not_cover_offer');
  const ri = await reserve(db, C, { partyKey: 'trip:A', idemKey: '2', offerId: 'OI', expectedVersion: 1, nowMs: NOW });
  assert.equal((await confirmHold(db, { holdId: ri.holdId, partyKey: 'trip:A', authority: contract, nowMs: NOW })).ok, true);
  assert.equal((await confirmHold(db, { holdId: r.holdId, partyKey: 'trip:A', authority: staffOk(), nowMs: NOW })).ok, true);
  assert.equal((await confirmHold(db, { holdId: r.holdId, partyKey: 'trip:A', authority: staffOk(), nowMs: NOW })).replay, true); await invariant(db);
});
test('repeated confirmation callbacks do not double-debit; confirm after expiry fails and returns stock + credit', async () => {
  const db = mem(); await seedOffer(db); await grantWelcome(db, C, { partyKey: 'trip:A', actor: 'a', source: 's', nowMs: NOW });
  const r = await reserve(db, C, { partyKey: 'trip:A', idemKey: '1', offerId: 'O1', expectedVersion: 1, nowMs: NOW });
  for (let i = 0; i < 3; i++) await confirmHold(db, { holdId: r.holdId, partyKey: 'trip:A', authority: staffOk(), nowMs: NOW + 10 });
  assert.equal((await balance(db, 'trip:A')).redeemed, 2500);
  const r2 = await reserve(db, C, { partyKey: 'trip:A', idemKey: '2', offerId: 'O1', expectedVersion: 1, nowMs: NOW, ttlMs: 100 });
  const late = await confirmHold(db, { holdId: r2.holdId, partyKey: 'trip:A', authority: staffOk(), nowMs: NOW + 9999 });
  assert.equal(late.code, 'hold_expired'); assert.equal(await stock(db), 9); assert.equal((await balance(db, 'trip:A')).reserved, 0); await invariant(db);
});
test('cancellation: policy window, authority, restore once, no resale of past service, expired credit not revived', async () => {
  const db = mem(); await seedOffer(db, { credit_restore_hours_before: 12, inventory_restore_hours_before: 12 }); await seedOffer(db, { offer_id: 'OP', service_start_utc: NOW + 3600e3, service_date: '2026-11-03' });
  await grantWelcome(db, C, { partyKey: 'trip:A', actor: 'a', source: 's', nowMs: NOW });
  const mk = async (id, idem, off = 'O1') => { const r = await reserve(db, C, { partyKey: 'trip:A', idemKey: idem, offerId: off, expectedVersion: 1, nowMs: NOW }); await confirmHold(db, { holdId: r.holdId, partyKey: 'trip:A', authority: staffOk(), nowMs: NOW }); return r.holdId; };
  const h1 = await mk(1, 'a');
  assert.equal((await cancelHold(db, { holdId: h1, partyKey: 'trip:A', authority: staffOk(), nowMs: NOW })).code, 'no_server_authority'); // confirm authority is not a cancel authority
  const guest = issueCancellationAuthority({ kind: 'guest_cancel', verifiedBy: 'guest:A' });
  assert.equal((await cancelHold(db, { holdId: h1, partyKey: 'trip:B', authority: guest, nowMs: NOW })).code, 'unknown_hold');
  const c1 = await cancelHold(db, { holdId: h1, partyKey: 'trip:A', authority: guest, nowMs: NOW + 60000 });   // 14h before service, window is 12h
  assert.deepEqual([c1.ok, c1.creditRestored, c1.inventoryRestored], [true, true, true]);
  await cancelHold(db, { holdId: h1, partyKey: 'trip:A', authority: guest, nowMs: NOW + 70000 });
  const b = await balance(db, 'trip:A'); assert.deepEqual([b.available, b.redeemed], [50000, 0]); assert.equal(await stock(db), 10);
  // inside the no-refund window: credit forfeited (stays redeemed), stock not resold
  const hLate = await mk(2, 'b', 'O1'); const sc = await cancelHold(db, { holdId: hLate, partyKey: 'trip:A', authority: guest, nowMs: FIJI('2026-11-03T08:00:00') });
  assert.deepEqual([sc.creditRestored, sc.inventoryRestored], [false, false]); assert.equal((await balance(db, 'trip:A')).redeemed, 2500);
  // staff refund with evidence restores credit only; past service never re-enters stock
  const h3 = await mk(3, 'c', 'OP'); const refund = issueCancellationAuthority({ kind: 'staff_cancel', ref: 'REFUND-EV-9', verifiedBy: 'staff:james', refundCredit: true });
  const s3 = await cancelHold(db, { holdId: h3, partyKey: 'trip:A', authority: refund, nowMs: NOW + 3 * 3600e3 });
  assert.deepEqual([s3.creditRestored, s3.inventoryRestored], [true, false]);
  // credit restored after the grant expired goes to expired, not available
  const h4 = await mk(4, 'd'); await db.exec(`UPDATE bula_credit_accounts SET expires_at = ${NOW + 1} WHERE party_key = 'trip:A'`);
  await cancelHold(db, { holdId: h4, partyKey: 'trip:A', authority: guest, nowMs: NOW + 60000 }); const e = await balance(db, 'trip:A');
  assert.ok(e.expired >= 2500); await invariant(db);
});
test('operator cancels a service: full credit back, stock not resold; missing evidence ref refused at mint time', async () => {
  assert.throws(() => issueCancellationAuthority({ kind: 'staff_cancel', verifiedBy: 'x' }), /evidence/);
  const db = mem(); await seedOffer(db); await grantWelcome(db, C, { partyKey: 'trip:A', actor: 'a', source: 's', nowMs: NOW });
  const r = await reserve(db, C, { partyKey: 'trip:A', idemKey: '1', offerId: 'O1', expectedVersion: 1, nowMs: NOW }); await confirmHold(db, { holdId: r.holdId, partyKey: 'trip:A', authority: staffOk(), nowMs: NOW });
  const op = issueCancellationAuthority({ kind: 'operator_cancel', ref: 'OP-NOTICE-1', verifiedBy: 'staff:james' });
  const x = await cancelHold(db, { holdId: r.holdId, partyKey: 'trip:A', authority: op, nowMs: FIJI('2026-11-03T07:00:00') });
  assert.deepEqual([x.creditRestored, x.inventoryRestored], [true, false]); assert.equal(await stock(db), 9); await invariant(db);
});
test('grant expiry sweep moves unused credit to expired once; expired balance cannot be reserved', async () => {
  const db = mem(); await seedOffer(db); await grantWelcome(db, C, { partyKey: 'trip:A', actor: 'a', source: 's', nowMs: NOW });
  const later = NOW + 91 * 86400000; assert.equal(await expireGrants(db, later), 1); assert.equal(await expireGrants(db, later), 0);
  const b = await balance(db, 'trip:A'); assert.deepEqual([b.available, b.expired], [0, 50000]); await invariant(db);
});

/* ---- rollback / fault between writes, restart recovery ------------------------------------------------------ */
test('FAULT between the inventory write and the credit write rolls back everything', async () => {
  for (const after of [1, 2, 3, 4]) { // every position inside the 5+ statement reserve batch
    const db = mem(); await seedOffer(db); await grantWelcome(db, C, { partyKey: 'trip:A', actor: 'a', source: 's', nowMs: NOW });
    db.fault.after = after;
    await assert.rejects(() => reserve(db, C, { partyKey: 'trip:A', idemKey: 'k', offerId: 'O1', expectedVersion: 1, nowMs: NOW }), /INJECTED_FAULT/);
    assert.equal(await stock(db), 10, `after=${after}`); const b = await balance(db, 'trip:A'); assert.deepEqual([b.available, b.reserved], [50000, 0]);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM bula_holds').first()).n, 0); assert.equal((await db.prepare('SELECT COUNT(*) n FROM bula_assert').first()).n, 0);
    const ok = await reserve(db, C, { partyKey: 'trip:A', idemKey: 'k', offerId: 'O1', expectedVersion: 1, nowMs: NOW }); assert.equal(ok.ok, true); // retry after the crash works
  }
});
test('FAULT inside confirm and cancel batches leaves the hold in its previous consistent state', async () => {
  const db = mem(); await seedOffer(db); await grantWelcome(db, C, { partyKey: 'trip:A', actor: 'a', source: 's', nowMs: NOW });
  const r = await reserve(db, C, { partyKey: 'trip:A', idemKey: 'k', offerId: 'O1', expectedVersion: 1, nowMs: NOW });
  db.fault.after = 2; await assert.rejects(() => confirmHold(db, { holdId: r.holdId, partyKey: 'trip:A', authority: staffOk(), nowMs: NOW }), /INJECTED/);
  assert.equal((await db.prepare('SELECT state FROM bula_holds').first()).state, 'held'); assert.equal((await balance(db, 'trip:A')).reserved, 2500);
  assert.equal((await confirmHold(db, { holdId: r.holdId, partyKey: 'trip:A', authority: staffOk(), nowMs: NOW })).ok, true);
  const g = issueCancellationAuthority({ kind: 'guest_cancel', verifiedBy: 'guest:A' });
  db.fault.after = 1; await assert.rejects(() => cancelHold(db, { holdId: r.holdId, partyKey: 'trip:A', authority: g, nowMs: NOW + 1000 }), /INJECTED/);
  assert.equal((await db.prepare('SELECT state FROM bula_holds').first()).state, 'confirmed'); assert.equal((await balance(db, 'trip:A')).redeemed, 2500); await invariant(db);
});
test('RESTART RECOVERY: process dies holding stock+credit; a fresh connection on the same file sweeps it back', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const file = `${fs.mkdtempSync(`${os.tmpdir()}/bula-`)}/d.db`;
  let db = openD1(file, { init: true }); await seedOffer(db); await grantWelcome(db, C, { partyKey: 'trip:A', actor: 'a', source: 's', nowMs: NOW });
  await reserve(db, C, { partyKey: 'trip:A', idemKey: 'k', offerId: 'O1', expectedVersion: 1, nowMs: NOW, ttlMs: 1000 }); db.close();   // "crash"
  db = openD1(file); assert.equal(await stock(db), 9);
  assert.equal(await sweepExpired(db, NOW + 5000), 1); assert.equal(await sweepExpired(db, NOW + 6000), 0);
  assert.equal(await stock(db), 10); assert.equal((await balance(db, 'trip:A')).available, 50000); await invariant(db); db.close();
});
