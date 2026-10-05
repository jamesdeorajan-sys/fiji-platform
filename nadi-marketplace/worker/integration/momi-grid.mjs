// Momi minibus ONLY: daytime/night x one-way/return x {no extras, child seat, surfboard, both}. For each cell it records, SEPARATELY, what each component quotes / submits / saves / calculates in
// production (released NAT c5ee3b1, FijiDash 8c6f920, Worker 0b961a4) and in the candidates, then shows PROPOSED coherent totals as arithmetic on the recommended options (NOT IMPLEMENTED, NOT APPROVED).
// Isolated: real page functions, real Worker source, in-memory DB, outbound blocked. Same environment variables as journey.test.mjs.
//   node integration/momi-grid.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { NEW_DIR, missing, worker, journey, srcs } from './harness.mjs';
if (missing.length) { console.error('set ' + missing.join(', ')); process.exit(2); }
console.warn = () => {};
const outDir = path.resolve(process.argv[2] || 'out');
const S = srcs(); const OLD = process.env.WORKER_OLD_DIR;
const EXTRAS = [['none', false, false], ['child seat', true, false], ['surfboard', false, true], ['both', true, true]];
const TIMES = [['day 10:00', '10:00'], ['night 23:00', '23:00']];
const TRIPS = ['one-way', 'return'];
const x = (seat, surf) => (seat ? 8 : 0) + (surf ? 24 : 0);
const c2 = (n) => Math.round(n * 100) / 100;

async function workerCalc(dir, { trip, time, seat, surf, withId }) {
  const w = await worker(dir);
  const body = { guest_name: 'Zed Testperson', guest_phone: '+61411222333', client_booking_ref: 'GRID-' + Math.random().toString(36).slice(2, 8), pickup_zone: 'Nadi Airport', destination_zone: 'Momi Bay', vehicle_type: 'minibus', quoted_currency: 'FJD', quoted_amount: 5, fx_rate_at_booking: 1, distance_km: 38.623, payment_method: 'cash',
    pickup_date: '2026-10-20', pickup_time: time, trip_type: trip, has_child_seat: seat, has_surfboard: surf, has_tour: false, is_custom_address: false, require_quote_match: true,
    ...(trip === 'return' ? { return_date: '2026-10-27', return_time: '10:00', return_pickup_location: 'Hotel' } : {}), ...(withId ? { approved_final_fare_id: 'MOMI_MARRIOTT_MINIBUS_ONE_WAY_DAY' } : {}) };
  const r = await w.post(body); return r.body && r.body.reference_fare_fjd;          // the Worker's own calculated TOTAL for this itinerary (after discount, extras and night included)
}
async function run(site, src, dir, o) {
  const w = await worker(dir); const j = await journey({ site, src, w, o });
  return { selection: j.selection, review: j.review, submitted: j.submitted, saved: w.saved() ? w.saved().quoted_amount : null, id: j.approvedId || null, decision: w.decision() ? w.decision().outcome : null };
}

const cells = [];
for (const [tl, time] of TIMES) for (const trip of TRIPS) for (const [el, seat, surf] of EXTRAS) {
  const o = { trip, time, seat, surf }; const cell = { key: `${tl}, ${trip}, ${el}`, time: tl, trip, extras: el, seat, surf };
  cell.natProd = await run('nat', S.natOld, OLD, o); cell.natCand = await run('nat', S.natNew, NEW_DIR, o);
  cell.fdProd = await run('fd', S.fdOld, OLD, o); cell.fdCand = await run('fd', S.fdNew, NEW_DIR, o);
  const approvedCell = tl === 'day 10:00' && trip === 'one-way' && el === 'none';
  cell.workerProd = await workerCalc(OLD, { trip, time, seat, surf, withId: false });
  cell.workerCand = await workerCalc(NEW_DIR, { trip, time, seat, surf, withId: false });
  cell.workerCandWithId = await workerCalc(NEW_DIR, { trip, time, seat, surf, withId: approvedCell || undefined });
  // PROPOSED coherent totals (arithmetic on options; NOT implemented, NOT approved). One-way: the approved final fare stays the transfer component (175.92 by day);
  // extras at their listed price (E-A), no second transfer discount. Night: N-A none, or N-B x1.2 on the transfer component in cents. Return: the approved 297 / 304 stay; everything else
  // keeps the existing page arithmetic (the NAT / FijiDash-candidate figure), which this table only checks for coherence.
  if (trip === 'one-way') { cell.propA = c2(175.92 + x(seat, surf)); cell.propB = c2((time === '23:00' ? 175.92 * 1.2 : 175.92) + x(seat, surf)); }
  else { cell.propA = cell.natCand.saved; cell.propB = cell.natCand.saved; }
  cells.push(cell);
}
const get = (t, trip, e) => cells.find((c) => c.time === t && c.trip === trip && c.extras === e);
// inversion checks per component (extras never lower a total; night never below day; return never below one-way) on a given accessor
const inversions = (acc, label) => {
  const out = [];
  for (const t of TIMES.map((a) => a[0])) for (const trip of TRIPS) for (const [e] of EXTRAS.slice(1)) { const a = acc(get(t, trip, 'none')), b = acc(get(t, trip, e)); if (b < a - 0.005) out.push(`${label}: ${t} ${trip}: ${e} (${b}) < no extras (${a})`); }
  for (const trip of TRIPS) for (const [e] of EXTRAS) { const d = acc(get('day 10:00', trip, e)), n = acc(get('night 23:00', trip, e)); if (n < d - 0.005) out.push(`${label}: ${trip} ${e}: night (${n}) < day (${d})`); }
  for (const t of TIMES.map((a) => a[0])) for (const [e] of EXTRAS) { const o = acc(get(t, 'one-way', e)), r = acc(get(t, 'return', e)); if (r < o - 0.005) out.push(`${label}: ${t} ${e}: return (${r}) < one-way (${o})`); }
  return out;
};
const inv = { natProd: inversions((c) => c.natProd.saved, 'NAT production (saved)'), natCand: inversions((c) => c.natCand.saved, 'NAT candidate (saved)'), fdProd: inversions((c) => c.fdProd.saved, 'FijiDash production (saved)'), fdCand: inversions((c) => c.fdCand.saved, 'FijiDash candidate (saved)'),
  workerProd: inversions((c) => c.workerProd, 'Worker production (calculated)'), workerCand: inversions((c) => c.workerCand, 'Worker candidate (calculated, no id)'), propA: inversions((c) => c.propA, 'PROPOSED E-A + N-A'), propB: inversions((c) => c.propB, 'PROPOSED E-A + N-B') };

const f = (n) => (n === null || n === undefined ? '-' : Number.isInteger(n) ? String(n) : Number(n).toFixed(2));
const q = (r) => `${f(r.selection)}${r.review !== r.selection ? ' / ' + f(r.review) : ''} -> ${f(r.submitted)} -> **${f(r.saved)}**`;
let md = '';
md += '| Cell | NAT production (quote -> submitted -> saved) | NAT candidate | FijiDash production (selection / review -> submitted -> saved) | FijiDash candidate | Worker production (calculated total) | Worker candidate (no id) | Worker candidate (with approved id) | PROPOSED: extras at list price, night none | PROPOSED: extras at list price, night x1.2 on the transfer |\n|---|---|---|---|---|---|---|---|---|---|\n';
for (const c of cells) md += `| ${c.key} | ${q(c.natProd)} | ${q(c.natCand)} | ${q(c.fdProd)} | ${q(c.fdCand)} | ${f(c.workerProd)} | ${f(c.workerCand)} | ${f(c.workerCandWithId)} | ${f(c.propA)}${c.trip === 'return' ? ' (unchanged)' : ''} | ${f(c.propB)}${c.trip === 'return' ? ' (unchanged)' : ''} |\n`;
md += '\n### Inversions found (a total that goes DOWN when it should not)\n\n';
for (const [k, v] of Object.entries(inv)) md += `- **${k}**: ${v.length ? '\n' + v.map((s) => '  - ' + s).join('\n') : 'none'}\n`;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'momi_grid.json'), JSON.stringify({ cells, inversions: inv }, null, 1)); fs.writeFileSync(path.join(outDir, 'momi_grid.md'), md);
console.log(md);
