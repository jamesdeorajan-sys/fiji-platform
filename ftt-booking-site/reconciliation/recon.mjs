// Fare reconciliation across both sites (arrival transfers, airport -> destination), via lib.mjs: real page code + real deployed Worker bundle + a read-only
// production pricing snapshot (test-fixtures/pricing-snapshot-2026-10-05.json), all outbound blocked. It decides NO fare: it records what each layer says.
//   NAT_APP_JS=<nadi-airport-transfers-site/src/app.js> node reconciliation/recon.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { SOURCES, routesOf, newEnv, runCase, here } from './lib.mjs';

const outDir = path.resolve(process.argv[2] || path.join(here, 'out'));
const env = await newEnv();
const TIMES = [{ label: 'day 10:00', t: '10:00', night: false }, { label: 'night 23:00', t: '23:00', night: true }];
const EXTRAS = [{ label: 'none', seat: false }, { label: 'child seat', seat: true }];
// 'lookup-down' variants: the live /reference-fare lookup is unavailable, so the page can only use its own published table (selection = review = static)
const VARIANTS = [['NAT-live(c5ee3b1)', 'nat', 'nat', true], ['FD-prod(8c6f920)', 'fd-prod', 'fd-prod', false], ['FD-candidate', 'fd-cand', 'fd-cand', true],
  ['FD-prod(8c6f920) lookup-down', 'nat', 'fd-prod', false], ['FD-candidate lookup-down', 'nat', 'fd-cand', true]];

const rows = [];
for (const [label, variant, srcKey, optIn] of VARIANTS) {
  const src = SOURCES[srcKey]();
  for (const route of routesOf(src)) for (const vehicle of ['sedan', 'minivan', 'minibus']) for (const trip of ['one-way', 'return']) for (const ex of EXTRAS) for (const tm of TIMES) {
    const base = { site: label, route: route.destValue, area: route.area, vehicle, direction: 'airport -> destination (arrival)', trip, time: tm.label, extras: ex.label };
    let r;
    try { r = await runCase(env, { variant, src, row: route, vehicle, trip, time: tm.t, seat: ex.seat, optIn }); } catch (e) { rows.push({ ...base, cls: 'HARNESS_ERROR', note: String(e.message).slice(0, 100) }); continue; }
    rows.push({ ...base, advertised_one_way_base: r.advertised, selection: r.selection, review: r.review, submitted: r.submitted, worker_calculated: r.worker, saved: r.saved, in_band: r.inBand,
      selection_review_mismatch: r.selection !== r.review, cls: r.cls, note: r.note || '' });
  }
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'reconciliation_rows.json'), JSON.stringify(rows));
const cols = ['site', 'route', 'area', 'vehicle', 'direction', 'trip', 'time', 'extras', 'advertised_one_way_base', 'selection', 'review', 'submitted', 'worker_calculated', 'saved', 'in_band', 'selection_review_mismatch', 'cls', 'note'];
fs.writeFileSync(path.join(outDir, 'reconciliation_rows.csv'), [cols.join(',')].concat(rows.map((r) => cols.map((c) => { const v = r[c] ?? ''; return /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v; }).join(','))).join('\n'));
const summary = {};
for (const r of rows) { const s = (summary[r.site] ||= { rows: 0, byClass: {}, selection_review_mismatch: 0, night_saved_without_surcharge: 0 }); s.rows++; s.byClass[r.cls] = (s.byClass[r.cls] || 0) + 1; if (r.selection_review_mismatch) s.selection_review_mismatch++; if (r.time.startsWith('night') && r.saved != null && r.worker_calculated != null && r.saved < r.worker_calculated - 0.005) s.night_saved_without_surcharge++; }
fs.writeFileSync(path.join(outDir, 'reconciliation_summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
console.log('outbound calls the Worker attempted (all blocked):', env.rig.all.fetches.length, '| bookings in the in-memory DB:', env.rig.all.inserted.length);
