/* Statement-level fault injection for acceptance. Replaces the k-th statement (0-based) of the FIRST db.batch() with SQL that really fails
 * (INSERT into a table that does not exist), so the database itself aborts mid-batch and must roll back — unlike a JS throw before/after the batch.
 * Only reachable in routes when BULA_FAULT_HARNESS=on AND the admin credential is presented. Never enabled in production config. */
export function withSqlFault(db, k) {
  const state = { injected: false, batchLen: null };
  const proxy = new Proxy(db, { get(t, prop) {
    if (prop === '__fault') return state;
    if (prop === 'batch') return (stmts) => { if (state.injected) return t.batch(stmts); state.batchLen = stmts.length;
      if (k >= stmts.length) return t.batch(stmts);                       // position beyond this batch: nothing injected
      state.injected = true; const copy = stmts.slice(); copy[k] = t.prepare('INSERT INTO bula_fault_injected_missing_table (x) VALUES (1)'); return t.batch(copy); };
    const v = t[prop]; return typeof v === 'function' ? v.bind(t) : v; } });
  return proxy;
}
