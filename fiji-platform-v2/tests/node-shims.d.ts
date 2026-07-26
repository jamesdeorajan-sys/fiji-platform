declare module "node:test" {
  export const describe: (name: string, fn: () => void) => void;
  export const it: (name: string, fn: () => void | Promise<void>) => void;
}
declare module "node:assert/strict" {
  const assert: {
    equal(a: unknown, b: unknown): void;
    deepEqual(a: unknown, b: unknown): void;
    ok(v: unknown): void;
    throws(fn: () => unknown, expected?: RegExp): void;
    rejects(
      fn: () => Promise<unknown>,
      expected?: (error: unknown) => boolean,
    ): Promise<void>;
  };
  export default assert;
}
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      all(...values: (string | number | null)[]): unknown[];
      run(...values: (string | number | null)[]): {
        changes: bigint;
        lastInsertRowid: bigint;
      };
    };
  }
}
declare module "node:fs" {
  export function readFileSync(path: URL, encoding: string): string;
  export function readdirSync(path: URL): string[];
}
