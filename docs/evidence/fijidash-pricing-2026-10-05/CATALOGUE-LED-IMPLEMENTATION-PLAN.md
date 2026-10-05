# Catalogue-led pricing: implementation PLAN (not implemented, not a commercial decision)

Status: **plan only.** No commercial policy is implemented by this document, nothing is deployed, no booking, fuel setting, Worker, database or route is touched, and production stays on HOLD. It exists so that, once James decides, the build is short, checkable and reversible. "Catalogue-led" means: the published catalogue is the single source of fares, and every other layer (booking pages, route pages, the Worker's verification, llms.txt, FAQ and JSON-LD) reads it instead of keeping its own copy.

## 0. Preconditions (decisions this plan cannot make)

From `POLICY-DECISION-TABLE.md`: global policy **A** (catalogue is the fare) or the catalogue-led hybrid **C**; E1 (Momi sedan/minivan); night option N0-N3 and the leg allocation if N2; return rounding R1-R3; Tanoa T1-T4; display rule. A plan built on **A or C** is what follows. **Policy B (Worker formula is the fare) is not catalogue-led** and would need a different plan (the catalogue would be regenerated from the formula).

Per-row sign-off: every catalogue row carries an approval status. Only rows James has signed (or the specifically approved Momi minibus base and daytime scenarios) are `approved`; the rest are `published-unapproved` and are listed in every build report. Nothing is promoted to `approved` by code.

## 1. The one shared pricing source

A single directory in the repository, `pricing/`, is the only place a fare or a pricing rule is written down.

- `pricing/catalogue.json` - the data:
  - `rules`: return multiplier, return rounding (`ceil5` or `none`, per the R decision), discount (rate 0.10, threshold 50, whole-dollar rounding, never with a tour), extras (child seat 8, surfboard 24), the night rule (the chosen option, window 22:00-05:59, rate 1.2, which pickup counts, and the leg allocation if N2).
  - `routes[]`: `id` (e.g. `MARRIOTT_MOMI`), `zone`, `label`, `sites` (nat / fijidash), and the three **one-way** base fares (sedan / minivan / minibus). Returns, night and extras are DERIVED from `rules`, not stored (the approved Momi minibus return 297 is reproduced by the `ceil5` rule from 330, so it needs no stored override).
  - `approval` per route/vehicle: `status` (`approved` | `published-unapproved` | `pending` | `quote-on-request`), `by`, `date`, `note`.
- `pricing/pricing-rules.mjs` - ONE implementation of the arithmetic (base -> trip type -> night -> extras -> discount -> total) with the rounding stated once. Pure functions, no DOM, no network.
- `pricing/golden.json` - the golden table: for every route x vehicle x trip x {day, night variants} x extras, the expected guest total, generated once from the signed decisions and reviewed by James. Tests compare to it; the code never regenerates it silently.

Why a generated-copy model: the booking pages are static files with no build step and the Worker is a separate deploy. So `scripts/pricing-sync.mjs` generates `pricing-catalogue.generated.js` from `pricing/` and writes it into (a) each site's `src` and (b) the Worker source. **A drift test fails the build if any copy differs from the generated output** (and a second test fails if any file in the repository still contains a hard-coded fare table such as `ROUTES_DATA`, `TIER` constants or an in-scope active transfer price that is not generated (exclude historical evidence, test fixtures, separately owned tour prices and explanatory examples)). That is what makes it "one source": nobody can edit a copy.

## 2. What reads it

| Consumer | Change (future) | Behaviour guarded by |
|---|---|---|
| FijiDash page (`app.js`) | `ROUTES_DATA`/`computePrices`/`applyModifiers`/`calculateTotal` call the shared rules; the live `/reference-fare` swap is removed for catalogue routes (the catalogue is the fare), kept only as a display cross-check if wanted | `calculateTotal` byte-identical guard replaced by golden-table tests; selection = review by construction |
| NAT page (`app.js`) | same shared rules and data | same golden tests |
| Worker | `computeAuthoritativePrice` gains a catalogue path: for a catalogue route the authoritative total is the shared-rule total; the distance formula remains for non-catalogue paths. `require_quote_match` (409 consent) stays exactly as released | existing quote-consent tests + new parity tests (Worker vs page on the whole golden table) |
| Route pages, "From FJ$" titles, JSON-LD, llms.txt, FAQ strings | generated from the same data (`scripts/pricing-pages.mjs`) with before / after discount wording; a test fails if any printed price differs from the data | the advertised-price audit becomes a failing test, not a report |
| Reports | the reconciliation harness reads the shared data and must show zero unexplained differences | `recon.mjs` |

## 3. The short exception list (everything else follows the catalogue)

| # | Exception | Treatment |
|---|---|---|
| X1 | **Momi minibus (approved)** - base 175.92; 157.92 / 297 / 304 | Marked `approved` with the approval date; golden tests pin the three figures; the Worker figures 292.45 / 300.45 are never produced for this route |
| X2 | **Momi sedan / minivan** | Pending decision E1. No new default is approved. Preserve each production site’s existing behaviour until the selected scope is approved; do not migrate these rows merely because the candidate includes them. E1a/E1b/E1c then become explicit data |
| X3 | **Tanoa International** | Existing published values remain unapproved evidence. Pending T1-T4: no production change and no automatic removal from booking. Quote-on-request is a proposal requiring approval, not a default. Exclude the row from new enforcement until its handling is approved |
| X4 | **Paths that are not catalogue-priced**: departures / custom addresses, boats, tours | Unchanged: they keep today's behaviour (client amount saved as sent for custom, boat bundled fare, tour price). Listed so nobody assumes they are verified. Closing that trust gap is separate work |
| X5 | **Disputed rows not yet signed** (108 route/vehicle/trip cases in the table) | Loaded as `published-unapproved`; flagged in every report; the Worker accepts them in shadow mode only (see 4) until signed |
| X6 | **Night rule** | A single parameter of `rules`; ships only with the option James chooses (default: nothing new is introduced) |

This is an exception-category list, not approval of its individual fares. No other exception is allowed: a new exception must be a new row in this list, approved by James, with a golden test.

## 4. Phases, gates and rollback (each phase ends in review; none touches live bookings)

1. **Decide.** James records the decisions and signs the rows. Output: signed `catalogue.json` draft + golden table. *Gate: James.*
2. **Build the shared module and generators in a branch; no behaviour change.** Pages and Worker still use their own arithmetic; the new module is only run by tests. Prove parity: shared rules vs today's page arithmetic and vs the Worker, over the whole golden table, reporting every difference (expected: the disputed rows). *Gate: independent test rerun.*
3. **Shadow mode in the Worker (preview database only).** The Worker computes the catalogue verdict next to its current one and records `pricing_decision_shadow` (no PII); it enforces nothing. Replay synthetic bookings in the isolated harness; later, a read-only comparison against recorded decisions to confirm no surprise. Outbound blocked in tests. *Gate: independent review + James.*
4. **Preview pages** (FijiDash preview deployment and NAT preview) read the generated copies; run the full test set, the browser evidence, the async quote-safety and scope tests already in the review package. *Gate: independent review.*
5. **Release** (separately approved, one Worker + pages release, preceded by a production drift check so other sessions' fixes survive): enable catalogue enforcement through a Worker setting so rollback is a setting flip plus the previous deployment ids recorded beforehand (Worker version and Pages deployments). *Gate: James's explicit approval; production is on HOLD until then.*
6. **Retire the old copies.** Remove `ROUTES_DATA`, `TIER` and duplicated arithmetic once the drift tests are green for a full release cycle.

Fuel: **no fuel adjustment is part of any phase.** The fuel index stays as it is (multiplier 1) and does not enter the catalogue path; any later fuel policy would be a new `rules` entry and its own approval.

## 5. Tests that must exist before phase 5

- Golden table parity: page, Worker and generated pages all equal `golden.json` for every row.
- Approved Momi minibus pinned: 157.92 / 297 / 304 on every layer.
- Drift tests: generated copies equal sources; no hard-coded fare tables or printed fares outside generated files.
- The released protections unchanged: analytics-optional, 15 s timeout, same-reference retry, `resultKind: 'unknown'` wording, the 409 consent flow, stale-response guards, the accept cooldown (the full 119-test review package must stay green).
- Scope tests: departures, custom addresses, tours and boats keep their documented behaviour; the only silent-repricing path (callers without the opt-in) is closed or explicitly accepted.
- A report that lists every `published-unapproved` and `pending` row at build time, so none can ship unnoticed.

## 6. Risks and how the plan contains them

- **The catalogue is not approved as the commercially correct fare.** Containment: approval status per row, shadow mode, and the rule that the build report lists unapproved rows.
- **Static pages and the Worker deploy separately.** Containment: generated copies + drift tests + a version string (`pricing_version`) written into every booking's `pricing_decision`.
- **A disputed row (e.g. Mercure sedan 19 vs formula 30.15) is wrong in the catalogue.** Containment: it is a signed decision per row before it can be `approved`; nothing silently inherits the formula.
- **Scope creep into tours / boats / custom addresses.** Containment: exception X4 states they are out of scope.
- **Work done while production is on HOLD.** Containment: everything in phases 1-4 runs in the isolated harness or preview; production receives nothing before phase 5's approval.


## 7. Busy-season release design requirements (proposal only)

- Use integer FJD cents for money and explicit rational multipliers/rounding order. The approved Momi 297 and 304 must remain pinned independently of whichever global rounding option is later chosen. An incompatible global rule requires an approved explicit override or a new commercial decision; do not silently recompute them.
- Define route identity using pickup, destination, direction and vehicle, not zone alone. Multiple hotels sharing a zone can have different approved catalogue fares. Unknown or ambiguous route identity must have an approved fallback, never an invented mapping.
- Each quote carries catalogue/rules version, itinerary identity, itemised amounts and a validity policy. Quote expiry duration and treatment of old versions require approval. The Worker validates the quote; a client version label is not proof of validity.
- Sequential release must be specified and tested: old page/new Worker, new page/old Worker, old open tabs, failed asset loads and rollback. Generated-file parity alone does not protect mixed releases. Preserve explicit re-acceptance for any changed amount; no silent substitution.
- Same-request retries return the original saved booking and fare after a release or rollback. An edited itinerary is not silently treated as the unchanged request, and it must not create a duplicate after an uncertain save. Test both outcomes before release.
- Existing saved/agreed bookings, payment evidence and operator payouts are never repriced by catalogue activation. Any later guest-requested amendment requires its own recorded workflow.
- Shadow checks run on isolated synthetic fixtures only under current authority. Runtime production shadow writes, scheduled tasks and preview connections to production databases are not authorised. Read-only comparisons remain timestamped and exclude personal data.
- Release requires a healthy read-only booking/notification monitor, named release owner, exact pre-release deployments/settings and a reviewed rollback sequence. If monitoring is unavailable, pause release; do not infer zero failures.
- Rollback may revert future quoting, but must preserve accepted quotes and saved requests. A setting flip alone is not a proven rollback until cross-version acceptance is tested. Do not restore historical booking data or replay messages.
- Phase 5 needs a separate concrete approval after independent review. No production resource, route, setting, cache rule, fuel value or booking is changed by this plan.
