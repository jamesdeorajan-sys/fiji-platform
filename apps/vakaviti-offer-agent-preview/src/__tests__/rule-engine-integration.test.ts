// Integration test for makeRuleEnginePort/resolveOfferAction together - the exact seam where a
// real bug was found live (2026-08-29): derivePublicOfferAction() and evaluateOfferPublicationGates()
// were each unit-tested and individually correct, but wiring a synthetic VAKAVITI_OWNED_SYSTEM
// booking_route evidence item into a PROVIDER_DIRECT-typed resolution was silently rejected by
// authoritativeSourceClassFor() (every field on a PROVIDER_DIRECT offer requires
// PROVIDER_OFFICIAL_PAGE evidence), so every offer still failed 'supported_booking_route' despite
// the action model correctly deciding VAKAVITI_ENQUIRY. This test exists so that class of
// integration bug cannot silently reappear.
import { describe, it, expect } from 'vitest';
import { makeRuleEnginePort } from '../adapters';

describe('makeRuleEnginePort + resolveOfferAction integration', () => {
  const port = makeRuleEnginePort('Test Provider', 'provider-1');

  // Rule test 1, end to end: authoritative offer + valid internal enquiry route + NO scraped
  // provider booking route (exactly the real-world case that broke) can still publish.
  it('1 (integration). ELIGIBLE via VAKAVITI_ENQUIRY when the page has NO extractable booking route at all', () => {
    const facts = {
      proposed_offer_name: 'Summer Special', factual_summary: 'A great deal', category: 'accommodation',
      fiji_location: 'Nadi', advertised_price: '199', reference_price: null, currency: 'FJD', price_basis: 'PER_PERSON',
      explicit_discount: null, promo_code: null, booking_deadline: '2026-12-31', travel_from: null, travel_until: null,
      offer_expires_at: null, blackout_dates: null, minimum_stay: null, minimum_group_size: null, eligibility: null,
      inclusions: 'Breakfast included', exclusions: null, cancellation_terms: null,
      booking_route: null, // <- the exact real-world gap: no clean single URI on the page
      seller_or_marketer: null,
    };
    const result = port.evaluate('https://provider.example/deal', facts, 'sf-test');
    expect(result.decision).toBe('ELIGIBLE');
    expect(result.passedGates).toContain('supported_booking_route');
    expect(result.failedGates).not.toContain('supported_booking_route');
  });

  it('still fails on OTHER gates normally - the fix does not silently paper over a genuine contradiction', () => {
    const facts = {
      proposed_offer_name: null, factual_summary: null, category: null, fiji_location: null,
      advertised_price: '199', reference_price: null, currency: null /* missing currency for a shown price */,
      price_basis: null, explicit_discount: null, promo_code: null, booking_deadline: null, travel_from: null,
      travel_until: null, offer_expires_at: null, blackout_dates: null, minimum_stay: null, minimum_group_size: null,
      eligibility: null, inclusions: null, exclusions: null, cancellation_terms: null, booking_route: null,
      seller_or_marketer: null,
    };
    const result = port.evaluate('https://provider.example/deal2', facts, 'sf-test');
    expect(result.decision).toBe('NOT_ELIGIBLE');
    expect(result.failedGates).toContain('supported_price_basis'); // genuinely missing currency/basis for a shown price
    expect(result.passedGates).toContain('supported_booking_route'); // booking-action model still passes independently
  });

  it('a genuinely ambiguous provider identity still fails via not_actionable, not silently passed', () => {
    // provider_identity is only populated for PROVIDER_DIRECT offers via the entities passed to
    // evaluateOfferPublicationGates(), not from these facts - ambiguity here is exercised directly
    // via a contradiction test in public-offer-action.test.ts; this integration test's job is only
    // to confirm the NOT_ACTIONABLE path still surfaces as a real failed gate end to end.
    const result = makeRuleEnginePort('', '')?.evaluate('', { advertised_price: null } as any, 'sf-test');
    expect(result.decision).toBe('NOT_ELIGIBLE'); // empty sourceUrl -> NOT_ACTIONABLE -> never ELIGIBLE
    expect(result.failedGates.some(g => g.startsWith('not_actionable'))).toBe(true);
  });
});
