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
 *
 * Round 25 correction: Codex independently executed the token/cookie
 * functions EXTRACTED FROM THE REAL GUEST_APP_HTML STRING and found
 * getCookie's escaping broken in the actually-served text (a bug this
 * file's own round-24 tests, which hand-reimplemented the logic instead
 * of executing the real served bytes, never caught). getCookie has been
 * rewritten with zero regex/backslashes, and every client-side test in
 * this file now extracts and EXECUTES the real function source out of
 * GUEST_APP_HTML via `new Function(...)`, never a copy. Separately: a
 * cookie surviving in these tests is a simulation of storage behavior,
 * not a reproduction of an actual iPhone installation — Apple documents
 * cookies being copied at install time specifically, which is a one-time
 * event and does not by itself guarantee ongoing shared storage between
 * Safari and the standalone container afterward. Real-device acceptance
 * remains pending James's own retest.
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

// ---------------------------------------------------------------------
// Round 25 correction: Codex independently executed the token/cookie
// functions EXTRACTED FROM THE REAL GUEST_APP_HTML STRING (not a
// hand-copied reimplementation) and found that getCookie's escaping was
// broken by the time it reached the served text — a bug this file's
// round-24 tests never caught precisely BECAUSE they retyped the logic
// inline instead of executing the real served bytes. This helper pulls
// the actual function source out of GUEST_APP_HTML between two fixed,
// verified markers and executes it with `new Function(...)`, so every
// test below runs the exact code a real browser would receive — never
// a copy.
// ---------------------------------------------------------------------

function loadRealClientTokenFunctions() {
  const start = GUEST_APP_HTML.indexOf('function getCookie(name) {');
  const end = GUEST_APP_HTML.indexOf('function authFetch');
  assert.ok(start !== -1 && end !== -1 && end > start, 'could not locate the real getCookie..clearToken block in GUEST_APP_HTML — markers may have moved');
  const realSource = GUEST_APP_HTML.slice(start, end);
  // A belt-and-braces check that this really is unmodified served source,
  // not a stand-in: it must still contain the exact function names this
  // test depends on.
  for (const name of ['getCookie', 'setCookie', 'clearCookie', 'getToken', 'setToken', 'clearToken']) {
    assert.ok(realSource.includes('function ' + name + '('), `extracted block is missing function ${name} — extraction markers may be wrong`);
  }
  return new Function(
    'document', 'sessionStorage', 'localStorage', 'location',
    realSource + '\nreturn { getCookie: getCookie, setCookie: setCookie, clearCookie: clearCookie, getToken: getToken, setToken: setToken, clearToken: clearToken };'
  );
}

function makeMockBrowser(initialHash) {
  const sessionStore = new Map();
  const localStore = new Map();
  let cookieJar = '';
  const sessionStorage = { getItem: (k) => (sessionStore.has(k) ? sessionStore.get(k) : null), setItem: (k, v) => sessionStore.set(k, v), removeItem: (k) => sessionStore.delete(k) };
  const localStorage = { getItem: (k) => (localStore.has(k) ? localStore.get(k) : null), setItem: (k, v) => localStore.set(k, v), removeItem: (k) => localStore.delete(k) };
  const document = {
    get cookie() { return cookieJar; },
    set cookie(v) {
      const [pair] = v.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (/max-age=0/i.test(v)) {
        cookieJar = cookieJar.split('; ').filter((c) => c && !c.startsWith(name + '=')).join('; ');
      } else {
        const rest = cookieJar.split('; ').filter((c) => c && !c.startsWith(name + '='));
        rest.push(`${name}=${value}`);
        cookieJar = rest.join('; ');
      }
    },
  };
  const location = { hash: initialHash || '' };
  return { document, sessionStorage, localStorage, location, sessionStore, localStore, setRawCookie: (v) => { cookieJar = v; } };
}

test('round25: the extraction markers actually isolate real, runnable getCookie/setCookie/clearCookie/getToken/setToken/clearToken source from GUEST_APP_HTML', () => {
  const factory = loadRealClientTokenFunctions();
  const { document, sessionStorage, localStorage, location } = makeMockBrowser('');
  const fns = factory(document, sessionStorage, localStorage, location);
  for (const name of ['getCookie', 'setCookie', 'clearCookie', 'getToken', 'setToken', 'clearToken']) {
    assert.equal(typeof fns[name], 'function', `${name} must be a real, callable function extracted from the served app`);
  }
});

test('round25 (Codex repro, case 1): with the REAL served getCookie, document.cookie = "marau_tok=test-token" (cookie alone) — getCookie must return "test-token"', () => {
  const factory = loadRealClientTokenFunctions();
  const { document, sessionStorage, localStorage, location } = makeMockBrowser('');
  const { getCookie } = factory(document, sessionStorage, localStorage, location);
  document.cookie = 'marau_tok=test-token';
  assert.equal(getCookie('marau_tok'), 'test-token');
});

test('round25 (Codex repro, case 2 — the actual reported bug): with the REAL served getCookie, document.cookie = "other=1; marau_tok=test-token" (cookie AFTER another) — getCookie must still return "test-token", not null', () => {
  const factory = loadRealClientTokenFunctions();
  const { document, sessionStorage, localStorage, location, setRawCookie } = makeMockBrowser('');
  const { getCookie } = factory(document, sessionStorage, localStorage, location);
  setRawCookie('other=1; marau_tok=test-token');
  assert.equal(getCookie('marau_tok'), 'test-token', 'the exact case Codex found broken: getCookie incorrectly returned null when marau_tok followed another cookie');
});

test('round25: with the REAL served getCookie, a cookie appearing BEFORE another cookie ("marau_tok=test-token; other=1") is also found', () => {
  const factory = loadRealClientTokenFunctions();
  const { document, sessionStorage, localStorage, location, setRawCookie } = makeMockBrowser('');
  const { getCookie } = factory(document, sessionStorage, localStorage, location);
  setRawCookie('marau_tok=test-token; other=1');
  assert.equal(getCookie('marau_tok'), 'test-token');
});

test('round25: with the REAL served getCookie, an absent cookie (no marau_tok anywhere) returns null, never a false match', () => {
  const factory = loadRealClientTokenFunctions();
  const { document, sessionStorage, localStorage, location, setRawCookie } = makeMockBrowser('');
  const { getCookie } = factory(document, sessionStorage, localStorage, location);
  setRawCookie('other=1; another=2');
  assert.equal(getCookie('marau_tok'), null);
});

test('round25: end-to-end with the REAL served getToken() — cookie ALONE, sessionStorage empty, localStorage empty, no hash — the exact iPhone-reopen repro', () => {
  const factory = loadRealClientTokenFunctions();
  const setup = makeMockBrowser('#tok=secure-trip-token-xyz');
  const first = factory(setup.document, setup.sessionStorage, setup.localStorage, setup.location);
  // Establish the token the way the Safari tab would (writes all three).
  first.getToken();

  // Simulate the standalone container's own storages coming up genuinely
  // empty on relaunch, exactly as James's device showed — only the
  // cookie (copied at install time, per Apple's own documented behavior)
  // is still present. A fresh factory call models a fresh JS realm, the
  // same way a relaunched standalone app gets a fresh page load.
  setup.sessionStore.clear();
  setup.localStore.clear();
  setup.location.hash = '';
  const second = factory(setup.document, setup.sessionStorage, setup.localStorage, setup.location);
  const recovered = second.getToken();
  assert.equal(recovered, 'secure-trip-token-xyz', 'both storages empty, no fragment — the real served getToken() must still recover the token from the cookie');
});

test('round25: end-to-end with the REAL served getToken() — cookie set alongside an unrelated cookie written first (the Codex repro shape), storages empty', () => {
  const factory = loadRealClientTokenFunctions();
  const setup = makeMockBrowser('');
  setup.setRawCookie('other=1; marau_tok=secure-trip-token-abc');
  const fns = factory(setup.document, setup.sessionStorage, setup.localStorage, setup.location);
  assert.equal(fns.getToken(), 'secure-trip-token-abc');
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
