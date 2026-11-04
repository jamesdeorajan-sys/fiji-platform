import test from 'node:test';import assert from 'node:assert/strict';import {buildPartnerBookingLink,accommodationReferralState} from '../src/lib/accommodation-referrals.mjs';
const o={operatorId:'operator_001',bookingUrl:'https://hotel.example/book?rate=NOV',approvedBookingOrigin:'https://hotel.example',publicationStatus:'approved',priceFjdCents:29900,priceBasis:'night',startsAt:'2026-11-01T00:00:00+12:00',expiresAt:'2026-12-01T00:00:00+12:00'};
test('active offer links directly to approved partner',()=>assert.equal(buildPartnerBookingLink(o,'2026-11-05T00:00:00Z').href,o.bookingUrl));
test('outbound link identifies partner reservation',()=>assert.equal(buildPartnerBookingLink(o,'2026-11-05T00:00:00Z').reservationHandledBy,'partner'));
test('expired promotion blocks outbound special CTA',()=>assert.equal(accommodationReferralState(o,'2026-12-01T00:00:00+12:00').promotable,false));
test('withdrawn promotion blocks link',()=>assert.throws(()=>buildPartnerBookingLink({...o,publicationStatus:'withdrawn'},'2026-11-05T00:00:00Z')));
test('different destination domain rejected',()=>assert.throws(()=>buildPartnerBookingLink({...o,bookingUrl:'https://other.example/book'},'2026-11-05T00:00:00Z')));
test('http booking rejected',()=>assert.throws(()=>buildPartnerBookingLink({...o,bookingUrl:'http://hotel.example/book'},'2026-11-05T00:00:00Z')));
test('no live availability claims',()=>assert.equal(buildPartnerBookingLink(o,'2026-11-05T00:00:00Z').availabilityVerifiedByBulaBooking,false));
