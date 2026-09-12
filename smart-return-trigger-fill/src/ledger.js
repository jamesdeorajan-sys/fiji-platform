/* Issue #54 Stage 1 (SHADOW MODE) — movement ingestion.
 * Pure persistence. Never calls the matcher or WhatsApp card builder —
 * that separation is what lets a matcher outage or WhatsApp failure be
 * impossible to entangle with whether a booking got saved (see
 * src/pipeline.js and the atomic-safety tests).
 */
import { normalizeMovementInput } from './model.js';

export function ingestMovement(store, rawPayload) {
  const movement = normalizeMovementInput(rawPayload);
  const { inserted, movement: stored } = store.insertMovementIfNew(movement);
  return { movement: stored, wasNew: inserted };
}

export function linkReturnMovement(store, outboundMovementId, returnMovementId) {
  const outbound = store.updateMovement(outboundMovementId, { linked_return_movement_id: returnMovementId });
  const ret = store.updateMovement(returnMovementId, { linked_return_movement_id: outboundMovementId });
  return { outbound, return: ret };
}
