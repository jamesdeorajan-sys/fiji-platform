# REVENUE BASELINE

Status: INCOMPLETE — RECONCILIATION REQUIRED
Last updated: 2026-08-15

## North Star
**Profitable confirmed bookings per week**

## Historical evidence retained
Repository documentation previously recorded 44 orders and AUD 13,747.75 across two booking sites for 2026-04-01 through 2026-06-03. Treat as historical proof of transactions, not as current performance and not as proof of source-channel ROI without attribution evidence.

## Current baseline
Current weekly values are intentionally marked UNKNOWN until live transaction/account evidence is reconciled.

| Metric | Current value | Evidence status |
|---|---:|---|
| Confirmed bookings/week | UNKNOWN | Must reconcile live systems |
| Booking requests/week | UNKNOWN | Must reconcile live systems |
| Gross booking value/week | UNKNOWN | Must reconcile live systems |
| Contribution/week | UNKNOWN | Cost model missing/incomplete |
| Visitor → confirmed conversion | UNKNOWN | End-to-end instrumentation insufficiently evidenced |
| Average booking value | UNKNOWN | Reconcile current orders |
| Average contribution/booking | UNKNOWN | Reconcile revenue minus operator/driver/payment/discount/refund costs |
| Refund/cancellation rate | UNKNOWN | Reconcile current booking/payment systems |
| Return-transfer attach rate | UNKNOWN | Instrument/derive |
| Tour cross-sell attach rate | UNKNOWN | Instrument/derive |

## Canonical funnel to measure
visitor → quote_started → quote_generated → booking_started → booking_requested → accepted/availability_confirmed → payment_or_pay_later_authorised → booking_confirmed → fulfilled → completed → cancelled/refunded where applicable

Only canonical confirmed state counts toward the booking North Star.

## Minimum attribution envelope
- visitor_id
- session_id
- source
- medium
- campaign
- referrer
- landing_domain
- landing_page
- entity_id
- product_id / route_id
- quote_id
- lead_id
- booking_id
- payment_id
- gross_revenue
- discount
- refund
- payment_fee
- operator_or_driver_cost
- commission
- contribution

## Required Day 1–3 reconciliation
1. FTT current orders and payment flow.
2. NAT current booking-request storage and confirmation process.
3. Fiji Dash current booking/payment/fulfilment records.
4. Identify whether IDs can be reconciled across systems.
5. Identify analytics/GSC/GBP/source attribution available for each Tier-A asset.
6. Establish contribution formula by commercial model without inventing missing costs.

## CEO rule
Do not report channel ROI, conversion or contribution as fact until the denominator and transaction state are verified.
