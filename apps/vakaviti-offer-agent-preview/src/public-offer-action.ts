// Phase 7A (CEO directive 2026-08-29, "CENTRAL VAKAVITI ENQUIRY ROUTE REMOVES PUBLICATION
// BOTTLENECK"): the booking-ACTION model, layered on top of - never replacing - the existing,
// unmodified evaluateOfferPublicationGates() (deal-exchange-model.ts). That function's material-
// fact gates (price, currency, basis, dates, contradiction, evidence authority, duplicate,
// freshness) are untouched by this file. This file only decides HOW a visitor acts on an offer:
// through Vakaviti's own enquiry funnel (the default for every discovered third-party offer) or,
// only when explicitly selected, straight to the provider.
//
// Deliberately NOT a change to deal-exchange-model.ts itself - that file remains the single
// canonical gate and is reused unchanged (Phase A-R boundary commitment). The
// "supported_booking_route" check inside it still just asks "is there a valid, resolved
// booking_route evidence item" - what changed is what evidence this system now feeds it (see
// adapters.ts's makeRuleEnginePort): a genuinely valid, internally-generated Vakaviti enquiry
// route for VAKAVITI_ENQUIRY offers, instead of requiring one scraped from the provider's page.
import { validateBookingRoute } from './booking-route-safety';
import type { EvidenceResolutionResult } from './deal-exchange-model';

export type PublicOfferActionType = 'VAKAVITI_ENQUIRY' | 'PROVIDER_DIRECT' | 'NOT_ACTIONABLE';
export type DeploymentEnvironment = 'preview' | 'production';

export interface OfferActionSnapshot {
  sourceUrl: string | null; // authoritative public evidence page - required, always
  vakavitiEnquiryRoute: string | null; // internally generated; required for a VAKAVITI_ENQUIRY publication
  providerBookingRoute: string | null; // optional, separately validated, NEVER inferred from sourceUrl
  // Explicit selection only - never inferred. Absent/undefined means "use the default", and the
  // default for every discovered third-party offer is VAKAVITI_ENQUIRY, per the directive.
  requestedActionType?: 'VAKAVITI_ENQUIRY' | 'PROVIDER_DIRECT';
}

export interface PublicOfferActionResult {
  actionType: PublicOfferActionType;
  reason: string;
  // Echoes back exactly which route this decision actually selected as the live action target -
  // never sourceUrl, by construction (see the tests: this field is asserted to never equal
  // sourceUrl even when sourceUrl happens to look like a plausible URI).
  selectedRoute: string | null;
}

function ambiguousProviderOrSeller(resolvedEvidence: EvidenceResolutionResult): boolean {
  const provider = resolvedEvidence.resolvedFields.provider_identity;
  const seller = resolvedEvidence.resolvedFields.seller_identity;
  // Ambiguous means: contradiction on either field. A field simply being unresolved (isMissing)
  // for provider_identity when the offer is PROVIDER_DIRECT (no seller involved at all) is a
  // separate, existing gate (evaluateOfferPublicationGates()'s own 'exact_offer_owner_resolved') -
  // this function only adds the NEW check the directive asks for: an actual disagreement between
  // sources, which the existing gate does not treat as offer-owner-specific.
  return provider.isContradiction || seller.isContradiction;
}

export function derivePublicOfferAction(
  offer: OfferActionSnapshot,
  resolvedEvidence: EvidenceResolutionResult,
  environment: DeploymentEnvironment
): PublicOfferActionResult {
  if (!offer.sourceUrl) {
    return { actionType: 'NOT_ACTIONABLE', reason: 'Missing authoritative source_url - required for every public offer regardless of action type.', selectedRoute: null };
  }

  if (ambiguousProviderOrSeller(resolvedEvidence)) {
    return { actionType: 'NOT_ACTIONABLE', reason: 'Provider/seller identity is contradicted across evidence sources - cannot publish an actionable offer under an ambiguous identity.', selectedRoute: null };
  }

  const requested = offer.requestedActionType ?? 'VAKAVITI_ENQUIRY'; // the directive's required default

  if (requested === 'PROVIDER_DIRECT') {
    const validation = validateBookingRoute(offer.providerBookingRoute);
    if (!offer.providerBookingRoute || !validation.ok) {
      return {
        actionType: 'NOT_ACTIONABLE',
        reason: `PROVIDER_DIRECT was explicitly selected but provider_booking_route is ${offer.providerBookingRoute ? `invalid (${validation.reason})` : 'missing'} - never falls back to VAKAVITI_ENQUIRY or to source_url.`,
        selectedRoute: null,
      };
    }
    return { actionType: 'PROVIDER_DIRECT', reason: 'Explicitly selected PROVIDER_DIRECT with a valid external booking route.', selectedRoute: offer.providerBookingRoute };
  }

  // Default path: VAKAVITI_ENQUIRY. providerBookingRoute's presence/validity is deliberately never
  // inspected here - "a missing provider_booking_route must not fail an otherwise eligible
  // VAKAVITI_ENQUIRY offer," and equally, an UNSAFE provider_booking_route is simply ignored for
  // this path rather than surfaced as a failure (it is validated, and matters, only when
  // PROVIDER_DIRECT is the actually-selected action).
  const enquiryValidation = validateBookingRoute(offer.vakavitiEnquiryRoute);
  if (!offer.vakavitiEnquiryRoute || !enquiryValidation.ok) {
    return {
      actionType: 'NOT_ACTIONABLE',
      reason: `vakaviti_enquiry_route is ${offer.vakavitiEnquiryRoute ? `invalid (${enquiryValidation.reason})` : 'missing'} - required for publication under the default VAKAVITI_ENQUIRY action.`,
      selectedRoute: null,
    };
  }
  return {
    actionType: 'VAKAVITI_ENQUIRY',
    reason: `Default action for a discovered third-party offer (environment: ${environment}) - a valid internal Vakaviti enquiry route exists.`,
    selectedRoute: offer.vakavitiEnquiryRoute,
  };
}

/** Deterministically builds the internal enquiry route for a given offer id - always constructible
 * once an offer id exists, which is why "missing vakaviti_enquiry_route" is expected to be rare in
 * practice; it exists as an explicit, separately-stored field (not computed ad hoc at render time)
 * so it can be evidenced, audited, and validated exactly like any other route. */
export function buildVakavitiEnquiryRoute(baseUrl: string, offerId: string): string {
  return `${baseUrl.replace(/\/$/, '')}/enquire/${offerId}`;
}
