# Marau October revenue round - evidence, dependencies, decisions (2026-10-04)

> **CORRECTION (2026-10-04, later round):** the line below saying the staff console sign-in "renders at mobile width" overstated
> the browser evidence. The HTML rendered, but the page script crashed at load (`__name is not defined`) on preview 83e9b919, so
> the guest app and `/staff` were not functional there. Fixed and re-verified in `MARAU_REWARD_INTEGRITY_ROUND.md` (defect D14).


Scope: local implementation + isolated preview only. No production deploy/migration, real guest, fare change, payment, WhatsApp send or public offer. Issue #59 work untouched.

## Commits
- Marau (`ceo/marau-stage1-preview`): `9e08a0b` source client + real-contract tests; `81c96e0` offers; `4e659a4` referral rewards; `a22c74f` contact/consent; `0fb4a11` guest UI + staff console; plus the hosted-journey script and this doc.
- Nadi (`ceo/nadi-source-confirm-attempt-identity`): `0d0976e` attempt identity + operator attribution. PUSHED, NOT DEPLOYED, milestone38 NOT applied.

## Evidence labels
- LOCAL, AUTHOR-RUN: Marau suite 290/290, engine 247/247 (engine untouched since 9e08a0b), Nadi attempt-identity 17/17, real-contract 9/9 (runs Marau against the REAL nadi worker.js in a worktree). Not independently verified.
- HOSTED SYNTHETIC (isolated preview Worker `83e9b919-531b-4acb-97c3-d488b5433ae8`, D1 `marau-stage1-test-db`): `scripts/hosted_revenue_journey.mjs`, 36/36 checks. Covers journey, expired, sold-out (concurrent), withdrawal, cancellation, repeat requests, concurrent redemption (exactly one adjustment), missing WhatsApp, private-link protection, consent. One stated FIXTURE: return legs inserted directly into the preview DB. Preview source is the synthetic source, not production.
- Browser: staff console sign-in renders at mobile width with no tokens in the page. Guest-UI visual capture not done this round (served-text tests only).
- Not evidenced: real camera QR scan (OpenCV decode of the raster only), true parallelism (statement-level atomicity only), any production behaviour.

## Production dependencies
1. Deploy nadi milestone38 + the worker change to the real source (James release gate); until then `source_kind` is synthetic.
2. Real source authenticates only the shared ADMIN_TOKEN, so operator identity is `service-asserted`, not verified per person.
3. Real-booking mirror must supply return legs (leg_type) for credit application.
4. Production D1/Worker/resources for Marau; migrations 0035-0037.
5. Payment/collection of the discounted amount is outside Marau.

## Decisions for James
1. Reward amount, cap, minimum purchase, qualifying stage (confirmed vs fulfilled). FJ$10 was an illustration only.
2. Who funds the reward; one credit per friend ever?
3. Guest self-applies credits or staff applies?
4. Hold duration (12h default) and cancellation window.
5. wa.me handoff on/off (currently text only, no link).
6. Supplier verification process and fulfilment owners.
7. Promotional consent wording/channel; named follow-up owners.
8. Approval for any live mode (code refuses live without owner approval + env flag).

## Reporting rule
Quoted value, shares and requests are never revenue; the report separates confirmed sales, fulfilled sales, contribution before rewards, and reward funding.
