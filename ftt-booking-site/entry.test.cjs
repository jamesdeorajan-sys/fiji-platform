const {test}=require('node:test');
const assert=require('node:assert/strict');
const {enterPrefilledBooking}=require('./src/mobile-booking-entry.js');
function run(search,hash='',actualDest='Pearl'){
 let scrolls=0;const els={pickup:{value:'NAN'},destination:{value:actualDest},booking:{scrollIntoView(){scrolls++;}}};
 const result=enterPrefilledBooking({location:{search,hash}},{getElementById:id=>els[id]});
 return {result,scrolls};
}
test('valid prefilled route skips repeat hero',()=>assert.deepEqual(run('?pickup=NAN&dest=Pearl'),{result:true,scrolls:1}));
test('organic homepage remains unchanged',()=>assert.equal(run('').scrolls,0));
test('unrecognised destination never moves past correction',()=>assert.equal(run('?pickup=NAN&dest=Wrong').scrolls,0));
test('explicit non-booking anchor is respected',()=>assert.equal(run('?pickup=NAN&dest=Pearl','#contact').scrolls,0));
test('booking anchor remains supported',()=>assert.equal(run('?pickup=NAN&dest=Pearl','#booking').scrolls,1));
test('partial route does not jump',()=>assert.equal(run('?dest=Pearl').scrolls,0));
test('encoded hotel name must match actual selected hotel',()=>assert.equal(run('?pickup=NAN&dest=Pearl%20South%20Pacific','','Pearl South Pacific').scrolls,1));
