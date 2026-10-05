# Marau RC4 - human acceptance record (run `muuhi10o`)

**Status: PREPARED. Every human check below is NOT RUN until James performs it.** Nothing here is production, no real guest, no outbound message, no fare change, rewards OFF.

## 1. Frozen target (confirmed 2026-10-05 00:00 UTC)
| Item | Value | Check |
|---|---|---|
| Worker | `marau-stage1-preview-rc4` | confirmed |
| Version | `1ae9a441-3a2d-4000-bc03-1e5627c1ba9b` | `wrangler deployments list`: 100% current |
| Host | `https://marau-stage1-preview-rc4.helpronline.workers.dev` (`/staff` console) | `/` returns 200 |
| Code commit | `7df9958` | **fresh clean checkout** (new worktree, 0 modified/untracked): Marau suite **424/424** |
| Docs/scripts base | `0e4fb8f` | `git diff --stat 7df9958 0e4fb8f -- marau/worker marau/migrations` is empty |
| This record | its own separate docs commit on `ceo/marau-rc4-acceptance` (hash in the git log) | docs only |
| Rewards | policy mode `off`; 0 approved allocation rules | read from the database |
| Unrelated working-tree deletions in the original scratch clone (66 files) | **not modified, restored or committed** | the clean checkouts do not contain them |

## 2. Quiet acceptance window (shared database)
RC3 and RC4 share one D1 (`marau-stage1-legs-db`). The window cannot be *guaranteed* by the engineer alone, so it is arranged and then **monitored**:
- **Engineer side:** no hosted script, journey run, RC3 flow or other write is run against the database during the walkthrough, other than this run's own seed (before) and cleanup (after).
- **James side:** do not open any link on the RC3 host (`marau-stage1-preview-legs...`); use only the RC4 host and the links on the private card; do not run scripts.
- **Baseline before seeding** (quiet for ~34 minutes; last write was the engineer's own run at 23:26:22Z): guests 122, bookings 170, verifications 17, credits 26, approved rules 0. After the run, the same counts are re-read; any change not explained by this run's fixtures or James's steps marks the window **compromised**, and the checks are repeated on an isolated RC4 database (a new candidate identity would then be reported before re-running).

## 3. The 47 existing staff identities
| Question | Answer |
|---|---|
| What are they? | 42 `Ana/Bala (roundtrip <run>)` = 21 earlier journey runs; 5 `... (rc4 <run>)` = 4 RC4 script runs. All synthetic, all created by the author's own scripts. |
| Unaccounted? | **None.** Every one of the 25 run ids matches a recorded run in the author's evidence/output files. (Match is by name and run id; token values themselves are not readable here and are not listed.) |
| Separate from the temporary acceptance run? | Yes. The earlier throwaway proof run's `Acceptance Operator A/B (muufwkjz)` were **deleted** (0 remain). This run adds exactly two new identities, `Acceptance Operator A/B (muuhi10o)`; the total is now 49 (47 + 2). |
| Access scope | A staff token **alone grants nothing**: every `/preview/admin/*` route first needs the shared admin bearer token. With the admin token, **any** staff identity can perform **any** staff action (publish offers, verify returns, prepare sends, assign owners). There are no roles, no per-identity permissions, no expiry, and no revocation API (only a database delete). An identity is **attribution**, not authorization. |
| Risk | The older journey/RC4-script tokens follow a predictable pattern derived from a run id; they are only usable together with the admin token. Left in place by instruction (do not delete unrelated fixtures). **For production, per-person authenticated access is a required release item (P7).** |

## 4. Fixtures seeded for this run (all VERIFIED on the RC4 host before handoff)
Seed script verification (all lines `VERIFIED`): staff identity A accepted; staff identity B accepted; rewards policy is OFF; links for `recipient_with_consent`, `recipient_without_consent`, `uncertain_return` work; `recipient_without_consent` is in Needs attention (no WhatsApp, no owner); `uncertain_return` is in Needs attention as an uncertain return; `recipient_with_consent` is NOT in Needs attention. Phone fixtures `A_normal_round_trip` and `B_arrival_completed_return_upcoming` seeded the same way; every link answers 200.

**Expected trip facts (not secret) - what each link must show, Fiji time:**
| Link | Arrival | Return |
|---|---|---|
| A normal round trip | Wed, Oct 7, 2026, 9:00 AM - Nadi Airport -> Denarau - Confirmed | Wed, Oct 14, 2026, 10:30 AM - Sofitel Denarau lobby -> Nadi Airport - Confirmed |
| B arrival completed, return upcoming | Wed, Oct 7, 2026, 9:00 AM - Confirmed | Wed, Oct 14, 2026, 10:30 AM - **Awaiting human confirmation** + the "booking system shows completed" sentence |
| `uncertain_return` (staff fixture) | Thu, Oct 8, 2026, 9:00 AM - Confirmed | Thu, Oct 15, 2026, 10:30 AM - Awaiting human confirmation; after "Verify: still going ahead" -> Confirmed + "Our team checked..." note |
| `recipient_with_consent` / `recipient_without_consent` | Wed, Oct 7, 2026, 12:01 AM - pending | none |

Needs attention will also list older leftover synthetic items (earlier runs). Identify this run's items by their email: `acceptance.muuhi10o.*@example.test` and `phone.rt2.*@example.test`.

## 5. Credential delivery (no chat, GitHub, logs or screenshots)
A **local private folder on James's own machine**: `C:\Users\James\AppData\Local\MarauAcceptance\run-20261005T000059Z\` (access limited to SYSTEM, Administrators and the `James` account; outside every repository and any synced folder). It holds `OPERATOR_CARD_PRIVATE.txt` (staff console URL, admin token, the two staff tokens, the guest links) and `phone_links_QR_PRIVATE.html` (QR codes to open a guest link on a phone). Staff and admin secrets never appear in chat or in any committed file. The two staff tokens and the admin token are different secrets; keep them apart when entering. (If a password manager is preferred, copy them there and delete the files.)

## 6. Check results (NOT RUN until James performs them)
| # | Check | Result | Notes |
|---|---|---|---|
| H1 | Sign in; panels load; Reward policy mode Off; no credits | **PASS (sign-in and panel display only)** | James's screenshots (2026-10-05): Needs attention, Offer requests, Reward credits, Report, Suppliers, Offers, Morning and afternoon editions, Deals pilot, Reward policy OFF. The Report shows 17 earned and 9 applied **synthetic credits**, consistent with the pre-existing shared-DB count (not created by this run). This confirms rendering only - not action correctness or production readiness. Screenshots are kept by James; the sign-in screen was not captured. |
| H2 | Supplier create + Verify; offer draft + Publish | NOT RUN | |
| H3 | Edition draft + Publish; Prepare refused before review; B approves; A prepares | NOT RUN | |
| H4 | Check and copy message: no link/phone/email; app states it cannot stop an external send | NOT RUN | |
| H5 | Guest withdraws consent -> Check refused (no marketing consent), row stale | NOT RUN | |
| H6 | "I sent it" recorded and flagged contrary to eligibility | NOT RUN | |
| H7 | Needs attention: no-WhatsApp guest listed; Assign owner; sign out clears the console | NOT RUN | |
| H8a | Uncertain return visible with rewards OFF; "Verify: still going ahead"; guest view Confirmed + note | NOT RUN | |
| H8b | Engineer synthetic itinerary change -> verification invalidated, item re-opens, old row refused | NOT RUN | engineer-assisted |
| H8c | "Not going ahead": guest sees Cancelled; audit evidence (engineer read-back) | NOT RUN | |
| P1 | Phone: saved arrival and return dates/times correct (Link A, Link B) | NOT RUN | |
| P2 | Phone: reopen the link (history / home screen) -> same trip | NOT RUN | |
| P3 | Phone: camera scan of the referral QR works first time | NOT RUN | |
| P4 | Phone: switching private links never shows the previous trip | NOT RUN | |
| C1 | Cleanup: this run's guest links revoked and verified 401 | NOT RUN | after acceptance |
| C2 | Cleanup: this run's two staff identities deleted and tokens verified 401 | NOT RUN | after acceptance |
| C3 | Post-run counts re-read; window integrity | NOT RUN | after acceptance |

## 7. Findings during acceptance
### F1 - "-1/1 left" on a synthetic sunset offer (James's screenshot 112327): NOT a defect - a separator read as a minus sign
- **What the screenshot actually shows** (read from the image): `Synthetic Reef Tours muufut2r (verified) - owner Ana (roundtrip muufut2r) - 1/1 left - price FJ$120.00, cost FJ$80.00 - 0 open, 0 confirmed`. The staff console joins its fields with ` - ` (a hyphen); `1/1 left` follows the separator, so `- 1/1 left` reads like `-1/1`. The value is **1 of 1**, not negative.
- **Read-only trace of that exact offer** (`off_eaf50323-a12b-4922-92c9-0cf74c4ee737`, "Synthetic sunset muufut2r"; read with `wrangler d1 execute --command SELECT`): capacity 1, status published, **0 requests** (0 confirmed/fulfilled places), so places left = 1. The same screenshot's `Synthetic snorkel rc4 muug9beq - 19/20 left` equals capacity 20 minus the 1 place from the RC4 O5 hosted run's confirmed request.
- **Question 1, did a test deliberately create invalid capacity?** No. The journey script creates this offer with capacity 1 (valid; validation requires a whole number 1-500). Across the shared database: **39 offers, 0 overbooked, 0 with capacity below 1, minimum capacity 1.**
- **Question 2, is the availability display wrong?** The numbers are right. The code also clamps `places_left` at 0 (it can never print a negative number), and that clamp was not used to hide anything: no offer is over capacity. The only issue is **readability**: ` - 1/1 left` is ambiguous next to a hyphen.
- **Question 3, can the normal workflow overbook?** No. Capacity is checked inside the single INSERT that creates a request; a lapsed hold cannot be confirmed (`HOLD_EXPIRED`). The existing tests prove it on the clean RC4 checkout `7df9958`: *OVERSELLING is impossible under concurrency (capacity 2, five guests at once -> exactly 2 held)* and *a lapsed hold releases its places and cannot be confirmed*; the offers file passes 20/20.
- **Disposition:** no code defect, no fixture deleted or altered, no clamping change. **Observation O6 (cosmetic, NOT in frozen RC4):** change the staff offers line to an unambiguous form (for example `places left: 1 of 1`) in a later candidate. Not made now: RC4 stays frozen.
