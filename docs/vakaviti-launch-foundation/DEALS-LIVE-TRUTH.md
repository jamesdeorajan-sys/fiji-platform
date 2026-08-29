# /deals Live Truth — Read-Only Reconciliation

**Method:** every fact below was obtained by a live, read-only check against the real production
Worker (`https://vakaviti-marketplace-stage1.helpronline.workers.dev`) and the real production D1
database (`vakaviti-marketplace-stage1-db`), on 2026-08-30, during Phase 8 of the agent-preview
observation window. No write, no migration, no deploy was performed to produce this document.

## Verdict up front

**`/deals` is technically healthy.** It returns `200`, not `500`. Migration `0010_deal_public_hub.sql`
is **fully applied** — every table and column it creates exists in production today. The only real
gap is **content**, not infrastructure: zero deals are currently published, so a visitor sees the
hub's built-in empty state rather than any deal cards. This is a launch-readiness/content gap
(already tracked as a lower-severity item), not a technical defect.

## Exact findings

| Question | Answer | Evidence |
|---|---|---|
| HTTP status of `/deals` | **200** | `curl -o /dev/null -w "%{http_code}"` against the live route |
| Response body | Renders normally — title "Live Fiji Deals & Special Offers \| Vakaviti", `noindex,follow`, canonical tag present | Direct fetch of the response body |
| Does `deal_analytics_events` exist? | **Yes** | `SELECT name FROM sqlite_master WHERE type='table' AND name='deal_analytics_events'` returned a row |
| Migration 0010 applied? | **Fully applied.** All 3 things it creates are present: the `slug` column on `deal_offer_candidates` (confirmed via `PRAGMA table_info`), the `deal_analytics_events` table, and the `deal_enquiries` table | Direct schema introspection, see below |
| Is the route empty-but-working, or 500? | **Empty-but-working.** 0 published candidates → the hub renders its own designed empty state ("No live deals right now... New deals are added as they clear that review.") | Live response body + D1 count |
| Does any code query a missing table/column? | **No.** Every `deal_*` table referenced anywhere in `src/deals.ts`, `src/deals-hub.ts`, `src/deals-admin-ui.ts`, `src/deal-agent.ts` was checked against `sqlite_master` and confirmed to exist: `deal_sources`, `deal_offer_candidates`, `deal_analytics_events`, `deal_enquiries`, `deal_approvals`, `deal_change_events`, `deal_scan_runs`, `deal_source_scans` | `SELECT name FROM sqlite_master WHERE type='table' AND name IN (...)` — all 8 present |

## Exact counts (read-only, at time of check)

| Table | Count |
|---|---|
| `deal_sources` | 10 |
| `deal_offer_candidates` (total) | 7 |
| `deal_offer_candidates` with `review_status='PUBLISHED'` | **0** |
| `deal_analytics_events` | 149 |
| `deal_enquiries` | 0 |

149 analytics events already exist against zero published deals — these are hub-view/impression-type
events from prior testing and review traffic, not evidence of real traveller engagement with actual
deal content.

## Schema verification detail

```
PRAGMA table_info(deal_offer_candidates) → confirms `slug` column present (migration 0010, line 9)
SELECT name FROM sqlite_master WHERE type='table' AND name='deal_analytics_events' → present (migration 0010, lines 16-28)
SELECT name FROM sqlite_master WHERE type='table' AND name='deal_enquiries' → present (migration 0010, lines 36-44)
```

No partial-migration state was found. There is no evidence anywhere in this check of a prior 500 —
if one was observed at some point, it was not reproducible at the time of this reconciliation and
is not explained by any missing schema element found here.

## Recommendation

Since `/deals` is not broken, neither remedy the CEO's directive proposed is technically required:

- **Option A (hide/remove public navigation to `/deals`)** — not required for technical safety, but
  may still be the right *content* decision: launching with a "Live Fiji Deals" nav link that leads
  to an empty page is a weak first impression. This is a judgment call, not a defect fix.
- **Option B (separately authorize/validate migration 0010)** — **not applicable**. The migration is
  already fully applied; there is nothing to authorize or validate.

## CEO DECISION 2026-08-30 (decision 4, `CEO-DECISIONS-2026-08-30.md`)

**`/deals` stays out of primary public navigation** until at least **three** genuine offers are
simultaneously current, evidenced, human-reviewed, provider-approved where required,
`review_status='PUBLISHED'`, and carrying visible validity/expiry information on the card. The route
itself remains directly reachable (already true today, no gating needed) for QA purposes only.

**Current state against that bar:** 0 of 7 candidates are `PUBLISHED` — the bar is not met, so no
navigation change is due yet, and none is authorized right now regardless. The next action, if any,
is progressing candidates through the existing human-review process (a content decision), not a
code or navigation change.
