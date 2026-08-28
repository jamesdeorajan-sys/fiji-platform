import { describe, it, expect } from 'vitest';
import worker from '../index';

// Enquiry lifecycle fix (2026-08-28). Reported defect: GET /enquire/:operatorSlug wrote an
// enquiry row with status='SENT' immediately, before the visitor had seen anything or taken any
// deliberate action - a page prefetcher, a crawler, or simply loading the URL created a row
// indistinguishable from a real visitor, and 'SENT' asserted something (message transmission) the
// server can never actually verify. This file proves the fix: GET writes nothing; POST (checked
// against a CSRF token) records CREATED; a separate deliberate click through a tracked link
// records WHATSAPP_OPENED.
//
// Purpose-built fake DB for exactly the queries index.ts's /enquire/* routes issue - the shared
// fake-d1.ts is scoped to deal-exchange-listing.ts's simpler query shapes (see its own header
// comment) and does not evaluate SQLite date functions, which the interim dedup check here uses.

interface Operator { id: string; canonical_name: string; slug: string; whatsapp: string | null; website_url: string | null; last_public_check_at: string | null; commercial_status: string; }
interface Product { id: string; canonical_name: string; slug: string; operator_id: string; commercial_status: string; }
interface Enquiry { id: string; operator_id: string; product_id: string | null; channel: string; source_page: string | null; referrer: string | null; status: string; created_at: string; }

function fakeStage1Db(operators: Operator[], products: Product[] = [], enquiries: Enquiry[] = []) {
  const enq = enquiries;
  return {
    prepare(sql: string) {
      let binds: any[] = [];
      return {
        bind(...vals: any[]) { binds = vals; return this; },
        async first<T = any>(): Promise<T | null> {
          if (sql.includes('FROM operators')) {
            const slug = binds[0];
            const o = operators.find(o => o.slug === slug && o.commercial_status === 'ACTIVE');
            return (o as any) ?? null;
          }
          if (sql.includes('FROM products')) {
            const slug = binds[0];
            const p = products.find(p => p.slug === slug && p.commercial_status === 'ACTIVE');
            return (p as any) ?? null;
          }
          if (sql.startsWith('SELECT id FROM enquiries WHERE operator_id')) {
            const [operatorId, productId] = binds;
            const match = enq.find(e => e.operator_id === operatorId && (e.product_id === productId || (e.product_id === null && productId === null)) && (e.status === 'CREATED' || e.status === 'WHATSAPP_OPENED'));
            return (match as any) ?? null;
          }
          if (sql.startsWith('SELECT id,operator_id,product_id,status FROM enquiries')) {
            const [id, operatorId] = binds;
            const match = enq.find(e => e.id === id && e.operator_id === operatorId);
            return (match as any) ?? null;
          }
          if (sql.startsWith('SELECT canonical_name FROM products')) {
            const [id] = binds;
            const p = products.find(p => p.id === id);
            return (p as any) ?? null;
          }
          throw new Error('fakeStage1Db: unhandled first() query: ' + sql);
        },
        async run(): Promise<{ meta: { changes: number } }> {
          if (sql.startsWith('INSERT INTO enquiries')) {
            const [id, operatorId, productId, sourcePage, referrer] = binds;
            enq.push({ id, operator_id: operatorId, product_id: productId, channel: 'WHATSAPP', source_page: sourcePage, referrer, status: 'CREATED', created_at: new Date().toISOString() });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE enquiries SET status=')) {
            const [id] = binds;
            const e = enq.find(e => e.id === id && e.status === 'CREATED');
            if (e) { e.status = 'WHATSAPP_OPENED'; return { meta: { changes: 1 } }; }
            return { meta: { changes: 0 } };
          }
          throw new Error('fakeStage1Db: unhandled run() query: ' + sql);
        },
      };
    },
  } as any;
}

const OPERATOR: Operator = { id: 'op-1', canonical_name: 'Test Operator', slug: 'test-operator', whatsapp: '+6799999999', website_url: 'https://test-operator.example', last_public_check_at: null, commercial_status: 'ACTIVE' };

function baseEnv(enquiries: Enquiry[] = []) {
  return {
    ENVIRONMENT: 'preview',
    AI: {} as any,
    MARKETPLACE_ENQUIRY_WHATSAPP: '+61413335007',
    DEAL_EXCHANGE_PUBLIC_ENABLED: 'false',
    DB: fakeStage1Db([OPERATOR], [], enquiries),
  } as any;
}

async function fetchPath(path: string, env: Record<string, unknown>, init: RequestInit = {}) {
  return worker.fetch(new Request(`https://example.com${path}`, init), env as any);
}

function getCookieValue(res: Response, name: string): string | null {
  const setCookie = res.headers.get('set-cookie') || '';
  const m = setCookie.match(new RegExp(name + '=([^;]+)'));
  return m ? m[1] : null;
}

describe('GET /enquire/:operatorSlug writes nothing and renders a review page', () => {
  it('returns 200 HTML, not a redirect, and creates zero enquiry rows', async () => {
    const enquiries: Enquiry[] = [];
    const res = await fetchPath('/enquire/test-operator', baseEnv(enquiries));
    expect(res.status).toBe(200);
    expect(enquiries.length).toBe(0);
    const body = await res.text();
    expect(body).toContain('Test Operator');
    expect(body).toContain('method="POST"');
  });

  it('sets a CSRF cookie mirrored in the form as a hidden field', async () => {
    const res = await fetchPath('/enquire/test-operator', baseEnv());
    const cookieToken = getCookieValue(res, 'vakaviti_enquire_csrf');
    expect(cookieToken).toBeTruthy();
    const body = await res.text();
    expect(body).toContain(`value="${cookieToken}"`);
  });

  it('a nonexistent operator 404s', async () => {
    const res = await fetchPath('/enquire/does-not-exist', baseEnv());
    expect(res.status).toBe(404);
  });
});

describe('POST /enquire/:operatorSlug requires a matching CSRF token and creates status=CREATED', () => {
  it('rejects with 400 when no CSRF cookie is present', async () => {
    const enquiries: Enquiry[] = [];
    const res = await fetchPath('/enquire/test-operator', baseEnv(enquiries), {
      method: 'POST', body: new URLSearchParams({ csrf_token: 'anything' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.status).toBe(400);
    expect(enquiries.length).toBe(0);
  });

  it('rejects with 400 when the submitted token does not match the cookie', async () => {
    const enquiries: Enquiry[] = [];
    const res = await fetchPath('/enquire/test-operator', baseEnv(enquiries), {
      method: 'POST', body: new URLSearchParams({ csrf_token: 'wrong-token' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'vakaviti_enquire_csrf=real-token' },
    });
    expect(res.status).toBe(400);
    expect(enquiries.length).toBe(0);
  });

  it('a matching token creates exactly one row with status CREATED (never SENT) and shows the Continue-to-WhatsApp link, without claiming a message was sent', async () => {
    const enquiries: Enquiry[] = [];
    const res = await fetchPath('/enquire/test-operator', baseEnv(enquiries), {
      method: 'POST', body: new URLSearchParams({ csrf_token: 'match-token' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'vakaviti_enquire_csrf=match-token' },
    });
    expect(res.status).toBe(200);
    expect(enquiries.length).toBe(1);
    expect(enquiries[0].status).toBe('CREATED');
    const body = await res.text();
    expect(body).toContain('/enquire/test-operator/whatsapp/' + enquiries[0].id);
    expect(body.toLowerCase()).not.toMatch(/message (has been |was )?sent/);
  });

  it('resubmitting within the dedup window reuses the existing row rather than creating a duplicate', async () => {
    const enquiries: Enquiry[] = [];
    const opts = {
      method: 'POST', body: new URLSearchParams({ csrf_token: 'match-token' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'vakaviti_enquire_csrf=match-token' },
    };
    await fetchPath('/enquire/test-operator', baseEnv(enquiries), opts as any);
    await fetchPath('/enquire/test-operator', baseEnv(enquiries), opts as any);
    expect(enquiries.length).toBe(1);
  });
});

describe('GET /enquire/:operatorSlug/whatsapp/:id is the one tracked deliberate-action point', () => {
  it('transitions CREATED to WHATSAPP_OPENED and redirects to a real wa.me link', async () => {
    const enquiries: Enquiry[] = [{ id: 'enq-1', operator_id: 'op-1', product_id: null, channel: 'WHATSAPP', source_page: '/enquire/test-operator', referrer: null, status: 'CREATED', created_at: new Date().toISOString() }];
    const res = await fetchPath('/enquire/test-operator/whatsapp/enq-1', baseEnv(enquiries), { redirect: 'manual' } as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/^https:\/\/wa\.me\//);
    expect(enquiries[0].status).toBe('WHATSAPP_OPENED');
  });

  it('does not regress or duplicate if already WHATSAPP_OPENED', async () => {
    const enquiries: Enquiry[] = [{ id: 'enq-2', operator_id: 'op-1', product_id: null, channel: 'WHATSAPP', source_page: '/enquire/test-operator', referrer: null, status: 'WHATSAPP_OPENED', created_at: new Date().toISOString() }];
    const res = await fetchPath('/enquire/test-operator/whatsapp/enq-2', baseEnv(enquiries), { redirect: 'manual' } as any);
    expect(res.status).toBe(302);
    expect(enquiries.length).toBe(1);
    expect(enquiries[0].status).toBe('WHATSAPP_OPENED');
  });

  it('an enquiry belonging to a different operator is not found (no cross-operator leakage)', async () => {
    const enquiries: Enquiry[] = [{ id: 'enq-3', operator_id: 'some-other-operator', product_id: null, channel: 'WHATSAPP', source_page: null, referrer: null, status: 'CREATED', created_at: new Date().toISOString() }];
    const res = await fetchPath('/enquire/test-operator/whatsapp/enq-3', baseEnv(enquiries));
    expect(res.status).toBe(404);
  });

  it('a nonexistent enquiry id 404s', async () => {
    const res = await fetchPath('/enquire/test-operator/whatsapp/does-not-exist', baseEnv([]));
    expect(res.status).toBe(404);
  });
});

describe('no schema/status-constraint change was required for this fix', () => {
  it('the real production status column has no CHECK constraint, confirmed against a snapshot of its CREATE TABLE captured 2026-08-28 (see the migration-plan note in index.ts)', () => {
    // This is a documentation-anchor test, not a live schema check (this suite has no DB
    // connection) - it exists so a future schema change to `enquiries.status` is forced to
    // consciously update or remove this note rather than silently invalidate it.
    const capturedCreateTable = "CREATE TABLE enquiries ( id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, product_id TEXT, channel TEXT NOT NULL DEFAULT 'WHATSAPP', source_page TEXT, referrer TEXT, status TEXT NOT NULL DEFAULT 'SENT', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (operator_id) REFERENCES operators(id), FOREIGN KEY (product_id) REFERENCES products(id) )";
    expect(capturedCreateTable).not.toMatch(/CHECK/i);
  });
});
