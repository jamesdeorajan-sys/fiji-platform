# Bula Stage 1 — production foundation (2026-11-03). Everything OFF. Nothing deployed, provisioned, sent or ingested.

Release candidate (unchanged): `1343f866bac354ec2c90509fdc490391c6729a27`; gate evidence commit `88a0fc75…`.
Index: 01 NAT endpoint · 02 source contract · 03 production foundation · 04 email · 05 WhatsApp · 06 monitoring · 07 gaps/decisions · nat/ (diff, tests, hashes) · wiring/ (UNAPPLIED patch).

## Release integrity proof
- New code is two unimported modules (`bula/email_provider.js`, `bula/health.js`) and tests/docs. `esbuild worker/worker.js --bundle` of the tree at `1343f866` and of this commit gives the identical hash (`b4fb7fa0…`), i.e. the Worker's input graph is unchanged. The hashed release bundle `bula-1343f86` still verifies against its manifest (worker.js `25071d2b…`).
- Rollback baseline `5ec3f91…` bundle re-verified; identical schema; no migration added.
- Production NAT/FijiDash: only read-only operations were performed — fetch of the deployed Worker code via the Cloudflare connector, `sqlite_master` DDL, and aggregate COUNT queries (no guest rows read, `changed_db: false`).
