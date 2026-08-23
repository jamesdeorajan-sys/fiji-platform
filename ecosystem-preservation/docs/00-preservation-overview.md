# Vakaviti Ecosystem Preservation — 2026-08-23

Branch: `ceo/vakaviti-ecosystem-preservation` — documentation only. Not based on, and does not
modify, `ceo/vakaviti-marketplace-stage1` or any deployed application.

## What this branch contains

- `worker-manifest.json` — metadata for all 25 Workers (bindings by name, secrets by name only,
  Cron schedules, handlers, compatibility dates, deploy source, and a SHA-256 of the deployed
  bundle preserved privately outside git). No source code, no secret values, no personal data.
- `d1-manifest.json` — schema/table-name/aggregate-row-count summary for all 7 D1 databases, plus
  a SHA-256 of the full export preserved privately outside git. No row data.
- `vakaviti-kb-dependency-matrix.json` — table-level read/write matrix for the 15 Workers bound to
  the shared `vakaviti-kb` database, derived by inspecting the actual deployed bundle source.
  Contains table names, SQL verbs, and binding names only.
- `revenue-system-map.md`, `security-map.md`, `supply-reconciliation.md`,
  `git-ownership-proposal.md`, `recovery-procedures.md`, `secret-scan-summary.md` — analysis
  documents written from the evidence above.

## What is deliberately NOT in this branch

The repository `jamesdeorajan-sys/fiji-platform` is **public**. A secret/personal-data scan of
the 23 non-empty deployed Worker bundles found:

- A published business WhatsApp number (`+61 478 886 145`) repeated across 5 Workers — low
  sensitivity on its own (it is the number already advertised on live `wa.me` links), but still
  hardcoded rather than centrally configured.
- One genuine hardcoded credential-adjacent value: `nadi-dispatch-api` embeds an
  `ADMIN_LOGIN_PHONE` literal directly in its deployed source rather than as a secret binding — an
  admin-authentication-relevant phone number should never be a literal in code that could end up
  in a public repository. The number itself is deliberately **not reproduced anywhere in this
  branch**; see `secret-scan-summary.md` for the finding record.
- A one-off hardcoded row-ID deletion list in `vakaviti-kb-inspect` (maintenance script left live,
  not sensitive but not something that belongs in version control either).
- One garbled/truncated email-shaped string in `vakaviti-ingest-bl` that could not be confidently
  classified as safe from an automated scan alone.

Given the directive's own instruction — "Do not push if the repository is public and any
preserved source contains credentials, personal data or embedded secrets. In that case, return a
local manifest and report the secure-storage blocker" — **no raw Worker source and no D1 row
data is committed here.** Full bundles and full D1 exports were delivered to James directly and
privately in the working session (not through git). See `secret-scan-summary.md` for the complete,
per-Worker scan results and reasoning.

## Zero production change

Every action taken to build this branch was a `GET` request or a read-only D1
`SELECT`/`sqlite_master`/export call. No Worker was redeployed, no Pages project rebuilt, no DNS
record, route, binding, secret, Cron Trigger, Access policy, or D1 database was modified.
