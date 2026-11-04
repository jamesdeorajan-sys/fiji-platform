import {operatorTrustProfile,normalizeOperatorSocialLink} from './operator-trust.mjs';
import {summarizePublishedReviews} from './reviews.mjs';
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function buildPublicOperatorProfile(operator,evidence={},reviews=[]){
 if(!operator||!SLUG.test(String(operator.slug||'')))throw Error('Invalid operator slug');
 const trust=operatorTrustProfile(operator,evidence);
 if(trust.verificationStatus==='suspended')return null;
 const links=(Array.isArray(operator.socialLinks)?operator.socialLinks:[]).slice(0,12).map(normalizeOperatorSocialLink);
 const listings=(Array.isArray(operator.listings)?operator.listings:[]).filter(l=>l&&l.publicationStatus==='published'&&l.bookingStatus==='available'&&Number.isSafeInteger(l.priceFjdCents)&&l.priceFjdCents>0&&typeof l.title==='string').map(l=>({id:String(l.id||''),title:l.title.slice(0,120),priceFjdCents:l.priceFjdCents,currency:'FJD',priceBasis:l.priceBasis==='group'?'group':l.priceBasis==='vehicle'?'vehicle':'person',bookingEnabled:trust.canAcceptBooking})); 
 const eligible=reviews.filter(r=>r.operatorId===operator.id&&listings.some(l=>l.id===r.listingId));
 const seen=new Set();const published=eligible.filter(r=>{if(r.moderationStatus!=='approved'||r.publicationStatus!=='published'||r.verifiedBooking!==true||seen.has(r.bookingId))return false;seen.add(r.bookingId);return Number.isInteger(r.rating)&&r.rating>=1&&r.rating<=5;});
 const count=published.length;
 return {slug:operator.slug,name:trust.name,area:String(operator.area||'Fiji').slice(0,120),description:String(operator.description||'').slice(0,1500),trust,links,listings,reviewCount:count,averageRating:count?Math.round(published.reduce((n,r)=>n+r.rating,0)/count*10)/10:null,reviewNotice:count?'Ratings from completed bookings on BulaBooking.':'No verified guest reviews yet.'};
}
export function listPublicOperators(operators,evidenceById={},reviews=[]){
 return operators.map(o=>buildPublicOperatorProfile(o,evidenceById[o.id]||{},reviews)).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name));
}
