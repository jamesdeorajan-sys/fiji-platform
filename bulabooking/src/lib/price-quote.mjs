// Deterministic FJD-only pricing contract. Caller must fetch authoritative operator-approved rates.
const BASES=new Set(['person','group','vehicle']);
export function calculateExperienceQuote({priceFjdCents,priceBasis,guests,units=1,maxGroupSize=null,feesFjdCents=0}){
 if(!Number.isSafeInteger(priceFjdCents)||priceFjdCents<=0||!BASES.has(priceBasis))throw Error('Invalid FJD price or price basis');
 if(!Number.isSafeInteger(guests)||guests<1||guests>50)throw Error('Invalid guest count');
 if(!Number.isSafeInteger(units)||units<1||units>50)throw Error('Invalid unit count');
 if(!Number.isSafeInteger(feesFjdCents)||feesFjdCents<0)throw Error('Invalid fee');
 if(priceBasis==='person'&&units!==1)throw Error('Person pricing cannot include multiple units');
 if(priceBasis!=='person'&&(!Number.isSafeInteger(maxGroupSize)||maxGroupSize<1||maxGroupSize>50||guests>maxGroupSize*units))throw Error('Guests exceed booked unit capacity');
 const quantity=priceBasis==='person'?guests:units;
 const subtotal=priceFjdCents*quantity;
 const total=subtotal+feesFjdCents;
 if(!Number.isSafeInteger(total)||total<=0)throw Error('Quote overflow');
 return Object.freeze({currency:'FJD',priceBasis,guests,units:quantity,unitPriceFjdCents:priceFjdCents,subtotalFjdCents:subtotal,feesFjdCents,totalFjdCents:total,requiresOperatorAcceptance:true});
}
