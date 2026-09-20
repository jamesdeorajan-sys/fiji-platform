/* Issue #54 - private one-vehicle / one-day shadow exercise CLI.
 *   node scripts/one_vehicle_day_exercise.js --jobs JOBS.csv --vehicle VEHICLE.csv --date 2026-09-24 --private-dir DIR
 * Writes ONLY into --private-dir: the sanitized movement file, the full pilot report and the ops comparison sheet.
 * Prints ONLY the aggregate summary (safe to publish). Reads two local CSVs; no network, no D1, no messages.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { runOneVehicleDay, comparisonRows } from '../src/one_vehicle_day.js';

const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const jobs = arg('--jobs'); const vehicle = arg('--vehicle'); const date = arg('--date'); const dir = arg('--private-dir');
if (!jobs || !vehicle || !date || !dir) { console.error('usage: node scripts/one_vehicle_day_exercise.js --jobs JOBS.csv --vehicle VEHICLE.csv --date YYYY-MM-DD --private-dir DIR'); process.exit(2); }
const { summary, report, movements, config } = runOneVehicleDay({ jobsCsv: readFileSync(jobs, 'utf8'), vehicleCsv: readFileSync(vehicle, 'utf8'), date });
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/pilot_input_PRIVATE.json`, JSON.stringify({ config, movements }, null, 2));
writeFileSync(`${dir}/pilot_report_PRIVATE.json`, JSON.stringify(report, null, 2));
const rows = comparisonRows(report);
const head = ['movement_ref', 'proposed', 'from_zone', 'to_zone', 'earliest_start_utc', 'pilot_stage', 'pilot_holds', 'vehicle_actually_free (Y/N)', 'what_the_vehicle_actually_did', 'matches_reality (Y/N)'];
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
writeFileSync(`${dir}/ops_comparison_PRIVATE.csv`, '﻿' + [head.join(','), ...rows.map((r) => [r.movement_ref, r.proposed, r.from_zone, r.to_zone, r.earliest_start_utc, r.pilot_stage, r.pilot_holds, '', '', ''].map(esc).join(','))].join('\n'));
console.log(JSON.stringify(summary, null, 2));
