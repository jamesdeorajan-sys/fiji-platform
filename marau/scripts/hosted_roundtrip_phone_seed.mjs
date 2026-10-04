/* Seeds TWO SYNTHETIC round-trip guests on the ISOLATED legs preview for the physical-phone checklist, and writes their PRIVATE trip
 * links to a local file you name (outside the repository). The links are never printed. Rewards stay OFF.
 *   node scripts/hosted_roundtrip_phone_seed.mjs <base url> <admin test token> <out file>
 */
import fs from 'node:fs';
const [BASE, ADMIN, OUT] = process.argv.slice(2);
if (!BASE || !ADMIN || !OUT) { console.error('usage: <base> <admin token> <out file>'); process.exit(2); }
const RUN = Date.now().toString(36); const A = { authorization: `Bearer ${ADMIN}` };
const api = async (p, { method = 'GET', body } = {}) => { const r = await fetch(BASE + p, { method, headers: { ...A, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json().catch(() => null) }; };
const day = (d) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
const base = Number(String(Date.now()).slice(-7)) * 10 + 500;
const mk = (n, over) => ({ source_booking_ref: String(base + n), id: base + n, guest_email: `phone.rt${n}.${RUN}@example.test`, guest_phone: `+1500560${String(1000 + Math.floor(Math.random() * 8999))}`, pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan', pickup_date: day(2), pickup_time: '09:00', quoted_amount: 170, quoted_currency: 'FJD', settlement_amount_fjd: 150, commission_base_fjd: 20, status: 'accepted', assigned_driver_id: '3', return_date: day(9), return_time: '10:30', return_pickup_location: 'Sofitel Denarau lobby', ...over });
const out = {};
for (const [label, n, over, completed] of [['A_normal_round_trip', 1, {}, false], ['B_arrival_completed_return_upcoming', 2, {}, true]]) {
  const b = mk(n, over);
  await api('/preview/admin/synthetic-source', { method: 'POST', body: b });
  const ev = (type, status) => api(`/preview/admin/synthetic-source/${b.source_booking_ref}/sync-event`, { method: 'POST', body: { event_type: type, new_status: status, source_event_id: Date.now() % 1_000_000_000 + n, booking_id: b.id } });
  const s = await ev('created', 'accepted');
  if (completed) { await api('/preview/admin/synthetic-source', { method: 'POST', body: { ...b, status: 'completed' } }); await ev('completed', 'completed'); }
  out[label] = `${BASE}/#tok=${s.data.session.access_token}`;
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log('seeded', Object.keys(out).join(', '), '- links written to the named file (not printed)');
