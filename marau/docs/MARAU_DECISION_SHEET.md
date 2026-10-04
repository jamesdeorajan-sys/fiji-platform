# Marau - decision sheet for James (round-trip pilot readiness)

**Everything below is a recommendation. Nothing is approved. All live allocation and all reward policy remain DISABLED:** rewards are OFF on every preview, live mode cannot be set through any API, no owner-basis
allocation approval exists, and no real record can resolve a return value.

## A. Technical blockers (engineering/ops - not commercial)

| # | Blocker | Why it blocks | Owner |
|---|---|---|---|
| T1 | Deploy the Nadi read endpoint `GET /admin/bookings/:id` (`ceo/nadi-booking-read-itinerary`, `7d268e5`, not deployed) | without it Marau cannot read a real round trip | release gate (James) |
| T2 | Production Marau Worker + D1 + migrations 0035-0043 (none exist) | there is nothing to deploy to | release gate |
| T3 | Nadi milestone38 (attempt identity) | operator identity stays `service-asserted`, not authenticated | release gate |
| T4 | Mirror rows `test_data = 0` + owner-approved provenance path | live eligibility needs it; no approved path exists | release gate |
| T5 | Physical-phone evidence (camera QR scan, real iOS/Android) | partial: form, journey choices, arrival/return fields seen; saved dates, reopening, QR, link switching open | James (checklists) |
| T6 | Source team to confirm what booking-level `completed` means for a round trip | Marau now treats it as **uncertain** and requires staff verification, so this is no longer a hidden assumption - but confirming it removes the manual step | source team |

## B. Commercial decisions (yours)

| # | Decision | Recommendation |
|---|---|---|
| C1 | **How the return leg is priced** (the credit's target value) | **For FUTURE bookings: price the return explicitly at the source.** Have the booking path store a separate return amount (and a `trip_type`) next to the single quote, computed by the same pricing that produces the round-trip total (the site already derives it: round trip = about 1.85 x one-way). Marau then reads the recorded amount: no rule, nothing to approve, nothing arbitrary. |
| C2 | **Existing bookings** (no separate return amount) | **Controlled staff allocation, not a blanket rule.** You approve ONE envelope once (e.g. "a return is worth between X% and Y% of the booking total"); a named staff member then records an allocation for each booking **within the envelope, with evidence**, reviewed by a second person above a threshold. Marau keeps `RETURN_VALUE_UNRESOLVED` until that record exists. *Not built:* today only a global synthetic-preview rule exists; per-booking staff allocation is optional later work and would be built only after you approve an envelope. |
| C3 | Reward terms (amount, cap, minimum purchase, stage, payment-in-full) | decide only when C1/C2 are settled; FJ$10/FJ$20 were illustrations |
| C4 | Partial-refund rule (today any refund reverses the whole credit) and who records payment evidence | keep conservative until payment evidence has an owner |
| C5 | Pilot sender (WhatsApp Business number vs staff phone vs email), named staff owner per edition, confirmation rota, message text, consent wording, send cap, quiet hours | one named owner per Fiji date + slot; email fallback by that owner; text approved once per edition |
| C6 | Who may verify an uncertain return status | any named staff member for now; require a second named person once volume grows |
| C7 | wa.me handoff on/off and destination number | off until a number is chosen |
| C8 | Non-FJD quotes | keep manual (never allocated) until a conversion rule exists |

## C. Optional later work (not needed for a first pilot)

* per-booking staff allocation within an approved envelope (see C2);
* scheduled/automatic edition delivery and a real sender (the next commercial milestone - **not started**; the app cannot send);
* a source-side change that stores `trip_type` and the return amount (C1) - also removes most of the round-trip special-casing in Marau;
* explicit linking of two separate bookings (the source has no such field);
* automatic sweep timer (today recovery happens on the next staff/guest read).

## D. What the pilot can and cannot do (so nobody over-trusts it)

The app **cannot technically prevent** a message sent outside it. It re-checks consent, suppression, offers and edition expiry immediately before staff copy a message and withholds the text if any fails; it invalidates stale prepared
entries; and it records what staff actually did - a send made after consent changed is **recorded and flagged `contrary_to_eligibility`**, never refused or hidden, and never confused with `not_sent`.
