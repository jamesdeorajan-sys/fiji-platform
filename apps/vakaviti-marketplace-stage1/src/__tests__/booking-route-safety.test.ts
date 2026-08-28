import { describe, it, expect } from 'vitest';
import { validateBookingRoute } from '../booking-route-safety';
import { dealExchangeUi } from '../deal-exchange-ui';
import { FakeD1 } from './fake-d1';

// Regression suite for the booking-route safety hotfix (2026-08-28). Two live production offers
// were found storing a combined "https://... | tel:..." string in booking_route, which
// /go/deal/:id then passed straight into c.redirect() verbatim - an unvalidated HTTP Location
// header on a real booking path. This file proves both halves of the fix: the pure validator
// (write-time gate) and the redirect route's fail-closed behavior (redirect-time gate).

describe('validateBookingRoute - accepts exactly one canonical URI', () => {
  it('accepts a plain https destination', () => {
    const r = validateBookingRoute('https://example-resort.test/book');
    expect(r).toEqual({ ok: true, canonical: 'https://example-resort.test/book', reason: null });
  });

  it('accepts a mailto destination', () => {
    const r = validateBookingRoute('mailto:info@example-resort.test');
    expect(r.ok).toBe(true);
    expect(r.canonical).toBe('mailto:info@example-resort.test');
  });

  it('accepts a tel destination', () => {
    const r = validateBookingRoute('tel:+6799995512');
    expect(r.ok).toBe(true);
    expect(r.canonical).toBe('tel:+6799995512');
  });

  it('accepts null (no route configured) as valid', () => {
    expect(validateBookingRoute(null)).toEqual({ ok: true, canonical: null, reason: null });
  });

  it('accepts undefined the same as null', () => {
    expect(validateBookingRoute(undefined)).toEqual({ ok: true, canonical: null, reason: null });
  });
});

describe('validateBookingRoute - rejects the real production defect and adjacent attacks', () => {
  it('rejects the exact combined value found on off-mf-radisson in production', () => {
    const r = validateBookingRoute(
      'https://myfiji.com/package/radisson-blu-resort-fiji-denarau-island-7-nights-garden-view-one-bedroom-suite-flights-incl/ | tel:1300003454'
    );
    expect(r.ok).toBe(false);
    expect(r.canonical).toBeNull();
  });

  it('rejects the exact combined value found on off-spacifica-sofitel-1 in production', () => {
    const r = validateBookingRoute(
      'https://spacificatravel.com/fiji/package-deals/sofitel-fiji-resort-spa-waitui-plus-beach-club__373 | tel:1800800722 | package code 288911'
    );
    expect(r.ok).toBe(false);
  });

  it('rejects the free-text (non-URI) value found on preview\'s off-spacifica-sofitel-1', () => {
    const r = validateBookingRoute('Phone AU 1800 800 722 / NZ 0800 345 600, or Spacifica Travel enquiry form; package code 288911');
    expect(r.ok).toBe(false);
  });

  it('rejects whitespace-separated combined values without a pipe', () => {
    const r = validateBookingRoute('https://example.test tel:+123456');
    expect(r.ok).toBe(false);
  });

  it('rejects leading/trailing whitespace', () => {
    expect(validateBookingRoute(' https://example.test').ok).toBe(false);
    expect(validateBookingRoute('https://example.test ').ok).toBe(false);
  });

  it('rejects newline / header-injection characters', () => {
    const r = validateBookingRoute('https://example.test\r\nSet-Cookie: evil=1');
    expect(r.ok).toBe(false);
  });

  it('rejects other control characters', () => {
    expect(validateBookingRoute('https://example.test\x00').ok).toBe(false);
    expect(validateBookingRoute('https://example.test\x1b').ok).toBe(false);
  });

  it('rejects javascript: scheme', () => {
    expect(validateBookingRoute('javascript:alert(1)').ok).toBe(false);
  });

  it('rejects data: scheme', () => {
    expect(validateBookingRoute('data:text/html,<script>alert(1)</script>').ok).toBe(false);
  });

  it('rejects file: scheme', () => {
    expect(validateBookingRoute('file:///etc/passwd').ok).toBe(false);
  });

  it('rejects protocol-relative URLs', () => {
    expect(validateBookingRoute('//evil.test/phish').ok).toBe(false);
  });

  it('rejects unsupported schemes (e.g. ftp:)', () => {
    expect(validateBookingRoute('ftp://example.test/file').ok).toBe(false);
  });

  it('rejects malformed/ambiguous URI syntax', () => {
    expect(validateBookingRoute('https://').ok).toBe(false);
    expect(validateBookingRoute('not a url at all').ok).toBe(false);
  });

  it('rejects an empty string (distinct from null)', () => {
    expect(validateBookingRoute('').ok).toBe(false);
  });

  it('rejects a tel: value with embedded letters (not a real number)', () => {
    expect(validateBookingRoute('tel:CALL-NOW').ok).toBe(false);
  });

  it('rejects a mailto: value with more than one address', () => {
    expect(validateBookingRoute('mailto:a@example.test,b@example.test').ok).toBe(false);
  });
});

describe('/go/deal/:id - fail-closed redirect behavior', () => {
  function envWithOffer(offer: Record<string, any>) {
    const db = new FakeD1();
    db.table('deal_exchange_offers').push({
      offer_owner_type: 'PROVIDER_DIRECT', seller_id: null, provider_id: 'prov-test',
      canonical_source_url: 'https://fallback.test/page', publication_decision: 'ELIGIBLE',
      seller_name: null,
      ...offer,
    });
    return { env: { ENVIRONMENT: 'production', DEAL_EXCHANGE_DB: db, DEAL_EXCHANGE_PUBLIC_ENABLED: 'true' } as any, db };
  }

  it('a valid https booking_route redirects and creates exactly one click row', async () => {
    const { env, db } = envWithOffer({ id: 'off-valid-1', booking_route: 'https://good.test/book' });
    const res = await dealExchangeUi.request('/go/deal/off-valid-1', { redirect: 'manual' } as any, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://good.test/book');
    expect(db.table('deal_exchange_outbound_clicks').length).toBe(1);
    expect(db.table('deal_exchange_outbound_clicks')[0].outbound_destination).toBe('https://good.test/book');
  });

  it('the exact malformed production value fails closed: no redirect, no click row, no raw value echoed', async () => {
    const badRoute = 'https://myfiji.com/package/radisson-incl/ | tel:1300003454';
    const { env, db } = envWithOffer({ id: 'off-bad-1', booking_route: badRoute });
    const res = await dealExchangeUi.request('/go/deal/off-bad-1', {}, env);
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).not.toContain(badRoute);
    expect(body).not.toContain('tel:1300003454');
    expect(db.table('deal_exchange_outbound_clicks').length).toBe(0);
  });

  it('a missing offer still returns 404 (unrelated to route validation)', async () => {
    const { env } = envWithOffer({ id: 'off-real-1', booking_route: 'https://good.test/book' });
    const res = await dealExchangeUi.request('/go/deal/off-does-not-exist', {}, env);
    expect(res.status).toBe(404);
  });

  it('falls back to canonical_source_url when booking_route is null, and validates that too', async () => {
    const { env, db } = envWithOffer({ id: 'off-fallback-1', booking_route: null, canonical_source_url: 'https://fallback.test/page' });
    const res = await dealExchangeUi.request('/go/deal/off-fallback-1', { redirect: 'manual' } as any, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://fallback.test/page');
    expect(db.table('deal_exchange_outbound_clicks')[0].outbound_destination).toBe('https://fallback.test/page');
  });

  it('a repeated request within the same hour/IP is idempotent (still exactly one click row)', async () => {
    const { env, db } = envWithOffer({ id: 'off-repeat-1', booking_route: 'https://good.test/book' });
    await dealExchangeUi.request('/go/deal/off-repeat-1', {}, env);
    await dealExchangeUi.request('/go/deal/off-repeat-1', {}, env);
    expect(db.table('deal_exchange_outbound_clicks').length).toBe(1);
  });
});
