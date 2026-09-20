"""Offline reconstruction of the deployed nadi-dispatch-api quote-verification rule (no network, no PII).

Reads only ./inputs/*.json (public site data + non-PII pricing tables) and mirrors worker_excerpts.js:
  server_fare = (flagfall + per_km * zone_distance_km) * remote_multiplier
  server_price = loyalty_discount(server_fare)      # 10% off when > FJ$50, rounded like applyLoyaltyDiscount
  client posts the published fare (minus the client's own 10% loyalty discount when > FJ$50)
  if client < 0.8 * server_price or client > 1.3 * server_price  ->  server REPLACES the client amount (stored + alerted)
Scenario modelled: one-way, 10:00 pickup (no night surcharge), no extras, no tour, fixed (published) destination.
NOT modelled: return trips (x1.85 both sides), night pickups, child seat/surfboard extras, custom addresses, FijiDash's own client.
Run:  python recompute.py   ->  writes cells.csv and prints the replaced cells.
"""
import json, csv, os
HERE = os.path.dirname(os.path.abspath(__file__))
J = lambda n: json.load(open(os.path.join(HERE, "inputs", n), encoding="utf-8"))
rules, zones, cache, client = J("pricing_rules.json"), {z["name"]: z for z in J("zones.json")}, J("zone_distance_cache.json"), J("client_routes_and_areas.json")

dist = {}
for c in cache:
    other = c["zone_a"] if c["zone_b"] == "Nadi Airport" else c["zone_b"]
    dist[other] = c["distance_km"]

def fare(vehicle, km, mult):
    r = [x for x in rules if x["vehicle_type"] == vehicle and x["distance_min_km"] <= km and (x["distance_max_km"] is None or km < x["distance_max_km"])]
    r = sorted(r, key=lambda x: -x["distance_min_km"])[0]
    return (r["flagfall_fjd"] + r["base_rate_fjd_per_km"] * km) * mult

def server_loyalty(x):          # applyLoyaltyDiscount(x, false).finalFjd
    if x <= 50:
        return round(x * 100) / 100
    d = round(x * 0.1)          # JS Math.round on a positive number == floor(x + 0.5)
    return round((x - d) * 100) / 100

def js_round(x):
    import math
    return math.floor(x + 0.5)

def client_final(p):            # calculateTotal(): subtotal - round(subtotal*0.1) when subtotal > 50
    return p - js_round(p * 0.1) if p > 50 else p

zone_names = set(client["marketplace_zone_names"])
rows, replaced = [], []
for r in client["routes_data_from_app_js_31a27fb"]:
    area = client["destination_option_data_area_from_index_html_31a27fb"].get(r["destValue"])
    zone = area if area in zone_names else client["area_zone_aliases"].get(area, "NEEDS_LOOKUP")
    if zone not in dist:
        rows.append([r["label"], r["destValue"], area, zone, "", "", "", "", "", "not server-verified by this widget / no cached distance"]); continue
    km, mult = dist[zone], zones[zone]["remote_multiplier"] or 1
    for veh, p in (("sedan", r["s"]), ("minivan", r["v"]), ("minibus", r["m"])):
        c = client_final(p)
        s = server_loyalty(fare(veh, km, mult))
        rep = c < s * 0.8 or c > s * 1.3
        rows.append([r["label"], r["destValue"], area, zone, veh, c, round(s, 2), round(c / s, 3), "REPLACED" if rep else "kept", ""])
        if rep:
            replaced.append((r["label"], veh, c, round(s, 2)))
with open(os.path.join(HERE, "cells.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f); w.writerow(["route", "destValue", "data_area", "server_zone", "vehicle", "client_final_fjd", "server_price_fjd", "client/server", "outcome", "note"]); w.writerows(rows)
print("cells evaluated:", sum(1 for r in rows if r[4]), "| replaced:", len(replaced))
for x in replaced: print("  REPLACED", x)
# worked example for booking #143 (test): zone Nadi, sedan
print("worked example zone Nadi sedan: 5.57 + 3.592*6.844 =", round(5.57 + 3.592 * 6.844, 2), "| client 15 < 0.8*30.15 =", round(0.8 * 30.15, 2))
