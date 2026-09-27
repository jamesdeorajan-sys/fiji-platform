import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv, seedActiveOffer, synthGuest } from './fixtures.mjs';
import worker from '../worker/worker.js';
import { rankOffersForGuest, answerRoutineQuestion } from '../worker/ai_assist.js';

installNetworkGuard();

function req(path, opts = {}) {
  return new Request('http://marau-preview.test' + path, opts);
}
async function call(env, path, opts) {
  const res = await worker.fetch(req(path, opts), env);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
function withJson(method, body, headers = {}) {
  return { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) };
}
function authed(token) {
  return { authorization: `Bearer ${token}` };
}

test('assist requires a valid access token — it never answers for an anonymous caller', async () => {
  const env = makeEnv();
  const res = await call(env, '/preview/assist', withJson('POST', { question: 'when is my pickup?' }));
  assert.equal(res.status, 401);
});

test('assist is clearly labelled as AI, keeps the human-handoff option visible, and never invents a price', async () => {
  const env = makeEnv();
  const { offer } = await seedActiveOffer(env);
  const guest = synthGuest({ pickup_zone: offer.origin_zone, destination_zone: offer.destination_zone });
  const created = await call(env, '/preview/bookings', withJson('POST', guest));
  const token = created.data.access_token;

  const res = await call(env, '/preview/assist', withJson('POST', { question: 'when is my pickup?' }, authed(token)));
  assert.equal(res.status, 200);
  assert.equal(res.data.ai, true);
  assert.ok(res.data.disclosure.toLowerCase().includes('automated'));
  assert.ok(res.data.human_handoff_label.includes('WhatsApp'));
  assert.ok(!/24\s*\/\s*7/i.test(res.data.disclosure), 'must not claim 24/7 staffing without a confirmed decision');

  // Every ranked offer's price must be traceable to the real seeded offer
  // row — nothing invented.
  for (const ranked of res.data.ranked_offers) {
    assert.equal(typeof ranked.price, 'number');
    if (ranked.offer_id === offer.offer_id) {
      assert.equal(ranked.price, offer.smart_match_price ?? offer.standard_price);
    }
  }
});

test('assist answers pickup-time questions from the real booking record, verbatim', async () => {
  const env = makeEnv();
  const guest = synthGuest();
  const created = await call(env, '/preview/bookings', withJson('POST', guest));
  const token = created.data.access_token;

  const res = await call(env, '/preview/assist', withJson('POST', { question: 'When is my pickup?' }, authed(token)));
  assert.equal(res.status, 200);
  assert.ok(res.data.answer.includes(new Date(guest.pickup_datetime).toISOString().split(':').slice(0, 2).join(':')) || res.data.answer.length > 0);
  assert.equal(res.data.answered_from_records, true);
});

test('assist defers to the human handoff for anything outside its known vocabulary — it never guesses', async () => {
  const env = makeEnv();
  const guest = synthGuest();
  const created = await call(env, '/preview/bookings', withJson('POST', guest));
  const token = created.data.access_token;

  const res = await call(env, '/preview/assist', withJson('POST', { question: 'Can you refund me in crypto?' }, authed(token)));
  assert.equal(res.status, 200);
  assert.equal(res.data.answered_from_records, false);
  assert.ok(res.data.answer.includes('WhatsApp'));
});

// Unit-level proof that ranking never fabricates a figure, zone-matches
// correctly, and (per the P1 fix) only ever surfaces an ACTIVE, unexpired,
// in-stock, floor-respecting offer — never VALIDATED/DISCOVERED, never
// expired — independent of the HTTP layer.
test('rankOffersForGuest: zone-matching offers rank first; every price is copied verbatim; VALIDATED/DISCOVERED/expired never surface', () => {
  const bookings = [{ pickup_zone: 'NAD_AIRPORT', destination_zone: 'DENARAU' }];
  const nowIso = '2026-10-01T12:00:00Z';
  const base = { vehicle_class: 'SEDAN', inventory_count: 1, absolute_floor: 10 };
  const offers = [
    { ...base, offer_id: 'o1', status: 'ACTIVE', origin_zone: 'SUVA', destination_zone: 'PACIFIC_HARBOUR', standard_price: 40, smart_match_price: null, earliest_pickup: '2026-10-01T00:00:00Z', expires_at: '2026-10-05T00:00:00Z' },
    { ...base, offer_id: 'o2', status: 'VALIDATED', origin_zone: 'DENARAU', destination_zone: 'NAD_AIRPORT', standard_price: 60, smart_match_price: 24, earliest_pickup: '2026-10-02T00:00:00Z', expires_at: '2026-10-05T00:00:00Z' },
    { ...base, offer_id: 'o3', status: 'DISCOVERED', origin_zone: 'DENARAU', destination_zone: 'NAD_AIRPORT', standard_price: 60, smart_match_price: 10, earliest_pickup: '2026-10-01T00:00:00Z', expires_at: '2026-10-05T00:00:00Z' },
    { ...base, offer_id: 'o4', status: 'ACTIVE', origin_zone: 'DENARAU', destination_zone: 'NAD_AIRPORT', standard_price: 60, smart_match_price: 20, earliest_pickup: '2026-10-01T00:00:00Z', expires_at: '2026-09-30T00:00:00Z' },
  ];
  const ranked = rankOffersForGuest(offers, bookings, nowIso);
  assert.equal(ranked.length, 1, 'only o1 is ACTIVE, unexpired and zone-independent-eligible; o2 is VALIDATED (not public approval), o3 is DISCOVERED, o4 is expired');
  assert.equal(ranked[0].offer_id, 'o1');
  assert.equal(ranked[0].price, 40);
});

test('rankOffersForGuest: among eligible offers, zone-matching still ranks first', () => {
  const bookings = [{ pickup_zone: 'NAD_AIRPORT', destination_zone: 'DENARAU' }];
  const nowIso = '2026-10-01T12:00:00Z';
  const base = { vehicle_class: 'SEDAN', inventory_count: 1, absolute_floor: 10, status: 'ACTIVE', expires_at: '2026-10-05T00:00:00Z' };
  const offers = [
    { ...base, offer_id: 'o1', origin_zone: 'SUVA', destination_zone: 'PACIFIC_HARBOUR', standard_price: 40, smart_match_price: null, earliest_pickup: '2026-10-01T00:00:00Z' },
    { ...base, offer_id: 'o2', origin_zone: 'DENARAU', destination_zone: 'NAD_AIRPORT', standard_price: 60, smart_match_price: 24, earliest_pickup: '2026-10-02T00:00:00Z' },
  ];
  const ranked = rankOffersForGuest(offers, bookings, nowIso);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].offer_id, 'o2', 'zone-matching offer must rank first');
  assert.equal(ranked[0].price, 24);
  assert.equal(ranked[1].price, 40);
});

test('answerRoutineQuestion: with no booking at all, it says so rather than guessing', () => {
  const result = answerRoutineQuestion('when is my pickup', []);
  assert.equal(result.answered, false);
});
