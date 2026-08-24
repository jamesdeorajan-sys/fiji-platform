import { Hono } from 'hono';
import { determineOfferAction, filterEligibleOffers, compareOffers, parseNaturalLanguageIntent, suggestCrossSell, recordOutboundClick, createEnquiryReview, buildEnquiryIdempotencyKey, markWhatsappLinkOpened, type PublicDealSummary, type DealSearchFilters } from './deal-exchange-listing';

// VAKAVITI LIVE DEAL EXCHANGE - Milestone 3 mobile visitor journey (2026-08-24).
// Public-facing (no admin session required to browse) - this is the visitor-facing surface, NOT
// the private opportunity console (that belongs to PR #21, a separate branch entirely). Nothing
// here can mutate a deal's public eligibility - it only reads deal_exchange_offers rows whose
// publication_decision is already 'ELIGIBLE', computed offline by evaluateOfferPublicationGates().

export type Bindings = {
  DEAL_EXCHANGE_DB?: D1Database;
  DEAL_EXCHANGE_QA_DB?: D1Database;
  ENVIRONMENT: string;
  DEAL_EXCHANGE_PUBLIC_ENABLED?: string;
  MARKETPLACE_ENQUIRY_WHATSAPP?: string;
  QA_TEST_MODE?: string;
  QA_AUTH_SECRET?: string;
  CF_VERSION_METADATA?: { id: string; tag: string };
};

const QA_RUN_ID_HEADER = 'x-vakaviti-qa-run-id';
const QA_TIMESTAMP_HEADER = 'x-vakaviti-qa-timestamp';
const QA_NONCE_HEADER = 'x-vakaviti-qa-nonce';
const QA_SIGNATURE_HEADER = 'x-vakaviti-qa-signature';
const QA_RUN_ID_PATTERN = /^pw-[a-z0-9-]{6,64}$/; // matches the run-id format Playwright generates - not a secret, just a namespacing convention
const QA_NONCE_PATTERN = /^[a-f0-9]{32,64}$/;
const QA_SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;
const QA_MAX_SKEW_MS = 5 * 60 * 1000; // rejects stale/replayed-after-a-long-gap requests outright

// Thrown by getEnquiryDb()/verifyQaAuth() for any auth failure - caught by dealExchangeUi's
// onError handler below and turned into a 401 with the (non-secret) reason, never a silent
// fallback and never a raw 500.
class QaAuthError extends Error {}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// FINAL INTEGRATION REVIEW, Phase 1 (2026-08-25): replaces the old header-only QA gate. A
// caller-supplied x-vakaviti-qa-run-id is NEVER sufficient on its own - every one of the
// following must independently hold, in order, cheapest/hardest-to-fake first:
//   1. This deployment structurally IS the dedicated QA environment. Not a flag a caller can
//      fake: DEAL_EXCHANGE_QA_DB only exists under [env.qa] in wrangler.toml, so on every other
//      deployment (ordinary branch preview, eventual production) c.env.DEAL_EXCHANGE_QA_DB is
//      simply undefined, full stop - no header or credential changes that.
//   2. QA_TEST_MODE==='true' - a second, independently-set env var (belt and braces with #1).
//   3. QA_AUTH_SECRET is bound - a real Cloudflare secret (`wrangler secret put ... --env qa`),
//      never written to wrangler.toml, never logged, never equal to or derived from the
//      production ADMIN_TOKEN (a wholly separate credential, scoped to QA only).
//   4. A well-formed run id, a timestamp within QA_MAX_SKEW_MS of now, a nonce never seen before
//      (checked against qa_auth_nonces, itself only reachable inside the isolated QA database),
//      and a signature equal to HMAC-SHA256(QA_AUTH_SECRET, `${runId}.${nonce}.${timestamp}`) -
//      compared in constant time.
export async function verifyQaAuth(c: any, runId: string | undefined): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!c.env.DEAL_EXCHANGE_QA_DB) return { ok: false, reason: 'not the QA environment' };
  if (c.env.QA_TEST_MODE !== 'true') return { ok: false, reason: 'QA_TEST_MODE not enabled' };
  if (!c.env.QA_AUTH_SECRET) return { ok: false, reason: 'QA_AUTH_SECRET not bound' };
  if (!runId || !QA_RUN_ID_PATTERN.test(runId)) return { ok: false, reason: 'missing or malformed run id' };
  const timestamp = c.req.header(QA_TIMESTAMP_HEADER);
  const nonce = c.req.header(QA_NONCE_HEADER);
  const signature = c.req.header(QA_SIGNATURE_HEADER);
  if (!timestamp || !/^\d{10,13}$/.test(timestamp)) return { ok: false, reason: 'missing or malformed timestamp' };
  if (!nonce || !QA_NONCE_PATTERN.test(nonce)) return { ok: false, reason: 'missing or malformed nonce' };
  if (!signature || !QA_SIGNATURE_PATTERN.test(signature)) return { ok: false, reason: 'missing or malformed signature' };
  const skew = Math.abs(Date.now() - Number(timestamp));
  if (skew > QA_MAX_SKEW_MS) return { ok: false, reason: 'timestamp outside allowed skew (stale or replayed)' };
  const expected = await hmacHex(c.env.QA_AUTH_SECRET, `${runId}.${nonce}.${timestamp}`);
  if (!timingSafeEqual(expected, signature)) return { ok: false, reason: 'invalid signature' };
  const already = await c.env.DEAL_EXCHANGE_QA_DB.prepare('SELECT 1 FROM qa_auth_nonces WHERE nonce=?').bind(nonce).first();
  if (already) return { ok: false, reason: 'nonce already used (replay)' };
  await c.env.DEAL_EXCHANGE_QA_DB.prepare('INSERT INTO qa_auth_nonces (nonce) VALUES (?)').bind(nonce).run();
  return { ok: true };
}

async function getEnquiryDb(c: any): Promise<D1Database> {
  const runId = c.req.header(QA_RUN_ID_HEADER);
  if (runId) {
    const auth = await verifyQaAuth(c, runId);
    if (auth.ok) return c.env.DEAL_EXCHANGE_QA_DB;
    if (c.env.DEAL_EXCHANGE_QA_DB && c.env.QA_TEST_MODE === 'true') {
      // We ARE the QA deployment and a QA run id was supplied but failed auth - never silently
      // fall through to a production/preview DB that, by construction, isn't even bound here.
      throw new QaAuthError(auth.reason);
    }
    // Any other deployment: a QA run id header is simply irrelevant here (there is no QA_DB to
    // route to), so it has exactly zero effect - not even to select the alternate credential
    // path. A spoofed header on the ordinary preview behaves identically to no header at all.
  }
  if (!c.env.DEAL_EXCHANGE_DB) throw new QaAuthError('no database available for this request');
  return c.env.DEAL_EXCHANGE_DB;
}
export const dealExchangeUi = new Hono<{ Bindings: Bindings }>();

dealExchangeUi.onError((err, c) => {
  if (err instanceof QaAuthError) return c.json({ error: err.message }, 401);
  throw err;
});

// Phase 2 (Final Integration Review): non-secret build identity, reachable on every deployment
// (registered before the gating middleware below) regardless of whether Deal Exchange itself is
// configured/enabled - globalSetup polls this as its deployment-readiness signal.
dealExchangeUi.get('/internal/build-info', c => {
  return c.json({
    versionId: c.env.CF_VERSION_METADATA?.id ?? null,
    versionTag: c.env.CF_VERSION_METADATA?.tag ?? null,
    environment: c.env.ENVIRONMENT ?? null,
    qaModeActive: !!(c.env.DEAL_EXCHANGE_QA_DB && c.env.QA_TEST_MODE === 'true'),
  });
});

// Structurally inert whenever DEAL_EXCHANGE_DB is absent (e.g. production, until a separately
// authorized merge/migration - see the wrangler.toml pre-merge checklist), AND independently
// gated by DEAL_EXCHANGE_PUBLIC_ENABLED (Milestone 4 entry gate 4) - a future production rollout
// deploys the binding first, with this flag left unset, so the two are never conflated: a bound
// database does not by itself make the public routes live. Every route below can assume both
// conditions hold past this point - EXCEPT on the dedicated QA deployment, which deliberately has
// no DEAL_EXCHANGE_DB and leaves DEAL_EXCHANGE_PUBLIC_ENABLED false (it is not public), so it is
// let through on a separate, still-structural condition instead (never a per-request header).
dealExchangeUi.use('*', async (c, next) => {
  const isQaEnv = !!c.env.DEAL_EXCHANGE_QA_DB && c.env.QA_TEST_MODE === 'true';
  if (!c.env.DEAL_EXCHANGE_DB && !isQaEnv) return c.text('Live Deal Exchange is not configured on this environment.', 503);
  if (!isQaEnv && c.env.DEAL_EXCHANGE_PUBLIC_ENABLED !== 'true') return c.text('Live Deal Exchange is not yet publicly enabled on this environment.', 503);
  await next();
});

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const shell = (body: string, opts: { title?: string; active?: string; extraHead?: string } = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title || 'Explore Fiji')} - Vakaviti</title>
<meta name="robots" content="noindex,nofollow">
${opts.extraHead || ''}
<style>
:root{--ink:#12231b;--muted:#607068;--line:#dde5e0;--bg:#f6f8f7;--accent:#0f6e6a;--warn:#a15c00;--danger:#a1272b;--good:#1f7a4d}
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:var(--bg);color:var(--ink);-webkit-text-size-adjust:100%;padding-bottom:72px}
header{position:sticky;top:0;background:rgba(246,248,247,.96);backdrop-filter:blur(6px);z-index:10;padding:12px 16px;border-bottom:1px solid var(--line)}
header a.brand{color:var(--ink);text-decoration:none;font-weight:700;font-size:16px}
main{max-width:900px;margin:auto;padding:16px}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:12px;overflow-wrap:break-word}
.muted{color:var(--muted);font-size:13px}
.badge{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:#eef2ef;color:var(--muted)}
.badge.good{background:#e9f5f0;color:var(--good)}
.badge.warn{background:#fff3d6;color:var(--warn)}
.btn{display:inline-block;background:var(--ink);color:#fff;border:none;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700;font-size:14px;min-height:44px;min-width:44px;cursor:pointer}
.btn.secondary{background:#fff;color:var(--ink);border:1px solid var(--ink)}
.btn.small{padding:10px 14px;font-size:13px;min-height:44px}
.row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.filters select,.filters input{min-height:44px;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:14px}
.price{font-weight:800;font-size:20px}
a:focus-visible,button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
nav.tabbar{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid var(--line);display:flex;z-index:20;padding-bottom:env(safe-area-inset-bottom)}
nav.tabbar a{flex:1;text-align:center;padding:10px 4px;min-height:44px;text-decoration:none;color:var(--muted);font-size:12px;font-weight:600}
nav.tabbar a.active{color:var(--accent)}
.overflow-x{overflow-x:auto}
@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:0.01ms!important;transition-duration:0.01ms!important}}
</style></head>
<body>
<header><a class="brand" href="/explore">Vakaviti</a></header>
<main>${body}</main>
<nav class="tabbar">
  <a href="/explore" class="${opts.active === 'explore' ? 'active' : ''}">Explore</a>
  <a href="/live-deals" class="${opts.active === 'deals' ? 'active' : ''}">Deals</a>
  <a href="/plan" class="${opts.active === 'plan' ? 'active' : ''}">Plan</a>
  <a href="/saved" class="${opts.active === 'saved' ? 'active' : ''}">Saved</a>
  <a href="/chat" class="${opts.active === 'chat' ? 'active' : ''}">Chat</a>
</nav>
</body></html>`;

function toSummary(o: any): PublicDealSummary {
  return {
    id: o.id, offerOwnerType: o.offer_owner_type, title: o.detected_title || o.provider_name || 'Fiji offer',
    providerName: o.provider_name, sellerName: o.seller_name, region: o.region || o.locality, category: o.category,
    priceAmount: o.price_amount, currency: o.currency, isFromPrice: !!o.is_from_price, priceBasis: o.price_basis,
    occupancyBasis: o.occupancy_basis, nights: o.nights, inclusions: o.inclusions,
    travelStart: o.travel_start, travelEnd: o.travel_end, bookingDeadline: o.booking_deadline,
    checkedAt: o.checked_at, bookingRoute: o.booking_route,
    audience: o.audience_tags ? (o.audience_tags.split(',') as ('family' | 'couple' | 'adults_only')[]) : null,
  };
}

const dealCard = (o: PublicDealSummary, compareIds: string[] = []) => {
  const action = determineOfferAction(o.offerOwnerType, o.sellerName, o.bookingRoute);
  const crossSell = suggestCrossSell({ region: o.region, category: o.category });
  const price = o.priceAmount ? `${o.isFromPrice ? 'From ' : ''}${esc(o.currency)} ${esc(o.priceAmount)}` : 'Price on enquiry';
  const checked = o.checkedAt ? new Date(o.checkedAt).toISOString().slice(0, 10) : 'not recorded';
  const isChecked = compareIds.includes(o.id);
  return `<div class="card">
    <div class="row" style="justify-content:space-between;margin-top:0">
      <span class="badge good">${esc(o.offerOwnerType.replace(/_/g, ' '))}</span>
      <span class="price">${price}</span>
    </div>
    <h2 style="font-size:17px;margin:8px 0 2px">${esc(o.title)}</h2>
    <p class="muted" style="margin:0 0 4px">${esc(o.providerName || '')}${o.sellerName ? ' &middot; via ' + esc(o.sellerName) : ''} &middot; ${esc(o.region || 'Fiji')}</p>
    ${o.priceBasis ? `<p class="muted" style="margin:0 0 4px">${esc(o.priceBasis.replace(/_/g, ' '))}${o.occupancyBasis ? ', ' + esc(o.occupancyBasis) : ''}${o.nights ? ', ' + o.nights + ' nights' : ''}</p>` : ''}
    ${o.inclusions ? `<p style="margin:0 0 8px;font-size:13px">${esc(o.inclusions)}</p>` : ''}
    <p class="muted" style="margin:0 0 4px">Travel: ${esc(o.travelStart || '?')} to ${esc(o.travelEnd || '?')} ${o.bookingDeadline ? '&middot; book by ' + esc(o.bookingDeadline) : ''}</p>
    <p class="muted" style="margin:0 0 8px">Last checked ${esc(checked)} &middot; availability not guaranteed until confirmed</p>
    ${crossSell.length ? `<p class="muted" style="margin:0 0 8px;font-size:12px">${crossSell.map(c => esc(c.reason)).join(' ')}</p>` : ''}
    <div class="row">
      <a class="btn small" href="/live-deals/${esc(o.id)}">Details</a>
      <label class="btn small secondary" style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="compare" value="${esc(o.id)}" ${isChecked ? 'checked' : ''} onchange="toggleCompare('${esc(o.id)}')" style="width:20px;height:20px"> Compare</label>
      <button class="btn small secondary" onclick="saveDeal('${esc(o.id)}','${esc(o.title)}')">Save</button>
      ${action.actionType !== 'NONE' ? `<a class="btn small" href="/go/deal/${esc(o.id)}" data-action="${esc(action.actionType)}">${esc(action.cta)}</a>` : ''}
    </div>
  </div>`;
};

const SAVED_TRIP_SCRIPT = `<script>
function readSaved(){ try { return JSON.parse(localStorage.getItem('vakaviti_saved_trip')||'{"deals":[],"products":[]}'); } catch(e){ return {deals:[],products:[]}; } }
function writeSaved(s){ localStorage.setItem('vakaviti_saved_trip', JSON.stringify(s)); }
function saveDeal(id, title){ var s = readSaved(); if(!s.deals.find(function(d){return d.id===id})) s.deals.push({id:id, title:title}); writeSaved(s); alert('Saved to your trip.'); }
function toggleCompare(id){ var el = document.querySelectorAll('[name=compare]'); var chosen=[]; el.forEach(function(c){ if(c.checked) chosen.push(c.value); }); if(chosen.length>3){ alert('You can compare up to 3 at a time.'); return; } window.__compareIds = chosen; }
function goCompare(){ var ids = window.__compareIds || []; if(ids.length<2){ alert('Choose at least 2 to compare.'); return; } window.location = '/compare?ids=' + ids.join(','); }
</script>`;

// --- Explore (item 1: primary nav) ---------------------------------------------------------------
dealExchangeUi.get('/explore', async c => {
  const db = c.env.DEAL_EXCHANGE_DB!;
  const offers = await db.prepare(`SELECT * FROM deal_exchange_offers WHERE publication_decision='ELIGIBLE' ORDER BY checked_at DESC LIMIT 6`).all<any>();
  const owned = await db.prepare(`SELECT * FROM deal_exchange_owned_products WHERE classification != 'EXCLUDED_QUARANTINED' ORDER BY category, product_name LIMIT 12`).all<any>();
  return c.html(shell(`
    <h1 style="font-size:20px">Explore Fiji</h1>
    <form method="POST" action="/search-intent" class="card">
      <label class="muted" for="intent-text" style="font-size:12px">Tell us what you're looking for</label>
      <input id="intent-text" name="text" type="text" placeholder="Family of four from Sydney in September, 7 nights near Denarau" style="width:100%;min-height:44px;border:1px solid var(--line);border-radius:8px;padding:8px">
      <div class="row"><button class="btn small" type="submit">Find options</button></div>
    </form>
    <h2 style="font-size:16px">Live deals</h2>
    ${(offers.results || []).map(o => dealCard(toSummary(o))).join('') || '<div class="card">No public deals match right now - check back soon.</div>'}
    <h2 style="font-size:16px">Owned tours &amp; transfers</h2>
    ${(owned.results || []).map((p: any) => `<div class="card"><h3 style="font-size:15px;margin:0 0 4px">${esc(p.product_name)}</h3><p class="muted" style="margin:0 0 4px">${esc(p.category)} &middot; ${esc(p.region || 'Fiji')}</p>${p.price_amount ? `<p class="price" style="font-size:16px">${esc(p.currency)} ${esc(p.price_amount)}</p>` : '<p class="muted">Live quote - price calculated at booking</p>'}<span class="badge">${esc(p.classification.replace(/_/g, ' '))}</span></div>`).join('')}
    ${SAVED_TRIP_SCRIPT}
  `, { title: 'Explore', active: 'explore' }));
});

// --- Deals (search/filter) -------------------------------------------------------------------------
dealExchangeUi.get('/live-deals', async c => {
  const db = c.env.DEAL_EXCHANGE_DB!;
  const q = c.req.query();
  const filters: DealSearchFilters = {
    travelYear: q.year ? parseInt(q.year, 10) : undefined,
    travelMonth: q.month ? parseInt(q.month, 10) : undefined,
    region: q.region || undefined,
    category: q.category || undefined,
    audience: (q.audience as any) || undefined,
    offerOwnerType: (q.type as any) || undefined,
  };
  const all = await db.prepare(`SELECT * FROM deal_exchange_offers WHERE publication_decision='ELIGIBLE' ORDER BY checked_at DESC`).all<any>();
  const summaries = (all.results || []).map(toSummary);
  const filtered = filterEligibleOffers(summaries, filters);
  return c.html(shell(`
    <h1 style="font-size:20px">Live Deals</h1>
    <form method="GET" action="/live-deals" class="filters">
      <select name="month" aria-label="Travel month">
        <option value="">Any month</option>
        ${['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => `<option value="${i + 1}" ${filters.travelMonth === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
      <input type="hidden" name="year" value="${filters.travelYear || new Date().getFullYear()}">
      <select name="region" aria-label="Region"><option value="">Any region</option>${['Denarau','Nadi','Coral Coast','Mamanuca','Yasawa','Pacific Harbour','Savusavu','Taveuni'].map(r => `<option ${filters.region === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <select name="category" aria-label="Category"><option value="">Any type</option><option value="accommodation" ${filters.category === 'accommodation' ? 'selected' : ''}>Accommodation</option><option value="tour" ${filters.category === 'tour' ? 'selected' : ''}>Tour</option><option value="transfer" ${filters.category === 'transfer' ? 'selected' : ''}>Transfer</option><option value="cruise" ${filters.category === 'cruise' ? 'selected' : ''}>Cruise</option></select>
      <select name="audience" aria-label="Traveller type"><option value="">Family/Couple/Adults-only</option><option value="family" ${filters.audience === 'family' ? 'selected' : ''}>Family</option><option value="couple" ${filters.audience === 'couple' ? 'selected' : ''}>Couple</option><option value="adults_only" ${filters.audience === 'adults_only' ? 'selected' : ''}>Adults only</option></select>
      <select name="type" aria-label="Booking route"><option value="">Any booking type</option><option value="VAKAVITI_BOOKABLE" ${filters.offerOwnerType === 'VAKAVITI_BOOKABLE' ? 'selected' : ''}>Book through Vakaviti</option><option value="PROVIDER_DIRECT" ${filters.offerOwnerType === 'PROVIDER_DIRECT' ? 'selected' : ''}>Provider-direct</option><option value="SELLER_PACKAGE" ${filters.offerOwnerType === 'SELLER_PACKAGE' ? 'selected' : ''}>Seller package</option></select>
      <button class="btn small" type="submit">Filter</button>
    </form>
    <p class="muted">${filtered.length} of ${summaries.length} public deals match${filters.travelMonth ? ` for ${['','January','February','March','April','May','June','July','August','September','October','November','December'][filters.travelMonth]} ${filters.travelYear}` : ''}.</p>
    ${filtered.map(o => dealCard(o)).join('') || '<div class="card">No deals match these filters right now. Try a different month or region, or <a href="/chat">ask Vakaviti</a>.</div>'}
    <div class="row"><button class="btn secondary" onclick="goCompare()">Compare selected</button></div>
    ${SAVED_TRIP_SCRIPT}
  `, { title: 'Deals', active: 'deals' }));
});

// --- AI/search readiness (Milestone 4D) - PREPARED, NOT ENABLED --------------------------------
// Every field here is copied from data already visible on the rendered card (structured data must
// match visible facts, never assert more than the page shows). robots stays noindex,nofollow
// regardless - this is preparation for a future branded launch, not activation. The canonical URL
// points at THIS isolated preview origin, never vakaviti.ai - attaching a real domain is an
// explicit, separate, not-yet-authorized step.
// Search safety (Milestone 4 CEO review): three real gaps found and fixed here.
// 1. "InStock" was an unsupported availability claim - this app has no confirmed inventory/
//    booking-availability data, and the SAME card already shows "availability not guaranteed
//    until confirmed" in visible text right next to this structured data, which "InStock" flatly
//    contradicted. Omitted entirely rather than asserted without evidence - schema.org does not
//    require an availability value.
// 2. A PROVIDER_DIRECT offer never set `seller` at all, which risks a consumer defaulting to the
//    PAGE PUBLISHER (Vakaviti) as the implied seller - explicitly set to the real provider/seller
//    (never Vakaviti) for every offer type that reaches this function.
// 3. Price basis (per-night vs per-person vs total etc.) is now represented in machine-readable
//    form via priceSpecification, not just folded into the free-text description.
function buildDealSeoHead(c: any, o: PublicDealSummary): string {
  const origin = new URL(c.req.url).origin;
  const canonical = `${origin}/live-deals/${o.id}`;
  const description = `${o.title}${o.providerName ? ' at ' + o.providerName : ''}${o.region ? ', ' + o.region : ''} - ${o.priceAmount ? (o.isFromPrice ? 'from ' : '') + o.currency + ' ' + o.priceAmount : 'price on enquiry'}${o.priceBasis ? ' (' + o.priceBasis.replace(/_/g, ' ').toLowerCase() + ')' : ''}. Last checked ${o.checkedAt ? new Date(o.checkedAt).toISOString().slice(0, 10) : 'recently'}.`;
  // The real seller-of-record for schema.org purposes: the provider for PROVIDER_DIRECT, the
  // named seller for SELLER_PACKAGE - never Vakaviti, and never left implicit/undefined (which
  // some consumers read as "the site itself").
  const sellerOfRecord = o.sellerName || o.providerName || null;
  const jsonLd = o.priceAmount && o.currency ? {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: o.title,
    description,
    offers: {
      '@type': 'Offer',
      price: o.priceAmount,
      priceCurrency: o.currency,
      url: canonical,
      seller: sellerOfRecord ? { '@type': 'Organization', name: sellerOfRecord } : undefined,
      priceSpecification: o.priceBasis ? {
        '@type': 'UnitPriceSpecification',
        price: o.priceAmount,
        priceCurrency: o.currency,
        unitText: o.priceBasis.replace(/_/g, ' ').toLowerCase(),
      } : undefined,
    },
  } : null;
  return [
    `<link rel="canonical" href="${esc(canonical)}">`,
    `<meta name="description" content="${esc(description)}">`,
    jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : '',
  ].join('\n');
}

// --- Deal detail -------------------------------------------------------------------------------
dealExchangeUi.get('/live-deals/:id', async c => {
  const db = c.env.DEAL_EXCHANGE_DB!;
  const o = await db.prepare(`SELECT * FROM deal_exchange_offers WHERE id=?`).bind(c.req.param('id')).first<any>();
  if (!o || o.publication_decision !== 'ELIGIBLE') return c.notFound();
  const summary = toSummary(o);
  return c.html(shell(dealCard(summary) + SAVED_TRIP_SCRIPT, { title: summary.title, active: 'deals', extraHead: buildDealSeoHead(c, summary) }));
});

// --- Compare (up to 3) ---------------------------------------------------------------------------
dealExchangeUi.get('/compare', async c => {
  const db = c.env.DEAL_EXCHANGE_DB!;
  const ids = (c.req.query('ids') || '').split(',').filter(Boolean).slice(0, 3);
  if (ids.length === 0) return c.html(shell('<div class="card">Choose deals from the Deals page to compare.</div>', { title: 'Compare', active: 'deals' }));
  const rows: any[] = [];
  for (const id of ids) {
    const o = await db.prepare(`SELECT * FROM deal_exchange_offers WHERE id=? AND publication_decision='ELIGIBLE'`).bind(id).first<any>();
    if (o) rows.push(o);
  }
  const summaries = rows.map(toSummary);
  const result = compareOffers(summaries);
  return c.html(shell(`
    <h1 style="font-size:20px">Compare</h1>
    ${!result.allComparable ? `<div class="card"><span class="badge warn">Not directly comparable</span><p style="margin:8px 0 0;font-size:13px">${esc(result.entries.find(e => !e.comparable)?.incomparabilityReason || 'Price bases differ.')}</p></div>` : ''}
    <div class="overflow-x"><div style="display:flex;gap:12px;min-width:${result.entries.length * 260}px">
      ${result.entries.map(e => `<div style="flex:1;min-width:240px">${dealCard(e.offer)}</div>`).join('')}
    </div></div>
  `, { title: 'Compare', active: 'deals' }));
});

// --- Plan (saved trip, client-side) ----------------------------------------------------------------
dealExchangeUi.get('/plan', async c => {
  return c.html(shell(`
    <h1 style="font-size:20px">Your Plan</h1>
    <div id="plan-list" class="card">Loading your saved trip&hellip;</div>
    <div class="row"><input id="party-size" type="number" min="1" placeholder="Party size" style="min-height:44px;border:1px solid var(--line);border-radius:8px;padding:8px;width:120px"><input id="hotel-point" type="text" placeholder="Hotel / arrival point" style="min-height:44px;border:1px solid var(--line);border-radius:8px;padding:8px;flex:1"></div>
    <div class="row"><button class="btn small secondary" onclick="clearSaved()">Clear all</button></div>
    <script>
      function render(){
        var s = readSaved();
        var el = document.getElementById('plan-list');
        if (s.deals.length === 0 && s.products.length === 0) { el.innerHTML = '<p class="muted">Nothing saved yet - browse <a href="/live-deals">Deals</a> or <a href="/explore">Explore</a>.</p>'; return; }
        el.innerHTML = s.deals.map(function(d){ return '<p style="margin:4px 0">' + d.title + ' <button class="btn small secondary" onclick="removeSaved(\\'' + d.id + '\\')">Remove</button></p>'; }).join('');
      }
      function removeSaved(id){ var s = readSaved(); s.deals = s.deals.filter(function(d){return d.id!==id}); writeSaved(s); render(); }
      function clearSaved(){ localStorage.removeItem('vakaviti_saved_trip'); render(); }
      render();
    </script>
    ${SAVED_TRIP_SCRIPT}
  `, { title: 'Plan', active: 'plan' }));
});

dealExchangeUi.get('/saved', async c => c.redirect('/plan'));

// --- Chat / WhatsApp handoff review (item 11) -------------------------------------------------
dealExchangeUi.get('/chat', async c => {
  return c.html(shell(`
    <h1 style="font-size:20px">Ask Vakaviti</h1>
    <p class="muted">Review what we'll share before you head to WhatsApp - nothing is sent until you confirm.</p>
    <form method="POST" action="/chat/review" class="card">
      <label class="muted" for="dates" style="font-size:12px">Travel dates</label>
      <input id="dates" name="travel_dates" type="text" style="width:100%;min-height:44px;border:1px solid var(--line);border-radius:8px;padding:8px">
      <label class="muted" for="party" style="font-size:12px">Party size</label>
      <input id="party" name="party_size" type="text" style="width:100%;min-height:44px;border:1px solid var(--line);border-radius:8px;padding:8px">
      <label class="muted" for="hotel" style="font-size:12px">Hotel / arrival point</label>
      <input id="hotel" name="hotel_point" type="text" style="width:100%;min-height:44px;border:1px solid var(--line);border-radius:8px;padding:8px">
      <label class="muted" for="q" style="font-size:12px">Any unresolved questions?</label>
      <textarea id="q" name="questions" style="width:100%;min-height:80px;border:1px solid var(--line);border-radius:8px;padding:8px"></textarea>
      <div class="row"><button class="btn small" type="submit">Review before WhatsApp</button></div>
    </form>
  `, { title: 'Chat', active: 'chat' }));
});

dealExchangeUi.post('/chat/review', async c => {
  const body = await c.req.parseBody();
  const db = await getEnquiryDb(c);
  const reviewInput = {
    dealId: null, productId: null,
    travelDates: String(body.travel_dates || '') || null,
    partySize: String(body.party_size || '') || null,
    hotelOrArrivalPoint: String(body.hotel_point || '') || null,
    unresolvedQuestions: String(body.questions || '') || null,
  };
  const idempotencyKey = await buildEnquiryIdempotencyKey(reviewInput);
  const review = await createEnquiryReview(db, { ...reviewInput, idempotencyKey });
  return c.html(shell(`
    <h1 style="font-size:20px">Review before you go</h1>
    <div class="card">
      <p><b>Enquiry reference:</b> ${esc(review.enquiryReference)}</p>
      <p><b>Dates:</b> ${esc(body.travel_dates || 'not specified')}</p>
      <p><b>Party size:</b> ${esc(body.party_size || 'not specified')}</p>
      <p><b>Arrival point:</b> ${esc(body.hotel_point || 'not specified')}</p>
      <p><b>Questions:</b> ${esc(body.questions || 'none')}</p>
      <p class="muted">This reference lets our team see what you already told us, so you won't need to repeat it.</p>
      <div class="row"><a class="btn small" href="/chat/open-whatsapp/${esc(review.enquiryId)}" target="_blank" rel="noopener noreferrer">Continue to WhatsApp</a> <a class="btn small secondary" href="/chat">Edit</a></div>
    </div>
  `, { title: 'Review', active: 'chat' }));
});

// Tracked WhatsApp handoff - records WHATSAPP_LINK_OPENED (observable: the visitor actually
// clicked through) BEFORE redirecting to the real wa.me link, same "record before the 302"
// discipline as recordOutboundClick(). This never claims a message was sent - only that the
// visitor opened the link. The destination is Vakaviti's own configured WhatsApp number
// (MARKETPLACE_ENQUIRY_WHATSAPP), never a provider's private contact - this is the Vakaviti
// concierge handoff, not a provider-direct enquiry route.
dealExchangeUi.get('/chat/open-whatsapp/:id', async c => {
  const db = await getEnquiryDb(c);
  const enquiry = await db.prepare('SELECT * FROM deal_exchange_enquiries WHERE id=?').bind(c.req.param('id')).first<any>();
  if (!enquiry) return c.notFound();
  await markWhatsappLinkOpened(db, enquiry.id);
  const waNumber = (c.env.MARKETPLACE_ENQUIRY_WHATSAPP || '').replace(/[^\d]/g, '');
  const waText = encodeURIComponent(`Bula - enquiry ref ${enquiry.enquiry_reference}. Dates: ${enquiry.travel_dates || 'not specified'}. Party: ${enquiry.party_size || 'not specified'}. Arrival: ${enquiry.hotel_or_arrival_point || 'not specified'}. ${enquiry.unresolved_questions || ''}`);
  return c.redirect(`https://wa.me/${waNumber}?text=${waText}`, 302);
});

// FINAL INTEGRATION REVIEW, Phase 1 item 3: cleanup for the one authorized QA write smoke test.
//   - 404 outside the QA environment (not even a 503 that confirms the route exists at all).
//   - requires the same full HMAC auth as every other QA write (a run id header alone is not
//     enough here either - the previous version's only gate).
//   - hardcoded to DEAL_EXCHANGE_QA_DB ONLY - no parameter can redirect this at the real preview
//     database, by construction (there is no other D1 binding even referenced in this handler).
//   - deletes by exact enquiry_reference (bounded - never a blanket wipe), AND only when that
//     reference belongs to the SAME run id making the request (one run cannot clean another run).
//   - returns the post-delete residue count for the caller's own zero-residue assertion.
dealExchangeUi.post('/internal/qa-cleanup', async c => {
  if (!c.env.DEAL_EXCHANGE_QA_DB || c.env.QA_TEST_MODE !== 'true') return c.notFound();
  const runId = c.req.header(QA_RUN_ID_HEADER);
  const auth = await verifyQaAuth(c, runId || undefined);
  if (!auth.ok) return c.json({ error: auth.reason }, 401);
  const body = await c.req.json().catch(() => ({}));
  const reference = String(body.reference || '');
  if (!reference || !/^VKV-[A-Z0-9]{6}$/.test(reference)) return c.json({ error: 'invalid or missing reference' }, 400);
  const owned = await c.env.DEAL_EXCHANGE_QA_DB.prepare(
    `SELECT 1 FROM deal_exchange_enquiries WHERE enquiry_reference=? AND unresolved_questions LIKE ?`
  ).bind(reference, `%[qa:${runId}]%`).first();
  if (!owned) {
    const existsAtAll = await c.env.DEAL_EXCHANGE_QA_DB.prepare('SELECT 1 FROM deal_exchange_enquiries WHERE enquiry_reference=?').bind(reference).first();
    if (existsAtAll) return c.json({ error: 'reference does not belong to this run id' }, 403);
    // Reference genuinely doesn't exist (already cleaned, or never created) - a no-op delete
    // below is safe and lets the caller's zero-residue assertion still pass.
  }
  await c.env.DEAL_EXCHANGE_QA_DB.prepare('DELETE FROM deal_exchange_enquiries WHERE enquiry_reference=?').bind(reference).run();
  const residue = await c.env.DEAL_EXCHANGE_QA_DB.prepare('SELECT COUNT(*) n FROM deal_exchange_enquiries WHERE enquiry_reference=?').bind(reference).first<any>();
  const totalResidue = await c.env.DEAL_EXCHANGE_QA_DB.prepare('SELECT COUNT(*) n FROM deal_exchange_enquiries').first<any>();
  return c.json({ deleted: true, reference, residueForReference: residue?.n ?? -1, totalQaResidue: totalResidue?.n ?? -1 });
});

// --- Natural-language intent (item 12) -------------------------------------------------------
dealExchangeUi.post('/search-intent', async c => {
  const body = await c.req.parseBody();
  const parsed = parseNaturalLanguageIntent(String(body.text || ''));
  const params = new URLSearchParams();
  if (parsed.filters.travelMonth) params.set('month', String(parsed.filters.travelMonth));
  if (parsed.filters.travelYear) params.set('year', String(parsed.filters.travelYear));
  if (parsed.filters.region) params.set('region', parsed.filters.region);
  if (parsed.filters.category) params.set('category', parsed.filters.category);
  if (parsed.filters.audience) params.set('audience', parsed.filters.audience);
  return c.redirect(`/live-deals?${params.toString()}`);
});

// --- Attributed outbound routing (item 10) -----------------------------------------------------
dealExchangeUi.get('/go/deal/:id', async c => {
  const db = c.env.DEAL_EXCHANGE_DB!;
  const id = c.req.param('id');
  const o = await db.prepare(`SELECT * FROM deal_exchange_offers WHERE id=? AND publication_decision='ELIGIBLE'`).bind(id).first<any>();
  if (!o) return c.notFound();
  const action = determineOfferAction(o.offer_owner_type, o.seller_name, o.booking_route);
  let destination: string;
  if (o.offer_owner_type === 'VAKAVITI_BOOKABLE') destination = o.booking_route || 'https://fijitourtransfers.com';
  else destination = o.booking_route || o.canonical_source_url;
  const idempotencyKey = `deal:${id}:${c.req.header('cf-connecting-ip') || 'anon'}:${new Date().toISOString().slice(0, 13)}`;
  await recordOutboundClick(db, {
    sourceSite: 'vakaviti-live-deal-exchange', sourcePage: `/live-deals/${id}`, campaign: null, queryRef: c.req.query('ref') || null,
    providerId: o.provider_id, productId: null, dealId: id, sellerId: o.seller_id, enquiryId: null,
    fulfilmentRoute: action.actionType, outboundDestination: destination, idempotencyKey,
  });
  return c.redirect(destination, 302);
});
