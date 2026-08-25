import { describe, it, expect } from 'vitest';
import { verifyBuildIdentity } from '../build-identity';

// CEO CORRECTION (2026-08-25): regression coverage for the build-identity comparison, proving the
// exact defect from run 32861733744 cannot recur - GitHub's reserved GITHUB_SHA must never be
// able to influence this comparison, and every failure mode must fail closed, not open.

const QA_BUILD_INFO = { environment: 'qa', qaModeActive: true, gitCommitSha: 'a'.repeat(40) };

describe('verifyBuildIdentity - EXPECTED_GIT_COMMIT_SHA is the only thing that matters', () => {
  it('passes when the deployed commit matches EXPECTED_GIT_COMMIT_SHA', () => {
    const result = verifyBuildIdentity(QA_BUILD_INFO, { EXPECTED_GIT_COMMIT_SHA: 'a'.repeat(40) });
    expect(result.ok).toBe(true);
  });

  it('GITHUB_SHA cannot affect the comparison, even when it disagrees with everything else', () => {
    // The exact real-world scenario that broke run 32861733744: GITHUB_SHA held an unrelated
    // value (the refs/pull/N/merge synthetic commit) while the deployed commit and
    // EXPECTED_GIT_COMMIT_SHA genuinely matched each other. The comparison must still pass.
    const env = {
      EXPECTED_GIT_COMMIT_SHA: 'a'.repeat(40),
      GITHUB_SHA: '595864d0803f713fd702a510d1e11a7997c73442', // deliberately different, deliberately irrelevant
    };
    const result = verifyBuildIdentity(QA_BUILD_INFO, env);
    expect(result.ok).toBe(true);
  });

  it('GITHUB_SHA cannot cause a false pass either - a genuine mismatch on EXPECTED_GIT_COMMIT_SHA still fails, even if GITHUB_SHA happens to match the deployed commit', () => {
    const env = {
      EXPECTED_GIT_COMMIT_SHA: 'b'.repeat(40), // genuinely wrong
      GITHUB_SHA: 'a'.repeat(40), // happens to equal the deployed commit - must NOT be consulted
    };
    const result = verifyBuildIdentity(QA_BUILD_INFO, env);
    expect(result.ok).toBe(false);
  });
});

describe('verifyBuildIdentity - fails closed on every malformed/missing/mismatching case', () => {
  it('fails when EXPECTED_GIT_COMMIT_SHA is missing entirely', () => {
    const result = verifyBuildIdentity(QA_BUILD_INFO, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/missing or malformed/);
  });

  it('fails when EXPECTED_GIT_COMMIT_SHA is malformed (not a 40-char hex SHA)', () => {
    const result = verifyBuildIdentity(QA_BUILD_INFO, { EXPECTED_GIT_COMMIT_SHA: 'not-a-real-sha' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/missing or malformed/);
  });

  it('fails when the deployed gitCommitSha is missing (null)', () => {
    const result = verifyBuildIdentity({ ...QA_BUILD_INFO, gitCommitSha: null }, { EXPECTED_GIT_COMMIT_SHA: 'a'.repeat(40) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/deployed gitCommitSha missing or malformed/);
  });

  it('fails when the deployed gitCommitSha is malformed', () => {
    const result = verifyBuildIdentity({ ...QA_BUILD_INFO, gitCommitSha: 'short' }, { EXPECTED_GIT_COMMIT_SHA: 'a'.repeat(40) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/deployed gitCommitSha missing or malformed/);
  });

  it('fails when the two well-formed SHAs simply do not match', () => {
    const result = verifyBuildIdentity(QA_BUILD_INFO, { EXPECTED_GIT_COMMIT_SHA: 'c'.repeat(40) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/does not match EXPECTED_GIT_COMMIT_SHA/);
  });

  it('fails when the deployment does not report itself as the QA environment', () => {
    const result = verifyBuildIdentity({ ...QA_BUILD_INFO, environment: 'preview' }, { EXPECTED_GIT_COMMIT_SHA: 'a'.repeat(40) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/expected environment=qa/);
  });

  it('fails when qaModeActive is not exactly true', () => {
    const result = verifyBuildIdentity({ ...QA_BUILD_INFO, qaModeActive: false }, { EXPECTED_GIT_COMMIT_SHA: 'a'.repeat(40) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/expected environment=qa/);
  });
});
