// Real-browser mobile journey for NAT (local source only; every non-local request is aborted, the confirm button is never pressed).
// usage: node route-vehicle-journey.cjs <path-to-src> <tag> [shotsDir]   (needs playwright; not part of the default node:test run)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const SRC = process.argv[2], TAG = process.argv[3] || 'run', SHOTS = process.argv[4] || null;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.xml': 'text/xml', '.txt': 'text/plain' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SRC, p); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end('nf'); } else { r.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); }).listen(0);
const ROUTES = [['Denarau', 'Hilton Fiji'], ['CoralCoast', 'Outrigger'], ['Natadola', 'Natadola'], ['Momi', 'Momi']];
const geo = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), disabled: !!e.disabled }; }, sel);
async function pick(page, which, q, sentinel) {
  await page.click(`#${which}_ta_trigger`); await page.fill(`#${which}_ta_search`, q); await page.waitForTimeout(200);
  const o = await page.$(sentinel ? `#${which}_ta_list .ta-opt-sentinel` : `#${which}_ta_list .ta-opt:not(.ta-opt-sentinel)`);
  if (!o) return false; await o.tap().catch(() => o.click()); await page.waitForTimeout(300); return true;
}
const tap = async (page, sel) => { const e = await page.$(sel); if (!e) throw new Error('missing ' + sel); await e.scrollIntoViewIfNeeded({ timeout: 3000 }); await e.tap({ timeout: 3000 }).catch(() => e.click({ timeout: 3000, force: true })); await page.waitForTimeout(500); };
const overlap = (a, b) => a && b && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
(async () => {
  await new Promise((r) => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port, browser = await chromium.launch(), out = [];
  for (const w of [320, 360, 390, 430]) {
    const scenarios = [...ROUTES.map(([l, q]) => ({ name: 'oneway-noflight-' + l, q, ret: false, flight: '' })), { name: 'return-flight-Denarau', q: 'Hilton Fiji', ret: true, flight: 'FJ411' }, { name: 'custom-address', custom: true }, { name: 'party-of-5', q: 'Hilton Fiji', pax: 5 }];
    for (const sc of scenarios) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      const page = await ctx.newPage(); const blocked = [], errs = [];
      await page.route('**/*', (rt) => { const u = rt.request().url(); if (u.startsWith(base)) return rt.continue(); blocked.push(rt.request().method() + ' ' + new URL(u).host); return rt.abort(); });
      await page.addInitScript(() => { window.__NAT_FUNNEL_CAPTURE = []; });
      page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
      await page.goto(base + '/', { waitUntil: 'load' }); await page.waitForTimeout(500);
      const rec = { w, scenario: sc.name, tag: TAG };
      try {
      await pick(page, 'pickup', 'Nadi International');
      if (sc.custom) { rec.destOpt = await pick(page, 'destination', 'other', true); await page.fill('#customDestAddress', 'Wakaya Villa, 27 Beach Rd, Pacific Harbour'); await page.selectOption('#customDestZone', { index: 1 }).catch(() => {}); await page.waitForTimeout(400); }
      else rec.destOpt = await pick(page, 'destination', sc.q);
      if (sc.ret) await tap(page, '.trip-btn:nth-child(2)');
      if (sc.pax) for (let i = 2; i < sc.pax; i++) { try { await tap(page, '[onclick="changePax(1)"]'); } catch (e) { rec.paxErr = String(e).slice(0, 80); } }
      if (sc.flight) await page.fill('#flightNum', sc.flight);
      await page.waitForTimeout(300);
      rec.state = await page.evaluate(() => ({ pax: state.passengers, bags: state.luggage, veh: state.selectedVehicle, auto: !!state.vehicleAuto }));
      rec.panel = await page.$eval('#pricingPanel', (e) => e.style.display).catch(() => null);
      rec.cta1 = await geo(page, '#nextBtn1');
      if (w === 390 && sc.name === 'oneway-noflight-Denarau' && SHOTS) { await page.evaluate(() => document.getElementById('vehicleCards').scrollIntoView({ block: 'center' })); await page.screenshot({ path: `${SHOTS}/${TAG}-390-1-price-panel-preselected.png` }); }
      await tap(page, '#nextBtn1');
      rec.step2 = await page.$eval('#step2', (e) => e.style.display !== 'none');
      rec.flightErr = await page.$eval('#flightError', (e) => !e.hidden);
      rec.scrollY = await page.evaluate(() => Math.round(scrollY));
      if (rec.step2) {
        rec.step2Veh = await page.evaluate(() => state.selectedVehicle);
        rec.cta2 = await geo(page, '#nextBtn2');
        rec.hint = await page.$eval('#vehicleHint', (e) => e.textContent.trim().slice(0, 70));
        rec.cardsSelected = await page.$$eval('#vehicleDetailCards .vehicle-detail-card.selected', (e) => e.length);
        rec.priceShown = await page.$$eval('#vehicleDetailCards .vd-price', (e) => e.map((x) => x.textContent.trim().slice(0, 18)));
        rec.chatOverlapCta2 = overlap(await geo(page, '#nextBtn2'), await geo(page, '#chatLauncher, .chat-launcher, #fijiChatBtn, [class*="chat-fab"], [class*="chat-toggle"]'));
        if (w === 390 && sc.name === 'oneway-noflight-Denarau' && SHOTS) await page.screenshot({ path: `${SHOTS}/${TAG}-390-2-vehicle-step.png` });
        if (sc.pax) { rec.step3AfterNoTap = await page.evaluate(() => { document.getElementById('nextBtn2').click(); return document.getElementById('step3').style.display !== 'none'; }); try { await tap(page, '#vehicleDetailCards .vehicle-detail-card:not(.disabled)'); } catch (e) { rec.cardTapErr = String(e).slice(0, 80); } rec.nextBtn2AfterTap = (await geo(page, '#nextBtn2')).disabled; }
        // back navigation keeps the route, then forward again and reach guest details (never confirm)
        await tap(page, '#step2 .btn-secondary'); rec.backStep1 = await page.$eval('#step1', (e) => e.style.display !== 'none'); rec.routeKept = await page.evaluate(() => destination.value + '|' + pickup.value);
        await tap(page, '#nextBtn1');
        if (!sc.pax) { await tap(page, '#nextBtn2'); rec.step3 = await page.$eval('#step3', (e) => e.style.display !== 'none'); }
        if (rec.step3) { await page.fill('#firstName', 'Test'); await page.fill('#lastName', 'Guest'); await page.fill('#email', 'test@example.com'); await page.fill('#phone', '+61400000000'); rec.detailsEntered = true; }
        if (rec.step3 && w === 390 && sc.name === 'oneway-noflight-Denarau' && SHOTS) await page.screenshot({ path: `${SHOTS}/${TAG}-390-3-guest-details.png` });
      }
      } catch (e) { rec.error = String(e).split('\n')[0].slice(0, 140); }
      rec.hOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      rec.funnel = await page.evaluate(() => window.__NAT_FUNNEL_CAPTURE.map((p) => p.event_type));
      rec.blocked = blocked.length; rec.apiPosts = blocked.filter((b) => b.startsWith('POST')).length; rec.js = errs;
      out.push(rec); await ctx.close();
    }
  }
  await browser.close(); srv.close();
  fs.writeFileSync(path.join(SHOTS || '.', `journey-${TAG}.json`), JSON.stringify(out, null, 1));
  for (const r of out) console.log(JSON.stringify({ w: r.w, s: r.scenario, dest: r.destOpt, veh: r.state && r.state.veh, auto: r.state && r.state.auto, step2: r.step2, flightErr: r.flightErr, step2Veh: r.step2Veh, sel: r.cardsSelected, nb2dis: r.cta2 && r.cta2.disabled, step3: r.step3, back: r.backStep1, ovf: r.hOverflow, js: r.js.length, posts: r.apiPosts, err: r.error }));
})();
