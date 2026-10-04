/* Marau (PREVIEW/TEST ONLY) - RC4: the uncertain-return verification workflow is a PILOT requirement, not a reward feature.
 * Red-first against RC3 (code a7b8d3c). Synthetic data; default-deny network. Evidence label: LOCAL, AUTHOR-RUN.
 * EVERY test runs with rewards OFF (no policy is ever set; no credit exists).
 *
 * Pinned: (1) an uncertain return shows in the staff Needs-attention list with the facts staff must check, independent of credits;
 * (2) a staff verdict records actor + timestamp + evidence and is tied to the CURRENT itinerary (the staff member confirms the basis they
 * were shown; a changed itinerary is refused); (3) the source is neither called nor changed, provenance is untouched, and nothing implies
 * a driver or a payment; (4) any change to a relevant source fact invalidates the verification and re-opens the attention item;
 * (5) the guest sees a plain, non-implying note, never who verified or the evidence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv } from './fixtures.mjs';
import worker, { createGuestSession, createSessionAndOfferLink, nowIso } from '../worker/worker.js';
import { normalizePickupDatetime } from '../worker/fiji_time.js';
import { syncRealBookingEvent } from '../worker/real_booking_sync.js';
import { GUEST_APP_HTML } from '../worker/pages.js';
import { formatFijiCurrency, humanizeZoneLabel } from '../worker/guest_display.js';
import { formatFijiDateTime } from '../worker/fiji_time.js';

installNetworkGuard();

const call = async (env, p, { method = 'GET', body, headers = {} } = {}) => {
  const res = await worker.fetch(new Request('http://marau.test' + p, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, text, headers: res.headers };
};
const admin = (env) => ({ authorization: `Bearer ${env.MARAU_ADMIN_TEST_TOKEN}` });
const staffH = (env, t = 'staff-tok-bala') => ({ ...admin(env), 'x-marau-staff-token': t });
const guestH = (t) => ({ authorization: `Bearer ${t}` });
const inDays = (d) => new Date(Date.now() + d * 86400_000).toISOString();
const dayStr = (d) => inDays(d).slice(0, 10);
const all = async (env, sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results.map((r) => ({ ...r }));
const one = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).first();

let n = 0;
const src = (over = {}) => { n += 1; return { id: 9100 + n, client_booking_ref: `FD-UR${n}`, status: 'accepted', assigned_driver_id: 3, guest_phone: `+150055506${String(n).padStart(2, '0')}`, guest_email: `ur${n}@example.test`,
  pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan', quoted_currency: 'FJD', quoted_amount: 170, settlement_amount_fjd: 150, commission_base_fjd: 20,
  pickup_date: dayStr(3), pickup_time: '09:00', return_date: dayStr(10), return_time: '10:30', return_pickup_location: 'Sofitel Denarau lobby', flight_number: null, created_at: '2026-10-01T00:00:00Z', ...over }; };
function sourceOf(row) { let cur = { ...row }; const s = { reads: 0, set: (r) => { cur = { ...r }; }, reader: async (ref) => { s.reads += 1; return { ...cur, source_booking_ref: String(ref) }; } }; return s; }
let ev = 700000;
const sync = (env, r, source, type = 'accepted', status = 'accepted') => syncRealBookingEvent(env, String(r.id), { event_type: type, new_status: status, source_event_id: ++ev, booking_id: r.id }, { createGuestSession, createSessionAndOfferLink, nowIso, normalizePickupDatetime, reader: source.reader });
const legs = (env, r) => all(env, 'SELECT * FROM marau_test_bookings WHERE source_booking_ref = ? ORDER BY id', String(r.id));
const ret = async (env, r) => (await legs(env, r)).find((x) => x.leg_key === 'return');

async function uncertain(over = {}) {
  const env = makeEnv();
  for (const [t, nm] of [['staff-tok-ana', 'Ana (ops)'], ['staff-tok-bala', 'Bala (ops)']]) await call(env, '/preview/admin/staff-identities', { method: 'POST', headers: admin(env), body: { token: t, operator_name: nm } });
  const r = src(over); const source = sourceOf(r);
  assert.equal((await sync(env, r, source, 'created', 'accepted')).ok, true);
  source.set({ ...r, status: 'completed' }); await sync(env, r, source, 'completed', 'completed');
  const rows = await legs(env, r);
  const session = await one(env, 'SELECT * FROM guest_sessions WHERE session_id = ?', rows[0].guest_session_id);
  return { env, r, source, session };
}
const queue = async (env) => (await call(env, '/preview/admin/guests?attention=1', { headers: staffH(env) })).data.guests;
const verify = (env, id, body, t) => call(env, `/preview/admin/bookings/${id}/verify-status`, { method: 'POST', headers: staffH(env, t), body });
const EVID = 'Phoned the hotel desk at 09:12: the guest still departs on the return date';

test('NEEDS ATTENTION, rewards OFF: an uncertain return is listed for staff with the facts to check - no reward credit involved', async () => {
  const c = await uncertain();
  assert.equal((await all(c.env, 'SELECT * FROM marau_reward_credits')).length, 0, 'no credit exists');
  const q = await queue(c.env);
  const g = q.find((x) => x.session_id === c.session.session_id);
  assert.ok(g, 'the guest is in the attention queue');
  assert.ok(g.attention.includes('return_status_needs_verification'));
  assert.equal(g.uncertain_returns.length, 1);
  const u = g.uncertain_returns[0]; const leg = await ret(c.env, c.r);
  assert.deepEqual([u.booking_id, u.pickup_zone, u.destination_zone, u.source_status, u.return_pickup_datetime], [leg.id, 'Sofitel Denarau lobby', 'Nadi Airport', 'completed', leg.pickup_datetime]);
  assert.equal(typeof u.itinerary_basis, 'string'); assert.ok(u.itinerary_basis.length > 10);
  assert.equal(JSON.stringify(g).includes('settlement'), false);
});

test('a normal (non-ambiguous) booking is NOT flagged', async () => {
  const env = makeEnv(); const r = src(); const source = sourceOf(r);
  await call(env, '/preview/admin/staff-identities', { method: 'POST', headers: admin(env), body: { token: 'staff-tok-bala', operator_name: 'Bala (ops)' } });
  await sync(env, r, source, 'created', 'accepted');
  assert.equal((await queue(env)).length, 0);
});

test('VERIFICATION is tied to the CURRENT itinerary: the basis shown must be supplied; a missing or out-of-date basis is refused and nothing changes', async () => {
  const c = await uncertain(); const leg = await ret(c.env, c.r);
  const u = (await queue(c.env))[0].uncertain_returns[0];
  const missing = await verify(c.env, leg.id, { verdict: 'return_upcoming', evidence: EVID });
  assert.equal(missing.status, 400); assert.match(missing.data.details.join(' '), /itinerary/i);
  const wrong = await verify(c.env, leg.id, { verdict: 'return_upcoming', evidence: EVID, itinerary_basis: u.itinerary_basis + 'x' });
  assert.equal(wrong.status, 409); assert.equal(wrong.data.error, 'ITINERARY_CHANGED'); assert.ok(wrong.data.current);
  assert.equal((await ret(c.env, c.r)).status, 'pending'); assert.equal((await all(c.env, 'SELECT * FROM marau_leg_status_verifications')).length, 0);
  const ok = await verify(c.env, leg.id, { verdict: 'return_upcoming', evidence: EVID, itinerary_basis: u.itinerary_basis });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.source_unchanged, true); assert.equal(ok.data.leg.verified_by, 'Bala (ops)'); assert.ok(ok.data.leg.verified_at);
  const rec = (await all(c.env, 'SELECT * FROM marau_leg_status_verifications'))[0];
  assert.deepEqual([rec.actor, rec.basis, rec.evidence], ['Bala (ops)', u.itinerary_basis, EVID]);
  assert.equal((await verify(c.env, leg.id, { verdict: 'return_upcoming', evidence: EVID, itinerary_basis: u.itinerary_basis })).status, 409, 'nothing left to verify');
  assert.equal((await queue(c.env)).length, 0, 'the item leaves the queue');
  assert.equal((await verify(c.env, leg.id, { verdict: 'return_upcoming', evidence: EVID, itinerary_basis: 'x' }, 'no-such-token')).status, 401, 'authorised staff only');
});

test('LOCAL VERIFICATION never touches the source or provenance and implies no driver, payment or value: the source is not called; source/provenance/money columns are identical before and after', async () => {
  const c = await uncertain(); const leg = await ret(c.env, c.r);
  const cols = ['source_status', 'source_kind', 'source_origin', 'source_authenticated', 'test_data', 'source_total_cents', 'source_currency', 'source_settlement_fjd_cents', 'source_commission_base_fjd_cents', 'source_assigned_driver_id', 'quoted_amount', 'pickup_datetime', 'pickup_zone', 'destination_zone', 'leg_value_status', 'leg_value_cents', 'pickup_basis'];
  const before = Object.fromEntries(cols.map((k) => [k, leg[k]])); const arrBefore = (await legs(c.env, c.r)).find((x) => x.leg_key === 'arrival');
  const u = (await queue(c.env))[0].uncertain_returns[0]; const reads = c.source.reads;
  assert.equal((await verify(c.env, leg.id, { verdict: 'return_upcoming', evidence: EVID, itinerary_basis: u.itinerary_basis })).status, 200);
  const after = await ret(c.env, c.r);
  assert.deepEqual(Object.fromEntries(cols.map((k) => [k, after[k]])), before);
  const arrAfter = (await legs(c.env, c.r)).find((x) => x.leg_key === 'arrival');
  assert.deepEqual(arrAfter, arrBefore, 'the arrival row is untouched');
  assert.equal(c.source.reads, reads, 'the source was not called');
  for (const t of ['marau_reward_credits', 'marau_booking_adjustments', 'marau_offer_requests']) assert.equal((await all(c.env, `SELECT * FROM ${t}`)).length, 0, t);
  assert.equal(after.leg_value_status, 'unresolved');
});

test('INVALIDATION: any change to a relevant source fact (return time, return pickup location) re-opens the item and clears the verification; the old basis can no longer be used', async () => {
  for (const change of [{ return_time: '16:00' }, { return_pickup_location: 'Hilton Denarau lobby' }]) {
    const c = await uncertain(); const leg = await ret(c.env, c.r);
    const u1 = (await queue(c.env))[0].uncertain_returns[0];
    assert.equal((await verify(c.env, leg.id, { verdict: 'return_upcoming', evidence: EVID, itinerary_basis: u1.itinerary_basis })).status, 200);
    assert.equal((await ret(c.env, c.r)).status, 'confirmed');
    c.source.set({ ...c.r, status: 'completed', ...change }); await sync(c.env, c.r, c.source, 'completed', 'completed');
    const after = await ret(c.env, c.r);
    assert.equal(after.status, 'pending'); assert.equal(after.status_uncertainty, 'source_completed_while_return_upcoming');
    assert.equal(after.status_verified_by, null); assert.equal(after.status_verified_at, null); assert.equal(after.status_verification_evidence, null);
    const u2 = (await queue(c.env))[0].uncertain_returns[0];
    assert.notEqual(u2.itinerary_basis, u1.itinerary_basis, JSON.stringify(change));
    const stale = await verify(c.env, leg.id, { verdict: 'return_upcoming', evidence: EVID, itinerary_basis: u1.itinerary_basis });
    assert.equal(stale.status, 409); assert.equal(stale.data.error, 'ITINERARY_CHANGED');
    assert.equal((await verify(c.env, leg.id, { verdict: 'return_upcoming', evidence: EVID, itinerary_basis: u2.itinerary_basis })).status, 200, 're-verification against the new basis works');
  }
});

test('a verified itinerary that stays unchanged stays verified across repeated syncs; "not going ahead" cancels the Marau leg only', async () => {
  const c = await uncertain(); const leg = await ret(c.env, c.r);
  const u = (await queue(c.env))[0].uncertain_returns[0];
  await verify(c.env, leg.id, { verdict: 'return_upcoming', evidence: EVID, itinerary_basis: u.itinerary_basis });
  for (let i = 0; i < 3; i += 1) await sync(c.env, c.r, c.source, 'completed', 'completed');
  const still = await ret(c.env, c.r); assert.equal(still.status, 'confirmed'); assert.equal(still.status_uncertainty, null); assert.equal(still.status_verified_by, 'Bala (ops)');
  const d = await uncertain(); const dl = await ret(d.env, d.r); const du = (await queue(d.env))[0].uncertain_returns[0];
  const x = await verify(d.env, dl.id, { verdict: 'return_not_going_ahead', evidence: EVID, itinerary_basis: du.itinerary_basis });
  assert.equal(x.status, 200); assert.equal((await ret(d.env, d.r)).status, 'cancelled'); assert.equal(d.source.reads <= 3, true);
  assert.equal((await legs(d.env, d.r)).find((y) => y.leg_key === 'arrival').source_status, 'completed');
});

test('GUEST VIEW: after a verification the return carries a plain staff-checked note (no driver, payment or verifier named); before it, none', async () => {
  const c = await uncertain(); const leg = await ret(c.env, c.r);
  const t0 = (await call(c.env, '/preview/trip', { headers: guestH(c.session.access_token) })).data;
  assert.equal(t0.bookings.find((b) => b.leg_key === 'return').staff_checked_status, false);
  const u = (await queue(c.env))[0].uncertain_returns[0];
  await verify(c.env, leg.id, { verdict: 'return_upcoming', evidence: EVID, itinerary_basis: u.itinerary_basis });
  const t1 = (await call(c.env, '/preview/trip', { headers: guestH(c.session.access_token) })).data;
  assert.equal(t1.bookings.find((b) => b.leg_key === 'return').staff_checked_status, true);
  for (const secret of ['status_verified_by', 'status_verification_evidence', 'Bala', EVID, 'itinerary_basis']) assert.equal(JSON.stringify(t1).includes(secret), false, secret);
});

function loadClient() {
  const start = GUEST_APP_HTML.indexOf('function createOffersClient(deps)');
  const shim = GUEST_APP_HTML.slice(GUEST_APP_HTML.indexOf('var __name = function'), GUEST_APP_HTML.indexOf('};', GUEST_APP_HTML.indexOf('var __name = function')) + 2);
  const create = new Function(`${shim}\n${GUEST_APP_HTML.slice(start, GUEST_APP_HTML.indexOf('\n}\n', start) + 3)}\nreturn createOffersClient;`)();
  return create({ authFetch: async () => ({ ok: true, data: {} }), toast() {}, renderMockWhatsApp() {}, formatFijiCurrency, formatFijiDateTime, humanizeZoneLabel: (z) => z, els: {}, storage: { getItem: () => null, setItem() {} } });
}
test('GUEST CARD: the note says the team checked the return is going ahead and that this does not assign a driver or take payment; absent otherwise', () => {
  const c = loadClient();
  const base = { id: 2, leg_type: 'return', pickup_zone: 'Sofitel Denarau lobby', destination_zone: 'Nadi Airport', pickup_datetime: '2031-10-12T22:30:00.000Z', status: 'confirmed' };
  const withNote = c.legCardHtml({ ...base, staff_checked_status: true });
  assert.match(withNote, /Our team checked/i); assert.match(withNote, /does not assign a driver/i); assert.match(withNote, /payment/i);
  assert.equal(/Our team checked/i.test(c.legCardHtml({ ...base, staff_checked_status: false })), false);
  assert.equal(/Our team checked/i.test(c.legCardHtml({ ...base, status: 'pending', status_uncertainty: 'source_completed_while_return_upcoming', staff_checked_status: true })), false, 'never shown while uncertain');
});

test('STAFF CONSOLE: the Needs-attention list renders the uncertain return with its facts and verify / not-going-ahead buttons carrying the itinerary basis', async () => {
  const env = makeEnv(); const page = await call(env, '/staff');
  const start = page.text.indexOf('function createStaffConsole(deps)');
  const create = new Function(`${page.text.slice(start, page.text.indexOf('\n}\n', start) + 3)}\nreturn createStaffConsole;`)();
  const c = create({ document: { getElementById: () => ({ style: {}, classList: { add() {}, remove() {} } }), querySelectorAll: () => [] }, storage: { getItem: () => null, setItem() {}, removeItem() {} }, fetchImpl: async () => ({ json: async () => ({}) }), prompt: () => null });
  const html = c.guestsHtml([{ session_id: 'gs_x', contact: { phone: '+1', email: 'a@x.test' }, follow_up: { channel: 'whatsapp', reason: 'r', owner: null }, marketing_consent: null, attention: ['return_status_needs_verification'],
    uncertain_returns: [{ booking_id: 7, reference: 'RET-1', return_pickup_datetime: '2031-10-12T22:30:00.000Z', pickup_zone: 'Sofitel Denarau lobby', destination_zone: 'Nadi Airport', source_status: 'completed', itinerary_basis: 'BASIS-1' }] }]);
  assert.match(html, /return status needs verification/i);
  assert.match(html, /Sofitel Denarau lobby/); assert.match(html, /Nadi Airport/); assert.match(html, /completed/);
  assert.match(html, /data-verify-status="7"[^>]*data-basis="BASIS-1"[^>]*data-verdict="return_upcoming"|data-verdict="return_upcoming"[^>]*data-verify-status="7"/);
  assert.match(html, /data-verdict="return_not_going_ahead"/);
  assert.match(html, /source booking is not changed/i);
  const credits = c.creditsHtml([{ credit_id: 'cr_1', status: 'earned', amount_fjd: 10, funding_source: 'x', needs_manual_adjustment: false, holder: { phone: '+1' }, eligible_return_transfers: [{ booking_id: 7, reference: 'RET-1', original_fare_fjd: 68, needs_status_verification: true, itinerary_basis: 'BASIS-1' }] }]);
  assert.match(credits, /data-basis="BASIS-1"/, 'the credit-panel button carries the basis too');
});
