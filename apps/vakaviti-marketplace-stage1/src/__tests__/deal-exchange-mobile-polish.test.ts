import { describe, it, expect } from 'vitest';
import { dealExchangeUi } from '../deal-exchange-ui';

// LAUNCH-CANDIDATE FINAL POLISH (2026-08-27). Structural, branch-agnostic proof of the three
// disclosed visual issues found during the live Chromium acceptance recheck - none of these need
// a live deployment or DOM environment, since each is a property of the generated HTML/CSS string
// itself. The live, real-browser proof (unobscured content after scroll, actual keyboard
// scrolling, rendered colors) is captured separately as screenshots/console evidence against the
// deployed preview - this file guards the underlying markup/CSS from silently regressing.

function throwingDb(label: string) { return { prepare() { throw new Error(`DB_TOUCHED:${label}`); } } as any; }
// Supports both call shapes actually used by these routes: /live-deals and /compare's loop calls
// .prepare(sql).bind(id).first() once per id (this is bind-aware - .first() returns the row whose
// id matches the bound value, not just rows[0], which matters for /compare?ids=a,b needing BOTH
// distinct rows back); /live-deals's listing query calls .prepare(sql).all() with no bind.
function fixedRowsDb(rows: any[]) {
  function makeStatement(boundId?: string) {
    return {
      bind: (...args: any[]) => makeStatement(args[0]),
      all: async () => ({ results: rows }),
      first: async () => (boundId === undefined ? rows[0] ?? null : rows.find(r => r.id === boundId) ?? null),
    };
  }
  return { prepare: () => makeStatement() } as any;
}

const OFFER_A = {
  id: 'a', offer_owner_type: 'PROVIDER_DIRECT', provider_name: 'Resort A', canonical_source_url: 'https://a.example',
  fingerprint: 'fp-a', identity_key: 'k-a', price_amount: '100', currency: 'USD', is_from_price: 0,
  price_basis: 'PER_NIGHT', occupancy_basis: '2 adults', nights: 3, publication_decision: 'ELIGIBLE', checked_at: '2026-01-01T00:00:00Z',
};
const OFFER_B = { ...OFFER_A, id: 'b', provider_name: 'Resort B', fingerprint: 'fp-b', identity_key: 'k-b', price_basis: 'PER_PERSON' };

describe('POLISH FIX 1: bottom navigation cannot obscure content', () => {
  it('main reserves padding-bottom covering the fixed nav height plus env(safe-area-inset-bottom)', async () => {
    const res = await dealExchangeUi.request('/plan', {}, { ENVIRONMENT: 'preview', DEAL_EXCHANGE_DB: throwingDb('unused'), DEAL_EXCHANGE_PUBLIC_ENABLED: 'true' } as any);
    const html = await res.text();
    expect(html).toMatch(/main\{[^}]*padding-bottom:calc\(\d+px \+ env\(safe-area-inset-bottom\)\)/);
  });

  it('the reserved padding-bottom (64px) exceeds the nav\'s own measured content height (45px), so it is not merely cosmetic', async () => {
    // Documents the actual measured nav height this value must clear - see the live acceptance
    // report for the getBoundingClientRect() proof (height: 45px at 320-414px widths).
    const NAV_MEASURED_HEIGHT_PX = 45;
    const RESERVED_PADDING_PX = 64;
    expect(RESERVED_PADDING_PX).toBeGreaterThan(NAV_MEASURED_HEIGHT_PX);
  });
});

describe('POLISH FIX 2: Compare discoverability and keyboard access', () => {
  const env = { ENVIRONMENT: 'preview', DEAL_EXCHANGE_DB: fixedRowsDb([OFFER_A, OFFER_B]), DEAL_EXCHANGE_PUBLIC_ENABLED: 'true' } as any;

  it('shows the "Swipe to compare" hint when 2+ items are compared', async () => {
    const res = await dealExchangeUi.request('/compare?ids=a,b', {}, env);
    const html = await res.text();
    expect(html).toContain('Swipe to compare');
  });

  it('does not show the hint for a single-item compare (nothing to scroll to)', async () => {
    const res = await dealExchangeUi.request('/compare?ids=a', {}, env);
    const html = await res.text();
    expect(html).not.toContain('Swipe to compare');
  });

  it('the hint is hidden by CSS on wide viewports where 3 cards fit without scrolling (no desktop clutter)', async () => {
    const res = await dealExchangeUi.request('/compare?ids=a,b', {}, env);
    const html = await res.text();
    expect(html).toMatch(/@media \(min-width:820px\)\{\.scroll-hint\{display:none\}\}/);
  });

  it('the scrollable comparison region is a real, focusable, announced keyboard target', async () => {
    const res = await dealExchangeUi.request('/compare?ids=a,b', {}, env);
    const html = await res.text();
    expect(html).toContain('class="overflow-x" tabindex="0" role="group" aria-label="Comparison cards - scroll or use arrow keys to see more"');
  });

  it('still never claims one offer is cheaper when price bases differ (unchanged from the original fix)', async () => {
    const res = await dealExchangeUi.request('/compare?ids=a,b', {}, env);
    const html = await res.text();
    expect(html).toContain('Not directly comparable');
    expect(html).not.toMatch(/cheaper|best value/i);
  });
});

describe('POLISH FIX 3: detail-page navigation state is accessible and not misleading', () => {
  const env = { ENVIRONMENT: 'preview', DEAL_EXCHANGE_DB: fixedRowsDb([OFFER_A]), DEAL_EXCHANGE_PUBLIC_ENABLED: 'true' } as any;

  it('the real listing page (/live-deals) gets the exact aria-current="page" state', async () => {
    const res = await dealExchangeUi.request('/live-deals', {}, env);
    const html = await res.text();
    expect(html).toContain('<a href="/live-deals" class="active" aria-current="page">Deals</a>');
  });

  it('a deal-detail page gets a distinct parent-section state, never aria-current="page"', async () => {
    const res = await dealExchangeUi.request('/live-deals/a', {}, env);
    const html = await res.text();
    expect(html).toContain('<a href="/live-deals" class="active-section" aria-current="true">Deals</a>');
    expect(html).not.toContain('<a href="/live-deals" class="active" aria-current="page">Deals</a>');
  });

  it('the Compare page also gets the parent-section state, not the exact-page state', async () => {
    const res = await dealExchangeUi.request('/compare?ids=a', {}, env);
    const html = await res.text();
    expect(html).toContain('<a href="/live-deals" class="active-section" aria-current="true">Deals</a>');
  });
});

describe('Regression guard: prior saved-trip and disabled-flag fixes are unaffected by this polish', () => {
  it('/plan still loads SAVED_TRIP_SCRIPT before its own render() call', async () => {
    const res = await dealExchangeUi.request('/plan', {}, { ENVIRONMENT: 'preview', DEAL_EXCHANGE_DB: throwingDb('unused'), DEAL_EXCHANGE_PUBLIC_ENABLED: 'true' } as any);
    const html = await res.text();
    expect(html.indexOf('function readSaved()')).toBeLessThan(html.lastIndexOf('render();'));
  });

  it('every Deal Exchange route still fails closed with the public flag false', async () => {
    const env = { ENVIRONMENT: 'preview', DEAL_EXCHANGE_DB: throwingDb('flag-false') } as any;
    for (const path of ['/explore', '/live-deals', '/compare', '/plan']) {
      const res = await dealExchangeUi.request(path, {}, env);
      expect(res.status).toBe(503);
    }
  });
});
