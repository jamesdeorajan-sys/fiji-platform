import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { registerEnquiryRoutes } from '../enquiry-routes';

// Minimal in-memory D1 fake supporting exactly the query shapes enquiry-routes.ts issues.
class FakeD1 {
  offers = new Map<string, any>();
  enquiries = new Map<string, any>();

  prepare(sql: string) {
    const self = this;
    return {
      _sql: sql, _binds: [] as any[],
      bind(...vals: any[]) { this._binds = vals; return this; },
      async first<T = any>(): Promise<T | null> {
        const s = this._sql;
        if (s.includes('FROM deal_exchange_offers WHERE id=?')) {
          return (self.offers.get(this._binds[0]) as T) ?? null;
        }
        if (s.includes('FROM vakaviti_enquiries WHERE offer_id=?')) {
          const offerId = this._binds[0];
          const rows = [...self.enquiries.values()].filter(e => e.offer_id === offerId && ['CREATED', 'WHATSAPP_OPENED'].includes(e.status));
          return (rows[0] as T) ?? null;
        }
        if (s.includes('FROM vakaviti_enquiries WHERE id=? AND offer_id=?')) {
          const [id, offerId] = this._binds;
          const row = self.enquiries.get(id);
          return (row && row.offer_id === offerId ? row : null) as T | null;
        }
        return null;
      },
      async run(): Promise<{ meta: { changes: number } }> {
        const s = this._sql;
        if (s.startsWith('INSERT INTO vakaviti_enquiries')) {
          const [id, offer_id, provider_name, seller_name, price_copy, source_url, visitor_name, visitor_contact, idempotency_key] = this._binds;
          self.enquiries.set(id, { id, offer_id, provider_name, seller_name, price_copy, source_url, visitor_name, visitor_contact, status: 'CREATED', created_at: new Date().toISOString(), idempotency_key });
          return { meta: { changes: 1 } };
        }
        if (s.startsWith("UPDATE vakaviti_enquiries SET status='WHATSAPP_OPENED'")) {
          const [id] = this._binds;
          const row = self.enquiries.get(id);
          if (row && row.status === 'CREATED') { row.status = 'WHATSAPP_OPENED'; return { meta: { changes: 1 } }; }
          return { meta: { changes: 0 } };
        }
        return { meta: { changes: 0 } };
      },
    };
  }
}

function buildApp() {
  const app = new Hono<{ Bindings: any }>();
  registerEnquiryRoutes(app);
  return app;
}

const eligibleOffer = {
  id: 'offer-1', publication_decision: 'ELIGIBLE', provider_name: 'Test Provider', seller_name: null,
  price_amount: '199', currency: 'FJD', price_basis: 'PER_PERSON', checked_at: '2026-08-29T00:00:00Z',
  canonical_source_url: 'https://provider.example/deal',
};

function extractCsrf(html: string): { cookie: string; token: string } {
  const setCookieMatch = html.match(/vakaviti_offer_enquiry_csrf=([^;]+)/);
  return { cookie: setCookieMatch ? setCookieMatch[1] : '', token: '' };
}

describe('GET /enquire/:offerId', () => {
  it('renders the review page with zero writes and correct fields, and creates a CSRF cookie', async () => {
    const db = new FakeD1();
    db.offers.set('offer-1', eligibleOffer);
    const app = buildApp();
    const res = await app.request('/enquire/offer-1', {}, { DB: db } as any);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Ask Vakaviti about this offer');
    expect(html).toContain('Vakaviti helps you review this publicly advertised offer');
    expect(html).toContain('Test Provider');
    expect(html).toContain('FJD 199 (PER_PERSON)');
    expect(html).toContain('View original offer');
    expect(html).toContain('https://provider.example/deal');
    expect(res.headers.get('set-cookie')).toMatch(/vakaviti_offer_enquiry_csrf=/);
    expect(db.enquiries.size).toBe(0); // rule test 9: GET creates zero enquiry rows
  });

  it('SPECIAL offers with no resolved price show "Price on confirmation", never a fabricated figure', async () => {
    const db = new FakeD1();
    db.offers.set('offer-2', { ...eligibleOffer, id: 'offer-2', price_amount: null, currency: null, price_basis: null });
    const app = buildApp();
    const res = await app.request('/enquire/offer-2', {}, { DB: db } as any);
    const html = await res.text();
    expect(html).toContain('Price on confirmation');
  });

  it('never claims the offer is booked, sent, delivered, or availability-confirmed anywhere in the review copy', async () => {
    const db = new FakeD1();
    db.offers.set('offer-1', eligibleOffer);
    const app = buildApp();
    const html = await (await app.request('/enquire/offer-1', {}, { DB: db } as any)).text();
    // Word-boundary matches, not substrings - "consent" legitimately contains "sent" as a substring.
    for (const forbidden of [/\bsent\b/i, /\bdelivered\b/i, /\bbooked\b/i, /availability (?:is|has been) confirmed/i]) {
      expect(forbidden.test(html)).toBe(false);
    }
  });

  it('a non-ELIGIBLE or nonexistent offer 404s and writes nothing', async () => {
    const db = new FakeD1();
    db.offers.set('offer-3', { ...eligibleOffer, id: 'offer-3', publication_decision: 'NOT_ELIGIBLE' });
    const app = buildApp();
    const res1 = await app.request('/enquire/offer-3', {}, { DB: db } as any);
    expect(res1.status).toBe(404);
    const res2 = await app.request('/enquire/does-not-exist', {}, { DB: db } as any);
    expect(res2.status).toBe(404);
  });

  it('repeated GET/crawl/prefetch of the same offer still creates zero rows after multiple visits', async () => {
    const db = new FakeD1();
    db.offers.set('offer-1', eligibleOffer);
    const app = buildApp();
    for (let i = 0; i < 5; i++) await app.request('/enquire/offer-1', {}, { DB: db } as any);
    expect(db.enquiries.size).toBe(0);
  });
});

describe('POST /enquire/:offerId', () => {
  async function getReviewPageAndCsrf(app: Hono<any>, db: FakeD1, offerId: string) {
    const res = await app.request(`/enquire/${offerId}`, {}, { DB: db } as any);
    const setCookie = res.headers.get('set-cookie') || '';
    const token = setCookie.match(/vakaviti_offer_enquiry_csrf=([^;]+)/)?.[1] || '';
    return { cookie: `vakaviti_offer_enquiry_csrf=${token}`, token };
  }

  it('rejects a POST with no CSRF cookie/token', async () => {
    const db = new FakeD1();
    db.offers.set('offer-1', eligibleOffer);
    const app = buildApp();
    const res = await app.request('/enquire/offer-1', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'consent=yes',
    }, { DB: db } as any);
    expect(res.status).toBe(400);
    expect(db.enquiries.size).toBe(0);
  });

  it('a matching CSRF token + consent creates exactly ONE CREATED row - never claims SENT', async () => {
    const db = new FakeD1();
    db.offers.set('offer-1', eligibleOffer);
    const app = buildApp();
    const { cookie, token } = await getReviewPageAndCsrf(app, db, 'offer-1');
    const res = await app.request('/enquire/offer-1', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: `csrf_token=${token}&consent=yes&visitor_name=Alice`,
    }, { DB: db } as any);
    expect(res.status).toBe(200);
    expect(db.enquiries.size).toBe(1);
    const [enquiry] = [...db.enquiries.values()];
    expect(enquiry.status).toBe('CREATED');
    const html = await res.text();
    expect(html.toLowerCase()).not.toContain('sent');
    expect(html.toLowerCase()).not.toContain('delivered');
  });

  // Rule test 10: deliberate POST is idempotent (resubmission within the window reuses the row).
  it('10. resubmitting the same offer POST twice within the window creates only ONE row, not two', async () => {
    const db = new FakeD1();
    db.offers.set('offer-1', eligibleOffer);
    const app = buildApp();
    const { cookie, token } = await getReviewPageAndCsrf(app, db, 'offer-1');
    const formBody = `csrf_token=${token}&consent=yes`;
    await app.request('/enquire/offer-1', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body: formBody }, { DB: db } as any);
    await app.request('/enquire/offer-1', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body: formBody }, { DB: db } as any);
    expect(db.enquiries.size).toBe(1);
  });

  it('rejects a POST without consent', async () => {
    const db = new FakeD1();
    db.offers.set('offer-1', eligibleOffer);
    const app = buildApp();
    const { cookie, token } = await getReviewPageAndCsrf(app, db, 'offer-1');
    const res = await app.request('/enquire/offer-1', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body: `csrf_token=${token}`,
    }, { DB: db } as any);
    expect(res.status).toBe(400);
    expect(db.enquiries.size).toBe(0);
  });
});

describe('GET /enquire/:offerId/whatsapp/:enquiryId', () => {
  it('transitions CREATED -> WHATSAPP_OPENED and redirects to the ONE central Vakaviti number, never a provider number', async () => {
    const db = new FakeD1();
    db.offers.set('offer-1', eligibleOffer);
    db.enquiries.set('enq-1', { id: 'enq-1', offer_id: 'offer-1', status: 'CREATED', provider_name: 'Test Provider', price_copy: 'FJD 199', source_url: 'https://provider.example/deal' });
    const app = buildApp();
    const res = await app.request('/enquire/offer-1/whatsapp/enq-1', { redirect: 'manual' }, { DB: db } as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('wa.me/61478886145');
    expect(db.enquiries.get('enq-1')!.status).toBe('WHATSAPP_OPENED');
  });

  it('is idempotent - a second visit to an already-opened link does not error and status stays WHATSAPP_OPENED', async () => {
    const db = new FakeD1();
    db.offers.set('offer-1', eligibleOffer);
    db.enquiries.set('enq-1', { id: 'enq-1', offer_id: 'offer-1', status: 'CREATED', provider_name: 'Test Provider', price_copy: 'FJD 199', source_url: 'https://provider.example/deal' });
    const app = buildApp();
    await app.request('/enquire/offer-1/whatsapp/enq-1', { redirect: 'manual' }, { DB: db } as any);
    const res2 = await app.request('/enquire/offer-1/whatsapp/enq-1', { redirect: 'manual' }, { DB: db } as any);
    expect(res2.status).toBe(302);
    expect(db.enquiries.get('enq-1')!.status).toBe('WHATSAPP_OPENED');
  });

  it('the redirect DESTINATION is wa.me only - never the provider\'s own site or a private phone/email pulled from provider data', async () => {
    const db = new FakeD1();
    db.offers.set('offer-1', eligibleOffer);
    db.enquiries.set('enq-1', { id: 'enq-1', offer_id: 'offer-1', status: 'CREATED', provider_name: 'Test Provider', price_copy: 'FJD 199', source_url: 'https://provider.example/deal' });
    const app = buildApp();
    const res = await app.request('/enquire/offer-1/whatsapp/enq-1', { redirect: 'manual' }, { DB: db } as any);
    const location = res.headers.get('location') || '';
    // The public source_url legitimately appears IN the pre-filled message text (citing the public
    // evidence page, required by Phase 7B) - what must never happen is the browser being sent
    // anywhere other than wa.me itself.
    expect(new URL(location).hostname).toBe('wa.me');
    expect(new URL(location).pathname).toBe('/61478886145');
  });
});
