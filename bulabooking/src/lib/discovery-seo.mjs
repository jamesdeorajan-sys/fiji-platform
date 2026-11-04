// Evidence-first SEO and AI discovery metadata. No ranking guarantees.
const clean=(value,max=180)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
export function buildDiscoveryMetadata({title,description,canonicalUrl,siteName='BulaBooking',robots='index,follow',imageUrl}){
 const url=new URL(canonicalUrl);
 if(url.protocol!=='https:'||url.username||url.password)throw Error('Canonical must be public HTTPS');
 if(!['index,follow','noindex,nofollow','noindex,follow'].includes(robots))throw Error('Invalid robots policy');
 const out={title:clean(title,90),description:clean(description,300),canonical:url.toString(),robots,siteName:clean(siteName,80)};
 if(!out.title||!out.description)throw Error('Missing metadata');
 if(imageUrl){const image=new URL(imageUrl);if(image.protocol!=='https:')throw Error('Image must be HTTPS');out.image=image.toString();}
 return out;
}
export function buildExperienceJsonLd({name,description,url,operatorName,priceFjdCents,availabilityUrl}){
 if(!name||!description||!operatorName)throw Error('Verified operator facts required');
 const page=new URL(url);if(page.protocol!=='https:')throw Error('HTTPS page required');
 const graph={'@context':'https://schema.org','@type':'TouristTrip',name:clean(name,180),description:clean(description,500),url:page.toString(),provider:{'@type':'Organization',name:clean(operatorName,120)}};
 // TouristTrip does not imply review stars, ranking or an eligible Google rich result.
 if(Number.isSafeInteger(priceFjdCents)&&priceFjdCents>0&&availabilityUrl){
  const booking=new URL(availabilityUrl);if(booking.protocol!=='https:')throw Error('HTTPS booking link required');
  graph.offers={'@type':'Offer',priceCurrency:'FJD',price:(priceFjdCents/100).toFixed(2),url:booking.toString()};
 }
 return graph;
}
export function discoveryAudit(page){
 const checks=[['server_html',page.serverRendered===true],['canonical',page.canonicalHttps===true],['index_policy',page.publicApproved===true&&page.indexAllowed===true],['unique_content',page.originalOperatorFacts===true],['price_accuracy',page.fjdPriceVerified===true],['business_claims',page.businessClaimsVerified===true],['privacy',page.noPrivateBookingData===true],['mobile',page.mobileAccessible===true],['structured_data',page.structuredDataValidated===true],['sitemap',page.inSitemap===true]];
 return {checks:checks.map(([id,pass])=>({id,pass})),ready:checks.every(([,pass])=>pass),note:'Technical readiness is not a ranking, AI mention, or recommendation guarantee'};
}
