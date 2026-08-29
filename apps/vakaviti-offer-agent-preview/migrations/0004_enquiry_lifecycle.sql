-- VAKAVITI LIVE DEAL EXCHANGE - Milestone 4 entry gate 2: explicit enquiry lifecycle states.
-- "Never infer that opening a link means a message was sent" - status and booking_outcome are
-- deliberately separate dimensions: whether we know the visitor opened WhatsApp is a different
-- fact from whether a human actually made contact, which is different again from whether a
-- booking resulted. Nothing in this app ever sets booking_outcome to anything but 'UNKNOWN' -
-- that would require external evidence this system does not have.
ALTER TABLE deal_exchange_enquiries ADD COLUMN status TEXT NOT NULL DEFAULT 'REVIEW_CREATED' CHECK (status IN (
  'REVIEW_CREATED', 'WHATSAPP_LINK_OPENED', 'HUMAN_CONTACT_CONFIRMED'
));
ALTER TABLE deal_exchange_enquiries ADD COLUMN booking_outcome TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (booking_outcome IN ('UNKNOWN'));
ALTER TABLE deal_exchange_enquiries ADD COLUMN idempotency_key TEXT;
ALTER TABLE deal_exchange_enquiries ADD COLUMN whatsapp_link_opened_at TEXT;
ALTER TABLE deal_exchange_enquiries ADD COLUMN human_contact_confirmed_at TEXT;
ALTER TABLE deal_exchange_enquiries ADD COLUMN human_contact_confirmed_by TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_exchange_enquiries_idempotency ON deal_exchange_enquiries (idempotency_key);
