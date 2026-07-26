import { ApplicationError, databaseError } from "./errors.ts";

export type SqlValue = string | number | null;
export interface SqlStatement {
  readonly sql: string;
  readonly params?: readonly SqlValue[];
}
export interface WriteResult {
  readonly changes: number;
  readonly lastRowId?: number;
}
export interface SqlDatabase {
  execute(statement: SqlStatement): Promise<WriteResult>;
  query<T>(statement: SqlStatement): Promise<readonly T[]>;
  /** All statements commit atomically, or all roll back. */
  batch(statements: readonly SqlStatement[]): Promise<readonly WriteResult[]>;
}

export class Persistence {
  readonly database: SqlDatabase;
  constructor(database: SqlDatabase) {
    this.database = database;
  }
  async execute(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<WriteResult> {
    try {
      return await this.database.execute({ sql, params });
    } catch (error) {
      throw databaseError(error);
    }
  }
  async one<T>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<T | undefined> {
    try {
      return (await this.database.query<T>({ sql, params }))[0];
    } catch (error) {
      throw databaseError(error);
    }
  }
  async many<T>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<readonly T[]> {
    try {
      return await this.database.query<T>({ sql, params });
    } catch (error) {
      throw databaseError(error);
    }
  }
  async insert(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    await this.execute(sql, params);
  }
  async conditionalUpdate(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<void> {
    const result = await this.execute(sql, params);
    if (result.changes !== 1)
      throw new ApplicationError("CONFLICT", "Conditional update lost", 409);
  }
  async transaction(
    statements: readonly SqlStatement[],
  ): Promise<readonly WriteResult[]> {
    try {
      return await this.database.batch(statements);
    } catch (error) {
      throw databaseError(error);
    }
  }
}

export interface D1Result<T> {
  results?: T[];
  meta?: { changes?: number; last_row_id?: number };
  success: boolean;
  error?: string;
}
export interface D1PreparedStatement {
  bind(...values: SqlValue[]): D1PreparedStatement;
  run<T>(): Promise<D1Result<T>>;
  all<T>(): Promise<D1Result<T>>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export class D1SqlDatabase implements SqlDatabase {
  private readonly d1: D1Database;
  constructor(d1: D1Database) {
    this.d1 = d1;
  }
  private prepare(statement: SqlStatement): D1PreparedStatement {
    return this.d1.prepare(statement.sql).bind(...(statement.params ?? []));
  }
  async execute(statement: SqlStatement): Promise<WriteResult> {
    const result = await this.prepare(statement).run();
    if (!result.success) throw new Error(result.error ?? "D1 operation failed");
    return {
      changes: result.meta?.changes ?? 0,
      ...(result.meta?.last_row_id === undefined
        ? {}
        : { lastRowId: result.meta.last_row_id }),
    };
  }
  async query<T>(statement: SqlStatement): Promise<readonly T[]> {
    const result = await this.prepare(statement).all<T>();
    if (!result.success) throw new Error(result.error ?? "D1 query failed");
    return result.results ?? [];
  }
  async batch(
    statements: readonly SqlStatement[],
  ): Promise<readonly WriteResult[]> {
    const results = await this.d1.batch(
      statements.map((statement) => this.prepare(statement)),
    );
    if (results.some((result) => !result.success))
      throw new Error("D1 atomic batch failed");
    return results.map((result) => ({ changes: result.meta?.changes ?? 0 }));
  }
}
