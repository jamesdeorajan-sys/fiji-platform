# Marau - minimal pilot release package (PREPARED, NOT RELEASED)

**Status: a proposal for James's decision. Nothing here has been deployed, migrated, imported or sent.** No production deployment, no real guest import, no outbound message. The package waits for (1) the human acceptance results (hosted staff console, physical phone) and (2) James's explicit release decision. RC3 is frozen.

## 1. What the pilot is
Three things, for real guests, with a human in the loop:
1. **Trip details** - the guest opens a private link and sees their ARRIVAL and RETURN TO AIRPORT legs (own date + year, pickup time in Fiji time, pickup location, destination, status; "Awaiting pickup details" when not recorded).
2. **Human support** - guests whose contact route is weak or who need follow-up land in the staff *Needs attention* queue with a named owner; the guest-side "Talk to our team" WhatsApp handoff stays off until a number is chosen (O3/C7), so until then support is staff-initiated follow-up only.
3. **Manually managed verified offers** - staff verify a supplier, publish an offer, build a morning/afternoon edition, review it, prepare a recipient list of consent-eligible guests, and **a human sends each message outside the app**. The app re-checks facts before each copy and records what was actually done.

**Switched OFF in the pilot:** referral rewards, live credit allocation, reward policy, any automatic or scheduled send, any outbound message from the app.

## 2. Requirements, split by what they are needed for
| ID | Requirement | Pilot (trip + support + manual offers) | Needed ONLY for referral rewards |
|---|---|---|---|
| P1 | Production Marau Worker + dedicated D1 + migrations (section 5) | **required** | |
| P2 | **Production integration:** real source read path (Nadi `GET /admin/bookings/:id`, `7d268e5`, not deployed; production sync trigger per `MARAU_STAGE1_PRODUCTION_RELEASE_PACKAGE.md`) | **required** | |
| P3 | **Source provenance:** mirror rows written as real (`test_data = 0`) only through an owner-approved provenance path; synthetic and real never mix | **required** (T4) | |
| P4 | **Status mapping:** source `completed` + upcoming return stays visible and *pending* with the plain guest sentence; no inferred confirmation | **required** (done in code) | |
| P5 | **Consent:** deals only to guests with granted consent; withdrawal respected up to the moment of copy; contrary sends recorded | **required** (done in code) | |
| P6 | **Staff ownership:** named staff identity per operator; one named owner per edition/date; follow-up owner for guests without WhatsApp | **required** (identity table done; named people = decision C5) | |
| P7 | **Access controls:** `/staff` and `/preview/admin/*` not reachable by the public; per-person credentials; shared admin token replaced or fronted (e.g. Cloudflare Access) | **required** (design decision; not built in the preview) | |
| P8 | Operator identity authenticated at the source (Nadi milestone38) | only for confirming bookings **at the source** from Marau | |
| P9 | Sender, owner per Fiji date + slot, rota, message text, consent wording, cap, quiet hours (C5) | **required** | |
| P10 | Physical-phone acceptance (saved dates, reopening, QR, link switching) | **required** (guest Trip) - QR only if the referral card stays | |
| P11 | Hosted staff-console human acceptance (handoff doc) | **required** | |
| R1 | Return-leg pricing at source (explicit return amount) or approved staff allocation envelope (C1/C2) | | **yes** |
| R2 | Reward terms: amount, cap, minimum purchase, stage (C3) | | **yes** |
| R3 | Payment evidence owner and partial-refund rule (C4) | | **yes** |
| R4 | Staff status verification ("Verify with evidence") | | **yes** - it is shown only beside an earned credit |
| R5 | Referral policy, funding source, live-mode approval + environment flag | | **yes** (cannot be set through any API today) |
| R6 | Non-FJD conversion rule (C8) | | **yes** |

### Open pilot decisions that the preview does NOT settle (James)
- **O1 - referral card on the guest Trip.** With rewards OFF it reads "Referral rewards are not switched on yet" and offers sharing. Keep as is, or hide it for the pilot? Hiding is a code change, so it needs a new candidate.
- **O2 - uncertain return with rewards OFF.** A completed-arrival/upcoming-return booking shows the return as "Awaiting human confirmation" with an explanatory sentence, and the only staff clearing button is tied to credits. In the pilot it simply stays pending for the guest. Accept this, or request a Needs-attention entry (new candidate).
- **O3 - WhatsApp handoff (C7)** stays off until a number is chosen.
- **O4 - who holds named roles (P6/P9)** and the sender channel.

## 3. Exact candidate identity (frozen)
| Item | Value |
|---|---|
| Repo / branch | `marau-stage1` / `ceo/marau-leg-clarity` |
| **Code commit (RC3)** | **`a7b8d3c`** (`a7b8d3c0d4fe006a852c87eff1f9f41d0c1d31d0`) |
| Tag | `marau-leg-clarity-rc3` -> `13208ca` (docs only after the code commit) |
| Docs head at preparation | the branch head containing this file (docs/scripts only; `git diff --stat a7b8d3c HEAD -- marau/worker marau/migrations` must be empty) |
| Hosted proof | Worker `marau-stage1-preview-legs` **`615f1da8-2cc1-4f8d-91ab-ca66e5ba2bbf`**, D1 `marau-stage1-legs-db` |
| Test evidence | Marau 415/415 local; hosted journey 40/40 (`docs/evidence/hosted_leg_clarity_journey_615f1da8.json`) |
| Lineage (all on this branch) | `7f34cd9` RC2 docs on `2b8faea` code -> `e1f9428` red tests -> `4e510ea` leg clarity -> `a7b8d3c` fare labels |
| Shared engine migrations | `smart-return-trigger-fill/migrations/0001-0006` (engine tree last changed at `c955110`) |
| Source read endpoint | Nadi branch `ceo/nadi-booking-read-itinerary` `7d268e5` - **NOT deployed** |
| Preserved, not part of the release | RC1 `marau-preview-rc1` (Worker `496b4d98`); round-trip preview `marau-roundtrip-preview-1` |

A release uses **exactly `a7b8d3c`'s `marau/worker` and `marau/migrations`**. Any change (for example O1/O2) is a new candidate with its own tests and acceptance; it is not folded into RC3.

## 4. Pre-release gates (all must be true before James is asked to decide)
1. Human acceptance results received: hosted staff console (all seven steps) and physical phone (checklist rows 1-7).
2. P2-P4 satisfied or consciously waived by James in writing: Nadi read endpoint deployed and verified; provenance path approved; status mapping confirmed with the source team (T6).
3. P6/P7/P9 named: operators, owners, access-control choice, sender, text, consent wording.
4. A dated, written release decision from James naming the commit `a7b8d3c` (or a successor).

## 5. Migration order (new production D1 - no data to preserve)
Create the dedicated production D1 first (never `nadi-marketplace-db` or `vakaviti-kb`); record the Time Travel **bookmark before** any migration.
1. `smart-return-trigger-fill/migrations/0001` ... `0006` in filename order (shared engine schema, unmodified).
2. `marau/migrations/0007` ... `0043` in filename order (37 files, contiguous, no gaps).
3. Apply file by file with a recorded result for each; **stop at the first failure**, do not skip. Use `wrangler d1 execute <db> --remote --file <migration>` for these *writes on the new empty database only*; never use `--file` against any existing production database for reads.
4. Note: `0016`, `0020`, `0031`, `0034`, `0038` contain `DROP` statements (they appear to be SQLite table rebuilds - confirm before applying). They are expected to be safe on a fresh database; they would be dangerous on a database holding data, which is another reason the pilot D1 must be new.
5. Verify the schema list matches the preview D1's table list before deploying the Worker.

## 6. Deploy order and rollback
**Deploy order:** (a) migrations as above; (b) deploy Worker `a7b8d3c` with **no** public route and rewards policy default OFF; (c) put access control in front of `/staff` and `/preview/admin/*` (P7); (d) staff credentials created by the engineer (named identities, delivered per the handoff's delivery rules); (e) only then expose the guest route; (f) enable the source feed for **one** booking first.

**Rollback (decision rule: stop the feed first, undo the exposure second, data last):**
1. Stop the source feed to Marau (disables the sync trigger from P2). Nothing else depends on Marau, so Nadi/FijiDash behaviour is unaffected.
2. Remove the guest route and the staff route (or deny at the access layer). Guests then see nothing; no message is sent by the app either way.
3. Worker: this is the **first** production deployment, so there is no earlier production version to roll back to; "rollback" means un-routing the Worker (and, if needed, deleting it). Keep the Worker/D1 for investigation.
4. D1: schema is forward-only. Before real data exists, restore to the pre-migration bookmark or drop the empty database. **After real guest data exists, do not restore blindly** (it would discard bookings written since): export what is needed first, and only then decide.
5. Rewards cannot have created any credit (policy OFF), so there is no money-side reversal to run; if a credit ever appears, treat it as an incident.
6. Record who rolled back, when, and why in AGENT_SYNC.

## 7. Post-release checks (first hour, then each pilot day)
1. Worker serves `/` and `/preview/trip` (with a staff-created test link) with HTTP 200; `/staff` and admin routes **refuse** an unauthenticated request.
2. Rewards policy mode reads **Off**; no reward credit rows; `MARAU_ALLOW_LIVE_REWARDS` unset.
3. First fed booking: the Trip shows each leg's own date/time/location/status; provenance fields match the approved path (P3); an unrecorded return pickup reads "Awaiting pickup details".
4. A booking marked completed with an upcoming return shows the pending/uncertainty state (P4).
5. Consent: a guest without granted consent never appears as eligible in an edition review.
6. No outbound traffic from the Worker (no WhatsApp/email/send credentials configured; the edition send log shows only staff-recorded outcomes).
7. Staff identity list contains only the named operators; no `Acceptance`/`Ana (roundtrip` preview identities exist in production.
8. Daily: edition expiry in Fiji time (morning 14:00, afternoon midnight), the Needs-attention queue has an owner for every entry, `sent_contrary_to_eligibility` count reviewed by the owner.

## 8. What this package deliberately does not do
No production resource is created, no migration run, no real guest imported, no message sent, no fare changed, rewards and live allocation remain disabled. It waits for human acceptance and James's explicit release decision.
