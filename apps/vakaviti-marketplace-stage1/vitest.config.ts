import { defineConfig } from 'vitest/config';

// Plain Node test environment, not @cloudflare/vitest-pool-workers - the functions under test
// (opportunity-gate.ts, and opportunities.ts against the in-memory D1 mock in
// src/__tests__/fake-d1.ts) use only Web-standard APIs (crypto.subtle, URL, fetch is never
// called by any of them) already available in Node 22 (the version this repo's CI uses), so a
// full Workers runtime simulation is not required to exercise the real, unmodified TypeScript
// source - these tests import src/opportunity-gate.ts and src/opportunities.ts directly.
export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
