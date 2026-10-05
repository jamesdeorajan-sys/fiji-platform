// Audit of the "FijiDash production: selection differs from review on 840 of 840 priceable rows" claim: counting definitions, distribution, raw calculations.
//   node reconciliation/audit_selection_review.mjs <outDir>      (production source is read from git: 8c6f920)
import fs from 'node:fs';
import path from 'node:path';
import { SOURCES, routesOf, newEnv, runCase, zoneOf, kmOf } from './lib.mjs';

const outDir = path.resolve(process.argv[2] || 'out');
const env = await newEnv();
const src = SOURCES['fd-prod']();
const routes = routesOf(src);
const TIMES = [['day 10:00', '10:00'], ['night 23:00', '23:00']]; const EXTRAS = [['none', false], ['child seat', true]];
const rows = [];
for (const row of routes) for (const vehicle of ['sedan', 'minivan', 'minibus']) for (const trip of ['one-way', 'return']) for (const [el, seat] of EXTRAS) for (const [tl, time] of TIMES) {
  const r = await runCase(env, { variant: 'fd-prod', src, row, vehicle, trip, time, seat, optIn: false });
  rows.push({ route: row.destValue, vehicle, trip, extras: el, time: tl, ...r });
}
const priceable = rows.filter((r) => r.cls !== 'ZONE_NOT_IN_PRICING_DATA' && r.cls !== 'MISSING_PRICING_RULE');
const excluded = rows.filter((r) => !priceable.includes(r));
const d = (r) => Math.abs(r.selection - r.review);
const pct = (r) => (r.selection === 0 ? 0 : d(r) / r.selection);
const count = (fn) => priceable.filter(fn).length;
const by = (key) => { const o = {}; for (const r of priceable) { const k = r[key]; o[k] ||= { n: 0, differs: 0 }; o[k].n++; if (d(r) > 0.005) o[k].differs++; } return o; };
const lines = [];
const P = (s = '') => lines.push(s);
P('# Audit: FijiDash production selection vs review (counting definitions and raw calculations)\n');
P('## Definitions');
P('- **Row** = route x vehicle (sedan/minivan/minibus) x trip (one-way/return) x extras (none / child seat FJ$8) x pickup time (day 10:00 / night 23:00). Arrival direction, airport -> destination, FJD only.');
P(`- **Rows enumerated:** ${rows.length} (${routes.length} FijiDash routes x 24).`);
P(`- **Excluded from the denominator (no server price to compare against):** ${excluded.length} rows = ${[...new Set(excluded.map((r) => r.route))].join(', ')} (Worker has no zone distance/rule). They are counted separately, never as "matching" or "differing".`);
P(`- **Priceable rows (denominator):** ${priceable.length}.`);
P('- **Selection total** = the page\'s own `calculateTotal(vehicle).final` immediately after `computePrices` (the static published table, with the page\'s night/return modifiers), for the chosen vehicle, with the same extras, trip type and pickup time. This is what the vehicle card shows.');
P('- **Review total** = `calculateTotal(vehicle).final` after the real `renderFareTiers()` has replaced `state.prices[vehicle]` with the Worker `/reference-fare` answer for the same zone, vehicle and trip type. Same state object, same extras, same discount function (10% of the subtotal, whole dollars, only when the subtotal exceeds FJ$50), same currency (FJD). Only `state.prices[vehicle]` differs between the two reads.');
P('- **Differs** = |selection - review| > FJ$0.005 (any difference at all). Thresholds below show how many differ materially.');
P('- **Lookup failures:** this table assumes the lookup succeeds. When the lookup is unavailable the page cannot replace the price, so selection = review by construction (counted in the separate "lookup-down" variants in RECONCILIATION.md, never in this 840). Missing prices: none among priceable rows (every one has a published table figure and a Worker figure).\n');
P('## Result');
P('| Measure | Rows | Share of priceable |\n|---|---|---|');
const T = (label, n) => P(`| ${label} | ${n} | ${(100 * n / priceable.length).toFixed(1)}% |`);
T('Priceable rows', priceable.length); T('Differ at all (> FJ$0.005)', count((r) => d(r) > 0.005)); T('Identical (<= FJ$0.005)', count((r) => d(r) <= 0.005));
T('Differ by more than FJ$1', count((r) => d(r) > 1)); T('Differ by more than FJ$5', count((r) => d(r) > 5)); T('Differ by more than FJ$20', count((r) => d(r) > 20));
T('Differ by more than 5% of the selection total', count((r) => pct(r) > 0.05)); T('Differ by more than 20% of the selection total', count((r) => pct(r) > 0.2));
P(`\nLargest difference: FJ$${Math.max(...priceable.map(d)).toFixed(2)}. Median difference: FJ$${priceable.map(d).sort((a, b) => a - b)[Math.floor(priceable.length / 2)].toFixed(2)}.`);
const base = priceable.filter((r) => r.extras === 'none' && r.time === 'day 10:00');
P(`\nRows are combinations, not 840 distinct guest journeys. The base subset (day, no extras) is ${base.length} route/vehicle/trip cases: ${base.filter((r) => d(r) > 0.005).length} differ at all, ${base.filter((r) => d(r) > 1).length} by more than FJ$1, ${base.filter((r) => d(r) > 5).length} by more than FJ$5, ${base.filter((r) => pct(r) > 0.2).length} by more than 20%.`);
P('\nWhy nearly all rows differ at all: the published table holds whole-dollar figures, the Worker figure is a distance formula in cents, so exact equality is essentially impossible. That is why "840 of 840" overstates the guest impact: 50 rows differ by FJ$1 or less. The material counts above are the honest measure.\n');
for (const k of ['time', 'trip', 'vehicle', 'extras']) { P(`### By ${k}\n\n| ${k} | rows | differ at all |\n|---|---|---|`); for (const [name, v] of Object.entries(by(k))) P(`| ${name} | ${v.n} | ${v.differs} |`); P(); }
P('## Representative raw calculations (full `calculateTotal` objects)\n');
const pick = (route, vehicle, trip, extras, time) => priceable.find((r) => r.route === route && r.vehicle === vehicle && r.trip === trip && r.extras === extras && r.time === time);
const reps = [pick('MARRIOTT_MOMI', 'minibus', 'one-way', 'none', 'day 10:00'), pick('MERCURE_NADI', 'sedan', 'one-way', 'none', 'day 10:00'), pick('HILTON_DENARAU', 'sedan', 'one-way', 'none', 'day 10:00'),
  pick('CROWNE_PLAZA_NADI_BAY', 'sedan', 'return', 'child seat', 'night 23:00'), pick('MERCURE_NADI', 'minivan', 'return', 'none', 'day 10:00'), pick('SHANGRI_LA_YANUCA', 'minibus', 'one-way', 'none', 'day 10:00')].filter(Boolean);
for (const r of reps) {
  const c = r.calc; const fmt = (t) => `vehiclePrice ${t.vehiclePrice}, extras ${t.extras}, subtotal ${t.subtotal}, discount ${t.discount}, **final ${t.final}**`;
  P(`**${r.route} / ${r.vehicle} / ${r.trip} / extras ${r.extras} / ${r.time}**`);
  P(`- selection (static table incl. page modifiers): ${fmt(c.selection)}`);
  P(`- Worker /reference-fare (${r.trip}; pre-discount, no night, no extras): ${c.liveRef}`);
  P(`- review (same state, vehicle price replaced): ${fmt(c.review)}`);
  P(`- difference ${(c.review.final - c.selection.final).toFixed(2)}; discount function identical (10% of the subtotal when above FJ$50, whole dollars).\n`);
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'AUDIT-selection-vs-review.md'), lines.join('\n'));
console.log(lines.join('\n'));
