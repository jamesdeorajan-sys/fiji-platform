/* Issue #54 Stage 1 (SHADOW MODE) — demo script.
 * Ingests the synthetic fixtures through the real pipeline and prints the
 * matches, ops cards, and a 7-day board. Read-only, no writes to any real
 * system. Run with: node scripts/demo.js
 */
import { createMemoryStore } from '../src/db.js';
import { processIncomingMovement } from '../src/pipeline.js';
import { computeMatchCandidates } from '../src/matcher.js';
import { buildSevenDayMovementBoard } from '../src/board.js';
import { buildSyntheticMovements } from '../test/fixtures/synthetic_movements.js';

const store = createMemoryStore();

for (const raw of buildSyntheticMovements()) {
  const result = processIncomingMovement(store, raw);
  console.log('='.repeat(70));
  console.log(`Ingested ${result.movement.booking_reference} (new: ${result.wasNew})`);
  console.log('--- ops card ---');
  console.log(result.opsCard);
}

console.log('\n' + '#'.repeat(70));
console.log('FULL-POOL MATCH CANDIDATES (ingestion-order ops cards above only');
console.log('see what already existed at ingestion time — this shows what the');
console.log('matcher finds once the whole synthetic pool is known, e.g. for the');
console.log('7-day board or a periodic re-scan)');
console.log('#'.repeat(70));
const allMovements = store.listMovements();
for (const m of allMovements) {
  const others = allMovements.filter((o) => o.movement_id !== m.movement_id);
  const candidates = computeMatchCandidates(m, others);
  const best = candidates[0];
  console.log(
    `${m.booking_reference} (${m.pickup_zone}->${m.dropoff_zone}) best match: ${
      best
        ? `${best.candidate_movement_id} score=${best.match_score} operational=${best.operational_feasibility} pricing=${best.commercial_pricing_status}`
        : 'none'
    }`
  );
}

console.log('\n' + '#'.repeat(70));
console.log('7-DAY MOVEMENT BOARD (viewing as of 2026-09-20T00:00:00Z)');
console.log('#'.repeat(70));
const board = buildSevenDayMovementBoard(store, { nowIso: '2026-09-20T00:00:00Z' });
console.log(JSON.stringify(board, null, 2));
