// VAKAVITI LIVE DEAL EXCHANGE - Commercial Truth Model (Milestone 1), 2026-08-24.
//
// Pure, deterministic functions only - no AI.run() call, no network call, no D1 access. Same
// discipline as src/deal-quality.ts: a publication decision must be independently re-derivable
// and auditable, never a black-box AI judgment. Reuses canonicalizeUrl()/detectPromptInjection()
// from deal-quality.ts directly rather than re-implementing them.
//
// OWNERSHIP BOUNDARY (CEO directive, 2026-08-24): this file and everything under it owns PUBLIC
// multi-authority offers, comparison, trip-saving, revenue routing, and public deal freshness. It
// has NO relationship to PR #21's private-opportunity-capture pipeline (opportunities.ts,
// opportunity-gate.ts, opportunity_* tables) - that PR lives on a separate branch and is not
// present here. See DEAL_EXCHANGE_INTEGRATION_CONTRACT.md for the narrow, currently-disabled
// integration point between the two systems.

import { canonicalizeUrl, detectPromptInjection } from './deal-quality';
export { canonicalizeUrl, detectPromptInjection };

// --- Offer-owner types (Phase 1 item 1) -----------------------------------------------------------
export type OfferOwnerType =
  | 'VAKAVITI_BOOKABLE' | 'PROVIDER_DIRECT' | 'SELLER_PACKAGE' | 'PRICE_CHECK_REQUIRED' | 'FLIGHT_QUOTE';

// --- Entity separation (Phase 1 item 2) -------------------------------------------------------
// Six distinct identities that must never be collapsed into one "owner" field - e.g. Vakaviti can
// be the booking recipient for a transfer while Fiji Tour Transfers is the fulfilment operator,
// and neither of those is the "provider" (the resort) or "enquiry handler" (Vakaviti WhatsApp).
export interface OfferEntities {
  providerId: string | null;            // the actual business (resort/operator) - an identity, never a booking authority by itself
  providerName: string | null;
  sellerId: string | null;              // a third-party package seller (e.g. Jetstar Holidays) - null unless SELLER_PACKAGE
  sellerName: string | null;
  fulfilmentOperatorId: string | null;  // who actually delivers the service on the ground
  fulfilmentOperatorName: string | null;
  bookingRecipient: string | null;      // who receives the booking/payment - may differ from the fulfilment operator
  enquiryHandler: string | null;        // who answers questions (Vakaviti WhatsApp, the provider, or the seller)
}

// --- Evidence source classes (Phase 2) ----------------------------------------------------------
// A page an AI half-read is not publication authority. Only the first three classes are ever
// authoritative for a public fact - the rest are discovery leads only, exactly as directed: "Do
// not treat Google snippets, hotel panels, AI-generated answers, Facebook/TikTok posts, social
// comments, search-result prices, or cached snippets as publication authority."
export type EvidenceSourceClass =
  | 'PROVIDER_OFFICIAL_PAGE' | 'SELLER_OFFICIAL_PAGE' | 'VAKAVITI_OWNED_SYSTEM'
  | 'GOOGLE_SNIPPET' | 'GOOGLE_HOTEL_PANEL' | 'AI_GENERATED_ANSWER'
  | 'FACEBOOK_POST' | 'TIKTOK_POST' | 'SOCIAL_COMMENT' | 'SEARCH_RESULT_PRICE' | 'CACHED_SNIPPET';

const NEVER_AUTHORITATIVE: Set<EvidenceSourceClass> = new Set([
  'GOOGLE_SNIPPET', 'GOOGLE_HOTEL_PANEL', 'AI_GENERATED_ANSWER',
  'FACEBOOK_POST', 'TIKTOK_POST', 'SOCIAL_COMMENT', 'SEARCH_RESULT_PRICE', 'CACHED_SNIPPET',
]);
export const isAuthoritativeSourceClass = (cls: EvidenceSourceClass): boolean => !NEVER_AUTHORITATIVE.has(cls);

export type MaterialField =
  | 'provider_identity' | 'seller_identity' | 'exact_offer' | 'price' | 'currency' | 'price_basis'
  | 'occupancy_basis' | 'booking_deadline' | 'travel_window' | 'inclusions' | 'booking_route' | 'locality';

export const ALL_MATERIAL_FIELDS: MaterialField[] = [
  'provider_identity', 'seller_identity', 'exact_offer', 'price', 'currency', 'price_basis',
  'occupancy_basis', 'booking_deadline', 'travel_window', 'inclusions', 'booking_route', 'locality',
];

// Which source class is REQUIRED for a field to be selectable, per offer-owner type. A field
// missing from one page is not a failure - "do not require every fact to appear on one page" - as
// long as the required-authority source exists somewhere. A lower-authority source for the SAME
// field is recorded as rejected evidence, never allowed to silently overwrite the real one.
export function authoritativeSourceClassFor(field: MaterialField, offerOwnerType: OfferOwnerType): EvidenceSourceClass | null {
  if (offerOwnerType === 'VAKAVITI_BOOKABLE') return 'VAKAVITI_OWNED_SYSTEM';
  if (offerOwnerType === 'PROVIDER_DIRECT') return 'PROVIDER_OFFICIAL_PAGE';
  if (offerOwnerType === 'SELLER_PACKAGE') {
    // The provider's own page remains authoritative for provider identity/location even inside a
    // seller-owned package - the seller does not get to redefine who/where the provider is. Every
    // other material fact (price, inclusions, validity, booking route, exact offer, seller
    // identity) is owned by the seller's own page.
    if (field === 'provider_identity' || field === 'locality') return 'PROVIDER_OFFICIAL_PAGE';
    return 'SELLER_OFFICIAL_PAGE';
  }
  return null; // PRICE_CHECK_REQUIRED / FLIGHT_QUOTE do not use static field-authority resolution
}

export interface EvidenceItem {
  field: MaterialField;
  value: string | null;
  sourceClass: EvidenceSourceClass;
  sourceUrl: string | null;
  checkedAt: string | null;
}

export interface ResolvedField {
  field: MaterialField;
  selectedValue: string | null;
  selectedSourceClass: EvidenceSourceClass | null;
  selectedSourceUrl: string | null;
  selectionReason: string;
  isMissing: boolean;
  isStale: boolean;
  isContradiction: boolean;
  rejectedEvidence: { value: string | null; sourceClass: EvidenceSourceClass; reason: string }[];
}

export interface EvidenceResolutionResult {
  offerOwnerType: OfferOwnerType;
  resolvedFields: Record<MaterialField, ResolvedField>;
  supportedFields: MaterialField[];
  missingFields: MaterialField[];
  staleFields: MaterialField[];
  contradictingFields: MaterialField[];
}

const normalizeText = (s: string | null): string =>
  String(s ?? '').toLowerCase().trim().replace(/_/g, ' ').replace(/\s+/g, ' ').replace(/[^\w\s.-]/g, '');

function resolveOneField(
  field: MaterialField, allEvidence: EvidenceItem[], offerOwnerType: OfferOwnerType,
  nowMs: number, freshnessWindowHours: number
): ResolvedField {
  const items = allEvidence.filter(e => e.field === field);
  const requiredClass = authoritativeSourceClassFor(field, offerOwnerType);
  const rejected: { value: string | null; sourceClass: EvidenceSourceClass; reason: string }[] = [];

  const usable = items.filter(it => {
    if (!isAuthoritativeSourceClass(it.sourceClass)) {
      rejected.push({ value: it.value, sourceClass: it.sourceClass, reason: 'Not a publication-authority source class - discovery lead only.' });
      return false;
    }
    if (requiredClass && it.sourceClass !== requiredClass) {
      rejected.push({ value: it.value, sourceClass: it.sourceClass, reason: `Not authoritative for this field under ${offerOwnerType} - requires ${requiredClass}.` });
      return false;
    }
    return true;
  });

  if (usable.length === 0) {
    return {
      field, selectedValue: null, selectedSourceClass: null, selectedSourceUrl: null,
      selectionReason: 'No authoritative evidence found for this field.',
      isMissing: true, isStale: false, isContradiction: false, rejectedEvidence: rejected,
    };
  }

  const distinctValues = new Set(usable.map(u => normalizeText(u.value)));
  if (distinctValues.size > 1) {
    return {
      field, selectedValue: null, selectedSourceClass: null, selectedSourceUrl: null,
      selectionReason: `${usable.length} equally-authoritative source(s) disagree on this field - cannot silently resolve.`,
      isMissing: true, isStale: false, isContradiction: true, rejectedEvidence: rejected,
    };
  }

  const chosen = usable.slice().sort((a, b) => (Date.parse(b.checkedAt || '') || 0) - (Date.parse(a.checkedAt || '') || 0))[0];
  const ageHours = chosen.checkedAt && !isNaN(Date.parse(chosen.checkedAt)) ? (nowMs - Date.parse(chosen.checkedAt)) / 3600000 : Infinity;
  const stale = ageHours > freshnessWindowHours;
  return {
    field, selectedValue: chosen.value, selectedSourceClass: chosen.sourceClass, selectedSourceUrl: chosen.sourceUrl,
    selectionReason: stale
      ? `Evidence agrees but is stale (checked ${ageHours === Infinity ? 'never' : ageHours.toFixed(1) + 'h ago'}, window is ${freshnessWindowHours}h).`
      : 'Authoritative evidence found and current.',
    isMissing: false, isStale: stale, isContradiction: false, rejectedEvidence: rejected,
  };
}

export interface EvidenceBundleInput {
  offerOwnerType: OfferOwnerType;
  evidence: EvidenceItem[]; // may contain multiple items for the same field, from different sources
  freshnessWindowHours: number;
  now?: string; // injectable for deterministic tests - defaults to real current time
}

export function resolveEvidenceBundle(input: EvidenceBundleInput): EvidenceResolutionResult {
  const nowMs = input.now ? Date.parse(input.now) : Date.now();
  const resolvedFields = {} as Record<MaterialField, ResolvedField>;
  for (const field of ALL_MATERIAL_FIELDS) {
    resolvedFields[field] = resolveOneField(field, input.evidence, input.offerOwnerType, nowMs, input.freshnessWindowHours);
  }
  const supportedFields = ALL_MATERIAL_FIELDS.filter(f => !resolvedFields[f].isMissing);
  const missingFields = ALL_MATERIAL_FIELDS.filter(f => resolvedFields[f].isMissing);
  const staleFields = ALL_MATERIAL_FIELDS.filter(f => resolvedFields[f].isStale);
  const contradictingFields = ALL_MATERIAL_FIELDS.filter(f => resolvedFields[f].isContradiction);
  return { offerOwnerType: input.offerOwnerType, resolvedFields, supportedFields, missingFields, staleFields, contradictingFields };
}

// --- Commercial fields (Phase 1 item 5) -----------------------------------------------------------
// PER_NIGHT is deliberately its own basis, never silently reinterpreted as a package total/
// per-family/per-room figure - "never mix nightly hotel price with package price" is enforced by
// treating price_basis as its own evidence-resolved field (see resolveOneField above): if two
// sources disagree on basis, that is a contradiction, not a merge.
export type PriceBasis = 'PER_PERSON' | 'PER_ROOM' | 'PER_FAMILY' | 'TOTAL' | 'PER_NIGHT';
export type TaxesFeesStatus = 'INCLUDED' | 'EXCLUDED' | 'UNKNOWN';

export interface CommercialFields {
  amount: string | null;
  currency: string | null;
  isFromPrice: boolean;
  priceBasis: PriceBasis | null;
  occupancyBasis: string | null;
  nights: number | null;
  departureCity: string | null;
  bookingDeadline: string | null;
  travelStart: string | null;
  travelEnd: string | null;
  blackoutDates: string | null;
  inclusions: string | null;
  exclusions: string | null;
  taxesFeesStatus: TaxesFeesStatus | null;
  bookingRoute: string | null;
}

// --- Excluded identities (CEO directive, applies identically to this system) ---------------------
const EXCLUDED_DOMAINS = new Set(['tourfijitours.com', 'tourfiji.tours']);
const EXCLUDED_NAME_PATTERN = /\btour\s*fiji\s*tours?\b/i;
export function isExcludedIdentity(domain: string | null, name: string | null): boolean {
  const d = (domain || '').toLowerCase().replace(/^www\./, '');
  if (EXCLUDED_DOMAINS.has(d)) return true;
  if (name && EXCLUDED_NAME_PATTERN.test(name)) return true;
  return false;
}

// --- Public wording (Phase 1 item 8) --------------------------------------------------------------
export function generatePublicLabel(offerOwnerType: OfferOwnerType, sellerName: string | null): string | null {
  switch (offerOwnerType) {
    case 'VAKAVITI_BOOKABLE': return 'Book through Vakaviti';
    case 'PROVIDER_DIRECT': return 'Available from the provider';
    case 'SELLER_PACKAGE': return sellerName && sellerName.trim() ? `Available from ${sellerName.trim()}` : null;
    case 'PRICE_CHECK_REQUIRED': return null; // never public
    case 'FLIGHT_QUOTE': return null; // live-only path, see evaluateFlightQuoteDisplay()
  }
}

// --- Deterministic publication gates (Phase 1 item 6) ---------------------------------------------
export interface OfferPublicationCandidate {
  offerOwnerType: OfferOwnerType;
  entities: OfferEntities;
  resolution: EvidenceResolutionResult;
  sourceUrl: string | null; // the exact canonical offer URL under evaluation
  isDuplicateOfId: string | null;
  requiresPriceBasis: boolean;    // true whenever a price amount is actually shown
  requiresOccupancyBasis: boolean; // true for occupancy-sensitive categories (accommodation/cruise/etc)
  requiresValidityForRequestedDates: boolean; // true when a visitor requested specific dates
  freshnessWindowHours: number;
  checkedAt: string | null;
  pageText?: string; // raw text of the source page, used only for the prompt-injection check
}

export interface OfferGateResult {
  decision: 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'PRIVATE_ONLY';
  passedGates: string[];
  failedGates: string[];
  publicLabel: string | null;
}

export function evaluateOfferPublicationGates(c: OfferPublicationCandidate): OfferGateResult {
  if (c.offerOwnerType === 'PRICE_CHECK_REQUIRED') {
    return { decision: 'PRIVATE_ONLY', passedGates: [], failedGates: [], publicLabel: null };
  }
  if (c.offerOwnerType === 'FLIGHT_QUOTE') {
    // Flight quotes never reach this function in the real pipeline - see
    // evaluateFlightQuoteDisplay(), the only path that may show one, and which never persists a
    // fixed fare. This is a defensive backstop only.
    return { decision: 'NOT_ELIGIBLE', passedGates: [], failedGates: ['flight_quotes_never_persist_here'], publicLabel: null };
  }

  const passed: string[] = [];
  const failed: string[] = [];
  const check = (name: string, ok: boolean) => { if (ok) passed.push(name); else failed.push(name); };

  if (c.pageText && detectPromptInjection(c.pageText)) {
    return { decision: 'NOT_ELIGIBLE', passedGates: [], failedGates: ['no_prompt_injection'], publicLabel: null };
  }
  passed.push('no_prompt_injection');

  check('exact_offer_owner_resolved',
    c.offerOwnerType === 'VAKAVITI_BOOKABLE' ? !!(c.entities.fulfilmentOperatorId || c.entities.bookingRecipient) :
    c.offerOwnerType === 'PROVIDER_DIRECT' ? !!c.entities.providerId :
    /* SELLER_PACKAGE */ !!(c.entities.sellerId && c.entities.providerId));

  check('not_excluded_identity', !isExcludedIdentity(null, c.entities.providerName) && !isExcludedIdentity(null, c.entities.sellerName));

  let httpsOk = false;
  try { httpsOk = !!c.sourceUrl && new URL(c.sourceUrl).protocol === 'https:'; } catch { httpsOk = false; }
  check('https_canonical_source', httpsOk);

  const evidenceCurrent = !!c.checkedAt && !isNaN(Date.parse(c.checkedAt)) && (Date.now() - Date.parse(c.checkedAt)) / 3600000 <= c.freshnessWindowHours;
  check('current_evidence', evidenceCurrent);

  const priceField = c.resolution.resolvedFields.price;
  const priceBasisField = c.resolution.resolvedFields.price_basis;
  const currencyField = c.resolution.resolvedFields.currency;
  const priceShown = !priceField.isMissing && !priceField.isContradiction;
  check('supported_price_basis', !c.requiresPriceBasis || !priceShown || (!priceBasisField.isMissing && !currencyField.isMissing));

  const deadlineField = c.resolution.resolvedFields.booking_deadline;
  const windowField = c.resolution.resolvedFields.travel_window;
  check('supported_validity', !c.requiresValidityForRequestedDates || !deadlineField.isMissing || !windowField.isMissing);

  const routeField = c.resolution.resolvedFields.booking_route;
  check('supported_booking_route', !routeField.isMissing);

  check('no_unresolved_contradiction', c.resolution.contradictingFields.length === 0);
  check('no_duplicate_identity', !c.isDuplicateOfId);

  const isPastDate = (iso: string | null) => !!iso && !isNaN(Date.parse(iso)) && Date.parse(iso) < Date.now();
  const expired = isPastDate(deadlineField.selectedValue) && windowField.isMissing;
  check('not_expired', !expired);

  const occField = c.resolution.resolvedFields.occupancy_basis;
  check('supported_occupancy_basis', !c.requiresOccupancyBasis || !occField.isMissing);

  const label = generatePublicLabel(c.offerOwnerType, c.entities.sellerName);
  check('honest_public_label_available', !!label);
  check('acceptable_freshness_window', evidenceCurrent);

  const decision = failed.length === 0 ? 'ELIGIBLE' : 'NOT_ELIGIBLE';
  return { decision, passedGates: passed, failedGates: failed, publicLabel: decision === 'ELIGIBLE' ? label : null };
}

// --- Flight quotes: live-only, never persisted (Phase 1 item 8 / directive Phase 1 FLIGHT_QUOTE) --
export interface FlightQuoteDisplay {
  checkedAt: string;
  volatilityWarning: string;
  isPersistable: false; // structurally false - this type can never be written to a "public deal" store
}
export function evaluateFlightQuoteDisplay(checkedAt: string): FlightQuoteDisplay {
  return {
    checkedAt,
    volatilityWarning: 'Live result only - fares change constantly and are not held or guaranteed.',
    isPersistable: false,
  };
}

// --- Duplicate / versioning (Phase 1 item 7) --------------------------------------------------------
// Two independent mechanisms, matching the two independently-named duplicate scenarios:
//  1. computeOfferFingerprint - URL-variant + material-fact identity. canonicalizeUrl() already
//     strips tracking params, so "same package found through tracking URL variants" collapses
//     naturally. offerOwnerType + providerId + sellerId are part of the basis, so a provider-direct
//     offer and a seller-owned package for the SAME resort never collapse into one fingerprint,
//     and two different sellers packaging the same resort don't either.
//  2. computeOfferIdentityKey - a coarser identity cluster (no URL) for "the same seller/package
//     appears on multiple distinct pages" - two offers can share this key while having different
//     fingerprints (different exact URLs), which is exactly the case this key exists to catch.
export async function computeOfferFingerprint(
  offerOwnerType: OfferOwnerType, providerId: string | null, sellerId: string | null,
  canonicalUrl: string, materialFacts: Record<string, string | null>
): Promise<string> {
  const factsPart = Object.entries(materialFacts).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${normalizeText(v)}`).join('|');
  const basis = [offerOwnerType, providerId || '', sellerId || '', canonicalizeUrl(canonicalUrl), factsPart].join('::');
  const data = new TextEncoder().encode(basis);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function computeOfferIdentityKey(offerOwnerType: OfferOwnerType, providerId: string | null, sellerId: string | null, normalizedTitle: string): string {
  return [offerOwnerType, providerId || '', sellerId || '', normalizeText(normalizedTitle)].join('::');
}

export interface MaterialChangeDiff {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}
export function diffMaterialFacts(before: Record<string, string | null>, after: Record<string, string | null>): MaterialChangeDiff[] {
  const diffs: MaterialChangeDiff[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (normalizeText(before[key] ?? null) !== normalizeText(after[key] ?? null)) {
      diffs.push({ field: key, oldValue: before[key] ?? null, newValue: after[key] ?? null });
    }
  }
  return diffs;
}
