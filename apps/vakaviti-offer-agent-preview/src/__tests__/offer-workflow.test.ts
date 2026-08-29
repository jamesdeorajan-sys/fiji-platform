import { describe, it, expect, vi } from 'vitest';
import {
  runOfferWorkflow, runRecheckWorkflow, type WorkflowDependencies, type WorkflowOutcome, type RecheckSubject,
} from '../offer-workflow';

function makeDeps(overrides: Partial<WorkflowDependencies> = {}): WorkflowDependencies {
  const processed = new Map<string, WorkflowOutcome>();
  const auditEvents: any[] = [];
  const base: WorkflowDependencies = {
    fetchAgent: { fetch: vi.fn(async () => ({ ok: true, status: 200, body: '<html>deal</html>', contentType: 'text/html', classification: 'PROVIDER_RESPONSE' })) },
    extractionAgent: { extract: vi.fn(async () => ({ fields: { price: '199', currency: 'FJD' }, confidence: 1, rawExcerpts: { price: 'FJD 199' }, extractorModel: 'test-model', extractorVersion: 'v1' })) },
    normalizer: { canonicalizeUrl: (url: string) => url },
    evidenceStore: { record: vi.fn(async () => {}) },
    deduplicator: { computeIdentity: vi.fn(async () => 'identity-1'), findExisting: vi.fn(async () => null) },
    ruleEngine: { evaluate: vi.fn(() => ({ decision: 'ELIGIBLE' as const, passedGates: ['g1'], failedGates: [] })) },
    publisher: {
      publish: vi.fn(async () => ({ offerId: 'offer-1' })),
      sendToReview: vi.fn(async () => ({ offerId: 'offer-1' })),
    },
    rateLimiter: { tryAcquire: () => true },
    costBudget: { charge: () => true },
    idempotencyStore: {
      hasProcessed: async (key: string) => processed.has(key),
      markProcessed: async (key: string, outcome: WorkflowOutcome) => { processed.set(key, outcome); },
      getOutcome: async (key: string) => processed.get(key) ?? null,
    },
    auditor: { record: async (e: any) => { auditEvents.push(e); } },
    rechecker: { isDue: () => true },
    quarantiner: { quarantine: vi.fn(async () => {}) },
    clock: { now: () => '2026-08-29T00:00:00Z' },
  };
  return { ...base, ...overrides };
}

const input = { sourceId: 'src-1', url: 'https://provider.example/deal', idempotencyKey: 'key-1' };

describe('runOfferWorkflow', () => {
  it('publishes an eligible offer end to end', async () => {
    const deps = makeDeps();
    const outcome = await runOfferWorkflow(deps, input);
    expect(outcome).toEqual({ step: 'PUBLISHED', offerId: 'offer-1' });
    expect(deps.publisher.publish).toHaveBeenCalledOnce();
  });

  it('duplicate queue delivery of the SAME idempotency key is a no-op the second time - no re-fetch, no re-publish', async () => {
    const deps = makeDeps();
    const first = await runOfferWorkflow(deps, input);
    expect(first.step).toBe('PUBLISHED');
    const fetchCallsAfterFirst = (deps.fetchAgent.fetch as any).mock.calls.length;
    const publishCallsAfterFirst = (deps.publisher.publish as any).mock.calls.length;

    const second = await runOfferWorkflow(deps, input); // same idempotencyKey
    expect(second).toEqual({ step: 'ALREADY_PROCESSED' });
    expect((deps.fetchAgent.fetch as any).mock.calls.length).toBe(fetchCallsAfterFirst); // not called again
    expect((deps.publisher.publish as any).mock.calls.length).toBe(publishCallsAfterFirst); // not called again
  });

  it('a different idempotency key for the same URL is processed independently (not falsely deduped)', async () => {
    const deps = makeDeps();
    await runOfferWorkflow(deps, input);
    const second = await runOfferWorkflow(deps, { ...input, idempotencyKey: 'key-2' });
    expect(second.step).toBe('PUBLISHED');
    expect((deps.fetchAgent.fetch as any).mock.calls.length).toBe(2);
  });

  it('rate limiting short-circuits before any fetch, classified as a bounded retry', async () => {
    const deps = makeDeps({ rateLimiter: { tryAcquire: () => false } });
    const outcome = await runOfferWorkflow(deps, input);
    expect(outcome).toEqual({ step: 'RATE_LIMITED', retryClass: 'BOUNDED_RETRY' });
    expect(deps.fetchAgent.fetch).not.toHaveBeenCalled();
  });

  it('cost budget exhaustion short-circuits before any fetch, classified as a bounded retry', async () => {
    const deps = makeDeps({ costBudget: { charge: () => false } });
    const outcome = await runOfferWorkflow(deps, input);
    expect(outcome).toEqual({ step: 'BUDGET_EXCEEDED', retryClass: 'BOUNDED_RETRY' });
    expect(deps.fetchAgent.fetch).not.toHaveBeenCalled();
  });

  it('a timeout fetch failure is classified as a bounded retry (worth retrying)', async () => {
    const deps = makeDeps({ fetchAgent: { fetch: async () => ({ ok: false, classification: 'TIMEOUT' }) } });
    const outcome = await runOfferWorkflow(deps, input);
    expect(outcome).toEqual({ step: 'FETCH_FAILED', classification: 'TIMEOUT', retryClass: 'BOUNDED_RETRY' });
  });

  it('an access-denied fetch failure is classified as no-retry (will never succeed)', async () => {
    const deps = makeDeps({ fetchAgent: { fetch: async () => ({ ok: false, classification: 'ACCESS_DENIED' }) } });
    const outcome = await runOfferWorkflow(deps, input);
    expect(outcome).toEqual({ step: 'FETCH_FAILED', classification: 'ACCESS_DENIED', retryClass: 'NO_RETRY' });
  });

  it('extraction failure is no-retry and never reaches the rule engine or publisher', async () => {
    const deps = makeDeps({ extractionAgent: { extract: async () => null } });
    const outcome = await runOfferWorkflow(deps, input);
    expect(outcome).toEqual({ step: 'EXTRACTION_FAILED', retryClass: 'NO_RETRY' });
    expect(deps.ruleEngine.evaluate).not.toHaveBeenCalled();
    expect(deps.publisher.publish).not.toHaveBeenCalled();
  });

  it('a duplicate identity is skipped and never published a second time', async () => {
    const deps = makeDeps({ deduplicator: { computeIdentity: async () => 'id-1', findExisting: async () => ({ offerId: 'existing-offer' }) } });
    const outcome = await runOfferWorkflow(deps, input);
    expect(outcome).toEqual({ step: 'DUPLICATE_SKIPPED', existingOfferId: 'existing-offer' });
    expect(deps.publisher.publish).not.toHaveBeenCalled();
  });

  it('a NOT_ELIGIBLE gate result routes to review, never to publish', async () => {
    const deps = makeDeps({ ruleEngine: { evaluate: () => ({ decision: 'NOT_ELIGIBLE', passedGates: [], failedGates: ['supported_price_basis'] }) } });
    const outcome = await runOfferWorkflow(deps, input);
    expect(outcome).toEqual({ step: 'SENT_TO_REVIEW', offerId: 'offer-1', reasons: ['supported_price_basis'] });
    expect(deps.publisher.publish).not.toHaveBeenCalled();
    expect(deps.publisher.sendToReview).toHaveBeenCalledOnce();
  });
});

describe('runRecheckWorkflow', () => {
  const subject: RecheckSubject = {
    offerId: 'offer-1', sourceId: 'src-1', canonicalUrl: 'https://provider.example/deal',
    currentFacts: { price: '199' }, currentState: 'PUBLISHED',
  };

  it('does nothing when not due', async () => {
    const deps = makeDeps({ rechecker: { isDue: () => false } });
    const outcome = await runRecheckWorkflow(deps, subject);
    expect(outcome).toEqual({ step: 'NOT_DUE' });
    expect(deps.fetchAgent.fetch).not.toHaveBeenCalled();
  });

  it('still-eligible offers are updated without quarantine', async () => {
    const deps = makeDeps();
    const outcome = await runRecheckWorkflow(deps, subject);
    expect(outcome).toEqual({ step: 'STILL_ELIGIBLE_UPDATED' });
    expect(deps.quarantiner.quarantine).not.toHaveBeenCalled();
  });

  it('an expired offer is quarantined via the deterministic-rule authority path, with reasonCode EXPIRY', async () => {
    const deps = makeDeps({ ruleEngine: { evaluate: () => ({ decision: 'NOT_ELIGIBLE', passedGates: [], failedGates: ['not_expired'] }) } });
    const outcome = await runRecheckWorkflow(deps, subject);
    expect(outcome).toEqual({ step: 'QUARANTINED', reasonCode: 'EXPIRY' });
    expect(deps.quarantiner.quarantine).toHaveBeenCalledOnce();
    const [, transition] = (deps.quarantiner.quarantine as any).mock.calls[0];
    expect(transition.actorType).toBe('SYSTEM_DETERMINISTIC_RULE');
    expect(transition.reasonCode).toBe('EXPIRY');
    expect(transition.priorState).toBe('PUBLISHED');
    expect(transition.nextState).toBe('QUARANTINED');
  });

  it('a material-change eligibility failure quarantines with reasonCode MATERIAL_CHANGE', async () => {
    const deps = makeDeps({ ruleEngine: { evaluate: () => ({ decision: 'NOT_ELIGIBLE', passedGates: [], failedGates: ['no_unresolved_contradiction'] }) } });
    const outcome = await runRecheckWorkflow(deps, subject);
    expect(outcome).toEqual({ step: 'QUARANTINED', reasonCode: 'MATERIAL_CHANGE' });
  });

  it('a fetch failure during recheck never calls quarantine directly - it is surfaced for bounded retry instead', async () => {
    const deps = makeDeps({ fetchAgent: { fetch: async () => ({ ok: false, classification: 'TIMEOUT' }) } });
    const outcome = await runRecheckWorkflow(deps, subject);
    expect(outcome).toEqual({ step: 'FETCH_FAILED', classification: 'TIMEOUT', retryClass: 'BOUNDED_RETRY' });
    expect(deps.quarantiner.quarantine).not.toHaveBeenCalled();
  });
});
