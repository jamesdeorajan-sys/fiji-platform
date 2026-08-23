# Pricing Model

> **The authoritative source of truth for what a guest is actually charged is
> the live `pricing_rules` table in `nadi-marketplace-db` (D1), read by
> `nadi-dispatch-api`'s `computeFareFjd()`.** This document explains and
> mirrors that table — it does not define pricing itself, and if this
> document and the database ever disagree, the database is correct. This
> corrects an earlier version of this file that described itself as the
> single source of truth for a formula the code had already moved on from
> (see "Historical model" below).

## Why this document was corrected

An earlier version of this file (kept below, in "Historical model") described
a distance-*zone*-tiered formula (first 20km, next 40km, 60km+, one flat rate
per zone) with its own constants. That formula no longer matches either the
live client-published prices or the live server. It was superseded, at some
point, by a distance-*bracket* model (five discrete brackets per vehicle
type, each with its own flagfall + per-km rate) without this document being
updated — exactly the drift `docs/DEPLOYMENT.md`'s own troubleshooting
section warned about. Verified by direct computation against real published
routes (Hilton Denarau 12km, Grand Pacific Hotel Suva 198km) during E3A —
both landed within cents of the live published sedan/minivan/minibus prices,
confirming the bracket model below, not the old zone formula, is what's
actually live.

## Live formula (bracket model, matches `pricing_rules` exactly)

```
total = flagfall_fjd + (base_rate_fjd_per_km × distance_km)
      × return_multiplier   (if trip_type == "return")
      × night_surcharge     (if pickup 10pm-6am)
      + add-ons
      − loyalty_discount    (if subtotal > FJ$50, not on tours)
```

`flagfall_fjd` and `base_rate_fjd_per_km` come from the single matching row in
`pricing_rules` for the vehicle type and distance bracket
(`distance_min_km <= distance_km < distance_max_km`), read live, not hardcoded.
Brackets, per the live table (read-only query, 2026-08-23):

| Vehicle | 0–15km | 15–35km | 35–70km | 70–160km | 160–300km |
|---|---|---|---|---|---|
| Sedan | $3.592/km + $5.57 | $1.568/km + $44.19 | $1.438/km + $38.75 | $1.12/km + $33.65 | $1.852/km − $47.67 |
| Minivan | $3.581/km + $26.91 | $2.622/km + $43.54 | $0.479/km + $128.92 | $1.764/km + $6.22 | $4.815/km − $584.33 |
| Minibus | $4.133/km + $51.17 | $2.622/km + $73.54 | $0.956/km + $139.00 | $1.576/km + $66.96 | $1.852/km + $132.33 |

The negative flagfall values in the 160-300km bracket are not an error — they
are the y-intercept of a linear fit across that bracket's range and produce
sane, plausible fares across it (verified: sedan/minivan fares computed from
this table at 198km land within $0.05 of the live published Suva fares).

## Modifiers (confirmed identical across client, server, and this document)

| Modifier | Value | Conditions |
|---|---|---|
| Return trip | × 1.85 | Round-trip booking |
| Night surcharge | × 1.20 | Pickup time 10pm–6am |
| Loyalty discount | − 10% | Subtotal > FJ$50, never on tour bookings |
| Child/baby seat | + FJ$8 | Per seat |
| Surfboard/oversized | + FJ$24 | Per item |

Rounding: final totals are rounded to the nearest cent server-side
(`Math.round(x * 100) / 100`), not up to the nearest FJ$5 as the historical
model described — the nearest-$5 rounding was a client-side display
convention for the *published* route table, not something the server itself
does.

## Negotiation floor

A guest-proposed amount on a negotiation request must be at least
`NEGOTIATION_FLOOR_RATIO` of the real reference fare for that route — this
protects the assigned driver's minimum earnings and is enforced server-side
in `nadi-dispatch-api`, unrelated to the guest-widget's own pricing display.

## Vehicle capacity (unchanged from historical model — still accurate)

| Vehicle | Max passengers | Max luggage |
|---|---|---|
| Sedan | 3 | 3 bags |
| Minivan | 7 | 7 bags |
| Minibus | 12 | 14 bags |

## Server-authoritative behavior (see `../server-proposal/` for the one open gap)

- **Standard/fixed-route bookings:** the server independently recomputes the
  fare from `pricing_rules` and **replaces** the client-submitted amount if
  it falls outside a ±20%/+30% plausibility band. The client's number is
  informational only.
- **Custom-address bookings:** as of this document, the production behavior
  is looser (a wide 0.7×–3× band, logged but not enforced) — see
  `../server-proposal/nadi-dispatch-api-custom-address-hardening.md` for the
  proposed fix that brings this path to the same hard-enforcement standard,
  tested locally, not yet deployed.
- **Return-trip and tour bookings:** a failed sanity check blocks the booking
  and creates a human-review escalation rather than accepting an unverified
  price.

## Historical model (superseded — kept for reference only, not authoritative)

```javascript
// Superseded zone-tiered formula. Values were being read from this comment
// in the client's own app.js source as recently as this recovery. Do not
// use these constants for anything - they do not match the live database.
const TIER_HISTORICAL = {
  sedan:   { base: 25, z1: 2.50, z2: 2.10, z3: 1.50 },
  minivan: { base: 35, z1: 3.50, z2: 2.80, z3: 1.95 },
  minibus: { base: 50, z1: 5.00, z2: 4.00, z3: 2.80 }
};
// Zone 1: 0-20km, Zone 2: 20-60km, Zone 3: 60km+
```
Example of the drift this caused: Hilton Denarau (12km, sedan) — historical
formula gives $55; the live bracket model and the live published price both
land at $49.
