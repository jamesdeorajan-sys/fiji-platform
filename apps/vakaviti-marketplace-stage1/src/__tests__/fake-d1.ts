// Minimal in-memory D1Database stand-in for this branch's tests - same pattern as PR #21's
// fake-d1.ts (separate copy since these are separate, isolated branches by design). Supports only
// the exact query shapes deal-exchange-listing.ts issues: a single-column SELECT by
// idempotency_key, and two simple INSERTs.

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

    const selectMatch = s.match(/^SELECT (.+?) FROM (\w+)(?: WHERE (.+))?$/i);
    if (selectMatch) {
      const [, colsStr, table, whereClause] = selectMatch;
      let rows = this.table(table).slice();
      if (whereClause) {
        const eq = whereClause.match(/^(\w+)\s*=\s*\?$/);
        if (eq) { const col = eq[1]; const v = next(); rows = rows.filter(r => r[col] === v); }
        else throw new Error('FakeD1: unsupported WHERE clause: ' + whereClause);
      }
      if (colsStr.trim() === '*') return rows;
      const cols = colsStr.split(',').map(c => c.trim());
      return rows.map(r => Object.fromEntries(cols.map(c => [c, r[c]])));
    }

    const updateMatch = s.match(/^UPDATE (\w+) SET (.+?) WHERE (.+)$/i);
    if (updateMatch) {
      const [, table, setClause, whereClause] = updateMatch;
      const setParts = setClause.split(',').map(p => p.trim());
      const assignments: [string, any][] = [];
      for (const part of setParts) {
        const m = part.match(/^(\w+)\s*=\s*(.+)$/);
        if (!m) continue;
        assignments.push([m[1], this.literalOrNext(m[2], next)]);
      }
      const eq = whereClause.match(/^(\w+)\s*=\s*\?$/);
      if (!eq) throw new Error('FakeD1: unsupported UPDATE WHERE clause: ' + whereClause);
      const v = next();
      const rows = this.table(table).filter(r => r[eq[1]] === v);
      for (const r of rows) for (const [col, val] of assignments) r[col] = val;
      return rows;
    }

    throw new Error('FakeD1: unsupported SQL shape in test mock: ' + s);
  }
}
