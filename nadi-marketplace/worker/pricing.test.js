// Fiji Dash — pricing regression + scenario suite (Recommendation 3).
//
// Step 1 of the server-authoritative pricing plan (see the approved plan
// for full context): this file is written FIRST, against TODAY's already-
// correct live behavior, before any refactor touches the pricing code -
// it's the safety net the rest of the plan gets built behind, not an
// afterthought added once the refactor is "done."
//
// Integration-style on purpose: calls the REAL live API
// (api.nadiairporttransfers.com), matching the verification discipline
// already used for every fix that shipped today - real HTTP calls, real
// numbers, not assumptions. Unit tests for the individual named pricing
// steps (Recommendation 2) land in a separate file once pricing.js exists.
//
// Deliberately side-effect-free: every test here either only reads
// (GET /reference-fare, POST /quote against an already-cached address) or
// exercises a REJECTION path that the backend confirms never reaches an
// INSERT (a below-floor POST /negotiate). No test creates a persistent
// booking/negotiation row, so this suite is safe to run repeatedly - as a
// pre-deploy check or by hand - with no cleanup step required and no risk
// of polluting the live database it's testing against.
//
// The "successfully accepted negotiation" path (a real POST /negotiate
// above the floor, resulting in a real negotiation_requests row) is
// intentionally NOT automated here - there's no separate test database and
// no admin-token-gated cleanup endpoint for this table yet, so automating
// it would mean either accepting live-DB test pollution on every run or
// building cleanup infrastructure this pass doesn't cover. That path stays
// manually verified the same way it already was today (real POST, real D1
// SELECT, real DELETE, baseline count re-confirmed - see commit bead14d).
//
// Run: node --test nadi-marketplace/worker/pricing.test.js
// Required before every backend deploy (see nadi-marketplace/README.md).

const test = require('node:test');
const assert = require('node:assert/strict');

const API_BASE = 'https://api.nadiairporttransfers.com';
const RETURN_MULTIPLIER = 1.85; // must match worker.js's own constant

async function getReferenceFare(pickupZone, destinationZone, vehicleType, tripType) {
  const url = `${API_BASE}/reference-fare?pickup_zone=${encodeURIComponent(pickupZone)}` +
    `&destination_zone=${encodeURIComponent(destinationZone)}&vehicle_type=${vehicleType}&trip_type=${tripType}`;
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
}

async function proposeNegotiation(overrides) {
  const res = await fetch(`${API_BASE}/negotiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      guest_name: 'Pricing Test Suite (no booking created - below floor)',
      guest_phone: '+61400000099',
      pickup_zone: 'Nadi Airport',
      destination_zone: 'Denarau',
      vehicle_type: 'minivan',
      trip_type: 'one-way',
      guest_proposed_amount_fjd: 1,
      ...overrides,
    }),
  });
  return { status: res.status, body: await res.json() };
}

// ─── B. Scenario tests (the 6 from the original pricing-safety review) ────

test('Scenario: one-way short — Nadi Airport <-> Denarau, minivan', async () => {
  const { status, body } = await getReferenceFare('Nadi Airport', 'Denarau', 'minivan', 'one-way');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.reference_fare_fjd, 69.08);
});

test('Scenario: one-way long — Nadi Airport <-> Nausori, sedan', async () => {
  const { status, body } = await getReferenceFare('Nadi Airport', 'Nausori', 'sedan', 'one-way');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.reference_fare_fjd, 357.35);
});

test('Scenario: return short — Nadi Airport <-> Denarau, minivan', async () => {
  const { status, body } = await getReferenceFare('Nadi Airport', 'Denarau', 'minivan', 'return');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.reference_fare_fjd, 127.8);
});

test('Scenario: return long — Nadi Airport <-> Natadola, minivan', async () => {
  // $155.13 (from earlier live testing this session) was the ONE-WAY fare
  // for this route, not return - caught by this test itself on first run.
  // Correct return value is exactly 155.13 x 1.85 = 286.99.
  const { status, body } = await getReferenceFare('Nadi Airport', 'Natadola', 'minivan', 'return');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.reference_fare_fjd, 286.99);
});

test('Scenario: negotiated Flexible Fare proposal below the real floor is rejected', async () => {
  // $90 for a return-trip Denarau minivan (correct floor is 80% of $127.80
  // = $102.24) - exactly the underpricing case found and fixed today.
  const { status, body } = await proposeNegotiation({
    trip_type: 'return',
    guest_proposed_amount_fjd: 90,
  });
  assert.equal(status, 400);
  assert.ok(body.errors[0].includes('102.24'), `expected floor 102.24 in error, got: ${body.errors[0]}`);
});

test('Scenario: custom address — "Natadola Beach, Fiji", sedan', async () => {
  const res = await fetch(`${API_BASE}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction: 'from_airport', address: 'Natadola Beach, Fiji', vehicle_type: 'sedan' }),
  });
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.outcome, 'resolved');
  assert.equal(body.quoted_fare_fjd, 117.43);
});

// ─── C. Historical-bug regressions — one per bug that has actually shipped ─

test('Regression (return-multiplier bug, fixed bead14d): return fare always equals one-way × 1.85', async () => {
  const oneWay = await getReferenceFare('Nadi Airport', 'Denarau', 'minivan', 'one-way');
  const ret = await getReferenceFare('Nadi Airport', 'Denarau', 'minivan', 'return');
  const expected = Math.round(oneWay.body.reference_fare_fjd * RETURN_MULTIPLIER * 100) / 100;
  assert.equal(ret.body.reference_fare_fjd, expected);
});

test('Regression (return-multiplier bug): trip_type is honoured — one-way and return must differ for the same route', async () => {
  const oneWay = await getReferenceFare('Nadi Airport', 'Natadola', 'sedan', 'one-way');
  const ret = await getReferenceFare('Nadi Airport', 'Natadola', 'sedan', 'return');
  // Before today's fix these were silently identical (both computed as
  // one-way) - this is the single assertion that would have caught it.
  assert.notEqual(ret.body.reference_fare_fjd, oneWay.body.reference_fare_fjd);
});

test('Regression (static $25 floor bug): negotiation floor is proportional to the real reference fare, not a fixed constant', async () => {
  // Two routes with very different real fares - if the floor were ever a
  // static number again (the original $25 bug), both would reject/accept
  // at the exact same amount regardless of route. Uses the rejection path
  // only, so this never creates a persistent negotiation_requests row.
  const cheap = await getReferenceFare('Nadi Airport', 'Denarau', 'minivan', 'one-way');
  const expensive = await getReferenceFare('Nadi Airport', 'Nausori', 'sedan', 'one-way');
  const cheapFloor = Math.round(cheap.body.reference_fare_fjd * 0.8 * 100) / 100;
  const expensiveFloor = Math.round(expensive.body.reference_fare_fjd * 0.8 * 100) / 100;
  assert.notEqual(cheapFloor, expensiveFloor, 'floors for very different routes must not coincide');

  const belowCheapFloor = await proposeNegotiation({
    destination_zone: 'Denarau', vehicle_type: 'minivan', trip_type: 'one-way',
    guest_proposed_amount_fjd: Math.floor(cheapFloor) - 1,
  });
  assert.equal(belowCheapFloor.status, 400);
  assert.ok(belowCheapFloor.body.errors[0].includes(String(cheapFloor)));
});

test('Regression (Total-vs-Standard-Fare drift bug): the reference fare quoted by /reference-fare matches what /negotiate computes for the identical route — no two implementations of the same number', async () => {
  const direct = await getReferenceFare('Nadi Airport', 'Denarau', 'minivan', 'return');
  // Proposing $1 always fails validation before any INSERT (guest_proposed_amount_fjd
  // must be > 0 and pass the floor check) - the error message still carries
  // the server's real computed reference fare for this route, letting this
  // assertion run with zero DB footprint.
  const viaNegotiate = await proposeNegotiation({
    destination_zone: 'Denarau', vehicle_type: 'minivan', trip_type: 'return',
    guest_proposed_amount_fjd: 1,
  });
  assert.equal(viaNegotiate.status, 400);
  assert.ok(
    viaNegotiate.body.errors[0].includes(String(direct.body.reference_fare_fjd)),
    `expected /negotiate's error to reference the same fare /reference-fare returned (${direct.body.reference_fare_fjd}), got: ${viaNegotiate.body.errors[0]}`
  );
});
