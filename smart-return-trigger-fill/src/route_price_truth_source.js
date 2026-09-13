/* Issue #54 Stage 1 (SHADOW MODE) — route-price-truth assembly.
 *
 * Maps a candidate route to the four canonical figures Smart Return's
 * commercial gate needs (see model.js's COMMERCIAL_PRICING_STATUS), using
 * ONLY the real, already-approved formulas and settings already in
 * production use in nadi-marketplace/worker/worker.js — never a separately
 * invented number. This module makes no database or network call itself:
 * every input is a required, caller-supplied argument, sourced by whoever
 * has real backend/D1 access.
 *
 * ── REAL SOURCES, ONE PER FIELD ─────────────────────────────────────────
 *
 * referenceFareFjd (-> standard_price / smart_match_price)
 *   Source: computeRealReferenceFare(env, pickupZone, destinationZone,
 *   vehicleType, tripType) in nadi-marketplace/worker/worker.js — the
 *   EXACT server-side function the real negotiation flow already uses to
 *   compute a trustworthy reference fare for a zone pair (never trusts a
 *   client-supplied number — see that function's own "Milestone 16" fix
 *   comment). Requires live env.DB (zone lat/lng + distance lookup), so it
 *   cannot be called or reimplemented from this module — reimplementing it
 *   here would itself be exactly the kind of invented/drifted economics
 *   this whole system exists to prevent.
 *
 * commissionRate (-> operator_payout, with referenceFareFjd)
 *   Source: platform_settings.default_commission_rate (currently 0.15 as
 *   of this mission, but a live, DB-configurable setting — never
 *   hardcoded here), or a booking-specific bookings.commission_rate
 *   override when one exists (see getSetting() usage around
 *   worker.js:3745-3754). operator_payout is derived using the SAME
 *   formula the real backend already uses for driver settlement:
 *     commission = amount * commission_rate
 *     payout     = amount - commission = amount * (1 - commission_rate)
 *   applied to referenceFareFjd (a prospective quote, since a Smart Return
 *   candidate has no real settlement_amount_fjd yet — no booking exists
 *   for the hypothetical sale).
 *
 * floorRatio (-> absolute_floor, with referenceFareFjd)
 *   Source: NEGOTIATION_FLOOR_RATIO in nadi-marketplace/worker/worker.js,
 *   currently 0.80 — the platform's own existing, CEO-approved floor rule
 *   (a negotiated guest_proposed_amount_fjd must be >= referenceFareFjd *
 *   0.80). Reused here as DEFAULT_FLOOR_RATIO rather than a separately
 *   invented Smart Return floor concept. Overridable per call since it IS
 *   a real business rule that could change — re-verify DEFAULT_FLOOR_RATIO
 *   against worker.js's own NEGOTIATION_FLOOR_RATIO if this module is
 *   revisited after that constant changes there.
 *
 * effective_rule_version
 *   A plain audit string recording exactly which floorRatio/commissionRate
 *   values produced this entry, so a later reviewer can tell whether a
 *   stored entry used a since-changed rate/ratio without needing to trust
 *   memory.
 */
import { validateRoutePriceTruthEntry } from './route_price_truth.js';

export const DEFAULT_FLOOR_RATIO = 0.80;

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Builds a validated route_price_truth entry from real, caller-supplied
 * figures. Never invents referenceFareFjd or commissionRate — both are
 * required, and this returns a typed failure (never a guessed entry) when
 * either is missing or out of a sane range.
 */
export function buildRoutePriceTruthEntry({
  originZone,
  destinationZone,
  vehicleClass,
  currency = 'FJD',
  referenceFareFjd,
  commissionRate,
  floorRatio = DEFAULT_FLOOR_RATIO,
  asOfIso = null,
}) {
  if (!isFiniteNumber(referenceFareFjd) || referenceFareFjd <= 0) {
    return { ok: false, reason: 'MISSING_REFERENCE_FARE' };
  }
  if (!isFiniteNumber(commissionRate) || commissionRate < 0 || commissionRate >= 1) {
    return { ok: false, reason: 'MISSING_COMMISSION_RATE' };
  }
  if (!isFiniteNumber(floorRatio) || floorRatio <= 0 || floorRatio > 1) {
    return { ok: false, reason: 'INVALID_FLOOR_RATIO' };
  }

  const operatorPayout = Number((referenceFareFjd * (1 - commissionRate)).toFixed(2));
  const absoluteFloor = Number((referenceFareFjd * floorRatio).toFixed(2));

  const entry = {
    route_id: `${originZone}-${destinationZone}-${vehicleClass}`.toLowerCase(),
    origin_zone: originZone,
    destination_zone: destinationZone,
    vehicle_class: vehicleClass,
    currency,
    standard_price: referenceFareFjd,
    // Deliberately conservative: a Smart Return candidate is never priced
    // above the real public reference fare unless a separate, explicit
    // commercial policy decision sets a different smart_match_price — not
    // invented in this module.
    smart_match_price: referenceFareFjd,
    operator_payout: operatorPayout,
    absolute_floor: absoluteFloor,
    pricing_reason: `reference_fare_fjd=${referenceFareFjd} (computeRealReferenceFare), commission_rate=${commissionRate} (platform_settings.default_commission_rate or booking override), floor_ratio=${floorRatio} (NEGOTIATION_FLOOR_RATIO)`,
    last_verified_at: asOfIso,
    effective_rule_version: `floor_ratio=${floorRatio};commission_rate=${commissionRate}`,
    test_data: false,
  };

  const validation = validateRoutePriceTruthEntry(entry);
  if (!validation.valid) {
    return { ok: false, reason: 'VALIDATION_ERROR', detail: validation.errors };
  }
  return { ok: true, entry };
}
