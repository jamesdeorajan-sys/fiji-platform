# Git ownership proposal (proposed only — nothing applied, nothing merged, nothing deleted)

Repository: `jamesdeorajan-sys/fiji-platform` (public). The earlier ecosystem audit found 25
branches spanning at least two distinct agent lineages with overlapping/superseded work. This
document proposes a single authoritative mapping; it does not touch any branch.

| Application | Authoritative branch (proposed) | Cloudflare project | D1 database | Responsible executor | Overlapping branches to retire (proposed, not executed) |
|---|---|---|---|---|---|
| Vakaviti Marketplace (Stage 1) | `ceo/vakaviti-marketplace-stage1` | vakaviti-marketplace-stage1 | vakaviti-marketplace-stage1's own D1 | Current engagement / James | Any earlier `ceo/vakaviti-*` branch superseded by this lineage (identify by last-commit date vs. this branch's HEAD before retiring) |
| Ecosystem preservation & audit docs | `ceo/vakaviti-ecosystem-preservation` (this branch) | n/a (documentation only) | n/a | Current engagement / James | None — new, single-purpose branch |
| Nadi Airport Transfers dispatch | *unassigned — no Git source found for `nadi-dispatch-api` or `nadi-guest-widget-preview`* | nadi-dispatch-api, nadi-guest-widget-preview (Pages, no Git source) | nadi-marketplace-db | Unknown — needs direct confirmation from James | n/a |
| Concierge / Lagi chat | *unassigned — no Git source confirmed for `fiji-chat-widget`, `vakaviti-whatsapp` in this session* | fiji-chat-widget, vakaviti-whatsapp | vakaviti-kb, Vectorize | Unknown — needs direct confirmation from James | n/a |
| vakaviti-kb-bound utility fleet (15 Workers) | *unassigned* | vakaviti-onboard, vakaviti-reviews, vakaviti-leads, vakaviti-leads-v2, vakaviti-directory, vakaviti-events, vakaviti-config, vakaviti-dashboard-api, vakaviti-error-sentinel, vakaviti-reviews-scheduler, vakaviti-build-dashboard, vakaviti-zone-manager, seo-visibility-audit, fiji-drafting-console, fijitourtransfers-guides | vakaviti-kb | Unknown — needs direct confirmation from James | n/a |
| Come To Fiji ingestion | *unassigned* | come-to-fiji-link-checker, come-to-fiji-sync-fjt-trigger | come_to_fiji_db | Unknown — needs direct confirmation from James | n/a |

## Prohibited overlapping branches

Per the directive, this proposal does not merge, delete, or retarget any branch. The single
concrete action recommended before any cleanup is attempted: **confirm with James which of the
25 existing branches represent live, in-use work versus abandoned exploratory branches**, since a
majority of the account's 25 Workers currently have **no confirmed Git source at all** — meaning
most branch-cleanup risk in this repository is not "which branch is authoritative" but "most of
the deployed fleet isn't represented in this repository's branches in the first place."

## Recommended next step (not executed here)

A single follow-up, explicitly authorized phase to: (1) confirm actual source location (this repo,
a different repo, or dashboard-only/no-source) for every Worker listed as "unassigned" above, and
only then (2) propose a specific branch retirement list with last-commit evidence for each.
