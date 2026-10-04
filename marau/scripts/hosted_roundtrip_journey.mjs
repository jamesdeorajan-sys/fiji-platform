/* Marau - HOSTED SYNTHETIC round-trip + pilot journey, run against an ISOLATED PREVIEW Worker/D1 only (API level, no database access).
 *
 *   node scripts/hosted_roundtrip_journey.mjs <preview base url> <admin test token>
 *
 * One synthetic SOURCE booking holding arrival AND return (the real `bookings` schema's field names) is synced through the preview's
 * synthetic source; Marau must show two legs, refuse a credit with RETURN_VALUE_UNRESOLVED until a rule is approved, apply a referral
 * credit only to the return, keep one booking balance, survive repeated sync/edits/cancellation, and keep demonstration data marked.
 * It also drives the human-led deals pilot (review, availability, recipients, manual outcome log) - nothing is sent.
 * Leaves rewards OFF. Prints one JSON object of named checks; exit 1 if any fails.
 */
const [BASE, ADMIN] = process.argv.slice(2);
if (!BASE || !ADMIN) { console.error('usage: node scripts/hosted_roundtrip_journey.mjs <base url> <admin test token>'); process.exit(2); }
const RUN = Date.now().toString(36);
const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), ...(detail !== undefined ? { detail } : {}) });
const api = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const r = await fetch(BASE + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d, text: t };
};
const A = { authorization: `Bearer ${ADMIN}` };
const ANA = `rt-ana-${RUN}`; const BALA = `rt-bala-${RUN}`;
const S = (t) => ({ ...A, 'x-marau-staff-token': t });
const G = (t) => ({ authorization: `Bearer ${t}` });
const inDays = (d, h = 0) => new Date(Date.now() + d * 86400_000 + h * 3600_000).toISOString();
const day = (d) => inDays(d).slice(0, 10);
let srcN = 0;
const SRC_ID = Number(String(Date.now()).slice(-7)) * 10;
const sourceBody = (over = {}) => { srcN += 1; return { source_booking_ref: String(SRC_ID + srcN), id: SRC_ID + srcN, guest_email: `rt.${RUN}.${srcN}@example.test`, guest_phone: `+1500556${String(Math.floor(1000 + Math.random() * 8999))}`, pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan', pickup_date: day(3), pickup_time: '09:00', quoted_amount: 170, quoted_currency: 'FJD', settlement_amount_fjd: 150, commission_base_fjd: 20, status: 'accepted', assigned_driver_id: '3', return_date: day(10), return_time: '10:30', return_pickup_location: 'Sofitel Denarau lobby', ...over }; };
let evId = 0;
const seed = (b) => api('/preview/admin/synthetic-source', { method: 'POST', headers: A, body: b });
const sync = (b, type = 'accepted', status = 'accepted') => api(`/preview/admin/synthetic-source/${b.source_booking_ref}/sync-event`, { method: 'POST', headers: A, body: { event_type: type, new_status: status, source_event_id: Date.now() % 1_000_000_000 + (++evId), booking_id: b.id } });
const trip = async (token) => (await api('/preview/trip', { headers: G(token) })).data;
const legsOf = (t) => Object.fromEntries(t.bookings.filter((b) => b.leg_key).map((b) => [b.leg_key, b]));

try {
  await api('/preview/admin/staff-identities', { method: 'POST', headers: A, body: { token: ANA, operator_name: `Ana (roundtrip ${RUN})` } });
  await api('/preview/admin/staff-identities', { method: 'POST', headers: A, body: { token: BALA, operator_name: `Bala (roundtrip ${RUN})` } });
  await api('/preview/admin/rewards/policy', { method: 'POST', headers: S(ANA), body: { mode: 'preview', amount_fjd: 10, cap_per_referrer_fjd: 20, min_purchase_fjd: 0, qualify_on: 'fulfilled', require_payment: 'paid_in_full', funding_source: 'synthetic_test_budget' } });
  const sup = await api('/preview/admin/suppliers', { method: 'POST', headers: S(ANA), body: { name: `Synthetic Reef Tours ${RUN}`, fulfilment_owner: `Ana (roundtrip ${RUN})` } });
  await api(`/preview/admin/suppliers/${sup.data.supplier_id}/verify`, { method: 'POST', headers: S(ANA) });
  const mkOffer = async (title, cap = 20) => { const o = await api('/preview/admin/offers', { method: 'POST', headers: S(ANA), body: { supplier_id: sup.data.supplier_id, title: `${title} ${RUN}`, location: 'Mamanuca reef (synthetic)', inclusions: ['boat'], starts_at: inDays(6), book_by: inDays(5), expires_at: inDays(5, 12), capacity: cap, price_per_place_fjd: 120, cost_per_place_fjd: 80 } }); await api(`/preview/admin/offers/${o.data.offer_id}/publish`, { method: 'POST', headers: S(ANA) }); return o.data.offer_id; };
  const offer = await mkOffer('Synthetic snorkel');
  // the preview DB is shared across runs: start with NO approved allocation rule (retire any left by an earlier run)
  for (const r of (await api('/preview/admin/rewards/allocation-rules', { headers: S(ANA) })).data.rules.filter((x) => x.status === 'approved')) await api(`/preview/admin/rewards/allocation-rules/${r.rule_id}/retire`, { method: 'POST', headers: S(ANA), body: { note: 'reset before a hosted run' } });

  // ---- 1. one source booking -> two legs
  const b1 = sourceBody();
  check('synthetic source seeded with the REAL schema field names', (await seed(b1)).status === 200);
  const s1 = await sync(b1, 'created');
  check('sync creates the mirror', s1.status === 200 && s1.data.created === true, s1.data);
  const token = s1.data.session.access_token;
  let t = await trip(token); let L = legsOf(t);
  check('the guest\'s trip holds BOTH legs of the one source booking', t.bookings.length === 2 && L.arrival && L.return && L.arrival.guest_session_id === L.return.guest_session_id);
  check('dates, locations and status preserved; the return pickup is the RECORDED location', L.return.pickup_zone === 'Sofitel Denarau lobby' && L.return.pickup_basis === 'recorded' && L.arrival.pickup_zone === 'Nadi Airport' && L.return.status === 'confirmed' && L.arrival.status === 'confirmed');
  check('the return leg is NOT given the whole quote or a share: value unresolved', L.return.leg_value_status === 'unresolved' && L.return.leg_value_cents == null && L.arrival.source_total_cents === 17000 && L.return.source_total_cents === 17000);
  check('guest trip carries NO operator-side figures or provenance', !/settlement|commission|nadi_dispatch|source_kind|source_origin|source_authenticated/.test(JSON.stringify(t)));
  for (let i = 0; i < 3; i += 1) await sync(b1);
  check('repeated sync does not duplicate legs', (await trip(token)).bookings.length === 2);

  // ---- 2. referral purchase -> credit; unresolved value refuses; rule approval resolves
  const code = (await api('/preview/referral', { headers: G(token) })).data.code;
  const friend = await api('/preview/bookings', { method: 'POST', body: { guest_email: `rt.friend.${RUN}@example.test`, guest_phone: `+1500557${String(Math.floor(1000 + Math.random() * 8999))}`, whatsapp_available: true, pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'Sedan', quoted_amount: 80, pickup_datetime: inDays(2).slice(0, 16), referral_code: code } });
  const rid = (await api(`/preview/offers/${offer}/request`, { method: 'POST', headers: G(friend.data.access_token), body: { places: 1 } })).data.request.request_id;
  const act = (a, b = {}) => api(`/preview/admin/offers/requests/${rid}/${a}`, { method: 'POST', headers: S(ANA), body: b });
  await act('confirm'); await act('payment', { event: 'paid', amount_fjd: 120, method: 'cash', event_key: `rt-${RUN}` }); await act('fulfil');
  // the preview DB is shared across runs: pick THIS run's guest's credit by its holder, never someone else's
  let credits = (await api('/preview/admin/rewards/credits', { headers: S(ANA) })).data.credits.filter((c) => c.status === 'earned' && c.holder.email === b1.guest_email);
  const credit = credits[0];
  check('a qualifying referred purchase earns exactly one credit for the source-booking guest', credits.length === 1);
  const apply = (bookingId, tok = ANA) => api(`/preview/admin/rewards/credits/${credit.credit_id}/apply`, { method: 'POST', headers: S(tok), body: { booking_id: bookingId } });
  const noRule = await apply(L.return.id);
  check('RETURN_VALUE_UNRESOLVED: no approved allocation rule -> refused, credit stays earned', noRule.status === 409 && noRule.data.error === 'RETURN_VALUE_UNRESOLVED');
  const target = credit.eligible_return_transfers.find((x) => x.booking_id === L.return.id);
  check('staff listing shows the return as a target with NO invented fare, and the source total/settlement preserved', target && target.return_value_status === 'RETURN_VALUE_UNRESOLVED' && target.original_fare_fjd === null && target.source_total_fjd === 170 && target.source_settlement_fjd === 150);
  check('the arrival leg is never a credit target', (await apply(L.arrival.id)).data.error === 'NOT_AN_ELIGIBLE_RETURN_TRANSFER');
  const rule = await api('/preview/admin/rewards/allocation-rules', { method: 'POST', headers: S(ANA), body: { kind: 'percent_of_total', percent: 40 } });
  check('a PROPOSED rule changes nothing', rule.status === 201 && (await apply(L.return.id)).data.error === 'RETURN_VALUE_UNRESOLVED');
  const approved = await api(`/preview/admin/rewards/allocation-rules/${rule.data.rule.rule_id}/approve`, { method: 'POST', headers: S(BALA), body: { note: 'synthetic hosted rule', approval_basis: 'owner' } });
  check('approval is attributed and can only be a synthetic-preview approval (owner basis ignored)', approved.status === 200 && approved.data.rule.approved_by === `Bala (roundtrip ${RUN})` && approved.data.rule.approval_basis === 'synthetic_preview');
  const applied = await apply(L.return.id);
  check('credit applies ONLY to the return: booking total 170, credit 10, amount due 160; return value allocated 68', applied.status === 200 && applied.data.fare.booking_total_fjd === 170 && applied.data.fare.referral_credit_fjd === 10 && applied.data.fare.amount_due_fjd === 160 && applied.data.fare.return_value.value_fjd === 68);
  t = await trip(token); L = legsOf(t);
  check('one booking balance, identical from both legs; operator payout unchanged', L.arrival.fare.amount_due_fjd === 160 && L.return.fare.amount_due_fjd === 160 && L.return.fare.operator_payout_unchanged === true);

  // ---- 3. repeated sync, source edits, return cancelled
  for (let i = 0; i < 3; i += 1) await sync(b1);
  t = await trip(token); L = legsOf(t);
  check('repeated sync after application: still two legs, same balance, no second adjustment', t.bookings.length === 2 && L.return.fare.adjustments.length === 1 && L.return.fare.amount_due_fjd === 160);
  const retBefore = L.return;
  await seed({ ...b1, return_time: '17:00' }); await sync(b1);
  t = await trip(token); L = legsOf(t);
  check('a source edit to the return time reaches the SAME return leg (same id, new time); the credit stays', L.return.id === retBefore.id && L.return.pickup_datetime !== retBefore.pickup_datetime && L.return.fare.referral_credit_fjd === 10, [retBefore.pickup_datetime, L.return.pickup_datetime]);
  await seed({ ...b1, return_date: null, return_time: null, return_pickup_location: null }); await sync(b1);
  await api('/preview/admin/rewards/credits', { headers: S(ANA) });
  t = await trip(token); L = legsOf(t);
  check('return removed at the source: the SAME return leg is cancelled, arrival intact, credit released, balance back to the full total', L.return.status === 'cancelled' && L.arrival.status === 'confirmed' && L.arrival.return_leg_state === 'missing_return_details' && L.arrival.fare.amount_due_fjd === 170);

  // ---- 4. arrival already completed; missing return details; source cancellation
  const b2 = sourceBody(); await seed(b2); const s2 = await sync(b2, 'created');
  await seed({ ...b2, status: 'completed' }); await sync(b2, 'completed', 'completed');
  const L2 = legsOf(await trip(s2.data.session.access_token));
  check('ARRIVAL COMPLETED: the upcoming return is still a live leg (assumption recorded)', L2.return.status === 'confirmed' && L2.arrival.source_status === 'completed');
  const b3 = sourceBody({ return_time: null }); await seed(b3); const s3 = await sync(b3, 'created');
  const t3 = await trip(s3.data.session.access_token);
  check('MISSING RETURN DETAILS: no return leg is invented; the arrival says so', t3.bookings.length === 1 && t3.bookings[0].return_leg_state === 'missing_return_details');
  await seed({ ...b2, status: 'cancelled' }); await sync(b2, 'cancelled', 'cancelled');
  check('SOURCE CANCELLATION cancels the return leg too', legsOf(await trip(s2.data.session.access_token)).return.status === 'cancelled');

  // ---- 5. provenance
  const prov = await api(`/preview/admin/synthetic-source/${b1.source_booking_ref}`, { headers: A });
  check('demonstration provenance: the preview mirrors from the SYNTHETIC source (test_data = 1, not authenticated)', prov.status === 200 && prov.data.mirror && prov.data.mirror.test_data === 1 && prov.data.mirror.source_kind === 'synthetic' && prov.data.mirror.source_authenticated === 0);

  // ---- 6. the human-led deals pilot
  const offer2 = await mkOffer('Synthetic sunset', 1);
  // unique per run (the preview DB is shared)
  const edDate = new Date(Date.UTC(2032, 0, 1) + (parseInt(RUN, 36) % 3000) * 86400000).toISOString().slice(0, 10); const edId = `${edDate}:morning`; const E = encodeURIComponent(edId);
  await api('/preview/admin/editions', { method: 'POST', headers: S(ANA), body: { fiji_date: edDate, slot: 'morning', offer_ids: [offer, offer2] } });
  await api(`/preview/admin/editions/${E}/publish`, { method: 'POST', headers: S(ANA) });
  const rcpt = await api('/preview/bookings', { method: 'POST', body: { guest_email: `rt.rcpt.${RUN}@example.test`, guest_phone: `+1500558${String(Math.floor(1000 + Math.random() * 8999))}`, whatsapp_available: true, pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'Sedan', quoted_amount: 80, pickup_datetime: inDays(2).slice(0, 16) } });
  await api('/preview/trip/contact', { method: 'POST', headers: G(rcpt.data.access_token), body: { marketing_consent: 'granted' } });
  const rv = await api(`/preview/admin/editions/${E}/review`, { headers: S(ANA) });
  const mine = rv.data.recipients.find((r) => r.contact.email === `rt.rcpt.${RUN}@example.test`);
  check('PILOT review: live offer availability and consent-eligible recipients, nothing sent', rv.status === 200 && rv.data.nothing_was_sent === true && rv.data.sendable_offers.length === 2 && Boolean(mine));
  check('PILOT: prepare is refused before a review', (await api(`/preview/admin/editions/${E}/sends/prepare`, { method: 'POST', headers: S(ANA), body: {} })).data.error === 'EDITION_NOT_REVIEWED');
  const rec = await api(`/preview/admin/editions/${E}/review`, { method: 'POST', headers: S(BALA), body: { decision: 'approved_for_manual_send', note: 'checked' } });
  const prep = await api(`/preview/admin/editions/${E}/sends/prepare`, { method: 'POST', headers: S(ANA), body: {} });
  check('PILOT: review recorded by a named staff member; recipients prepared; nothing sent', rec.status === 200 && rec.data.review.reviewed_by === `Bala (roundtrip ${RUN})` && prep.status === 200 && prep.data.prepared >= 1 && prep.data.nothing_was_sent === true);
  const out = (status, tok = ANA) => api(`/preview/admin/editions/${E}/sends/${mine.session_id}/outcome`, { method: 'POST', headers: S(tok), body: { status, note: 'recorded by hand' } });
  const sent = await out('sent_manually'); const dup = await out('sent_manually', BALA); const reply = await out('replied');
  check('PILOT: manual send then reply recorded, idempotent, original operator kept', sent.status === 200 && dup.data.repeated === true && dup.data.send.updated_by === `Ana (roundtrip ${RUN})` && reply.data.send.status === 'replied');
  await api('/preview/trip/contact', { method: 'POST', headers: G(rcpt.data.access_token), body: { marketing_consent: 'withheld' } });
  const after = await api(`/preview/admin/editions/${E}/review`, { headers: S(ANA) });
  check('PILOT: a guest who withdrew consent drops out of the recipient list', !after.data.recipients.some((r) => r.session_id === mine.session_id));
  check('PILOT: no guest can read it', (await api(`/preview/admin/editions/${E}/sends`, { headers: G(rcpt.data.access_token) })).status === 401);
} catch (err) {
  check('journey completed without an unexpected error', false, String(err && err.stack ? err.stack : err));
} finally {
  await api('/preview/admin/rewards/policy', { method: 'POST', headers: S(ANA), body: { mode: 'off' } }).catch(() => {});
  const p = await api('/preview/admin/rewards/policy', { headers: S(ANA) }).catch(() => null);
  check('rewards left OFF at the end', p && p.data.policy && p.data.policy.mode === 'off');
}
const failed = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ run: RUN, base: BASE, evidence_label: 'HOSTED SYNTHETIC (isolated preview)', passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);
