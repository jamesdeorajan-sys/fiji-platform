# Marau Stage 1 — bounded mobile copy corrections

2026-09-28. Issue #54. Branch `ceo/marau-stage1-preview`. Display-only corrections — no booking, authorization, pricing, or recovery logic changed.

## Provenance

James's iPhone 15 Pro screenshots (installed to the home screen, running standalone) identified eight specific copy issues. This round addresses all eight, on the existing preview branch, and redeploys the SAME isolated Cloudflare Worker/D1 already live at **https://marau-stage1-preview.helpronline.workers.dev** — no new resource, no new environment.

**James's screenshots are the evidence of record for iPhone 15 Pro installation and standalone rendering.** Full close-and-reopen trip recovery on that device remains **awaiting James's own explicit confirmation** — this round did not (and cannot) re-verify that specific step itself; it only fixed the copy those screenshots surfaced.

## The eight corrections

All new formatting logic lives in one new shared module, `worker/guest_display.js` — used identically on both the client (spliced into `pages.js` via the same `.toString()` mechanism as every other shared display function) and the server (`whatsapp_handoff.js`, `worker.js`'s deal-listing copy), so the guest's own screen and the composed WhatsApp summary can never disagree.

1. **Pickup card short reference.** `shortBookingReference()` detects a real UUID segment (the shape every non-test `client_booking_ref` actually has: `MARAU-${uuid}`) and shows only its 8-character prefix (`MARAU-3F9A36C7`); anything without a UUID segment (a human-chosen synthetic test ref) is shown unchanged. This is **display only** — every actual authorization check in this codebase uses the bearer access token, never a booking reference of any length; the short reference is never looked up anywhere and cannot grant access.
2. **Route/vehicle labels.** `humanizeZoneLabel()`/`humanizeVehicleClassLabel()` convert known offer-derived codes (`NAD_AIRPORT` → "Nadi Airport", `DENARAU` → "Denarau", `SEDAN` → "Sedan") and fall back to a readable Title Case rendering for any future code-shaped value. **A real bug found and fixed while building this**: the first version's fallback applied to *any* string over a length threshold, which would have mangled an ordinary booking's own free-typed, already-human zone text (e.g. turning "Sofitel Denarau" into "Sofitel denarau"). Fixed by only transforming values that are actually code-shaped (`^[A-Z0-9_]+$`); anything else — including every ordinary booking's own guest-typed `pickup_zone`/`destination_zone`/`vehicle_type` — passes through completely unchanged. Underlying raw values are never altered anywhere.
3. **Currency.** `formatFijiCurrency()` prefixes `FJ$` on deal prices, comparison (struck-through) prices, requested-price displays, and the composed WhatsApp summaries. Numeric amounts are completely unaffected — verified directly (`deal.total_price === 24`, a `Number`, not a string).
4. **Unconfirmed deal wording.** The deal-listing `conditions` string no longer asserts "Confirmed by operator before travel" for an offer nothing has confirmed yet — it now reads "Requires operator confirmation."
5. **Request status.** The deal-request button no longer echoes the raw enum ("Requested (REQUESTED)"); it now reads "Request received — awaiting confirmation." for a fresh request. Subsequent `CONFIRMED`/`DECLINED` states are still shown accurately (via a small label map, not reworded away from what actually happened). The deal-requests list's own status pill was given the same treatment (`REQUESTED` → "Awaiting confirmation").
6. **Mocked WhatsApp summaries.** Both composers (`composeDealHandoffMessage`, `composeTripHandoffMessage`) no longer embed raw internal ids or a raw UTC timestamp in the human-readable message text. The message now reads a readable route, a short reference, and (for the trip summary) an explicit Fiji day/time matching the guest's actually-selected trip. **Full internal linkage is fully preserved** — `request_id`, `offer_id`, and `booking_id` are still returned as their own structured fields on the composed-message object, for the ops console, the assistant, and tests to use precisely; they are simply no longer *embedded in the prose*.
7. **Deal expiry.** The deals list's expiry used `new Date(d.expires_at).toLocaleString()` — the phone's own implicit local timezone, exactly the same class of bug already fixed for the pickup card in an earlier round. Now uses the same `formatFijiDateTime()` the rest of the app uses, with an explicit "Fiji time" label.
8. **Pickup heading.** "Next pickup" is now shown only for a genuinely confirmed arrangement (`status === 'confirmed'` or `'confirmed_unallocated'`); a still-pending booking reads "Requested pickup" instead — it has not actually been confirmed by an operator yet.

## Preserved, unchanged

- Marau as the app/home-screen name, "by Vakaviti AI", the existing palette, and the working icon assets — no logo redesign, no manifest rename. `myfiji.app` remains the planned public address, not yet acted on.
- Preview/demonstration-data labels throughout.
- Mocked messaging — no `wa.me` link, no real WhatsApp navigation or send, anywhere; unchanged.
- Booking, authorization, pricing, and recovery logic — a dedicated test (`booking, authorization, pricing and recovery logic are all completely unaffected...`) exercises a full confirm and an authorization failure end to end and asserts every raw value (price, offer id, request status) is exactly as before.

## Verification

- **Narrow mobile screens:** re-verified at a 375×812 viewport in the built-in browser against the running local server — pickup card, deal card, and the composed mock-WhatsApp panel all screenshotted and confirmed matching every correction above.
- **Non-Fiji device timezone:** `formatFijiDateTime`/`normalizePickupDatetime` take an explicit `timeZone: 'Pacific/Fiji'` argument, so they are structurally immune to whatever timezone the browsing device resolves to — proven directly: on this machine (which itself resolves to `Australia/Sydney`, GMT+10, a real non-Fiji zone), the exact same stored UTC instant renders as `10:00 AM` via the device's own implicit zone (`new Date().toString()`), `8:00 PM` in `America/New_York` (a genuinely different device timezone), and correctly, consistently `12:00 PM` — the guest's actual Fiji-local input — via `formatFijiDateTime`, regardless of which of those it's compared against.
- **Full test suite:** `smart-return-trigger-fill` (shared engine) **247/247**, unaffected; `marau/test/*.test.mjs` **137/137** (125 prior + 12 new in `marau_mobile_copy_corrections.test.mjs`, covering all eight findings individually plus the unaffected-logic check).
- **Embedding regression:** a `.toString()`-splicing test proves every new `guest_display.js` function survives extraction into the served script exactly as `pages.js` embeds it (the same discipline established after the round-3 `STORAGE_KEY` bug — and specifically relevant here, since an early draft of `humanizeZoneLabel`/`humanizeVehicleClassLabel` referenced an outer-scope constant that would NOT have survived splicing; caught and fixed before it ever reached a test run).

## Deploy

Redeployed to the SAME existing isolated preview — no new Cloudflare resource, no schema/migration change (this round touched no database column, so nothing needed re-applying to `marau-stage1-test-db`).

- **Preview URL (unchanged):** https://marau-stage1-preview.helpronline.workers.dev
- New Worker version: recorded in the round's checkpoint comment.

## Files changed

- `marau/worker/guest_display.js` — new, shared display-formatting module.
- `marau/worker/pages.js` — pickup card, deal list, deal-requests list, deal-request button label all updated to use the new formatters; "Requested pickup"/"Next pickup" heading logic added.
- `marau/worker/worker.js` — the deal-listing `conditions` string corrected.
- `marau/worker/whatsapp_handoff.js` — both composers rewritten to use the shared formatters and preserve internal linkage as structured fields instead of embedding it in the message text.
- `marau/test/marau_mobile_copy_corrections.test.mjs` — new, 12 tests.
- `marau/test/marau_codex_fixes.test.mjs`, `marau/test/marau_worker.test.mjs` — two pre-existing tests updated; they had asserted the raw internal id was present *in the message text itself*, which finding 6 deliberately changes. Both now check the preserved structured field instead.
