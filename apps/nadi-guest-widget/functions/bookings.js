// apps/nadi-guest-widget/functions/bookings.js
// Preview-only mock of nadi-dispatch-api's POST /bookings, implementing the
// PROPOSED hardened custom-address behavior from
// ../server-proposal/nadi-dispatch-api-custom-address-hardening.md (this is
// explicitly authorized in mock/staging form only - the real
// nadi-dispatch-api is untouched). No D1, no KV, no WhatsApp send, no
// persistence beyond this response except the isolate-scoped, non-durable
// idempotency map in _mock-pricing.js.
import { computeFareFjd, applyModifiers, fixtureGeocode, syntheticBookingRef, IDEMPOTENCY_CACHE } from './_mock-pricing.js';

const VEHICLE_TYPES = ['sedan', 'minivan', 'minibus'];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

// Same fixed-zone reference distances the real nadi-dispatch-api's
// computeAuthoritativePrice() would derive for a standard route - hardcoded
// here since there is no D1 zones table in this preview.
const FIXED_ROUTE_DISTANCE_KM = { Denarau: 12, 'Coral Coast': 90 };

export async function onRequestPost(context) {
  const { request, env } = context;
  if (String(env.PREVIEW_MODE || '').toLowerCase() !== 'true') {
    return json({ ok: false, error: 'mock endpoint disabled outside PREVIEW_MODE' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON.' }, 400);
  }

  const idemKey = (body.idempotency_key || '').toString();
  if (idemKey && IDEMPOTENCY_CACHE.has(idemKey)) {
    const existing = IDEMPOTENCY_CACHE.get(idemKey);
    return json({ ok: true, booking_reference: existing, idempotent_replay: true, preview: true }, 200);
  }

  const vehicleType = (body.vehicle_type || '').toString().toLowerCase();
  const tripType = (body.trip_type || 'one-way').toString() === 'return' ? 'return' : 'one-way';
  const pickupTime = body.pickup_time || null;
  const hasChildSeat = body.has_child_seat === true;
  const hasSurfboard = body.has_surfboard === true;
  const isCustomAddress = body.is_custom_address === true;
  const destinationZone = (body.destination_zone || '').toString();
  const clientQuotedAmount = Number(body.quoted_amount);
  const guestName = (body.guest_name || '').toString().trim().slice(0, 200);
  const guestPhone = (body.guest_phone || '').toString().trim();

  const errors = [];
  if (!VEHICLE_TYPES.includes(vehicleType)) errors.push(`vehicle_type must be one of: ${VEHICLE_TYPES.join(', ')}`);
  if (!guestPhone) errors.push('a valid guest_phone is required');
  if (!Number.isFinite(clientQuotedAmount) || clientQuotedAmount <= 0) errors.push('quoted_amount must be a positive number');
  if (errors.length) return json({ ok: false, errors }, 400);

  let finalAmount = clientQuotedAmount;
  let finalDistanceKm = body.distance_km ?? null;
  let pricingNote = null;

  if (isCustomAddress) {
    const customAddress = (body.custom_address || '').toString().trim();
    const direction = (body.custom_address_direction || 'from_airport').toString();
    const fixture = fixtureGeocode(direction, customAddress);

    if (!fixture.resolved) {
      // HARDENED behavior: no matching resolved quote -> refuse the
      // auto-priced booking, return manual_quote_required instead of
      // silently accepting whatever the client sent.
      return json({
        ok: true,
        outcome: 'manual_quote_required',
        message: "We could not automatically verify this address's price. Our team will confirm your fare directly.",
        whatsapp_link: null, // preview: WhatsApp is a disabled, labeled control - see index.html
        preview: true,
      });
    }

    const serverFare = applyModifiers(
      computeFareFjd(vehicleType, fixture.distanceKm, fixture.remoteMultiplier),
      { tripType, pickupTime, hasChildSeat, hasSurfboard }
    );
    if (Math.abs(serverFare - clientQuotedAmount) > 0.01) {
      pricingNote = 'reason_code=custom_address_price_overridden_by_server';
    }
    finalAmount = serverFare;
    finalDistanceKm = fixture.distanceKm;
  } else {
    // Standard/fixed-route: server-authoritative reference, same ±20%/+30%
    // enforcement band as the real nadi-dispatch-api - the client's number
    // is informational only.
    const refDistance = FIXED_ROUTE_DISTANCE_KM[destinationZone] ?? 12;
    const reference = applyModifiers(
      computeFareFjd(vehicleType, refDistance, 1),
      { tripType, pickupTime, hasChildSeat, hasSurfboard }
    );
    if (reference !== null && !(clientQuotedAmount >= 0.8 * reference && clientQuotedAmount <= 1.3 * reference)) {
      pricingNote = 'reason_code=standard_route_price_replaced_by_server';
      finalAmount = reference;
    }
    finalDistanceKm = refDistance;
  }

  const reference = syntheticBookingRef();
  if (idemKey) IDEMPOTENCY_CACHE.set(idemKey, reference);

  // "Retain no customer-entered data after the response": guestName/
  // guestPhone are used only to shape this one response below, never
  // written to IDEMPOTENCY_CACHE (which stores only the key -> reference
  // pair) or logged anywhere.
  return json({
    ok: true,
    outcome: 'booking_request_created',
    booking_reference: reference,
    quoted_amount: finalAmount,
    distance_km: finalDistanceKm,
    pricing_note: pricingNote,
    status: 'pending_confirmation',
    preview: true,
  }, 201);
}
