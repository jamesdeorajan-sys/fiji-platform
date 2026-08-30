// CEO AUTHORIZATION — IMPLEMENT MEDIA ACCURACY AND FALLBACK SYSTEM (2026-08-29/30), Phase 3.
// End-to-end proof (real Hono app, real index.ts route handlers) for each of the 4 named entity
// decisions, against fake D1 rows shaped like the real production data queried during the Phase 0
// audit (exact slugs, exact photo files previously assigned).
import { describe, it, expect } from 'vitest';
import worker from '../index';

const OPERATORS: Record<string, any> = {
  'intercontinental-fiji-golf-resort-spa-4b89448f': {
    id: 'op-ic', canonical_name: 'InterContinental Fiji Golf Resort & Spa', slug: 'intercontinental-fiji-golf-resort-spa-4b89448f',
    locality: 'Natadola Bay', region: 'Coral Coast, Viti Levu', country_code: 'FJ', commercial_status: 'ACTIVE',
    verification_status: 'NOT_VERIFIED', image_url: null, last_public_check_at: '2026-08-29 08:00:38',
    website_url: 'https://fiji.intercontinental.com/', description: null,
  },
  'south-sea-cruises-20bdfc25': {
    id: 'op-ssc', canonical_name: 'South Sea Cruises', slug: 'south-sea-cruises-20bdfc25',
    locality: 'Nadi', region: 'Fiji', country_code: 'FJ', commercial_status: 'ACTIVE',
    verification_status: 'NOT_VERIFIED', image_url: null, last_public_check_at: '2026-08-29 12:00:39',
    website_url: 'https://southseacruisesfiji.com/', description: null,
  },
  'nadi-airport-transfers': {
    id: 'op-nat', canonical_name: 'Nadi Airport Transfers', slug: 'nadi-airport-transfers',
    locality: 'Nadi', region: 'Denarau and surrounding Fiji tourism areas', country_code: 'FJ', commercial_status: 'ACTIVE',
    verification_status: 'NOT_VERIFIED', image_url: null, last_public_check_at: null,
    website_url: null, description: null,
  },
  'blue-lagoon-beach-resort': {
    id: 'op-blr', canonical_name: 'Blue Lagoon Beach Resort', slug: 'blue-lagoon-beach-resort',
    locality: 'Nacula Island', region: 'Yasawa Islands', country_code: 'FJ', commercial_status: 'ACTIVE',
    verification_status: 'NOT_VERIFIED', image_url: null, last_public_check_at: null,
    website_url: null, description: null,
  },
};

function fakeD1ForOperator(slug: string) {
  return {
    prepare(sql: string) {
      const self = this;
      return {
        _binds: [] as any[],
        bind(...vals: any[]) { this._binds = vals; return this; },
        async first<T = any>(): Promise<T | null> {
          if (sql.includes('FROM operators WHERE slug=?')) return (OPERATORS[slug] as T) ?? null;
          if (sql.includes('FROM provider_ceo_confirmations')) return null; // never a pilot partner in this test
          return null;
        },
        async all<T = any>(): Promise<{ results: T[] }> {
          if (sql.includes('FROM products WHERE operator_id=?')) return { results: [] }; // product rendering covered separately
          return { results: [] };
        },
        async run() { return { meta: { changes: 0 } }; },
      };
    },
  } as any;
}

const baseEnv = { ENVIRONMENT: 'preview', AI: {} as any, ADMIN_TOKEN: 'test-admin-token', DEAL_EXCHANGE_PUBLIC_ENABLED: 'false' };

async function getOperatorPage(slug: string) {
  const res = await worker.fetch(new Request(`https://example.com/operators/${slug}`), { ...baseEnv, DB: fakeD1ForOperator(slug) } as any);
  return { res, html: await res.text() };
}

describe('Phase 3 entity decisions', () => {
  it('InterContinental Fiji Golf Resort & Spa: BRANDED_FALLBACK accommodation visual, no photo, no "I" hero', async () => {
    const { res, html } = await getOperatorPage('intercontinental-fiji-golf-resort-spa-4b89448f');
    expect(res.status).toBe(200);
    expect(html).toContain('<svg');
    expect(html).not.toContain('<img');
    expect(html).not.toMatch(/<text/i); // no drawn "I" glyph
    expect(html).toContain('InterContinental Fiji Golf Resort &amp; Spa'); // real name stays as normal HTML
  });

  it('South Sea Cruises: BRANDED_FALLBACK cruise/island visual, no other cruise company\'s vessel, no "S" hero', async () => {
    const { res, html } = await getOperatorPage('south-sea-cruises-20bdfc25');
    expect(res.status).toBe(200);
    expect(html).toContain('<svg');
    expect(html).not.toContain('<img');
    expect(html).not.toMatch(/<text/i);
    expect(html).toContain('South Sea Cruises');
  });

  it('Nadi Airport Transfers: the marina/"FIJI ONE" photo is gone from the operator hero, replaced by the disclosed generic transfer photo', async () => {
    const { res, html } = await getOperatorPage('nadi-airport-transfers');
    expect(res.status).toBe(200);
    expect(html).not.toContain('context-denarau-marina.webp');
    expect(html).toContain('context-road-transfer.webp');
    expect(html).toContain('Representative Fiji transfer imagery');
  });

  it('Blue Lagoon Beach Resort: the Kuata Island photo is never paired with a loc-badge claiming Nacula Island, and carries an accurate, corrected disclosure label', async () => {
    const { res, html } = await getOperatorPage('blue-lagoon-beach-resort');
    expect(res.status).toBe(200);
    expect(html).toContain('category-adventure.webp');
    expect(html).toContain('Representative Yasawa Islands scenery — Kuata Island');
    expect(html).not.toContain('class="loc-badge"'); // no badge ELEMENT on this SEMANTIC_CATEGORY hero (the class still exists in the shared stylesheet, just unused here)
    expect(html).toContain('Nacula Island, Yasawa Islands'); // the real location still appears, just as normal page text below the hero
  });
});
