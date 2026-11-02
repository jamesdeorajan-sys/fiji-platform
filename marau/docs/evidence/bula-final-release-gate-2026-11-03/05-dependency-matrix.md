# 7. Production dependency check (read-only; no secrets printed)

READY = proven in the isolated candidate; **nothing is READY in production because no production Bula deployment exists.**

| Dependency | Class | Evidence / gap |
|---|---|---|
| Source booking feed | **BLOCKER** | The read-only NAT endpoint `GET /admin/bookings/:id` exists only on isolated, undeployed branch `ceo/nadi-booking-read-itinerary` (7d268e5; "isolated, not deployed"). Production NAT cannot be read by Bula. The sync event feed that triggers the mirror to production Marau is also unverified. Logic itself is READY against synthetic fixtures |
| Guest identity | READY (isolated) | one guest/party per source ref; no phone/email lookup merging; tested |
| Private access tokens | READY (isolated) | token/device-key auth, revoke, isolation tested; production token secret/config not provisioned |
| Staff authentication | MISSING (production) | mechanism READY (individual staff identities + roles, attributed actions); no production staff roster/credentials created; shared admin credential bootstrap needs a production secret |
| Offer catalogue | MISSING | publish/import flow READY; no real operator offers, contracts or approvals exist; production would start empty |
| Wallet ledger | READY (isolated) | atomic, invariant-checked; welcome amount FJ$500 and policy/expiry (`expires_at` NULL = none) are CEO policy decisions not yet recorded for production |
| Capacity ledger | READY (isolated) | same; real operator capacity not loaded |
| Capture/notification jobs | READY (isolated) | idempotent, retry/ambiguous-safe; capture only |
| Email capture/sender mode | **BLOCKER** | there is NO live email sender in this code; the guest never receives the private link by email. Capture mode records would-be emails only. Without a delivery path the guest-facing flow cannot start in production |
| Production secrets/configuration | MISSING | `NADI_SOURCE_BASE_URL`, `NADI_SOURCE_ADMIN_TOKEN`, admin/staff secrets, `BULA_SUPPORT_WHATSAPP` + `BULA_SUPPORT_VERIFIED` (number must be verified by James), production policy version, guest origin — none set; no production Worker/D1/wrangler target |
| Monitoring/diagnostics | MISSING | per-hold audit, CEO source-sync state/captured routes and runner diagnostics exist; no alerting, error budget, or log sink for a production Worker |
| Rollback target | READY | 5ec3f91 bundle verified; flags-off lockdown; see 04 |
