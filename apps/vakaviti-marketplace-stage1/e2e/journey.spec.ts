import { test, expect } from '@playwright/test';

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
  test('review -> confirm -> tracked WhatsApp link, stopping before wa.me, with a stable enquiry reference', async ({ page }) => {
    await page.goto('/chat');
    await page.fill('#dates', 'September 2026, 7 nights');
    await page.fill('#party', '2 adults');
    await page.fill('#hotel', 'Denarau');
    await page.fill('#q', 'Is breakfast included?');
    await page.click('button[type=submit]');

    await expect(page.locator('main')).toContainText('Review before you go');
    const text = await page.locator('main').innerText();
    const refMatch = text.match(/VKV-[A-Z0-9]{6}/);
    expect(refMatch, 'no enquiry reference rendered').toBeTruthy();
    const reference = refMatch![0];
    expect(text).toContain('September 2026, 7 nights');
    expect(text).toContain('Denarau');
    expect(text).toContain('Is breakfast included?');

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
    // exercised here as a real double-submit, not just at the unit level).
    await page.goto('/chat');
    await page.fill('#dates', 'September 2026, 7 nights');
    await page.fill('#party', '2 adults');
    await page.fill('#hotel', 'Denarau');
    await page.fill('#q', 'Is breakfast included?');
    await page.click('button[type=submit]');
    const secondText = await page.locator('main').innerText();
    expect(secondText).toContain(reference); // same reference, not a new one
  });
});
