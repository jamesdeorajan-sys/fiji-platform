import { describe, it, expect } from 'vitest';
import { dealExchangeUi } from '../deal-exchange-ui';
import { FakeD1 } from './fake-d1';

// Contact-journey fix (2026-08-28). Reported defect: clicking "Enquire with provider" on either
// Taveuni Palms offer (a mailto: destination) produced an unusable outcome - Chromium silently
// aborts the navigation (net::ERR_ABORTED, zero visitor feedback), and WebKit was observed
// resolving the mailto: URI to a completely different https destination (the provider's own
// marketing site) instead. This file proves the fix: mailto:/tel: destinations now render a
// review page first (no database write on GET) and only record attribution when the visitor
// deliberately submits the confirm form (a real POST) - never on page view, prefetch, or crawl.

function envWithOffer(offer: Record<string, any>) {
  const db = new FakeD1();
  db.table('deal_exchange_offers').push({
    offer_owner_type: 'PROVIDER_DIRECT', seller_id: null, provider_id: 'prov-test',
    canonical_source_url: 'https://fallback.test/page', publication_decision: 'ELIGIBLE',
    seller_name: null, provider_name: 'Test Provider', detected_title: 'Test Offer',
    price_amount: '100', currency: 'USD',
    ...offer,
  });
  return { env: { ENVIRONMENT: 'production', DEAL_EXCHANGE_DB: db, DEAL_EXCHANGE_PUBLIC_ENABLED: 'true' } as any, db };
}

describe('GET /go/deal/:id with a mailto: route renders a review page and writes nothing', () => {
  it('returns 200 HTML, not a redirect', async () => {
    const { env } = envWithOffer({ id: 'off-mailto-1', booking_route: 'mailto:info@example.test' });
    const res = await dealExchangeUi.request('/go/deal/off-mailto-1', {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('creates zero outbound_clicks rows just from viewing the review page', async () => {
    const { env, db } = envWithOffer({ id: 'off-mailto-2', booking_route: 'mailto:info@example.test' });
    await dealExchangeUi.request('/go/deal/off-mailto-2', {}, env);
    expect(db.table('deal_exchange_outbound_clicks').length).toBe(0);
  });

  it('shows the provider name, offer title, and the contact value, but never claims an email was sent', async () => {
    const { env } = envWithOffer({ id: 'off-mailto-3', booking_route: 'mailto:info@example.test', provider_name: 'Example Resort', detected_title: 'Example Package' });
    const res = await dealExchangeUi.request('/go/deal/off-mailto-3', {}, env);
    const body = await res.text();
    expect(body).toContain('Example Resort');
    expect(body).toContain('Example Package');
    expect(body).toContain('info@example.test');
    expect(body.toLowerCase()).not.toMatch(/email (has been |was )?sent/);
    expect(body.toLowerCase()).not.toContain('message sent');
  });

  it('states plainly that the booking is made directly with the provider, not through Vakaviti', async () => {
    const { env } = envWithOffer({ id: 'off-mailto-4', booking_route: 'mailto:info@example.test' });
    const res = await dealExchangeUi.request('/go/deal/off-mailto-4', {}, env);
    const body = await res.text();
    expect(body.toLowerCase()).toContain('directly with the provider');
  });

  it('offers a working "Back to offer" link', async () => {
    const { env } = envWithOffer({ id: 'off-mailto-5', booking_route: 'mailto:info@example.test' });
    const res = await dealExchangeUi.request('/go/deal/off-mailto-5', {}, env);
    const body = await res.text();
    expect(body).toContain('href="/live-deals/off-mailto-5"');
  });

  it('the confirm action is a real POST form, not a GET link (so a prefetcher/crawler cannot trigger it)', async () => {
    const { env } = envWithOffer({ id: 'off-mailto-6', booking_route: 'mailto:info@example.test' });
    const res = await dealExchangeUi.request('/go/deal/off-mailto-6', {}, env);
    const body = await res.text();
    expect(body).toContain('method="POST"');
    expect(body).toContain('action="/go/deal/off-mailto-6/confirm"');
  });

  it('is noindex, matching every other public Deal Exchange page', async () => {
    const { env } = envWithOffer({ id: 'off-mailto-7', booking_route: 'mailto:info@example.test' });
    const res = await dealExchangeUi.request('/go/deal/off-mailto-7', {}, env);
    const body = await res.text();
    expect(body).toContain('name="robots" content="noindex,nofollow"');
  });
});

describe('GET /go/deal/:id with a tel: route also renders a review page, not a redirect', () => {
  it('returns 200 HTML with the phone number and a Call provider action', async () => {
    const { env, db } = envWithOffer({ id: 'off-tel-1', booking_route: 'tel:+6791234567' });
    const res = await dealExchangeUi.request('/go/deal/off-tel-1', {}, env);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('+6791234567');
    expect(body).toContain('Call provider');
    expect(db.table('deal_exchange_outbound_clicks').length).toBe(0);
  });
});

describe('POST /go/deal/:id/confirm records attribution and redirects - the one deliberate-action point', () => {
  it('creates exactly one outbound_clicks row and redirects to the mailto: destination', async () => {
    const { env, db } = envWithOffer({ id: 'off-confirm-1', booking_route: 'mailto:info@example.test' });
    const res = await dealExchangeUi.request('/go/deal/off-confirm-1/confirm', { method: 'POST', redirect: 'manual' } as any, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('mailto:info@example.test');
    expect(db.table('deal_exchange_outbound_clicks').length).toBe(1);
    expect(db.table('deal_exchange_outbound_clicks')[0].outbound_destination).toBe('mailto:info@example.test');
  });

  it('a GET to /confirm is not the write path - only POST records attribution (Hono 404s a GET against a POST-only route)', async () => {
    const { env, db } = envWithOffer({ id: 'off-confirm-2', booking_route: 'mailto:info@example.test' });
    const res = await dealExchangeUi.request('/go/deal/off-confirm-2/confirm', { method: 'GET' }, env);
    expect(res.status).not.toBe(302);
    expect(db.table('deal_exchange_outbound_clicks').length).toBe(0);
  });

  it('re-validates the route on POST and fails closed if it is unsafe, creating no click and no raw-value echo', async () => {
    const badRoute = 'https://example.test/a | tel:12345';
    const { env, db } = envWithOffer({ id: 'off-confirm-bad', booking_route: badRoute });
    const res = await dealExchangeUi.request('/go/deal/off-confirm-bad/confirm', { method: 'POST' }, env);
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).not.toContain(badRoute);
    expect(db.table('deal_exchange_outbound_clicks').length).toBe(0);
  });

  it('a repeated confirm within the same hour/IP is idempotent (still exactly one row)', async () => {
    const { env, db } = envWithOffer({ id: 'off-confirm-3', booking_route: 'mailto:info@example.test' });
    await dealExchangeUi.request('/go/deal/off-confirm-3/confirm', { method: 'POST' }, env);
    await dealExchangeUi.request('/go/deal/off-confirm-3/confirm', { method: 'POST' }, env);
    expect(db.table('deal_exchange_outbound_clicks').length).toBe(1);
  });

  it('a missing offer returns 404, not a redirect', async () => {
    const { env } = envWithOffer({ id: 'off-confirm-real', booking_route: 'mailto:info@example.test' });
    const res = await dealExchangeUi.request('/go/deal/off-confirm-does-not-exist/confirm', { method: 'POST' }, env);
    expect(res.status).toBe(404);
  });
});

describe('https destinations are unaffected - unchanged single-step redirect, no review page', () => {
  it('a plain https booking_route still redirects immediately on GET with exactly one click row', async () => {
    const { env, db } = envWithOffer({ id: 'off-https-1', booking_route: 'https://good.test/book' });
    const res = await dealExchangeUi.request('/go/deal/off-https-1', { redirect: 'manual' } as any, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://good.test/book');
    expect(db.table('deal_exchange_outbound_clicks').length).toBe(1);
  });

  it('a SELLER_PACKAGE https route also still redirects immediately on GET', async () => {
    const { env, db } = envWithOffer({ id: 'off-https-2', offer_owner_type: 'SELLER_PACKAGE', seller_name: 'Test Seller', booking_route: 'https://seller.test/package' });
    const res = await dealExchangeUi.request('/go/deal/off-https-2', { redirect: 'manual' } as any, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://seller.test/package');
    expect(db.table('deal_exchange_outbound_clicks').length).toBe(1);
  });
});
