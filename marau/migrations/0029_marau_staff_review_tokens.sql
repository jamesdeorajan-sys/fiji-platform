-- Marau Stage 1 (PREVIEW/TEST ONLY) — round 19. The approved staff
-- workflow: a booking/deal-specific "Review and confirm" link, carried
-- inside the EXISTING detailed WhatsApp alert (still fully mocked — no
-- real send), opens an AUTHENTICATED staff page scoped to exactly that
-- one subject. Opening the link (a GET) never confirms anything by
-- itself; only an explicit staff action (a POST) does, and that POST
-- reuses the EXISTING admin confirm/decline handlers
-- (handleAdminConfirmDealRequest / handleAdminDeclineDealRequest)
-- rather than duplicating their logic.
--
-- A token is scoped to exactly one subject (never a general admin
-- credential) and expires — it is not a substitute for the shared admin
-- token's broader access, and grants nothing beyond deciding that one
-- deal request.
CREATE TABLE IF NOT EXISTS marau_staff_review_tokens (
  token         TEXT PRIMARY KEY,
  subject_type  TEXT NOT NULL CHECK (subject_type IN ('deal_request')),
  subject_id    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_marau_staff_review_tokens_subject ON marau_staff_review_tokens(subject_type, subject_id);
