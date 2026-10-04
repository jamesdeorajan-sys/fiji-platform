/* Acceptance-operator credentials for the hosted staff-console check - SYNTHETIC, isolated preview only. No product behaviour is
 * changed: this only calls routes that already exist.
 *
 *   seed      ADMIN_TOKEN=... node scripts/staff_acceptance_credentials.mjs seed <base url> <private out file>
 *               creates TWO named, individual staff identities (random tokens) and TWO synthetic guests (one with marketing consent
 *               granted and WhatsApp; one with neither, so it lands in the staff attention queue), and writes every secret to <private out file> (outside the repository). Nothing secret is
 *               printed.
 *   teardown  ADMIN_TOKEN=... node scripts/staff_acceptance_credentials.mjs teardown <base url> <private out file> [--staff-deleted]
 *               revokes ONLY the guest links this run created and verifies each now answers 401. With --staff-deleted (after the
 *               staff-identity rows were removed with the exact D1 command it prints) it also verifies the staff tokens are refused.
 *               It never touches the shared admin token, any other staff identity, or any other record.
 *
 * The shared admin token is read from the ADMIN_TOKEN environment variable (not argv) so it stays out of process listings.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const [MODE, BASE, OUT, FLAG] = process.argv.slice(2);
const ADMIN = process.env.ADMIN_TOKEN;
if (!['seed', 'teardown'].includes(MODE) || !BASE || !OUT || !ADMIN) {
  console.error('usage: ADMIN_TOKEN=... node scripts/staff_acceptance_credentials.mjs <seed|teardown> <base url> <private out file> [--staff-deleted]');
  process.exit(2);
}
const api = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const r = await fetch(BASE + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
};
const A = { authorization: `Bearer ${ADMIN}` };
const rand = (n = 24) => crypto.randomBytes(n).toString('base64url');

if (MODE === 'seed') {
  if (fs.existsSync(OUT)) { console.error('refusing to overwrite an existing private file'); process.exit(2); }
  const run = Date.now().toString(36);
  const staff = [
    { role: 'preparer', operator_name: `Acceptance Operator A (${run})`, token: `acc-${rand()}` },
    { role: 'reviewer', operator_name: `Acceptance Operator B (${run})`, token: `acc-${rand()}` },
  ];
  for (const s of staff) {
    const r = await api('/preview/admin/staff-identities', { method: 'POST', headers: A, body: { token: s.token, operator_name: s.operator_name } });
    if (r.status !== 200) { console.error(`staff identity seed failed (${r.status})`); process.exit(1); }
  }
  const when = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 16);
  const guests = [];
  for (const [label, consent] of [['recipient_with_consent', 'granted'], ['recipient_without_consent', null]]) {
    const n = guests.length + 1;
    const body = { guest_email: `acceptance.${run}.${n}@example.test`, guest_phone: `+1500561${String(1000 + Math.floor(Math.random() * 8999))}`, whatsapp_available: consent ? true : false, pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'Sedan', quoted_amount: 80, leg_type: 'arrival', pickup_datetime: when };
    const r = await api('/preview/bookings', { method: 'POST', body });
    if (r.status !== 201) { console.error(`guest seed failed (${r.status})`); process.exit(1); }
    if (consent) await api('/preview/trip/contact', { method: 'POST', headers: { authorization: `Bearer ${r.data.access_token}` }, body: { marketing_consent: consent } });
    guests.push({ label, email: body.guest_email, guest_link: `${BASE}/#tok=${r.data.access_token}`, guest_token: r.data.access_token });
  }
  fs.writeFileSync(OUT, JSON.stringify({ run, base: BASE, staff, guests, note: 'SYNTHETIC. Private: never commit, screenshot or paste in chat.' }, null, 2), { mode: 0o600 });
  console.log(`seeded run ${run}: ${staff.length} staff identities, ${guests.length} synthetic guests. Secrets written to the private file (not printed).`);
  console.log('Staff-identity cleanup (run AFTER acceptance, removes only these rows):');
  for (const s of staff) console.log(`  wrangler d1 execute marau-stage1-legs-db --remote --command "DELETE FROM marau_staff_identities WHERE operator_name = '${s.operator_name}'"`);
}

if (MODE === 'teardown') {
  const f = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  let ok = true;
  const say = (label, pass) => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`); if (!pass) ok = false; };
  for (const g of f.guests) {
    await api('/preview/trip/revoke', { method: 'POST', headers: { authorization: `Bearer ${g.guest_token}` } });
    say(`guest link "${g.label}" revoked (now 401)`, (await api('/preview/trip', { headers: { authorization: `Bearer ${g.guest_token}` } })).status === 401);
  }
  if (FLAG === '--staff-deleted') {
    for (const s of f.staff) {
      const r = await api('/preview/admin/rewards/allocation-rules', { headers: { ...A, 'x-marau-staff-token': s.token } });
      say(`staff identity "${s.operator_name}" refused (401)`, r.status === 401);
    }
  } else {
    console.log('INFO  staff identities not yet checked: delete the rows with the printed D1 command, then re-run with --staff-deleted');
  }
  process.exitCode = ok ? 0 : 1;
}
