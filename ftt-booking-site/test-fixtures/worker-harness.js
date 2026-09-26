// Runs the REAL deployed Worker (test-fixtures/worker-deployed-80de8469.mjs) against an in-memory stand-in for D1
// seeded from a read-only snapshot of the real zones, pricing_rules, zone_distance_cache and fuel_index tables.
// Nothing is mocked in the pricing path: computeAuthoritativePrice, applyNightSurcharge, applyExtras,
// applyLoyaltyDiscount and the 0.8x-1.3x acceptance band all execute from the deployed code.
const path = require('path');
const { pathToFileURL } = require('url');
const snap = require('./pricing-snapshot-2026-09-27.json');

let workerPromise;
function loadWorker() {
  workerPromise = workerPromise || import(pathToFileURL(path.join(__dirname, 'worker-deployed-80de8469.mjs')).href);
  return workerPromise;
}

function makeEnv() {
  const inserted = [];
  const unmatched = new Set();
  let nextId = 5000;
  const zoneNames = snap.zones.map((z) => z.name);
  const norm = (s) => s.replace(/\s+/g, ' ').trim();

  function run(sql, args) {
    const s = norm(sql);
    if (/^SELECT name FROM zones$/i.test(s)) return { first: null, all: { results: zoneNames.map((name) => ({ name })) } };
    let m;
    if ((m = s.match(/^SELECT lat, lng(, remote_multiplier)? FROM zones WHERE name = \?$/i))) {
      const z = snap.zones.find((x) => x.name === args[0]);
      return { first: z ? { lat: z.lat, lng: z.lng, remote_multiplier: z.remote_multiplier } : null };
    }
    if (/FROM zone_distance_cache WHERE zone_a = \? AND zone_b = \?/i.test(s)) {
      const row = snap.zone_distance_cache.find((r) => r.zone_a === args[0] && r.zone_b === args[1]);
      return { first: row ? { distance_km: row.distance_km } : null };
    }
    if (/FROM pricing_rules WHERE vehicle_type = \?/i.test(s)) {
      const [veh, d1, d2] = args;
      const rows = snap.pricing_rules.filter((r) => r.vehicle_type === veh && r.active === 1 && r.distance_min_km <= d1 && (r.distance_max_km === null || d2 < r.distance_max_km));
      rows.sort((a, b) => b.distance_min_km - a.distance_min_km);
      return { first: rows[0] ? { base_rate_fjd_per_km: rows[0].base_rate_fjd_per_km, flagfall_fjd: rows[0].flagfall_fjd } : null };
    }
    if (/FROM fuel_index/i.test(s)) return { first: { multiplier: snap.fuel_index_latest[0].multiplier } };
    if (/^SELECT \* FROM bookings WHERE client_booking_ref = \?$/i.test(s)) return { first: null };
    if ((m = s.match(/^INSERT INTO bookings \(([^)]*)\) VALUES/i))) {
      const cols = m[1].split(',').map((c) => c.trim());
      const row = { id: ++nextId };
      cols.forEach((c, i) => { row[c] = args[i]; });
      inserted.push(row);
      return { run: { success: true, meta: { last_row_id: row.id, changes: 1 } } };
    }
    if ((m = s.match(/^SELECT \* FROM bookings WHERE id = \?$/i))) return { first: inserted.find((r) => r.id === args[0]) || null };
    unmatched.add(s.slice(0, 140));
    return { first: null, all: { results: [] }, run: { success: true, meta: { last_row_id: 1, changes: 1 } } };
  }
  const stmt = (sql, args) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => run(sql, args).first ?? null,
    all: async () => run(sql, args).all ?? { results: [] },
    run: async () => run(sql, args).run ?? { success: true, meta: { last_row_id: 1, changes: 1 } },
  });
  const DB = { prepare: (sql) => stmt(sql, []), batch: async (list) => Promise.all(list.map((x) => x.run())) };
  return { env: { DB }, inserted, unmatched };
}

// POST /bookings against the real Worker; returns the amount it would SAVE (quoted_amount column) and the response.
async function saveThroughWorker(payload) {
  const worker = (await loadWorker()).default;
  const { env, inserted, unmatched } = makeEnv();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); // outbound WhatsApp etc.
  try {
    const res = await worker.fetch(new Request('https://api.nadiairporttransfers.com/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', origin: 'https://book.fijidash.com' },
      body: JSON.stringify(payload),
    }), env, { waitUntil() {} });
    const body = await res.json().catch(() => null);
    return { status: res.status, body, saved: inserted[0] || null, unmatched: [...unmatched] };
  } finally {
    globalThis.fetch = realFetch;
  }
}

module.exports = { loadWorker, makeEnv, saveThroughWorker, snap };
