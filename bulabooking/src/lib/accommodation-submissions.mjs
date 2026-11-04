// Pure intake and approval contracts. No persistence, external AI or publication.
import {validateMonthlySpecial} from './monthly-specials.mjs';
import {validateAccommodationReferral} from './accommodation-referrals.mjs';
const ID=/^[A-Za-z0-9_-]{8,100}$/;
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max;
export function prepareAccommodationSubmission(input,session){
 if(!session||session.authenticated!==true||session.role!=='operator'||!ID.test(String(session.operatorId||''))||!ID.test(String(session.actorId||'')))throw Error('Authenticated operator required');
 if(!input||input.operatorId!==session.operatorId)throw Error('Operator ownership mismatch');
 if(!text(input.propertyName,160)||!text(input.roomType,120)||!text(input.location,160)||!text(input.cancellationTerms,2000))throw Error('Accommodation details required');
 if(input.publicationStatus&&input.publicationStatus!=='draft')throw Error('Submission cannot self-approve');
 const candidate={...input,publicationStatus:'draft'};
 const special=validateMonthlySpecial(candidate);
 const referral=validateAccommodationReferral(candidate);
 return {status:'pending_review',submittedBy:session.actorId,operatorId:session.operatorId,offer:{...special,bookingUrl:referral.bookingUrl,approvedBookingOrigin:referral.approvedBookingOrigin,propertyName:input.propertyName.trim(),roomType:input.roomType.trim(),location:input.location.trim(),cancellationTerms:input.cancellationTerms.trim(),publicationStatus:'draft'}};
}
export function approveAccommodationSubmission(submission,reviewer,{bookingOriginVerified=false,claimsVerified=false,termsVerified=false}={}){
 if(!reviewer||reviewer.authenticated!==true||reviewer.role!=='staff'||!ID.test(String(reviewer.actorId||'')))throw Error('Authenticated staff reviewer required');
 if(!submission||submission.status!=='pending_review'||!submission.offer||!bookingOriginVerified||!claimsVerified||!termsVerified)throw Error('Verification incomplete');
 const offer={...submission.offer,publicationStatus:'approved'};
 validateMonthlySpecial(offer);validateAccommodationReferral(offer);
 return {status:'approved',approvedBy:reviewer.actorId,offer};
}
export function draftAccommodationPromotionBrief(submission){
 if(!submission||!submission.offer)throw Error('Submission required');
 const o=submission.offer;
 return {task:'Draft promotional copy for human approval only',facts:{propertyName:o.propertyName,roomType:o.roomType,location:o.location,title:o.title,priceFjdCents:o.priceFjdCents,priceBasis:o.priceBasis,startsAt:o.startsAt,expiresAt:o.expiresAt,stayFrom:o.stayFrom,stayUntil:o.stayUntil,terms:o.terms},rules:['Never invent availability, discounts, rankings, reviews or scarcity','Never alter prices or expiry dates','Guest books on official accommodation website','Do not publish without operator approval']};
}
