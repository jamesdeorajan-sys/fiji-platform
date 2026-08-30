import { describe, it, expect } from 'vitest';
import { FakeD1 } from './fake-d1';
import {
  determineOfferAction, classifyBookingRoute, classifyOwnedProduct, filterEligibleOffers,
  compareOffers, parseNaturalLanguageIntent, recordOutboundClick, createEnquiryReview,
  buildEnquiryIdempotencyKey, markWhatsappLinkOpened, confirmHumanContact,
  type PublicDealSummary,
} from '../deal-exchange-listing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FUTURE_SEPT = { start: '2026-09-01T00:00:00Z', end: '2026-09-10T00:00:00Z' };
const OCT_ONLY = { start: '2026-10-26T00:00:00Z', end: '2027-07-27T00:00:00Z' };

function summary(overrides: Partial<PublicDealSummary> = {}): PublicDealSummary {
  return {
    id: 'off-1', offerOwnerType: 'PROVIDER_DIRECT', title: 'Test Offer', providerName: 'Test Resort',
    sellerName: null, region: 'Denarau', category: 'accommodation', priceAmount: '899', currency: 'FJD',
    isFromPrice: true, priceBasis: 'PER_PERSON', occupancyBasis: 'twin share', nights: 5,
    inclusions: 'Breakfast', travelStart: FUTURE_SEPT.start, travelEnd: FUTURE_SEPT.end,
    bookingDeadline: '2026-08-31T00:00:00Z', checkedAt: '2026-08-24T12:00:00Z', bookingRoute: 'https://test-resort.test/book',
    audience: ['family'],
    ...overrides,
  };
}

describe('Milestone 3 test 1: September excludes an October-only deal', () => {
  it('a deal whose travel window starts in October is excluded from a September search', () => {
    const offers = [summary({ id: 'sept-deal' }), summary({ id: 'oct-deal', travelStart: OCT_ONLY.start, travelEnd: OCT_ONLY.end })];
    const result = filterEligibleOffers(offers, { travelYear: 2026, travelMonth: 9 });
    expect(result.map(o => o.id)).toEqual(['sept-deal']);
    expect(result.map(o => o.id)).not.toContain('oct-deal');
  });

  it('this is the exact real My Fiji / Radisson Blu case found in Milestone 2 research', () => {
    const myFijiRadisson = summary({ id: 'myfiji-radisson', offerOwnerType: 'SELLER_PACKAGE', sellerName: 'My Fiji', travelStart: '2026-10-26', travelEnd: '2027-07-27', bookingDeadline: '2026-08-31' });
    const result = filterEligibleOffers([myFijiRadisson], { travelYear: 2026, travelMonth: 9 });
    expect(result).toHaveLength(0); // has a real booking deadline, but that alone must not count as September eligibility
  });
});

describe('Milestone 3 test 2: undated package remains private (never surfaces publicly)', () => {
  it('an offer with no travel window at all is excluded from ANY month-specific search', () => {
    const undated = summary({ id: 'undated', travelStart: null, travelEnd: null });
    expect(filterEligibleOffers([undated], { travelYear: 2026, travelMonth: 9 })).toHaveLength(0);
    expect(filterEligibleOffers([undated], { travelYear: 2026, travelMonth: 12 })).toHaveLength(0);
  });
});

describe('Milestone 3 test 3 (revised, contact-journey fix 2026-08-28): honest scheme-specific CTAs, never "Book"/"Enquire" for a non-URL route', () => {
  it('a PROVIDER_DIRECT offer with only an email route gets "Email provider" and requires review, never "Book now"', () => {
    const action = determineOfferAction('PROVIDER_DIRECT', null, 'info@resort.test');
    expect(action.label).toBe('Email provider');
    expect(action.cta).toBe('Email provider');
    expect(action.actionType).toBe('EMAIL_PROVIDER');
    expect(action.requiresReview).toBe(true);
    expect(action.label.toLowerCase()).not.toContain('book now');
    expect(action.cta.toLowerCase()).not.toMatch(/^book now/);
  });

  it('a PROVIDER_DIRECT offer with only a phone route gets "Call provider" and requires review', () => {
    const action = determineOfferAction('PROVIDER_DIRECT', null, '+679 229 8969');
    expect(action.actionType).toBe('CALL_PROVIDER');
    expect(action.label).toBe('Call provider');
    expect(action.requiresReview).toBe(true);
  });

  it('a PROVIDER_DIRECT offer with a real bookable URL gets "Book on provider website" and does not require review', () => {
    const action = determineOfferAction('PROVIDER_DIRECT', null, 'https://taveunipalms.com/book');
    expect(action.label).toBe('Book on provider website');
    expect(action.actionType).toBe('BOOK_PROVIDER');
    expect(action.requiresReview).toBe(false);
  });

  it('classifyBookingRoute distinguishes email from phone from a real URL', () => {
    expect(classifyBookingRoute('info@resort.test')).toBe('EMAIL_ONLY');
    expect(classifyBookingRoute('mailto:info@resort.test')).toBe('EMAIL_ONLY');
    expect(classifyBookingRoute('+679 229 8969')).toBe('PHONE_ONLY');
    expect(classifyBookingRoute('https://resort.test/book')).toBe('BOOKABLE_URL');
    expect(classifyBookingRoute(null)).toBe('NONE');
  });
});

describe('Milestone 3 test 4 (revised, contact-journey fix 2026-08-28): seller label and route', () => {
  it('a SELLER_PACKAGE offer with an https route gets the same honest "Book on provider website" CTA, keeping VIEW_SELLER_PACKAGE for internal attribution', () => {
    const action = determineOfferAction('SELLER_PACKAGE', 'My Fiji', 'https://myfiji.com/package/x');
    expect(action.label).toBe('Book on provider website');
    expect(action.cta).toBe('Book on provider website');
    expect(action.actionType).toBe('VIEW_SELLER_PACKAGE');
    expect(action.requiresReview).toBe(false);
  });
  it('a SELLER_PACKAGE offer with no seller name has no valid public action', () => {
    const action = determineOfferAction('SELLER_PACKAGE', null, 'https://example.test');
    expect(action.actionType).toBe('NONE');
  });
});

describe('Milestone 3 test 5: an owned product is not automatically a deal', () => {
  it('a discount with no stated validity window is ORDINARY_BOOKABLE, not GENUINE_CURRENT_SPECIAL', () => {
    const r = classifyOwnedProduct({
      productName: 'Nadi Cultural Night Tour', category: 'tour', priceAmount: '135', currency: 'AUD',
      priceBasisConfirmed: true, discountShown: true, validityWindowStated: false, bookingRoute: 'https://fijitourtransfers.com/tour',
    });
    expect(r.classification).toBe('ORDINARY_BOOKABLE');
    expect(r.reason).toMatch(/no expiry\/validity window/);
  });

  it('a discount WITH a stated validity window is a genuine current special', () => {
    const r = classifyOwnedProduct({
      productName: 'Seasonal Sale', category: 'tour', priceAmount: '100', currency: 'AUD',
      priceBasisConfirmed: true, discountShown: true, validityWindowStated: true, bookingRoute: 'https://fijitourtransfers.com/tour',
    });
    expect(r.classification).toBe('GENUINE_CURRENT_SPECIAL');
  });

  it('missing price, currency, or booking route is incomplete/contradictory', () => {
    const r = classifyOwnedProduct({
      productName: 'X', category: 'tour', priceAmount: null, currency: null,
      priceBasisConfirmed: false, discountShown: false, validityWindowStated: false, bookingRoute: null,
    });
    expect(r.classification).toBe('INCOMPLETE_CONTRADICTORY');
  });

  it('an excluded identity is quarantined regardless of otherwise-complete data', () => {
    const r = classifyOwnedProduct({
      productName: 'X', category: 'tour', priceAmount: '100', currency: 'AUD',
      priceBasisConfirmed: true, discountShown: false, validityWindowStated: false, bookingRoute: 'https://x.test',
      isExcludedIdentity: true,
    });
    expect(r.classification).toBe('EXCLUDED_QUARANTINED');
  });
});

describe('Milestone 3 test 6: fixed-price transfer versus live-quote route', () => {
  it('a real fixed-price transfer with a confirmed basis and route is ordinary bookable', () => {
    const r = classifyOwnedProduct({
      productName: 'Nadi Airport to Aquarius Beach Resort', category: 'transfer', priceAmount: '8', currency: 'AUD',
      priceBasisConfirmed: true, discountShown: false, validityWindowStated: false, bookingRoute: 'https://fijitourtransfers.com/transfer',
    });
    expect(r.classification).toBe('ORDINARY_BOOKABLE');
  });
  it('a live distance-calculator route with no fixed price is correctly incomplete for fixed-price listing purposes (never invents a price)', () => {
    const r = classifyOwnedProduct({
      productName: 'Nadi Airport Transfers (any destination)', category: 'transfer', priceAmount: null, currency: null,
      priceBasisConfirmed: false, discountShown: false, validityWindowStated: false, bookingRoute: 'https://nadiairporttransfers.com',
    });
    expect(r.classification).toBe('INCOMPLETE_CONTRADICTORY');
    expect(r.reason).toMatch(/Missing price/);
  });
});

describe('Milestone 3 test 7: comparing incompatible price bases', () => {
  it('comparing a per-person offer against a total-price offer states why, rather than ranking one cheaper', () => {
    const a = summary({ id: 'a', priceBasis: 'PER_PERSON', priceAmount: '899' });
    const b = summary({ id: 'b', priceBasis: 'TOTAL', priceAmount: '3500' });
    const result = compareOffers([a, b]);
    expect(result.allComparable).toBe(false);
    expect(result.entries[0].incomparabilityReason).toMatch(/differs/);
    expect(result.entries[1].incomparabilityReason).toMatch(/differs/);
  });
  it('comparing two offers with the same price basis is fully comparable', () => {
    const a = summary({ id: 'a', priceBasis: 'PER_PERSON' });
    const b = summary({ id: 'b', priceBasis: 'PER_PERSON' });
    const result = compareOffers([a, b]);
    expect(result.allComparable).toBe(true);
  });
  it('refuses to compare more than 3 at once', () => {
    const offers = [summary({ id: 'a' }), summary({ id: 'b' }), summary({ id: 'c' }), summary({ id: 'd' })];
    expect(() => compareOffers(offers)).toThrow('at most 3');
  });
});

describe('Milestone 3 test 8: saved trip never stores contact PII (source inspection of the client script)', () => {
  it('the saved-trip localStorage script only ever writes id/title fields, never email/phone/name inputs', () => {
    const src = readFileSync(fileURLToPath(new URL('../deal-exchange-ui.ts', import.meta.url)), 'utf8');
    const scriptMatch = src.match(/const SAVED_TRIP_SCRIPT = `([\s\S]*?)`;/);
    expect(scriptMatch).not.toBeNull();
    const script = scriptMatch![1];
    expect(script).not.toMatch(/email/i);
    expect(script).not.toMatch(/phone/i);
    expect(script).toMatch(/deals\.push\(\{id:\s*id,\s*title:\s*title\}\)/);
  });
});

describe('Milestone 3 test 9: AI (natural-language) intent cannot override deterministic eligibility', () => {
  it('parseNaturalLanguageIntent returns only filter criteria - it has no field that could carry a price, result, or availability claim', () => {
    const parsed = parseNaturalLanguageIntent('Family of four travelling from Sydney to Fiji in September for seven nights near Denarau');
    expect(parsed.filters.travelMonth).toBe(9);
    expect(parsed.filters.region).toBe('denarau');
    expect(parsed.filters.audience).toBe('family');
    // The parsed result is ONLY ever fed into filterEligibleOffers() as filter criteria - it is
    // structurally incapable of injecting a result, price, or availability claim of its own.
    expect(Object.keys(parsed)).toEqual(['filters', 'matchedPhrases', 'confidence']);
    expect((parsed as any).results).toBeUndefined();
    expect((parsed as any).price).toBeUndefined();
  });

  it('the parsed filters, once applied, still correctly exclude an October-only deal from a September request', () => {
    const parsed = parseNaturalLanguageIntent('looking for something in September 2026');
    const offers = [summary({ id: 'sept' }), summary({ id: 'oct', travelStart: OCT_ONLY.start, travelEnd: OCT_ONLY.end })];
    const result = filterEligibleOffers(offers, parsed.filters);
    expect(result.map(o => o.id)).toEqual(['sept']);
  });
});

describe('Milestone 3 test 10: outbound attribution is recorded before the redirect fires', () => {
  it('recordOutboundClick writes the row and returns the destination for the caller to redirect to', async () => {
    const db = new FakeD1();
    const result = await recordOutboundClick(db as any, {
      sourceSite: 'vakaviti-live-deal-exchange', sourcePage: '/deals/off-1', campaign: null, queryRef: null,
      providerId: 'prov-1', productId: null, dealId: 'off-1', sellerId: null, enquiryId: null,
      fulfilmentRoute: 'BOOK_PROVIDER', outboundDestination: 'https://taveunipalms.com/book', idempotencyKey: 'k1',
    });
    expect(result.recorded).toBe(true);
    expect(result.alreadyExisted).toBe(false);
    expect(result.outboundDestination).toBe('https://taveunipalms.com/book');
    expect(db.tables['deal_exchange_outbound_clicks']).toHaveLength(1);
    expect(db.tables['deal_exchange_outbound_clicks'][0].deal_id).toBe('off-1');
  });
});

describe('Milestone 3 test 11: duplicate outbound requests are idempotent', () => {
  it('the same idempotency key does not create a second row', async () => {
    const db = new FakeD1();
    const input = {
      sourceSite: 's', sourcePage: 'p', campaign: null, queryRef: null,
      providerId: null, productId: null, dealId: 'off-1', sellerId: null, enquiryId: null,
      fulfilmentRoute: 'BOOK_PROVIDER', outboundDestination: 'https://x.test', idempotencyKey: 'same-key',
    };
    const r1 = await recordOutboundClick(db as any, input);
    const r2 = await recordOutboundClick(db as any, input);
    expect(r1.alreadyExisted).toBe(false);
    expect(r2.alreadyExisted).toBe(true);
    expect(db.tables['deal_exchange_outbound_clicks']).toHaveLength(1);
  });
});

describe('Milestone 3 test 12: an expired-window deal disappears from any month search', () => {
  it('a deal whose entire travel window is in the past does not match a current-or-future month query', () => {
    const expired = summary({ id: 'expired', travelStart: '2020-01-01T00:00:00Z', travelEnd: '2020-01-10T00:00:00Z' });
    expect(filterEligibleOffers([expired], { travelYear: 2026, travelMonth: 9 })).toHaveLength(0);
  });
});

describe('Milestone 3 test 13: graceful handling when the intent parser finds nothing (no AI dependency to fail)', () => {
  it('unparseable or empty text returns LOW confidence and empty filters, never throws', () => {
    expect(() => parseNaturalLanguageIntent('')).not.toThrow();
    const empty = parseNaturalLanguageIntent('asdkjfh qwerty zzz');
    expect(empty.confidence).toBe('LOW');
    expect(Object.keys(empty.filters)).toHaveLength(0);
  });
  it('there is no AI.run() call anywhere in the intent parser or listing service, so there is no AI timeout to handle in the first place', () => {
    const src = readFileSync(fileURLToPath(new URL('../deal-exchange-listing.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/AI\.run\(/);
  });
});

describe('Milestone 3 test 14: empty state', () => {
  it('filtering an empty offer list returns an empty array without throwing', () => {
    expect(filterEligibleOffers([], { travelYear: 2026, travelMonth: 9 })).toEqual([]);
  });
  it('the Deals page source renders an explicit empty-state message, not a blank page', () => {
    const src = readFileSync(fileURLToPath(new URL('../deal-exchange-ui.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/No deals match these filters/);
  });
});

describe('Milestone 3 test 15 (revised, contact-journey fix 2026-08-28): every offer-owner type produces the exact required label', () => {
  it('VAKAVITI_BOOKABLE, PROVIDER_DIRECT (all three route types), SELLER_PACKAGE, and the two never-public types', () => {
    expect(determineOfferAction('VAKAVITI_BOOKABLE', null, 'https://fijitourtransfers.com').label).toBe('Book through Vakaviti');
    expect(determineOfferAction('PROVIDER_DIRECT', null, 'https://resort.test/book').label).toBe('Book on provider website');
    expect(determineOfferAction('PROVIDER_DIRECT', null, 'info@resort.test').label).toBe('Email provider');
    expect(determineOfferAction('PROVIDER_DIRECT', null, '+679 229 8969').label).toBe('Call provider');
    expect(determineOfferAction('SELLER_PACKAGE', 'My Fiji', 'https://myfiji.test').label).toBe('Book on provider website');
    expect(determineOfferAction('PRICE_CHECK_REQUIRED', null, null).actionType).toBe('NONE');
    expect(determineOfferAction('FLIGHT_QUOTE', null, null).actionType).toBe('NONE');
  });
});

describe('createEnquiryReview - WhatsApp handoff never sends anything itself', () => {
  it('creates a review record with a real reference and starts at REVIEW_CREATED / booking_outcome UNKNOWN', async () => {
    const db = new FakeD1();
    const input = { dealId: 'off-1', productId: null, travelDates: 'Sept 2026', partySize: '4', hotelOrArrivalPoint: 'Denarau', unresolvedQuestions: 'Is breakfast included?' };
    const idempotencyKey = await buildEnquiryIdempotencyKey(input);
    const result = await createEnquiryReview(db as any, { ...input, idempotencyKey });
    expect(result.enquiryReference).toMatch(/^VKV-/);
    expect(result.alreadyExisted).toBe(false);
    expect(db.tables['deal_exchange_enquiries']).toHaveLength(1);
    expect(db.tables['deal_exchange_enquiries'][0].status).toBe('REVIEW_CREATED');
    expect(db.tables['deal_exchange_enquiries'][0].booking_outcome).toBe('UNKNOWN');
  });
});

describe('Milestone 4 entry gate 2: WhatsApp review/handoff lifecycle', () => {
  it('a refresh/double-click resubmit of the identical review does not create a duplicate enquiry', async () => {
    const db = new FakeD1();
    const input = { dealId: 'off-1', productId: null, travelDates: 'Sept 2026', partySize: '2', hotelOrArrivalPoint: 'Nadi', unresolvedQuestions: null };
    const key = await buildEnquiryIdempotencyKey(input);
    const r1 = await createEnquiryReview(db as any, { ...input, idempotencyKey: key });
    const r2 = await createEnquiryReview(db as any, { ...input, idempotencyKey: key });
    expect(r1.alreadyExisted).toBe(false);
    expect(r2.alreadyExisted).toBe(true);
    expect(r2.enquiryReference).toBe(r1.enquiryReference);
    expect(db.tables['deal_exchange_enquiries']).toHaveLength(1);
  });

  it('genuinely different review content produces a different enquiry', async () => {
    const a = await buildEnquiryIdempotencyKey({ dealId: 'off-1', productId: null, travelDates: 'Sept', partySize: '2', hotelOrArrivalPoint: 'Nadi', unresolvedQuestions: null });
    const b = await buildEnquiryIdempotencyKey({ dealId: 'off-1', productId: null, travelDates: 'Sept', partySize: '4', hotelOrArrivalPoint: 'Nadi', unresolvedQuestions: null });
    expect(a).not.toBe(b);
  });

  it('CEO test: opening the WhatsApp link only ever sets WHATSAPP_LINK_OPENED - it never claims a message was sent', async () => {
    const db = new FakeD1();
    const key = await buildEnquiryIdempotencyKey({ dealId: 'off-1', productId: null, travelDates: 'Sept', partySize: '2', hotelOrArrivalPoint: 'Nadi', unresolvedQuestions: null });
    const created = await createEnquiryReview(db as any, { dealId: 'off-1', productId: null, travelDates: 'Sept', partySize: '2', hotelOrArrivalPoint: 'Nadi', unresolvedQuestions: null, idempotencyKey: key });
    const result = await markWhatsappLinkOpened(db as any, created.enquiryId);
    expect(result.updated).toBe(true);
    const row = db.tables['deal_exchange_enquiries'].find((r: any) => r.id === created.enquiryId);
    expect(row.status).toBe('WHATSAPP_LINK_OPENED');
    expect(row.whatsapp_link_opened_at).toBeTruthy();
    // Nothing about this call, or anywhere in this module, ever sets a "message sent"/"MESSAGE_SENT"
    // style status - the only status values that exist at all are the three explicit lifecycle
    // states, none of which claim delivery.
    expect(['REVIEW_CREATED', 'WHATSAPP_LINK_OPENED', 'HUMAN_CONTACT_CONFIRMED']).toContain(row.status);
  });

  it('opening the link twice does not regress or duplicate the transition', async () => {
    const db = new FakeD1();
    const key = await buildEnquiryIdempotencyKey({ dealId: 'off-1', productId: null, travelDates: 'Sept', partySize: '2', hotelOrArrivalPoint: 'Nadi', unresolvedQuestions: null });
    const created = await createEnquiryReview(db as any, { dealId: 'off-1', productId: null, travelDates: 'Sept', partySize: '2', hotelOrArrivalPoint: 'Nadi', unresolvedQuestions: null, idempotencyKey: key });
    const first = await markWhatsappLinkOpened(db as any, created.enquiryId);
    const second = await markWhatsappLinkOpened(db as any, created.enquiryId);
    expect(first.updated).toBe(true);
    expect(second.updated).toBe(false); // already past REVIEW_CREATED - not re-applied
  });

  it('HUMAN_CONTACT_CONFIRMED exists as a real, callable mechanism, even though nothing in the visitor UI calls it yet (it requires later human evidence)', async () => {
    const db = new FakeD1();
    const key = await buildEnquiryIdempotencyKey({ dealId: 'off-1', productId: null, travelDates: 'Sept', partySize: '2', hotelOrArrivalPoint: 'Nadi', unresolvedQuestions: null });
    const created = await createEnquiryReview(db as any, { dealId: 'off-1', productId: null, travelDates: 'Sept', partySize: '2', hotelOrArrivalPoint: 'Nadi', unresolvedQuestions: null, idempotencyKey: key });
    const result = await confirmHumanContact(db as any, created.enquiryId, 'staff-member');
    expect(result.updated).toBe(true);
    const row = db.tables['deal_exchange_enquiries'].find((r: any) => r.id === created.enquiryId);
    expect(row.status).toBe('HUMAN_CONTACT_CONFIRMED');
    expect(row.human_contact_confirmed_by).toBe('staff-member');
  });

  it('the migration schema itself only ever allows booking_outcome to be UNKNOWN - a database-level guarantee, not just an application convention', () => {
    // See migrations/deal-exchange/0004_enquiry_lifecycle.sql: booking_outcome has a CHECK
    // constraint permitting only the single value 'UNKNOWN' - there is no column value this
    // module (or any future caller) could set that would let a booking be falsely claimed.
    const src = readFileSync(fileURLToPath(new URL('../../migrations/deal-exchange/0004_enquiry_lifecycle.sql', import.meta.url)), 'utf8');
    expect(src).toMatch(/booking_outcome TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK \(booking_outcome IN \('UNKNOWN'\)\)/);
  });
});
