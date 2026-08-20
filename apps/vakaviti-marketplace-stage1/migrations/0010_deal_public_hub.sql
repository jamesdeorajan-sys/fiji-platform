PRAGMA foreign_keys = ON;

-- Deal Intelligence public hub + review centre support. Fully additive: one new nullable
-- column on the existing deal_offer_candidates table (native ADD COLUMN, no CHECK-constraint
-- change, no table rebuild), plus two new isolated tables. Nothing here touches operators,
-- products, offers, or enquiries - deal enquiries get their own table specifically so Deal
-- Intelligence attribution never mixes with real Wave 1 marketplace leads.

ALTER TABLE deal_offer_candidates ADD COLUMN slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_offer_candidates_slug ON deal_offer_candidates(slug);

-- Privacy-safe event log for the public deals hub (Part F). No traveler-identifying data -
-- offer/category/place/query references only, matching the enquiries table's existing
-- non-identifying-attribution discipline.
CREATE TABLE IF NOT EXISTS deal_analytics_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'HUB_VIEW','SEARCH','FILTER','SORT','DEAL_IMPRESSION','DEAL_OPENED','CTA_SELECTED',
    'ENQUIRY_CREATED','EXPIRED_OFFER_ENCOUNTER','NO_RESULTS_QUERY'
  )),
  offer_id TEXT,
  category TEXT,
  place TEXT,
  query TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_deal_analytics_events_type ON deal_analytics_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_deal_analytics_events_offer ON deal_analytics_events(offer_id);

-- Deal-specific enquiries, deliberately separate from the real `enquiries` table (which is
-- FK-bound to real operators/products) - a Deal Intelligence candidate's seller_or_marketer is
-- free text, not yet a resolved real operator, so its enquiries must not be recorded as if they
-- were real Wave 1 marketplace leads. Exact offer attribution is preserved via offer_candidate_id.
CREATE TABLE IF NOT EXISTS deal_enquiries (
  id TEXT PRIMARY KEY,
  offer_candidate_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'WHATSAPP',
  source_page TEXT,
  referrer TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (offer_candidate_id) REFERENCES deal_offer_candidates(id)
);
CREATE INDEX IF NOT EXISTS idx_deal_enquiries_offer ON deal_enquiries(offer_candidate_id, created_at);
