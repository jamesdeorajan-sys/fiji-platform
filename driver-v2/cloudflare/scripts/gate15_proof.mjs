// Gate 1.5 proof runner. Drives the isolated Worker over REAL HTTP (genuinely concurrent requests) and reads the database back through the control surface.
// Targets: a local workerd (wrangler dev --local) for package validation, or - only after explicit CEO GO - the isolated Worker on workers.dev.
// It refuses to run against any host that is not localhost or driver-v2-gate15-isolated.*.workers.dev.
//   env: GATE15_BASE_URL  GATE15_CONTROL_TOKEN  [GATE15_RACES=200]  [GATE15_TARGET=local-workerd|remote-isolated]  [GATE15_OUT=<file>]  [GATE15_COMMIT=<sha>]
import fs from 'node:fs'; import path from 'node:path'; import { execSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { assertHostAllowed } from '../src/safety.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.GATE15_BASE_URL || '').replace(/\/$/, ''); const TOKEN = process.env.GATE15_CONTROL_TOKEN || '';
const TARGET = process.env.GATE15_TARGET || 'local-workerd'; const RACES = Number(process.env.GATE15_RACES || 200);
if (!BASE || !TOKEN) { console.error('GATE15_BASE_URL and GATE15_CONTROL_TOKEN are required'); process.exit(2); }
assertHostAllowed(new URL(BASE).hostname);                                              // client-side refusal of any non-isolated host
const OUT = process.env.GATE15_OUT || path.join(here, '..', '..', 'evidence', 'gate15', `${TARGET}-results.json`);
const CANARY = ['CANARY-GUEST-NAME-Zxq', '+000-CANARY-PHONE-7788', 'canary-guest@example.invalid', 'CANARY-FJ-999', 'CANARY-NOTE-meet-at-pillar-9'];
const FORBIDDEN_KEYS = ['guest_name', 'guest_phone', 'guest_email', 'flight_number', 'pickup_notes', 'phone', 'email', 'contact'];

const SEED = Number(process.env.GATE15_SEED || 20261103); let _x = SEED >>> 0; const rnd = () => { _x = (_x * 1664525 + 1013904223) >>> 0; return _x / 2 ** 32; };
const checks = []; let failed = 0; const t0 = Date.now();
const check = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); if (!pass) failed++; console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : ' — ' + JSON.stringify(detail).slice(0, 300)}`); };
const lat = [];
async function http(method, p, { headers = {}, body } = {}) {
  const s = performance.now(); const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); lat.push(performance.now() - s); let j; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 200) }; } return { status: r.status, body: j, text };
}
const ctl = (op, body, method = 'POST') => http(method, `/__gate15/${op}`, { headers: { 'x-gate15-control': TOKEN }, body: method === 'POST' ? (body || {}) : undefined });
let tokens = {};
const drv = (d, method, p, body) => http(method, p, { headers: { authorization: `Bearer ${tokens[d]}` }, body });
const accept = (d, offerId) => drv(d, 'POST', `/api/offers/${offerId}/accept`, {});
const nb = async (backdate = 0) => { const r = await ctl('new-booking', { backdate_s: backdate }); if (!r.body.ok) throw new Error('new-booking failed ' + JSON.stringify(r.body)); return r.body; };
const readback = async (b) => (await ctl(`readback?booking_id=${b}`, null, 'GET')).body;
const free = () => ctl('free-drivers');
const offerOf = (nbRes, d) => nbRes.offers.find((o) => o.driver_id === d);
const hasPII = (txt) => CANARY.some((c) => txt.includes(c)) || FORBIDDEN_KEYS.some((k) => txt.includes(`"${k}"`));

try {
  // ---------- identity ----------
  const id = (await ctl('identity', null, 'GET')).body;
  check('resource identity: Worker serves only after the identity marker matches driver-v2-gate15-isolated-20261103', id.ok && id.identity_row?.marker === 'driver-v2-gate15-isolated-20261103' && id.identity_row?.worker_name === 'driver-v2-gate15-isolated', id.identity_row);
  check('Worker environment exposes ONLY the isolated DB binding (+ the isolated control token)', JSON.stringify(id.env_keys.filter((k) => k !== 'GATE15_CONTROL_TOKEN')) === JSON.stringify(['DB']), id.env_keys);
  check('database holds exactly the isolated fixture tables (no foreign/production tables)', JSON.stringify(id.tables.filter((t) => !t.startsWith('sqlite_') && !t.startsWith('_cf_') && !t.startsWith('d1_'))) === JSON.stringify([...id.expected_tables].sort()), id.tables);
  await ctl('reset');                                                                  // isolated, synthetic-only data
  const unauth = await http('POST', '/__gate15/reset'); check('control surface is closed without the isolated token (404)', unauth.status === 404, unauth.status);

  // ---------- D1 primitives ----------
  const probe = (await ctl('probe')).body;
  for (const c of probe.checks) check(`D1 primitive: ${c.name}`, c.pass, c.detail);

  // ---------- seed ----------
  const seeded = (await ctl('seed', { drivers: 6 })).body; tokens = seeded.tokens; check('seeded 6 synthetic placeholder drivers (driver 1 = only real-test identity)', seeded.ok && Object.keys(tokens).length === 6, seeded.drivers);
  await ctl('delivery-mode', { mode: 'DELIVERED' });

  // ---------- duplicate + replayed accept ----------
  let b = await nb(0); let o1 = offerOf(b, 1);
  const dup = await Promise.all([1, 2, 3].map(() => accept(1, o1.offer_id)));
  check('duplicate Accept (3 concurrent HTTP requests, same offer): all 200 ASSIGNED, exactly one non-replay', dup.every((r) => r.status === 200 && r.body.code === 'ASSIGNED') && dup.filter((r) => r.body.replay === false).length === 1, dup.map((r) => [r.status, r.body.code, r.body.replay]));
  let rb = await readback(b.booking_id);
  check('duplicate Accept: one assigned driver, one ACCEPTED offer, one DRIVER_ASSIGNED, no duplicate critical events', rb.booking.assigned_driver_id === 1 && rb.accepted_offers === 1 && rb.events.DRIVER_ASSIGNED === 1 && rb.duplicate_critical_events.length === 0, rb);
  const replay = await accept(1, o1.offer_id); check('replayed Accept later: 200 ASSIGNED replay=true, nothing duplicated', replay.status === 200 && replay.body.replay === true && (await readback(b.booking_id)).events.DRIVER_ASSIGNED === 1, replay.body);
  check('guest/admin assignment intents captured exactly once, none sent', rb.capture.GUEST_DRIVER_ASSIGNED === 1 && rb.capture.ADMIN_DRIVER_ASSIGNED === 1, rb.capture);
  await free();

  // ---------- stale / loser accept ----------
  b = await nb(125); check('120 s+ without engagement: dispatch broadened to 3 open offers', b.offers.filter((o) => o.state === 'OFFERED').length === 3, b.offers);
  const winner = await accept(2, offerOf(b, 2).offer_id); const l1 = await accept(1, offerOf(b, 1).offer_id); const l3 = await accept(3, offerOf(b, 3).offer_id);
  check('stale Accept: losers get 409 ASSIGNMENT_ALREADY_TAKEN and cannot overwrite the winner', winner.body.code === 'ASSIGNED' && [l1, l3].every((r) => r.status === 409 && r.body.code === 'ASSIGNMENT_ALREADY_TAKEN'), [winner.body.code, l1.body.code, l3.body.code]);
  rb = await readback(b.booking_id); check('stale Accept readback: winner 2 assigned, other offers SUPERSEDED', rb.booking.assigned_driver_id === 2 && rb.offers.filter((o) => o.driver_id !== 2).every((o) => o.state === 'SUPERSEDED'), rb.offers);
  const loserTrip = await drv(1, 'GET', `/api/trips/${b.booking_id}`); const winnerTrip = await drv(2, 'GET', `/api/trips/${b.booking_id}`);
  check('pre-assignment PII exclusion: loser cannot read the trip (404 NOT_ASSIGNED_DRIVER), guest data only reaches the server-confirmed winner', loserTrip.status === 404 && !hasPII(loserTrip.text) && winnerTrip.status === 200 && winnerTrip.text.includes('CANARY-GUEST-NAME-Zxq'), [loserTrip.status, winnerTrip.status]);
  await free();

  // ---------- PII exclusion on every pre-assignment surface ----------
  b = await nb(125); const surfaces = [];
  for (const d of [1, 2, 3]) { surfaces.push((await drv(d, 'GET', '/api/state')).text); surfaces.push((await drv(d, 'POST', `/api/offers/${offerOf(b, d).offer_id}/view`, {})).text); }
  surfaces.push(JSON.stringify(b)); surfaces.push((await accept(9, 'ofr_nope').catch(() => ({ text: '' }))).text);
  check('pre-assignment PII exclusion: /api/state, /view and the control payload carry no guest name/phone/email/flight/notes (canaries absent)', surfaces.every((t) => !hasPII(t)), surfaces.map((t) => hasPII(t)));
  await accept(1, offerOf(b, 1).offer_id); await free();

  // ---------- expired accept + boundaries (real clock; +/-3 s margins - exact-ms boundaries are proven in the deterministic suite) ----------
  b = await nb(0); await ctl('backdate', { booking_id: b.booking_id, seconds: 185 }); const exp = await accept(1, offerOf(b, 1).offer_id);
  check('expired Accept (185 s): 410 OFFER_EXPIRED, booking stays unassigned', exp.status === 410 && exp.body.code === 'OFFER_EXPIRED' && (await readback(b.booking_id)).booking.assigned_driver_id === null, exp.body);
  const bound = [[57, 'PRIORITY', true], [63, 'CONNECTIVITY_GRACE', true], [117, 'CONNECTIVITY_GRACE', true], [123, 'ESCALATED_DISPATCH', true], [177, 'ESCALATED_DISPATCH', true], [183, 'HUMAN_FALLBACK_REQUIRED', false]];
  for (const [sec, phase, ok] of bound) {
    await free(); const x = await nb(0); await ctl('backdate', { booking_id: x.booking_id, seconds: sec });
    const st = (await drv(1, 'GET', '/api/state')).body; const shown = st.offers.find((o) => o.offer_id === offerOf(x, 1).offer_id);
    const res = await accept(1, offerOf(x, 1).offer_id);
    check(`server-time boundary @${sec}s (${phase}): phase reported ${phase}; Accept ${ok ? 'succeeds' : 'is refused 410'}`, shown?.phase_now === phase && (ok ? res.body.code === 'ASSIGNED' : res.status === 410 && res.body.code === 'OFFER_EXPIRED'), { phase: shown?.phase_now, code: res.body.code });
  }
  await free();

  // ---------- human fallback ----------
  b = await nb(0); await ctl('backdate', { booking_id: b.booking_id, seconds: 185, sweep: true }); await ctl('sweep', { booking_id: b.booking_id }); await ctl('sweep', { booking_id: b.booking_id });
  rb = await readback(b.booking_id);
  check('>=180 s: exactly one HUMAN_FALLBACK_REQUIRED event + one escalation row after repeated sweeps; booking still pending (never cancelled); one captured staff intent, none sent',
    rb.events.HUMAN_FALLBACK_REQUIRED === 1 && rb.escalations.find((e) => e.t === 'HUMAN_FALLBACK_REQUIRED')?.n === 1 && rb.booking.status === 'pending' && rb.booking.assigned_driver_id === null && rb.capture.STAFF_FALLBACK === 1 && rb.offers.every((o) => o.state !== 'OFFERED' && o.state !== 'VIEWED'), rb);

  // ---------- busy-driver rule on D1 ----------
  await free(); const X = await nb(0), Y = await nb(0);
  check('both bookings (dispatched while driver 1 is free) offer driver 1', !!offerOf(X, 1) && !!offerOf(Y, 1), [X.offers, Y.offers]);
  const ax = await accept(1, offerOf(X, 1).offer_id); const ay = await accept(1, offerOf(Y, 1).offer_id);
  check('active driver cannot win a second offer through stale state: 409 DRIVER_HAS_ACTIVE_TRIP, booking Y stays unassigned', ax.body.code === 'ASSIGNED' && ay.status === 409 && ay.body.code === 'DRIVER_HAS_ACTIVE_TRIP' && (await readback(Y.booking_id)).booking.assigned_driver_id === null, [ax.body.code, ay.body.code]);
  const Z = await nb(0); check('new immediate booking skips the busy driver and offers a free eligible one', !offerOf(Z, 1) && Z.offers.length >= 1, Z.offers);
  await free(); const Z2 = await nb(0); check('after COMPLETED the previously busy driver is eligible again', !!offerOf(Z2, 1), Z2.offers); await accept(1, offerOf(Z2, 1).offer_id); await free();

  // ---------- first-wins against changes made OUTSIDE the offer flow (staff assignment / cancellation while an offer is open) ----------
  await free(); b = await nb(0); await ctl('staff-set', { booking_id: b.booking_id, assigned_driver_id: 3 });
  const stale1 = await accept(1, offerOf(b, 1).offer_id); rb = await readback(b.booking_id);
  check('staff assignment while an offer is open: the stale Accept gets 409 ASSIGNMENT_ALREADY_TAKEN and cannot overwrite the staff assignment (no assignment audit written)', stale1.status === 409 && stale1.body.code === 'ASSIGNMENT_ALREADY_TAKEN' && rb.booking.assigned_driver_id === 3 && !rb.events.DRIVER_ASSIGNED, { c: stale1.body.code, rb: rb.booking });
  const c2 = await nb(0); await ctl('staff-set', { booking_id: c2.booking_id, status: 'cancelled' }); const stale2 = await accept(1, offerOf(c2, 1).offer_id); rb = await readback(c2.booking_id);
  check('staff cancellation while an offer is open: Accept gets 409 SUPERSEDED, booking stays cancelled and unassigned', stale2.status === 409 && stale2.body.code === 'SUPERSEDED' && rb.booking.status === 'cancelled' && rb.booking.assigned_driver_id === null, { c: stale2.body.code, rb: rb.booking });
  await ctl('staff-set', { booking_id: b.booking_id, status: 'cancelled' });                             // park the staff-assigned synthetic booking so it does not count as an active trip

  // ---------- critical state + audit atomicity ----------
  b = await nb(0); await ctl('fault', { arm: true, event_type: 'DRIVER_ASSIGNED' }); const bad = await accept(1, offerOf(b, 1).offer_id); rb = await readback(b.booking_id);
  check('audit atomicity (assignment): injected audit failure -> 503 AUDIT_PERSIST_FAILED and NOTHING persisted (booking unassigned, offer still open, zero decision/assignment events)',
    bad.status === 503 && bad.body.code === 'AUDIT_PERSIST_FAILED' && rb.booking.assigned_driver_id === null && rb.booking.status === 'pending' && rb.offers.find((o) => o.driver_id === 1).state === 'OFFERED' && !rb.events.DRIVER_ASSIGNED && !rb.events.DRIVER_DECISION && !rb.events.ASSIGNMENT_PERSISTED, { bad: bad.body.code, rb });
  await ctl('fault', { arm: false }); const good = await accept(1, offerOf(b, 1).offer_id); rb = await readback(b.booking_id);
  check('audit atomicity (assignment): after the fault clears, the retry succeeds exactly once', good.body.code === 'ASSIGNED' && rb.events.DRIVER_ASSIGNED === 1 && rb.accepted_offers === 1, good.body);
  await ctl('fault', { arm: true, event_type: 'EN_ROUTE_PICKUP' }); const badStage = await drv(1, 'POST', `/api/trips/${b.booking_id}/stage`, { stage: 'EN_ROUTE_PICKUP' }); rb = await readback(b.booking_id);
  check('audit atomicity (lifecycle): injected audit failure -> 503 and the coarse status did NOT advance', badStage.status === 503 && rb.booking.status === 'accepted' && !rb.events.EN_ROUTE_PICKUP, { s: badStage.status, rb: rb.booking });
  await ctl('fault', { arm: false }); const goodStage = await drv(1, 'POST', `/api/trips/${b.booking_id}/stage`, { stage: 'EN_ROUTE_PICKUP' }); check('audit atomicity (lifecycle): retry after the fault clears advances once', goodStage.body.ok === true && (await readback(b.booking_id)).booking.status === 'en_route', goodStage.body);
  await free();

  // ---------- decline path (json_extract guard) ----------
  b = await nb(125); const d1 = await drv(1, 'POST', `/api/offers/${offerOf(b, 1).offer_id}/decline`, {}); const d2 = await drv(1, 'POST', `/api/offers/${offerOf(b, 1).offer_id}/decline`, {});
  rb = await readback(b.booking_id);
  check('decline is durable and replay-safe (uses json_extract guard): 200 DRIVER_DECLINED, replay=true, exactly one DRIVER_DECISION event, booking intact', d1.body.code === 'DRIVER_DECLINED' && d2.body.replay === true && rb.events.DRIVER_DECISION === 1 && rb.booking.status === 'pending', { d1: d1.body, d2: d2.body, rb: rb.events });
  await accept(2, offerOf(b, 2).offer_id); await free();

  // ---------- REAL concurrent HTTP races ----------
  console.log(`\n== ${RACES} contested races over real concurrent HTTP ==`);
  const race = { seed: SEED, requested: RACES, completed: 0, contested: 0, http_requests: 0, status_histogram: {}, code_histogram: {}, winners_by_driver: {}, violations: [], max_in_flight: 0 };
  for (let i = 0; i < RACES; i++) {
    await free(); const r = await nb(125); const open = r.offers.filter((o) => o.state === 'OFFERED'); if (open.length >= 2) race.contested++;
    const taps = []; for (const o of open) { taps.push(o, o); }                                   // each driver double-taps
    for (let k = taps.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [taps[k], taps[j]] = [taps[j], taps[k]]; }   // seeded random ARRIVAL order, so winners are not decided by who is issued first
    const calls = taps.map((o) => accept(o.driver_id, o.offer_id).then((x) => ({ d: o.driver_id, x })));
    race.max_in_flight = Math.max(race.max_in_flight, calls.length);
    const rs = await Promise.all(calls); race.http_requests += rs.length;
    for (const { x } of rs) { race.status_histogram[x.status] = (race.status_histogram[x.status] || 0) + 1; race.code_histogram[x.body.code] = (race.code_histogram[x.body.code] || 0) + 1; }
    const fresh = rs.filter(({ x }) => x.body.code === 'ASSIGNED' && x.body.replay === false); const back = await readback(r.booking_id); const v = [];
    if (fresh.length !== 1) v.push(`fresh winners=${fresh.length}`);
    const w = fresh[0]?.d; if (back.booking.assigned_driver_id !== w) v.push(`assigned ${back.booking.assigned_driver_id} != winner ${w}`);
    if (back.accepted_offers !== 1) v.push(`accepted_offers=${back.accepted_offers}`);
    if (back.offers.filter((o) => o.driver_id !== w).some((o) => o.state !== 'SUPERSEDED')) v.push('loser offer not SUPERSEDED');
    if (back.events.DRIVER_ASSIGNED !== 1 || back.duplicate_critical_events.length) v.push(`assignment events=${back.events.DRIVER_ASSIGNED} dup=${JSON.stringify(back.duplicate_critical_events)}`);
    for (const { d, x } of rs) if (d !== w && !(x.status === 409 && x.body.code === 'ASSIGNMENT_ALREADY_TAKEN')) v.push(`loser ${d} got ${x.status}/${x.body.code}`);
    for (const { d, x } of rs) if (d === w && !(x.status === 200 && x.body.code === 'ASSIGNED')) v.push(`winner tap got ${x.status}/${x.body.code}`);
    if (v.length) race.violations.push({ race: i, booking: r.booking_id, v }); else race.winners_by_driver[w] = (race.winners_by_driver[w] || 0) + 1;
    race.completed++;
  }
  check(`real concurrent HTTP races: ${RACES} contested races, exactly one server-confirmed winner each, losers 409, one assignment event, one ACCEPTED offer, others SUPERSEDED`, race.completed === RACES && race.violations.length === 0 && race.contested === RACES, race);
  check('races were genuinely contested across drivers (>=2 distinct winners)', Object.keys(race.winners_by_driver).length >= 2, race.winners_by_driver);
  await free();

  // ---------- zero-side-effect / invariants ----------
  const sum = (await ctl('summary', null, 'GET')).body;
  check('global invariants hold over the whole isolated database (no double accept, no orphan assignment, audit trail complete, one active trip per driver)', sum.ok && sum.violations.length === 0, sum.violations);
  check('zero real sends: every captured intent is suppressed (schema CHECK forbids otherwise); no WhatsApp/email/guest/admin send', sum.real_sends === 0 && Object.keys(sum.capture_by_kind).every((k) => ['DRIVER_OFFER', 'GUEST_DRIVER_ASSIGNED', 'ADMIN_DRIVER_ASSIGNED', 'STAFF_FALLBACK'].includes(k)), sum.capture_by_kind);
  check('zero wallet/commission effects', sum.wallet_changed === false && sum.wallet_transactions === 0, sum);
  check('zero real phone numbers (all driver phones are +000-GATE1 placeholders) and zero non-synthetic bookings', sum.non_placeholder_phones === 0 && sum.non_synthetic_bookings === 0, sum);
  var summary = sum;
} catch (e) { check('proof run completed without an unexpected exception', false, String(e.stack || e).slice(0, 500)); }

lat.sort((a, b) => a - b); const pct = (p) => Math.round(lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] || 0);
let commit = process.env.GATE15_COMMIT || ''; try { commit ||= execSync('git rev-parse HEAD', { cwd: here }).toString().trim(); } catch { /* not a git checkout */ }
const result = { target: TARGET, host: new URL(BASE).hostname, commit_sha: commit, schema_sha256: fs.readFileSync(path.join(here, '..', 'schema', 'gate15_d1_schema.sha256'), 'utf8').split(/\s+/)[0],
  started_at: new Date(t0).toISOString(), duration_s: Math.round((Date.now() - t0) / 1000), checks_total: checks.length, checks_failed: failed, http_requests_total: lat.length, latency_ms: { p50: pct(0.5), p95: pct(0.95), max: pct(1) }, summary: typeof summary === 'undefined' ? null : summary, checks };
fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
console.log(`\n${checks.length - failed}/${checks.length} checks passed -> ${OUT}`); process.exit(failed ? 1 : 0);
