# 3. Bula production foundation — PROPOSAL ONLY (nothing provisioned)

## Resources (exact names proposed)
| Resource | Proposed | Notes |
|---|---|---|
| Worker | `vakaviti-bula-prod` | deployed from the hashed `1343f866…` bundle (worker.js `25071d2b…`) — unchanged. workers.dev only; **no routes, no custom domain, no crons** at first |
| D1 | `vakaviti-bula-prod-db` | empty; schema = bundle `schema.sql` (`6231f0ca…`) + `migration_0047.sql` (`2521546f…`). New, separate from NAT/FijiDash and from the acceptance D1 |
| Cron triggers | none until activation approval; then `*/15 * * * *` + `0 6 * * *` as in the acceptance config | with all flags OFF a cron would be inert, but keep it off anyway |
| Observability | Workers Logs on (`[observability] enabled = true`) | needed for the alert design in 06 |

## Variables (all OFF/unset by default)
`BULA_SYNTHETIC_TEST` (must be OFF/absent — see below), `BULA_CHECKOUT_ENABLED`, `BULA_CREDITS_ENABLED`, `BULA_EDITION_PUBLISH_ENABLED`, `BULA_OUTBOX_ENABLED`, `BULA_SOURCE_SYNC`, `BULA_EMAIL_CAPTURE`, `BULA_EMAIL_SEND_ENABLED`, `BULA_DEVICE_PAIRING` = **off**; `BULA_FAULT_HARNESS` **absent** (the acceptance harness must not exist in production). `BULA_POLICY_VERSION` = `prod-policy-1`; `BULA_GUEST_ORIGIN`, `BULA_STAFF_INBOX` (CEO address), `BULA_BUILD`/`BULA_COMMIT` = `1343f866…`.
**FJ$500 welcome policy:** the default `BULA_WELCOME_CENTS` is 50000 (FJ$500). Decisions needed: expiry (`BULA_CREDIT_TTL_MS` unset = never expires), who funds it (`funding_party` per offer), eligibility = one grant per booking party.
## Secrets (names only; values created by James in the dashboard, never in chat/repo)
`MARAU_ADMIN_TEST_TOKEN` (bootstrap admin credential — the variable name is historical; it is the only admin credential the Worker reads), `NADI_SOURCE_BASE_URL`, `NADI_SOURCE_ADMIN_TOKEN` (will hold the NAT `SOURCE_READ_TOKEN`, **not** NAT's master admin token), later `BULA_EMAIL_API_KEY`, `BULA_SUPPORT_WHATSAPP` (after verification).
**Staff identity:** after deploy, CEO bootstraps individual staff via `POST /preview/admin/bula/staff` (roles ceo/ops/approver). No shared staff logins.
**Production-vs-test switch to note:** with `BULA_SYNTHETIC_TEST` off, guest receipts are **blocked** until a verified support number is configured (`support_contact_unverified`). That is an intentional extra gate.

## Safe to provision while OFF (isolated; touches no customer/source system)
Create empty D1; apply schema; deploy Worker with flags off, no cron, no routes; set the admin secret; create CEO staff identity; verify `/version.json` shows commit 1343f866 and every guest/flag route inert. This ingests nothing, creates no wallets, sends nothing.
## Requires CEO approval
Creating anything at all (explicit GO), the welcome-credit expiry/funding policy, NAT `SOURCE_READ_TOKEN` creation, setting `NADI_SOURCE_*` on Bula, any flag change, cron enablement, the cutover call, email provider selection.
## Reminder
Bula does not yet have a trigger from NAT for new bookings (07). Provisioning does not depend on that.
