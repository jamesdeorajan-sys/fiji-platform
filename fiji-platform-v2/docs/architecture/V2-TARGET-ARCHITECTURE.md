# V2 Target Architecture

`Applications → API → Guest / Destination / Fare / Booking → Dispatch / Driver / Wallet → Messaging → Analytics/Event layer`

Applications never own domain truth. The API authenticates, validates, and delegates. Guest owns persistent traveler identity; Destination owns place and zone identity; Fare owns pricing versions and immutable quotes; Booking owns the canonical booking state and state events. Dispatch owns offer lifecycle while Booking alone records the assigned driver through atomic conditional acceptance. Driver owns eligibility inputs, vehicles, sessions, and private-document metadata. Wallet owns its append-only ledger; balances are derived/reconciled from transactions. Messaging owns templates and delivery evidence and cannot implicitly change a booking. Audit events record accountable changes; platform events feed analytics without becoming transactional truth.

Dependencies point toward shared types and stable upstream identities. Engines expose contracts, not UI, storage, or provider implementation. D1 is the canonical transactional store; private driver files will live in a V2-only private object store.
