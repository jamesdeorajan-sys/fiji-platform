// Compares the 'before' and 'after' metadata snapshots and asserts that NO pre-existing Worker or D1 changed during the Gate 1.5 proof window.
// Only the isolated Worker (driver-v2-gate15-isolated) and isolated D1 are allowed to appear as new/changed. Exit 1 on any other difference.
import fs from 'node:fs'; import path from 'node:path';
const dir = process.argv[2] || path.join(process.cwd(), 'evidence', 'gate15', 'remote'); const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const ALLOWED_W = 'driver-v2-gate15-isolated', ALLOWED_D = 'driver-v2-gate15-isolated-20261103'; const problems = [];
const key = (arr, k) => Object.fromEntries(arr.map((x) => [x[k], x]));
const bw = key(rd('before.all_workers_modified_on.json'), 'id'), aw = key(rd('after.all_workers_modified_on.json'), 'id');
for (const id of new Set([...Object.keys(bw), ...Object.keys(aw)])) { if (id === ALLOWED_W) continue; if (JSON.stringify(bw[id]) !== JSON.stringify(aw[id])) problems.push(`WORKER CHANGED/ADDED/REMOVED: ${id}`); }
const bd = key(rd('before.all_d1_identity.json'), 'name'), ad = key(rd('after.all_d1_identity.json'), 'name');
for (const n of new Set([...Object.keys(bd), ...Object.keys(ad)])) { if (n === ALLOWED_D) continue; if (JSON.stringify(bd[n]) !== JSON.stringify(ad[n])) problems.push(`D1 CHANGED/ADDED/REMOVED: ${n}`); }
const routes = rd('after.zone_routes.json').routes_pointing_at_isolated_worker; if (routes.length) problems.push(`ROUTES point at the isolated worker: ${JSON.stringify(routes)}`);
const out = { production_untouched: problems.length === 0, problems, workers_compared: Object.keys(bw).length, d1_compared: Object.keys(bd).length };
fs.writeFileSync(path.join(dir, 'production-untouched.json'), JSON.stringify(out, null, 2) + '\n'); console.log(JSON.stringify(out, null, 2)); process.exit(problems.length ? 1 : 0);
