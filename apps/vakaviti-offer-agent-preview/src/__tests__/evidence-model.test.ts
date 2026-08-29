import { describe, it, expect } from 'vitest';
import { buildDefaultEvidenceRecord, requestEvidenceEscalation, MAX_EXCERPT_CHARS } from '../evidence-model';

describe('buildDefaultEvidenceRecord', () => {
  const base = {
    canonicalUrl: 'https://provider.example/deal', checkedAt: '2026-08-29T00:00:00Z',
    httpStatus: 200, httpContentType: 'text/html', contentHash: 'abc123',
    structuredFacts: { price: '199', currency: 'FJD' },
    extractorModel: '@cf/meta/llama-3.1-8b-instruct-fp8', extractorVersion: 'v1',
    ruleResults: [{ gate: 'no_prompt_injection', passed: true }],
  };

  it('never contains a full-HTML or screenshot field - the type has none, and the builder does not add one', () => {
    const record: any = buildDefaultEvidenceRecord({ ...base, rawExcerpts: { price: 'Book now for FJD 199 per person.' } });
    expect(record.fullHtml).toBeUndefined();
    expect(record.screenshotKey).toBeUndefined();
    expect(record.images).toBeUndefined();
    expect(Object.keys(record).sort()).toEqual(
      ['canonicalUrl', 'checkedAt', 'contentHash', 'extractorModel', 'extractorVersion', 'httpContentType', 'httpStatus', 'ruleResults', 'shortExcerpts', 'structuredFacts'].sort()
    );
  });

  it('truncates an excerpt longer than MAX_EXCERPT_CHARS and never stores the full text', () => {
    const longExcerpt = 'A'.repeat(1000);
    const record = buildDefaultEvidenceRecord({ ...base, rawExcerpts: { factual_summary: longExcerpt } });
    expect(record.shortExcerpts.factual_summary.length).toBe(MAX_EXCERPT_CHARS);
    expect(record.shortExcerpts.factual_summary.length).toBeLessThan(longExcerpt.length);
  });

  it('leaves a short excerpt untouched', () => {
    const record = buildDefaultEvidenceRecord({ ...base, rawExcerpts: { price: 'FJD 199' } });
    expect(record.shortExcerpts.price).toBe('FJD 199');
  });
});

describe('requestEvidenceEscalation (optional, never automatic)', () => {
  it('requires a non-empty reason', () => {
    expect(() => requestEvidenceEscalation(
      { offerOrSourceId: 'off-1', escalationReason: '', requestedByActorId: 'ceo-1', contentType: 'FULL_HTML_SNAPSHOT' },
      'r2-key-1'
    )).toThrow(/non-empty reason/i);
    expect(() => requestEvidenceEscalation(
      { offerOrSourceId: 'off-1', escalationReason: '   ', requestedByActorId: 'ceo-1', contentType: 'FULL_HTML_SNAPSHOT' },
      'r2-key-1'
    )).toThrow(/non-empty reason/i);
  });

  it('succeeds with an explicit reason and produces a record structurally separate from DefaultEvidenceRecord', () => {
    const escalation = requestEvidenceEscalation(
      { offerOrSourceId: 'off-1', escalationReason: 'Provider disputed the extracted price - full snapshot needed for reconciliation.', requestedByActorId: 'ceo-1', contentType: 'FULL_HTML_SNAPSHOT' },
      'r2-key-1', () => 'T0'
    );
    expect(escalation.r2ObjectKey).toBe('r2-key-1');
    expect(escalation.requestedAt).toBe('T0');
    expect(escalation.contentType).toBe('FULL_HTML_SNAPSHOT');
  });
});
