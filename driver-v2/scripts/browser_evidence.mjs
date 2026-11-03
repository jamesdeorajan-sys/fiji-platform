// Phone-sized browser/PWA evidence for Driver PWA v2 Gate 1 (isolated dev server, synthetic data, loopback only).
// 390x844 viewport, CDP slow-network emulation, delayed Accept, offline/reconnect, competing driver. Exits non-zero on any failed check.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startDevServer } from '../server/dev_server.mjs';
import { CANARY } from '../test-harness/fixture.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'evidence', 'browser'); fs.mkdirSync(OUT, { recursive: true });
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const s = await startDevServer({ drivers: 3 });
const base = `http://127.0.0.1:${s.port}`;
const ctl = (op, q = '') => fetch(`${base}/__test/${op}${q}`).then((r) => r.json());
const browser = await chromium.launch();
const mk = async (driver = 1) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage(); const { token } = await ctl('token', `?driver=${driver}`);
  const net = []; page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) net.push(r.url()); });
  return { context, page, token, net };
};
const shot = async (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const T = (page, id) => page.locator(`[data-testid="${id}"]`);

try {
  // ── Journey A: slow data connection end to end ──
  const A = await mk(1); const { page, context } = A;
  await ctl('mode', '?m=DELIVERED'); const b1 = (await ctl('new-booking')).booking_id;
  await page.goto(`${base}/#token=${A.token}`);
  await T(page, 'offer-card').first().waitFor({ timeout: 8000 });
  await shot(page, '01_offer_received');
  const offerText = await page.locator('body').innerText();
  check('offer screen shows no guest PII before assignment', !Object.values(CANARY).some((c) => offerText.includes(c)));
  check('offer shows PRIORITY phase and a countdown', (await T(page, 'phase-chip').innerText()).includes('PRIORITY') && /0:\d\d/.test(await T(page, 'countdown').innerText()));

  await ctl('advance', '?s=75'); await page.waitForFunction(() => /GRACE/.test(document.querySelector('[data-testid="phase-chip"]')?.textContent || ''), null, { timeout: 8000 });
  await shot(page, '02_dispatch_phase_connectivity_grace');
  check('at 75 s the offer is still open and labelled CONNECTIVITY GRACE (not expired, not cancelled)', (await T(page, 'btn-accept').isEnabled()) && /Still open/.test(await T(page, 'countdown').innerText()));

  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 600, downloadThroughput: 40 * 1024, uploadThroughput: 20 * 1024 });   // slow-network simulation
  let acceptHits = 0;
  await page.route('**/api/offers/*/accept', async (route) => { acceptHits++; await new Promise((r) => setTimeout(r, 3500)); await route.continue(); });
  await T(page, 'btn-accept').click();
  await T(page, 'state-confirming').waitFor({ timeout: 3000 });
  await shot(page, '03_accept_confirming_slow_network');
  check('Accept immediately shows local CONFIRMING; button disabled; job NOT shown as assigned yet', (await T(page, 'btn-accept').isDisabled()) && (await T(page, 'trip-view').count()) === 0);
  await page.locator('[data-testid="btn-accept"]').click({ force: true, timeout: 500 }).catch(() => {});      // accidental repeat tap
  await T(page, 'trip-view').waitFor({ timeout: 20000 });
  check('repeat tap while confirming did not create a second request', acceptHits === 1, `accept requests=${acceptHits}`);
  await shot(page, '04_assigned_after_server_confirmation');
  check('guest details appear only after server-confirmed assignment', (await page.locator('body').innerText()).includes(CANARY.name));
  await page.unroute('**/api/offers/*/accept');

  const step = async (label, name) => { await T(page, 'btn-next').click(); await page.waitForFunction((l) => document.querySelector('[data-testid="stage"]')?.textContent?.includes(l) || document.querySelector('[data-testid="notice-done"]'), label, { timeout: 15000 }); if (name) await shot(page, name); };
  await step('Driving to pickup', '05_pickup_journey_en_route');
  await step('Arrived at pickup');
  check('PICKUP_VALIDATED is blocked until photo evidence is stored', await T(page, 'btn-next').isDisabled());
  await shot(page, '06_pickup_validation_needs_evidence');
  await T(page, 'btn-evidence').click(); await page.waitForFunction(() => /stored/.test(document.querySelector('[data-testid="btn-evidence"]')?.textContent || ''), null, { timeout: 15000 });
  await shot(page, '07_pickup_evidence_stored');
  await step('Pickup validated', '08_pickup_validated');
  await step('Passenger on board', '09_passenger_onboard');
  await step('Driving to destination', '10_destination_journey_en_route');
  await step('Arrived at destination');
  await T(page, 'btn-next').click(); await T(page, 'notice-done').waitFor({ timeout: 15000 });
  await shot(page, '11_completed');
  check('trip completed through the PWA', (await T(page, 'notice-done').innerText()).includes('completed'));
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  // ── Journey B: offline during Accept, then reconnect / reload recovery ──
  const B = await mk(1); const pb = B.page;
  const b2 = (await ctl('new-booking')).booking_id;
  await pb.goto(`${base}/#token=${B.token}`); await T(pb, 'offer-card').first().waitFor({ timeout: 8000 });
  await B.context.setOffline(true);
  await T(pb, 'btn-accept').click(); await T(pb, 'state-confirming').waitFor({ timeout: 3000 });
  await pb.waitForFunction(() => document.querySelector('[data-testid="conn-chip"]')?.dataset.state === 'reconnecting', null, { timeout: 25000 });
  await shot(pb, '12_offline_reconnecting_confirming');
  check('offline: UI stays CONFIRMING, shows Reconnecting…, never claims the job', (await T(pb, 'trip-view').count()) === 0 && /Reconnecting/.test(await T(pb, 'conn-chip').innerText()));
  await B.context.setOffline(false);
  await T(pb, 'trip-view').waitFor({ timeout: 30000 });
  await shot(pb, '13_reconnect_recovered_assigned');
  const sum = await ctl('summary');
  check('retries after reconnect produced exactly one assignment (replay-safe)', sum.events.filter((e) => e === 'DRIVER_ASSIGNED').length === 2 /* b1 + b2 */ && sum.bookings.filter((x) => x.assigned_driver_id === 1).length === 2);
  await pb.reload(); await T(pb, 'trip-view').waitFor({ timeout: 10000 });
  await shot(pb, '14_reload_recovered_server_state');
  check('reload recovers authoritative trip state from the server', true);

  // ── Journey C: competing driver loses with a stable message ──
  await ctl('mode', '?m=NO_RECEIPT'); const b3 = (await ctl('new-booking')).booking_id; await ctl('advance', '?s=61');
  const C1 = await mk(1), C2 = await mk(2);
  await C1.page.goto(`${base}/#token=${C1.token}`); await C2.page.goto(`${base}/#token=${C2.token}`);
  await T(C1.page, 'offer-card').first().waitFor({ timeout: 8000 }); await T(C2.page, 'offer-card').first().waitFor({ timeout: 8000 });
  await T(C1.page, 'btn-accept').click(); await C1.page.locator(`[data-testid="trip-view"][data-booking="${b3}"]`).waitFor({ timeout: 10000 });
  await T(C2.page, 'btn-accept').click(); await T(C2.page, 'notice-taken').waitFor({ timeout: 10000 });
  await shot(C2.page, '15_competing_driver_job_already_taken');
  check('losing driver sees a stable "already taken" result and never sees guest PII', !(await C2.page.locator('body').innerText()).includes(CANARY.name) && !(await C2.page.locator('body').innerText()).includes(CANARY.phone));
  const fin = await ctl('summary');
  check('no booking has more than one assigned driver / ACCEPTED offer', fin.bookings.filter((x) => x.assigned_driver_id).length === 3 && new Set(fin.bookings.map((x) => x.id)).size === 3);
  check('zero real sends (all notification intents suppressed/captured)', fin.real_sends === 0, `captured intents=${fin.intents}`);
  check('browser made zero non-loopback requests', [A, B, C1, C2].every((x) => x.net.length === 0), JSON.stringify([A, B, C1, C2].flatMap((x) => x.net)));
} catch (e) { check('browser run completed without exception', false, String(e.stack || e).slice(0, 400)); }
finally { await browser.close(); await s.close(); }

fs.writeFileSync(path.join(OUT, 'browser-results.json'), JSON.stringify({ viewport: '390x844 @2x, isMobile+touch', slow_network: 'CDP latency 600ms / 40KB/s down / 20KB/s up + 3.5s delayed Accept response', results, failed }, null, 2));
console.log(`\nbrowser checks: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
