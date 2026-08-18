import { Hono } from 'hono';
import { candidates } from './candidates';
import { products } from './products';
import { enrichCandidate, providerCopilot, createHumanGate } from './ai';

type Bindings = { DB: D1Database; AI: Ai; ENVIRONMENT: string; ADMIN_TOKEN?: string };
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


const FAVICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#12231b"/><text x="32" y="45" font-family="system-ui,sans-serif" font-size="34" font-weight="700" fill="#ffffff" text-anchor="middle">V</text></svg>');

// Must be an absolute URL - OG/social crawlers do not resolve relative image paths.
// Update this one line when a branded production domain replaces the preview URL.
const OG_IMAGE_PATH = 'https://vakaviti-marketplace-stage1.helpronline.workers.dev/images/og-image.jpg';

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
.btn{display:inline-block;background:var(--ink);color:white;text-decoration:none;padding:13px 20px;border-radius:12px;font-weight:700;min-height:24px}
.btn.secondary{background:white;color:var(--ink);border:1px solid var(--ink)}
.btn.whatsapp{background:#128c7e}
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

app.notFound(c => c.html(html(`<section class="section"><span class="badge">404</span><h1>We couldn't find that page.</h1><p class="muted">The page you're looking for doesn't exist or may have moved.</p><p class="cta-row"><a class="btn" href="/">Go home</a> <a class="btn secondary" href="/experiences">Browse experiences</a></p><p class="muted">Looking for something specific? <a href="/contact">Contact support</a>.</p></section>`, { title: 'Page not found — Vakaviti', noindex: true }), 404));

// OG_IMAGE_PATH (/images/og-image.jpg) is now served directly by Workers Static Assets
// from public/images/ - a real composited photo, replacing the earlier generated SVG.

app.get('/', async c => {
  const featuredProducts = await c.env.DB.prepare(`SELECT p.id,p.canonical_name,p.slug,p.image_url,p.verification_status,o.canonical_name as operator_name,o.slug as operator_slug,o.locality,o.region,of.amount_minor,of.currency,of.pricing_basis FROM products p JOIN operators o ON o.id=p.operator_id LEFT JOIN offers of ON of.product_id=p.id AND of.active=1 ORDER BY p.created_at ASC LIMIT 3`).all<any>();
  const featuredOperators = await c.env.DB.prepare(`SELECT o.id,o.canonical_name,o.slug,o.locality,o.region,o.verification_status,o.image_url,COUNT(p.id) as product_count FROM operators o LEFT JOIN products p ON p.operator_id=o.id GROUP BY o.id ORDER BY o.canonical_name LIMIT 3`).all<any>();

  const expCards = (featuredProducts.results || []).map((p: any) => `<article class="card"><a href="/experiences/${esc(p.slug)}" style="text-decoration:none;color:inherit">${mediaBlock(p.image_url, `${p.canonical_name} — ${p.operator_name}`, { seed: p.id })}<div class="card-body"><span class="badge${p.verification_status === 'VAKAVITI_VERIFIED' ? ' verified' : ''}">${p.verification_status === 'VAKAVITI_VERIFIED' ? '✓ Vakaviti Verified' : 'Not yet verified'}</span><h3 style="margin:8px 0 2px">${esc(p.canonical_name)}</h3><p class="muted" style="margin:0 0 8px">${esc(p.operator_name)} &middot; ${esc([p.locality, p.region].filter(Boolean).join(', ') || 'Fiji')}</p><p class="muted" style="margin:0">${priceLabel({ amount_minor: p.amount_minor, currency: p.currency, pricing_basis: p.pricing_basis })}</p></div></a></article>`).join('');
  const opCards = (featuredOperators.results || []).map((o: any) => `<article class="card"><a href="/operators/${esc(o.slug)}" style="text-decoration:none;color:inherit">${mediaBlock(o.image_url, o.canonical_name, { seed: o.id })}<div class="card-body"><span class="badge${o.verification_status === 'VAKAVITI_VERIFIED' ? ' verified' : ''}">${o.verification_status === 'VAKAVITI_VERIFIED' ? '✓ Vakaviti Verified' : 'Publicly listed'}</span><h3 style="margin:8px 0 2px">${esc(o.canonical_name)}</h3><p class="muted" style="margin:0 0 8px">${esc([o.locality, o.region].filter(Boolean).join(', ') || 'Fiji')}</p><p class="muted" style="margin:0">${o.product_count} experience${o.product_count === 1 ? '' : 's'}</p></div></a></article>`).join('');

  const categories = [
    { label: 'Transfers', ctx: 'Airport & point-to-point', href: '/experiences', from: '#134a3f', to: '#0c2b23', img: null, alt: '', available: true },
    { label: 'Island experiences', ctx: 'Coming soon', href: null, from: '#0f6e6a', to: '#0a3c39', img: '/images/category-islands-ocean.webp', alt: 'Fiji islands from above', available: false },
    { label: 'Waterfalls & nature', ctx: 'Coming soon', href: null, from: '#1c5c3f', to: '#0c2b23', img: null, alt: '', available: false },
    { label: 'Cultural experiences', ctx: 'Coming soon', href: null, from: '#7a4a1c', to: '#3d2510', img: null, alt: '', available: false },
    { label: 'Adventure', ctx: 'Coming soon', href: null, from: '#2a4d6e', to: '#12283d', img: '/images/category-adventure.webp', alt: 'Boat at Kuata, Fiji before a dive', available: false },
    { label: 'Day tours', ctx: 'Coming soon', href: null, from: '#5c3d6e', to: '#291a33', img: null, alt: '', available: false }
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
  <div><span class="eyebrow">Fiji Operator Graph</span><h1>Fiji tourism operators, structured in one trusted place.</h1><p class="muted">Every listing shows what Vakaviti has actually verified — evidence, identity and direct contact — so you can message the operator yourself with confidence.</p><div class="cta-row"><a class="btn" href="/experiences">Explore Fiji experiences</a><a class="btn secondary" href="/operators">Meet local operators</a></div></div>
  <div class="hero-media"><img src="/images/hero-fiji-leleuvia.webp" alt="Aerial view of Leleuvia Island, Fiji" loading="eager" fetchpriority="high" style="width:100%;height:100%;object-fit:cover;display:block"><span class="loc-badge">Leleuvia Island, Fiji</span></div>
</div></section>

<section class="section"><h2>Why Vakaviti</h2><div class="grid">
  <div class="card"><div class="card-body"><h3>See who you're booking with</h3><p class="muted">Every listing shows whether Vakaviti has verified the operator, so you know what's confirmed and what isn't.</p></div></div>
  <div class="card"><div class="card-body"><h3>Message operators directly</h3><p class="muted">No account, no forms — tap through to WhatsApp and ask your questions or confirm availability yourself.</p></div></div>
  <div class="card"><div class="card-body"><h3>Built for Fiji</h3><p class="muted">Local tours, activities and ground transport, discovered and structured for travellers planning a trip to Fiji.</p></div></div>
</div></section>

${expCards ? `<section class="section"><h2>Featured experiences</h2><p class="muted">Real Fiji services, ready to enquire about today.</p><div class="grid">${expCards}</div></section>` : ''}
${opCards ? `<section class="section"><h2>Local operators</h2><div class="grid">${opCards}</div></section>` : ''}

<section class="section"><h2>Explore Fiji</h2><p class="muted">Browse by category — more experiences are being added as operators join.</p><div class="grid">${catCards}</div></section>

<section class="section" style="text-align:center;background:#0f2a20;color:#fff;border-radius:24px;padding:48px 24px"><h2 style="color:#fff">Ready to plan your Fiji trip?</h2><p style="opacity:.85;max-width:520px;margin:0 auto 20px">Browse real experiences or reach out directly — or if you run a Fiji tour, activity or transport business, join as a Founding Partner.</p><div class="cta-row" style="justify-content:center"><a class="btn" style="background:#fff;color:#12231b" href="/experiences">Explore Fiji</a><a class="btn secondary" style="border-color:#fff;color:#fff" href="/partners">Become a Vakaviti partner</a></div></section>
`, { title: 'Vakaviti — Find trusted Fiji experiences', description: 'Find trusted Fiji tours, activities and ground transport, and connect directly with local operators on WhatsApp.', noindex: true }));
});

app.get('/partners', c => c.html(html(`<section class="section"><span class="badge">Founding Partner Program</span><h1>Keep running your Fiji business. We help bring the enquiries.</h1><p class="muted">Vakaviti is a directory and enquiry channel for Fiji tourism operators. We list your business, travellers find you, and they message you directly on WhatsApp to ask questions and arrange bookings — you stay in full control of price, availability and the booking itself.</p></section><section class="grid"><div class="card"><div class="card-body"><h3>What does it cost?</h3><p class="muted">No setup fee and no monthly fee for founding partners while the program is in preview. Final commercial terms will be confirmed with you directly before anything is charged.</p></div></div><div class="card"><div class="card-body"><h3>How does Vakaviti make money?</h3><p class="muted">Through a share of confirmed bookings once commercial terms are agreed with you — not a forced software subscription.</p></div></div><div class="card"><div class="card-body"><h3>What do you control?</h3><p class="muted">Your prices, availability, policies and identity. Nothing about your business goes live as "verified" without you confirming it first.</p></div></div><div class="card"><div class="card-body"><h3>What information is needed?</h3><p class="muted">Your business name, a WhatsApp number for enquiries, your service area, a short description, and at least one experience or service with a price (or "contact for price").</p></div></div><div class="card"><div class="card-body"><h3>What happens after you apply?</h3><p class="muted">We follow up directly by WhatsApp or email to confirm your details and prepare your public profile before it goes live.</p></div></div><div class="card"><div class="card-body"><h3>How are enquiries delivered?</h3><p class="muted">Directly to your WhatsApp, in real time, when a traveller taps to ask about your listing.</p></div></div></section><section class="section"><h2>Claim or add your business</h2><form method="post" action="/api/partner-interest"><label>Business name</label><input name="business" autocomplete="organization" required><label>Your name</label><input name="name" autocomplete="name" required><label>Phone / WhatsApp</label><input name="phone" type="tel" autocomplete="tel" required><label>Email</label><input name="email" type="email" autocomplete="email"><label>Website or Facebook page</label><input name="url" autocomplete="url"><button class="btn" type="submit">Start my profile</button></form><p class="muted">Prefer email? Write to <a href="mailto:helpronline@gmail.com">helpronline@gmail.com</a>.</p></section>`, { title: 'Become a Vakaviti Founding Partner', description: 'Join Vakaviti as a Founding Partner — no setup fee, keep control of your prices and bookings, get enquiries by WhatsApp.' })));

app.get('/experiences', async c => {
  const rows = await c.env.DB.prepare(`SELECT p.id,p.canonical_name,p.slug,p.category,p.duration_minutes,p.verification_status,p.image_url,o.canonical_name as operator_name,o.slug as operator_slug,o.locality,o.region,of.amount_minor,of.currency,of.pricing_basis FROM products p JOIN operators o ON o.id=p.operator_id LEFT JOIN offers of ON of.product_id=p.id AND of.active=1 ORDER BY p.canonical_name LIMIT 100`).all<any>();
  const cards = (rows.results || []).map((p: any) => `<article class="card"><a href="/experiences/${esc(p.slug)}" style="text-decoration:none;color:inherit">${mediaBlock(p.image_url, `${p.canonical_name} — ${p.operator_name}`, { seed: p.id })}<div class="card-body"><span class="badge${p.verification_status === 'VAKAVITI_VERIFIED' ? ' verified' : ''}">${p.verification_status === 'VAKAVITI_VERIFIED' ? '✓ Vakaviti Verified' : 'Not yet verified'}</span><h3 style="margin:8px 0 4px">${esc(p.canonical_name)}</h3><p class="muted" style="margin:0 0 6px">${esc(p.operator_name)} &middot; ${esc([p.locality, p.region].filter(Boolean).join(', ') || 'Fiji')}</p><p class="muted" style="margin:0">${priceLabel({ amount_minor: p.amount_minor, currency: p.currency, pricing_basis: p.pricing_basis })}${durationLabel(p.duration_minutes) ? ' &middot; ' + durationLabel(p.duration_minutes) : ''}</p></div></a></article>`).join('');
  return c.html(html(`<section class="section"><span class="badge">Experiences</span><h1>Fiji tours, activities and transport.</h1><p class="muted">Browse real Fiji experiences and enquire directly with the operator on WhatsApp.</p></section><div class="grid">${cards || '<div class="card"><div class="card-body">No experiences published yet. Check back soon.</div></div>'}</div>`, { title: 'Fiji Experiences — Vakaviti', description: 'Browse verified Fiji tours, activities and ground transport, and enquire directly with local operators on WhatsApp.', noindex: true }));
});

app.get('/experiences/:slug', async c => {
  const p = await c.env.DB.prepare(`SELECT * FROM products WHERE slug=?`).bind(c.req.param('slug')).first<any>();
  if (!p) return c.notFound();
  const o = await c.env.DB.prepare(`SELECT * FROM operators WHERE id=?`).bind(p.operator_id).first<any>();
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
  return c.html(html(`<section class="section" style="padding-top:20px">
    <div class="hero-media" style="aspect-ratio:21/9;margin-bottom:20px">${mediaBlock(p.image_url, `${p.canonical_name} — ${o.canonical_name}`, { aspect: '21/9', radius: '20px', seed: p.id, eager: true })}<span class="loc-badge">${esc([o.locality, o.region].filter(Boolean).join(', ') || 'Fiji')}</span></div>
    <span class="badge${verified ? ' verified' : ''}">${verified ? '✓ Vakaviti Verified' : 'Publicly listed — not yet verified'}</span>
    <h1>${esc(p.canonical_name)}</h1>
    <p class="muted">${esc(o.canonical_name)} &middot; ${esc([o.locality, o.region].filter(Boolean).join(', ') || 'Fiji')}</p>
    ${p.description ? `<p>${esc(p.description)}</p>` : ''}
    <div class="grid">${facts.map(f => `<div class="card"><div class="card-body"><h3 style="margin:0 0 6px;font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)">${esc(f.label)}</h3><p style="margin:0;font-weight:600">${esc(f.value)}</p></div></div>`).join('')}</div>
    <p class="muted">Operated by ${esc(o.canonical_name)}. ${verified ? 'Identity and details verified by Vakaviti.' : 'This listing is publicly discovered and has not yet been verified by Vakaviti — confirm details directly with the operator.'}</p>
    <div class="wa-sticky"><a class="btn whatsapp" href="${enquireHref}" style="width:100%;text-align:center;box-sizing:border-box;display:block">Check availability on WhatsApp</a></div>
    <p><a class="btn secondary" href="/operators/${esc(o.slug)}">View operator</a></p>
  </section>`, { title: `${p.canonical_name} — Vakaviti`, description: `${p.canonical_name} with ${o.canonical_name} in Fiji. ${priceLabel(offer)}.`, ogImage: p.image_url, noindex: true }));
});

app.get('/operators', async c => {
  const rows = await c.env.DB.prepare(`SELECT o.id,o.canonical_name,o.slug,o.locality,o.region,o.claim_status,o.verification_status,o.image_url,COUNT(p.id) as product_count FROM operators o LEFT JOIN products p ON p.operator_id=o.id GROUP BY o.id ORDER BY o.canonical_name LIMIT 100`).all<any>();
  const cards = (rows.results || []).map((o: any) => `<article class="card"><a href="/operators/${esc(o.slug)}" style="text-decoration:none;color:inherit">${mediaBlock(o.image_url, o.canonical_name, { seed: o.id })}<div class="card-body"><span class="badge${o.verification_status === 'VAKAVITI_VERIFIED' ? ' verified' : ''}">${o.verification_status === 'VAKAVITI_VERIFIED' ? '✓ Vakaviti Verified' : o.claim_status === 'CLAIMED' ? 'Claimed profile' : 'Publicly listed &middot; unclaimed'}</span><h3 style="margin:8px 0 4px">${esc(o.canonical_name)}</h3><p class="muted" style="margin:0 0 6px">${esc([o.locality, o.region].filter(Boolean).join(', ') || 'Fiji')}</p><p class="muted" style="margin:0">${o.product_count} experience${o.product_count === 1 ? '' : 's'}</p></div></a></article>`).join('');
  return c.html(html(`<section class="section"><span class="badge">Fiji Operator Graph</span><h1>Fiji tourism operators, structured in one place.</h1><p class="muted">Publicly listed means we found public evidence the operator exists. It does not mean identity, licences, prices, availability or products have been verified by Vakaviti.</p></section><div class="grid">${cards || '<div class="card"><div class="card-body">No operators imported yet. Candidate collection is the next stage.</div></div>'}</div>`, { title: 'Fiji Tourism Operators — Vakaviti', noindex: true }));
});

app.get('/operators/:slug', async c => {
  const o = await c.env.DB.prepare(`SELECT * FROM operators WHERE slug=?`).bind(c.req.param('slug')).first<any>();
  if (!o) return c.notFound();
  const productRows = await c.env.DB.prepare(`SELECT id,canonical_name,slug,category,verification_status,image_url FROM products WHERE operator_id=? ORDER BY canonical_name`).bind(o.id).all<any>();
  const verified = o.verification_status === 'VAKAVITI_VERIFIED';
  const status = verified ? '✓ Vakaviti Verified' : o.claim_status === 'CLAIMED' ? 'Profile claimed — verification in progress' : 'Publicly listed — information not yet verified by Vakaviti';
  const list = (productRows.results || []).map((p: any) => `<a href="/experiences/${esc(p.slug)}" style="text-decoration:none;color:inherit"><article class="card">${mediaBlock(p.image_url, `${p.canonical_name} — ${o.canonical_name}`, { aspect: '4/3', seed: p.id })}<div class="card-body"><h3 style="margin:0 0 4px">${esc(p.canonical_name)}</h3><span class="badge${p.verification_status === 'VAKAVITI_VERIFIED' ? ' verified' : ''}">${p.verification_status === 'VAKAVITI_VERIFIED' ? '✓ Verified' : 'Not yet verified'}</span></div></article></a>`).join('');
  const enquireHref = `/enquire/${esc(o.slug)}`;
  return c.html(html(`<section class="section">
    <div class="hero-media" style="aspect-ratio:21/9;margin-bottom:20px">${mediaBlock(o.image_url, o.canonical_name, { aspect: '21/9', radius: '20px', seed: o.id, eager: true })}<span class="loc-badge">${esc([o.locality, o.region].filter(Boolean).join(', ') || 'Fiji')}</span></div>
    <span class="badge${verified ? ' verified' : ''}">${status}</span>
    <h1>${esc(o.canonical_name)}</h1>
    <p class="muted">${esc([o.locality, o.region].filter(Boolean).join(', ') || 'Fiji')}</p>
    ${o.description ? `<p>${esc(o.description)}</p>` : ''}
    <div class="cta-row">${o.whatsapp ? `<a class="btn whatsapp" href="${enquireHref}">Enquire on WhatsApp</a>` : ''}${o.claim_status !== 'CLAIMED' ? `<a class="btn secondary" href="/claim/${esc(o.slug)}">Claim this business</a>` : ''}</div>
  </section>
  <section class="section"><h2>Experiences</h2><div class="grid">${list || '<div class="card"><div class="card-body">No verified products yet.</div></div>'}</div></section>`, { title: `${o.canonical_name} — Vakaviti`, description: `${o.canonical_name}, ${[o.locality, o.region].filter(Boolean).join(', ') || 'Fiji'} — Fiji tourism operator on Vakaviti.`, ogImage: o.image_url, noindex: true }));
});

app.get('/enquire/:operatorSlug', async c => {
  const operator = await c.env.DB.prepare(`SELECT id,canonical_name,slug,whatsapp FROM operators WHERE slug=?`).bind(c.req.param('operatorSlug')).first<any>();
  if (!operator) return c.notFound();
  const productSlug = c.req.query('product');
  let product: any = null;
  if (productSlug) {
    const candidate = await c.env.DB.prepare(`SELECT id,canonical_name,slug,operator_id FROM products WHERE slug=?`).bind(productSlug).first<any>();
    if (candidate && candidate.operator_id === operator.id) product = candidate;
  }
  if (!operator.whatsapp) {
    return c.html(html(`<section class="section"><h1>Contact not yet available</h1><p class="muted">${esc(operator.canonical_name)} hasn't confirmed a WhatsApp contact yet. Please check back soon or <a href="/contact">contact Vakaviti support</a>.</p><p><a class="btn secondary" href="/operators/${esc(operator.slug)}">Back to profile</a></p></section>`, { title: 'Contact not available', noindex: true }));
  }
  const id = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO enquiries(id,operator_id,product_id,channel,source_page,referrer,status) VALUES(?,?,?, 'WHATSAPP', ?, ?, 'SENT')`)
    .bind(id, operator.id, product ? product.id : null, c.req.path, c.req.header('referer') || null).run();
  const message = product
    ? `Bula! I'm interested in ${product.canonical_name} with ${operator.canonical_name} — I found you on Vakaviti. Could you confirm availability and pricing?`
    : `Bula! I found ${operator.canonical_name} on Vakaviti and I'd like to know more about your tours/experiences.`;
  return c.redirect(waLink(operator.whatsapp, message), 302);
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

app.get('/about', c => c.html(html(`<section class="section"><span class="badge">About</span><h1>What Vakaviti is — and isn't.</h1></section><div class="grid"><div class="card"><div class="card-body"><h3>What we are</h3><p class="muted">A directory that helps travellers find real Fiji tour, activity and ground transport operators, and connects them directly with those operators.</p></div></div><div class="card"><div class="card-body"><h3>What "publicly listed" means</h3><p class="muted">We found public evidence an operator exists. It does not mean we have verified identity, licences, prices or availability.</p></div></div><div class="card"><div class="card-body"><h3>What "Vakaviti Verified" means</h3><p class="muted">A human at Vakaviti has reviewed and confirmed the operator's identity and key facts. Verified status is never automatic and is never granted by AI alone.</p></div></div><div class="card"><div class="card-body"><h3>How enquiries work today</h3><p class="muted">Tapping "Enquire on WhatsApp" takes you directly to a WhatsApp chat with the operator. Vakaviti does not currently process payments or confirm bookings — the operator handles your enquiry and any booking directly.</p></div></div><div class="card"><div class="card-body"><h3>For operators</h3><p class="muted">Operators can join as a Founding Partner. See <a href="/partners">Become a Partner</a> for details.</p></div></div><div class="card"><div class="card-body"><h3>Questions?</h3><p class="muted">Reach us at <a href="mailto:helpronline@gmail.com">helpronline@gmail.com</a>.</p></div></div></div>`, { title: 'About Vakaviti', description: 'What Vakaviti is, what verification means, and how enquiries work.' })));

app.get('/privacy', c => c.html(html(`<section class="section"><span class="badge">Preview</span><h1>Privacy</h1><p class="muted">This is a preview environment. A complete Privacy Policy will be published before public launch. In the meantime:</p></section><div class="grid"><div class="card"><div class="card-body"><p class="muted">Claim and Founding Partner forms collect the contact details you submit, used only to follow up with you.</p></div></div><div class="card"><div class="card-body"><p class="muted">Tapping a WhatsApp enquiry button records which listing and operator it relates to, and the time — not your personal details, which stay inside WhatsApp.</p></div></div><div class="card"><div class="card-body"><p class="muted">We do not sell your information.</p></div></div></div><p class="muted">Questions? Email <a href="mailto:helpronline@gmail.com">helpronline@gmail.com</a>.</p>`, { title: 'Privacy — Vakaviti', noindex: true })));

app.get('/terms', c => c.html(html(`<section class="section"><span class="badge">Preview</span><h1>Terms</h1><p class="muted">This is a preview environment. Complete Terms of Service will be published before public launch. In the meantime:</p></section><div class="grid"><div class="card"><div class="card-body"><p class="muted">Vakaviti is a directory and enquiry channel. We do not currently process payments or confirm bookings — any booking is arranged directly between you and the operator.</p></div></div><div class="card"><div class="card-body"><p class="muted">"Publicly listed" is not the same as "verified." Check the badge on each listing before relying on any detail.</p></div></div><div class="card"><div class="card-body"><p class="muted">Operators are responsible for the accuracy of information they confirm, and for fulfilling any booking made with them.</p></div></div></div><p class="muted">Questions? Email <a href="mailto:helpronline@gmail.com">helpronline@gmail.com</a>.</p>`, { title: 'Terms — Vakaviti', noindex: true })));

app.get('/contact', c => c.html(html(`<section class="section"><span class="badge">Support</span><h1>Contact Vakaviti</h1><p class="muted">For travellers: contact the operator directly via WhatsApp from their listing for the fastest response.</p><p>For everything else, including operators wanting to join: <a href="mailto:helpronline@gmail.com">helpronline@gmail.com</a></p><p><a class="btn secondary" href="/partners">Become a Founding Partner</a></p></section>`, { title: 'Contact — Vakaviti' })));

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

app.route('/api/admin/candidates', candidates);
app.route('/api/admin/products', products);
app.get('/api/health', c => c.json({ ok:true, service:'vakaviti-marketplace-stage1', environment:c.env.ENVIRONMENT, ai:true }));

export default app;
