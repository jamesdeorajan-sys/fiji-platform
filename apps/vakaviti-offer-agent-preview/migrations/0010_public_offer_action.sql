-- Phase 7A (CEO directive 2026-08-29): the booking-action model's own fields. Additive only -
-- deal_exchange_offers.booking_route (from the original canonical schema) is left in place
-- unchanged for audit/back-compat; these three new columns are what public-offer-action.ts and the
-- new /enquire flow actually read and write going forward.
ALTER TABLE deal_exchange_offers ADD COLUMN public_action_type TEXT
  CHECK (public_action_type IS NULL OR public_action_type IN ('VAKAVITI_ENQUIRY','PROVIDER_DIRECT','NOT_ACTIONABLE'));
ALTER TABLE deal_exchange_offers ADD COLUMN vakaviti_enquiry_route TEXT;
ALTER TABLE deal_exchange_offers ADD COLUMN provider_booking_route TEXT;

-- The internal Vakaviti enquiry funnel for discovered third-party offers - deliberately separate
-- from Stage 1's `enquiries` and from `deal_exchange_enquiries` (both already-established, already-
-- write-authoritative systems per the Phase A-R lead-consolidation decision NOT to add a fourth
-- pipeline there). This one is new because it serves a genuinely new product surface (Vakaviti
-- acting as the enquiry intermediary for offers Vakaviti did not create and has no existing
-- relationship-specific enquiry table for) - it is isolated-preview-only infrastructure, not a
-- change to any existing production pipeline.
CREATE TABLE IF NOT EXISTS vakaviti_enquiries (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES deal_exchange_offers(id),
  provider_name TEXT,
  seller_name TEXT,
  price_copy TEXT,
  source_url TEXT NOT NULL,
  visitor_name TEXT,
  visitor_contact TEXT,
  consent_given_at TEXT,
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','WHATSAPP_OPENED')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vakaviti_enquiries_offer ON vakaviti_enquiries (offer_id);
