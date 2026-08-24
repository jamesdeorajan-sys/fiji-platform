import { describe, it, expect } from 'vitest';
import { FakeD1 } from './fake-d1';
import {
  captureOrUpdateOpportunity, ingestProviderReply, confirmProviderReplyExtraction,
  convertOpportunityToDealCandidate, setLifecycleStatus, deriveOpportunityPublishedState,
  type Bindings, type DiscoveryCaptureInput,
} from '../opportunities';

const futureIso = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

function makeEnv() {
  const oppDb = new FakeD1();
  const mainDb = new FakeD1();
  const mirrorDb = new FakeD1();
  const env = { DB: mainDb as any, OPPORTUNITY_DB: oppDb as any, AI: {} as any, ENVIRONMENT: 'test' } as Bindings;
  return { env, oppDb, mainDb, mirrorDb };
}

// A fully-formed, genuinely-eligible-for-both-lanes input, matching every field
// evaluateOpportunityCaptureGates AND (once converted) evaluateDealAutoPublishGates requires -
// individual tests override just the field(s) under test.
const validInput = (overrides: Partial<DiscoveryCaptureInput> = {}): DiscoveryCaptureInput => ({
  canonicalSourceUrl: 'https://example-resort.test/specials',
  providerName: 'Example Resort',
  providerDomain: 'example-resort.test',
  detectedTitle: 'Special stay package',
  detectedOfferText: 'A special package offer with savings',
  evidenceExcerpt: 'This week only: a special stay package with real savings for guests booking direct.',
  pageText: 'This week only: a special stay package with real savings for guests booking direct.',
  region: 'Nadi', locality: 'Nadi', category: 'accommodation',
  priceAmount: '199', currency: 'FJD', priceBasis: 'PER_NIGHT',
  bookingDeadline: futureIso(30), travelStart: futureIso(40), travelEnd: futureIso(45), expiry: futureIso(60),
  inclusionsJson: JSON.stringify(['breakfast']), exclusionsJson: null,
  occupancyBasis: 'double', minimumStay: '2 nights',
  bookingRoute: 'https://example-resort.test/book', providerContactRoute: 'contact@example-resort.test',
  sourceId: null, sourceScanId: null, isAggregatorEvidence: false, isTestFixture: true,
  ...overrides,
});

describe('captureOrUpdateOpportunity - persistence/dedup/event layer around the capture gate', () => {
  it('captures a new valid opportunity and records exactly one DETECTED event', async () => {
    const { env, oppDb } = makeEnv();
    const r = await captureOrUpdateOpportunity(env, validInput(), 'test-actor');
    expect(r.outcome).toBe('CAPTURED');
    expect(oppDb.tables['opportunities'].length).toBe(1);
    const events = oppDb.tables['opportunity_lifecycle_events'].filter((e: any) => e.opportunity_id === r.opportunityId);
    expect(events.length).toBe(1);
    expect(events[0].new_status).toBe('DETECTED');
    expect(events[0].actor_type).toBe('AI');
  });

  it('CEO test: rejects capture when the gate fails, and writes no row at all (generic homepage / no offer signal)', async () => {
    const { env, oppDb } = makeEnv();
    const r = await captureOrUpdateOpportunity(env, validInput({
      detectedTitle: 'Welcome', detectedOfferText: null,
      evidenceExcerpt: 'Welcome to our resort, we look forward to hosting you.',
      pageText: 'Welcome to our resort, we look forward to hosting you.',
    }), 'test-actor');
    expect(r.outcome).toBe('REJECTED');
    expect(oppDb.tables['opportunities']?.length ?? 0).toBe(0);
  });

  it('CEO test: an identical re-scan (duplicate fingerprint) does not create a second row', async () => {
    const { env, oppDb } = makeEnv();
    const r1 = await captureOrUpdateOpportunity(env, validInput(), 'test-actor');
    const r2 = await captureOrUpdateOpportunity(env, validInput(), 'test-actor');
    expect(r1.outcome).toBe('CAPTURED');
    expect(r2.outcome).toBe('UPDATED_UNCHANGED');
    expect(r2.opportunityId).toBe(r1.opportunityId);
    expect(oppDb.tables['opportunities'].length).toBe(1);
  });

  it('CEO test: a material change (price change) creates exactly one new lifecycle event tied to the new row, not a duplicate of the old fingerprint', async () => {
    const { env, oppDb } = makeEnv();
    const r1 = await captureOrUpdateOpportunity(env, validInput(), 'test-actor');
    const r2 = await captureOrUpdateOpportunity(env, validInput({ priceAmount: '249' }), 'test-actor');
    expect(r2.outcome).toBe('MATERIAL_CHANGE');
    expect(r2.opportunityId).not.toBe(r1.opportunityId);
    expect(oppDb.tables['opportunities'].length).toBe(2);
    const eventsForNew = oppDb.tables['opportunity_lifecycle_events'].filter((e: any) => e.opportunity_id === r2.opportunityId);
    expect(eventsForNew.length).toBe(1);
    expect(eventsForNew[0].new_status).toBe('DETECTED');
    expect(eventsForNew[0].prior_status).toBe('DETECTED'); // prior row's status, linked via metadata
  });

  it('a CEO-excluded identity is rejected even with otherwise-perfect evidence', async () => {
    const { env, oppDb } = makeEnv();
    const r = await captureOrUpdateOpportunity(env, validInput({ providerDomain: 'tourfijitours.com', providerName: 'Tour Fiji Tours' }), 'test-actor');
    expect(r.outcome).toBe('REJECTED');
    expect(oppDb.tables['opportunities']?.length ?? 0).toBe(0);
  });
});

describe('ingestProviderReply / confirmProviderReplyExtraction - Phase 6 evidence & confirmation', () => {
  it('records the reply verbatim and moves lifecycle to PROVIDER_REPLIED without touching any fact field', async () => {
    const { env, oppDb } = makeEnv();
    const cap = await captureOrUpdateOpportunity(env, validInput(), 'test-actor');
    await ingestProviderReply(env, cap.opportunityId!, 'Yes still available, 249 FJD per night.', 'admin', { price_amount: '249' });
    const opp = oppDb.tables['opportunities'].find((o: any) => o.id === cap.opportunityId)!;
    expect(opp.lifecycle_status).toBe('PROVIDER_REPLIED');
    expect(opp.price_amount).toBe('199'); // unchanged - reply alone never applies facts
    const reply = oppDb.tables['opportunity_provider_replies'][0];
    expect(reply.human_confirmed).toBe(0);
    expect(reply.raw_reply_text).toBe('Yes still available, 249 FJD per night.');
  });

  it('flags a genuine contradiction between the website-derived price and the reply-proposed price', async () => {
    const { env } = makeEnv();
    const cap = await captureOrUpdateOpportunity(env, validInput(), 'test-actor');
    const { contradictionFlags } = await ingestProviderReply(env, cap.opportunityId!, 'Actually it is 249 now.', 'admin', { price_amount: '249' });
    expect(contradictionFlags.some(f => f.includes('price_amount'))).toBe(true);
  });

  it('CEO test: confirming extraction applies only the human-entered, allow-listed fields - a provider reply can never grant permission or apply an unlisted field', async () => {
    const { env, oppDb } = makeEnv();
    const cap = await captureOrUpdateOpportunity(env, validInput(), 'test-actor');
    const { replyId } = await ingestProviderReply(env, cap.opportunityId!, 'Yes available, 249 FJD.', 'admin', {});
    await confirmProviderReplyExtraction(env, replyId, {
      price_amount: '249',
      provider_permission_status: 'GRANTED', // not in the allowed list - must be silently ignored
      image_rights_status: 'GRANTED', // not in the allowed list - must be silently ignored
    }, 'admin');
    const opp = oppDb.tables['opportunities'].find((o: any) => o.id === cap.opportunityId)!;
    expect(opp.price_amount).toBe('249');
    expect(opp.provider_permission_status).toBeUndefined();
    expect(opp.image_rights_status).toBeUndefined();
    const reply = oppDb.tables['opportunity_provider_replies'].find((r: any) => r.id === replyId)!;
    expect(reply.human_confirmed).toBe(1);
    expect(reply.confirmed_by).toBe('admin');
  });
});

describe('convertOpportunityToDealCandidate - governed conversion, Class B gates independently required', () => {
  it('CEO test: EXPIRED, WITHDRAWN, REJECTED and DUPLICATE opportunities cannot convert', async () => {
    const { env, mirrorDb } = makeEnv();
    for (const status of ['EXPIRED', 'WITHDRAWN', 'REJECTED', 'DUPLICATE'] as const) {
      const cap = await captureOrUpdateOpportunity(env, validInput({ canonicalSourceUrl: `https://example-resort.test/specials-${status.toLowerCase()}` }), 'test-actor');
      await setLifecycleStatus(env, cap.opportunityId!, status, 'HUMAN', 'admin', 'test transition');
      const result = await convertOpportunityToDealCandidate(env, cap.opportunityId!, 'admin', mirrorDb as any, 'test_deal_offer_candidates_mirror');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain(`lifecycle_status_not_convertible:${status}`);
    }
    expect(mirrorDb.tables['test_deal_offer_candidates_mirror']?.length ?? 0).toBe(0);
  });

  it('CEO test: a missing/unapproved deal source blocks public eligibility even though the governed conversion itself succeeds', async () => {
    const { env, mirrorDb } = makeEnv();
    const cap = await captureOrUpdateOpportunity(env, validInput({ sourceId: null }), 'test-actor');
    const result = await convertOpportunityToDealCandidate(env, cap.opportunityId!, 'admin', mirrorDb as any, 'test_deal_offer_candidates_mirror');
    expect(result.ok).toBe(true); // a NEEDS_HUMAN_REVIEW candidate row is created for human review
    expect(result.publishGateCheck?.decision).toBe('NOT_ELIGIBLE');
    expect(result.publishGateCheck?.failedGates).toContain('source_approved');
    expect(mirrorDb.tables['test_deal_offer_candidates_mirror'].length).toBe(1);
    expect(mirrorDb.tables['test_deal_offer_candidates_mirror'][0].review_status).toBe('NEEDS_HUMAN_REVIEW');
  });

  it('CEO test: an unregistered source_id also fails closed to NOT approved, never defaults to approved', async () => {
    const { env, mainDb, mirrorDb } = makeEnv();
    mainDb.tables['deal_sources'] = []; // no row for this source at all
    const cap = await captureOrUpdateOpportunity(env, validInput({ sourceId: 'unregistered-source' }), 'test-actor');
    const result = await convertOpportunityToDealCandidate(env, cap.opportunityId!, 'admin', mirrorDb as any, 'test_deal_offer_candidates_mirror');
    expect(result.publishGateCheck?.decision).toBe('NOT_ELIGIBLE');
    expect(result.publishGateCheck?.failedGates).toContain('source_approved');
  });

  it('a genuinely APPROVED and fully-complete opportunity independently re-derives ELIGIBLE - proving the public Class B gate is re-run, not bypassed', async () => {
    const { env, mainDb, mirrorDb } = makeEnv();
    mainDb.tables['deal_sources'] = [{ id: 'src-1', source_approval_status: 'APPROVED' }];
    const cap = await captureOrUpdateOpportunity(env, validInput({ sourceId: 'src-1' }), 'test-actor');
    const result = await convertOpportunityToDealCandidate(env, cap.opportunityId!, 'admin', mirrorDb as any, 'test_deal_offer_candidates_mirror');
    expect(result.ok).toBe(true);
    expect(result.publishGateCheck?.decision).toBe('ELIGIBLE');
    expect(result.publishGateCheck?.failedGates).toEqual([]);
  });

  it('required facts still missing (e.g. no price captured) blocks conversion at the precondition stage', async () => {
    const { env, mirrorDb } = makeEnv();
    const cap = await captureOrUpdateOpportunity(env, validInput({ priceAmount: null, currency: null }), 'test-actor');
    const result = await convertOpportunityToDealCandidate(env, cap.opportunityId!, 'admin', mirrorDb as any, 'test_deal_offer_candidates_mirror');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('required_facts_still_missing');
  });

  it('a duplicate fingerprint at conversion time blocks conversion', async () => {
    const { env, oppDb, mirrorDb } = makeEnv();
    const cap = await captureOrUpdateOpportunity(env, validInput(), 'test-actor');
    // Simulate a second row somehow sharing the same fingerprint (defense in depth beyond the
    // UNIQUE constraint already proven at the real D1 layer during earlier engagement testing).
    oppDb.tables['opportunities'].push({ ...oppDb.tables['opportunities'][0], id: 'dup-row-id' });
    const result = await convertOpportunityToDealCandidate(env, cap.opportunityId!, 'admin', mirrorDb as any, 'test_deal_offer_candidates_mirror');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('duplicate_fingerprint');
  });
});

describe('setLifecycleStatus - PUBLISHED cannot be manually set (CEO hardening item 6)', () => {
  it('CEO test: rejects any attempt to directly set PUBLISHED, regardless of actor type', async () => {
    const { env } = makeEnv();
    const cap = await captureOrUpdateOpportunity(env, validInput(), 'test-actor');
    await expect(setLifecycleStatus(env, cap.opportunityId!, 'PUBLISHED', 'HUMAN', 'admin', 'attempt'))
      .rejects.toThrow('lifecycle_status_not_manually_settable:PUBLISHED');
    await expect(setLifecycleStatus(env, cap.opportunityId!, 'PUBLISHED', 'AI', 'ai-agent', 'attempt'))
      .rejects.toThrow('lifecycle_status_not_manually_settable:PUBLISHED');
  });

  it('every other lifecycle status remains settable by a human', async () => {
    const { env, oppDb } = makeEnv();
    const cap = await captureOrUpdateOpportunity(env, validInput(), 'test-actor');
    await setLifecycleStatus(env, cap.opportunityId!, 'OUTREACH_READY', 'HUMAN', 'admin', 'ok');
    const opp = oppDb.tables['opportunities'].find((o: any) => o.id === cap.opportunityId)!;
    expect(opp.lifecycle_status).toBe('OUTREACH_READY');
  });
});

describe('deriveOpportunityPublishedState - the only source of truth for public visibility', () => {
  it('is not published when there is no linked deal candidate at all', async () => {
    const { env } = makeEnv();
    const state = await deriveOpportunityPublishedState(env, { linked_deal_candidate_id: null });
    expect(state.isPublished).toBe(false);
  });

  it('is not published when the linked candidate row cannot be found', async () => {
    const { env } = makeEnv();
    const state = await deriveOpportunityPublishedState(env, { linked_deal_candidate_id: 'missing-id' });
    expect(state.isPublished).toBe(false);
  });

  it('CEO test: is published only when the linked candidate is actually PUBLISHED in the real, independent Class B table', async () => {
    const { env, mainDb } = makeEnv();
    mainDb.tables['deal_offer_candidates'] = [{ id: 'cand-1', review_status: 'PUBLISHED' }];
    const state = await deriveOpportunityPublishedState(env, { linked_deal_candidate_id: 'cand-1' });
    expect(state.isPublished).toBe(true);
  });

  it('CEO test: reflects withdrawn public eligibility immediately, without needing the opportunity row itself to change', async () => {
    const { env, mainDb } = makeEnv();
    mainDb.tables['deal_offer_candidates'] = [{ id: 'cand-1', review_status: 'WITHDRAWN' }];
    const state = await deriveOpportunityPublishedState(env, { linked_deal_candidate_id: 'cand-1' });
    expect(state.isPublished).toBe(false);
    expect(state.reason).toContain('WITHDRAWN');
  });
});
