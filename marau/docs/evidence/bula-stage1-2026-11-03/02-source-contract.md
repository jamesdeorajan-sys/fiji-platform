# 2. Source contract — field classification from ACTUAL production evidence

Evidence used (read-only, no guest rows read): (a) `sqlite_master` DDL of the production `bookings` / `negotiation_requests` tables (NAT D1 `nadi-marketplace-db`); (b) aggregate counts per creation month (counts only, no values); (c) the deployed Worker's booking-intake validation. Nothing was copied out except counts.

Aggregates (production bookings, 381 rows; test rows included, which I cannot separate):
| month | rows | no email | no phone | no name | no client ref | no date/time | no price | no flight | round trip |
|---|---|---|---|---|---|---|---|---|---|
| 2026-07 | 2 | 2 | 0 | 0 | 2 | 1 | 0 | 2 | 0 |
| 2026-08 | 30 | 30 | 0 | 0 | 30 | 2 | 0 | 30 | 9 |
| 2026-09 | 173 | 6 | 0 | 0 | 5 | 0 | 0 | 45 | 53 |
| 2026-10 | 167 | **0** | 0 | 0 | **0** | 0 | 0 | 16 | 69 |
| 2026-11 (to 3rd) | 9 | **0** | 0 | 0 | **0** | 0 | 0 | 1 | 5 |

| Field | Class | Basis |
|---|---|---|
| booking reference | **GUARANTEED** (`id`, integer primary key — Bula's `source_booking_ref`). `client_booking_ref` is **LEGACY-MISSING** (37 rows before October; none since) | PK; counts |
| guest name | OPTIONAL (nullable column) — not exposed by the endpoint, not needed by Bula | DDL |
| email | **OPTIONAL by code** (intake default `null`, not validated as required); **LEGACY-MISSING** for 38 pre-October rows; present on every booking since 2026-10-01 (0 of 176) | DDL, intake, counts |
| phone / WhatsApp | **GUARANTEED by intake validation** ("a valid guest_phone is required"); column itself is nullable; 0 missing in all 381. Admin test-booking paths can store null | DDL, intake, counts |
| route (pickup/destination zone) | **GUARANTEED** (NOT NULL) | DDL |
| booking date/time | column nullable; **LEGACY-MISSING** (3 rows, Jul–Aug); none missing since September | DDL, counts |
| price | **GUARANTEED** (`quoted_amount` NOT NULL; none ≤ 0) | DDL, counts |
| currency | **GUARANTEED** (NOT NULL) | DDL |
| passengers | **UNKNOWN / not on the booking row.** Only in `negotiation_requests.passengers` (nullable) for negotiated bookings. The endpoint does not return it; Bula shows "unavailable" | DDL |
| flight | **OPTIONAL** (≈10% blank even in October) | counts |
| add-ons | **UNKNOWN — not stored** in any table; any add-on cost is inside `quoted_amount` | DDL |

## What this means for the Bula mirror (behaviour unchanged)
The mirror refuses a booking with no email, phone, or price (HTTP 409 `MISSING_GUEST_CONTACT` / `MISSING_QUOTED_AMOUNT`), writing nothing.
- Price and phone: always present ⇒ no practical impact.
- **Email: the only live exposure.** Since 2026-10-01 every booking has had one, but the code does not require it, and Bula delivers the private link **by email only**. A future booking without an email would be refused by Bula (guest gets no link; NAT is unaffected).
- Legacy rows are irrelevant: Bula only ingests bookings saved after the cutover instant.

## Launch-policy decision required (CEO)
A) **Keep fail-closed (recommended):** bookings without email are not mirrored; monitoring raises a count so ops can contact the guest manually. No invented values. 
B) Make email mandatory at NAT booking intake (a NAT change — separate approval).
C) Add a WhatsApp delivery path (not available; out of scope).
Also needed: a CEO decision on **how Bula learns a booking was saved** — see 07 (no trigger exists).
