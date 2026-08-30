// CEO AUTHORIZATION — SECURE INTERNAL ROUTES AND ADD READ-ONLY OFFER LISTING (2026-08-29), Phase 3.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Hono } from 'hono';
import { registerPublicListingRoutes } from '../public-listing';
import { registerEnquiryRoutes } from '../enquiry-routes';

// A generic fake D1 that filters an in-memory offer array the same way the intended query would -
// paired with the source-text assertion below that the real query text actually carries both
// filters, so a regression that silently drops a WHERE clause is caught either way.
class FakeD1 {
  offers: any[];
  writes: any[] = [];
  constructor(offers: any[]) { this.offers = offers; }

  prepare(sql: string) {
    const self = this;
    return {
      _sql: sql, _binds: [] as any[],
      bind(...vals: any[]) { this._binds = vals; return this; },
      async all<T = any>(): Promise<{ results: T[] }> {
        if (self._sql_matches_eligible_query(this._sql)) {
          const eligible = self.offers
            .filter(o => o.publication_decision === 'ELIGIBLE' && o.is_synthetic_fixture === 0)
            .sort((a, b) => (a.checked_at < b.checked_at ? 1 : a.checked_at > b.checked_at ? -1 : (a.id < b.id ? -1 : 1)));
          return { results: eligible as T[] };
        }
        return { results: [] };
      },
      async first<T = any>(): Promise<T | null> {
        if (this._sql.includes('FROM deal_exchange_offers WHERE id=?')) {
          return (self.offers.find(o => o.id === this._binds[0]) as T) ?? null;
        }
        return null;
      },
      async run() {
        self.writes.push({ sql: this._sql, binds: this._binds });
        throw new Error('UNEXPECTED WRITE on a GET-only path: ' + this._sql);
      },
    };
  }

  _sql_matches_eligible_query(sql: string) {
    return sql.includes('FROM deal_exchange_offers') && sql.includes("publication_decision = 'ELIGIBLE'") && sql.includes('is_synthetic_fixture = 0');
  }
}

function buildApp() {
  const app = new Hono<{ Bindings: any }>();
  registerEnquiryRoutes(app);
  registerPublicListingRoutes(app);
  return app;
}

const eligible1 = { id: 'offer-a', publication_decision: 'ELIGIBLE', is_synthetic_fixture: 0, provider_name: 'Malamala Beach Club', seller_name: null, price_amount: '250', currency: 'FJD', price_basis: 'PER_PERSON', checked_at: '2026-08-29T10:00:00Z', region: 'Mamanuca', category: 'Day Cruise', booking_deadline: null, canonical_source_url: 'https://malamala.example/deal' };
const eligible2 = { id: 'offer-b', publication_decision: 'ELIGIBLE', is_synthetic_fixture: 0, provider_name: 'Taveuni Palms Resort', seller_name: null, price_amount: null, currency: null, price_basis: null, checked_at: '2026-08-29T09:00:00Z', region: null, category: null, booking_deadline: '2026-09-30', canonical_source_url: 'https://taveuni.example/deal' };
const eligible3 = { id: 'offer-c', publication_decision: 'ELIGIBLE', is_synthetic_fixture: 0, provider_name: 'Hideaway Holidays', seller_name: 'Hideaway Travel Agency', price_amount: '999', currency: 'AUD', price_basis: 'PER_FAMILY', checked_at: '2026-08-29T08:00:00Z', region: null, category: null, booking_deadline: null, canonical_source_url: 'https://hideaway.example/deal' };
const eligible4 = { id: 'offer-d', publication_decision: 'ELIGIBLE', is_synthetic_fixture: 0, provider_name: 'Malamala Beach Club', seller_name: null, price_amount: '180', currency: 'FJD', price_basis: 'PER_PERSON', checked_at: '2026-08-29T07:00:00Z', region: null, category: null, booking_deadline: null, canonical_source_url: 'https://malamala.example/other-deal' };
const syntheticFixture = { id: 'offer-fixture', publication_decision: 'ELIGIBLE', is_synthetic_fixture: 1, provider_name: 'TEST FIXTURE - DO NOT TREAT AS REAL', seller_name: null, price_amount: null, currency: null, price_basis: null, checked_at: '2026-08-29T11:00:00Z', region: null, category: null, booking_deadline: null, canonical_source_url: 'https://example.com/fixture' };
const reviewRequired = { id: 'offer-review', publication_decision: 'NOT_ELIGIBLE', is_synthetic_fixture: 0, provider_name: 'Unreviewed Provider', seller_name: null, price_amount: null, currency: null, price_basis: null, checked_at: '2026-08-29T06:00:00Z', region: null, category: null, booking_deadline: null, canonical_source_url: 'https://unreviewed.example/deal' };
const quarantined = { id: 'offer-quarantined', publication_decision: 'NOT_ELIGIBLE', is_synthetic_fixture: 0, provider_name: 'Quarantined Provider', seller_name: null, price_amount: null, currency: null, price_basis: null, checked_at: '2026-08-29T05:00:00Z', region: null, category: null, booking_deadline: null, failed_gates_json: '["quarantined_by_freshness_recheck"]', canonical_source_url: 'https://quarantined.example/deal' };

const ALL_OFFERS = [eligible1, eligible2, eligible3, eligible4, syntheticFixture, reviewRequired, quarantined];

describe('GET /offers', () => {
  it('1. shows exactly the four real ELIGIBLE, non-fixture offers', async () => {
    const db = new FakeD1(ALL_OFFERS);
    const app = buildApp();
    const res = await app.request('/offers', {}, { DB: db } as any);
    expect(res.status).toBe(200);
    const html = await res.text();
    for (const p of ['Malamala Beach Club', 'Taveuni Palms Resort', 'Hideaway Holidays']) expect(html).toContain(p);
    const cardCount = (html.match(/class="card"/g) || []).length;
    expect(cardCount).toBe(4);
  });

  it('2. the synthetic fixture never appears', async () => {
    const db = new FakeD1(ALL_OFFERS);
    const app = buildApp();
    const html = await (await app.request('/offers', {}, { DB: db } as any)).text();
    expect(html).not.toContain('TEST FIXTURE');
    expect(html).not.toContain('offer-fixture');
  });

  it('3. review-required (NOT_ELIGIBLE) rows never appear', async () => {
    const db = new FakeD1(ALL_OFFERS);
    const app = buildApp();
    const html = await (await app.request('/offers', {}, { DB: db } as any)).text();
    expect(html).not.toContain('Unreviewed Provider');
  });

  it('4. quarantined rows never appear', async () => {
    const db = new FakeD1(ALL_OFFERS);
    const app = buildApp();
    const html = await (await app.request('/offers', {}, { DB: db } as any)).text();
    expect(html).not.toContain('Quarantined Provider');
  });

  it('never leaks internal gate-failure reasons even though the underlying row carries them', async () => {
    const db = new FakeD1(ALL_OFFERS);
    const app = buildApp();
    const html = await (await app.request('/offers', {}, { DB: db } as any)).text();
    expect(html).not.toContain('quarantined_by_freshness_recheck');
  });

  it('5. each card\'s detail link resolves to a real, working /enquire/:offerId page', async () => {
    const db = new FakeD1(ALL_OFFERS);
    const app = buildApp();
    const html = await (await app.request('/offers', {}, { DB: db } as any)).text();
    for (const id of ['offer-a', 'offer-b', 'offer-c', 'offer-d']) {
      expect(html).toContain(`/enquire/${id}`);
      const detailRes = await app.request(`/enquire/${id}`, {}, { DB: db } as any);
      expect(detailRes.status).toBe(200);
    }
  });

  it('6. GET /offers and GET detail pages create zero writes', async () => {
    const db = new FakeD1(ALL_OFFERS);
    const app = buildApp();
    await app.request('/offers', {}, { DB: db } as any);
    for (const id of ['offer-a', 'offer-b', 'offer-c', 'offer-d']) {
      await app.request(`/enquire/${id}`, {}, { DB: db } as any);
    }
    expect(db.writes.length).toBe(0);
  });

  it('does not fabricate a price for a SPECIAL offer with no resolved price', async () => {
    const db = new FakeD1(ALL_OFFERS);
    const app = buildApp();
    const html = await (await app.request('/offers', {}, { DB: db } as any)).text();
    expect(html).toContain('Price on confirmation');
  });

  it('shows seller only when it differs from provider', async () => {
    const db = new FakeD1(ALL_OFFERS);
    const app = buildApp();
    const html = await (await app.request('/offers', {}, { DB: db } as any)).text();
    expect(html).toContain('Hideaway Travel Agency');
  });

  it('11. HTML/script injection in provider_name is escaped, never executed', async () => {
    const malicious = { ...eligible1, id: 'offer-xss', provider_name: '<script>alert(1)</script>' };
    const db = new FakeD1([malicious]);
    const app = buildApp();
    const html = await (await app.request('/offers', {}, { DB: db } as any)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('12. the page is marked noindex,nofollow', async () => {
    const db = new FakeD1(ALL_OFFERS);
    const app = buildApp();
    const html = await (await app.request('/offers', {}, { DB: db } as any)).text();
    expect(html).toContain('name="robots" content="noindex,nofollow"');
  });

  it('carries a clear preview banner', async () => {
    const db = new FakeD1(ALL_OFFERS);
    const app = buildApp();
    const html = await (await app.request('/offers', {}, { DB: db } as any)).text();
    expect(html.toLowerCase()).toContain('preview');
  });

  it('never makes the provider/source URL the primary CTA (no anchor to the source URL with the CTA class)', async () => {
    const db = new FakeD1(ALL_OFFERS);
    const app = buildApp();
    const html = await (await app.request('/offers', {}, { DB: db } as any)).text();
    // the CTA anchors must point at /enquire/, never at a canonical_source_url
    const ctaHrefs = [...html.matchAll(/class="cta" href="([^"]+)"/g)].map(m => m[1]);
    expect(ctaHrefs.length).toBeGreaterThan(0);
    for (const href of ctaHrefs) expect(href.startsWith('/enquire/')).toBe(true);
  });

  it('13. layout uses a responsive grid with a single-column mobile breakpoint (no fixed multi-column width)', async () => {
    const db = new FakeD1(ALL_OFFERS);
    const app = buildApp();
    const html = await (await app.request('/offers', {}, { DB: db } as any)).text();
    expect(html).toMatch(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(/);
    expect(html).toMatch(/@media \(max-width:\s*480px\)/);
  });

  it('renders "no offers" gracefully with zero eligible rows', async () => {
    const db = new FakeD1([reviewRequired, syntheticFixture]);
    const app = buildApp();
    const res = await app.request('/offers', {}, { DB: db } as any);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('No offers are currently available');
  });
});

describe('GET /', () => {
  it('redirects to /offers', async () => {
    const db = new FakeD1(ALL_OFFERS);
    const app = buildApp();
    const res = await app.request('/', { redirect: 'manual' }, { DB: db } as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/offers');
  });
});

describe('source-text guard: the eligible-offers query text actually carries both required filters', () => {
  it('public-listing.ts\'s query string includes the ELIGIBLE and non-fixture conditions verbatim', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public-listing.ts'), 'utf8');
    expect(src).toContain("publication_decision = 'ELIGIBLE'");
    expect(src).toContain('is_synthetic_fixture = 0');
  });
});
