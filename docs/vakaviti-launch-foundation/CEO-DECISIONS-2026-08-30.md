# CEO Decisions — 2026-08-30

Recorded against the launch foundation package prepared on branch
`ceo/vakaviti-launch-foundation-docs` (base commit `ee19fe43c31a7e544996f4956ce6ca1419a6036e`,
docs added at commit `44a45b1a68a4016b8148f1a671c3f29a70abe1e8`). These are decisions on the
*documented plan* — none of them is a production launch authorization. See "What this document
does not authorize" at the end.

---

## Decision 1 — Initial enquiry-routing model: APPROVED

**Central Vakaviti routing**, exactly as designed in `CENTRAL-ENQUIRY-OPERATING-MODEL.md`:

```
Traveller → Vakaviti → controlled provider assignment → provider response → Vakaviti follow-up
```

**Authorizes:** operating the launch on this model as the documented plan; staffing and running the
central WhatsApp inbox workflow described in that document once other gates permit; using it as the
basis for the Founding-Operator onboarding SOP's contact-capture step.

**Does not authorize:** direct provider routing at initial launch, in any form. `operators.whatsapp`
data may still be captured during onboarding (it is useful evidence and a future-readiness step),
but it must not be wired into any code path that routes a traveller enquiry directly to an operator
for the initial launch.

---

## Decision 2 — Provisional canonical marketplace domain: APPROVED FOR PLANNING

**`marketplace.vakaviti.ai`** is approved as the domain to plan around (in documentation, copy
drafts, and future implementation tickets).

**Authorizes:** referencing this hostname in planning documents, draft legal text, and any future
implementation runbook as the target.

**Does not authorize:** any DNS record, Cloudflare route, TLS certificate, Worker custom-domain
binding, or search-indexing change. `SITE_ORIGIN` in `src/index.ts` remains the `workers.dev` URL
until a separate, explicit authorization to change it is given.

---

## Decision 3 — Lagi / root-domain relationship: DEFERRED

The larger question of whether Stage 1 and the existing Lagi concierge product should unify, stay
separate, or one supersede the other is **not decided now**, and does not need to be to proceed with
planning.

**Authorizes:** proceeding with Decision 2's subdomain plan precisely because it does not force this
question — `marketplace.vakaviti.ai` can be set up later without touching the root domain or any of
Lagi's existing subdomains.

**Does not authorize:** any change to `vakaviti.ai` (root), Lagi's deployment, its D1 database, its
`dashboard.` or `join.` subdomains, or any of its existing configuration. Nothing in this package
has touched, or may touch, any Lagi-related resource.

---

## Decision 4 — `/deals` visibility

**Kept out of primary public navigation** until at least **three** genuine offers simultaneously
meet **all** of:
- current
- evidenced
- human-reviewed
- provider-approved where required
- `review_status='PUBLISHED'`
- carrying visible validity/expiry information on the card

**Current state against this bar (verified read-only, unchanged since `DEALS-LIVE-TRUTH.md`):**
0 of 7 candidates are `PUBLISHED`. The bar is not met. `/deals` stays out of primary navigation.

**Authorizes:** treating the existing, already-live `/deals` route as QA/direct-link-only for now —
it may remain reachable by direct URL (already true today; no code change needed to achieve this,
since the route itself was never gated).

**Does not authorize:** any change to site navigation right now (adding or removing the nav link),
any change to which deals are published, or any change to the review/publication process. The next
action, if any, is a content decision (publishing candidates through the existing human-review
process) — not a code or navigation change today.

---

## Decision 5 — Provider onboarding: APPROVED (manual, controlled)

**Authorizes:** running the manual process in `FOUNDING-OPERATOR-ONBOARDING-SOP.md` against:
- **First controlled cohort: 10 credible operators**
- **Expansion target: 30 operators**
- Publishing only operators/products supported by evidence and appropriate authorization, per the
  SOP's publication checklist

**Does not authorize:** building any self-service onboarding flow before launch; sending any
provider invitation yet (see "What this document does not authorize" below — no message has been
sent under this decision); onboarding any specific named operator without following every step of
the existing SOP (selection → identity verification → evidence → product/price capture → image
rights → contact verification → operator approval → claim invitation → publication checklist).

---

## Decision 6 — Legal drafts: NOT APPROVED FOR PUBLICATION

`PRIVACY-POLICY-DRAFT.md` and `TERMS-OF-SERVICE-DRAFT.md` remain operational drafts only.

**Authorizes:** continuing to use these drafts as an internal reference for what the eventual real
policies need to cover.

**Does not authorize:** publishing either draft; removing, resolving, or guessing at any
**CEO INPUT REQUIRED** marker in either draft or in `LEGAL-FACTS-REQUIRED.md`; modifying the live
`/privacy` or `/terms` routes, which continue to show their existing "preview environment... will be
published before public launch" language unchanged.

---

## Remaining legal inputs required from James

Every item in `LEGAL-FACTS-REQUIRED.md` remains open:
1. Legal entity name
2. Company registration
3. Business address
4. Governing law and jurisdiction
5. Data-retention periods
6. Refund liability confirmation
7. Payment-agent status confirmation
8. Commission model
9. Operator contractual responsibility (legal phrasing)
10. Data Protection Officer / privacy contact, if required
11. Age restriction / minors policy, if any
12. Cross-border data transfer disclosure, if required

Plus, newly surfaced by this decision round:
13. Whether the one `operators.whatsapp` value identical to the central enquiry number
    (`+61413335007`, currently stored against Nadi Airport Transfers) is that operator's real,
    confirmed number or a placeholder — needed before that value is relied on for anything beyond
    internal record-keeping.
14. Enquiry acknowledgement target and provider response deadline (`CENTRAL-ENQUIRY-OPERATING-MODEL.md`)
15. Escalation backup person for the central WhatsApp inbox
16. Duration of Gate 4's post-launch observation period and Gate 5's supply-depth target
    (`LAUNCH-GATE-CHECKLIST.md`)

## Remaining Phase 8 dependencies

- PR #32 (media accuracy/fallback system) remains unmerged, pending the full 24-hour Phase 8
  observation window completing with a PASS, plus CEO visual sign-off — both still outstanding as
  of this decision round.
- Gate 1 of `LAUNCH-GATE-CHECKLIST.md` (Internal QA) cannot be declared complete until Phase 8 PASSES
  and PR #32 merges. Every decision recorded in this document can be planned and prepared now, but
  Gate 1 itself has not opened.

## What this document does not authorize

**No production launch, deployment, DNS change, domain change, indexing change, migration,
navigation change, provider invitation, or traveller invitation is authorized by this document or
by any of the six decisions it records.** Every decision above is a decision on the *documented
plan* — narrowing which options remain open for future, separately-authorized execution steps. Gate
1 of `LAUNCH-GATE-CHECKLIST.md` has not opened; no gate has opened.
