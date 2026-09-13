-- Issue #54 Stage 1 (SHADOW MODE) — CEO fix 2026-09-13.
-- Opaque pointer back to the originating storefront's own secure
-- booking/customer record. Never a name, phone number, email address, or
-- WhatsApp number — src/model.js#normalizeMovementInput rejects ingestion
-- outright if any of those field names are present, and rejects this
-- column's value if it looks like an email or phone number.

ALTER TABLE movements ADD COLUMN booking_contact_ref TEXT;
