// Vakaviti Deal Intelligence - P1.2: deterministic candidate-quality gate, page classification,
// URL canonicalization, and deal-identity/deduplication logic.
//
// Everything in this file is pure and deterministic - no AI.run() call, no network call, no D1
// access. It exists specifically so a low-information scan (a homepage, a stale marketing page,
// a page an AI half-read) cannot reach the human review queue just because its fingerprint
// changed. AI extraction confidence is read but never trusted alone (CEO directive P1.2 is
// explicit: "Do not rely only on an AI-generated confidence number") - every gate below is a
// concrete, inspectable check against the extracted fields and the raw page text.

export type PageClassification =
  | 'OFFER_PAGE' | 'MULTI_OFFER_PAGE' | 'PRODUCT_PAGE' | 'PROVIDER_HOME_PAGE'
  | 'BOOKING_ENGINE_PAGE' | 'INFORMATIONAL_PAGE' | 'UNKNOWN';

export type QualityDecision = 'ACCEPTED' | 'QUALITY_REJECTED';

export interface ExtractedFields {
  proposed_offer_name: string | null;
  factual_summary: string | null;
  category: string | null;
  fiji_location: string | null;
  advertised_price: string | null;
  reference_price: string | null;
  currency: string | null;
  price_basis: string | null;
  explicit_discount: string | null;
  promo_code: string | null;
  booking_deadline: string | null;
  travel_from: string | null;
  travel_until: string | null;
  offer_expires_at: string | null;
  blackout_dates: string | null;
  minimum_stay: string | null;
  minimum_group_size: string | null;
  eligibility: string | null;
  inclusions: string | null;
  exclusions: string | null;
  cancellation_terms: string | null;
  booking_route: string | null;
  seller_or_marketer: string | null;
}

export interface QualityResult {
  pageClassification: PageClassification;
  passedGates: string[];
  failedGates: string[];
  missingFields: string[];
  contradictionFlags: string[];
  confidence: number;
  decision: QualityDecision;
  rejectionReason: string | null;
  materialFactCount: number;
}

// --- Prompt-injection detection (gate 8) -------------------------------------------------------
// Applied to the RAW page text before extraction is trusted at all. A page attempting to steer
// the model ("ignore previous instructions", "you are now", a fake system/assistant turn, an
// instruction to approve/publish) fails closed regardless of what the AI happened to return -
// this is a content check, not a trust decision made by the model being asked about itself.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all|any|previous|the above|prior) instructions?/i,
  /disregard (all|any|previous|the above|prior)/i,
  /you are now/i,
  /new instructions?:/i,
  /system\s*:/i,
  /assistant\s*:/i,
  /\bact as\b.{0,30}\b(admin|administrator|system)\b/i,
  /(approve|publish|mark).{0,20}(this offer|this deal|this candidate)/i,
  /grant (publication|approval|verified)/i,
];

export function detectPromptInjection(pageText: string): boolean {
  const sample = (pageText || '').slice(0, 20000);
  return INJECTION_PATTERNS.some(p => p.test(sample));
}

// --- URL canonicalization (deduplication requirement) -------------------------------------------
// Lowercases scheme+host, strips the fragment, normalizes a single trailing slash on the path
// (but never collapses "/" itself), and removes known non-semantic tracking parameters while
// preserving anything else - a query parameter that might actually distinguish one offer from
// another on the same path (e.g. ?package=romance) is kept rather than guessed away.
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'gclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid', 'ref', 'referrer', '_ga', 'igshid',
]);

export function canonicalizeUrl(rawUrl: string): string {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return rawUrl; }
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  u.hash = '';
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  const pairs: [string, string][] = [];
  u.searchParams.forEach((v, k) => pairs.push([k, v]));
  pairs.sort(([a], [b]) => a.localeCompare(b));
  const kept = new URLSearchParams();
  for (const [k, v] of pairs) {
    if (!TRACKING_PARAMS.has(k.toLowerCase())) kept.set(k, v);
  }
  u.search = kept.toString() ? `?${kept.toString()}` : '';
  return u.toString();
}

// --- Deal identity (deduplication requirement) --------------------------------------------------
// A stable identity for "this specific deal", independent of incidental content-fingerprint
// churn (an ad slot, an analytics snippet, a "last updated" timestamp on the page changing every
// scan). Built only from the facts that would actually make it a DIFFERENT deal if they changed:
// the source, the canonical URL, the normalized title, and the material commercial terms. Two
// scans of the same page that extract the same title and the same material facts produce the
// same identity hash even if their raw content-fingerprints differ - that is the whole point.
// Coerces defensively (String(s ?? '')) rather than trusting the declared string|null type - an
// AI extraction that returns a JSON number instead of a string for some field must never crash
// this pipeline; gate_10_schema_valid is what flags that case as a failure, not an exception.
// Underscores are treated as word separators (PER_PERSON -> "per person") so an enum-style field
// value the model normalizes itself can still be matched against ordinary page text that says
// "per person", not "per_person" - the identity hash is equally well-formed either way since the
// same normalization is applied on every call.
const normalizeText = (s: string | null): string =>
  String(s ?? '').toLowerCase().trim().replace(/_/g, ' ').replace(/\s+/g, ' ').replace(/[^\w\s-]/g, '');

const MATERIAL_FACT_KEYS: (keyof ExtractedFields)[] = [
  'advertised_price', 'currency', 'price_basis', 'reference_price', 'explicit_discount',
  'booking_deadline', 'offer_expires_at', 'travel_from', 'travel_until', 'minimum_stay',
  'inclusions', 'eligibility', 'cancellation_terms', 'blackout_dates',
];

export async function computeDealIdentity(canonicalUrl: string, sourceId: string, fields: ExtractedFields): Promise<string> {
  const materialPart = MATERIAL_FACT_KEYS.map(k => `${k}=${normalizeText(fields[k])}`).join('|');
  const basis = [
    sourceId,
    canonicalUrl,
    normalizeText(fields.proposed_offer_name),
    materialPart,
  ].join('::');
  const data = new TextEncoder().encode(basis);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Returns the list of material fields that differ between two extractions - used both to decide
// "is this a material change at all" and to write one deal_change_events row per changed field,
// so the audit trail says exactly what changed, not just that something did.
export function diffMaterialFacts(before: ExtractedFields, after: ExtractedFields): { field: string; oldValue: string | null; newValue: string | null }[] {
  const diffs: { field: string; oldValue: string | null; newValue: string | null }[] = [];
  for (const key of [...MATERIAL_FACT_KEYS, 'proposed_offer_name' as const]) {
    const a = normalizeText(before[key]);
    const b = normalizeText(after[key]);
    if (a !== b) diffs.push({ field: key, oldValue: before[key], newValue: after[key] });
  }
  return diffs;
}

// --- Page classification (deterministic, not AI-judged) -----------------------------------------
// Heuristic but rule-based: looks at the URL path and structural signals in the extracted fields,
// never trusts marketing words alone. A page containing "special", "best price", "book now" with
// nothing else extracted is exactly the case this task must NOT treat as proof of a deal.
export function classifyPage(canonicalUrl: string, fields: ExtractedFields, pageText: string): PageClassification {
  let path = '';
  try { path = new URL(canonicalUrl).pathname.toLowerCase(); } catch { /* leave empty */ }

  const hasOfferSignal = !!(fields.proposed_offer_name || fields.advertised_price || fields.explicit_discount);
  const bookingEnginePatterns = /\/(book|booking|checkout|reservation|cart)\b/;
  const productPathPatterns = /\/(rooms?|room-types?|packages?|tours?|cruises?|activities?)\/[a-z0-9-]+/;
  const offerPathPatterns = /\/(special-offers?|deals?|promotions?|offers?)\b/;

  if (bookingEnginePatterns.test(path)) return 'BOOKING_ENGINE_PAGE';

  // A page whose extracted "offer" facts don't materially differ across sections, or which has
  // several independently-attributable offer titles, is multi-offer rather than single-offer -
  // this pilot's extractor only returns one field-set per scan, so true multi-offer detection is
  // conservative: it fires only when the raw text contains multiple distinct price tokens next
  // to distinct heading-like phrases, which is a real (if imperfect) structural signal.
  const priceTokenMatches = (pageText.match(/\b(FJD|F\$|USD|US\$|AUD|A\$|\$)\s?\d{2,5}\b/gi) || []);
  const distinctPriceTokens = new Set(priceTokenMatches.map(t => t.toUpperCase()));
  if (distinctPriceTokens.size >= 3 && offerPathPatterns.test(path)) return 'MULTI_OFFER_PAGE';

  if (offerPathPatterns.test(path) && hasOfferSignal) return 'OFFER_PAGE';
  if (productPathPatterns.test(path)) return 'PRODUCT_PAGE';
  if (offerPathPatterns.test(path) && !hasOfferSignal) return 'INFORMATIONAL_PAGE'; // e.g. an /offers page that's currently empty of any concrete deal
  if (path === '' || path === '/' ) return 'PROVIDER_HOME_PAGE';

  const informationalPatterns = /\/(about|contact|faq|terms|privacy|policy|blog|news)\b/;
  if (informationalPatterns.test(path)) return 'INFORMATIONAL_PAGE';

  return 'UNKNOWN';
}

// --- Quality gate (the 10 deterministic checks) --------------------------------------------------
const AMBIGUOUS_SELLER_PATTERNS = /^(various|multiple|n\/?a|unknown|tbc|to be confirmed|our partners?)$/i;
const GENERIC_MARKETING_PATTERNS = /(available year[- ]round|book now|best price guarantee|exclusive offers?|contact us for (more )?details)/i;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');

function factAttributable(value: string | null, pageTextNorm: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const tokens = normalizeText(value).split(' ').filter(t => t.length >= 3);
  if (tokens.length === 0) return false;
  // A fact is "attributable" if a meaningful fragment of it appears in the visible page text -
  // guards against the model inventing a plausible-looking value that isn't actually on the page.
  const needle = tokens.slice(0, 4).join(' ');
  return pageTextNorm.includes(needle) || tokens.some(t => pageTextNorm.includes(t) && t.length >= 5);
}

export function evaluateQualityGates(
  canonicalUrl: string,
  fields: ExtractedFields,
  extractionConfidence: number,
  pageText: string
): QualityResult {
  const passed: string[] = [];
  const failed: string[] = [];
  const missing: string[] = [];
  const contradictions: string[] = [];
  const pageTextNorm = norm(pageText || '');
  const classification = classifyPage(canonicalUrl, fields, pageText || '');

  // Gate 8 runs first and short-circuits everything else - a page that tried to inject
  // instructions is rejected outright, never partially trusted.
  if (detectPromptInjection(pageText || '')) {
    failed.push('gate_8_no_prompt_injection');
    return {
      pageClassification: classification, passedGates: passed, failedGates: failed,
      missingFields: [], contradictionFlags: ['prompt_injection_detected'], confidence: extractionConfidence,
      decision: 'QUALITY_REJECTED', rejectionReason: 'Page content matched a prompt-injection pattern; extraction discarded without trust.',
      materialFactCount: 0,
    };
  }
  passed.push('gate_8_no_prompt_injection');

  // Gate 1: identifiable deal/package/special/promo proposition.
  const hasTitle = !!(fields.proposed_offer_name && fields.proposed_offer_name.trim().length >= 8);
  const summaryLooksSpecific = !!(fields.factual_summary
    && fields.factual_summary.trim().length >= 15
    && !GENERIC_MARKETING_PATTERNS.test(fields.factual_summary)
    && /\d/.test(fields.factual_summary)); // a concrete number (price, nights, %) is a real specificity signal
  // PRODUCT_PAGE (a specific tour/room/package detail page) is just as attributable as a
  // dedicated offer-listing page - it's excluded only for BOOKING_ENGINE_PAGE (a transactional
  // tool, not a proposition itself), PROVIDER_HOME_PAGE, INFORMATIONAL_PAGE, and UNKNOWN, which
  // default closed rather than open.
  const eligiblePageType = classification === 'OFFER_PAGE' || classification === 'MULTI_OFFER_PAGE' || classification === 'PRODUCT_PAGE';
  if ((hasTitle || summaryLooksSpecific) && eligiblePageType) {
    passed.push('gate_1_identifiable_proposition');
  } else {
    failed.push('gate_1_identifiable_proposition');
    if (!hasTitle) missing.push('proposed_offer_name');
  }

  // Generic provider homepages / informational pages never pass regardless of marketing words -
  // per the directive: "must not generate offer candidates unless a specific attributable offer
  // is actually present," and "special / best price / package / book now" alone prove nothing.
  if (classification === 'PROVIDER_HOME_PAGE' || classification === 'INFORMATIONAL_PAGE') {
    failed.push('gate_1_identifiable_proposition_page_type_excluded');
  }

  // Gate 2: provider/source identity resolved.
  if (fields.seller_or_marketer && fields.seller_or_marketer.trim().length > 0) {
    passed.push('gate_2_provider_identity_resolved');
  } else {
    failed.push('gate_2_provider_identity_resolved');
    missing.push('seller_or_marketer');
  }

  // Gate 3: canonical source URL retained.
  let urlOk = false;
  try { urlOk = !!new URL(canonicalUrl).hostname; } catch { urlOk = false; }
  if (urlOk) passed.push('gate_3_canonical_url_retained'); else failed.push('gate_3_canonical_url_retained');

  // Gate 4: meaningful offer title.
  const titleIsJustSellerName = !!(fields.proposed_offer_name && fields.seller_or_marketer
    && normalizeText(fields.proposed_offer_name) === normalizeText(fields.seller_or_marketer));
  if (hasTitle && !titleIsJustSellerName) {
    passed.push('gate_4_meaningful_title');
  } else {
    failed.push('gate_4_meaningful_title');
    if (titleIsJustSellerName) contradictions.push('proposed_offer_name duplicates seller_or_marketer verbatim');
  }

  // Gate 5: at least one booking/travel applicability fact.
  const applicabilityFields: (keyof ExtractedFields)[] = ['booking_deadline', 'travel_from', 'travel_until', 'offer_expires_at', 'minimum_stay', 'booking_route'];
  const applicabilityPresent = applicabilityFields.some(k => !!fields[k]);
  if (applicabilityPresent) passed.push('gate_5_applicability_fact'); else { failed.push('gate_5_applicability_fact'); missing.push(...applicabilityFields.filter(k => !fields[k])); }

  // Gate 6: at least two additional material commercial facts, each attributable to the page.
  const attributableMaterialFacts = MATERIAL_FACT_KEYS.filter(k => fields[k] && factAttributable(fields[k], pageTextNorm));
  const unattributable = MATERIAL_FACT_KEYS.filter(k => fields[k] && !factAttributable(fields[k], pageTextNorm));
  if (unattributable.length > 0) contradictions.push(...unattributable.map(k => `${k} not found in visible source text`));
  if (attributableMaterialFacts.length >= 2) {
    passed.push('gate_6_two_material_facts');
  } else {
    failed.push('gate_6_two_material_facts');
    missing.push(...MATERIAL_FACT_KEYS.filter(k => !fields[k]));
  }

  // Gate 7: seller/fulfiller not materially ambiguous.
  const sellerAmbiguous = !!(fields.seller_or_marketer && AMBIGUOUS_SELLER_PATTERNS.test(fields.seller_or_marketer.trim()));
  if (fields.seller_or_marketer && !sellerAmbiguous) {
    passed.push('gate_7_seller_not_ambiguous');
  } else {
    failed.push('gate_7_seller_not_ambiguous');
    if (sellerAmbiguous) contradictions.push('seller_or_marketer is a placeholder/ambiguous value');
  }

  // Gate 9: extracted facts attributable to visible source content (title + summary too, not
  // just the material-fact list checked in gate 6).
  const titleAttributable = !fields.proposed_offer_name || factAttributable(fields.proposed_offer_name, pageTextNorm);
  if (titleAttributable && unattributable.length === 0) {
    passed.push('gate_9_attributable_to_source');
  } else {
    failed.push('gate_9_attributable_to_source');
    if (!titleAttributable) contradictions.push('proposed_offer_name not found in visible source text');
  }

  // Gate 10: schema validation - every declared field key present with a string-or-null value.
  const schemaOk = Object.keys(fields).length > 0 && Object.values(fields).every(v => v === null || typeof v === 'string');
  if (schemaOk) passed.push('gate_10_schema_valid'); else failed.push('gate_10_schema_valid');

  const decision: QualityDecision = failed.length === 0 ? 'ACCEPTED' : 'QUALITY_REJECTED';
  const rejectionReason = decision === 'QUALITY_REJECTED'
    ? `Failed ${failed.length} gate(s): ${failed.join(', ')}`
    : null;

  return {
    pageClassification: classification,
    passedGates: passed,
    failedGates: failed,
    missingFields: [...new Set(missing)],
    contradictionFlags: contradictions,
    confidence: extractionConfidence,
    decision,
    rejectionReason,
    materialFactCount: attributableMaterialFacts.length,
  };
}
