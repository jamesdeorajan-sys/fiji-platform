"""
Mock nadi-dispatch-api - reproduces the documented POST /quote and
POST /bookings contract for local testing only. In-memory, non-persistent,
no real Google Maps key, no real WhatsApp number, no real D1. Resets on
restart.

Two pricing modes, selectable per-request via the X-Pricing-Mode header:
  - "current-prod" : ports today's live custom-address behavior (log-only
    0.7x-3x tolerance against a coarse fixed-zone reference; client-submitted
    price/distance accepted if within that band)
  - "hardened"     : the PROPOSED fix (custom-address price/distance always
    replaced by the server's own geocoded-quote-derived number; if no valid
    prior quote exists for the address, the booking is refused and a
    manual_quote_required record is created instead)

This lets the same test scenario be run against both and diffed.
"""
import http.server
import json
import re
import sys
import uuid

sys.path.insert(0, __file__.rsplit("/", 1)[0] if "/" in __file__ else ".")
import pricing_lib as pl

# --- in-memory state (fixture-only, wiped on restart) ---
BOOKINGS = {}
IDEMPOTENCY_INDEX = {}  # idempotency_key -> booking_id
GEOCODED_ADDRESSES = {}  # normalized "direction:address" -> quote result
ESCALATIONS = []
NEXT_ID = [1]

MAX_QUOTE_DISTANCE_KM = 300


def normalize_address_query(raw):
    return re.sub(r"\s+", " ", (raw or "").strip().lower())


# --- sanitized fixture "geocoding" — deterministic, no real Maps call ---
FIXTURE_GEOCODE = {
    # A real, resolvable custom address a guest might type.
    "from_airport:42 example lane, martintar": {
        "resolved": True, "distance_km": 8.4, "nearest_zone": "Denarau", "remote_multiplier": 1.0,
    },
    # An address that cannot be confidently resolved (garbage / too vague).
    "from_airport:somewhere near the shop": {
        "resolved": False,
    },
}


def json_response(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("[mock-nadi-api] " + (fmt % args) + "\n")

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return None

    def do_POST(self):
        mode = self.headers.get("X-Pricing-Mode", "hardened")
        if self.path == "/quote":
            return self._handle_quote()
        if self.path == "/bookings":
            return self._handle_bookings(mode)
        json_response(self, 404, {"ok": False, "error": "unknown route"})

    def _handle_quote(self):
        body = self._read_json()
        if body is None:
            return json_response(self, 400, {"ok": False, "error": "Invalid JSON."})
        address = (body.get("address") or "").strip()
        direction = body.get("direction", "from_airport")
        vehicle_type = body.get("vehicle_type", "sedan")
        if not address:
            return json_response(self, 400, {"ok": False, "errors": ["address is required"]})
        key = f"{direction}:{normalize_address_query(address)}"
        fixture = FIXTURE_GEOCODE.get(key)
        if fixture is None:
            # Unknown-to-fixture address: treat as "cannot establish a route"
            # rather than fabricating a plausible-looking distance - this
            # mirrors the real callGoogleRoutesApi()'s low-confidence path.
            fixture = {"resolved": False}
        GEOCODED_ADDRESSES[key] = fixture
        if not fixture["resolved"]:
            ESCALATIONS.append({"trigger": "geocode_failed", "address": "[REDACTED-IN-LOG]", "raw_context_for_human_review": address})
            return json_response(self, 200, {
                "ok": True, "outcome": "needs_manual_confirmation",
                "message": "Could not confirm this address automatically.",
                "whatsapp_link": "https://wa.me/<CONCIERGE_NUMBER_NOT_A_REAL_SECRET_IN_THIS_MOCK>",
            })
        fare = pl.compute_fare_fjd(vehicle_type, fixture["distance_km"], fixture["remote_multiplier"])
        return json_response(self, 200, {
            "ok": True, "outcome": "resolved", "distance_km": fixture["distance_km"],
            "nearest_zone": {"name": fixture["nearest_zone"], "remote_multiplier": fixture["remote_multiplier"]},
            "vehicle_type": vehicle_type, "quoted_fare_fjd": fare,
        })

    def _handle_bookings(self, mode):
        body = self._read_json()
        if body is None:
            return json_response(self, 400, {"ok": False, "error": "Invalid JSON."})

        idem_key = body.get("idempotency_key")
        if idem_key and idem_key in IDEMPOTENCY_INDEX:
            existing_id = IDEMPOTENCY_INDEX[idem_key]
            return json_response(self, 200, {"ok": True, "booking_id": existing_id, "booking": BOOKINGS[existing_id], "idempotent_replay": True})

        vehicle_type = body.get("vehicle_type", "sedan")
        trip_type = body.get("trip_type", "one-way")
        pickup_time = body.get("pickup_time")
        has_child_seat = bool(body.get("has_child_seat"))
        has_surfboard = bool(body.get("has_surfboard"))
        is_custom_address = bool(body.get("is_custom_address"))
        client_quoted_amount = float(body.get("quoted_amount", 0))
        client_distance_km = body.get("distance_km")
        destination_zone = body.get("destination_zone", "")

        pricing_note = None
        final_amount = client_quoted_amount
        final_distance = client_distance_km

        if is_custom_address:
            custom_address = (body.get("custom_address") or "").strip()
            direction = body.get("custom_address_direction", "from_airport")
            key = f"{direction}:{normalize_address_query(custom_address)}"
            cached = GEOCODED_ADDRESSES.get(key)

            if mode == "current-prod":
                # TODAY'S LIVE BEHAVIOR: coarse fixed-zone reference, wide
                # band, LOG-ONLY - never blocks, never corrects.
                reference = pl.compute_authoritative_price_CURRENT_PROD(
                    body.get("pickup_zone", ""), destination_zone, vehicle_type,
                    trip_type, pickup_time, has_child_seat, has_surfboard,
                )
                if reference is not None and not (0.7 * reference <= client_quoted_amount <= 3 * reference):
                    pricing_note = f"pricing-sanity: outside plausible range (reference={reference})"
                    sys.stderr.write(f"[pricing-sanity][current-prod] {pricing_note}\n")
                # amount/distance are NOT corrected - client values pass through untouched.
            else:
                # HARDENED (PROPOSED): require a matching, resolved prior
                # quote; never trust client amount/distance for a custom
                # address at all.
                if not cached or not cached.get("resolved"):
                    ESCALATIONS.append({"trigger": "manual_quote_required", "reason_code": "no_matching_resolved_quote"})
                    return json_response(self, 200, {
                        "ok": True, "outcome": "manual_quote_required",
                        "message": "We could not automatically verify this address's price. Our team will confirm your fare directly.",
                        "whatsapp_link": "https://wa.me/<CONCIERGE_NUMBER_NOT_A_REAL_SECRET_IN_THIS_MOCK>",
                    })
                server_fare = pl.compute_custom_address_price_HARDENED(
                    cached["distance_km"], cached["remote_multiplier"], vehicle_type,
                    trip_type, pickup_time, has_child_seat, has_surfboard,
                )
                if server_fare is None:
                    ESCALATIONS.append({"trigger": "manual_quote_required", "reason_code": "no_pricing_rule_for_distance"})
                    return json_response(self, 200, {"ok": True, "outcome": "manual_quote_required"})
                if abs(server_fare - client_quoted_amount) > 0.01:
                    pricing_note = "reason_code=custom_address_price_overridden_by_server"
                    sys.stderr.write(f"[pricing-hardened] {pricing_note} (client={client_quoted_amount}, server={server_fare})\n")
                final_amount = server_fare
                final_distance = cached["distance_km"]

        booking_id = NEXT_ID[0]
        NEXT_ID[0] += 1
        booking = {
            "id": booking_id, "vehicle_type": vehicle_type, "trip_type": trip_type,
            "quoted_amount": final_amount, "distance_km": final_distance,
            "is_custom_address": is_custom_address, "status": "pending",
            "pricing_note": pricing_note,
        }
        BOOKINGS[booking_id] = booking
        if idem_key:
            IDEMPOTENCY_INDEX[idem_key] = booking_id
        return json_response(self, 201, {"ok": True, "booking_id": booking_id, "booking": booking})

    def do_GET(self):
        if self.path == "/__debug/state":
            return json_response(self, 200, {
                "bookings": BOOKINGS, "escalations": ESCALATIONS, "booking_count": len(BOOKINGS),
            })
        json_response(self, 404, {"ok": False})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8792
    print(f"Mock nadi-dispatch-api on http://localhost:{port} (in-memory, no real backend)")
    http.server.HTTPServer(("0.0.0.0", port), Handler).serve_forever()
