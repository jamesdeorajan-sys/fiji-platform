# Ops-verified movements — input contract for the seven-day shadow pilot

Status 2026-09-21 (recovery branch). **Nothing here is wired to production, D1 or any storefront.** Issue #54 and Issue #59 share this
need: a trustworthy record that a saved request became a *confirmed, assigned* movement. The real database cannot supply it today
(see `docs/evidence/2026-09-21-smart-return-recovery/RECOVERY_STATUS.md` on `main`: 0 `accepted` events, 1 driver, 1 vehicle, bookings `pending` 106 / `completed` 1).

## Rule
A movement enters the pilot only with a complete, well-formed confirmation record (enforced by `checkConfirmation` in `scripts/seven_day_pilot.js`):
`confirmation.source` is `ops_worksheet` (a named ops person confirmed it) or `system_accepted` (a real `accepted` booking event by `admin` / `driver:<id>`; `confirmed_by` must then be exactly `admin` or `driver:<id>`); **`confirmed_by`** is a non-empty named confirmer (a handle/label, never printed in any report); **`confirmed_at`** is an ISO-8601 timestamp **with a time and zone** (`2026-09-20T05:00:00Z` or `+12:00`; an empty string, a date only, or `WHATIF` is rejected); **`evidence_ref`** is a non-empty pointer to the ops sheet row / message (never the message text). Malformed records are excluded and counted by reason (`not_verified_reason_counts`). **No status is invented, inferred or defaulted:** `pending`, a sent alert, provider acceptance, a quote, or a page view never counts.

## File shape (sanitized; opaque refs; no names, phones, emails, notes, flight numbers, booking references)
```json
{
  "config": {
    "airport_zone": "Nadi Airport",
    "turnaround_minutes": null,
    "vehicle_capacity_confirmed": false,
    "vehicle_capacity": { "sedan": { "pax": 3, "bags": 3 }, "minivan": { "pax": 7, "bags": 7 }, "minibus": { "pax": 12, "bags": 14 } },
    "route_durations_verified": { "Nadi Airport|Denarau": null, "Denarau|Nadi Airport": null },
    "vehicle_availability_attested": { "veh_A": { "from": "2026-09-24T00:00", "to": "2026-09-24T23:59" } },
    "route_price_truth": {
      "Denarau|Nadi Airport|sedan": { "operator_payout_fjd": null, "additional_cost_fjd": null, "absolute_floor_fjd": null, "smart_match_price_fjd": null, "fare_authority_approved": false }
    },
    "contribution_requirement": { "approved": false, "min_fjd": null, "approved_by": null, "approved_on": null }
  },
  "movements": [
    { "movement_ref": "opaque-1", "leg": "arrival", "pickup_zone": "Nadi Airport", "dropoff_zone": "Denarau",
      "pickup_local": "2026-09-22T09:00", "vehicle_class": "sedan", "passengers": 2, "luggage": 2,
      "duration_minutes": null, "assigned_vehicle_ref": null,
      "confirmation": { "source": "ops_worksheet", "confirmed_by": "ops:dispatcher-1", "confirmed_at": "2026-09-21T03:00:00Z", "evidence_ref": "ops-sheet-row-12" } }
  ]
}
```
- Zone names are the real `zones` names (`Nadi Airport`, `Denarau`, `Coral Coast`, `Momi Bay`, `Natadola`, `Pacific Harbour`, `Wailoaloa`, `Vuda Point`, `Sonaisali`, `Lautoka`, `Suva`, `Nadi`).
- `pickup_local` is Fiji wall-clock time; the runner converts it to a UTC instant.
- A round-trip booking row is expanded into two movements (arrival + departure); the return leg's time and zone come from the row's own return fields.
- `passengers`/`luggage`: only integers, from the widget's structured `Passengers:`/`Luggage:` tokens (`src/notes_structured_fields.js`) or from ops. Unknown = `null`.
- `duration_minutes` (or `route_durations_verified` for the route), `assigned_vehicle_ref`, `turnaround_minutes`, capacity table, **`vehicle_availability_attested`** (ops vouch that the supplied movements list EVERY commitment of that vehicle for the period), payout, `additional_cost_fjd`, floor, smart-match price: **`null` until ops-verified.** Each `null` produces a named HOLD, never a guess. The reverse (empty-leg) duration is never assumed equal to the outbound duration.
- `contribution_requirement`: the minimum contribution **James** has approved (`approved: true`, `min_fjd`, `approved_by`). No threshold is invented; without it the commercial verdict is HOLD. Contribution = price - (operator payout + additional cost); the floor must itself cover that cost.
- `fare_authority_approved` stays `false` until James records an approved fare authority for that route; a formula-derived number alone is not approval.

## Mapping from the private ops worksheet (Issue #59)
The worksheet already has the blank columns `operator_saw_alert`, `staff_owner`, `driver_assigned`, `guest_confirmed`, `outcome`. Add
`vehicle_ref`, `confirmed_by`, `confirmed_at`, `evidence_ref`, `trip_duration_minutes` (ops estimate), then build this file locally. One collection effort
serves the #59 measurement stages and this pilot.
