import { defineConfig } from '@playwright/test';

// Entry gate 1: executes against the REAL deployed branch preview (not a local dev server, not
// mocked HTML) - the exact same URL used for manual verification throughout this milestone. The
// alias is stable for this branch's name (confirmed empirically this engagement), so this URL
// does not change between pushes.
//
// Blocker 2 (CEO review): retries must be 0, not a way to paper over non-determinism. Flakiness
// found this milestone had two real causes, both fixed at the root rather than retried away:
// (1) the SEO test drove browser rendering for content that's 100% server-rendered - fixed by
// testing the raw HTTP response directly; (2) "Workers Builds" (deployment) and this test run are
// independent parallel CI checks with no ordering guarantee - fixed with globalSetup polling a
// real deployment-readiness signal instead of assuming the deploy already finished.
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 30000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'https://ceo-vakaviti-live-deal-exchange-vakaviti-marketplace-stage1.helpronline.workers.dev',
    ignoreHTTPSErrors: false,
  },
});
