# SESSION_HANDOFF.md — Vakaviti Ecosystem Canonical Handoff

Status: **CANONICAL — LIVING DOCUMENT.** This file is the single source of
truth for "where things stand right now." It supersedes conversation-level
phase reports as a handoff mechanism. Update this file, in place, at the
end of every future phase/session — do not create a new dated file for
routine updates. See `CHANGELOG.md` (same directory) for the append-only
history of what changed and when.

Last updated: 2026-08-24T00:00:00Z
Last updated by: Claude (Code), CEO Final Reconciliation session

## Mission

Audit, preserve, and incrementally upgrade the Vakaviti/Fiji ecosystem
(Cloudflare Workers/Pages/D1 + WordPress/WooCommerce + Vakaviti.ai content
network) without breaking anything live, while building a governed
"control plane" of facts so that Vakaviti's own AI/knowledge layer never
silently inherits an unverified or contradictory claim from a
partner/third-party surface. North Star metric (per
`ceo-war-room/00-CEO-CONTROL.md`): **profitable confirmed bookings per
week** — a booking *request* is explicitly not a confirmed booking.

## Current authoritative repositories and branches

Repo: `jamesdeorajan-sys/fiji-platform` (GitHub).

| Branch | Head (last known) | Role |
|---|---|---|
| `main` | `3474eaba70d018d5c70c137d15ff2a17f79c43ba` | Protected, unchanged throughout this entire engagement |
| `ceo/vakaviti-marketplace-stage1` | `c477cbbd64efb5f39c5abef9a5d83c2384729916` | Stage 1 marketplace build, protected, unchanged |
| `ceo/vakaviti-ecosystem-preservation` | `26d40c83a96ca039a91c51cc82b2e270eae0dff1` | Phase E1 preservation docs (security map, supply reconciliation, ownership proposal, recovery procedures) |
| `guest-widget-integration-preview` | `cc53ea682b52a4f85b6dfec23a892eff385d4ce1` | Confirmed source lineage for both `book.fijidash.com` (this commit) and `nadiairporttransfers.com` (earlier commit `9c2f581...` same branch) |
| `ceo/nadi-revenue-bridge-preview` | `26a763954f2ecd113d16f7ac874624d0f2218ec8` | `apps/nadi-guest-widget/` — the prepared, rehearsed Nadi rebrand + idempotency artifact E3E/E3F worked from |
| `ceo/war-room-control-plane` | `bc0daa7b00156a53203fee07e627f9c55d16892d` | **This control-plane document set.** Also contains `microsites/` (source for the 5 Vakaviti guide microsites) |

## Current deployed resources (Cloudflare account `595101df2c562b3c65595420d43f9fe1`)

- **`nadi-dispatch-api` Worker** — PRODUCTION, MODIFIED under E3F. Deployment
  `55b59828-c4d8-4ab6-b8da-fd50d519000b` / version `5349af64-2f3d-43ac-901e-975257cfa3fa`,
  live since 2026-08-23T14:14:34Z. Adds optional `Idempotency-Key` support
  and hardened custom-address pricing (reuses the guest's own prior
  `/quote` geocode; never a fresh client-trusted estimate). Secrets
  (`ADMIN_TOKEN`, `DOC_SIGNING_SECRET`, `GOOGLE_MAPS_API_KEY`,
  `WHATSAPP_PHONE_ID`, `WHATSAPP_TOKEN`) untouched throughout (inherited via
  Versions-API `keep_bindings`, never read or set by any agent).
- **`nadi-marketplace-db` D1** (`0ec1cd84-fcda-4f7f-8337-0fb70fe1a512`) —
  PRODUCTION, schema modified under E3F: added nullable
  `idempotency_key`/`idempotency_fingerprint` columns + partial unique
  index. Frozen there by CEO decision. As of the last observation tick: 16
  booking rows, zero using the new idempotency path, zero duplicates, FK
  clean. Two pre-migration backups exist, both SHA-256
  `219f714cb5e65e39addd1700b053783e7b643450fff404c1b62e8a02bb227f3d`.
- **`nadiairporttransfers` Pages project** (`0bc02785-f6e0-4734-b0dd-3833cab3fb4b`)
  — UNCHANGED throughout, including through the E3F stop. Canonical
  deployment `628491f5-...` (2026-05-05). A prepared-but-never-deployed
  Nadi-rebrand build exists locally only; never pushed to Cloudflare.
- **`nadi-guest-widget-preview-v2`** (`f99b2778-e1b6-4a98-83d9-49c2ef375952`)
  — the one authorized isolated Nadi rebrand preview, `PREVIEW_MODE=true`,
  service-bound to `nadi-dispatch-api-staging`. Live at
  `nadi-guest-widget-preview-v2.pages.dev`.
- **`nadi-dispatch-api-staging` Worker** + **`nadi-marketplace-staging-db-v2` D1**
  (`80df3178-ba61-4588-b4db-ee07d9618b2b`) — fully isolated rehearsal
  resources, synthetic/test data only, zero Cron, zero custom domain.
- **Untouched by this whole engagement**: `nadi-guest-widget-preview`
  (serves `book.fijidash.com`), `main`/`ceo/vakaviti-marketplace-stage1`
  branches, and every third-party site inspected (fijitourtransfers.com,
  nadiairporttransfers.com's *live* front end, cometofiji.com,
  natadolabayhorseriding.com, the 5 vakaviti.ai microsites' *live* hosting).

## Production freezes currently in effect

- **CEO PRODUCTION FREEZE (local/Git-only development)** — still in effect
  except for the two explicitly-authorized production actions inside E3F
  (the `nadi-dispatch-api` Worker redeploy and `nadi-marketplace-db` schema
  migration, both completed) and the still-not-executed Pages deployment
  (explicitly halted mid-E3F and NOT resumed).
- **E3F Recovery Decision freeze**: hold the current partial-deployment
  state, no rollback, no continuation of the halted Pages step, pending a
  24-hour read-only observation window.

## Current public counts (last verified)

- `nadi-marketplace-db.bookings`: 16 rows (1 completed / $76 settled, 15
  pending), 0 rows using the new `idempotency_key` path, 0 duplicates.
- `pricing_rules`: 15 rows. `zones`: 19 rows. All unchanged by E3F.

## Current workstreams

1. **E3F 24-hour observation window** — ACTIVE, running on its own hourly
   `ScheduleWakeup` independent of this document. Will resolve to either
   "E3F INCIDENT OBSERVED — WORKER ROLLBACK AUTHORIZATION REQUIRED" or "E3F
   PARTIAL DEPLOYMENT STABLE — PRODUCTION FREEZE CONTINUES."
2. **Revenue link graph / control plane** — this document set. Status:
   substantially complete for the domains inspected so far (see Completed
   phases); two new domains surfaced (tourfijitours.com, bulahappiness.com)
   remain uninspected.

## Completed phases (summary — see CHANGELOG.md for the itemized record)

E1 (preservation docs) → E2 (traffic/revenue/automation baseline) → P1.5A
(Cron supply reconciliation) → E3A (Nadi source recovery + design) → E3B
(Git-backed booking bridge, undeployed) → CEO Production Freeze → E3C
(isolated Nadi cloud preview) → E3D (isolated dispatch staging + durable
idempotency) → E3E (production rehearsal + rollout plan) → E3F (controlled
production deployment — Worker + D1 completed, Pages step halted by CEO
override) → E3F Recovery Decision (hold + 24h observe) → CEO Addendum
(revenue link registry v1) → CEO Review follow-up (identity correction,
truth quarantine, 5-microsite coverage) → **CEO Final Reconciliation
(this session: ComeToFiji + Natadola coverage, this handoff/changelog
pair)**.

## Active blockers

- E3F's halted Pages deployment step cannot resume until the 24-hour
  observation window closes AND a fresh CEO authorization is given — it is
  not auto-resumable.
- Identity questions across fijitourtransfers.com / tourfiji.tours /
  tourfijitours.com / natadolabayhorseriding.com / "Fiji Tourism Guide" are
  all `LEGAL_AND_COMMERCIAL_IDENTITY_UNRESOLVED` — blocks any Vakaviti
  import of facts from those domains.
- ComeToFiji's own commercial claims (repeating FTT's "zero commission")
  are quarantined (TRUTH-016) pending first-party evidence.
- tourfijitours.com and bulahappiness.com are newly discovered and
  uninspected.

## Commercial-truth quarantines (current)

TRUTH-001 through TRUTH-008 (original register) plus TRUTH-009 through
TRUTH-018 (added across the two most recent sessions) — see
`ceo-war-room/05-COMMERCIAL-TRUTH-REGISTER.md` for the full table. None of
TRUTH-009 through TRUTH-018 may be imported into Vakaviti until reconciled.

## Next approved action

Continue passive observation of the E3F window (no action required until
it resolves or an abort condition fires). No other production action is
currently authorized.

## Actions requiring CEO authorization (not yet given)

- Resuming/completing the halted E3F Pages deployment step.
- Any rollback of the `nadi-dispatch-api` Worker or `nadi-marketplace-db`
  schema.
- Inspecting tourfijitours.com and bulahappiness.com.
- Any first-party legal/ownership confirmation to resolve the
  `LEGAL_AND_COMMERCIAL_IDENTITY_UNRESOLVED` items.
- Any decision to build topic-relevant (vs. homepage-only) links from the
  5 microsites to Fiji Tour Transfers, or to add attribution parameters to
  any live link (design exists in `INTEGRATION_CONTRACT.md`, not
  implemented).

## Rollback locations

- `nadi-dispatch-api` prior version: `6f778c87-af82-4356-9fa1-e40eafcd1593`
  (source hash `0c21105745dcc01087e211c84cabf425403249541f497b21e8148bb72e381b8f`),
  live 2026-08-10 through 2026-08-23. Re-promote via the Versions API if a
  rollback is ever CEO-authorized — do not perform automatically.
- `nadi-marketplace-db` pre-migration state: recoverable from the two
  SHA-256-identical backups listed below (schema-only rollback would drop
  the two new nullable columns and the partial unique index — no row data
  loss since the columns are nullable and unused).

## Backup locations and hashes

- Two independent `nadi-marketplace-db` backups taken immediately
  pre-E3F-migration: `backup1_pre_e3f.sql` / `backup2_pre_e3f.sql`, both
  SHA-256 `219f714cb5e65e39addd1700b053783e7b643450fff404c1b62e8a02bb227f3d`.
- Two full ecosystem preservation ZIPs (Phase E1) delivered directly to and
  confirmed saved by James at
  `C:\Users\James\Desktop\Vakaviti Preservation Backups\` (outside any
  temporary session directory).

## Continuation procedure for Code/Codex

1. Read this file in full before taking any action.
2. Check `CHANGELOG.md` for anything more recent than this file's
   "Last updated" timestamp — if found, this file is stale; reconcile
   before proceeding, and say so explicitly rather than acting on stale
   state.
3. Check whether the E3F 24-hour observation window has resolved (look for
   its final report in the current conversation or ask James); do not
   assume it is still pending.
4. Treat every production freeze listed above as still active unless a
   message in the current conversation explicitly lifts it.
5. Before any Cloudflare mutation, re-verify the target resource's current
   deployment/version ID against this file — do not trust a cached ID from
   an old conversation summary.
6. On completing any phase, update this file's relevant sections in place
   AND append a row to `CHANGELOG.md` — both, not one or the other.
7. Dated snapshot files (`docs/SESSION-HANDOFF-2026-05-29.md`,
   `docs/SESSION-HANDOFF-2026-06-02.md`) are historical pointers only — do
   not update them; do not treat them as current state.

---
**Last-updated timestamp: 2026-08-24T00:00:00Z**
