// Child process: own SQLite connection to the shared file; waits for a common start instant, then reserves.
import { openD1 } from './test_db.mjs';
import { cfg } from './fixtures.mjs';
import { reserve } from './inventory_credit.js';
const [file, startAt, nowMs, partyKey, idemKey, offerId, qty] = process.argv.slice(2);
const db = openD1(file);
while (Date.now() < +startAt) { /* spin to a common start */ }
try { const r = await reserve(db, cfg(), { partyKey, idemKey, offerId, qty: +qty, expectedVersion: 1, nowMs: +nowMs });
  console.log(JSON.stringify({ ok: r.ok, code: r.code ?? null, holdId: r.holdId ?? null, credit: r.creditCents ?? 0 })); }
catch (e) { console.log(JSON.stringify({ ok: false, code: 'THROWN', msg: String(e.message).slice(0, 120) })); }
