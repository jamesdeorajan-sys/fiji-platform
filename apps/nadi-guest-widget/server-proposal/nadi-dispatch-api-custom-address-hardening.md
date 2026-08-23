# Proposed hardening for `nadi-dispatch-api` — custom-address pricing

**Status: proposal only. Not deployed. This file changes nothing in production.**
Validated locally against a Python port of the same formulas
(`../local-dev/pricing_lib.py`) and a mock API
(`../local-dev/mock_nadi_dispatch_api.py`, `../local-dev/run_tests.py` — 10/10
checks pass, including a reproduction of the exact under-pricing manipulation
this patch closes).

## The gap (confirmed in E3A/E3B, current live behavior)

`POST /quote` already resolves a custom address correctly and safely: it calls
the real Google Routes API server-side, caches the result in
`geocoded_addresses`, and returns `needs_manual_confirmation` if it can't
establish a confident route. That part is already solid.

`POST /bookings` (`createBookingRecord`'s custom-address branch, currently in
production) does **not** reuse that resolved quote. It instead re-derives a
coarse reference from `computeAuthoritativePrice()` — a fixed-zone-pair
formula — and only **logs** a warning if the client's submitted
`quoted_amount` falls outside 0.7×–3× of that coarse reference. It never
corrects the amount, never overrides the client-submitted `distance_km`, and
never blocks the booking. A client can submit an amount inside that wide band
that is still meaningfully below the real, already-geocoded fare.

## The fix

Require the booking-creation call to identify *which* prior `/quote` it's
completing, and treat that cached, resolved `geocoded_addresses` row as the
sole source of truth for a custom address — never a fresh approximation, and
never the client's own numbers.

### Client change (`app.js`, additive — existing standard-route payload shape unchanged)

`submitMarketplaceBooking()` already has the exact address text in
`state.quoteResult.forAddress` (it's what was sent to `/quote` moments
earlier). Add it to the `POST /bookings` body only when `is_custom_address`
is true:

```diff
   is_custom_address: isCustomAddress,
+  custom_address: isCustomAddress ? state.quoteResult?.forAddress : undefined,
+  custom_address_direction: isCustomAddress ? state.quoteResult?.forDirection : undefined,
```

Standard (non-custom) bookings send neither field — zero change to their
request shape or the prices they receive.

### Server change (`nadi-dispatch-api`, `createBookingRecord`)

Replace the current log-only branch:

```diff
-        } else if (isCustomAddress && !hasTour) {
-          if (quotedAmount < serverFjdDiscounted * 0.7 || quotedAmount > serverFjdDiscounted * 3) {
-            pricingNote = `custom-address quoted_amount (${quotedAmount}) is outside the plausible range for this route (zone-floor reference ${serverFjdDiscounted})`;
-            console.warn(`[pricing-sanity] ${pricingNote} - ${pickupZone} -> ${destinationZone}`);
-          }
-        }
+        } else if (isCustomAddress && !hasTour) {
+          const queryNormalized = `${customAddressDirection || 'from_airport'}:${normalizeAddressQuery(customAddress || '')}`;
+          const cachedQuote = await env.DB.prepare(
+            `SELECT * FROM geocoded_addresses WHERE query_normalized = ? AND outcome = 'resolved'`
+          ).bind(queryNormalized).first();
+          if (!cachedQuote) {
+            const { escalation } = await createEscalation(env, {
+              source: "guest", triggerType: "needs_manual_confirmation",
+              context: `${guestPhone ? `Guest phone: ${guestPhone}. ` : ""}Booking attempted for custom address "${customAddress}" with no matching resolved quote on file.`,
+              sourceIp,
+            });
+            console.warn(`[pricing-hardened] reason_code=no_matching_resolved_quote`);
+            return { ok: false, manualQuoteRequired: true, escalationId: escalation.id,
+                      errors: ["We could not automatically verify this address's price. We've alerted our team and will follow up to confirm your fare."] };
+          }
+          const nearestZone = await findNearestZone(env, cachedQuote.lat, cachedQuote.lng);
+          const serverFare = nearestZone
+            ? await computeFareFjd(env, vehicleType, cachedQuote.distance_km, nearestZone.remote_multiplier)
+            : null;
+          if (serverFare === null) {
+            const { escalation } = await createEscalation(env, {
+              source: "guest", triggerType: "needs_manual_confirmation",
+              context: `${guestPhone ? `Guest phone: ${guestPhone}. ` : ""}Booking attempted for custom address "${customAddress}" - no pricing rule for the resolved distance.`,
+              sourceIp,
+            });
+            console.warn(`[pricing-hardened] reason_code=no_pricing_rule_for_distance`);
+            return { ok: false, manualQuoteRequired: true, escalationId: escalation.id,
+                      errors: ["We could not automatically confirm your fare. We've alerted our team and will follow up."] };
+          }
+          let fare = applyTripTypeMultiplier(serverFare, tripType);
+          fare = applyNightSurcharge(fare, pickupTime);
+          fare = applyExtras(fare, { hasChildSeat, hasSurfboard });
+          const finalServerFjd = computeFinalTotal(fare);
+          if (Math.abs(finalServerFjd - quotedAmount) > 0.01) {
+            console.warn(`[pricing-hardened] reason_code=custom_address_price_overridden_by_server`);
+          }
+          quotedAmount = finalServerFjd;
+          distanceKm = cachedQuote.distance_km;
+        }
```

### What this preserves (Phase 1 requirement)

- Standard/fixed-route bookings: **zero behavior change** — this branch only
  runs when `isCustomAddress === true`.
- Return-trip sanity check, tour-booking sanity check, zone allowlist, rate
  limits, idempotency: untouched.
- The existing `needs_manual_confirmation` pattern, `createEscalation()`, and
  `buildConciergeWhatsAppLink()` are reused exactly as `/quote` already uses
  them — no new mechanism invented.
- Logging uses a short `reason_code` string only; the raw address text goes
  only into the escalation's DB `context` field for human review (same as
  today), never to `console.warn`.

### What changes for guests

A custom-address booking now **always** reflects the exact fare from the
`/quote` the guest already saw on screen — it can no longer drift lower (or
higher) between quote and booking. An address with no matching resolved quote
(e.g. the guest edited the address text after quoting, or typed something
new right before tapping "Book") now produces a clear
`manual_quote_required` outcome and a WhatsApp fallback, instead of silently
accepting whatever number reached the server.

## Not done here

- This has not been applied to any live Worker. Deploying it requires a
  separate, explicit production authorization per the current freeze.
- No staging copy of `nadi-dispatch-api` exists on the account to canary this
  against — that's worth creating before this ever goes live to production
  traffic, and is flagged as a repair item rather than something this task
  invented a workaround for.
