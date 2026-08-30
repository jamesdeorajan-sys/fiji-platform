# Phase 3 Source-Family Research Record (2026-08-29)

Live research completed via real browser navigation and direct HTTP checks (robots.txt, UA
sensitivity) before any of these domains were added to the discovery registry. No forms were
submitted, no logins attempted, no booking/payment flow was clicked into.

## Hideaway Holidays
- Verified domain: `www.hideawayholidays.com.au` (AU travel agency — distinct from "Fiji Hideaway
  Resort & Spa" at `fijihideawayresort.com`, a different, unrelated business).
- Real deal paths: `/fiji-islands-hot-deals/`, `/fiji-packages/`, `/fiji-airways-on-sale-holiday-deals/`,
  `/fiji-christmas-deals/`, `/honeymoon-deals/`, individual offers at `/fiji-package/<resort>/<offer-slug>/`.
- Excluded: `/search/*` (no content).
- Rendering: plain server-rendered HTML. **Known limitation**: sits behind Cloudflare bot-mitigation
  — a bare/generic User-Agent was hard-blocked on deep package pages during research; a realistic
  browser UA passed. This system's `safeFetchSource()` uses an honest, self-identifying bot
  User-Agent and is **not modified to impersonate a browser** to get past this — per the master
  directive's prohibition on bypassing access controls. Expect `ACCESS_DENIED`-classified fetches
  from this family; that is correct, policy-compliant behavior, not a defect.
- Currency: AUD (inferred from `.com.au` domain / AU phone number / "Departure City" field — not an
  explicit on-page currency code).
- robots.txt: `Allow: /` — no restriction on any of the above paths.

## South Sea Cruises Fiji
- Verified domain: `southseacruisesfiji.com`.
- Real deal paths: `/returnee-deal/` (20%-off promo), `/day-trips/*` (e.g. `/day-trips/malamala-beach-club/`).
- Excluded: `/malamala-book-now/` (drives into booking). `bookings.southseacruisesfiji.com` and
  `apps.customlinc.com.au` are different hostnames — excluded structurally by this system's
  same-domain check, not by path pattern.
- Rendering: plain server-rendered HTML (WordPress), fetched cleanly with a simple GET.
- Currency: FJD, explicitly stated site-wide.
- robots.txt: disallows only `/wp-admin/`, `/wp-includes/`, `wp-content` plugins/themes, `/wp-json/`,
  `/site.webmanifest`. Target paths unrestricted.

## Malamala Beach Club
- Verified domain: `www.malamalabeachclub.com`.
- Real deal paths: `/price` (full rate card + upgrades), `/upgrades`.
- Excluded: `/book` (live Wix Bookings payment flow), `/mclub-membership` (login-gated), any URL
  with a `?lightbox=` query string (per their own robots.txt — honored by construction, since this
  system's discovery only extracts `<a href>` targets from HTML and never constructs lightbox URLs).
- Rendering: Wix platform, but `/price` returns the full rate card server-rendered — a plain HTTP
  GET retrieved the complete pricing text with no JS execution needed.
- Currency: FJD, explicitly labelled throughout (e.g. "FJ$215"). Pricing matches South Sea Cruises'
  own Malamala day-trip page exactly (South Sea Cruises operates/sells Malamala day passes) — a
  useful cross-check if the pipeline ever needs to dedupe the same deal across both sites.
- robots.txt: allows `/` generally, explicitly disallows `*?lightbox=`, blocks PetalBot.

## Taveuni Palms Resort
- Verified domain: `taveunipalms.com`.
- Real deal paths: `/rates-specials` (specials + full rate card).
- Excluded: `/book` (301-redirects off-domain to `book-directonline.com/properties/TaveuniPalmsResortDirect`
  — a third-party payment engine; excluded both by path pattern and because the redirect target is a
  different hostname this system never follows into).
- Rendering: plain server-rendered HTML (WordPress).
- Currency: USD, explicitly stated ("rates are indicated in U.S. Dollars and EXCLUDE the Fijian
  Government tax (VAT 12.5%)").
- robots.txt: disallows only `/wp-admin/` (with an admin-ajax carve-out).

## Vakaviti-owned public source
Per explicit confirmation from the CEO during this build (a standing note from earlier this
engagement holds `fijitourtransfers.com` out of scope without separate authorization), the fifth
family scans `vakaviti-marketplace-stage1.helpronline.workers.dev`'s own `/experiences` and
`/operators` public directory pages instead — zero external-provider risk, exercises the pipeline
against already-known, fully-controlled content.

## Cross-checks performed
- None of the four external domains overlap with `fijitourtransfers.com`, `tourfijitours.com`, or
  `tourfiji.tours` (all previously flagged/excluded elsewhere in this engagement).
- No parked-domain, injected-spam, or lookalike-domain red flags found on any of the four sites
  (the kind of compromise found earlier this engagement on an unrelated domain during supply
  research was specifically checked for and not present here).
