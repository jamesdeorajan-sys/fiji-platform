// Accommodation promotion lifecycle; no AI inference or automatic price changes.
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const parse=(v)=>{if(typeof v!=='string'||!ISO.test(v)||!Number.isFinite(Date.parse(v)))throw Error('Valid offset-aware ISO timestamp required');return Date.parse(v);};
function validDate(v){return typeof v==='string'&&DATE.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;}
export function validateMonthlySpecial(offer){
 if(!offer||typeof offer!=='object')throw Error('Offer required');
 if(!/^[a-zA-Z0-9_-]{8,100}$/.test(String(offer.operatorId||'')))throw Error('Operator ID required');
 if(typeof offer.title!=='string'||offer.title.trim().length<8||offer.title.length>160)throw Error('Valid title required');
 if(!Number.isSafeInteger(offer.priceFjdCents)||offer.priceFjdCents<=0)throw Error('Positive FJD price required');
 if(!['night','stay','person'].includes(offer.priceBasis))throw Error('Price basis required');
 const start=parse(offer.startsAt),end=parse(offer.expiresAt);
 if(end<=start)throw Error('Expiry must follow start');
 if(!validDate(offer.stayFrom)||!validDate(offer.stayUntil)||offer.stayUntil<offer.stayFrom)throw Error('Stay window required');
 if(!['draft','approved','paused','withdrawn'].includes(offer.publicationStatus))throw Error('Publication status required');
 if(typeof offer.terms!=='string'||offer.terms.trim().length<20)throw Error('Clear terms required');
 if(!Number.isSafeInteger(offer.maxOccupancy)||offer.maxOccupancy<1||offer.maxOccupancy>100)throw Error('Occupancy required');
 if(offer.timeZone!=='Pacific/Fiji')throw Error('Use Fiji timezone');
 return {...offer,currency:'FJD'};
}
export function monthlySpecialState(offer,now=new Date().toISOString()){
 const o=validateMonthlySpecial(offer),at=parse(now),start=parse(o.startsAt),end=parse(o.expiresAt);
 if(o.publicationStatus==='withdrawn')return {state:'withdrawn',bookable:false,indexable:false};
 if(o.publicationStatus==='paused')return {state:'paused',bookable:false,indexable:false};
 if(o.publicationStatus==='draft')return {state:'draft',bookable:false,indexable:false};
 if(at<start)return {state:'scheduled',bookable:false,indexable:false};
 if(at>=end)return {state:'expired',bookable:false,indexable:false};
 return {state:'active',bookable:true,indexable:true};
}
export function publicSpecial(offer,now){
 const o=validateMonthlySpecial(offer),status=monthlySpecialState(o,now);
 return {title:o.title,operatorId:o.operatorId,priceFjdCents:o.priceFjdCents,priceBasis:o.priceBasis,currency:'FJD',stayFrom:o.stayFrom,stayUntil:o.stayUntil,expiresAt:o.expiresAt,terms:o.terms,maxOccupancy:o.maxOccupancy,...status};
}
