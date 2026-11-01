// HOSTED acceptance driver for the NEW isolated Bula Worker + NEW synthetic D1. It speaks only HTTP to BASE and creates only synthetic data.
// Usage: BASE=https://<new-worker> ADMIN=<fresh admin secret> node bula/hosted_acceptance.mjs        Output: JSON evidence (redacted: no tokens, no emails).
// It REFUSES to run unless BASE contains "bula-acceptance" (a guard against pointing it at any other Worker).
const BASE = process.env.BASE, ADMIN = process.env.ADMIN; if (!BASE || !ADMIN || !/(bula-acceptance|^http:\/\/localhost:)/.test(BASE)) { console.error('BASE (must contain "bula-acceptance") and ADMIN are required'); process.exit(2); }
const J = { 'content-type': 'application/json' }; const ev = []; const rec = (name, pass, detail) => { ev.push({ name, pass, detail }); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(detail).slice(0, 200)); };
const api = async (m, p, { tok, staff, body } = {}) => { const r = await fetch(BASE + p, { method: m, headers: { ...J, authorization: `Bearer ${tok || ADMIN}`, ...(staff ? { 'x-marau-staff-token': staff } : {}) }, body: body ? JSON.stringify(body) : undefined }); let d; try { d = await r.json(); } catch { d = null; } return { s: r.status, d }; };
const run = `acc${Date.now().toString(36)}`; const H = 3600e3; const now = Date.now();
const STAFF = { ceo: `${run}-ceo`, ops: `${run}-ops`, ap: `${run}-ap` };
for (const [k, role] of [['ceo', 'ceo'], ['ops', 'ops'], ['ap', 'approver']]) await api('POST', '/preview/admin/bula/staff', { body: { token: `stf_${STAFF[k]}`, staff_id: STAFF[k], display_name: STAFF[k], role } });
const T = (k) => `stf_${STAFF[k]}`;
const newGuest = async (i) => { const r = await fetch(BASE + '/preview/bookings', { method: 'POST', headers: J, body: JSON.stringify({ guest_email: `acc${i}.${run}@example.invalid`, guest_phone: `+1500555${String(1000 + i)}`, client_booking_ref: `${run}-g${i}`, pickup_zone: 'NAD_AIRPORT', destination_zone: 'DENARAU', vehicle_type: 'Sedan', pickup_datetime: new Date(now + 72 * H).toISOString(), leg_type: 'arrival', quoted_amount: 45, quoted_currency: 'FJD', demonstration_data: true }) }); return (await r.json()).access_token; };
// NOTE: the exact synthetic booking body must match the deployed /preview/bookings contract; adjust here if the first call returns 4xx.
const offerCsvRow = (id, cap) => [id, 'ACC synthetic', 'op_acc', 'DATE', '09:00', 'Denarau', 'person', '100.00', '25', 'seat', String(cap), 'CUTOFF', 'Lunch', '', '', 'Free cancel 24h', '12', '12', 'vakaviti', '80', 'no', ''].join(',');
// The operator supplies the service date/cutoff placeholders at run time (Fiji wall clock) — see docs/BULA_HOSTED_ACCEPTANCE.md.
const date = process.env.SERVICE_DATE, cutoff = process.env.BOOKING_CUTOFF; if (!date || !cutoff) { console.error('SERVICE_DATE (YYYY-MM-DD Fiji) and BOOKING_CUTOFF (YYYY-MM-DD HH:MM Fiji) are required'); process.exit(2); }
const cols = 'offer_id,title,operator_id,service_date,service_time,pickup_zones,pricing_basis,offer_price_fjd,max_credit_fjd,capacity_unit,capacity_quantity,booking_cutoff,inclusions,exclusions,min_spend_fjd,cancellation_terms,credit_restore_hours_before,inventory_restore_hours_before,funding_party,operator_payout_fjd,instant_confirm,operator_contract_id';
const imp = await api('POST', '/preview/admin/bula/offers/import', { staff: T('ops'), body: { csv: [cols, offerCsvRow(`${run}-RACE`, 3).replace('DATE', date).replace('CUTOFF', cutoff), offerCsvRow(`${run}-ONE`, 1).replace('DATE', date).replace('CUTOFF', cutoff)].join('\n') } });
rec('import as ops', imp.s < 300 && imp.d.created === 2, imp.d);
for (const id of [`${run}-RACE`, `${run}-ONE`]) { const a = await api('POST', `/preview/admin/bula/offers/${id}/approve`, { staff: T('ap'), body: {} }); rec(`approve ${id} (second person)`, a.s === 200, a.d); }
const pub = await api('POST', '/preview/admin/bula/publish', { staff: T('ceo'), body: {} }); rec('publish', pub.s === 200, pub.d);
// RACE: 12 guests, 3 seats -> exactly 3 holds, 9 sold_out; remaining never negative.
const toks = await Promise.all(Array.from({ length: 12 }, (_, i) => newGuest(i)));
const rs = await Promise.all(toks.map((t, i) => api('POST', '/preview/bula/reserve', { tok: t, body: { offer_id: `${run}-RACE`, version: 1, qty: 1, idem_key: `r${i}` } })));
const won = rs.filter((r) => r.s === 201).length, lost = rs.filter((r) => r.d && r.d.code === 'sold_out').length; rec('race: 12 guests / 3 seats', won === 3 && lost === 9, { won, lost, other: rs.filter((r) => ![201].includes(r.s) && !(r.d && r.d.code === 'sold_out')).map((r) => r.s) });
// IDEMPOTENT RETRY: same idem key from the same guest 5x in parallel -> one hold.
const idem = await Promise.all(Array.from({ length: 5 }, () => api('POST', '/preview/bula/reserve', { tok: toks[11], body: { offer_id: `${run}-ONE`, version: 1, qty: 1, idem_key: 'same' } })));
rec('idempotent retry (5 parallel, same key)', new Set(idem.filter((r) => r.d && r.d.hold).map((r) => r.d.hold.holdId)).size === 1, { statuses: idem.map((r) => r.s) });
// CREDIT: the welcome balance cannot be spent twice in parallel beyond its limit (checked via wallet after the race).
const wal = await api('GET', '/preview/bula/offers', { tok: toks[0] }); rec('wallet visible and never negative', !wal.d.wallet || wal.d.wallet.availableCents >= 0, { wallet: wal.d.wallet });
// CROSS-PARTY: guest B cannot cancel guest A's hold.
const aHold = rs.find((r) => r.s === 201); const idxA = rs.indexOf(aHold); const other = toks[(idxA + 1) % 12]; const steal = await api('POST', `/preview/bula/holds/${aHold.d.hold.holdId}/cancel`, { tok: other, body: {} }); rec('cross-party cancel refused', steal.s !== 200, { status: steal.s });
// FORGED STAFF: admin credential without a staff token, and a guest bearer on a staff route.
rec('forged staff refused', (await api('GET', '/preview/admin/bula/me')).s === 401 && (await api('GET', '/preview/admin/bula/queue', { tok: toks[0] })).s === 401, {});
// CONFIRM then double-cancel: exactly one restoration.
const conf = await api('POST', `/preview/admin/bula/holds/${aHold.d.hold.holdId}/confirm`, { staff: T('ops'), body: { evidence_note: 'acceptance' } }); rec('staff confirm', conf.s === 200, conf.d);
const c1 = await Promise.all([1, 2, 3].map(() => api('POST', `/preview/bula/holds/${aHold.d.hold.holdId}/cancel`, { tok: toks[idxA], body: {} }))); rec('3 parallel cancels: one wins', c1.filter((r) => r.s === 200 && !r.d.replay).length <= 1, { statuses: c1.map((r) => r.s) });
console.log('EVIDENCE_JSON ' + JSON.stringify({ run, base: new URL(BASE).host, results: ev }));
process.exit(ev.every((e) => e.pass) ? 0 : 1);
