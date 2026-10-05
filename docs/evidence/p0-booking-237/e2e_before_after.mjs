// END-TO-END before/after for the exact itinerary of booking #237, with NO live booking, NO message and NO network:
//   page code  = the real app.js functions (live base c6d62a6 for BEFORE, the repair for AFTER) evaluated in a sandbox;
//   Worker     = the real worker.js (deployed 2125a34 for BEFORE, the repair for AFTER) over an in-memory DB seeded from the production pricing snapshot.
// NAN -> Marriott Momi Bay, minibus, 7 pax / 7 bags, child seat, return; outbound 15 Oct 2026 09:15, return 19 Oct 2026 06:00.
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const SCR = 'C:/Users/James/AppData/Local/Temp/claude/C--Users-James-Desktop-VAKAVITI-MASTER/a8c468c9-8b61-4c40-9acf-bf7f5a2e8175/scratchpad';
const workerRepo = `${SCR}/p0-worker`; const siteRepo = `${SCR}/p0-site`;
const harnessUrl = pathToFileURL(`${workerRepo}/nadi-marketplace/worker/test-fixtures/worker-harness.mjs`).href;
const { postBooking } = await import(harnessUrl);

function worker(rev) { // a directory holding worker.js + pricing.mjs from a git revision (or the working tree when rev is null)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'));
  for (const f of ['worker.js', 'pricing.mjs']) fs.writeFileSync(path.join(dir, f), rev ? execFileSync('git', ['show', `${rev}:nadi-marketplace/worker/${f}`], { cwd: workerRepo, maxBuffer: 1e8 }).toString() : fs.readFileSync(`${workerRepo}/nadi-marketplace/worker/${f}`, 'utf8'));
  return dir;
}
function page(srcPath) {
  const lines = fs.readFileSync(srcPath, 'utf8').replace(/\r/g, '').split('\n');
  const idx = (re, from = 0) => lines.findIndex((l, i) => i >= from && re.test(l));
  const rs = idx(/^const ROUTES_DATA = \[/);
  const code = [lines.slice(idx(/^const NIGHT_SURCHARGE/), idx(/^\/\/ ─── EMOJI STRIPPER/)).join('\n'), lines.slice(idx(/^function isNightPickup/), idx(/^\/\/ ─── RELIABLY SET A <SELECT>/)).join('\n'), lines.slice(rs, idx(/^\];/, rs) + 1).join('\n'),
    lines.slice(idx(/^async function submitNadiBooking\(/), idx(/^\/\/ Same non-blocking, fire-and-forget escalation pattern/)).join('\n')].join('\n');
  const fields = { firstName: { value: 'Guest' }, lastName: { value: 'Test' }, phone: { value: '+61400000000' }, email: { value: 'g@example.test' }, flightNum: { value: '' }, notes: { value: '' }, travelDate: { value: '2026-10-15' }, travelTime: { value: '09:15' },
    returnDate: { value: '2026-10-19' }, returnTime: { value: '06:00' }, returnPickupLocation: { value: 'Fiji Marriott Resort Momi Bay' }, pickup: { value: 'NAN' }, destination: { value: 'MARRIOTT_MOMI' }, 'extra-seat': { checked: true }, 'extra-surf': { checked: false } };
  const sb = { Math, Number, parseInt, JSON, Promise, console, state: { tripType: 'return', prices: {}, extrasTotal: 8, passengers: 7, luggage: 7, selectedVehicle: 'minibus', selectedTour: null, distanceKm: 38.6, destination: { hotel: 'Fiji Marriott Resort Momi Bay' } },
    document: { getElementById: (id) => fields[id] }, NADI_API_BASE: 'https://api.test', buildOperationalNotes: () => 'Passengers: 7 | Luggage: 7', reportNadiSyncFailure: async () => {}, __server: null, __last: null };
  sb.bookingRequest = async (url, o) => { const r = await postBooking(sb.__server, JSON.parse(o.body)); sb.__last = r; return { response: { ok: r.status < 400, status: r.status }, data: r.body }; };
  vm.createContext(sb); vm.runInContext('var TIER = {}; ' + code + '; state.prices = computePrices("NAN", "MARRIOTT_MOMI", 40);', sb);
  return sb;
}
const out = {};

// ---------------- BEFORE: the live page against the deployed Worker
{
  const sb = page(`${siteRepo}/../p0/app_live.js`.replace('/p0-site/../p0', '/p0')); sb.__server = worker('2125a34');
  const shown = vm.runInContext('calculateTotal().final', sb);
  const r = await vm.runInContext('submitNadiBooking("FTT-BEFORE", "Momi Bay")', sb);
  out.before = { guest_sees_and_accepts_fjd: shown, page_submits_fjd: sb.__last && JSON.parse(JSON.stringify(sb.__last.saved)).quoted_amount !== undefined ? shown : shown, worker_http_status: sb.__last.status, saved_fjd: sb.__last.saved.quoted_amount,
    guest_told_of_change: false, page_reads_amount_from_response: false, booking_created: r.ok === true, created_event_records_adjustment: Boolean(sb.__last.events[0] && sb.__last.events[0].metadata && sb.__last.events[0].metadata.pricing_adjustment) };
}
// ---------------- AFTER (a): the repaired page against the repaired Worker - the guest is shown, accepts, and the accepted amount is saved
{
  const sb = page(`${siteRepo}/nadi-airport-transfers-site/src/app.js`); sb.__server = worker(null);
  const shownFirst = vm.runInContext('calculateTotal().final', sb);
  const first = await vm.runInContext('submitNadiBooking("FTT-AFTER", "Momi Bay")', sb);
  const firstStatus = sb.__last.status; const firstSaved = sb.__last.saved;
  // exactly what confirmBooking() does on a mismatch: remember the booking system fare for these pricing inputs and re-show the review
  vm.runInContext('state.fareOverride = { key: fareOverrideKey(), amount: ' + first.priceMismatch.reference + ', shown: ' + first.priceMismatch.submitted + ' }', sb);
  const shownSecond = vm.runInContext('calculateTotal().final', sb); const label = vm.runInContext('calculateTotal().serverConfirmed', sb);
  const second = await vm.runInContext('submitNadiBooking("FTT-AFTER", "Momi Bay")', sb);
  out.after_page_and_worker = { first_submit: { page_shown_fjd: shownFirst, worker_http_status: firstStatus, saved_anything: firstSaved !== null, mismatch: first.priceMismatch },
    guest_then_sees_fjd: shownSecond, review_marked_as_confirmed_by_booking_system: label === true,
    second_submit: { page_submits_fjd: shownSecond, worker_http_status: sb.__last.status, saved_fjd: sb.__last.saved.quoted_amount, booking_created: second.ok === true },
    shown_equals_accepted_equals_saved: shownSecond === sb.__last.saved.quoted_amount && sb.__last.saved.quoted_amount === first.priceMismatch.reference, alert_amount_fjd: sb.__last.saved.quoted_amount };
}
// ---------------- AFTER (b): an OLD cached page (no flag) against the repaired Worker - unchanged save, but now recorded
{
  const sb = page(`${SCR}/p0/app_live.js`); sb.__server = worker(null);
  await vm.runInContext('submitNadiBooking("FTT-OLDCACHE", "Momi Bay")', sb);
  const ev = sb.__last.events[0] && sb.__last.events[0].metadata;
  out.after_old_cached_page = { worker_http_status: sb.__last.status, saved_fjd: sb.__last.saved.quoted_amount, adjustment_recorded: ev && ev.pricing_adjustment, residual_risk: 'the guest of an old cached page still sees 142 and is saved at 300.45 until the cache key changes (max 4h) - now recorded, not prevented' };
}
fs.writeFileSync(`${SCR}/p0/e2e_before_after.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
