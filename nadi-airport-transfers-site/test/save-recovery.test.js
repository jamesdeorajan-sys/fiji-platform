import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const requestCode = source.slice(source.indexOf('async function bookingRequest('), source.indexOf('async function submitNadiBooking('));
test('stalled response body times out; no automatic repeat booking request', async () => {
  let calls=0, signal;
  const c={AbortController,setTimeout,clearTimeout,fetch:async(_,o)=>{calls++;signal=o.signal;return {json:()=>new Promise(()=>{})};}};
  vm.createContext(c);vm.runInContext(requestCode,c);
  await assert.rejects(c.bookingRequest('/mock',{},5),/timed out/);
  assert.equal(calls,1);assert.equal(signal.aborted,true);
});
test('failure restores controls; retry preserves fields and ID with storage blocked', async () => {
  const fields={pickup:{value:'NAN'},destination:{value:'HILTON_DENARAU',selectedOptions:[{}]},firstName:{value:'Guest'},email:{value:'guest@example.com'},bookingWidget:{style:{}},bulaSuccess:{style:{}},bulaRetry:{hidden:true}};
  const button={disabled:false,textContent:'Confirm',focus(){}};
  const refs=[];
  const c={document:{getElementById:id=>fields[id],querySelector:()=>button},state:{selectedVehicle:'sedan',passengers:2,luggage:2,tripType:'one-way'},validateBookingContact:()=>true,validateArrivalFlight:()=>true,calculateTotal:()=>({final:49}),sessionStorage:{getItem(){throw Error();},setItem(){throw Error();},removeItem(){}},buildWhatsAppURL:()=>'/mock',resolveFixedDestinationZone:()=> 'Denarau',submitNadiBooking:async ref=>{refs.push(ref);return {ok:false};},showStep:n=>{c.step=n;}};
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('function normalisePhoneForFingerprint('), source.indexOf('// ─── CONFIRM BOOKING')),c);
  vm.runInContext(source.slice(source.indexOf('async function confirmBooking()'),source.indexOf('// Reset the booking flow')),c);
  await c.confirmBooking();
  assert.equal(button.disabled,false);assert.equal(button.textContent,'Confirm');assert.equal(fields.bulaRetry.hidden,false);
  c.retryBooking();assert.equal(c.step,4);assert.equal(fields.bookingWidget.style.display,'');
  assert.equal(fields.email.value,'guest@example.com');
  await c.confirmBooking();assert.equal(refs[0],refs[1]);assert.equal(c.state.confirmBookingInFlight,false);
});
test('double activation while saving only issues one request', async () => {
  let resolveSave; let calls=0;
  const c={state:{},validateBookingContact:()=>true,validateArrivalFlight:()=>true,document:{querySelector:()=>null,getElementById:id=>id==='pickup'?{value:'NAN'}:id==='destination'?{value:'HILTON_DENARAU',selectedOptions:[{}]}:undefined},buildBookingIntentFingerprint:()=> 'same',sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},buildWhatsAppURL:()=>'/mock',resolveFixedDestinationZone:()=> 'Denarau',submitNadiBooking:()=>{calls++;return new Promise(r=>{resolveSave=r;});}};
  vm.createContext(c);vm.runInContext(source.slice(source.indexOf('async function confirmBooking()'),source.indexOf('// Reopen the existing form')),c);
  const first=c.confirmBooking();await c.confirmBooking();assert.equal(calls,1);
  resolveSave({ok:true,bookingId:123});await first;assert.equal(c.state.pendingBookingAttempt,null);
  await c.confirmBooking();assert.equal(calls,1,'successful save cannot be submitted again before reset');
});
