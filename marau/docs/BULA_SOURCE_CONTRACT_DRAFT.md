# Bula booking-mirror source contract — DRAFT (isolated; no production change proposed to be applied)

Inspected: real Nadi checkout (`ceo/nadi-booking-read-itinerary` 7d268e5), `schema.sql` + milestone migrations.

| Field | Authoritative source today | Verdict |
|---|---|---|
| currency, total | `bookings.quoted_currency`, `bookings.quoted_amount` (final saved total) | available, mirrored as-is |
| flight number | `bookings.flight_number` | available |
| passengers | `negotiation_requests.passengers` (joined by `negotiation_requests.booking_id → bookings.id`) | **only for bookings that came through negotiation**; standard bookings carry none |
| luggage | none in any table | not in source |
| add-ons | none | not in source |
| discount | none (only `reference_fare_fjd` vs `guest_proposed_amount_fjd` on negotiation rows; the saved total already reflects the outcome) | not in source; **never infer a discount from fare differences** |

Rules kept: missing stays `NULL` + `availability = not_in_source`; no quantity/discount inference; total is the source's saved total, never recomputed.

Proposed additions (to be separately approved before any production application):
1. Read-only reader extension: `passengers` via the existing negotiation join (nullable). Provenance: `{kind:'nadi_dispatch_api', field:'negotiation_requests.passengers', joined_by:'booking_id'}`.
2. If luggage / add-ons / discount are wanted for guests, the NAT booking flow must first CAPTURE them (new nullable columns + validation + capture in the booking form). That is a production schema/flow change and is NOT started.
3. Contract test: a source row with each optional field present/absent/wrong-typed (already in `m2_offers_snapshot.test.mjs`).
