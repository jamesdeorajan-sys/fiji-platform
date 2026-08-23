# apps/nadi-guest-widget

**Status: proposal branch (`ceo/nadi-revenue-bridge-preview`). Not connected to
Cloudflare. Not merged. No production system has been touched to produce this
directory — everything here was built from read-only source recovery
(E3A/E3B) plus local-only testing.**

## What this is

A Git-backed, single source of truth for the guest-facing Nadi transfer
booking site, replacing two independently-uploaded, drifting Cloudflare Pages
projects with one branded-by-configuration codebase:

- **Sourced from:** `guest-widget-integration-preview` branch,
  commit `cc53ea682b52a4f85b6dfec23a892eff385d4ce1` — confirmed byte-identical
  (after CRLF normalization) to what is live today on `book.fijidash.com`
  (Cloudflare Pages project `nadi-guest-widget-preview`, deployment
  `04fd5a82-3939-481d-a804-aa486688c68e`).
- The older, currently-live `nadiairporttransfers.com` build (Cloudflare
  Pages project `nadiairporttransfers`, canonical deployment `628491f5`,
  2026-05-05) traces to an earlier commit on the same branch,
  `9c2f581c1831db2152961daa1f1248c00aae0772` — also verified byte-identical.
  This directory intentionally sources from the **newer** commit (the one
  live on `book.fijidash.com`), since it already contains the working
  `nadi-dispatch-api` bridge for airport-anchored trips that the older build
  never had.

## What changed vs. the recovered source

- `worker.js` (the Pages-attached stub — "currently stub, real logic is
  client-side" per its own original README) is **omitted from this
  directory's active runtime**. It is not deleted from Git history: it still
  exists at its original path in every earlier commit on
  `guest-widget-integration-preview`, and in this branch's own first commit
  (a straight copy of that branch's HEAD, made before this directory was
  added).
- Brand-specific text (site name, logo text, canonical URL, meta/structured
  data, footer line, the two brand mentions inside `app.js`/`chat-widget.js`)
  is now driven by `brand.config.json` through `functions/_middleware.js`,
  instead of being hardcoded "Fiji Dash" text. The underlying `index.html`,
  `app.js`, `styles.css`, `chat-widget.js`, and all 22 `transfer/*.html`
  pages are otherwise **byte-identical** to the recovered source — no
  functional/pricing/booking logic was touched by this change.
- Two unsupported claims present in the source lineage's footer
  ("Licensed & insured transport operator, Fiji.") are dropped for the Nadi
  brand specifically, per the explicit instruction not to introduce
  unsupported licensing/verification claims for that brand. (The "500+
  five-star reviews" claim flagged as unverified in an earlier README no
  longer appears in this source lineage at all — already resolved upstream
  before this task.)
- `docs/PRICING_MODEL.md` is corrected to match the live `pricing_rules`
  table (bracket model), with the superseded zone-tiered formula kept in a
  clearly marked historical section.
- `server-proposal/` contains a **proposed, undeployed** hardening patch for
  `nadi-dispatch-api`'s custom-address pricing path — see that file for the
  vulnerability it closes and the local test evidence.

## Authoritative Cloudflare deployment path (today, unchanged by this branch)

| Domain | Pages project | Live deployment |
|---|---|---|
| `nadiairporttransfers.com`, `www.` | `nadiairporttransfers` | `628491f5` (2026-05-05) |
| `book.fijidash.com` | `nadi-guest-widget-preview` | `04fd5a82` (2026-08-10) |

Neither project has been modified. Promoting this directory to either domain
is a separate, explicitly-authorized action — not performed here.

## Directory layout

```
apps/nadi-guest-widget/
  brand.config.json          # presentation-only config; never read by pricing/security code
  functions/_middleware.js   # proposed Cloudflare Pages Function (not deployed)
  src/                       # the static site itself (index.html, app.js, styles.css,
                              #  chat-widget.js, transfer/*.html, assets, favicons, _headers,
                              #  _redirects, wrangler.toml) - byte-identical to source lineage
  docs/PRICING_MODEL.md      # corrected pricing documentation
  server-proposal/           # proposed nadi-dispatch-api patch, not deployed
  local-dev/                 # local-only mock API + tests; see local-dev/README.md
```

## How to actually preview this locally (no Cloudflare, no Node)

Node/npm/wrangler are not available in the environment this branch was built
in, so real `wrangler pages dev` was not run. `local-dev/local_static_emulator.py`
is a Python port of `functions/_middleware.js`'s rewrite rules, used to
produce and verify the branding evidence in the E3B report. See
`local-dev/README.md` for exact run instructions and for what would need to
happen (a real `wrangler pages dev`) to test the actual Cloudflare Pages
Function artifact once Node is available.
