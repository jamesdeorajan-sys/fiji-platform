// CEO CORRECTION (2026-08-25): pure, unit-testable build-identity comparison logic, extracted out
// of e2e/global-setup.ts so it can be exercised deterministically by Vitest (network-free) rather
// than only ever running live inside a Playwright global setup.
//
// Root cause of the prior failure: GITHUB_SHA is one of GitHub Actions' reserved default
// environment variables. Attempting to override it at the step level (`env: GITHUB_SHA: ...`)
// displayed the intended value in the step's own logged env block, but the value actually visible
// to the running process differed - for this specific pull_request-triggered run, the process
// read GITHUB_SHA as 595864d0803f713fd702a510d1e11a7997c73442 (the synthetic refs/pull/22/merge
// commit) rather than the PR head SHA the workflow was told to substitute. GitHub's own docs
// caution that default variables are effectively reserved and warn that redefining them "may
// cause unexpected behavior" - this run is direct proof of that, not a one-off fluke. The fix is
// to never read or rely on GITHUB_SHA for this comparison at all, using a dedicated,
// non-reserved variable name instead (EXPECTED_GIT_COMMIT_SHA) that carries no collision risk.
export interface BuildInfo {
  environment?: string | null;
  qaModeActive?: boolean | null;
  gitCommitSha?: string | null;
}

export type IdentityResult = { ok: true } | { ok: false; reason: string };

const SHA_PATTERN = /^[0-9a-f]{40}$/;

export function verifyBuildIdentity(buildInfo: BuildInfo, env: Record<string, string | undefined>): IdentityResult {
  // Deliberately reads ONLY env.EXPECTED_GIT_COMMIT_SHA - env.GITHUB_SHA is never referenced
  // anywhere in this function, by construction, so it cannot affect the outcome regardless of
  // what GitHub Actions (or anything else) sets it to.
  const expected = env.EXPECTED_GIT_COMMIT_SHA;
  if (!expected || !SHA_PATTERN.test(expected)) {
    return { ok: false, reason: `EXPECTED_GIT_COMMIT_SHA missing or malformed (${expected ?? 'unset'})` };
  }
  if (buildInfo.environment !== 'qa' || buildInfo.qaModeActive !== true) {
    return { ok: false, reason: `identity check failed - expected environment=qa, qaModeActive=true, got ${JSON.stringify(buildInfo)}` };
  }
  const deployed = buildInfo.gitCommitSha;
  if (typeof deployed !== 'string' || !SHA_PATTERN.test(deployed)) {
    return { ok: false, reason: `deployed gitCommitSha missing or malformed (${deployed ?? 'null'})` };
  }
  if (deployed !== expected) {
    return { ok: false, reason: `deployed commit ${deployed} does not match EXPECTED_GIT_COMMIT_SHA ${expected}` };
  }
  return { ok: true };
}
