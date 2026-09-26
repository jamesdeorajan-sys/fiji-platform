/* CLI check on a synthetic private input: private sheets are written, stdout is aggregate-only, ops confirmations regenerate the proposal. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const row = (o) => ({ id: 0, store: 'FTT', status: 'pending', pickup_date: '2026-09-24', pickup_time: '17:30', pickup_zone: 'Nadi Airport', destination_zone: 'Coral Coast', vehicle_class: 'minivan', distance_km: 96.7,
  return_date: null, return_time: null, return_pickup_location: null, passengers: 4, luggage: 4, assigned_driver_id: null, assigned_vehicle_ref: null, provider_alert_accepted: true, flight_present: true, flags: {}, ...o });
const input = {
  rows: [row({ id: 9001 }), row({ id: 9002, pickup_date: '2026-09-20', pickup_time: '10:00', return_date: '2026-09-24', return_time: '14:00', return_pickup_location: 'Secret Hotel Name' })],
  destinations: [], zone_distance_cache: [], known_zones: ['Coral Coast', 'Nadi Airport'],
  hotel_options: [{ name: 'Secret Hotel Name', zone: 'Coral Coast', source: 'storefront hotel option (data-hotel -> data-area)' }],
};
const run = (extra = []) => {
  const dir = mkdtempSync(join(tmpdir(), 'blcli-'));
  writeFileSync(join(dir, 'in.json'), JSON.stringify(input));
  const stdout = execFileSync(process.execPath, ['scripts/booking_led_plan.js', '--input', join(dir, 'in.json'), '--private-dir', join(dir, 'out'), '--windows', '2026-09-24:2026-09-24', ...extra.map((x) => x.replace('DIR', dir))], { encoding: 'utf8' });
  return { dir, stdout };
};

test('CLI writes the private sheets and prints only aggregates; the location text never reaches stdout', () => {
  const { dir, stdout } = run();
  for (const f of ['return_location_EXCEPTIONS_for_ops_2026-09-24_PRIVATE.csv', 'legs_2026-09-24_PRIVATE.csv', 'competing_alternatives_2026-09-24_PRIVATE.csv', 'allocation_decisions_2026-09-24_PRIVATE.csv', 'unmatched_requests_2026-09-24_PRIVATE.csv'])
    assert.ok(existsSync(join(dir, 'out', f)), f);
  assert.doesNotMatch(stdout, /Secret Hotel Name|9001|9002/);
  const s = JSON.parse(stdout)[0];
  assert.equal(s.potential_pairings.conditional_on_location_confirmation, 1);
  assert.equal(s.competing_alternatives.legs_allocated, 0);
  const sheet = readFileSync(join(dir, 'out', 'return_location_EXCEPTIONS_for_ops_2026-09-24_PRIVATE.csv'), 'utf8');
  assert.match(sheet, /Secret Hotel Name/);          // the private sheet keeps the original text for ops
  assert.match(sheet, /EXACT_STOREFRONT_HOTEL_OPTION/);
  rmSync(dir, { recursive: true, force: true });
});

test('a completed confirmation sheet regenerates the proposal: the pairing stops being conditional', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blcli2-'));
  writeFileSync(join(dir, 'in.json'), JSON.stringify(input));
  writeFileSync(join(dir, 'conf.csv'), 'leg_id,booking_id,suggested_zone,OPS: accept suggestion? (Y/N),OPS: confirmed zone (only if different or no suggestion),OPS: confirmed by,OPS: evidence\nL002,9002,Coral Coast,Y,,ops:tester,sheet-1\n');
  const stdout = execFileSync(process.execPath, ['scripts/booking_led_plan.js', '--input', join(dir, 'in.json'), '--private-dir', join(dir, 'out'), '--windows', '2026-09-24:2026-09-24', '--location-confirmations', join(dir, 'conf.csv')], { encoding: 'utf8' });
  const s = JSON.parse(stdout)[0];
  assert.equal(s.return_location_status.RESOLVED_VIA_OPS_CONFIRMATION, 1);
  assert.equal(s.potential_pairings.confirmed_mapping, 1);
  assert.equal(s.potential_pairings.conditional_on_location_confirmation, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('an incomplete ops confirmation (no confirmer or evidence) does not resolve the location', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blcli3-'));
  writeFileSync(join(dir, 'in.json'), JSON.stringify(input));
  writeFileSync(join(dir, 'conf.csv'), 'leg_id,booking_id,suggested_zone,OPS: accept suggestion? (Y/N),OPS: confirmed zone (only if different or no suggestion),OPS: confirmed by,OPS: evidence\nL002,9002,Coral Coast,Y,,,\n');
  const s = JSON.parse(execFileSync(process.execPath, ['scripts/booking_led_plan.js', '--input', join(dir, 'in.json'), '--private-dir', join(dir, 'out'), '--windows', '2026-09-24:2026-09-24', '--location-confirmations', join(dir, 'conf.csv')], { encoding: 'utf8' }))[0];
  assert.equal(s.return_location_status.RESOLVED_VIA_OPS_CONFIRMATION, undefined);
  assert.equal(s.potential_pairings.conditional_on_location_confirmation, 1);
  rmSync(dir, { recursive: true, force: true });
});
