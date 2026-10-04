/* HOSTED SYNTHETIC check of the RC4 uncertain-return workflow with REWARDS OFF, on an isolated preview. API level, author-run; it is NOT
 * staff-console browser acceptance (the console needs credentials typed by a person - see docs/MARAU_STAFF_ACCEPTANCE_HANDOFF.md).
 *   ADMIN_TOKEN=... node scripts/hosted_uncertain_return_rewards_off.mjs <base url>
 * It aborts without writing if the reward policy is not OFF, and never turns rewards on. It does NOT delete or retire anyone else's allocation rule to make a check pass.
 * Section 3 creates ONE synthetic approved allocation rule on purpose (to prove OFF still blocks earning/application even when a rule exists) and retires that
 * one rule, and only that one, at the very end as cleanup.
 * Evidence records detail only for failing checks, with any guest token redacted. Creates its own synthetic staff identity.
 */
const [BASE] = process.argv.slice(2);
const ADMIN = process.env.ADMIN_TOKEN;
if (!BASE || !ADMIN) { console.error('usage: ADMIN_TOKEN=... node scripts/hosted_uncertain_return_rewards_off.mjs <base url>'); process.exit(2); }
const RUN = Date.now().toString(36);
const checks = [];
const redact = (d) => JSON.parse(JSON.stringify(d === undefined ? null : d).replace(/tok_[0-9a-f-]{36}/g, 'tok_REDACTED'));
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), ...(!ok && detail !== undefined ? { detail: redact(detail) } : {}) });
const api = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const r = await fetch(BASE + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
};
const A = { authorization: `Bearer ${ADMIN}` };
const STAFF = `rc4-bala-${RUN}`; const S = { ...A, 'x-marau-staff-token': STAFF };
const inDays = (d) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
const SRC = Number(String(Date.now()).slice(-7)) * 10 + 7;
const body = (over = {}) => ({ source_booking_ref: String(SRC), id: SRC, guest_email: `rc4.${RUN}@example.test`, guest_phone: `+1500562${String(Math.floor(1000 + Math.random() * 8999))}`, whatsapp_available: true, pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'Sedan', quoted_amount: 170, quoted_currency: 'FJD', settlement_amount_fjd: 150, commission_base_fjd: 20, assigned_driver_id: null,
  pickup_date: inDays(3), pickup_time: '09:00', return_date: inDays(10), return_time: '10:30', return_pickup_location: 'Sofitel Denarau lobby', status: 'accepted', ...over });
let ev = Date.now() % 1_000_000_000;
const seed = (b) => api('/preview/admin/synthetic-source', { method: 'POST', headers: A, body: b });
const sync = (b, type, status) => api(`/preview/admin/synthetic-source/${b.source_booking_ref}/sync-event`, { method: 'POST', headers: A, body: { event_type: type, new_status: status, source_event_id: ++ev, booking_id: b.id } });
const mirrorOf = async () => (await api(`/preview/admin/synthetic-source/${SRC}`, { headers: A })).data;
const queue = async () => (await api('/preview/admin/guests?attention=1', { headers: S })).data.guests || [];
const mine = async () => (await queue()).find((g) => g.contact.email === `rc4.${RUN}@example.test`);
const verify = (id, over) => api(`/preview/admin/bookings/${id}/verify-status`, { method: 'POST', headers: S, body: { verdict: 'return_upcoming', evidence: 'synthetic hosted check: confirmed by phone that the return is still booked', ...over } });

try {
  await api('/preview/admin/staff-identities', { method: 'POST', headers: A, body: { token: STAFF, operator_name: `Bala (rc4 ${RUN})` } });
  const pol = await api('/preview/admin/rewards/policy', { headers: S });
  check('PRECONDITION: rewards policy is OFF (script sets no policy)', pol.status === 200 && pol.data.policy && pol.data.policy.mode === 'off', pol.data);
  if (!(pol.data.policy && pol.data.policy.mode === 'off')) throw new Error('rewards policy is not off - aborting without writing');
  const rulesAtStart = ((await api('/preview/admin/rewards/allocation-rules', { headers: S })).data.rules || []).map((r) => r.status);
  check('INFO: allocation rules present at start are left as they are (statuses: ' + rulesAtStart.join(',') + ')', true);
  const b = body(); await seed(b);
  const created = await sync(b, 'created', 'accepted');
  const tok = created.data.session.access_token;
  check('before: a normal booking is not in the attention queue', !(await mine()));
  await seed({ ...b, status: 'completed' }); await sync(b, 'completed', 'completed');
  const g = await mine();
  check('NEEDS ATTENTION (rewards OFF): the uncertain return is listed with the facts to check', g && g.attention.includes('return_status_needs_verification') && g.uncertain_returns.length === 1 && g.uncertain_returns[0].pickup_zone === 'Sofitel Denarau lobby' && g.uncertain_returns[0].destination_zone === 'Nadi Airport' && g.uncertain_returns[0].source_status === 'completed', g);
  const u = g.uncertain_returns[0];
  const before = await mirrorOf();
  const noBasis = await verify(u.booking_id, {});
  check('a verdict without the itinerary basis is refused (400)', noBasis.status === 400, noBasis);
  const wrong = await verify(u.booking_id, { itinerary_basis: u.itinerary_basis + 'x' });
  check('a stale/wrong basis is refused (409 ITINERARY_CHANGED) and records nothing', wrong.status === 409 && wrong.data.error === 'ITINERARY_CHANGED', wrong);
  check('a request without a valid staff identity is refused (401)', (await api(`/preview/admin/bookings/${u.booking_id}/verify-status`, { method: 'POST', headers: { ...A, 'x-marau-staff-token': 'nope' }, body: { verdict: 'return_upcoming', evidence: 'x'.repeat(12), itinerary_basis: u.itinerary_basis } })).status === 401);
  const ok = await verify(u.booking_id, { itinerary_basis: u.itinerary_basis });
  check('verification recorded: actor, timestamp, source unchanged', ok.status === 200 && ok.data.source_unchanged === true && ok.data.leg.verified_by === `Bala (rc4 ${RUN})` && Boolean(ok.data.leg.verified_at), ok);
  const after = await mirrorOf();
  check('source provenance and money fields identical before and after verification', before.mirror && after.mirror && ['source_kind', 'source_origin', 'source_authenticated', 'test_data', 'source_status', 'source_total_cents', 'pickup_datetime'].every((k) => before.mirror[k] === after.mirror[k]), { before: before.mirror, after: after.mirror });
  const trip = (await api('/preview/trip', { headers: { authorization: `Bearer ${tok}` } })).data;
  const ret = trip.bookings.find((x) => x.leg_key === 'return');
  check('guest sees the return confirmed with a plain staff-checked flag; never who verified or the evidence', ret.status === 'confirmed' && ret.staff_checked_status === true && !/status_verified_by|status_verification_evidence|Bala|itinerary_basis/.test(JSON.stringify(trip)));
  check('the item leaves the attention queue', !(await mine()));
  const credits = (await api('/preview/admin/rewards/credits', { headers: S })).data.credits || [];
  check('REWARDS OFF: no credit exists for this guest (return-value allocation is a separate thing, checked in section 3)', !credits.some((c) => c.holder && c.holder.email === `rc4.${RUN}@example.test`), { credits_for_guest: credits.filter((c) => c.holder && c.holder.email === `rc4.${RUN}@example.test`).length });
  await seed({ ...b, status: 'completed', return_time: '16:00' }); await sync(b, 'completed', 'completed');
  const re = await mine();
  const t2 = (await api('/preview/trip', { headers: { authorization: `Bearer ${tok}` } })).data.bookings.find((x) => x.leg_key === 'return');
  check('INVALIDATION: a changed return time re-opens the item, clears the guest note and the status goes back to pending', re && re.uncertain_returns.length === 1 && re.uncertain_returns[0].itinerary_basis !== u.itinerary_basis && t2.status === 'pending' && t2.staff_checked_status === false && t2.status_uncertainty === 'source_completed_while_return_upcoming', { re, t2 });
  const stale = await verify(u.booking_id, { itinerary_basis: u.itinerary_basis });
  check('the old basis cannot be reused after the change (409)', stale.status === 409 && stale.data.error === 'ITINERARY_CHANGED', stale);
  const again = await verify(u.booking_id, { itinerary_basis: re.uncertain_returns[0].itinerary_basis });
  check('re-verification against the NEW basis works', again.status === 200, again);

  // ---------------- 2. "Not going ahead", end to end, rewards OFF
  const b3 = body({ source_booking_ref: String(SRC + 1), id: SRC + 1, guest_email: `rc4.ngo.${RUN}@example.test`, guest_phone: `+1500564${String(Math.floor(1000 + Math.random() * 8999))}` });
  await seed(b3); const c3 = await sync(b3, 'created', 'accepted'); const tok3 = c3.data.session.access_token;
  await seed({ ...b3, status: 'completed' }); await sync(b3, 'completed', 'completed');
  const mine3 = async () => (await queue()).find((x) => x.contact.email === b3.guest_email);
  const q3 = await mine3(); const u3 = q3 && q3.uncertain_returns[0];
  check('NGO: the uncertain return is in the staff queue', Boolean(u3));
  const m3before = (await api(`/preview/admin/synthetic-source/${b3.source_booking_ref}`, { headers: A })).data;
  const NOTE = 'synthetic hosted check: hotel desk confirmed the guest has cancelled the return';
  const ngo = await verify(u3.booking_id, { verdict: 'return_not_going_ahead', evidence: NOTE, itinerary_basis: u3.itinerary_basis });
  check('NGO: recorded under the named staff identity; source stated unchanged', ngo.status === 200 && ngo.data.source_unchanged === true && ngo.data.leg.status === 'cancelled' && ngo.data.leg.verified_by === `Bala (rc4 ${RUN})`, ngo);
  check('NGO: the item leaves the queue', !(await mine3()));
  const g3 = (await api('/preview/trip', { headers: { authorization: `Bearer ${tok3}` } })).data;
  const r3 = g3.bookings.find((x) => x.leg_key === 'return');
  check('NGO: the guest sees Cancelled, no staff-checked note, no verifier or evidence', r3.status === 'cancelled' && r3.staff_checked_status === false && !JSON.stringify(g3).includes(NOTE) && !/Bala|status_verified_by|itinerary_basis/.test(JSON.stringify(g3)));
  const m3after = (await api(`/preview/admin/synthetic-source/${b3.source_booking_ref}`, { headers: A })).data;
  check('NGO: source row, provenance and money identical before and after', m3before.mirror && ['source_kind', 'source_origin', 'source_authenticated', 'test_data', 'source_status', 'source_total_cents', 'pickup_datetime'].every((k) => m3before.mirror[k] === m3after.mirror[k]) && JSON.stringify(m3before.source) === JSON.stringify(m3after.source));
  const rep1 = await verify(u3.booking_id, { verdict: 'return_not_going_ahead', evidence: NOTE, itinerary_basis: u3.itinerary_basis });
  check('NGO: a repeated action is a no-op (409 NOTHING_TO_VERIFY)', rep1.status === 409 && rep1.data.error === 'NOTHING_TO_VERIFY', rep1);
  await seed({ ...b3, status: 'completed', return_time: '16:00' }); await sync(b3, 'completed', 'completed');
  const q3b = await mine3(); const r3b = (await api('/preview/trip', { headers: { authorization: `Bearer ${tok3}` } })).data.bookings.find((x) => x.leg_key === 'return');
  check('NGO: a later itinerary change re-opens it (pending, uncertain, new basis) rather than leaving it cancelled', q3b && q3b.uncertain_returns[0].itinerary_basis !== u3.itinerary_basis && r3b.status === 'pending' && r3b.status_uncertainty === 'source_completed_while_return_upcoming', { q3b, r3b });
  const oldBasis = await verify(u3.booking_id, { verdict: 'return_not_going_ahead', evidence: NOTE, itinerary_basis: u3.itinerary_basis });
  check('NGO: the old basis cannot be reused (409 ITINERARY_CHANGED)', oldBasis.status === 409 && oldBasis.data.error === 'ITINERARY_CHANGED', oldBasis);

  // ---------------- 3. O5: allocation is not earning. OFF blocks earning, promotion and application even with an APPROVED rule present.
  const STAFF2 = `rc4-ana-${RUN}`; const S2 = { ...A, 'x-marau-staff-token': STAFF2 };
  await api('/preview/admin/staff-identities', { method: 'POST', headers: A, body: { token: STAFF2, operator_name: `Ana (rc4 ${RUN})` } });
  const rule = await api('/preview/admin/rewards/allocation-rules', { method: 'POST', headers: S2, body: { kind: 'percent_of_total', percent: 40 } });
  const ruleId = rule.data && rule.data.rule && rule.data.rule.rule_id;
  const appr = await api(`/preview/admin/rewards/allocation-rules/${ruleId}/approve`, { method: 'POST', headers: S, body: { note: 'synthetic: proves OFF blocks rewards even when a rule is approved' } });
  check('O5: an APPROVED synthetic allocation rule exists for the whole of this section (it is not deleted to make a check pass)', rule.status === 201 && appr.status === 200 && appr.data.rule.status === 'approved', { rule: rule.status, appr: appr.status });
  check('O5: rewards policy is still OFF', ((await api('/preview/admin/rewards/policy', { headers: S })).data.policy || {}).mode === 'off');
  const b4 = body({ source_booking_ref: String(SRC + 2), id: SRC + 2, guest_email: `rc4.o5.${RUN}@example.test`, guest_phone: `+1500565${String(Math.floor(1000 + Math.random() * 8999))}` });
  await seed(b4); const c4 = await sync(b4, 'created', 'accepted'); const tok4 = c4.data.session.access_token;
  const trip4 = async () => (await api('/preview/trip', { headers: { authorization: `Bearer ${tok4}` } })).data.bookings.find((x) => x.leg_key === 'return');
  await trip4(); // the first guest read runs the reconcile sweep that allocates (the response is built from rows read before it)
  const ret4 = await trip4();
  check('O5 (1) ALLOCATION still happens with rewards OFF: the return leg is valued by the approved rule (allocation is rule-gated, not mode-gated)', ret4.leg_value_status === 'allocated' && ret4.leg_value_cents === Math.round(17000 * 0.4), ret4);
  // (2) EARNING blocked: a referred friend's purchase is confirmed, paid and fulfilled
  const code4 = (await api('/preview/referral', { headers: { authorization: `Bearer ${tok4}` } })).data.code;
  const friend = await api('/preview/bookings', { method: 'POST', body: { guest_email: `rc4.o5f.${RUN}@example.test`, guest_phone: `+1500566${String(Math.floor(1000 + Math.random() * 8999))}`, whatsapp_available: true, pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'Sedan', quoted_amount: 80, pickup_datetime: new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 16), referral_code: code4 } });
  const sup = await api('/preview/admin/suppliers', { method: 'POST', headers: S, body: { name: `Synthetic Reef Tours rc4 ${RUN}`, fulfilment_owner: `Bala (rc4 ${RUN})` } });
  await api(`/preview/admin/suppliers/${sup.data.supplier_id}/verify`, { method: 'POST', headers: S });
  const inD = (d, h = 0) => new Date(Date.now() + d * 86400_000 + h * 3600_000).toISOString();
  const offer = await api('/preview/admin/offers', { method: 'POST', headers: S, body: { supplier_id: sup.data.supplier_id, title: `Synthetic snorkel rc4 ${RUN}`, location: 'Mamanuca reef (synthetic)', inclusions: ['boat'], starts_at: inD(6), book_by: inD(5), expires_at: inD(5, 12), capacity: 20, price_per_place_fjd: 120, cost_per_place_fjd: 80 } });
  await api(`/preview/admin/offers/${offer.data.offer_id}/publish`, { method: 'POST', headers: S });
  const rid = (await api(`/preview/offers/${offer.data.offer_id}/request`, { method: 'POST', headers: { authorization: `Bearer ${friend.data.access_token}` }, body: { places: 1 } })).data.request.request_id;
  const act = (a, bd = {}) => api(`/preview/admin/offers/requests/${rid}/${a}`, { method: 'POST', headers: S, body: bd });
  await act('confirm'); await act('payment', { event: 'paid', amount_fjd: 120, method: 'cash', event_key: `rc4-${RUN}` }); const ful = await act('fulfil');
  const creditsAfter = (await api('/preview/admin/rewards/credits', { headers: S })).data.credits || [];
  check('O5 (2) EARNING is blocked: the referred purchase was fulfilled and paid, yet NO credit exists for the referrer', ful.status === 200 && !creditsAfter.some((c) => c.holder && c.holder.email === b4.guest_email), { fulfil: ful.status });
  // (3) APPLICATION blocked: try an already-earned credit on the allocated, live return leg
  const earnedExisting = creditsAfter.find((c) => c.status === 'earned');
  if (earnedExisting) {
    const ap = await api(`/preview/admin/rewards/credits/${earnedExisting.credit_id}/apply`, { method: 'POST', headers: S, body: { booking_id: ret4.id } });
    const stillEarned = ((await api('/preview/admin/rewards/credits', { headers: S })).data.credits || []).find((c) => c.credit_id === earnedExisting.credit_id);
    check('O5 (3) APPLICATION is blocked (409 REWARDS_OFF) on an allocated return leg, and the credit is left earned', ap.status === 409 && ap.data.error === 'REWARDS_OFF' && stillEarned && stillEarned.status === 'earned', { status: ap.status, error: ap.data && ap.data.error });
  } else {
    check('INFO: no pre-existing earned credit on this preview, so APPLICATION-blocked is proven by the local suite only', true);
  }
  const pendingExisting = creditsAfter.filter((c) => c.status === 'pending').length;
  check(`INFO: PROMOTION-blocked is proven by the local suite (pre-existing pending credits on this preview: ${pendingExisting}; creating one needs rewards ON, which this script never does)`, true);
  const retire = await api(`/preview/admin/rewards/allocation-rules/${ruleId}/retire`, { method: 'POST', headers: S, body: { note: 'cleanup of the one rule this section created' } });
  check('CLEANUP: only the rule this section created was retired', retire.status === 200);
  const p2 = await api('/preview/admin/rewards/policy', { headers: S });
  check('rewards still OFF at the end', p2.data.policy && p2.data.policy.mode === 'off');
} catch (err) {
  check('run completed without an unexpected error', false, String(err && err.message ? err.message : err));
}
const failed = checks.filter((c) => !c.ok).length;
console.log(JSON.stringify({ run: RUN, base: BASE, evidence_label: 'HOSTED SYNTHETIC, rewards OFF (isolated preview, API level; not staff-console browser acceptance)', passed: checks.length - failed, failed, checks }, null, 2));
process.exitCode = failed ? 1 : 0;
