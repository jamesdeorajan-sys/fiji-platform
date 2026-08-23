// apps/nadi-guest-widget/functions/_middleware.js
//
// PROPOSED Cloudflare Pages Function - NOT deployed anywhere. Lives in this
// branch as source only, per the CEO production freeze (no Cloudflare
// deployment authorized in this task).
//
// Purpose: serve the SAME static build under two brand identities
// (nadiairporttransfers.com and book.fijidash.com/default) without forking
// the HTML/JS. The underlying index.html, transfer/*.html, app.js and
// chat-widget.js are kept byte-identical to the confirmed, working source
// (guest-widget-integration-preview @ cc53ea68) - this file only rewrites
// the HTTP *response*, at the edge, based on the request's hostname.
//
// Hard boundary (do not weaken this file to cross it): brand.config.json
// controls presentation strings only - name, logo text, canonical URL,
// meta/structured-data, footer copy, and the two client-visible "brand name"
// strings inside app.js/chat-widget.js. It is never read by, and must never
// be wired into, any fare/pricing/distance/security decision - those live
// entirely server-side in nadi-dispatch-api and are untouched by this file.

import brandConfig from '../brand.config.json';

function resolveBrand(hostname) {
  let entry = brandConfig[hostname];
  if (entry && entry.$ref) entry = brandConfig[entry.$ref];
  return entry || brandConfig.default;
}

// Text nodes / attribute values only ever contain the literal "Fiji Dash" as
// the brand-varying substring in this source (verified against index.html
// and all 22 transfer/*.html pages before writing this rewriter) - swapping
// that one substring, plus the canonical/og:url host, covers every brand
// touchpoint Phase 2 lists (title, visible brand, canonical domain,
// structured business identity) without needing per-page rules.
class BrandTextRewriter {
  constructor(brand) {
    this.brand = brand;
  }
  text(text) {
    if (!text.text.includes('Fiji Dash')) return;
    text.replace(text.text.split('Fiji Dash').join(this.brand.name), { html: false });
  }
}

class AttrRewriter {
  constructor(attrName, brand, kind) {
    this.attrName = attrName;
    this.brand = brand;
    this.kind = kind;
  }
  element(el) {
    const current = el.getAttribute(this.attrName);
    if (current === null) return;
    if (this.kind === 'canonical-href') {
      // Preserve the path, swap only scheme+host to the brand's canonical base.
      try {
        const u = new URL(current);
        el.setAttribute(this.attrName, this.brand.canonicalBase + u.pathname);
      } catch {
        /* leave malformed URLs untouched rather than guess */
      }
      return;
    }
    if (current.includes('Fiji Dash')) {
      el.setAttribute(this.attrName, current.split('Fiji Dash').join(this.brand.name));
    }
  }
}

class MetaDescriptionRewriter {
  constructor(brand) {
    this.brand = brand;
  }
  element(el) {
    if (el.getAttribute('content')) {
      el.setAttribute('content', this.brand.metaDescription);
    }
  }
}

class LdJsonRewriter {
  constructor(brand) {
    this.brand = brand;
    this.buffer = '';
  }
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

class FooterRewriter {
  constructor(brand) {
    this.brand = brand;
  }
  element(el) {
    // Marked by its own distinctive copy in source; matched via the
    // surrounding text handler below rather than a class/id (none exists
    // in the recovered source), so this class stays a no-op placeholder
    // for now - the actual rewrite happens in FooterTextRewriter.
  }
}

class FooterTextRewriter {
  constructor(brand) {
    this.brand = brand;
  }
  text(text) {
    if (!text.text.includes('All rights reserved')) return;
    text.replace(this.brand.footerLegalLine, { html: false });
  }
}

const JS_BRAND_LITERALS = [
  // app.js: WhatsApp confirmation header line + the modify-booking message.
  { needle: '`Fiji Dash`,', field: 'whatsappMessageBrandLine', wrap: (v) => '`' + v + '`,' },
  { needle: "Hi Fiji Dash, I'd like to modify booking", field: 'whatsappMessageBrandLine', wrap: (v) => `Hi ${v}, I'd like to modify booking` },
  // chat-widget.js: single named constant.
  { needle: "const BRAND_NAME = 'Fiji Dash';", field: 'chatWidgetBrandName', wrap: (v) => `const BRAND_NAME = '${v}';` },
  { needle: 'aria-label="Chat with Fiji Dash"', field: 'chatWidgetBrandName', wrap: (v) => `aria-label="Chat with ${v}"` },
];

function rewriteBrandedScript(text, brand) {
  let out = text;
  for (const { needle, field, wrap } of JS_BRAND_LITERALS) {
    if (out.includes(needle)) {
      out = out.split(needle).join(wrap(brand[field]));
    }
  }
  return out;
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const hostname = url.hostname;
  const brand = resolveBrand(hostname);

  const response = await next();
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('text/html')) {
    const rewriter = new HTMLRewriter()
      .on('title', new BrandTextRewriter(brand))
      .on('.logo-text', new BrandTextRewriter(brand))
      .on('footer', new FooterTextRewriter(brand))
      .on('meta[property="og:title"]', new AttrRewriter('content', brand, 'text'))
      .on('meta[property="og:description"]', new MetaDescriptionRewriter(brand))
      .on('meta[name="description"]', new MetaDescriptionRewriter(brand))
      .on('meta[property="og:url"]', new AttrRewriter('content', brand, 'canonical-href'))
      .on('link[rel="canonical"]', new AttrRewriter('href', brand, 'canonical-href'))
      .on('script[type="application/ld+json"]', new LdJsonRewriter(brand));
    return rewriter.transform(response);
  }

  if (url.pathname === '/app.js' || url.pathname === '/chat-widget.js') {
    const text = await response.text();
    const rewritten = rewriteBrandedScript(text, brand);
    return new Response(rewritten, response);
  }

  return response;
}
