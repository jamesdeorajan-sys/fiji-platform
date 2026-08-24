-- VAKAVITI LIVE DEAL EXCHANGE - Milestone 3: mobile journey support tables (2026-08-24).
-- Additive only. Attribution and enquiry-review tables are append-only (same discipline as
-- deal_exchange_evidence/offer_history in 0001).

-- Owned-inventory classification (Fiji Tour Transfers / Nadi Airport Transfers) - read-only
-- inspection results, never a live scrape cache. "Do not call ordinary products deals" - this
-- table is deliberately separate from deal_exchange_offers so an ordinary bookable product can
-- never be counted toward the Live Deals total by construction.
CREATE TABLE IF NOT EXISTS deal_exchange_owned_products (
  id TEXT PRIMARY KEY,
  source_system TEXT NOT NULL CHECK (source_system IN ('fiji_tour_transfers', 'nadi_airport_transfers')),
  product_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('tour', 'transfer')),
  price_amount TEXT,
  currency TEXT,
  price_basis TEXT,
  classification TEXT NOT NULL CHECK (classification IN (
    'ORDINARY_BOOKABLE', 'GENUINE_CURRENT_SPECIAL', 'INCOMPLETE_CONTRADICTORY', 'EXCLUDED_QUARANTINED'
  )),
  classification_reason TEXT NOT NULL,
  region TEXT,
  booking_route TEXT,
  checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_deal_exchange_owned_products_classification ON deal_exchange_owned_products (classification);

-- Attribution - append-only. Written BEFORE the 302 fires, per the CEO's explicit "record the
-- click before a 302 redirect" instruction.
CREATE TABLE IF NOT EXISTS deal_exchange_outbound_clicks (
  id TEXT PRIMARY KEY,
  source_site TEXT NOT NULL,
  source_page TEXT NOT NULL,
  campaign TEXT,
  query_ref TEXT,
  provider_id TEXT,
  product_id TEXT,
  deal_id TEXT,
  seller_id TEXT,
  enquiry_id TEXT,
  fulfilment_route TEXT NOT NULL,
  outbound_destination TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_deal_exchange_outbound_clicks_deal ON deal_exchange_outbound_clicks (deal_id);

CREATE TRIGGER IF NOT EXISTS trg_deal_exchange_outbound_clicks_no_update
BEFORE UPDATE ON deal_exchange_outbound_clicks
BEGIN
  SELECT RAISE(ABORT, 'deal_exchange_outbound_clicks is append-only.');
END;
CREATE TRIGGER IF NOT EXISTS trg_deal_exchange_outbound_clicks_no_delete
BEFORE DELETE ON deal_exchange_outbound_clicks
BEGIN
  SELECT RAISE(ABORT, 'deal_exchange_outbound_clicks is append-only.');
END;

-- WhatsApp handoff - created ONLY when the visitor deliberately confirms the review screen. No
-- automated message is ever sent from this table; whatsapp_opened_at records that the visitor
-- themselves clicked through, not that Vakaviti sent anything.
CREATE TABLE IF NOT EXISTS deal_exchange_enquiries (
  id TEXT PRIMARY KEY,
  deal_id TEXT,
  product_id TEXT,
  travel_dates TEXT,
  party_size TEXT,
  hotel_or_arrival_point TEXT,
  unresolved_questions TEXT,
  enquiry_reference TEXT NOT NULL UNIQUE,
  whatsapp_opened_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Saved trip is client-side (localStorage) only per the CEO's explicit privacy instruction - no
-- server table exists for it in this milestone, deliberately.
