# Nadi Airport Transfers — site source (nadiairporttransfers.com)

First-time git tracking for the live `nadiairporttransfers` Cloudflare Pages
project. Previously this site's production deployment had no connected git
source — these files are byte-reproduced from the live site plus the Nadi
Revenue Recovery A/B change below.

## This commit: server-side booking save + automatic ground-team notification

For guests booking a supported, fixed-zone Nadi Airport route:
`guest submit -> server-side save (via the existing nadi-dispatch-api Worker
and its D1 bookings table) -> reference -> automatic ops WhatsApp
notification -> success screen -> WhatsApp becomes optional (conversation
only)`.

Unsupported/custom-address routes are unaffected: they keep the original
WhatsApp-only flow, unchanged.

No backend, Worker, D1 schema, or fare changes are included. This reuses the
same booking endpoint and notification path FijiDash already uses in
production — zero new infrastructure.

### Files
- `src/app.js` — added `submitNadiBooking()`, `reportNadiSyncFailure()`,
  `resolveFixedDestinationZone()`; `confirmBooking()` made async with a
  save-eligibility branch.
- `src/index.html` — success-card title split into `#bulaTitleSaved` /
  `#bulaTitleWhatsappOnly` toggle spans; added `id="bulaLeadText"`.
- `src/styles.css`, `src/chat-widget.js` — unmodified, included for a
  complete deployable source tree.

### Validation
Validated end-to-end in an isolated Cloudflare Pages preview
(`nadi-revenue-recovery-preview.pages.dev`) before this commit. See the
Nadi P0 Revenue Recovery Final Production Gate Report for full results.

**Booking #69 (ref `FTT-R7KA45`) is a test record created during that
validation.** It is a real row in the shared production `bookings` table —
do not treat it as a genuine guest booking.

### Rollback
The live Pages deployment this replaces is
`0dc14830-b0b1-470e-9f25-46ab134993e3` (Production, branch=main). Cloudflare
Pages -> nadiairporttransfers -> Deployments -> that deployment -> "Rollback
to this deployment."
