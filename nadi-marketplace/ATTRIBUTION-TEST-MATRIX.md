# Revenue Attribution Preview Test Matrix

Status: PREVIEW ONLY. No production Worker or D1 deployment is authorised by this document.

## Purpose
Prove that source attribution can be captured and persisted without changing booking truth, pricing, idempotency, dispatch, negotiation, or WhatsApp handoff.

## Canonical source buckets
- `google`
- `meta`
- `chatgpt_ai`
- `cometofiji`
- `vakaviti_lagi`
- `whatsapp_referral`
- `bookfijitransfers_promo`
- `direct`
- `other`

## Required browser cases

### A. Google Ads
Entry URL includes `utm_source=google&utm_medium=cpc&utm_campaign=nadi_airport_transfer`.
Expected: first + last source normalise to `google`; campaign retained; no booking UX change.

### B. Meta
Entry URL includes `utm_source=meta&utm_medium=paid_social&utm_campaign=coral_coast_transfer&utm_content=creative_01`.
Expected: normalise to `meta`; content retained.

### C. ChatGPT / AI referral
Entry from `chatgpt.com` or explicit `utm_source=chatgpt`.
Expected: normalise to `chatgpt_ai`.

### D. ComeToFiji
Referrer or UTM identifies `cometofiji.com`.
Expected: normalise to `cometofiji`.

### E. Vakaviti / Lagi
Referrer or UTM identifies `vakaviti.ai` / Lagi.
Expected: normalise to `vakaviti_lagi`.

### F. WhatsApp/referral
Explicit campaign link uses `utm_source=whatsapp` or an approved referral source value.
Expected: normalise to `whatsapp_referral`.

### G. BookFijiTransfers FJ$39 promotion
Use `utm_source=bookfijitransfers&utm_medium=referral&utm_campaign=fj39_open_transfer`.
Expected: normalise to `bookfijitransfers_promo` and preserve campaign `fj39_open_transfer`.

### H. Direct
No usable UTM and no external referrer.
Expected: normalise to `direct`.

### I. Other
Unknown non-empty external referrer/source.
Expected: normalise to `other`; raw safe source/referrer retained within limits.

## First-touch / last-touch behaviour
1. First eligible landing creates first-touch values once.
2. Internal navigation never overwrites first touch.
3. A later external/campaign touch updates last touch only.
4. Refresh does not mutate first touch.
5. Attribution storage failure is swallowed and booking still works.
6. Expired/invalid stored JSON falls back safely.

## PII rejection tests
The following must never be persisted as attribution metadata merely because they appear in a URL/query:
- passenger name
- phone / WhatsApp number
- email address
- booking reference
- flight number
- free-text notes

Unexpected query keys that appear PII-like (`email`, `phone`, `name`, `booking_ref`, `flight`, etc.) must be ignored for attribution. Only the explicit allowlist (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`) may be read from query parameters.

## Server validation tests
1. Server independently clamps all attribution string lengths.
2. Server rejects/normalises unsupported `attribution_source` bucket values to `other` or a safe derived bucket.
3. Server must not trust a client-supplied normalised bucket without validating its raw attribution fields.
4. Missing attribution fields remain nullable and never fail booking validation.
5. Existing booking idempotency path returns the original booking row and does not create a duplicate when a retry carries different last-touch metadata.
6. Attribution fields are not used by pricing, commission, dispatch eligibility, negotiation, status transitions, or booking confirmation.

## Booking regression matrix
Run each after attribution code is enabled in preview:
- Nadi Airport -> Denarau sedan one-way
- Nadi Airport -> Natadola sedan one-way
- Nadi Airport -> Coral Coast return
- custom destination quote
- boat destination if currently supported in preview
- booking retry with same `client_booking_ref`
- failed attribution storage / unavailable localStorage
- unsupported route WhatsApp handoff

For every case verify:
- quoted amount unchanged versus baseline
- `/quote` target unchanged
- `/bookings` target unchanged
- booking success/failure UI semantics unchanged
- WhatsApp URL generation unchanged
- no new PII appears in URLs

## Preview release gate
Do not merge/release until all of the following are demonstrated:
- migration applies cleanly to an isolated D1 copy
- client tests pass for A-I
- server persistence is verified by querying the test booking row
- double-submit/idempotency regression passes
- booking remains successful with attribution unavailable
- no production D1 or Worker changed during validation
