/* Marau Stage 1 (PREVIEW/TEST ONLY) — a real-SQLite-backed stand-in for a
 * Cloudflare D1 binding, used only in tests. Deliberately NOT a hand-rolled
 * per-query mock: it runs the actual migration SQL (0001-0011, unmodified)
 * against Node's built-in `node:sqlite` (DatabaseSync), so UNIQUE, CHECK,
 * FOREIGN KEY and PRIMARY KEY constraints — the exact mechanisms this
 * mission's acceptance criteria depend on (idempotent booking refs,
 * one-active-request-per-guest-per-offer, the vehicle_time_claims
 * exclusivity guard) — are enforced by SQLite itself, not by application
 * logic pretending to be a database. This directly answers the mission's
 * instruction: "do not treat the passing 240-test memory suite as proof
 * of D1 readiness" — this harness is what stands in for real D1 instead.
 *
 * The public surface matches the real D1 API closely enough for every
 * code path this package uses: `db.prepare(sql).bind(...args).first()`,
 * `.all()`, `.run()` (each returning a Promise, per the real API), plus
 * `db.exec(sql)` for schema setup. It is not a complete D1 polyfill.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIRS = [
  path.join(process.cwd(), '..', 'smart-return-trigger-fill', 'migrations'),
  path.join(process.cwd(), 'migrations'),
];

function readMigrationsFrom(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, sql: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

/**
 * Creates a fresh in-memory SQLite database, applies every migration in
 * smart-return-trigger-fill/migrations/ (the existing Issue #54 schema)
 * followed by every migration in marau/migrations/ (this stage's new
 * tables), in filename order — exactly the order a real rollout would
 * apply them. Returns a D1-shaped async wrapper.
 */
export function createTestD1({ migrationsDirs = MIGRATIONS_DIRS } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  const applied = [];
  for (const dir of migrationsDirs) {
    for (const { file, sql } of readMigrationsFrom(dir)) {
      sqlite.exec(sql);
      applied.push(file);
    }
  }

  function toD1Row(row) {
    if (row == null) return null;
    // node:sqlite returns integers for INTEGER columns and JS numbers for
    // REAL — same as D1. Booleans are stored as 0/1 in both, so no
    // conversion is needed for this schema's INTEGER-flag columns.
    return row;
  }

  // node:sqlite's DatabaseSync (unlike the real D1 API) refuses a raw JS
  // boolean as a bind parameter. D1 itself accepts true/false and stores
  // them as 0/1, so callers writing real D1-shaped code (as everything in
  // this package does) reasonably pass booleans — this shim coerces them
  // the same way D1 does, rather than pushing that conversion onto every
  // caller.
  function coerce(v) {
    if (v === true) return 1;
    if (v === false) return 0;
    return v;
  }

  function makeStatement(sql, boundArgs = []) {
    return {
      sql,
      boundArgs,
      bind(...args) {
        return makeStatement(sql, args.map(coerce));
      },
      async first() {
        const stmt = sqlite.prepare(sql);
        try {
          return toD1Row(stmt.get(...boundArgs) ?? null);
        } catch (err) {
          throw shimError(err, sql);
        }
      },
      async all() {
        const stmt = sqlite.prepare(sql);
        try {
          const results = stmt.all(...boundArgs).map(toD1Row);
          return { success: true, results, meta: { changes: results.length } };
        } catch (err) {
          throw shimError(err, sql);
        }
      },
      async run() {
        const stmt = sqlite.prepare(sql);
        try {
          const info = stmt.run(...boundArgs);
          return {
            success: true,
            meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) },
          };
        } catch (err) {
          throw shimError(err, sql);
        }
      },
    };
  }

  function shimError(err, sql) {
    const wrapped = new Error(`${err.message} (sql: ${sql.replace(/\s+/g, ' ').trim().slice(0, 200)})`);
    wrapped.cause = err;
    wrapped.isConstraintViolation = /UNIQUE constraint|CHECK constraint|FOREIGN KEY constraint|PRIMARY KEY/i.test(
      err.message
    );
    return wrapped;
  }

  return {
    kind: 'sqlite-d1-shim',
    appliedMigrations: applied,
    prepare(sql) {
      return makeStatement(sql);
    },
    exec(sql) {
      sqlite.exec(sql);
    },
    // D1's batch(): the statements run in order inside ONE implicit transaction - if any statement throws, every earlier
    // write in the batch is rolled back. Everything runs synchronously, so nothing can interleave inside a batch.
    async batch(statements) {
      sqlite.exec('BEGIN');
      const out = [];
      try {
        for (const st of statements) {
          const stmt = sqlite.prepare(st.sql);
          const isRead = /^\s*(WITH|SELECT)\b/i.test(st.sql);
          if (isRead) {
            const results = stmt.all(...st.boundArgs);
            out.push({ success: true, results, meta: { changes: 0 } });
          } else {
            const info = stmt.run(...st.boundArgs);
            out.push({ success: true, results: [], meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } });
          }
        }
        sqlite.exec('COMMIT');
      } catch (err) {
        try { sqlite.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw shimError(err, 'batch');
      }
      return out;
    },
    // Direct escape hatch for test setup/assertions that don't need the
    // Promise-based D1 shape (e.g. seeding fixtures synchronously).
    raw: sqlite,
  };
}
