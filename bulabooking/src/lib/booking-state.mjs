// Pure booking lifecycle contract; NO live database writes or notifications.
export const BOOKING_STATES=Object.freeze(['pending','accepted','declined','cancelled','completed','expired']);
const allowed=Object.freeze({
 pending:{operator:['accepted','declined'],guest:['cancelled'],system:['expired'],staff:['cancelled','expired']},
 accepted:{operator:['completed'],guest:['cancelled'],staff:['cancelled','completed']},
 declined:{},cancelled:{},completed:{},expired:{}
});
export function transitionBooking(booking,next,actor){
 if(!booking||!BOOKING_STATES.includes(booking.status))throw new Error('Unknown booking state');
 if(!BOOKING_STATES.includes(next))throw new Error('Unknown target state');
 if(!allowed[booking.status]?.[actor]?.includes(next))throw new Error('Transition not permitted');
 if(booking.status==='accepted'&&next==='cancelled'&&!booking.cancellationEligible)throw new Error('Cancellation requires policy review');
 return {...booking,status:next,updatedAt:new Date().toISOString()};
}
export function bookingMessage(status){
 const messages={pending:'Request received — awaiting operator acceptance. Not yet confirmed.',accepted:'Operator accepted — your experience is confirmed.',declined:'Operator declined — please choose another experience.',cancelled:'Booking cancelled.',completed:'Experience completed.',expired:'Request expired — please submit a new request.'};
 if(!messages[status])throw new Error('Unknown booking status');
 return messages[status];
}
