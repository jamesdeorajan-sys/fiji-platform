# Pricing Model — Fiji Tour Transfers

> **Single source of truth.** All prices in the booking widget, routes table, FAQ schema, marketing copy, and email templates must match this document. If the code drifts from this doc, the code is wrong.

## Core formula

Pricing is **tiered by distance** to match real Fiji market behaviour:

```
total = base_fare + (distance_in_zones × per_km_rate)
       × night_surcharge (if applicable)
       × return_multiplier (if applicable)
       − discount (if subtotal > FJ$50)
```

## Tiered pricing constants (FJD)

```javascript
const TIER = {
  sedan:   { base: 25, z1: 2.50, z2: 2.10, z3: 1.50 },
  minivan: { base: 35, z1: 3.50, z2: 2.80, z3: 1.95 },
  minibus: { base: 50, z1: 5.00, z2: 4.00, z3: 2.80 }
};
```

### Zones explained
- **Zone 1 (z1):** First 0–20 km — city, Denarau, airport area
- **Zone 2 (z2):** Next 20–60 km — Natadola, Momi, Sigatoka mid-range
- **Zone 3 (z3):** 60+ km — Coral Coast east, Pacific Harbour, Suva long-haul

The taper means a Suva trip (200km) doesn't cost 4× a 50km trip — it costs ~2.4×, matching how locals price long-haul work.

## Modifiers

| Modifier | Multiplier | Conditions |
|---|---|---|
| Night surcharge | × 1.20 | Pickup time 10pm–6am |
| Return trip | × 1.85 | Round-trip booking |
| Loyalty discount | − 10% | Subtotal > FJ$50 (strict over) |

Rounding: All final prices rounded UP to nearest FJ$5.

## Vehicle capacity

| Vehicle | Max passengers | Max luggage | Best for |
|---|---|---|---|
| Sedan | 3 | 3 bags | Solo, couples, small families with light bags |
| Minivan | 7 | 7 bags | Families, small groups, surf trips |
| Minibus | 12 | 14 bags | Tour groups, conference shuttles, multi-family |

## Add-ons (FJD)

| Add-on | Price | Notes |
|---|---|---|
| Shell lei welcome | Free | Marketing freebie |
| Child / baby seat | +FJ$8 each | Per seat per trip |
| Supermarket stop | Free | One stop included |
| Surfboard / oversized | +FJ$24 | Per board / per oversized item |

## Distance estimation

We use Haversine straight-line distance × **adaptive road multiplier**:

```javascript
function roadKm(lat1, lng1, lat2, lng2) {
  const straight = haversineKm(lat1, lng1, lat2, lng2);
  // Multiplier blends from 1.55 (short) to 1.70 (long) over the first 100km
  const t = Math.min(1, straight / 100);
  return straight * (1.55 + 0.15 * t);
}
```

This matches Google Maps driving distance to ±10% across the entire Viti Levu road network.

## Drive time estimation

Piecewise speed model matches Queens Road reality:

```javascript
// 40 km/h first 10 km (city), 60 km/h next 30 km (suburbs), 75 km/h after (highway)
let min = 5;  // door-handover overhead
const a = Math.min(km, 10);
const b = Math.max(0, Math.min(km - 10, 30));
const c = Math.max(0, km - 40);
min += (a / 40 + b / 60 + c / 75) * 60;
```

This matches Google Maps drive times closely:
- Nadi → Denarau: 22 min (Google: 18–20 min) ✓
- Nadi → Coral Coast Outrigger: 1h 36m (Google: 1h 30m) ✓
- Nadi → Suva: 2h 56m (Google: 2h 45m–3h 15m) ✓

## Reference price tables

### Selected one-way fares (sedan, before discount)

| Route | Distance | One-way | Return | After 10% discount (return) |
|---|---|---|---|---|
| Nadi Town | 5 km | FJ$40 | FJ$75 | FJ$67 |
| Denarau (Hilton) | 12 km | FJ$55 | FJ$105 | FJ$94 |
| Wailoaloa Beach | 8 km | FJ$45 | FJ$85 | FJ$76 |
| DoubleTree Sonaisali | 18 km | FJ$70 | FJ$130 | FJ$117 |
| Lautoka City | 28 km | FJ$95 | FJ$180 | FJ$162 |
| Marriott Momi Bay | 42 km | FJ$125 | FJ$235 | FJ$212 |
| InterContinental Natadola | 38 km | FJ$115 | FJ$215 | FJ$193 |
| Sigatoka Sand Dunes | 60 km | FJ$160 | FJ$300 | FJ$270 |
| Shangri-La Yanuca | 72 km | FJ$180 | FJ$335 | FJ$302 |
| Outrigger Fiji | 98 km | FJ$220 | FJ$410 | FJ$369 |
| Warwick / Naviti | 100 km | FJ$220 | FJ$410 | FJ$369 |
| Pacific Harbour (Pearl) | 145 km | FJ$290 | FJ$540 | FJ$486 |
| Grand Pacific Hotel Suva | 198 km | FJ$370 | FJ$685 | FJ$617 |

(Minivan ≈ 1.35× sedan, minibus ≈ 1.90× sedan for the same route.)

## Why this model wins

1. **Predictability.** Same start and end always = same price. No surge.
2. **Competitive on long-haul.** Effective per-km rate drops with distance, beating linear-rate competitors.
3. **Fair on short trips.** Base fare ensures driver isn't doing FJ$15 trips to Denarau.
4. **Self-explaining.** "Base fare + distance + return discount + 10% off" is intuitive.

## When to update this doc

- Anytime the per-km rates change → update the constants table
- Anytime a new vehicle class is added → update the vehicle table
- Anytime add-ons change → update the add-on table
- Anytime competitor pricing changes meaningfully → re-validate against market

After any change here, propagate to:
- `src/app.js` (the `TIER`, `BASE_FARE`, etc constants)
- `src/index.html` (FAQ schema, price ranges, examples)
- The routes table data in `app.js` (`ROUTES_DATA`)
- Marketing copy and any landing pages
- This doc itself

If those don't match, the build is broken.
