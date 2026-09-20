# Bounded revenue diagnosis — evidence bundle (2026-09-21)

Read-only. No production change, no live submission. **Contains no customer names, phones, emails or booking references (only the marked-test booking numbers #143/#144)** (aggregates only; the per-booking worksheet is held privately by James). Extraction 2026-09-20 ~13:00–14:20 UTC. Author: Claude. Status of every number: **AUTHOR-VERIFIED** until Codex reproduces it.

Files: `sql/README_queries.sql` (exact predicates/queries) · `data/*.csv|json` (counts only) · `pricing_repro/` (Worker excerpts, non-PII inputs, `recompute.py`, `cells.csv`).

## 1. Definitions and limits
| Term | Definition |
|---|---|
| Saved request | Row in `nadi-marketplace-db.bookings` (server accepted the POST). Not a confirmed booking. |
| Test exclusion | Name/phone rules in `sql/README_queries.sql` (`CLAUDE*`, `JAMES DER*/DEO*`, James's test phone). Unknown internal tests may remain. |
| Duplicate rule | same phone + zone + vehicle ≤ 15 min; later row dropped in `*_dedup` series (4 pairs; none shared a ref). |
| Site (from `client_booking_ref`) | `FTT-` = on-site nadiairporttransfers.com widget (first row **2026-09-07 12:19:48 UTC**); `FD-` = FijiDash (first 2026-09-02 03:42:47 UTC); no-ref = 38 rows 2026-07-24→2026-09-02. Prefix is **not** origin: Nadi route pages hand off to FijiDash, so `FD-` rows with a Nadi referrer/campaign (8 in Sept) are Nadi-origin. |
| Timezone | `created_at` is UTC. Fiji day = UTC+12 (no DST). Both bases reported where they differ. |
| Partial day | Extraction was 2026-09-20 13:00 UTC = 01:00 21 Sep Fiji; last saved row 04:27:57 UTC. **Fiji-day 20 Sep is complete; UTC-day 20 Sep is partial (13 of 24 h).** Windows below use Fiji days 8–20 Sep, so no partial day. |
| Traffic | Cloudflare GraphQL: zone `httpRequests1dGroups` (all traffic incl. bots) and account `rumPageloadEventsAdaptiveGroups` (real-browser beacon page loads, **sampled**, counts in multiples of 10, ±). Tester sessions (James/Codex/Claude browsers, desktop) inflate Sep 13–20 desktop counts and cannot be removed. |
| BookFijiTransfers | **UNKNOWN for every stage.** Hosted on ChatGPT Sites (Issue #39); not in this DB, not in this Cloudflare account's analytics. |

## 2. Funnel by site (Fiji/UTC per column header; `data/funnel_daily_utc_by_site.csv`)
| Stage | NadiAirportTransfers (on-site) | FijiDash | BookFijiTransfers |
|---|---|---|---|
| Visits | RUM page loads (sampled) + zone uniques (bot-inclusive) — available | RUM page loads (sampled) — available | UNKNOWN |
| Booking starts | **UNKNOWN** (no client instrumentation; `funnel_events` has 2 `nadi` rows, 2026-09-09) | `booking_page_view` sessions — 224 (11–20 Sep) | UNKNOWN |
| Save attempts | **UNKNOWN** (client failures: 0 `FTT-` escalations) | `booking_post_started` sessions — 30 | UNKNOWN |
| Saved requests | 46 (Sept, non-test) | 36 | UNKNOWN |
| Operator receipt | provider accepted (WhatsApp 200 + WAMID): **71/71** since 2026-09-06 15:36 UTC, 2–6 s (avg 3.2 s); **delivery/read by staff UNKNOWN** | same rule (included in the 71) | UNKNOWN |
| Staff ownership / guest confirmation / completed-cancelled | **UNKNOWN** (`status`/`assigned_driver_id` not used; no `human_confirmed` column in production) | UNKNOWN | UNKNOWN |

FijiDash funnel sessions 11–20 Sep: page view 224 → route selected 114 → vehicle selected 119 → details opened 46 → confirm clicked 32 → post started 30 → post succeeded 30; `booking_post_failed` 2 sessions (both later succeeded). 36 of the 224 sessions had a `nadiairporttransfers.com` referrer. Test sessions are included and cannot be separated.

## 3. The reported fall — exact windows
Fiji days; complete days only; non-test on-site `FTT-` saved requests (`data/nadi_fijidash_saved_requests_daily_fiji.csv`, `data/decline_tests.json`):
`8:5 9:9 10:6 11:1 12:2 13:4 14:5 15:4 16:2 17:0 18:5 19:3 20:0`

| Comparison | raw | de-duplicated | exact two-sided p (conditional binomial) |
|---|---|---|---|
| 8–10 Sep (3 d) vs 11–20 Sep (10 d) | 20 → 26 (6.67 → 2.60/day) | 18 → 25 (6.0 → 2.5/day) | 0.002 / 0.006 (UTC-day basis 0.003 / 0.009) |
| 8–14 Sep (7 d) vs 15–20 Sep (6 d) | 32 → 14 (4.6 → 2.3/day) | 29 → 14 | 0.038 / 0.092 |
| Nadi-origin incl. FijiDash handoffs, 8–10 vs 11–20 | 18 → 33 (6.0 → 3.3/day) | — | 0.046 |

Reading: the fall on the on-site widget is statistically detectable but rests on a 3-day launch window whose peak (9 on 9 Sep) may be launch novelty/regression to the mean; the two-week split is marginal after de-duplication; counting FijiDash handoffs roughly halves the drop. **Baseline limitation:** `FTT-` rows do not exist before 2026-09-07, so no pre-launch per-site baseline is testable here and the earlier "10+/day" cannot be confirmed or refuted from this DB (max non-test all-site Fiji day = 10). Earlier on-site requests were WhatsApp-only (code inference from the site README, not a runtime observation). Window-composition caveat: weekdays differ (8 Sep = Tuesday).

**Visits did not fall** (`data/cloudflare_*`): real-browser homepage loads/day 33.7 (20 Aug–7 Sep) → 33.3 (8–10) → 38.0 (11–20); Google-referred loads 6.8 → 11.0/day; zone uniques 298 → 323 → 312/day (bot-inclusive). Mobile homepage loads fell 25.8 → 20.0 → 18.0/day (−30%) while desktop rose 7.9 → 13.3 → 20.0/day (testers included). Saved on-site requests per homepage real-browser load (**a proxy, not a conversion rate**): **17% (8–10 Sep, 17/100) → 6.3% (11–20 Sep, 24/380)** — sampled denominators (RUM multiples of 10), small n. Numerator: non-test, de-duplicated `FTT-` saves by **UTC** day; denominator: RUM homepage loads by UTC date; the two are not the same population (saves are not device-split, saves can come from earlier visits). Five variants of numerator/denominator/filters in `data/proxy_ratio_reconciliation.csv` give 6.3–8.0% (window B) vs 17% (window A) except when the denominator widens to all pages (4.7%) or narrows to mobile (13.3%, upper bound).

**Organic demand (GSC, supplied by Codex):** Aug 13–31: 139 clicks / 4,154 impressions; Sep 1–19: 167 clicks / 4,046 impressions → clicks +20.1%, impressions −2.6%. Page tables use different windows (Aug 13–31 vs Sep 1–20) and must not be mixed with these totals. Search demand did not fall, which weakens a top-of-funnel-loss explanation.

## 4. Defect → impact matrix
| Defect | Confirmed? | Evidence of impact | Proven cause of lost bookings? |
|---|---|---|---|
| Unknown `/transfer/*` and legacy Outrigger alias serve the homepage with 200; its relative `styles.css`/`app.js` then resolve under `/transfer/` and get HTML | **Yes** (25/25 route pages fine; alias/unknown = fallback; preview fix verified) | Cloudflare path counts 13–20 Sep (all traffic; **exposure — requests, not unique guests, not lost bookings**): alias **245** requests (2nd most-requested transfer path, 51 mobile), plus `/transfer/app.js` 45, `/transfer/chat-widget.js` 43, `/transfer/styles.css` 25 = symptoms of broken-rendered fallback pages. Bing Copilot: 20 citations to the alias. `first_landing_path` is NULL on all 46 `FTT-` rows, so bookings cannot be tied to it. | **No** — exposure is real, attributable lost bookings unproven |
| Route landing pages absent from production: `/transfer/*` were real 2026-05-03→07 and 2026-06-06 13:15–13:33, then **homepage fallback 2026-06-06 13:33 → 2026-09-11 06:45 (97 days)**, real 11–13 Sep, **blank (0 B) 2026-09-13 08:25 → 2026-09-16 07:35 (~71 h)**, real since (`data/nadi_pages_production_deployments_timeline.csv`) | **Yes per deployments** (pinned deployment URLs) | Route-page real-browser loads (mobile) 4.7/day → 2.0/day; Google-referred loads did not fall | **Unproven.** Contradiction to resolve: Copilot cited these URLs from 2026-06-17 and the alias returned a real 10,057 B page on 2026-09-17, yet no project deployment in that period contains them — what served them on the custom domain is **unresolved** |
| Stored price ≠ shown price (Worker `[pricing-drift]` overwrite) | **Yes** (reproduced from deployed code + live D1; `pricing_repro/`) | 6 of 105 one-way cells (`cells.csv`). **No overwritten amount observed among 46 saved on-site requests** (42 match the client-expected fare only; 0 match the server formula only; 4 match neither and are not consistent with an overwrite — unexplained, see `data/ftt_amount_reconciliation_counts_only.csv`). Integer vs non-integer alone is not treated as evidence. The sample **excludes abandonment**: a guest who saw a different price and left is invisible here. `[pricing-drift]` console logs were never persisted (Worker observability/logpush/tail all off), so historical drift events cannot be counted. #143 was a marked test. | **Unproven / not excluded.** Saved-request evidence shows no overwrite; it cannot say whether pricing mismatch caused abandonment. Money/dispute risk remains a confirmed defect |
| Notification failure/recovery | Partly: no durable retry table (PR #55 undeployed) | **71/71** post-pipeline saved requests have an `admin_notification_sent` event (WAMID, 2–6 s); 1 failure ever (2026-09-06 15:13 UTC, template parameter error, fixed same day); 0 failures since. **Gap:** 8 saved requests (6 with pickups 24 Sep–21 Dec) predate the pipeline and were **never alerted**; staff reading/acting UNKNOWN. Correction to my 20 Sep handover: outcomes ARE logged in `booking_events` (sent/failed/skipped), I wrongly implied no record. | **No** on this evidence (100% provider acceptance) |
| Uncertain save / retry | Partly | FijiDash: 2 client-reported POST failures in 30 attempted sessions; both recovered by same-ref retry → 1 row, 1 alert (idempotency worked; one case: row+alert written within 6 s, client reported failure ~26 s after the confirm click — cause unknown). On-site: 0 failure escalations; 3 `FTT-` duplicate pairs (Fiji days 9, 10 and 13 Sep), none since | **No** (≤ 3 of 46 rows affected; none since 14 Sep) |
| Mobile booking friction | **UNKNOWN** | Mobile is 67–77% of loads early, 38% now (testers). No device on bookings or funnel events. FijiDash funnel biggest drops: page view → route selected 49% lost, vehicle → details 61% lost (device unknown). Vehicle-step deadlock fixed 2026-09-17 08:34 UTC; 18–20 Sep on-site saves 5/3/0 (n too small) | **Unproven** |

## 5. Pricing reproduction (for Codex)
`pricing_repro/recompute.py` reads only `inputs/*.json` and reproduces: zone `Nadi`, cached 6.844 km, sedan band 0–15 km `5.57 + 3.592×6.844 = 30.15`; client 15 < 0.8×30.15 → replaced. Replaced cells: Nadi Town sedan 19→30.15; Tanoa/Tokatoka sedan 15→30.15, minivan 25→46.42, minibus 45→71.46; Mercure/Tradewinds sedan 19→30.15; Momi minibus 71→157.92. `worker_excerpts.js` = verbatim bundle ranges of deployed `nadi-dispatch-api` `80de8469…` (2026-09-06). Not modelled: return, night, extras, custom addresses, FijiDash's client. No pricing change is proposed; Momi minibus fare remains HOLD.

## 6. Upcoming pickups (counts only; `data/pickups_by_date_and_site_counts_only.csv`)
Saved non-test requests with pickup ≥ 21 Sep (Fiji): **40** (9 with pickup 21–24 Sep); 16 more with pickups 18–20 Sep (outcome unknown). **6 upcoming requests predate the alert pipeline** (earliest pickup 24 Sep 07:30) — highest-priority manual check. The per-booking reconciliation worksheet (IDs/refs, blank ops columns) is held privately by James.

## 7. Preview-only repair (branch `ceo/nadi-outrigger-softfix-preview`, commit `9ddd923`, base `31a27fb`)
`_redirects` (alias → `/transfer/coral-coast-outrigger` 301; `/transfer`, `/transfer/` → `/`), `404.html` (noindex), 5 static tests (76/76). Preview deployment `77ef3ba6` (alias `ceo-outrigger-softfix-previe.fttlandingpage.pages.dev`), **not production**. Verified 2026-09-20/21: alias 301→200 real page with own canonical and CTA; unknown slugs (incl. trailing slash, `/transfer/app.js`, `/nope`) 404 + noindex; 25/25 sitemap pages 200, 25 distinct titles, none homepage-fallback; `/?pickup=NAN&dest=HILTON_DENARAU` still prefills, 35 route rows render, app loads; 39 same-origin links/assets scanned — only `/cdn-cgi/l/email-protection` 404s on the `.pages.dev` host (Cloudflare edge path, unrelated to `404.html`). Author re-check 2026-09-21 at 375×812 emulation (AUTHOR-VERIFIED, no submissions): alias → `/transfer/coral-coast-outrigger`, no horizontal overflow, canonical `https://nadiairporttransfers.com/transfer/coral-coast-outrigger`, CTA `book.fijidash.com/?pickup=NAN&dest=OUTRIGGER_FIJI&utm_…content=coral-coast-outrigger` (route preserved), sticky bar present, inline CSS loads; homepage deep link prefills `pickup=NAN`, `destination=HILTON_DENARAU`, `styles.css` 200 text/css, `app.js`/`chat-widget.js` 200 application/javascript, no overflow; unknown path 404 + `noindex, nofollow`, buttons `/#booking` `/#routes`, no overflow; old `/transfer/app.js` now 404 (text/html body) instead of 200 HTML.
Not tested: production behaviour, edge caching after promotion, real-device mobile walk-through (Codex owns the independent review).

## 8. Release acceptance (revised)
- Fresh valid journeys (alias, homepage, deep link, a route page, unknown path) load the correct assets: every same-origin script/CSS returns 2xx with the right content-type; unknown paths 404 + noindex.
- **Not required:** zero post-deploy requests to `/transfer/app.js`, `/transfer/styles.css`, `/transfer/chat-widget.js` — cached clients and bots may keep requesting them. Monitor those counts, and their statuses, separately as residual errors (expected to trend down; they will 404 rather than return HTML).
- Path counts are exposure, not guests.
- No production change without Codex's independent result and James's approval.
