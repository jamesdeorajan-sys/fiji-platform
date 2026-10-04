/* Marau (PREVIEW/TEST ONLY) - which leg of a holiday a transfer is, derived from the SOURCE's own pickup/destination zones.
 *
 * A referral credit may only be applied to a RETURN transfer, so every booking that reaches Marau - created in Marau, or
 * mirrored from the real source - must carry a leg type. The source has no explicit "leg" field, so it is inferred from
 * zone names: an airport pickup is an arrival, an airport destination is a return, anything else (including
 * airport-to-airport) is 'other'. It is re-derived on every mirror update so it always follows the source.
 */
const AIRPORT = /airport/i;

export function classifyLeg(pickupZone, destinationZone) {
  // An unknown end means the leg cannot be classified: never guess (a wrong 'return' would make a credit applicable).
  if (typeof pickupZone !== 'string' || !pickupZone.trim() || typeof destinationZone !== 'string' || !destinationZone.trim()) return 'other';
  const from = typeof pickupZone === 'string' && AIRPORT.test(pickupZone);
  const to = typeof destinationZone === 'string' && AIRPORT.test(destinationZone);
  if (from && !to) return 'arrival';
  if (to && !from) return 'return';
  return 'other';
}

// RED-BASELINE STUB (replaced in the fix commit)
export function classifyMirroredShape() { return { leg_type: 'other', shape: 'stub', credit_basis: 'none' }; }
