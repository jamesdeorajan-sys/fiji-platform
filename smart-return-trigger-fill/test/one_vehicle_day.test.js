/* One-vehicle / one-day exercise builder. Synthetic sheets only: opaque ids, no customer data. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, runOneVehicleDay, comparisonRows, summarizeComparison } from '../src/one_vehicle_day.js';

const JOBS_HEAD = 'booking_id,leg,date,start_local_time,from_zone,to_zone,vehicle_class_booked,THIS_VEHICLE? (Y/N),vehicle_ref (any label),passengers,bags,estimated_duration_minutes (real),confirmed_by,confirmed_at,evidence_ref';
const VEH_HEAD = 'item,your answer,notes';
const D = '2026-09-24';
const sheet = (head, rows) => [head, ...rows].join('\n');
const job = (o) => `${o.id},${o.leg ?? 'arrival'},${D},${o.t ?? ''},${o.from ?? ''},${o.to ?? ''},${o.cls ?? 'sedan'},${o.flag ?? ''},${o.veh ?? ''},${o.pax ?? ''},${o.bags ?? ''},${o.dur ?? ''},${o.by ?? ''},${o.at ?? ''},${o.ev ?? ''}`;
const CONF = { by: 'ops:dispatcher-1', at: '2026-09-23T05:00:00+12:00', ev: 'sheet-1' };
const VEHICLE_OK = sheet(VEH_HEAD, [
  'vehicle_ref,Van-1,', 'vehicle_class,sedan,', 'max_passengers,3,', 'max_bags,3,', 'attestation_from (date+time),2026-09-24 00:00,', 'attestation_to (date+time),2026-09-24 23:59,',
  'attestation_statement,YES,', 'turnaround_minutes,30,', 'drive_minutes Nadi Airport -> Denarau,25,', 'drive_minutes Denarau -> Nadi Airport,25,',
]);
const attestFix = (csv) => csv.replace('2026-09-24 00:00', '2026-09-24T00:00').replace('2026-09-24 23:59', '2026-09-24T23:59');

test('parseCsv handles BOM, quotes, commas and CRLF', () => {
  const rows = parseCsv('﻿a,b\r\n"x,1","he said ""hi"""\r\n');
  assert.deepEqual(rows, [{ a: 'x,1', b: 'he said "hi"' }]);
});

test('the blank templates as sent produce all-unknown inputs: the untouched pre-filled attestation sentence is NOT an attestation', () => {
  const vehicle = sheet(VEH_HEAD, ['vehicle_ref,,', 'vehicle_class,,', 'max_passengers,,', 'max_bags,,', 'attestation_from (date+time),,', 'attestation_to (date+time),,', 'attestation_statement,I confirm the jobs sheet lists EVERY job for that vehicle,type YES', 'turnaround_minutes,,']);
  const { summary } = runOneVehicleDay({ jobsCsv: sheet(JOBS_HEAD, [job({ id: '11', t: '09:00', from: 'Nadi Airport', to: 'Denarau' })]), vehicleCsv: vehicle, date: D });
  const s1 = summary.section1_input_completeness_and_contradictions;
  assert.equal(s1.vehicle_sheet_answered.attestation_statement, false);
  assert.equal(s1.jobs.unanswered, 1);
  assert.equal(summary.section2_verified_movements_and_sold_return_matches.verified_movements, 0);
  assert.equal(summary.section3_hypothetical_vs_operationally_feasible.operationally_feasible, 0);
  assert.match(summary.interpretation, /not evidence of zero/i);
});

test('a completed day: arrival on the vehicle, a sold return on another vehicle and one on this vehicle -> chain + DIFFERENT_VEHICLE, commercial held separately', () => {
  const jobs = sheet(JOBS_HEAD, [
    job({ id: '11', t: '09:00', from: 'Nadi Airport', to: 'Denarau', flag: 'Y', veh: 'Van-1', pax: 2, bags: 2, dur: 60, ...CONF }),
    job({ id: '12', leg: 'return', t: '14:00', from: 'Denarau', to: 'Nadi Airport', flag: 'N', pax: 2, bags: 1, dur: 30, ...CONF }),
    job({ id: '13', leg: 'return', t: '16:00', from: 'Denarau', to: 'Nadi Airport', flag: 'Y', veh: 'Van-1', pax: 1, bags: 0, dur: 30, ...CONF }),
  ]);
  const { summary } = runOneVehicleDay({ jobsCsv: jobs, vehicleCsv: attestFix(VEHICLE_OK), date: D });
  assert.equal(summary.section2_verified_movements_and_sold_return_matches.verified_movements, 3);
  assert.equal(summary.section2_verified_movements_and_sold_return_matches.sold_reverse_chains, 1);
  assert.equal(summary.section2_verified_movements_and_sold_return_matches.rejection_reason_counts.DIFFERENT_VEHICLE, 1);
  assert.deepEqual(summary.section4a_operational_holds, {});
});

test('a completed day with no sold return: hypothetical becomes operationally feasible, and the commercial hold is reported separately', () => {
  const jobs = sheet(JOBS_HEAD, [job({ id: '11', t: '09:00', from: 'Nadi Airport', to: 'Denarau', flag: 'Y', veh: 'Van-1', pax: 2, bags: 2, dur: 60, ...CONF })]);
  const { summary } = runOneVehicleDay({ jobsCsv: jobs, vehicleCsv: attestFix(VEHICLE_OK), date: D });
  const s3 = summary.section3_hypothetical_vs_operationally_feasible;
  assert.equal(s3.hypothetical_empty_legs, 1);
  assert.equal(s3.operationally_feasible, 1);
  assert.equal(s3.ready_for_dispatch_review, 0);
  assert.deepEqual(summary.section4a_operational_holds, {});
  assert.equal(summary.section4b_commercial_holds.ECONOMICS_UNKNOWN, 1);
});

test('contradictions are counted: overlapping jobs on the vehicle (incl. turnaround), invalid inputs, class and capacity conflicts, wrong vehicle label', () => {
  const jobs = sheet(JOBS_HEAD, [
    job({ id: '11', t: '09:00', from: 'Nadi Airport', to: 'Denarau', flag: 'Y', veh: 'Van-1', pax: 2, bags: 2, dur: 60, ...CONF }),
    job({ id: '12', t: '09:15', from: 'Momi Bay', to: 'Nadi Airport', flag: 'Y', veh: 'Van-1', pax: 6, bags: 1, dur: 30, ...CONF, cls: 'minivan' }),
    job({ id: '13', t: '9am', from: 'Nadi Airport', to: 'Denarau', flag: 'Y', veh: 'Van-2', pax: -1, bags: 1, dur: 0, ...CONF }),
  ]);
  const c = runOneVehicleDay({ jobsCsv: jobs, vehicleCsv: attestFix(VEHICLE_OK), date: D }).summary.section1_input_completeness_and_contradictions.contradictions;
  assert.ok(c.overlapping_job_pairs_on_vehicle_incl_turnaround >= 1);
  assert.equal(c.invalid_time, 1);
  assert.equal(c.invalid_duration, 1);
  assert.equal(c.invalid_load, 1);
  assert.equal(c.class_mismatch_vs_vehicle, 1);
  assert.equal(c.load_over_capacity, 1);
  assert.equal(c.vehicle_ref_mismatch, 1);
});

test('missing confirmation fields are counted per field and the movement is not verified', () => {
  const jobs = sheet(JOBS_HEAD, [job({ id: '11', t: '09:00', from: 'Nadi Airport', to: 'Denarau', flag: 'Y', veh: 'Van-1', pax: 2, bags: 2, dur: 60, by: 'ops:x' })]);
  const { summary } = runOneVehicleDay({ jobsCsv: jobs, vehicleCsv: attestFix(VEHICLE_OK), date: D });
  const m = summary.section1_input_completeness_and_contradictions.missing_fields_on_vehicle_jobs;
  assert.equal(m.confirmed_at, 1);
  assert.equal(m.evidence_ref, 1);
  assert.equal(summary.section2_verified_movements_and_sold_return_matches.verified_movements, 0);
  assert.ok(summary.section2_verified_movements_and_sold_return_matches.not_verified_reason_counts.BAD_CONFIRMED_AT >= 1);
});

test('other-job rows on the vehicle count as commitments and can block the empty leg', () => {
  const jobs = sheet(JOBS_HEAD, [
    job({ id: '11', t: '09:00', from: 'Nadi Airport', to: 'Denarau', flag: 'Y', veh: 'Van-1', pax: 2, bags: 2, dur: 60, ...CONF }),
    job({ id: 'OTHER-JOB-1', leg: 'other', t: '10:40', from: 'Nadi Airport', to: 'Lautoka', veh: 'Van-1', dur: 60, ...CONF, cls: 'sedan' }),
    job({ id: 'OTHER-JOB-2', leg: '' }),
  ]);
  const { summary } = runOneVehicleDay({ jobsCsv: jobs, vehicleCsv: attestFix(VEHICLE_OK), date: D });
  assert.equal(summary.section1_input_completeness_and_contradictions.jobs.other_job_rows_used, 1);
  assert.equal(summary.section1_input_completeness_and_contradictions.jobs.other_job_rows_blank, 1);
  assert.equal(summary.section3_hypothetical_vs_operationally_feasible.operationally_feasible, 0);
  assert.ok(summary.section4a_operational_holds.VEHICLE_CONFLICT >= 1);
});

test('the summary is aggregate-only: no booking ids, confirmer, evidence pointers or zones-with-times leak', () => {
  const jobs = sheet(JOBS_HEAD, [job({ id: '9931', t: '09:00', from: 'Nadi Airport', to: 'Denarau', flag: 'Y', veh: 'Van-1', pax: 2, bags: 2, dur: 60, by: 'ops:secret-name', at: CONF.at, ev: 'evidence-XYZ' })]);
  const text = JSON.stringify(runOneVehicleDay({ jobsCsv: jobs, vehicleCsv: attestFix(VEHICLE_OK), date: D }).summary);
  assert.doesNotMatch(text, /9931|secret-name|evidence-XYZ|Van-1/);
});

test('ops comparison: private rows are generated per proposed leg and aggregated after ops answer Y/N', () => {
  const jobs = sheet(JOBS_HEAD, [job({ id: '11', t: '09:00', from: 'Nadi Airport', to: 'Denarau', flag: 'Y', veh: 'Van-1', pax: 2, bags: 2, dur: 60, ...CONF })]);
  const { report } = runOneVehicleDay({ jobsCsv: jobs, vehicleCsv: attestFix(VEHICLE_OK), date: D });
  const rows = comparisonRows(report);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].proposed, 'HYPOTHETICAL empty leg');
  const filled = [{ ...rows[0], 'vehicle_actually_free (Y/N)': 'N', 'matches_reality (Y/N)': 'N' }, { ...rows[0], 'vehicle_actually_free (Y/N)': 'Y', 'matches_reality (Y/N)': 'Y' }, { ...rows[0] }];
  assert.deepEqual(summarizeComparison(filled), { proposed_legs: 3, vehicle_actually_free_yes: 1, vehicle_actually_free_no: 1, matches_reality_yes: 1, matches_reality_no: 1, unanswered: 1 });
});
