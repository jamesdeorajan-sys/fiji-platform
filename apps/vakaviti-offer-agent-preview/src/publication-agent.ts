// PublicationAgent - the only module that writes to deal_exchange_offers / advances
// publication_decision. Enforces the CEO directive's exact daily caps (10/source-family, 30
// global) and public-copy disclosure requirements. Never called directly by AI/extraction code -
// only from offer-workflow.ts's runOfferWorkflow(), itself only reachable after
// evaluateOfferPublicationGates() (deal-exchange-model.ts, reused unchanged) has already decided
// ELIGIBLE.
import type { Env } from './env';
import { generatePublicLabel, resolveOfferAction, deterministicOfferId } from './adapters';
import { SOURCE_CHECKED_LABEL, PRICE_ON_CONFIRMATION_LABEL } from './public-presentation';
import type { PublisherPort } from './offer-workflow';

export const MAX_NEW_PUBLICATIONS_PER_SOURCE_FAMILY_PER_DAY = 10;
export const MAX_NEW_PUBLICATIONS_GLOBAL_PER_DAY = 30;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface CapCheckResult {
  allowed: boolean;
  reason: string;
}

export async function checkDailyPublicationCaps(env: Env, sourceFamilyId: string): Promise<CapCheckResult> {
  const date = todayUtc();
  const familyRow = await env.DB.prepare(
    `SELECT count FROM daily_publication_counters WHERE source_family_id=? AND publication_date=?`
  ).bind(sourceFamilyId, date).first<any>();
  const familyCount = familyRow?.count ?? 0;
  if (familyCount >= MAX_NEW_PUBLICATIONS_PER_SOURCE_FAMILY_PER_DAY) {
    return { allowed: false, reason: `Source family has already published ${familyCount} offers today (cap ${MAX_NEW_PUBLICATIONS_PER_SOURCE_FAMILY_PER_DAY}).` };
  }
  const globalRow = await env.DB.prepare(`SELECT count FROM daily_global_publication_counter WHERE publication_date=?`).bind(date).first<any>();
  const globalCount = globalRow?.count ?? 0;
  if (globalCount >= MAX_NEW_PUBLICATIONS_GLOBAL_PER_DAY) {
    return { allowed: false, reason: `Global daily publication cap reached (${globalCount}/${MAX_NEW_PUBLICATIONS_GLOBAL_PER_DAY}).` };
  }
  return { allowed: true, reason: 'Within both per-family and global daily caps.' };
}

async function incrementCaps(env: Env, sourceFamilyId: string): Promise<void> {
  const date = todayUtc();
  await env.DB.prepare(
    `INSERT INTO daily_publication_counters (source_family_id, publication_date, count) VALUES (?, ?, 1)
     ON CONFLICT(source_family_id, publication_date) DO UPDATE SET count = count + 1`
  ).bind(sourceFamilyId, date).run();
  await env.DB.prepare(
    `INSERT INTO daily_global_publication_counter (publication_date, count) VALUES (?, 1)
     ON CONFLICT(publication_date) DO UPDATE SET count = count + 1`
  ).bind(date).run();
}

/**
 * Required public-copy disclosure block (CEO directive Phase 5) - provider, seller (null unless a
 * real seller identity exists), price/basis or "Price on confirmation", source-checked date,
 * an availability-must-be-confirmed statement, and a no-partnership-claim statement. This is the
 * ONLY function that produces this exact disclosure text, so every published offer carries it
 * uniformly.
 */
export function buildDisclosureCopy(input: {
  providerName: string; sellerName: string | null; priceCopy: string | null; checkedAt: string;
}): string {
  const priceLine = input.priceCopy ?? PRICE_ON_CONFIRMATION_LABEL;
  const sellerLine = input.sellerName ? `Seller: ${input.sellerName}. ` : '';
  return [
    `Provider: ${input.providerName}. ${sellerLine}`,
    `${priceLine}. ${SOURCE_CHECKED_LABEL}: ${input.checkedAt.slice(0, 10)}.`,
    'Availability must be confirmed with the provider before booking.',
    'Vakaviti is not claiming a partnership with this provider unless separately evidenced.',
  ].join(' ');
}

async function recordPublicationAgentRun(env: Env, outcomeJson: string): Promise<void> {
  // PublicationAgent has no cron schedule of its own (it runs synchronously inside
  // OfferProcessingWorkflow whenever a candidate reaches the publish-or-review step) - this is its
  // only execution record, so OperationsSupervisorAgent's status report can show a real
  // lastSuccessfulRun for it rather than a permanently-null field.
  await env.DB.prepare(
    `INSERT INTO agent_runs (id, agent_name, idempotency_key, status, outcome_json, completed_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`
  ).bind(crypto.randomUUID(), 'PublicationAgent', crypto.randomUUID(), 'COMPLETED', outcomeJson).run();
}

export function makePublisherPort(env: Env, sourceFamilyId: string, providerName: string, providerId: string): PublisherPort {
  return {
    async publish(sourceId, canonicalUrl, facts) {
      // Re-derives the IDENTICAL action decision makeRuleEnginePort already used to reach ELIGIBLE -
      // pure function, same inputs, same output - rather than trusting a value smuggled across the
      // fixed offer-workflow.ts port boundary.
      const { action } = resolveOfferAction(sourceId, canonicalUrl, facts);
      const offerId = deterministicOfferId(sourceId, canonicalUrl);
      const now = new Date().toISOString();

      const capCheck = await checkDailyPublicationCaps(env, sourceFamilyId);
      if (!capCheck.allowed) {
        // Cap reached: the offer is fully evidenced and gate-passed, but publication itself is
        // deferred, not silently dropped - it lands in review so a human sees why, rather than
        // disappearing.
        await insertOffer(env, offerId, sourceFamilyId, providerId, providerName, canonicalUrl, facts, 'NOT_ELIGIBLE', now, [], [capCheck.reason], action);
        await recordPublicationAgentRun(env, JSON.stringify({ decision: 'DEFERRED_CAP_REACHED', offerId }));
        return { offerId };
      }

      const publicLabel = generatePublicLabel('PROVIDER_DIRECT', null);
      await insertOffer(env, offerId, sourceFamilyId, providerId, providerName, canonicalUrl, facts, 'ELIGIBLE', now, ['capacity_available', 'booking_route_valid'], [], action, publicLabel);
      await incrementCaps(env, sourceFamilyId);
      await recordPublicationAgentRun(env, JSON.stringify({ decision: 'PUBLISHED', offerId, actionType: action.actionType }));
      return { offerId };
    },
    async sendToReview(sourceId, canonicalUrl, facts, reasons) {
      const { action } = resolveOfferAction(sourceId, canonicalUrl, facts);
      const offerId = deterministicOfferId(sourceId, canonicalUrl);
      const now = new Date().toISOString();
      await insertOffer(env, offerId, sourceFamilyId, providerId, providerName, canonicalUrl, facts, 'NOT_ELIGIBLE', now, [], reasons, action);
      await recordPublicationAgentRun(env, JSON.stringify({ decision: 'SENT_TO_REVIEW', offerId, reasons, actionType: action.actionType }));
      return { offerId };
    },
  };
}

async function insertOffer(
  env: Env, offerId: string, sourceFamilyId: string, providerId: string, providerName: string,
  canonicalUrl: string, facts: Record<string, string | null>, decision: 'ELIGIBLE' | 'NOT_ELIGIBLE',
  checkedAt: string, passedGates: string[], failedGates: string[],
  action: { actionType: 'VAKAVITI_ENQUIRY' | 'PROVIDER_DIRECT' | 'NOT_ACTIONABLE'; selectedRoute: string | null },
  publicLabel: string | null = null
): Promise<void> {
  const identityKey = `PROVIDER_DIRECT::${providerId}::${(facts.proposed_offer_name || canonicalUrl).toLowerCase()}`;
  const fingerprintValue = crypto.randomUUID(); // fingerprint uniqueness is enforced by the caller's dedup step before publish() is ever reached
  const vakavitiEnquiryRoute = action.actionType === 'VAKAVITI_ENQUIRY' ? action.selectedRoute : null;
  const providerBookingRoute = action.actionType === 'PROVIDER_DIRECT' ? action.selectedRoute : (facts.booking_route ?? null);
  // Legacy booking_route column: kept populated with whatever route the ACTION actually selected
  // (never source_url), purely for audit continuity with the original canonical schema - no code
  // in this app reads it as a redirect target any more; public_action_type/vakaviti_enquiry_route/
  // provider_booking_route are the fields the new booking-action model actually uses.
  await env.DB.prepare(
    `INSERT INTO deal_exchange_offers (
      id, offer_owner_type, provider_id, provider_name, canonical_source_url, fingerprint, identity_key,
      price_amount, currency, price_basis, booking_deadline, inclusions, booking_route, locality,
      publication_decision, passed_gates_json, failed_gates_json, public_label, checked_at, source_family_id,
      public_action_type, vakaviti_enquiry_route, provider_booking_route
    ) VALUES (?,?,?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      publication_decision=excluded.publication_decision, passed_gates_json=excluded.passed_gates_json,
      failed_gates_json=excluded.failed_gates_json, public_label=excluded.public_label, checked_at=excluded.checked_at,
      public_action_type=excluded.public_action_type, vakaviti_enquiry_route=excluded.vakaviti_enquiry_route,
      provider_booking_route=excluded.provider_booking_route, updated_at=CURRENT_TIMESTAMP`
  ).bind(
    offerId, 'PROVIDER_DIRECT', providerId, providerName, canonicalUrl, fingerprintValue, identityKey,
    facts.advertised_price ?? null, facts.currency ?? null, facts.price_basis ?? null,
    facts.booking_deadline ?? null, facts.inclusions ?? null, action.selectedRoute, facts.fiji_location ?? null,
    decision, JSON.stringify(passedGates), JSON.stringify(failedGates), publicLabel, checkedAt, sourceFamilyId,
    action.actionType, vakavitiEnquiryRoute, providerBookingRoute
  ).run();
}
