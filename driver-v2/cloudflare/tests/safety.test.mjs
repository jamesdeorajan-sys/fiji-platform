// Negative-control tests for the Gate 1.5 isolation guards: each production-ish mistake MUST be refused. No network, no Cloudflare access.
import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { assertPackageSafe } from '../scripts/assert_package_safe.mjs';
import { assertEnvShape, assertHostAllowed, assertIsolatedDatabase, _resetVerifiedForTests, IsolationError, ISOLATED, EXPECTED_TABLES } from '../src/safety.js';

const here = path.dirname(fileURLToPath(import.meta.url)); const pkg = path.join(here, '..'); const srcRoot = path.join(pkg, '..', 'src');
function sandbox(mutate) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g15-'));
  fs.cpSync(srcRoot, path.join(tmp, 'src'), { recursive: true });
  fs.cpSync(pkg, path.join(tmp, 'cloudflare'), { recursive: true, filter: (s) => !/node_modules|\.wrangler|evidence/.test(s) });
  const root = path.join(tmp, 'cloudflare'); mutate?.(root); return root;
}
const edit = (root, rel, fn) => { const p = path.join(root, rel); fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8'))); };
const refuses = async (name, mutate, needle) => test(`package refuses: ${name}`, async () => {
  const r = await assertPackageSafe(sandbox(mutate)); assert.equal(r.ok, false, 'must be refused'); assert.ok(r.failures.some((f) => f.includes(needle)), `${needle} not in ${JSON.stringify(r.failures)}`);
});

test('the package as shipped passes the safety assertion', async () => { const r = await assertPackageSafe(pkg); assert.deepEqual(r.failures, []); assert.equal(r.ok, true); });

await refuses('production D1 name nadi-marketplace-db', (r) => edit(r, 'wrangler.toml', (s) => s.replace('driver-v2-gate15-isolated-20261103"\ndatabase_id', 'nadi-marketplace-db"\ndatabase_id')), 'nadi-marketplace-db');
await refuses('production D1 id', (r) => edit(r, 'wrangler.toml', (s) => s.replace(/database_id = ".*"/, 'database_id = "0ec1cd84-fcda-4f7f-8337-0fb70fe1a512"')), 'production D1 id refused');
await refuses('an arbitrary (non-pinned) UUID', (r) => edit(r, 'wrangler.toml', (s) => s.replace(/database_id = ".*"/, 'database_id = "11111111-2222-3333-4444-555555555555"')), 'must be exactly the isolated D1 UUID');
await refuses('the old deploy-time placeholder (UUID is now pinned in the package)', (r) => edit(r, 'wrangler.toml', (s) => s.replace(/database_id = ".*"/, 'database_id = "SET_AT_DEPLOY_X"')), 'must be exactly the isolated D1 UUID');
await refuses('production worker identity nadi-dispatch-api', (r) => edit(r, 'wrangler.toml', (s) => s.replace('name = "driver-v2-gate15-isolated"', 'name = "nadi-dispatch-api"')), 'production worker identity refused');
await refuses('a route', (r) => edit(r, 'wrangler.toml', (s) => `route = "example.com/*"\n${s}`), 'forbidden top-level key: route');
await refuses('routes table', (r) => edit(r, 'wrangler.toml', (s) => `${s}\n[[routes]]\npattern = "x.example/*"\n`), 'forbidden wrangler section');
await refuses('a cron trigger', (r) => edit(r, 'wrangler.toml', (s) => `${s}\n[triggers]\ncrons = ["* * * * *"]\n`), 'forbidden wrangler section');
await refuses('workers_dev = true', (r) => edit(r, 'wrangler.toml', (s) => s.replace('workers_dev = false', 'workers_dev = true')), 'workers_dev must be false');
await refuses('a second D1 binding', (r) => edit(r, 'wrangler.toml', (s) => `${s}\n[[d1_databases]]\nbinding = "DB2"\ndatabase_name = "other"\ndatabase_id = "SET_AT_DEPLOY_X"\n`), 'exactly one d1_databases binding');
await refuses('a KV binding', (r) => edit(r, 'wrangler.toml', (s) => `${s}\n[[kv_namespaces]]\nbinding = "K"\nid = "abc"\n`), 'forbidden wrangler section');
await refuses('plain [vars]', (r) => edit(r, 'wrangler.toml', (s) => `${s}\n[vars]\nTOKEN = "x"\n`), 'forbidden wrangler section');
await refuses('a service binding', (r) => edit(r, 'wrangler.toml', (s) => `${s}\n[[services]]\nbinding = "S"\nservice = "nadi-dispatch-api"\n`), 'forbidden wrangler section');
await refuses('outbound fetch() in worker source', (r) => edit(r, 'src/worker.js', (s) => `${s}\nawait fetch('https://example.invalid/');\n`), 'forbidden construct (fetch()');
await refuses('a scheduled handler', (r) => edit(r, 'src/worker.js', (s) => s.replace('export default {', 'export default {\n  async scheduled(e, env) {},')), 'scheduled handler');
await refuses('a WhatsApp/messaging provider reference', (r) => edit(r, 'src/d1_capture.js', (s) => `${s}\nconst u = 'https://graph.facebook.com/v1/messages';\n`), 'messaging provider');
await refuses('a production hostname in source', (r) => edit(r, 'src/control.js', (s) => `${s}\nconst h = 'nadiairporttransfers.com';\n`), 'nadiairporttransfers.com');
await refuses('a production worker name in source', (r) => edit(r, 'src/control.js', (s) => `${s}\nconst n = 'nadi-dispatch-api';\n`), 'nadi-dispatch-api');
await refuses('schema drift vs recorded hash', (r) => edit(r, 'schema/gate15_d1_schema.sql', (s) => `${s}\n-- tampered\n`), 'schema hash drift');
await refuses('a core-service file that sends over the network', (r) => fs.appendFileSync(path.join(r, '..', 'src', 'service.js'), "\nawait fetch('https://x.invalid');\n"), 'forbidden construct (fetch()');

test('runtime: unexpected bindings are refused', () => {
  assert.doesNotThrow(() => assertEnvShape({ DB: {}, GATE15_CONTROL_TOKEN: 't' })); assert.doesNotThrow(() => assertEnvShape({ DB: {} }));
  for (const k of ['PROD_DB', 'WHATSAPP_TOKEN', 'NAT_API', 'KV']) assert.throws(() => assertEnvShape({ DB: {}, [k]: 1 }), (e) => e instanceof IsolationError && e.reason === `UNEXPECTED_BINDING:${k}`);
  assert.throws(() => assertEnvShape({}), (e) => e.reason === 'NO_DB_BINDING');
});
test('runtime: only localhost and the isolated workers.dev host are served; every production hostname is refused', () => {
  for (const h of ['localhost', '127.0.0.1', 'driver-v2-gate15-isolated.someaccount.workers.dev']) assert.doesNotThrow(() => assertHostAllowed(h));
  for (const h of ['nadiairporttransfers.com', 'www.nadiairporttransfers.com', 'api.fijidash.com', 'vakaviti.ai', 'lagi.vakaviti.ai', 'kiaoratransferstoursfiji.tours']) assert.throws(() => assertHostAllowed(h), (e) => e.reason === 'PRODUCTION_HOSTNAME_REFUSED');
  for (const h of ['nadi-dispatch-api.x.workers.dev', 'evil.workers.dev', 'example.com', '']) assert.throws(() => assertHostAllowed(h), (e) => e.reason === 'HOSTNAME_NOT_ALLOWLISTED');
});
const fakeDb = ({ marker = { marker: ISOLATED.MARKER, worker_name: ISOLATED.WORKER_NAME }, tables = EXPECTED_TABLES, identityThrows = false } = {}) => ({
  prepare: (sql) => ({ first: async () => { if (identityThrows) throw new Error('no such table'); return marker; }, all: async () => ({ results: tables.map((name) => ({ name })) }) }),
});
test('runtime: a database without the identity marker, with a wrong marker, or with foreign (production-like) tables is refused', async () => {
  _resetVerifiedForTests(); await assert.rejects(assertIsolatedDatabase(fakeDb({ identityThrows: true })), (e) => e.reason === 'IDENTITY_TABLE_MISSING');
  await assert.rejects(assertIsolatedDatabase(fakeDb({ marker: null })), (e) => e.reason === 'IDENTITY_MARKER_MISMATCH');
  await assert.rejects(assertIsolatedDatabase(fakeDb({ marker: { marker: 'nadi-marketplace-db', worker_name: 'x' } })), (e) => e.reason === 'IDENTITY_MARKER_MISMATCH');
  await assert.rejects(assertIsolatedDatabase(fakeDb({ tables: [...EXPECTED_TABLES, 'negotiation_requests', 'geocoded_addresses'] })), (e) => e.reason.startsWith('FOREIGN_TABLES_PRESENT'));
  await assert.rejects(assertIsolatedDatabase(fakeDb({ tables: EXPECTED_TABLES.slice(1) })), (e) => e.reason.startsWith('SCHEMA_INCOMPLETE'));
  _resetVerifiedForTests(); await assertIsolatedDatabase(fakeDb());      // the genuine isolated shape passes
});
test('runtime: the Worker entry returns 503 ISOLATION_ASSERTION_FAILED before touching anything when bound to a wrong database or host', async () => {
  const { default: worker } = await import('../src/worker.js'); _resetVerifiedForTests();
  const bad = await worker.fetch(new Request('https://driver-v2-gate15-isolated.acct.workers.dev/api/state'), { DB: fakeDb({ tables: [...EXPECTED_TABLES, 'bookings_prod'] }) });
  assert.equal(bad.status, 503); assert.equal((await bad.json()).code, 'ISOLATION_ASSERTION_FAILED');
  const host = await worker.fetch(new Request('https://nadiairporttransfers.com/api/state'), { DB: fakeDb() }); assert.equal(host.status, 503);
  const extra = await worker.fetch(new Request('http://localhost/api/state'), { DB: fakeDb(), NAT_DB: {} }); assert.equal(extra.status, 503);
  const nocontrol = await worker.fetch(new Request('http://localhost/__gate15/identity'), { DB: fakeDb() }); assert.equal(nocontrol.status, 404, 'control surface is closed without the isolated secret');
});
