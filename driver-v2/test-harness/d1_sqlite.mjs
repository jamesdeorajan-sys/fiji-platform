// A D1-shaped adapter over node:sqlite (in-memory). ISOLATED TEST HARNESS ONLY: no Cloudflare binding, no network.
// Semantics mirrored from D1: prepare().bind().run()/first()/all(), batch() is ONE atomic transaction (any failing
// statement rolls the whole batch back), run() reports meta.changes.
// Chaos: hooks.beforeStatement is awaited before every statement so concurrent callers genuinely interleave their
// read-then-write pre-checks; correctness must not depend on those pre-checks (the batch guards are in SQL).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = path.join(here, '..', 'schema', 'gate1_isolated_schema.sql');

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.db, this.sql, args); }
  async run() { await this.db._pre(this.sql); return this.db._run(this.sql, this.args); }
  async first(col) {
    await this.db._pre(this.sql);
    const row = this.db.raw.prepare(this.sql).get(...this.args.map(norm));
    if (!row) return null;
    return col ? row[col] : { ...row };
  }
  async all() {
    await this.db._pre(this.sql);
    const results = this.db.raw.prepare(this.sql).all(...this.args.map(norm)).map((r) => ({ ...r }));
    return { results, success: true, meta: { changes: 0 } };
  }
}
const norm = (v) => (v === undefined ? null : v);

export class D1Sqlite {
  constructor({ chaos = null } = {}) {
    this.raw = new DatabaseSync(':memory:');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.hooks = { beforeStatement: chaos };      // async (sql) => void
    this.stats = { statements: 0, batches: 0, rollbacks: 0 };
    this.log = null;                              // optional array to capture executed SQL verbs (write-audit)
  }
  static fromSchema(opts) { const d = new D1Sqlite(opts); d.raw.exec(fs.readFileSync(SCHEMA_PATH, 'utf8')); return d; }
  prepare(sql) { return new Stmt(this, sql); }
  async exec(sql) { this.raw.exec(sql); return { success: true }; }
  async _pre(sql) { if (this.hooks.beforeStatement) await this.hooks.beforeStatement(sql); }
  _run(sql, args) {
    this.stats.statements++;
    if (this.log) this.log.push(sql.trim().split(/\s+/)[0].toUpperCase());
    const r = this.raw.prepare(sql).run(...args.map(norm));
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  // Atomic: all statements execute with no await between them (single-threaded => no interleaving), or none persist.
  async batch(stmts) {
    this.stats.batches++;
    if (this.hooks.beforeStatement) await this.hooks.beforeStatement('BATCH');
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const out = stmts.map((s) => this._run(s.sql, s.args));
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.stats.rollbacks++;
      try { this.raw.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw e;
    }
  }
  // Test helpers (read-only conveniences; never used by product code).
  q(sql, ...args) { return this.raw.prepare(sql).all(...args.map(norm)).map((r) => ({ ...r })); }
  q1(sql, ...args) { return this.raw.prepare(sql).get(...args.map(norm)) ?? null; }
}

export function randomChaos(maxMicro = 6) {
  // yields a random number of microtask turns so concurrent flows interleave unpredictably
  return async () => { const n = Math.floor(Math.random() * maxMicro); for (let i = 0; i < n; i++) await Promise.resolve(); };
}
