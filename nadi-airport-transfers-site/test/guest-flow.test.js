import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
function harness(overrides = {}) {
  const values = { firstName:'Test', lastName:'Guest', email:'test@example.com', phone:'+12025550123', pickup:'NAN', flightNum:'FJ401' };
  const fields = Object.fromEntries(Object.entries({...values, ...overrides}).map(([id,value]) => [id, {value, checked:false, focus(){this.focused=true;}, reportValidity(){}, setCustomValidity(v){this.error=v;}, scrollIntoView(){}}]));
  fields.flightUnknown = {checked:false}; fields.flightError={hidden:true};
  const c = {document:{getElementById:id=>fields[id]}, state:{selectedVehicle:null}, VEHICLES:[], resolveLocation:()=>({}), showStep:n=>{c.step=n;}, alert:m=>{c.alerted=m;}, buildVehicleDetailCards:()=>'', buildConfirmation:()=>{c.review=true;}};
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('function validateBookingContact()'),source.indexOf('// ─── TOUR BANNER')),c);
  return {c,fields};
}
test('valid route reaches vehicle selection without a preselected vehicle',()=>{const {c}=harness();c.goToStep(2);assert.equal(c.step,2);});
test('cannot skip vehicle selection',()=>{const {c}=harness();c.goToStep(3);assert.equal(c.step,undefined);assert.match(c.alerted,/select a vehicle/);});
test('invalid email returns to visible contact step',()=>{const {c,fields}=harness({email:'not-an-email'});c.goToStep(4);assert.equal(c.step,3);assert.equal(c.review,undefined);assert.equal(fields.email.focused,true);});
test('invalid phone cannot reach review',()=>{const {c}=harness({phone:'x'});c.goToStep(4);assert.equal(c.step,3);assert.equal(c.review,undefined);});
test('valid contact reaches review',()=>{const {c}=harness();c.goToStep(4);assert.equal(c.review,true);assert.equal(c.step,4);});
test('missing flight returns to visible trip step',()=>{const {c,fields}=harness({flightNum:''});assert.equal(c.validateArrivalFlight(),false);assert.equal(c.step,1);assert.equal(fields.flightError.hidden,false);assert.equal(fields.flightNum.focused,true);});
test('explicit unknown flight choice permits progression',()=>{const {c,fields}=harness({flightNum:''});fields.flightUnknown.checked=true;c.goToStep(2);assert.equal(c.step,2);assert.equal(fields.flightError.hidden,true);});
test('non-airport pickup does not require flight details',()=>{const {c}=harness({pickup:'HOTEL',flightNum:''});assert.equal(c.validateArrivalFlight(),true);});
test('invalid submission never locks button or starts a request',async()=>{const {c}=harness({email:'bad'});const start=source.indexOf('async function confirmBooking()');const end=source.indexOf('\nfunction ',start);vm.runInContext(source.slice(start,end),c);await c.confirmBooking();assert.equal(c.state.confirmBookingInFlight,undefined);assert.equal(c.step,3);});
