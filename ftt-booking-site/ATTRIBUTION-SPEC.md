# Fiji Revenue Attribution Specification

Status: implementation specification for the existing Fiji Dash / Fiji Tour Transfers booking estate. No production deployment in this commit.

## Objective
Measure which channel creates each booking so paid and organic effort can be moved toward revenue rather than traffic.

## Capture on first landing
Persist these values for the browser session and, where permitted, for 30 days:
- utm_source
- utm_medium
- utm_campaign
- utm_content
- utm_term
- referrer hostname
- landing path
- first_seen_at

## Capture on booking submission
Attach both first-touch and last-touch values to the booking/enquiry record:
- first_source / first_medium / first_campaign / first_content / first_term / first_referrer / first_landing_path / first_seen_at
- last_source / last_medium / last_campaign / last_content / last_term / last_referrer / last_landing_path
- attribution_source: the normalised reporting bucket for the last meaningful acquisition source

Do not put passenger names, phone numbers, emails, booking references, flight numbers or other customer PII into attribution URLs.

## Minimum channel normalisation
- google: google organic or Google Ads
- meta: facebook / instagram / Meta Ads
- chatgpt_ai: chatgpt.com, OpenAI referrals, known AI-referral UTM values
- cometofiji: cometofiji.com
- vakaviti_lagi: vakaviti.ai and Lagi referral hosts
- whatsapp_referral: explicit WhatsApp/referral campaign links
- bookfijitransfers_promo: BookFijiTransfers.com campaign/referral links, including the FJ$39 open-transfer promotion
- direct: no usable referrer or campaign data
- other: everything else retained with raw values

## Campaign-link standard
Use lowercase stable parameters. Examples:
- `?utm_source=google&utm_medium=cpc&utm_campaign=nadi_airport_transfer`
- `?utm_source=meta&utm_medium=paid_social&utm_campaign=coral_coast_transfer&utm_content=creative_01`
- `?utm_source=cometofiji&utm_medium=referral&utm_campaign=natadola_guide`
- `?utm_source=vakaviti&utm_medium=referral&utm_campaign=lagi_transfer`
- `?utm_source=bookfijitransfers&utm_medium=promo&utm_campaign=fj39_open_transfer`

## Server-side storage contract
The bookings table should store explicit nullable TEXT columns so revenue reporting does not depend on browser storage or JSON parsing:
- first_source
- first_medium
- first_campaign
- first_content
- first_term
- first_referrer
- first_landing_path
- first_seen_at
- last_source
- last_medium
- last_campaign
- last_content
- last_term
- last_referrer
- last_landing_path
- attribution_source

All fields are metadata only. They must never participate in fare calculation, dispatch eligibility, idempotency, booking confirmation, or customer-facing truth.

## Revenue dashboard
Daily reporting must show by normalised source:
- qualified enquiries
- bookings
- gross booking value
- operator payout where available
- ad spend where available
- contribution after payout/ad spend
- enquiry-to-booking conversion
- average booking value
- return-transfer attach rate
- tour/activity attach rate

## Rollout guardrails
1. No booking-flow redesign is required.
2. Attribution failure must never block a booking.
3. Existing idempotency and booking-confirmation behaviour remain unchanged.
4. Store attribution server-side with the booking where the backend supports it; client-only storage is not sufficient for revenue reporting.
5. Strip or reject unexpected PII-like query parameters before persisting campaign metadata.
6. Preserve the current human-confirmed booking truth model.
7. Unknown or malformed attribution metadata must be dropped or normalised to `other`; never reject an otherwise-valid booking because of attribution.
8. Do not apply this migration or deploy Worker/app changes to production until isolated preview regression passes.

## Validation
- Google, Meta, ChatGPT, ComeToFiji, Vakaviti/Lagi, BookFijiTransfers promo, WhatsApp/referral and direct test visits each create distinguishable attribution records.
- Refresh/navigation preserves first touch while last touch updates correctly.
- Booking succeeds if attribution capture/storage is unavailable.
- Existing `client_booking_ref` idempotency remains unchanged.
- No PII is added to URLs or analytics payloads.
- Attribution fields do not change quoted amount, settlement amount, dispatch, status or WhatsApp handoff.
