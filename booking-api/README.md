# Booking API Phase 1

This directory contains the publication candidate for the authoritative, D1-backed Booking Service described by the Fiji AI Authority Foundation. It is implementation-only: it has not been deployed and does not grant staging or production authority.

## Scope and boundaries

Phase 1 stores externally-authorized fare quote snapshots and persists bookings, passengers, transfer legs, booking status history, idempotency results, and transactional outbox events. It does **not** calculate fares, take payments, dispatch vehicles, or send WhatsApp or other communications. The `communications` table is reserved for state owned by a future authorized Communication Service; this Worker does not write or send communications.

`POST /quotes` requires a `fare_authority_ref` and a `source_ref` for each line. Those references attest where amounts came from; this service does not become a Fare Service.

## Routes

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/quotes` | Persist an unexpired FJD fare snapshot supplied by an approved fare authority |
| `POST` | `/bookings` | Persist a booking from an active quote after explicit confirmation and consent |
| `GET` | `/bookings/:id` | Retrieve the persisted booking, passengers, legs, and status history |
| `POST` | `/bookings/:id/cancel` | Cancel an eligible nonterminal booking |
| `GET` | `/health` | Verify Worker-to-D1 connectivity |

All domain routes require `X-Actor-Id`, `X-Actor-Type`, and `X-Purpose`. Both mutation routes require `Idempotency-Key`. `X-Correlation-Id` is accepted or generated and returned. Authentication verification must be supplied by an approved upstream identity layer before any release; actor headers alone are not production authentication.

## Minimal request shapes

```json
POST /quotes
{
  "fare_authority_ref": "interim-fare:v1:calculation-123",
  "currency": "FJD",
  "expires_at": "2026-08-03T13:00:00.000Z",
  "traveler_ref": "traveler_123",
  "lines": [{
    "line_type": "TRANSFER",
    "description": "Nadi Airport transfer",
    "quantity": 1,
    "unit_amount_minor": 7500,
    "source_ref": "approved-rule-set:1"
  }]
}
```

```json
POST /bookings
{
  "quote_id": "quote-id",
  "traveler_ref": "traveler_123",
  "confirmed": true,
  "consent": { "granted": true, "ref": "consent-event-id" },
  "contact": { "name": "Traveler", "email": "traveler@example.test" },
  "passengers": [{ "passenger_type": "ADULT", "display_name": "Traveler" }],
  "transfer_legs": [{
    "origin_ref": "NAN",
    "destination_ref": "hotel-id",
    "service_at": "2026-08-04T02:00:00.000Z"
  }]
}
```

## Schema and atomicity

`migrations/0001_booking_api_phase1.sql` creates all nine Phase 1 tables and supporting indexes. D1 `batch()` is used so each quote or booking mutation, its state history, idempotency record, quote acceptance, and outbox event commit atomically. Foreign keys use `ON DELETE RESTRICT` so operational evidence is not silently removed.

Outbox publishing is deliberately absent. A future separately approved publisher may deliver unpublished records and set `published_at`; this phase only establishes durable event persistence.

## Local verification

```sh
cd booking-api
npm test
```

The test suite uses Node's built-in test runner and a deterministic in-memory repository. It covers quote creation and expiry, booking creation and retrieval, idempotency replay, cancellation, and outbox persistence.

## Release gates

Do not deploy this candidate or create Cloudflare resources from this repository change. Before staging, the owner must separately approve and record:

1. identity/authentication integration and actor authorization policy;
2. a real non-production D1 database and exact Wrangler binding;
3. migration apply and rollback/recovery rehearsal;
4. integration, negative authorization, privacy/redaction, and D1 concurrency tests;
5. monitoring, retention, incident ownership, and outbox consumer design; and
6. the exact reviewed commit and configuration.

Production remains prohibited without James's explicit, time-bound production authorization under the governance foundation.
