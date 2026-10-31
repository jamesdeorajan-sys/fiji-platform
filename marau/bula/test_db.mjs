/* Test-only D1 stand-in on node:sqlite. File-backed so SEVERAL connections (and processes) can share one database.
 * batch() = BEGIN IMMEDIATE ... COMMIT/ROLLBACK, like D1's atomic batch. `faultAfter` simulates a crash mid-batch. */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dirs = [path.join(root, '..', 'smart-return-trigger-fill', 'migrations'), path.join(root, 'migrations'), path.join(root, 'bula', 'migrations')];
export function migrationSql() {
  return dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.sql')).sort().map((f) => fs.readFileSync(path.join(d, f), 'utf8')));
}
export function openD1(file, { init = false, faultAfter = null } = {}) {
  const s = new DatabaseSync(file);
  s.exec('PRAGMA busy_timeout = 20000; PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') s.exec('PRAGMA journal_mode = WAL;');
  if (init) for (const sql of migrationSql()) s.exec(sql);
  const co = (v) => (v === true ? 1 : v === false ? 0 : v);
  const mk = (sql, a = []) => ({ sql, a, bind: (...x) => mk(sql, x.map(co)),
    async first() { return s.prepare(sql).get(...a) ?? null; },
    async all() { return { results: s.prepare(sql).all(...a) }; },
    async run() { const i = s.prepare(sql).run(...a); return { meta: { changes: i.changes } }; } });
  const db = { raw: s, fault: { after: faultAfter }, prepare: (sql) => mk(sql), exec: (q) => s.exec(q), close: () => s.close(),
    async batch(sts) {
      s.exec('BEGIN IMMEDIATE'); const out = [];
      try {
        let n = 0;
        for (const st of sts) {
          if (db.fault.after !== null && n === db.fault.after) { db.fault.after = null; throw new Error('INJECTED_FAULT'); }
          const stmt = s.prepare(st.sql);
          if (/^\s*(WITH|SELECT)\b/i.test(st.sql)) out.push({ results: stmt.all(...st.a) }); else out.push({ meta: { changes: stmt.run(...st.a).changes } });
          n++;
        }
        s.exec('COMMIT'); return out;
      } catch (e) { try { s.exec('ROLLBACK'); } catch {} throw e; }
    } };
  return db;
}
