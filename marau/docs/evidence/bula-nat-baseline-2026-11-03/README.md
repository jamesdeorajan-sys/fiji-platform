# NAT production baseline recovery + read-only source/discovery endpoints (2026-11-03) — NOTHING DEPLOYED

## Production baseline
- Source: ORIGINAL source, commit `99c1aef2805636883d6f0e40aed1df204d0a857b` (local-only branch `ceo/nat-rental-enquiries`), preserved in the PC release package `incident-2026-10-11/nat-rental-release-package-67d0075-99c1aef` (git bundle).
- Proof: `wrangler 4.156.2 deploy --dry-run` of that commit = sha256 `04203dd3599e9e5cdbdd5d4b8686a65e00b4ea9a983c4dafa3e70ed6a5a69287` = the byte-exact deployed Worker. Rebuilt again from the baseline branch (rollback proof): same hash (`nat/rollback-rebuild-sha.txt`). Unexplained differences: none.
- Rentals module (rental.mjs, rental_console.mjs, rental_enquiries tests) is in that source. Baseline offline suite: 150 tests / 149 pass / 0 fail / 1 pre-existing skip (`nat/baseline-offline-tests-at-99c1aef.txt`). `pricing.test.js` is a live-API test and is excluded (never run against production).
- Schema: repo schema+migrations vs production `bookings` (read-only PRAGMA): 44 of 46 columns identical. Production has two extra nullable columns, `idempotency_key` and `idempotency_fingerprint`, with no repo migration; the Worker never references them. Pre-existing drift, no effect; recommend a note in the NAT docs. (`nat/schema-compare.txt`)

## NAT patch (branch `ceo/nat-source-read-discovery`, commit in `nat/NAT_PATCH_COMMIT.txt`)
- +68 lines in worker.js, 0 removed (`nat/nat-source-discovery.diff`); patched bundle differs from production by 0 removed / 56 added bundle lines (`nat/bundle-baseline-vs-patched.diff`), sha256 `ae00bd7c…`.
- `GET /admin/bookings/:id` (20 whitelisted fields) and `GET /admin/bookings/recent?after=&limit=` (id, created_at, status only; limit 1–100, default 50; cursor = bookings.id; PRIMARY KEY range scan, no new index, no schema change).
- Auth: dedicated `SOURCE_READ_TOKEN` only; master ADMIN_TOKEN and admin login tokens refused; unset/empty secret fails closed; removing the secret is the kill switch. No writes, notifications, WhatsApp, email or pricing; no sensitive logging.
- Tests: `nat/source_read_discovery.test.mjs` 19/19 (incl. differential test vs the deployed bundle for 18 existing routes — status, body and database effect identical; stable over 60 runs). Full offline suite with patch: 169 tests / 168 pass / 0 fail / 1 pre-existing skip.

## Bula side (NEW UNRELEASED CANDIDATE — candidate `1343f866…` is unchanged and must get its own release gate)
- `bula/source_discovery.js`, migration `0048_bula_source_discovery.sql`, flag `BULA_SOURCE_DISCOVERY` (default OFF, also needs `BULA_SOURCE_SYNC`), cron hook in `bulaScheduled`, one-line `scheduled` change in worker.js.
- Bootstrap records the max id as a floor: history is not mirrored. Overlap 20 ids, 50/page, 4 pages/run. Watermark never passes a transiently failing booking (attempt cap 10 so one bad booking cannot block forever).
- Missing email/phone (and missing amount): counted, recorded in `bula_source_refusals` (reason + field NAMES only), shown in the staff queue ("Bookings needing staff attention"), health alert `SOURCE_BOOKING_REFUSED_NEEDS_STAFF`, staff "Mark handled" with audited note. No guest journey, no invented email, nothing sent.
- Source fidelity: `bula/source_fidelity.js` — SOURCE_CONFIRMED / SOURCE_MISSING / NOT_APPLICABLE stored in the snapshot provenance. No inference.
- Tests: `bula/m6_discovery.test.mjs` 17/17. Whole Marau suite: all pass except the Stage-1 evidence file `docs/evidence/bula-stage1-…/nat_source_read.test.mjs`, a superseded bundle-level test that needs `NAT_BUNDLE` set (not a regression).
