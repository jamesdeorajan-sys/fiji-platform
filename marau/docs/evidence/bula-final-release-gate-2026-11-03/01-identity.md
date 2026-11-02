# 1. Candidate identity (fail-closed check) — PASS, all identities = 1343f866bac354ec2c90509fdc490391c6729a27

| Item | Value | Match |
|---|---|---|
| Local git HEAD | `1343f866bac354ec2c90509fdc490391c6729a27` | yes |
| Remote `origin/ceo/bula-happiness-isolated-r0` (`git ls-remote`) | `1343f866bac354ec2c90509fdc490391c6729a27` | yes |
| Working tree | clean (`git status --short` empty) before this gate's evidence/test files were added | yes |
| Bundle `BUNDLE.json` commit (`bula-1343f86`) | `1343f866…` | yes |
| Bundle file hashes vs manifest | worker.js `25071d2b…64cb`, schema.sql `6231f0ca…4c31e`, wrangler.json `6303793a…eaa96`, hosted_acceptance.mjs `83394fc7…10a7`, run_acceptance.mjs `29d55f54…710b`, migration_0047.sql `2521546f…35240` — recomputed, all equal | yes |
| PC copy `Downloads\bula-acceptance-1343f86\` | hash-verified when copied (earlier turn) | yes |
| Hosted deployed commit (`hosted/state.json`, from the PC) | `1343f866…`, deployed 2026-11-01T15:31:42Z, URL `marau-bula-acceptance.helpronline.workers.dev` | yes |
| Hosted base evidence commit | `1343f866…` (31 checks) | yes |
| Hosted source-mode evidence commit | `1343f866…` (29 checks, mode `source`) | yes |

**Limits of what was verified here:** this sandbox cannot reach `workers.dev` or the Cloudflare API (allowlist), and the Cloudflare connector is read-only and returns only names/ids/modified time. The hosted identity is therefore taken from the PC's own evidence files written by the runner (the runner reads `/version.json` from the Worker itself). `marau-bula-acceptance` last modified 2026-11-01T15:31:41Z (connector), consistent with that deploy.

**Release-affecting changes:** none. This gate adds only a tests file (`bula/m4_release_gate.test.mjs`) and this evidence directory in a descendant commit; the worker bundle/hashes are unchanged.
