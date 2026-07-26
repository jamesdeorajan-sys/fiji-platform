# Migrations

Numbered migrations are immutable and forward-only. Never edit an applied migration; add the next numbered file. D1/SQLite is the canonical transactional schema. Acceptance assigns a booking only with a conditional update (`... WHERE assigned_driver_id IS NULL`) in the same transaction that accepts an active offer.
