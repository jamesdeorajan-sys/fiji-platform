import test from 'node:test';import assert from 'node:assert/strict';import {assessListingGrowth,createGrowthAgentBrief} from '../src/lib/growth-agent.mjs';
test('missing FJD price is critical',()=>assert.equal(assessListingGrowth({}).actions[0].id,'fj_dollars'));
test('invalid price basis flagged',()=>assert.ok(assessListingGrowth({priceFjdCents:10000,priceBasis:'USD'}).actions.some(a=>a.id==='fj_dollars')));
test('short descriptions need improvement',()=>assert.ok(assessListingGrowth({description:'Short'}).actions.some(a=>a.id==='expand_description')));
test('empty photos flagged',()=>assert.ok(assessListingGrowth({photos:[]}).actions.some(a=>a.id==='add_photos')));
test('verification is not fabricated',()=>assert.ok(assessListingGrowth({operatorVerified:false}).actions.some(a=>a.id==='verification_disclosure')));
test('recommendations never auto-publish',()=>assert.equal(assessListingGrowth({}).automaticPublishing,false));
test('AI brief requests approval and factual limits',()=>{const brief=createGrowthAgentBrief({priceFjdCents:10000,secretToken:'DO_NOT_SHARE'});assert.equal(brief.publicationStatus,'draft_only');assert.equal(Object.hasOwn(brief.operatorFacts,'secretToken'),false);});
