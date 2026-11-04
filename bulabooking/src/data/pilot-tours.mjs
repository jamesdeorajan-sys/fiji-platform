// Real public source URLs, curated for isolated preview only. Pricing on source is AUD, not approved FJD.
export const pilotTours=[
{slug:'natadola-beach-horse-riding-50-minute',title:'Natadola Beach Horse Riding — 50-minute experience',area:'Natadola Beach',duration:'50 minutes',summary:'Guided scenic beach horse riding. Hotel transfer options may be arranged separately; confirm availability and inclusions on the provider website.',sourceUrl:'https://fijitourtransfers.com/tours/natadola-beach-horse-riding-au76/',sourceCurrency:'AUD',sourcePrice:76},
{slug:'natadola-beach-horse-riding-90-minute',title:'Natadola Beach Horse Riding — 90-minute experience',area:'Natadola Beach',duration:'90 minutes',summary:'Extended guided ride along Natadola Beach. Confirm current pricing and conditions with the provider.',sourceUrl:'https://fijitourtransfers.com/tours/natadola-beach-horse-riding-tour-au139-90-minute-ride/',sourceCurrency:'AUD',sourcePrice:139},
{slug:'natadola-beach-cave-ride',title:'Natadola Beach Cave Tour Ride',area:'Natadola Beach',duration:'1 hour',summary:'A Natadola coastal cave and riding experience. Check the provider for the exact route and inclusions.',sourceUrl:'https://fijitourtransfers.com/tours/natadola-beach-cave-tour-ride/',sourceCurrency:'AUD',sourcePrice:90},
{slug:'natadola-beach-ride-and-massage',title:'Natadola Bay Horse Riding & Beach Massage',area:'Natadola Beach',duration:'1 hour',summary:'Combination beach ride and massage experience. Confirm package terms directly with the provider.',sourceUrl:'https://fijitourtransfers.com/tours/natadola-bay-horse-riding-beach-massage-in-fiji/',sourceCurrency:'AUD',sourcePrice:139}
];
export const pilotProvider={name:'Fiji Tour Transfers',website:'https://fijitourtransfers.com/',verification:'pilot_source_review_pending',bookingMode:'external_provider_site'};
export const transferPartner={name:'Nadi Airport Transfers',website:'https://nadiairporttransfers.com/',affiliation:'Affiliated transfer service',bookingMode:'external_transfer_site'};

export const pilotFx={from:'AUD',to:'FJD',rate:1.5711719,asOf:'2026-11-04T17:00:00Z',source:'https://exchangerates.me/aud/fjd',kind:'indicative_mid_market'};
export function previewFjdPrice(tour){if(tour.sourceCurrency!=='AUD')throw Error('Expected AUD');return Math.round(tour.sourcePrice*pilotFx.rate*100)/100;}

export function pilotTransferReferralUrl(){const u=new URL(transferPartner.website);u.searchParams.set('utm_source','bulabooking');u.searchParams.set('utm_medium','referral');u.searchParams.set('utm_campaign','fiji_tour_transfers_pilot');return u.toString();}

export function pilotFxFresh(now=new Date(),maxAgeDays=3){const age=now.getTime()-Date.parse(pilotFx.asOf);return Number.isFinite(age)&&age>=0&&age<=maxAgeDays*86400000;}

export function tourTransferReferralUrl(slug){if(!pilotTours.some(t=>t.slug===slug))throw Error('Unknown pilot tour');const u=new URL(pilotTransferReferralUrl());u.searchParams.set('utm_content',slug);return u.toString();}
