// Playwright global setup - waits for the actual deployed preview to reflect the code just
// pushed before any test runs. Root cause of a real, discovered timing race: "Workers Builds"
// (the deployment) and "validate" (this test run) are two independent, parallel GitHub Actions
// checks triggered by the same push - nothing guarantees the deployment finishes before this job
// starts.
//
// FINAL INTEGRATION REVIEW, Phase 2 (2026-08-25): strengthened from "some deployment is
// responding" to "the deployment answers as the expected environment", using the non-secret
// /internal/build-info route backed by Cloudflare's own version_metadata binding.
//
// CEO CORRECTION (2026-08-25): for the dedicated QA deployment, exact-commit identity is now
// verified via verifyBuildIdentity() (src/build-identity.ts) against EXPECTED_GIT_COMMIT_SHA -
// never GITHUB_SHA. Root cause of the prior failure (run 32861733744): GITHUB_SHA is one of
// GitHub Actions' reserved default environment variables; a step-level `env: GITHUB_SHA: ...`
// override displayed correctly in the step's own logged env block but did not reliably apply to
// the running process for a pull_request-triggered job (the process read the synthetic
// refs/pull/22/merge commit instead of the intended PR head SHA). GitHub's own documentation
// warns that redefining a default variable "may cause unexpected behavior" - this was that
// behavior, not a one-off fluke. EXPECTED_GIT_COMMIT_SHA is a plain, non-reserved variable name
// with no such collision risk.
import type { FullConfig } from '@playwright/test';
import { verifyBuildIdentity } from '../src/build-identity';

async function pollBuildInfo(baseURL: string, deadline: number): Promise<any> {
  let last: any = null;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseURL}/internal/build-info`).catch(() => null);
    if (res && res.status === 200) {
      last = await res.json().catch(() => null);
      if (last) return last;
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`global-setup: ${baseURL} did not return a valid /internal/build-info response before the deadline (last response: ${JSON.stringify(last)}).`);
}

async function globalSetup(config: FullConfig) {
  const baseURL = (config.projects[0]?.use as any)?.baseURL as string;
  if (!baseURL) throw new Error('global-setup: no baseURL configured');

  const previewDeadline = Date.now() + 90000; // bounded - never waits forever
  const preview = await pollBuildInfo(baseURL, previewDeadline);
  if (preview.environment !== 'preview' || preview.qaModeActive !== false) {
    throw new Error(`global-setup: ordinary preview identity check failed - expected environment=preview, qaModeActive=false, got ${JSON.stringify(preview)}.`);
  }
  const expectedVersion = process.env.EXPECTED_VERSION_ID;
  if (expectedVersion && preview.versionId !== expectedVersion) {
    throw new Error(`global-setup: deployed preview version ${preview.versionId} does not match expected ${expectedVersion} - refusing to run write-path tests against a stale or ambiguous deployment.`);
  }

  const qaBaseUrl = process.env.QA_BASE_URL;
  if (qaBaseUrl) {
    const qaDeadline = Date.now() + 90000;
    const qa = await pollBuildInfo(qaBaseUrl, qaDeadline);
    const identity = verifyBuildIdentity(qa, process.env);
    // Log only non-sensitive commit identifiers and the outcome - never any secret value.
    console.log(`global-setup: QA build-identity comparison - deployed=${qa.gitCommitSha ?? 'null'} expected=${process.env.EXPECTED_GIT_COMMIT_SHA ?? 'unset'} match=${identity.ok}`);
    if (!identity.ok) {
      throw new Error(`global-setup: QA build identity check failed - ${identity.reason}. "some version is live" is not sufficient; refusing to run write-path tests against an unverified commit.`);
    }
  }
}

export default globalSetup;
