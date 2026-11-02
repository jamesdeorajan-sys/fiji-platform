# Remaining risks and minimum fixes

## Genuine launch blockers (decision HOLD)
1. **No production source feed.** NAT's read-only booking endpoint is undeployed (isolated branch); production Bula cannot learn about real bookings. *Fix:* CEO-approved separate deploy of that read-only endpoint (+ token), verified read-only against one test booking.
2. **No production Bula Worker/D1/config/secrets/staff roster** (nothing to activate). *Fix:* provision per-partner-ready production resources from the hashed 1343f866 bundle with all flags OFF, set secrets, create staff identities, record policy (welcome amount, expiry).
3. **No live email sender** — receipts exist only as captured text, so no real guest gets a private link. *Fix:* decide the delivery path (CEO), implement/verify a sender behind its own flag, test to a James-controlled address only.
4. **Support WhatsApp unverified/unset**; **monitoring/alerting absent**. *Fix:* James verifies the number; add minimal alerting on adapter_failed / outbox failure / invariant query.

## Risks to accept or confirm (not blockers)
- Hosted acceptance evidence is from 2026-11-01 and was not repeated in this gate (no egress); re-run `verify`+`resume` on the PC for a same-day confirmation.
- Mirror refuses real bookings lacking email/phone/price; confirm real data always has them.
- Passengers/luggage/add-ons/discount are not in the source and are shown as unavailable by design.
- Candidate performance at 50+ partners is untested at scale (single isolated D1, synthetic volume).
- Stop-hook "unpushed commits" warnings are stale; remote equals HEAD.
