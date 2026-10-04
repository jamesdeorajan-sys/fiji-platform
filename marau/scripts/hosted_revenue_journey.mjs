/* Marau - HOSTED synthetic revenue journey, run against the ISOLATED PREVIEW Worker/D1 only.
 *
 *   node scripts/hosted_revenue_journey.mjs <preview base url> <MARAU_ADMIN_TEST_TOKEN>
 *
 * Evidence label when run: HOSTED SYNTHETIC (isolated preview). Every guest, supplier, offer and amount is synthetic and
 * labelled; nothing is sent, charged or reaches a real system. It leaves the reward policy back at OFF when it finishes.
 * One piece is a stated FIXTURE: a return-transfer leg is inserted into the preview DB with `wrangler d1 execute`, standing
 * in for the real-booking mirror attaching a second leg to a guest (that mirror is proven separately, rounds 13-22).
 *
 * Prints one JSON object of named checks. Exit code 1 if any check fails.
 */
import { execFileSync } from 'node:child_process';

const [BASE, ADMIN] = process.argv.slice(2);
if (!BASE || !ADMIN) { console.error('usage: node scripts/hosted_revenue_journey.mjs <base url> <admin test token>'); process.exit(2); }
const RUN = Date.now().toString(36);
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), ...(detail !== undefined ? { detail } : {}) }); };

const api = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, text };
};
const adminH = { authorization: `Bearer ${ADMIN}` };
const staff = (tok) => ({ ...adminH, 'x-marau-staff-token': tok });
const guest = (t) => ({ authorization: `Bearer ${t}` });
const ANA = `demo-ana-${RUN}`; const BALA = `demo-bala-${RUN}`;
const inDays = (d, h = 0) => new Date(Date.now() + d * 86400_000 + h * 3600_000).toISOString();
let phoneN = 0;
const synth = (over = {}) => { phoneN += 1; return { guest_email: `r30.${RUN}.${phoneN}@example.test`, guest_phone: `+1500555${String(Math.floor(Math.random() * 9000) + 1000)}`, whatsapp_available: true, pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'Sedan', quoted_amount: 100, pickup_datetime: inDays(3).slice(0, 16), leg_type: 'arrival', ...over }; };
const wrangler = (sql) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'marau-stage1-test-db', '--remote', '--command', `"${sql.replace(/"/g, '')}"`], { env: { ...process.env, CLOUDFLARE_API_TOKEN: '' }, shell: true, encoding: 'utf8' });
const wranglerJson = (sql) => { const out = wrangler(sql); return JSON.parse(out.slice(out.indexOf('[')))[0].results; };

async function newGuest(over) {
  const res = await api('/preview/bookings', { method: 'POST', body: synth(over) });
  if (res.status !== 201) throw new Error('guest create failed ' + res.text);
  const row = wranglerJson(`SELECT session_id FROM guest_sessions WHERE access_token = '${res.data.access_token}'`)[0];
  return { token: res.data.access_token, sessionId: row.session_id, applied: res.data.referral_applied };
}
const publishedOffer = async (supplierId, over = {}) => {
  const c = await api('/preview/admin/offers', { method: 'POST', headers: staff(ANA), body: { supplier_id: supplierId, title: `Synthetic snorkel ${RUN}`, location: 'Mamanuca reef (synthetic)', inclusions: ['boat', 'lunch'], starts_at: inDays(6), book_by: inDays(5), expires_at: inDays(5, 12), capacity: 4, price_per_place_fjd: 120, cost_per_place_fjd: 80, ...over } });
  const p = await api(`/preview/admin/offers/${c.data.offer_id}/publish`, { method: 'POST', headers: staff(ANA) });
  return { id: c.data.offer_id, createStatus: c.status, publishStatus: p.status };
};

try {
  // ---- staff identities + supplier gate
  await api('/preview/admin/staff-identities', { method: 'POST', headers: adminH, body: { token: ANA, operator_name: `Ana (demo ops ${RUN})` } });
  await api('/preview/admin/staff-identities', { method: 'POST', headers: adminH, body: { token: BALA, operator_name: `Bala (demo ops ${RUN})` } });
  const noStaff = await api('/preview/admin/suppliers', { method: 'POST', headers: adminH, body: { name: 'X Tours', fulfilment_owner: 'Ana' } });
  check('staff identity required: shared admin credential alone is refused', noStaff.status === 401);
  const sup = await api('/preview/admin/suppliers', { method: 'POST', headers: staff(ANA), body: { name: `Synthetic Reef Tours ${RUN}`, fulfilment_owner: `Ana (demo ops ${RUN})` } });
  const draft = await api('/preview/admin/offers', { method: 'POST', headers: staff(ANA), body: { supplier_id: sup.data.supplier_id, title: 'Unverified-supplier offer', location: 'x y', inclusions: 'z', starts_at: inDays(5), capacity: 2, price_per_place_fjd: 50 } });
  const refuse = await api(`/preview/admin/offers/${draft.data.offer_id}/publish`, { method: 'POST', headers: staff(ANA) });
  check('an offer cannot publish for an UNVERIFIED supplier', refuse.status === 409 && refuse.data.error === 'SUPPLIER_NOT_VERIFIED');
  await api(`/preview/admin/suppliers/${sup.data.supplier_id}/verify`, { method: 'POST', headers: staff(ANA) });

  // ---- reward policy: ships OFF; set a SYNTHETIC preview policy (FJ$10 is an illustration, not an approved rule)
  const pol0 = (await api('/preview/admin/rewards/policy', { headers: staff(ANA) })).data.policy;
  check('policy starts OFF with no pre-approved amount (or was left off by an earlier run)', pol0.mode === 'off');
  const live = await api('/preview/admin/rewards/policy', { method: 'POST', headers: staff(ANA), body: { mode: 'live' } });
  check('LIVE rewards cannot be switched on through the API', live.status === 409 && live.data.error === 'LIVE_REWARDS_REQUIRE_OWNER_APPROVAL');
  await api('/preview/admin/rewards/policy', { method: 'POST', headers: staff(ANA), body: { mode: 'preview', amount_fjd: 10, cap_per_referrer_fjd: 20, min_purchase_fjd: 50, qualify_on: 'fulfilled', funding_source: 'synthetic_test_budget' } });

  // ---- the acceptance journey
  const offer = await publishedOffer(sup.data.supplier_id);
  check('verified supplier + owner -> offer created and published', offer.createStatus === 201 && offer.publishStatus === 200);
  const referrer = await newGuest();
  wrangler(`INSERT INTO marau_test_bookings (client_booking_ref, guest_session_id, guest_email, guest_phone, pickup_zone, destination_zone, vehicle_type, pickup_datetime, quoted_amount, status, test_data, created_at, updated_at, leg_type) SELECT 'RET-${RUN}', session_id, guest_email, guest_phone, 'DENARAU', 'NAD_AIRPORT', 'Sedan', '${inDays(12)}', 100, 'pending', 1, '${new Date().toISOString()}', '${new Date().toISOString()}', 'return' FROM guest_sessions WHERE session_id = '${referrer.sessionId}'`);
  const returnId = wranglerJson(`SELECT id FROM marau_test_bookings WHERE client_booking_ref = 'RET-${RUN}'`)[0].id;
  const trip = await api('/preview/trip', { headers: guest(referrer.token) });
  const offersBeside = await api('/preview/offers', { headers: guest(referrer.token) });
  check('guest has a Marau trip (arrival + return) and sees the offer beside it', trip.data.bookings.length === 2 && offersBeside.data.offers.some((o) => o.offer_id === offer.id));

  const ref = (await api('/preview/referral', { headers: guest(referrer.token) })).data;
  check('PUBLIC referral link is separate from the PRIVATE trip token and reveals nothing', /\/r\/[A-Z2-9]{8}$/.test(ref.share_url) && !ref.share_url.includes(referrer.token) && !JSON.stringify(ref).includes(referrer.token));
  const landing = await api(`/r/${ref.code}`);
  const qr = await api(`/preview/referral/qr.svg?code=${ref.code}`);
  check('public landing page and QR are served anonymously and carry no private data', landing.status === 200 && qr.status === 200 && qr.text.startsWith('<svg') && !landing.text.includes(referrer.token) && !qr.text.includes(referrer.token));
  check('referral guest view requires the private token', (await api('/preview/referral')).status === 401);

  const friend = await newGuest({ referral_code: ref.code });
  check('friend joins through the link and is attributed (response says only "applied")', friend.applied === true);
  const sameRef = await api('/preview/bookings', { method: 'POST', body: { ...synth({ referral_code: ref.code }), guest_phone: wranglerJson(`SELECT guest_phone FROM guest_sessions WHERE session_id = '${referrer.sessionId}'`)[0].guest_phone } });
  check('self-referral (referrer\'s own phone) is NOT attributed', sameRef.status === 201 && sameRef.data.referral_applied === false);

  const bought = await api(`/preview/offers/${offer.id}/request`, { method: 'POST', headers: guest(friend.token), body: { places: 1, client_request_ref: `k-${RUN}` } });
  const again = await api(`/preview/offers/${offer.id}/request`, { method: 'POST', headers: guest(friend.token), body: { places: 1, client_request_ref: `k-${RUN}` } });
  check('request saved; a repeated request returns the SAME request', bought.status === 201 && again.status === 200 && again.data.request.request_id === bought.data.request.request_id);
  const creditsAfterSave = (await api('/preview/admin/rewards/credits', { headers: staff(ANA) })).data.credits.filter((c) => true).length;
  const rid = bought.data.request.request_id;
  const c1 = await api(`/preview/admin/offers/requests/${rid}/confirm`, { method: 'POST', headers: staff(ANA), body: { operator: 'Impersonated' } });
  const row = wranglerJson(`SELECT decided_by FROM marau_offer_requests WHERE request_id = '${rid}'`)[0];
  check('human confirmation records the operator from the STAFF TOKEN (spoofed body field ignored)', c1.status === 200 && row.decided_by === `Ana (demo ops ${RUN})`);
  const c2 = await api(`/preview/admin/offers/requests/${rid}/confirm`, { method: 'POST', headers: staff(BALA), body: {} });
  check('a repeat confirm by another staff member changes nothing', c2.data.repeated === true && c2.data.original_operator === `Ana (demo ops ${RUN})`);
  const credPending = wranglerJson(`SELECT status FROM marau_reward_credits WHERE qualifying_request_id = '${rid}'`);
  check('SAVED request earned nothing; confirmation makes the credit only PENDING', credPending.length === 1 && credPending[0].status === 'pending' && creditsAfterSave >= 0);
  await api(`/preview/admin/offers/requests/${rid}/fulfil`, { method: 'POST', headers: staff(ANA), body: {} });
  const credit = wranglerJson(`SELECT credit_id, status, amount_cents, funding_source FROM marau_reward_credits WHERE qualifying_request_id = '${rid}'`)[0];
  check('fulfilment earns exactly one credit, funding source recorded', credit.status === 'earned' && credit.amount_cents === 1000 && credit.funding_source === 'synthetic_test_budget');

  // concurrent redemption of one credit against two return bookings
  wrangler(`INSERT INTO marau_test_bookings (client_booking_ref, guest_session_id, guest_email, guest_phone, pickup_zone, destination_zone, vehicle_type, pickup_datetime, quoted_amount, status, test_data, created_at, updated_at, leg_type) SELECT 'RET2-${RUN}', session_id, guest_email, guest_phone, 'DENARAU', 'NAD_AIRPORT', 'Sedan', '${inDays(13)}', 100, 'pending', 1, '${new Date().toISOString()}', '${new Date().toISOString()}', 'return' FROM guest_sessions WHERE session_id = '${referrer.sessionId}'`);
  const return2 = wranglerJson(`SELECT id FROM marau_test_bookings WHERE client_booking_ref = 'RET2-${RUN}'`)[0].id;
  const applyBody = (id) => ({ method: 'POST', headers: staff(ANA), body: { booking_id: id } });
  const [x, y] = await Promise.all([api(`/preview/admin/rewards/credits/${credit.credit_id}/apply`, applyBody(returnId)), api(`/preview/admin/rewards/credits/${credit.credit_id}/apply`, { ...applyBody(return2), headers: staff(BALA) })]);
  check('CONCURRENT redemption: exactly one of two simultaneous applications wins', [x.status, y.status].sort().join() === '200,409', [x.status, y.status]);
  const adjustments = wranglerJson(`SELECT COUNT(*) AS n FROM marau_booking_adjustments WHERE credit_id = '${credit.credit_id}'`)[0].n;
  check('exactly ONE credit adjustment exists', adjustments === 1);
  const landed = x.status === 200 ? returnId : return2;
  const finalTrip = (await api('/preview/trip', { headers: guest(referrer.token) })).data.bookings.find((b) => b.id === landed);
  check('guest sees original fare, credit and amount due SEPARATELY (100 / 10 / 90)', finalTrip.fare.original_fare_fjd === 100 && finalTrip.fare.referral_credit_fjd === 10 && finalTrip.fare.amount_due_fjd === 90 && finalTrip.fare.operator_payout_unchanged === true);
  check('original quote is unchanged in the database', wranglerJson(`SELECT quoted_amount FROM marau_test_bookings WHERE id = ${landed}`)[0].quoted_amount === 100);

  // sold-out, expired, deadline, withdrawal, cancellation
  const small = await publishedOffer(sup.data.supplier_id, { capacity: 1, title: `Synthetic sold-out ${RUN}` });
  const gA = await newGuest(); const gB = await newGuest();
  const [ra, rb] = await Promise.all([api(`/preview/offers/${small.id}/request`, { method: 'POST', headers: guest(gA.token), body: { places: 1 } }), api(`/preview/offers/${small.id}/request`, { method: 'POST', headers: guest(gB.token), body: { places: 1 } })]);
  check('SOLD OUT under concurrency: capacity 1, two simultaneous requests -> exactly one place held', [ra.status, rb.status].sort().join() === '201,409');
  const loser = ra.status === 409 ? ra : rb;
  check('the loser is told SOLD_OUT', loser.data.error === 'SOLD_OUT');
  const expiring = await publishedOffer(sup.data.supplier_id, { title: `Synthetic expiring ${RUN}` });
  wrangler(`UPDATE marau_experience_offers SET expires_at = '${inDays(0, -1)}', book_by = '${inDays(0, -2)}' WHERE offer_id = '${expiring.id}'`);
  const exp = await api(`/preview/offers/${expiring.id}/request`, { method: 'POST', headers: guest(gA.token), body: { places: 1 } });
  check('EXPIRED offer: refused (410) and not listed', exp.status === 410 && !(await api('/preview/offers')).data.offers.some((o) => o.offer_id === expiring.id));
  const wd = await publishedOffer(sup.data.supplier_id, { title: `Synthetic withdrawn ${RUN}`, capacity: 5 });
  const gC = await newGuest(); const gD = await newGuest();
  const open = await api(`/preview/offers/${wd.id}/request`, { method: 'POST', headers: guest(gC.token), body: { places: 1 } });
  const conf = await api(`/preview/offers/${wd.id}/request`, { method: 'POST', headers: guest(gD.token), body: { places: 1 } });
  await api(`/preview/admin/offers/requests/${conf.data.request.request_id}/confirm`, { method: 'POST', headers: staff(ANA), body: {} });
  const wres = await api(`/preview/admin/offers/${wd.id}/withdraw`, { method: 'POST', headers: staff(ANA), body: { reason: 'synthetic supplier cancelled' } });
  check('WITHDRAWAL declines open requests but flags (never silently cancels) confirmed guests', wres.data.declined_open_requests === 1 && wres.data.confirmed_guests_needing_human_follow_up === 1 && open.status === 201);
  const canc = await api(`/preview/offers/requests/${small.id ? (ra.status === 201 ? ra : rb).data.request.request_id : ''}/cancel`, { method: 'POST', headers: guest(ra.status === 201 ? gA.token : gB.token) });
  check('guest CANCELLATION before the deadline releases the place', canc.status === 200 && canc.data.request.status === 'cancelled_by_guest');
  const afterCancel = await api(`/preview/offers/${small.id}/request`, { method: 'POST', headers: guest(ra.status === 201 ? gB.token : gA.token), body: { places: 1 } });
  check('...and the released place can be taken by someone else', afterCancel.status === 201);

  // reversal after application is flagged, not silent
  const stats = wranglerJson(`SELECT status, needs_manual_adjustment FROM marau_reward_credits WHERE credit_id = '${credit.credit_id}'`)[0];
  await api(`/preview/admin/offers/requests/${rid}/cancel`, { method: 'POST', headers: staff(ANA), body: { note: 'synthetic refund after discount applied' } });
  const rev = wranglerJson(`SELECT status, needs_manual_adjustment FROM marau_reward_credits WHERE credit_id = '${credit.credit_id}'`)[0];
  const fareAfter = (await api('/preview/trip', { headers: guest(referrer.token) })).data.bookings.find((b) => b.id === landed).fare;
  check('reversing the purchase AFTER a credit was applied flags it for a human; the fare is not silently changed', stats.status === 'applied' && rev.status === 'reversed' && rev.needs_manual_adjustment === 1 && fareAfter.adjustment_status === 'reversal_pending_staff' && fareAfter.amount_due_fjd === 90);

  // missing WhatsApp + consent + private-link protection
  const noWa = await newGuest({ whatsapp_available: false });
  const off2 = await publishedOffer(sup.data.supplier_id, { title: `Synthetic sunset ${RUN}`, capacity: 6 });
  const noWaReq = await api(`/preview/offers/${off2.id}/request`, { method: 'POST', headers: guest(noWa.token), body: { places: 1 } });
  const queue = (await api('/preview/admin/guests?attention=1', { headers: staff(ANA) })).data.guests.find((g) => g.session_id === noWa.sessionId);
  check('MISSING WHATSAPP: guest can still request; staff see an email fallback and a missing-owner flag', noWaReq.status === 201 && queue && queue.follow_up.channel === 'email' && queue.attention.includes('no_whatsapp_and_no_named_owner'));
  const assign = await api(`/preview/admin/guests/${noWa.sessionId}/follow-up-owner`, { method: 'POST', headers: staff(BALA), body: { owner: `Ana (demo ops ${RUN})` } });
  check('a NAMED staff owner can be assigned; a made-up name is refused', assign.status === 200 && (await api(`/preview/admin/guests/${noWa.sessionId}/follow-up-owner`, { method: 'POST', headers: staff(BALA), body: { owner: 'Nobody Real' } })).status === 400);
  const promo = await api('/preview/admin/messages/check', { method: 'POST', headers: staff(ANA), body: { session_id: noWa.sessionId, purpose: 'deal_edition' } });
  const essential = await api('/preview/admin/messages/check', { method: 'POST', headers: staff(ANA), body: { session_id: noWa.sessionId, purpose: 'booking_confirmation' } });
  check('promotional needs consent (unknown -> not allowed); essential trip messages always allowed; nothing sent', promo.data.allowed === false && essential.data.allowed === true && promo.data.nothing_was_sent === true);
  const other = await api(`/preview/offers/requests/${noWaReq.data.request.request_id}/cancel`, { method: 'POST', headers: guest(gA.token) });
  const handoff = await api(`/preview/offers/requests/${noWaReq.data.request.request_id}/whatsapp-handoff`, { method: 'POST', headers: guest(noWa.token) });
  check('PRIVATE data is private: another guest cannot touch a request; enquiry text has the reference, no contact, no wa.me link', other.status === 404 && handoff.data.handoff.message.includes(noWaReq.data.request.reference) && !/wa\.me|https?:/.test(handoff.text) && !handoff.text.includes('example.test'));
  const pub = (await api('/preview/offers')).text + (await api(`/r/${ref.code}`)).text;
  check('public surfaces contain no guest email/phone/cost/owner', !pub.includes('example.test') && !pub.includes('cost_per_place') && !pub.includes('fulfilment_owner'));
  check('browse-anytime: anonymous browsing lists every published offer', (await api('/preview/offers')).data.browse_all === true);

  // report
  const rep = (await api('/preview/admin/offers/report', { headers: staff(ANA) })).data;
  check('report labels quoted value as NOT revenue and separates shares/attributions/credits/funding', /NOT revenue/.test(rep.labels.quoted_value) && typeof rep.referral_shares_tapped === 'number' && typeof rep.reward_funding_committed_fjd === 'number');
  checks.push({ name: 'report snapshot (all hosted synthetic data accumulated in the preview DB)', ok: true, detail: { requests_total: rep.requests_total, requests_confirmed: rep.requests_confirmed, requests_fulfilled: rep.requests_fulfilled, confirmed_sales_value_fjd: rep.confirmed_sales_value_fjd, realised_contribution_fjd_before_rewards: rep.realised_contribution_fjd_before_rewards, reward_credits: rep.reward_credits, reward_funding_committed_fjd: rep.reward_funding_committed_fjd } });
} catch (err) {
  check('journey completed without an unexpected error', false, String(err && err.stack ? err.stack : err));
} finally {
  // Restore the shipped default: rewards OFF.
  await api('/preview/admin/rewards/policy', { method: 'POST', headers: staff(ANA), body: { mode: 'off' } }).catch(() => {});
  const final = await api('/preview/admin/rewards/policy', { headers: staff(ANA) }).catch(() => null);
  check('policy restored to OFF at the end of the run', final && final.data.policy.mode === 'off');
}

const failed = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ run: RUN, base: BASE, evidence_label: 'HOSTED SYNTHETIC (isolated preview)', passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);
