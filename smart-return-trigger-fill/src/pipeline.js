/* Issue #54 Stage 1 (SHADOW MODE) — orchestration.
 *
 * Deliberately structured so step 1 (persistence) can never be rolled back
 * or invalidated by a failure in step 2 (matching) or step 3 (WhatsApp
 * card generation) — this is what satisfies the safety invariants
 * "matcher outage does not stop STANDARD booking flow" and "WhatsApp
 * failure must never delete or invalidate a saved booking."
 */
import { ingestMovement } from './ledger.js';
import { computeMatchCandidates } from './matcher.js';
import { buildOpsCard } from './whatsapp_cards.js';

export function processIncomingMovement(
  store,
  rawPayload,
  { routePriceTruthLookup, matchFn = computeMatchCandidates, cardFn = buildOpsCard } = {}
) {
  // Step 1: persist. If this throws, nothing downstream runs — a malformed
  // booking must fail loudly rather than produce a half-recorded shadow.
  const { movement, wasNew } = ingestMovement(store, rawPayload);

  // Step 2: match (best-effort). A throw here must not undo step 1.
  // matchFn/cardFn are injectable so outage scenarios can be exercised in
  // tests without monkey-patching ES module exports.
  let matches = [];
  let matcherError = null;
  try {
    const pool = store.listMovements().filter((m) => m.movement_id !== movement.movement_id);
    matches = matchFn(movement, pool, { routePriceTruthLookup });
  } catch (err) {
    matcherError = err;
  }

  // Step 3: build the internal ops card (best-effort, never sent). A throw
  // here must not undo step 1 or step 2's already-computed matches.
  let opsCard = null;
  let whatsappError = null;
  try {
    opsCard = cardFn(movement, matches);
  } catch (err) {
    whatsappError = err;
  }

  return { movement, wasNew, matches, opsCard, matcherError, whatsappError };
}
