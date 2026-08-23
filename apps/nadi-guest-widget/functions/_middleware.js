// apps/nadi-guest-widget/functions/_middleware.js
//
// Two roles, toggled entirely by the PREVIEW_MODE Pages environment variable
// (set at the Pages-project level, never in this source):
//
//   PREVIEW_MODE unset/false -> "real future production" behavior: brand is
//   chosen by request hostname (nadiairporttransfers.com vs default/Fiji
//   Dash), app.js keeps calling the real nadi-dispatch-api.
//
//   PREVIEW_MODE=true -> this isolated QA preview's behavior: brand is
//   ALWAYS Nadi Airport Transfers regardless of hostname (this preview only
//   ever shows one brand, per the CEO's explicit instruction), a visible
//   "TEST PREVIEW" banner and noindex meta are injected, and app.js's
//   NADI_API_BASE is rewritten to an empty string so its existing
//   fetch(`${NADI_API_BASE}/quote`) / .../bookings calls become same-origin
//   relative requests - hitting functions/quote.js and functions/bookings.js
//   in this same Pages project, never api.nadiairporttransfers.com.
//
// Hard boundary (unchanged from the original design): brand.config.json
// controls presentation only. It is never read by, and must never be wired
// into, any fare/pricing/distance/security decision.

import brandConfig from '../brand.config.json';

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
      try {
        const u = new URL(current);
        el.setAttribute(this.attrName, this.brand.canonicalBase + u.pathname);
      } catch { /* leave malformed URLs untouched */ }
      return;
    }
    if (current.includes('Fiji Dash')) {
      el.setAttribute(this.attrName, current.split('Fiji Dash').join(this.brand.name));
    }
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
      out = out.split(
        'Fiji Dash operates a real-time, automated driver dispatch marketplace for airport transfers and private tours across Fiji - a guest requests a ride, online drivers get the job broadcast to them, and the first to accept is confirmed within seconds.'
      ).join(this.brand.structuredDataDescription);
      out = out.split('Fiji Dash fixed-fare routes').join(`${this.brand.name} fixed-fare routes`);
      text.replace(out, { html: false });
      this.buffer = '';
    } else {
      text.remove();
    }
  }
}

class FooterTextRewriter {
  constructor(brand) { this.brand = brand; }
  text(text) {
    if (!text.text.includes('All rights reserved')) return;
    text.replace(this.brand.footerLegalLine, { html: false });
  }
}

// Appends brand.trustLine (if set) to the one, unique booking-widget
// subheading - "Select pickup, destination & vehicle - price calculated
// live by distance." Matched on its own distinctive text since no id/class
// hook exists on this element in the recovered source.
class TrustLineRewriter {
  constructor(brand) { this.brand = brand; this.done = false; }
  text(text) {
    if (this.done || !this.brand.trustLine) return;
    if (!text.text.includes('price calculated live by distance')) return;
    text.replace(`${text.text} ${this.brand.trustLine}`, { html: false });
    this.done = true;
  }
}

// PREVIEW_MODE only: injects a fixed, dismissable-looking-but-not-actually
// TEST PREVIEW banner immediately after <body>, and forces noindex via meta
// (in addition to the response header set below and robots.txt).
class PreviewBannerInjector {
  element(el) {
    el.prepend(
      `<div role="status" style="position:sticky;top:0;z-index:99999;background:#b91c1c;color:#fff;text-align:center;font:600 14px/1.4 system-ui,sans-serif;padding:10px 12px;">TEST PREVIEW — NO REAL BOOKING WILL BE CREATED</div>`,
      { html: true }
    );
  }
}

class NoIndexMetaInjector {
  element(el) {
    el.append(`<meta name="robots" content="noindex,nofollow,noarchive">`, { html: true });
    // window.__PREVIEW_MODE__ - read by app.js (synthetic QA-PREVIEW- refs,
    // disabling the two dynamically-set wa.me links at confirmBooking()
    // time). Placed in <head> so it runs before app.js executes.
    el.append(`<script>window.__PREVIEW_MODE__ = true;</script>`, { html: true });
  }
}

// PREVIEW_MODE only: disables the two WhatsApp controls that exist in the
// static markup (confirmBooking() also prevents app.js from re-enabling
// them with a real href - see the window.__PREVIEW_MODE__ checks there).
class DisableWhatsAppControl {
  constructor() { this.labelAppended = false; }
  element(el) {
    el.removeAttribute('href');
    el.removeAttribute('onclick');
    el.setAttribute('aria-disabled', 'true');
    el.setAttribute('role', 'link');
    el.setAttribute('tabindex', '-1');
    el.setAttribute('style', 'opacity:0.5;pointer-events:none;cursor:not-allowed;');
    // Appended once, after all of this element's own text/child content, so
    // it survives regardless of how the parser chunks the text node(s)
    // inside (an SVG icon sibling sits before the label text here).
    el.append(' (preview only — disabled)', { html: false });
    this.labelAppended = true;
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
  for (const { needle, field, wrap } of JS_BRAND_LITERALS) {
    if (out.includes(needle)) out = out.split(needle).join(wrap(brand[field]));
  }
  if (previewMode) {
    // The only production-endpoint reference in the client bundle. Swapped
    // to an empty string so every fetch(`${NADI_API_BASE}/quote"`) call
    // becomes a same-origin relative request to this preview's own mock
    // functions - never api.nadiairporttransfers.com.
    out = out.replace(
      "const NADI_API_BASE = 'https://api.nadiairporttransfers.com';",
      "const NADI_API_BASE = ''; // PREVIEW_MODE: forced to same-origin mock, never production"
    );
  }
  return out;
}

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
};

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const previewMode = String(env.PREVIEW_MODE || '').toLowerCase() === 'true';
  const brand = resolveBrand(url.hostname, previewMode);

  // PREVIEW_MODE: serve a hard "disallow everything" robots.txt instead of
  // the canonical static file (which is written for a real future
  // production deploy and should keep allowing crawlers there).
  if (previewMode && url.pathname === '/robots.txt') {
    return new Response('User-agent: *\nDisallow: /\n', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow, noarchive' },
    });
  }

  const response = await next();
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
}
