// HMAC-SHA256 verification for providers whose webhook contract uses a shared secret.
// Actual provider headers, canonical bytes, replay window and rotation must be configured per provider.
const encoder=new TextEncoder();
function toHex(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
export async function signHmacSha256(secret,rawBody){
 if(typeof secret!=='string'||secret.length<16)throw Error('Webhook secret too short');
 if(typeof rawBody!=='string')throw Error('Raw body required');
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return toHex(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(rawBody))));
}
export async function verifyHmacSha256(secret,rawBody,signature){
 if(typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/.test(signature))return false;
 const expected=await signHmacSha256(secret,rawBody);
 // Constant-time compare of fixed-length lowercase ASCII hex.
 let diff=0;const supplied=signature.slice(7);
 for(let i=0;i<64;i++)diff|=expected.charCodeAt(i)^supplied.charCodeAt(i);
 return diff===0;
}
