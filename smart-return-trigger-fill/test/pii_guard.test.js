import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMovementInput, ValidationError } from '../src/model.js';

const basePayload = () => ({
  booking_reference: 'PII-0001',
  source_site: 'nadiairporttransfers.com',
  origin: 'Nadi Airport', pickup_zone: 'NAD_AIRPORT',
  destination: 'Denarau', dropoff_zone: 'DENARAU',
  pickup_datetime: '2026-10-05T09:00:00Z',
  arrival_or_departure: 'arrival',
  passenger_count: 2, vehicle_class: 'SEDAN',
  customer_price: 45,
  test_data: true,
});

const deniedFields = [
  ['customer_name', 'Jane Doe'],
  ['name', 'Jane Doe'],
  ['first_name', 'Jane'],
  ['last_name', 'Doe'],
  ['customer_email', 'jane@example.com'],
  ['email', 'jane@example.com'],
  ['customer_phone', '+6791234567'],
  ['phone', '+6791234567'],
  ['phone_number', '+6791234567'],
  ['mobile', '+6791234567'],
  ['whatsapp_number', '+6791234567'],
  ['whatsapp', '+6791234567'],
];

for (const [field, value] of deniedFields) {
  test(`ingestion rejects a payload carrying direct PII field '${field}'`, () => {
    const payload = { ...basePayload(), [field]: value };
    assert.throws(() => normalizeMovementInput(payload), ValidationError);
  });
}

test('booking_contact_ref is accepted when it is a plain opaque token', () => {
  const movement = normalizeMovementInput({ ...basePayload(), booking_contact_ref: 'ftt-cust-ref-8827' });
  assert.equal(movement.booking_contact_ref, 'ftt-cust-ref-8827');
});

test('booking_contact_ref is rejected if it looks like an email address', () => {
  const payload = { ...basePayload(), booking_contact_ref: 'jane@example.com' };
  assert.throws(() => normalizeMovementInput(payload), ValidationError);
});

test('booking_contact_ref is rejected if it looks like a phone number', () => {
  const payload = { ...basePayload(), booking_contact_ref: '+679 123 4567' };
  assert.throws(() => normalizeMovementInput(payload), ValidationError);
});

test('booking_contact_ref defaults to null when omitted — not required', () => {
  const movement = normalizeMovementInput(basePayload());
  assert.equal(movement.booking_contact_ref, null);
});

test('a normalized movement never carries any PII-shaped key at all', () => {
  const movement = normalizeMovementInput({ ...basePayload(), booking_contact_ref: 'ref-1' });
  const suspicious = ['name', 'email', 'phone', 'whatsapp'];
  for (const key of Object.keys(movement)) {
    for (const bad of suspicious) {
      assert.ok(!key.toLowerCase().includes(bad), `unexpected PII-shaped key on movement: ${key}`);
    }
  }
});
