# CEO approvals record — 2026-11-03

## Bula application candidate status
| Commit | Status |
|---|---|
| `26fd18a2` | FAILED / SUPERSEDED (gate found genuine defects) |
| `a38e7d71…` | CURRENT BULA APPLICATION CANDIDATE (deployable) |
| `2baac215…` | DOCS / EVIDENCE HEAD (not the deployable candidate) |
| `1343f866…` | Previous known-good application / rollback-compatible reference (preserved) |

## Private NAT source control
- Repository: https://github.com/jamesdeorajan-sys/nat-production-source — PRIVATE, no forks, no Pages.
- Tags (created via GitHub releases; lightweight tags, flagged pre-release): `nat-prod-baseline-04203dd3` -> `99c1aef2805636883d6f0e40aed1df204d0a857b`; `nat-source-discovery-candidate-ae00bd7c` -> `951ef462dc91eb156ade461846480a45a8081127`.
- Independent recovery (fresh clone from the remote, 248 commits): baseline rebuild (wrangler 4.156.2 deploy --dry-run) sha256 `04203dd3599e9e5cdbdd5d4b8686a65e00b4ea9a983c4dafa3e70ed6a5a69287`; candidate `ae00bd7c238aafc763aabca7fecc8307e3ce8103df66b9e21932a08444ecc788`. Both match.
- Live nadi-dispatch-api re-fetched read-only: sha256 `04203dd3…` (== baseline, production not moved).
- Tests from the remote clone: source_read_discovery 19/19 (incl. differential vs baseline and real Bula reader), rental_enquiries 34/34, notification_fencing 7/7. pricing.test.js needs live network (fails identically on baseline in the sandbox; not applicable).
- `main` protection: not available (GitHub returns 403 "Upgrade to GitHub Pro" for private repos on this plan).
- NAT deployment: NOT executed from this session (no wrangler credentials / Cloudflare write access). Production unchanged.
