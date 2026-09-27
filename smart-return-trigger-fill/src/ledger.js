/* Issue #54 Stage 1 (SHADOW MODE) — movement ingestion.
 * Pure persistence. Never calls the matcher or WhatsApp card builder —
 * that separation is what lets a matcher outage or WhatsApp failure be
 * impossible to entangle with whether a booking got saved (see
 * src/pipeline.js and the atomic-safety tests).
 *
 * Marau Stage 1 fix (2026-09-28): both functions are now `async` and
 * await every store call — see src/offers.js's file header for the full
 * explanation of the defect this fixes (store calls were consumed
 * synchronously, which is only safe against the memory store and silently
 * wrong against a Promise-returning store like createD1Store).
 */
import { normalizeMovementInput } from './model.js';

export async function ingestMovement(store, rawPayload) {
  const movement = normalizeMovementInput(rawPayload);
  const { inserted, movement: stored } = await store.insertMovementIfNew(movement);
  return { movement: stored, wasNew: inserted };
}

export async function linkReturnMovement(store, outboundMovementId, returnMovementId) {
  const outbound = await store.updateMovement(outboundMovementId, { linked_return_movement_id: returnMovementId });
  const ret = await store.updateMovement(returnMovementId, { linked_return_movement_id: outboundMovementId });
  return { outbound, return: ret };
}
