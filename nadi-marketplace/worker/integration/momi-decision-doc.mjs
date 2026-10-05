// Assembles MOMI-DECISION-TABLE.md from the grid output (integration/momi-grid.mjs -> momi_grid.json / momi_grid.md). Text only: no pricing logic is changed or implemented.
//   node integration/momi-decision-doc.mjs <gridOutDir> <outFile>
import fs from 'node:fs';
import path from 'node:path';
const [dir, out] = process.argv.slice(2);
const md = fs.readFileSync(path.join(dir, 'momi_grid.md'), 'utf8');
const c2 = (n) => Math.round(n * 100) / 100; const f = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const X = [['none', 0], ['child seat', 8], ['surfboard', 24], ['both', 32]];
// option arithmetic (documented, not implemented)
const dayA = X.map(([, x]) => c2(175.92 + x));                                  // E-A: extras at list price, no discount on anything
const dayB = X.map(([, x]) => c2(175.92 + (x ? x - Math.round(x * 0.1) : 0)));  // E-B: extras carry the standard 10% on their own (whole dollars), transfer untouched
const nightN = (mult, round5) => X.map(([, x]) => { let t = 175.92 * mult; t = round5 ? Math.ceil(t / 5) * 5 : c2(t); return c2(t + x); });
const nightA = dayA, nightB = nightN(1.2, false), nightC = nightN(1.2, true);
const row = (label, arr) => `| ${label} | ${arr.map(f).join(' | ')} |`;
const doc = `# Momi minibus decision table (ONLY the Momi minibus) - HOLD

> **HOLD - James's instruction, 2026-10-05: all three releases (Worker, NAT, FijiDash) are on hold; production is unchanged.** This table implements nothing. The only approved amounts are: daytime one-way, no extras **FJ$175.92 final fare (discount already included)**; daytime return **297**; daytime return with a child seat **304**. Every other total in this document is either what a component produces today (not approved) or an arithmetic illustration of an option (not approved, not implemented).

Source: isolated grid, real page functions and real Worker source, in-memory database, every outbound call blocked (\`integration/momi-grid.mjs\`; reproduce with the environment variables listed in \`integration/journey.test.mjs\`). Cells: daytime (10:00) / night (23:00) x one-way / return x {no extras, child seat FJ$8, surfboard FJ$24, both}. Amounts are shown **separately per component**: NAT, FijiDash and the Worker. "quote -> submitted -> saved": what the page shows, what it sends, what the Worker records (FijiDash: selection / review where they differ). "Worker calculated total" is the Worker's own figure (a 409 probe): after discount, with extras and night, but not what is necessarily saved (a submitted amount inside 0.8x-1.3x of it is kept as submitted).

## 1. The 16 cells

${md}
Reading guide: **production** = released NAT \`c5ee3b1\`, FijiDash \`8c6f920\`, Worker \`0b961a4\`; **candidate** = the three held branches. The approved cell is the first row (candidate: 175.92 on every component; the Worker produces 175.92 only when the page names the approved id). Returns: production FijiDash recorded the Worker's figures (292.45, 300.45, 314.45, 321.45 by day); the candidate keeps the approved 297 / 304 and the existing page convention for the other return cells (NAT already did).

## 2. The two inversions (release blockers) and what causes them

- **I1 - extras lower the one-way total.** The approved final fare is exempt from the standard discount, but extras still go through the standard rule: (175.92 + 8) less 10% = 165.92, which is below 175.92 (surfboard 179.92, both 186.92). NAT candidate, FijiDash candidate and the Worker all agree. Production had no such inversion (157.92 + extras behaved normally).
- **I2 - FijiDash night review below daytime.** FijiDash quotes 193 at selection (static page modifier) but its review step swaps in the Worker's reference fare, which has no night component, and then applies the standard discount: 157.92 - below the approved daytime 175.92. NAT quotes 193; the Worker formula says 190.10. Production FijiDash had night = day = 157.92 (no inversion, but also no night surcharge ever applied: release blocker B1 of the pricing review).

Regression coverage: \`integration/inversions.test.mjs\` (cross-component), plus TODO invariants in the NAT and FijiDash suites. The characterisations pass (they record today's behaviour); the invariants "extras never lower the total" and "night is never below day" are visible TODOs that will pass only when the owner decisions below are implemented.

## 3. Recommendation: how the approved final fare stays the transfer component when extras are selected

**Author's recommendation (not an approval):** treat FJ$175.92 as the **transfer component** of a daytime one-way minibus booking to this hotel and add extras on top at their listed price, with **no discount on the transfer component and none on the extras** (option E-A). Reasons: (a) the public copy already says "extras are additional: child seat FJ$8 and surfboard FJ$24 per booking"; (b) totals can never fall when an extra is added; (c) the approved fare is never reduced; (d) the arithmetic is one addition on all three components. Requires an implementation (not done): the Worker's approved-fare rule must return the transfer component and add the extras (so a booking WITH extras is still recognised), and both pages must do the same; \`pricing_version\` should record it. Alternatives: **E-B** extras keep the standard 10% on their own (whole dollars); **E-C** keep today's behaviour (the inversion remains - not recommended).

Daytime one-way totals by extras (arithmetic only; columns: none / child seat / surfboard / both):

| Option | none | child seat | surfboard | both |
|---|---|---|---|---|
${row('today (candidate, I1)', [175.92, 165.92, 179.92, 186.92])}
${row('E-A extras at list price, no discount', dayA)}
${row('E-B extras discounted on their own', dayB)}

Night is **not approved** and has its own owner decision. If night keeps a surcharge, the coherent way to keep the approved fare as the transfer component is to apply the night multiplier to **the transfer component** and then add extras (no discount on either): option **N-B** (x1.2, cents, the Worker's existing multiplier). **N-C** applies the page convention (x1.2 rounded up to FJ$5). **N-A** applies no night surcharge to this fare (night = day). Night one-way totals (none / child seat / surfboard / both, with E-A extras):

| Night option | none | child seat | surfboard | both |
|---|---|---|---|---|
${row('N-A no night surcharge', nightA)}
${row('N-B x1.2 on the transfer, cents', nightB)}
${row('N-C x1.2, rounded up to FJ$5', nightC)}

N-A and N-B keep night >= day and extras >= no extras (verified by the grid on the PROPOSED columns of section 1); N-C does by arithmetic (215 >= 175.92). Today the components disagree (NAT 193, Worker 190.10, FijiDash review 157.92). The author does not recommend a rate: N-B is the only option that matches both the published "20% night surcharge" wording and the Worker's existing arithmetic; N-A is the only option that keeps FijiDash's current "no night surcharge" behaviour.

**Returns:** the approved **297 / 304** (daytime, no extras / child seat) are preserved in every option and on every component. The other return cells (daytime + surfboard 319, both 326; night 355 / 363 / 377 / 384) are produced today by the existing page convention on NAT and both candidates and have never been approved individually; the table checks that they are coherent (never below one-way, extras and night never lower them) and proposes **no change**.

## 4. Exact owner decisions required (none made; nothing implemented)

1. **Extras on the approved fare:** [ ] E-A extras at list price, no discount / [ ] E-B extras discounted on their own / [ ] other: ______ / [ ] keep today (I1 remains).
2. **Does the approved final fare apply to a daytime one-way booking WITH extras** (as its transfer component)? [ ] yes / [ ] no (then extras bookings follow the old rule and E-C applies).
3. **Night one-way for this fare:** [ ] N-A none / [ ] N-B x1.2 on the transfer, cents / [ ] N-C x1.2 rounded up to FJ$5 / [ ] other: ______ / [ ] quote on request.
4. **Night return, and return + surfboard / both:** [ ] keep the existing page convention (355 / 363 / 377 / 384; 319 / 326) / [ ] other: ______. (297 / 304 are approved and stay.)
5. **Scope:** [ ] Marriott only (as built) / other Momi Bay hotels, sedan and minivan: not covered and not proposed.
6. **Old-tab policy:** accept that tabs open before a release keep quoting 157.92 until reload? [ ] accept / [ ] other: ______ (see section 6; not fixed).

## 5. Scope verification (actual diffs and whole-grid results)

Runtime files changed per branch (everything else is tests or documents):
- Worker \`ceo/momi-final-fare-worker\` vs \`0b961a4\`: \`pricing.mjs\` (+18) and \`worker.js\` (+13 / -3) only.
- NAT \`ceo/momi-final-fare-nat\` vs \`c5ee3b1\`: \`src/app.js\`, \`src/index.html\` (cache key only), \`src/transfer/fiji-marriott-resort-momi-bay.html\` only.
- FijiDash \`ceo/momi-final-fare-fijidash\` vs \`8c6f920\`: \`src/app.js\`, \`src/index.html\` (cache key only), \`src/transfer/fiji-marriott-resort-momi-bay.html\` only.

Whole-grid results (\`integration/scope-grid.test.mjs\`, passing): 1,632 NAT cells and 1,680 FijiDash cells per page version (every priceable route x vehicle x trip x {none, seat, surf, both} x {10:00, 23:00}; Tanoa International is unpriceable and excluded; FijiDash also lists Naviti) and 672 Worker cells (14 zones). **NAT: exactly 1 cell changes** (Momi minibus one-way day no extras, 157.92 -> 175.92). **FijiDash: only Momi minibus cells change** - the **exclusions** to "all other pricing unchanged" are: (a) the catalogue change 79 -> 175.92, which moves all 16 Momi minibus selection figures, and (b) the Momi minibus RETURN review figures (8 cells: 292.45 etc. -> the approved 297 / 304 convention) plus the approved one-way review figure (1 cell). Momi sedan, Momi minivan and every other route are identical cell by cell on both sites (selection and review). **Worker: without the approved id the candidate calculates exactly what production does in every one of the 672 cells; with the id sent on every cell, exactly one cell differs** (Momi Bay minibus one-way day no extras, 157.92 -> 175.92). Both pages send the id in exactly one grid cell. Other hotels in the Momi Bay zone are therefore unaffected (the Worker cannot distinguish hotels without the id, which only the Marriott page sends).

## 6. Promotional wording, mixed versions and old tabs (reported; the exposure is NOT fixed)

Wording that conflicts with a final fare for this one fare (not rewritten; only the Momi pages carry the exception): NAT \`index.html\` banner "10% off automatically applied to bookings over FJ$50" and promo "10% OFF every booking over FJ$50"; the same banner text in both \`app.js\` and FijiDash \`index.html\`; the "automatic 10% loyalty discount" copy on 21 FijiDash route pages and 1 NAT route page; and the Momi page sentence "extras ... added before the discount", which is untrue for the final fare if extras are ever priced under E-A / E-B (it also still describes the returns correctly).

Mixed versions (grid and journey tests): **new Worker + old page/tab:** the old page quotes and submits 157.92 and the Worker records 157.92 - nothing is repriced, **the old-tab exposure is NOT fixed** (those bookings are recorded at the superseded figure until the guest reloads; the cache key is bumped and no cache is purged). **New page + old Worker:** 175.92 is submitted without the approved id and kept as shown (inside the 0.8-1.3x band; decision \`kept_in_band\`); with extras the old Worker would compute the same 165.92. **Both old:** unchanged. A future Worker that adds extras handling would again produce different results for old tabs that keep quoting the old arithmetic: any release of an extras/night rule must repeat this matrix.
`;
fs.writeFileSync(out, doc);
console.log('written', out, doc.length);
