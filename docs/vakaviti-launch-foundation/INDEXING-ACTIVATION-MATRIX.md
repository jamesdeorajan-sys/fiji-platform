# Indexing Activation Matrix

## Current live state (verified by direct code read, 2026-08-30)

`html()`'s own default in `src/index.ts` is: `noindex,follow` unless a route explicitly passes
`noindex: false`. **A full grep of the codebase found zero routes that pass `noindex: false`.**
Every single public page today — homepage, `/operators`, `/experiences`, every operator/product
detail page, `/about`, `/partners`, `/contact`, `/privacy`, `/terms`, the 404 page — is currently
`noindex,follow`. This is a clean, safe, fully-non-indexed starting state; there is nothing to walk
back before designing the first activation.

`src/deals-hub.ts` uses its own separate `shell()` with a hardcoded `noindex,follow` on every route
(`/deals`, `/deals/category/:cat`, `/deals/:slug`) — same effective state, different code path.

## Recommended target state, by route

| Route | Recommended | Why |
|---|---|---|
| `/` (homepage) | `index,follow` | The front door — should be indexed once content quality gates below are met |
| `/operators` | `index,follow` | Core directory value |
| `/operators/:slug` | `index,follow` (only once ≥1 real product exists and content is accurate) | Individual operator pages are the actual long-tail SEO value; an empty operator page (InterContinental, South Sea Cruises today — 0 products each) indexed early looks thin/low-value to search engines and to a visitor who lands on it |
| `/experiences` | `index,follow` | Core directory value |
| `/experiences/:slug` | `index,follow` | Long-tail SEO value per experience |
| `/about`, `/contact` | `index,follow` | Legitimate, evergreen, low-risk pages |
| `/partners` | `index,follow` | Wants to be found by prospective operators |
| `/privacy`, `/terms` | `noindex,follow` **until the real drafts (see `PRIVACY-POLICY-DRAFT.md` / `TERMS-OF-SERVICE-DRAFT.md`) are legally reviewed and published** | Indexing a page that says "this is a preview... will be published before public launch" is actively harmful — it invites scrutiny of exactly the gap that hasn't been closed yet |
| `/deals`, `/deals/category/:cat` | `noindex,follow` until ≥1 deal is published (see `DEALS-LIVE-TRUTH.md`) | Indexing a directory-style page with zero content is a poor result for any visitor arriving from search |
| `/deals/:slug` | `index,follow` once that specific deal is published | Standard per-item indexing once real |
| `/claim/:slug` | `noindex,follow` | Utility page, not content — no SEO value, keep it out of search results |
| `/enquire/*`, `/api/*` | `noindex,nofollow` | Functional/transactional paths, never meant to be search results |
| `/admin/*` | **excluded entirely** — already gated behind `requireAdminSession`/admin auth, and should additionally be blocked in `robots.txt` as defense-in-depth | Never index admin surfaces, regardless of auth |
| `/explore` (Deal Exchange) | `noindex,nofollow` (unchanged) | Feature is deliberately disabled (`DEAL_EXCHANGE_PUBLIC_ENABLED=false`) — indexing a 503 page has no value and could look broken in search results |
| 404 page | `noindex,follow` (unchanged) | Standard practice |

## Prerequisites before removing `noindex` from any route (all must be true, not a pick-list)

1. **Real Privacy Policy and Terms published** (not the operational drafts in this doc set) — see
   `LEGAL-FACTS-REQUIRED.md`. Indexing a marketplace without real legal pages first is a real-world
   trust and compliance risk, independent of anything technical.
2. **Correct canonical URLs** — every page must use the final chosen hostname (see
   `BRANDED-DOMAIN-DECISION.md`) in its `<link rel="canonical">` tag, not the `workers.dev` URL or a
   half-migrated mix of both. `src/index.ts`'s `SITE_ORIGIN` constant currently hardcodes the
   `workers.dev` URL — this is a one-line change once the domain decision is made, but it must
   happen *before* indexing, not after (a mid-flight canonical-URL change while indexed can hurt
   rankings).
3. **A sitemap.** None exists today (confirmed: no `sitemap.xml` route or static file found in the
   codebase). Needs to be built listing every route that's being flipped to `index,follow`.
4. **A `robots.txt`.** None exists today (confirmed: no matching route or static file found). Needs
   to explicitly disallow `/admin/`, `/api/`, `/enquire/`, and reference the sitemap.
5. **Functional public routes.** Already true today for the core directory routes (`/`,
   `/operators`, `/experiences`) — verified live and via the 128-check cross-browser matrix run
   during the media-completion QA pass.
6. **Sufficient honest supply.** Indexing `/operators/:slug` for an operator with 0 products (2 of
   the current 4) produces a thin, low-value page a search engine may penalize and a visitor will
   find unconvincing. Recommend gating per-operator indexing on that operator having ≥1 real
   product, rather than flipping the whole `/operators/:slug` route on for every operator uniformly.
7. **No placeholder/test content.** Confirmed clean today at the code level (no lorem-ipsum, no
   obviously-fake operator names found in production data) — re-verify at the moment of activation,
   since data changes over time.
8. **Monitoring and rollback readiness.** See `LAUNCH-GATE-CHECKLIST.md` — indexing is much harder to
   meaningfully "undo" than a code rollback (search engines cache and re-crawl on their own schedule,
   not yours), so this gate should be treated as closer to a one-way door than any other launch step
   and only crossed once the operational basics (monitoring, a tested rollback path) are in place.

## What this document does NOT do

No `robots` meta value, `robots.txt`, sitemap, DNS record, or route was changed to produce this
document. This is a target-state design only.
