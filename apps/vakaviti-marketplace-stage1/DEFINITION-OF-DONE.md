# Vakaviti Stage 1 — Definition of Done

Created 2026-08-19 following the CEO "Build Accuracy System + Visual Repair" directive, after a
real quality failure: the site rendered, CI passed, and the marketplace still shipped with
semantically wrong/duplicated imagery (e.g. all 5 Nadi Airport Transfers products showing one
identical photo; Blue Lagoon's Accommodation and Diving enquiries showing the same photo).

**The rule this document exists to enforce: CI GREEN != PRODUCT PASS.**

A statement of "implemented" is not sufficient. A statement of "CI green" is not sufficient.
Every item below requires evidence, not a claim. If evidence was not actually gathered, the item
is not checked, and the task is not done — no exceptions, regardless of time pressure.

## Checklist — required for every future Stage 1 task

- [ ] **Facts sourced** — every commercial fact (name, price, contact, location, category) traces
      to a CEO-confirmed source or existing verified D1 data. Nothing invented.
- [ ] **No invented commercial facts** — no price, availability, review, license, or verification
      claim added without an explicit source.
- [ ] **Code committed** — pushed to `ceo/vakaviti-marketplace-stage1` via a real commit with a
      descriptive message (never left only in local/scratch files).
- [ ] **CI green** — both `validate` checks pass. (Necessary, never sufficient on its own.)
- [ ] **Regression guard run manually** — `npm run guard:regression` was actually executed and
      passed. This is NOT currently part of CI (see "What automation can and cannot do here"
      below) — a green CI run does not mean this ran.
- [ ] **Workers Build green** — the Cloudflare deployment check itself passed.
- [ ] **Deployed version matches Git HEAD** — verified by fetching the live site and confirming
      it reflects the latest commit's actual changes (a content fingerprint check — e.g. a
      string, image asset, or behaviour unique to the new commit — not just "CI said success").
      If deployed != HEAD, STOP and do not build further changes on an uncertain baseline.
- [ ] **D1 verified where relevant** — for any change touching data display, the actual D1 row
      values were read and compared against what the rendered page shows. No assumption that the
      code "should" produce a value without checking what it actually returns.
- [ ] **Desktop live page inspected** — the actual deployed page was opened (browser tooling or
      equivalent), not just curl'd or assumed from source reading.
- [ ] **Mobile live page inspected** — at minimum 375px; ideally 375/390/430px. Checked for
      layout breakage, cropped images, and unusable CTAs.
- [ ] **Visual semantics inspected** — for any page carrying imagery, a human (or an agent acting
      as one, actually looking at rendered output) confirmed the image is not just present but
      *appropriate*: no accidental duplication of unrelated cards, no image implying something
      false about an operator/product, no jarring crop. Automated tests cannot do this step —
      see `scripts/regression-guards.mjs`'s own explicit disclaimer.
- [ ] **Enquiry routing preserved** — `MARKETPLACE_ENQUIRY_WHATSAPP` still controls the preview
      destination; each operator's own `whatsapp` value in D1 is untouched.
- [ ] **Isolation preserved** — `nadi-marketplace-staging` and `vakaviti-lagi-public` Pages
      projects still show `apps/vakaviti-marketplace-stage1/*` as an excluded build path.
- [ ] **No production resource touched** — no production domain, DNS record, D1 database, Pages
      project, or Worker outside this Stage 1 app was created, modified, or deployed to.
- [ ] **Acceptance matrix updated** — `ACCEPTANCE-MATRIX.md` rows for every route your change
      touches were re-verified against the live deployment and their RESULT updated with today's
      date and the method used. A stale, unreviewed PASS from a previous task does not carry
      forward automatically for a route your change actually affects.
- [ ] **Recovery implications considered** — if you added a new binding, secret, asset type, or
      external dependency, `STAGE1-RECOVERY.md` was updated so a future rebuild still works from
      Git alone (plus the documented D1/secret restore steps).

## What "PASS" requires, concretely

A route is only PASS in `ACCEPTANCE-MATRIX.md` when someone actually:
1. Opened the *deployed* URL (not localhost, not a code read-through).
2. Confirmed the status code, the visible content, and the image semantics match what the row
   claims.
3. Did the same at a mobile width.

If any of those three didn't happen, the row must say so honestly (e.g. "BLOCKED — mobile not
checked, reason: X") rather than being marked PASS.

## What automation can and cannot do here

**CI REGRESSION GUARD WIRING — PENDING CEO AUTHORIZATION.** `scripts/regression-guards.mjs`
exists, is committed, and is runnable manually (`npm run guard:regression`), but as of 2026-08-19
it is **NOT** wired into `.github/workflows/vakaviti-marketplace-stage1-ci.yml` — the API token
used for Stage 1 work has `repo`/`read:org`/`gist` scopes only, and GitHub blocks API writes to
`.github/workflows/*` without the `workflow` scope (it returns 404 rather than 403, so the failure
is silent unless specifically checked for — which is exactly how this file's wording drifted from
reality once before; do not let it happen again). Adding the one-line CI step requires either the
token being re-authorized with the `workflow` scope, or a human applying the change directly in
GitHub. Until that happens, every task must run `npm run guard:regression` manually before
declaring Stage 1 work done — CI staying green does NOT mean this guard ran.

Once wired, `scripts/regression-guards.mjs` catches: missing image asset files, image keys
referenced but not defined in the semantic registry, a non-absolute `og:image`, a missing preview
environment or central enquiry WhatsApp config, a protected production domain leaking into Stage 1
config, and an unexpected drift in the pinned Workers AI model.

It explicitly does **not** and cannot judge whether a photograph is the *right* photograph for a
product. That determination is inherently a human (or human-simulating live-browser) judgment
call and remains Phase 7's mandatory live visual QA — this is a deliberate, permanent limitation
of automated testing on this project, not a gap to "eventually" close with more code.

Data-integrity checks that require live D1 access (orphan products, invalid operator
relationships, duplicate slugs *in the database*, invalid pricing_basis/currency combinations) are
**not** run automatically in CI, because CI does not hold Cloudflare credentials and adding them
would be a scope expansion beyond what any single task has authorized. These remain a manual
"Phase 9 Data QA" step — query D1 directly and diff against the rendered page — before any task
touching commercial data is declared done.

## Escalation rule

If, partway through applying this checklist, you find a defect unrelated to the current task's
scope, do not silently fix it and do not silently ignore it: name it explicitly in your final
report as a "Remaining Known Defect" so a human can decide whether it needs its own task. Scope
discipline and honesty about defects are not in tension — hiding a defect to keep a report clean
is the failure mode this whole document exists to prevent.
