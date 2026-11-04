import test from 'node:test';import assert from 'node:assert/strict';import {buildDiscoveryMetadata,buildExperienceJsonLd,discoveryAudit} from '../src/lib/discovery-seo.mjs';
test('metadata uses HTTPS canonical',()=>assert.equal(buildDiscoveryMetadata({title:'Fiji tours',description:'Locally operated experiences',canonicalUrl:'https://bulabooking.com/tours/'}).canonical,'https://bulabooking.com/tours/'));
test('http canonical rejected',()=>assert.throws(()=>buildDiscoveryMetadata({title:'Fiji',description:'Tour',canonicalUrl:'http://bulabooking.com'})));
test('unverified rankings not emitted',()=>{const ld=buildExperienceJsonLd({name:'Fiji excursion',description:'Operator supplied',url:'https://bulabooking.com/tours/a',operatorName:'Operator'});assert.equal(ld.aggregateRating,undefined);assert.equal(ld.offers,undefined);});
test('FJD offer included when approved',()=>assert.equal(buildExperienceJsonLd({name:'Fiji excursion',description:'Operator supplied',url:'https://bulabooking.com/tours/a',operatorName:'Operator',priceFjdCents:12500,availabilityUrl:'https://bulabooking.com/book/a'}).offers.price,'125.00'));
test('private booking exposure blocks discovery readiness',()=>assert.equal(discoveryAudit({publicApproved:true,indexAllowed:true,noPrivateBookingData:false}).ready,false));
test('no ranking guarantee in audit',()=>assert.match(discoveryAudit({}).note,/not a ranking/));
