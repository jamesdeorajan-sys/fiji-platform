// Deterministic validation only; not an endpoint or reservation implementation.
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
export function validateBookingRequest(request) {
 if(!request||typeof request!=='object')throw new Error('Invalid request');
 const experienceId=String(request.experienceId||'');
 const key=String(request.idempotencyKey||'');
 const date=String(request.serviceDate||'');
 const guests=Number(request.guests);
 if(!/^[a-zA-Z0-9_-]{8,100}$/.test(experienceId))throw new Error('Invalid experience');
 if(!/^[a-zA-Z0-9_-]{16,128}$/.test(key))throw new Error('Invalid idempotency key');
 if(!datePattern.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('Invalid service date');
 if(!Number.isSafeInteger(guests)||guests<1||guests>50)throw new Error('Invalid party size');
 return {experienceId,idempotencyKey:key,serviceDate:date,guests};
}
export function quoteTotalCents(unitPriceCents,guests) {
 if(!Number.isSafeInteger(unitPriceCents)||unitPriceCents<0||!Number.isSafeInteger(guests)||guests<1||guests>50)throw new Error('Invalid quote inputs');
 const total=unitPriceCents*guests;
 if(!Number.isSafeInteger(total))throw new Error('Quote overflow');
 return total;
}
export function publicBookingStatus(status) {
 const statuses={pending:{confirmed:false,label:'Awaiting operator acceptance'},accepted:{confirmed:true,label:'Confirmed by operator'},declined:{confirmed:false,label:'Declined'},cancelled:{confirmed:false,label:'Cancelled'},completed:{confirmed:true,label:'Completed'},expired:{confirmed:false,label:'Expired'}};
 if(!Object.hasOwn(statuses,status))throw new Error('Unknown status');
 return statuses[status];
}
