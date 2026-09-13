/* Issue #54 Stage 1 (SHADOW MODE) — canonical route-price contract.
 * See docs/ROUTE_PRICE_TRUTH_CONTRACT.md for the full field-by-field spec
 * consumed by the three storefronts. This module only validates shape —
 * it does not connect to any live UI.
 */

const REQUIRED_FIELDS = ['route_id', 'origin_zone', 'destination_zone', 'vehicle_class', 'currency'];

export function validateRoutePriceTruthEntry(entry) {
  const missing = REQUIRED_FIELDS.filter((f) => entry?.[f] == null);
  if (missing.length > 0) {
    return { valid: false, errors: missing.map((f) => `missing required field: ${f}`) };
  }
  const errors = [];
  for (const priceField of [
    'standard_price',
    'acquisition_price',
    'return_lock_price',
    'smart_match_price',
    'live_fill_price',
    'operator_payout',
    'absolute_floor',
  ]) {
    const v = entry[priceField];
    if (v != null && !(Number.isFinite(v) && v >= 0)) {
      errors.push(`${priceField} must be a non-negative number or null`);
    }
  }
  if (entry.absolute_floor != null) {
    for (const priceField of ['standard_price', 'return_lock_price', 'smart_match_price', 'live_fill_price']) {
      const v = entry[priceField];
      if (v != null && v < entry.absolute_floor) {
        errors.push(`${priceField} (${v}) is below absolute_floor (${entry.absolute_floor})`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
