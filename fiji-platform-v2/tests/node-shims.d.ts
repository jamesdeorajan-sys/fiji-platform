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
  };
  export default assert;
}
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): { all(): unknown[] };
  }
}
declare module "node:fs" {
  export function readFileSync(path: URL, encoding: string): string;
}
