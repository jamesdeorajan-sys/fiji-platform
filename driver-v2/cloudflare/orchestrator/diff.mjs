// Production-untouched comparison. PASS requires ZERO unexplained differences outside the two isolated resources; anything else => HOLD / INVESTIGATE.
import { ISOLATED, PRODUCTION_DENYLIST } from '../src/safety.js';
const j = (x) => JSON.stringify(x);

export function diffSnapshots(before, after) {
  const problems = []; const checked = {};
  const iw = ISOLATED.WORKER_NAME; const id1 = ISOLATED.D1_NAME;
  // 1. every worker except the isolated one: identical id set + modified_on + etag
  const ids = new Set([...Object.keys(before.workers), ...Object.keys(after.workers)]); let n = 0;
  for (const id of ids) { if (id === iw) continue; n++; if (j(before.workers[id]) !== j(after.workers[id])) problems.push(`WORKER ${before.workers[id] ? (after.workers[id] ? 'CHANGED' : 'REMOVED') : 'ADDED'}: ${id}`); }
  checked.workers = n;
  // 2. watched production workers in detail (bindings, schedules, secret names, deployments)
  for (const name of new Set([...Object.keys(before.prod_workers), ...Object.keys(after.prod_workers)])) {
    for (const k of ['bindings', 'schedules', 'secrets', 'deployments']) if (j(before.prod_workers[name]?.[k]) !== j(after.prod_workers[name]?.[k])) problems.push(`PRODUCTION WORKER ${name}: ${k} changed`);
  }
  checked.production_workers_detailed = Object.keys(before.prod_workers).length;
  // 3. every D1 except the isolated one
  n = 0; for (const name of new Set([...Object.keys(before.d1), ...Object.keys(after.d1)])) { if (name === id1) continue; n++; if (j(before.d1[name]) !== j(after.d1[name])) problems.push(`D1 ${before.d1[name] ? (after.d1[name] ? 'CHANGED' : 'REMOVED') : 'ADDED'}: ${name}`); }
  checked.d1 = n;
  if (after.d1[id1] && after.d1[id1].uuid !== ISOLATED.D1_UUID) problems.push('isolated D1 uuid is not the pinned uuid');
  for (const bad of PRODUCTION_DENYLIST.d1_ids) if (Object.values(after.d1).some((d) => d.uuid === bad && d.uuid !== before.d1['nadi-marketplace-db']?.uuid)) problems.push('production D1 uuid appeared unexpectedly');
  // 4. routes and custom domains (NAT / FijiDash / customer routes live here): full-set equality, and none may reference the isolated worker
  if (j(before.zone_routes) !== j(after.zone_routes)) problems.push('ZONE ROUTES changed (NAT/FijiDash/customer routes must be identical)');
  checked.zone_routes = before.zone_routes.length;
  if (j(before.domains) !== j(after.domains)) problems.push('WORKER CUSTOM DOMAINS changed');
  checked.domains = before.domains.length;
  if (after.zone_routes.some((r) => r.script === iw)) problems.push('a zone route points at the isolated worker');
  if (after.domains.some((d) => d.service === iw)) problems.push('a custom domain points at the isolated worker');
  // 5. the isolated resources must be back to their quiescent state
  const iso = after.isolated || {};
  if (iso.workers_dev_enabled) problems.push('ISOLATED worker: workers.dev is still ENABLED');
  if ((iso.schedules || []).length) problems.push('ISOLATED worker: schedules exist');
  if ((iso.secrets || []).length) problems.push(`ISOLATED worker: secrets remain (${(iso.secrets || []).join(',')})`);
  if ((iso.bindings || []).length) problems.push(`ISOLATED worker: bindings remain (${(iso.bindings || []).map((b) => b.name).join(',')}) - not restored to the zero-binding shell`);
  if (!iso.d1 || iso.d1.uuid !== ISOLATED.D1_UUID || iso.d1.name !== ISOLATED.D1_NAME) problems.push('isolated D1 identity not confirmed after teardown (must still exist, unchanged identity)');
  return { production_untouched: problems.filter((p) => !p.startsWith('ISOLATED')).length === 0, isolated_quiescent: problems.filter((p) => p.startsWith('ISOLATED') || p.includes('isolated')).length === 0, clean: problems.length === 0, problems, checked };
}
