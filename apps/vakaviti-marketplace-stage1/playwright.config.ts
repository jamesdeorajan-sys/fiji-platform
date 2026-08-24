import { defineConfig } from '@playwright/test';

// Entry gate 1: executes against the REAL deployed branch preview (not a local dev server, not
// mocked HTML) - the exact same URL used for manual verification throughout this milestone. The
// alias is stable for this branch's name (confirmed empirically this engagement), so this URL
// does not change between pushes.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30000,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'https://ceo-vakaviti-live-deal-exchange-vakaviti-marketplace-stage1.helpronline.workers.dev',
    ignoreHTTPSErrors: false,
  },
});
