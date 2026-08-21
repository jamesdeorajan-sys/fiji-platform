// Vakaviti P1.3D - deterministic gates for AI-DISCOVERED PUBLIC DIRECTORY listings (Path A),
// distinct from CEO-CONFIRMED PILOT PARTNERS (Path B, src/provider-onboarding.ts). Pure,
// deterministic, no AI.run() call, no D1 access - identical discipline to
// src/deal-quality.ts, which this file otherwise has nothing to do with (a directory listing is
// a factual identity/location/service record, never a commercial offer).
//
// Of the 9 requirements the CEO directive names, 5 are genuinely data-driven and checked here;
// the other 4 (concise factual wording; no unsupported review/rating/price/award/verification
// claim; correction/claim/withdrawal routes offered) are satisfied by construction - the public
// template that renders a directory listing (src/index.ts) has no code path that could emit any
// of those things, and always renders a claim/correction link. regression-guards.mjs check 19
// verifies that template-level guarantee structurally, the same way it already verifies the
// claim-status wording ban from P1.3A/C.

export interface DirectoryCandidate {
  canonical_name: string | null;
  website_url: string | null;
  primary_url: string | null;
  locality: string | null;
  region: string | null;
  duplicate_of_id: string | null;
  product_count: number; // caller supplies this (COUNT of linked product_candidates)
}

export interface DirectoryGateResult {
  passedGates: string[];
  failedGates: string[];
  decision: 'ELIGIBLE' | 'NOT_ELIGIBLE';
  reasons: string[];
}

export function evaluateDirectoryListingGates(c: DirectoryCandidate): DirectoryGateResult {
  const passed: string[] = [];
  const failed: string[] = [];
  const reasons: string[] = [];

  // 1. Canonical provider identity sufficiently resolved.
  const hasName = !!(c.canonical_name && c.canonical_name.trim().length >= 3);
  if (hasName) passed.push('identity_resolved'); else { failed.push('identity_resolved'); reasons.push('No canonical provider name.'); }

  // 2. Official provider-controlled domain exists.
  const domain = c.website_url || c.primary_url;
  const hasDomain = !!(domain && /^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(domain));
  if (hasDomain) passed.push('official_domain_present'); else { failed.push('official_domain_present'); reasons.push('No official domain on file.'); }

  // 3 & 4. Business name and Fiji relevance / locality or service area supported - this pilot is
  // Fiji-only by construction, so any genuinely-found locality/region is the relevance signal.
  const hasLocality = !!(c.locality || c.region);
  if (hasLocality) passed.push('locality_supported'); else { failed.push('locality_supported'); reasons.push('No locality or region extracted.'); }

  // 5. At least one real service or product supported.
  const hasProduct = c.product_count > 0;
  if (hasProduct) passed.push('has_service_or_product'); else { failed.push('has_service_or_product'); reasons.push('No linked product/service found.'); }

  // 6. No unresolved identity contradiction (a flagged duplicate is exactly that).
  const noDuplicateFlag = !c.duplicate_of_id;
  if (noDuplicateFlag) passed.push('no_identity_contradiction'); else { failed.push('no_identity_contradiction'); reasons.push('Flagged as a possible duplicate of another record - resolve manually first.'); }

  // 7-9: satisfied by construction (see file header) - recorded as passed for a complete gate
  // list in the audit trail, not because any candidate-level data was checked here.
  passed.push('factual_wording_by_template', 'no_unsupported_claims_by_template', 'correction_route_by_template');

  return {
    passedGates: passed,
    failedGates: failed,
    decision: failed.length === 0 ? 'ELIGIBLE' : 'NOT_ELIGIBLE',
    reasons,
  };
}
