// Phase A-R, item 2: derived public-presentation classifier (CEO directive 2026-08-29).
//
// publication_decision (deal-exchange-model.ts's evaluateOfferPublicationGates()) remains the sole
// authoritative eligibility state - this module never re-decides eligibility, it only decides HOW
// an already-decided offer is presented, or maps a not-yet-decided offer to REVIEW_REQUIRED. No new
// database column is introduced (explicitly forbidden this phase) - derivePublicPresentation() is a
// pure function computed at render time from data that already exists.
//
// Zero D1 access, zero AI.run() call, zero network call - same discipline as deal-exchange-model.ts,
// so a presentation decision is independently re-derivable and auditable like every other gate in
// this codebase.
import type { EvidenceResolutionResult } from './deal-exchange-model';

export type PublicPresentationClass = 'PRICED_DEAL' | 'SPECIAL' | 'REVIEW_REQUIRED' | 'NOT_PUBLIC';

export type PublicationDecisionSnapshot = 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'PRIVATE_ONLY' | null | undefined;

export interface OfferPublicationSnapshot {
  publicationDecision: PublicationDecisionSnapshot;
}

export interface PublicPresentation {
  presentationClass: PublicPresentationClass;
  // priceCopy is the ONLY place a price-shaped string is emitted. For SPECIAL it is always the
  // literal PRICE_ON_CONFIRMATION_LABEL below - never a number, never derived from any field -
  // so a SPECIAL listing can never fabricate a figure by construction, not just by convention.
  priceCopy: string | null;
  sourceCheckedCopy: string;
  reason: string;
}

// Public wording constants (CEO directive: use "Source checked", never "Vakaviti verified" without
// direct provider confirmation - which this deterministic-evidence pipeline never has by itself).
export const SOURCE_CHECKED_LABEL = 'Source checked';
export const PRICE_ON_CONFIRMATION_LABEL = 'Price on confirmation';

// Guarded by a test that scans this module's own source text for the forbidden phrase, so the
// constant can never be silently reintroduced. Not exported - existing only to give the guard test
// something concrete to assert never appears anywhere in this file's non-comment output paths.
const FORBIDDEN_LABEL = 'Vakaviti verified';
export function assertNoForbiddenLabel(): void {
  const generatedStrings = [SOURCE_CHECKED_LABEL, PRICE_ON_CONFIRMATION_LABEL];
  for (const s of generatedStrings) {
    if (s.includes(FORBIDDEN_LABEL)) {
      throw new Error('public-presentation.ts generated a forbidden "Vakaviti verified" claim');
    }
  }
}

export function derivePublicPresentation(
  offer: OfferPublicationSnapshot,
  resolvedEvidence: EvidenceResolutionResult
): PublicPresentation {
  if (offer.publicationDecision === 'PRIVATE_ONLY') {
    return {
      presentationClass: 'NOT_PUBLIC', priceCopy: null, sourceCheckedCopy: SOURCE_CHECKED_LABEL,
      reason: 'Offer is private-only by owner type - never shown publicly regardless of evidence.',
    };
  }
  if (offer.publicationDecision === 'NOT_ELIGIBLE') {
    return {
      presentationClass: 'NOT_PUBLIC', priceCopy: null, sourceCheckedCopy: SOURCE_CHECKED_LABEL,
      reason: 'publication_decision is NOT_ELIGIBLE - the sole authoritative gate has already excluded this offer.',
    };
  }
  if (offer.publicationDecision !== 'ELIGIBLE') {
    // null / undefined / any other value - never assume eligible in the absence of a decision.
    return {
      presentationClass: 'REVIEW_REQUIRED', priceCopy: null, sourceCheckedCopy: SOURCE_CHECKED_LABEL,
      reason: 'No authoritative publication_decision recorded yet.',
    };
  }

  if (resolvedEvidence.contradictingFields.length > 0) {
    // Defensive: evaluateOfferPublicationGates() already fails 'no_unresolved_contradiction' before
    // ELIGIBLE can be set, so this branch should be unreachable in practice - kept as a hard
    // fail-closed check anyway, since this function must never trust an upstream invariant blindly.
    return {
      presentationClass: 'REVIEW_REQUIRED', priceCopy: null, sourceCheckedCopy: SOURCE_CHECKED_LABEL,
      reason: 'ELIGIBLE but resolved evidence still shows an unresolved contradiction - never present publicly until resolved.',
    };
  }

  const priceField = resolvedEvidence.resolvedFields.price;
  const basisField = resolvedEvidence.resolvedFields.price_basis;
  const currencyField = resolvedEvidence.resolvedFields.currency;
  const priceShown = !priceField.isMissing && !priceField.isContradiction;

  if (priceShown) {
    if (basisField.isMissing || currencyField.isMissing || basisField.isContradiction || currencyField.isContradiction) {
      // Same defensive posture: evaluateOfferPublicationGates()'s 'supported_price_basis' gate
      // should have already blocked this combination from reaching ELIGIBLE - if it somehow did,
      // this function still refuses to display an unsupported price rather than guess a basis.
      return {
        presentationClass: 'REVIEW_REQUIRED', priceCopy: null, sourceCheckedCopy: SOURCE_CHECKED_LABEL,
        reason: 'Price is present but currency or basis is not fully resolved - never display an unsupported price.',
      };
    }
    return {
      presentationClass: 'PRICED_DEAL',
      priceCopy: `${currencyField.selectedValue} ${priceField.selectedValue} (${basisField.selectedValue})`,
      sourceCheckedCopy: SOURCE_CHECKED_LABEL,
      reason: 'Evidenced price, currency and basis all resolved and current.',
    };
  }

  // ELIGIBLE, no contradiction, no price shown: a genuine material benefit without an absolute
  // price. priceCopy is always the fixed label - never computed from any field.
  return {
    presentationClass: 'SPECIAL',
    priceCopy: PRICE_ON_CONFIRMATION_LABEL,
    sourceCheckedCopy: SOURCE_CHECKED_LABEL,
    reason: 'Evidenced material benefit without a resolved price.',
  };
}
