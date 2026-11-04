// Isolated D1 ledger adapter. Caller must authenticate guest and validate slot ownership,
// price, terms and consent before invoking. Never expose raw errors to guests.
const ID=/^[A-Za-z0-9_-]{8,100}$/;
function validId(value){return typeof value==='string'&&ID.test(value);}
export function validateLedgerRequest(input){
 if(!input||!['id','idempotencyKey','fingerprint','slotId','operatorId','listingId','eventId','outboxId'].every(k=>validId(input[k])))throw Error('Invalid booking identifiers');
 if(!Number.isSafeInteger(input.quantity)||input.quantity<1||input.quantity>50)throw Error('Invalid quantity');
 if(!Number.isSafeInteger(input.totalFjdCents)||input.totalFjdCents<=0)throw Error('Invalid FJD amount');
 if(typeof input.createdAt!=='string'||!Number.isFinite(Date.parse(input.createdAt)))throw Error('Invalid timestamp');
 return {...input,currency:'FJD',createdAt:new Date(input.createdAt).toISOString()};
}
export async function saveBookingRequest(db,raw){
 if(!db||typeof db.prepare!=='function'||typeof db.batch!=='function')throw Error('D1 binding required');
 const input=validateLedgerRequest(raw);
 const existing=await db.prepare('SELECT id, request_fingerprint, status FROM bb_bookings WHERE idempotency_key = ?').bind(input.idempotencyKey).first();
 if(existing){
  if(existing.request_fingerprint!==input.fingerprint)throw Error('Idempotency conflict');
  return {bookingId:existing.id,status:existing.status,replayed:true};
 }
 // All statements must succeed together. SQL capacity trigger rejects overbooking.
 // Quote is compared against authoritative slot price inside the INSERT SELECT.
 const insert=db.prepare(`INSERT INTO bb_bookings
 (id,idempotency_key,request_fingerprint,slot_id,operator_id,listing_id,quantity,currency,total_fjd_cents,status,created_at,updated_at)
 SELECT ?,?,?,?,?,?,?,'FJD',?,'pending',?,? FROM bb_slots
 WHERE id=? AND operator_id=? AND listing_id=? AND price_fjd_cents * ? = ?`)
 .bind(input.id,input.idempotencyKey,input.fingerprint,input.slotId,input.operatorId,input.listingId,input.quantity,input.totalFjdCents,input.createdAt,input.createdAt,input.slotId,input.operatorId,input.listingId,input.quantity,input.totalFjdCents);
 // The event FK causes the batch to roll back if INSERT SELECT inserted no booking.
 const event=db.prepare('INSERT INTO bb_booking_events(id,booking_id,event_type,actor_type,occurred_at) VALUES (?, ?, ?, ?, ?)')
 .bind(input.eventId,input.id,'booking_request_saved','guest',input.createdAt);
 const outbox=db.prepare('INSERT INTO bb_outbox(id,booking_id,event_type,created_at) VALUES (?,?,?,?)')
 .bind(input.outboxId,input.id,'booking_request_saved',input.createdAt);
 try {
  const result=await db.batch([insert,event,outbox]);
  if(result[0]?.meta?.changes!==1)throw Error('Booking not inserted');
  return {bookingId:input.id,status:'pending',replayed:false};
 }catch(error){
  // Resolve concurrent same-key requests only after the transaction has settled.
  const found=await db.prepare('SELECT id,request_fingerprint,status FROM bb_bookings WHERE idempotency_key=?').bind(input.idempotencyKey).first();
  if(found){
   if(found.request_fingerprint!==input.fingerprint)throw Error('Idempotency conflict');
   return {bookingId:found.id,status:found.status,replayed:true};
  }
  throw error;
 }
}
