import { defineConfig } from 'vitest/config';

// Plain Node test environment - deal-exchange-model.ts uses only Web-standard APIs
// (crypto.subtle, URL), already available in Node 22 (this repo's CI version), so a full Workers
// runtime simulation is not required to exercise the real, unmodified TypeScript source.
export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
