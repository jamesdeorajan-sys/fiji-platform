# Sprint 13 — price correctness and audit remediation

The new pure quote contract supports FJD per-person, group and vehicle pricing with unit capacities and transparent fees. Eight unit tests cover these cases. It is not yet wired to the D1 booking ledger, so production must remain blocked.

## Critical integration design
1. Migrate slot records to include price_basis, max_guests_per_unit, and an operator-approved immutable quote/version. For group and vehicle bookings, reserve capacity by units, while enforcing guest limits. Do not treat guest count as reserved units.
2. Compute the quote on the server from authoritative operator-approved pricing. Persist guest_count, unit_count, price_basis, subtotal, fees, total and quote version; never trust a client total.
3. Existing 0001 ledger price_fjd_cents * quantity is only correct for person-priced slots when quantity=guests. Do not use it for group/vehicle pricing until migration and adapter are updated and tested.
4. Transition audit must capture actor_id, actor_role and verified operator membership. Current 0002 trigger uses 'system_transition' and is insufficient. Build an atomic actor-attributed transition with a constrained audit mechanism and ensure failed writes roll back.
5. Validate SQLite/D1 migrations and last-seat concurrency; ensure cancellation and completion do not double-release inventory.
6. Test all booking actions through authenticated, tenant-scoped APIs before staging.
7. No production deploy or migration without CEO approval.
