/* Issue #54 Stage 1 (SHADOW MODE) — demo script.
 * Ingests the synthetic fixtures through the real pipeline and prints the
 * matches, ops cards, and a 7-day board. Read-only, no writes to any real
 * system. Run with: node scripts/demo.js
 */
import { createMemoryStore } from '../src/db.js';
import { processIncomingMovement } from '../src/pipeline.js';
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
console.log('7-DAY MOVEMENT BOARD (viewing as of 2026-09-20T00:00:00Z)');
console.log('#'.repeat(70));
const board = buildSevenDayMovementBoard(store, { nowIso: '2026-09-20T00:00:00Z' });
console.log(JSON.stringify(board, null, 2));
