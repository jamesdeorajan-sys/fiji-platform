# Route Price Truth — canonical contract

Issue: #54 (Stage 1, shadow mode). This is the documented data contract the
three storefronts (nadiairporttransfers.com, bookfijitransfers.com,
book.fijidash.com) can eventually read from instead of holding their own
fare copies. **No storefront is connected to this contract yet.** Stage 1
only defines and validates the shape (`src/route_price_truth.js`,
`migrations/0003_route_price_truth.sql`).

## Shape

```json
{
  "route_id": "nad_airport-denarau-sedan",
  "origin_zone": "NAD_AIRPORT",
  "destination_zone": "DENARAU",
  "vehicle_class": "SEDAN",
  "standard_price": 45.0,
  "acquisition_price": 39.0,
  "return_lock_price": 40.0,
  "smart_match_price": 35.0,
  "live_fill_price": null,
  "operator_payout": 30.0,
  "absolute_floor": 25.0,
  "currency": "AUD",
  "last_verified_at": "2026-09-12T00:00:00Z",
  "pricing_reason": "manual ops entry",
  "offer_expiry": null,
  "test_data": true
}
```

## Field notes

| Field | Notes |
|---|---|
| `route_id` | Stable id, convention `origin_zone-destination_zone-vehicle_class` (lowercase). |
| `standard_price` / `acquisition_price` | The two public fares storefronts may already show today. This contract does not change either — it only centralizes the number. |
| `return_lock_price` | Fare shown once RETURN_LOCK eligibility is confirmed (`src/pricing.js#isReturnLockEligible`). |
| `smart_match_price` | Never used unless the matcher found a `FEASIBLE` candidate (`src/pricing.js#smartMatchPrice`). |
| `live_fill_price` | Never used unless a real `ACTIVE`/`VALIDATED`/`HELD` `smart_offers` row exists for the route. |
| `operator_payout` / `absolute_floor` | Nullable. While either is null, every price-recommendation function in `src/pricing.js` returns `HOLD_UNKNOWN_FLOOR` instead of guessing. |
| `last_verified_at` | Who/when confirmed these numbers are real — not auto-populated by any code path in Stage 1. |
| `pricing_reason` | Free text audit trail for why a number is what it is. |
| `offer_expiry` | Only meaningful for the fare classes tied to a live `smart_offers` row. |
| `test_data` | `true` for every row this branch has ever written; must be `false`-only rows before any of this feeds a real customer price. |

## Hard rules enforced by `validateRoutePriceTruthEntry`

- `route_id`, `origin_zone`, `destination_zone`, `vehicle_class`, `currency` are required.
- Every price field, if present, must be a non-negative number.
- No price field may be below `absolute_floor` when `absolute_floor` is set — a route-price-truth row that fails this is rejected, not silently clamped, because the invalid row was presumably meant as ops input and clamping would hide the mistake.

## Non-goals for this branch

- Not wired to NadiAirportTransfers.com's live booking JS.
- Not wired to any Cloudflare D1 binding — `createD1Store` in `src/db.js` implements this schema for Stage 2 but is never invoked here.
- No auto-population of `operator_payout` / `absolute_floor` — those are entered by ops, not inferred.
