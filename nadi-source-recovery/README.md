# Nadi Master Source Recovery — investigation notes (2026-09-13)

Read-only investigation. No deploy, no merge, no content changes made to any live property.

## 1–2. Cloudflare Pages deployment history / current production deployment ID

**BLOCKED.** The wrangler API token configured in this environment is invalid:

```
$ npx wrangler whoami
[ERROR] A request to the Cloudflare API (/accounts) failed.
Invalid access token [code: 9109]
```

This blocks `wrangler pages deployment list --project-name=nadiairporttransfers`, which is
the only way to name the current production deployment ID or enumerate deployment history
(including confirming or retrieving deployment `0dc14830-b0b1-470e-9f25-46ab134993e3` from
6 June 2026). **This needs a refreshed Cloudflare API token, or the deployment list pulled
directly from the dashboard (Pages → nadiairporttransfers → Deployments) by someone with
access**, before task 1/2/3/6 can be completed as specified.

The project's default `<project>.pages.dev` subdomain (which would show the current
production deployment without needing the API) was also tried and failed to resolve —
either it's disabled for this project or blocked from this environment. Not conclusive
either way.

## 3. Asset inventory comparison vs the 6 June deployment

**Partially blocked** — without API/dashboard access to the June 6 deployment's actual
files, there's nothing to diff against directly. What I *can* say: the June 6 asset list
you gave (`index.html`, `app.js`, `chat-widget.js`, `llms.txt`, `robots.txt`, `sitemap.xml`,
one hashed txt file) is a **flat, single-directory static file set** — no `transfer/`
subdirectory, no `functions/` directory, no `_worker.js` mentioned. Compare that with what's
live today (Section 5) and the discrepancy is the whole story: `/transfer/*` behaves nothing
like a flat static deploy.

## 4. When did `/transfer/*` behavior first appear?

**Cannot be dated precisely** — two independent attempts came back empty:

- **Wayback Machine**: zero archived snapshots exist for `nadiairporttransfers.com` at
  all (checked the whole domain, not just `/transfer/*`) — this site has apparently never
  been crawled by the Internet Archive.
- **HTTP caching headers**: none of the live static assets (`app.js`, `chat-widget.js`,
  `styles.css`, `robots.txt`) return a `Last-Modified` header — only weak ETags (content
  hashes, not timestamps).

What I *do* have, extracted directly from the live homepage's own cache-busting query
strings (the same convention used across every other property in this account):

- `styles.css?v=20260908a` and `chat-widget.js?v=20260908a` → last touched **2026-09-08**
- `app.js?v=20260909a-return-trip` → last touched **2026-09-09** (a "return trip" feature)

So the homepage/CSS/JS layer was under active development as recently as 4–5 days before
this audit (today: 2026-09-13). That doesn't date the `/transfer/*` fault directly (it's a
separate architectural layer — see Section 5 — untouched by these particular bumps), but it
rules out "long-dormant, nobody's touched this site in months."

**Strongest available dating evidence — `sitemap.xml`:**

```
https://nadiairporttransfers.com/
https://nadiairporttransfers.com/transfer/port-denarau
https://nadiairporttransfers.com/transfer/natadola-intercontinental
https://nadiairporttransfers.com/transfer/pacific-harbour
https://nadiairporttransfers.com/transfer/suva
https://nadiairporttransfers.com/transfer/coral-coast-outrigger
https://nadiairporttransfers.com/transfer/pearl-south-pacific-resort
https://nadiairporttransfers.com/transfer/port-denarau-marina
https://nadiairporttransfers.com/transfer/shangri-la-yanuca-island
https://nadiairporttransfers.com/transfer/naviti-resort
https://nadiairporttransfers.com/transfer/doubletree-sonaisali-island
https://nadiairporttransfers.com/transfer/hilton-fiji-beach-resort
```

This is a **real, correctly-served static file** (not a fallback) — and it lists exactly
the CEO's 10 confirmed-broken slugs plus `port-denarau-marina` (one of the two working
pages). It does **not** list `outrigger-fiji-beach-resort` — the *other* working page — at
all. Combined with the previously-found UTM tag difference on their booking CTAs
(`port-denarau-marina` → `utm_campaign=nadi_legacy_rescue`; `outrigger-fiji-beach-resort` →
`utm_campaign=nadi_transfer_acquisition`), the most consistent story is:

- The 10 broken slugs + `port-denarau-marina` were built and submitted for indexing in one
  earlier batch ("legacy_rescue") — they were real, working pages at some point (nobody
  hand-writes a sitemap entry for a page that never existed).
- `outrigger-fiji-beach-resort` was added later, in a separate, newer batch
  ("transfer_acquisition"), after the sitemap was last regenerated — which is also why it's
  the one page from that batch that still works.
- Sometime **after** the sitemap was generated and **before** today, whatever serves
  `/transfer/*` broke for the entire older batch, without anyone updating the sitemap to
  reflect it.

This is circumstantial, not a timestamp — but it's real evidence, not a guess, and it
points at a **regression of previously-working pages**, not pages that were never finished.

## 5. What's actually live today

Confirmed via direct HTTP probing (all read-only GETs):

| Path | Result | Interpretation |
|---|---|---|
| `/`, `/index.html` | 200, real content, `cf-cache-status: DYNAMIC` | Homepage is NOT served as a cached static file — every request re-executes something |
| `/app.js`, `/chat-widget.js`, `/styles.css`, `/robots.txt` | 200, real content, `cf-cache-status: REVALIDATED` | These genuinely ARE static assets in Cloudflare's edge cache |
| `/sitemap.xml` | 200, real correct XML, `DYNAMIC` | Real content, but still routed dynamically rather than as a cached static file |
| `/llms.txt` | 200, **byte-identical to the homepage** (confirmed via `diff`) | **Broken** — same failure class as the fallback route pills. One of the CEO's originally-uploaded assets is currently missing/broken in production, not just `/transfer/*` |
| `/favicon.ico` | 200, byte-identical to homepage, `cf-cache-status: EXPIRED` | Falls back to homepage — the site's default behavior for **any unmatched path** |
| `/_headers`, `/_redirects`, `/_routes.json` | 200, byte-identical to homepage | Inconclusive on their own (Cloudflare never serves these special config files' raw content over HTTP even when they exist and are working correctly) — but consistent with the same default fallback |
| `/transfer/<10 broken slugs>` | 200, **0 bytes**, `DYNAMIC` | Does NOT match the site's default fallback pattern (see below) |
| `/transfer/<3 "also broken" slugs>` + any nonexistent `/transfer/*` slug | 200, byte-identical to homepage, `DYNAMIC` | Matches the site's default fallback pattern exactly |
| `/transfer/port-denarau-marina`, `/transfer/outrigger-fiji-beach-resort` | 200, real distinct content, `DYNAMIC` | Working |

**Key architectural conclusion:** the site's default behavior for *any* unmatched path
(`/favicon.ico`, `/llms.txt`, `/_headers`, a nonsense `/transfer/*` slug) is to fall back to
serving the homepage — that's a single, consistent, site-wide pattern, almost certainly
Cloudflare Pages' standard "serve `index.html`" clean-URL/SPA fallback for anything with no
matching static file.

The 10 broken slugs behave **differently** from that default — they return a **true empty
body**, not the homepage. Something must specifically recognize `/transfer/*` as an
in-scope path *before* the default fallback ever gets a chance to run, and for these 10
slugs, that something produces nothing instead of either real content or falling through
to the normal 404→homepage behavior. That is the signature of a **Cloudflare Pages
Function** (most likely `functions/transfer/[[slug]].js` or an equivalent catch-all, or a
`_worker.js` with an explicit `/transfer/` route) doing a per-slug data lookup and emitting
an empty response on an unhandled miss, rather than a plain static-file deployment.

- **Static transfer HTML files:** no evidence of any (0-byte responses could never come from
  serving a real static file — Cloudflare doesn't truncate static assets to nothing)
- **Pages Functions:** strongly implied (see above) — could not confirm directly, no API/
  file-manifest access
- **`_worker.js`:** possible alternative to Functions, same evidence either way — could not
  distinguish the two without seeing the actual deployment
- **`_redirects` / `_headers` / `_routes.json`:** requested directly, all fall back to the
  homepage exactly like any other unmatched path — this is expected Cloudflare behavior
  whether or not these files exist, so it's not evidence either way
- **Generated assets:** the June 6 upload mentions "one hashed txt file" — not referenced by
  any `href`/`src` in the current homepage HTML, so it can't be found by following links.
  Enumerating it requires an actual file-manifest listing (dashboard or API) — not possible
  from this environment right now.

## 6. Export of exact latest production assets

**Not possible via the Cloudflare API** (token invalid, as above) — there is no way to
export a deployment's exact file manifest or an official archive without it, short of
someone downloading it from the dashboard directly.

**What was done instead:** every asset that IS reachable over plain HTTPS was downloaded
byte-faithfully via `curl` and is committed alongside this README (see `2026-09-13-live/`).
This is the current live *output*, not the deployment's source input — for a Pages
Function specifically, the HTML `/transfer/*` produces is a symptom I can capture, not the
function's own source code, which isn't retrievable over HTTP at all.

## 7. Source reconstruction path

`nadi-source-recovery/2026-09-13-live/` (this repo, branch `ceo/nadi-master-source-recovery`):

```
index.html     — homepage, byte-faithful fetch, 2026-09-13
app.js         — homepage booking-widget script (client-side only — confirmed no
                 routing/service-worker logic touching /transfer/* at all)
chat-widget.js — floating chat widget script
styles.css     — homepage stylesheet
robots.txt     — real, correctly served
sitemap.xml    — real, correctly served (see Section 4 for why this file matters)
llms.txt       — INCLUDED FOR EVIDENCE ONLY: this is not real llms.txt content, it is
                 byte-identical to index.html (confirmed via diff) — the actual llms.txt
                 is currently unreachable
```

This reconstructs everything reachable over HTTP. It does **not** and cannot include:
the Pages Function/`_worker.js` source (if one exists) driving `/transfer/*`, the per-hotel
data it reads from, or the missing "hashed txt file" from the June 6 upload — none of these
are exposed over HTTP.

## 8. No content changes made

Confirmed — every file above is an unmodified, byte-faithful capture of what's live right
now. Nothing was edited.

## 9. Likely origin of the blank route behavior

Most consistent explanation across all evidence gathered (this report + the prior P0 route
audit): a Pages Function (or `_worker.js` route) intercepts `/transfer/*` specifically,
looks up per-slug hotel data from some source not visible over HTTP, and for most of the
older ("legacy_rescue") batch of slugs that data lookup now fails in a way the function
doesn't guard against — producing an empty `Response` instead of either real content or a
graceful fall-through to the site's normal 404→homepage behavior. `port-denarau-marina`
(same old batch) and `outrigger-fiji-beach-resort` (a separate, newer batch) still have
intact data and render correctly. The 3 "fallback" slugs
(`sheraton-fiji-golf-beach-resort`, `intercontinental-fiji-natadola`,
`grand-pacific-hotel-suva`) aren't recognized by the function at all and fall through to the
site's ordinary default behavior instead.

This is a plausible, evidence-backed hypothesis, not a confirmed root cause — confirming it
needs the actual Function/data source, which this environment cannot reach.

## 10. Safest path to Git-backed canonical source

1. Get the Cloudflare API token working again (or have someone with dashboard access pull
   it) — this alone unblocks tasks 1, 2, 3, and 6 completely and would very likely resolve
   the open questions in Section 5 immediately (a file listing would show in seconds whether
   this is a Functions directory, a `_worker.js`, or something else).
2. From the dashboard, download the exact current production deployment's full file
   tree (Cloudflare Pages deployments are downloadable/inspectable from the deployment
   detail view) — this is the one artifact that actually answers "what's really running,"
   which HTTP probing from outside can only infer.
3. Import that exact tree into this repo as a new directory (e.g.
   `nadiairporttransfers-site/`), commit it as the real baseline (replacing the
   `2026-09-13-live/` HTTP-fetched approximation in this folder), and connect the Cloudflare
   Pages project to this repo's branch going forward so every future deploy is a real,
   reviewable git commit instead of a manual upload with no history — this is the only way
   to stop this kind of drift from recurring silently.
4. Only after that canonical source exists should any real fix to `/transfer/*` be written
   and reviewed — patching blind against an HTTP-fetched approximation risks missing
   whatever the Function actually depends on.
