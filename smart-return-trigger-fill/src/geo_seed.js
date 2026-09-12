/* Issue #54 Stage 1 (SHADOW MODE) — PLACEHOLDER geography seed.
 *
 * These zone-adjacency and distance figures are illustrative only, sized
 * for the synthetic fixtures in test/fixtures/. They are NOT verified Fiji
 * road distances or drive times and must not be read as operational fact.
 * Replace with ops-verified data before any Stage 2 rollout — until then,
 * every distance/time figure derived from this file is tagged `verified:
 * false` and the matcher/pricing layers must not surface it as a promised
 * number to a customer or in a revenue estimate without that flag.
 */

export const ZONE_ADJACENCY = Object.freeze({
  // zone -> zones considered "nearby" (not identical, but reverse-matchable).
  NAD_AIRPORT: ['NAD_TOWN', 'DENARAU'],
  NAD_TOWN: ['NAD_AIRPORT', 'DENARAU'],
  DENARAU: ['NAD_AIRPORT', 'NAD_TOWN'],
  NATADOLA: ['CORAL_COAST'],
  CORAL_COAST: ['NATADOLA', 'SUVA'],
  SUVA: ['CORAL_COAST'],
});

export const CORRIDOR_GROUPS = Object.freeze({
  'NAD_AIRPORT|DENARAU': 'nadi-denarau-corridor',
  'DENARAU|NAD_AIRPORT': 'nadi-denarau-corridor',
  'NAD_AIRPORT|CORAL_COAST': 'nadi-coral-coast-corridor',
  'CORAL_COAST|NAD_AIRPORT': 'nadi-coral-coast-corridor',
  'CORAL_COAST|SUVA': 'coral-coast-suva-corridor',
  'SUVA|CORAL_COAST': 'coral-coast-suva-corridor',
});

// PLACEHOLDER distances (km) and drive times (minutes). `verified: false`
// on every row — see file header.
const DISTANCE_SEED = [
  { a: 'NAD_AIRPORT', b: 'DENARAU', km: 20, minutes: 30 },
  { a: 'NAD_AIRPORT', b: 'NAD_TOWN', km: 9, minutes: 15 },
  { a: 'NAD_TOWN', b: 'DENARAU', km: 12, minutes: 20 },
  { a: 'NAD_AIRPORT', b: 'CORAL_COAST', km: 60, minutes: 75 },
  { a: 'NATADOLA', b: 'CORAL_COAST', km: 15, minutes: 25 },
  { a: 'CORAL_COAST', b: 'SUVA', km: 130, minutes: 150 },
];

const DISTANCE_TABLE = new Map();
for (const { a, b, km, minutes } of DISTANCE_SEED) {
  DISTANCE_TABLE.set(`${a}|${b}`, { km, minutes, verified: false });
  DISTANCE_TABLE.set(`${b}|${a}`, { km, minutes, verified: false });
}

export function lookupDistance(zoneA, zoneB) {
  if (zoneA === zoneB) return { km: 0, minutes: 0, verified: false };
  return DISTANCE_TABLE.get(`${zoneA}|${zoneB}`) ?? null;
}

export function isNearby(zoneA, zoneB) {
  return (ZONE_ADJACENCY[zoneA] ?? []).includes(zoneB);
}

export function corridorOf(zoneA, zoneB) {
  return CORRIDOR_GROUPS[`${zoneA}|${zoneB}`] ?? null;
}

// Minimum turnaround buffer between a drop-off and the next pickup for the
// same vehicle. Placeholder value pending ops input — see docs/CEO_RELEASE_REPORT.md.
export const MIN_TURNAROUND_MINUTES = 45;
