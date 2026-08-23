// Cloudflare Pages "Advanced Mode" worker for this DIRECT-UPLOAD deployment
// only (no Node/wrangler available in this environment to bundle
// functions/*.js the normal way, so this hand-merges the same logic from
// ../functions/_middleware.js, _mock-pricing.js, quote.js and bookings.js
// into one script - identical behavior, single-file form required by the
// direct-upload API's lack of a functions/ auto-bundler).
//
// This file exists ONLY in this isolated preview project's deployment
// bundle - it is not part of apps/nadi-guest-widget's canonical source
// (which keeps the functions/ directory form for any future Git-integrated
// deploy) and is not committed anywhere.

// Inlined from ../brand.config.json rather than imported, so this single
// file has no module-resolution dependency for a raw direct-upload deploy
// (no build/bundle step runs on this path). Keep in sync with that file by
// hand if brand.config.json changes.
const brandConfig = {
  default: {
    brandId: 'fiji-dash', name: 'Fiji Dash', logoText: 'Fiji Dash', domain: 'book.fijidash.com',
    canonicalBase: 'https://book.fijidash.com', ogSiteName: 'Fiji Dash',
    metaDescription: 'Book Fiji airport transfers from Nadi International Airport to all major resorts. Real-time pricing by distance. Private & shared transfers to Denarau, Coral Coast, Pacific Harbour, Sigatoka and 50+ hotels. 24/7 Fijian-owned service.',
    structuredDataName: 'Fiji Dash',
    structuredDataDescription: 'Fiji Dash operates a real-time, automated driver dispatch marketplace for airport transfers and private tours across Fiji - a guest requests a ride, online drivers get the job broadcast to them, and the first to accept is confirmed within seconds.',
    footerLegalLine: '© 2026 Fiji Dash. All rights reserved.', poweredByLine: null, trustLine: null, trustBadgeReviews: null,
    whatsappMessageBrandLine: 'Fiji Dash', chatWidgetBrandName: 'Fiji Dash', analyticsAttributionSource: 'fijidash_direct',
  },
  'nadiairporttransfers.com': {
    brandId: 'nadi-airport-transfers', name: 'Nadi Airport Transfers', logoText: 'Nadi Airport Transfers', domain: 'nadiairporttransfers.com',
    canonicalBase: 'https://nadiairporttransfers.com', ogSiteName: 'Nadi Airport Transfers',
    metaDescription: 'Book Fiji airport transfers from Nadi International Airport to all major resorts. Real-time pricing by distance. Private & shared transfers to Denarau, Coral Coast, Pacific Harbour, Sigatoka and 50+ hotels. 24/7 Fijian-owned service.',
    structuredDataName: 'Nadi Airport Transfers',
    structuredDataDescription: 'Nadi Airport Transfers operates a real-time, automated driver dispatch service for airport transfers and private tours across Fiji - a guest requests a ride, online drivers get the job broadcast to them, and the first to accept is confirmed within seconds.',
    footerLegalLine: '© 2026 Nadi Airport Transfers. All rights reserved.', poweredByLine: null,
    trustLine: 'Secure booking request with local WhatsApp support.', trustBadgeReviews: null,
    whatsappMessageBrandLine: 'Nadi Airport Transfers', chatWidgetBrandName: 'Nadi Airport Transfers', analyticsAttributionSource: 'nadi_direct',
  },
};
brandConfig['www.nadiairporttransfers.com'] = brandConfig['nadiairporttransfers.com'];

const NADI_BRAND = brandConfig['nadiairporttransfers.com'];

function resolveBrand(hostname, previewMode) {
  if (previewMode) return NADI_BRAND;
  let entry = brandConfig[hostname];
  if (entry && entry.$ref) entry = brandConfig[entry.$ref];
  return entry || brandConfig.default;
}

class BrandTextRewriter {
  constructor(brand) { this.brand = brand; }
  text(text) {
    if (!text.text.includes('Fiji Dash')) return;
    text.replace(text.text.split('Fiji Dash').join(this.brand.name), { html: false });
  }
}
class AttrRewriter {
  constructor(attrName, brand, kind) { this.attrName = attrName; this.brand = brand; this.kind = kind; }
  element(el) {
    const current = el.getAttribute(this.attrName);
    if (current === null) return;
    if (this.kind === 'canonical-href') {
      try { const u = new URL(current); el.setAttribute(this.attrName, this.brand.canonicalBase + u.pathname); } catch {}
      return;
    }
    if (current.includes('Fiji Dash')) el.setAttribute(this.attrName, current.split('Fiji Dash').join(this.brand.name));
  }
}
class MetaDescriptionRewriter {
  constructor(brand) { this.brand = brand; }
  element(el) { if (el.getAttribute('content')) el.setAttribute('content', this.brand.metaDescription); }
}
class LdJsonRewriter {
  constructor(brand) { this.brand = brand; this.buffer = ''; }
  text(text) {
    this.buffer += text.text;
    if (text.lastInTextNode) {
      let out = this.buffer;
      out = out.split('"Fiji Dash"').join(JSON.stringify(this.brand.structuredDataName));
      out = out.split('Fiji Dash operates a real-time, automated driver dispatch marketplace for airport transfers and private tours across Fiji - a guest requests a ride, online drivers get the job broadcast to them, and the first to accept is confirmed within seconds.').join(this.brand.structuredDataDescription);
      out = out.split('Fiji Dash fixed-fare routes').join(`${this.brand.name} fixed-fare routes`);
      text.replace(out, { html: false });
      this.buffer = '';
    } else { text.remove(); }
  }
}
class FooterTextRewriter {
  constructor(brand) { this.brand = brand; }
  text(text) { if (text.text.includes('All rights reserved')) text.replace(this.brand.footerLegalLine, { html: false }); }
}
class TrustLineRewriter {
  constructor(brand) { this.brand = brand; this.done = false; }
  text(text) {
    if (this.done || !this.brand.trustLine) return;
    if (!text.text.includes('price calculated live by distance')) return;
    text.replace(`${text.text} ${this.brand.trustLine}`, { html: false });
    this.done = true;
  }
}
class PreviewBannerInjector {
  element(el) {
    el.prepend(`<div role="status" style="position:sticky;top:0;z-index:99999;background:#b91c1c;color:#fff;text-align:center;font:600 14px/1.4 system-ui,sans-serif;padding:10px 12px;">TEST PREVIEW — NO REAL BOOKING WILL BE CREATED</div>`, { html: true });
  }
}
class NoIndexMetaInjector {
  element(el) {
    el.append(`<meta name="robots" content="noindex,nofollow,noarchive">`, { html: true });
    el.append(`<script>window.__PREVIEW_MODE__ = true;</script>`, { html: true });
  }
}
class DisableWhatsAppControl {
  element(el) {
    el.removeAttribute('href');
    el.removeAttribute('onclick');
    el.setAttribute('aria-disabled', 'true');
    el.setAttribute('role', 'link');
    el.setAttribute('tabindex', '-1');
    el.setAttribute('style', 'opacity:0.5;pointer-events:none;cursor:not-allowed;');
    el.append(' (preview only — disabled)', { html: false });
  }
}

const JS_BRAND_LITERALS = [
  { needle: '`Fiji Dash`,', field: 'whatsappMessageBrandLine', wrap: (v) => '`' + v + '`,' },
  { needle: "Hi Fiji Dash, I'd like to modify booking", field: 'whatsappMessageBrandLine', wrap: (v) => `Hi ${v}, I'd like to modify booking` },
  { needle: "const BRAND_NAME = 'Fiji Dash';", field: 'chatWidgetBrandName', wrap: (v) => `const BRAND_NAME = '${v}';` },
  { needle: 'aria-label="Chat with Fiji Dash"', field: 'chatWidgetBrandName', wrap: (v) => `aria-label="Chat with ${v}"` },
];
function rewriteBrandedScript(text, brand, previewMode) {
  let out = text;
  for (const { needle, field, wrap } of JS_BRAND_LITERALS) if (out.includes(needle)) out = out.split(needle).join(wrap(brand[field]));
  if (previewMode) {
    out = out.replace(
      "const NADI_API_BASE = 'https://api.nadiairporttransfers.com';",
      "const NADI_API_BASE = ''; // PREVIEW_MODE: forced to same-origin mock, never production"
    );
  }
  return out;
}

const SECURITY_HEADERS = {
  // img-src includes fijitourtransfers.com - the tour-listing images on this
  // page are loaded directly from that live site by design (per the
  // recovered source's own docs/DEPLOYMENT.md), with an onerror fallback
  // already in the markup for when it's unreachable. Blocking it outright
  // was a real CSP bug caught during this preview's own QA pass (18 blocked
  // image loads in the console) - fixed here, not shipped as "acceptable
  // because there's a fallback".
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://fijitourtransfers.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

// ─── E3D Phase 5: proxy to the isolated staging Worker via a private
// service binding (env.STAGING_API). The browser only ever sees this same-
// origin /quote and /bookings path - no staging URL, credential, or
// hostname is ever visible client-side. All pricing/idempotency/
// custom-address-hardening logic now lives in nadi-dispatch-api-staging
// itself, backed by its own isolated D1 (nadi-marketplace-staging-db-v2) -
// this Pages Worker no longer computes fares or dedupes bookings at all. ──
async function proxyToStaging(env, request, pathname) {
  if (!env.STAGING_API) {
    return json({ ok: false, error: 'staging_service_unavailable' }, 503);
  }
  const upstream = new Request(`https://staging-internal${pathname}`, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  return env.STAGING_API.fetch(upstream);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const previewMode = String(env.PREVIEW_MODE || '').toLowerCase() === 'true';

    if (request.method === 'POST' && (url.pathname === '/quote' || url.pathname === '/bookings')) {
      return proxyToStaging(env, request, url.pathname);
    }

    if (previewMode && url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow, noarchive' } });
    }

    const brand = resolveBrand(url.hostname, previewMode);
    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get('content-type') || '';
    let finalResponse = response;

    if (contentType.includes('text/html')) {
      const rewriter = new HTMLRewriter()
        .on('title', new BrandTextRewriter(brand))
        .on('.logo-text', new BrandTextRewriter(brand))
        .on('footer', new FooterTextRewriter(brand))
        .on('p', new TrustLineRewriter(brand))
        .on('meta[property="og:title"]', new AttrRewriter('content', brand, 'text'))
        .on('meta[property="og:description"]', new MetaDescriptionRewriter(brand))
        .on('meta[name="description"]', new MetaDescriptionRewriter(brand))
        .on('meta[property="og:url"]', new AttrRewriter('content', brand, 'canonical-href'))
        .on('link[rel="canonical"]', new AttrRewriter('href', brand, 'canonical-href'))
        .on('script[type="application/ld+json"]', new LdJsonRewriter(brand));
      if (previewMode) {
        rewriter
          .on('body', new PreviewBannerInjector())
          .on('head', new NoIndexMetaInjector())
          .on('#bulaWaBtn', new DisableWhatsAppControl())
          .on('#bulaModifyLink', new DisableWhatsAppControl())
          .on('a[href^="https://wa.me/"]', new DisableWhatsAppControl())
          .on('a[href^="tel:"]', new DisableWhatsAppControl());
      }
      finalResponse = rewriter.transform(response);
    } else if (url.pathname === '/app.js' || url.pathname === '/chat-widget.js') {
      const text = await response.text();
      finalResponse = new Response(rewriteBrandedScript(text, brand, previewMode), response);
    }

    const headers = new Headers(finalResponse.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
    if (previewMode) headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return new Response(finalResponse.body, { status: finalResponse.status, headers });
  },
};
