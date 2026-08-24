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
// CEO DECISION - Phase 5 (2026-08-25): "some version is live" is no longer sufficient for the
// dedicated QA deployment - the exact GIT COMMIT must match. When QA_BASE_URL is set (only true
// in the protected vakaviti-qa deployment job), this also polls the QA deployment's build-info
// and requires gitCommitSha === GITHUB_SHA exactly, plus environment==='qa' and
// qaModeActive===true - failing closed (never proceeding to the write-path tests) on any
// mismatch, timeout, or missing value.
import type { FullConfig } from '@playwright/test';

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
  const expectedCommitSha = process.env.GITHUB_SHA;
  if (qaBaseUrl) {
    if (!expectedCommitSha) throw new Error('global-setup: QA_BASE_URL is set but GITHUB_SHA is not - cannot verify exact commit identity, refusing to proceed.');
    const qaDeadline = Date.now() + 90000;
    const qa = await pollBuildInfo(qaBaseUrl, qaDeadline);
    if (qa.environment !== 'qa' || qa.qaModeActive !== true) {
      throw new Error(`global-setup: QA deployment identity check failed - expected environment=qa, qaModeActive=true, got ${JSON.stringify(qa)}.`);
    }
    if (qa.gitCommitSha !== expectedCommitSha) {
      throw new Error(`global-setup: QA deployment git commit ${qa.gitCommitSha} does not match GITHUB_SHA ${expectedCommitSha} - "some version is live" is not sufficient; refusing to run write-path tests against an unverified commit.`);
    }
  }
}

export default globalSetup;
