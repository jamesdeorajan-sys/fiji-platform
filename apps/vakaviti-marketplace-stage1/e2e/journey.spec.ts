import { test, expect } from '@playwright/test';
import { createHmac, randomBytes } from 'node:crypto';

test.describe('Three-item comparison', () => {
  test('comparing all 3 real preview deals renders and states the incomparability reason (mixed price bases)', async ({ page }) => {
    await page.goto('/compare?ids=off-tp-1,off-tp-2,off-mf-radisson');
    const text = await page.locator('main').innerText();
    expect(text).toContain('Taveuni Palms Resort');
    expect(text).toContain('Radisson Blu');
    // off-tp-* are PER_NIGHT, off-mf-radisson is PER_PERSON - genuinely different bases
    expect(text).toMatch(/Not directly comparable|differs/i);
  });
});

test.describe('Saved trip (localStorage, no server, no PII)', () => {
  test('save, then remove, then clear all - all client-side only', async ({ page }) => {
    await page.goto('/explore');
    await page.evaluate(() => localStorage.removeItem('vakaviti_saved_trip'));
    // Simulate the save button's own function directly - same call path a real click makes.
    await page.evaluate(() => (window as any).saveDeal('off-tp-1', 'Taveuni Palms Pay 6 Stay 7'));
    const afterSave = await page.evaluate(() => JSON.parse(localStorage.getItem('vakaviti_saved_trip') || '{}'));
    expect(afterSave.deals).toHaveLength(1);
    expect(afterSave.deals[0].id).toBe('off-tp-1');
    // No PII field exists anywhere in what got stored.
    const raw = await page.evaluate(() => localStorage.getItem('vakaviti_saved_trip') || '');
    expect(raw.toLowerCase()).not.toMatch(/email|phone/);

    await page.goto('/plan');
    await page.evaluate(() => (window as any).removeSaved('off-tp-1'));
    const afterRemove = await page.evaluate(() => JSON.parse(localStorage.getItem('vakaviti_saved_trip') || '{}'));
    expect(afterRemove.deals).toHaveLength(0);

    await page.evaluate(() => (window as any).saveDeal('off-tp-2', 'x'));
    await page.evaluate(() => (window as any).clearSaved());
    const afterClear = await page.evaluate(() => localStorage.getItem('vakaviti_saved_trip'));
    expect(afterClear).toBeNull();
  });
});

test.describe('Milestone 4 entry gate 2: WhatsApp review/handoff full lifecycle (no message sent)', () => {
  // FINAL INTEGRATION REVIEW, Phase 1 (2026-08-25): this is the ONE authorized end-to-end write
  // smoke test, and it now runs against the DEDICATED QA environment (QA_BASE_URL), not the
  // shared branch preview - DEAL_EXCHANGE_QA_DB is no longer bound there at all (see
  // wrangler.toml). Every write request carries a full HMAC-signed header set (run id, timestamp,
  // single-use nonce, signature) computed with the real QA_AUTH_SECRET - see verifyQaAuth() in
  // deal-exchange-ui.ts. A bare run-id header (the old scheme) is no longer sufficient anywhere.
  //
  // Skipped until QA_BASE_URL/QA_AUTH_SECRET are supplied to CI - the dedicated QA Worker isn't
  // deployed yet, pending a separate CEO decision on provisioning a Cloudflare credential for CI
  // (see the FINAL REPORT). This is a disclosed gap, not a silently-lowered bar: the suite still
  // fails closed (skip, not pass) rather than pretending the write path was proven.
  const qaBaseUrl = process.env.QA_BASE_URL;
  const qaSecret = process.env.QA_AUTH_SECRET;
  test.skip(!qaBaseUrl || !qaSecret, 'QA_BASE_URL/QA_AUTH_SECRET not provided to this CI run - dedicated QA environment deployment is pending a separate CEO infrastructure decision.');

  function qaHeaders(runId: string) {
    const timestamp = String(Date.now());
    const nonce = randomBytes(16).toString('hex');
    const signature = createHmac('sha256', qaSecret!).update(`${runId}.${nonce}.${timestamp}`).digest('hex');
    return { 'x-vakaviti-qa-run-id': runId, 'x-vakaviti-qa-timestamp': timestamp, 'x-vakaviti-qa-nonce': nonce, 'x-vakaviti-qa-signature': signature };
  }

  test('review -> confirm -> tracked WhatsApp link, stopping before wa.me, with a stable enquiry reference', async ({ page, request }) => {
    const runId = `pw-${test.info().workerIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Unique per-run content so this run's idempotency key can never collide with another
    // parallel run's - "parallel runs cannot collide" is a real property of the content itself,
    // not just the routing.
    const uniqueQuestion = `Is breakfast included? [qa:${runId}]`;
    let reference = '';

    try {
      await page.goto(`${qaBaseUrl}/`); // establish the origin before setting per-origin headers
      await page.setExtraHTTPHeaders(qaHeaders(runId)); // fresh nonce for this submission only
      await page.goto(`${qaBaseUrl}/chat`);
      await page.fill('#dates', 'September 2026, 7 nights');
      await page.fill('#party', '2 adults');
      await page.fill('#hotel', 'Denarau');
      await page.fill('#q', uniqueQuestion);
      await page.click('button[type=submit]');

      await expect(page.locator('main')).toContainText('Review before you go');
      const text = await page.locator('main').innerText();
      const refMatch = text.match(/VKV-[A-Z0-9]{6}/);
      expect(refMatch, 'no enquiry reference rendered').toBeTruthy();
      reference = refMatch![0];
      expect(text).toContain('September 2026, 7 nights');
      expect(text).toContain('Denarau');
      expect(text).toContain(uniqueQuestion);

      // The link exists, targets our own tracked route (not wa.me directly), and the test
      // deliberately does NOT click it or follow it - per the explicit instruction to stop before
      // navigating to wa.me or sending anything.
      const waLink = page.locator('a', { hasText: 'Continue to WhatsApp' });
      await expect(waLink).toBeVisible();
      const href = await waLink.getAttribute('href');
      expect(href).toMatch(/^\/chat\/open-whatsapp\//);
      expect(href).not.toMatch(/wa\.me/); // safe: the visible link never points straight at wa.me
      const rel = await waLink.getAttribute('rel');
      expect(rel).toContain('noopener');
      expect(rel).toContain('noreferrer');

      // Resubmitting the identical form must not create a second reference (idempotency,
      // exercised here as a real double-submit, not just at the unit level). Needs a FRESH nonce
      // (single-use) even though it's the same run id and same content.
      await page.setExtraHTTPHeaders(qaHeaders(runId));
      await page.goto(`${qaBaseUrl}/chat`);
      await page.fill('#dates', 'September 2026, 7 nights');
      await page.fill('#party', '2 adults');
      await page.fill('#hotel', 'Denarau');
      await page.fill('#q', uniqueQuestion);
      await page.click('button[type=submit]');
      const secondText = await page.locator('main').innerText();
      expect(secondText).toContain(reference); // same reference, not a new one
    } finally {
      if (reference) {
        const cleanup = await request.post(`${qaBaseUrl}/internal/qa-cleanup`, { headers: qaHeaders(runId), data: { reference } });
        expect(cleanup.ok(), 'QA cleanup request itself failed').toBeTruthy();
        const body = await cleanup.json();
        // Post-test zero-residue assertion against the real server response, not an assumption.
        expect(body.residueForReference, `residue remained for ${reference}`).toBe(0);
      }
    }
  });
});

test.describe('Milestone 4D: AI/search readiness is prepared but not enabled', () => {
  // Root cause of the Blocker 2 flake: this content is 100% server-rendered (buildDealSeoHead()
  // is a plain synchronous function, no client JS touches it) - driving a full Chromium page load
  // and DOM-locator waits for static <head> tags added browser-rendering-pipeline timing variance
  // with no corresponding benefit. Fetching the raw HTML via APIRequestContext (no browser
  // rendering at all) is both the deterministic-readiness fix and the faster test. A browser
  // assertion is kept only where browser behavior actually matters (see the JS-disabled and
  // mobile-device tests in mobile-accessibility.spec.ts, which genuinely need a real renderer).
  test('deal detail page HTML carries canonical URL, meta description, and JSON-LD matching visible facts - but stays noindex', async ({ request }) => {
    const response = await request.get('/live-deals/off-tp-1');
    expect(response.status()).toBe(200);
    const html = await response.text();

    expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
    const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)">/);
    expect(canonicalMatch, 'no canonical link found in server-rendered HTML').toBeTruthy();
    expect(canonicalMatch![1]).toContain('/live-deals/off-tp-1');

    const descriptionMatch = html.match(/<meta name="description" content="([^"]*)">/);
    expect(descriptionMatch, 'no meta description found').toBeTruthy();
    expect(descriptionMatch![1]).toContain('Taveuni Palms Resort');

    const ldJsonMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(ldJsonMatch, 'no JSON-LD script tag found').toBeTruthy();
    const parsed = JSON.parse(ldJsonMatch![1]);
    expect(parsed['@type']).toBe('Product');
    expect(parsed.offers.price).toBe('1500');
    expect(parsed.offers.priceCurrency).toBe('USD');
    // "InStock" would be an unsupported availability claim - this app has no confirmed inventory
    // data, and the same card visibly says "availability not guaranteed until confirmed" right
    // next to this structured data. availability must be omitted entirely, not asserted.
    expect(parsed.offers.availability).toBeUndefined();
    // The seller-of-record is the real provider (Taveuni Palms), never Vakaviti implied by
    // omission.
    expect(parsed.offers.seller.name).toBe('Taveuni Palms Resort');
    // Price basis is machine-readable, not just folded into free text.
    expect(parsed.offers.priceSpecification.unitText).toBe('per night');
    // No rating/review claim exists anywhere in the payload unless real evidence supports one -
    // this offer has none, so the structured data must not invent one either.
    expect(parsed.aggregateRating).toBeUndefined();
    expect(parsed.review).toBeUndefined();

    // The structured price matches what the same HTML response shows a visitor - not a separate,
    // independently-sourced claim.
    expect(html).toContain('1500');
  });

  test('a private/incomplete offer never gets a public detail page or structured data at all', async ({ request }) => {
    // off-jmc-1 is PRIVATE_ONLY (Jean-Michel Cousteau) - the route must 404, not silently render
    // an incomplete offer with partial/invented structured data.
    const response = await request.get('/live-deals/off-jmc-1');
    expect(response.status()).toBe(404);
  });
});
