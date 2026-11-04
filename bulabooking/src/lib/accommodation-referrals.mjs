// Accommodation offers are promotional referrals only: never take bookings or payments.
const HTTPS=(v)=>{const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('HTTPS partner URL required');if(['localhost','127.0.0.1','0.0.0.0'].includes(u.hostname)||u.hostname.endsWith('.local'))throw Error('Private host not allowed');return u;};
export function validateAccommodationReferral(offer){
 if(!offer||typeof offer!=='object')throw Error('Offer required');
 if(!/^[A-Za-z0-9_-]{8,100}$/.test(String(offer.operatorId||'')))throw Error('Operator ID required');
 const target=HTTPS(offer.bookingUrl);
 const approved=HTTPS(offer.approvedBookingOrigin);
 if(target.origin!==approved.origin)throw Error('Booking URL must match verified partner origin');
 if(!['approved','draft','paused','withdrawn'].includes(offer.publicationStatus))throw Error('Invalid publication status');
 if(!Number.isSafeInteger(offer.priceFjdCents)||offer.priceFjdCents<=0)throw Error('FJD promotional price required');
 if(!['night','stay','person'].includes(offer.priceBasis))throw Error('Price basis required');
 const start=Date.parse(offer.startsAt),end=Date.parse(offer.expiresAt);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw Error('Invalid offer window');
 return {...offer,bookingUrl:target.toString(),approvedBookingOrigin:approved.origin,currency:'FJD'};
}
export function accommodationReferralState(offer,now=new Date().toISOString()){
 const o=validateAccommodationReferral(offer),t=Date.parse(now);
 if(!Number.isFinite(t))throw Error('Invalid current time');
 if(o.publicationStatus==='withdrawn')return {state:'withdrawn',promotable:false};
 if(o.publicationStatus==='paused')return {state:'paused',promotable:false};
 if(o.publicationStatus==='draft')return {state:'draft',promotable:false};
 if(t<Date.parse(o.startsAt))return {state:'scheduled',promotable:false};
 if(t>=Date.parse(o.expiresAt))return {state:'expired',promotable:false};
 return {state:'active',promotable:true};
}
export function buildPartnerBookingLink(offer,now){
 const o=validateAccommodationReferral(offer),state=accommodationReferralState(o,now);
 if(!state.promotable)throw Error('Offer is not active');
 // Return the exact approved booking destination; never proxy guest reservation details.
 return {href:o.bookingUrl,label:'Book direct with accommodation',external:true,rel:'noopener noreferrer sponsored',reservationHandledBy:'partner',availabilityVerifiedByBulaBooking:false};
}
