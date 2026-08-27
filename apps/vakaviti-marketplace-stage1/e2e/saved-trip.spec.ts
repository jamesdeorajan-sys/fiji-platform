import { test, expect } from '@playwright/test';

// LAUNCH-CANDIDATE UX REMEDIATION (2026-08-27) - dynamic saved-trip/plan journey coverage.
// These behaviors genuinely need a real browser executing the page's own client-side script
// (readSaved/writeSaved/render against real localStorage) - not something a Vitest unit test
// (Node environment, no DOM) can exercise. Follows the same opt-in pattern as
// qa-security.spec.ts's QA_BASE_URL: this suite targets whichever branch preview is currently
// under review, not the fixed baseURL in playwright.config.ts (which points at PR #22's own
// preview and must stay untouched) - so it is skipped entirely unless a base URL is explicitly
// supplied, and can be pointed at any future branch's preview (e.g. the eventual production
// integration branch) just by setting the env var, with no code change.
test.describe('Launch-candidate: Saved trip / Plan journey (needs LAUNCH_CANDIDATE_BASE_URL)', () => {
  const baseUrl = process.env.LAUNCH_CANDIDATE_BASE_URL;
  test.skip(!baseUrl, 'LAUNCH_CANDIDATE_BASE_URL not provided to this run - dynamic saved-trip checks are opt-in per branch, see PLAN_REMEDIATION notes in the launch-candidate acceptance report.');

  test.beforeEach(async ({ page }) => {
    // saveDeal() calls a native alert() to confirm the save - auto-accept it so .click() never
    // hangs waiting for a dialog no one is watching for.
    page.on('dialog', d => d.accept());
    await page.goto(`${baseUrl}/plan`);
    await page.evaluate(() => localStorage.removeItem('vakaviti_saved_trip'));
  });

  test('a saved deal renders on /plan without the readSaved ReferenceError', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto(`${baseUrl}/live-deals`);
    const firstSave = page.locator('button:has-text("Save")').first();
    const dealTitle = await page.locator('.card h2').first().textContent();
    await firstSave.click();

    await page.goto(`${baseUrl}/plan`);
    await expect(page.locator('#plan-list')).not.toContainText('Loading your saved trip');
    await expect(page.locator('#plan-list')).toContainText(dealTitle!.trim());
    expect(errors.filter(e => e.includes('readSaved'))).toHaveLength(0);
  });

  test('adding two deals shows both; removing one leaves exactly the other', async ({ page }) => {
    await page.goto(`${baseUrl}/live-deals`);
    const saveButtons = page.locator('button:has-text("Save")');
    const count = await saveButtons.count();
    test.skip(count < 2, 'fewer than 2 public deals available on this preview to exercise a two-item save/remove flow');

    const titles = await page.locator('.card h2').allTextContents();
    await saveButtons.nth(0).click();
    await saveButtons.nth(1).click();

    await page.goto(`${baseUrl}/plan`);
    await expect(page.locator('#plan-list')).toContainText(titles[0].trim());
    await expect(page.locator('#plan-list')).toContainText(titles[1].trim());

    await page.locator('#plan-list button:has-text("Remove")').first().click();
    await expect(page.locator('#plan-list')).not.toContainText(titles[0].trim());
    await expect(page.locator('#plan-list')).toContainText(titles[1].trim());
  });

  test('refresh preserves the remaining saved item (localStorage persistence, not in-memory state)', async ({ page }) => {
    await page.goto(`${baseUrl}/live-deals`);
    const dealTitle = await page.locator('.card h2').first().textContent();
    await page.locator('button:has-text("Save")').first().click();

    await page.goto(`${baseUrl}/plan`);
    await expect(page.locator('#plan-list')).toContainText(dealTitle!.trim());
    await page.reload();
    await expect(page.locator('#plan-list')).not.toContainText('Loading your saved trip');
    await expect(page.locator('#plan-list')).toContainText(dealTitle!.trim());
  });

  test('empty saved-trip state renders a helpful message, not a stuck "Loading" state', async ({ page }) => {
    await page.goto(`${baseUrl}/plan`);
    await expect(page.locator('#plan-list')).not.toContainText('Loading your saved trip');
    await expect(page.locator('#plan-list')).toContainText('Nothing saved yet');
  });

  test('malformed localStorage (invalid JSON) does not strand the page on "Loading…" or throw', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.evaluate(() => localStorage.setItem('vakaviti_saved_trip', 'not valid json{{{'));
    await page.reload();
    await expect(page.locator('#plan-list')).not.toContainText('Loading your saved trip');
    await expect(page.locator('#plan-list')).toContainText('Nothing saved yet');
    expect(errors).toHaveLength(0);
  });

  test('malformed localStorage (valid JSON, wrong shape) also recovers safely', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.evaluate(() => localStorage.setItem('vakaviti_saved_trip', JSON.stringify({ unexpected: true })));
    await page.reload();
    await expect(page.locator('#plan-list')).not.toContainText('Loading your saved trip');
    await expect(page.locator('#plan-list')).toContainText('Nothing saved yet');
    expect(errors).toHaveLength(0);
  });

  test('/saved redirects to the working, populated plan experience', async ({ page }) => {
    await page.goto(`${baseUrl}/live-deals`);
    const dealTitle = await page.locator('.card h2').first().textContent();
    await page.locator('button:has-text("Save")').first().click();

    await page.goto(`${baseUrl}/saved`);
    expect(page.url()).toContain('/plan');
    await expect(page.locator('#plan-list')).toContainText(dealTitle!.trim());
  });
});
