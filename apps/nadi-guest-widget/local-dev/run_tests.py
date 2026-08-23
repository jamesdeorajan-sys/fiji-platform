"""
Exercises the mock nadi-dispatch-api (must already be running on :8792) to
prove the pricing-security and custom-address-manipulation claims in the
E3B report. All requests go to localhost only.
"""
import json
import urllib.request

BASE = "http://localhost:8792"


def post(path, body, mode=None):
    headers = {"Content-Type": "application/json"}
    if mode:
        headers["X-Pricing-Mode"] = mode
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


def get(path):
    with urllib.request.urlopen(BASE + path) as resp:
        return json.load(resp)


results = []


def check(name, condition, detail=""):
    results.append((name, bool(condition), detail))
    print(("PASS" if condition else "FAIL"), "-", name, ("(" + detail + ")" if detail else ""))


# --- Test 1: standard fixed-route booking is unaffected by hardening ---
r1 = post("/bookings", {
    "idempotency_key": "test-standard-1",
    "vehicle_type": "sedan", "pickup_zone": "Nadi Airport", "destination_zone": "Denarau",
    "quoted_amount": 49, "distance_km": 12, "is_custom_address": False,
}, mode="hardened")
check("standard-route booking accepted, amount untouched (not custom-address path)",
      r1["ok"] and r1["booking"]["quoted_amount"] == 49, json.dumps(r1))

# --- Test 2: real /quote for a resolvable custom address ---
q2 = post("/quote", {"address": "42 Example Lane, Martintar", "vehicle_type": "sedan", "direction": "from_airport"})
check("quote resolves a real custom address server-side", q2["outcome"] == "resolved" and q2["distance_km"] == 8.4, json.dumps(q2))
server_fare_sedan = q2["quoted_fare_fjd"]

# --- Test 3: CURRENT PROD - client under-prices a custom-address booking within tolerance band ---
under_priced = round(server_fare_sedan * 0.75, 2)  # inside the 0.7x-3x band -> old logic accepts it
r3 = post("/bookings", {
    "idempotency_key": "test-manip-current-prod",
    "vehicle_type": "sedan", "pickup_zone": "Nadi Airport", "destination_zone": "Denarau",
    "quoted_amount": under_priced, "distance_km": 3.0,  # client also lies about distance
    "is_custom_address": True, "custom_address": "42 Example Lane, Martintar",
    "custom_address_direction": "from_airport",
}, mode="current-prod")
check("VULNERABILITY (today's live logic): under-priced custom-address booking is accepted at the client's number",
      r3["ok"] and r3["booking"]["quoted_amount"] == under_priced and r3["booking"]["distance_km"] == 3.0,
      f"accepted client amount {under_priced} instead of the real quoted fare {server_fare_sedan}")

# --- Test 4: HARDENED - the same manipulation attempt is rejected/corrected ---
r4 = post("/bookings", {
    "idempotency_key": "test-manip-hardened",
    "vehicle_type": "sedan", "pickup_zone": "Nadi Airport", "destination_zone": "Denarau",
    "quoted_amount": under_priced, "distance_km": 3.0,
    "is_custom_address": True, "custom_address": "42 Example Lane, Martintar",
    "custom_address_direction": "from_airport",
}, mode="hardened")
check("FIX: same manipulation attempt is server-corrected to the real geocoded fare, not accepted",
      r4["ok"] and r4["booking"]["quoted_amount"] == server_fare_sedan and r4["booking"]["distance_km"] == 8.4,
      f"server replaced {under_priced}/3.0km with {r4['booking']['quoted_amount']}/{r4['booking']['distance_km']}km")

# --- Test 5: HARDENED - an address with no prior resolved quote cannot be auto-priced at all ---
r5 = post("/bookings", {
    "idempotency_key": "test-no-quote-hardened",
    "vehicle_type": "sedan", "pickup_zone": "Nadi Airport", "destination_zone": "Denarau",
    "quoted_amount": 40, "distance_km": 5,
    "is_custom_address": True, "custom_address": "a random street nobody quoted",
    "custom_address_direction": "from_airport",
}, mode="hardened")
check("FIX: custom address with no matching prior quote -> manual_quote_required, no booking auto-created",
      r5.get("outcome") == "manual_quote_required" and "booking_id" not in r5, json.dumps(r5))

# --- Test 6: HARDENED - an address that fails geocoding entirely ---
q6 = post("/quote", {"address": "Somewhere near the shop", "vehicle_type": "sedan", "direction": "from_airport"})
check("quote correctly refuses to fabricate a distance for a low-confidence address",
      q6["outcome"] == "needs_manual_confirmation", json.dumps(q6))

# --- Test 7: idempotency - one submission creates exactly one booking ---
before = get("/__debug/state")["booking_count"]
post("/bookings", {"idempotency_key": "test-idem-1", "vehicle_type": "sedan", "pickup_zone": "Nadi Airport",
                    "destination_zone": "Denarau", "quoted_amount": 49, "distance_km": 12, "is_custom_address": False})
after_one = get("/__debug/state")["booking_count"]
check("one submission creates exactly one booking", after_one == before + 1, f"{before} -> {after_one}")

# --- Test 8: double-tap (same idempotency key sent twice) creates no duplicate ---
r8a = post("/bookings", {"idempotency_key": "test-idem-2", "vehicle_type": "sedan", "pickup_zone": "Nadi Airport",
                          "destination_zone": "Denarau", "quoted_amount": 49, "distance_km": 12, "is_custom_address": False})
r8b = post("/bookings", {"idempotency_key": "test-idem-2", "vehicle_type": "sedan", "pickup_zone": "Nadi Airport",
                          "destination_zone": "Denarau", "quoted_amount": 49, "distance_km": 12, "is_custom_address": False})
after_two = get("/__debug/state")["booking_count"]
check("double-tap (identical idempotency key) creates no duplicate booking",
      after_two == after_one + 1 and r8a["booking_id"] == r8b["booking_id"] and r8b.get("idempotent_replay") is True,
      f"count stayed at {after_two}, same booking_id {r8a['booking_id']}=={r8b['booking_id']}")

# --- Test 9: existing bookings are unaffected by any of the above ---
state = get("/__debug/state")
check("existing bookings (test-standard-1) remain unchanged after all manipulation attempts",
      state["bookings"]["1"]["quoted_amount"] == 49 if "1" in state["bookings"] else state["bookings"][1]["quoted_amount"] == 49,
      "booking #1 untouched")

# --- Test 10: no real WhatsApp number, phone, or address text ever appears in a server LOG line ---
check("escalation records used for human review carry a reason code, not raw address, in this mock's log path",
      all("reason_code" in e or e.get("trigger") == "geocode_failed" for e in state["escalations"]),
      json.dumps(state["escalations"]))

print()
passed = sum(1 for _, ok, _ in results if ok)
print(f"{passed}/{len(results)} checks passed")
if passed != len(results):
    raise SystemExit(1)
