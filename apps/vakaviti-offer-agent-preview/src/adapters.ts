// Concrete, Cloudflare-backed implementations of offer-workflow.ts's port interfaces. Every
// function here either calls a REUSED, unmodified function from the existing codebase
// (safeFetchSource, extractOfferFacts, canonicalizeUrl, computeOfferFingerprint,
// evaluateOfferPublicationGates, resolveEvidenceBundle) or does straightforward D1 I/O around one.
import type { Env } from './env';
import { safeFetchSource, extractOfferFacts, fingerprint } from './deal-agent';
import { canonicalizeUrl } from './deal-quality';
import {
  resolveEvidenceBundle, evaluateOfferPublicationGates, computeOfferFingerprint,
  generatePublicLabel, type EvidenceItem, type MaterialField, type OfferOwnerType,
  type EvidenceResolutionResult,
} from './deal-exchange-model';
import { validateBookingRoute } from './booking-route-safety';
import { buildDefaultEvidenceRecord, type DefaultEvidenceRecord } from './evidence-model';
import { derivePublicOfferAction, buildVakavitiEnquiryRoute, type PublicOfferActionResult } from './public-offer-action';
import type {
  FetchPort, FetchPortResult, ExtractionPort, ExtractionPortResult, NormalizerPort,
  EvidenceStorePort, DeduplicatorPort, RuleEnginePort, RuleEngineGateResult, RateLimiterPort,
  CostBudgetPort, IdempotencyStorePort, AuditorPort, WorkflowOutcome,
} from './offer-workflow';

/** Deterministic, synchronous (no crypto.subtle - RuleEnginePort.evaluate() is sync by contract),
 * content-derived id: same (sourceId, canonicalUrl) always yields the same offer id, so
 * makeRuleEnginePort and makePublisherPort/insertOffer independently arrive at the IDENTICAL id
 * without any change to offer-workflow.ts's fixed port interfaces or extra state smuggled between
 * them. Good enough uniqueness for this preview's scale - not a cryptographic hash, and not used
 * anywhere dedup/security-sensitive (computeOfferFingerprint(), unrelated and unchanged, still owns
 * real deduplication). */
export function deterministicOfferId(sourceId: string, canonicalUrl: string): string {
  const basis = `${sourceId}::${canonicalUrl}`;
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < basis.length; i++) {
    const ch = basis.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = (h1 ^ (h1 >>> 16)) >>> 0;
  h2 = (h2 ^ (h2 >>> 16)) >>> 0;
  return `offer-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

const EXTRACTION_TO_MATERIAL_FIELD: Partial<Record<string, MaterialField>> = {
  advertised_price: 'price', currency: 'currency', price_basis: 'price_basis',
  booking_deadline: 'booking_deadline', inclusions: 'inclusions', booking_route: 'booking_route',
  fiji_location: 'locality',
};

export function makeFetchPort(): FetchPort {
  return {
    async fetch(url: string): Promise<FetchPortResult> {
      const result = await safeFetchSource(url);
      return {
        ok: result.ok, status: result.status, body: result.body,
        contentType: result.ok ? 'text/html' : null, classification: result.classification,
        error: result.error,
      };
    },
  };
}

export function makeExtractionPort(env: Env): ExtractionPort {
  return {
    async extract(body: string, url: string): Promise<ExtractionPortResult | null> {
      const result = await extractOfferFacts(env as any, body, url);
      if (!result) return null;
      const rawExcerpts: Record<string, string> = {};
      for (const [k, v] of Object.entries(result.fields)) {
        if (v) rawExcerpts[k] = v;
      }
      return {
        fields: result.fields, confidence: result.confidence, rawExcerpts,
        extractorModel: '@cf/meta/llama-3.1-8b-instruct-fp8', extractorVersion: 'v1',
      };
    },
  };
}

export function makeNormalizerPort(): NormalizerPort {
  return { canonicalizeUrl: (url: string) => canonicalizeUrl(url) };
}

export function makeEvidenceStorePort(env: Env, offerIdForRecord: () => string | null): EvidenceStorePort {
  return {
    async record(evidence: DefaultEvidenceRecord): Promise<void> {
      const offerId = offerIdForRecord();
      if (!offerId) return; // no offer exists yet (e.g. a review-only candidate) - nothing to attach evidence to
      for (const [field, value] of Object.entries(evidence.structuredFacts)) {
        if (value === null || value === undefined) continue;
        await env.DB.prepare(
          `INSERT INTO deal_exchange_evidence (id, offer_id, field, value, source_class, source_url, checked_at) VALUES (?,?,?,?,?,?,?)`
        ).bind(crypto.randomUUID(), offerId, field, value, 'PROVIDER_OFFICIAL_PAGE', evidence.canonicalUrl, evidence.checkedAt).run();
      }
    },
  };
}

export function makeDeduplicatorPort(env: Env): DeduplicatorPort {
  return {
    async computeIdentity(canonicalUrl: string, sourceId: string, facts: Record<string, string | null>): Promise<string> {
      return computeOfferFingerprint('PROVIDER_DIRECT', sourceId, null, canonicalUrl, facts);
    },
    async findExisting(identity: string): Promise<{ offerId: string } | null> {
      const row = await env.DB.prepare(`SELECT id FROM deal_exchange_offers WHERE fingerprint=?`).bind(identity).first<any>();
      return row ? { offerId: row.id } : null;
    },
  };
}

/** Builds the EvidenceItem[] this specific extraction supports, all as PROVIDER_OFFICIAL_PAGE class
 * (every seed source family this phase is an official provider page, never a seller/aggregator). */
export function factsToEvidenceItems(facts: Record<string, string | null>, canonicalUrl: string, checkedAt: string): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  for (const [rawField, value] of Object.entries(facts)) {
    const field = EXTRACTION_TO_MATERIAL_FIELD[rawField];
    if (!field || value === null) continue;
    items.push({ field, value, sourceClass: 'PROVIDER_OFFICIAL_PAGE', sourceUrl: canonicalUrl, checkedAt });
  }
  return items;
}

// --- Phase 7A: the booking-action layer, shared by the rule-engine port and the publisher so both
// independently re-derive the IDENTICAL decision from the identical inputs, rather than smuggling
// extra state across offer-workflow.ts's fixed port interfaces. ---------------------------------
const OFFER_AGENT_PREVIEW_BASE_URL = 'https://vakaviti-offer-agent-preview.helpronline.workers.dev';

export interface ResolvedOfferAction {
  action: PublicOfferActionResult;
  resolution: EvidenceResolutionResult; // the FINAL resolution (post action-decision), fed to evaluateOfferPublicationGates
}

export function resolveOfferAction(sourceId: string, canonicalUrl: string, facts: Record<string, string | null>): ResolvedOfferAction {
  const offerId = deterministicOfferId(sourceId, canonicalUrl);
  const now = new Date().toISOString();
  // booking_route is deliberately EXCLUDED from the evidence set fed to resolveEvidenceBundle().
  // authoritativeSourceClassFor() ties every field's required evidence class to the offer's OWNER
  // TYPE (PROVIDER_OFFICIAL_PAGE for every field of a PROVIDER_DIRECT offer) - there is no existing
  // owner type where "most facts come from the provider but the booking route is Vakaviti-sourced,"
  // so a synthetic VAKAVITI_OWNED_SYSTEM evidence item for booking_route would be silently rejected
  // as non-authoritative for this owner type (confirmed by live evidence: it was, on the first cut
  // of this fix). "Which action type applies" is a system-level routing decision, not a material
  // fact requiring provider-page evidence, so it is evaluated entirely separately below - never by
  // feeding fabricated evidence into the canonical, unmodified evidence-authority system.
  const evidence = factsToEvidenceItems(facts, canonicalUrl, now).filter(e => e.field !== 'booking_route');
  const resolution = resolveEvidenceBundle({ offerOwnerType: 'PROVIDER_DIRECT', evidence, freshnessWindowHours: 24, now });

  const vakavitiEnquiryRoute = buildVakavitiEnquiryRoute(OFFER_AGENT_PREVIEW_BASE_URL, offerId);
  const action = derivePublicOfferAction(
    { sourceUrl: canonicalUrl, vakavitiEnquiryRoute, providerBookingRoute: facts.booking_route ?? null },
    resolution, 'preview'
  );
  return { action, resolution };
}

export function makeRuleEnginePort(providerName: string, providerId: string): RuleEnginePort {
  return {
    evaluate(canonicalUrl: string, facts: Record<string, string | null>, sourceId: string): RuleEngineGateResult {
      const now = new Date().toISOString();
      const { action, resolution } = resolveOfferAction(sourceId, canonicalUrl, facts);
      const priceShown = !resolution.resolvedFields.price.isMissing;
      const result = evaluateOfferPublicationGates({
        offerOwnerType: 'PROVIDER_DIRECT',
        entities: {
          providerId, providerName, sellerId: null, sellerName: null,
          fulfilmentOperatorId: null, fulfilmentOperatorName: null, bookingRecipient: null, enquiryHandler: null,
        },
        resolution, sourceUrl: canonicalUrl, isDuplicateOfId: null,
        requiresPriceBasis: priceShown, requiresOccupancyBasis: false, requiresValidityForRequestedDates: false,
        freshnessWindowHours: 24, checkedAt: now,
      });

      // Every OTHER gate (price/currency/basis/dates/contradiction/duplicate/freshness/identity) is
      // taken verbatim from the unmodified canonical function above - this is the ONLY line that
      // touches its output, replacing its 'supported_booking_route' verdict (which is always FALSE
      // here, since booking_route evidence is never fed to it) with the booking-ACTION model's own
      // verdict instead.
      const passedGates = result.passedGates.filter(g => g !== 'supported_booking_route');
      const failedGates = result.failedGates.filter(g => g !== 'supported_booking_route');
      if (action.actionType === 'NOT_ACTIONABLE') {
        failedGates.push(`not_actionable: ${action.reason}`);
      } else {
        passedGates.push('supported_booking_route');
      }
      const decision = failedGates.length === 0 ? 'ELIGIBLE' : 'NOT_ELIGIBLE';
      return { decision, passedGates, failedGates };
    },
  };
}

export function makeRateLimiterPort(env: Env): RateLimiterPort {
  // Synchronous interface, D1 check done just-in-time by the caller before invoking the workflow
  // (see queue consumers in index.ts) - kept here as a trivial always-true pass-through so
  // offer-workflow.ts's signature stays synchronous per its DI contract; the REAL per-source
  // rate-limit gate (offer_source_families.rate_limit_per_hour vs. a rolling count) is enforced in
  // the discovery-agent.ts tick that decides which families are due to be scanned at all - a family
  // over its rate limit is simply not selected for this cycle, which is a stronger guarantee than a
  // per-message check.
  return { tryAcquire: () => true };
}

export function makeCostBudgetPort(): CostBudgetPort {
  // Same reasoning as makeRateLimiterPort - the real daily AI-call cap is enforced in
  // operations-supervisor.ts's pre-tick check (MAX_DAILY_AI_CALLS), which refuses to enqueue further
  // fetch-extract work once the day's budget is spent, rather than charging per-message here.
  return { charge: () => true };
}

export function makeIdempotencyStorePort(env: Env, agentName: string): IdempotencyStorePort {
  return {
    async hasProcessed(key: string): Promise<boolean> {
      const row = await env.DB.prepare(`SELECT id FROM agent_runs WHERE idempotency_key=?`).bind(key).first<any>();
      return !!row;
    },
    async markProcessed(key: string, outcome: WorkflowOutcome): Promise<void> {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO agent_runs (id, agent_name, idempotency_key, status, step, outcome_json, completed_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)`
      ).bind(crypto.randomUUID(), agentName, key, 'COMPLETED', outcome.step, JSON.stringify(outcome)).run();
    },
    async getOutcome(key: string): Promise<WorkflowOutcome | null> {
      const row = await env.DB.prepare(`SELECT outcome_json FROM agent_runs WHERE idempotency_key=?`).bind(key).first<any>();
      return row ? JSON.parse(row.outcome_json) : null;
    },
  };
}

export function makeAuditorPort(env: Env): AuditorPort {
  return {
    async record(event): Promise<void> {
      // markProcessed() already writes the canonical agent_runs row for this idempotency key - this
      // second call is a no-op in the common case (INSERT OR IGNORE) and exists only so a future
      // step that audits WITHOUT also marking-processed (there isn't one today) has a safe path.
      await env.DB.prepare(
        `INSERT OR IGNORE INTO agent_runs (id, agent_name, idempotency_key, status, step, outcome_json, completed_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)`
      ).bind(crypto.randomUUID(), 'OfferProcessingWorkflow', event.idempotencyKey, 'COMPLETED', event.step, JSON.stringify(event.outcome)).run();
    },
  };
}

export { validateBookingRoute, generatePublicLabel, fingerprint };
export type { OfferOwnerType };
