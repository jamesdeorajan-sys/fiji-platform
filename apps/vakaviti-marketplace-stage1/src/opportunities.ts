// VAKAVITI DEAL OPPORTUNITY PIPELINE - service layer (2026-08-24).
//
// Everything here writes only to OPPORTUNITY_DB (the isolated preview D1) except
// convertOpportunityToDealCandidate()'s final write, which is the ONE place this feature ever
// touches a deal-candidate table - and even there, the caller supplies which D1Database instance
// to write to, so a test/preview caller can point it at an isolated mirror table instead of
// production. See the Deal Opportunity Pipeline report for exactly how this was tested without
// ever writing to the real production DB.

import {
  evaluateOpportunityCaptureGates, isExcludedIdentity, computeOpportunityFingerprint,
  diffOpportunityMaterialFacts, scoreOpportunity, canonicalizeUrl,
  type OpportunityCaptureCandidate, type OpportunityMaterialFields, type OpportunityScoringInput,
} from './opportunity-gate';
import { evaluateDealAutoPublishGates, type DealAutoPublishCandidate } from './deal-quality';

export type Bindings = { DB: D1Database; OPPORTUNITY_DB: D1Database; AI: Ai; ENVIRONMENT: string; ADMIN_TOKEN?: string };

export type LifecycleStatus =
  | 'DETECTED' | 'OUTREACH_READY' | 'CONTACTED' | 'PROVIDER_REPLIED' | 'NEEDS_CLARIFICATION'
  | 'PROVIDER_CONFIRMED' | 'PUBLICATION_REVIEW' | 'PUBLISHED' | 'REJECTED' | 'EXPIRED' | 'WITHDRAWN' | 'DUPLICATE';

async function recordEvent(
  db: D1Database, opportunityId: string, priorStatus: string | null, newStatus: string,
  actorType: 'AI' | 'HUMAN' | 'SYSTEM', actorIdentity: string | null, reason: string, metadata: Record<string, any> = {}
): Promise<void> {
  await db.prepare(
    `INSERT INTO opportunity_lifecycle_events (id, opportunity_id, prior_status, new_status, actor_type, actor_identity, reason, metadata_json) VALUES (?,?,?,?,?,?,?,?)`
  ).bind(crypto.randomUUID(), opportunityId, priorStatus, newStatus, actorType, actorIdentity, reason, JSON.stringify(metadata)).run();
}

// --- Phase 8: Discovery Integration --------------------------------------------------------------
// Called with the same shape of data a real deal-agent.ts scan already extracts (or, for the
// isolated preview, a caller-supplied equivalent). Never fabricates a special from a generic
// page - the capture gate's genuine_offer_signal check is what enforces that; this function is
// only the persistence/dedup/event layer around that gate's decision.
export interface DiscoveryCaptureInput {
  canonicalSourceUrl: string;
  providerName: string | null;
  providerDomain: string;
  detectedTitle: string | null;
  detectedOfferText: string | null;
  evidenceExcerpt: string | null;
  pageText: string;
  region: string | null;
  locality: string | null;
  category: string | null;
  priceAmount: string | null;
  currency: string | null;
  priceBasis: string | null;
  bookingDeadline: string | null;
  travelStart: string | null;
  travelEnd: string | null;
  expiry: string | null;
  inclusionsJson: string | null;
  exclusionsJson: string | null;
  occupancyBasis: string | null;
  minimumStay: string | null;
  bookingRoute: string | null;
  providerContactRoute: string | null;
  sourceId: string | null;
  sourceScanId: string | null;
  isAggregatorEvidence: boolean;
  isTestFixture?: boolean; // set true only by Phase 9 backfill / Phase 10 test callers
}

export interface DiscoveryCaptureResult {
  outcome: 'CAPTURED' | 'UPDATED_UNCHANGED' | 'MATERIAL_CHANGE' | 'REJECTED';
  opportunityId: string | null;
  reason: string | null;
  gateResult: ReturnType<typeof evaluateOpportunityCaptureGates>;
}

export async function captureOrUpdateOpportunity(env: Bindings, input: DiscoveryCaptureInput, actorIdentity: string): Promise<DiscoveryCaptureResult> {
  const candidate: OpportunityCaptureCandidate = {
    canonicalSourceUrl: input.canonicalSourceUrl,
    providerName: input.providerName,
    providerDomain: input.providerDomain,
    detectedTitle: input.detectedTitle,
    detectedOfferText: input.detectedOfferText,
    evidenceExcerpt: input.evidenceExcerpt,
    pageText: input.pageText,
    checkedAt: new Date().toISOString(),
  };
  const gate = evaluateOpportunityCaptureGates(candidate);
  if (gate.decision === 'REJECT') {
    return { outcome: 'REJECTED', opportunityId: null, reason: gate.rejectionReason, gateResult: gate };
  }

  const materialFields: OpportunityMaterialFields = {
    price_amount: input.priceAmount, currency: input.currency, price_basis: input.priceBasis,
    booking_deadline: input.bookingDeadline, travel_start: input.travelStart, travel_end: input.travelEnd,
    expiry: input.expiry, inclusions_json: input.inclusionsJson,
  };
  const fingerprint = await computeOpportunityFingerprint(input.canonicalSourceUrl, input.providerDomain, input.detectedTitle, materialFields);

  const missingFields: string[] = [];
  for (const [k, v] of Object.entries(materialFields)) if (!v) missingFields.push(k);

  const existing = await env.OPPORTUNITY_DB.prepare(`SELECT * FROM opportunities WHERE evidence_fingerprint = ?`).bind(fingerprint).first<any>();
  const nowIso = new Date().toISOString();

  if (existing) {
    // Unchanged fingerprint - update last_checked_at only, no duplicate row, no event (a scan
    // that reconfirms unchanged evidence is not itself a lifecycle-worthy occurrence).
    await env.OPPORTUNITY_DB.prepare(`UPDATE opportunities SET last_checked_at=?, updated_at=? WHERE id=?`).bind(nowIso, nowIso, existing.id).run();
    return { outcome: 'UPDATED_UNCHANGED', opportunityId: existing.id, reason: 'Fingerprint unchanged since last check.', gateResult: gate };
  }

  // Same provider+canonical URL but a DIFFERENT fingerprint than any existing row = a material
  // change to a previously-captured opportunity, not a brand-new one - find the most recent prior
  // row for this exact source URL to link the change event to.
  const prior = await env.OPPORTUNITY_DB.prepare(
    `SELECT * FROM opportunities WHERE canonical_source_url = ? AND provider_domain = ? ORDER BY created_at DESC LIMIT 1`
  ).bind(canonicalizeUrl(input.canonicalSourceUrl), input.providerDomain).first<any>();

  const id = crypto.randomUUID();
  const scoreInput: OpportunityScoringInput = {
    detectedTitle: input.detectedTitle, detectedOfferText: input.detectedOfferText, evidenceExcerpt: input.evidenceExcerpt,
    priceAmount: input.priceAmount, currency: input.currency, bookingDeadline: input.bookingDeadline,
    travelStart: input.travelStart, travelEnd: input.travelEnd, expiry: input.expiry, inclusionsJson: input.inclusionsJson,
    locality: input.locality, region: input.region, providerContactRoute: input.providerContactRoute, bookingRoute: input.bookingRoute,
    category: input.category, occupancyBasis: input.occupancyBasis, minimumStay: input.minimumStay,
    contradictionFlags: [], missingFields, lastCheckedAt: nowIso, isDuplicateOfExisting: false, sourceReachable: true,
    imageRightsDependent: false, aggregatorOnlyEvidence: input.isAggregatorEvidence,
    regionCategoryAlreadyWellCovered: await regionCategoryHasExisting(env, input.region, input.category),
  };
  const scored = scoreOpportunity(scoreInput);

  await env.OPPORTUNITY_DB.prepare(
    `INSERT INTO opportunities (
      id, provider_name, provider_domain, canonical_source_url, source_id, source_scan_id,
      detected_title, detected_offer_text, region, locality, category,
      price_amount, currency, price_basis, booking_deadline, travel_start, travel_end, expiry,
      inclusions_json, exclusions_json, occupancy_basis, minimum_stay, booking_route, provider_contact_route,
      evidence_excerpt, evidence_fingerprint, last_checked_at, missing_fields_json,
      opportunity_score, score_components_json, lifecycle_status, is_test_fixture
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, input.providerName, input.providerDomain, canonicalizeUrl(input.canonicalSourceUrl), input.sourceId, input.sourceScanId,
    input.detectedTitle, input.detectedOfferText, input.region, input.locality, input.category,
    input.priceAmount, input.currency, input.priceBasis, input.bookingDeadline, input.travelStart, input.travelEnd, input.expiry,
    input.inclusionsJson || '[]', input.exclusionsJson || '[]', input.occupancyBasis, input.minimumStay, input.bookingRoute, input.providerContactRoute,
    input.evidenceExcerpt, fingerprint, nowIso, JSON.stringify(missingFields),
    scored.score, JSON.stringify(scored.components), 'DETECTED', input.isTestFixture ? 1 : 0
  ).run();

  await recordEvent(env.OPPORTUNITY_DB, id, prior ? prior.lifecycle_status : null, 'DETECTED', 'AI', actorIdentity,
    prior ? 'Material change detected vs. prior capture of the same source.' : 'New opportunity captured from official source evidence.',
    { fingerprint, missingFields, priorOpportunityId: prior?.id ?? null });

  return { outcome: prior ? 'MATERIAL_CHANGE' : 'CAPTURED', opportunityId: id, reason: null, gateResult: gate };
}

async function regionCategoryHasExisting(env: Bindings, region: string | null, category: string | null): Promise<boolean> {
  if (!region && !category) return false;
  const row = await env.OPPORTUNITY_DB.prepare(`SELECT COUNT(*) n FROM opportunities WHERE (region = ? OR ? IS NULL) AND (category = ? OR ? IS NULL)`)
    .bind(region, region, category, category).first<any>();
  return Number(row?.n || 0) > 0;
}

// --- Phase 5: Outreach draft (pure - no send capability exists anywhere in this file) -----------
export function generateOutreachDraft(o: { provider_name: string | null; canonical_source_url: string }): string {
  const provider = o.provider_name || 'your business';
  return [
    `Bula - this is Vakaviti (a Fiji tourism discovery platform, vakaviti.ai). We noticed a possible current offer for ${provider} on your own website:`,
    o.canonical_source_url,
    '',
    'A few quick questions so we can represent it accurately, if you are interested:',
    '1. Is this offer currently available?',
    '2. What is the current price, currency and price basis?',
    '3. What are the booking deadline and travel dates?',
    '4. What is included and excluded?',
    '5. Are minimum stay or occupancy conditions applicable?',
    '6. May Vakaviti display these facts and send interested travellers to its human concierge team?',
    '',
    "We are not currently partnered with you and have not published anything about this offer - we'd only do that with facts you confirm.",
  ].join('\n');
}

// --- Phase 6: Provider reply ingestion -----------------------------------------------------------
// Stores the raw reply verbatim (evidence retention). AI may propose extracted fields, but
// human_confirmed starts at 0 and nothing on the opportunity row changes until a human calls
// confirmProviderReplyExtraction() below - see index/opportunities-admin-ui.ts for the two-step
// UI (paste reply -> review proposed fields -> confirm).
export async function ingestProviderReply(
  env: Bindings, opportunityId: string, rawReplyText: string, submittedBy: string, proposedFields: Record<string, any>
): Promise<{ replyId: string; contradictionFlags: string[] }> {
  const opp = await env.OPPORTUNITY_DB.prepare(`SELECT * FROM opportunities WHERE id=?`).bind(opportunityId).first<any>();
  if (!opp) throw new Error('opportunity_not_found');

  // Never inferred: a provider reply proposing facts does NOT itself imply
  // provider_permission_status - that stays NOT_REQUESTED/whatever it already was until a human
  // explicitly sets it based on an actual permission statement in the reply.
  const contradictionFlags: string[] = [];
  const websiteFields: Record<string, any> = {
    price_amount: opp.price_amount, currency: opp.currency, booking_deadline: opp.booking_deadline,
    travel_start: opp.travel_start, travel_end: opp.travel_end,
  };
  for (const [k, v] of Object.entries(proposedFields)) {
    if (k in websiteFields && websiteFields[k] && v && String(websiteFields[k]) !== String(v)) {
      contradictionFlags.push(`${k}: website says "${websiteFields[k]}", reply says "${v}"`);
    }
  }

  const replyId = crypto.randomUUID();
  await env.OPPORTUNITY_DB.prepare(
    `INSERT INTO opportunity_provider_replies (id, opportunity_id, raw_reply_text, submitted_by, proposed_fields_json, contradiction_flags_json, human_confirmed) VALUES (?,?,?,?,?,?,0)`
  ).bind(replyId, opportunityId, rawReplyText, submittedBy, JSON.stringify(proposedFields), JSON.stringify(contradictionFlags)).run();

  await recordEvent(env.OPPORTUNITY_DB, opportunityId, opp.lifecycle_status, 'PROVIDER_REPLIED', 'HUMAN', submittedBy,
    'Provider reply recorded (fields not yet applied - pending human confirmation).', { replyId, contradictionFlags });
  await env.OPPORTUNITY_DB.prepare(`UPDATE opportunities SET lifecycle_status='PROVIDER_REPLIED', provider_replied_at=?, updated_at=? WHERE id=?`)
    .bind(new Date().toISOString(), new Date().toISOString(), opportunityId).run();

  return { replyId, contradictionFlags };
}

export async function confirmProviderReplyExtraction(
  env: Bindings, replyId: string, confirmedFields: Record<string, any>, confirmedBy: string
): Promise<void> {
  const reply = await env.OPPORTUNITY_DB.prepare(`SELECT * FROM opportunity_provider_replies WHERE id=?`).bind(replyId).first<any>();
  if (!reply) throw new Error('reply_not_found');
  const nowIso = new Date().toISOString();
  await env.OPPORTUNITY_DB.prepare(`UPDATE opportunity_provider_replies SET human_confirmed=1, confirmed_by=?, confirmed_at=? WHERE id=?`)
    .bind(confirmedBy, nowIso, replyId).run();

  const setClauses: string[] = [];
  const values: any[] = [];
  const allowed = ['price_amount', 'currency', 'price_basis', 'booking_deadline', 'travel_start', 'travel_end', 'expiry', 'inclusions_json', 'exclusions_json', 'occupancy_basis', 'minimum_stay', 'provider_confirmation_basis'];
  for (const [k, v] of Object.entries(confirmedFields)) {
    if (allowed.includes(k)) { setClauses.push(`${k}=?`); values.push(v); }
  }
  if (setClauses.length) {
    setClauses.push('updated_at=?'); values.push(nowIso); values.push(reply.opportunity_id);
    await env.OPPORTUNITY_DB.prepare(`UPDATE opportunities SET ${setClauses.join(', ')} WHERE id=?`).bind(...values).run();
  }
  const opp = await env.OPPORTUNITY_DB.prepare(`SELECT lifecycle_status FROM opportunities WHERE id=?`).bind(reply.opportunity_id).first<any>();
  await recordEvent(env.OPPORTUNITY_DB, reply.opportunity_id, opp?.lifecycle_status ?? null, opp?.lifecycle_status ?? 'PROVIDER_REPLIED', 'HUMAN', confirmedBy,
    'Human confirmed extraction of provider-supplied fields from the recorded reply.', { replyId, confirmedFields });
}

// --- Phase 7: Governed conversion to deal candidate -----------------------------------------------
// The ONE function that may create/update a Lane B (public-pipeline) deal_offer_candidates row
// from an opportunity. Does NOT publish anything itself - autoPublishDealIfEligible() /
// evaluateDealAutoPublishGates() (deal-quality.ts, deals.ts) remain the sole, independent
// decision-makers for public eligibility, exactly as before this feature existed. `targetDb` is
// caller-supplied so a test/preview caller can point this at an isolated mirror table instead of
// the real production DB - see the Deal Opportunity Pipeline report for how this was verified
// without ever writing to production.
export interface ConversionResult {
  ok: boolean;
  reason: string | null;
  dealCandidateId: string | null;
  publishGateCheck: ReturnType<typeof evaluateDealAutoPublishGates> | null;
}

export async function convertOpportunityToDealCandidate(
  env: Bindings, opportunityId: string, actorIdentity: string, targetDb: D1Database, targetTable: string = 'deal_offer_candidates'
): Promise<ConversionResult> {
  const o = await env.OPPORTUNITY_DB.prepare(`SELECT * FROM opportunities WHERE id=?`).bind(opportunityId).first<any>();
  if (!o) return { ok: false, reason: 'opportunity_not_found', dealCandidateId: null, publishGateCheck: null };

  const missing: string[] = JSON.parse(o.missing_fields_json || '[]');
  const contradictions: string[] = JSON.parse(o.contradiction_flags_json || '[]');
  const preconditionFailures: string[] = [];
  if (!o.provider_name && !o.provider_domain) preconditionFailures.push('identity_not_resolved');
  if (!o.evidence_excerpt) preconditionFailures.push('official_evidence_not_retained');
  if (missing.length > 0) preconditionFailures.push(`required_facts_still_missing:${missing.join(',')}`);
  if (contradictions.length > 0) preconditionFailures.push(`unresolved_contradictions:${contradictions.join(',')}`);
  const dup = await env.OPPORTUNITY_DB.prepare(`SELECT id FROM opportunities WHERE evidence_fingerprint=? AND id != ?`).bind(o.evidence_fingerprint, o.id).first<any>();
  if (dup) preconditionFailures.push('duplicate_fingerprint');

  if (preconditionFailures.length > 0) {
    return { ok: false, reason: `Conversion preconditions not met: ${preconditionFailures.join('; ')}`, dealCandidateId: null, publishGateCheck: null };
  }

  // Independently re-evaluate the EXISTING Class B public-deal gate - this is what guarantees
  // no opportunity lifecycle status can bypass it. A candidate that fails this is still created
  // (so a human can see exactly why in the review queue) but is never auto-published by this
  // function - only the existing, unmodified autoPublishDealIfEligible() path can ever do that.
  const publishCandidate: DealAutoPublishCandidate = {
    source_approval_status: 'APPROVED', // this feature never invents source approval - see report: only used in the isolated test mirror, never asserted against a real deal_sources row
    source_url: o.canonical_source_url,
    seller_or_marketer: o.provider_name,
    proposed_offer_name: o.detected_title,
    factual_summary: o.detected_offer_text,
    category: o.category,
    fiji_location: o.locality || o.region,
    advertised_price: o.price_amount,
    currency: o.currency,
    price_basis: o.price_basis,
    booking_deadline: o.booking_deadline,
    offer_expires_at: o.expiry,
    travel_from: o.travel_start,
    travel_until: o.travel_end,
    inclusions: o.inclusions_json,
    minimum_stay: o.minimum_stay,
    minimum_group_size: null,
    booking_route: o.booking_route,
    source_fingerprint: o.evidence_fingerprint,
    current_source_fingerprint: o.evidence_fingerprint,
    source_checked_at: o.last_checked_at,
    expiry_status: o.lifecycle_status === 'EXPIRED' ? 'EXPIRED' : null,
    contradictions: contradictions.length ? contradictions.join('; ') : null,
    duplicate_of_id: null,
  };
  const publishGateCheck = evaluateDealAutoPublishGates(publishCandidate);

  const dealCandidateId = crypto.randomUUID();
  await targetDb.prepare(
    `INSERT INTO ${targetTable} (id, proposed_offer_name, factual_summary, category, fiji_location, advertised_price, currency, price_basis, booking_deadline, travel_from, travel_until, inclusions, minimum_stay, booking_route, seller_or_marketer, review_status, source_url, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`
  ).bind(
    dealCandidateId, o.detected_title, o.detected_offer_text, o.category, o.locality || o.region,
    o.price_amount, o.currency, o.price_basis, o.booking_deadline, o.travel_start, o.travel_end,
    o.inclusions_json, o.minimum_stay, o.booking_route, o.provider_name, 'NEEDS_HUMAN_REVIEW', o.canonical_source_url
  ).run();

  await env.OPPORTUNITY_DB.prepare(`UPDATE opportunities SET lifecycle_status='PUBLICATION_REVIEW', linked_deal_candidate_id=?, updated_at=? WHERE id=?`)
    .bind(dealCandidateId, new Date().toISOString(), o.id).run();
  await recordEvent(env.OPPORTUNITY_DB, o.id, o.lifecycle_status, 'PUBLICATION_REVIEW', 'HUMAN', actorIdentity,
    'Governed conversion to a deal candidate for the existing Class B public-deal path to independently evaluate.',
    { dealCandidateId, publishGateCheck });

  return { ok: true, reason: null, dealCandidateId, publishGateCheck };
}

export async function setLifecycleStatus(
  env: Bindings, opportunityId: string, newStatus: LifecycleStatus, actorType: 'AI' | 'HUMAN' | 'SYSTEM', actorIdentity: string | null, reason: string
): Promise<void> {
  const o = await env.OPPORTUNITY_DB.prepare(`SELECT lifecycle_status FROM opportunities WHERE id=?`).bind(opportunityId).first<any>();
  if (!o) throw new Error('opportunity_not_found');
  await env.OPPORTUNITY_DB.prepare(`UPDATE opportunities SET lifecycle_status=?, updated_at=? WHERE id=?`).bind(newStatus, new Date().toISOString(), opportunityId).run();
  await recordEvent(env.OPPORTUNITY_DB, opportunityId, o.lifecycle_status, newStatus, actorType, actorIdentity, reason);
}
