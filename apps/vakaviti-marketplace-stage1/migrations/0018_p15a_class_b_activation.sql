PRAGMA foreign_keys = ON;

-- P1.5A: activates the Class B (source-evidenced deal) standing policy inserted inactive in
-- migration 0017, now that James has supplied the exact governed defaults for the four fields no
-- webpage can ever contain (response_owner, fulfilment_operator basis, content_rights_status
-- basis, image_rights_status basis). No schema change - this is a migration-level UPDATE, not an
-- application code path (see regression-guards.mjs check 24/25 - no code anywhere writes
-- standing_policies).
UPDATE standing_policies SET
  active = 1,
  scope_permitted = 'Automatic publication of a source-evidenced deal once every fact-of-evidence gate in evaluateDealAutoPublishGates() (src/deal-quality.ts) passes. On publish, autoPublishDealIfEligible() (src/deals.ts) sets exactly these CEO-approved, non-configurable defaults: response_owner=''Vakaviti Concierge — James and authorized team''; fulfilment_operator=the evidenced provider identity from the source (never implying a Vakaviti contract, resale authority, availability control, or partnership); content_rights_status basis=''VAKAVITI_ORIGINAL_FACTUAL_SUMMARY'' (a concise, newly-written factual summary - never the provider''s marketing prose or protected expression), stored as the existing APPROVED enum value with this exact basis recorded in the audit trail; image_rights_status basis=''NO_IMAGE_USED'', stored as the existing NO_IMAGE enum value. Public wording is fixed: "Deal discovered on the provider''s official website.", "Last checked [date/time].", "Availability and final terms must be confirmed.", "Vakaviti will help with your enquiry." Never Partner/Claimed/Vakaviti Verified/Guaranteed/Instant confirmation/Exclusive/Authorized reseller unless a separate governed record supports that exact status.',
  scope_forbidden = 'No caller may override the four fixed defaults above - autoPublishDealIfEligible() accepts only (env, candidateId), never field values. Does not authorize an image unless a separate right is recorded. Does not authorize any claim of partnership, verification, contract, resale authority, or guaranteed availability. Does not touch operators/candidate_operators/provider_ceo_confirmations. AI (src/deal-agent.ts, src/discovery-bridge.ts) has no path to this decision - it only ever extracts facts; evaluateDealAutoPublishGates() and autoPublishDealIfEligible() are the sole deterministic decision points.'
WHERE id = 'policy-class-b-deals-2026-08-21';
