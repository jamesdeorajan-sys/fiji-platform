#!/usr/bin/env node
/* Issue #54 Stage 1 (SHADOW MODE) — first live-shadow report generator.
 *
 * READ-ONLY. Makes no database or network call itself: it consumes an
 * array of already-fetched `{ booking, event, passengerCount? }` rows
 * (shaped exactly like the real `bookings` / `booking_events` tables —
 * see src/production_adapter.js's header comment for the exact read-only
 * SQL this is designed against) and produces the 12-point shadow report
 * the mission requires. No customer PII is read from the input rows in
 * the first place (mapConfirmedBookingToMovementInput never touches
 * guest_name/guest_phone/guest_email/flight_number/notes), so none can
 * leak into this report either — see test/production_adapter.test.js and
 * test/live_shadow_report.test.js for the proof.
 *
 * Usage:
 *   node scripts/live_shadow_report.js --input path/to/confirmed_bookings.json --source-site nadiairporttransfers.com
 *
 * Input file shape: a JSON array of
 *   { booking: {...real bookings row...}, event: {...real booking_events row...}, passengerCount?: number }
 *
 * With no --input (or an empty array), this reports zero real movements
 * evaluated and says so explicitly — it never substitutes synthetic data
 * for a real run without being asked to.
 *
 * Requires SMART_RETURN_SHADOW_SECRET (env var) whenever --input has at
 * least one row — see src/production_adapter.js's OPAQUE LINKAGE section.
 * There is no default and no fallback; this script refuses to run rather
 * than invent one.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createMemoryStore } from '../src/db.js';
import { processIncomingMovement } from '../src/pipeline.js';
import { computeMatchCandidates } from '../src/matcher.js';
import { mapConfirmedBookingToMovementInput } from '../src/production_adapter.js';

export async function runLiveShadowReport(confirmedBookingRows, { sourceSite, store = createMemoryStore(), routePriceTruthLookup, shadowSecret } = {}) {
  // Fail closed up front: if there is anything to actually evaluate but no
  // shadow secret was supplied, every row would fail identically anyway
  // (see mapConfirmedBookingToMovementInput's own SHADOW_SECRET_NOT_CONFIGURED
  // path) - refusing here makes that obvious immediately rather than
  // producing a report that quietly skipped everything.
  if (confirmedBookingRows.length > 0 && !shadowSecret) {
    throw new Error(
      'runLiveShadowReport: shadowSecret is required whenever there are rows to evaluate — refusing to run with an unkeyed/absent secret. Pass it via the SMART_RETURN_SHADOW_SECRET env var (CLI) or the shadowSecret option (programmatic use).'
    );
  }

  const skipped = []; // { shadowRef, reason, detail }
  const evaluatedMovements = [];

  for (const row of confirmedBookingRows) {
    const mapped = await mapConfirmedBookingToMovementInput(row.booking, row.event, {
      sourceSite: row.sourceSite ?? sourceSite,
      passengerCount: row.passengerCount,
      estimatedDurationMinutes: row.estimatedDurationMinutes,
      shadowSecret,
    });
    if (!mapped.ok) {
      // Only the opaque shadowRef is ever recorded here — never the raw
      // booking id (see production_adapter.js's own header for why every
      // failure path is designed to carry shadowRef instead).
      skipped.push({ shadowRef: mapped.shadowRef ?? null, reason: mapped.reason, detail: mapped.detail ?? null });
      continue;
    }
    // Ingest only — the matches processIncomingMovement returns here
    // reflect just what was ALREADY in the store at this row's own
    // ingestion time (ingestion-order-dependent), which is wrong for a
    // retrospective batch report where the same booking's match should
    // never depend on which order the input rows happened to arrive in.
    // Real matches are computed in a separate full-pool pass below,
    // matching board.js's own approach for the same reason.
    const { movement } = processIncomingMovement(store, mapped.movementInput, { routePriceTruthLookup });
    evaluatedMovements.push(movement);
  }

  // Second pass: every evaluated movement is matched against the FULL
  // final pool (all rows from this run, order-independent), not just
  // whatever existed when it happened to be ingested.
  const evaluated = evaluatedMovements.map((movement) => {
    const pool = evaluatedMovements.filter((m) => m.movement_id !== movement.movement_id);
    const matches = computeMatchCandidates(movement, pool, { routePriceTruthLookup });
    return { movement, matches };
  });

  // ── Aggregate into the mission's 12-point report shape ──────────────
  const confirmedMovementsEvaluated = evaluated.length;

  // "creating predicted empty/reposition legs": a confirmed movement with
  // at least one candidate match at all (i.e. some other movement could
  // plausibly fill what would otherwise be an empty leg), regardless of
  // whether that candidate is FEASIBLE or priceable yet.
  const withPredictedEmptyLeg = evaluated.filter((e) => e.matches.length > 0);

  let feasibleCount = 0;
  let readyForShadowMatchCount = 0;
  const holdReasons = {}; // reason -> count
  const routePairs = [];
  const timingWindows = [];
  const referencePrices = [];
  const floorCostAvailability = [];
  const shadowPrices = [];
  const contributions = [];

  for (const { movement, matches } of evaluated) {
    for (const match of matches) {
      if (match.operational_feasibility === 'FEASIBLE') feasibleCount++;

      let holdReason = null;
      if (match.operational_feasibility !== 'FEASIBLE') {
        holdReason = `OPERATIONAL_${match.operational_feasibility}`;
      } else if (match.commercial_pricing_status !== 'READY') {
        holdReason = `COMMERCIAL_${match.commercial_pricing_status}`;
      }

      if (holdReason) {
        holdReasons[holdReason] = (holdReasons[holdReason] ?? 0) + 1;
      } else {
        readyForShadowMatchCount++;
      }

      routePairs.push({
        source_route: `${movement.pickup_zone}->${movement.dropoff_zone}`,
        candidate_route_direction: match.match_type,
        candidate_movement_id: match.candidate_movement_id,
      });
      timingWindows.push({
        candidate_movement_id: match.candidate_movement_id,
        time_compatible: match.time_compatible,
        time_gap_minutes: match.time_gap_minutes,
      });
      referencePrices.push({
        candidate_movement_id: match.candidate_movement_id,
        reference_public_price: null, // no route_price_truth populated yet in this run — see report notes
      });
      floorCostAvailability.push({
        candidate_movement_id: match.candidate_movement_id,
        commercial_pricing_status: match.commercial_pricing_status,
      });
      if (match.commercial_pricing_status === 'READY') {
        shadowPrices.push({ candidate_movement_id: match.candidate_movement_id, estimated_incremental_revenue: match.estimated_incremental_revenue });
        contributions.push({ candidate_movement_id: match.candidate_movement_id, estimated_contribution: match.estimated_contribution });
      }
    }
  }

  return {
    generated_at: new Date().toISOString(),
    mode: 'READ_SHADOW_ONLY',
    input_row_count: confirmedBookingRows.length,
    confirmed_movements_evaluated: confirmedMovementsEvaluated,
    movements_with_predicted_empty_or_reposition_leg: withPredictedEmptyLeg.length,
    feasible_candidate_count: feasibleCount,
    hold_count: Object.values(holdReasons).reduce((a, b) => a + b, 0),
    ready_for_shadow_match_count: readyForShadowMatchCount,
    hold_reasons: holdReasons,
    candidate_route_pairs: routePairs,
    timing_windows: timingWindows,
    reference_public_price: referencePrices,
    floor_cost_basis_availability: floorCostAvailability,
    shadow_price_where_permitted: shadowPrices,
    estimated_incremental_contribution_where_permitted: contributions,
    skipped_bookings: skipped,
    skipped_reason_counts: skipped.reduce((acc, s) => { acc[s.reason] = (acc[s.reason] ?? 0) + 1; return acc; }, {}),
  };
}

function parseArgs(argv) {
  const args = { input: null, sourceSite: 'nadiairporttransfers.com' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') args.input = argv[++i];
    if (argv[i] === '--source-site') args.sourceSite = argv[++i];
  }
  return args;
}

// Only run as a CLI when invoked directly (not when imported by tests).
// Compared as normalized file:// URLs rather than a raw string template so
// this works correctly on Windows too, where process.argv[1] can be a
// relative path with backslashes that never textually matches
// import.meta.url's absolute file:///C:/... form.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { input, sourceSite } = parseArgs(process.argv.slice(2));
  const rows = input ? JSON.parse(readFileSync(input, 'utf8')) : [];
  if (!input) {
    console.log('No --input supplied — running with ZERO real confirmed-booking rows.');
    console.log('This is not a synthetic substitute; it honestly reports nothing evaluated.');
  }
  // Injected dependency only — no default, no hardcoded fallback. Must be
  // set as raw key bytes via an env var; this script never invents one.
  const shadowSecretEnv = process.env.SMART_RETURN_SHADOW_SECRET;
  const shadowSecret = shadowSecretEnv ? new TextEncoder().encode(shadowSecretEnv) : undefined;
  if (rows.length > 0 && !shadowSecret) {
    console.error('SMART_RETURN_SHADOW_SECRET is not set and there are rows to evaluate — refusing to run. Set it (a real secret, never committed) and retry.');
    process.exit(1);
  }
  const report = await runLiveShadowReport(rows, { sourceSite, shadowSecret });
  console.log(JSON.stringify(report, null, 2));
}
