"""
Pure-function port of nadi-dispatch-api's pricing.mjs, plus the PROPOSED
custom-address hardening from ../server-proposal/. Ported by hand from the
read-only preserved source (../../worker_bundles/nadi-dispatch-api.multipart,
SHA-256 verified against the live deployment in E3A) so the exact same
constants and formula are exercised locally, without touching the real
Worker or its live D1 database.

This file has two pricing paths side by side, both selectable by the mock
API server, so the "before" and "after" can be tested against the same
fixtures:
  - compute_authoritative_price_CURRENT_PROD  - today's live logic
  - compute_custom_address_price_HARDENED     - the proposed fix
"""
from dataclasses import dataclass

RETURN_MULTIPLIER = 1.85
NIGHT_SURCHARGE = 0.2
DISCOUNT_THRESHOLD_FJD = 50
DISCOUNT_RATE = 0.1
CHILD_SEAT_FJD = 8
SURFBOARD_FJD = 24


def compute_base_fare(flagfall_fjd, base_rate_fjd_per_km, distance_km):
    if flagfall_fjd is None or base_rate_fjd_per_km is None or distance_km is None:
        return None
    return flagfall_fjd + base_rate_fjd_per_km * distance_km


def apply_zone_multiplier(base_fare_fjd, remote_multiplier):
    return base_fare_fjd * (1 if remote_multiplier is None else remote_multiplier)


def apply_trip_type_multiplier(fare_fjd, trip_type):
    return fare_fjd * RETURN_MULTIPLIER if trip_type == "return" else fare_fjd


def is_night_pickup(pickup_time):
    if not pickup_time:
        return False
    try:
        hour = int(str(pickup_time).split(":")[0])
    except ValueError:
        return False
    return hour >= 22 or hour < 6


def apply_night_surcharge(fare_fjd, pickup_time):
    return fare_fjd * (1 + NIGHT_SURCHARGE) if is_night_pickup(pickup_time) else fare_fjd


def apply_extras(fare_fjd, has_child_seat=False, has_surfboard=False):
    total = fare_fjd
    if has_child_seat:
        total += CHILD_SEAT_FJD
    if has_surfboard:
        total += SURFBOARD_FJD
    return total


def apply_loyalty_discount(subtotal_fjd, has_tour=False):
    if has_tour or subtotal_fjd <= DISCOUNT_THRESHOLD_FJD:
        return 0, round(subtotal_fjd, 2)
    discount = round(subtotal_fjd * DISCOUNT_RATE)
    return discount, round(subtotal_fjd - discount, 2)


def compute_final_total(fare_fjd):
    return round(fare_fjd, 2)


# --- pricing_rules table, exact live values queried read-only from
#     nadi-marketplace-db in E3A (2026-08-23) ---
PRICING_RULES = [
    {"vehicle_type": "sedan", "min": 0, "max": 15, "rate": 3.592, "flagfall": 5.57},
    {"vehicle_type": "sedan", "min": 15, "max": 35, "rate": 1.568, "flagfall": 44.19},
    {"vehicle_type": "sedan", "min": 35, "max": 70, "rate": 1.438, "flagfall": 38.75},
    {"vehicle_type": "sedan", "min": 70, "max": 160, "rate": 1.12, "flagfall": 33.65},
    {"vehicle_type": "sedan", "min": 160, "max": 300, "rate": 1.852, "flagfall": -47.67},
    {"vehicle_type": "minivan", "min": 0, "max": 15, "rate": 3.581, "flagfall": 26.91},
    {"vehicle_type": "minivan", "min": 15, "max": 35, "rate": 2.622, "flagfall": 43.54},
    {"vehicle_type": "minivan", "min": 35, "max": 70, "rate": 0.479, "flagfall": 128.92},
    {"vehicle_type": "minivan", "min": 70, "max": 160, "rate": 1.764, "flagfall": 6.22},
    {"vehicle_type": "minivan", "min": 160, "max": 300, "rate": 4.815, "flagfall": -584.33},
    {"vehicle_type": "minibus", "min": 0, "max": 15, "rate": 4.133, "flagfall": 51.17},
    {"vehicle_type": "minibus", "min": 15, "max": 35, "rate": 2.622, "flagfall": 73.54},
    {"vehicle_type": "minibus", "min": 35, "max": 70, "rate": 0.956, "flagfall": 139},
    {"vehicle_type": "minibus", "min": 70, "max": 160, "rate": 1.576, "flagfall": 66.96},
    {"vehicle_type": "minibus", "min": 160, "max": 300, "rate": 1.852, "flagfall": 132.33},
]


def find_pricing_rule(vehicle_type, distance_km):
    matches = [
        r for r in PRICING_RULES
        if r["vehicle_type"] == vehicle_type and r["min"] <= distance_km < r["max"]
    ]
    return max(matches, key=lambda r: r["min"]) if matches else None


def compute_fare_fjd(vehicle_type, distance_km, remote_multiplier=1):
    rule = find_pricing_rule(vehicle_type, distance_km)
    if not rule:
        return None
    base = compute_base_fare(rule["flagfall"], rule["rate"], distance_km)
    return compute_final_total(apply_zone_multiplier(base, remote_multiplier))


# --- ZONES fixture: sanitized, matches real zone NAMES/relative distances
#     only - no real addresses, no real coordinates beyond what's needed for
#     the nearest-zone haversine calc, all "lat/lng" values below are
#     deliberately rounded/offset from real ones (fixture data, not real). ---
ZONES = {
    "Nadi Airport": {"lat": -17.75, "lng": 177.44, "remote_multiplier": 1.0},
    "Denarau": {"lat": -17.77, "lng": 177.38, "remote_multiplier": 1.0},
    "Coral Coast": {"lat": -18.20, "lng": 177.70, "remote_multiplier": 1.1},
}


def compute_authoritative_price_CURRENT_PROD(pickup_zone, destination_zone, vehicle_type,
                                              trip_type="one-way", pickup_time=None,
                                              has_child_seat=False, has_surfboard=False,
                                              fixed_zone_distance_km=12.0):
    """Ports computeAuthoritativePrice() - used for BOTH fixed-hotel bookings
    (correctly) and, today, as the reference for custom-address bookings too
    (the actual gap: it has no idea the destination is a free-text address,
    only a zone name, so it can only ever approximate)."""
    fare = compute_fare_fjd(vehicle_type, fixed_zone_distance_km, ZONES.get(destination_zone, {}).get("remote_multiplier", 1.0))
    if fare is None:
        return None
    fare = apply_trip_type_multiplier(fare, trip_type)
    fare = apply_night_surcharge(fare, pickup_time)
    fare = apply_extras(fare, has_child_seat, has_surfboard)
    return compute_final_total(fare)


def compute_custom_address_price_HARDENED(geocoded_distance_km, nearest_zone_remote_multiplier,
                                           vehicle_type, trip_type="one-way", pickup_time=None,
                                           has_child_seat=False, has_surfboard=False):
    """PROPOSED fix: uses the SAME geocoded_distance_km already produced by a
    prior, real /quote call for this exact address (server-side Maps
    resolution) - never a client-submitted distance, never the coarse
    fixed-zone approximation above."""
    fare = compute_fare_fjd(vehicle_type, geocoded_distance_km, nearest_zone_remote_multiplier)
    if fare is None:
        return None
    fare = apply_trip_type_multiplier(fare, trip_type)
    fare = apply_night_surcharge(fare, pickup_time)
    fare = apply_extras(fare, has_child_seat, has_surfboard)
    return compute_final_total(fare)
