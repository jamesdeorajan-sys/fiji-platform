# Marau Stage 1 — design pass (applied after correctness passed review)

Applied only after all 6 second-review correctness findings were fixed and re-tested (313/313) — no design change was made before that point, per the mission's own ordering.

## What was ported from the approved design reference (`marau-app-prototype.html`)

- **Palette**: the exact `--ink`/`--muted`/`--paper`/`--surface`/`--lagoon`/`--shallows`/`--line`/`--hibiscus`/`--frangipani` custom properties, including the dark-mode media-query variant, copied verbatim.
- **Typography**: Familjen Grotesk (headings, the pickup card's time, price figures, the deal percentage) + Onest (body), loaded via the same Google Fonts `<link>` the prototype uses.
- **Brand mark**: the circular lagoon-and-frangipani mark plus the "Marau by Vakaviti AI" wordmark, in the header of both the guest app and the ops console.
- **Prominent pickup card**: the `.pickup`/`.route`/`.facts` component — a full-bleed lagoon-coloured card with the route as a two-stop dotted line (pickup filled, destination outlined) and a facts grid (vehicle, status) — replacing the previous plain text summary.
- **Deal card**: the `.deal`/`.pct`/`.price` treatment — a percentage-off badge in hibiscus, struck-through original price beside the bold current price, ported directly.

## What was deliberately NOT ported

Credits, the gamified task list (flight number, luggage, reconfirm, "add your next transfer"), the install banner and reminder toggles are all part of the prototype's deferred feature set (credits, book-ahead rewards, notifications) and were not built in Stage 1 — porting their visual chrome without the underlying feature would be misleading, so they were left out entirely rather than stubbed.

## Booking-link guests land directly on their trip

Unchanged behaviour, reconfirmed after the redesign: `loadTrip()` runs on page load, checks for a `#tok=` fragment, and calls `showView('trip')` the moment `GET /preview/trip` resolves — a guest opening a real booking-confirmation link never sees the entry form. Verified in a live local run (screenshots below) by navigating directly to a `#tok=` link and observing the Trip pickup card render with no intermediate screen.

## The synthetic entry form stays visibly separate

The booking-creation form (`view-start`) is now styled as a plainly-labelled test harness: a dashed border, a monospace `PREVIEW TEST HARNESS` tag, and explicit copy — *"A real Marau guest never sees this screen — they land straight on their Trip from a booking-confirmation link."* — distinguishing it from the branded Trip/Deals experience a real guest actually uses.

## Preview labels preserved

Every screen still carries an explicit label: the header's "Preview" pill, the isolated-build banner under it, per-deal "DEMONSTRATION DATA — preview only, not a real offer" labels, and the mock-WhatsApp panel's "Preview mock — nothing is sent" tag are all unchanged from the correctness-pass build.

## Screenshots (mobile, 375×812)

Captured live against `test/local_preview_server.mjs` — a throwaway Node HTTP server (not part of the Worker or its deployment) that serves the real `worker.js` fetch handler against the real SQLite-backed `test/d1_sqlite_shim.mjs`, used solely because `wrangler dev --local`'s own D1 binding produces an opaque internal error in this sandboxed environment (reproduced on a trivial `CREATE TABLE` — see the review package §9; this is an environment limitation, not a code defect). Five screens were captured and shown inline in-session: the welcome/test-harness screen, the Trip view with the prominent pickup card, the Deals list, an offer requested (showing its status pill), and the mocked WhatsApp handoff panel with the composed message and copy button. All five render correctly at mobile width with the ported palette/typography/brand mark in place.
