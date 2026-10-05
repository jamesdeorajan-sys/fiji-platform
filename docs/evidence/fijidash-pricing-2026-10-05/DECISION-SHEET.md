# Decision sheet for James (one page) - 2026-10-05

Production is on HOLD. Nothing below is implemented, deployed or approved. **Recommendations are the author's and are NOT approvals**; the boxes are for you. No fare is invented: every figure is an existing published or formula figure from `POLICY-DECISION-TABLE.md` (quoted amount = what a page shows the guest; recorded amount = what the booking system stores).

Document status: this sheet is based on branch commit `056e4c2`. Codex's documentation patch (`catalogue-policy-docs.patch`, local commits `63ab476` / `73be6ac`) was **not available to the author and has not been reviewed or applied**; where this sheet differs in wording from that patch, the patch's reviewed wording should win once it is integrated.

## Already approved (no decision needed)

Marriott Momi Bay **minibus**: base FJ$175.92 before the 10% discount; quoted and recorded one-way **157.92**, day return **297**, day return with a child seat **304**. Nothing else is approved.

## Decisions, in priority order

| # | Decision | Options | Author's recommendation (not an approval) | Your decision |
|---|---|---|---|---|
| 1 | **Global fare authority, and the disputed exceptions.** Which source is the fare: the published catalogue, or the Worker formula? 108 route/vehicle/trip cases on 28 routes differ by more than FJ$5 and 5%; 4 differ by more than the Worker's 30% band: Nadi downtown and Mercure sedan one-way (catalogue 19, formula 30.15), Wailoaloa and Crowne Plaza sedan return (catalogue 67, formula 50.17) | **A** catalogue / **B** formula / **C** catalogue-led with per-row exceptions | **C**: the catalogue is the authority (it is what you approved for Momi and what the pages advertise), and every disputed row stays "published, unapproved" until you sign it, starting with the 4 out-of-band rows. This only works if the catalogue figures are ones you stand behind - that is your commercial call, not a technical one | [ ] A  [ ] B  [ ] C |
| 2 | **Night surcharge and return-leg allocation.** The pages and FAQ say 20%, but FijiDash records the day amount at night on live-fare routes; neither side looks at the return pickup time (release blocker B1) | **N0** none / **N1** Worker rule (outbound pickup only) / **N2** per leg / **N3** page convention (outbound only, rounded up to FJ$5) | **Not N2** (no system holds legs; its totals depend on an allocation assumption nobody has approved). Choose between N0 and N3; N3 matches NAT today and the rounding the approved Momi figures use. If you want a night surcharge, decide whether a night RETURN pickup counts | [ ] N0  [ ] N1  [ ] N2  [ ] N3   night return counts: [ ] yes [ ] no   leg allocation if N2: [ ] AL-1 equal legs  [ ] AL-2  [ ] other: ____ |
| 3 | **Return rounding.** Page rounds returns up to the next FJ$5; the Worker does not (differences up to FJ$5; Momi minibus return 297 vs 292.45) | **R1** page convention everywhere / **R2** Worker convention everywhere / **R3** keep both, tolerate in-band differences | **R1**: the approved Momi figures (297 / 304) are only reproduced by the round-up, so R2 would contradict your approval | [ ] R1  [ ] R2  [ ] R3 |
| 4 | **Momi sedan / minivan scope.** Your approval covered the minibus. The held candidate extends the return convention to the Momi sedan and minivan returns (166 / 252 quoted; Worker 157.44 / 245.73) | **E1a** minibus-only / **E1b** extend to sedan+minivan returns / **E1c** also extend to their one-way (89 / 134) | **E1a** until you approve more. If chosen, the candidate needs a one-line scope change (not made) | [ ] E1a  [ ] E1b  [ ] E1c |
| 5 | **Tanoa International handling.** The Worker has no rule for it and records whatever amount the client sends; pages quote FJ$15 / 25 / 45 (return by convention 30 / 50 / 85 before discount) | **T1** fixed-fare rule with fares you supply / **T2** treat as an existing zone / **T3** quote on request / **T4** keep as is (unverified) | **T1** if you confirm the three fares (the only option that restores server verification and keeps instant booking). **No default is assumed** by this sheet or the plan: until you decide, nothing changes | [ ] T1 (fares ____ / ____ / ____)  [ ] T2  [ ] T3  [ ] T4 |

Also needed only if you choose B or C in decision 1: the **display rule** for printed prices (whole dollars with a stated rounding rule, or show cents).

## What happens after you decide

Each decision becomes its own change in the isolated harness, re-tested, independently reviewed, and checked for production drift before any release. Fuel adjustments are not part of any option and stay disabled.
