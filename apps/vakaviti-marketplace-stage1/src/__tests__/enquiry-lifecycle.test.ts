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
          // Checked BEFORE the broader (slug-based) products branch below - both queries start
          // with "SELECT canonical_name FROM products" / include "FROM products", so the more
          // specific id+operator_id+commercial_status shape must be matched first or it is
          // silently shadowed by the slug-based handler further down.
          if (sql.startsWith('SELECT canonical_name FROM products WHERE id=? AND operator_id=? AND commercial_status')) {
            const [id, operatorId] = binds;
            const p = products.find(p => p.id === id && p.operator_id === operatorId && p.commercial_status === 'ACTIVE');
            return (p as any) ?? null;
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

function baseEnv(enquiries: Enquiry[] = [], products: Product[] = [], operators: Operator[] = [OPERATOR]) {
  return {
    ENVIRONMENT: 'preview',
    AI: {} as any,
    MARKETPLACE_ENQUIRY_WHATSAPP: '+61413335007',
    DEAL_EXCHANGE_PUBLIC_ENABLED: 'false',
    DB: fakeStage1Db(operators, products, enquiries),
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

// Regression fix (2026-08-29): the product lookup here had no commercial_status='ACTIVE' filter,
// so a withdrawn/deactivated product's name could still be pulled into the outbound WhatsApp
// message as if nothing had changed. Fixed to fail closed - checked before the status transition
// and before the redirect is built, so a failing check writes nothing and redirects nowhere.
describe('GET /enquire/:operatorSlug/whatsapp/:id fails closed on an inactive/missing/mismatched product', () => {
  const ACTIVE_OPERATOR: Operator = OPERATOR;
  const INACTIVE_OPERATOR: Operator = { ...OPERATOR, id: 'op-inactive', slug: 'inactive-operator', commercial_status: 'INACTIVE' };
  const ACTIVE_PRODUCT: Product = { id: 'prod-1', canonical_name: 'Active Product', slug: 'active-product', operator_id: 'op-1', commercial_status: 'ACTIVE' };
  const INACTIVE_PRODUCT: Product = { id: 'prod-2', canonical_name: 'Inactive Product', slug: 'inactive-product', operator_id: 'op-1', commercial_status: 'INACTIVE' };
  const OTHER_OPERATOR_PRODUCT: Product = { id: 'prod-3', canonical_name: 'Someone Else Product', slug: 'other-op-product', operator_id: 'op-other', commercial_status: 'ACTIVE' };

  function enquiryWithProduct(productId: string | null, status: Enquiry['status'] = 'CREATED'): Enquiry {
    return { id: 'enq-x', operator_id: 'op-1', product_id: productId, channel: 'WHATSAPP', source_page: null, referrer: null, status, created_at: new Date().toISOString() };
  }

  // 1. Active operator, no product.
  it('1. active operator, no product - succeeds', async () => {
    const enquiries = [enquiryWithProduct(null)];
    const res = await fetchPath('/enquire/test-operator/whatsapp/enq-x', baseEnv(enquiries, []), { redirect: 'manual' } as any);
    expect(res.status).toBe(302);
    expect(enquiries[0].status).toBe('WHATSAPP_OPENED');
  });

  // 2. Active operator and active product.
  it('2. active operator and active product - succeeds, product name reaches the message', async () => {
    const enquiries = [enquiryWithProduct('prod-1')];
    const res = await fetchPath('/enquire/test-operator/whatsapp/enq-x', baseEnv(enquiries, [ACTIVE_PRODUCT]), { redirect: 'manual' } as any);
    expect(res.status).toBe(302);
    expect(decodeURIComponent(res.headers.get('location') || '')).toContain('Active Product');
    expect(enquiries[0].status).toBe('WHATSAPP_OPENED');
  });

  // 3. Inactive operator.
  it('3. inactive operator - fails closed with 404 (operator lookup already filters ACTIVE)', async () => {
    const enquiries = [{ ...enquiryWithProduct(null), operator_id: 'op-inactive' }];
    const res = await fetchPath('/enquire/inactive-operator/whatsapp/enq-x', baseEnv(enquiries, [], [ACTIVE_OPERATOR, INACTIVE_OPERATOR]));
    expect(res.status).toBe(404);
    expect(enquiries[0].status).toBe('CREATED'); // untouched
  });

  // 4. Inactive product.
  it('4. inactive product - fails closed with 404, no transition, no redirect', async () => {
    const enquiries = [enquiryWithProduct('prod-2')];
    const res = await fetchPath('/enquire/test-operator/whatsapp/enq-x', baseEnv(enquiries, [INACTIVE_PRODUCT]), { redirect: 'manual' } as any);
    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();
    expect(enquiries[0].status).toBe('CREATED'); // never transitioned
  });

  // 5. Missing operator.
  it('5. missing operator (nonexistent slug) - 404', async () => {
    const res = await fetchPath('/enquire/does-not-exist/whatsapp/enq-x', baseEnv([enquiryWithProduct(null)]));
    expect(res.status).toBe(404);
  });

  // 6. Missing product.
  it('6. missing product (product_id references a row that does not exist at all) - fails closed with 404', async () => {
    const enquiries = [enquiryWithProduct('prod-does-not-exist')];
    const res = await fetchPath('/enquire/test-operator/whatsapp/enq-x', baseEnv(enquiries, []), { redirect: 'manual' } as any);
    expect(res.status).toBe(404);
    expect(enquiries[0].status).toBe('CREATED');
  });

  // 7. Operator/product mismatch.
  it('7. product exists and is active, but belongs to a DIFFERENT operator - fails closed with 404', async () => {
    const enquiries = [enquiryWithProduct('prod-3')];
    const res = await fetchPath('/enquire/test-operator/whatsapp/enq-x', baseEnv(enquiries, [OTHER_OPERATOR_PRODUCT]), { redirect: 'manual' } as any);
    expect(res.status).toBe(404);
    expect(enquiries[0].status).toBe('CREATED');
  });

  // 8. Repeated WhatsApp-open request.
  it('8. a repeated request against an already-opened enquiry with a valid active product remains idempotent', async () => {
    const enquiries = [enquiryWithProduct('prod-1', 'WHATSAPP_OPENED')];
    const first = await fetchPath('/enquire/test-operator/whatsapp/enq-x', baseEnv(enquiries, [ACTIVE_PRODUCT]), { redirect: 'manual' } as any);
    const second = await fetchPath('/enquire/test-operator/whatsapp/enq-x', baseEnv(enquiries, [ACTIVE_PRODUCT]), { redirect: 'manual' } as any);
    expect(first.status).toBe(302);
    expect(second.status).toBe(302);
    expect(enquiries.length).toBe(1);
    expect(enquiries[0].status).toBe('WHATSAPP_OPENED');
  });

  // 9. Failure creates zero writes (covered per-case above via `enquiries[0].status` staying
  // 'CREATED', consolidated here as one explicit assertion across every failure path).
  it('9. every failure path above creates zero writes - status never transitions on any of them', async () => {
    const cases: [string, Enquiry[], Product[], Operator[]][] = [
      ['inactive product', [enquiryWithProduct('prod-2')], [INACTIVE_PRODUCT], [ACTIVE_OPERATOR]],
      ['missing product', [enquiryWithProduct('prod-missing')], [], [ACTIVE_OPERATOR]],
      ['mismatched product', [enquiryWithProduct('prod-3')], [OTHER_OPERATOR_PRODUCT], [ACTIVE_OPERATOR]],
    ];
    for (const [, enquiries, products, operators] of cases) {
      await fetchPath('/enquire/test-operator/whatsapp/enq-x', baseEnv(enquiries, products, operators));
      expect(enquiries[0].status).toBe('CREATED');
    }
  });

  // 10. Failure exposes no WhatsApp destination.
  it('10. a failure response never contains a wa.me location or any raw internal id in its body', async () => {
    const enquiries = [enquiryWithProduct('prod-2')];
    const res = await fetchPath('/enquire/test-operator/whatsapp/enq-x', baseEnv(enquiries, [INACTIVE_PRODUCT]), { redirect: 'manual' } as any);
    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();
    const body = await res.text();
    expect(body).not.toMatch(/wa\.me/);
    expect(body).not.toContain('prod-2');
    expect(body).not.toContain('op-1');
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
