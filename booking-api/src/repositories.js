function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

export class D1BookingRepository {
  constructor(db) {
    this.db = db;
  }

  async createQuote({ quote, lines, outbox, idempotency }) {
    const statements = [
      this.db.prepare(`INSERT INTO fare_quotes
        (id, fare_authority_ref, currency, subtotal_minor, total_minor, status,
         expires_at, traveler_ref, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        quote.id, quote.fare_authority_ref, quote.currency, quote.subtotal_minor,
        quote.total_minor, quote.status, quote.expires_at, quote.traveler_ref,
        quote.created_by, quote.created_at
      ),
      ...lines.map((line) => this.db.prepare(`INSERT INTO fare_quote_lines
        (id, quote_id, line_type, description, quantity, unit_amount_minor,
         total_amount_minor, source_ref, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        line.id, quote.id, line.line_type, line.description, line.quantity,
        line.unit_amount_minor, line.total_amount_minor, line.source_ref, line.position
      )),
      this.#outboxStatement(outbox),
      this.#idempotencyStatement(idempotency),
    ];
    await this.db.batch(statements);
    return { ...quote, lines };
  }

  async getQuote(id) {
    const quote = await this.db.prepare('SELECT * FROM fare_quotes WHERE id = ?').bind(id).first();
    if (!quote) return null;
    const { results } = await this.db.prepare(
      'SELECT * FROM fare_quote_lines WHERE quote_id = ? ORDER BY position'
    ).bind(id).all();
    return { ...quote, lines: results };
  }

  async expireQuote(id, expiredAt) {
    await this.db.prepare(`UPDATE fare_quotes SET status = 'EXPIRED'
      WHERE id = ? AND status = 'ACTIVE' AND expires_at <= ?`).bind(id, expiredAt).run();
  }

  async createBooking({ booking, passengers, legs, history, outbox, idempotency }) {
    const statements = [
      this.db.prepare(`INSERT INTO bookings
        (id, quote_id, status, traveler_ref, contact_name, contact_email, contact_phone,
         consent_ref, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        booking.id, booking.quote_id, booking.status, booking.traveler_ref,
        booking.contact_name, booking.contact_email, booking.contact_phone,
        booking.consent_ref, booking.created_by, booking.created_at, booking.updated_at
      ),
      ...passengers.map((p) => this.db.prepare(`INSERT INTO booking_passengers
        (id, booking_id, passenger_type, display_name, accessibility_notes, position)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(
        p.id, booking.id, p.passenger_type, p.display_name, p.accessibility_notes, p.position
      )),
      ...legs.map((leg) => this.db.prepare(`INSERT INTO transfer_legs
        (id, booking_id, origin_ref, destination_ref, service_at, flight_number, notes, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        leg.id, booking.id, leg.origin_ref, leg.destination_ref, leg.service_at,
        leg.flight_number, leg.notes, leg.position
      )),
      this.#historyStatement(history),
      this.#outboxStatement(outbox),
      this.#idempotencyStatement(idempotency),
      this.db.prepare(`UPDATE fare_quotes SET status = 'ACCEPTED', accepted_at = ?
        WHERE id = ? AND status = 'ACTIVE'`).bind(booking.created_at, booking.quote_id),
    ];
    await this.db.batch(statements);
    return { ...booking, passengers, transfer_legs: legs, status_history: [history] };
  }

  async getBooking(id) {
    const booking = await this.db.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
    if (!booking) return null;
    const [passengers, legs, history] = await Promise.all([
      this.db.prepare('SELECT * FROM booking_passengers WHERE booking_id = ? ORDER BY position').bind(id).all(),
      this.db.prepare('SELECT * FROM transfer_legs WHERE booking_id = ? ORDER BY position').bind(id).all(),
      this.db.prepare('SELECT * FROM booking_status_history WHERE booking_id = ? ORDER BY created_at').bind(id).all(),
    ]);
    return { ...booking, passengers: passengers.results, transfer_legs: legs.results, status_history: history.results };
  }

  async cancelBooking({ bookingId, reason, cancelledAt, history, outbox, idempotency }) {
    const response = JSON.parse(idempotency.response_body);
    await this.db.batch([
      this.db.prepare(`UPDATE bookings SET status = 'CANCELLED', cancelled_at = ?,
        cancellation_reason = ?, updated_at = ? WHERE id = ? AND status NOT IN ('CANCELLED', 'COMPLETED')`)
        .bind(cancelledAt, reason, cancelledAt, bookingId),
      this.#historyStatement(history),
      this.#outboxStatement(outbox),
      this.#idempotencyStatement(idempotency),
    ]);
    return response;
  }

  async getIdempotency(scope, key) {
    const row = await this.db.prepare(
      'SELECT * FROM idempotency_keys WHERE scope = ? AND idempotency_key = ?'
    ).bind(scope, key).first();
    return row ? { ...row, response_body: parseJson(row.response_body) } : null;
  }

  async health() {
    const row = await this.db.prepare('SELECT 1 AS ok').first();
    return row?.ok === 1;
  }

  #historyStatement(value) {
    return this.db.prepare(`INSERT INTO booking_status_history
      (id, booking_id, from_status, to_status, reason, actor_id, correlation_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      value.id, value.booking_id, value.from_status, value.to_status, value.reason,
      value.actor_id, value.correlation_id, value.created_at
    );
  }

  #outboxStatement(value) {
    return this.db.prepare(`INSERT INTO outbox_events
      (id, aggregate_type, aggregate_id, event_type, schema_version, payload,
       correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      value.id, value.aggregate_type, value.aggregate_id, value.event_type,
      value.schema_version, JSON.stringify(value.payload), value.correlation_id, value.created_at
    );
  }

  #idempotencyStatement(value) {
    return this.db.prepare(`INSERT INTO idempotency_keys
      (scope, idempotency_key, request_hash, response_status, response_body,
       resource_type, resource_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      value.scope, value.idempotency_key, value.request_hash, value.response_status,
      value.response_body, value.resource_type, value.resource_id, value.created_at, value.expires_at
    );
  }
}
