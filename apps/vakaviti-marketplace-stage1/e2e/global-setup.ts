// Playwright global setup - waits for the actual deployed preview to reflect the code just
// pushed before any test runs. Root cause of a real, discovered timing race: "Workers Builds"
// (the deployment) and "validate" (this test run) are two independent, parallel GitHub Actions
// checks triggered by the same push - nothing guarantees the deployment finishes before this job
// starts. Polls a route that only exists in the current push (a real behavioral marker, not a
// fixed timeout) rather than guessing a fixed sleep duration.
import type { FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  const baseURL = (config.projects[0]?.use as any)?.baseURL as string;
  if (!baseURL) throw new Error('global-setup: no baseURL configured');

  const deadline = Date.now() + 90000; // bounded - never waits forever
  let lastStatus = -1;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseURL}/internal/qa-cleanup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reference: 'VKV-READY0' }),
    }).catch(() => null);
    lastStatus = res?.status ?? -1;
    // 200 = the route exists and DEAL_EXCHANGE_QA_DB is bound - the deployment this test run
    // needs is live. 400 also proves the route exists (just rejects this particular fixed
    // reference format on some future signature change) - either is a valid readiness signal.
    if (lastStatus === 200 || lastStatus === 400) return;
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`global-setup: preview deployment did not become ready within 90s (last status: ${lastStatus}). Workers Builds may still be deploying - do not increase this timeout blindly; investigate deployment lag instead.`);
}

export default globalSetup;
