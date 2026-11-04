// In-memory deterministic simulator. NOT a production booking engine.
// Single-process model only: no cross-worker concurrency guarantees or persistence.
import {validateBookingRequest,quoteTotalCents} from './booking-contract.mjs';
import {transitionBooking} from './booking-state.mjs';
export class ReservationEngine {
 #slots=new Map();#bookings=new Map();#keys=new Map();#sequence=0;
 defineSlot({experienceId,serviceDate,capacity,priceFjdCents,operatorId}){
  if(!/^[a-zA-Z0-9_-]{8,100}$/.test(experienceId)||!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate))throw Error('Invalid slot');
  if(!Number.isSafeInteger(capacity)||capacity<1||!Number.isSafeInteger(priceFjdCents)||priceFjdCents<0||!operatorId)throw Error('Invalid slot values');
  const slotKey=experienceId+'|'+serviceDate;
  if(this.#slots.has(slotKey))throw Error('Slot already exists');
  this.#slots.set(slotKey,{experienceId,serviceDate,capacity,priceFjdCents,operatorId,reserved:0});
 }
 request(input){
  const req=validateBookingRequest(input);
  const fingerprint=JSON.stringify([req.experienceId,req.serviceDate,req.guests]);
  const prior=this.#keys.get(req.idempotencyKey);
  if(prior){if(prior.fingerprint!==fingerprint)throw Error('Idempotency conflict');return {...this.#bookings.get(prior.id)};}
  const slot=this.#slots.get(req.experienceId+'|'+req.serviceDate);
  if(!slot)throw Error('Experience/date not available');
  if(slot.capacity-slot.reserved<req.guests)throw Error('Insufficient availability');
  const total=quoteTotalCents(slot.priceFjdCents,req.guests);
  const id='demo_'+String(++this.#sequence).padStart(8,'0');
  const booking={id,experienceId:req.experienceId,operatorId:slot.operatorId,serviceDate:req.serviceDate,guests:req.guests,quotedTotalFjdCents:total,status:'pending',cancellationEligible:false};
  slot.reserved+=req.guests;this.#bookings.set(id,booking);this.#keys.set(req.idempotencyKey,{id,fingerprint});
  return {...booking};
 }
 transition({bookingId,next,actor,operatorId}){
  const booking=this.#bookings.get(bookingId);
  if(!booking)throw Error('Booking not found');
  if(actor==='operator'&&booking.operatorId!==operatorId)throw Error('Access denied');
  const updated=transitionBooking(booking,next,actor);
  const slot=this.#slots.get(booking.experienceId+'|'+booking.serviceDate);
  if(['declined','cancelled','expired'].includes(next)&&['pending','accepted'].includes(booking.status))slot.reserved-=booking.guests;
  this.#bookings.set(bookingId,updated);
  return {...updated};
 }
 availability(experienceId,serviceDate){
  const slot=this.#slots.get(experienceId+'|'+serviceDate);
  if(!slot)return null;
  return {capacity:slot.capacity,remaining:slot.capacity-slot.reserved};
 }
}
