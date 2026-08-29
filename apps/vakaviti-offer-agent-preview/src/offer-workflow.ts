// Phase A-R, item 9: executable workflow specification (CEO directive 2026-08-29).
//
// DISCOVER -> FETCH -> EXTRACT -> NORMALIZE -> EVIDENCE -> DEDUPLICATE -> RULE EVALUATION ->
// AUTO-PUBLISH OR REVIEW -> RECHECK -> UPDATE OR QUARANTINE, expressed as two functions
// (runOfferWorkflow covers DISCOVER..AUTO-PUBLISH OR REVIEW; runRecheckWorkflow covers
// RECHECK..UPDATE OR QUARANTINE) over an injected WorkflowDependencies bag. DISCOVER itself is not
// a step inside runOfferWorkflow - a DiscoveryProvider (discovery-providers.ts) supplies the
// candidate URL that becomes this function's input, keeping "propose a URL" and "process a URL"
// as separate concerns with separate authority.
//
// Every dependency is an interface, not a concrete Cloudflare binding - these functions run
// unmodified against fakes in a Phase A-R test and, unchanged, against real Queues/Workflows
// bindings once Phase B is separately authorized. No import in this file requires provisioned
// Cloudflare infrastructure.
import { quarantineOffer, type Actor, type QuarantineReasonCode, type OfferQuarantineState } from './authority-model';
import { buildDefaultEvidenceRecord, type DefaultEvidenceRecord } from './evidence-model';

export type RetryClass = 'BOUNDED_RETRY' | 'NO_RETRY';

export interface FetchPortResult {
  ok: boolean;
  status?: number;
  body?: string;
  contentType?: string | null;
  classification: string; // reuses safeFetchSource()'s existing classification vocabulary
  error?: string;
}
export interface FetchPort { fetch(url: string): Promise<FetchPortResult>; }

export interface ExtractionPortResult {
  fields: Record<string, string | null>;
  confidence: number;
  rawExcerpts: Record<string, string>;
  extractorModel: string;
  extractorVersion: string;
}
export interface ExtractionPort { extract(body: string, url: string): Promise<ExtractionPortResult | null>; }

export interface NormalizerPort { canonicalizeUrl(url: string): string; }

export interface EvidenceStorePort { record(evidence: DefaultEvidenceRecord): Promise<void>; }

export interface DeduplicatorPort {
  computeIdentity(canonicalUrl: string, sourceId: string, facts: Record<string, string | null>): Promise<string>;
  findExisting(identity: string): Promise<{ offerId: string } | null>;
}

export interface RuleEngineGateResult {
  decision: 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'PRIVATE_ONLY';
  passedGates: string[];
  failedGates: string[];
}
export interface RuleEnginePort {
  evaluate(canonicalUrl: string, facts: Record<string, string | null>, sourceId: string): RuleEngineGateResult;
}

export interface PublisherPort {
  publish(sourceId: string, canonicalUrl: string, facts: Record<string, string | null>): Promise<{ offerId: string }>;
  sendToReview(sourceId: string, canonicalUrl: string, facts: Record<string, string | null>, reasons: string[]): Promise<{ offerId: string }>;
}

export interface RateLimiterPort { tryAcquire(sourceId: string): boolean; }
export interface CostBudgetPort { charge(units: number): boolean; }

export interface IdempotencyStorePort {
  hasProcessed(key: string): Promise<boolean>;
  markProcessed(key: string, outcome: WorkflowOutcome): Promise<void>;
  getOutcome(key: string): Promise<WorkflowOutcome | null>;
}

export interface AuditorPort { record(event: { step: string; outcome: WorkflowOutcome; idempotencyKey: string }): Promise<void>; }

export interface RecheckSubject {
  offerId: string;
  sourceId: string;
  canonicalUrl: string;
  currentFacts: Record<string, string | null>;
  currentState: OfferQuarantineState;
}
export interface RecheckerPort { isDue(subject: RecheckSubject): boolean; }
export interface QuarantinerPort { quarantine(offerId: string, record: ReturnType<typeof quarantineOffer>): Promise<void>; }

export interface WorkflowDependencies {
  fetchAgent: FetchPort;
  extractionAgent: ExtractionPort;
  normalizer: NormalizerPort;
  evidenceStore: EvidenceStorePort;
  deduplicator: DeduplicatorPort;
  ruleEngine: RuleEnginePort;
  publisher: PublisherPort;
  rateLimiter: RateLimiterPort;
  costBudget: CostBudgetPort;
  idempotencyStore: IdempotencyStorePort;
  auditor: AuditorPort;
  rechecker: RecheckerPort;
  quarantiner: QuarantinerPort;
  clock: { now(): string };
}

export interface OfferWorkflowInput {
  sourceId: string;
  url: string;
  idempotencyKey: string; // caller-supplied, deterministic (e.g. `${sourceId}:${canonicalUrl}:${scanWindow}`)
}

export type WorkflowOutcome =
  | { step: 'ALREADY_PROCESSED' }
  | { step: 'RATE_LIMITED'; retryClass: RetryClass }
  | { step: 'BUDGET_EXCEEDED'; retryClass: RetryClass }
  | { step: 'FETCH_FAILED'; classification: string; retryClass: RetryClass }
  | { step: 'EXTRACTION_FAILED'; retryClass: RetryClass }
  | { step: 'DUPLICATE_SKIPPED'; existingOfferId: string }
  | { step: 'PUBLISHED'; offerId: string }
  | { step: 'SENT_TO_REVIEW'; offerId: string; reasons: string[] };

// Fetch failures this codebase already knows are worth retrying (timeouts, Cloudflare edge
// hiccups) vs. ones that will never succeed on retry (access denied, unsupported content) -
// mirrors safeFetchSource()'s existing classification vocabulary rather than inventing a new one.
const RETRYABLE_FETCH_CLASSIFICATIONS = new Set(['TIMEOUT', 'CLOUDFLARE_EGRESS_FAILURE', 'DNS_FAILURE', 'TLS_FAILURE', 'PROVIDER_RESPONSE']);

export async function runOfferWorkflow(deps: WorkflowDependencies, input: OfferWorkflowInput): Promise<WorkflowOutcome> {
  // Idempotency first, before any side effect - a duplicate queue delivery of the exact same key
  // must never re-fetch, re-charge budget, or re-publish.
  if (await deps.idempotencyStore.hasProcessed(input.idempotencyKey)) {
    return { step: 'ALREADY_PROCESSED' };
  }

  const finish = async (outcome: WorkflowOutcome): Promise<WorkflowOutcome> => {
    await deps.idempotencyStore.markProcessed(input.idempotencyKey, outcome);
    await deps.auditor.record({ step: outcome.step, outcome, idempotencyKey: input.idempotencyKey });
    return outcome;
  };

  if (!deps.rateLimiter.tryAcquire(input.sourceId)) {
    return finish({ step: 'RATE_LIMITED', retryClass: 'BOUNDED_RETRY' });
  }
  if (!deps.costBudget.charge(1)) {
    return finish({ step: 'BUDGET_EXCEEDED', retryClass: 'BOUNDED_RETRY' });
  }

  const fetchResult = await deps.fetchAgent.fetch(input.url);
  if (!fetchResult.ok) {
    const retryClass: RetryClass = RETRYABLE_FETCH_CLASSIFICATIONS.has(fetchResult.classification) ? 'BOUNDED_RETRY' : 'NO_RETRY';
    return finish({ step: 'FETCH_FAILED', classification: fetchResult.classification, retryClass });
  }

  const canonicalUrl = deps.normalizer.canonicalizeUrl(input.url);
  const extraction = await deps.extractionAgent.extract(fetchResult.body ?? '', canonicalUrl);
  if (!extraction) {
    return finish({ step: 'EXTRACTION_FAILED', retryClass: 'NO_RETRY' }); // a page nothing could be read from will not improve on retry
  }

  await deps.evidenceStore.record(buildDefaultEvidenceRecord({
    canonicalUrl, checkedAt: deps.clock.now(), httpStatus: fetchResult.status ?? 0,
    httpContentType: fetchResult.contentType ?? null, contentHash: await sha256Hex(fetchResult.body ?? ''),
    structuredFacts: extraction.fields, rawExcerpts: extraction.rawExcerpts,
    extractorModel: extraction.extractorModel, extractorVersion: extraction.extractorVersion,
    ruleResults: [], // filled in after rule evaluation below, via a second evidence write in a full implementation
  }));

  const identity = await deps.deduplicator.computeIdentity(canonicalUrl, input.sourceId, extraction.fields);
  const existing = await deps.deduplicator.findExisting(identity);
  if (existing) {
    return finish({ step: 'DUPLICATE_SKIPPED', existingOfferId: existing.offerId });
  }

  const gate = deps.ruleEngine.evaluate(canonicalUrl, extraction.fields, input.sourceId);
  if (gate.decision === 'ELIGIBLE') {
    const { offerId } = await deps.publisher.publish(input.sourceId, canonicalUrl, extraction.fields);
    return finish({ step: 'PUBLISHED', offerId });
  }
  const { offerId } = await deps.publisher.sendToReview(input.sourceId, canonicalUrl, extraction.fields, gate.failedGates);
  return finish({ step: 'SENT_TO_REVIEW', offerId, reasons: gate.failedGates });
}

// --- RECHECK -> UPDATE OR QUARANTINE --------------------------------------------------------------
export type RecheckOutcome =
  | { step: 'NOT_DUE' }
  | { step: 'FETCH_FAILED'; classification: string; retryClass: RetryClass }
  | { step: 'STILL_ELIGIBLE_UPDATED' }
  | { step: 'QUARANTINED'; reasonCode: QuarantineReasonCode };

export async function runRecheckWorkflow(deps: WorkflowDependencies, subject: RecheckSubject): Promise<RecheckOutcome> {
  if (!deps.rechecker.isDue(subject)) return { step: 'NOT_DUE' };

  const fetchResult = await deps.fetchAgent.fetch(subject.canonicalUrl);
  if (!fetchResult.ok) {
    const retryClass: RetryClass = RETRYABLE_FETCH_CLASSIFICATIONS.has(fetchResult.classification) ? 'BOUNDED_RETRY' : 'NO_RETRY';
    return { step: 'FETCH_FAILED', classification: fetchResult.classification, retryClass };
  }

  const extraction = await deps.extractionAgent.extract(fetchResult.body ?? '', subject.canonicalUrl);
  const freshFacts = extraction?.fields ?? {};
  const gate = deps.ruleEngine.evaluate(subject.canonicalUrl, freshFacts, subject.sourceId);

  if (gate.decision === 'ELIGIBLE') {
    return { step: 'STILL_ELIGIBLE_UPDATED' };
  }

  // Only the two reason codes the deterministic rule is authorized to use (authority-model.ts) -
  // an eligibility failure that is neither is treated as MATERIAL_CHANGE, the more conservative of
  // the two, rather than inventing a third automated reason code here.
  const reasonCode: QuarantineReasonCode = gate.failedGates.includes('not_expired') ? 'EXPIRY' : 'MATERIAL_CHANGE';
  const actor: Actor = { type: 'SYSTEM_DETERMINISTIC_RULE', id: 'expiry-quarantine-rule' };
  const transition = quarantineOffer(actor, subject.currentState, reasonCode, `Recheck failed gates: ${gate.failedGates.join(', ')}`, deps.clock.now);
  await deps.quarantiner.quarantine(subject.offerId, transition);
  return { step: 'QUARANTINED', reasonCode };
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
