/* Marau Stage 1 (PREVIEW ONLY) — the real vehicle/time exclusivity guard.
 * See migrations/0013_marau_vehicle_windows.sql and
 * 0014_marau_vehicle_allocations.sql for the schema and the atomicity
 * rationale (a single INSERT ... SELECT ... WHERE NOT EXISTS statement,
 * not a UNIQUE constraint, because the conflict condition is a time-range
 * OVERLAP, not equality).
 *
 * FIX for a P0 Codex finding: two offers backed by DIFFERENT movements
 * assigned to the SAME vehicle with OVERLAPPING windows both confirmed
 * (200/200) under the old `vehicle_time_claims` guard, whose PRIMARY KEY
 * on `source_movement_id` only ever prevented the SAME movement being
 * claimed twice. This module is used by BOTH deal-request confirmation
 * and ordinary booking confirmation (worker.js), so a vehicle already
 * committed one way blocks the other, per the mission's "covering
 * overlapping offers AND ordinary bookings."
 *
 * "Unknown vehicle/availability must block confirmation": a subject
 * (movement or booking) with no `vehicle_windows` row has no known
 * vehicle_id/window at all, so there is nothing to check for conflict —
 * callers must reject BEFORE calling claimVehicleAllocation() in that
 * case (see worker.js), never assume it's fine to proceed.
 */

/**
 * Atomically claims a vehicle for [windowStart, windowEnd). Returns
 * { success: true, allocationId } if no existing allocation for the same
 * vehicle_id overlaps, or { success: false } if one already does — in
 * which case NOTHING was written (the WHERE NOT EXISTS clause makes the
 * whole statement a no-op when a conflict exists, so there's nothing to
 * roll back for this call itself).
 */
export async function claimVehicleAllocation(env, { allocationId, vehicleId, windowStart, windowEnd, subjectType, subjectId, nowIso }) {
  const result = await env.DB
    .prepare(
      `INSERT INTO vehicle_allocations (allocation_id, vehicle_id, window_start, window_end, subject_type, subject_id, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM vehicle_allocations
         WHERE vehicle_id = ? AND window_start < ? AND window_end > ?
       )`
    )
    .bind(allocationId, vehicleId, windowStart, windowEnd, subjectType, subjectId, nowIso, vehicleId, windowEnd, windowStart)
    .run();
  return { success: result.meta.changes === 1, allocationId };
}

/**
 * Releases a claim made by claimVehicleAllocation — used to roll back a
 * confirmation attempt that won the vehicle/time race but then failed a
 * LATER step (e.g. the offer's own CAS transition), so a failed attempt
 * never leaves a phantom lock a legitimate later confirmation can't get
 * past. Idempotent: releasing an allocation_id that doesn't exist (e.g.
 * because the claim step itself failed and nothing was ever inserted) is
 * a harmless no-op.
 */
export async function releaseVehicleAllocation(env, allocationId) {
  if (!allocationId) return;
  await env.DB.prepare('DELETE FROM vehicle_allocations WHERE allocation_id = ?').bind(allocationId).run();
}

export async function findVehicleWindow(env, subjectType, subjectId) {
  return env.DB.prepare('SELECT * FROM vehicle_windows WHERE subject_type = ? AND subject_id = ?').bind(subjectType, subjectId).first();
}
