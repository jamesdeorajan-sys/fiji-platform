import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BookingService } from '../src/service.js';

class MemoryRepository {
  constructor() {
    this.quotes = new Map();
    this.bookings = new Map();
    this.keys = new Map();
    this.outbox = [];
  }

  async createQuote({ quote, lines, outbox, idempotency }) {
    const value = { ...quote, lines };
    this.quotes.set(quote.id, value);
    this.outbox.push(outbox);
    this.keys.set(`${idempotency.scope}:${idempotency.idempotency_key}`, { ...idempotency, response_body: JSON.parse(idempotency.response_body) });
    return value;
  }

  async getQuote(id) { return this.quotes.get(id) || null; }

  async expireQuote(id) {
    this.quotes.get(id).status = 'EXPIRED';
  }

  async createBooking({ booking, passengers, legs, history, outbox, idempotency }) {
    const value = { ...booking, passengers, transfer_legs: legs, status_history: [history] };
    this.bookings.set(booking.id, value);
    this.quotes.get(booking.quote_id).status = 'ACCEPTED';
    this.outbox.push(outbox);
    this.keys.set(`${idempotency.scope}:${idempotency.idempotency_key}`, { ...idempotency, response_body: JSON.parse(idempotency.response_body) });
    return value;
  }

  async getBooking(id) { return this.bookings.get(id) || null; }

  async cancelBooking({ bookingId, reason, cancelledAt, history, outbox, idempotency }) {
    const current = this.bookings.get(bookingId);
    const value = { ...current, status: 'CANCELLED', cancellation_reason: reason, cancelled_at: cancelledAt, updated_at: cancelledAt, status_history: [...current.status_history, history] };
    this.bookings.set(bookingId, value);
    this.outbox.push(outbox);
    this.keys.set(`${idempotency.scope}:${idempotency.idempotency_key}`, { ...idempotency, response_body: JSON.parse(idempotency.response_body) });
    return value;
  }

  async getIdempotency(scope, key) { return this.keys.get(`${scope}:${key}`) || null; }
}

const clock = new Date('2026-08-03T12:00:00.000Z');
let quoteKeySequence = 0;
const context = (key = `quote-key-${++quoteKeySequence}`) => ({ actorId: 'actor_test', actorType: 'operator', purpose: 'booking', correlationId: 'corr_test', idempotencyKey: key });

function harness() {
  let sequence = 0;
  const repository = new MemoryRepository();
  const service = new BookingService(repository, { now: () => new Date(clock), id: () => `id_${++sequence}` });
  return { repository, service };
}

function quoteInput(overrides = {}) {
  return {
    fare_authority_ref: 'interim-fare:v1:calc-123', currency: 'FJD',
    expires_at: '2026-08-03T13:00:00.000Z', traveler_ref: 'traveler_1',
    lines: [{ line_type: 'TRANSFER', description: 'Nadi transfer', quantity: 1, unit_amount_minor: 7500, source_ref: 'fare-rule-1' }],
    ...overrides,
  };
}

function bookingInput(quoteId) {
  return {
    quote_id: quoteId, traveler_ref: 'traveler_1', confirmed: true,
    consent: { granted: true, ref: 'consent_1' },
    contact: { name: 'Test Traveler', email: 'traveler@example.test' },
    passengers: [{ passenger_type: 'ADULT', display_name: 'Test Traveler' }],
    transfer_legs: [{ origin_ref: 'NAN', destination_ref: 'hotel_1', service_at: '2026-08-04T02:00:00.000Z' }],
  };
}

async function createBooking(service, key = 'booking-key') {
  const quote = await service.createQuote(quoteInput(), context());
  return service.createBooking(bookingInput(quote.id), context(key));
}

describe('Booking API Phase 1 service', () => {
  test('quote creation persists an externally sourced FJD quote snapshot', async () => {
    const { service } = harness();
    const quote = await service.createQuote(quoteInput(), context());
    assert.equal(quote.status, 'ACTIVE');
    assert.equal(quote.total_minor, 7500);
    assert.equal(quote.lines[0].source_ref, 'fare-rule-1');
  });

  test('quote expiry blocks booking creation and records EXPIRED', async () => {
    const { service, repository } = harness();
    const quote = await service.createQuote(quoteInput({ expires_at: '2026-08-03T12:00:00.001Z' }), context());
    service.now = () => new Date('2026-08-03T12:00:01.000Z');
    await assert.rejects(service.createBooking(bookingInput(quote.id), context('expired-key')), { code: 'QUOTE_NOT_ACTIVE', status: 409 });
    assert.equal(repository.quotes.get(quote.id).status, 'EXPIRED');
  });

  test('booking creation persists passengers, legs, and initial status history', async () => {
    const { service } = harness();
    const booking = await createBooking(service);
    assert.equal(booking.status, 'BOOKING_CREATED');
    assert.equal(booking.passengers.length, 1);
    assert.equal(booking.transfer_legs.length, 1);
    assert.equal(booking.status_history[0].to_status, 'BOOKING_CREATED');
  });

  test('idempotency replay returns the original booking without a second write', async () => {
    const { service, repository } = harness();
    const quote = await service.createQuote(quoteInput(), context());
    const input = bookingInput(quote.id);
    const first = await service.createBooking(input, context('same-key'));
    const replay = await service.createBooking(input, context('same-key'));
    assert.equal(replay.id, first.id);
    assert.equal(repository.bookings.size, 1);
  });

  test('booking retrieval returns persisted booking details', async () => {
    const { service } = harness();
    const created = await createBooking(service);
    const retrieved = await service.getBooking(created.id);
    assert.deepEqual(retrieved, created);
  });

  test('cancellation transitions an eligible booking and records history', async () => {
    const { service } = harness();
    const booking = await createBooking(service);
    const cancelled = await service.cancelBooking(booking.id, { reason: 'Traveler requested cancellation' }, context('cancel-key'));
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.status_history.at(-1).from_status, 'BOOKING_CREATED');
    assert.equal(cancelled.status_history.at(-1).to_status, 'CANCELLED');
  });

  test('quote, booking, and cancellation write durable outbox records', async () => {
    const { service, repository } = harness();
    const booking = await createBooking(service);
    await service.cancelBooking(booking.id, { reason: 'Plans changed' }, context('cancel-outbox-key'));
    assert.deepEqual(repository.outbox.map((event) => event.event_type), ['fare_quote.created', 'booking.created', 'booking.cancelled']);
    assert.ok(repository.outbox.every((event) => event.correlation_id === 'corr_test'));
  });
});
