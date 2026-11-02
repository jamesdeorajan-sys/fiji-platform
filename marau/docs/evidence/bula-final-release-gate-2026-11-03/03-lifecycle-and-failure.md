# 3–4. Lifecycle, failure/recovery, authorization, invariants

Evidence: `m4-scenarios.json` (24 recorded steps) produced by `bula/m4_release_gate.test.mjs` (10 tests, all pass). Synthetic NAT-shaped fixtures; real Worker/route code; in-memory D1; captured (never sent) emails.

## Invariant checker (runs after EVERY lifecycle step and every failure case; reads only the database)
- account buckets: available + reserved + redeemed + expired = granted; ledger `granted` sum = account granted; exactly ONE welcome grant per party
- credit tied up (reserved + redeemed) = credit of live (held/confirmed) requests
- per offer: remaining = capacity_total − live quantity; 0 ≤ remaining ≤ total
- no hold has two `reserved`/`released`/`redeemed`/`restored` ledger rows
- one link per source booking; guests, grants, jobs counted before/after every replay

## Lifecycle (decline path)
| Step | Source truth (NAT row) vs Bula/Marau derived |
|---|---|
| Transfer saved | SOURCE: booking 3001 (route, date/time, flight, price, status `pending`). DERIVED: 1 guest session, 1 link, 1 snapshot, 2 receipt jobs |
| Guest recognised / itinerary | trip shows source fields as-is; unavailable fields said to be unavailable; status mirrors source (`pending`) |
| Private access | guest token from the captured receipt link; wrong/none/revoked/other-guest refused |
| Welcome credit | DERIVED: FJ$500 once per party (`available 50000`) |
| Offer shown | one published offer card |
| Request | credit reserved once (−FJ$25.00 → 47500); capacity 8 → 7; same idempotency key replay creates nothing new |
| Staff | sees request in queue; claim attributed to `ana(ops)` |
| Decline | atomic: credit back to 50000, capacity back, audit `hold_declined` once; guest sees "Declined" + "credit returned" (proved from ledger) |
| Replay | repeated decline and a guest withdrawal after decline change nothing; exactly one `released` ledger row |

## Lifecycle (confirm path)
Confirm attributed to the acting staff member; second confirm leaves the database identical; confirming an activity never confirms the TRANSFER (stays source status); when the source later says `accepted` the trip shows Confirmed (source truth wins).

## Failure / recovery cases (all PASS; invariants hold; nothing duplicated or corrupted)
| Case | Result |
|---|---|
| Source down during sync / delayed recovery | booking+guest+grant+jobs not lost; no snapshot invented while down; after recovery + 3 sweeps: 1 guest, 1 link, 1 grant, 1 snapshot |
| Duplicate source record (3× created + 3× updated event) | no second guest/link/grant/job/snapshot |
| Repeated sweep (3× scheduled + 3× outbox run) | database state identical; exactly 2 captured messages (1 guest, 1 team) |
| Repeated guest request | same key → same request; second key can't exceed capacity/credit (checked by invariants) |
| Concurrent requests for last unit | exactly 1 live request; remaining 0; never oversold |
| Wrong / missing / revoked token, other guest's request | 401/403/404; state unchanged; guest B never sees A's requests |
| Unauthorised staff (no identity, bad token, approver role, guest token on staff route) | 4xx; state unchanged |
| Two staff, same request, simultaneous | claims → one 200, one 409; loser cannot confirm/decline; concurrent declines → both 200, one audit row, credit restored once |
| Repeated decline / withdrawal | restore once only |
| Capture/notification failure (fail ×1, ×2, ambiguous sent, ambiguous not sent) | booking unaffected; no recipient ever receives a duplicate; 1 guest, 1 grant |
| Missing OPTIONAL fields (flight, return) | accepted; unavailable shown; nothing invented |
| Missing REQUIRED fields (email, phone, quoted price) | refused whole (409 MISSING_*), nothing half-written |
| All Bula flags off | source sync writes no Bula job/grant/snapshot, cutover unset |

## Note found while testing (not a defect)
The existing mirror requires guest email, phone and a quoted price; a source booking lacking any of these is refused (fail-closed). If real NAT bookings can lack email, they will not appear in Bula — a launch-data question for James, listed in risks.
