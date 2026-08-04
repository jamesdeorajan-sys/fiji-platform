import { ApiError, assert } from './errors.js';

const TERMINAL = new Set(['CANCELLED', 'COMPLETED']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requiredString(value, field, max = 200) {
  assert(typeof value === 'string' && value.trim(), 400, 'VALIDATION_ERROR', `${field} is required`);
  assert(value.length <= max, 400, 'VALIDATION_ERROR', `${field} is too long`);
  return value.trim();
}

function optionalString(value, field, max = 500) {
  if (value == null || value === '') return null;
  assert(typeof value === 'string' && value.length <= max, 400, 'VALIDATION_ERROR', `${field} is invalid`);
  return value.trim();
}

async function sha256(value) {
  const stable = (item) => {
    if (Array.isArray(item)) return item.map(stable);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, stable(item[key])]));
    }
    return item;
  };
  const data = new TextEncoder().encode(JSON.stringify(stable(value)));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class BookingService {
  constructor(repository, { now = () => new Date(), id = () => crypto.randomUUID() } = {}) {
    this.repository = repository;
    this.now = now;
    this.id = id;
  }

  async createQuote(input, context) {
    const key = requiredString(context.idempotencyKey, 'Idempotency-Key');
    const requestHash = await sha256(input);
    const replay = await this.#replay('POST:/quotes', key, requestHash);
    if (replay) return replay;
    const now = this.now();
    const expiresAt = new Date(requiredString(input.expires_at, 'expires_at'));
    assert(!Number.isNaN(expiresAt.valueOf()) && expiresAt > now, 400, 'INVALID_EXPIRY', 'expires_at must be in the future');
    assert(input.currency === 'FJD', 400, 'INVALID_CURRENCY', 'Phase 1 quotes must use FJD');
    assert(Array.isArray(input.lines) && input.lines.length > 0, 400, 'VALIDATION_ERROR', 'lines are required');

    const lines = input.lines.map((line, position) => {
      assert(Number.isSafeInteger(line.quantity) && line.quantity > 0, 400, 'VALIDATION_ERROR', 'line quantity must be a positive integer');
      assert(Number.isSafeInteger(line.unit_amount_minor), 400, 'VALIDATION_ERROR', 'line unit_amount_minor must be an integer');
      return {
        id: this.id(), line_type: requiredString(line.line_type, 'line_type', 50),
        description: requiredString(line.description, 'description'), quantity: line.quantity,
        unit_amount_minor: line.unit_amount_minor,
        total_amount_minor: line.quantity * line.unit_amount_minor,
        source_ref: requiredString(line.source_ref, 'source_ref'), position,
      };
    });
    const total = lines.reduce((sum, line) => sum + line.total_amount_minor, 0);
    assert(Number.isSafeInteger(total) && total >= 0, 400, 'INVALID_TOTAL', 'quote total must be a non-negative safe integer');
    const quote = {
      id: this.id(), fare_authority_ref: requiredString(input.fare_authority_ref, 'fare_authority_ref'),
      currency: 'FJD', subtotal_minor: total, total_minor: total, status: 'ACTIVE',
      expires_at: expiresAt.toISOString(), traveler_ref: optionalString(input.traveler_ref, 'traveler_ref'),
      created_by: context.actorId, created_at: now.toISOString(),
    };
    const outbox = this.#event('FareQuote', quote.id, 'fare_quote.created', { quote_id: quote.id }, context, now);
    const response = { ...quote, lines };
    const idempotency = this.#idempotency('POST:/quotes', key, requestHash, 201, response, 'FareQuote', quote.id, now);
    return this.repository.createQuote({ quote, lines, outbox, idempotency });
  }

  async createBooking(input, context) {
    const key = requiredString(context.idempotencyKey, 'Idempotency-Key');
    const requestHash = await sha256(input);
    const existing = await this.#replay(`POST:/bookings`, key, requestHash);
    if (existing) return existing;

    const quoteId = requiredString(input.quote_id, 'quote_id');
    let quote = await this.repository.getQuote(quoteId);
    assert(quote, 404, 'QUOTE_NOT_FOUND', 'Quote not found');
    const now = this.now();
    if (quote.status === 'ACTIVE' && new Date(quote.expires_at) <= now) {
      await this.repository.expireQuote(quote.id, now.toISOString());
      quote = { ...quote, status: 'EXPIRED' };
    }
    assert(quote.status === 'ACTIVE', 409, 'QUOTE_NOT_ACTIVE', `Quote is ${quote.status}`);
    assert(input.confirmed === true, 400, 'CONFIRMATION_REQUIRED', 'Explicit booking confirmation is required');
    assert(typeof input.consent === 'object' && input.consent.granted === true, 400, 'CONSENT_REQUIRED', 'Booking consent is required');
    const passengersInput = input.passengers;
    assert(Array.isArray(passengersInput) && passengersInput.length > 0, 400, 'VALIDATION_ERROR', 'passengers are required');
    assert(Array.isArray(input.transfer_legs) && input.transfer_legs.length > 0, 400, 'VALIDATION_ERROR', 'transfer_legs are required');

    const booking = {
      id: this.id(), quote_id: quote.id, status: 'BOOKING_CREATED',
      traveler_ref: requiredString(input.traveler_ref, 'traveler_ref'),
      contact_name: requiredString(input.contact?.name, 'contact.name'),
      contact_email: optionalString(input.contact?.email, 'contact.email'),
      contact_phone: optionalString(input.contact?.phone, 'contact.phone', 50),
      consent_ref: requiredString(input.consent.ref, 'consent.ref'), created_by: context.actorId,
      created_at: now.toISOString(), updated_at: now.toISOString(),
    };
    assert(!booking.contact_email || EMAIL.test(booking.contact_email), 400, 'VALIDATION_ERROR', 'contact.email is invalid');
    assert(booking.contact_email || booking.contact_phone, 400, 'VALIDATION_ERROR', 'A contact email or phone is required');
    const passengers = passengersInput.map((p, position) => {
      assert(['ADULT', 'CHILD', 'INFANT'].includes(p.passenger_type), 400, 'VALIDATION_ERROR', 'Invalid passenger_type');
      return { id: this.id(), passenger_type: p.passenger_type, display_name: optionalString(p.display_name, 'display_name'), accessibility_notes: optionalString(p.accessibility_notes, 'accessibility_notes'), position };
    });
    const legs = input.transfer_legs.map((leg, position) => {
      const serviceAt = new Date(requiredString(leg.service_at, 'service_at'));
      assert(!Number.isNaN(serviceAt.valueOf()), 400, 'VALIDATION_ERROR', 'service_at is invalid');
      return { id: this.id(), origin_ref: requiredString(leg.origin_ref, 'origin_ref'), destination_ref: requiredString(leg.destination_ref, 'destination_ref'), service_at: serviceAt.toISOString(), flight_number: optionalString(leg.flight_number, 'flight_number', 50), notes: optionalString(leg.notes, 'notes'), position };
    });
    const history = this.#history(booking.id, null, booking.status, 'Booking created', context, now);
    const outbox = this.#event('Booking', booking.id, 'booking.created', { booking_id: booking.id, quote_id: quote.id, status: booking.status }, context, now);
    const response = { ...booking, passengers, transfer_legs: legs, status_history: [history] };
    const idempotency = this.#idempotency('POST:/bookings', key, requestHash, 201, response, 'Booking', booking.id, now);
    return this.repository.createBooking({ booking, passengers, legs, history, outbox, idempotency });
  }

  async getBooking(id) {
    const booking = await this.repository.getBooking(requiredString(id, 'booking id'));
    assert(booking, 404, 'BOOKING_NOT_FOUND', 'Booking not found');
    return booking;
  }

  async cancelBooking(id, input, context) {
    const key = requiredString(context.idempotencyKey, 'Idempotency-Key');
    const requestHash = await sha256(input);
    const scope = `POST:/bookings/${id}/cancel`;
    const replay = await this.#replay(scope, key, requestHash);
    if (replay) return replay;
    const booking = await this.getBooking(id);
    assert(!TERMINAL.has(booking.status), 409, 'BOOKING_NOT_CANCELLABLE', `Booking is ${booking.status}`);
    const now = this.now();
    const reason = requiredString(input.reason, 'reason', 500);
    const history = this.#history(id, booking.status, 'CANCELLED', reason, context, now);
    const response = { ...booking, status: 'CANCELLED', cancellation_reason: reason, cancelled_at: now.toISOString(), updated_at: now.toISOString(), status_history: [...(booking.status_history || []), history] };
    const outbox = this.#event('Booking', id, 'booking.cancelled', { booking_id: id, from_status: booking.status, status: 'CANCELLED', reason }, context, now);
    const idempotency = this.#idempotency(scope, key, requestHash, 200, response, 'Booking', id, now);
    return this.repository.cancelBooking({ bookingId: id, reason, cancelledAt: now.toISOString(), history, outbox, idempotency });
  }

  async #replay(scope, key, requestHash) {
    const stored = await this.repository.getIdempotency(scope, key);
    if (!stored) return null;
    if (stored.request_hash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was used with a different request');
    return stored.response_body;
  }

  #history(bookingId, from, to, reason, context, now) {
    return { id: this.id(), booking_id: bookingId, from_status: from, to_status: to, reason, actor_id: context.actorId, correlation_id: context.correlationId, created_at: now.toISOString() };
  }

  #event(type, id, eventType, payload, context, now) {
    return { id: this.id(), aggregate_type: type, aggregate_id: id, event_type: eventType, schema_version: 1, payload, correlation_id: context.correlationId, created_at: now.toISOString() };
  }

  #idempotency(scope, key, hash, status, response, type, id, now) {
    return { scope, idempotency_key: key, request_hash: hash, response_status: status, response_body: JSON.stringify(response), resource_type: type, resource_id: id, created_at: now.toISOString(), expires_at: new Date(now.valueOf() + 24 * 60 * 60 * 1000).toISOString() };
  }
}
