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
if (!['seed', 'teardown', 'change-return'].includes(MODE) || !BASE || !OUT || !ADMIN) {
  console.error('usage: ADMIN_TOKEN=... node scripts/staff_acceptance_credentials.mjs <seed|teardown|change-return> <base url> <private out file> [--staff-deleted]');
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
  // Fixture 3 (RC4): a synthetic round trip whose source says 'completed' while the return is still ahead - the uncertain-return item.
  const srcId = Number(String(Date.now()).slice(-7)) * 10 + 3;
  const day = (d) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
  const sb = { source_booking_ref: String(srcId), id: srcId, guest_email: `acceptance.${run}.uncertain@example.test`, guest_phone: `+1500563${String(1000 + Math.floor(Math.random() * 8999))}`, whatsapp_available: true, pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'Sedan', quoted_amount: 170, quoted_currency: 'FJD', settlement_amount_fjd: 150, commission_base_fjd: 20, assigned_driver_id: null, pickup_date: day(3), pickup_time: '09:00', return_date: day(10), return_time: '10:30', return_pickup_location: 'Sofitel Denarau lobby', status: 'accepted' };
  let evn = Date.now() % 1_000_000_000;
  const ev = (type, status) => api(`/preview/admin/synthetic-source/${sb.source_booking_ref}/sync-event`, { method: 'POST', headers: A, body: { event_type: type, new_status: status, source_event_id: ++evn, booking_id: sb.id } });
  await api('/preview/admin/synthetic-source', { method: 'POST', headers: A, body: sb });
  const created = await ev('created', 'accepted');
  await api('/preview/admin/synthetic-source', { method: 'POST', headers: A, body: { ...sb, status: 'completed' } });
  await ev('completed', 'completed');
  if (!created.data || !created.data.session) { console.error('uncertain-return fixture seed failed'); process.exit(1); }
  guests.push({ label: 'uncertain_return', email: sb.guest_email, guest_link: `${BASE}/#tok=${created.data.session.access_token}`, guest_token: created.data.session.access_token });
  // VERIFY that the fixtures really exist on THIS host (a seed that did not verify them is only a plan).
  const S0 = { ...A, 'x-marau-staff-token': staff[0].token };
  const queue = (await api('/preview/admin/guests?attention=1', { headers: S0 })).data.guests || [];
  const verified = [
    ['staff identity A accepted', (await api('/preview/admin/rewards/policy', { headers: S0 })).status === 200],
    ['staff identity B accepted', (await api('/preview/admin/rewards/policy', { headers: { ...A, 'x-marau-staff-token': staff[1].token } })).status === 200],
    ['rewards policy is OFF', ((await api('/preview/admin/rewards/policy', { headers: S0 })).data.policy || {}).mode === 'off'],
    ...(await Promise.all(guests.map(async (g) => [`guest "${g.label}" link works`, (await api('/preview/trip', { headers: { authorization: `Bearer ${g.guest_token}` } })).status === 200]))),
    ['"recipient_without_consent" is in Needs attention (no WhatsApp, no owner)', queue.some((q) => q.contact.email === guests[1].email && q.attention.includes('no_whatsapp_and_no_named_owner'))],
    ['"uncertain_return" is in Needs attention as an uncertain return', queue.some((q) => q.contact.email === sb.guest_email && q.attention.includes('return_status_needs_verification'))],
    ['"recipient_with_consent" is NOT in Needs attention', !queue.some((q) => q.contact.email === guests[0].email)],
  ];
  const bad = verified.filter(([, ok]) => !ok);
  for (const [label, ok] of verified) console.log(`${ok ? 'VERIFIED' : 'FAILED  '} ${label}`);
  if (bad.length) console.error(`${bad.length} fixture(s) NOT verified on ${BASE}: do not hand these to an operator`);
  fs.writeFileSync(OUT, JSON.stringify({ run, base: BASE, staff, guests, uncertain_source: sb, note: 'SYNTHETIC. Private: never commit, screenshot or paste in chat.', fixtures_verified: bad.length === 0 }, null, 2), { mode: 0o600 });
  if (bad.length) process.exitCode = 1;
  console.log(`seeded run ${run}: ${staff.length} staff identities, ${guests.length} synthetic guests. Secrets written to the private file (not printed).`);
  console.log('Staff-identity cleanup (run AFTER acceptance, removes only these two rows, in ONE command):');
  console.log(`  wrangler d1 execute marau-stage1-legs-db --remote --command "DELETE FROM marau_staff_identities WHERE operator_name IN (${staff.map((x) => "'" + x.operator_name + "'").join(', ')})"`);
  console.log('  (keep the private file until the --staff-deleted check below has run)');
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

if (MODE === 'change-return') {
  // Engineer-assisted: moves the synthetic source's return time, so a staff verification made earlier is INVALIDATED and the item re-opens.
  const f = JSON.parse(fs.readFileSync(OUT, 'utf8')); const sb = f.uncertain_source;
  await api('/preview/admin/synthetic-source', { method: 'POST', headers: A, body: { ...sb, status: 'completed', return_time: '16:00' } });
  const r = await api(`/preview/admin/synthetic-source/${sb.source_booking_ref}/sync-event`, { method: 'POST', headers: A, body: { event_type: 'completed', new_status: 'completed', source_event_id: (Date.now() % 1_000_000_000) + 7, booking_id: sb.id } });
  console.log(r.status === 200 ? 'synthetic source return time moved to 16:00; refresh Needs attention: the return should be listed again' : `change failed (${r.status})`);
}
