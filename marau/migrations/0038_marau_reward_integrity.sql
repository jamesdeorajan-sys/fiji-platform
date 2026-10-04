-- Marau Stage 1 (PREVIEW/TEST ONLY) - reward integrity (October round 2).
--
--  1. PAYMENT EVIDENCE. Marau does not take payments; guests pay later (cash/card/bank at fulfilment). A reward credit used to
--     be earned on FULFILMENT alone, which let a delivered-but-unpaid purchase earn. marau_offer_payments is an append-only
--     ledger of payment evidence a named staff member records ('paid' / 'refunded'), idempotent per (request, event_key).
--     The reward policy gains require_payment ('paid_in_full' by default, 'none' as the alternative commercial choice).
--  2. MULTIPLE CREDITS PER RETURN. marau_booking_adjustments had UNIQUE(booking_id): one credit per return booking, ever.
--     That is replaced by (a) a partial UNIQUE on credit_id for LIVE adjustments only (a released credit can be re-applied
--     elsewhere) and (b) a remaining-amount-due bound enforced inside the single INSERT that creates an adjustment.
--     New adjustment states: released_booking_cancelled (the return transfer was cancelled/declined) and reversal_resolved
--     (a human settled a flagged reversal).

ALTER TABLE marau_reward_policy ADD COLUMN require_payment TEXT NOT NULL DEFAULT 'paid_in_full' CHECK (require_payment IN ('none', 'paid_in_full'));

CREATE TABLE IF NOT EXISTS marau_offer_payments (
  payment_id   TEXT PRIMARY KEY,
  request_id   TEXT NOT NULL REFERENCES marau_offer_requests(request_id),
  event_type   TEXT NOT NULL CHECK (event_type IN ('paid', 'refunded')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method       TEXT NOT NULL CHECK (method IN ('cash', 'card', 'bank_transfer', 'other')),
  reference    TEXT,
  event_key    TEXT NOT NULL,
  recorded_by  TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (request_id, event_key)
);
CREATE INDEX IF NOT EXISTS idx_marau_offer_payments_request ON marau_offer_payments(request_id);

-- Rebuild the adjustments table without UNIQUE(booking_id) and with the two new states.
CREATE TABLE marau_booking_adjustments_v2 (
  adjustment_id            TEXT PRIMARY KEY,
  booking_id               INTEGER NOT NULL,
  credit_id                TEXT NOT NULL REFERENCES marau_reward_credits(credit_id),
  kind                     TEXT NOT NULL DEFAULT 'referral_credit',
  original_quote_cents     INTEGER NOT NULL,
  credit_cents             INTEGER NOT NULL CHECK (credit_cents > 0),
  amount_due_cents         INTEGER NOT NULL CHECK (amount_due_cents >= 0),
  operator_payout_cents    INTEGER,
  operator_payout_unchanged INTEGER NOT NULL DEFAULT 1,
  funded_by                TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'reversal_pending_staff', 'released_booking_cancelled', 'reversal_resolved')),
  created_by               TEXT NOT NULL,
  created_at               TEXT NOT NULL,
  resolved_by              TEXT,
  resolved_at              TEXT,
  resolution_note          TEXT
);
INSERT INTO marau_booking_adjustments_v2 (adjustment_id, booking_id, credit_id, kind, original_quote_cents, credit_cents, amount_due_cents, operator_payout_cents, operator_payout_unchanged, funded_by, status, created_by, created_at)
  SELECT adjustment_id, booking_id, credit_id, kind, original_quote_cents, credit_cents, amount_due_cents, operator_payout_cents, operator_payout_unchanged, funded_by, status, created_by, created_at FROM marau_booking_adjustments;
DROP TABLE marau_booking_adjustments;
ALTER TABLE marau_booking_adjustments_v2 RENAME TO marau_booking_adjustments;
CREATE UNIQUE INDEX idx_marau_adjustments_one_live_per_credit ON marau_booking_adjustments(credit_id) WHERE status IN ('applied', 'reversal_pending_staff');
CREATE INDEX idx_marau_adjustments_booking ON marau_booking_adjustments(booking_id, status);
