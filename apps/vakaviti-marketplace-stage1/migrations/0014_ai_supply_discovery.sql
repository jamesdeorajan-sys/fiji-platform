PRAGMA foreign_keys = ON;

-- P1.3D: AI supply discovery, batch review, and rapid publication. Fully additive - two new
-- tables only. No existing table (operators, products, candidate_operators, deal_sources,
-- deal_offer_candidates, provider_ceo_confirmations) is touched.
--
-- Deliberately NOT added: a "listing_basis" column on operators to distinguish AI-discovered
-- directory listings from CEO-confirmed pilot partners. That distinction is instead DERIVED live
-- from whether an unrevoked provider_ceo_confirmations row exists for the operator - the exact
-- same "recompute, never trust a cached flag" discipline already used for the Pilot Partner
-- badge. An operator with no confirmation row is, by construction, an AI-discovered directory
-- listing; one with an unrevoked row is a Pilot Partner. There is no third state to store because
-- there is nothing to cache.

-- standing_policies: a durable, auditable record of this directive itself - James's standing
-- human policy authorization for AI to publish factual, deterministically-gated directory
-- listings without a per-provider CEO confirmation. AI reads this table to confirm the policy is
-- active before ever promoting a directory listing; AI has no write path to it at all (see
-- regression-guards.mjs check 19).
CREATE TABLE IF NOT EXISTS standing_policies (
  id TEXT PRIMARY KEY,
  policy_name TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  directive_reference TEXT,
  scope_permitted TEXT NOT NULL,      -- human-readable summary of what this policy allows
  scope_forbidden TEXT NOT NULL,      -- human-readable summary of what it explicitly does not allow
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  revoked_at TEXT,
  revoked_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- supply_import_batches: idempotency + audit ledger for the documentation-to-review importer.
-- Keyed by manifest_hash so re-running an import of the exact same dossier content is a safe
-- no-op rather than a duplicate. Every record the import creates stays private (candidate-stage
-- only) - this table never grants publication by itself.
CREATE TABLE IF NOT EXISTS supply_import_batches (
  id TEXT PRIMARY KEY,
  source_path TEXT NOT NULL,
  manifest_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PREVIEWED' CHECK (status IN ('PREVIEWED','CONFIRMED','FAILED')),
  actor TEXT,
  preview_json TEXT,
  records_total INTEGER NOT NULL DEFAULT 0,
  records_created INTEGER NOT NULL DEFAULT 0,
  records_skipped_duplicate INTEGER NOT NULL DEFAULT 0,
  records_rejected_invalid INTEGER NOT NULL DEFAULT 0,
  previewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_supply_import_batches_hash ON supply_import_batches(manifest_hash);

-- Seed the standing policy itself. This row IS the durable record of James's CEO directive
-- (P1.3D, 2026-08-21) authorizing AI to publish factual, deterministically-gated directory
-- listings without a per-provider CEO confirmation. Inserted here, by migration, under CEO
-- authority - never by application code, and application code has no UPDATE/INSERT path to this
-- table at all (see regression-guards.mjs check 19). To revoke this policy, a human runs a
-- one-line UPDATE (active=0, revoked_at, revoked_by) directly against D1 - deliberately outside
-- any code path, so revocation can never be an AI action either.
INSERT INTO standing_policies (
  id, policy_name, granted_by, directive_reference, scope_permitted, scope_forbidden
) VALUES (
  'policy-ai-directory-2026-08-21',
  'AI_DISCOVERED_DIRECTORY_PUBLICATION',
  'James (CEO, Vakaviti / AJ Group Enterprises Pty Ltd)',
  'VAKAVITI P1.3D - AI SUPPLY DISCOVERY, BATCH REVIEW AND RAPID PUBLICATION (2026-08-21)',
  'Publishing factual AI-discovered public directory listings (provider name, location, service area, contact route, at least one real service) once every deterministic gate in src/directory-gate.ts passes and a human has approved the specific candidate via the batch review console.',
  'Does NOT authorize: partnership claims, verification claims (VAKAVITI_VERIFIED), fabricated or unsupported information, copying copyrighted descriptions, reuse of images without a supported right, publishing live commercial deals without separate team review, or sharing traveller personal data without consent. AI may never approve or submit a listing itself.'
);
