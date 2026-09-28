/* Marau Stage 1 (PREVIEW ONLY) — round 24: the iPhone installation
 * blocker. James's own real device showed the guest link correctly
 * loading his confirmed Trip in Safari, but the SAME guest's freshly-
 * installed home-screen icon opened straight to the synthetic-entry
 * screen (screenshot evidence, 2026-09-29) — the standalone container's
 * own localStorage did not carry the token the Safari tab had just set.
 *
 * Fix: a cookie is now ALSO written whenever the token is established
 * (client-side, pages.js), checked as a genuinely independent THIRD
 * recovery path (never assumed to work, only tried, after both existing
 * storages) — and the server (worker.js's requireGuestSession) accepts
 * that same cookie as a second-line fallback to the ordinary
 * Authorization header. Neither mechanism is assumed to work on its
 * own; the whole point is redundancy across mechanisms with genuinely
 * different sharing behavior between a browser tab and a standalone
 * home-screen app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv, seedActiveOffer, synthGuest } from './fixtures.mjs';
import worker from '../worker/worker.js';
import { GUEST_APP_HTML } from '../worker/pages.js';

installNetworkGuard();

function req(path, opts = {}) {
  return new Request('http://marau-preview.test' + path, opts);
}
async function call(env, path, opts) {
  const res = await worker.fetch(req(path, opts), env);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
function withJson(method, body, headers = {}) {
  return { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) };
}
function authed(token) {
  return { authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------
// Client-side: the served script itself writes/reads a cookie, and the
// getToken() logic correctly recovers from it when BOTH sessionStorage
// AND localStorage are empty — the exact standalone-relaunch scenario a
// real device demonstrated, simulated here without a real browser.
// ---------------------------------------------------------------------

test('round24: the served app writes the token to a cookie in addition to both storages, and clears it on revoke', () => {
  assert.ok(GUEST_APP_HTML.includes("document.cookie"), 'the served app must reference document.cookie for token persistence');
  assert.ok(GUEST_APP_HTML.includes("setCookie('marau_tok'"), 'setToken must persist to a cookie too');
  assert.ok(GUEST_APP_HTML.includes("getCookie('marau_tok')"), 'getToken must be able to recover from the cookie');
  assert.ok(GUEST_APP_HTML.includes("clearCookie('marau_tok')"), 'clearToken/revoke must clear the cookie too');
});

test('round24: getToken() recovers from the cookie ALONE — sessionStorage empty, localStorage empty, no hash — the exact reported repro', () => {
  // A faithful re-implementation of the ACTUAL logic now embedded in
  // pages.js (mirrors the existing finding-3 test's own established
  // pattern for testing this client-side logic without a real browser).
  const sessionStore = new Map();
  const localStore = new Map();
  let cookieJar = '';
  const sessionStorage = { getItem: (k) => (sessionStore.has(k) ? sessionStore.get(k) : null), setItem: (k, v) => sessionStore.set(k, v), removeItem: (k) => sessionStore.delete(k) };
  const localStorage = { getItem: (k) => (localStore.has(k) ? localStore.get(k) : null), setItem: (k, v) => localStore.set(k, v), removeItem: (k) => localStore.delete(k) };
  const document = {
    get cookie() { return cookieJar; },
    set cookie(v) {
      // A tiny real cookie-jar simulation: parses "name=value; ...attrs"
      // and either sets or (max-age=0) clears that name in the jar.
      const [pair] = v.split(';');
      const [name, value] = pair.split('=');
      if (/max-age=0/i.test(v)) {
        cookieJar = cookieJar.split('; ').filter((c) => !c.startsWith(name + '=')).join('; ');
      } else {
        const rest = cookieJar.split('; ').filter((c) => c && !c.startsWith(name + '='));
        rest.push(`${name}=${value}`);
        cookieJar = rest.join('; ');
      }
    },
  };

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function setCookie(name, value) {
    document.cookie = name + '=' + encodeURIComponent(value) + '; path=/; max-age=31536000; samesite=lax; secure';
  }
  function getToken(location) {
    const m = location.hash.match(/tok=([^&]+)/);
    if (m) {
      try { sessionStorage.setItem('marau_tok', m[1]); } catch (e) {}
      try { localStorage.setItem('marau_tok', m[1]); } catch (e) {}
      try { setCookie('marau_tok', m[1]); } catch (e) {}
      return m[1];
    }
    try {
      const fromSession = sessionStorage.getItem('marau_tok');
      if (fromSession) return fromSession;
    } catch (e) {}
    try {
      const fromLocal = localStorage.getItem('marau_tok');
      if (fromLocal) return fromLocal;
    } catch (e) {}
    try {
      const fromCookie = getCookie('marau_tok');
      if (fromCookie) return fromCookie;
    } catch (e) {}
    return null;
  }

  // Simulate: the Safari tab established the token (sets all three).
  getToken({ hash: '#tok=secure-trip-token-xyz' });
  // Simulate: the standalone container's own localStorage/sessionStorage
  // came up genuinely empty on relaunch (the real repro) — but the
  // cookie (a different, more reliably-shared mechanism) is still there.
  sessionStore.clear();
  localStore.clear();
  assert.equal(sessionStorage.getItem('marau_tok'), null);
  assert.equal(localStorage.getItem('marau_tok'), null);

  const recovered = getToken({ hash: '' });
  assert.equal(recovered, 'secure-trip-token-xyz', 'the exact reported repro: both storages empty, no fragment — the cookie must still recover the token');
});

// ---------------------------------------------------------------------
// Server-side: requireGuestSession accepts the SAME cookie as a
// fallback — isolation, expiry and revocation are completely unchanged,
// and this never grants access via a booking reference/email/phone
// match, only the guest's own already-issued opaque token.
// ---------------------------------------------------------------------

test('round24: a request with ONLY a marau_tok cookie (no Authorization header) is authenticated exactly like the ordinary header', async () => {
  const env = makeEnv();
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const token = created.data.access_token;

  const viaCookie = await call(env, '/preview/trip', { headers: { cookie: `marau_tok=${token}` } });
  assert.equal(viaCookie.status, 200);
  assert.equal(viaCookie.data.bookings.length, 1);

  const viaHeader = await call(env, '/preview/trip', { headers: authed(token) });
  assert.deepEqual(viaCookie.data, viaHeader.data, 'the cookie-authenticated response must be identical to the header-authenticated one');
});

test('round24: the Authorization header still wins when BOTH are present, and a garbage cookie alongside a valid header never breaks auth', async () => {
  const env = makeEnv();
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const token = created.data.access_token;

  const both = await call(env, '/preview/trip', { headers: { authorization: `Bearer ${token}`, cookie: 'marau_tok=not-a-real-token' } });
  assert.equal(both.status, 200, 'a valid header must authenticate even with an unrelated, invalid cookie present');
});

test('round24: revocation is checked identically for the cookie path — a revoked token via cookie is rejected, exactly like via header', async () => {
  const env = makeEnv();
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const token = created.data.access_token;
  await call(env, '/preview/trip/revoke', { method: 'POST', headers: authed(token) });

  const viaCookie = await call(env, '/preview/trip', { headers: { cookie: `marau_tok=${token}` } });
  assert.equal(viaCookie.status, 401, 'a revoked token must be rejected via the cookie path exactly like via the header');
});

test('round24: an invalid/unknown cookie value is rejected, never silently treated as valid or matched to any guest by contact details', async () => {
  const env = makeEnv();
  const viaCookie = await call(env, '/preview/trip', { headers: { cookie: 'marau_tok=totally-made-up-value' } });
  assert.equal(viaCookie.status, 401);
});

test('round24: the guest-session cookie fallback is NEVER accepted as admin/staff authentication — requireAdmin is completely untouched', async () => {
  const env = makeEnv();
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const token = created.data.access_token;

  // A valid GUEST token, presented as a cookie, must not satisfy any
  // admin-token-gated route.
  const attempt = await call(env, '/preview/admin/deal-requests', { headers: { cookie: `marau_tok=${token}` } });
  assert.equal(attempt.status, 401, 'a guest session cookie must never authenticate an admin-gated route');

  // And the real admin token presented as a cookie (not the header)
  // must ALSO not work — requireAdmin only ever reads the Authorization
  // header, by design, completely separate from this round's change.
  const adminViaCookie = await call(env, '/preview/admin/deal-requests', { headers: { cookie: `marau_tok=${env.MARAU_ADMIN_TEST_TOKEN}` } });
  assert.equal(adminViaCookie.status, 401, 'requireAdmin must remain header-only, unaffected by the new guest cookie fallback');
});

test('round24: no duplicate booking entry — the cookie fallback authenticates an EXISTING session, it never creates or substitutes a new one', async () => {
  const env = makeEnv();
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const token = created.data.access_token;

  await call(env, '/preview/trip', { headers: { cookie: `marau_tok=${token}` } });
  await call(env, '/preview/trip', { headers: authed(token) });

  const { results: sessions } = await env.DB.prepare('SELECT * FROM guest_sessions WHERE access_token = ?').bind(token).all();
  assert.equal(sessions.length, 1, 'exactly one session must exist regardless of how many times it is authenticated via either mechanism');
});

// ---------------------------------------------------------------------
// End-to-end: install -> close -> reopen recovery, demonstrated with
// the cookie as the ONLY surviving mechanism (the exact reported gap).
// ---------------------------------------------------------------------

test('round24: end-to-end — a fresh booking, then a simulated "reopen the installed app with both JS storages empty" recovers the SAME confirmed trip via the cookie path', async () => {
  const env = makeEnv();
  const { offer } = await seedActiveOffer(env);
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const token = created.data.access_token;
  await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST', headers: authed(token) });

  // Simulate the "reopen" — only the cookie survives.
  const reopened = await call(env, '/preview/trip', { headers: { cookie: `marau_tok=${token}` } });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.data.bookings.length, 1);
  assert.equal(reopened.data.deal_requests.length, 1);
});
