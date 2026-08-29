import { Hono } from 'hono';
import type { Env } from './env';
import { isGloballyForceDisabled } from './env';
import { runOfferWorkflow, runRecheckWorkflow, type WorkflowDependencies, type RecheckSubject } from './offer-workflow';
import {
  makeFetchPort, makeExtractionPort, makeNormalizerPort, makeEvidenceStorePort, makeDeduplicatorPort,
  makeRuleEnginePort, makeRateLimiterPort, makeCostBudgetPort, makeIdempotencyStorePort, makeAuditorPort,
} from './adapters';
import { makePublisherPort } from './publication-agent';
import { makeRechecker } from './freshness-agent';
import { makeQuarantiner } from './quarantine';
import { processDiscoveryForFamily, makeHumanSubmissionDiscoveryProvider } from './discovery-agent';
import { CATEGORY_PAGE_URLS_BY_FAMILY } from './seed-source-families';
import { getStatusReport, isUnderDailyAiCallBudget, incrementAiCallCounter } from './operations-supervisor';
import { setGlobalKillSwitch, pauseSource, approveSource, type Actor } from './authority-model';
import { registerEnquiryRoutes } from './enquiry-routes';
import { runDueAgentTicks } from './agent-orchestration';

const app = new Hono<{ Bindings: Env }>();
registerEnquiryRoutes(app);

function requireHuman(c: any): Actor | Response {
  const token = c.req.header('authorization')?.replace(/^Bearer /i, '');
  if (!token || !c.env.ADMIN_TOKEN || token !== c.env.ADMIN_TOKEN) {
    return c.json({ error: 'Authenticated human actor required (missing/invalid admin token).' }, 401);
  }
  return { type: 'HUMAN', id: 'admin' };
}

app.get('/api/health', (c) => c.json({ ok: true, service: 'vakaviti-offer-agent-preview' }));

app.get('/internal/build-info', (c) => c.json({
  versionId: c.env.CF_VERSION_METADATA?.id ?? null, environment: c.env.ENVIRONMENT,
  forceDisabled: isGloballyForceDisabled(c.env),
}));

app.get('/internal/agent-status', async (c) => c.json(await getStatusReport(c.env)));

app.get('/internal/review-queue', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, provider_name, canonical_source_url, failed_gates_json, checked_at FROM deal_exchange_offers WHERE publication_decision='NOT_ELIGIBLE' ORDER BY checked_at DESC LIMIT 50`
  ).all<any>();
  return c.json({ count: rows.results?.length ?? 0, items: rows.results ?? [] });
});

app.post('/internal/kill-switch', async (c) => {
  const actorOrErr = requireHuman(c);
  if (actorOrErr instanceof Response) return actorOrErr;
  const body = await c.req.json<{ active: boolean; reason: string }>();
  const current = await c.env.DB.prepare(`SELECT active FROM kill_switches WHERE id='global'`).first<any>();
  const priorState = current?.active ? 'ACTIVE' : 'INACTIVE';
  const nextState = body.active ? 'ACTIVE' : 'INACTIVE';
  const transition = setGlobalKillSwitch(actorOrErr, priorState, nextState, 'MANUAL', body.reason ?? null);
  await c.env.DB.prepare(`UPDATE kill_switches SET active=?, reason=?, set_by=?, set_at=CURRENT_TIMESTAMP WHERE id='global'`)
    .bind(body.active ? 1 : 0, body.reason ?? null, actorOrErr.id).run();
  await c.env.DB.prepare(
    `INSERT INTO authority_transitions (id, transition_type, actor_type, actor_id, reason_code, evidence, prior_state, next_state, subject_id) VALUES (?,?,?,?,?,?,?,?,NULL)`
  ).bind(crypto.randomUUID(), 'GLOBAL_KILL_SWITCH', transition.actorType, transition.actorId, transition.reasonCode, transition.evidence, transition.priorState, transition.nextState).run();
  return c.json({ ok: true, transition });
});

app.post('/internal/source/:id/pause', async (c) => {
  const actorOrErr = requireHuman(c);
  if (actorOrErr instanceof Response) return actorOrErr;
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(`SELECT source_approval_status FROM offer_source_families WHERE id=?`).bind(id).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  const transition = pauseSource(actorOrErr, row.source_approval_status, 'MANUAL_HUMAN_PAUSE', 'Manual pause via admin endpoint');
  await c.env.DB.prepare(`UPDATE offer_source_families SET source_approval_status='PAUSED', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
  return c.json({ ok: true, transition });
});

app.post('/internal/source/:id/approve', async (c) => {
  const actorOrErr = requireHuman(c);
  if (actorOrErr instanceof Response) return actorOrErr;
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(`SELECT source_approval_status FROM offer_source_families WHERE id=?`).bind(id).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  const transition = approveSource(actorOrErr, row.source_approval_status, 'MANUAL_HUMAN_APPROVE', 'Manual approval via admin endpoint');
  await c.env.DB.prepare(`UPDATE offer_source_families SET source_approval_status='APPROVED', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
  return c.json({ ok: true, transition });
});

app.post('/internal/submit-url', async (c) => {
  const actorOrErr = requireHuman(c);
  if (actorOrErr instanceof Response) return actorOrErr;
  const body = await c.req.json<{ url: string; sourceFamilyId: string }>();
  const provider = makeHumanSubmissionDiscoveryProvider();
  const [candidate] = await provider.discover({ submittedUrl: body.url, submittedByActorId: actorOrErr.id });
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO discovered_candidates (id, url, discovered_via, authority, source_family_id, status) VALUES (?,?,?,?,?,'PENDING')`
  ).bind(crypto.randomUUID(), candidate.url, candidate.discoveredVia, candidate.authority, body.sourceFamilyId).run();
  const idempotencyKey = `fetch-extract:${body.sourceFamilyId}:${candidate.url}`;
  await c.env.FETCH_EXTRACT_QUEUE.send({ sourceFamilyId: body.sourceFamilyId, url: candidate.url, idempotencyKey });
  return c.json({ ok: true, candidate });
});

// Phase 7D: reprocess an already-evaluated candidate URL under the corrected booking-action model.
// The OLD offer row (its own random-UUID id, from before deterministic ids existed) is never
// touched - a fresh evaluation produces a NEW offer row (a new, deterministic id derived from
// sourceFamilyId+canonicalUrl), and an explicit history row on the OLD offer links to it so a
// human reviewing the old row's trail can find the new evaluation. Synchronous (not queued) so the
// caller gets an immediate, individually-reportable result per the directive's "report every failed
// gate individually" requirement.
app.post('/internal/reprocess', async (c) => {
  const actorOrErr = requireHuman(c);
  if (actorOrErr instanceof Response) return actorOrErr;
  const body = await c.req.json<{ oldOfferId: string; sourceFamilyId: string; url: string }>();

  const familyRow = await c.env.DB.prepare(`SELECT * FROM offer_source_families WHERE id=?`).bind(body.sourceFamilyId).first<any>();
  if (!familyRow) return c.json({ error: 'source family not found' }, 404);

  let offerIdForRecord: string | null = null;
  const deps: WorkflowDependencies = {
    fetchAgent: makeFetchPort(), extractionAgent: makeExtractionPort(c.env), normalizer: makeNormalizerPort(),
    evidenceStore: makeEvidenceStorePort(c.env, () => offerIdForRecord), deduplicator: makeDeduplicatorPort(c.env),
    ruleEngine: makeRuleEnginePort(familyRow.legal_provider_or_seller_identity, familyRow.id),
    publisher: makePublisherPort(c.env, familyRow.id, familyRow.legal_provider_or_seller_identity, familyRow.id),
    rateLimiter: makeRateLimiterPort(c.env), costBudget: makeCostBudgetPort(),
    idempotencyStore: makeIdempotencyStorePort(c.env, 'OfferProcessingWorkflow'), auditor: makeAuditorPort(c.env),
    rechecker: makeRechecker(), quarantiner: makeQuarantiner(c.env), clock: { now: () => new Date().toISOString() },
  };
  const idempotencyKey = `reprocess:${body.sourceFamilyId}:${body.url}:${new Date().toISOString()}`;
  const outcome = await runOfferWorkflow(deps, { sourceId: body.sourceFamilyId, url: body.url, idempotencyKey });
  const newOfferId = (outcome as any).offerId ?? null;

  if (newOfferId && body.oldOfferId) {
    const oldOffer = await c.env.DB.prepare(`SELECT publication_decision FROM deal_exchange_offers WHERE id=?`).bind(body.oldOfferId).first<any>();
    if (oldOffer) {
      await c.env.DB.prepare(
        `INSERT INTO deal_exchange_offer_history (id, offer_id, field, old_value, new_value, reason) VALUES (?,?,?,?,?,?)`
      ).bind(crypto.randomUUID(), body.oldOfferId, 'reprocessing_lineage', body.oldOfferId, newOfferId,
        `REPROCESSED_UNDER_CORRECTED_BOOKING_ACTION_MODEL: superseding evaluation created as ${newOfferId} (old row left byte-identical, never overwritten)`).run();
    }
  }

  const newOffer = newOfferId ? await c.env.DB.prepare(`SELECT publication_decision, public_action_type, failed_gates_json FROM deal_exchange_offers WHERE id=?`).bind(newOfferId).first<any>() : null;
  return c.json({ oldOfferId: body.oldOfferId, newOfferId, outcome, newOffer });
});

// Phase 3 (CEO incident correction, 2026-08-29): /internal/tick/all and the external-scheduler
// fallback are REMOVED entirely - no third-party routine may hold ADMIN_TOKEN, no external
// scheduler is used, and native Cron with the corrected per-service isDue() design (see
// agent-orchestration.ts) makes this endpoint unnecessary. Nothing in this file replaces it.

export default {
  fetch: app.fetch,

  // ONE native Cron Trigger ("*/10 * * * *" - see wrangler.toml). ONE idempotent orchestration
  // entry point. Dispatch never compares controller.cron against a literal string - that pattern
  // (three overlapping expressions, each gated by `event.cron === '<exact string>'`) is exactly
  // what was removed this session. controller.scheduledTime/controller.cron are recorded verbatim
  // for audit inside runDueAgentTicks(), never used for branching logic.
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (isGloballyForceDisabled(env)) return;
    const killSwitch = await env.DB.prepare(`SELECT active FROM kill_switches WHERE id='global'`).first<any>();
    if (killSwitch?.active) return; // human-set global kill switch - honored before any agent runs

    await runDueAgentTicks(env, controller.scheduledTime, controller.cron);
  },

  async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext): Promise<void> {
    if (isGloballyForceDisabled(env)) return;
    const killSwitch = await env.DB.prepare(`SELECT active FROM kill_switches WHERE id='global'`).first<any>();
    if (killSwitch?.active) return;

    if (batch.queue.endsWith('-discovery')) {
      for (const message of batch.messages) {
        const { sourceFamilyId, idempotencyKey } = message.body as any;
        const idem = makeIdempotencyStorePort(env, 'DiscoveryAgent');
        if (await idem.hasProcessed(idempotencyKey)) { message.ack(); continue; }
        try {
          const result = await processDiscoveryForFamily(env, sourceFamilyId, CATEGORY_PAGE_URLS_BY_FAMILY);
          await idem.markProcessed(idempotencyKey, { step: 'PUBLISHED', offerId: JSON.stringify(result) } as any);
          message.ack();
        } catch (e: any) {
          message.retry();
        }
      }
    } else if (batch.queue.endsWith('-fetch-extract')) {
      for (const message of batch.messages) {
        const { sourceFamilyId, url, idempotencyKey } = message.body as any;
        try {
          const familyRow = await env.DB.prepare(`SELECT * FROM offer_source_families WHERE id=?`).bind(sourceFamilyId).first<any>();
          if (!familyRow) { message.ack(); continue; } // family removed/paused since enqueue - not an error, just stale
          if (!(await isUnderDailyAiCallBudget(env))) { message.retry(); continue; } // bounded retry, not a silent drop

          let offerIdForRecord: string | null = null;
          const deps: WorkflowDependencies = {
            fetchAgent: makeFetchPort(),
            extractionAgent: makeExtractionPort(env),
            normalizer: makeNormalizerPort(),
            evidenceStore: makeEvidenceStorePort(env, () => offerIdForRecord),
            deduplicator: makeDeduplicatorPort(env),
            ruleEngine: makeRuleEnginePort(familyRow.legal_provider_or_seller_identity, familyRow.id),
            publisher: makePublisherPort(env, familyRow.id, familyRow.legal_provider_or_seller_identity, familyRow.id),
            rateLimiter: makeRateLimiterPort(env),
            costBudget: makeCostBudgetPort(),
            idempotencyStore: makeIdempotencyStorePort(env, 'OfferProcessingWorkflow'),
            auditor: makeAuditorPort(env),
            rechecker: makeRechecker(),
            quarantiner: makeQuarantiner(env),
            clock: { now: () => new Date().toISOString() },
          };
          await incrementAiCallCounter(env);
          const outcome = await runOfferWorkflow(deps, { sourceId: sourceFamilyId, url, idempotencyKey });
          if (outcome.step === 'PUBLISHED' || outcome.step === 'SENT_TO_REVIEW') offerIdForRecord = outcome.offerId;

          // Wire real fetch outcomes into the anomaly-auto-pause safety control
          // (operations-supervisor.ts's checkAnomalyAndAutoPause reads failure_count) - a failed
          // fetch increments it, any other outcome (including a successful fetch that later fails
          // extraction/gates) resets it, since the SOURCE itself was reachable.
          if (outcome.step === 'FETCH_FAILED') {
            await env.DB.prepare(`UPDATE offer_source_families SET failure_count = failure_count + 1, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(sourceFamilyId).run();
          } else {
            await env.DB.prepare(`UPDATE offer_source_families SET failure_count = 0, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(sourceFamilyId).run();
          }

          await env.DB.prepare(`UPDATE discovered_candidates SET status='PROCESSED' WHERE url=?`).bind(url).run();
          message.ack();
        } catch (e: any) {
          message.retry();
        }
      }
    } else if (batch.queue.endsWith('-recheck')) {
      for (const message of batch.messages) {
        const { offerId, idempotencyKey } = message.body as any;
        try {
          const offerRow = await env.DB.prepare(`SELECT * FROM deal_exchange_offers WHERE id=?`).bind(offerId).first<any>();
          if (!offerRow) { message.ack(); continue; }
          const subject: RecheckSubject = {
            offerId, sourceId: offerRow.source_family_id, canonicalUrl: offerRow.canonical_source_url,
            currentFacts: { booking_deadline: offerRow.booking_deadline, advertised_price: offerRow.price_amount },
            currentState: offerRow.publication_decision === 'ELIGIBLE' ? 'PUBLISHED' : 'QUARANTINED',
          };
          const deps: WorkflowDependencies = {
            fetchAgent: makeFetchPort(), extractionAgent: makeExtractionPort(env), normalizer: makeNormalizerPort(),
            evidenceStore: makeEvidenceStorePort(env, () => offerId), deduplicator: makeDeduplicatorPort(env),
            ruleEngine: makeRuleEnginePort(offerRow.provider_name, offerRow.provider_id),
            publisher: makePublisherPort(env, offerRow.source_family_id, offerRow.provider_name, offerRow.provider_id),
            rateLimiter: makeRateLimiterPort(env), costBudget: makeCostBudgetPort(),
            idempotencyStore: makeIdempotencyStorePort(env, 'FreshnessAgent'), auditor: makeAuditorPort(env),
            rechecker: makeRechecker(), quarantiner: makeQuarantiner(env), clock: { now: () => new Date().toISOString() },
          };
          const idem = makeIdempotencyStorePort(env, 'FreshnessAgent');
          if (!(await idem.hasProcessed(idempotencyKey))) {
            await runRecheckWorkflow(deps, subject);
            await idem.markProcessed(idempotencyKey, { step: 'PUBLISHED', offerId } as any);
          }
          message.ack();
        } catch (e: any) {
          message.retry();
        }
      }
    }
  },
};
