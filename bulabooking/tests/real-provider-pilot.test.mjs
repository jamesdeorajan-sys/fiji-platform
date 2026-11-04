import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pilotTours,pilotProvider,transferPartner} from '../src/data/pilot-tours.mjs';

test('pilot has four distinct real-source tours',()=>{
 assert.equal(pilotTours.length,4);
 assert.equal(new Set(pilotTours.map(t=>t.slug)).size,4);
});
test('tour links stay on official source domain',()=>{
 for(const tour of pilotTours){
  const u=new URL(tour.sourceUrl);
  assert.equal(u.protocol,'https:');
  assert.equal(u.hostname,'fijitourtransfers.com');
  assert.ok(u.pathname.startsWith('/tours/'));
 }
});
test('source AUD is never silently described as FJD',()=>{
 for(const tour of pilotTours){
  assert.equal(tour.sourceCurrency,'AUD');
  assert.ok(Number.isFinite(tour.sourcePrice)&&tour.sourcePrice>0);
 }
});
test('pilot operator remains unverified',()=>{
 assert.equal(pilotProvider.verification,'pilot_source_review_pending');
 assert.equal(pilotProvider.bookingMode,'external_provider_site');
});
test('NAT affiliation is disclosed',()=>{
 assert.equal(transferPartner.affiliation,'Affiliated transfer service');
 assert.equal(new URL(transferPartner.website).hostname,'nadiairporttransfers.com');
});
test('pilot page stays noindex with external booking and disclaimer',()=>{
 const html=readFileSync(new URL('../src/pages/pilot/fiji-tour-transfers.astro',import.meta.url),'utf8');
 assert.match(html,/noindex,nofollow/);
 assert.match(html,/Source prices are advertised in AUD/);
 assert.match(html,/rel="noopener noreferrer sponsored"/);
 assert.match(html,/AU\$\{t.sourcePrice\}/);
});
test('homepage links pilot and NAT',()=>{
 const html=readFileSync(new URL('../src/pages/index.astro',import.meta.url),'utf8');
 assert.match(html,/\/pilot\/fiji-tour-transfers\//);
 assert.match(html,/https:\/\/nadiairporttransfers.com\//);
});
