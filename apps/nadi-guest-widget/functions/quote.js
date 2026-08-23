// apps/nadi-guest-widget/functions/quote.js
// Preview-only mock of nadi-dispatch-api's POST /quote. No D1, no KV, no
// outbound fetch, no persistence beyond this one response. See
// _mock-pricing.js's header for exactly what "no persistence" means here.
import { computeFareFjd, fixtureGeocode } from './_mock-pricing.js';

const VEHICLE_TYPES = ['sedan', 'minivan', 'minibus'];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (String(env.PREVIEW_MODE || '').toLowerCase() !== 'true') {
    // This route only exists to serve the isolated preview. If it's ever
    // reached outside PREVIEW_MODE (e.g. a future real deploy of this same
    // codebase without the mock functions removed), refuse rather than
    // silently answering with fake data.
    return json({ ok: false, error: 'mock endpoint disabled outside PREVIEW_MODE' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON.' }, 400);
  }

  const address = (body.address || '').toString().trim();
  const direction = (body.direction || 'from_airport').toString();
  const vehicleType = (body.vehicle_type || '').toString().toLowerCase();

  if (!address) return json({ ok: false, errors: ['address is required'] }, 400);
  if (!VEHICLE_TYPES.includes(vehicleType)) {
    return json({ ok: false, errors: [`vehicle_type must be one of: ${VEHICLE_TYPES.join(', ')}`] }, 400);
  }

  // Deliberate deterministic failure-state trigger for QA - never reachable
  // by an ordinary guest, only by a tester who types this exact phrase.
  if (address.toLowerCase().includes('force_api_error')) {
    return json({ ok: false, error: 'Simulated upstream failure (QA trigger).' }, 500);
  }

  const fixture = fixtureGeocode(direction, address);
  if (!fixture.resolved) {
    return json({
      ok: true,
      outcome: 'needs_manual_confirmation',
      message: 'Could not confirm this address automatically. Our team will follow up to confirm your fare.',
      whatsapp_link: null, // preview: WhatsApp control is disabled, see index.html banner
    });
  }

  const fare = computeFareFjd(vehicleType, fixture.distanceKm, fixture.remoteMultiplier);
  return json({
    ok: true,
    outcome: 'resolved',
    distance_km: fixture.distanceKm,
    nearest_zone: { name: fixture.zoneName, remote_multiplier: fixture.remoteMultiplier },
    vehicle_type: vehicleType,
    quoted_fare_fjd: fare,
    preview: true,
  });
}
