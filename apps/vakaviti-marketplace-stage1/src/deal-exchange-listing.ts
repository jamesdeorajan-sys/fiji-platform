// VAKAVITI LIVE DEAL EXCHANGE - Milestone 3: mobile journey service layer (2026-08-24).
//
// Pure, deterministic functions only where the CEO's directive requires it (owned-product
// classification, filtering, comparison, natural-language intent parsing, cross-sell) - no
// AI.run() call anywhere in this file. The one D1-touching function (recordOutboundClick) is kept
// separate and minimal, following the same discipline as opportunities.ts in PR #21.

import { checkMonthEligibility, type OfferOwnerType, type PriceBasis } from './deal-exchange-model';

const normalizeText = (s: string | null | undefined): string =>
  String(s ?? '').toLowerCase().trim().replace(/_/g, ' ').replace(/\s+/g, ' ').replace(/[^\w\s.-]/g, '');

// --- Offer action / CTA per status class (Milestone 3 item 3) ------------------------------------
// Refines Milestone 1's generatePublicLabel(): PROVIDER_DIRECT now splits into two distinct
// actions depending on whether the captured booking route is a real bookable URL or only an
// email/phone enquiry channel - "never render 'Book now'" for the enquiry-only case.
export type BookingRouteType = 'BOOKABLE_URL' | 'ENQUIRY_ONLY' | 'NONE';

export function classifyBookingRoute(route: string | null): BookingRouteType {
  if (!route || !route.trim()) return 'NONE';
  const r = route.trim();
  if (/^mailto:/i.test(r) || (/@/.test(r) && !/^https?:\/\//i.test(r))) return 'ENQUIRY_ONLY';
  if (/^tel:/i.test(r) || /^\+?[\d\s()-]{7,}$/.test(r)) return 'ENQUIRY_ONLY';
  try {
    const u = new URL(r);
    if (u.protocol === 'https:' || u.protocol === 'http:') return 'BOOKABLE_URL';
  } catch { /* not a URL at all */ }
  return 'ENQUIRY_ONLY';
}

export type OfferActionType = 'BOOK_VAKAVITI' | 'BOOK_PROVIDER' | 'ENQUIRE_PROVIDER' | 'VIEW_SELLER_PACKAGE' | 'NONE';
export interface OfferAction {
  label: string;
  cta: string;
  actionType: OfferActionType;
}

export function determineOfferAction(offerOwnerType: OfferOwnerType, sellerName: string | null, bookingRoute: string | null): OfferAction {
  if (offerOwnerType === 'VAKAVITI_BOOKABLE') {
    return { label: 'Book through Vakaviti', cta: 'Book through Vakaviti', actionType: 'BOOK_VAKAVITI' };
  }
  if (offerOwnerType === 'PROVIDER_DIRECT') {
    const routeType = classifyBookingRoute(bookingRoute);
    if (routeType === 'BOOKABLE_URL') return { label: 'Book with provider', cta: 'Book with provider', actionType: 'BOOK_PROVIDER' };
    return { label: 'Enquire with provider', cta: 'Enquire with provider', actionType: 'ENQUIRE_PROVIDER' };
  }
  if (offerOwnerType === 'SELLER_PACKAGE') {
    if (!sellerName || !sellerName.trim()) return { label: '', cta: '', actionType: 'NONE' };
    return { label: `Available from ${sellerName.trim()}`, cta: `View package at ${sellerName.trim()}`, actionType: 'VIEW_SELLER_PACKAGE' };
  }
  return { label: '', cta: '', actionType: 'NONE' }; // PRICE_CHECK_REQUIRED / FLIGHT_QUOTE never get a public action here
}

// --- Owned-product classification (Milestone 3 item 5) -------------------------------------------
// "Do not call ordinary products deals." A discount display alone is not a time-bound deal - it
// needs a stated validity/expiry window to be a GENUINE_CURRENT_SPECIAL. Everything else that's
// real, priced and bookable is ORDINARY_BOOKABLE, which surfaces via Explore/Plan/cross-sell, not
// the Live Deals count, by construction (this table is separate from deal_exchange_offers).
export type OwnedProductClassification = 'ORDINARY_BOOKABLE' | 'GENUINE_CURRENT_SPECIAL' | 'INCOMPLETE_CONTRADICTORY' | 'EXCLUDED_QUARANTINED';

export interface OwnedProductInput {
  productName: string;
  category: 'tour' | 'transfer';
  priceAmount: string | null;
  currency: string | null;
  priceBasisConfirmed: boolean;
  discountShown: boolean;
  validityWindowStated: boolean;
  bookingRoute: string | null;
  isExcludedIdentity?: boolean;
}
export interface OwnedProductClassificationResult {
  classification: OwnedProductClassification;
  reason: string;
}

export function classifyOwnedProduct(input: OwnedProductInput): OwnedProductClassificationResult {
  if (input.isExcludedIdentity) {
    return { classification: 'EXCLUDED_QUARANTINED', reason: 'Matches a CEO-excluded identity.' };
  }
  if (!input.priceAmount || !input.currency || !input.bookingRoute) {
    return { classification: 'INCOMPLETE_CONTRADICTORY', reason: 'Missing price, currency, or a working booking route.' };
  }
  if (input.discountShown && input.validityWindowStated) {
    return { classification: 'GENUINE_CURRENT_SPECIAL', reason: 'A discount is displayed with a stated validity/expiry window.' };
  }
  if (input.discountShown && !input.validityWindowStated) {
    return { classification: 'ORDINARY_BOOKABLE', reason: 'A discount is displayed but no expiry/validity window was stated - treated as an everyday listed price, not a time-bound deal.' };
  }
  if (!input.priceBasisConfirmed) {
    return { classification: 'INCOMPLETE_CONTRADICTORY', reason: 'Price basis (e.g. per person vs per group) was not explicitly confirmed on the source page.' };
  }
  return { classification: 'ORDINARY_BOOKABLE', reason: 'Real price, confirmed basis, working booking route - no time-bound discount claimed.' };
}

// --- Public deal search/filter (Milestone 3 item 2) -----------------------------------------------
export interface PublicDealSummary {
  id: string;
  offerOwnerType: OfferOwnerType;
  title: string;
  providerName: string | null;
  sellerName: string | null;
  region: string | null;
  category: string | null;
  priceAmount: string | null;
  currency: string | null;
  isFromPrice: boolean;
  priceBasis: PriceBasis | null;
  occupancyBasis: string | null;
  nights: number | null;
  inclusions: string | null;
  travelStart: string | null;
  travelEnd: string | null;
  bookingDeadline: string | null;
  checkedAt: string | null;
  bookingRoute: string | null;
  audience: ('family' | 'couple' | 'adults_only')[] | null;
}

export interface DealSearchFilters {
  travelYear?: number;
  travelMonth?: number;
  region?: string;
  category?: string;
  audience?: 'family' | 'couple' | 'adults_only';
  minBudget?: number;
  maxBudget?: number;
  currency?: string;
  offerOwnerType?: OfferOwnerType;
}

export function filterEligibleOffers(offers: PublicDealSummary[], filters: DealSearchFilters): PublicDealSummary[] {
  return offers.filter(o => {
    if (filters.travelYear && filters.travelMonth) {
      if (!checkMonthEligibility(o.travelStart, o.travelEnd, filters.travelYear, filters.travelMonth).eligible) return false;
    }
    if (filters.region && normalizeText(o.region) !== normalizeText(filters.region)) return false;
    if (filters.category && normalizeText(o.category) !== normalizeText(filters.category)) return false;
    if (filters.audience && (!o.audience || !o.audience.includes(filters.audience))) return false;
    if (filters.offerOwnerType && o.offerOwnerType !== filters.offerOwnerType) return false;
    if (filters.currency && o.currency && normalizeText(o.currency) !== normalizeText(filters.currency)) return false;
    if ((filters.minBudget != null || filters.maxBudget != null)) {
      if (!o.priceAmount) return false;
      const amt = parseFloat(o.priceAmount);
      if (isNaN(amt)) return false;
      if (filters.minBudget != null && amt < filters.minBudget) return false;
      if (filters.maxBudget != null && amt > filters.maxBudget) return false;
    }
    return true;
  });
}

// --- Comparison (Milestone 3 item 7) ----------------------------------------------------------
export interface ComparisonEntry {
  offer: PublicDealSummary;
  comparable: boolean;
  incomparabilityReason: string | null;
}
export interface ComparisonResult {
  entries: ComparisonEntry[];
  allComparable: boolean;
}

export function compareOffers(offers: PublicDealSummary[]): ComparisonResult {
  if (offers.length > 3) throw new Error('compareOffers: at most 3 offers may be compared at once.');
  const bases = new Set(offers.map(o => o.priceBasis));
  const allSameBasis = bases.size <= 1 && !bases.has(null);
  const entries: ComparisonEntry[] = offers.map(o => {
    if (!o.priceBasis) return { offer: o, comparable: false, incomparabilityReason: 'Price basis unknown for this offer - cannot compare against other offers.' };
    if (!allSameBasis) {
      const otherBases = [...bases].filter((b): b is PriceBasis => !!b && b !== o.priceBasis);
      return { offer: o, comparable: false, incomparabilityReason: `Price basis (${o.priceBasis}) differs from other compared offers (${otherBases.join(', ')}) - shown side by side, not ranked as cheaper/more expensive.` };
    }
    return { offer: o, comparable: true, incomparabilityReason: null };
  });
  return { entries, allComparable: entries.every(e => e.comparable) };
}

// --- Cross-sell (Milestone 3 item 9) ----------------------------------------------------------
export interface CrossSellSuggestion {
  suggestionType: 'AIRPORT_TRANSFER' | 'PORT_MARINA_CONNECTION' | 'CONCIERGE' | 'OWNED_TOUR';
  reason: string;
  targetRoute: string;
}

export function suggestCrossSell(offer: { region: string | null; category: string | null }): CrossSellSuggestion[] {
  const suggestions: CrossSellSuggestion[] = [];
  const region = normalizeText(offer.region);
  if (offer.category === 'accommodation' && ['denarau', 'nadi', 'coral coast'].some(r => region.includes(r))) {
    suggestions.push({
      suggestionType: 'AIRPORT_TRANSFER',
      reason: 'This stay is in a region Fiji Tour Transfers directly serves.',
      targetRoute: 'https://fijitourtransfers.com',
    });
  }
  if (['mamanuca', 'yasawa'].some(r => region.includes(r))) {
    suggestions.push({
      suggestionType: 'PORT_MARINA_CONNECTION',
      reason: 'Island stays in this region typically need a port/marina connection from Port Denarau.',
      targetRoute: 'https://fijitourtransfers.com',
    });
  }
  if (offer.category === 'cruise') {
    suggestions.push({
      suggestionType: 'PORT_MARINA_CONNECTION',
      reason: 'Cruises need a transfer to/from the departure port and often pre/post accommodation.',
      targetRoute: 'https://fijitourtransfers.com',
    });
  }
  if (region.includes('savusavu') || region.includes('taveuni') || region.includes('vanua levu')) {
    suggestions.push({
      suggestionType: 'CONCIERGE',
      reason: 'This is a multi-region itinerary (Vanua Levu / Taveuni typically requires a domestic flight leg) - Vakaviti concierge can help coordinate.',
      targetRoute: '/chat',
    });
  }
  return suggestions;
}

// --- Bounded natural-language intent parser (Milestone 3 item 12) --------------------------------
// Deliberately has NO AI.run() call at all in this MVP - deterministic keyword/regex extraction
// only. This trivially satisfies "AI must never invent a result, price, date or availability" (
// there is no AI in the loop) and "if AI fails, the normal filter interface remains fully usable"
// (this function is purely additive - the filter UI never depends on it).
export interface ParsedIntent {
  filters: DealSearchFilters;
  matchedPhrases: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const REGION_KEYWORDS = ['denarau', 'nadi', 'coral coast', 'mamanuca', 'yasawa', 'pacific harbour', 'savusavu', 'vanua levu', 'taveuni'];
const CATEGORY_KEYWORDS: Record<string, string> = {
  resort: 'accommodation', hotel: 'accommodation', accommodation: 'accommodation',
  cruise: 'cruise', tour: 'tour', activity: 'tour', transfer: 'transfer',
};
const AUDIENCE_KEYWORDS: Record<string, 'family' | 'couple' | 'adults_only'> = {
  family: 'family', families: 'family', kids: 'family',
  couple: 'couple', couples: 'couple', romantic: 'couple', honeymoon: 'couple',
  'adults only': 'adults_only', 'adults-only': 'adults_only',
};

export function parseNaturalLanguageIntent(text: string): ParsedIntent {
  const t = ` ${normalizeText(text)} `;
  const filters: DealSearchFilters = {};
  const matched: string[] = [];

  for (const [name, num] of Object.entries(MONTH_NAMES)) {
    if (t.includes(name)) { filters.travelMonth = num; matched.push(name); break; }
  }
  const yearMatch = t.match(/\b(20\d{2})\b/);
  if (yearMatch) { filters.travelYear = parseInt(yearMatch[1], 10); matched.push(yearMatch[1]); }
  else if (filters.travelMonth) { filters.travelYear = new Date().getFullYear(); }

  for (const region of REGION_KEYWORDS) { if (t.includes(region)) { filters.region = region; matched.push(region); break; } }
  for (const [kw, cat] of Object.entries(CATEGORY_KEYWORDS)) { if (t.includes(kw)) { filters.category = cat; matched.push(kw); break; } }
  for (const [kw, aud] of Object.entries(AUDIENCE_KEYWORDS)) { if (t.includes(kw)) { filters.audience = aud; matched.push(kw); break; } }

  const budgetMatch = t.match(/(?:under|below|less than) \$?(\d+)/);
  if (budgetMatch) { filters.maxBudget = parseInt(budgetMatch[1], 10); matched.push(budgetMatch[0].trim()); }

  const confidence: ParsedIntent['confidence'] = matched.length >= 3 ? 'HIGH' : matched.length >= 1 ? 'MEDIUM' : 'LOW';
  return { filters, matchedPhrases: matched, confidence };
}

// --- Attribution (Milestone 3 item 10) --------------------------------------------------------
export interface OutboundClickInput {
  sourceSite: string; sourcePage: string; campaign: string | null; queryRef: string | null;
  providerId: string | null; productId: string | null; dealId: string | null; sellerId: string | null; enquiryId: string | null;
  fulfilmentRoute: string; outboundDestination: string; idempotencyKey: string;
}
export interface OutboundClickResult {
  recorded: boolean;
  alreadyExisted: boolean;
  outboundDestination: string;
}

// Writes the attribution row BEFORE the caller issues the 302 - the caller (the Hono route) is
// responsible for the actual redirect; this function only ever records, never fetches or follows
// a redirect itself.
export async function recordOutboundClick(db: D1Database, input: OutboundClickInput): Promise<OutboundClickResult> {
  const existing = await db.prepare('SELECT id FROM deal_exchange_outbound_clicks WHERE idempotency_key=?').bind(input.idempotencyKey).first<any>();
  if (existing) return { recorded: true, alreadyExisted: true, outboundDestination: input.outboundDestination };
  await db.prepare(
    `INSERT INTO deal_exchange_outbound_clicks (id, source_site, source_page, campaign, query_ref, provider_id, product_id, deal_id, seller_id, enquiry_id, fulfilment_route, outbound_destination, idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    crypto.randomUUID(), input.sourceSite, input.sourcePage, input.campaign, input.queryRef,
    input.providerId, input.productId, input.dealId, input.sellerId, input.enquiryId,
    input.fulfilmentRoute, input.outboundDestination, input.idempotencyKey
  ).run();
  return { recorded: true, alreadyExisted: false, outboundDestination: input.outboundDestination };
}

// --- WhatsApp handoff enquiry review (Milestone 3 item 11) ----------------------------------------
// Created ONLY when the visitor deliberately confirms the review screen (see deal-exchange-ui.ts).
// Nothing here ever sends a message - whatsapp_opened_at is set only if/when the visitor
// themselves clicks through to WhatsApp afterward.
export interface EnquiryReviewInput {
  dealId: string | null; productId: string | null;
  travelDates: string | null; partySize: string | null; hotelOrArrivalPoint: string | null;
  unresolvedQuestions: string | null;
}
export interface EnquiryReviewResult {
  enquiryId: string;
  enquiryReference: string;
}

function makeEnquiryReference(): string {
  return 'VKV-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

export async function createEnquiryReview(db: D1Database, input: EnquiryReviewInput): Promise<EnquiryReviewResult> {
  const id = crypto.randomUUID();
  const reference = makeEnquiryReference();
  await db.prepare(
    `INSERT INTO deal_exchange_enquiries (id, deal_id, product_id, travel_dates, party_size, hotel_or_arrival_point, unresolved_questions, enquiry_reference) VALUES (?,?,?,?,?,?,?,?)`
  ).bind(id, input.dealId, input.productId, input.travelDates, input.partySize, input.hotelOrArrivalPoint, input.unresolvedQuestions, reference).run();
  return { enquiryId: id, enquiryReference: reference };
}
