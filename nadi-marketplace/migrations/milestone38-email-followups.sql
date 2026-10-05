-- Nadi Airport Transfers — Driver Marketplace
-- Milestone 38: dependable email follow-up requests (backup contact channel). PREPARED, NOT APPLIED to production.
--
-- A guest who cannot use WhatsApp can ask for the Fiji team to follow up BY EMAIL. This table is the DURABLE queue behind that request:
--   * one row per client_booking_ref (UNIQUE): repeated clicks / retries / replays are the same row, never a duplicate task;
--   * kind 'booking'  = attached to an existing, saved reservation (booking_id set);
--     kind 'enquiry'  = no saved booking (WhatsApp-only / unsupported route): an enquiry for HUMAN REVIEW - NOT a booking, never confirmed by this table;
--   * requested_email is stored SEPARATELY from bookings.guest_email (never overwritten); email_differs flags a correction so staff verify first;
--   * staff handling is recorded: assigned_to (NULL = explicitly the unassigned queue), acknowledgement, contact outcome. admin tokens do not identify
--     a person, so the *_by columns are the staff member's self-declared label, recorded as given;
--   * "REQUESTED" means a request was received. It never means a transfer is confirmed or that any email was sent or delivered.
-- Additive only: nothing existing is altered. The escalations row (escalation_id) reuses the existing staff escalation queue/alert path.

CREATE TABLE email_followups (
  id INTEGER PRIMARY KEY,
  client_ref TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('booking', 'enquiry')),
  booking_id INTEGER REFERENCES bookings(id),
  guest_name TEXT,
  guest_phone TEXT,
  requested_email TEXT NOT NULL,
  booking_email TEXT,
  email_differs INTEGER NOT NULL DEFAULT 0,
  journey_summary TEXT,
  origin_site TEXT,          -- 'nat' (nadiairporttransfers.com) | 'fijidash' (book.fijidash.com) | 'unknown'
  receiving_inbox TEXT,      -- the monitored human inbox at request time (James-confirmed: tourfijitours@gmail.com); a RECEIVING inbox only, no sender
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'ACKNOWLEDGED', 'CONTACTED', 'CLOSED')),
  designated_owner TEXT,     -- who is RESPONSIBLE by policy when the request arrives (platform_settings 'email_followup_owner'); NOT proof anyone has picked it up
  assigned_to TEXT,          -- who has actually CLAIMED it (NULL = unclaimed); claiming also acknowledges
  assigned_at TEXT,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  contact_outcome TEXT,
  contact_outcome_note TEXT,
  contact_outcome_at TEXT,
  contact_outcome_by TEXT,
  escalation_id INTEGER REFERENCES escalations(id),
  alert_status TEXT,
  request_count INTEGER NOT NULL DEFAULT 1,
  source_ip TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_email_followups_status ON email_followups(status, created_at);
CREATE INDEX idx_email_followups_booking ON email_followups(booking_id);
CREATE INDEX idx_email_followups_ip ON email_followups(source_ip, created_at);

-- Initial operational owner (James, recorded 2026-10-06): he monitors tourfijitours@gmail.com and owns email follow-ups during initial testing. This is the DESIGNATED owner;
-- each request still shows UNCLAIMED until a staff member actually claims it.
INSERT OR IGNORE INTO platform_settings (key, value) VALUES ('email_followup_owner', 'James');
INSERT OR IGNORE INTO platform_settings (key, value) VALUES ('email_followup_inbox', 'tourfijitours@gmail.com');
