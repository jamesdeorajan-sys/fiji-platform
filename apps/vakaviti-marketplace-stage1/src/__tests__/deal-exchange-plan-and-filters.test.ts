import { describe, it, expect } from 'vitest';
import { dealExchangeUi } from '../deal-exchange-ui';

// LAUNCH-CANDIDATE UX REMEDIATION (2026-08-27). Proves the four confirmed defects from the
// launch-candidate visual/journey acceptance gate are fixed, and stay fixed. These are branch-
// agnostic structural/static checks - they need no live deployment and no DOM/jsdom environment,
// since they inspect the actual generated HTML string Hono returns, the same way the rest of this
// suite already does. Dynamic browser-only behaviors (localStorage add/remove/refresh/malformed
// recovery) are covered separately in e2e/saved-trip.spec.ts against a real deployed preview.

function throwingDb(label: string) {
  return { prepare() { throw new Error(`DB_TOUCHED:${label}`); } } as any;
}

const enabledEnv = { ENVIRONMENT: 'preview', DEAL_EXCHANGE_DB: throwingDb('unused'), DEAL_EXCHANGE_PUBLIC_ENABLED: 'true' } as any;

// /live-deals issues exactly one fixed, parameterless query
// ("SELECT * FROM deal_exchange_offers WHERE publication_decision='ELIGIBLE' ORDER BY
// checked_at DESC") and does all real filtering afterward in JS via filterEligibleOffers() - so a
// fixed-rows stand-in (not the shared fake-d1.ts, whose SQL parser only supports bound-parameter
// WHERE clauses, not this literal-value shape) is enough to test that JS-side filtering honestly.
function fixedRowsDb(rows: any[]) {
  return { prepare: () => ({ all: async () => ({ results: rows }) }) } as any;
}

const NOVEMBER_2027_OFFER = {
  id: 'test-nov-2027', offer_owner_type: 'PROVIDER_DIRECT', provider_name: 'Test Resort',
  canonical_source_url: 'https://example.com', fingerprint: 'fp-1', identity_key: 'k-1',
  price_amount: '100', currency: 'USD', is_from_price: 0, price_basis: 'PER_NIGHT',
  occupancy_basis: '2 adults', nights: 3, travel_start: '2027-11-01', travel_end: '2027-11-30',
  publication_decision: 'ELIGIBLE', checked_at: '2027-08-01T00:00:00Z',
};

const enabledEnvWithOffers = { ENVIRONMENT: 'preview', DEAL_EXCHANGE_DB: fixedRowsDb([NOVEMBER_2027_OFFER]), DEAL_EXCHANGE_PUBLIC_ENABLED: 'true' } as any;

describe('LAUNCH BLOCKER FIX: /plan defines saved-trip helpers before first invocation', () => {
  it('SAVED_TRIP_SCRIPT (which defines readSaved/writeSaved) appears before the inline script that calls render()', async () => {
    // /plan sits behind the same fail-closed gate as every other route on this router, so it
    // needs the binding+flag to be reached at all - but its own handler body never calls
    // DEAL_EXCHANGE_DB.prepare() (it is a client-side-only, localStorage-backed page), which this
    // sentinel DB proves: if it ever got touched, this test would fail with DB_TOUCHED, not a
    // clean 200.
    const res = await dealExchangeUi.request('/plan', {}, enabledEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    const readSavedDefIndex = html.indexOf('function readSaved()');
    const renderCallIndex = html.lastIndexOf('render();');
    expect(readSavedDefIndex).toBeGreaterThan(-1);
    expect(renderCallIndex).toBeGreaterThan(-1);
    expect(readSavedDefIndex).toBeLessThan(renderCallIndex);
  });

  it('readSaved() falls back to an empty, correctly-shaped object for syntactically valid but wrongly-shaped JSON, not just invalid JSON', async () => {
    const res = await dealExchangeUi.request('/plan', {}, enabledEnv);
    const html = await res.text();
    // Confirms the hardened shape-check (Array.isArray guards) is present, not just the original
    // try/catch around JSON.parse - a value like "{}" or "null" parses successfully but has no
    // .deals array, which would otherwise throw inside render()'s s.deals.length access.
    expect(html).toContain('Array.isArray(parsed && parsed.deals)');
    expect(html).toContain('Array.isArray(parsed && parsed.products)');
  });
});

describe('FIX: month-only deep links never render "undefined" and still filter', () => {
  it('defaults travelYear to the current year when only month is supplied, before the results label is built', async () => {
    const res = await dealExchangeUi.request('/live-deals?month=6', {}, enabledEnvWithOffers);
    const html = await res.text();
    expect(html).not.toContain('undefined');
    expect(html).toContain(String(new Date().getFullYear()));
  });

  it('normal form-generated requests (month and year both supplied) are unaffected, and the filter genuinely applies', async () => {
    const res = await dealExchangeUi.request('/live-deals?month=11&year=2027', {}, enabledEnvWithOffers);
    const html = await res.text();
    expect(html).not.toContain('undefined');
    expect(html).toContain('November 2027');
    expect(html).toContain('1 of 1 public deals match for November 2027');
  });

  it('a request for a month/year the fixture offer does NOT cover correctly excludes it (proves the filter is not silently skipped)', async () => {
    const res = await dealExchangeUi.request('/live-deals?month=6&year=2027', {}, enabledEnvWithOffers);
    const html = await res.text();
    expect(html).toContain('0 of 1 public deals match for June 2027');
  });

  it('a request with neither month nor year still renders the unfiltered label with no "for ..." suffix', async () => {
    const res = await dealExchangeUi.request('/live-deals', {}, enabledEnvWithOffers);
    const html = await res.text();
    expect(html).not.toContain('undefined');
    expect(html).toMatch(/public deals match\./);
  });
});

describe('FIX: Save/Compare hit areas and the nav brand link meet the 44x44 CSS pixel minimum', () => {
  it('the Compare label and Save button declare an explicit min-height/min-width of 44px', async () => {
    const res = await dealExchangeUi.request('/live-deals', {}, enabledEnvWithOffers);
    const html = await res.text();
    expect(html).toContain('class="btn small secondary" style="display:flex;align-items:center;gap:6px;min-height:44px;min-width:44px"');
    expect(html).toContain('class="btn small secondary" style="min-height:44px;min-width:44px" onclick="saveDeal(');
  });

  it('the nav brand link declares a minimum 44px interactive height without altering its visible text/size', async () => {
    const res = await dealExchangeUi.request('/live-deals', {}, enabledEnvWithOffers);
    const html = await res.text();
    expect(html).toMatch(/header a\.brand\{[^}]*min-height:44px/);
    // font-size/weight/no-underline are unchanged - this is a hit-area fix, not a visual redesign.
    expect(html).toMatch(/header a\.brand\{[^}]*font-size:16px/);
  });
});

describe('Regression guard: disabled production flag behavior and isolation are unchanged by these fixes', () => {
  it('every Deal Exchange route still fails closed with DEAL_EXCHANGE_PUBLIC_ENABLED=false', async () => {
    const env = { ENVIRONMENT: 'preview', DEAL_EXCHANGE_DB: throwingDb('flag-false') } as any;
    for (const path of ['/explore', '/live-deals', '/compare', '/plan']) {
      const res = await dealExchangeUi.request(path, {}, env);
      expect(res.status).toBe(503);
    }
  });
});
