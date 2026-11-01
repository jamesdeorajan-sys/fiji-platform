/* Bula Happiness — mobile screens (guest + staff). Plain HTML/JS, no framework, no external requests. Output is written with textContent only. */
const CSS = `
:root{--bg:#f6f4ef;--card:#fff;--ink:#16302b;--mut:#5d6f6b;--brand:#0d6b5f;--brand2:#0a4f46;--warn:#9a5b00;--bad:#a12622;--line:#dfe5e2;--chip:#e8f3f0}
@media (prefers-color-scheme:dark){:root{--bg:#10201d;--card:#172b27;--ink:#eef5f3;--mut:#9db4af;--brand:#37b3a1;--brand2:#2a9486;--warn:#f0b35a;--bad:#ff8a84;--line:#27403b;--chip:#1d3a35}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding-bottom:80px}
header{padding:14px 16px;background:var(--brand2);color:#fff;position:sticky;top:0;z-index:5}h1{font-size:19px;margin:0}header small{opacity:.85;display:block}
.wallet{margin:12px 16px 0;padding:10px 14px;background:var(--chip);border-radius:12px;font-weight:600}
nav{display:flex;gap:8px;padding:12px 16px 0}nav button{flex:1;min-height:44px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:12px;font-size:16px}nav button[aria-selected=true]{background:var(--brand);color:#fff;border-color:var(--brand)}
section{padding:8px 16px}h2{font-size:15px;color:var(--mut);text-transform:uppercase;letter-spacing:.04em;margin:18px 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;margin:0 0 12px}.card h3{margin:0 0 4px;font-size:18px}.mut{color:var(--mut);font-size:14px}
.price{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin:8px 0}.net{font-size:24px;font-weight:700}.was{text-decoration:line-through;color:var(--mut)}.credit{color:var(--brand);font-weight:600}
.btn{display:block;width:100%;min-height:48px;border:0;border-radius:12px;background:var(--brand);color:#fff;font-size:17px;font-weight:600;margin-top:10px}.btn.sec{background:transparent;color:var(--brand);border:1px solid var(--brand)}.btn[disabled]{opacity:.5}
.chip{display:inline-block;padding:3px 10px;border-radius:99px;background:var(--chip);font-size:13px;font-weight:600}.chip.ok{background:#d7f0e0;color:#0b5a2b}.chip.wait{background:#fdecc8;color:var(--warn)}.chip.off{background:#eee;color:#555}
.sheet{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:flex-end;z-index:10}.sheet.on{display:flex}.panel{background:var(--card);width:100%;max-height:90vh;overflow:auto;border-radius:20px 20px 0 0;padding:18px 16px 28px}
.row{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px dashed var(--line)}.row.total{font-weight:700;font-size:18px;border-bottom:0}
.step{display:flex;align-items:center;gap:14px;margin:10px 0}.step button{width:48px;height:48px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-size:22px}.step b{min-width:36px;text-align:center;font-size:20px}
.msg{padding:12px;border-radius:12px;background:var(--chip);margin:10px 0}.msg.bad{background:#fde3e1;color:var(--bad)}
input,textarea,select{width:100%;min-height:44px;font:16px system-ui;padding:8px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink)}textarea{min-height:140px;font-family:ui-monospace,monospace;font-size:13px}label{display:block;margin:10px 0 4px;font-weight:600}
`;
const COMMON = `
function $(i){return document.getElementById(i)}
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function fjd(c){return 'FJ$'+(c/100).toFixed(2)}
var FIJI=new Intl.DateTimeFormat('en-FJ',{timeZone:'Pacific/Fiji',weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
function fj(ms){return FIJI.format(new Date(ms))+' Fiji time'}
function uuid(){return (crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random())}
`;
export const GUEST_UI = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><title>Bula Happiness — offers</title><link rel="manifest" href="/bula/manifest.webmanifest"><link rel="apple-touch-icon" href="/icon-192.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="theme-color" content="#0a4f46"><style>${CSS}</style></head><body>
<header><h1>Bula Happiness</h1><small>PREVIEW — synthetic test data, no real bookings or payments</small></header>
<div id="wallet" class="wallet" hidden></div>
<nav role="tablist"><button role="tab" id="t-offers" aria-selected="true">Offers</button><button role="tab" id="t-mine" aria-selected="false">My bookings</button></nav>
<section id="v-offers"></section><section id="v-mine" hidden></section>
<div class="sheet" id="sheet"><div class="panel" id="panel"></div></div>
<script>
${COMMON}
var TOK=null;try{var m=/[#&]tok=([^&]+)/.exec(location.hash);if(m){TOK=decodeURIComponent(m[1]);try{localStorage.setItem('marau_tok',TOK)}catch(e){}history.replaceState(null,'',location.pathname)}}catch(e){}
if(!TOK){try{TOK=localStorage.getItem('marau_tok')}catch(e){}}
var STATE={offers:null,holds:null};
function api(path,opt){opt=opt||{};var h={'authorization':'Bearer '+TOK};if(opt.body){h['content-type']='application/json'}return fetch(path,{method:opt.method||'GET',headers:h,body:opt.body?JSON.stringify(opt.body):undefined,cache:'no-store'}).then(function(r){return r.json().then(function(j){return {status:r.status,data:j}})})}
function show(tab){$('v-offers').hidden=tab!=='offers';$('v-mine').hidden=tab!=='mine';$('t-offers').setAttribute('aria-selected',tab==='offers');$('t-mine').setAttribute('aria-selected',tab==='mine');if(tab==='mine')loadMine()}
$('t-offers').onclick=function(){show('offers')};$('t-mine').onclick=function(){show('mine')};
function noAccess(){var v=$('v-offers');v.textContent='';v.appendChild(el('div','msg bad','This page needs your private trip link. Open the link from your booking email (in Safari or Chrome). If you added this page to your Home Screen and see this message, open the email link again.'))}
function card(o){var c=el('div','card');c.appendChild(el('h3','',o.title));c.appendChild(el('div','mut',fj(o.serviceStartUtc)+' · '+o.pickupZones.split(',').join(', ')));
 var p=el('div','price');if(o.creditCents>0){p.appendChild(el('span','was',fjd(o.offerPriceCents)));}p.appendChild(el('span','net',fjd(o.netPayableCents)));if(o.creditCents>0)p.appendChild(el('span','credit','includes '+fjd(o.creditCents)+' welcome credit'));c.appendChild(p);
 c.appendChild(el('div','mut','Price is per '+(o.pricingBasis==='person'?'person':o.pricingBasis)+' · '+o.remaining+' '+o.capacityUnit+(o.remaining===1?'':'s')+' left · book by '+fj(o.bookingCutoffUtc)));
 c.appendChild(el('span','chip '+(o.instantConfirm?'ok':'wait'),o.instantConfirm?'Instant confirmation':'Subject to team confirmation'));
 var b=el('button','btn','See details & reserve');b.onclick=function(){openSheet(o)};c.appendChild(b);return c}
var RT=null;function schedule(d){if(RT)clearTimeout(RT);if(!d||!d.nextReleaseUtc||!d.serverNowUtc)return;var skew=d.serverNowUtc-Date.now();var delay=d.nextReleaseUtc-(Date.now()+skew)+2000;if(delay>0&&delay<2147000000)RT=setTimeout(loadOffers,delay)}
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'&&TOK)loadOffers()});
function loadOffers(){if(!TOK)return noAccess();api('/preview/bula/offers').then(function(r){if(r.status===401)return noAccess();var d=r.data;STATE.offers=d;schedule(d);var w=$('wallet');if(d.wallet){w.hidden=false;w.textContent='Welcome credit: '+fjd(d.wallet.availableCents)+' · promotional credit toward eligible offers, no cash value'}
 var v=$('v-offers');v.textContent='';if(d.empty){v.appendChild(el('div','msg',d.message));return}
 [['today','Today — still bookable'],['tomorrow','Tomorrow — released 6 pm Fiji time']].forEach(function(g){var list=d.cards.filter(function(c){return c.group===g[0]});if(!list.length)return;v.appendChild(el('h2','',g[1]));list.forEach(function(o){v.appendChild(card(o))})});
 v.appendChild(el('div','mut','Next release: '+fj(d.nextReleaseUtc)))})}
function calc(o,qty){var price=o.unitPriceCents*qty,credit=(price>=o.minSpendCents)?Math.max(0,Math.min(o.maxCreditCents*qty,STATE.offers.wallet?STATE.offers.wallet.availableCents:0,price)):0;return {price:price,credit:credit,net:price-credit}}
function openSheet(o){var panel=$('panel');panel.textContent='';var qty=1,idem=uuid();panel.appendChild(el('h3','',o.title));panel.appendChild(el('div','mut',fj(o.serviceStartUtc)));
 var rows=el('div');var msg=el('div');
 function paint(){rows.textContent='';var c=calc(o,qty);[['Price ('+qty+' × '+fjd(o.unitPriceCents)+')',fjd(c.price)],['Welcome credit',c.credit>0?'− '+fjd(c.credit):'none'],['You pay',fjd(c.net)]].forEach(function(r,i){var d=el('div','row'+(i===2?' total':''));d.appendChild(el('span','',r[0]));d.appendChild(el('span','',r[1]));rows.appendChild(d)});}
 if(o.pricingBasis==='person'){var s=el('div','step');var mi=el('button','','−'),ma=el('button','','+'),n=el('b','','1');mi.setAttribute('aria-label','fewer people');ma.setAttribute('aria-label','more people');
  mi.onclick=function(){if(qty>1){qty--;n.textContent=qty;paint()}};ma.onclick=function(){if(qty<o.remaining){qty++;n.textContent=qty;paint()}};s.appendChild(el('span','','People'));s.appendChild(mi);s.appendChild(n);s.appendChild(ma);panel.appendChild(s)}
 panel.appendChild(rows);paint();
 panel.appendChild(el('p','mut','Includes: '+o.inclusions+(o.exclusions?' · Not included: '+o.exclusions:'')));panel.appendChild(el('p','mut','Cancellation: '+o.cancellationTerms));panel.appendChild(el('p','mut','No payment is taken in this app. Credit has no cash value and applies only to eligible offers.'));
 panel.appendChild(msg);var go=el('button','btn',o.instantConfirm?'Reserve — instant confirmation':'Send request');var cl=el('button','btn sec','Close');cl.onclick=function(){$('sheet').classList.remove('on')};
 go.onclick=function(){go.disabled=true;var c=calc(o,qty);api('/preview/bula/reserve',{method:'POST',body:{offer_id:o.offerId,version:o.version,qty:qty,idem_key:idem,expected_net_cents:c.net}}).then(function(r){msg.textContent='';
  if(r.data&&r.data.ok){var h=r.data.hold;panel.textContent='';panel.appendChild(el('h3','',h.state==='confirmed'?'Confirmed ✓':'Request sent'));panel.appendChild(el('div','msg',h.message));panel.appendChild(el('div','row total',''));var t=el('div','row');t.appendChild(el('span','','You pay'));t.appendChild(el('span','',fjd(h.netPayableCents)));panel.appendChild(t);
   var b=el('button','btn','View my bookings');b.onclick=function(){$('sheet').classList.remove('on');show('mine')};panel.appendChild(b);loadOffers();return}
  go.disabled=false;var code=r.data&&r.data.code;var text={offer_changed:'This offer was just updated. Close and reopen it to see the new details.',price_changed:'The price or your credit changed. Close and reopen the offer.',sold_out:'Sorry — that was the last place.',insufficient_inventory:'Not enough places left for that many people.',past_cutoff:'Booking for this offer has closed.',not_published:'This offer is no longer available.',hold_expired:'That request expired. Please try again.',already_requested:'You already have a request for this offer — see My bookings. It will not be sent twice.'}[code]||'Could not reserve. Please try again.';msg.appendChild(el('div','msg bad',text));loadOffers()})};
 panel.appendChild(go);panel.appendChild(cl);$('sheet').classList.add('on')}
function loadMine(){var v=$('v-mine');if(!TOK){v.textContent='';v.appendChild(el('div','msg bad','This device has no private trip link, so your bookings cannot be shown here. Open the link from your booking email in this browser (a Home Screen copy keeps its own storage).'));return}api('/preview/bula/holds').then(function(r){v.textContent='';if(r.status===401){v.appendChild(el('div','msg bad','Your private trip link is not recognised. Open the link from your booking email again.'));return}if(r.status!==200){v.appendChild(el('div','msg bad','Could not load your bookings. Pull to refresh or try again.'));return}var hs=(r.data&&r.data.holds)||[];if(!hs.length){v.appendChild(el('div','msg','No bookings or requests yet.'));return}
 hs.forEach(function(h){try{var c=el('div','card');c.appendChild(el('h3','',h.title));c.appendChild(el('div','mut',fj(h.serviceStartUtc)+' · '+h.qty+' '+h.capacityUnit+(h.qty===1?'':'s')));var cls=h.state==='confirmed'?'ok':h.state==='held'?'wait':'off';c.appendChild(el('span','chip '+cls,h.state==='held'?'Requested':h.state[0].toUpperCase()+h.state.slice(1)));
  var p=el('div','price');p.appendChild(el('span','net',fjd(h.netPayableCents)));if(h.creditCents>0)p.appendChild(el('span','credit','after '+fjd(h.creditCents)+' credit'));c.appendChild(p);c.appendChild(el('div','mut',h.message));
  if(h.state==='confirmed'||h.state==='held'){var b=el('button','btn sec',h.state==='held'?'Withdraw request':'Cancel booking');b.onclick=function(){confirmAct(h)};c.appendChild(b)}
  if(h.state==='cancelled'&&h.creditCents>0)c.appendChild(el('div','mut',h.creditRestored?'Your credit was returned.':'Credit was not returned under the cancellation terms.'));v.appendChild(c)}catch(e){var bad=el('div','card');bad.appendChild(el('div','msg bad','One booking could not be displayed (reference '+String(h&&h.holdId||'?').slice(0,12)+').'));v.appendChild(bad)}})}).catch(function(){v.textContent='';v.appendChild(el('div','msg bad','Could not load your bookings. Check your connection and try again.'))})}
function confirmAct(h){var p=$('panel');p.textContent='';p.appendChild(el('h3','',h.state==='held'?'Withdraw this request?':'Cancel this booking?'));p.appendChild(el('p','mut','Cancellation terms: '+h.cancellationTerms));var m=el('div');p.appendChild(m);
 var y=el('button','btn',h.state==='held'?'Yes, withdraw':'Yes, cancel');var n=el('button','btn sec','Keep it');n.onclick=function(){$('sheet').classList.remove('on')};
 y.onclick=function(){y.disabled=true;api('/preview/bula/holds/'+h.holdId+'/'+(h.state==='held'?'release':'cancel'),{method:'POST',body:{}}).then(function(r){$('sheet').classList.remove('on');loadMine();loadOffers()})};p.appendChild(y);p.appendChild(n);$('sheet').classList.add('on')}
$('sheet').onclick=function(e){if(e.target===$('sheet'))$('sheet').classList.remove('on')};
loadOffers();
</script><div id="app-build" hidden></div></body></html>`;

export const STAFF_UI = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Bula Happiness — staff</title><style>${CSS}</style></head><body>
<header><h1>Bula staff</h1><small id="who">Not signed in</small></header>
<section id="login"><div class="card"><label for="adm">Admin credential</label><input id="adm" type="password" autocomplete="off"><label for="stf">Your staff token</label><input id="stf" type="password" autocomplete="off"><button class="btn" id="go">Sign in</button><div class="mut">Kept in this tab only (session storage). Your name and role come from the server, not from this form.</div><div id="lmsg"></div></div></section>
<nav id="tabs" hidden><button data-t="req" aria-selected="true">Requests</button><button data-t="off" aria-selected="false">Offers</button><button data-t="mail" aria-selected="false">Email</button></nav>
<section id="main" hidden></section>
<script>
${COMMON}
var A=null,S=null,TAB='req';try{A=sessionStorage.getItem('b_adm');S=sessionStorage.getItem('b_stf')}catch(e){}
function api(path,opt){opt=opt||{};var h={'authorization':'Bearer '+A,'x-marau-staff-token':S};if(opt.body)h['content-type']='application/json';return fetch(path,{method:opt.method||'GET',headers:h,body:opt.body?JSON.stringify(opt.body):undefined,cache:'no-store'}).then(function(r){return r.json().then(function(j){return {status:r.status,data:j}})})}
function boot(){api('/preview/admin/bula/me').then(function(r){if(r.status!==200){$('login').hidden=false;$('tabs').hidden=true;$('main').hidden=true;if(A)$('lmsg').textContent='Sign-in failed.';return}$('who').textContent=r.data.staffId+' · '+r.data.role;$('login').hidden=true;$('tabs').hidden=false;$('main').hidden=false;render()})}
$('go').onclick=function(){A=$('adm').value;S=$('stf').value;try{sessionStorage.setItem('b_adm',A);sessionStorage.setItem('b_stf',S)}catch(e){}$('adm').value='';$('stf').value='';boot()};
Array.prototype.forEach.call(document.querySelectorAll('#tabs button'),function(b){b.onclick=function(){TAB=b.getAttribute('data-t');Array.prototype.forEach.call(document.querySelectorAll('#tabs button'),function(x){x.setAttribute('aria-selected',x===b)});render()}});
function note(m,cls){var d=el('div','msg '+(cls||''),m);return d}
function render(){var v=$('main');v.textContent='';if(TAB==='req')reqs(v);else if(TAB==='off')offers(v);else mail(v)}
function reqs(v){api('/preview/admin/bula/queue').then(function(r){if(r.status!==200){v.appendChild(note('Not permitted for your role.','bad'));return}v.appendChild(el('h2','','Requests awaiting confirmation'));var q=r.data.requests;if(!q.length)v.appendChild(note('None waiting.'));
 q.forEach(function(h){var c=el('div','card');c.appendChild(el('h3','',h.title));c.appendChild(el('div','mut',fj(h.serviceStartUtc)+' · '+h.qty+' '+h.capacityUnit));c.appendChild(el('div','mut','Guest party: '+h.partyKey));c.appendChild(el('div','net',fjd(h.netPayableCents)+(h.creditCents?'  (credit '+fjd(h.creditCents)+')':'')));
  var ev=el('input');ev.placeholder='Evidence / note (e.g. operator confirmation ref)';ev.setAttribute('aria-label','evidence note');c.appendChild(ev);
  var ok=el('button','btn','Confirm');ok.onclick=function(){ok.disabled=true;api('/preview/admin/bula/holds/'+h.holdId+'/confirm',{method:'POST',body:{evidence_note:ev.value}}).then(render)};var no=el('button','btn sec','Decline');no.onclick=function(){no.disabled=true;api('/preview/admin/bula/holds/'+h.holdId+'/decline',{method:'POST',body:{evidence_note:ev.value||'declined'}}).then(render)};c.appendChild(ok);c.appendChild(no);v.appendChild(c)});
 v.appendChild(el('h2','','Recently confirmed'));r.data.confirmed.forEach(function(h){var c=el('div','card');c.appendChild(el('h3','',h.title));c.appendChild(el('div','mut',fj(h.serviceStartUtc)+' · '+fjd(h.netPayableCents)));var ev=el('input');ev.placeholder='Reason for cancelling for the guest';c.appendChild(ev);var x=el('button','btn sec','Cancel for guest');x.onclick=function(){if(!ev.value)return;api('/preview/admin/bula/holds/'+h.holdId+'/cancel',{method:'POST',body:{evidence_note:ev.value}}).then(render)};c.appendChild(x);v.appendChild(c)})})}
function offers(v){api('/preview/admin/bula/offers').then(function(r){v.appendChild(el('h2','','Offers'));(r.data.offers||[]).forEach(function(o){var c=el('div','card');c.appendChild(el('h3','',o.title));c.appendChild(el('span','chip',o.status));c.appendChild(el('div','mut',o.service_date+' · '+fjd(o.price_cents)+' · credit up to '+fjd(o.max_credit_cents)+' · '+o.remaining+'/'+o.capacity_total+' '+o.capacity_unit));
  if(o.status==='draft'){var a=el('button','btn','Approve');a.onclick=function(){api('/preview/admin/bula/offers/'+o.offer_id+'/approve',{method:'POST',body:{}}).then(function(x){if(x.status!==200)alert2(x.data.code||x.data.error);render()})};c.appendChild(a)}
  if(o.status!=='withdrawn'&&o.status!=='expired'){var w=el('button','btn sec','Withdraw');w.onclick=function(){api('/preview/admin/bula/offers/'+o.offer_id+'/withdraw',{method:'POST',body:{}}).then(render)};c.appendChild(w)}v.appendChild(c)});
 v.appendChild(el('h2','','Import offers (CSV text)'));var t=el('textarea');t.setAttribute('aria-label','csv');v.appendChild(t);var b=el('button','btn','Import as drafts');var m=el('div');b.onclick=function(){api('/preview/admin/bula/offers/import',{method:'POST',body:{csv:t.value}}).then(function(x){m.textContent='';m.appendChild(note(x.data.created?('Imported '+x.data.created+' draft(s).'):((x.data.errors||[]).map(function(e){return 'Row '+e.row+': '+e.error}).join(' | ')||x.data.error),x.data.created?'':'bad'));if(x.data.created)render()})};v.appendChild(b);v.appendChild(m);
 var pb=el('button','btn sec','Run 6 pm publisher now');pb.onclick=function(){api('/preview/admin/bula/publish',{method:'POST',body:{}}).then(function(x){m.textContent='';m.appendChild(note(JSON.stringify(x.data)));render()})};v.appendChild(pb)})}
function alert2(t){var d=note(t,'bad');$('main').insertBefore(d,$('main').firstChild)}
function mail(v){api('/preview/admin/bula/queue').then(function(r){v.appendChild(el('h2','','Email needing attention'));var e=(r.data&&r.data.email)||[];if(!e.length)v.appendChild(note('Nothing needs attention.'));e.forEach(function(j){var c=el('div','card');c.appendChild(el('h3','',j.booking_ref+' · '+j.recipient_kind));c.appendChild(el('span','chip wait',j.state));c.appendChild(el('div','mut',j.blocked_reason||j.last_error||''));v.appendChild(c)})})}
if(A&&S)boot();
</script></body></html>`;
