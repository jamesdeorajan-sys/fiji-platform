# Shared RC3 / RC4 preview database - reconciliation (2026-10-05)

RC3 (`marau-stage1-preview-legs`, Worker `615f1da8`) and RC4 (`marau-stage1-preview-rc4`, Worker `1ae9a441`) are **two Workers on ONE D1 database**, `marau-stage1-legs-db`. So "RC3 is untouched" is true **only of RC3's Worker code and version**. It is **not** true of the data RC3 reads: every hosted script run against either Worker wrote to the same database. This note lists what was written, who wrote it, and what it means for RC3. Read-only queries (`wrangler d1 execute --command SELECT ...`, no tokens selected) were used; nothing was changed to produce this note.

## 1. What is unchanged, and what is not
| Thing | State |
|---|---|
| RC3 Worker code, version `615f1da8`, config | **Unchanged** since its deploy |
| RC4 deploy | A **separate** Worker; no migration; no change to the schema RC3 uses |
| The shared database content | **Changed** by hosted scripts (below); synthetic data only |
| Anything production | Not touched. This is an isolated preview database; no real guest, message or payment |

## 2. Allocation rules (`marau_return_allocation_rules`)
- **18 rules exist, all `retired`; none approved now.** All are 40% `percent_of_total`, `approval_basis = synthetic_preview`.
- 17 were created and approved by the **journey script** (RC3 line and the RC4 regression run), each retired by the *next* run's start-up (the journey script's own design). One more (the 18th) was created, approved and retired by the RC4 hosted script this round (`Ana/Bala (rc4 muug9beq)`), only to prove the O5 boundary; it was retired at the end of that run and only that one.
- **One earlier retirement by an RC4 script** (`Bala (rc4 muufvqb0)`) retired a rule that the journey run `muufut2r` had left approved. That was an RC4 script retiring a rule it did not create, to make a check read cleanly. It has been **removed from the script**: no RC4 check now retires or deletes a rule it did not create.
- Effect on RC3: before this work a journey run always left one approved synthetic rule behind; now none is approved, so an RC3 return leg synced or read today stays `unresolved` until a rule is approved again. Nothing in RC3's code changed.

## 3. Reward policy and credits
- Policy: `mode = off` (last written by journey run `muufut2r`, which switches it to preview and back to off; RC4's own script never changes it).
- Credits: **26 total - 17 earned, 9 applied**, all created by earlier journey runs on synthetic guests. The RC4 uncertain-return/not-going-ahead/O5 runs created **none** (counts were identical before and after the last hosted run).

## 4. Fixtures and guests by origin (118 guest sessions + synthetic source bookings, all `test_data = 1`)
| Origin | Guests | Note |
|---|---|---|
| Round-trip journey runs (RC3 line and RC4 regression) | 109 | each run creates guests, staff identities, a supplier/offer/edition, referrals and credits |
| RC4 scripts (`rc4.*`) | 7 | uncertain-return, not-going-ahead, O5 referrer and friend guests, per run |
| Seed-script proof run (`acceptance.*`) | 3 | all three guest links **revoked** (401 verified) |
| Phone-checklist seed (Link A / Link B) | 2 | James's RC3 phone fixtures; **not touched** by any RC4 script |
| Leg-clarity fixture (2031 dates) | 1 | author fixture |

- **Staff identities: 47 rows, all synthetic.** Named `Ana/Bala (roundtrip <run>)` (journey runs, 42) and `Bala (rc4 <run>)` x4 and `Ana (rc4 muug9beq)` x1 from RC4 hosted runs. The proof run's `Acceptance Operator A/B` rows were **deleted** (0 remain). The remaining synthetic identities are useless without the shared admin token and are left in place.
- **Verifications** (`marau_leg_status_verifications`): written by journey runs (basis format v1 `status|pickup`) and RC4 runs (format v2).

## 5. Effects on RC3 (and what to avoid)
1. **Mixed-version basis.** RC3 records and checks a verification against a v1 basis; RC4 uses a richer v2 basis. If both Workers **sync the same booking**, each Worker's lookup will not match the other's verification, so an uncertain return one verified can **re-open** when the other syncs it. Verifications and re-opens are always safe (they fail toward "uncertain"), but they would surprise an operator. **Run acceptance against ONE Worker only.**
2. RC3 does not show the RC4 guest note or the RC4 Needs-attention item; RC3's `verify-status` does not require the itinerary basis. Data written through RC4 is still valid for RC3 to display.
3. **Needs attention on RC4 will also list leftover synthetic items:** at the time of writing three uncertain returns exist on the preview (James's Link B fixture, plus script leftovers). The operator's own fixture is identified by its email `acceptance.<run>.uncertain@example.test`.
4. Do not run `hosted_roundtrip_journey.mjs`, the seed scripts, or any RC3 flow against this database **during** human acceptance: they create staff identities, rules and queue items that would add noise.

## 6. Recommendation (not done - needs your call)
For acceptance and any later release evidence, use a **dedicated database for RC4** (a new D1 with the same migrations), so RC3 and RC4 evidence cannot contaminate each other. Sharing was chosen to avoid a migration; it has the costs above. Until then, treat all counts here as shared state.
