// Pure verified-review domain rules. Does not authenticate users, store reviews or publish content.
const ID=/^[A-Za-z0-9_-]{8,100}$/;
const normalizeText=(value,max)=>{if(typeof value!=='string')throw Error('Review text required');const text=value.trim();if(text.length<20||text.length>max)throw Error('Review length must be 20–'+max+' characters');return text;};
export function prepareVerifiedReview({booking,review,actorGuestId}){
 if(!booking||!ID.test(String(booking.id||''))||!ID.test(String(booking.listingId||''))||!ID.test(String(booking.operatorId||'')))throw Error('Invalid booking');
 if(booking.status!=='completed')throw Error('Only completed experiences are eligible');
 if(typeof actorGuestId!=='string'||!actorGuestId||actorGuestId!==booking.guestId)throw Error('Review ownership not verified');
 if(booking.isTest===true)throw Error('Test bookings are not eligible');
 if(!review||!Number.isInteger(review.rating)||review.rating<1||review.rating>5)throw Error('Rating must be 1–5');
 const title=typeof review.title==='string'?review.title.trim():'';
 if(title.length>120)throw Error('Title too long');
 const body=normalizeText(review.body,3000);
 return {bookingId:booking.id,listingId:booking.listingId,operatorId:booking.operatorId,guestId:actorGuestId,rating:review.rating,title,body,verifiedBooking:true,moderationStatus:'pending',publicationStatus:'unpublished'};
}
export function reviewModerationTransition(review,next,actor,reason){
 if(!review||review.moderationStatus!=='pending'||!['approved','rejected'].includes(next)||actor!=='moderator')throw Error('Invalid moderation transition');
 if(next==='rejected'&&(!reason||String(reason).trim().length<8))throw Error('Document a policy reason');
 return {...review,moderationStatus:next,publicationStatus:next==='approved'?'published':'unpublished',moderationReason:next==='rejected'?String(reason).trim():null};
}
export function summarizePublishedReviews(reviews,listingId){
 const eligible=reviews.filter(r=>r.listingId===listingId&&r.moderationStatus==='approved'&&r.publicationStatus==='published'&&r.verifiedBooking===true&&Number.isInteger(r.rating)&&r.rating>=1&&r.rating<=5);
 const unique=new Map();
 for(const review of eligible){if(!unique.has(review.bookingId))unique.set(review.bookingId,review);}
 const ratings=[...unique.values()].map(r=>r.rating);
 const total=ratings.reduce((a,b)=>a+b,0);
 return {count:ratings.length,averageRating:ratings.length?Math.round(total/ratings.length*10)/10:null,distribution:Object.fromEntries([1,2,3,4,5].map(star=>[star,ratings.filter(r=>r===star).length]))};
}
