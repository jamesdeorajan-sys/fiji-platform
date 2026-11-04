// Staging adapter: database changes only. Authentication and tenant membership
// must be established by trusted middleware, never a guest-supplied operator ID.
const ID=/^[A-Za-z0-9_-]{8,100}$/;
const ACTIONS={accept:'accepted',decline:'declined',complete:'completed'};
export function validateOperatorAction(input,session){
 if(!session||session.authenticated!==true||session.role!=='operator'||typeof session.operatorId!=='string'||!ID.test(session.operatorId))throw Error('Operator authentication required');
 if(!input||typeof input.bookingId!=='string'||!ID.test(input.bookingId)||!Object.hasOwn(ACTIONS,input.action))throw Error('Invalid booking action');
 const expected=input.action==='complete'?'accepted':'pending';
 return {bookingId:input.bookingId,operatorId:session.operatorId,next:ACTIONS[input.action],expected};
}
export async function applyOperatorAction(db,input,session,now=new Date().toISOString()){
 if(!db||typeof db.prepare!=='function')throw Error('Database binding required');
 const a=validateOperatorAction(input,session);
 if(!Number.isFinite(Date.parse(now)))throw Error('Invalid timestamp');
 const result=await db.prepare('UPDATE bb_bookings SET status=?,updated_at=? WHERE id=? AND operator_id=? AND status=?')
  .bind(a.next,new Date(now).toISOString(),a.bookingId,a.operatorId,a.expected).run();
 if(result?.meta?.changes!==1)throw Error('Booking unavailable, not owned by operator, or already transitioned');
 // The migration's AFTER UPDATE trigger atomically records the audit event and outbox entry.
 return {bookingId:a.bookingId,status:a.next,recorded:true};
}
export async function listOperatorBookings(db,session,{limit=25,offset=0}={}){
 if(!session||session.authenticated!==true||session.role!=='operator'||!ID.test(String(session.operatorId||'')))throw Error('Operator authentication required');
 if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0)throw Error('Invalid pagination');
 const result=await db.prepare('SELECT id,listing_id,slot_id,quantity,currency,total_fjd_cents,status,created_at,updated_at FROM bb_bookings WHERE operator_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?')
 .bind(session.operatorId,limit,offset).all();
 return result.results||[];
}
