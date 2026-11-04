export const CATEGORIES = ['Island cruises','Snorkelling','Culture & villages','Adventure','Fishing','Nature','Other'];
export function parseFjdToCents(value) {
 const raw=String(value).trim();
 if(!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(raw)) throw new Error('Enter a valid FJD amount with up to 2 decimal places');
 const [whole,decimal='']=raw.split('.');
 return Number(whole)*100+Number(decimal.padEnd(2,'0'));
}
export function draftListing(input) {
 const operator=String(input.operator||'').trim();
 const title=String(input.title||'').trim();
 const location=String(input.location||'').trim();
 const description=String(input.description||'').trim();
 const category=String(input.category||'');
 const priceCents=parseFjdToCents(input.price);
 if(operator.length<2||operator.length>120)throw new Error('Enter your operator name');
 if(title.length<5||title.length>120)throw new Error('Enter an experience title (5–120 characters)');
 if(location.length<2||location.length>120)throw new Error('Enter a Fiji location');
 if(description.length<30||description.length>2500)throw new Error('Describe your experience in at least 30 characters');
 if(!CATEGORIES.includes(category))throw new Error('Select a category');
 if(priceCents<=0)throw new Error('Enter a positive price');
 const slug=title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70);
 return {operator,title,location,description,category,priceFjdCents:priceCents,slug,publicationStatus:'draft',bookingStatus:'unavailable',notice:'Draft only. Operator verification, capacity, inclusions and terms must be approved before publishing.'};
}
export function formatFjd(cents){return 'FJ$'+(cents/100).toFixed(2)}
