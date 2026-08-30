import { describe, it, expect } from 'vitest';
import { verifyQaAuth, hmacHex, timingSafeEqual } from '../deal-exchange-ui';
import { FakeD1 } from './fake-d1';

// FINAL INTEGRATION REVIEW, Phase 1 (2026-08-25): deterministic unit coverage for the multi-factor
// QA gate that replaced the old header-only check. Deliberately does NOT hit any live deployment -
// these are pure-function/mock-DB assertions, so they carry zero residue risk and run identically
// in every CI environment regardless of whether the dedicated QA Worker has been deployed yet.

const SECRET = 'unit-test-only-secret-never-a-real-credential';
const RUN_ID = 'pw-0-1234567890-abcdef';

async function sign(runId: string, nonce: string, timestamp: string) {
  return hmacHex(SECRET, `${runId}.${nonce}.${timestamp}`);
}

function makeCtx(overrides: Partial<{ env: any; headers: Record<string, string> }> = {}) {
  const qaDb = new FakeD1();
  const env = {
    DEAL_EXCHANGE_QA_DB: qaDb,
    QA_TEST_MODE: 'true',
    QA_AUTH_SECRET: SECRET,
    ...(overrides.env || {}),
  };
  const headers = overrides.headers || {};
  return {
    env,
    req: { header: (name: string) => headers[name.toLowerCase()] },
  };
}

describe('timingSafeEqual', () => {
  it('accepts identical strings', () => expect(timingSafeEqual('abc123', 'abc123')).toBe(true));
  it('rejects differing strings of equal length', () => expect(timingSafeEqual('abc123', 'abc124')).toBe(false));
  it('rejects differing lengths without throwing', () => expect(timingSafeEqual('abc', 'abcd')).toBe(false));
});

describe('verifyQaAuth - spoofed header cannot select QA_DB when not the QA environment', () => {
  it('fails when DEAL_EXCHANGE_QA_DB is not bound (the ordinary preview/production shape), even with an otherwise-perfect signature', async () => {
    const timestamp = String(Date.now());
    const nonce = 'a'.repeat(32);
    const signature = await sign(RUN_ID, nonce, timestamp);
    const c = makeCtx({
      env: { DEAL_EXCHANGE_QA_DB: undefined },
      headers: { 'x-vakaviti-qa-timestamp': timestamp, 'x-vakaviti-qa-nonce': nonce, 'x-vakaviti-qa-signature': signature },
    });
    const result = await verifyQaAuth(c, RUN_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not the QA environment');
  });

  it('fails when QA_TEST_MODE is not "true", even inside a deployment that has the QA_DB binding', async () => {
    const timestamp = String(Date.now());
    const nonce = 'b'.repeat(32);
    const signature = await sign(RUN_ID, nonce, timestamp);
    const c = makeCtx({
      env: { QA_TEST_MODE: 'false' },
      headers: { 'x-vakaviti-qa-timestamp': timestamp, 'x-vakaviti-qa-nonce': nonce, 'x-vakaviti-qa-signature': signature },
    });
    const result = await verifyQaAuth(c, RUN_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('QA_TEST_MODE not enabled');
  });
});

describe('verifyQaAuth - malformed and unauthenticated requests fail', () => {
  it('rejects a missing run id', async () => {
    const c = makeCtx();
    const result = await verifyQaAuth(c, undefined);
    expect(result.ok).toBe(false);
  });

  it('rejects a missing signature/timestamp/nonce entirely (the old header-only shape)', async () => {
    const c = makeCtx({ headers: {} });
    const result = await verifyQaAuth(c, RUN_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/timestamp/);
  });

  it('rejects a well-formed but wrong signature', async () => {
    const timestamp = String(Date.now());
    const nonce = 'c'.repeat(32);
    const c = makeCtx({ headers: { 'x-vakaviti-qa-timestamp': timestamp, 'x-vakaviti-qa-nonce': nonce, 'x-vakaviti-qa-signature': 'f'.repeat(64) } });
    const result = await verifyQaAuth(c, RUN_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid signature');
  });

  it('rejects a stale timestamp outside the allowed skew', async () => {
    const timestamp = String(Date.now() - 10 * 60 * 1000); // 10 minutes old
    const nonce = 'd'.repeat(32);
    const signature = await sign(RUN_ID, nonce, timestamp);
    const c = makeCtx({ headers: { 'x-vakaviti-qa-timestamp': timestamp, 'x-vakaviti-qa-nonce': nonce, 'x-vakaviti-qa-signature': signature } });
    const result = await verifyQaAuth(c, RUN_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/skew/);
  });

  it('rejects when QA_AUTH_SECRET is not bound', async () => {
    const timestamp = String(Date.now());
    const nonce = 'e'.repeat(32);
    const signature = await sign(RUN_ID, nonce, timestamp);
    const c = makeCtx({ env: { QA_AUTH_SECRET: undefined }, headers: { 'x-vakaviti-qa-timestamp': timestamp, 'x-vakaviti-qa-nonce': nonce, 'x-vakaviti-qa-signature': signature } });
    const result = await verifyQaAuth(c, RUN_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('QA_AUTH_SECRET not bound');
  });
});

describe('verifyQaAuth - a correctly signed request succeeds exactly once (replay protection)', () => {
  it('accepts a valid signature the first time, then rejects the identical replayed request', async () => {
    const timestamp = String(Date.now());
    const nonce = 'f'.repeat(32);
    const signature = await sign(RUN_ID, nonce, timestamp);
    const c = makeCtx({ headers: { 'x-vakaviti-qa-timestamp': timestamp, 'x-vakaviti-qa-nonce': nonce, 'x-vakaviti-qa-signature': signature } });

    const first = await verifyQaAuth(c, RUN_ID);
    expect(first.ok).toBe(true);

    const replay = await verifyQaAuth(c, RUN_ID);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toMatch(/replay/);
  });
});
