# Sprint 5 — FJD-first pricing and human + AI support contract

## Approved product language
- Main message: Start your Fiji journey. Book now with confidence.
- All guest-facing prices in Fijian dollars (FJD), formatted as FJ$.
- No silent currency conversion or invented exchange rates.
- Booking request status must say awaiting operator acceptance until operator accepts.
- Planned WhatsApp human + AI chat coverage 24/7, but never claim a human is online unless the channel is configured and availability verified.

## Currency invariant
- FJD is the source currency for tours, dedicated transfers, add-ons, totals, refunds and discount calculations.
- Persist integer FJD cents and currency='FJD' with each immutable quote and booking.
- Always display whether a price is per person, group or vehicle; disclose taxes, inclusions, fees and cancellation policy before request.
- Do not invent transfer prices; use NAT/FijiDash authoritative quote API when integrated.
- Discounts must be applied on the server with explicit eligibility and nonnegative totals.

## Support workflow (not connected)
1. Guest asks question via approved WhatsApp Business integration or web chat.
2. Consent, privacy notice and channel availability check.
3. AI answers routine FAQs only from approved, operator-specific knowledge; confidence threshold and safe fallback.
4. Booking changes, refunds, missing drivers, emergencies, complaints, safety and low-confidence queries go to human team or monitored queue.
5. Support staff sees relevant booking reference with role-scoped access and full audit trail; no unnecessary personal information sent to model.
6. AI may draft responses but cannot accept tours, confirm pending bookings, promise refunds or override operator decisions.
7. Staff handoff and after-hours queue must be monitored; define measurable response targets and emergency guidance before 24/7 marketing goes live.

## Integration prerequisites
- Verify official WhatsApp Business account, consent/template requirements, approved phone number, staff roster, webhook signatures, message retry/deduplication, delivery and escalation.
- Confirm NAT/FijiDash existing production booking status semantics before connecting.
- Do not auto-create WhatsApp groups or message guests without consent and supported API capabilities.
- Run end-to-end tests and obtain explicit CEO production approval.
