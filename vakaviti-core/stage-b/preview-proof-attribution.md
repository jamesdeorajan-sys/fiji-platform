# Preview proof — Origin-based source attribution (Issue #38 Step 3, CEO correction)

**Isolated infrastructure used, nothing shared with production:**
- Worker: `nadi-dispatch-api-attribution-preview` (`https://nadi-dispatch-api-attribution-preview.helpronline.workers.dev`) — bindings checked and confirmed to be *only* `env.DB` pointing at the isolated D1 below; no R2, no cron, no shared secrets.
- D1: `nadi-marketplace-attribution-preview-db` (id `52d61b77-7e2f-40f5-8737-bbc446443886`) — freshly created this pass, seeded from the real `schema.sql` + real `milestone34` (both extracted from `origin/guest-widget-integration-preview`, the actual branch merged to production), then the corrected `milestone35-booking-source-attribution.sql`.
- Code: the real, current production `worker.js` (same source, byte-identical apart from the attribution addition below) + real `pricing.mjs` — not a simplified stand-in.

**Migration applied to this preview only, verified via `PRAGMA table_info`:**

| Column | notnull | default |
|---|---|---|
| `canonical_source` | **1 (NOT NULL)** | `'unknown'` |
| `storefront_id` | 0 | NULL |
| `campaign` | 0 | NULL |
| `referral_code` | 0 | NULL |
| `vakaviti_booking_id` | 0 | NULL |

Matches the CEO's exact correction. Confirmed by direct schema introspection, not by re-reading the migration file's intent.

**Code change:** `resolveStorefrontAttribution(request)` reads only `request.headers.get('Origin')` against a closed allowlist (`https://book.fijidash.com` → fijidash; `https://nadiairporttransfers.com` / `https://www.nadiairporttransfers.com` → nadiairporttransfers; anything else → null/unknown). Called in `handleGuestBookingCreate()` **before** the request body is touched for identity purposes; `body.canonical_source` / `body.storefront_id` are never read anywhere in the handler.

## The 7 required proofs — all passed, live, against the isolated preview above

| # | Test | Origin sent | Result | Pass? |
|---|---|---|---|---|
| 1 | Known Origin — FijiDash | `https://book.fijidash.com` | `storefront_id: "fijidash"`, `canonical_source: "fijidash"` | ✅ |
| 2 | Known Origin — Nadi Airport Transfers (apex) | `https://nadiairporttransfers.com` | `storefront_id: "nadiairporttransfers"`, `canonical_source: "nadi_airport_transfers"` | ✅ |
| 2b | Known Origin — Nadi Airport Transfers (www, also live per Issue #38 verification) | `https://www.nadiairporttransfers.com` | Same as #2 | ✅ |
| 3 | Same Host, different Origin | Tests 1/2/2b all hit the identical `*.workers.dev` Host | Three different `storefront_id` results from the one Host, proving Host alone cannot do this | ✅ |
| 4 | Unknown/unexpected Origin | `https://evil-scraper.example.com` | `storefront_id: null`, `canonical_source: "unknown"` | ✅ |
| 5 | Missing Origin entirely | *(no Origin header sent)* | `storefront_id: null`, `canonical_source: "unknown"` | ✅ |
| 6 | Client tries to claim an identity via body fields, with an unrelated/unknown real Origin | Body: `canonical_source:"fijidash", storefront_id:"fijidash"`; real Origin: `https://attacker.example.com` | Stored `canonical_source: "unknown"`, `storefront_id: null` — **client's claim entirely ignored** | ✅ |
| 6b | Client tries to claim a *different* identity than its real Origin | Body: `canonical_source:"partner", storefront_id:"bookfijitransfers"`; real Origin: `https://nadiairporttransfers.com` | Stored the **true** server-derived `canonical_source: "nadi_airport_transfers"`, `storefront_id: "nadiairporttransfers"` — client's spoofed claim overridden in both directions, not just refused | ✅ |
| 7 | Old-client-shaped payload (no attribution fields at all, no Origin) still creates a booking | Plain body identical in shape to today's live `ftt-booking-site/src/app.js` payload | `ok: true`, real `booking_id` returned, `canonical_source: "unknown"` (correct default) | ✅ |

Raw D1 rows for all 8 test bookings created (test 6 initially hit the pre-existing, unrelated guest-booking rate limiter — 5 req/10min — which was raised **on this isolated preview D1 only** to complete the run; this is expected pre-existing behavior, not a defect in the attribution logic):

```
id  guest_name              canonical_source        storefront_id
1   TEST-ATTR T1            fijidash                fijidash
2   TEST-ATTR T2            nadi_airport_transfers  nadiairporttransfers
3   TEST-ATTR T2b           nadi_airport_transfers  nadiairporttransfers
4   TEST-ATTR T4            unknown                 null
5   TEST-ATTR T5            unknown                 null
6   TEST-ATTR T6            unknown                 null
7   TEST-ATTR T6b           nadi_airport_transfers  nadiairporttransfers
8   TEST-ATTR T7 OldClient  unknown                 null
```

## What this proves and doesn't

**Proves:** the corrected design works exactly as specified, end to end, against real production code and a real (isolated) D1 — not a mockup. Backward compatibility with the existing, unmodified frontend payload shape is demonstrated, not assumed.

**Doesn't prove:** that `book.fijidash.com`'s real browser traffic actually sends `Origin: https://book.fijidash.com` today — this preview simulated that Origin via curl, exactly as the CEO's instructions specified ("Request simulating Origin"). The underlying guarantee is a web-platform one (a cross-origin `fetch()` always carries the calling page's own origin, not something `app.js` sets or could misconfigure) and the live Worker already returns `Access-Control-Allow-Origin: *` today, meaning real Origin headers are already arriving on every request and are simply unread — but this was not separately re-confirmed via live browser network capture in this pass, only via the documented spec behavior.

No production Worker, D1, Pages project, or frontend was touched to produce this evidence. All resources above are new, isolated, and not referenced by any live request path.
