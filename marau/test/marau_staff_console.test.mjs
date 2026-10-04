/* Marau (PREVIEW/TEST ONLY) - the staff console page and its listing endpoints. The renderers are executed from the text
 * actually SERVED at /staff. Evidence label: LOCAL, AUTHOR-RUN. Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv } from './fixtures.mjs';
import worker from '../worker/worker.js';

installNetworkGuard();

const call = async (env, path, { method = 'GET', body, headers = {} } = {}) => {
  const res = await worker.fetch(new Request('http://marau.test' + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, text, headers: res.headers };
};
const admin = (env) => ({ authorization: `Bearer ${env.MARAU_ADMIN_TEST_TOKEN}` });
const staffH = (env, t = 'staff-tok-ana') => ({ ...admin(env), 'x-marau-staff-token': t });

async function servedConsole() {
  const env = makeEnv();
  const page = await call(env, '/staff');
  const start = page.text.indexOf('function createStaffConsole(deps)');
  assert.ok(start !== -1, 'createStaffConsole is in the served page');
  const end = page.text.indexOf('\n}\n', start) + 3;
  const create = new Function(`${page.text.slice(start, end)}\nreturn createStaffConsole;`)();
  const store = new Map();
  const stubDoc = { getElementById: () => ({ style: {}, classList: { add() {}, remove() {} } }), querySelectorAll: () => [] };
  return { page, console: create({ document: stubDoc, storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }, fetchImpl: async () => ({ json: async () => ({}) }), prompt: () => null }) };
}

test('/staff serves the console: noindex, no tokens or data in the page, no backticks, both token fields, every region the script writes to', async () => {
  const { page } = await servedConsole();
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /html/);
  assert.match(page.text, /name="robots" content="noindex"/);
  assert.equal(page.text.includes('`'), false);
  const env = makeEnv();
  assert.equal(page.text.includes(env.MARAU_ADMIN_TEST_TOKEN), false, 'the admin token is never embedded in the page');
  for (const id of ['adminTok', 'staffTok', 'loginBtn', 'logoutBtn', 'rGuests', 'rRequests', 'rCredits', 'rPolicy', 'rReport', 'rSuppliers', 'rOffers', 'rEditions', 'supplierForm', 'offerForm', 'editionForm', 'policyForm', 'oSupplier']) assert.match(page.text, new RegExp(`id="${id}"`), id);
  assert.equal(/id="(adminTok|staffTok)"[^>]*type="password"/.test(page.text), true, 'token inputs are password fields');
  assert.match(page.text, /Live mode cannot be switched on from here/);
  assert.equal(/<option value="live"/.test(page.text), false, 'the policy form offers no live mode');
});

test('the console sends BOTH credentials on every call and reports real failures (never a silent success)', async () => {
  const calls = [];
  const env = makeEnv();
  const page = await call(env, '/staff');
  const start = page.text.indexOf('function createStaffConsole(deps)');
  const create = new Function(`${page.text.slice(start, page.text.indexOf('\n}\n', start) + 3)}\nreturn createStaffConsole;`)();
  const store = new Map();
  const toastNode = { textContent: '', classList: { add() {}, remove() {} }, style: {} };
  const doc = { getElementById: (id) => (id === 'toast' ? toastNode : { style: {}, classList: { add() {}, remove() {} }, set innerHTML(v) {}, get innerHTML() { return ''; } }), querySelectorAll: () => [] };
  const c = create({ document: doc, storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }, prompt: () => null,
    fetchImpl: async (path, init) => { calls.push({ path, init }); return { status: 409, json: async () => ({ error: 'HOLD_EXPIRED', detail: 'the hold lapsed' }) }; } });
  await c.signIn('ADMIN-T', 'STAFF-T');
  assert.ok(calls.length >= 8, 'sign-in loads every region');
  for (const { init } of calls) {
    assert.equal(init.headers.authorization, 'Bearer ADMIN-T');
    assert.equal(init.headers['x-marau-staff-token'], 'STAFF-T');
  }
  assert.equal(calls.some(({ path }) => path.includes('ADMIN-T') || path.includes('STAFF-T')), false, 'tokens are never put in a URL');
  const failed = await c.call('POST', '/preview/admin/offers/requests/req_1/confirm', {});
  assert.equal(c.failMessage(failed), 'the hold lapsed');
});

test('renderers escape everything, label money honestly, and show the human-decision controls only in the right states', async () => {
  const { console: c } = await servedConsole();
  const evil = '<img src=x onerror=1>';
  const guests = c.guestsHtml([{ session_id: 'gs_1', contact: { phone: evil, email: 'a@b.test' }, follow_up: { channel: 'email', reason: 'guest has no WhatsApp', owner: null }, marketing_consent: 'unknown', attention: ['no_whatsapp_and_no_named_owner'] }]);
  assert.equal(guests.includes('<img src=x'), false);
  assert.match(guests, /no whatsapp and no named owner/);
  assert.match(guests, /data-assign-owner="gs_1"/);
  assert.match(c.guestsHtml([]), /Nobody needs attention/);

  const req = (status, extra = {}) => ({ request_id: 'req_1', reference: 'OFR-AAAAAA', title: 'T', status, places: 2, total_fjd: 240, contact: { phone: '+1', email: 'e@x.test' }, follow_up: { channel: 'whatsapp' }, ...extra });
  assert.match(c.requestsHtml([req('requested')]), /data-act="confirm"[\s\S]*data-act="decline"/);
  assert.equal(c.requestsHtml([req('requested')]).includes('data-act="fulfil"'), false);
  assert.match(c.requestsHtml([req('confirmed')]), /data-act="fulfil"[\s\S]*data-act="cancel"/);
  assert.match(c.requestsHtml([req('fulfilled')]), />Reverse</);
  assert.equal(/data-act=/.test(c.requestsHtml([req('declined')])), false, 'a decided request has no decision buttons');
  assert.match(c.requestsHtml([req('confirmed', { needs_human_follow_up: true })]), /offer withdrawn - contact guest/);

  const offers = c.offersHtml([{ offer_id: 'off_1', title: 'Draft one', status: 'draft', supplier: 'S', supplier_verification: 'verified', fulfilment_owner: 'Ana (ops)', places_left: 3, capacity: 4, price_per_place_fjd: 120, cost_per_place_fjd: 80, open_requests: 1, confirmed_requests: 0 }]);
  assert.match(offers, /data-publish="off_1"/);
  assert.match(offers, /data-withdraw="off_1"/);
  assert.equal(c.offersHtml([{ offer_id: 'o', title: 't', status: 'withdrawn', supplier: 's', supplier_verification: 'v', fulfilment_owner: 'x', places_left: 0, capacity: 1, price_per_place_fjd: 1, cost_per_place_fjd: 0, open_requests: 0, confirmed_requests: 0 }]).includes('data-withdraw'), false);

  const credits = c.creditsHtml([
    { credit_id: 'cr_1', status: 'earned', amount_fjd: 10, funding_source: 'marau_marketing_budget', needs_manual_adjustment: false, holder: { phone: '+1' }, eligible_return_transfers: [{ booking_id: 7, reference: 'RET-1', original_fare_fjd: 100 }] },
    { credit_id: 'cr_2', status: 'earned', amount_fjd: 10, funding_source: 'x', needs_manual_adjustment: false, holder: { phone: '+2' }, eligible_return_transfers: [] },
    { credit_id: 'cr_3', status: 'reversed', amount_fjd: 10, funding_source: 'x', needs_manual_adjustment: true, holder: { phone: '+3' }, eligible_return_transfers: [] },
  ]);
  assert.match(credits, /data-apply-credit="cr_1"/);
  assert.match(credits, /No eligible upcoming return transfer yet/);
  assert.match(credits, /needs your decision/);
  assert.equal(credits.includes('data-apply-credit="cr_3"'), false);

  const report = c.reportHtml({ requests_total: 4, requests_open_awaiting_human: 1, requests_confirmed: 1, requests_fulfilled: 1, quoted_value_open_fjd: 120, confirmed_sales_value_fjd: 240, fulfilled_sales_value_fjd: 120, expected_contribution_fjd_before_rewards: 80, realised_contribution_fjd_before_rewards: 40, referral_shares_tapped: 2, referral_friends_attributed: 2, reward_credits: { pending: 0, earned: 1, applied: 0, reversed: 0 }, reward_funding_committed_fjd: 10, reward_funding_applied_fjd: 0 });
  assert.match(report, /Quoted value of open requests \(NOT revenue\)/);
  assert.match(report, /Shares, requests and quoted value are NOT sales/);
  assert.equal(/revenue/i.test(report.replace('NOT revenue', '')), false, 'nothing else is called revenue');
  assert.match(c.policyHtml({ mode: 'off', amount_fjd: null, cap_per_referrer_fjd: null, min_purchase_fjd: 0, qualify_on: 'fulfilled', funding_source: 'f' }), /Mode <b>off<\/b>/);
});

test('staff listing endpoints: suppliers and editions need the staff identity and expose no guest data', async () => {
  const env = makeEnv();
  await call(env, '/preview/admin/staff-identities', { method: 'POST', headers: admin(env), body: { token: 'staff-tok-ana', operator_name: 'Ana (ops)' } });
  const sup = await call(env, '/preview/admin/suppliers', { method: 'POST', headers: staffH(env), body: { name: 'Synthetic Tours', fulfilment_owner: 'Ana (ops)' } });
  await call(env, `/preview/admin/suppliers/${sup.data.supplier_id}/verify`, { method: 'POST', headers: staffH(env) });
  const listed = await call(env, '/preview/admin/suppliers', { headers: staffH(env) });
  assert.deepEqual(listed.data.suppliers.map((s) => [s.name, s.verification_status]), [['Synthetic Tours', 'verified']]);
  assert.equal((await call(env, '/preview/admin/suppliers', { headers: admin(env) })).status, 401);
  assert.equal((await call(env, '/preview/admin/editions', { headers: admin(env) })).status, 401);
  assert.deepEqual((await call(env, '/preview/admin/editions', { headers: staffH(env) })).data.editions, []);

  const inDays = (d) => new Date(Date.now() + d * 86400_000).toISOString();
  const offer = await call(env, '/preview/admin/offers', { method: 'POST', headers: staffH(env), body: { supplier_id: sup.data.supplier_id, title: 'Edition offer', location: 'Denarau', inclusions: 'x', starts_at: inDays(5), book_by: inDays(4), expires_at: inDays(4.5), capacity: 3, price_per_place_fjd: 50 } });
  await call(env, `/preview/admin/offers/${offer.data.offer_id}/publish`, { method: 'POST', headers: staffH(env) });
  await call(env, '/preview/admin/editions', { method: 'POST', headers: staffH(env), body: { fiji_date: '2031-02-02', slot: 'afternoon', offer_ids: [offer.data.offer_id] } });
  const eds = (await call(env, '/preview/admin/editions', { headers: staffH(env) })).data.editions;
  assert.deepEqual(eds.map((e) => [e.edition_id, e.status, e.offers.map((o) => o.title)]), [['2031-02-02:afternoon', 'draft', ['Edition offer']]]);
});
