// Local-only repro of NAT route->vehicle. All non-local network aborted: nothing saves, nothing notifies.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const SRC = process.argv[2], TAG = process.argv[3] || 'before';
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.ico':'image/x-icon', '.xml':'text/xml', '.txt':'text/plain' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SRC, p); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end('nf'); } else { r.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); }).listen(0);
const ROUTES = [['Denarau','Hilton Fiji'],['CoralCoast','Outrigger'],['Natadola','Natadola'],['Momi','Momi']];
(async () => {
  await new Promise(r => srv.once('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch();
  const out = [];
  for (const w of [320, 360, 390, 430]) {
    for (const [label, q] of ROUTES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      const blocked = [];
      await page.route('**/*', rt => { const u = rt.request().url(); if (u.startsWith(base)) return rt.continue(); blocked.push(rt.request().method() + ' ' + u.split('?')[0]); return rt.abort(); });
      await page.addInitScript(() => { window.__NAT_FUNNEL_CAPTURE = []; });
      const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 120)));
      await page.goto(base + '/', { waitUntil: 'load' });
      await page.waitForTimeout(600);
      const rec = { w, route: label, tag: TAG };
      // choose destination through the visible typeahead like a guest
      await page.evaluate(() => document.getElementById('booking').scrollIntoView());
      await page.click('#pickup_ta_trigger'); await page.fill('#pickup_ta_search', 'Nadi International'); await page.waitForTimeout(250);
      const po = await page.$('#pickup_ta_list .ta-opt:not(.ta-opt-sentinel)'); rec.pickupOptionFound = !!po; if (po) await po.tap().catch(() => po.click()); await page.waitForTimeout(300);
      await page.click('#destination_ta_trigger');
      await page.fill('#destination_ta_search', q);
      await page.waitForTimeout(250);
      const opt = await page.$('#destination_ta_list .ta-opt:not(.ta-opt-sentinel)');
      rec.optionFound = !!opt;
      if (opt) await opt.tap().catch(() => opt.click());
      await page.waitForTimeout(400);
      rec.destValue = await page.$eval('#destination', e => e.value);
      rec.pickupValue = await page.$eval('#pickup', e => e.value);
      const geo = async sel => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, disabled: !!e.disabled, display: getComputedStyle(e).display }; }, sel);
      rec.cta1_beforeScroll = await geo('#nextBtn1'); rec.selVehAfterRoute = await page.evaluate(() => state.selectedVehicle);
      rec.scrollY_afterRoute = await page.evaluate(() => Math.round(scrollY));
      if (w === 390 && label === 'Denarau') await page.screenshot({ path: `shots/${TAG}-${w}-${label}-1-after-route.png` });
      // Continue WITHOUT flight (the guest who does not have it)
      const nb = await page.$('#nextBtn1');
      await nb.scrollIntoViewIfNeeded(); await nb.tap().catch(() => nb.click());
      await page.waitForTimeout(700);
      rec.step2Visible = await page.$eval('#step2', e => e.style.display !== 'none');
      rec.flightErrorVisible = await page.$eval('#flightError', e => !e.hidden).catch(() => null);
      rec.flightNumValue = await page.$eval('#flightNum', e => e.value);
      if (w === 390 && label === 'Denarau') await page.screenshot({ path: `shots/${TAG}-${w}-${label}-2-after-continue-no-flight.png` });
      // Now satisfy the gate by ticking "don't know" if blocked, then continue
      if (!rec.step2Visible && await page.$('#flightUnknown')) { await page.tap('#flightUnknown').catch(() => page.click('#flightUnknown')); await page.waitForTimeout(200); const nb2 = await page.$('#nextBtn1'); await nb2.scrollIntoViewIfNeeded(); await nb2.tap().catch(() => nb2.click()); await page.waitForTimeout(700); rec.step2AfterUnknownTick = await page.$eval('#step2', e => e.style.display !== 'none'); }
      rec.selectedVehicleAtStep2 = await page.evaluate(() => state.selectedVehicle); rec.selectedVehicleAfterRoute = rec.selVehAfterRoute;
      rec.cta2 = await geo('#nextBtn2');
      rec.vehicleHint = await page.$eval('#vehicleHint', e => e.textContent.trim().slice(0, 80)).catch(() => null);
      if (w === 390 && label === 'Denarau') await page.screenshot({ path: `shots/${TAG}-${w}-${label}-3-vehicle-step.png` });
      rec.funnel = await page.evaluate(() => (window.__NAT_FUNNEL_CAPTURE||[]).map(p => p.event_type));
      rec.blockedRequests = blocked.length; rec.jsErrors = errs;
      out.push(rec); await ctx.close();
    }
  }
  await browser.close(); srv.close();
  fs.writeFileSync(`result-${TAG}.json`, JSON.stringify(out, null, 1));
  for (const r of out) console.log(JSON.stringify({ w: r.w, route: r.route, opt: r.optionFound, pick: r.pickupValue, dest: r.destValue, cta1top: r.cta1_beforeScroll && r.cta1_beforeScroll.top, vh: 844, step2NoFlight: r.step2Visible, flightErr: r.flightErrorVisible, step2AfterTick: r.step2AfterUnknownTick, veh: r.selectedVehicleAtStep2, nextBtn2Disabled: r.cta2 && r.cta2.disabled, ev: r.funnel.join(','), js: r.jsErrors.length }));
})();
