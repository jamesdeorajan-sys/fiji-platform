// CEO AUTHORIZATION — SECURE INTERNAL ROUTES AND ADD READ-ONLY OFFER LISTING (2026-08-29), Phase 2.
//
// Read-only, zero-write public listing of already-ELIGIBLE, non-fixture offers. Reuses the same
// eligibility gate the enquiry-review page already trusts (publication_decision='ELIGIBLE' AND
// is_synthetic_fixture=0) - this module never re-decides eligibility, it only renders it. No
// internal gate reasons, no rejected/quarantined rows, no private/net rates, no internal IDs beyond
// the offer id already used as the public /enquire/:offerId path segment.
import { Hono } from 'hono';
import type { Env } from './env';
import { PRICE_ON_CONFIRMATION_LABEL } from './public-presentation';

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0 16px 32px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f7f6f3; color: #1c1c1c; }
  .preview-banner { background: #fef3c7; border-bottom: 1px solid #f5d485; color: #7a5b00; padding: 10px 16px; margin: 0 -16px 20px; font-size: 14px; text-align: center; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  .subhead { color: #555; font-size: 0.9rem; margin: 0 0 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; max-width: 1200px; margin: 0 auto; }
  .card { background: #fff; border: 1px solid #e4e1d8; border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .card h2 { font-size: 1.05rem; margin: 0 0 2px; overflow-wrap: anywhere; }
  .meta { font-size: 0.85rem; color: #555; overflow-wrap: anywhere; }
  .price { font-size: 1.05rem; font-weight: 600; margin: 6px 0 2px; }
  .notice { font-size: 0.78rem; color: #777; }
  .cta { margin-top: 10px; display: inline-block; text-align: center; background: #14532d; color: #fff; text-decoration: none; padding: 10px 14px; border-radius: 6px; font-size: 0.9rem; }
  .empty { text-align: center; color: #666; padding: 40px 16px; }
  @media (max-width: 480px) { .grid { grid-template-columns: 1fr; } }
`;

function offerCard(offer: any): string {
  const title = offer.public_label || offer.provider_name || 'Offer';
  const priceCopy = offer.price_amount && offer.currency && offer.price_basis
    ? `${offer.currency} ${offer.price_amount} (${offer.price_basis})`
    : PRICE_ON_CONFIRMATION_LABEL;
  const checkedDate = (offer.checked_at || '').slice(0, 10);
  const showSeller = offer.seller_name && offer.seller_name !== offer.provider_name;

  return `
    <article class="card">
      <h2>${escapeHtml(title)}</h2>
      <div class="meta">Provider: ${escapeHtml(offer.provider_name || 'Unknown provider')}</div>
      ${showSeller ? `<div class="meta">Seller: ${escapeHtml(offer.seller_name)}</div>` : ''}
      <div class="price">${escapeHtml(priceCopy)}</div>
      ${checkedDate ? `<div class="meta">Source checked: ${escapeHtml(checkedDate)}</div>` : ''}
      ${offer.region || offer.category ? `<div class="meta">${escapeHtml([offer.region, offer.category].filter(Boolean).join(' · '))}</div>` : ''}
      ${offer.booking_deadline ? `<div class="meta">Valid until: ${escapeHtml(offer.booking_deadline)}</div>` : ''}
      <div class="notice">Availability must be confirmed.</div>
      <a class="cta" href="/enquire/${encodeURIComponent(offer.id)}">Ask Vakaviti about this offer</a>
    </article>`;
}

function renderListingPage(offers: any[]): string {
  const cards = offers.length
    ? `<div class="grid">${offers.map(offerCard).join('')}</div>`
    : `<div class="empty">No offers are currently available.</div>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vakaviti Agent-Discovered Offers (Preview)</title><meta name="robots" content="noindex,nofollow"><style>${STYLE}</style></head><body>
    <div class="preview-banner">PREVIEW — Vakaviti-discovered offers under agent evaluation. Not yet a production feature.</div>
    <h1>Agent-Discovered Offers</h1>
    <p class="subhead">Publicly advertised offers Vakaviti's agents have evidenced and checked. Availability and final price must always be confirmed.</p>
    ${cards}
  </body></html>`;
}

// Deterministic ordering: checked_at DESC then id ASC as a stable tiebreaker, so the listing never
// silently reorders between two requests with identical checked_at values.
const ELIGIBLE_OFFERS_QUERY = `
  SELECT id, public_label, provider_name, seller_name, price_amount, currency, price_basis,
         checked_at, region, category, booking_deadline
  FROM deal_exchange_offers
  WHERE publication_decision = 'ELIGIBLE' AND is_synthetic_fixture = 0
  ORDER BY checked_at DESC, id ASC
`;

export async function fetchPublicEligibleOffers(env: Env): Promise<any[]> {
  const rows = await env.DB.prepare(ELIGIBLE_OFFERS_QUERY).all<any>();
  return rows.results ?? [];
}

export function registerPublicListingRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/offers', async (c) => {
    const offers = await fetchPublicEligibleOffers(c.env);
    return c.html(renderListingPage(offers));
  });

  app.get('/', (c) => c.redirect('/offers', 302));
}
