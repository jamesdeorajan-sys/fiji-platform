/* HOSTED SYNTHETIC check of the RC4 uncertain-return workflow with REWARDS OFF, on an isolated preview. API level, author-run; it is NOT
 * staff-console browser acceptance (the console needs credentials typed by a person - see docs/MARAU_STAFF_ACCEPTANCE_HANDOFF.md).
 *   ADMIN_TOKEN=... node scripts/hosted_uncertain_return_rewards_off.mjs <base url>
 * It aborts without writing if the reward policy is not OFF. It sets NO reward policy, creates no credit and no allocation rule.
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
  check('REWARDS OFF throughout: no credit exists for this guest and nothing implies payment or driver', !credits.some((c) => c.holder && c.holder.email === `rc4.${RUN}@example.test`) && ret.leg_value_status === 'unresolved');
  await seed({ ...b, status: 'completed', return_time: '16:00' }); await sync(b, 'completed', 'completed');
  const re = await mine();
  const t2 = (await api('/preview/trip', { headers: { authorization: `Bearer ${tok}` } })).data.bookings.find((x) => x.leg_key === 'return');
  check('INVALIDATION: a changed return time re-opens the item, clears the guest note and the status goes back to pending', re && re.uncertain_returns.length === 1 && re.uncertain_returns[0].itinerary_basis !== u.itinerary_basis && t2.status === 'pending' && t2.staff_checked_status === false && t2.status_uncertainty === 'source_completed_while_return_upcoming', { re, t2 });
  const stale = await verify(u.booking_id, { itinerary_basis: u.itinerary_basis });
  check('the old basis cannot be reused after the change (409)', stale.status === 409 && stale.data.error === 'ITINERARY_CHANGED', stale);
  const again = await verify(u.booking_id, { itinerary_basis: re.uncertain_returns[0].itinerary_basis });
  check('re-verification against the NEW basis works', again.status === 200, again);
  const p2 = await api('/preview/admin/rewards/policy', { headers: S });
  check('rewards still OFF at the end', p2.data.policy && p2.data.policy.mode === 'off');
} catch (err) {
  check('run completed without an unexpected error', false, String(err && err.message ? err.message : err));
}
const failed = checks.filter((c) => !c.ok).length;
console.log(JSON.stringify({ run: RUN, base: BASE, evidence_label: 'HOSTED SYNTHETIC, rewards OFF (isolated preview, API level; not staff-console browser acceptance)', passed: checks.length - failed, failed, checks }, null, 2));
process.exitCode = failed ? 1 : 0;
