#!/usr/bin/env node
/* NAT controlled-deployment smoke tool. READ-ONLY: GET / OPTIONS only. It never creates a booking, enquiry, assignment or message, and it NEVER prints a secret or a guest value
 * (only HTTP status codes, field NAMES and counts). Node >= 18.
 *   node nat_smoke.mjs capture <label> [baseUrl]      -> writes smoke-<label>.json (status + normalised body hash of safe probes)
 *   node nat_smoke.mjs compare <a.json> <b.json>      -> exit 1 if any existing-route probe differs
 *   node nat_smoke.mjs closed [baseUrl]               -> new routes must answer 401 for: no token, junk token (and master token if ADMIN_TOKEN is exported)
 *   SOURCE_READ_TOKEN=... node nat_smoke.mjs source [baseUrl]   -> authenticated, controlled, read-only checks of both new routes */
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
const [cmd, a1, a2] = process.argv.slice(2); const BASE = (cmd === 'capture' ? a2 : cmd === 'compare' ? null : a1) || 'https://api.nadiairporttransfers.com';
const norm = (t) => t.replace(/nonce="[^"]*"/g, 'nonce="N"').replace(/\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d+)?Z?/g, 'TS').replace(/\b1\d{12}\b/g, 'MS').replace(/"(uptime|now|time|timestamp|checked_at)":\s*[^,}]+/g, '"$1":"X"');
const get = async (path, { method = 'GET', token } = {}) => { const r = await fetch(BASE + path, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, redirect: 'manual', signal: AbortSignal.timeout(15000) }); const t = await r.text(); return { status: r.status, text: t }; };
const PROBES = [['GET', '/health'], ['GET', '/zones'], ['GET', '/destinations'], ['GET', '/fuel-index'], ['OPTIONS', '/bookings'], ['OPTIONS', '/rental-enquiries'], ['GET', '/admin/bookings'], ['GET', '/admin/dashboard-stats'], ['GET', '/admin/drivers'], ['GET', '/admin/rentals'], ['GET', '/admin/rentals-console'], ['GET', '/admin/whatsapp/templates'], ['GET', '/driver/jobs'], ['GET', '/no-such-route-smoke']];
if (cmd === 'capture') { const out = {}; for (const [m, p] of PROBES) { const r = await get(p, { method: m }); out[`${m} ${p}`] = { status: r.status, bodySha256: createHash('sha256').update(norm(r.text)).digest('hex') }; console.log(r.status, m, p); } writeFileSync(`smoke-${a1}.json`, JSON.stringify({ base: BASE, probes: out }, null, 2)); }
else if (cmd === 'compare') { const A = JSON.parse(readFileSync(a1)).probes, B = JSON.parse(readFileSync(a2)).probes; let bad = 0; for (const k of Object.keys(A)) { const same = A[k].status === B[k]?.status && A[k].bodySha256 === B[k]?.bodySha256; if (!same) bad++; console.log(same ? 'SAME' : 'DIFF', k, A[k].status, '->', B[k]?.status); } console.log(bad ? `${bad} DIFFERENCE(S) - ABORT` : 'all existing-route probes identical'); process.exit(bad ? 1 : 0); }
else if (cmd === 'closed') { let bad = 0; const tokens = [[undefined, 'no token'], ['junk-token-for-smoke', 'junk token'], ...(process.env.ADMIN_TOKEN ? [[process.env.ADMIN_TOKEN, 'MASTER admin token']] : [])];
  for (const p of ['/admin/bookings/recent?after=0', '/admin/bookings/1']) for (const [t, n] of tokens) { const r = await get(p, { token: t }); const ok = r.status === 401; if (!ok) bad++; console.log(ok ? 'OK ' : 'LEAK', r.status, p.split('?')[0], n); }
  console.log(bad ? 'NEW ROUTES NOT FAIL-CLOSED - REMOVE SOURCE_READ_TOKEN / ROLL BACK' : 'new routes fail closed (401)'); process.exit(bad ? 1 : 0); }
else if (cmd === 'source') { const tok = process.env.SOURCE_READ_TOKEN; if (!tok) { console.error('SOURCE_READ_TOKEN not set'); process.exit(2); } let bad = 0; const chk = (ok, m) => { if (!ok) bad++; console.log(ok ? 'OK  ' : 'FAIL', m); };
  const boot = await get('/admin/bookings/recent', { token: tok }); chk(boot.status === 200, `discovery bootstrap 200 (got ${boot.status})`); let j = {}; try { j = JSON.parse(boot.text); } catch {}
  chk(Array.isArray(j.items) && j.items.length === 0 && Number.isInteger(j.max_id), 'bootstrap returns no items and an integer max_id'); const mx = j.max_id;
  const win = await get(`/admin/bookings/recent?after=${Math.max(0, mx - 3)}&limit=3`, { token: tok }); const w = JSON.parse(win.text); chk(win.status === 200 && w.items.length <= 3 && w.items.every((i) => Object.keys(i).sort().join() === 'created_at,id,status'), 'discovery items carry only id/created_at/status (max 3)');
  const bad400 = await get('/admin/bookings/recent?limit=101', { token: tok }); chk(bad400.status === 400, 'limit=101 rejected (400)');
  const one = await get(`/admin/bookings/${mx}`, { token: tok }); let b = {}; try { b = JSON.parse(one.text).booking || {}; } catch {}
  const WL = 'assigned_driver_id,client_booking_ref,commission_base_fjd,created_at,destination_zone,flight_number,guest_email,guest_phone,id,pickup_date,pickup_time,pickup_zone,quoted_amount,quoted_currency,return_date,return_pickup_location,return_time,settlement_amount_fjd,status,vehicle_type';
  chk(one.status === 200 && Object.keys(b).sort().join() === WL, `single read returns exactly the 20 whitelisted field names (keys only printed; ${Object.keys(b).length} keys)`);
  chk(!/guest_name|notes|source_ip|payment_method|first_source/.test(one.text), 'no name / notes / IP / payment / attribution fields present');
  chk((await get('/admin/bookings/99999999', { token: tok })).status === 404, 'unknown id -> 404');
  console.log(bad ? `${bad} FAILURE(S) - ABORT / KILL` : 'source + discovery verified (read-only)'); process.exit(bad ? 1 : 0); }
else { console.error('usage: capture <label> [base] | compare a.json b.json | closed [base] | source [base]'); process.exit(2); }
