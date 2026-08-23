// nadi-dispatch-api-staging — isolated staging Worker.
//
// Explicitly NOT wired to: production D1, production Maps key, production
// ADMIN_TOKEN, any WhatsApp sending path, any Cron Trigger, any driver
// broadcast, any custom domain. Bindings: DB (nadi-marketplace-staging-db-v2)
// only. No secrets bound at all - there is nothing in this Worker's
// environment for client JavaScript to ever see, satisfying "no
// authentication secret in client JavaScript" trivially (there isn't one).

const VEHICLE_TYPES = ['sedan', 'minivan', 'minibus'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function normalizeAddressQuery(raw) {
  return (raw || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

// Deterministic mock routing - no production Maps API call, ever. Backed by
// the staging DB's own geocoded_addresses fixture table (synthetic data
// only, see schema.sql).
async function fixtureGeocode(env, direction, address) {
  const key = `${direction}:${normalizeAddressQuery(address)}`;
  const row = await env.DB.prepare(
    `SELECT ga.resolved, ga.distance_km, z.name AS zone_name, z.remote_multiplier
     FROM geocoded_addresses ga LEFT JOIN zones z ON z.id = ga.nearest_zone_id
     WHERE ga.query_normalized = ?`
  ).bind(key).first();
  if (!row || !row.resolved) return { resolved: false };
  return { resolved: true, distanceKm: row.distance_km, zoneName: row.zone_name, remoteMultiplier: row.remote_multiplier };
}

async function computeFareFjd(env, vehicleType, distanceKm, remoteMultiplier = 1) {
  const rule = await env.DB.prepare(
    `SELECT base_rate_fjd_per_km, flagfall_fjd FROM pricing_rules
     WHERE vehicle_type = ? AND active = 1 AND distance_min_km <= ? AND (distance_max_km IS NULL OR ? < distance_max_km)
     ORDER BY distance_min_km DESC LIMIT 1`
  ).bind(vehicleType, distanceKm, distanceKm).first();
  if (!rule) return null;
  const base = rule.flagfall_fjd + rule.base_rate_fjd_per_km * distanceKm;
  return Math.round(base * (remoteMultiplier ?? 1) * 100) / 100;
}

const RETURN_MULTIPLIER = 1.85;
const NIGHT_SURCHARGE = 0.2;
const CHILD_SEAT_FJD = 8;
const SURFBOARD_FJD = 24;

function isNightPickup(pickupTime) {
  if (!pickupTime) return false;
  const hour = parseInt(String(pickupTime).split(':')[0], 10);
  return Number.isFinite(hour) && (hour >= 22 || hour < 6);
}
function applyModifiers(fareFjd, { tripType, pickupTime, hasChildSeat, hasSurfboard }) {
  let fare = fareFjd;
  if (tripType === 'return') fare *= RETURN_MULTIPLIER;
  if (isNightPickup(pickupTime)) fare *= 1 + NIGHT_SURCHARGE;
  if (hasChildSeat) fare += CHILD_SEAT_FJD;
  if (hasSurfboard) fare += SURFBOARD_FJD;
  return Math.round(fare * 100) / 100;
}

function syntheticBookingRef() {
  return `STG-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).toUpperCase().slice(2, 6)}`;
}

// Fingerprint: SHA-256 of material booking facts only. Deliberately
// excludes guest_name/guest_phone/notes (the only fields that could carry
// personal data) - Phase 3 requirement 10. The output is a one-way digest;
// none of the input fields can be recovered from it.
async function computeFingerprint(materialFacts) {
  const canonical = JSON.stringify(materialFacts, Object.keys(materialFacts).sort());
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const FIXED_ROUTE_DISTANCE_KM = { Denarau: 12, 'Coral Coast': 90 };

async function handleQuote(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }
  const address = (body.address || '').toString().trim();
  const direction = (body.direction || 'from_airport').toString();
  const vehicleType = (body.vehicle_type || '').toString().toLowerCase();
  if (!address) return json({ ok: false, errors: ['address is required'] }, 400);
  if (!VEHICLE_TYPES.includes(vehicleType)) return json({ ok: false, errors: [`vehicle_type must be one of: ${VEHICLE_TYPES.join(', ')}`] }, 400);

  const geo = await fixtureGeocode(env, direction, address);
  if (!geo.resolved) {
    return json({ ok: true, outcome: 'needs_manual_confirmation', message: 'Could not confirm this address automatically.' });
  }
  const fare = await computeFareFjd(env, vehicleType, geo.distanceKm, geo.remoteMultiplier);
  return json({ ok: true, outcome: 'resolved', distance_km: geo.distanceKm, nearest_zone: { name: geo.zoneName, remote_multiplier: geo.remoteMultiplier }, vehicle_type: vehicleType, quoted_fare_fjd: fare, staging: true });
}

async function handleBookings(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }

  const idemKey = (request.headers.get('Idempotency-Key') || body.idempotency_key || '').toString().trim();
  if (!idemKey) return json({ ok: false, errors: ['Idempotency-Key is required'] }, 400);
  if (!UUID_RE.test(idemKey)) return json({ ok: false, errors: ['Idempotency-Key must be a valid UUID'] }, 400);

  const vehicleType = (body.vehicle_type || '').toString().toLowerCase();
  const tripType = (body.trip_type || 'one-way').toString() === 'return' ? 'return' : 'one-way';
  const pickupTime = body.pickup_time || null;
  const hasChildSeat = body.has_child_seat === true;
  const hasSurfboard = body.has_surfboard === true;
  const isCustomAddress = body.is_custom_address === true;
  const destinationZone = (body.destination_zone || '').toString();
  const pickupZone = (body.pickup_zone || '').toString();
  const clientQuotedAmount = Number(body.quoted_amount);

  const errors = [];
  if (!VEHICLE_TYPES.includes(vehicleType)) errors.push(`vehicle_type must be one of: ${VEHICLE_TYPES.join(', ')}`);
  if (!Number.isFinite(clientQuotedAmount) || clientQuotedAmount <= 0) errors.push('quoted_amount must be a positive number');
  if (errors.length) return json({ ok: false, errors }, 400);

  // ── Material-facts fingerprint (never includes guest_name/guest_phone/notes) ──
  const customAddressNormalized = isCustomAddress ? normalizeAddressQuery(body.custom_address) : null;
  const materialFacts = {
    vehicleType, tripType, pickupZone, destinationZone, isCustomAddress,
    customAddressNormalized, pickupDate: body.pickup_date || null, pickupTime,
    hasChildSeat, hasSurfboard, clientQuotedAmount,
  };
  const fingerprint = await computeFingerprint(materialFacts);

  // ── Idempotency lookup BEFORE any pricing/insert work ──
  const existing = await env.DB.prepare(
    `SELECT booking_reference, quoted_amount, distance_km, pricing_note, idempotency_fingerprint, status FROM bookings WHERE idempotency_key = ?`
  ).bind(idemKey).first();
  if (existing) {
    if (existing.idempotency_fingerprint !== fingerprint) {
      return json({ ok: false, error: 'idempotency_key_reused', message: 'This Idempotency-Key was already used for a different booking.' }, 409);
    }
    return json({
      ok: true, outcome: 'booking_request_created', booking_reference: existing.booking_reference,
      quoted_amount: existing.quoted_amount, distance_km: existing.distance_km, pricing_note: existing.pricing_note,
      status: existing.status, idempotent_replay: true, staging: true,
    }, 200);
  }

  // ── Pricing (server-authoritative, same hardening as the mock) ──
  let finalAmount = clientQuotedAmount;
  let finalDistanceKm = body.distance_km ?? null;
  let pricingNote = null;

  if (isCustomAddress) {
    const direction = (body.custom_address_direction || 'from_airport').toString();
    const geo = await fixtureGeocode(env, direction, body.custom_address);
    if (!geo.resolved) {
      await env.DB.prepare(`INSERT INTO manual_quote_log (reason_code, vehicle_type) VALUES (?, ?)`)
        .bind('no_matching_resolved_quote', vehicleType).run();
      return json({ ok: true, outcome: 'manual_quote_required', message: "We could not automatically verify this address's price.", staging: true });
    }
    const serverFare = applyModifiers(await computeFareFjd(env, vehicleType, geo.distanceKm, geo.remoteMultiplier), { tripType, pickupTime, hasChildSeat, hasSurfboard });
    if (serverFare === null) {
      await env.DB.prepare(`INSERT INTO manual_quote_log (reason_code, vehicle_type) VALUES (?, ?)`)
        .bind('no_pricing_rule_for_distance', vehicleType).run();
      return json({ ok: true, outcome: 'manual_quote_required', staging: true });
    }
    if (Math.abs(serverFare - clientQuotedAmount) > 0.01) pricingNote = 'reason_code=custom_address_price_overridden_by_server';
    finalAmount = serverFare;
    finalDistanceKm = geo.distanceKm;
  } else {
    const refDistance = FIXED_ROUTE_DISTANCE_KM[destinationZone] ?? 12;
    const reference = applyModifiers(await computeFareFjd(env, vehicleType, refDistance, 1), { tripType, pickupTime, hasChildSeat, hasSurfboard });
    if (reference !== null && !(clientQuotedAmount >= 0.8 * reference && clientQuotedAmount <= 1.3 * reference)) {
      pricingNote = 'reason_code=standard_route_price_replaced_by_server';
      finalAmount = reference;
    }
    finalDistanceKm = refDistance;
  }

  const reference = syntheticBookingRef();

  // ── Atomic, durable idempotency: the UNIQUE partial index on
  // idempotency_key is what actually makes this safe under concurrency,
  // not this code path itself. Two isolates racing here will both reach
  // this INSERT; exactly one succeeds, the other hits a UNIQUE constraint
  // violation and is handled by re-reading the winning row below. ──
  try {
    await env.DB.prepare(
      `INSERT INTO bookings (booking_reference, vehicle_type, trip_type, pickup_zone, destination_zone, is_custom_address, custom_address_query, distance_km, quoted_amount, pricing_note, status, idempotency_key, idempotency_fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_confirmation', ?, ?)`
    ).bind(reference, vehicleType, tripType, pickupZone || null, destinationZone || null, isCustomAddress ? 1 : 0, customAddressNormalized, finalDistanceKm, finalAmount, pricingNote, idemKey, fingerprint).run();
  } catch (err) {
    // Lost the race - another isolate's concurrent request already inserted
    // the row for this exact idempotency_key. Re-read and return ITS data,
    // so both the winner and the loser hand the guest the SAME reference.
    const winner = await env.DB.prepare(
      `SELECT booking_reference, quoted_amount, distance_km, pricing_note, idempotency_fingerprint, status FROM bookings WHERE idempotency_key = ?`
    ).bind(idemKey).first();
    if (winner) {
      if (winner.idempotency_fingerprint !== fingerprint) {
        return json({ ok: false, error: 'idempotency_key_reused' }, 409);
      }
      return json({
        ok: true, outcome: 'booking_request_created', booking_reference: winner.booking_reference,
        quoted_amount: winner.quoted_amount, distance_km: winner.distance_km, pricing_note: winner.pricing_note,
        status: winner.status, idempotent_replay: true, race_resolved: true, staging: true,
      }, 200);
    }
    return json({ ok: false, error: 'insert_failed', detail: String(err?.message || err) }, 500);
  }

  return json({
    ok: true, outcome: 'booking_request_created', booking_reference: reference,
    quoted_amount: finalAmount, distance_km: finalDistanceKm, pricing_note: pricingNote,
    status: 'pending_confirmation', staging: true,
  }, 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/quote') return handleQuote(request, env);
    if (request.method === 'POST' && url.pathname === '/bookings') return handleBookings(request, env);
    if (url.pathname === '/health') return json({ ok: true, service: 'nadi-dispatch-api-staging' });
    return json({ ok: false, error: 'not found' }, 404);
  },
};
