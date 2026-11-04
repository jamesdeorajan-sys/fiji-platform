import test from 'node:test';import assert from 'node:assert/strict';import {calculateExperienceQuote as quote} from '../src/lib/price-quote.mjs';
test('per-person pricing multiplies guests',()=>assert.equal(quote({priceFjdCents:10000,priceBasis:'person',guests:3}).totalFjdCents,30000));
test('group price is not multiplied by guests',()=>assert.equal(quote({priceFjdCents:45000,priceBasis:'group',guests:4,maxGroupSize:6}).totalFjdCents,45000));
test('vehicle pricing multiplies vehicles not passengers',()=>assert.equal(quote({priceFjdCents:20000,priceBasis:'vehicle',guests:7,units:2,maxGroupSize:4}).totalFjdCents,40000));
test('excess group capacity rejected',()=>assert.throws(()=>quote({priceFjdCents:45000,priceBasis:'group',guests:7,maxGroupSize:6})));
test('zero and negative prices rejected',()=>assert.throws(()=>quote({priceFjdCents:0,priceBasis:'person',guests:1})));
test('invalid price basis rejected',()=>assert.throws(()=>quote({priceFjdCents:10000,priceBasis:'USD',guests:1})));
test('fee included transparently',()=>assert.equal(quote({priceFjdCents:10000,priceBasis:'person',guests:2,feesFjdCents:500}).totalFjdCents,20500));
test('pending until operator accepts',()=>assert.equal(quote({priceFjdCents:10000,priceBasis:'person',guests:1}).requiresOperatorAcceptance,true));
