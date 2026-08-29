# Launch Control Checklist

Five sequential gates. Each must pass before the next opens. "Rollback trigger" means: if this
condition is observed *after* the gate has already been declared open, treat it as a reason to close
back down to the previous gate, not merely a note.

---

## Gate 1 — Internal QA

**Purpose:** prove the current codebase (Stage 1 core + PR #32's media system, once merged) is
technically sound, before any real external party sees it.

| Evidence required | Owner | GO criteria | HOLD criteria |
|---|---|---|---|
| Phase 8 24-hour agent-preview observation — PASS | Engineering (this session) | Zero incident, zero drift, full report delivered | Any incident/drift |
| PR #32 CEO visual sign-off + merge | CEO + Engineering | All 4 named entities confirmed correct on the QA preview; PR merged; production version confirmed changed via `/internal/build-info` | Any visual defect still present |
| Post-merge smoke test (all steps in the PR #32 runbook) | Engineering | All public routes 200, zero broken images, zero console errors, D1 counts unchanged | Any smoke-test failure |
| `/deals` reconciliation decision made (see `DEALS-LIVE-TRUTH.md`) | CEO | Explicit decision: keep visible / hide nav / accelerate publishing | No decision made |

**Rollback trigger:** any post-merge smoke-test failure → Cloudflare dashboard instant rollback to
the pre-merge version (`551ab646-bbed-47ea-bcf7-b8fffbb65786` as of this document).

---

## Gate 2 — Provider invitation

**Purpose:** begin the manual Founding-Operator onboarding SOP with a small, controlled number of
real operators, before any traveller-facing promotion. **CEO DECISION 2026-08-30 (decision 5):
approved, targeting a first cohort of 10 credible operators, expanding to 30.**

| Evidence required | Owner | GO criteria | HOLD criteria |
|---|---|---|---|
| Gate 1 passed | — | — | — |
| `FOUNDING-OPERATOR-ONBOARDING-SOP.md` process confirmed workable end-to-end on at least 1 real operator (of the approved 10-operator first cohort) | CEO/founder | One full onboarding cycle completed (selection → verification → evidence → publication checklist) without a step proving unworkable | Process breaks down or takes materially longer than expected |
| Central enquiry inbox workflow staffed | CEO/founder | A named person (with a named backup, per `CENTRAL-ENQUIRY-OPERATING-MODEL.md`'s escalation gap) is actively monitoring the central WhatsApp number | No backup named |
| WhatsApp/contact data integrity check | Engineering | The one suspicious `operators.whatsapp` value flagged in `CENTRAL-ENQUIRY-OPERATING-MODEL.md` confirmed real or corrected | Left unresolved |

**Rollback trigger:** an onboarded operator's listing is found materially inaccurate after
publication and not correctable within the agreed turnaround → suspend that listing
(`commercial_status` away from `ACTIVE`) per the SOP's removal procedure; does not require closing
the whole gate unless the pattern repeats across multiple operators.

---

## Gate 3 — Controlled traveller soft launch

**Purpose:** let a small, controlled group of real travellers use the live site and central enquiry
flow, before any public indexing or broad promotion.

| Evidence required | Owner | GO criteria | HOLD criteria |
|---|---|---|---|
| Gate 2 passed with ≥1 operator carrying ≥1 real, approved product | — | — | — |
| Enquiry acknowledgement target defined and met in practice | CEO/founder | A stated target (see `CENTRAL-ENQUIRY-OPERATING-MODEL.md`, CEO input required) is being met for real test enquiries | Target consistently missed |
| Daily enquiry reconciliation performed at least once | CEO/founder | D1 `enquiries` count matches the manual tracker count | Discrepancy found and unexplained |
| No payment/booking claim made anywhere on the site | Engineering | Confirmed via the same grep used in this doc set — no payment code, no booking-confirmation language | Any such claim found |
| Site still on `workers.dev` or the chosen branded domain, but still `noindex` everywhere | Engineering | Confirmed via the same route-by-route grep as `INDEXING-ACTIVATION-MATRIX.md` | Any route already indexed prematurely |

**Rollback trigger:** any real traveller enquiry goes unacknowledged past the stated target with no
documented reason → pause new soft-launch invitations until the central-inbox workflow is fixed;
does not require taking the site down.

---

## Gate 4 — Public indexed launch

**Purpose:** flip the recommended routes in `INDEXING-ACTIVATION-MATRIX.md` from `noindex` to
`index,follow` and let organic/search traffic reach the site for the first time.

| Evidence required | Owner | GO criteria | HOLD criteria |
|---|---|---|---|
| Gate 3 passed with a real, positive enquiry outcome (at least one traveller successfully connected to an operator) | — | — | — |
| Real Privacy Policy + Terms of Service published (legally reviewed, not the operational drafts) | CEO + lawyer | Both documents live and linked, replacing the current preview-placeholder text | Placeholder text still live |
| Canonical hostname DNS/route/certificate/Worker binding live, `SITE_ORIGIN` updated | CEO + Engineering | `marketplace.vakaviti.ai` (approved for planning 2026-08-30, decision 2) actually configured in DNS and code — a separate authorization from the planning approval itself | DNS/route work not yet separately authorized and completed |
| `sitemap.xml` and `robots.txt` live | Engineering | Both exist and correctly reference only the routes marked `index,follow` in the matrix | Missing either |
| Per-operator indexing gated on real content (≥1 product) | Engineering | InterContinental/South Sea Cruises (or any future 0-product operator) excluded from the sitemap until they have real products | A thin/empty operator page indexed |
| Monitoring in place | CEO/Engineering | At minimum, Cloudflare's own Worker error-rate notification configured (see the broader launch-blocker inventory) | No alerting exists |
| Rollback path tested | Engineering | A real (non-production) dry-run of the Cloudflare dashboard version rollback has been performed at least once | Never tested |

**Rollback trigger:** this gate is the closest thing to a one-way door (see
`INDEXING-ACTIVATION-MATRIX.md`) — a code/content rollback is still possible and should happen
immediately if a legal, safety, or accuracy problem is found, but a search-index "rollback" cannot
be instant (crawlers re-crawl on their own schedule). Treat any legal/accuracy incident post-indexing
as an emergency: fix the content immediately regardless of indexing status, and additionally
`noindex` the specific affected page(s) pending resolution.

---

## Gate 5 — Broader revenue launch

**Purpose:** move from a Founding-Partner, no-fee preview to an actual commercial model
(commission/fees), and/or broaden marketing spend.

| Evidence required | Owner | GO criteria | HOLD criteria |
|---|---|---|---|
| Gate 4 passed and stable for a CEO-defined observation period | CEO | **CEO INPUT REQUIRED** for the exact duration | — |
| Commercial model finalized (commission/fee structure) | CEO + legal | `LEGAL-FACTS-REQUIRED.md` item 8 resolved; Terms of Service updated to match | Model still undecided |
| Payment/booking-confirmation functionality, if any is planned, built and tested | Engineering | Only applicable if the commercial model requires it — confirmed today: no such code exists yet | Functionality half-built and live |
| Supply depth sufficient for the marketing spend planned | CEO | **CEO INPUT REQUIRED** for the target operator count — today's real count is 2 operators with products | Supply still thin relative to planned spend |
| Operator satisfaction check-in completed with every Founding Partner before their free-preview terms change | CEO/founder | Every onboarded operator has been told, and has acknowledged, what changes about fees | Any operator surprised by a fee change |

**Rollback trigger:** any operator dispute over commercial terms not previously communicated →
pause the commercial-model change for new operators until Founding Partners' terms are honored as
originally stated on `/partners`.

---

## Cross-cutting note

No gate in this checklist requires a code change to *define* — only to *execute*. This document is
a control structure, not an implementation plan; each gate's own "evidence required" row names the
separate piece of work (legal review, DNS, onboarding, etc.) that must happen elsewhere.
