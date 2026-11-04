// Pure routing policy only. No WhatsApp, AI provider, guest data or outbound messages.
export const SUPPORT_CHANNELS=Object.freeze(['ai_assist','human_whatsapp','staff_queue']);
const HIGH_RISK=new Set(['safety','emergency','complaint','refund','payment_dispute','missing_driver','booking_change','unconfirmed_booking','accessibility']);
export function routeSupport({topic,aiConfidence,humanAvailable,consentToAi=false}){
 if(typeof topic!=='string'||!topic.trim())throw Error('Support topic required');
 if(typeof humanAvailable!=='boolean')throw Error('Human availability must be explicitly known');
 if(HIGH_RISK.has(topic)||!consentToAi||typeof aiConfidence!=='number'||aiConfidence<0.85){
  return {channel:humanAvailable?'human_whatsapp':'staff_queue',automatedConfirmation:false,reason:HIGH_RISK.has(topic)?'human_review_required':'human_or_low_confidence'};
 }
 return {channel:'ai_assist',automatedConfirmation:false,reason:'routine_question'};
}
export function supportDisclosure({humanAvailable,whatsappConfigured}){
 if(humanAvailable===true&&whatsappConfigured===true)return 'Human WhatsApp support is available now. AI can assist with routine questions.';
 return 'Human support availability is not confirmed. Your request may be queued; do not rely on this channel for emergencies.';
}
