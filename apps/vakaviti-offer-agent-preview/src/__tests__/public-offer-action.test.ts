import { describe, it, expect } from 'vitest';
import { derivePublicOfferAction, buildVakavitiEnquiryRoute, type OfferActionSnapshot } from '../public-offer-action';
import type { EvidenceResolutionResult, ResolvedField, MaterialField } from '../deal-exchange-model';
import { ALL_MATERIAL_FIELDS } from '../deal-exchange-model';

function resolved(overrides: Partial<Record<MaterialField, Partial<ResolvedField>>> = {}): EvidenceResolutionResult {
  const resolvedFields = {} as Record<MaterialField, ResolvedField>;
  for (const f of ALL_MATERIAL_FIELDS) {
    resolvedFields[f] = {
      field: f, selectedValue: null, selectedSourceClass: null, selectedSourceUrl: null,
      selectionReason: 'test default', isMissing: true, isStale: false, isContradiction: false,
      rejectedEvidence: [], ...overrides[f],
    };
  }
  const missingFields = ALL_MATERIAL_FIELDS.filter(f => resolvedFields[f].isMissing);
  const contradictingFields = ALL_MATERIAL_FIELDS.filter(f => resolvedFields[f].isContradiction);
  return {
    offerOwnerType: 'PROVIDER_DIRECT', resolvedFields,
    supportedFields: ALL_MATERIAL_FIELDS.filter(f => !resolvedFields[f].isMissing),
    missingFields, staleFields: [], contradictingFields,
  };
}

const validEnquiryRoute = 'https://vakaviti-offer-agent-preview.helpronline.workers.dev/enquire/offer-1';
const validProviderRoute = 'https://provider.example/book';
const validSourceUrl = 'https://provider.example/deals';

function offer(overrides: Partial<OfferActionSnapshot> = {}): OfferActionSnapshot {
  return { sourceUrl: validSourceUrl, vakavitiEnquiryRoute: validEnquiryRoute, providerBookingRoute: null, ...overrides };
}

describe('derivePublicOfferAction', () => {
  // Rule test 1: authoritative offer + valid internal enquiry route + NO provider route can publish.
  it('1. publishes VAKAVITI_ENQUIRY with a valid enquiry route and no provider route at all', () => {
    const r = derivePublicOfferAction(offer({ providerBookingRoute: null }), resolved(), 'preview');
    expect(r.actionType).toBe('VAKAVITI_ENQUIRY');
    expect(r.selectedRoute).toBe(validEnquiryRoute);
  });

  // Rule test 2: missing source_url cannot publish.
  it('2. NOT_ACTIONABLE when source_url is missing, regardless of how good everything else is', () => {
    const r = derivePublicOfferAction(offer({ sourceUrl: null }), resolved(), 'preview');
    expect(r.actionType).toBe('NOT_ACTIONABLE');
    expect(r.reason).toMatch(/source_url/);
  });

  // Rule test 3: ambiguous provider/seller cannot publish.
  it('3. NOT_ACTIONABLE when provider identity is contradicted across sources', () => {
    const ev = resolved({ provider_identity: { isContradiction: true, isMissing: false } });
    const r = derivePublicOfferAction(offer(), ev, 'preview');
    expect(r.actionType).toBe('NOT_ACTIONABLE');
    expect(r.reason).toMatch(/identity/i);
  });
  it('3b. NOT_ACTIONABLE when seller identity is contradicted across sources', () => {
    const ev = resolved({ seller_identity: { isContradiction: true, isMissing: false } });
    const r = derivePublicOfferAction(offer(), ev, 'preview');
    expect(r.actionType).toBe('NOT_ACTIONABLE');
  });

  // Rule test 6: unsafe external route is ignored for VAKAVITI_ENQUIRY.
  it('6. an unsafe/malformed provider_booking_route never blocks or affects the default VAKAVITI_ENQUIRY path', () => {
    const r = derivePublicOfferAction(offer({ providerBookingRoute: 'https://a.example | tel:+679' }), resolved(), 'preview');
    expect(r.actionType).toBe('VAKAVITI_ENQUIRY');
    expect(r.selectedRoute).toBe(validEnquiryRoute);
  });

  // Rule test 7: unsafe external route fails PROVIDER_DIRECT.
  it('7. an unsafe/malformed provider_booking_route fails an explicitly-selected PROVIDER_DIRECT', () => {
    const r = derivePublicOfferAction(offer({ requestedActionType: 'PROVIDER_DIRECT', providerBookingRoute: 'https://a.example | tel:+679' }), resolved(), 'preview');
    expect(r.actionType).toBe('NOT_ACTIONABLE');
    expect(r.reason).toMatch(/invalid/);
  });
  it('7b. a MISSING provider_booking_route also fails an explicitly-selected PROVIDER_DIRECT (never falls back to VAKAVITI_ENQUIRY)', () => {
    const r = derivePublicOfferAction(offer({ requestedActionType: 'PROVIDER_DIRECT', providerBookingRoute: null }), resolved(), 'preview');
    expect(r.actionType).toBe('NOT_ACTIONABLE');
    expect(r.selectedRoute).toBeNull();
  });
  it('7c. PROVIDER_DIRECT succeeds with a genuinely valid provider_booking_route', () => {
    const r = derivePublicOfferAction(offer({ requestedActionType: 'PROVIDER_DIRECT', providerBookingRoute: validProviderRoute }), resolved(), 'preview');
    expect(r.actionType).toBe('PROVIDER_DIRECT');
    expect(r.selectedRoute).toBe(validProviderRoute);
  });

  // Rule test 8: source_url is never silently used as a booking route.
  it('8. selectedRoute never equals sourceUrl under any outcome, even when vakavitiEnquiryRoute is missing', () => {
    const r1 = derivePublicOfferAction(offer({ vakavitiEnquiryRoute: null }), resolved(), 'preview');
    expect(r1.actionType).toBe('NOT_ACTIONABLE');
    expect(r1.selectedRoute).not.toBe(validSourceUrl);
    expect(r1.selectedRoute).toBeNull(); // never silently falls back to source_url instead of failing

    const r2 = derivePublicOfferAction(offer({ requestedActionType: 'PROVIDER_DIRECT', providerBookingRoute: null }), resolved(), 'preview');
    expect(r2.selectedRoute).not.toBe(validSourceUrl);

    const r3 = derivePublicOfferAction(offer(), resolved(), 'preview');
    expect(r3.selectedRoute).not.toBe(validSourceUrl);
  });

  it('missing vakaviti_enquiry_route fails the default path with a clear reason, never fabricating one', () => {
    const r = derivePublicOfferAction(offer({ vakavitiEnquiryRoute: null }), resolved(), 'preview');
    expect(r.actionType).toBe('NOT_ACTIONABLE');
    expect(r.reason).toMatch(/vakaviti_enquiry_route/);
  });

  it('an invalid (malformed) vakaviti_enquiry_route also fails, not just a missing one', () => {
    const r = derivePublicOfferAction(offer({ vakavitiEnquiryRoute: 'not a url | injected' }), resolved(), 'preview');
    expect(r.actionType).toBe('NOT_ACTIONABLE');
  });

  it('environment is threaded through into the reason but does not change the gating outcome for identical inputs', () => {
    const rPreview = derivePublicOfferAction(offer(), resolved(), 'preview');
    const rProd = derivePublicOfferAction(offer(), resolved(), 'production');
    expect(rPreview.actionType).toBe(rProd.actionType);
    expect(rPreview.selectedRoute).toBe(rProd.selectedRoute);
  });
});

describe('buildVakavitiEnquiryRoute', () => {
  it('deterministically builds a route from a base URL and offer id, never touching source_url', () => {
    expect(buildVakavitiEnquiryRoute('https://vakaviti-offer-agent-preview.helpronline.workers.dev', 'offer-1'))
      .toBe('https://vakaviti-offer-agent-preview.helpronline.workers.dev/enquire/offer-1');
    // trailing slash on base is tolerated
    expect(buildVakavitiEnquiryRoute('https://example.com/', 'offer-2')).toBe('https://example.com/enquire/offer-2');
  });
});
