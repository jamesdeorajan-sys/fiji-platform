# Marau - release gate (updated for the round-trip round)

**Nothing here is approved or requested.** This is the list that must be GREEN before any production request. Status is as of branch `ceo/marau-roundtrip-legs`
(code `1735a56`, isolated preview Worker `11b19336`). RC1 (`marau-preview-rc1`, Worker `496b4d98`) is preserved unchanged.

| # | Gate | Status | Evidence / what is missing |
|---|---|---|---|
| 1 | Source adapter reads the REAL booking shape (round trip in one row) | **Built, proposed, NOT deployed** | Nadi `7d268e5` (`GET /admin/bookings/:id`), Marau adapter; run against the real worker in-process. **Source endpoint is not deployed.** |
| 2 | Round trip -> two stable legs; repeated sync/edits/cancellation reconcile | **Green locally + hosted synthetic** | 18 local tests; hosted 29/29 x2 |
| 3 | Return-leg value explicit (`RETURN_VALUE_UNRESOLVED`) | **Green; BLOCKED by a decision** | an approved allocation rule (James) - no real return leg can take a credit until then |
| 4 | Demonstration vs real separated by provenance | **Green locally** | live eligibility needs authenticated + approved provenance; no approved path exists |
| 5 | Human-led deals pilot (manual) | **Built; green locally + hosted synthetic + local browser** | sender, owner, rota, text, consent wording = **decisions** |
| 6 | Real-source reader deployed with itinerary fields | **NOT DONE** | needs the Nadi endpoint deployed (James release gate) |
| 7 | Nadi milestone38 (attempt identity) | **NOT DEPLOYED** | unchanged; operator identity stays `service-asserted` |
| 8 | Production Marau resources + migrations 0035-0042 | **NOT DONE** | none exist; rollback = Time Travel bookmark taken before migrating |
| 9 | Mirror rows `test_data=0` + live-reward decision | **NOT DONE** | requires gates 1,6,7 and an owner approval |
| 10 | Physical-phone evidence | **NOT COLLECTED** | RC1 walkthrough available now; camera QR scan unverified |
| 11 | Real iPhone/Android pass on the round-trip UI | **NOT DONE** | |
| 12 | Edition delivery + human-team workflow | **NEXT COMMERCIAL MILESTONE - not started** | no scheduler, no sender exists |
| 13 | Booking-level `completed` semantics for round trips | **ASSUMPTION - unconfirmed** | recorded on the leg; confirm with the source team |
| 14 | Commercial decisions (rewards, payment-evidence owner, partial-refund rule, wa.me, consent wording, supplier verification) | **OPEN** | `MARAU_RELEASE_CANDIDATE.md` section 4; `MARAU_ROUNDTRIP_AND_PILOT.md` sections 7-8 |

Reproducible acceptance (this branch): `node --test test/*.test.mjs` (385) · `(cd ../smart-return-trigger-fill && node --test test/*.test.js)` (247) · Nadi `node --test nadi-marketplace/worker/*.test.mjs` (111) ·
`node scripts/hosted_roundtrip_journey.mjs <legs preview url> <admin token>` (29) · `node scripts/local_pilot_demo_server.mjs` (local browser demo).
Rewards are **OFF** on every preview unless a script turns them to synthetic preview mode and restores OFF (both hosted scripts do).
