// Assembles MOMI-DECISION-TABLE.md from the grid output (integration/momi-grid.mjs -> momi_grid.json / momi_grid.md). Text only: no pricing logic is changed or implemented here.
//   node integration/momi-decision-doc.mjs <gridOutDir> <outFile>
import fs from 'node:fs';
import path from 'node:path';
const [dir, out] = process.argv.slice(2);
const md = fs.readFileSync(path.join(dir, 'momi_grid.md'), 'utf8');
const doc = `# Momi minibus decision table (ONLY the Momi minibus) - UPDATED APPROVAL, night on HOLD

> **James's updated approval, 2026-10-05 (supersedes the earlier instruction to implement night totals):** Nadi Airport -> Fiji Marriott Resort Momi Bay, minibus, daytime one-way (06:00-21:59 Fiji time): **No extras FJ$175.92 FINAL (standard discount already included); child seat FJ$183.92; surfboard FJ$199.92; both FJ$207.92.** Extras are FJ$8 / FJ$24 and **no further standard discount applies to this transfer or its extras.**
> **On HOLD (not approved, not implemented):** the proposed night totals 211.10 / 219.10 / 235.10 / 243.10 and any night policy for this fare. The existing night surcharge is not disabled and the daytime approval is not extended to night.
> **Preserved:** returns (the approved 297 / 304 and every other return cell), other routes / hotels / vehicle classes, the released booking / quote-consent / retry / notification fixes, fuel adjustments OFF, historical bookings.
> Production is unchanged. Nothing here is deployed.

Source: isolated grid, real page functions and real Worker source, in-memory database, every outbound call blocked (\`integration/momi-grid.mjs\`). Cells: daytime (10:00) / night (23:00) x one-way / return x {no extras, child seat FJ$8, surfboard FJ$24, both}. Amounts are per component: NAT, FijiDash and the Worker. "quote -> submitted -> saved": what the page shows, sends, and the Worker records (FijiDash: selection / review where they differ). "Worker calculated total" is the Worker's own figure (a 409 probe) - with the approved id the four daytime one-way cells equal the approved totals. The two "PROPOSED" columns are arithmetic on the held options and are NOT approved or implemented (the first column "night none" is shown only as context for the night decision; its daytime cells equal what is now approved).

## 1. The 16 cells

${md}
Reading guide: **production** = released NAT \`c5ee3b1\`, FijiDash \`8c6f920\`, Worker \`0b961a4\`; **candidate** = the three review branches. The four daytime one-way rows now read 175.92 / 183.92 / 199.92 / 207.92 on NAT, FijiDash (selection AND review) and the Worker (with the approved id). Night rows are unchanged from production on NAT and the Worker; FijiDash night one-way selection is 193 etc. but its review/saved amount is the existing 157.92 / 165.92 / 179.92 / 186.92.

## 2. Status of the two inversions

- **I1 - extras lowered the one-way total: RESOLVED by the approval** (transfer 175.92 + FJ$8 / FJ$24, no discount on either). It is now a passing regression on all three components, day and night: \`integration/inversions.test.mjs\`, NAT \`test/momi-final-fare.test.js\`, FijiDash \`momi-final-fare.test.mjs\`, Worker \`approved-final-fare.test.mjs\`.
- **I2 - FijiDash night one-way review below the approved daytime totals: UNRESOLVED (night on HOLD).** FijiDash quotes 193 / 201 / 215 / 222 at selection (static page modifier) but its review step swaps in the Worker's reference fare, which has no night component, then applies the standard discount: 157.92 / 165.92 / 179.92 / 186.92, i.e. 18.00-21.00 BELOW the approved daytime totals. This is the existing night behaviour (B1 in the pricing review), not changed here; it stays a visible TODO invariant. NAT night (193 / 201 / 215 / 222) and the Worker night formula (190.10 / 197.10 / 211.10 / 219.10) are above the daytime totals but disagree with each other and with FijiDash.

## 3. Remaining decision (only if night is to be released coherently)

With night held, daytime is approved while night follows three different existing rules. A coherent release needs ONE night policy for this fare: **N-A** no night surcharge (night = day: 175.92 / 183.92 / 199.92 / 207.92); **N-B** x1.2 on the transfer component in cents (211.10 / 219.10 / 235.10 / 243.10); **N-C** x1.2 rounded up to FJ$5 (215 / 223 / 239 / 247); or another rule, **and** an instruction for the FijiDash night review step. Until then the existing behaviour (above) continues for night pickups; the approved daytime totals are unaffected.

## 4. Scope (verified by whole-grid diffs, \`integration/scope-grid.test.mjs\`)

Runtime files per branch: Worker \`pricing.mjs\`, \`worker.js\`; NAT and FijiDash \`src/app.js\`, \`src/index.html\` (cache key only), Momi route page. NAT: exactly the four daytime one-way Momi minibus cells change (none / child seat / surfboard / both; no night cell). FijiDash: only Momi minibus cells change; the exclusions to "all other pricing unchanged" are (a) the catalogue change 79 -> 175.92 (all 16 Momi minibus selection figures) and (b) the review figures of the four daytime one-way cells plus the 8 Momi minibus RETURN cells (292.45 etc. -> the approved page convention); FijiDash night review is unchanged. Worker: without the approved id the candidate equals production in every cell; with the id sent on every cell exactly four differ (Momi Bay minibus one-way day: 157.92 -> 175.92, 165.92 -> 183.92, 179.92 -> 199.92, 186.92 -> 207.92). Other Momi Bay hotels, sedan and minivan are unaffected.

## 5. Public wording

Momi route pages (NAT and FijiDash): minibus one-way FJ$175.92 final fare with extras FJ$183.92 / 199.92 / 207.92 and no further discount (table, FAQ and JSON-LD agree; tests assert it); the earlier sentence "extras ... added before the discount" is removed for this fare. In the booking tool the "10% off automatically applied" banner now says the Momi Bay Marriott minibus one-way is a final fare with the discount already included, when Momi Bay is selected. **Not changed (flagged):** the static "10% OFF every booking over FJ$50" promo block in NAT \`index.html\`, the banner default text on other destinations (correct for them), and the "automatic 10% loyalty discount" copy on other route pages - none refer to this fare specifically.

## 6. Mixed versions and old tabs (the exposure is NOT fixed)

Old pages / tabs (NAT \`c5ee3b1\`, FijiDash \`8c6f920\`) with the new Worker keep quoting and submitting 157.92 / 165.92 / 179.92 / 186.92; the Worker records them as shown (matched, no repricing). Shortfall against the approved totals: 18.00 / 18.00 / 20.00 / 21.00 per booking until the guest reloads. New pages with the OLD Worker submit the approved totals; the old Worker keeps them (inside its 0.8x-1.3x band, \`kept_in_band\`), so deployment order does not lose the new amounts. Verified in \`integration/journey.test.mjs\` (outbound blocked, no production writes).
`;
fs.writeFileSync(out, doc);
console.log('written', out, doc.length);
