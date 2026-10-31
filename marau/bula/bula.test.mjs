// SYNTHETIC fixtures only. No real guests, offers or messages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseInstantMs, isEditionVisible, latestVisibleServiceDate, addDays, runPublisher, editionView } from './edition.js';
import { createLedger, priceWithCredit } from './ledger.js';
import { createCheckout } from './checkout.js';
import { createOutbox, createCaptureSender, renderGuestEmail, liveSenderDisabled } from './outbox.js';

const fiji = (s) => Date.parse(new Date(Date.parse(`${s}Z`) - 12 * 3600e3).toISOString()); // wall clock Fiji -> UTC ms (UTC+12, no DST in test dates)
const mkOffer = (o = {}) => ({ id: 'O1', title: 'SYNTHETIC Island Cruise', status: 'published', serviceDate: '2026-11-03', bookingCutoffUtc: new Date(fiji('2026-11-02T20:00:00')).toISOString(), remaining: 1, priceCents: 15000, maxCreditCents: 2500, version: 1, approvedBy: 'james', approvedAt: 1, ...o });

test('visibility 17:59 vs 18:00 Fiji for next-day edition', () => {
  assert.equal(isEditionVisible('2026-11-03', fiji('2026-11-02T17:59:00')), false);
  assert.equal(isEditionVisible('2026-11-03', fiji('2026-11-02T18:00:00')), true);
  assert.equal(latestVisibleServiceDate(fiji('2026-11-02T17:59:00')), '2026-11-02');
  assert.equal(latestVisibleServiceDate(fiji('2026-11-02T18:00:00')), '2026-11-03');
});
test('month/year boundary 31 Dec -> 1 Jan', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(latestVisibleServiceDate(fiji('2026-12-31T18:00:00')), '2027-01-01');
  assert.equal(releaseInstantMs('2027-01-01'), fiji('2026-12-31T18:00:00'));
});
test('host timezone cannot shift the release (same instant regardless of TZ env)', () => {
  assert.equal(new Date(releaseInstantMs('2026-11-03')).toISOString(), '2026-11-02T06:00:00.000Z');
});
test('publisher: idempotent, catch-up after missed run, never publishes stale or unapproved', () => {
  const o = [mkOffer({ id: 'A', status: 'approved' }), mkOffer({ id: 'B', status: 'approved', bookingCutoffUtc: new Date(fiji('2026-11-02T10:00:00')).toISOString() }), mkOffer({ id: 'C', status: 'approved', approvedBy: null })];
  const now = fiji('2026-11-02T19:30:00'); // run missed 18:00, ran 19:30
  runPublisher(o, now); runPublisher(o, now);
  assert.deepEqual(o.map((x) => x.status), ['published', 'expired', 'approved']);
  assert.equal(editionView(o, now).items.length, 1);
});
test('no approved offers -> honest empty state', () => assert.equal(editionView([], Date.now()).empty, true));
test('withdrawn offer is not bookable', () => assert.equal(editionView([mkOffer({ status: 'withdrawn' })], fiji('2026-11-02T19:00:00')).empty, true));

test('FJ$500 balance, approved FJ$150 offer with FJ$25 credit -> pay FJ$125, remaining FJ$475', () => {
  const now = fiji('2026-11-02T19:00:00'); const L = createLedger(); const o = [mkOffer()]; const C = createCheckout({ ledger: L, offers: o });
  L.grantWelcome({ partyKey: 'P1', cents: 50000, actor: 'system', source: 'synthetic', nowMs: now });
  const r = C.reserve({ idemKey: 'k1', offerId: 'O1', partyKey: 'P1', expectedVersion: 1, expectedNetCents: 12500, nowMs: now });
  assert.equal(r.ok, true); assert.equal(r.netPayableCents, 12500); assert.equal(r.creditCents, 2500);
  assert.equal(C.confirm(r.holdId, now + 1000).ok, true);
  assert.equal(L.balance('P1', now + 1000).available, 47500);
});
test('partial / insufficient / zero credit pricing', () => {
  assert.deepEqual(priceWithCredit({ offerPriceCents: 15000, maxCreditCents: 2500, availableCents: 1000 }), { offerPriceCents: 15000, creditCents: 1000, netPayableCents: 14000 });
  assert.equal(priceWithCredit({ offerPriceCents: 15000, maxCreditCents: 2500, availableCents: 0 }).netPayableCents, 15000);
  assert.equal(priceWithCredit({ offerPriceCents: 1000, maxCreditCents: 2500, availableCents: 9999 }).netPayableCents, 0);
});
test('welcome grant replay does not duplicate', () => {
  const L = createLedger(); L.grantWelcome({ partyKey: 'P', actor: 'a', source: 's' }); const r = L.grantWelcome({ partyKey: 'P', actor: 'a', source: 's' });
  assert.equal(r.replay, true); assert.equal(L.balance('P').granted, 50000);
});
test('last-place concurrency: only one of two simultaneous checkouts wins', async () => {
  const now = fiji('2026-11-02T19:00:00'); const L = createLedger(); const o = [mkOffer()]; const C = createCheckout({ ledger: L, offers: o });
  for (const p of ['A', 'B']) L.grantWelcome({ partyKey: p, actor: 'x', source: 's', nowMs: now });
  const rs = await Promise.all(['A', 'B'].map(async (p) => C.reserve({ idemKey: p, offerId: 'O1', partyKey: p, expectedVersion: 1, nowMs: now })));
  assert.equal(rs.filter((r) => r.ok).length, 1); assert.equal(o[0].remaining, 0);
  assert.equal(rs.find((r) => !r.ok).code, 'sold_out');
});
test('simultaneous checkouts cannot overspend one balance (never negative)', () => {
  const now = fiji('2026-11-02T19:00:00'); const L = createLedger(); L.grantWelcome({ partyKey: 'P', cents: 3000, actor: 'x', source: 's', nowMs: now });
  const o = [mkOffer({ id: 'O1', remaining: 5 }), mkOffer({ id: 'O2', remaining: 5 })]; const C = createCheckout({ ledger: L, offers: o });
  const a = C.reserve({ idemKey: '1', offerId: 'O1', partyKey: 'P', qty: 1, expectedVersion: 1, nowMs: now });
  const b = C.reserve({ idemKey: '2', offerId: 'O2', partyKey: 'P', qty: 1, expectedVersion: 1, nowMs: now });
  assert.equal(a.creditCents + b.creditCents, 3000);
  assert.ok(L.balance('P', now).available >= 0); assert.equal(a.creditCents, 2500); assert.equal(b.creditCents, 500);
});
test('hold timeout returns inventory and credit; replayed confirm does not double-debit; cancel restores once', () => {
  const now = fiji('2026-11-02T19:00:00'); const L = createLedger(); const o = [mkOffer()]; const C = createCheckout({ ledger: L, offers: o });
  L.grantWelcome({ partyKey: 'P', actor: 'x', source: 's', nowMs: now });
  const r = C.reserve({ idemKey: 'k', offerId: 'O1', partyKey: 'P', expectedVersion: 1, nowMs: now, ttlMs: 1000 });
  assert.equal(C.confirm(r.holdId, now + 5000).code, 'hold_expired'); assert.equal(o[0].remaining, 1); assert.equal(L.balance('P', now + 5000).available, 50000);
  const r2 = C.reserve({ idemKey: 'k2', offerId: 'O1', partyKey: 'P', expectedVersion: 1, nowMs: now });
  C.confirm(r2.holdId, now); const again = C.confirm(r2.holdId, now); assert.equal(again.replay, true);
  assert.equal(L.balance('P', now).available, 47500);
  C.cancel(r2.holdId, now); C.cancel(r2.holdId, now);
  assert.equal(L.balance('P', now).available, 50000); assert.equal(o[0].remaining, 1);
});
test('offer changed / price changed during checkout is refused; operator payout fields untouched', () => {
  const now = fiji('2026-11-02T19:00:00'); const L = createLedger(); L.grantWelcome({ partyKey: 'P', actor: 'x', source: 's', nowMs: now });
  const o = [mkOffer({ version: 2, operatorPayoutCents: 9000 })]; const C = createCheckout({ ledger: L, offers: o });
  assert.equal(C.reserve({ idemKey: 'a', offerId: 'O1', partyKey: 'P', expectedVersion: 1, nowMs: now }).code, 'offer_changed');
  assert.equal(C.reserve({ idemKey: 'b', offerId: 'O1', partyKey: 'P', expectedVersion: 2, expectedNetCents: 1, nowMs: now }).code, 'price_changed');
  assert.equal(o[0].operatorPayoutCents, 9000);
});
test('zero quantity and past cutoff refused', () => {
  const now = fiji('2026-11-02T19:00:00'); const L = createLedger(); const C = createCheckout({ ledger: L, offers: [mkOffer({ remaining: 0 }), mkOffer({ id: 'O2' })] });
  assert.equal(C.reserve({ idemKey: 'a', offerId: 'O1', partyKey: 'P', expectedVersion: 1, nowMs: now }).code, 'sold_out');
  assert.equal(C.reserve({ idemKey: 'b', offerId: 'O2', partyKey: 'P', expectedVersion: 1, nowMs: fiji('2026-11-02T20:00:00') }).code, 'past_cutoff');
});

const evt = { eventId: 'E1', bookingRef: 'BK-SYN-1', status: 'pending', guestEmail: 'synthetic@example.invalid', from: 'Nadi Airport', to: 'Sofitel Denarau', pickupFijiLocal: 'Tue 3 Nov 2026 09:00', currency: 'FJD', priceCents: 11100, passengers: 2, luggage: 3 };
test('saved booking -> exactly one guest + one staff captured email; replay creates no duplicates', async () => {
  const ob = createOutbox(), s = createCaptureSender();
  ob.enqueueForSavedBooking(evt); ob.enqueueForSavedBooking(evt);
  await ob.run(s, (j) => j.recipient === 'guest' ? renderGuestEmail(j, { privateTripUrl: 'https://example.invalid/t/SYNTH' }) : { to: 'team.invalid', subject: 'New booking', text: j.bookingRef });
  await ob.run(s, () => { throw new Error('should not resend'); });
  assert.equal(ob.jobs().length, 2); assert.equal(s.sent.length, 2);
  const g = s.sent.find((m) => m.to === evt.guestEmail);
  assert.match(g.text, /received/i); assert.doesNotMatch(g.text, /is confirmed/i); assert.match(g.text, /Fiji time/);
});
test('sender failure never loses the booking job; retry succeeds; live sender disabled is reported not thrown', async () => {
  const ob = createOutbox(); ob.enqueueForSavedBooking(evt);
  const r = (j) => ({ to: 'x.invalid', subject: j.recipient, text: 't' });
  await ob.run(liveSenderDisabled, r); assert.ok(ob.jobs().every((j) => j.state === 'failed' && /LIVE_SENDER_DISABLED/.test(j.error)));
  const s = createCaptureSender({ failTimes: 1 }); await ob.run(s, r); await ob.run(s, r);
  assert.ok(ob.jobs().every((j) => j.state === 'accepted'));
  assert.ok(ob.jobs().every((j) => j.evidence.delivered === false && j.evidence.humanAck === false));
});
test('ambiguous send outcome is not blindly resent; reconcile resolves it', async () => {
  const ob = createOutbox(), s = createCaptureSender({ ambiguousTimes: 2 }); ob.enqueueForSavedBooking(evt);
  const r = () => ({ to: 'x.invalid', subject: 's', text: 't' });
  await ob.run(s, r); await ob.run(s, r);
  assert.ok(ob.jobs().every((j) => j.state === 'ambiguous' && j.attempts === 1)); assert.equal(s.sent.length, 0);
  for (const j of ob.jobs()) ob.reconcile(j.key, { accepted: true });
  assert.ok(ob.jobs().every((j) => j.state === 'accepted'));
});
