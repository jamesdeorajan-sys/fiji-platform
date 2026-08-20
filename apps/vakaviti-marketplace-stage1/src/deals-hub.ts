import { Hono } from 'hono';
import { isPubliclyEligible } from './deals';

// Vakaviti Live Fiji Deals - P1 Part C/D: the mobile-first public hub. Server-rendered, zero
// client JS (matching this app's site-wide pattern), noindex throughout (preview infrastructure,
// no branded domain yet - see src/index.ts's own noindex discipline). Every route here queries
// through isPubliclyEligible() (src/deals.ts) - the same deterministic gate the admin approval
// flow and the JSON preview API both use - so "what's shown here" and "what's eligible" can
// never drift apart into two different implementations of the same rule.

type Bindings = { DB: D1Database };
export const dealsHub = new Hono<{ Bindings: Bindings }>();

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const BASE_URL = 'https://vakaviti-marketplace-stage1.helpronline.workers.dev';

async function getEligibleDeals(db: D1Database): Promise<any[]> {
  const rows = await db.prepare(
    `SELECT c.*, s.source_approval_status, s.content_fingerprint AS current_source_fingerprint
     FROM deal_offer_candidates c JOIN deal_sources s ON c.source_id = s.id
     WHERE c.review_status = 'PUBLISHED'`
  ).all<any>();
  return (rows.results || []).filter(isPubliclyEligible);
}

const logEvent = (db: D1Database, eventType: string, fields: any = {}) =>
  db.prepare(`INSERT INTO deal_analytics_events (id, event_type, offer_id, category, place, query, metadata_json) VALUES (?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), eventType, fields.offer_id ?? null, fields.category ?? null, fields.place ?? null, fields.query ?? null, fields.metadata ? JSON.stringify(fields.metadata) : null).run();

const shell = (body: string, opts: { title: string; description: string; canonical: string; jsonLd?: any[] }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="${esc(opts.canonical)}">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(opts.canonical)}">
${(opts.jsonLd || []).map(obj => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`).join('\n')}
<style>
:root{--ink:#12231b;--muted:#607068;--line:#dde5e0;--bg:#f6f8f7;--accent:#0f6e6a}
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:var(--bg);color:var(--ink);-webkit-text-size-adjust:100%;padding-bottom:env(safe-area-inset-bottom)}
a{color:inherit}
header{position:sticky;top:0;z-index:20;background:rgba(246,248,247,.96);backdrop-filter:blur(6px);border-bottom:1px solid var(--line);padding:10px 16px}
.header-row{display:flex;justify-content:space-between;align-items:center;max-width:900px;margin:auto}
header a.brand{font-weight:800;text-decoration:none;font-size:16px}
.chips{display:flex;gap:8px;overflow-x:auto;padding:10px 16px;position:sticky;top:45px;z-index:19;background:var(--bg);border-bottom:1px solid var(--line);-webkit-overflow-scrolling:touch}
.chips a{white-space:nowrap;font-size:13px;padding:9px 14px;border-radius:999px;background:#fff;border:1px solid var(--line);text-decoration:none;color:var(--ink);min-height:36px;display:flex;align-items:center}
.chips a.active{background:var(--ink);color:#fff;border-color:var(--ink)}
main{max-width:900px;margin:auto;padding:16px}
h1{font-size:clamp(1.3rem,4vw,1.7rem);margin:6px 0 4px}
.lede{color:var(--muted);font-size:14px;margin:0 0 14px;max-width:60ch}
.search{width:100%;padding:13px 14px;border:1px solid var(--line);border-radius:12px;font-size:16px;min-height:44px;margin-bottom:12px}
.deal-grid{display:grid;grid-template-columns:1fr;gap:14px}
@media (min-width:640px){.deal-grid{grid-template-columns:1fr 1fr}}
@media (min-width:960px){.deal-grid{grid-template-columns:1fr 1fr 1fr}}
.deal-card{display:block;text-decoration:none;color:inherit;background:#fff;border:1px solid var(--line);border-radius:16px;overflow:hidden}
.deal-card .img{aspect-ratio:16/10;background:linear-gradient(135deg,#0f6e6a,#12231b);display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:600;padding:12px;text-align:center}
.deal-card img{width:100%;height:100%;object-fit:cover;display:block}
.deal-body{padding:14px}
.deal-body h3{margin:0 0 4px;font-size:16px}
.price-row{display:flex;align-items:baseline;gap:8px;margin:8px 0}
.price{font-weight:800;font-size:18px}
.deal-meta{font-size:12px;color:var(--muted);margin:2px 0}
.badge{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:#e9f5f0;color:var(--accent);margin-top:6px}
.empty{text-align:center;padding:60px 20px;color:var(--muted)}
.empty h2{color:var(--ink);font-size:18px}
.btn{display:block;text-align:center;background:var(--ink);color:#fff;text-decoration:none;padding:14px 18px;border-radius:12px;font-weight:700;font-size:15px;min-height:44px}
.btn.secondary{background:#fff;color:var(--ink);border:1px solid var(--ink)}
.sticky-cta{position:sticky;bottom:0;background:linear-gradient(180deg,rgba(246,248,247,0),#f6f8f7 25%);padding:14px 16px calc(16px + env(safe-area-inset-bottom));margin-top:16px}
.fact-table{width:100%;border-collapse:collapse;margin:14px 0}
.fact-table td{padding:8px 0;border-top:1px solid var(--line);font-size:14px;vertical-align:top}
.fact-table td:first-child{color:var(--muted);width:40%;padding-right:10px}
footer{max-width:900px;margin:24px auto;padding:20px 16px;color:var(--muted);font-size:12px}
a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
</style></head>
<body>
<header><div class="header-row"><a class="brand" href="/deals">Vakaviti · Live Fiji Deals</a><a href="/" class="muted" style="font-size:13px;text-decoration:none">Main site</a></div></header>
${body}
<footer><p>Vakaviti Deal Intelligence preview. Every deal shown has passed human review and provider approval, and is checked for freshness on an ongoing schedule. This is not a booking confirmation - enquire to check live availability.</p></footer>
</body></html>`;

const CATEGORIES = ['ACCOMMODATION', 'ACTIVITY', 'DINING', 'TRANSPORT', 'EXPERIENCE', 'CRUISE'];

function categoryChips(active?: string, activePlace?: string) {
  const cats = CATEGORIES.map(cat => `<a class="${cat === active ? 'active' : ''}" href="/deals/category/${cat.toLowerCase()}">${esc(cat.charAt(0) + cat.slice(1).toLowerCase())}</a>`).join('');
  return `<div class="chips"><a class="${!active && !activePlace ? 'active' : ''}" href="/deals">All deals</a>${cats}</div>`;
}

function dealCard(d: any): string {
  const priceText = d.advertised_price ? `${esc(d.currency || '')} ${esc(d.advertised_price)}${d.price_basis ? ' / ' + esc(d.price_basis.replace(/_/g, ' ').toLowerCase()) : ''}` : 'Quote required';
  const savingText = (d.explicit_discount) ? esc(d.explicit_discount) : null;
  return `<a class="deal-card" href="/deals/${esc(d.slug)}">
    <div class="img">${esc(d.fiji_location || d.seller_or_marketer || 'Fiji')}</div>
    <div class="deal-body">
      <h3>${esc(d.proposed_offer_name)}</h3>
      <p class="deal-meta">${esc(d.seller_or_marketer)} · ${esc(d.fiji_location)}</p>
      <div class="price-row"><span class="price">${priceText}</span>${savingText ? `<span class="deal-meta">${savingText}</span>` : ''}</div>
      ${d.booking_deadline ? `<p class="deal-meta">Book by ${esc(d.booking_deadline)}</p>` : ''}
      <p class="deal-meta">Last checked ${esc((d.source_checked_at || '').slice(0, 10))}</p>
      <span class="badge">Vakaviti reviewed &amp; approved</span>
    </div>
  </a>`;
}

function emptyState(context: string): string {
  return `<div class="empty">
    <h2>No live deals ${esc(context)} right now</h2>
    <p>We only publish an offer once a human at Vakaviti has reviewed the evidence and the provider has approved it. New deals are added as they clear that review.</p>
    <a class="btn secondary" href="/deals" style="max-width:260px;margin:16px auto 0">Browse all Fiji deals</a>
  </div>`;
}

// --- /deals - the hub -------------------------------------------------------------------------

dealsHub.get('/', async c => {
  const q = (c.req.query('q') || '').trim();
  let deals = await getEligibleDeals(c.env.DB);
  if (q) deals = deals.filter(d => `${d.proposed_offer_name} ${d.factual_summary} ${d.fiji_location} ${d.category}`.toLowerCase().includes(q.toLowerCase()));
  await logEvent(c.env.DB, deals.length ? 'HUB_VIEW' : 'NO_RESULTS_QUERY', { query: q || null });

  const cards = deals.map(dealCard).join('');
  const body = `
${categoryChips()}
<main>
  <h1>Live Fiji Deals &amp; Special Offers</h1>
  <p class="lede">Real, current offers from Fiji tour and accommodation providers - each checked, evidenced and human-approved before it appears here. Nothing here is invented or auto-published.</p>
  <form method="GET" action="/deals" role="search"><input class="search" type="search" name="q" value="${esc(q)}" placeholder="Search deals, e.g. Yasawa, diving, family" aria-label="Search deals"></form>
  <div class="deal-grid">${cards}</div>
  ${deals.length === 0 ? emptyState(q ? `matching "${esc(q)}"` : '') : ''}
</main>`;
  return c.html(shell(body, {
    title: 'Live Fiji Deals & Special Offers | Vakaviti',
    description: 'Current, human-reviewed Fiji travel deals from real providers - checked for freshness, never invented.',
    canonical: `${BASE_URL}/deals`,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Live Fiji Deals', item: `${BASE_URL}/deals` }] }]
  }));
});

// --- /deals/category/:categorySlug and /deals/location/:placeSlug -----------------------------

dealsHub.get('/category/:categorySlug', async c => {
  const categorySlug = c.req.param('categorySlug').toUpperCase();
  const deals = (await getEligibleDeals(c.env.DB)).filter(d => (d.category || '').toUpperCase() === categorySlug);
  await logEvent(c.env.DB, deals.length ? 'FILTER' : 'NO_RESULTS_QUERY', { category: categorySlug });
  const label = categorySlug.charAt(0) + categorySlug.slice(1).toLowerCase();
  const body = `
${categoryChips(categorySlug)}
<main>
  <h1>${esc(label)} deals in Fiji</h1>
  <p class="lede">Human-reviewed ${esc(label.toLowerCase())} offers currently available from Fiji providers.</p>
  <div class="deal-grid">${deals.map(dealCard).join('')}</div>
  ${deals.length === 0 ? emptyState(`in ${esc(label)}`) : ''}
</main>`;
  return c.html(shell(body, {
    title: `${label} Deals in Fiji | Vakaviti`,
    description: `Current human-reviewed ${label.toLowerCase()} deals from real Fiji providers.`,
    canonical: `${BASE_URL}/deals/category/${c.req.param('categorySlug')}`,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Live Fiji Deals', item: `${BASE_URL}/deals` },
      { '@type': 'ListItem', position: 2, name: label, item: `${BASE_URL}/deals/category/${c.req.param('categorySlug')}` }
    ] }]
  }));
});

dealsHub.get('/location/:placeSlug', async c => {
  const placeSlug = c.req.param('placeSlug');
  const placeQuery = placeSlug.replace(/-/g, ' ');
  const deals = (await getEligibleDeals(c.env.DB)).filter(d => (d.fiji_location || '').toLowerCase().includes(placeQuery.toLowerCase()));
  await logEvent(c.env.DB, deals.length ? 'FILTER' : 'NO_RESULTS_QUERY', { place: placeSlug });
  const label = placeQuery.replace(/\b\w/g, ch => ch.toUpperCase());
  const body = `
${categoryChips(undefined, placeSlug)}
<main>
  <h1>Fiji deals in ${esc(label)}</h1>
  <p class="lede">Human-reviewed offers currently available in ${esc(label)}.</p>
  <div class="deal-grid">${deals.map(dealCard).join('')}</div>
  ${deals.length === 0 ? emptyState(`in ${esc(label)}`) : ''}
</main>`;
  return c.html(shell(body, {
    title: `Fiji Deals in ${label} | Vakaviti`,
    description: `Current human-reviewed deals in ${label}, Fiji.`,
    canonical: `${BASE_URL}/deals/location/${placeSlug}`,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Live Fiji Deals', item: `${BASE_URL}/deals` },
      { '@type': 'ListItem', position: 2, name: label, item: `${BASE_URL}/deals/location/${placeSlug}` }
    ] }]
  }));
});

// --- sitemap: only currently-eligible deals, recomputed on every request - an ineligible offer
// disappears from it on the very next fetch, no rebuild/cache to wait for. Registered BEFORE
// the '/:offerSlug' wildcard below - a static route registered after a same-depth ':param'
// wildcard gets swallowed by it instead of matching on its own (found and fixed once already,
// Pilot 6D-A's '/types' vs '/:id' - applying that lesson here from the start rather than
// re-discovering it live). -------------------------------------------------------------------

dealsHub.get('/sitemap.xml', async c => {
  const deals = await getEligibleDeals(c.env.DB);
  const urls = [`${BASE_URL}/deals`, ...deals.map(d => `${BASE_URL}/deals/${d.slug}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${esc(u)}</loc></url>`).join('')}</urlset>`;
  return c.text(xml, 200, { 'Content-Type': 'application/xml' });
});

// --- /deals/:offerSlug - detail page -------------------------------------------------------

dealsHub.get('/:offerSlug', async c => {
  const slug = c.req.param('offerSlug');
  const row = await c.env.DB.prepare(
    `SELECT c.*, s.source_approval_status, s.content_fingerprint AS current_source_fingerprint
     FROM deal_offer_candidates c JOIN deal_sources s ON c.source_id = s.id
     WHERE c.slug = ? AND c.review_status = 'PUBLISHED'`
  ).bind(slug).first<any>();
  if (!row || !isPubliclyEligible(row)) {
    await logEvent(c.env.DB, 'EXPIRED_OFFER_ENCOUNTER', { metadata: { slug } });
    return c.notFound();
  }
  await logEvent(c.env.DB, 'DEAL_OPENED', { offer_id: row.id, category: row.category, place: row.fiji_location });

  const priceText = row.advertised_price ? `${esc(row.currency || '')} ${esc(row.advertised_price)}${row.price_basis ? ' / ' + esc(row.price_basis.replace(/_/g, ' ').toLowerCase()) : ''}` : 'Quote required';
  const factRow = (label: string, value: any) => value ? `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>` : '';

  const allDeals = await getEligibleDeals(c.env.DB);
  const related = allDeals.filter(d => d.id !== row.id && (d.category === row.category || d.fiji_location === row.fiji_location)).slice(0, 3);

  const jsonLd: any[] = [
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Live Fiji Deals', item: `${BASE_URL}/deals` },
      { '@type': 'ListItem', position: 2, name: row.proposed_offer_name, item: `${BASE_URL}/deals/${slug}` }
    ] },
    {
      '@context': 'https://schema.org', '@type': 'Product', name: row.proposed_offer_name, description: row.factual_summary,
      brand: { '@type': 'Organization', name: row.seller_or_marketer },
      ...(row.advertised_price ? { offers: { '@type': 'Offer', price: row.advertised_price, priceCurrency: row.currency || 'FJD', availability: 'https://schema.org/InStock', url: `${BASE_URL}/deals/${slug}` } } : {})
    }
  ];

  const body = `
<main>
  <p><a href="/deals" class="lede" style="text-decoration:none">&larr; All Fiji deals</a></p>
  <h1>${esc(row.proposed_offer_name)}</h1>
  <p class="lede">${esc(row.seller_or_marketer)} · ${esc(row.fiji_location)}</p>
  <p>${esc(row.factual_summary)}</p>
  <table class="fact-table">
    ${factRow('Seller / marketer', row.seller_or_marketer)}
    ${factRow('Fulfilled by', row.fulfilment_operator)}
    ${factRow('Location', row.fiji_location)}
    ${factRow('Category', row.category)}
    ${factRow('Booking deadline', row.booking_deadline)}
    ${factRow('Travel window', [row.travel_from, row.travel_until].filter(Boolean).join(' → '))}
    ${factRow('Inclusions', row.inclusions)}
    ${factRow('Exclusions', row.exclusions)}
    ${factRow('Restrictions', row.eligibility)}
    ${factRow('Blackout dates', row.blackout_dates)}
    ${factRow('Cancellation terms', row.cancellation_terms)}
    ${factRow('Last checked', row.source_checked_at)}
    ${factRow('Source', `<a href="${esc(row.source_url)}" target="_blank" rel="noopener nofollow">${esc(row.source_url)}</a>`)}
  </table>
  <p class="lede">Reviewed and approved by Vakaviti. An enquiry below is not a confirmed booking - availability is subject to the provider.</p>
  ${related.length ? `<h2 style="font-size:16px">Related deals</h2><div class="deal-grid">${related.map(dealCard).join('')}</div>` : ''}
</main>
<div class="sticky-cta">
  <a class="btn" href="/deals/${esc(slug)}/enquire">${row.advertised_price ? esc(priceText) + ' · ' : ''}Ask Vakaviti about this deal</a>
  <p class="lede" style="text-align:center;margin:8px 0 0">An enquiry is not a confirmed booking.</p>
</div>`;
  return c.html(shell(body, {
    title: `${row.proposed_offer_name} | Vakaviti Live Fiji Deals`,
    description: (row.factual_summary || '').slice(0, 155),
    canonical: `${BASE_URL}/deals/${slug}`,
    jsonLd
  }));
});

// --- Enquiry route: server-rendered redirect, own table (deal_enquiries), duplicate-tap guard --

dealsHub.get('/:offerSlug/enquire', async c => {
  const slug = c.req.param('offerSlug');
  const row = await c.env.DB.prepare(
    `SELECT c.*, s.content_fingerprint AS current_source_fingerprint, s.source_approval_status
     FROM deal_offer_candidates c JOIN deal_sources s ON c.source_id = s.id
     WHERE c.slug = ? AND c.review_status = 'PUBLISHED'`
  ).bind(slug).first<any>();
  if (!row || !isPubliclyEligible(row)) return c.notFound();

  const referrer = c.req.header('referer') || null;
  // Duplicate-tap guard: skip inserting a new row if an identical one (same offer + referrer)
  // was created in the last 10 seconds - a plain server-rendered link has no client-side way to
  // disable itself after one tap, so this is the achievable equivalent without adding JS.
  const recent = await c.env.DB.prepare(
    `SELECT id FROM deal_enquiries WHERE offer_candidate_id=? AND (referrer IS ? OR referrer = ?) AND created_at > datetime('now', '-10 seconds') LIMIT 1`
  ).bind(row.id, referrer, referrer).first<any>();
  if (!recent) {
    await c.env.DB.prepare(`INSERT INTO deal_enquiries (id, offer_candidate_id, channel, source_page, referrer) VALUES (?,?,?,?,?)`)
      .bind(crypto.randomUUID(), row.id, 'WHATSAPP', c.req.path, referrer).run();
    await logEvent(c.env.DB, 'ENQUIRY_CREATED', { offer_id: row.id, category: row.category, place: row.fiji_location });
  }
  await logEvent(c.env.DB, 'CTA_SELECTED', { offer_id: row.id });

  const body = `<main class="empty"><h1 style="font-size:20px">Thanks - your enquiry is on its way</h1>
  <p>Vakaviti will help connect your enquiry about <strong>${esc(row.proposed_offer_name)}</strong> with ${esc(row.seller_or_marketer)}. This is not a confirmed booking.</p>
  <a class="btn secondary" href="/deals/${esc(slug)}" style="max-width:260px;margin:16px auto 0">Back to this deal</a></main>`;
  return c.html(shell(body, { title: 'Enquiry sent | Vakaviti', description: 'Enquiry confirmation.', canonical: `${BASE_URL}/deals/${slug}/enquire` }));
});
