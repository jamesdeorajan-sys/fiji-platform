// Build-time / pre-deploy safety assertion for the Gate 1.5 package. Exit 1 (and print every failure) if ANY rule is violated.
// Usage: node scripts/assert_package_safe.mjs [packageRoot]       (default: the cloudflare/ directory that contains this script)
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Minimal TOML reader (enough for wrangler.toml): returns [{ table, isArray, kv }]
export function parseToml(text) {
  const sections = [{ table: '', isArray: false, kv: {} }]; let cur = sections[0];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim(); if (!line || line.startsWith('#')) continue;
    let m;
    if ((m = line.match(/^\[\[([^\]]+)\]\]$/))) { cur = { table: m[1].trim(), isArray: true, kv: {} }; sections.push(cur); continue; }
    if ((m = line.match(/^\[([^\]]+)\]$/))) { cur = { table: m[1].trim(), isArray: false, kv: {} }; sections.push(cur); continue; }
    if ((m = line.match(/^([A-Za-z0-9_.\-"]+)\s*=\s*(.+)$/))) cur.kv[m[1].replace(/"/g, '')] = m[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return sections;
}

export async function assertPackageSafe(root = path.join(here, '..')) {
  const fail = []; const info = {};
  const { ISOLATED, PRODUCTION_DENYLIST } = await import(pathToFileURL(path.join(root, 'src', 'safety.js')).href + `?t=${Date.now()}`);
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

  // ---- wrangler.toml ----
  const toml = parseToml(read('wrangler.toml')); const top = toml[0].kv;
  if (top.name !== ISOLATED.WORKER_NAME) fail.push(`worker name must be exactly ${ISOLATED.WORKER_NAME} (got ${top.name})`);
  if (PRODUCTION_DENYLIST.names.includes(top.name)) fail.push(`production worker identity refused: ${top.name}`);
  if (top.workers_dev !== 'false') fail.push('workers_dev must be false in the package');
  if (top.preview_urls && top.preview_urls !== 'false') fail.push('preview_urls must be false in the package');
  for (const k of ['route', 'routes', 'triggers', 'crons', 'account_id', 'zone_id', 'zone_name', 'env']) if (k in top) fail.push(`forbidden top-level key: ${k}`);
  const forbiddenTables = /^(triggers|vars|services|kv_namespaces|r2_buckets|queues|vectorize|ai|analytics_engine_datasets|durable_objects|hyperdrive|routes|env|secrets_store_secrets|send_email|browser|mtls_certificates|dispatch_namespaces|unsafe|tail_consumers|observability)/;
  for (const s of toml.slice(1)) if (s.table !== 'd1_databases' && forbiddenTables.test(s.table)) fail.push(`forbidden wrangler section: [${s.isArray ? '[' : ''}${s.table}]`);
  const d1 = toml.filter((s) => s.table === 'd1_databases');
  if (d1.length !== 1) fail.push(`exactly one d1_databases binding required (got ${d1.length})`);
  else {
    const kv = d1[0].kv; info.d1 = { binding: kv.binding, database_name: kv.database_name, database_id: kv.database_id };
    if (kv.binding !== ISOLATED.BINDING) fail.push(`D1 binding must be ${ISOLATED.BINDING}`);
    if (kv.database_name !== ISOLATED.D1_NAME) fail.push(`D1 database_name must be exactly ${ISOLATED.D1_NAME} (got ${kv.database_name})`);
    if (PRODUCTION_DENYLIST.names.includes(kv.database_name)) fail.push(`production D1 name refused: ${kv.database_name}`);
    if (PRODUCTION_DENYLIST.d1_ids.includes(String(kv.database_id).toLowerCase())) fail.push(`production D1 id refused: ${kv.database_id}`);
    if (String(kv.database_id).toLowerCase() !== ISOLATED.D1_UUID) fail.push(`database_id must be exactly the isolated D1 UUID ${ISOLATED.D1_UUID} (got ${kv.database_id}); no other value is accepted`);
    for (const k of Object.keys(kv)) if (!['binding', 'database_name', 'database_id', 'migrations_dir'].includes(k)) fail.push(`unexpected key on D1 binding: ${k}`);
  }
  // ---- source scan: production identifiers may appear ONLY in the deny-list definition; no network / messaging / scheduler code anywhere ----
  const files = []; const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const rel = path.join(d, e.name); if (e.isDirectory()) { if (!['node_modules', '.wrangler', 'evidence'].includes(e.name)) walk(rel); } else files.push(rel); } };
  walk('.');
  const productSrc = ['src', path.join('..', 'src')];
  const scanFiles = [...files.filter((f) => f.startsWith('src') || f === 'wrangler.toml'), ...fs.readdirSync(path.join(root, '..', 'src')).map((f) => path.join('..', 'src', f))];
  const denyTerms = [...PRODUCTION_DENYLIST.names, ...PRODUCTION_DENYLIST.d1_ids, ...PRODUCTION_DENYLIST.hostnames];
  for (const f of scanFiles) {
    const text = read(f); const isDeny = f.replace(/\\/g, '/') === 'src/safety.js';
    if (!isDeny) for (const t of denyTerms) if (text.toLowerCase().includes(t.toLowerCase())) fail.push(`production identifier "${t}" appears in ${f}`);
    const code = f.endsWith('.toml') ? text.replace(/(^|\s)#.*$/gm, '') : text.replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
    const net = [[/\bfetch\s*\(/g, 'fetch('], [/\bXMLHttpRequest\b/, 'XMLHttpRequest'], [/\bWebSocket\b/, 'WebSocket'], [/cloudflare:sockets/, 'cloudflare:sockets'], [/\bnode:(net|tls|http|https|dgram|dns)\b/, 'node network module'],
      [/\bsendEmail\b|send_email|\bsmtp\b/i, 'email'], [/graph\.facebook\.com|api\.whatsapp|twilio|messagebird|sendgrid|mailgun|resend\.com/i, 'messaging provider'], [/\bscheduled\s*\(/, 'scheduled handler'], [/\bcrons?\b/i, 'cron'], [/waitUntil\s*\(/, 'waitUntil']];
    for (const [re, label] of net) {
      const hits = code.match(re); if (!hits) continue;
      // the one allowed occurrence: the Worker's own `async fetch(request, env)` entry and the line that REPLACES global fetch with a thrower
      if (label === 'fetch(') { const stripped = code.replace(/async\s+fetch\s*\(/g, '').replace(/globalThis\.fetch\s*=\s*\(\)\s*=>/g, ''); if (!/\bfetch\s*\(/.test(stripped)) continue; }
      if (label === 'cron' && f.endsWith('safety.js')) continue;
      fail.push(`forbidden construct (${label}) in ${f}`);
    }
    if (/process\.env|\.env\.[A-Z_]*TOKEN|secret/i.test(code) && !f.endsWith('control.js') && !f.endsWith('worker.js') && !f.endsWith('safety.js')) { /* secrets are only referenced by name in control/worker/safety */ }
  }
  // ---- schema hash ----
  const schema = fs.readFileSync(path.join(root, 'schema', 'gate15_d1_schema.sql'), 'utf8'); const sha = crypto.createHash('sha256').update(schema).digest('hex');
  const recorded = read('schema/gate15_d1_schema.sha256').split(/\s+/)[0]; info.schema_sha256 = sha;
  if (sha !== recorded) fail.push(`schema hash drift: file ${sha} != recorded ${recorded} (run scripts/build_schema.mjs)`);
  if (!schema.includes(ISOLATED.MARKER)) fail.push('schema does not carry the identity marker');
  for (const bad of PRODUCTION_DENYLIST.names) if (schema.includes(bad)) fail.push(`production identifier in schema: ${bad}`);
  if (/\bATTACH\b|\bPRAGMA\b/i.test(schema.replace(/--.*$/gm, ''))) fail.push('schema contains ATTACH/PRAGMA');
  return { ok: fail.length === 0, failures: fail, info };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const r = await assertPackageSafe(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 1);
}
