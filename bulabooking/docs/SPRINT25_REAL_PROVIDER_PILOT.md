# Sprint 25 — first real-source pilot

CEO-directed isolated pre-deployment pilot: Fiji Tour Transfers (fijitourtransfers.com) as initial tour provider; Nadi Airport Transfers (nadiairporttransfers.com) as visibly affiliated standalone transfer partner.

## Selected source pages
- 50-minute Natadola horse ride: https://fijitourtransfers.com/tours/natadola-beach-horse-riding-au76/
- 90-minute Natadola horse ride: https://fijitourtransfers.com/tours/natadola-beach-horse-riding-tour-au139-90-minute-ride/
- Natadola cave ride: https://fijitourtransfers.com/tours/natadola-beach-cave-tour-ride/
- Natadola ride and beach massage: https://fijitourtransfers.com/tours/natadola-bay-horse-riding-beach-massage-in-fiji/

Public source prices were AUD, not FJD. Pilot explicitly labels AUD source prices and is noindex. Before production, require provider-approved FJD quotes and correct price basis, current inclusions, booking terms and actual operator attribution. Do not import source-site ratings as verified BulaBooking reviews.

## Partner positioning
NAT is disclosed as affiliated, with relevant transfer CTAs and a clear external booking destination. Avoid misleading transfer inclusion, spammy sitewide links, unsupported superiority claims, or implying that an outbound click is a completed booking.

## Release gates
Verify all links, complete security/privacy review, execute Astro build and test suite, test mobile widths 320/390/430, confirm source URLs remain live, obtain operator approval, decide if tour bookings occur inside BulaBooking or externally, instrument consent-respecting outbound click events, confirm server-time expiry for any promotions, then request CEO deployment approval. No production change.
