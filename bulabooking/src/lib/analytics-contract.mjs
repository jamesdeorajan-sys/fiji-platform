// Analytics validation/aggregation only. No telemetry collection or external API calls.
// Do not include guest names, emails, phone numbers, message contents or IP addresses.
export const EVENT_NAMES=Object.freeze(['listing_impression','listing_view','availability_check','booking_started','booking_request_saved','booking_accepted','booking_declined','booking_cancelled','booking_expired','booking_completed','transfer_handoff','support_requested']);
const SOURCES=Object.freeze(['organic_google','organic_bing','ai_referral','paid','social','direct','partner','other','unknown']);
const idPattern=/^[A-Za-z0-9_-]{8,100}$/;
export function validateAnalyticsEvent(event){
 if(!event||typeof event!=='object'||Array.isArray(event))throw Error('Invalid event');
 const {eventId,eventName,providerId,listingId,occurredAt,source,bookingId=null}=event;
 if(!idPattern.test(String(eventId||'')))throw Error('Invalid event ID');
 if(!EVENT_NAMES.includes(eventName))throw Error('Invalid event name');
 if(!idPattern.test(String(providerId||''))||!idPattern.test(String(listingId||'')))throw Error('Missing provider/listing attribution');
 if(!SOURCES.includes(source))throw Error('Invalid acquisition source');
 if(typeof occurredAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(occurredAt)||!Number.isFinite(Date.parse(occurredAt)))throw Error('Invalid timestamp');
 if(bookingId!==null&&!idPattern.test(String(bookingId)))throw Error('Invalid booking reference');
 if(eventName.startsWith('booking_')&&['booking_request_saved','booking_accepted','booking_declined','booking_cancelled','booking_expired','booking_completed'].includes(eventName)&&bookingId===null)throw Error('Booking attribution required');
 return {eventId,eventName,providerId,listingId,bookingId,occurredAt:new Date(occurredAt).toISOString(),source};
}
export function summarizeListingEvents(events,providerId,listingId){
 const unique=new Map();
 for(const raw of events){const event=validateAnalyticsEvent(raw);if(!unique.has(event.eventId))unique.set(event.eventId,event);}
 const matched=[...unique.values()].filter(e=>e.providerId===providerId&&e.listingId===listingId);
 const counts=Object.fromEntries(EVENT_NAMES.map(name=>[name,0]));
 for(const e of matched)counts[e.eventName]++;
 const views=counts.listing_view,requests=counts.booking_request_saved,accepted=counts.booking_accepted;
 return {providerId,listingId,counts,viewToRequestRate:views?requests/views:null,requestToAcceptanceRate:requests?accepted/requests:null,measurementNote:'Event counts, not unique users or confirmed revenue. Funnel rates are indicative; reconcile booking records and event delivery.'};
}
