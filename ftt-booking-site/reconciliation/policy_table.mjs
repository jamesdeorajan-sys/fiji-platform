// Pricing-policy decision table for James. Computes what each option would show, from figures that already exist (published catalogue, Worker formula, the page's and the Worker's
// own arithmetic). It decides NO fare, invents NO figure, does not touch fuel, and writes nothing to production. Isolated harness (lib.mjs): real page code + real Worker bundle.
//   node reconciliation/policy_table.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { SOURCES, routesOf, newEnv, runCase, zoneOf, cents, root } from './lib.mjs';

const outDir = path.resolve(process.argv[2] || 'out');
const env = await newEnv();
const fdSrc = SOURCES['fd-cand'](); const natSrc = SOURCES.nat(); const prodSrc = SOURCES['fd-prod']();
const fdRoutes = routesOf(fdSrc); const natRoutes = routesOf(natSrc);
const f = (n) => (typeof n === 'string' ? n : n === null || n === undefined ? '-' : Number.isInteger(n) ? String(n) : Number(n).toFixed(2));
const disc = (sub) => (sub > 50 ? sub - Math.round(sub * 0.1) : sub);          // page and Worker: 10% of the subtotal, whole dollars, only above FJ$50, never with a tour
const ceil5 = (x) => Math.ceil(x / 5) * 5;
const VEH = ['sedan', 'minivan', 'minibus'];
const L = []; const P = (s = '') => L.push(s);
const csv = [['route', 'vehicle', 'trip', 'catalogue_base_before_discount', 'catalogue_total', 'worker_before_discount', 'worker_total', 'delta_total', 'delta_pct_of_worker', 'in_band_0.8_1.3', 'charged_today_NAT', 'charged_today_FD_production', 'charged_today_FD_candidate', 'worker_fare_checks']];

// ---------- 1. catalogue vs Worker, every route (day 10:00, no extras) ----------
const rows = [];
for (const route of fdRoutes) for (const v of VEH) for (const trip of ['one-way', 'return']) {
  const zone = zoneOf(route.area);
  const cat = await runCase(env, { variant: 'nat', src: fdSrc, row: route, vehicle: v, trip, time: '10:00', seat: false, optIn: true });        // the published catalogue as the page quotes it
  const natRow = natRoutes.find((r) => r.destValue === route.destValue); const nat = natRow ? await runCase(env, { variant: 'nat', src: natSrc, row: natRow, vehicle: v, trip, time: '10:00', seat: false, optIn: true }) : { saved: null, selection: null };
  const prod = await runCase(env, { variant: 'fd-prod', src: prodSrc, row: route, vehicle: v, trip, time: '10:00', seat: false, optIn: false });
  const cand = await runCase(env, { variant: 'fd-cand', src: fdSrc, row: route, vehicle: v, trip, time: '10:00', seat: false, optIn: true });
  const F1 = zone ? await env.referenceFare(zone, v, 'one-way') : null; const Fr = zone ? await env.referenceFare(zone, v, trip) : null;
  rows.push({ route: route.destValue, area: route.area, zone, vehicle: v, trip, catBase: route[{ sedan: 's', minivan: 'v', minibus: 'm' }[v]], catTotal: cat.selection, worker: cat.worker, workerPre: Fr, natCharged: nat.cls === 'CONSENT_REQUIRED' ? `refused at ${f(nat.selection)}: guest must accept the Worker fare` : (nat.saved ?? nat.selection), prodCharged: prod.saved, candCharged: cand.cls === 'CONSENT_REQUIRED' ? 'refused: consent' : cand.saved, cls: cat.cls, candCls: cand.cls });
}
const priceable = rows.filter((r) => r.worker !== null && r.worker !== undefined);
const delta = (r) => r.catTotal - r.worker;
const disputed = priceable.filter((r) => Math.abs(delta(r)) > 5 && Math.abs(delta(r)) / r.worker > 0.05);
const outBand = priceable.filter((r) => r.catTotal < 0.8 * r.worker || r.catTotal > 1.3 * r.worker);
for (const r of priceable) csv.push([r.route, r.vehicle, r.trip, r.catBase, r.catTotal, r.workerPre === null ? '' : cents(r.workerPre), r.worker, cents(delta(r)), (100 * delta(r) / r.worker).toFixed(1), !outBand.includes(r), r.natCharged, r.prodCharged, r.candCharged, '']);

P('# Pricing-policy decision table (for James) - 2026-10-05');
P('');
P('**Production remains on HOLD. This is a decision aid, not a release and not a recommendation of any fare.** Every figure below is computed from numbers that already exist (the published catalogue `ROUTES_DATA`, the Worker\'s distance formula, and each side\'s own arithmetic) in the isolated harness (real page code + the real deployed Worker bundle `7a32a034` + the read-only pricing snapshot of 2026-10-05; outbound blocked). No fare was invented, fuel adjustments are NOT enabled (the fuel index is unchanged: multiplier 1, FJ$3.39/L), and no live booking, message or production write was made. Tick boxes (`[ ]`) are for James.');
P('');
P('Only two commercial decisions exist today: the Momi minibus base FJ$175.92 (before the 10% discount) and the Momi return convention (157.92 one-way / 297 return / 304 return + child seat). Nothing else in this document is approved. "Catalogue" below means the fares published in the booking tool / route pages (`ROUTES_DATA`) - published, **not** approved as the commercially intended fare. "Worker" means the distance formula in the booking Worker - also not approved.');
P('');
P('## 1. Published catalogue versus Worker formula, every disputed route');
P('');
P(`Basis: day pickup 10:00, no extras, arrival (airport -> destination), totals as the guest sees them (after the existing 10% discount). ${priceable.length} route/vehicle/trip cases are priceable (Tanoa International has no Worker rule, see section 4). **Disputed = the two differ by more than FJ$5 and by more than 5% of the Worker figure: ${disputed.length} cases on ${new Set(disputed.map((r) => r.route)).size} routes.** ${outBand.length} of them are outside the Worker's 0.8x-1.3x acceptance band (the Worker would refuse the catalogue figure under the quote-consent opt-in); the rest differ but sit inside the band (the Worker keeps the shown figure). The other ${priceable.length - disputed.length} cases agree to within FJ$5 / 5% and need no decision beyond the global policy. The full ${priceable.length}-row table is in \`policy_catalogue_vs_worker.csv\`.`);
P('');
P('"Charged today" = what is actually saved today: **NAT** (page quotes the catalogue); **FD prod** = FijiDash production (its review step swaps in the Worker figure, so it charges the Worker figure on every priceable route, except when the live lookup fails); **FD cand** = the held candidate (Worker figure, except Momi return = catalogue convention).');
P('');
P('Decision per row: **A** = catalogue is the fare (Worker/live fare must follow it), **B** = Worker formula is the fare (catalogue and pages must follow it), **C** = another figure (James supplies it). A global choice can be recorded once in the last section.');
P('');
P('| Route | Vehicle | Trip | Catalogue base (before discount) | Catalogue total | Worker total | Catalogue - Worker | In band? | NAT charges | FD prod charges | FD cand charges | Decision |');
P('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of disputed.sort((a, b) => a.route.localeCompare(b.route) || VEH.indexOf(a.vehicle) - VEH.indexOf(b.vehicle) || a.trip.localeCompare(b.trip))) {
  P(`| ${r.route} | ${r.vehicle} | ${r.trip} | ${f(r.catBase)} | ${f(r.catTotal)} | ${f(r.worker)} | ${delta(r) > 0 ? '+' : ''}${f(cents(delta(r)))} (${(100 * delta(r) / r.worker).toFixed(0)}%) | ${outBand.includes(r) ? '**no (refused)**' : 'yes'} | ${f(r.natCharged)} | ${f(r.prodCharged)} | ${f(r.candCharged)} | A / B / C: ____ |`);
}
P('');
P('Priority routes: **Momi** - decided: minibus base 175.92 and the return convention (157.92 / 297 / 304). NOT decided, and visible in the table: the held candidate applies the same return convention to the Momi **sedan and minivan** returns as well (sedan return catalogue 166 vs Worker 157.44; one-way sedan/minivan still follow the Worker figure 85.29 / 132.42 on FijiDash and the catalogue 89 / 134 on NAT) - James should confirm or reject that extension. **Nadi / Mercure** - sedan one-way catalogue 19 vs Worker 30.15, outside the band. **Wailoaloa / Crowne Plaza** - sedan return catalogue 67 vs Worker 50.17, outside the band. Both Nadi-area sedan one-way rows (Nadi downtown and Mercure) and both sedan returns for Wailoaloa and Crowne Plaza are the four cases the Worker would refuse.');
P('');

// ---------- 2. night options ----------
const cases = [['MARRIOTT_MOMI', 'minibus'], ['HILTON_DENARAU', 'sedan'], ['MERCURE_NADI', 'sedan'], ['GRAND_PACIFIC', 'minivan']];
const nightRows = [];
const W = (F1, ret, nightOut, seat) => { const t = cents(F1 * (ret ? 1.85 : 1) * (nightOut ? 1.2 : 1)); const sub = cents(t + (seat ? 8 : 0)); return cents(disc(sub)); };   // Worker arithmetic
const PERLEG = (F1, ret, nOut, nRet, seat) => { const legs = ret ? [nOut, nRet] : [nOut]; const share = ret ? 1.85 / 2 : 1; const t = cents(legs.reduce((s, n) => s + F1 * share * (n ? 1.2 : 1), 0)); return cents(disc(cents(t + (seat ? 8 : 0)))); };
const PAGE = (base, ret, nightOut, seat) => { let p = base; if (nightOut) p *= 1.2; if (ret) p *= 1.85; if (nightOut || ret) p = ceil5(p); return disc(p + (seat ? 8 : 0)); };            // page arithmetic
for (const [dest, v] of cases) {
  const route = fdRoutes.find((r) => r.destValue === dest); const zone = zoneOf(route.area);
  const F1 = await env.referenceFare(zone, v, 'one-way'); const base = route[{ sedan: 's', minivan: 'v', minibus: 'm' }[v]];
  // verify the Worker arithmetic against the real Worker (outbound time only matters) for every scenario before it is used below
  for (const [out, ret, trip] of [['10:00', '10:00', 'one-way'], ['23:00', '10:00', 'one-way'], ['10:00', '10:00', 'return'], ['23:00', '10:00', 'return'], ['10:00', '23:00', 'return'], ['23:00', '23:00', 'return']]) {
    const real = await runCase(env, { variant: 'nat', src: fdSrc, row: route, vehicle: v, trip, time: out, returnTime: ret, seat: false, optIn: true });
    const mine = W(F1, trip === 'return', out === '23:00', false);
    if (Math.abs(real.worker - mine) > 0.005) throw new Error(`Worker arithmetic mismatch ${dest} ${v} ${trip} ${out}/${ret}: real ${real.worker} mine ${mine}`);
    // and the page arithmetic against the real page code
    const pg = await runCase(env, { variant: 'nat', src: fdSrc, row: route, vehicle: v, trip, time: out, returnTime: ret, seat: false, optIn: true });
    if (!(dest === 'MARRIOTT_MOMI' && v === 'minibus' && trip === 'return' && false) && Math.abs(pg.selection - PAGE(base, trip === 'return', out === '23:00', false)) > 0.005) throw new Error(`page arithmetic mismatch ${dest} ${v} ${trip} ${out}`);
  }
  const SC = [['One-way, day', false, false, false], ['One-way, night pickup', false, true, false], ['Return: day out / day back', true, false, false], ['Return: NIGHT ARRIVAL (out night, back day)', true, true, false], ['Return: NIGHT RETURN pickup (out day, back night)', true, false, true], ['Return: BOTH night', true, true, true]];
  nightRows.push({ dest, v, F1, base, sc: SC.map(([label, ret, nOut, nRet]) => ({ label, O0: W(F1, ret, false, false), O1: W(F1, ret, nOut, false), O2: PERLEG(F1, ret, nOut, nRet, false), O3: PAGE(base, ret, nOut, false), O4: W(F1, ret, false, false) })) });
}
P('## 2. Night surcharge: options, with day / night-arrival / night-return / both-night totals');
P('');
P('Today (facts, reproduced in `NIGHT.md`): the client and the Worker agree night = pickup 22:00-05:59 (21:59 and 06:00 are day). FijiDash (production and candidate) saves the **day** fare at night on every live-fare route; NAT (static table) applies the page\'s own night modifier (x1.2, then rounded up to FJ$5). Neither the page nor the Worker looks at the return pickup time. The FAQ and the "Night surcharge applied" label say 20% applies.');
P('');
P('Options (the figures are computed with each side\'s existing arithmetic; **no new surcharge rate, no new fare**):');
P('');
P('- **N0 No night surcharge anywhere** (what FijiDash saves today). Pages, FAQ and label stop claiming it; NAT\'s static modifier and the Worker\'s night step are removed.');
P('- **N1 Existing Worker rule on the live fare** (x1.2 on the whole transfer when the OUTBOUND pickup is night; return pickup ignored; extras added after; 10% discount after). Changes FijiDash only; Worker unchanged. Selection = review = Worker.');
P('- **N2 Per-leg surcharge** (each leg whose own pickup is 22:00-05:59 is surcharged; the two legs of a return are each half of the x1.85 return fare). Needs new Worker and page code and the return-pickup time on the booking.');
P('- **N3 Static-table convention everywhere** (the page\'s modifier: x1.2 and x1.85, rounded UP to the next FJ$5, outbound time only). Needs the Worker to adopt the round-up (otherwise in-band differences continue). This is what NAT shows today.');
P('');
P('Totals (guest-visible, no extras, after the 10% discount where it applies). Base = the published catalogue one-way figure; Worker one-way = the formula figure before discount. N0 uses the Worker formula figure (what FijiDash production saves today); the held candidate shows the catalogue convention instead for Momi return (297), which is the N3 column.');
P('');
for (const nr of nightRows) {
  P(`**${nr.dest} ${nr.v}** - catalogue one-way base ${f(nr.base)}, Worker one-way before discount ${f(cents(nr.F1))}`);
  P('');
  P('| Scenario | N0 none (FD today) | N1 Worker rule on live fare | N2 per-leg | N3 static convention (NAT today) |');
  P('|---|---|---|---|---|');
  for (const s of nr.sc) P(`| ${s.label} | ${f(s.O0)} | ${f(s.O1)} | ${f(s.O2)} | ${f(s.O3)} |`);
  P('');
}
P('Cross-checks run before this table was written: the N1 arithmetic equals the real Worker\'s saved amount in all six scenarios for all four cases, and the N3 arithmetic equals the real page\'s quote (the script stops if either differs).');
P('');
P('**What each night option requires** (nothing is applied):');
P('');
P('| Option | Worker | FijiDash page | NAT page | Advertised text |');
P('|---|---|---|---|---|');
P('| N0 | remove the night step (or leave it: the page figure is always in band) | already the behaviour; remove the label "Night surcharge applied" | remove the page modifier (night quotes drop to the day figure) | delete "20% night surcharge" from the FAQ in both sites (the FAQ line in `app.js`) |');
P('| N1 | none | add x1.2 to the live fare when the outbound pickup is night (selection and review) | unchanged (static modifier already similar but rounds up to FJ$5) | FAQ stays; the label becomes true. Say plainly that only the OUTBOUND pickup time counts |');
P('| N2 | new per-leg logic; needs `return_time` in the pricing step; new `pricing_version` | new arithmetic | new arithmetic | FAQ rewritten: surcharge per leg |');
P('| N3 | adopt FJ$5 round-up for modifier fares (or accept in-band differences) | selection/review use the static figure again (the live fare would no longer be shown) | unchanged | FAQ stays; label true |');
P('');
P('Decision: night option **[ ] N0  [ ] N1  [ ] N2  [ ] N3**.  Does a night RETURN pickup count (matters for N2 only, and for N1/N3 it is ignored today): **[ ] yes  [ ] no**.');
P('');

// ---------- 3. return / rounding / extras ----------
const rr = priceable.filter((r) => r.trip === 'return');
const roundAdds = rr.map((r) => { const one = rows.find((o) => o.route === r.route && o.vehicle === r.vehicle && o.trip === 'one-way'); return ceil5(one.catBase * 1.85) - one.catBase * 1.85; });
P('## 3. Exact treatment of return discounts, rounding and extras');
P('');
P('| Step | Page (published-table path) | Worker (`computeAuthoritativePrice` + `applyLoyaltyDiscount`) |');
P('|---|---|---|');
P('| One-way base | the published figure for the route and vehicle (whole dollars), else a distance formula rounded up to FJ$5 | flagfall + rate x distance for the distance band (zone-pair distance table), x the destination zone multiplier (1.37 for Ba and Rakiraki, otherwise 1), rounded to cents. The fuel index (currently multiplier 1) is only RECORDED on the booking; it does not enter the fare, so no option here depends on fuel |');
P('| Return | x1.85 of the one-way base, then **rounded UP to the next FJ$5** (only when a modifier applies) | x1.85 of the one-way fare, cents, **no round-up** |');
P('| "Return discount" | none beyond the x1.85 (about 7.5% below two one-ways). The FAQ line "discounted vs two one-ways" describes this | same |');
P('| Night | x1.2 on the base, applied before the return multiplier, outbound pickup only, then round up to FJ$5 | x1.2 on the whole transfer, outbound pickup only, cents |');
P('| Extras | child seat FJ$8, surfboard FJ$24, **once per booking**, never multiplied by return or night, added BEFORE the discount | same: added once, before the discount |');
P('| Discount | 10% of the subtotal, **whole dollars (`Math.round`)**, only when the subtotal exceeds FJ$50, never with a tour | identical function (`applyLoyaltyDiscount`) |');
P('| Where they can differ | the FJ$5 round-up and the catalogue base itself | cents vs whole dollars; the formula base |');
P('');
P(`Rounding is a real, separate source of difference: across the ${rr.length} priceable return cases the page\'s round-up adds between FJ$${Math.min(...roundAdds).toFixed(2)} and FJ$${Math.max(...roundAdds).toFixed(2)} (mean FJ$${(roundAdds.reduce((a, b) => a + b, 0) / roundAdds.length).toFixed(2)}) to the pre-discount return fare compared with x1.85 alone.`);
P('');
P('Worked examples (all computed, none invented):');
P('');
P('| Case | Page arithmetic | Worker arithmetic | Difference |');
P('|---|---|---|---|');
const mm = fdRoutes.find((r) => r.destValue === 'MARRIOTT_MOMI'); const F1m = await env.referenceFare('Momi Bay', 'minibus', 'one-way');
const ex = (label, base, F1, ret, seat) => { const pg = PAGE(base, ret, false, seat); const w = W(F1, ret, false, seat); const pgSub = (ret ? ceil5(base * 1.85) : base) + (seat ? 8 : 0); const wSub = cents(F1 * (ret ? 1.85 : 1)) + (seat ? 8 : 0); P(`| ${label} | ${f(pgSub)} - ${f(pgSub > 50 ? Math.round(pgSub * 0.1) : 0)} = **${f(pg)}** | ${f(wSub)} - ${f(wSub > 50 ? Math.round(wSub * 0.1) : 0)} = **${f(w)}** | ${f(cents(pg - w))} |`); };
ex('Momi minibus one-way (approved)', mm.m, F1m, false, false); ex('Momi minibus return (approved convention)', mm.m, F1m, true, false); ex('Momi minibus return + child seat (approved convention)', mm.m, F1m, true, true);
const hl = fdRoutes.find((r) => r.destValue === 'HILTON_DENARAU'); ex('Hilton Denarau sedan return', hl.s, await env.referenceFare('Denarau', 'sedan', 'one-way'), true, false);
ex('Hilton Denarau sedan return + child seat', hl.s, await env.referenceFare('Denarau', 'sedan', 'one-way'), true, true);
P('');
P('Harmonisation options (apply only to the **path that quotes**; the extras and discount functions already match):');
P('');
P('- **R1 Page convention everywhere:** the Worker adopts the FJ$5 round-up for return and night fares. Returns rise by up to FJ$5 versus today\'s Worker figures; one-way is unchanged. Needs a Worker change and a new `pricing_version`.');
P('- **R2 Worker convention everywhere:** the page drops the round-up (cents). Static catalogue returns fall by up to FJ$5; pages that print return figures must be re-derived.');
P('- **R3 Status quo (tolerance):** both stay; differences inside the 0.8x-1.3x band are kept as shown. This is why 794 NAT and 818 FijiDash static rows differ in the reconciliation and is the option that keeps the current Momi exception.');
P('');
P('Decision: **[ ] R1  [ ] R2  [ ] R3**.  Extras and the 10% discount: **[ ] keep as is** (they already match).');
P('');

// ---------- 4. Tanoa ----------
P('## 4. Tanoa International Hotel: the missing pricing rule');
P('');
const tr = fdRoutes.find((r) => r.destValue === 'TANOA_INTERNATIONAL');
const probe = async (amount) => { const r = await env.rig.post(env.payload({ zone: 'Nadi Airport', vehicle: 'sedan', trip: 'one-way', time: '10:00', seat: false, amount, optIn: true, k: 1 })); const ev = r.events.find((e) => e.event_type === 'created'); return { status: r.status, saved: r.created.length ? r.saved.quoted_amount : null, outcome: ev && ev.metadata.pricing_decision && ev.metadata.pricing_decision.outcome }; };
const t5 = await probe(5), t15 = await probe(15), t500 = await probe(500);
P(`Facts: the booking tool and route pages quote **FJ$${tr.s} sedan / FJ$${tr.v} minivan / FJ$${tr.m} minibus** one-way (return by the page convention: ${[tr.s, tr.v, tr.m].map((b) => ceil5(b * 1.85)).join(' / ')} before discount). The destination resolves to the zone "Nadi Airport", the same as the pickup, so the Worker has no distance and no rule and cannot compute a reference fare. With the real Worker bundle: an amount of 5 is saved as **${f(t5.saved)}**, 15 as **${f(t15.saved)}**, 500 as **${f(t500.saved)}** (each recorded \`${t15.outcome}\`). The Worker therefore trusts whatever the client sends for this route; it never refuses or reprices it.`);
P('');
P('| Option | What it means | Needs from James |');
P('|---|---|---|');
P('| T1 Explicit fixed-fare rule | Add a fixed-fare entry for Nadi Airport <-> Tanoa International so the Worker can verify it | the three one-way fares (and confirmation the page convention applies to returns) - **not invented here** |');
P('| T2 Treat as an existing zone | Map the hotel to the neighbouring "Nadi" zone and use the formula | confirmation that is the intended fare. For reference only, the formula fares for Nadi are: ' + `${['sedan', 'minivan', 'minibus'].map((v) => 'FJ$' + cents(rows.find((r) => r.route === 'NADI_DOWNTOWN' && r.vehicle === v && r.trip === 'one-way').workerPre)).join(' / ')} before discount (sedan / minivan / minibus) - this is not a proposal |`);
P('| T3 Quote on request | Remove Tanoa from the instant-booking tool and the pages\' fixed table; guests are quoted by the team | nothing numeric; pages must be edited |');
P('| T4 Status quo | Keep FJ$15 / 25 / 45 with no server check (any amount can be saved) | explicit acceptance of the unverified route |');
P('');
P('Decision: **[ ] T1  [ ] T2  [ ] T3  [ ] T4**.');
P('');

// ---------- 5. advertised price corrections per option ----------
const amounts = (s) => [...s.matchAll(/FJ\$\s?([0-9]+(?:\.[0-9]+)?)/g)].map((m) => Number(m[1]));
const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&rarr;/g, '->').replace(/\s+/g, ' ').trim();
const natDir = path.join(root, 'test-fixtures', 'nat-site-c5ee3b1'); const fdDir = path.join(root, 'src');
const surf = {};
for (const [site, dir, rts] of [['FijiDash', fdDir, fdRoutes], ['NAT', natDir, natRoutes]]) {
  const S = (surf[site] = { pages: 0, items: 0, notCat: 0, notWorker: 0, pagesNotCat: new Set(), pagesNotWorker: new Set(), noLink: 0, from: 0, fromNotCat: 0, fromNotWorker: 0 });
  for (const file of fs.readdirSync(path.join(dir, 'transfer')).filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(dir, 'transfer', file), 'utf8'); const dest = (html.match(/[?&]dest=([A-Z0-9_]+)/) || [])[1]; const route = rts.find((r) => r.destValue === dest); S.pages++;
    if (!route) { S.noLink++; continue; }
    const zone = zoneOf(route.area);
    for (const m of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => strip(c[1]));
      const vk = { Sedan: 'sedan', Minivan: 'minivan', Minibus: 'minibus' }[(cells[0] || '').trim()]; if (!vk || cells.length < 3) continue;
      const base = route[{ sedan: 's', minivan: 'v', minibus: 'm' }[vk]];
      for (const [idx, trip] of [[1, 'one-way'], [2, 'return']]) {
        const a = amounts(cells[idx]); if (!a.length) continue; S.items++;
        const cat = trip === 'return' ? ceil5(base * 1.85) : base; const wk = zone ? await env.referenceFare(zone, vk, trip) : null;
        const matchCat = Math.abs(a[0] - cat) < 0.005; const matchWk = wk !== null && Math.abs(a[0] - wk) < 0.005;
        if (!matchCat) { S.notCat++; S.pagesNotCat.add(file); } if (!matchWk) { S.notWorker++; S.pagesNotWorker.add(file); }
      }
    }
    const fr = (html.match(/<title>[^<]*From FJ\$([0-9.]+)/) || [])[1];
    if (fr) { S.from++; const base = route.s; const wk = zone ? await env.referenceFare(zone, 'sedan', 'one-way') : null; if (Math.abs(Number(fr) - base) > 0.005) S.fromNotCat++; if (wk === null || Math.abs(Number(fr) - wk) > 0.005) S.fromNotWorker++; }
  }
}
const llms = fs.readFileSync(path.join(fdDir, 'llms.txt'), 'utf8'); let llmsLines = 0, llmsNotCat = 0;
for (const line of llms.split('\n')) { const m = line.match(/^- (.+?) — (\d+)km — from FJ\$([0-9.]+)/); if (!m) continue; llmsLines++; const row = fdRoutes.find((r) => r.dest === m[1] || r.dest.includes(m[1]) || m[1].includes(r.dest)); if (!row || Math.abs(Number(m[3]) - row.s) > 0.005) llmsNotCat++; }
P('## 5. Advertised-price corrections required by each option');
P('');
P('Counted from the route pages as they stand (FijiDash `ftt-booking-site/src/transfer`, NAT `c5ee3b1`), comparing each printed one-way / return figure (before discount) with (a) the published catalogue (return by the page convention) and (b) the Worker figure to the cent. **Nothing was edited and no replacement figure is proposed.**');
P('');
P('| Surface | Printed items checked | Not equal to the catalogue | Not equal to the Worker (to the cent) |');
P('|---|---|---|---|');
for (const site of ['FijiDash', 'NAT']) { const S = surf[site]; P(`| ${site} route pages (${S.pages} pages; ${S.noLink} cannot be reconciled: no booking link or route not in the booking tool) | ${S.items} table figures | ${S.notCat} on ${S.pagesNotCat.size} pages | ${S.notWorker} on ${S.pagesNotWorker.size} pages |`); P(`| ${site} "From FJ$" in page titles | ${S.from} | ${S.fromNotCat} | ${S.fromNotWorker} |`); }
P(`| FijiDash llms.txt "from FJ$" lines | ${llmsLines} | ${llmsNotCat} | not compared |`);
P('| FijiDash `app.js` FAQ / marketing strings and index.html JSON-LD | listed in `ADVERTISED-PRICES-AUDIT.md` | manual | manual |');
P('');
P('Because pages print whole dollars and the Worker works in cents, "not equal to the Worker" counts almost every figure. Option B below therefore also needs a **display rule** (round for display? show cents?) - a further decision.');
P('');
P('| Policy option | What changes in the booking path | Advertised corrections required |');
P('|---|---|---|');
P(`| **A. Catalogue is the fare** | the Worker (or a server fare table) enforces the catalogue; FijiDash selection returns to the static figure (no live fare); disputed routes keep their published fares | pages already match their own catalogue except ${surf.FijiDash.notCat + surf.NAT.notCat} printed figures (${surf.FijiDash.pagesNotCat.size + surf.NAT.pagesNotCat.size} pages) that disagree with it, ${llmsNotCat} llms.txt lines, and the night / return conventions in the FAQ |`);
P(`| **B. Worker formula is the fare** | the catalogue is rebuilt from the formula; NAT and the pages show it | essentially every printed figure changes: ${surf.FijiDash.notWorker + surf.NAT.notWorker} table figures, ${surf.FijiDash.fromNotWorker + surf.NAT.fromNotWorker} "From" titles, llms.txt, the routes table (${disputed.length} disputed route/vehicle/trip figures differ by more than FJ$5 / 5%), FAQ; plus the display-rule decision |`);
P(`| **C. Per-route hybrid** (James chooses A, B or C per row in section 1) | each route follows its own choice; a server fare table holds the A/C routes so the Worker can verify them | only the ${new Set(disputed.map((r) => r.route)).size} disputed routes need page/table edits (every printed figure for those routes), plus FAQ |`);
P('');
P('Night and return options add FAQ / label changes as listed in section 2 (N0: delete the 20% sentence and the label; N1-N3: keep, with the outbound-pickup rule stated plainly). Return rounding (R1/R2) changes every printed return figure that is derived by the other convention.');
P('');
P('## Decisions to record');
P('');
P('- Global fare policy: **[ ] A  [ ] B  [ ] C (per row above)**');
P('- Night: **[ ] N0  [ ] N1  [ ] N2  [ ] N3**; night return pickup counts: **[ ] yes  [ ] no**');
P('- Return rounding: **[ ] R1  [ ] R2  [ ] R3**');
P('- Tanoa International: **[ ] T1 (fares: ______ / ______ / ______)  [ ] T2  [ ] T3  [ ] T4**');
P('- Display rule for pages if B or C: **[ ] whole dollars (rounding rule: ______)  [ ] show cents**');
P('');
P('Nothing is released by recording these. Each decision needs its own change, re-test and independent review; production stays on HOLD until then. Fuel adjustments are not part of any option and remain disabled.');

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'POLICY-DECISION-TABLE.md'), L.join('\n'));
fs.writeFileSync(path.join(outDir, 'policy_catalogue_vs_worker.csv'), csv.map((r) => r.join(',')).join('\n'));
console.log(L.join('\n').slice(0, 7000)); console.log('\ndisputed', disputed.length, 'routes', new Set(disputed.map((r) => r.route)).size, 'outBand', outBand.length, 'priceable', priceable.length);
