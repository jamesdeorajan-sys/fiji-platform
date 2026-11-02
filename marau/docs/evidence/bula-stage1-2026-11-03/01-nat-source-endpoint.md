# 1. NAT read-only source endpoint — review of 7d268e5 against CURRENT production (NOT deployed)

## Critical finding: 7d268e5 cannot be deployed as committed
- `7d268e5` is stacked on ~40 unmerged commits (issue #59 notification/broadcast rework, `0d0976e` confirmation-attempt change on manual-assign). Deploying a build of it would ship all of that, not just a read route.
- The code actually deployed on `nadi-dispatch-api` contains modules that exist in NO branch of `fiji-platform` (a rentals module — `rental.mjs`, `/admin/rentals-console`, `rental_enquiries` — plus later fare/consent work). A build from 7d268e5 would REMOVE rentals from production. I bundled every remote branch that contains the NAT Worker and compared it with the deployed bundle: none matches (closest 755 differing lines).
- Therefore the production NAT source of truth is not in git. Review was done against the **byte-exact deployed bundle**, fetched read-only.

## What is proposed instead (exact, minimal, additive)
`nat/nat-source-endpoint.diff`: **+27 lines, 0 removed**, applied to the deployed bundle: one route `GET /admin/bookings/<digits>` and one handler. It is the 7d268e5 read route with two hardenings:
- **H1 dedicated read-only credential `SOURCE_READ_TOKEN`.** 7d268e5 used `requireAdmin`, which accepts the master `ADMIN_TOKEN` and interactive admin-login tokens. Bula would then hold a credential that can also cancel and assign bookings. The proposed route accepts ONLY `SOURCE_READ_TOKEN` (constant-time compare). The master admin token and login tokens are refused (tested). Unset/empty secret ⇒ every call 401 (fail-closed; safe to deploy before the secret exists).
- **H2 logging:** on a database error only the error *name* is logged (7d268e5 logged the whole error object).

## Checklist (all evidence in `nat/nat-test-output.txt`, 11/11 pass)
| Requirement | Result |
|---|---|
| strictly read-only; no creation / modification / status change | PASS — DB byte-identical before/after valid, invalid, unauthorised reads; POST/PUT/PATCH/DELETE never served; added code has no write verb |
| no notification / WhatsApp / email / customer contact | PASS — outbound `fetch` denied in the test and never attempted; no `booking_events` row |
| no pricing change; no change to existing booking journey | PASS — differential test: 14 existing-route probes answer byte-for-byte like the deployed bundle; the bundle diff is purely additive (every deployed line survives in order) |
| authentication fail-closed | PASS — none / wrong / master ADMIN / login-session token / truncated / extended / empty / unset secret ⇒ 401, no row data in body; 503 only after auth |
| minimum fields | PASS with one caveat below — exactly 20 fields; never guest_name, notes, payment_method, source_ip, attribution, distance, fx |
| secrets never logged | PASS — console captured across ok/denied/error paths: no token, email or phone |
| contract with the real Bula reader | PASS — `createNadiBookingReader` against the patched Worker: round trip, one-way, 404→null, wrong token rejected, repeated reads identical |

**Field caveat (CEO/Bula decision, not changed here):** the 20 fields match the released Bula reader/mirror (it stores `settlement_amount_fjd`, `commission_base_fjd`, `vehicle_type`, `assigned_driver_id`). Of these, `commission_base_fjd`, `settlement_amount_fjd` and `assigned_driver_id` are not needed for any guest-facing Bula feature. Dropping them needs a Bula mirror change (a new bundle), so the Bula release was left untouched. Recommendation: accept for launch (token-gated, server-to-server) and trim later.
**Other notes:** the response carries the platform's wildcard CORS header like every other route; the bearer token still gates it. The existing WAF/rate limit on `api.nadiairporttransfers.com` applies.

## Production impact if deployed
New path returns 401 to everyone until `SOURCE_READ_TOKEN` is set. Nothing else changes. Even after the secret exists, nothing reads it until Bula's source flags are turned on (they are OFF).

## Deployment target
Worker `nadi-dispatch-api` (production NAT). **Open issue:** the deploy needs the true source repo/branch (with rentals) and its wrangler config (D1, crons, secrets, routes), which are not in git. Do not upload the patched bundle with an ad-hoc binding list. Apply the same 27 lines at source level in the real source, then deploy it the way NAT is normally deployed.

## Rollback (explicit)
1. Immediate kill switch: `wrangler secret delete SOURCE_READ_TOKEN` ⇒ route returns 401 again; no redeploy. 
2. Full rollback: redeploy the previous Worker version (record its version id immediately before deploy; Cloudflare keeps prior versions — `wrangler rollback`). The previous artifact is identified by sha256 `04203dd3…9287` of the deployed bundle recorded here.
3. No schema change, no data change, so rolling back loses nothing.

## What was NOT done
No deploy, no secret set, no request to production NAT beyond the read-only code fetch and read-only schema/aggregate queries described in 02.
