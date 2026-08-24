import { Hono } from 'hono';
import { candidates } from './candidates';
import { products } from './products';
import { places } from './places';
import { deals, dealsPublic } from './deals';
import { dealsAdminUi } from './deals-admin-ui';
import { dealsHub } from './deals-hub';
import { runDailyDiscovery } from './deal-agent';
import { providerOnboarding } from './provider-onboarding';
import { providerOnboardingUi } from './provider-onboarding-ui';
import { supplyDashboard } from './supply-dashboard';
import { batchReviewUi } from './batch-review-ui';
import { supplySprintUi } from './supply-sprint-ui';
import { runSupplyBootstrap, runPhase2SupplyExpansion, runWave3SupplyExpansion, runFreshnessCheck, runClassBAutoPublishPass } from './supply-scheduler';
import { enrichCandidate, providerCopilot, createHumanGate } from './ai';

type Bindings = { DB: D1Database; AI: Ai; ENVIRONMENT: string; ADMIN_TOKEN?: string; MARKETPLACE_ENQUIRY_WHATSAPP?: string };

// Centralised Stage 1 enquiry-routing decision. This is a preview/testing routing rule only -
// it decides where the WhatsApp message goes, it never touches an operator's own stored
// contact in D1. In preview, every enquiry routes to the configured Stage 1 test destination
// regardless of which operator/product is displayed. A future production routing policy
// (e.g. routing directly to the operator) is intentionally NOT assumed here - it needs its
// own explicit decision and configuration later. Fails closed (returns null) rather than
// guessing if the expected configuration is missing, so a misconfigured deploy can never
// silently send a customer somewhere unintended.
const resolveEnquiryDestination = (env: Bindings): string | null => {
  if (env.ENVIRONMENT === 'preview') {
    return env.MARKETPLACE_ENQUIRY_WHATSAPP || null;
  }
  return null;
};
const app = new Hono<{ Bindings: Bindings }>();

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const waLink = (phone: string, message: string) => {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
};

const PRICING_UNIT_LABEL: Record<string, string> = {
  PER_NIGHT: '/night',
  PER_PERSON_PER_DAY: '/person/day',
  PER_PERSON: '/person',
  PER_GROUP: '/group',
  PER_HOUR: '/hour'
};

const priceLabel = (offer: { amount_minor?: number | null; currency?: string | null; pricing_basis?: string | null } | null | undefined) => {
  if (!offer || !offer.amount_minor) return 'Contact for price';
  const amount = (Number(offer.amount_minor) / 100).toFixed(0);
  const unit = (offer.pricing_basis && PRICING_UNIT_LABEL[offer.pricing_basis]) || '';
  return `From ${offer.currency || 'FJD'} ${amount}${unit}`;
};

const durationLabel = (minutes: number | null | undefined) => {
  if (!minutes) return null;
  const m = Number(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
};

// Deterministic small hash so repeated fallback SVGs on one page never collide on gradient ids.
const idFor = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return 'g' + h.toString(36);
};

// Original, generated placeholder art (no third-party imagery). Used wherever a real,
// rights-cleared image_url has not yet been supplied. Never intended to look like a photo.
const fallbackMedia = (label: string, opts: { aspect?: string; radius?: string; seed?: string } = {}) => {
  const aspect = opts.aspect || '16/9';
  const radius = opts.radius || '14px 14px 0 0';
  const seed = opts.seed || label || 'x';
  const gid = idFor(seed);
  const initial = (label || '?').trim().charAt(0).toUpperCase() || '?';
  return `<svg viewBox="0 0 400 225" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(label)} — photo coming soon" style="width:100%;aspect-ratio:${aspect};display:block;border-radius:${radius}">
<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#134a3f"/><stop offset="100%" stop-color="#0c2b23"/></linearGradient></defs>
<rect width="400" height="225" fill="url(#${gid})"/>
<path d="M0 172 Q100 150 200 168 T400 158 V225 H0 Z" fill="#ffffff" opacity="0.06"/>
<path d="M0 198 Q100 182 200 195 T400 188 V225 H0 Z" fill="#ffffff" opacity="0.09"/>
<text x="50%" y="48%" font-family="system-ui,sans-serif" font-size="42" font-weight="700" fill="#ffffff" fill-opacity="0.85" text-anchor="middle" dominant-baseline="middle">${esc(initial)}</text>
</svg>`;
};

const mediaBlock = (imageUrl: string | null | undefined, alt: string, opts: { aspect?: string; radius?: string; seed?: string; eager?: boolean } = {}) => {
  const aspect = opts.aspect || '16/9';
  const radius = opts.radius || '14px 14px 0 0';
  if (imageUrl) {
    const loading = opts.eager ? 'eager' : 'lazy';
    const fp = opts.eager ? ' fetchpriority="high"' : '';
    return `<img src="${esc(imageUrl)}" alt="${esc(alt)}" loading="${loading}"${fp} style="width:100%;aspect-ratio:${aspect};object-fit:cover;border-radius:${radius};display:block;background:#0c2b23">`;
  }
  return fallbackMedia(alt, { aspect, radius, seed: opts.seed });
};

// Semantic Fiji image registry (Stage 1 Build Accuracy System, 2026-08-19). Every entry is a
// real, licensed, source-verified photo (see IMAGE-SOURCES.md) with a defined semantic purpose
// and permitted/prohibited uses documented there. A photo is only ever assigned to a
// product/operator via the explicit maps below (PRODUCT_IMAGE_KEY / OPERATOR_IMAGE_KEY) - never
// inferred from a blind category lookup, so every assignment is an individually-reviewed,
// truthful decision. Nothing here is presented as depicting a specific operator's actual
// vehicle, room, staff or dive site - these are all generic Fiji destination/semantic context.
// An operator/product's own authorized image_url from D1 always takes priority - see
// resolveImage() below.
const SEMANTIC_IMAGES: Record<string, { url: string; alt: string }> = {
  hero: { url: '/images/hero-fiji-leleuvia.webp', alt: 'Aerial view of Leleuvia Island, Fiji' },
  islands: { url: '/images/category-islands-ocean.webp', alt: 'Fiji islands seen from above' },
  yasawa_transfer: { url: '/images/category-adventure.webp', alt: 'Boat at Kuata, Yasawa Islands, Fiji, before a dive' },
  diving: { url: '/images/category-diving.webp', alt: 'Crown-of-thorns starfish on the seabed, Warwick, Fiji' },
  nadi_denarau: { url: '/images/context-denarau-marina.webp', alt: 'Denarau Island Marina, Fiji' },
  road_transfer: { url: '/images/context-road-transfer.webp', alt: 'Cars on a tree-lined road, Suva, Fiji' },
  accommodation: { url: '/images/category-accommodation.webp', alt: 'Poolside at a Fiji resort' },
  wedding: { url: '/images/category-wedding.webp', alt: 'Beach wedding arch and chairs, Nadi, Fiji' },
  day_tour: { url: '/images/category-daytour.webp', alt: 'Beach and boat at sunrise, Kuata Island, Fiji' },
  partners: { url: '/images/category-islands-ocean.webp', alt: 'Fiji islands seen from above' }
};

// Explicit, product-by-product image decisions. A product with NO entry here intentionally
// renders the premium branded fallback rather than an unreviewed guess (see resolveImage()) -
// "truthful fallback" beats "irrelevant photograph." Add an entry only after confirming the
// assigned photo's documented permitted use genuinely covers this specific product; do not
// add an entry just to fill the rectangle. Every assignment must also pass the Traveller
// Expectation Test (see IMAGE-SOURCES.md): if a traveller saw only this image and the product
// title, would it strengthen their understanding of this exact experience?
//
// 2026-08-19 Visual Truth Correction Pass: the previous 'airport_transfer' key
// (context-arrival-sky.webp, a flight/sky photo) failed the Traveller Expectation Test - it
// read as generic sky/sunset, not transport, and was assigned to all 3 airport-route products
// identically. It has been retired from active assignment (asset kept, unused - see
// IMAGE-SOURCES.md). The 'nadi_denarau' marina photo was also removed from every Nadi Airport
// Transfers product, since none of them involve marina/boat transport - a marina photo may only
// represent a marina/boat-transfer context, never generic road transfers, per the new rule.
const PRODUCT_IMAGE_KEY: Record<string, string> = {
  'blue-lagoon-accommodation-enquiry': 'accommodation',
  'blue-lagoon-diving-enquiry': 'diving',
  'blue-lagoon-island-transfer-enquiry': 'yasawa_transfer',
  'blue-lagoon-wedding-enquiry': 'wedding',
  // blue-lagoon-dining-enquiry: no source-verified matching Fiji dining/food photo found after
  //   searching Unsplash and Pexels - branded fallback (see IMAGE-SOURCES.md rejected list)
  'denarau-nadi-airport-transfer': 'road_transfer',
  'nadi-airport-denarau-transfer': 'road_transfer'
  // nadi-airport-nadi-hotels-transfer, private-fiji-transfer-enquiry, private-hotel-transfer:
  //   deliberately left on branded fallback rather than reuse road_transfer a 3rd/4th/5th time
  //   on the same operator's product list - "stop repetitive image assignment" takes priority
  //   over forcing a 3rd share of one photo. The 2 products above share road_transfer only
  //   because they are literally the same physical route in opposite directions.
};

// Explicit per-operator image decision (deliberately not inferred from a region-string match -
// only 2 operators exist, so an explicit, auditable assignment is safer than pattern-matching).
const OPERATOR_IMAGE_KEY: Record<string, string> = {
  'nadi-airport-transfers': 'nadi_denarau',
  'blue-lagoon-beach-resort': 'yasawa_transfer'
};

// Priority order used everywhere on the site (never "some Fiji image is better than no
// image"): (1) the operator/product's own authorized image_url from D1, (2) an explicitly
// assigned, permitted-use semantic photo, (3) the generated branded fallback (handled by
// mediaBlock itself when url is null). A missing semantic assignment is a deliberate truthful
// fallback, not a bug - never a broken or misleading image.
const resolveImage = (ownUrl: string | null | undefined, semanticKey: string | null | undefined, ownAlt: string): { url: string | null; alt: string } => {
  if (ownUrl) return { url: ownUrl, alt: ownAlt };
  const ctx = semanticKey ? SEMANTIC_IMAGES[semanticKey] : null;
  if (ctx) return { url: ctx.url, alt: ctx.alt };
  return { url: null, alt: ownAlt };
};


const FAVICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#12231b"/><text x="32" y="45" font-family="system-ui,sans-serif" font-size="34" font-weight="700" fill="#ffffff" text-anchor="middle">V</text></svg>');

// Must be an absolute URL - OG/social crawlers do not resolve relative image paths.
// Update this one line when a branded production domain replaces the preview URL.
const SITE_ORIGIN = 'https://vakaviti-marketplace-stage1.helpronline.workers.dev';
const OG_IMAGE_PATH = `${SITE_ORIGIN}/images/og-image.jpg`;

// OG/social crawlers need an absolute URL - a real operator/product image_url is normally
// already absolute (external), but our own /images/... context photos are site-relative.
const absoluteImage = (url: string | null | undefined): string | null => {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `${SITE_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
};

type PageOpts = { title?: string; description?: string; ogImage?: string | null; noindex?: boolean };

const html = (body: string, opts: PageOpts = {}) => {
  const title = opts.title ? opts.title : 'Vakaviti Verified Fiji Network';
  const description = opts.description || 'Find trusted Fiji tours, activities and ground transport, and connect directly with local operators.';
  const robots = opts.noindex === false ? 'index,follow' : 'noindex,follow';
  const ogImage = opts.ogImage || OG_IMAGE_PATH;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${robots}">
<link rel="icon" href="${FAVICON}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:image" content="${esc(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<style>
:root{--ink:#12231b;--muted:#607068;--line:#dde5e0;--bg:#f6f8f7;--accent:#0f6e6a}
body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:var(--bg);color:var(--ink)}
header,main{max-width:1100px;margin:auto;padding:20px 24px}
header{display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:rgba(246,248,247,.92);backdrop-filter:blur(6px);z-index:10}
header nav a{color:var(--ink);text-decoration:none;font-size:14px;margin-left:14px}
.eyebrow{display:inline-block;letter-spacing:.06em;text-transform:uppercase;font-size:12px;font-weight:700;color:var(--accent);margin-bottom:10px}
.hero-wrap{padding:28px 0 8px}
.hero-grid{display:grid;grid-template-columns:1.1fr 1fr;gap:32px;align-items:center}
.hero-media{border-radius:24px;overflow:hidden;aspect-ratio:16/11;box-shadow:0 20px 50px -20px rgba(15,40,30,.4);position:relative}
.hero-media .loc-badge{position:absolute;left:16px;bottom:16px;background:rgba(12,35,27,.55);color:#fff;padding:6px 12px;border-radius:999px;font-size:12px;backdrop-filter:blur(3px)}
h1{font-size:clamp(2.1rem,4.4vw,3.4rem);line-height:1.04;margin:0 0 16px;letter-spacing:-.01em}
.muted{color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px}
.section{padding:40px 0}
.section h2{font-size:clamp(1.5rem,2.6vw,2rem);margin:0 0 6px}
.card{background:white;border:1px solid var(--line);border-radius:18px;overflow:hidden}
.card-body{padding:16px}
.badge{display:inline-block;border:1px solid #b7c8be;border-radius:999px;padding:5px 10px;font-size:12px;background:#fff}
.badge.verified{background:#e9f5f0;border-color:#a9d9c6;color:#0f6e6a;font-weight:600}
.badge.soon{background:#f1f1ef;color:#8a938d}
.trust-tag{display:block;margin-top:8px;font-size:11px;color:var(--muted)}
.trust-tag.verified{display:inline-block;border:1px solid #a9d9c6;background:#e9f5f0;color:#0f6e6a;font-weight:600;border-radius:999px;padding:4px 9px}
.btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;background:var(--ink);color:white;text-decoration:none;padding:13px 20px;border-radius:12px;font-weight:700;min-height:44px;min-width:44px}
.btn.secondary{background:white;color:var(--ink);border:1px solid var(--ink)}
.btn.whatsapp{background:#128c7e}
a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.cta-row{display:flex;flex-wrap:wrap;gap:12px;margin-top:8px}
.cat-card{position:relative;border-radius:16px;overflow:hidden;min-height:150px;display:flex;align-items:flex-end;padding:14px;color:#fff;text-decoration:none}
.cat-card .fill{position:absolute;inset:0;z-index:0}
.cat-card .label{position:relative;z-index:1}
.cat-card .label strong{display:block;font-size:16px}
.cat-card .label span{font-size:12px;opacity:.85}
input,textarea{width:100%;padding:12px;border:1px solid #ccd7d1;border-radius:10px;box-sizing:border-box;margin:6px 0 14px;font-size:16px}
footer{max-width:1100px;margin:40px auto;padding:24px;color:var(--muted)}
footer p{margin:4px 0}
footer a{color:var(--muted)}
.wa-sticky{position:sticky;bottom:0;background:linear-gradient(180deg,rgba(246,248,247,0),#f6f8f7 30%);padding:14px 0 18px;margin-top:10px}
@media (max-width:820px){.hero-grid{grid-template-columns:1fr}.hero-media{aspect-ratio:16/10}}
</style></head><body><header><strong><a href="/" style="color:inherit;text-decoration:none">Vakaviti</a></strong><nav><a href="/experiences">Experiences</a><a href="/operators">Operators</a><a href="/partners">Partners</a></nav></header><main>${body}</main><footer><p>Stage 1 preview — public discovery does not equal Vakaviti verification.</p><p><a href="/about">About</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a> &middot; <a href="/contact">Contact</a></p></footer></body></html>`;
};

const requireAdmin = (c: any) => {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) return c.json({ error: 'admin_api_not_configured' }, 503);
  const auth = c.req.header('authorization') || '';
  if (auth !== `Bearer ${expected}`) return c.json({ error: 'unauthorized' }, 401);
  return null;
};

app.notFound(c => c.html(html(`<section class="section" style="padding-top:20px">
  <div class="hero-media" style="aspect-ratio:21/9;margin-bottom:20px">${mediaBlock(SEMANTIC_IMAGES.hero.url, SEMANTIC_IMAGES.hero.alt, { aspect: '21/9', radius: '20px' })}</div>
  <span class="badge">404</span><h1>Looks like this path doesn't reach Fiji.</h1><p class="muted">The page you're looking for doesn't exist or may have moved.</p><p class="cta-row"><a class="btn" href="/experiences">Explore Fiji</a> <a class="btn secondary" href="/">Go home</a></p><p class="muted">Looking for something specific? <a href="/contact">Contact support</a>.</p></section>`, { title: 'Page not found — Vakaviti', noindex: true }), 404));

// OG_IMAGE_PATH (/images/og-image.jpg) is now served directly by Workers Static Assets
// from public/images/ - a real composited photo, replacing the earlier generated SVG.

app.get('/', async c => {
  const featuredProducts = await c.env.DB.prepare(`SELECT p.id,p.canonical_name,p.slug,p.image_url,p.verification_status,o.canonical_name as operator_name,o.slug as operator_slug,o.locality,o.region,of.amount_minor,of.currency,of.pricing_basis FROM products p JOIN operators o ON o.id=p.operator_id LEFT JOIN offers of ON of.product_id=p.id AND of.active=1 WHERE p.commercial_status='ACTIVE' AND o.commercial_status='ACTIVE' ORDER BY p.created_at ASC LIMIT 3`).all<any>();
  const featuredOperators = await c.env.DB.prepare(`SELECT o.id,o.canonical_name,o.slug,o.locality,o.region,o.verification_status,o.image_url,COUNT(p.id) as product_count FROM operators o LEFT JOIN products p ON p.operator_id=o.id AND p.commercial_status='ACTIVE' WHERE o.commercial_status='ACTIVE' GROUP BY o.id ORDER BY o.canonical_name LIMIT 3`).all<any>();

  const expCards = (featuredProducts.results || []).map((p: any) => { const img = resolveImage(p.image_url, PRODUCT_IMAGE_KEY[p.slug], `${p.canonical_name} — ${p.operator_name}`); const verified = p.verification_status === 'VAKAVITI_VERIFIED'; return `<article class="card"><a href="/experiences/${esc(p.slug)}" style="text-decoration:none;color:inherit">${mediaBlock(img.url, img.alt, { seed: p.id })}<div class="card-body"><h3 style="margin:0 0 2px">${esc(p.canonical_name)}</h3><p class="muted" style="margin:0 0 8px">${esc(p.operator_name)} &middot; ${esc([p.locality, p.region].filter(Boolean).join(', ') || 'Fiji')}</p><p class="muted" style="margin:0;font-weight:600;color:var(--ink)">${priceLabel({ amount_minor: p.amount_minor, currency: p.currency, pricing_basis: p.pricing_basis })}</p><span class="trust-tag${verified ? ' verified' : ''}">${verified ? '✓ Vakaviti Verified' : 'Not yet verified'}</span></div></a></article>`; }).join('');
  const opCards = (featuredOperators.results || []).map((o: any) => { const img = resolveImage(o.image_url, OPERATOR_IMAGE_KEY[o.slug], o.canonical_name); const verified = o.verification_status === 'VAKAVITI_VERIFIED'; return `<article class="card"><a href="/operators/${esc(o.slug)}" style="text-decoration:none;color:inherit">${mediaBlock(img.url, img.alt, { seed: o.id })}<div class="card-body"><h3 style="margin:0 0 2px">${esc(o.canonical_name)}</h3><p class="muted" style="margin:0 0 8px">${esc([o.locality, o.region].filter(Boolean).join(', ') || 'Fiji')}</p><p class="muted" style="margin:0">${o.product_count} experience${o.product_count === 1 ? '' : 's'}</p><span class="trust-tag${verified ? ' verified' : ''}">${verified ? '✓ Vakaviti Verified' : 'Publicly listed'}</span></div></a></article>`; }).join('');

  // All 6 categories now have an intentional visual treatment - either a source-verified Fiji
  // photo (4 of 6) or a documented, deliberate branded gradient fallback (Waterfalls & nature,
  // Cultural experiences - see IMAGE-SOURCES.md for the specific rejected candidates and why).
  const categories = [
    { label: 'Transfers', ctx: 'Airport & point-to-point', href: '/experiences', from: '#134a3f', to: '#0c2b23', img: SEMANTIC_IMAGES.road_transfer.url, alt: SEMANTIC_IMAGES.road_transfer.alt, available: true },
    { label: 'Island experiences', ctx: 'Coming soon', href: null, from: '#0f6e6a', to: '#0a3c39', img: SEMANTIC_IMAGES.islands.url, alt: SEMANTIC_IMAGES.islands.alt, available: false },
    { label: 'Waterfalls & nature', ctx: 'Coming soon', href: null, from: '#1c5c3f', to: '#0c2b23', img: null, alt: '', available: false },
    { label: 'Cultural experiences', ctx: 'Coming soon', href: null, from: '#7a4a1c', to: '#3d2510', img: null, alt: '', available: false },
    { label: 'Adventure', ctx: 'Coming soon', href: null, from: '#2a4d6e', to: '#12283d', img: SEMANTIC_IMAGES.yasawa_transfer.url, alt: SEMANTIC_IMAGES.yasawa_transfer.alt, available: false },
    { label: 'Day tours', ctx: 'Coming soon', href: null, from: '#5c3d6e', to: '#291a33', img: SEMANTIC_IMAGES.day_tour.url, alt: SEMANTIC_IMAGES.day_tour.alt, available: false }
  ];
  const catCards = categories.map(cat => {
    const fill = cat.img
      ? `<img class="fill" src="${cat.img}" alt="${esc(cat.alt)}" loading="lazy" style="width:100%;height:100%;object-fit:cover">`
      : `<span class="fill" style="background:linear-gradient(135deg,${cat.from},${cat.to})"></span>`;
    const scrim = cat.img ? `<span class="fill" style="background:linear-gradient(0deg,rgba(0,0,0,.55),rgba(0,0,0,.05) 60%)"></span>` : '';
    const inner = `${fill}${scrim}<span class="label"><strong>${esc(cat.label)}</strong><span>${esc(cat.ctx)}</span></span>${cat.available ? '' : '<span class="badge soon" style="position:absolute;top:12px;right:12px;z-index:1">Coming soon</span>'}`;
    return cat.available
      ? `<a class="cat-card" href="${cat.href}">${inner}</a>`
      : `<div class="cat-card" style="cursor:default">${inner}</div>`;
  }).join('');

  return c.html(html(`
<section class="hero-wrap"><div class="hero-grid">
  <div><span class="eyebrow">Fiji Operator Graph</span><h1>Fiji tourism operators, structured in one trusted place.</h1><p class="muted">Every listing shows its current Vakaviti verification status. Some businesses are published while verification is still in progress — ask on WhatsApp and get connected to the right local operator.</p><div class="cta-row"><a class="btn" href="/experiences">Explore Fiji experiences</a><a class="btn secondary" href="/operators">Meet local operators</a></div></div>
  <div class="hero-media"><img src="/images/hero-fiji-leleuvia.webp" alt="Aerial view of Leleuvia Island, Fiji" loading="eager" fetchpriority="high" style="width:100%;height:100%;object-fit:cover;display:block"><span class="loc-badge">Leleuvia Island, Fiji</span></div>
</div></section>

<section class="section"><h2>Why Vakaviti</h2><div class="grid">
  <div class="card"><div class="card-body"><h3>See who you're asking</h3><p class="muted">"Vakaviti Verified" means Vakaviti has completed an evidence-backed review. "Not yet verified" means it hasn't — but a business can still be listed and reachable while that review is in progress. Publication and verification are shown separately, so you always know which one you're looking at.</p></div></div>
  <div class="card"><div class="card-body"><h3>Ask on WhatsApp</h3><p class="muted">No account, no forms — tap through to WhatsApp and Vakaviti will connect your enquiry with the right local operator.</p></div></div>
  <div class="card"><div class="card-body"><h3>Built for Fiji</h3><p class="muted">Local tours, activities and ground transport, discovered and structured for travellers planning a trip to Fiji.</p></div></div>
</div></section>

${expCards ? `<section class="section"><h2>Featured experiences</h2><p class="muted">Real Fiji services, ready to enquire about today.</p><div class="grid">${expCards}</div></section>` : ''}
${opCards ? `<section class="section"><h2>Local operators</h2><div class="grid">${opCards}</div></section>` : ''}

<section class="section"><h2>Explore Fiji</h2><p class="muted">Browse by category — more experiences are being added as operators join.</p><div class="grid">${catCards}</div></section>

<section class="section" style="text-align:center;color:#fff;border-radius:24px;padding:0;position:relative;overflow:hidden"><img src="${SEMANTIC_IMAGES.hero.url}" alt="" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0"><span style="position:absolute;inset:0;background:linear-gradient(160deg,rgba(9,30,23,.88),rgba(15,42,32,.82));z-index:0"></span><div style="position:relative;z-index:1;padding:56px 24px"><h2 style="color:#fff">Ready to plan your Fiji trip?</h2><p style="opacity:.9;max-width:520px;margin:0 auto 20px">Browse real experiences or reach out directly — or if you run a Fiji tour, activity or transport business, join as a Founding Partner.</p><div class="cta-row" style="justify-content:center"><a class="btn" style="background:#fff;color:#12231b" href="/experiences">Explore Fiji</a><a class="btn secondary" style="border-color:#fff;color:#fff" href="/partners">Become a Vakaviti partner</a></div></div></section>
`, { title: 'Vakaviti — Find trusted Fiji experiences', description: 'Find trusted Fiji tours, activities and ground transport, and connect directly with local operators on WhatsApp.', noindex: true }));
});

app.get('/partners', c => c.html(html(`<section class="section" style="padding-top:20px">
  <div class="hero-media" style="aspect-ratio:21/9;margin-bottom:20px">${mediaBlock(SEMANTIC_IMAGES.partners.url, SEMANTIC_IMAGES.partners.alt, { aspect: '21/9', radius: '20px', eager: true })}</div>
  <span class="badge">Founding Partner Program</span><h1>Put your Fiji experience in front of travellers.</h1><p class="muted">Vakaviti is a directory and enquiry channel for Fiji tourism operators. We list your business, travellers find you, and their questions get connected through to you — you stay in full control of price, availability and the booking itself.</p></section><section class="grid"><div class="card"><div class="card-body"><h3>What does it cost?</h3><p class="muted">No setup fee and no monthly fee for founding partners while the program is in preview. Final commercial terms will be confirmed with you directly before anything is charged.</p></div></div><div class="card"><div class="card-body"><h3>How does Vakaviti make money?</h3><p class="muted">Through a share of confirmed bookings once commercial terms are agreed with you — not a forced software subscription.</p></div></div><div class="card"><div class="card-body"><h3>What do you control?</h3><p class="muted">Your prices, availability, policies and identity. Nothing about your business goes live as "verified" without you confirming it first.</p></div></div><div class="card"><div class="card-body"><h3>What information is needed?</h3><p class="muted">Your business name, a WhatsApp number for enquiries, your service area, a short description, and at least one experience or service with a price (or "contact for price").</p></div></div><div class="card"><div class="card-body"><h3>What happens after you apply?</h3><p class="muted">We follow up directly by WhatsApp or email to confirm your details and prepare your public profile before it goes live.</p></div></div><div class="card"><div class="card-body"><h3>How are enquiries delivered?</h3><p class="muted">During this preview, traveller enquiries route through the Vakaviti team first, who pass them on to you with full details of what the traveller asked about — not yet a direct real-time connection to your own WhatsApp.</p></div></div></section><section class="section"><h2>Claim or add your business</h2><form method="post" action="/api/partner-interest"><label>Business name</label><input name="business" autocomplete="organization" required><label>Your name</label><input name="name" autocomplete="name" required><label>Phone / WhatsApp</label><input name="phone" type="tel" autocomplete="tel" required><label>Email</label><input name="email" type="email" autocomplete="email"><label>Website or Facebook page</label><input name="url" autocomplete="url"><button class="btn" type="submit">Start my profile</button></form><p class="muted">Prefer email? Write to <a href="mailto:helpronline@gmail.com">helpronline@gmail.com</a>.</p></section>`, { title: 'Become a Vakaviti Founding Partner', description: 'Join Vakaviti as a Founding Partner — no setup fee, keep control of your prices and bookings, get enquiries by WhatsApp.' })));

app.get('/experiences', async c => {
  const rows = await c.env.DB.prepare(`SELECT p.id,p.canonical_name,p.slug,p.category,p.duration_minutes,p.verification_status,p.image_url,o.canonical_name as operator_name,o.slug as operator_slug,o.locality,o.region,of.amount_minor,of.currency,of.pricing_basis FROM products p JOIN operators o ON o.id=p.operator_id LEFT JOIN offers of ON of.product_id=p.id AND of.active=1 WHERE p.commercial_status='ACTIVE' AND o.commercial_status='ACTIVE' ORDER BY p.canonical_name LIMIT 100`).all<any>();
  const cards = (rows.results || []).map((p: any) => { const img = resolveImage(p.image_url, PRODUCT_IMAGE_KEY[p.slug], `${p.canonical_name} — ${p.operator_name}`); const verified = p.verification_status === 'VAKAVITI_VERIFIED'; return `<article class="card"><a href="/experiences/${esc(p.slug)}" style="text-decoration:none;color:inherit">${mediaBlock(img.url, img.alt, { seed: p.id })}<div class="card-body"><h3 style="margin:0 0 4px">${esc(p.canonical_name)}</h3><p class="muted" style="margin:0 0 6px">${esc(p.operator_name)} &middot; ${esc([p.locality, p.region].filter(Boolean).join(', ') || 'Fiji')}</p><p class="muted" style="margin:0;font-weight:600;color:var(--ink)">${priceLabel({ amount_minor: p.amount_minor, currency: p.currency, pricing_basis: p.pricing_basis })}${durationLabel(p.duration_minutes) ? ' &middot; ' + durationLabel(p.duration_minutes) : ''}</p><span class="trust-tag${verified ? ' verified' : ''}">${verified ? '✓ Vakaviti Verified' : 'Not yet verified'}</span></div></a></article>`; }).join('');
  return c.html(html(`<section class="section"><span class="badge">Experiences</span><h1>Fiji tours, activities and transport.</h1><p class="muted">Browse real Fiji experiences and ask Vakaviti on WhatsApp — we'll connect your enquiry with the right operator.</p></section><div class="grid">${cards || '<div class="card"><div class="card-body">No experiences published yet. Check back soon.</div></div>'}</div>`, { title: 'Fiji Experiences — Vakaviti', description: 'Browse verified Fiji tours, activities and ground transport, and ask Vakaviti on WhatsApp to connect with local operators.', noindex: true }));
});

app.get('/experiences/:slug', async c => {
  // Fail closed: a product is only publicly reachable when both it and its parent operator are
  // commercial_status='ACTIVE'. An inactive parent hides its products even if a product row is
  // itself (accidentally) ACTIVE - checked again below via the operator lookup's own filter.
  const p = await c.env.DB.prepare(`SELECT * FROM products WHERE slug=? AND commercial_status='ACTIVE'`).bind(c.req.param('slug')).first<any>();
  if (!p) return c.notFound();
  const o = await c.env.DB.prepare(`SELECT * FROM operators WHERE id=? AND commercial_status='ACTIVE'`).bind(p.operator_id).first<any>();
  if (!o) return c.notFound();
  const offer = await c.env.DB.prepare(`SELECT * FROM offers WHERE product_id=? AND active=1 ORDER BY source_observed_at DESC LIMIT 1`).bind(p.id).first<any>();
  const verified = p.verification_status === 'VAKAVITI_VERIFIED';
  const enquireHref = `/enquire/${esc(o.slug)}?product=${esc(p.slug)}`;
  const facts = [
    { label: 'Price', value: priceLabel(offer) },
    durationLabel(p.duration_minutes) ? { label: 'Duration', value: durationLabel(p.duration_minutes) } : null,
    offer?.pickup_policy ? { label: 'Pickup', value: offer.pickup_policy } : null,
    offer?.cancellation_policy ? { label: 'Cancellation', value: offer.cancellation_policy } : null
  ].filter(Boolean) as { label: string; value: string }[];
  const semanticKey = PRODUCT_IMAGE_KEY[p.slug];
  const heroImg = resolveImage(p.image_url, semanticKey, `${p.canonical_name} — ${o.canonical_name}`);
  // A second, complementary photo - only shown when the hero itself resolved to a real,
  // explicitly-assigned semantic photo (never pair a second photo onto the branded fallback,
  // and never invent a pairing for a product with no verified match).
  const SUPPORTING_KEY: Record<string, string> = { islands: 'yasawa_transfer', yasawa_transfer: 'islands', diving: 'islands', accommodation: 'islands', wedding: 'islands', day_tour: 'yasawa_transfer', road_transfer: 'nadi_denarau', nadi_denarau: 'road_transfer' };
  const supportingKey = !p.image_url && semanticKey ? SUPPORTING_KEY[semanticKey] : null;
  const supportingImg = supportingKey ? SEMANTIC_IMAGES[supportingKey] : null;
  return c.html(html(`<section class="section" style="padding-top:20px">
    <div class="hero-media" style="aspect-ratio:21/9;margin-bottom:20px">${mediaBlock(heroImg.url, heroImg.alt, { aspect: '21/9', radius: '20px', seed: p.id, eager: true })}<span class="loc-badge">${esc([o.locality, o.region].filter(Boolean).join(', ') || 'Fiji')}</span></div>
    <span class="badge${verified ? ' verified' : ''}">${verified ? '✓ Vakaviti Verified' : 'Publicly listed — not yet verified'}</span>
    <h1>${esc(p.canonical_name)}</h1>
    <p class="muted">${esc(o.canonical_name)} &middot; ${esc([o.locality, o.region].filter(Boolean).join(', ') || 'Fiji')}</p>
    ${p.description ? `<p>${esc(p.description)}</p>` : ''}
    <div class="grid">${facts.map(f => `<div class="card"><div class="card-body"><h3 style="margin:0 0 6px;font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)">${esc(f.label)}</h3><p style="margin:0;font-weight:600">${esc(f.value)}</p></div></div>`).join('')}</div>
    <p class="muted">Operated by ${esc(o.canonical_name)}. ${verified ? 'Identity and details verified by Vakaviti.' : 'This listing is publicly discovered and has not yet been verified by Vakaviti — confirm details directly with the operator.'}</p>
    ${supportingImg ? `<div style="margin:20px 0;border-radius:16px;overflow:hidden">${mediaBlock(supportingImg.url, supportingImg.alt, { aspect: '16/7', radius: '16px' })}</div>` : ''}
    <div class="wa-sticky"><a class="btn whatsapp" href="${enquireHref}" style="width:100%;text-align:center;box-sizing:border-box;display:block">Ask Vakaviti on WhatsApp</a><p class="muted" style="margin:8px 0 0;font-size:13px">Vakaviti will help connect your enquiry with the right local operator.</p></div>
    <p><a class="btn secondary" href="/operators/${esc(o.slug)}">View operator</a></p>
  </section>`, { title: `${p.canonical_name} — Vakaviti`, description: `${p.canonical_name} with ${o.canonical_name} in Fiji. ${priceLabel(offer)}.`, ogImage: absoluteImage(p.image_url || heroImg.url), noindex: true }));
});

app.get('/operators', async c => {
  // P1.3A: claim_status is deliberately NOT selected here - claim status is an internal/
  // administration-only concept (see PUBLIC CLAIM-STATUS POLICY) and must never reach a guest
  // page, not even indirectly via conditional text. Pilot Partner status is derived live from
  // whether an unrevoked CEO confirmation exists - never cached, never inferred from claim state.
  const rows = await c.env.DB.prepare(`SELECT o.id,o.canonical_name,o.slug,o.locality,o.region,o.verification_status,o.image_url,o.last_public_check_at,COUNT(p.id) as product_count,(SELECT COUNT(*) FROM provider_ceo_confirmations pc WHERE pc.operator_id=o.id AND pc.revoked_at IS NULL) as pilot_partner_count FROM operators o LEFT JOIN products p ON p.operator_id=o.id AND p.commercial_status='ACTIVE' WHERE o.commercial_status='ACTIVE' GROUP BY o.id ORDER BY o.canonical_name LIMIT 100`).all<any>();
  // P1.3D: last_public_check_at is set ONLY by the AI-discovered-directory-listing promotion path
  // (src/candidates.ts promoteCandidateToDirectoryListing) - its presence, not a new column, is
  // what distinguishes an AI-discovered listing from any other non-Pilot-Partner operator here.
  const cards = (rows.results || []).map((o: any) => { const img = resolveImage(o.image_url, OPERATOR_IMAGE_KEY[o.slug], o.canonical_name); const verified = o.verification_status === 'VAKAVITI_VERIFIED'; const pilotPartner = Number(o.pilot_partner_count) > 0; const aiDiscovered = !verified && !pilotPartner && !!o.last_public_check_at; const trustLabel = verified ? '✓ Vakaviti Verified' : pilotPartner ? '✓ Vakaviti Pilot Partner' : aiDiscovered ? 'Vakaviti-discovered' : 'Publicly listed'; return `<article class="card"><a href="/operators/${esc(o.slug)}" style="text-decoration:none;color:inherit">${mediaBlock(img.url, img.alt, { seed: o.id })}<div class="card-body"><h3 style="margin:0 0 4px">${esc(o.canonical_name)}</h3><p class="muted" style="margin:0 0 6px">${esc([o.locality, o.region].filter(Boolean).join(', ') || 'Fiji')}</p><p class="muted" style="margin:0">${o.product_count} experience${o.product_count === 1 ? '' : 's'}</p><span class="trust-tag${verified ? ' verified' : ''}">${trustLabel}</span></div></a></article>`; }).join('');
  return c.html(html(`<section class="section"><span class="badge">Fiji Operator Graph</span><h1>Fiji tourism operators, structured in one place.</h1><p class="muted">Publicly listed means we found public evidence the operator exists. It does not mean identity, licences, prices, availability or products have been verified by Vakaviti.</p></section><div class="grid">${cards || '<div class="card"><div class="card-body">No operators imported yet. Candidate collection is the next stage.</div></div>'}</div>`, { title: 'Fiji Tourism Operators — Vakaviti', noindex: true }));
});

app.get('/operators/:slug', async c => {
  // Fail closed: an inactive operator is not publicly reachable at all, regardless of its own
  // products' individual commercial_status.
  const o = await c.env.DB.prepare(`SELECT * FROM operators WHERE slug=? AND commercial_status='ACTIVE'`).bind(c.req.param('slug')).first<any>();
  if (!o) return c.notFound();
  const productRows = await c.env.DB.prepare(`SELECT id,canonical_name,slug,category,verification_status,image_url FROM products WHERE operator_id=? AND commercial_status='ACTIVE' ORDER BY canonical_name`).bind(o.id).all<any>();
  const verified = o.verification_status === 'VAKAVITI_VERIFIED';
  // P1.3A: Pilot Partner status is derived live from an unrevoked CEO confirmation - claim_status
  // is never read on this page at all (see PUBLIC CLAIM-STATUS POLICY - claim status stays
  // internal-only). "Claimed"/"unclaimed" text is never shown to guests.
  const pilotPartnerRow = await c.env.DB.prepare(`SELECT 1 FROM provider_ceo_confirmations WHERE operator_id=? AND revoked_at IS NULL LIMIT 1`).bind(o.id).first<any>();
  const pilotPartner = !!pilotPartnerRow;
  // P1.3D: AI-discovered directory listings (Path A) are distinguished purely by
  // last_public_check_at being set - see promoteCandidateToDirectoryListing() in
  // src/candidates.ts, the only code path that stamps it. This is never shown for Pilot Partners
  // or Vakaviti Verified operators, and never implies partnership, verification, or endorsement.
  const aiDiscovered = !verified && !pilotPartner && !!o.last_public_check_at;
  const status = verified ? '✓ Vakaviti Verified' : pilotPartner ? '✓ Vakaviti Pilot Partner' : aiDiscovered ? 'Vakaviti-discovered Fiji provider' : 'Publicly listed — information not yet verified by Vakaviti';
  const lastCheckedDate = aiDiscovered && o.last_public_check_at ? new Date(o.last_public_check_at).toLocaleDateString('en-FJ', { year: 'numeric', month: 'long', day: 'numeric' }) : null;
  const list = (productRows.results || []).map((p: any) => { const img = resolveImage(p.image_url, PRODUCT_IMAGE_KEY[p.slug], `${p.canonical_name} — ${o.canonical_name}`); const pverified = p.verification_status === 'VAKAVITI_VERIFIED'; return `<a href="/experiences/${esc(p.slug)}" style="text-decoration:none;color:inherit"><article class="card">${mediaBlock(img.url, img.alt, { aspect: '4/3', seed: p.id })}<div class="card-body"><h3 style="margin:0 0 4px">${esc(p.canonical_name)}</h3><span class="trust-tag${pverified ? ' verified' : ''}">${pverified ? '✓ Verified' : 'Not yet verified'}</span></div></article></a>`; }).join('');
  const enquireHref = `/enquire/${esc(o.slug)}`;
  const opHeroImg = resolveImage(o.image_url, OPERATOR_IMAGE_KEY[o.slug], o.canonical_name);
  return c.html(html(`<section class="section">
    <div class="hero-media" style="aspect-ratio:21/9;margin-bottom:20px">${mediaBlock(opHeroImg.url, opHeroImg.alt, { aspect: '21/9', radius: '20px', seed: o.id, eager: true })}<span class="loc-badge">${esc([o.locality, o.region].filter(Boolean).join(', ') || 'Fiji')}</span></div>
    <span class="badge${verified ? ' verified' : ''}">${status}</span>
    <h1>${esc(o.canonical_name)}</h1>
    <p class="muted">${esc([o.locality, o.region].filter(Boolean).join(', ') || 'Fiji')}</p>
    ${aiDiscovered ? `<p class="muted" style="font-size:13px">Information sourced from the provider's official website and last checked on ${esc(lastCheckedDate || '')}.</p>` : ''}
    ${o.description ? `<p>${esc(o.description)}</p>` : ''}
    <div class="cta-row"><a class="btn secondary" href="/claim/${esc(o.slug)}">${aiDiscovered ? 'Claim this business or report incorrect information' : 'Claim or manage this business'}</a></div>
    ${resolveEnquiryDestination(c.env) ? `<div class="wa-sticky"><a class="btn whatsapp" href="${enquireHref}" style="width:100%;text-align:center;box-sizing:border-box;display:flex">${aiDiscovered ? 'Ask Vakaviti about this provider' : 'Ask Vakaviti on WhatsApp'}</a><p class="muted" style="margin:8px 0 0;font-size:13px">Vakaviti will help connect your enquiry with the right local operator.</p></div>` : ''}
  </section>
  <section class="section"><h2>Experiences</h2><div class="grid">${list || '<div class="card"><div class="card-body">No verified products yet.</div></div>'}</div></section>`, { title: `${o.canonical_name} — Vakaviti`, description: `${o.canonical_name}, ${[o.locality, o.region].filter(Boolean).join(', ') || 'Fiji'} — Fiji tourism operator on Vakaviti.`, ogImage: absoluteImage(o.image_url || opHeroImg.url), noindex: true }));
});

app.get('/enquire/:operatorSlug', async c => {
  // Fail closed: an inactive operator must not accept enquiries either - the publication gate
  // covers the commercial action, not just the listing pages that link to it.
  const operator = await c.env.DB.prepare(`SELECT id,canonical_name,slug,whatsapp FROM operators WHERE slug=? AND commercial_status='ACTIVE'`).bind(c.req.param('operatorSlug')).first<any>();
  if (!operator) return c.notFound();
  const productSlug = c.req.query('product');
  let product: any = null;
  if (productSlug) {
    const candidate = await c.env.DB.prepare(`SELECT id,canonical_name,slug,operator_id FROM products WHERE slug=? AND commercial_status='ACTIVE'`).bind(productSlug).first<any>();
    if (candidate && candidate.operator_id === operator.id) product = candidate;
  }
  // Supply Wave 3 (2026-08-24) fix: this used to gate on operator.whatsapp being set, which
  // blocked every enquiry for an AI-discovered operator whose source page had no WhatsApp
  // number (discovery-bridge.ts correctly never guesses one) - even though
  // resolveEnquiryDestination() below already provides a real, working destination (the
  // Vakaviti team's own number) in preview mode regardless of the operator's own contact
  // fields. The check below is now the single source of truth for whether an enquiry can be
  // sent at all, matching its own documented fail-closed behavior for production.
  const destination = resolveEnquiryDestination(c.env);
  if (!destination) {
    return c.html(html(`<section class="section"><h1>Enquiries aren't available right now</h1><p class="muted">Something's missing in our setup and we don't want to risk sending your enquiry to the wrong place. Please try again shortly, or <a href="/contact">contact Vakaviti support</a> directly.</p></section>`, { title: 'Enquiry unavailable', noindex: true }), 503);
  }
  const id = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO enquiries(id,operator_id,product_id,channel,source_page,referrer,status) VALUES(?,?,?, 'WHATSAPP', ?, ?, 'SENT')`)
    .bind(id, operator.id, product ? product.id : null, c.req.path, c.req.header('referer') || null).run();
  const messageLines = ['Vakaviti enquiry', `Operator: ${operator.canonical_name}`];
  if (product) messageLines.push(`Experience: ${product.canonical_name}`);
  messageLines.push('Source: Vakaviti', "Hi, I'm interested in this Fiji experience — can you help me with availability and pricing?", `Reference: ${id}`);
  return c.redirect(waLink(destination, messageLines.join('\n')), 302);
});

app.get('/claim/:slug', async c => {
  const o = await c.env.DB.prepare(`SELECT id,canonical_name,slug FROM operators WHERE slug=?`).bind(c.req.param('slug')).first<any>();
  if (!o) return c.notFound();
  return c.html(html(`<section class="section"><span class="badge">Business claim</span><h1>Claim ${esc(o.canonical_name)}</h1><p class="muted">Claiming a profile does not automatically create Vakaviti Verified status. Verification happens separately.</p><form method="post" action="/api/claim"><input type="hidden" name="operator_id" value="${esc(o.id)}"><label>Your name</label><input name="name" autocomplete="name" required><label>Email</label><input name="email" type="email" autocomplete="email"><label>Phone / WhatsApp</label><input name="phone" type="tel" autocomplete="tel" required><button class="btn" type="submit">Submit claim</button></form></section>`, { title: `Claim ${o.canonical_name} — Vakaviti`, noindex: true }));
});

app.post('/api/claim', async c => {
  const body = await c.req.parseBody();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO claims(id,operator_id,claimant_name,claimant_email,claimant_phone,channel) VALUES(?,?,?,?,?,'WEB')`).bind(id,String(body.operator_id),String(body.name||''),String(body.email||''),String(body.phone||'')).run();
  const sessionId = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO provider_copilot_sessions(id,operator_id,claimant_phone,claimant_email) VALUES(?,?,?,?)`).bind(sessionId,String(body.operator_id),String(body.phone||''),String(body.email||'')).run();
  return c.html(html(`<section class="section"><h1>Claim received.</h1><p>Reference: ${esc(id)}</p><p class="muted">We have opened an onboarding copilot session so we can ask only for missing information. The profile remains unverified until evidence review is completed.</p><a class="btn" href="/operators">Back to operators</a></section>`, { noindex: true }));
});

app.post('/api/partner-interest', async c => {
  const body = await c.req.parseBody();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO evidence(id,entity_type,entity_id,field_name,source_type,source_url,observed_value,evidence_status,confidence) VALUES(?,?,?,?,?,?,?,?,?)`).bind(id,'PARTNER_LEAD',id,'interest','SELF_SUBMITTED',String(body.url||''),JSON.stringify(body),'CANDIDATE',1).run();
  return c.html(html(`<section class="section"><h1>Founding Partner interest received.</h1><p>Reference: ${esc(id)}</p><p class="muted">Next step is AI-assisted candidate enrichment and verification, not automatic publication.</p><a class="btn" href="/">Return home</a></section>`, { noindex: true }));
});

app.get('/about', c => c.html(html(`<section class="section" style="padding-top:20px">
  <div class="hero-media" style="aspect-ratio:21/9;margin-bottom:20px">${mediaBlock(SEMANTIC_IMAGES.hero.url, SEMANTIC_IMAGES.hero.alt, { aspect: '21/9', radius: '20px', eager: true })}</div>
  <span class="badge">About</span><h1>What Vakaviti is — and isn't.</h1></section><div class="grid"><div class="card"><div class="card-body"><h3>What we are</h3><p class="muted">A directory that helps travellers find real Fiji tour, activity and ground transport operators, and connects them directly with those operators.</p></div></div><div class="card"><div class="card-body"><h3>What "publicly listed" means</h3><p class="muted">We found public evidence an operator exists. It does not mean we have verified identity, licences, prices or availability.</p></div></div><div class="card"><div class="card-body"><h3>What "Vakaviti Verified" means</h3><p class="muted">A human at Vakaviti has reviewed and confirmed the operator's identity and key facts. Verified status is never automatic and is never granted by AI alone.</p></div></div><div class="card"><div class="card-body"><h3>How enquiries work today</h3><p class="muted">During this preview, tapping "Ask Vakaviti on WhatsApp" opens a chat with Vakaviti, not the operator directly — we pass your enquiry on to the right local operator. The message always states which operator and experience you're asking about. Vakaviti does not currently process payments or confirm bookings — the operator handles your booking directly once connected.</p></div></div><div class="card"><div class="card-body"><h3>For operators</h3><p class="muted">Operators can join as a Founding Partner. See <a href="/partners">Become a Partner</a> for details.</p></div></div><div class="card"><div class="card-body"><h3>Questions?</h3><p class="muted">Reach us at <a href="mailto:helpronline@gmail.com">helpronline@gmail.com</a>.</p></div></div></div>`, { title: 'About Vakaviti', description: 'What Vakaviti is, what verification means, and how enquiries work.' })));

app.get('/privacy', c => c.html(html(`<section class="section" style="padding-top:20px">
  <div style="border-radius:16px;overflow:hidden;margin-bottom:20px">${mediaBlock(SEMANTIC_IMAGES.islands.url, SEMANTIC_IMAGES.islands.alt, { aspect: '21/5', radius: '16px' })}</div>
  <span class="badge">Preview</span><h1>Privacy</h1><p class="muted">This is a preview environment. A complete Privacy Policy will be published before public launch. In the meantime:</p></section><div class="grid"><div class="card"><div class="card-body"><p class="muted">Claim and Founding Partner forms collect the contact details you submit, used only to follow up with you.</p></div></div><div class="card"><div class="card-body"><p class="muted">Tapping a WhatsApp enquiry button records which listing and operator it relates to, and the time — not your personal details, which stay inside WhatsApp.</p></div></div><div class="card"><div class="card-body"><p class="muted">We do not sell your information.</p></div></div></div><p class="muted">Questions? Email <a href="mailto:helpronline@gmail.com">helpronline@gmail.com</a>.</p>`, { title: 'Privacy — Vakaviti', noindex: true })));

app.get('/terms', c => c.html(html(`<section class="section" style="padding-top:20px">
  <div style="border-radius:16px;overflow:hidden;margin-bottom:20px">${mediaBlock(SEMANTIC_IMAGES.yasawa_transfer.url, SEMANTIC_IMAGES.yasawa_transfer.alt, { aspect: '21/5', radius: '16px' })}</div>
  <span class="badge">Preview</span><h1>Terms</h1><p class="muted">This is a preview environment. Complete Terms of Service will be published before public launch. In the meantime:</p></section><div class="grid"><div class="card"><div class="card-body"><p class="muted">Vakaviti is a directory and enquiry channel. We do not currently process payments or confirm bookings — any booking is arranged directly between you and the operator.</p></div></div><div class="card"><div class="card-body"><p class="muted">"Publicly listed" is not the same as "verified." Check the badge on each listing before relying on any detail.</p></div></div><div class="card"><div class="card-body"><p class="muted">Operators are responsible for the accuracy of information they confirm, and for fulfilling any booking made with them.</p></div></div></div><p class="muted">Questions? Email <a href="mailto:helpronline@gmail.com">helpronline@gmail.com</a>.</p>`, { title: 'Terms — Vakaviti', noindex: true })));

app.get('/contact', c => c.html(html(`<section class="section" style="padding-top:20px">
  <div class="hero-media" style="aspect-ratio:21/9;margin-bottom:20px">${mediaBlock(SEMANTIC_IMAGES.islands.url, SEMANTIC_IMAGES.islands.alt, { aspect: '21/9', radius: '20px', eager: true })}</div>
  <span class="badge">Support</span><h1>Contact Vakaviti</h1><p class="muted">For travellers: use "Ask Vakaviti on WhatsApp" on any listing for the fastest response — during this preview, enquiries go to the Vakaviti team first, who connect you with the right operator.</p><p>For everything else, including operators wanting to join: <a href="mailto:helpronline@gmail.com">helpronline@gmail.com</a></p><p><a class="btn secondary" href="/partners">Become a Founding Partner</a></p></section>`, { title: 'Contact — Vakaviti' })));

app.post('/api/admin/ai/enrich-candidate', async c => {
  const denied = requireAdmin(c); if (denied) return denied;
  const body = await c.req.json<any>();
  if (!body?.candidate_id || !body?.canonical_name || !body?.source_text) return c.json({ error: 'candidate_id_canonical_name_source_text_required' }, 400);
  try {
    const result = await enrichCandidate(c.env, {
      candidate_id: String(body.candidate_id),
      canonical_name: String(body.canonical_name),
      source_text: String(body.source_text),
      source_url: body.source_url ? String(body.source_url) : undefined
    });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: 'ai_enrichment_failed', detail: String(err?.message || err) }, 500);
  }
});

app.post('/api/admin/ai/provider-copilot', async c => {
  const denied = requireAdmin(c); if (denied) return denied;
  const body = await c.req.json<any>();
  if (!body?.session_id || !body?.operator_name || !body?.provider_message) return c.json({ error: 'session_id_operator_name_provider_message_required' }, 400);
  const result = await providerCopilot(c.env, {
    session_id: String(body.session_id),
    operator_name: String(body.operator_name),
    current_step: String(body.current_step || 'IDENTITY'),
    verified_context: body.verified_context || {},
    candidate_context: body.candidate_context || {},
    provider_message: String(body.provider_message)
  });
  const outputText = JSON.stringify(result.output);
  if (outputText.includes('"needs_human_gate":true')) {
    await createHumanGate(c.env, { gate_type:'PROVIDER_COPILOT_EXCEPTION', entity_type:'PROVIDER_SESSION', entity_id:String(body.session_id), reason:'AI identified a trust/legal/money/verification boundary requiring human review.', evidence:result.output });
  }
  return c.json(result);
});

app.get('/api/admin/human-gates', async c => {
  const denied = requireAdmin(c); if (denied) return denied;
  const rows = await c.env.DB.prepare(`SELECT * FROM human_gates WHERE status='PENDING' ORDER BY created_at ASC LIMIT 100`).all<any>();
  return c.json({ results: rows.results || [] });
});

app.get('/api/admin/enquiries', async c => {
  const denied = requireAdmin(c); if (denied) return denied;
  const rows = await c.env.DB.prepare(`SELECT e.*, o.canonical_name as operator_name, p.canonical_name as product_name FROM enquiries e LEFT JOIN operators o ON o.id=e.operator_id LEFT JOIN products p ON p.id=e.product_id ORDER BY e.created_at DESC LIMIT 200`).all<any>();
  return c.json({ results: rows.results || [] });
});

// Human Verification Decision Engine (2026-08-19, Evidence Engine Pilot 5). This is the ONLY
// place in the codebase that may ever write 'VAKAVITI_VERIFIED' to operators.verification_status
// - not AI (src/products.ts's /digitise never has, and structurally cannot, since it only ever
// writes product_candidates), not promotion (src/candidates.ts's /:id/promote always forces
// NOT_VERIFIED), not publication. A verification decision here NEVER touches commercial_status -
// verification and publication remain fully independent dimensions, matching the law documented
// in EVIDENCE-AND-PROMOTION-GOVERNANCE.md: CEO_AUTHORIZATION != independent verification,
// AI_EXTRACTION != verification, and VAKAVITI_VERIFIED requires this explicit human decision.
const VERIFICATION_TRANSITIONS: Record<string, string[]> = {
  NOT_VERIFIED: ['VAKAVITI_VERIFIED'],
  VAKAVITI_VERIFIED: ['NOT_VERIFIED'], // revocation/correction
};

// P1 remediation (CEO-authorized): CEO_AUTHORIZATION is provenance, not independent
// verification, and AI-derived evidence can never independently qualify an operator either -
// both were already true in EVIDENCE-AND-PROMOTION-GOVERNANCE.md, but nothing previously
// enforced it at the code level. A grant must cite at least one evidence row whose source_type
// is neither CEO_AUTHORIZATION nor AI-derived. evidence.source_type is free text (no CHECK
// constraint exists), so this is a denylist against the two known-disqualifying patterns rather
// than an invented allowlist of new required values - it accepts any future legitimate source
// type (OPERATOR_CONFIRMED, registry/website-verified, etc.) without this endpoint needing to
// know its exact spelling in advance. As of this change, zero OPERATOR-entity evidence row in
// the live database qualifies (confirmed: every one is CEO_AUTHORIZATION) - so this correctly
// fails closed on every new grant attempt until real qualifying evidence exists, exactly as
// instructed, without a separate on/off switch.
const isDisqualifiedEvidenceSourceType = (sourceType: string): boolean => {
  const s = String(sourceType || '').toUpperCase();
  if (s === 'CEO_AUTHORIZATION') return true;
  if (/(^|_)AI(_|$)/.test(s)) return true; // e.g. AI_EXTRACTED, PRODUCT_AI_DIGITISE, bare "AI"
  return false;
};

app.post('/api/admin/operators/:id/verification', async c => {
  const denied = requireAdmin(c); if (denied) return denied;
  const id = c.req.param('id');
  const body = await c.req.json<any>().catch(() => ({}));

  const operator = await c.env.DB.prepare(`SELECT id,verification_status,commercial_status FROM operators WHERE id=?`).bind(id).first<any>();
  if (!operator) return c.json({ error: 'operator_not_found' }, 404);

  const targetState = String(body.verification_status || '');
  if (!['VAKAVITI_VERIFIED', 'NOT_VERIFIED'].includes(targetState)) {
    return c.json({ error: 'invalid_target_state', allowed: ['VAKAVITI_VERIFIED', 'NOT_VERIFIED'] }, 400);
  }
  const currentState = String(operator.verification_status);
  if (!(VERIFICATION_TRANSITIONS[currentState] || []).includes(targetState)) {
    return c.json({ error: 'invalid_transition', from: currentState, to: targetState }, 409);
  }

  const reason = String(body.reason || '').trim();
  if (!reason) return c.json({ error: 'reason_required' }, 400);
  const reviewer = String(body.reviewer || '').trim();
  if (!reviewer) return c.json({ error: 'reviewer_required' }, 400);

  // Granting verification requires a real evidence basis; revoking it does not (a human may
  // revoke on suspicion/reason alone - the absence of trust doesn't itself need evidence).
  const evidenceIds: string[] = Array.isArray(body.evidence_ids) ? body.evidence_ids.map(String) : [];
  if (targetState === 'VAKAVITI_VERIFIED' && evidenceIds.length === 0) {
    return c.json({ error: 'evidence_basis_required' }, 400);
  }
  if (evidenceIds.length) {
    const placeholders = evidenceIds.map(() => '?').join(',');
    const rows = await c.env.DB.prepare(`SELECT id,entity_type,entity_id,source_type FROM evidence WHERE id IN (${placeholders})`).bind(...evidenceIds).all<any>();
    const found = new Map((rows.results || []).map((r: any) => [r.id, r]));
    for (const eid of evidenceIds) {
      const row = found.get(eid);
      if (!row) return c.json({ error: 'evidence_not_found', evidence_id: eid }, 422);
      if (row.entity_type !== 'OPERATOR' || row.entity_id !== id) return c.json({ error: 'evidence_belongs_to_other_entity', evidence_id: eid }, 422);
    }
    // A grant (never a revoke) must cite at least one evidence row that is neither
    // CEO_AUTHORIZATION nor AI-derived - see isDisqualifiedEvidenceSourceType above. Checked
    // before any write, so a rejected grant leaves operators and review_actions untouched.
    if (targetState === 'VAKAVITI_VERIFIED') {
      const qualifying = evidenceIds.filter(eid => !isDisqualifiedEvidenceSourceType(found.get(eid)!.source_type));
      if (qualifying.length === 0) {
        return c.json({
          error: 'no_qualifying_evidence',
          detail: 'A verification grant must cite at least one evidence row whose source_type is not CEO_AUTHORIZATION and not AI-derived. CEO_AUTHORIZATION establishes provenance, not independent verification.'
        }, 422);
      }
    }
  }

  // commercial_status is deliberately never referenced above and never appears in this UPDATE -
  // publication state is untouched by a verification decision, in either direction.
  await c.env.DB.prepare(`UPDATE operators SET verification_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(targetState, id).run();

  const auditId = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO review_actions(id,entity_type,entity_id,action_type,actor,note,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(
      auditId, 'OPERATOR', id,
      targetState === 'VAKAVITI_VERIFIED' ? 'VERIFICATION_GRANTED' : 'VERIFICATION_REVOKED',
      reviewer, reason,
      JSON.stringify({ verification_status: currentState }),
      JSON.stringify({ verification_status: targetState, evidence_ids: evidenceIds })
    ).run();

  return c.json({ operator_id: id, verification_status: targetState, commercial_status: operator.commercial_status, review_action_id: auditId }, 200);
});

app.route('/api/admin/candidates', candidates);
app.route('/api/admin/products', products);
app.route('/api/admin/places', places);
app.route('/api/admin/deals', deals);
// P1.3A: the CEO-confirmed provider fast-track. requireAdmin end-to-end (see
// src/provider-onboarding.ts) - AI has no import path to this file at all.
app.route('/api/admin/providers', providerOnboarding);
// P1.3C: the cookie-session CEO onboarding console - same auth model as /admin/deals, same
// underlying governed service as the JSON API above. Removes the operational need for this
// session to ever hold ADMIN_TOKEN.
app.route('/admin/providers', providerOnboardingUi);
// P1.3B Phase 8: read-only supply dashboard - makes onboarding bottlenecks visible, never writes.
app.route('/api/admin/dashboard/supply', supplyDashboard);
// P1.3D: cookie-session batch review console for AI-discovered public directory listings (Path
// A). Same auth model as /admin/deals and /admin/providers. AI has no import path here (see
// regression-guards.mjs check 20) - only an authenticated human session can approve or reject.
app.route('/admin/review', batchReviewUi);
// P1.4: the initial supply sprint controller - lets James trigger bounded, real Worker-origin
// provider discovery batches without waiting for the normal Cron rotation. Same cookie-session
// auth as every other admin console. AI has no import path here (regression-guards.mjs check 22).
app.route('/admin/supply/sprint', supplySprintUi);
// Controlled public Deal Intelligence preview - JSON only (this app has no HTML admin/preview
// pages anywhere), never linked from any indexed page, no custom domain, not promoted. Every
// row returned has already passed isPubliclyEligible() inside dealsPublic itself - see
// src/deals.ts. With zero PUBLISHED offers today (no provider has approved anything yet), this
// always returns an empty result set.
app.route('/api/deals-preview', dealsPublic);
// P1 Human Review Centre - server-rendered, mobile-usable admin HTML, cookie-session-gated (see
// src/deals-admin-ui.ts for the auth model). Distinct from /api/admin/deals above, which remains
// Bearer-token-only for programmatic/JSON use - this is an additive HTML surface, not a
// replacement.
app.route('/admin/deals', dealsAdminUi);
// P1 Live Fiji Deals public hub - mobile-first, server-rendered, noindex (preview infra, no
// branded domain yet). Every route filters through the same isPubliclyEligible() gate as the
// admin approval flow and the JSON preview API - see src/deals-hub.ts.
app.route('/deals', dealsHub);
app.get('/api/health', c => c.json({ ok:true, service:'vakaviti-marketplace-stage1', environment:c.env.ENVIRONMENT, ai:true }));

type ScheduledBindings = Bindings;
export default {
  fetch: app.fetch,
  // P1.5: every scheduled tick now also drives the provider-discovery bootstrap (bounded batches
  // of the 7 CEO-authorized sources, auto-publishing eligible directory listings under the
  // standing policy - see src/supply-scheduler.ts) and one freshness recheck of the stalest
  // AI-discovered listing, alongside the pre-existing deal-offer scan. Each is independently
  // wrapped so one failing does not block the others; this mirrors the same
  // one-failed-source-never-blocks-another discipline already used inside each of these
  // functions individually.
  async scheduled(_event: ScheduledEvent, env: ScheduledBindings, ctx: ExecutionContext) {
    ctx.waitUntil(runDailyDiscovery(env));
    ctx.waitUntil(runSupplyBootstrap(env).catch(() => {}));
    // Supply Operations Activation Phase 2 (2026-08-24): a second, independent, bounded-batch
    // source list (see supply-scheduler.ts PHASE2_SOURCE_DOMAINS) - runs as its own sprint row,
    // never competing with the original bootstrap for the same tick's single-flight slot.
    ctx.waitUntil(runPhase2SupplyExpansion(env).catch(() => {}));
    // Supply Expansion Wave 3 (2026-08-24): same governed mechanism, own idempotency key, own
    // sprint row - see supply-scheduler.ts WAVE3_SOURCE_DOMAINS.
    ctx.waitUntil(runWave3SupplyExpansion(env).catch(() => {}));
    ctx.waitUntil(runFreshnessCheck(env).catch(() => {}));
    // P1.5A: Class B (source-evidenced deal) auto-publication under the CEO-approved standing
    // policy - see src/supply-scheduler.ts's runClassBAutoPublishPass() and src/deals.ts's
    // autoPublishDealIfEligible() for the governed gate + action.
    ctx.waitUntil(runClassBAutoPublishPass(env).catch(() => {}));
  }
};
