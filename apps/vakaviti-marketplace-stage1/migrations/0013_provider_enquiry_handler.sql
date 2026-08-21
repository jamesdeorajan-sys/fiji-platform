PRAGMA foreign_keys = ON;

-- P1.3C: records which party (Vakaviti or the provider directly) is the intended handler for a
-- CEO-confirmed provider's initial enquiries. One nullable-with-default column, fully additive.
-- Recording this does not yet change enquiry ROUTING behaviour - every enquiry today still goes
-- through the existing /enquire/:operatorSlug flow to Vakaviti's own configured destination
-- regardless of this value, matching the CEO directive's own current scope (Coral View's
-- authorization explicitly sets this to VAKAVITI, the only value any live behaviour depends on
-- so far). A future PROVIDER-direct routing implementation is a separate, later decision.

-- No CHECK constraint here deliberately - D1's ADD COLUMN support for CHECK constraints is not
-- exercised elsewhere in this project and is not worth the risk on an otherwise-routine additive
-- change. The allowed-value enforcement lives in the application layer instead
-- (createCeoConfirmation() in src/provider-onboarding.ts validates before every write).
ALTER TABLE provider_ceo_confirmations ADD COLUMN initial_enquiry_handler TEXT NOT NULL DEFAULT 'VAKAVITI';
