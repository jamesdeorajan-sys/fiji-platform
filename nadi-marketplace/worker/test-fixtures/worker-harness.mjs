// Runs a Worker source directory (worker.js + pricing.mjs) against an in-memory stand-in for D1 seeded from a read-only
// snapshot of the real zones, pricing_rules, zone_distance_cache and fuel_index tables (pricing-snapshot-2026-09-27.json).
// The pricing path is NOT mocked: computeAuthoritativePrice, the night surcharge, extras, loyalty discount, the
// return sanity check and the 0.8x-1.3x acceptance band all execute from the code in the directory you pass in.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
export const snap = JSON.parse(fs.readFileSync(path.join(here, 'pricing-snapshot-2026-09-27.json'), 'utf8'));

const cache = new Map();
export function loadWorker(dir) {
  if (!cache.has(dir)) cache.set(dir, import(pathToFileURL(path.join(dir, 'worker.js')).href + '?v=' + encodeURIComponent(dir)));
  return cache.get(dir);
}

// A copy of a git revision's worker.js + pricing.mjs in a temp dir (optionally with a pricing.mjs text substitution).
export function materialise({ rev, repoRoot, replacePricing }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-'));
  for (const f of ['worker.js', 'pricing.mjs', 'email_followup.mjs']) {   // email_followup.mjs only exists from Milestone 38 on; older revisions simply do not have it
    let text;
    try {
      text = rev
        ? execFileSync('git', ['show', `${rev}:nadi-marketplace/worker/${f}`], { cwd: repoRoot, maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8')
        : fs.readFileSync(path.join(here, '..', f), 'utf8');
    } catch (err) { if (f === 'email_followup.mjs') continue; throw err; }
    if (f === 'pricing.mjs' && replacePricing) { const [a, b] = replacePricing; if (!text.includes(a)) throw new Error('replacePricing target not found: ' + a); text = text.replace(a, b); }
    fs.writeFileSync(path.join(dir, f), text);
  }
  return dir;
}

export function makeEnv({ settings = {} } = {}) {
  const inserted = [];
  const writes = [];
  const escalations = [];
  const events = [];
  const unmatched = new Set();
  let nextId = 5000;
  const zoneNames = snap.zones.map((z) => z.name);
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  function run(sql, args) {
    const s = norm(sql);
    if (!/^SELECT/i.test(s)) writes.push(s.slice(0, 120));
    if (/^SELECT name FROM zones$/i.test(s)) return { all: { results: zoneNames.map((name) => ({ name })) } };
    let m;
    if (/^SELECT lat, lng(, remote_multiplier)? FROM zones WHERE name = \?$/i.test(s)) {
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
    if (/^SELECT \* FROM bookings WHERE client_booking_ref = \?$/i.test(s)) return { first: inserted.find((r) => r.client_booking_ref === args[0]) || null };
    if (/^UPDATE admin_notification_state SET state = 'ATTEMPTING'.*RETURNING attempt_count$/i.test(s)) return { first: { attempt_count: 1 } };
    if (/^SELECT value FROM platform_settings WHERE key = \?$/i.test(s)) return { first: settings[args[0]] !== undefined ? { value: settings[args[0]] } : null };
    if ((m = s.match(/^INSERT INTO bookings \(([^)]*)\) VALUES/i))) {
      const cols = m[1].split(',').map((c) => c.trim());
      const row = { id: ++nextId };
      cols.forEach((c, i) => { row[c] = args[i]; });
      inserted.push(row);
      return { run: { success: true, meta: { last_row_id: row.id, changes: 1 } } };
    }
    if (/^SELECT \* FROM bookings WHERE id = \?$/i.test(s)) return { first: inserted.find((r) => r.id === args[0]) || null };
    if ((m = s.match(/^INSERT INTO escalations \(([^)]*)\) VALUES/i))) {
      const cols = m[1].split(',').map((c) => c.trim());
      const row = {}; cols.forEach((c, i) => { row[c] = args[i]; });
      escalations.push(row);
      return { run: { success: true, meta: { last_row_id: escalations.length, changes: 1 } } };
    }
    if ((m = s.match(/^INSERT INTO booking_events \(([^)]*)\) VALUES/i))) {
      const cols = m[1].split(',').map((c) => c.trim()); const row = {}; cols.forEach((c, i) => { row[c] = args[i]; });
      events.push({ ...row, metadata: row.metadata ? JSON.parse(row.metadata) : null });
      return { run: { success: true, meta: { last_row_id: events.length, changes: 1 } } };
    }
    unmatched.add(s.slice(0, 120));
    return { first: null, all: { results: [] }, run: { success: true, meta: { last_row_id: 1, changes: 1 } } };
  }
  const stmt = (sql, args) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => run(sql, args).first ?? null,
    all: async () => run(sql, args).all ?? { results: [] },
    run: async () => run(sql, args).run ?? { success: true, meta: { last_row_id: 1, changes: 1 } },
  });
  return { env: { DB: { prepare: (sql) => stmt(sql, []), batch: async (l) => Promise.all(l.map((x) => x.run())) } }, inserted, escalations, events, writes, unmatched };
}

export async function postBooking(dir, payload) {
  const worker = (await loadWorker(dir)).default;
  const h = makeEnv();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const res = await worker.fetch(new Request('https://api.nadiairporttransfers.com/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', origin: 'https://book.fijidash.com' },
      body: JSON.stringify(payload),
    }), h.env, { waitUntil() {} });
    const body = await res.json().catch(() => null);
    return { status: res.status, body, saved: h.inserted[0] || null, escalations: h.escalations, events: h.events };
  } finally { globalThis.fetch = realFetch; }
}

export const bookingPayload = ({ zone, vehicle, tripType, time, seat, surf, amount }) => ({
  guest_name: 'QA Test', guest_phone: '+61400000000', guest_email: 'qa-test@example.invalid', client_booking_ref: `FD-T${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  pickup_zone: 'Nadi Airport', destination_zone: zone, vehicle_type: vehicle, quoted_currency: 'FJD', quoted_amount: amount, fx_rate_at_booking: 1,
  distance_km: snap.zone_distance_cache.find((r) => r.zone_a === zone || r.zone_b === zone).distance_km,
  payment_method: 'cash', pickup_date: '2026-09-28', pickup_time: time, trip_type: tripType, has_child_seat: seat, has_surfboard: surf, has_tour: false, is_custom_address: false,
});
