-- PROPOSED (not applied anywhere). Numbering checked 1 Nov 2026 against every remote branch: no branch defines marau/migrations >= 0044.
-- Staff roles, operator acceptance contracts, and a minimal versioned booking snapshot with provenance.
CREATE TABLE IF NOT EXISTS bula_staff_roles (
  staff_id     TEXT PRIMARY KEY,                         -- stable id assigned by the admin seeding route, never taken from a request body at use time
  token        TEXT NOT NULL UNIQUE REFERENCES marau_staff_identities(token),
  display_name TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('ceo','approver','ops','editor')),
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by   TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bula_operator_contracts (
  contract_id  TEXT PRIMARY KEY, operator_id TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('active','suspended','ended')),
  scope_offer_ids TEXT,                                  -- comma list; NULL = every offer of this operator
  valid_from   INTEGER NOT NULL, valid_to INTEGER NOT NULL,
  approved_by_staff_id TEXT NOT NULL REFERENCES bula_staff_roles(staff_id), approved_at INTEGER NOT NULL, notes TEXT
);
-- Minimal snapshot of what the AUTHORITATIVE source says about a booking. Fields the source does not carry stay NULL and are listed
-- in availability_json as 'not_in_source'; nothing is invented or recomputed. total_minor is the source quoted_amount x 100 as supplied.
CREATE TABLE IF NOT EXISTS bula_booking_snapshots (
  booking_ref  TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1,
  source_kind  TEXT NOT NULL CHECK (source_kind IN ('nadi_dispatch_api','marau_synthetic_form')),
  source_ref   TEXT, provenance_json TEXT NOT NULL, captured_at INTEGER NOT NULL,
  currency     TEXT, total_minor INTEGER, flight_number TEXT,
  passengers   INTEGER, luggage INTEGER, add_ons_json TEXT, discount_minor INTEGER,
  availability_json TEXT NOT NULL
);
