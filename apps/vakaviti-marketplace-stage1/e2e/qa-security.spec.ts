import { test, expect } from '@playwright/test';
import { createHmac, randomBytes } from 'node:crypto';

// FINAL INTEGRATION REVIEW, Phase 4 (2026-08-25): explicit security tests for the hardened QA
// gate. Split deliberately into two groups:
//   - Group A runs against the ORDINARY branch preview (today's baseURL) and is always safe to
//     run: DEAL_EXCHANGE_QA_DB is not bound there at all (see wrangler.toml), so these assertions
//     can never create a stray write - there's nothing for a spoofed header to reach.
//   - Group B needs a live, deployed dedicated QA environment plus its real QA_AUTH_SECRET to
//     construct valid/invalid signed requests against. Neither exists yet (see the FINAL REPORT's
//     open question about provisioning a Cloudflare credential for CI) - these are skipped, not
//     faked, until QA_BASE_URL and QA_AUTH_SECRET are supplied to the CI job.

test.describe('Group A - ordinary preview cannot be tricked into QA behaviour (safe, zero residue)', () => {
  test('a spoofed QA header set (run id + fake HMAC signature) still gets a 404 from qa-cleanup, not a 401 or 200', async ({ request }) => {
    // A 404 here (not 401/503) proves the route is structurally unreachable on this deployment -
    // DEAL_EXCHANGE_QA_DB simply isn't bound, so the handler never even gets to the auth check.
    const response = await request.post('/internal/qa-cleanup', {
      headers: {
        'x-vakaviti-qa-run-id': 'pw-fake-0000000000-abcdef',
        'x-vakaviti-qa-timestamp': String(Date.now()),
        'x-vakaviti-qa-nonce': 'a'.repeat(32),
        'x-vakaviti-qa-signature': 'f'.repeat(64),
      },
      data: { reference: 'VKV-ABC123' },
    });
    expect(response.status()).toBe(404);
  });

  test('qa-cleanup 404s even with completely absent/malformed auth headers', async ({ request }) => {
    const response = await request.post('/internal/qa-cleanup', { data: { reference: 'VKV-ABC123' } });
    expect(response.status()).toBe(404);
  });

  test('/internal/build-info reports this deployment as NOT QA mode', async ({ request }) => {
    const response = await request.get('/internal/build-info');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.environment).toBe('preview');
    expect(body.qaModeActive).toBe(false);
  });
});

test.describe('Group B - live QA environment auth behaviour (needs QA_BASE_URL + QA_AUTH_SECRET)', () => {
  const qaBaseUrl = process.env.QA_BASE_URL;
  const qaSecret = process.env.QA_AUTH_SECRET;
  test.skip(!qaBaseUrl || !qaSecret, 'QA_BASE_URL/QA_AUTH_SECRET not provided to this CI run - the dedicated QA environment is pending a separate CEO infrastructure decision (Phase 1 item 2 of the Final Integration Review). See the FINAL REPORT.');

  function sign(runId: string, nonce: string, timestamp: string) {
    return createHmac('sha256', qaSecret!).update(`${runId}.${nonce}.${timestamp}`).digest('hex');
  }

  test('unauthenticated cleanup fails (QA env reachable, but no auth headers at all)', async ({ request }) => {
    const response = await request.post(`${qaBaseUrl}/internal/qa-cleanup`, { data: { reference: 'VKV-ABC123' } });
    expect(response.status()).toBe(401);
  });

  test('malformed signature fails', async ({ request }) => {
    const runId = `pw-sec-${Date.now()}-a`;
    const timestamp = String(Date.now());
    const nonce = randomBytes(16).toString('hex');
    const response = await request.post(`${qaBaseUrl}/internal/qa-cleanup`, {
      headers: { 'x-vakaviti-qa-run-id': runId, 'x-vakaviti-qa-timestamp': timestamp, 'x-vakaviti-qa-nonce': nonce, 'x-vakaviti-qa-signature': 'not-a-real-signature' },
      data: { reference: 'VKV-ABC123' },
    });
    expect(response.status()).toBe(401);
  });

  test('an expired timestamp fails, even with an otherwise-correct signature', async ({ request }) => {
    const runId = `pw-sec-${Date.now()}-c`;
    const timestamp = String(Date.now() - 10 * 60 * 1000); // 10 minutes old - outside the 5 minute skew window
    const nonce = randomBytes(16).toString('hex');
    const response = await request.post(`${qaBaseUrl}/internal/qa-cleanup`, {
      headers: { 'x-vakaviti-qa-run-id': runId, 'x-vakaviti-qa-timestamp': timestamp, 'x-vakaviti-qa-nonce': nonce, 'x-vakaviti-qa-signature': sign(runId, nonce, timestamp) },
      data: { reference: 'VKV-ABC123' },
    });
    expect(response.status()).toBe(401);
  });

  test('a malformed run id fails (does not match the pw-<worker>-<ts>-<rand> shape)', async ({ request }) => {
    const runId = 'not-a-valid-run-id';
    const timestamp = String(Date.now());
    const nonce = randomBytes(16).toString('hex');
    const response = await request.post(`${qaBaseUrl}/internal/qa-cleanup`, {
      headers: { 'x-vakaviti-qa-run-id': runId, 'x-vakaviti-qa-timestamp': timestamp, 'x-vakaviti-qa-nonce': nonce, 'x-vakaviti-qa-signature': sign(runId, nonce, timestamp) },
      data: { reference: 'VKV-ABC123' },
    });
    expect(response.status()).toBe(401);
  });

  test('a replayed (previously-used) signature fails on its second use', async ({ request }) => {
    const runId = `pw-sec-${Date.now()}-b`;
    const timestamp = String(Date.now());
    const nonce = randomBytes(16).toString('hex');
    const signature = sign(runId, nonce, timestamp);
    const headers = { 'x-vakaviti-qa-run-id': runId, 'x-vakaviti-qa-timestamp': timestamp, 'x-vakaviti-qa-nonce': nonce, 'x-vakaviti-qa-signature': signature };

    const first = await request.post(`${qaBaseUrl}/internal/qa-cleanup`, { headers, data: { reference: 'VKV-NOPE01' } });
    // First use is authenticated (even though the reference doesn't exist, that's a 200 no-op per
    // the cleanup route's own contract - the point here is only that auth succeeded).
    expect(first.status()).toBe(200);

    const replay = await request.post(`${qaBaseUrl}/internal/qa-cleanup`, { headers, data: { reference: 'VKV-NOPE01' } });
    expect(replay.status()).toBe(401);
  });

  test('one run cannot clean up a reference created by a different run', async ({ page, request }) => {
    const ownerRunId = `pw-sec-${Date.now()}-owner`;
    const attackerRunId = `pw-sec-${Date.now()}-attacker`;

    function headersFor(runId: string) {
      const timestamp = String(Date.now());
      const nonce = randomBytes(16).toString('hex');
      return { 'x-vakaviti-qa-run-id': runId, 'x-vakaviti-qa-timestamp': timestamp, 'x-vakaviti-qa-nonce': nonce, 'x-vakaviti-qa-signature': sign(runId, nonce, timestamp) };
    }

    await page.goto(`${qaBaseUrl}/`);
    await page.setExtraHTTPHeaders(headersFor(ownerRunId));
    await page.goto(`${qaBaseUrl}/chat`);
    await page.fill('#dates', 'September 2026, 7 nights');
    await page.fill('#party', '2 adults');
    await page.fill('#hotel', 'Denarau');
    await page.fill('#q', `Cross-run cleanup attack test [qa:${ownerRunId}]`);
    await page.click('button[type=submit]');
    const text = await page.locator('main').innerText();
    const refMatch = text.match(/VKV-[A-Z0-9]{6}/);
    expect(refMatch, 'no enquiry reference rendered').toBeTruthy();
    const reference = refMatch![0];

    try {
      const attackerAttempt = await request.post(`${qaBaseUrl}/internal/qa-cleanup`, { headers: headersFor(attackerRunId), data: { reference } });
      expect(attackerAttempt.status()).toBe(403);
    } finally {
      const ownerCleanup = await request.post(`${qaBaseUrl}/internal/qa-cleanup`, { headers: headersFor(ownerRunId), data: { reference } });
      const body = await ownerCleanup.json();
      expect(body.residueForReference).toBe(0);
    }
  });
});
