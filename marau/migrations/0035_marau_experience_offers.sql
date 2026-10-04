-- Marau Stage 1 (PREVIEW/TEST ONLY) - staff-managed experience offers (October revenue slice 2).
--
-- A genuinely new product beside the Smart Return transfer deals: an activity/experience sold by a VERIFIED supplier,
-- confirmed by a HUMAN, with a named fulfilment owner. Nothing here sends a message, takes a payment, or touches the
-- live transfer sites. Applied only to the isolated preview database - never to production.
--
-- Money is INTEGER CENTS of FJD throughout (no floating-point totals). `price_per_place_cents` is the all-inclusive FJD
-- price for ONE place; a request's total is places x that snapshot. `cost_per_place_cents` is the supplier cost, STAFF
-- ONLY, so contribution can be reported separately from quoted value. Quoted value is never collected revenue.
--
-- Overselling is prevented in ONE conditional INSERT (see worker/experience_offers.js): seats held by a live
-- 'requested' hold, a 'confirmed' or a 'fulfilled' request count against capacity inside the same statement that
-- creates the request. Holds lapse at hold_expires_at so unattended requests cannot block inventory.

CREATE TABLE IF NOT EXISTS marau_suppliers (
  supplier_id         TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  fulfilment_owner    TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'suspended')),
  verified_by         TEXT,
  verified_at         TEXT,
  created_by          TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS marau_experience_offers (
  offer_id              TEXT PRIMARY KEY,
  supplier_id           TEXT NOT NULL REFERENCES marau_suppliers(supplier_id),
  title                 TEXT NOT NULL,
  description           TEXT,
  location              TEXT NOT NULL,
  inclusions            TEXT NOT NULL,
  starts_at             TEXT NOT NULL,
  capacity              INTEGER NOT NULL CHECK (capacity >= 1),
  price_per_place_cents INTEGER NOT NULL CHECK (price_per_place_cents > 0),
  cost_per_place_cents  INTEGER NOT NULL DEFAULT 0 CHECK (cost_per_place_cents >= 0),
  book_by               TEXT NOT NULL,
  expires_at            TEXT NOT NULL,
  fulfilment_owner      TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'withdrawn')),
  created_by            TEXT NOT NULL,
  published_by          TEXT,
  published_at          TEXT,
  withdrawn_by          TEXT,
  withdrawn_at          TEXT,
  withdrawn_reason      TEXT,
  test_data             INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marau_experience_offers_status ON marau_experience_offers(status, starts_at);

CREATE TABLE IF NOT EXISTS marau_offer_requests (
  request_id            TEXT PRIMARY KEY,
  reference             TEXT NOT NULL UNIQUE,
  offer_id              TEXT NOT NULL REFERENCES marau_experience_offers(offer_id),
  guest_session_id      TEXT NOT NULL REFERENCES guest_sessions(session_id),
  places                INTEGER NOT NULL CHECK (places >= 1),
  price_per_place_cents INTEGER NOT NULL,
  total_cents           INTEGER NOT NULL,
  client_request_ref    TEXT,
  status                TEXT NOT NULL CHECK (status IN ('requested', 'confirmed', 'declined', 'cancelled_by_guest', 'cancelled_by_staff', 'expired', 'fulfilled')),
  hold_expires_at       TEXT,
  decided_by            TEXT,
  decided_at            TEXT,
  decision_note         TEXT,
  fulfilled_by          TEXT,
  fulfilled_at          TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
-- One live request per guest per offer: a repeated request can never double-book, whatever the client does.
CREATE UNIQUE INDEX IF NOT EXISTS idx_marau_offer_requests_one_live_per_guest
  ON marau_offer_requests(guest_session_id, offer_id) WHERE status IN ('requested', 'confirmed', 'fulfilled');
-- A client retry key is idempotent per guest session.
CREATE UNIQUE INDEX IF NOT EXISTS idx_marau_offer_requests_client_ref
  ON marau_offer_requests(guest_session_id, client_request_ref) WHERE client_request_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marau_offer_requests_offer ON marau_offer_requests(offer_id, status);

-- Append-only audit of every staff/guest transition, with the authenticated operator where one exists.
CREATE TABLE IF NOT EXISTS marau_offer_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id    TEXT,
  request_id  TEXT,
  event_type  TEXT NOT NULL,
  actor       TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marau_offer_events_request ON marau_offer_events(request_id);
CREATE INDEX IF NOT EXISTS idx_marau_offer_events_offer ON marau_offer_events(offer_id);

-- Prepared morning / afternoon deal editions, keyed by Fiji calendar date. Editions only SELECT offers to feature;
-- browsing every published offer stays available at any time regardless of editions or personalisation.
CREATE TABLE IF NOT EXISTS marau_deal_editions (
  edition_id   TEXT PRIMARY KEY,
  fiji_date    TEXT NOT NULL,
  slot         TEXT NOT NULL CHECK (slot IN ('morning', 'afternoon')),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_by   TEXT NOT NULL,
  published_by TEXT,
  published_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (fiji_date, slot)
);
CREATE TABLE IF NOT EXISTS marau_edition_offers (
  edition_id TEXT NOT NULL REFERENCES marau_deal_editions(edition_id),
  offer_id   TEXT NOT NULL REFERENCES marau_experience_offers(offer_id),
  position   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (edition_id, offer_id)
);
