import {routeSupport} from './support-routing.mjs';

// Provider-agnostic, pure inbound support classifier. Never sends messages.
const TYPES = new Set(['tour_faq','transfer_faq','pricing','availability','booking_status','booking_change','unconfirmed_booking','missing_driver','safety','emergency','refund','payment_dispute','complaint','accessibility','other']);
const HIGH_PRIORITY = new Set(['missing_driver','safety','emergency','booking_change','unconfirmed_booking','payment_dispute']);
export function normalizeInboundSupport(payload) {
 if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('Invalid inbound payload');
 const messageId=String(payload.messageId??'');
 const conversationId=String(payload.conversationId??'');
 const topic=String(payload.topic??'');
 const text=String(payload.text??'').trim();
 if(!/^[A-Za-z0-9_.:-]{8,128}$/.test(messageId))throw Error('Invalid message ID');
 if(!/^[A-Za-z0-9_.:-]{8,128}$/.test(conversationId))throw Error('Invalid conversation ID');
 if(!TYPES.has(topic))throw Error('Unsupported support topic');
 if(!text || text.length>4000)throw Error('Invalid message length');
 return {messageId,conversationId,topic,text,consentToAi:payload.consentToAi===true};
}
export function planSupportHandling(payload,environment) {
 const input=normalizeInboundSupport(payload);
 if(!environment || typeof environment.humanAvailable!=='boolean')throw Error('Verified staffing availability required');
 const routing=routeSupport({topic:input.topic,aiConfidence:environment.aiConfidence,humanAvailable:environment.humanAvailable,consentToAi:input.consentToAi});
 // Booking status is read-only: AI cannot assert a confirmation.
 if(input.topic==='booking_status' && routing.channel==='ai_assist') {
  return {messageId:input.messageId,conversationId:input.conversationId,channel:'staff_queue',priority:'normal',automatedConfirmation:false,reason:'requires_authoritative_booking_lookup'};
 }
 return {messageId:input.messageId,conversationId:input.conversationId,channel:routing.channel,priority:HIGH_PRIORITY.has(input.topic)?'urgent':'normal',automatedConfirmation:false,reason:routing.reason};
}
// Caller MUST use durable unique(messageId) constraint before executing this plan.
// Message contents are intentionally not included in the dispatch plan.
