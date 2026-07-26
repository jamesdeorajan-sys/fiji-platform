# Initial Domain Model

## Guest

`guests` provides persistent identity. Normalized `guest_contacts` are unique by kind/value so duplicates can later be detected or merged without treating a booking as identity. Guests own stays (at destinations), preferences, interests, and append-only behavioral events.

## Destination and fare

Zones group destinations; destination slugs are globally unique. Immutable, activated pricing versions own rules between zones. A quote links origin/destination and its exact pricing version, currency, expiry, original standard fare, and optional flexible fare. Components explain the result; flexible pricing is additional data and never overwrites standard fare.

## Booking, driver, and dispatch

A booking belongs to one guest and optionally its originating quote, and has one canonical state. Every transition is recorded in `booking_events`; messages are not state. Drivers own vehicles, zones, private-document metadata, work sessions, and status events. Dispatch offers connect a booking and driver with an explicit lifecycle. One accepted offer per booking is enforced, and acceptance must conditionally assign only an unassigned booking atomically.

## Wallet and messaging

A driver wallet is unique per currency. Every balance change is a non-zero append-only transaction with a globally unique idempotency key; balance and commission can be reconciled by summing history. Templates are separate from deliveries. Provider approval and verified delivery are explicit; defined, approved, delivered, and production-ready are not synonyms. Messaging cannot mutate booking truth implicitly.

## Platform

Audit events capture actor/action and before/after evidence. Platform events form an analytics/integration stream, not transactional truth. IDs and timestamps are application-generated strings; money is always integer minor units with a three-letter uppercase currency.

Generic businesses, services, and leads are intentionally excluded from the Phase 0 core. A future marketplace may add partner entities only behind a justified domain boundary.
