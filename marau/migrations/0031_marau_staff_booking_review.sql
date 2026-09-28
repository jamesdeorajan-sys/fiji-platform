-- Marau Stage 1 (PREVIEW/TEST ONLY) — round 21 correction: the approved
-- staff "Review and confirm" workflow concerns the INITIAL TRANSFER
-- RESERVATION (a real booking, synced via worker/real_booking_sync.js),
-- not only an additional Marau "deal request" — round 19/20 scoped it to
-- deal requests alone. This widens `marau_staff_review_tokens` to also
-- cover a `booking` subject (keyed by the real `source_booking_ref`, the
-- same stable identity the sync module already uses — never a raw
-- Marau row id, consistent with that module's own provenance rules).
-- SQLite cannot ALTER a CHECK constraint in place, so this recreates the
-- table with the widened constraint (same technique already used
-- elsewhere in this codebase, e.g. migration 0016) — this table holds no
-- production data, so there is nothing destructive about it.
CREATE TABLE marau_staff_review_tokens_new (
  token         TEXT PRIMARY KEY,
  subject_type  TEXT NOT NULL CHECK (subject_type IN ('deal_request', 'booking')),
  subject_id    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);
INSERT INTO marau_staff_review_tokens_new SELECT * FROM marau_staff_review_tokens;
DROP TABLE marau_staff_review_tokens;
ALTER TABLE marau_staff_review_tokens_new RENAME TO marau_staff_review_tokens;
CREATE INDEX IF NOT EXISTS idx_marau_staff_review_tokens_subject ON marau_staff_review_tokens(subject_type, subject_id);

-- Round 21, requirement 4: "record the authorised operator responsible
-- for the decision." A durable audit row per genuine decision — never
-- inferred from the shared admin token alone, since this preview has no
-- per-operator login (per instruction: "use the existing protected
-- staff mechanism... do not invent a new identity platform" — the
-- shared admin token remains the ONLY authentication check; `operator`
-- is a plain, staff-supplied identifying label recorded alongside it,
-- not itself a credential).
CREATE TABLE IF NOT EXISTS marau_staff_decisions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token         TEXT NOT NULL,
  subject_type  TEXT NOT NULL,
  subject_id    TEXT NOT NULL,
  decision      TEXT NOT NULL,
  operator      TEXT NOT NULL,
  decided_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marau_staff_decisions_subject ON marau_staff_decisions(subject_type, subject_id);
