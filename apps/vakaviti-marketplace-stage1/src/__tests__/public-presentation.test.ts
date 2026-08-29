import { describe, it, expect } from 'vitest';
import {
  derivePublicPresentation, SOURCE_CHECKED_LABEL, PRICE_ON_CONFIRMATION_LABEL, assertNoForbiddenLabel,
} from '../public-presentation';
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

describe('derivePublicPresentation', () => {
  it('NOT_PUBLIC for PRIVATE_ONLY regardless of evidence', () => {
    const r = derivePublicPresentation({ publicationDecision: 'PRIVATE_ONLY' }, resolved());
    expect(r.presentationClass).toBe('NOT_PUBLIC');
    expect(r.priceCopy).toBeNull();
  });

  it('NOT_PUBLIC for NOT_ELIGIBLE', () => {
    const r = derivePublicPresentation({ publicationDecision: 'NOT_ELIGIBLE' }, resolved());
    expect(r.presentationClass).toBe('NOT_PUBLIC');
  });

  it('REVIEW_REQUIRED when publication_decision is absent (never assumes eligible)', () => {
    const r = derivePublicPresentation({ publicationDecision: null }, resolved());
    expect(r.presentationClass).toBe('REVIEW_REQUIRED');
  });

  it('PRICED_DEAL requires evidenced price, currency AND basis all resolved', () => {
    const ev = resolved({
      price: { isMissing: false, selectedValue: '199' },
      currency: { isMissing: false, selectedValue: 'FJD' },
      price_basis: { isMissing: false, selectedValue: 'PER_PERSON' },
    });
    const r = derivePublicPresentation({ publicationDecision: 'ELIGIBLE' }, ev);
    expect(r.presentationClass).toBe('PRICED_DEAL');
    expect(r.priceCopy).toBe('FJD 199 (PER_PERSON)');
  });

  it('does NOT produce PRICED_DEAL if price is present but basis is missing (never fabricates a basis)', () => {
    const ev = resolved({
      price: { isMissing: false, selectedValue: '199' },
      currency: { isMissing: false, selectedValue: 'FJD' },
      // price_basis left missing
    });
    const r = derivePublicPresentation({ publicationDecision: 'ELIGIBLE' }, ev);
    expect(r.presentationClass).not.toBe('PRICED_DEAL');
    expect(r.presentationClass).toBe('REVIEW_REQUIRED');
  });

  it('SPECIAL when ELIGIBLE with no price shown, and priceCopy is exactly the fixed confirmation label - never a number', () => {
    const r = derivePublicPresentation({ publicationDecision: 'ELIGIBLE' }, resolved());
    expect(r.presentationClass).toBe('SPECIAL');
    expect(r.priceCopy).toBe(PRICE_ON_CONFIRMATION_LABEL);
    expect(r.priceCopy).toBe('Price on confirmation');
    expect(/\d/.test(r.priceCopy!)).toBe(false); // SPECIAL never contains a digit - never a fabricated figure
  });

  it('REVIEW_REQUIRED if ELIGIBLE but a contradiction somehow remains (defensive fail-closed)', () => {
    const ev = resolved({ price: { isMissing: true, isContradiction: true } });
    const r = derivePublicPresentation({ publicationDecision: 'ELIGIBLE' }, ev);
    expect(r.presentationClass).toBe('REVIEW_REQUIRED');
  });

  it('every branch uses the exact "Source checked" label', () => {
    const decisions: EvidenceResolutionResult['offerOwnerType'][] = [];
    const cases: [any, EvidenceResolutionResult][] = [
      ['PRIVATE_ONLY', resolved()], ['NOT_ELIGIBLE', resolved()], [null, resolved()],
      ['ELIGIBLE', resolved()],
    ];
    for (const [decision, ev] of cases) {
      const r = derivePublicPresentation({ publicationDecision: decision }, ev);
      expect(r.sourceCheckedCopy).toBe(SOURCE_CHECKED_LABEL);
      expect(r.sourceCheckedCopy).toBe('Source checked');
    }
  });

  it('no output string ever contains the forbidden "Vakaviti verified" claim, across every branch', () => {
    assertNoForbiddenLabel();
    const decisions: any[] = ['PRIVATE_ONLY', 'NOT_ELIGIBLE', null, undefined, 'ELIGIBLE'];
    const evidenceVariants: EvidenceResolutionResult[] = [
      resolved(),
      resolved({ price: { isMissing: false, selectedValue: '199' }, currency: { isMissing: false, selectedValue: 'FJD' }, price_basis: { isMissing: false, selectedValue: 'PER_PERSON' } }),
      resolved({ price: { isMissing: true, isContradiction: true } }),
    ];
    for (const decision of decisions) {
      for (const ev of evidenceVariants) {
        const r = derivePublicPresentation({ publicationDecision: decision }, ev);
        expect(r.sourceCheckedCopy.includes('Vakaviti verified')).toBe(false);
        expect((r.priceCopy ?? '').includes('Vakaviti verified')).toBe(false);
        expect(r.reason.includes('Vakaviti verified')).toBe(false);
      }
    }
  });
});
