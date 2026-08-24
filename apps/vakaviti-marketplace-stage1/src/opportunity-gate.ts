// VAKAVITI DEAL OPPORTUNITY PIPELINE - Lane A (private capture gate + scoring), 2026-08-24.
//
// Pure, deterministic functions only - no AI.run() call, no network call, no D1 access - the
// exact same discipline as src/deal-quality.ts and src/directory-gate.ts, and for the same
// reason: a private capture decision must be independently re-derivable and auditable, not a
// black-box AI judgment. Reuses detectPromptInjection() and canonicalizeUrl() from
// deal-quality.ts directly rather than re-implementing them - those are already the CEO-reviewed,
// tested implementations, and prompt-injection/URL-canonicalization logic should have exactly one
// source of truth in this app.
//
// LANE SEPARATION: this file's job is ONLY "may this be captured privately" and "how should it be
// prioritized." It has no publish action and no path to one - see src/opportunities.ts for the
// governed conversion function, which independently re-runs the EXISTING
// evaluateDealAutoPublishGates() (deal-quality.ts) before anything can become a public deal.
// Nothing in this file can satisfy or bypass that check.

import { detectPromptInjection, canonicalizeUrl, isBlockedHost } from './deal-quality';
// Note: deliberately NOT importing anything from './deal-agent' here - deal-agent.ts imports
// from './opportunities', which imports from this file, so an import the other way would create
// a circular dependency (found and fixed during PR #21 hardening test-suite setup).

// CEO-directed exclusions (ceo-war-room/04-BRAND-ENTITY-MAP.md, 2026-08-24 CEO Final First-Party
// Answers) - control/ownership does not override the exclusion. Kept as an explicit, small,
// auditable list here rather than inferred from any other signal.
const EXCLUDED_DOMAINS = new Set(['tourfijitours.com', 'tourfiji.tours']);
const EXCLUDED_NAME_PATTERN = /\btour\s*fiji\s*tours?\b/i;

export function isExcludedIdentity(domain: string | null, providerName: string | null): boolean {
  const d = (domain || '').toLowerCase().replace(/^www\./, '');
  if (EXCLUDED_DOMAINS.has(d)) return true;
  if (providerName && EXCLUDED_NAME_PATTERN.test(providerName)) return true;
  return false;
}

// A genuine offer/promotional signal - the same bar Phase 2 names explicitly. Deliberately does
// NOT include bare "book now" / "best price guarantee" / "exclusive offers" style marketing
// filler (see deal-quality.ts's own GENERIC_MARKETING_PATTERNS) - those alone prove nothing, the
// same rule already established for the public Lane B gate.
const OFFER_SIGNAL_PATTERN = /\b(special|specials|offer|offers|package|packages|promotion|promotions|promo|save|bonus|stay\s*[-&]?\s*pay|promotional rate)\b/i;

export function hasOfferSignal(text: string): boolean {
  return OFFER_SIGNAL_PATTERN.test(text || '');
}

export interface OpportunityCaptureCandidate {
  canonicalSourceUrl: string;
  providerName: string | null;
  providerDomain: string | null;
  detectedTitle: string | null;
  detectedOfferText: string | null;
  evidenceExcerpt: string | null;
  pageText: string; // raw page text, used only for the offer-signal and prompt-injection checks
  checkedAt: string | null;
}

export interface OpportunityCaptureResult {
  decision: 'CAPTURE' | 'REJECT';
  passedGates: string[];
  failedGates: string[];
  rejectionReason: string | null;
  missingFields: string[]; // recorded even on CAPTURE - these are the commercial facts NOT required for private capture
}

// Fields Phase 2 explicitly says are NOT required for private capture - their absence is
// recorded in missing_fields_json on the opportunity row, never invented.
const OPTIONAL_FOR_CAPTURE = [
  'price_amount', 'currency', 'price_basis', 'booking_deadline', 'travel_start', 'travel_end',
  'provider_permission_status_confirmed', 'image_rights_status_confirmed',
] as const;

export function evaluateOpportunityCaptureGates(c: OpportunityCaptureCandidate): OpportunityCaptureResult {
  const passed: string[] = [];
  const failed: string[] = [];

  // Gate: prompt injection - runs first and short-circuits, identical discipline to Lane B.
  if (detectPromptInjection(c.pageText || '')) {
    return {
      decision: 'REJECT', passedGates: [], failedGates: ['no_prompt_injection'],
      rejectionReason: 'Page content matched a prompt-injection pattern; not captured.',
      missingFields: [],
    };
  }
  passed.push('no_prompt_injection');

  // Gate: provider-controlled official HTTPS source, not a private/blocked network target.
  let parsed: URL | null = null;
  try { parsed = new URL(c.canonicalSourceUrl); } catch { parsed = null; }
  const httpsOk = !!parsed && parsed.protocol === 'https:';
  const notBlocked = !!parsed && !isBlockedHost(parsed.hostname) && !parsed.username && !parsed.password;
  if (httpsOk && notBlocked) passed.push('official_https_source'); else failed.push('official_https_source');

  // Gate: no CEO-excluded identity.
  if (!isExcludedIdentity(c.providerDomain, c.providerName)) passed.push('not_excluded_identity'); else failed.push('not_excluded_identity');

  // Gate: resolved provider identity.
  const hasIdentity = !!(c.providerName && c.providerName.trim().length >= 2) || !!(c.providerDomain && c.providerDomain.trim().length > 0);
  if (hasIdentity) passed.push('provider_identity_resolved'); else failed.push('provider_identity_resolved');

  // Gate: exact canonical source URL retained (not a bare domain, not a search/aggregator result page).
  const hasPath = !!parsed && parsed.pathname && parsed.pathname !== '/';
  if (hasPath) passed.push('exact_canonical_url'); else failed.push('exact_canonical_url');

  // Gate: genuine offer signal present in the evidence itself, not just inferred from category.
  const offerText = [c.detectedTitle, c.detectedOfferText, c.evidenceExcerpt].filter(Boolean).join(' ');
  if (hasOfferSignal(offerText) || hasOfferSignal(c.pageText || '')) passed.push('genuine_offer_signal'); else failed.push('genuine_offer_signal');

  // Gate: captured factual evidence (an actual excerpt, not empty/placeholder).
  const hasEvidence = !!(c.evidenceExcerpt && c.evidenceExcerpt.trim().length >= 20);
  if (hasEvidence) passed.push('evidence_captured'); else failed.push('evidence_captured');

  // Gate: checked timestamp present.
  if (c.checkedAt) passed.push('checked_timestamp_present'); else failed.push('checked_timestamp_present');

  const decision = failed.length === 0 ? 'CAPTURE' : 'REJECT';
  return {
    decision,
    passedGates: passed,
    failedGates: failed,
    rejectionReason: failed.length ? `Failed ${failed.length} capture gate(s): ${failed.join(', ')}` : null,
    missingFields: OPTIONAL_FOR_CAPTURE.slice(0, 6), // price/basis/dates - caller overwrites with the real missing subset once fields are known (see opportunities.ts)
  };
}

export { canonicalizeUrl };

// --- Fingerprint (dedup identity) ---------------------------------------------------------------
// Same normalization discipline as deal-quality.ts's computeDealIdentity(): coerces defensively,
// treats underscores as word separators, strips punctuation. A stable identity for "this specific
// opportunity" so re-scanning an unchanged page never creates a duplicate row - see
// evaluateMaterialChange() below for what counts as a real change worth a new lifecycle event.
const normalizeText = (s: string | null): string =>
  String(s ?? '').toLowerCase().trim().replace(/_/g, ' ').replace(/\s+/g, ' ').replace(/[^\w\s-]/g, '');

export interface OpportunityMaterialFields {
  price_amount: string | null;
  currency: string | null;
  price_basis: string | null;
  booking_deadline: string | null;
  travel_start: string | null;
  travel_end: string | null;
  expiry: string | null;
  inclusions_json: string | null;
}

export async function computeOpportunityFingerprint(
  canonicalSourceUrl: string,
  providerDomain: string,
  detectedTitle: string | null,
  fields: OpportunityMaterialFields
): Promise<string> {
  const materialPart = Object.entries(fields).map(([k, v]) => `${k}=${normalizeText(v)}`).join('|');
  const basis = [providerDomain.toLowerCase(), canonicalizeUrl(canonicalSourceUrl), normalizeText(detectedTitle), materialPart].join('::');
  const data = new TextEncoder().encode(basis);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function diffOpportunityMaterialFacts(before: OpportunityMaterialFields, after: OpportunityMaterialFields): { field: string; oldValue: string | null; newValue: string | null }[] {
  const diffs: { field: string; oldValue: string | null; newValue: string | null }[] = [];
  for (const key of Object.keys(before) as (keyof OpportunityMaterialFields)[]) {
    const a = normalizeText(before[key]);
    const b = normalizeText(after[key]);
    if (a !== b) diffs.push({ field: key, oldValue: before[key], newValue: after[key] });
  }
  return diffs;
}

// --- Scoring (Phase 3) ---------------------------------------------------------------------------
// Every component is a fixed, named integer contribution - stored verbatim in
// score_components_json so the ranking is auditable, not just a final number. AI confidence is
// never a scoring input at all (the CEO directive is explicit: "AI confidence alone must never
// determine priority or publication") - every component below is a concrete, inspectable fact
// check, the same discipline as evaluateQualityGates() in deal-quality.ts.
const HIGH_DEMAND_CATEGORIES = new Set(['accommodation', 'resort', 'cruise', 'diving', 'tour', 'tours', 'activity', 'activities']);

export interface OpportunityScoringInput {
  detectedTitle: string | null;
  detectedOfferText: string | null;
  evidenceExcerpt: string | null;
  priceAmount: string | null;
  currency: string | null;
  bookingDeadline: string | null;
  travelStart: string | null;
  travelEnd: string | null;
  expiry: string | null;
  inclusionsJson: string | null;
  locality: string | null;
  region: string | null;
  providerContactRoute: string | null;
  bookingRoute: string | null;
  category: string | null;
  occupancyBasis: string | null;
  minimumStay: string | null;
  contradictionFlags: string[];
  missingFields: string[];
  lastCheckedAt: string | null;
  isDuplicateOfExisting: boolean;
  sourceReachable: boolean;
  imageRightsDependent: boolean;
  aggregatorOnlyEvidence: boolean;
  // Simple presence check the caller supplies - "is there at least one other captured
  // opportunity already covering this region+category" - true means this one is NOT filling a
  // gap (a small negative), false means it IS (a small positive).
  regionCategoryAlreadyWellCovered: boolean;
}

export interface OpportunityScoreResult {
  score: number;
  components: { name: string; delta: number; reason: string }[];
}

export function scoreOpportunity(input: OpportunityScoringInput): OpportunityScoreResult {
  const components: { name: string; delta: number; reason: string }[] = [];
  const add = (name: string, delta: number, reason: string) => components.push({ name, delta, reason });

  const offerText = [input.detectedTitle, input.detectedOfferText, input.evidenceExcerpt].filter(Boolean).join(' ');
  if (hasOfferSignal(offerText)) add('explicit_promotional_language', 15, 'A genuine offer/special/promotion signal is present in the captured evidence.');

  if (input.priceAmount && input.currency) add('price_and_currency_visible', 15, 'Both a price and a currency were captured.');
  else if (input.priceAmount) add('price_partial', 5, 'A price was captured but no currency.');

  const now = Date.now();
  const futureOrCurrent = (d: string | null) => { if (!d) return false; const t = Date.parse(d); return !isNaN(t) && t >= now; };
  if (futureOrCurrent(input.bookingDeadline) || futureOrCurrent(input.travelEnd) || futureOrCurrent(input.expiry)) {
    add('current_or_future_validity', 12, 'At least one validity/travel date is current or in the future.');
  } else if (input.bookingDeadline || input.travelEnd || input.expiry) {
    add('validity_in_past', -15, 'Every captured validity/travel date is already in the past.');
  }

  if (input.inclusionsJson && input.inclusionsJson !== '[]' && input.inclusionsJson !== '{}') add('clear_inclusions', 8, 'Inclusions were captured.');

  if (input.locality || input.region) add('clear_fiji_locality', 8, 'A Fiji locality or region was resolved.');

  if (input.providerContactRoute) add('working_provider_contact_route', 6, 'A provider contact route was captured.');
  if (input.bookingRoute) add('official_booking_route', 6, 'An official booking route was captured.');

  if (input.category && HIGH_DEMAND_CATEGORIES.has(input.category.toLowerCase())) {
    add('high_traveller_demand_category', 6, `Category "${input.category}" is high traveller-demand.`);
  }

  if (!input.regionCategoryAlreadyWellCovered) add('regional_category_supply_gap', 10, 'Few or no other captured opportunities exist yet for this region/category.');
  else add('regional_category_already_covered', -4, 'This region/category already has other captured opportunities.');

  const occupancySensitive = !!(input.category && HIGH_DEMAND_CATEGORIES.has(input.category.toLowerCase()) && /accommodation|resort|cruise/i.test(input.category));
  if (occupancySensitive) {
    if (input.occupancyBasis || input.minimumStay) add('occupancy_basis_complete', 6, 'Occupancy/minimum-stay basis captured for an occupancy-sensitive category.');
    else add('occupancy_basis_missing', -6, 'Occupancy/minimum-stay basis is missing for an occupancy-sensitive category.');
  }

  // --- negative factors ---
  if (!input.bookingDeadline && !input.travelStart && !input.travelEnd) add('missing_dates', -10, 'No booking deadline or travel window was captured at all.');
  if (!input.priceAmount) add('missing_price_basis', -8, 'No price was captured.');
  if (input.contradictionFlags && input.contradictionFlags.length > 0) add('contradictory_facts', -20, `${input.contradictionFlags.length} contradiction flag(s) recorded.`);
  if (!input.lastCheckedAt) add('unclear_provider_or_stale_evidence', -10, 'No checked timestamp recorded.');
  else {
    const ageMs = now - Date.parse(input.lastCheckedAt);
    if (!isNaN(ageMs) && ageMs > 1000 * 60 * 60 * 24 * 14) add('stale_evidence', -10, 'Evidence was last checked more than 14 days ago.');
  }
  if (input.isDuplicateOfExisting) add('duplicated_offer', -25, 'This offer duplicates an existing captured opportunity.');
  if (!input.sourceReachable) add('inaccessible_source', -20, 'The official source was not reachable at last check.');
  if (input.imageRightsDependent) add('rights_dependent_imagery', -5, 'This opportunity depends on imagery whose rights are unresolved.');
  if (input.aggregatorOnlyEvidence) add('aggregator_only_evidence', -30, 'Evidence traces to an aggregator/OTA/directory, not a provider-controlled source.');

  const score = components.reduce((sum, c) => sum + c.delta, 0);
  return { score, components };
}
