# 6. Minimal production monitoring (prepared, not wired)

Design: no new service. (1) `bula/health.js` — read-only invariant/failure queries returning codes and counts only; (2) run from the existing cron after approval, writing one `[bula][ALERT] {code,count}` line per alert to **Workers Logs**; (3) one **Cloudflare Notification / log alert** to the CEO email on `[bula][ALERT]` and on Worker error rate. No guest data, no customer-facing action, no new secrets.

| Signal | Detection | Status |
|---|---|---|
| source fetch failure | existing log `[bula] source-sync adapter failed` / `partial failure`; `SOURCE_ROWS_WITHOUT_SNAPSHOT` alert | **Partly ready** — needs log alert rule |
| mirror failure | mirror refusals (409 `MISSING_*`) and 5xx are returned to the caller and **not logged** | **MISSING** — needs a log line in the sync entry (code change, with the trigger in 07) |
| guest-link creation failure | `MIRROR_WITHOUT_GUEST_SESSION`, `MIRROR_WITHOUT_JOBS_OR_GRANT` | Ready (code) |
| email send failure | `EMAIL_FAILED_OR_DEAD`, `EMAIL_AMBIGUOUS_NEEDS_HUMAN`, `EMAIL_BLOCKED`, `EMAIL_BOUNCED`, `EMAIL_STUCK_QUEUED` + `[bula][email]` | Ready (code) |
| wallet invariant failure | `WALLET_BUCKETS_DONT_ADD_UP`, `WALLET_GRANT_LEDGER_MISMATCH`, `WALLET_RESERVED_NOT_LIVE_REQUESTS`, `WALLET_DUPLICATE_GRANT` | Ready (code) |
| capacity invariant failure | `CAPACITY_MISMATCH`, `CAPACITY_OUT_OF_BOUNDS` | Ready (code) |
| staff-action conflict | 409 `claimed_by_other` has no DB trace; watch 409 rate on `/preview/admin/bula/holds/*` in Workers analytics | Partly ready (alert rule) |
| repeated/duplicate processing | `DUPLICATE_LINKS_FOR_SOURCE_REF`, `DUPLICATE_LEDGER_ROW_PER_HOLD` (should be impossible; non-zero = constraint bypassed) | Ready (code) |
| Worker exceptions | existing `[bula] route error`; Cloudflare error-rate notification | Partly ready (alert rule) |

Tests: clean after a full lifecycle; each wallet/capacity/snapshot/job alert is raised when the data is corrupted on purpose. **Missing before activation:** applying the wiring (new gate), creating the Cloudflare Notification rules (James, dashboard), the mirror-failure log line, and a named alert recipient.
