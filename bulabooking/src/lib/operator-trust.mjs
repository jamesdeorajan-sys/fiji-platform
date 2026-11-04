// Public trust disclosures are derived only from independently recorded evidence.
// No operator-supplied verification status or review totals may override these rules.
export const VERIFICATION_STATUSES=Object.freeze(['unverified','pending','verified','suspended']);
export function operatorTrustProfile(operator,evidence={}){
 if(!operator||typeof operator.name!=='string'||!operator.name.trim())throw Error('Operator name required');
 const status=VERIFICATION_STATUSES.includes(evidence.verificationStatus)?evidence.verificationStatus:'unverified';
 const labels={unverified:'Not yet verified',pending:'Verification in progress',verified:'Verified operator',suspended:'Listing suspended'};
 const verified=status==='verified';
 const completedBookings=Number.isSafeInteger(evidence.completedBookings)&&evidence.completedBookings>=0?evidence.completedBookings:0;
 const publishedReviews=Number.isSafeInteger(evidence.publishedVerifiedReviews)&&evidence.publishedVerifiedReviews>=0?evidence.publishedVerifiedReviews:0;
 return {name:operator.name.trim().slice(0,120),verificationStatus:status,verificationLabel:labels[status],canAcceptBooking:status!=='suspended'&&evidence.bookingEligible===true,completedBookings,publishedVerifiedReviews:publishedReviews,disclosures:verified?'Identity and operating details checked by BulaBooking. This does not guarantee service quality.':'Operator identity and operating details have not yet been fully verified by BulaBooking.'};
}
const HOSTS={
 facebook:['facebook.com','www.facebook.com','m.facebook.com'],
 instagram:['instagram.com','www.instagram.com'],
 tiktok:['tiktok.com','www.tiktok.com'],
 youtube:['youtube.com','www.youtube.com','youtu.be'],
 tripadvisor:['tripadvisor.com','www.tripadvisor.com'],
 website:null
};
export function normalizeOperatorSocialLink({platform,url}){
 if(!Object.hasOwn(HOSTS,platform))throw Error('Unsupported social platform');
 if(typeof url!=='string'||url.length>2048)throw Error('Invalid URL');
 let parsed;try{parsed=new URL(url);}catch{throw Error('Invalid URL');}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port)throw Error('Only secure public URLs allowed');
 const host=parsed.hostname.toLowerCase();
 if(HOSTS[platform]&&!HOSTS[platform].includes(host))throw Error('Platform domain mismatch');
 if(platform==='website'&&(!host.includes('.')||host==='localhost'||host.endsWith('.local')||host.endsWith('.internal')||/^\d+\.\d+\.\d+\.\d+$/.test(host)))throw Error('Unsupported website host');
 parsed.hash='';
 return {platform,url:parsed.toString(),verification:'operator_supplied',notice:'External link supplied by the operator. BulaBooking has not independently verified the social account or its followers/reviews.'};
}
