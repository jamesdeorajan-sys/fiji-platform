// Night-surcharge reproduction with the ACTUAL client code and the ACTUAL deployed Worker together (isolated, outbound blocked).
// For each pickup time at the 22:00 / 06:00 boundaries, and for different outbound / return pickup times, it records selection -> review -> submitted -> Worker-calculated -> saved.
// It decides NO rule. Output: <outDir>/night_rows.json and night.md.
//   NAT_APP_JS=<nadi-airport-transfers-site/src/app.js> node reconciliation/night.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { SOURCES, routesOf, newEnv, runCase } from './lib.mjs';

const outDir = path.resolve(process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), 'out'));
const env = await newEnv();
const SITES = [['NAT live c5ee3b1 (static table, opt-in)', 'nat', 'nat', true], ['FijiDash production 8c6f920 (live fare, no opt-in)', 'fd-prod', 'fd-prod', false], ['FijiDash candidate (live fare, opt-in)', 'fd-cand', 'fd-cand', true]];
const CASES = [['HILTON_DENARAU', 'sedan'], ['MARRIOTT_MOMI', 'minibus'], ['MERCURE_NADI', 'minivan']];
const OUTBOUND = ['21:59', '22:00', '05:59', '06:00'];
const rows = [];
for (const [label, variant, key, optIn] of SITES) {
  const src = SOURCES[key]();
  for (const [dest, vehicle] of CASES) {
    const row = routesOf(src).find((r) => r.destValue === dest);
    for (const time of OUTBOUND) {
      rows.push({ site: label, dest, vehicle, trip: 'one-way', outbound: time, return: '-', ...(await runCase(env, { variant, src, row, vehicle, trip: 'one-way', time, returnTime: '10:00', seat: false, optIn })) });
    }
    // return trips: outbound day / return night, outbound night / return day, both night, both day
    for (const [out, ret] of [['10:00', '23:00'], ['10:00', '05:59'], ['23:00', '10:00'], ['23:00', '23:00'], ['21:59', '22:00'], ['10:00', '10:00']]) {
      rows.push({ site: label, dest, vehicle, trip: 'return', outbound: out, return: ret, ...(await runCase(env, { variant, src, row, vehicle, trip: 'return', time: out, returnTime: ret, seat: false, optIn })) });
    }
  }
}
const f = (n) => (n === null || n === undefined ? '-' : Number.isInteger(n) ? String(n) : n.toFixed(2));
let md = '| Site | Route / vehicle | Trip | Outbound pickup | Return pickup | Selection | Review | Submitted | Worker-calculated | Saved | Class |\n|---|---|---|---|---|---|---|---|---|---|---|\n';
for (const r of rows) md += `| ${r.site.split(' (')[0]} | ${r.dest} ${r.vehicle} | ${r.trip} | ${r.outbound} | ${r.return} | ${f(r.selection)} | ${f(r.review)} | ${f(r.submitted)} | ${f(r.worker)} | ${f(r.saved)} | ${r.cls} |\n`;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'night_rows.json'), JSON.stringify(rows.map(({ calc, ...x }) => x), null, 1));
fs.writeFileSync(path.join(outDir, 'night.md'), md);
console.log(md);
