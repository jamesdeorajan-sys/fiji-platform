// Provider-independent adapters: never represent stale, missing or unlicensed data as live.
export const FIJI_PLACES=Object.freeze([{name:'Nadi',latitude:-17.7765,longitude:177.4356},{name:'Denarau',latitude:-17.7708,longitude:177.3733},{name:'Suva',latitude:-18.1416,longitude:178.4415}]);
export const TRAVEL_CURRENCIES=Object.freeze(['AUD','NZD','USD','EUR','GBP']);
const finite=(x)=>typeof x==='number'&&Number.isFinite(x);
const timestamp=(x)=>typeof x==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(x)&&Number.isFinite(Date.parse(x));
export function weatherSnapshot(raw,{now=new Date().toISOString(),maxAgeMinutes=90,licensed=false}={}){
 if(!licensed)return {status:'unavailable',reason:'weather_provider_not_approved'};
 if(!raw||!timestamp(raw.observedAt)||!finite(raw.temperatureC)||!finite(raw.windKmh))return {status:'unavailable',reason:'invalid_weather_data'};
 const age=(Date.parse(now)-Date.parse(raw.observedAt))/60000;
 if(!Number.isFinite(age)||age< -5||age>maxAgeMinutes)return {status:'stale',observedAt:raw.observedAt};
 return {status:'current',temperatureC:raw.temperatureC,windKmh:raw.windKmh,observedAt:raw.observedAt,provider:raw.provider||'Weather data provider',warningAuthority:'Fiji Meteorological Service'};
}
export function fxSnapshot(raw,{now=new Date().toISOString(),maxAgeDays=5}={}){
 if(!raw||raw.base!=='FJD'||!TRAVEL_CURRENCIES.includes(raw.quote)||!finite(raw.rate)||raw.rate<=0||!/^\d{4}-\d{2}-\d{2}$/.test(raw.date||''))return {status:'unavailable',reason:'invalid_exchange_rate'};
 const observed=Date.parse(raw.date+'T00:00:00Z'),age=(Date.parse(now)-observed)/86400000;
 if(!Number.isFinite(age)||age< -1||age>maxAgeDays)return {status:'stale',date:raw.date};
 return {status:'indicative',base:'FJD',quote:raw.quote,rate:raw.rate,date:raw.date,provider:raw.provider||'Exchange-rate provider',disclaimer:'Indicative only; bank, card and cash rates may differ.'};
}
export function convertIndicativeFjd(fjd,fx){
 if(!finite(fjd)||fjd<0||fx?.status!=='indicative')throw Error('Valid FJD amount and fresh indicative rate required');
 return Math.round((fjd*fx.rate+Number.EPSILON)*100)/100;
}
