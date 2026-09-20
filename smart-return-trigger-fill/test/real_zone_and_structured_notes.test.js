import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapConfirmedBookingToMovementInput } from '../src/production_adapter.js';
import { deriveStructuredPaxLuggage } from '../src/notes_structured_fields.js';

const SECRET = crypto.getRandomValues(new Uint8Array(32));
const booking = (o = {}) => ({ id: 1, status: 'accepted', assigned_driver_id: 7, pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan', quoted_amount: 49, pickup_date: '2026-10-05', pickup_time: '09:30', created_at: '2026-09-25T00:00:00Z', ...o });
const ev = { booking_id: 1, event_type: 'accepted', new_status: 'accepted', actor: 'admin' };

test('the real zone name "Nadi Airport" is recognised as an airport (arrival), not skipped', async () => {
  const r = await mapConfirmedBookingToMovementInput(booking(), ev, { sourceSite: 'nadiairporttransfers.com', passengerCount: 2, shadowSecret: SECRET });
  assert.equal(r.ok, true);
  assert.equal(r.movementInput.arrival_or_departure, 'arrival');
});

test('a real departure ("Denarau" -> "Nadi Airport") is recognised as a departure', async () => {
  const r = await mapConfirmedBookingToMovementInput(booking({ pickup_zone: 'Denarau', destination_zone: 'Nadi Airport' }), ev, { sourceSite: 'nadiairporttransfers.com', passengerCount: 2, shadowSecret: SECRET });
  assert.equal(r.movementInput.arrival_or_departure, 'departure');
});

test('two non-airport real zones are still CANNOT_DETERMINE (never guessed)', async () => {
  const r = await mapConfirmedBookingToMovementInput(booking({ pickup_zone: 'Denarau', destination_zone: 'Coral Coast' }), ev, { sourceSite: 'nadiairporttransfers.com', passengerCount: 2, shadowSecret: SECRET });
  assert.equal(r.reason, 'CANNOT_DETERMINE_ARRIVAL_OR_DEPARTURE');
});

test('structured widget notes yield only two bounded integers', () => {
  assert.deepEqual(deriveStructuredPaxLuggage('Passengers: 3 | Luggage: 2 | Guest notes: call me on 0412 345 678'), { passengers: 3, luggage: 2 });
  assert.deepEqual(deriveStructuredPaxLuggage('Passengers: 3\nLuggage: 0\nGuest notes: x'), { passengers: 3, luggage: 0 });
});

test('anything else yields null, never a default: missing tokens, out-of-range, embedded in free text, non-string', () => {
  assert.deepEqual(deriveStructuredPaxLuggage('Staying at Hilton'), { passengers: null, luggage: null });
  assert.deepEqual(deriveStructuredPaxLuggage('Passengers: 0 | Luggage: 99'), { passengers: null, luggage: null });
  assert.deepEqual(deriveStructuredPaxLuggage('my friend said Passengers: 4 are coming'), { passengers: null, luggage: null });
  assert.deepEqual(deriveStructuredPaxLuggage(null), { passengers: null, luggage: null });
});

test('the extractor never returns any of the text', () => {
  const out = deriveStructuredPaxLuggage('Passengers: 2 | Luggage: 1 | Guest notes: secret@example.com');
  assert.deepEqual(Object.keys(out).sort(), ['luggage', 'passengers']);
  assert.doesNotMatch(JSON.stringify(out), /secret|example/);
});
