# Marau - the real booking path (round trips in ONE source booking) and the human-led deals pilot

Isolated branch `ceo/marau-roundtrip-legs` (from `marau-preview-rc1`, which is preserved untouched with its evidence). Preview only; rewards OFF;
no production deployment, migration, live message, real guest import or payment. Synthetic data throughout.

## 1. Source facts this is built on (read from the real `nadi-dispatch-api` code, not assumed)

| Fact | Where |
|---|---|
| A round trip is **ONE `bookings` row**: the return is `return_date`, `return_time`, `return_pickup_location` on the same row | migration milestone17; `createBookingRecord` |
| **One** `quoted_amount` (+ `quoted_currency`, `settlement_amount_fjd`, `commission_base_fjd`); **no separate return amount** | `bookings` schema / INSERT |
| **No `trip_type` column** (it is accepted in the request but never stored) and **no link between two bookings** | INSERT column list |
| The existing `GET /admin/bookings` list **omits** the `return_*` fields, so it cannot represent a round trip | `handleAdminListBookings` |

## 2. Read-only source adapter (Task 1)

* **Source side** (Nadi branch `ceo/nadi-booking-read-itinerary`, commit `7d268e5`, **pushed, NOT deployed, no migration**): `GET /admin/bookings/:id`, admin-only, read-only,
  returns exactly the fields a mirror needs (both legs' itinerary, the single quote, settlement figures, status, driver id) and no guest name/notes/IP/attribution.
  Nadi suite 111/111 (incl. 4 new tests: admin-only, round trip as one row, one-way nulls, mutates nothing).
* **Marau side** (`worker/nadi_booking_reader.js`): one GET of one validated booking id per call; admin credential only; `redirect: 'manual'`; https/loopback only; fail-closed on any unexpected
  response (wrong id, 3xx, 401/403, 5xx, non-JSON, malformed types); 404 = "not found"; **whitelisted fields only**; exposes `provenance` `{kind:'nadi_dispatch_api', origin, authenticated:true, read_only:true}`.
  Selected by the Worker only when `NADI_SOURCE_BASE_URL` + `NADI_SOURCE_ADMIN_TOKEN` are configured (**they are not, anywhere**).
* **Evidence:** the adapter is run against the **real nadi `worker.js`** in-process: a round-trip booking created through the real `POST /bookings` is read by the adapter and mirrored as two legs (`REAL SCHEMA` test). LOCAL, AUTHOR-RUN.

## 3. Round-trip mapping (Task 1)

An airport-origin booking with return fields becomes **two Marau legs of the SAME source booking** (`marau_test_bookings`):

| | arrival leg | return leg |
|---|---|---|
| identity | `source_booking_ref`, `leg_key='arrival'` (the claim-guarded owned row) | same `source_booking_ref`, `leg_key='return'` (derived, `source_sync_owned=0`) |
| uniqueness | unique `(source_booking_ref, leg_key)` -> a repeated sync **cannot** duplicate a leg; concurrent syncs converge on exactly two rows (tested) | |
| pickup / destination | as recorded | pickup = **recorded** `return_pickup_location` (`pickup_basis='recorded'`), else the outbound destination marked `inferred_from_outbound_destination`; destination = the outbound origin |
| date/time | `pickup_date`/`pickup_time` | `return_date`/`return_time` (never guessed: missing or unparseable -> **no leg**) |
| status | source status mapped as before | same, `cancelled` if the source is cancelled |
| provenance + totals | `source_kind/origin/authenticated`; **original total, currency, settlement and commission preserved verbatim in cents** on both legs | same |

Reconciliation (all tested): **repeated sync** = no change; **return edited** (date/time/location) -> the SAME return row updates, arrival untouched, and vice versa; **return removed or incomplete at the source** -> the SAME leg is
**cancelled** (never deleted, never duplicated), the arrival says `missing_return_details`, any applied credit is released; **restored** -> the same leg comes back; **return details missing from the start** -> no leg is invented;
**source cancellation** -> both legs cancelled; **arrival completed** -> the upcoming return stays live and still reconciles even though the arrival row is terminal-locked.

**Stated assumption (unconfirmed by the source):** the source has one booking-level status. When it says `completed` while the return pickup is still in the future, Marau treats it as the **outbound** being complete and keeps the return live,
recording `leg_note = source_status_completed_while_return_upcoming`. This needs confirming with the source team.

**Still unsupported (reported, never guessed):** a round trip that does not start at an airport; two separate bookings "explicitly linked" (the source has no such field, any link-looking field is ignored); a source reader that omits the itinerary fields
(rows classify `unclassified` and are ineligible); non-FJD quotes (never allocated).

## 4. Return-leg value (Task 2)

The return leg's value is **never** the full quote and **never** an arbitrary share. Each return leg is `leg_value_status='unresolved'` (`RETURN_VALUE_UNRESOLVED`) until an **approved allocation rule** resolves it:

* rules: `percent_of_total` (basis points, 0 < p < 100) or `fixed_return_fjd`; they are **proposed -> approved -> retired**; a proposal does nothing;
* **the API can only ever record a `synthetic_preview` approval** (an `owner` basis in the body is ignored) and a synthetic-preview rule **never resolves a record that arrived through an authenticated source** - real records stay unresolved until an owner-basis approval exists, which no API in this codebase can create;
* applying a credit to an unresolved return returns **409 `RETURN_VALUE_UNRESOLVED`** (with the reason `no_approved_allocation_rule` or `source_currency_not_fjd`), changes nothing, and the staff listing shows the return as a target with **no fare**;
* once allocated, the credit is bounded by the **leg value** (unused part reported) and by the **booking balance**; retiring a rule returns *unapplied* legs to unresolved and never touches an applied credit.
* **Booking balance:** the fare object is `scope: round_trip_booking` - **original booking total (both legs), credit, amount due**, identical from either leg, `operator_payout_unchanged: true`; the operator figures are preserved and **never shown to the guest** (tested: the guest trip carries no settlement, commission or provenance).

## 5. Acceptance journey (Task 3) - evidence

One source booking with arrival + return -> Marau trip with both legs -> qualifying referred purchase (paid + fulfilled) -> credit **applied only to the return** (arrival refused) -> accurate balance (170 / 10 / 160) -> repeated sync changes nothing ->
return time edited (credit stays on the same leg) -> return removed (leg cancelled, credit released, balance back to 170). Variants: arrival already completed, return in the past (refused), missing return details (credit has nowhere to land and staff are told `RETURN_DETAILS_MISSING`), source cancellation.

| Class | Result |
|---|---|
| LOCAL, AUTHOR-RUN | Marau **385/385** (incl. `marau_roundtrip_legs` 18, `marau_deals_pilot` 7); engine 247/247; Nadi 111/111. Red baseline: `docs/evidence/roundtrip_legs_RED_baseline_rc1.txt` (19/19 red) |
| HOSTED SYNTHETIC | `scripts/hosted_roundtrip_journey.mjs` **29/29**, run **twice consecutively** on the shared preview DB, Worker `11b19336-421c-4c00-98d7-2e9e40a8bed5` (`marau-stage1-preview-legs`, D1 `marau-stage1-legs-db`). Transient network failures during earlier attempts were retried and reported; two script bugs (shared-DB state) were fixed |
| BROWSER | Local 127.0.0.1 demo server (`scripts/local_pilot_demo_server.mjs`, test tokens, in-memory SQLite): the guest app shows **both legs** of a mirrored round trip; the staff console **deals-pilot panel** was driven by real taps (approve -> prepare -> "I sent it" -> recorded by `Ana (demo ops)`). **Not** done on the hosted legs preview (the staff console needs tokens typed into a non-local page) and **not** a real phone |
| PHYSICAL PHONE | none; RC1 acceptance is available now (see the phone walkthrough) |

## 6. Demonstration vs real (Task 4)

`test_data` is an **output of provenance, never an input**. Every mirror row records `source_kind`, `source_origin`, `source_authenticated`. `test_data` becomes 0 **only** when the read came through the authenticated adapter **and** the integration is approved
(`MARAU_REAL_SOURCE_APPROVED=1`, set nowhere); authenticated provenance alone changes nothing. **Live reward eligibility** additionally requires the referrer's trip to carry authenticated, approved provenance: hand-flipping `test_data` to 0 on demonstration records
earns **nothing** in live mode (tested), and live mode itself stays un-settable via the API (owner approval + `MARAU_ALLOW_LIVE_REWARDS`).

## 7. The human-led deals pilot (Task 5)

What it is: a staff workflow, API + `/staff` panel, for **manual** editions. **No automatic send, no scheduler, no live messaging, no outbound call** (default-deny network in the tests; `worker.scheduled` absent).

1. **Review** a *published* edition: live availability per offer (`open | sold_out | expired | deadline_passed | withdrawn | unavailable`), consent-eligible recipients (same rule as `sendDecision`: consent granted + usable, unsuppressed channel) with the reasons others are excluded. Approving needs >= 1 open offer; the availability seen is stored with the named reviewer.
2. **Prepare** the recipient list (needs an approved review; idempotent).
3. **Record** what a person did by hand: `prepared -> sent_manually | not_sent`, `sent_manually -> replied | bounced | opted_out`, `replied -> opted_out`. Each step is attributed and idempotent (original operator kept). **Re-checked at the moment a send is recorded**: withdrawn consent, a new suppression, or no open offer blocks it.
4. Outcomes feed the existing controls: a **bounce** records a delivery-failure suppression on that channel; an **opt-out** withholds marketing consent (logged) and records a marketing opt-out. Guests cannot read any of it.

### Pilot decisions for James (proposals, NOT assumed facts)

| Decision | Proposal to react to | Status |
|---|---|---|
| Sender identity | a named Marau/Vakaviti WhatsApp Business number vs a staff phone vs email only | **OPEN - not chosen** |
| Staff owner per edition/slot | one named owner per Fiji date + slot (morning/afternoon) | **OPEN** |
| Confirmation rota | who confirms offer requests, records payment evidence and answers replies, and when (Fiji hours) | **OPEN** |
| Message text and consent wording | approved template per edition; promotional consent wording and what "opt out" means | **OPEN** |
| Volume cap per send and quiet hours | e.g. a maximum recipient count per edition | **OPEN** |
| Fallback when WhatsApp is unavailable | email by a named owner (the data supports it) | **OPEN** |

## 8. Return-value and booking-path decisions for James

1. The **approved allocation rule** for the return leg (percent of the round-trip total, a fixed return value, or a source change that records a separate return amount). Until then every real return leg stays `RETURN_VALUE_UNRESOLVED`.
2. Who may **approve** a rule for real records (owner-basis approval does not exist in the API by design).
3. Confirm with the source team the **booking-level `completed`** meaning for round trips.
4. Whether to ask the source to **store `trip_type`** and a **separate return amount** (a source change; would remove the need for an allocation rule).
5. Currency: non-FJD quotes are never allocated - decide the conversion rule or keep them manual.
