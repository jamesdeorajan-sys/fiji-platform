# Focused browser evidence - FijiDash candidate (2026-10-05, preview-only)

Real Chromium (the in-app browser pane) against a local server (`ftt-booking-site/reconciliation/browser/server.mjs`). The server serves the page source and answers `api.nadiairporttransfers.com` from the real deployed Worker bundle over an in-memory database. A guard script injected into every page routes the API host to the local server and blocks every other cross-origin fetch / XHR / beacon / `window.open` (only the funnel-analytics beacons were attempted, and were blocked). The Worker's own outbound calls (WhatsApp alerts) are recorded and blocked. No live booking, message or write.

Driver: `reconciliation/browser/driver.js`. Everything below was read from the real page DOM and the harness's record of what the Worker did.

## A. Reproduction on FijiDash PRODUCTION (`8c6f920`): Momi minibus, one-way, day, 8 passengers

| Step | Guest sees |
|---|---|
| Vehicle selection | Minibus **FJ$79 -> FJ$71** (the minibus is cheaper than the sedan, FJ$99 -> 89) |
| Review step | **FJ$157.92** (subtotal FJ$175.92, 10% discount -FJ$18) with "Price updated to reflect the current live fare." |
| Submitted / Worker | submitted 157.92, `require_quote_match` NOT sent, Worker calculated 157.92, saved 157.92, decision `matched` |
| After saving | no saved amount shown to the guest (the page ignored it) |

So the guest chose at 71 and was asked to confirm at 157.92: the discrepancy is on screen, not only in the data.

## B. Candidate: same trip

| Step | Guest sees |
|---|---|
| Vehicle selection | Sedan FJ$94.29 -> 85.29, Minivan FJ$147.42 -> 132.42, **Minibus FJ$175.92 -> FJ$157.92** (the same figures the review step shows) |
| Review step | **FJ$157.92**, subtotal FJ$175.92, no "price updated" note (nothing changed between selection and review) |
| Submitted / Worker | submitted 157.92, `require_quote_match` true, Worker 157.92, saved 157.92, decision `matched` |
| After saving | success card: **"Fare saved: FJD 157.92"** (read from the Worker response) |

## C. Consent journey (candidate; live-fare lookup made unavailable so the page can only use its static table)

Trip: Nadi Airport -> Mercure Nadi, sedan, one-way.

1. Selection shows FJ$19 with the honest note "We couldn't confirm the live price just now, so the fares shown are estimates. Our team confirms the final price with you. Try again". Review shows FJ$19.
2. Guest presses Confirm. Worker: **409 PRICE_MISMATCH, reference fare 30.15; 0 bookings created, 0 outbound calls** (no alert, no driver broadcast, no message).
3. The review step shows: "The price for this trip has changed. Nothing has been booked yet. Original total shown: FJ$19 / Revised total: FJ$30.15 / Tap "Accept revised price and submit" to book at FJ$30.15, or go back to change your trip." The button now reads **Accept revised price and submit**.
4. Guest presses it. Worker: 201, **same booking reference**, submitted 30.15, `revised_from_amount` 19, saved **30.15**, decision `accepted_revised`, original shown 19. Success card: "Fare saved: FJD 30.15".
5. Mobile 390x844: notice, total (one short line) and button all fit; no horizontal scroll (document width 390).

## D. Acceptance is invalidated by an itinerary change (candidate)

After the 409 and the revised total are on screen, the guest goes Back to step 1 and ticks the child seat, then returns to the review step: the "Accept revised price" notice is gone, the button is back to "Confirm booking request", the stored acceptance is null and the total is recomputed from the page's own prices (FJ$27), not the stale FJ$30.15. Nothing had been saved. (Unit tests additionally cover extras, trip type, vehicle, day/night, destination, pickup date, passengers and bags, and a refusal that arrives after the journey changed.)

## E. Honest uncertain-save state and same-reference retry preserved (candidate)

The response to the booking write is lost after the Worker committed it (the page's fetch fails once). The page shows "We couldn't confirm whether your booking request was saved. Please try again using the same request ... Do not make a second booking with different details", with the reference. "Try again" re-sends the SAME reference: the Worker answers 200 `idempotent: true`, the database holds exactly one booking, and the success card shows "Fare saved: FJD 157.92".

Harness note: the first attempt to simulate the lost response by destroying the server socket was silently retried by Chromium itself (an automatic POST retry on a reset connection), which masked the failure. The page-side fetch failure above is the faithful simulation; the unit suites cover timeout / network error / 5xx as `resultKind: 'unknown'`.

## Not evidenced here

Physical-phone testing of this FijiDash candidate; a desktop-width screenshot of the success card after a revised-price acceptance (verified in the DOM and unit tests, screenshot taken for the consent notice and the plain "Fare saved" card only); departures, boats, custom addresses and tours (see RECONCILIATION.md coverage).
