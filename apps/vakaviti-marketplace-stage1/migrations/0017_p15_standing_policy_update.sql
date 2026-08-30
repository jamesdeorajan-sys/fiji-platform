PRAGMA foreign_keys = ON;

-- P1.5: no schema change - standing_policies (0014) already has every column this needs. Two new
-- rows only, both inserted by migration (never by application code - see regression-guards.mjs
-- check 19), continuing the same "a human-granted policy is a durable, auditable record, not a
-- runtime flag" discipline.

-- Records that P1.5 activated automatic, Cron-triggered execution of the policy already granted
-- in 0014 (AI_DISCOVERED_DIRECTORY_PUBLICATION) - the deterministic gate and the standing
-- authorization are unchanged; what changed is that a passing candidate is now promoted the
-- moment it's discovered (src/supply-scheduler.ts, triggered only by Cloudflare's own Cron, never
-- a public route) instead of waiting for a human click at /admin/review. /admin/review remains
-- available for anything the automatic pass does not cover (identity conflicts, weak evidence).
INSERT INTO standing_policies (
  id, policy_name, granted_by, directive_reference, scope_permitted, scope_forbidden
) VALUES (
  'policy-class-a-automation-2026-08-21',
  'CLASS_A_DIRECTORY_AUTOMATIC_EXECUTION',
  'James (CEO, Vakaviti / AJ Group Enterprises Pty Ltd)',
  'VAKAVITI P1.5 - REMOVE MANUAL TOKEN BOTTLENECK AND ACTIVATE GOVERNED AI SUPPLY (2026-08-21)',
  'Activates automatic (Cron-triggered, never publicly triggered) execution of the AI_DISCOVERED_DIRECTORY_PUBLICATION policy already granted in migration 0014: a directory-listing candidate that passes every deterministic gate in src/directory-gate.ts is promoted the moment it is discovered, without waiting for a human click at /admin/review.',
  'Does not change what may be published - still factual directory listings only, still NOT_VERIFIED, still no partnership/verification claim. Does not touch deal_offer_candidates or provider_ceo_confirmations. Does not authorize a public HTTP trigger for this automation - only Cloudflare''s own Cron Trigger may invoke it.'
);

-- Class B (source-evidenced deal auto-publish) is recorded as authorized IN PRINCIPLE but
-- deliberately left INACTIVE, because no code path currently exists that could safely act on it
-- without fabricating a claim. Four required facts - fulfilment_operator, response_owner,
-- content_rights_status, image_rights_status - are business/rights judgment calls with no honest
-- default; they have only ever been set by a human, in one request, via the existing
-- POST /candidates/:id/approve endpoint (src/deals.ts). evaluateDealAutoPublishGates() in
-- src/deal-quality.ts implements the full 14-point deterministic check the CEO directive names,
-- correctly classifying every existing candidate as NOT_ELIGIBLE today, and is wired for
-- visibility only (src/supply-dashboard.ts) - nothing calls it as a publish decision.
-- To activate: a human needs to decide and record specific defaults (e.g. a standard
-- response_owner and fulfilment_operator per provider, and a rule for when AI-written factual
-- summaries count as rights-clear with no image unless a separate right is confirmed) - that is
-- a further CEO policy decision, not something inferred here.
INSERT INTO standing_policies (
  id, policy_name, granted_by, directive_reference, scope_permitted, scope_forbidden, active
) VALUES (
  'policy-class-b-deals-2026-08-21',
  'CLASS_B_SOURCE_EVIDENCED_DEAL_AUTO_PUBLISH',
  'James (CEO, Vakaviti / AJ Group Enterprises Pty Ltd)',
  'VAKAVITI P1.5 - REMOVE MANUAL TOKEN BOTTLENECK AND ACTIVATE GOVERNED AI SUPPLY (2026-08-21)',
  'Authorized in principle: automatic publication of a source-evidenced deal once identity, price/basis, validity, inclusions, booking route, and source-freshness facts are all present and unambiguous on a provider-controlled source, per the CEO directive''s 14-point checklist (implemented as evaluateDealAutoPublishGates() in src/deal-quality.ts).',
  'NOT YET ACTIVE: no code path auto-sets fulfilment_operator, response_owner, content_rights_status, or image_rights_status - these remain human-only judgment calls set exclusively via the existing POST /candidates/:id/approve endpoint. This row records the authorization; it does not itself enable auto-publication until a human decision fills that specific gap.',
  0
);
