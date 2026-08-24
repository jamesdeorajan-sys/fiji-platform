// Playwright global setup - waits for the actual deployed preview to reflect the code just
// pushed before any test runs. Root cause of a real, discovered timing race: "Workers Builds"
// (the deployment) and "validate" (this test run) are two independent, parallel GitHub Actions
// checks triggered by the same push - nothing guarantees the deployment finishes before this job
// starts.
//
// FINAL INTEGRATION REVIEW, Phase 2 (2026-08-25): strengthened from "some deployment is
// responding" to "the deployment answers as the expected environment", using the non-secret
// /internal/build-info route backed by Cloudflare's own version_metadata binding - no injected
// commit SHA, no chicken-and-egg problem of a commit embedding its own hash inside itself.
//
// Honest, disclosed gap: exact per-commit verification (this precise git SHA, not just "the
// preview environment") requires cross-checking the returned versionId against Cloudflare's
// Versions API, which needs a Cloudflare credential inside this CI job - none exists yet (see the
// FINAL REPORT's open question). When EXPECTED_VERSION_ID is supplied (it is not, today), this
// still fails closed on a mismatch rather than silently proceeding.
import type { FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  const baseURL = (config.projects[0]?.use as any)?.baseURL as string;
  if (!baseURL) throw new Error('global-setup: no baseURL configured');

  const deadline = Date.now() + 90000; // bounded - never waits forever
  let last: any = null;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseURL}/internal/build-info`).catch(() => null);
    if (res && res.status === 200) {
      last = await res.json().catch(() => null);
      if (last && last.environment === 'preview') {
        const expected = process.env.EXPECTED_VERSION_ID;
        if (expected && last.versionId !== expected) {
          throw new Error(`global-setup: deployed version ${last.versionId} does not match expected ${expected} - refusing to run write-path tests against a stale or ambiguous deployment.`);
        }
        return;
      }
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`global-setup: preview deployment did not become ready within 90s (last build-info response: ${JSON.stringify(last)}). Workers Builds may still be deploying - do not increase this timeout blindly; investigate deployment lag instead.`);
}

export default globalSetup;
