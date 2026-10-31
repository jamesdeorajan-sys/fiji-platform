// SYNTHETIC. Installed-app reload/update behaviour without a service worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, synthGuest } from '../test/fixtures.mjs';
import worker from '../worker/worker.js';
const get = (env, p, h = {}) => worker.fetch(new Request('http://marau.test' + p, { headers: h }), env);

test('app shell: build indicator + version.json agree; shell revalidates; private API is no-store', async () => {
  const env = makeEnv({ BULA_BUILD: 'b-2026-11-01-a', BULA_COMMIT: 'abc1234' });
  const page = await get(env, '/'); const t = await page.text();
  assert.match(t, /id="app-build" data-build="b-2026-11-01-a"/); assert.equal(page.headers.get('cache-control'), 'no-cache');
  const v = await (await get(env, '/version.json')).json(); assert.deepEqual([v.app, v.build, v.commit], ['marau-bula', 'b-2026-11-01-a', 'abc1234']);
  const g = await worker.fetch(new Request('http://marau.test/preview/bookings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(synthGuest({ leg_type: 'arrival' })) }), env);
  const tok = (await g.json()).access_token; const trip = await get(env, '/preview/trip', { authorization: `Bearer ${tok}` });
  assert.equal(trip.status, 200); assert.equal(trip.headers.get('cache-control'), 'no-store');
  assert.equal((await get(env, '/preview/trip')).headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(JSON.stringify(v), /tok_|token|secret/i);
});
test('UPDATE PATH: an "installed" client holding build A sees build B on reload; manifest identity (start_url/scope) is unchanged so the install is preserved', async () => {
  const A = makeEnv({ BULA_BUILD: 'A' }); const B = { ...A, BULA_BUILD: 'B' };
  const held = (await (await get(A, '/version.json')).json()).build;                       // client launched build A
  const relaunch = await (await get(B, '/')).text();                                        // server redeployed; client reloads the shell
  assert.match(relaunch, /data-build="B"/); assert.notEqual((await (await get(B, '/version.json')).json()).build, held);
  const mA = await (await get(A, '/manifest.json')).json(), mB = await (await get(B, '/manifest.json')).json();
  assert.deepEqual(mA, mB); assert.equal(mB.start_url, '/'); assert.equal(mB.scope, '/'); assert.equal(mB.display, 'standalone');
});
test('no build configured shows "unset" (honest), and hostile build strings cannot inject markup', async () => {
  const env = makeEnv(); assert.match(await (await get(env, '/')).text(), /data-build="unset"/);
  const evil = makeEnv({ BULA_BUILD: '"><script>alert(1)</script>' }); const t = await (await get(evil, '/')).text(); assert.doesNotMatch(t, /<script>alert\(1\)/);
});
