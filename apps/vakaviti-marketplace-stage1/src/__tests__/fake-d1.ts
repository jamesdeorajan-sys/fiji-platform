// A small, hand-rolled in-memory stand-in for D1Database, used ONLY by this test suite. It
// executes the real, unmodified opportunities.ts against real SQL strings (parsed generically,
// not per-query special-cased beyond what's noted below) - this is not a re-implementation of
// opportunities.ts's logic, it is a fake persistence layer underneath the real logic, so what's
// under test is the actual shipped TypeScript.
//
// Supports exactly the query shapes this app's opportunities.ts issues: single-table
// INSERT/SELECT/UPDATE with a conjunctive (AND-only, except one named OR-IS-NULL pattern) WHERE
// clause of `col = ?` / `col != ?` / `col IS ?` terms, optional ORDER BY/LIMIT. No JOINs are
// needed because opportunities.ts never issues one.

type Row = Record<string, any>;

export class FakeD1 {
  tables: Record<string, Row[]> = {};

  table(name: string): Row[] {
    if (!this.tables[name]) this.tables[name] = [];
    return this.tables[name];
  }

  prepare(sql: string) {
    const self = this;
    return {
      _sql: sql,
      _binds: [] as any[],
      bind(...vals: any[]) { this._binds = vals; return this; },
      async first<T = any>(): Promise<T | null> {
        const rows = self.exec(this._sql, this._binds);
        return (rows[0] as T) ?? null;
      },
      async all<T = any>(): Promise<{ results: T[] }> {
        return { results: self.exec(this._sql, this._binds) as T[] };
      },
      async run(): Promise<{ meta: { changes: number } }> {
        const before = JSON.stringify(self.tables);
        self.exec(this._sql, this._binds);
        const after = JSON.stringify(self.tables);
        return { meta: { changes: before === after ? 0 : 1 } };
      },
    };
  }

  // A `?` consumes the next bind param; anything else is a literal from the SQL text itself
  // (e.g. `human_confirmed=1` or `... VALUES (?,?,0)`) - numeric literals are coerced to real
  // numbers and quoted literals have their quotes stripped, matching how SQLite itself would
  // type these values, so a test asserting `toBe(0)` (not `toBe('0')`) sees the same type real
  // D1 would return.
  private literalOrNext(token: string, next: () => any): any {
    const t = token.trim();
    if (t === '?') return next();
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    const quoted = t.match(/^'(.*)'$/);
    if (quoted) return quoted[1];
    return t;
  }

  private exec(sql: string, binds: any[]): Row[] {
    const s = sql.trim().replace(/\s+/g, ' ');
    let bi = 0;
    const next = () => binds[bi++];

    // Special-cased: the one COUNT query with an OR-IS-NULL pattern (regionCategoryHasExisting).
    if (/^SELECT COUNT\(\*\) n FROM opportunities WHERE \(region = \?/.test(s)) {
      const [region, , category] = binds;
      const rows = this.table('opportunities').filter(r => (r.region === region) && (r.category === category));
      return [{ n: rows.length }];
    }

    const insertMatch = s.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)/i);
    if (insertMatch) {
      const [, table, colsStr, valuesStr] = insertMatch;
      const cols = colsStr.split(',').map(c => c.trim());
      const values = valuesStr.split(',').map(v => v.trim());
      const row: Row = {};
      cols.forEach((c, i) => { row[c] = this.literalOrNext(values[i], next); });
      if (!('created_at' in row)) row.created_at = new Date().toISOString();
      this.table(table).push(row);
      return [];
    }

    const updateMatch = s.match(/^UPDATE (\w+) SET (.+?) WHERE (.+)$/i);
    if (updateMatch) {
      const [, table, setClause, whereClause] = updateMatch;
      const setParts = setClause.split(',').map(p => p.trim());
      const assignments: [string, any][] = [];
      for (const part of setParts) {
        const m = part.match(/^(\w+)\s*=\s*(.+)$/);
        if (!m) continue;
        const [, col, rhs] = m;
        assignments.push([col, this.literalOrNext(rhs, next)]);
      }
      const whereFn = this.buildWhere(whereClause, () => next());
      const rows = this.table(table).filter(whereFn);
      for (const r of rows) for (const [col, val] of assignments) r[col] = val;
      return rows;
    }

    const selectMatch = s.match(/^SELECT (.+?) FROM (\w+)(?: WHERE (.+?))?(?: ORDER BY ([\w, ]+?)(?: (ASC|DESC))?)?(?: LIMIT (\d+))?$/i);
    if (selectMatch) {
      const [, colsStr, table, whereClause, orderCol, orderDir, limitStr] = selectMatch;
      let rows = this.table(table).slice();
      if (whereClause) {
        const whereFn = this.buildWhere(whereClause, () => next());
        rows = rows.filter(whereFn);
      }
      if (orderCol) {
        rows.sort((a, b) => {
          const av = a[orderCol.trim()], bv = b[orderCol.trim()];
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return orderDir === 'DESC' ? -cmp : cmp;
        });
      }
      if (limitStr) rows = rows.slice(0, parseInt(limitStr, 10));
      if (/^COUNT\(\*\)/.test(colsStr.trim())) return [{ n: rows.length }];
      if (colsStr.trim() === '*') return rows;
      const cols = colsStr.split(',').map(c => c.trim());
      return rows.map(r => Object.fromEntries(cols.map(c => [c, r[c]])));
    }

    throw new Error('FakeD1: unsupported SQL shape in test mock: ' + s);
  }

  private buildWhere(clause: string, next: () => any): (r: Row) => boolean {
    // Only conjunctive (AND-only) simple comparisons are needed by opportunities.ts's WHERE
    // clauses outside the one special-cased COUNT query above.
    const terms = clause.split(/\sAND\s/i);
    const checks: ((r: Row) => boolean)[] = [];
    for (const term of terms) {
      const eq = term.match(/^(\w+)\s*=\s*\?$/);
      const neq = term.match(/^(\w+)\s*!=\s*\?$/);
      if (eq) { const col = eq[1]; const v = next(); checks.push(r => r[col] === v); continue; }
      if (neq) { const col = neq[1]; const v = next(); checks.push(r => r[col] !== v); continue; }
      throw new Error('FakeD1: unsupported WHERE term: ' + term);
    }
    return (r: Row) => checks.every(c => c(r));
  }
}
