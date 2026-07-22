-- Nadi Airport Transfers — Driver Marketplace
-- Milestone 10: human escalation / "back to base" system
--
-- booking_id/driver_id are separate nullable FK-style columns rather than
-- folded into context's free text, matching the geocoded_addresses/bookings
-- pattern elsewhere in this schema — lets an escalation be queried by which
-- real booking/driver it relates to, not just grepped out of a text blob.

CREATE TABLE escalations (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('guest', 'driver')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'geocode_failed', 'needs_manual_confirmation', 'wallet_dispute', 'app_issue', 'other'
  )),
  context TEXT, -- free text: what they typed, error detail, etc.
  booking_id INTEGER REFERENCES bookings(id),
  driver_id INTEGER REFERENCES drivers(id),
  created_at TEXT DEFAULT (datetime('now')),
  resolved INTEGER NOT NULL DEFAULT 0
);
