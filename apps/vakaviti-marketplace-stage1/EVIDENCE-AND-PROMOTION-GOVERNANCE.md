# Vakaviti Stage 1 — Evidence & Promotion Governance

Created 2026-08-19 (Evidence Engine Pilot 2). This document is the permanent reference for how a
new operator is allowed to become a live Stage 1 listing, and for the vocabulary used everywhere
else in this project's evidence records.

## The three-way distinction

**EVIDENCE** = information supporting a real-world claim (a source URL, an operator's own message,
a government registry entry, a CEO authorization). Recorded in the `evidence` table.

**VERIFICATION DECISION** = a human governance decision made *after* reviewing evidence. Nothing in
this codebase — no AI call, no candidate-review transition, no promotion — may itself constitute a
verification decision. It is always a separate, explicit act.

**PUBLISHED STATUS** = what the marketplace actually displays (`operators.verification_status`,
`products.verification_status`). This is downstream of a verification decision, never a substitute
for one.

Evidence ≠ verification decision. Verification decision ≠ evidence. Conflating any two of these is
the exact failure mode this document exists to prevent.

## `CEO_AUTHORIZATION` — what it means and what it does not

`CEO_AUTHORIZATION` is a legitimate `evidence.source_type` value meaning: **"James explicitly
authorized this fact for Stage 1 publication."** It does **not** mean independently verified,
operator-confirmed, registry-verified, or website-verified — those are separate, distinguishable
source types, and a `CEO_AUTHORIZATION` row must never be read as any of them.

`confidence=1.0` on a `CEO_AUTHORIZATION` row means "confidence that the authorization occurred,"
**not** "absolute confidence the underlying real-world fact is true." The two live operators'
`VAKAVITI_VERIFIED` badges predate and are independent of the 21 evidence rows recorded in Pilot 1
— those rows document the authorization alongside the badge, they do not retroactively justify it.

## Promotion lifecycle (implemented 2026-08-19)

```
DISCOVERED (candidate_operators.workflow_state)
  ↓ POST /api/admin/candidates/ingest
ENRICHED / QUALIFIED / SHORTLISTED / REJECTED / DUPLICATE_RESOLVED
  ↓ POST /api/admin/candidates/:id/review   (human decision, logged to review_actions)
QUALIFIED or SHORTLISTED only
  ↓ POST /api/admin/candidates/:id/promote  (admin-authenticated, fails closed)
operator created:
  verification_status = 'NOT_VERIFIED'   ← always, no exception
  commercial_status   = 'INACTIVE'       ← always, no exception
  ↓
[separate, later, explicit human decision — no code path exists for this yet]
  ↓
VAKAVITI_VERIFIED
```

There is no code path from `candidate_operators` directly to `VAKAVITI_VERIFIED`, and no code path
from any AI call to `VAKAVITI_VERIFIED`. Confirmed by inspection: the only two writers of
`operators.verification_status` in this codebase are (a) this promotion endpoint, which always
writes `NOT_VERIFIED`, and (b) direct manual/CEO-authorized D1 writes outside all application code
(how the current 2 live operators were created). No third path exists.

## `POST /api/admin/candidates/:id/promote`

Admin-authenticated (inherits the router-level `requireAdmin` middleware already applied to every
`/api/admin/candidates/*` route). Fails closed on every axis:

| Condition | Response |
|---|---|
| Missing/wrong admin token | `401` (existing middleware) |
| Candidate not `QUALIFIED` or `SHORTLISTED` | `409 candidate_not_approved_for_promotion` |
| Already promoted once | `409 already_promoted` |
| Missing mandatory evidence (see below) | `422 missing_mandatory_evidence`, names exactly what's missing |
| Success | `201`, new operator's `id`/`slug`, always `NOT_VERIFIED`/`INACTIVE` |

**Duplicate-promotion prevention deliberately uses no new column.** It queries `review_actions` for
an existing `entity_type='CANDIDATE_OPERATOR', entity_id=<id>, action_type='PROMOTED_TO_OPERATOR'`
row. This is zero-schema-change by design — `review_actions` already exists for exactly this kind
of audit record, and reusing it also gives free provenance linkage: `after_json` on that row
records the resulting `operator_id`, so the candidate→operator relationship is always traceable
without adding a `promoted_operator_id` column to `candidate_operators`.

## Mandatory evidence policy (minimum to promote, not to verify)

Deliberately minimal — only what's commercially necessary to publish *a listing*, not what's
necessary to mark it verified:
- `canonical_name` — must be present (already a `NOT NULL` column)
- location — `locality` or `region`, at least one
- contact — `whatsapp`, `phone`, or `email`, at least one
- category — `categories_json` must parse to a non-empty array
- provenance — at least one `candidate_sources` row must exist (guaranteed today by `/ingest`
  itself, which always creates one)

Optional facts (website, legal identity, social profiles) are never required to promote. A
candidate may be promoted as `NOT_VERIFIED` while these remain unknown.

## Known governance gap — reported, not fixed in this pass

**None of the public marketplace queries in `src/index.ts` filter by `commercial_status` or
`verification_status`.** A freshly promoted operator (`NOT_VERIFIED`/`INACTIVE`) is immediately
visible on `/operators`, the homepage's featured-operators section, and its own `/operators/:slug`
page — identically to the 2 existing verified operators, with only the badge text differing. This
endpoint only gates *evidenced* promotion; it does not gate *public visibility* of a newly promoted
operator. Closing this (e.g. a real draft/publish distinction, or filtering the public queries by
`commercial_status='ACTIVE'`) is separate, not-yet-authorized work.

## What remains frozen (per CEO instruction, 2026-08-19)

Canonical ecosystem IDs, the Fiji Place Authority, the Lead/Fare/Booking Services, and any
cross-ecosystem API (ComeToFiji, Lagi) remain out of scope until this supply-governance path is
proven with real use.

## The publication law (added 2026-08-19, Evidence Engine Pilot 3)

Every state above answers "what do we believe is true." None of them answer "is this visible to
the public." Those are separate questions, and conflating them was a real defect found during
Pilot 2's synthetic testing: a freshly promoted `NOT_VERIFIED`/`INACTIVE` operator was immediately
visible on every public page, identically to a verified one.

**Explicitly, none of these states imply publication:**
- `DISCOVERED` does not mean published.
- `SOURCE_EVIDENCED` does not mean published.
- `OPERATOR_CONFIRMED` does not mean published.
- `VAKAVITI_VERIFIED` does not automatically mean published.
- `PROMOTED` (i.e. exists as an `operators`/`products` row) does not mean published.

**The only thing that gates public visibility is `commercial_status`:**
- `commercial_status='ACTIVE'` → eligible for public marketplace visibility
- `commercial_status!='ACTIVE'` → MUST NOT appear on any public page or accept enquiries

Verification and publication are independent dimensions — both can vary independently:
- `VAKAVITI_VERIFIED` + `INACTIVE` = verified internally, not publicly listed
- `NOT_VERIFIED` + `ACTIVE` = may be publicly listed if commercial approval explicitly permits it (Stage 1's own 2 real operators are exactly this shape for their *products* — every product is `NOT_VERIFIED`/`ACTIVE`, while the *operators* are `VAKAVITI_VERIFIED`/`ACTIVE`)
- `NOT_VERIFIED` + `INACTIVE` = not publicly visible (the default state a freshly promoted operator now lands in)

## Fail-closed public queries (implemented 2026-08-19)

Every public discovery/commercial query in `src/index.ts` now requires `commercial_status='ACTIVE'`
on both the operator and, where applicable, the product:

| Route | Operator filter | Product filter |
|---|---|---|
| `/` (featured products/operators) | Yes | Yes |
| `/experiences` | Yes | Yes |
| `/experiences/:slug` | Yes (checked after product lookup, so an inactive parent 404s even if the product row is itself ACTIVE) | Yes |
| `/operators` | Yes | Yes (product count and listing) |
| `/operators/:slug` | Yes | Yes |
| `/enquire/:operatorSlug` | Yes | Yes (an inactive product silently falls through to no product-specific mention rather than erroring; an inactive operator 404s the whole route) |

**`/claim/:slug` is deliberately NOT filtered.** Claiming a profile is an onboarding step for an
operator to take control of their own listing, not public marketplace discovery — an operator
should be able to claim a not-yet-`ACTIVE` listing as part of getting activated. This is a
considered exclusion, not an oversight.

No sitemap, feed, or other public discovery endpoint exists in this app beyond the routes above
(confirmed by full-file inspection).

## Known limitation carried forward

There is still no `POST /publish` or `POST /activate` endpoint — reaching `commercial_status='ACTIVE'`
remains an explicit, direct data state with no code path that sets it automatically. Building that
endpoint requires separate, later CEO authorization, per instruction.

## The verification law (added 2026-08-19, Evidence Engine Pilot 5)

Extends the publication law above with the equivalent rule for the *verification* dimension:

- `CEO_AUTHORIZATION` (a source type recorded in `evidence`) is **not** independent verification.
- AI extraction (`POST /api/admin/products/digitise`) is **not** verification — structurally
  cannot be, since it only ever writes `product_candidates`, never `operators`/`products`.
- `SOURCE_EVIDENCED` is **not** `OPERATOR_CONFIRMED`, and `OPERATOR_CONFIRMED` is **not**
  automatically `VAKAVITI_VERIFIED`.
- `VAKAVITI_VERIFIED` requires one thing only: an explicit human decision through
  `POST /api/admin/operators/:id/verification`. There is no other code path in this codebase
  that writes that value — confirmed by inspection: `src/candidates.ts`'s `/:id/promote` always
  forces `NOT_VERIFIED`; `src/products.ts`'s AI pipeline never touches `operators` at all.

**Verification and publication are fully independent — both can vary independently, and neither
automatically changes the other:**
- `ACTIVE` + `NOT_VERIFIED` — valid (Stage 1's own 10 real products are exactly this shape)
- `INACTIVE` + `VAKAVITI_VERIFIED` — valid (verified internally, not yet publicly listed)
- `ACTIVE` + `VAKAVITI_VERIFIED` — valid (Stage 1's own 2 real operators are exactly this shape)

`POST /api/admin/operators/:id/verification` never references or writes `commercial_status` in
any branch — this is enforced by omission (the `UPDATE` statement only ever sets
`verification_status`), not by a runtime check, and is exactly why the CEO's own Pilot 5 test
(verify a synthetic operator, confirm it still 404s publicly because it remains `INACTIVE`)
proves the two dimensions truly don't interact.

## `POST /api/admin/operators/:id/verification`

Admin-authenticated. Fails closed on every axis:

| Condition | Response |
|---|---|
| Missing/wrong admin token | `401` |
| Operator not found | `404 operator_not_found` |
| `verification_status` not one of `VAKAVITI_VERIFIED`/`NOT_VERIFIED` | `400 invalid_target_state` |
| Requested transition not allowed from the current state | `409 invalid_transition` |
| Missing `reason` | `400 reason_required` |
| Missing `reviewer` | `400 reviewer_required` |
| Granting `VAKAVITI_VERIFIED` with no `evidence_ids` | `400 evidence_basis_required` |
| A referenced evidence ID doesn't exist | `422 evidence_not_found` |
| A referenced evidence ID belongs to a different entity | `422 evidence_belongs_to_other_entity` |
| Success | `200`, new `verification_status`, unchanged `commercial_status`, `review_action_id` |

**Allowed transitions:** `NOT_VERIFIED → VAKAVITI_VERIFIED` (grant, requires evidence) and
`VAKAVITI_VERIFIED → NOT_VERIFIED` (revoke/correct, evidence not required — a human may revoke
trust on reason alone; the absence of trust doesn't itself need positive evidence). No other
target states exist. No self-transition (`NOT_VERIFIED → NOT_VERIFIED` etc.) is defined as valid.

**Audit record**: reuses `review_actions` (zero schema change) — `entity_type='OPERATOR'`,
`action_type='VERIFICATION_GRANTED'`/`'VERIFICATION_REVOKED'`, `actor`=reviewer, `note`=reason,
`before_json`/`after_json` capture the state transition, and `after_json.evidence_ids` records
exactly which evidence rows supported a grant. This table already had every field this decision
needed to be truthfully recorded — no new column was required.

**Scope**: operator-level verification only in this pass. A product-level equivalent
(`POST /api/admin/products/:id/verification`) does not yet exist — out of scope until separately
authorized.
