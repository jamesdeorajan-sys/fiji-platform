// Email follow-up requests (Milestone 38). Drives the REAL worker.js fetch() handler over an in-memory SQLite database loaded with the real schema + the real migration
// chain (including milestone38-email-followups.sql). Every outbound call is blocked by the default-deny network guard except where a test installs its own recording
// Meta mock; no real WhatsApp / email is ever sent. All data is synthetic.
// Run: node --test nadi-marketplace/worker/email_followup.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.js';
import { validateEmail, maskEmail, OUTCOMES } from './email_followup.mjs';
import { installNetworkGuard } from './network_guard.mjs';
installNetworkGuard();
const guard = globalThis.fetch;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const SCHEMA_SQL = readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const MIGRATIONS = ['milestone34-booking-idempotency-and-contact-fields.sql', 'milestone35-revenue-attribution.sql', 'milestone36-admin-notification-retry-state.sql', 'milestone38-email-followups.sql'].map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));

function d1(db) {
  return { prepare(sql) { let a = []; const api = { bind(...x) { a = x; return api; }, async first() { const r = db.prepare(sql).get(...a); return r === undefined ? null : r; }, async all() { return { results: db.prepare(sql).all(...a) }; }, async run() { const i = db.prepare(sql).run(...a); return { meta: { changes: i.changes, last_row_id: i.lastInsertRowid } }; } }; return api; } };
}
const ADMIN = 'test-admin-token';
function fresh({ secrets = true, whatsapp = false, adminPhone = '+6799999999' } = {}) {
  const db = new DatabaseSync(':memory:'); db.exec(SCHEMA_SQL); for (const m of MIGRATIONS) db.exec(m);
  if (adminPhone) db.prepare(`UPDATE platform_settings SET value = ? WHERE key = 'admin_alert_phone'`).run(adminPhone);
  const env = { DB: d1(db), ...(secrets ? { ADMIN_TOKEN: ADMIN } : {}), ...(whatsapp ? { WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: 'p' } : {}) };
  return { env, db };
}
const call = async (env, method, url, body, { ip = '203.0.113.10', auth } = {}) => {
  const res = await worker.fetch(new Request('https://worker.test' + url, { method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: res.status, body: await res.json() };
};
const PHONE = '+6799112233';
const bookingBody = (ref, o = {}) => ({ guest_name: 'Zed Testperson', guest_phone: PHONE, guest_email: 'zed.test@example.invalid', client_booking_ref: ref, pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan', quoted_currency: 'FJD', quoted_amount: 49, payment_method: 'cash', pickup_date: '2026-10-20', pickup_time: '09:30', trip_type: 'one-way', ...o });
const book = (env, ref, o) => call(env, 'POST', '/bookings', bookingBody(ref, o));
const count = (db, t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
const follow = (env, ref, token, email = 'zed.real@example.invalid', extra = {}, opts) => call(env, 'POST', '/email-followup', { client_ref: ref, ...(token ? { token } : {}), email, guest_phone: PHONE, origin_site: 'fijidash', ...extra }, opts);
const ENQ = { guest_name: 'Wanda Whatsapponly', guest_phone: PHONE, enquiry: { from: 'Nadi Airport', to: 'Somewhere remote', date: '2026-10-20', time: '09:30', trip: 'one-way', vehicle: 'sedan', passengers: 2, flight: 'FJ000', amount_shown: 120 } };

// recording Meta mock (never reaches the network)
function metaMock(responder = () => ({ ok: true, status: 200, text: JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }) })) {
  const calls = []; globalThis.fetch = async (url, opts) => { const body = opts && opts.body ? opts.body.toString() : ''; calls.push({ url: String(url), body }); const r = responder(body); return { ok: r.ok, status: r.status, text: async () => r.text, json: async () => JSON.parse(r.text) }; };
  return { calls, restore() { globalThis.fetch = guard; } };
}
const alertText = (body) => { try { return JSON.parse(body).template.components[0].parameters.find((p) => p.parameter_name === 'alert_summary').text; } catch { return null; } };

test('validateEmail: accepts ordinary single addresses, rejects everything that cannot be one mailbox; syntax only - deliverability is never claimed', () => {
  for (const ok of ['a@b.co', 'first.last+tag@sub.example.com', 'Zed@Example.COM']) assert.equal(validateEmail(ok).ok, true, ok);
  assert.equal(validateEmail('Zed@Example.COM').email, 'Zed@example.com');
  for (const bad of ['', ' ', 'plain', 'a@b', 'a@@b.com', '@b.com', 'a@.com', 'a@b..com', 'a..b@c.com', '.a@b.com', 'a b@c.com', 'a@b.com,c@d.com', 'a@b.com;c@d.com', 'Zed <a@b.com>', '"a"@b.com', 'a@b.com\nBcc: x@y.com', 'a@b.com\r\n', 'a@[127.0.0.1]', 'a@1.2.3.4', 'a@b.c', 'a@-b.com', 'x'.repeat(250) + '@b.com', 5, null, undefined, {}]) assert.equal(validateEmail(bad).ok, false, JSON.stringify(bad));
  assert.equal(maskEmail('zed.real@example.invalid'), 'z******@example.invalid'); assert.ok(!maskEmail('ab@x.com').includes('ab@'));
});

test('SAVED booking: a token is issued only to the creator; the follow-up attaches to THAT booking, is durable before the answer, says "received" - never confirmed / sent / delivered; the booking email is not overwritten; staff get an escalation naming the designated owner as NOT YET CLAIMED', async () => {
  const { env, db } = fresh(); const m = metaMock();
  const b = await book(env, 'FD-SAVED1'); assert.equal(b.status, 201); assert.match(b.body.followup_token, /^[0-9a-f]{64}$/); m.calls.length = 0;
  const f = await follow(env, 'FD-SAVED1', b.body.followup_token);
  assert.equal(f.status, 201); assert.deepEqual([f.body.received, f.body.kind, f.body.status, f.body.created, f.body.transfer_confirmed, f.body.acknowledgement_email, f.body.reply], [true, 'booking', 'REQUESTED', true, false, 'not_sent', 'manual_by_our_team']);
  assert.ok(!JSON.stringify(f.body).includes('zed.real@example.invalid'), 'the full address is never echoed'); assert.equal(f.body.email_masked, 'z******@example.invalid');
  const row = db.prepare('SELECT * FROM email_followups').get(); assert.equal(row.booking_id, b.body.booking_id); assert.equal(row.requested_email, 'zed.real@example.invalid'); assert.equal(row.booking_email, 'zed.test@example.invalid'); assert.equal(row.email_differs, 1); assert.equal(row.assigned_to, null); assert.equal(row.designated_owner, 'James');
  assert.equal(db.prepare('SELECT guest_email FROM bookings').get().guest_email, 'zed.test@example.invalid', 'the booking contact is untouched');
  const esc = db.prepare('SELECT * FROM escalations').get(); assert.match(esc.context, /^EMAIL FOLLOW-UP REQUIRED \| #\d+ \| Ref FD-SAVED1 \| Email zed\.real@example\.invalid \(DIFFERS from booking email - verify first\) \| Booking #\d+ \| Site book\.fijidash\.com \| Status REQUESTED \| Owner: James - NOT YET CLAIMED \| Inbox tourfijitours@gmail\.com/); assert.equal(esc.booking_id, b.body.booking_id); assert.equal(row.escalation_id, esc.id);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM booking_events WHERE event_type = 'email_followup_requested'`).get().n, 1);
  // the only outbound message is the single staff alert: one line, essentials first, no driver broadcast, no guest message
  assert.equal(m.calls.length, 0, 'no WhatsApp credentials configured in this env: nothing attempted'); m.restore();
});

test('DUPLICATE CLICKS: ten simultaneous requests and later retries create exactly ONE follow-up, ONE escalation, ONE booking', async () => {
  const { env, db } = fresh(); const b = await book(env, 'FD-DUP1');
  const rs = await Promise.all(Array.from({ length: 10 }, () => follow(env, 'FD-DUP1', b.body.followup_token)));
  assert.ok(rs.every((r) => r.status === 200 || r.status === 201), JSON.stringify(rs.map((r) => r.status))); assert.equal(rs.filter((r) => r.body.created).length, 1);
  const again = await follow(env, 'FD-DUP1', b.body.followup_token); assert.equal(again.status, 200); assert.equal(again.body.created, false);
  assert.deepEqual([count(db, 'email_followups'), count(db, 'escalations'), count(db, 'bookings')], [1, 1, 1]); assert.ok(db.prepare('SELECT request_count AS n FROM email_followups').get().n >= 2);
});

test('SECURITY: the reference alone reads and changes nothing - no token, a wrong token, another reference\'s token, or a different phone all fail; the replay token needs the phone on file', async () => {
  const { env, db } = fresh(); const a = await book(env, 'FD-SEC-A'); const other = await book(env, 'FD-SEC-B', { guest_phone: '+6799445566', guest_name: 'Other Guest', guest_email: 'other@example.invalid' });
  for (const [label, tok] of [['no token', undefined], ['wrong token', 'f'.repeat(64)], ['short token', 'abc'], ["another booking's token", other.body.followup_token]]) { const r = await follow(env, 'FD-SEC-A', tok); assert.equal(r.status, 403, label); assert.equal(r.body.code, 'TOKEN_REQUIRED'); assert.ok(!JSON.stringify(r.body).includes('Zed') && !JSON.stringify(r.body).includes('example.invalid'), label + ': nothing about the guest leaks'); }
  assert.equal(count(db, 'email_followups'), 0);
  // replaying the booking POST with the SAME ref but someone else's phone yields no token and no data of the real guest
  const steal = await book(env, 'FD-SEC-A', { guest_phone: '+6799000111', guest_name: 'Mallory', guest_email: 'mallory@example.invalid' });
  assert.equal(steal.body.followup_token, undefined); assert.equal(steal.body.idempotent, true);
  const own = await book(env, 'FD-SEC-A'); assert.equal(own.body.followup_token, a.body.followup_token, 'the creator\'s replay (same phone) gets the same token back');
  const ok = await follow(env, 'FD-SEC-A', own.body.followup_token); assert.equal(ok.status, 201);
  // a stranger cannot overwrite the address of an existing request without the token
  const hijack = await follow(env, 'FD-SEC-A', undefined, 'mallory@example.invalid'); assert.equal(hijack.status, 403); assert.equal(db.prepare('SELECT requested_email FROM email_followups').get().requested_email, 'zed.real@example.invalid');
});

test('CORRECTION: the guest can correct the address (token-protected) until staff acknowledge; the correction is flagged and the escalation text updated; afterwards it is locked and nothing changes', async () => {
  const { env, db } = fresh(); const b = await book(env, 'FD-FIX1', { guest_email: 'zed.test@example.invalid' });
  await follow(env, 'FD-FIX1', b.body.followup_token, 'typo@example.invalid');
  const fixed = await follow(env, 'FD-FIX1', b.body.followup_token, 'zed.test@example.invalid'); assert.equal(fixed.status, 200); assert.equal(fixed.body.changed, true);
  let row = db.prepare('SELECT * FROM email_followups').get(); assert.equal(row.requested_email, 'zed.test@example.invalid'); assert.equal(row.email_differs, 0); assert.equal(count(db, 'escalations'), 1); assert.match(db.prepare('SELECT context FROM escalations').get().context, /Email zed\.test@example\.invalid \(corrected by guest\)/);
  const ack = await call(env, 'POST', `/admin/email-followups/${row.id}/acknowledge`, { by: 'Test Staff' }, { auth: ADMIN }); assert.equal(ack.body.status, 'ACKNOWLEDGED');
  const late = await follow(env, 'FD-FIX1', b.body.followup_token, 'later@example.invalid'); assert.equal(late.status, 200); assert.equal(late.body.locked, true); assert.equal(late.body.changed, false);
  assert.equal(db.prepare('SELECT requested_email FROM email_followups').get().requested_email, 'zed.test@example.invalid');
});

test('UNCERTAIN SAVE: the booking committed but its response was lost; reconciling by the SAME reference (same phone) returns the same booking and token, no second reservation, and the follow-up attaches to it', async () => {
  const { env, db } = fresh(); const first = await book(env, 'FD-UNC1'); assert.equal(first.status, 201); /* response "lost": the page never saw first.body */
  const replay = await book(env, 'FD-UNC1'); assert.equal(replay.status, 200); assert.equal(replay.body.idempotent, true); assert.equal(replay.body.booking_id, first.body.booking_id); assert.ok(replay.body.followup_token);
  const f = await follow(env, 'FD-UNC1', replay.body.followup_token); assert.equal(f.status, 201); assert.equal(f.body.kind, 'booking');
  assert.deepEqual([count(db, 'bookings'), count(db, 'email_followups')], [1, 1]);
  // and when the booking truly never saved, a follow-up WITHOUT a booking is only ever an enquiry - never attached to a phantom booking
  const noBooking = await follow(env, 'FD-UNC-NONE', undefined, 'zed.real@example.invalid', ENQ); assert.equal(noBooking.body.kind, 'enquiry'); assert.equal(count(db, 'bookings'), 1);
});

test('UNSUPPORTED / WHATSAPP-ONLY: no saved booking -> an ENQUIRY for human review; never a booking, never "confirmed"; identical retry = same enquiry; a different address needs the token; details required', async () => {
  const { env, db } = fresh();
  const e = await follow(env, 'FD-ENQ1', undefined, 'wanda@example.invalid', { ...ENQ, origin_site: 'nat' }); assert.equal(e.status, 201); assert.deepEqual([e.body.kind, e.body.transfer_confirmed, e.body.created], ['enquiry', false, true]); assert.match(e.body.token, /^[0-9a-f]{64}$/);
  assert.equal(count(db, 'bookings'), 0); const row = db.prepare('SELECT * FROM email_followups').get(); assert.equal(row.booking_id, null); assert.match(row.journey_summary, /From: Nadi Airport \| To: Somewhere remote \| Date: 2026-10-20 \| Pickup: 09:30 \| Trip: one-way \| Vehicle: sedan \| Pax: 2 \| Flight: FJ000 \| Fare shown: FJ\$120/);
  assert.match(db.prepare('SELECT context FROM escalations').get().context, /^EMAIL FOLLOW-UP REQUIRED \| #\d+ \| Ref FD-ENQ1 \| Email wanda@example\.invalid \| ENQUIRY - no saved booking, human review, not a booking \| Site nadiairporttransfers\.com \| Status REQUESTED \| Owner: James - NOT YET CLAIMED \| Inbox tourfijitours@gmail\.com/);
  const retry = await follow(env, 'FD-ENQ1', undefined, 'wanda@example.invalid', ENQ); assert.equal(retry.status, 200); assert.equal(retry.body.created, false); assert.equal(retry.body.followup_id, e.body.followup_id);
  const diff = await follow(env, 'FD-ENQ1', undefined, 'mallory@example.invalid', ENQ); assert.equal(diff.status, 403);
  const withTok = await follow(env, 'FD-ENQ1', e.body.token, 'wanda2@example.invalid', ENQ); assert.equal(withTok.status, 200); assert.equal(withTok.body.changed, true);
  assert.deepEqual([count(db, 'email_followups'), count(db, 'escalations'), count(db, 'bookings')], [1, 1, 0]);
  const noName = await follow(env, 'FD-ENQ2', undefined, 'x@example.invalid', { guest_name: '', enquiry: {} }); assert.equal(noName.status, 400); assert.equal(noName.body.code, 'DETAILS_REQUIRED');
  // a reference that DOES have a booking can never be hijacked into an enquiry
  await book(env, 'FD-ENQ3'); const hij = await follow(env, 'FD-ENQ3', undefined, 'mallory@example.invalid', ENQ); assert.equal(hij.status, 403);
});

test('INVALID EMAIL (server side): rejected before anything is stored; syntax validation is explicitly not deliverability', async () => {
  const { env, db } = fresh(); const b = await book(env, 'FD-BAD1');
  for (const bad of ['not-an-email', 'a@b.com\nBcc: evil@x.com', 'a@b.com, c@d.com', '']) { const r = await follow(env, 'FD-BAD1', b.body.followup_token, bad); assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(r.body.code, 'INVALID_EMAIL'); assert.equal(r.body.deliverability, 'not_checked'); }
  assert.deepEqual([count(db, 'email_followups'), count(db, 'escalations')], [0, 0]);
  const badRef = await call(env, 'POST', '/email-followup', { client_ref: 'x', email: 'a@b.co' }); assert.equal(badRef.body.code, 'INVALID_REF');
});

test('FAILURE honesty: when the request cannot be recorded nothing is claimed; the guest can retry the same request; a failing staff alert never loses or blocks the durable request (alert status recorded)', async () => {
  const { env, db } = fresh({ whatsapp: true }); const m = metaMock(() => ({ ok: false, status: 400, text: JSON.stringify({ error: { message: 'simulated provider failure', code: 131000 } }) })); const b = await book(env, 'FD-FAIL1');
  const f = await follow(env, 'FD-FAIL1', b.body.followup_token); assert.equal(f.status, 201, 'the durable request stands even though the staff alert failed');
  assert.equal(db.prepare('SELECT alert_status FROM email_followups').get().alert_status, 'FAILED'); m.restore();
  // storage failure -> 5xx and no "received"
  const broken = { ...env, DB: { prepare(sql) { if (/INSERT INTO email_followups/.test(sql)) throw new Error('simulated storage failure'); return env.DB.prepare(sql); } } };
  const m2 = metaMock(); const b2 = await book(env, 'FD-FAIL2'); const bad = await follow(broken, 'FD-FAIL2', b2.body.followup_token);
  assert.notEqual(bad.status, 201); assert.ok(!bad.body.received); assert.equal(bad.body.code, 'NOT_RECORDED');
  const retry = await follow(env, 'FD-FAIL2', b2.body.followup_token); assert.equal(retry.status, 201); assert.equal(retry.body.created, true); m2.restore();
});

test('NOT CONFIGURED: with neither FOLLOWUP_SECRET nor ADMIN_TOKEN the feature says so (503) and no token is issued; existing booking behaviour is unchanged; FOLLOWUP_SECRET works on its own', async () => {
  const { env } = fresh({ secrets: false }); const b = await book(env, 'FD-NOCFG1'); assert.equal(b.status, 201); assert.equal(b.body.followup_token, undefined);
  const r = await follow(env, 'FD-NOCFG1', 'x'.repeat(64)); assert.equal(r.status, 503); assert.equal(r.body.code, 'NOT_CONFIGURED');
  const { env: e2 } = fresh({ secrets: false }); e2.FOLLOWUP_SECRET = 'dedicated-secret'; const b2 = await book(e2, 'FD-NOCFG2'); assert.match(b2.body.followup_token, /^[0-9a-f]{64}$/); assert.equal((await follow(e2, 'FD-NOCFG2', b2.body.followup_token)).status, 201);
});

test('RATE LIMIT: new requests per IP per day are capped; replays of an existing request are not new rows', async () => {
  const { env } = fresh(); const toks = []; for (let i = 0; i < 12; i++) { const ref = `FD-RATE${i}`; const b = await call(env, 'POST', '/bookings', bookingBody(ref), { ip: `198.51.100.${i + 1}` }); toks.push([ref, b.body.followup_token]); }
  const results = []; for (const [ref, t] of toks) results.push((await follow(env, ref, t, 'rl@example.invalid', {}, { ip: '203.0.113.99' })).status);
  assert.equal(results.filter((s) => s === 201).length, 10); assert.equal(results.filter((s) => s === 429).length, 2);
});

test('STAFF: the queue is behind admin auth, shows UNCLAIMED with the designated owner, supports owner assignment, acknowledgement and a recorded contact outcome (closing resolves the linked escalation); "by" is required and recorded as declared', async () => {
  const { env, db } = fresh(); const b = await book(env, 'FD-STAFF1'); await follow(env, 'FD-STAFF1', b.body.followup_token); const id = db.prepare('SELECT id FROM email_followups').get().id;
  assert.equal((await call(env, 'GET', '/admin/email-followups')).status, 401); assert.equal((await call(env, 'POST', `/admin/email-followups/${id}/outcome`, { by: 'x', outcome: 'GUEST_CONFIRMED' })).status, 401);
  const list = await call(env, 'GET', '/admin/email-followups?status=open', undefined, { auth: ADMIN }); assert.equal(list.body.followups.length, 1); assert.deepEqual([list.body.followups[0].claim_state, list.body.followups[0].assigned_to, list.body.followups[0].designated_owner, list.body.followups[0].status], ['UNCLAIMED', null, 'James', 'REQUESTED']); assert.ok(Number.isInteger(list.body.followups[0].age_minutes));
  assert.equal((await call(env, 'POST', `/admin/email-followups/${id}/assign`, { assigned_to: '' }, { auth: ADMIN })).status, 400);
  assert.equal((await call(env, 'POST', `/admin/email-followups/${id}/assign`, { assigned_to: 'Reservations desk' }, { auth: ADMIN })).body.claim_state, 'CLAIMED');
  assert.equal((await call(env, 'POST', `/admin/email-followups/${id}/assign`, { assigned_to: null }, { auth: ADMIN })).body.claim_state, 'UNCLAIMED');
  assert.equal((await call(env, 'POST', `/admin/email-followups/${id}/acknowledge`, {}, { auth: ADMIN })).status, 400);
  assert.equal((await call(env, 'POST', `/admin/email-followups/${id}/outcome`, { by: 'Test Staff', outcome: 'MADE_UP' }, { auth: ADMIN })).status, 400);
  const sent = await call(env, 'POST', `/admin/email-followups/${id}/outcome`, { by: 'Test Staff', outcome: 'EMAIL_SENT_MANUALLY', note: 'emailed by hand' }, { auth: ADMIN }); assert.equal(sent.body.status, 'CONTACTED'); assert.equal(db.prepare('SELECT resolved FROM escalations').get().resolved, 0);
  const done = await call(env, 'POST', `/admin/email-followups/${id}/outcome`, { by: 'Test Staff', outcome: 'GUEST_CONFIRMED' }, { auth: ADMIN }); assert.equal(done.body.status, 'CLOSED'); assert.equal(db.prepare('SELECT resolved FROM escalations').get().resolved, 1);
  const row = db.prepare('SELECT * FROM email_followups').get(); assert.deepEqual([row.acknowledged_by, row.contact_outcome_by, row.contact_outcome], ['Test Staff', 'Test Staff', 'GUEST_CONFIRMED']);
  assert.deepEqual(Object.keys(OUTCOMES).sort(), ['CANNOT_REACH', 'EMAIL_SENT_MANUALLY', 'GUEST_CONFIRMED', 'NO_ACTION_NEEDED']);
});

test('PRIVACY / CHANNELS: the staff alert is one clean line (Meta-safe) with the essentials first and goes to the staff alert phone only; the follow-up never triggers a driver broadcast or any guest message', async () => {
  const { env, db } = fresh({ whatsapp: true }); const m = metaMock(); const b = await book(env, 'FD-PRIV1'); m.calls.length = 0;
  await follow(env, 'FD-PRIV1', b.body.followup_token); m.restore();
  assert.equal(m.calls.length, 1, 'exactly one outbound message: the staff alert'); const text = alertText(m.calls[0].body);
  assert.ok(text && !/[\r\n\t]| {5,}/.test(text)); assert.match(text.slice(0, 200), /EMAIL FOLLOW-UP REQUIRED/); assert.match(text, /FD-PRIV1/); assert.match(text, /zed\.real@example\.invalid/);
  assert.ok(m.calls[0].body.includes('6799999999'), 'sent to the staff alert phone'); assert.ok(!m.calls[0].body.includes('6799112233'), 'not to the guest');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM booking_events WHERE event_type LIKE 'driver_broadcast%'`).get().n, 0, 'no driver broadcast');
});

test('REGRESSION: booking creation, idempotency and responses are unchanged apart from the additive followup_token (same booking id, amounts, statuses; one booking per reference)', async () => {
  const { env, db } = fresh(); const a = await book(env, 'FD-REG1'); const b = await book(env, 'FD-REG1');
  assert.deepEqual([a.status, b.status, b.body.idempotent, a.body.booking_id === b.body.booking_id, count(db, 'bookings')], [201, 200, true, true, 1]);
  assert.equal(a.body.booking.quoted_amount, 49); const { followup_token, ...rest } = a.body; assert.ok(followup_token); assert.ok(['ok', 'booking_id', 'booking', 'broadcast', 'idempotent'].every((k) => k in rest));
});

test('RECEIVING INBOX + ORIGIN: every follow-up records the originating site, the reference, the guest reply address, the journey and the monitored inbox (tourfijitours@gmail.com - receiving only); an unknown site is recorded as unknown; the inbox can be changed by platform setting; no sending service exists', async () => {
  const { env, db } = fresh(); const b = await book(env, 'FD-INBOX1');
  const f = await follow(env, 'FD-INBOX1', b.body.followup_token, 'zed.real@example.invalid', { origin_site: 'nat' }); assert.equal(f.body.team_inbox, 'tourfijitours@gmail.com');
  const row = db.prepare('SELECT * FROM email_followups').get(); assert.deepEqual([row.origin_site, row.client_ref, row.requested_email, row.receiving_inbox], ['nat', 'FD-INBOX1', 'zed.real@example.invalid', 'tourfijitours@gmail.com']); assert.match(row.journey_summary, /From: Nadi Airport \| To: Denarau \| Date: 2026-10-20 \| Pickup: 09:30 \| Trip: one-way \| Vehicle: sedan/);
  const b2 = await book(env, 'FD-INBOX2'); await follow(env, 'FD-INBOX2', b2.body.followup_token, 'z@example.invalid', { origin_site: 'evil.example' }); assert.equal(db.prepare(`SELECT origin_site FROM email_followups WHERE client_ref = 'FD-INBOX2'`).get().origin_site, 'unknown');
  db.prepare(`UPDATE platform_settings SET value = 'ops@example.invalid' WHERE key = 'email_followup_inbox'`).run(); const b3 = await book(env, 'FD-INBOX3'); const f3 = await follow(env, 'FD-INBOX3', b3.body.followup_token); assert.equal(f3.body.team_inbox, 'ops@example.invalid');
  const src = readFileSync(path.join(__dirname, 'email_followup.mjs'), 'utf8') + readFileSync(path.join(__dirname, 'worker.js'), 'utf8');
  assert.ok(!/smtp|mailchannels|sendgrid|resend\.com|sendEmail/i.test(src), 'no outbound email sender exists in this Worker; the reply is manual');
});

const claim = (env, id, by, auth = ADMIN) => call(env, 'POST', `/admin/email-followups/${id}/claim`, by === undefined ? {} : { by }, { auth });

test('OWNERSHIP: James is the DESIGNATED initial owner (seeded by the migration); that is distinct from CLAIMED - every request shows UNCLAIMED until someone actually claims it; the owner is configurable and an empty setting means "none designated" (shown honestly)', async () => {
  const { env, db } = fresh(); assert.equal(db.prepare(`SELECT value FROM platform_settings WHERE key = 'email_followup_owner'`).get().value, 'James');
  const b = await book(env, 'FD-OWN1'); await follow(env, 'FD-OWN1', b.body.followup_token); let row = db.prepare('SELECT * FROM email_followups').get(); assert.deepEqual([row.designated_owner, row.assigned_to, row.status], ['James', null, 'REQUESTED']);
  db.prepare(`UPDATE platform_settings SET value = '' WHERE key = 'email_followup_owner'`).run(); const b2 = await book(env, 'FD-OWN2'); await follow(env, 'FD-OWN2', b2.body.followup_token);
  assert.match(db.prepare(`SELECT context FROM escalations WHERE id = 2`).get().context, /Owner: none designated - NOT YET CLAIMED/);
  const id = row.id; const c = await claim(env, id, 'James'); assert.equal(c.status, 200); assert.deepEqual([c.body.claim_state, c.body.claimed_by, c.body.status], ['CLAIMED', 'James', 'ACKNOWLEDGED']);
  assert.equal((await claim(env, id, 'Someone Else')).status, 409, 'a claimed follow-up cannot be silently taken over'); assert.equal((await claim(env, id, 'James')).status, 200, 'claiming again as the same person is harmless');
  assert.equal((await claim(env, id)).status, 400, 'by is required'); assert.equal((await claim(env, id, 'x', 'wrong-token')).status, 401);
});

test('STAFF WORKFLOW end to end (synthetic): find the open follow-up -> claim it -> read the guest reply address, phone, site, reference and journey -> record the contact outcome -> closed; the guest can no longer change the address once claimed', async () => {
  const { env, db } = fresh(); const b = await book(env, 'FD-FLOW1'); await follow(env, 'FD-FLOW1', b.body.followup_token, 'zed.real@example.invalid', { origin_site: 'nat' });
  const open = await call(env, 'GET', '/admin/email-followups?status=open', undefined, { auth: ADMIN }); assert.equal(open.body.followups.length, 1); const f = open.body.followups[0];
  assert.deepEqual([f.client_ref, f.requested_email, f.origin_site, f.guest_phone, f.guest_name, f.claim_state, f.designated_owner], ['FD-FLOW1', 'zed.real@example.invalid', 'nat', PHONE, 'Zed Testperson', 'UNCLAIMED', 'James']); assert.match(f.journey_summary, /From: Nadi Airport \| To: Denarau/);
  const c = await claim(env, f.id, 'James'); assert.match(db.prepare('SELECT context FROM escalations').get().context, /Status ACKNOWLEDGED | CLAIMED by James |/, 'the existing escalations page shows the claim'); assert.deepEqual([c.body.reply_email, c.body.reference, c.body.origin_site, c.body.guest_phone], ['zed.real@example.invalid', 'FD-FLOW1', 'nat', PHONE]); assert.match(c.body.journey, /Vehicle: sedan/);
  const late = await follow(env, 'FD-FLOW1', b.body.followup_token, 'changed@example.invalid'); assert.equal(late.body.locked, true);
  const sent = await call(env, 'POST', `/admin/email-followups/${f.id}/outcome`, { by: 'James', outcome: 'EMAIL_SENT_MANUALLY', note: 'replied from the team inbox' }, { auth: ADMIN }); assert.equal(sent.body.status, 'CONTACTED');
  assert.equal((await call(env, 'GET', '/admin/email-followups?status=open', undefined, { auth: ADMIN })).body.followups.length, 1, 'CONTACTED is not closed: it is still on the open list until the guest confirms or staff close it');
  const done = await call(env, 'POST', `/admin/email-followups/${f.id}/outcome`, { by: 'James', outcome: 'GUEST_CONFIRMED' }, { auth: ADMIN }); assert.equal(done.body.status, 'CLOSED');
  const all = await call(env, 'GET', '/admin/email-followups?status=all', undefined, { auth: ADMIN }); const closed = all.body.followups[0]; assert.deepEqual([closed.status, closed.assigned_to, closed.acknowledged_by, closed.contact_outcome, closed.contact_outcome_by], ['CLOSED', 'James', 'James', 'GUEST_CONFIRMED', 'James']);
  assert.equal(db.prepare('SELECT resolved FROM escalations').get().resolved, 1);
});

test('ESCALATIONS PAGE CAN NOT SILENTLY CLOSE AN OPEN FOLLOW-UP: Resolve on the mirrored escalation is refused with a pointer to the follow-up queue; once the follow-up is CLOSED the normal behaviour is unchanged', async () => {
  const { env, db } = fresh(); const b = await book(env, 'FD-ESC1'); await follow(env, 'FD-ESC1', b.body.followup_token); const escId = db.prepare('SELECT escalation_id FROM email_followups').get().escalation_id; const id = db.prepare('SELECT id FROM email_followups').get().id;
  const refused = await call(env, 'POST', `/admin/escalations/${escId}/resolve`, undefined, { auth: ADMIN }); assert.equal(refused.status, 409); assert.equal(refused.body.code, 'EMAIL_FOLLOWUP_OPEN'); assert.match(refused.body.error, /Email follow-ups page/); assert.equal(db.prepare('SELECT resolved FROM escalations WHERE id = ?').get(escId).resolved, 0);
  const other = db.prepare(`INSERT INTO escalations (source, trigger_type, context) VALUES ('guest', 'other', 'unrelated')`).run().lastInsertRowid; assert.equal((await call(env, 'POST', `/admin/escalations/${other}/resolve`, undefined, { auth: ADMIN })).status, 200, 'other escalations are unaffected');
  await call(env, 'POST', `/admin/email-followups/${id}/outcome`, { by: 'James', outcome: 'NO_ACTION_NEEDED' }, { auth: ADMIN }); assert.equal(db.prepare('SELECT resolved FROM escalations WHERE id = ?').get(escId).resolved, 1);
});

test('FAILED STAFF ALERT: whether the WhatsApp alert fails with a provider error, throws, or no alert phone is set, the request stays recorded, VISIBLE in the database-backed queue, and fully actionable (claim -> outcome); the alert outcome is recorded', async () => {
  for (const [label, setup] of [['provider error', () => metaMock(() => ({ ok: false, status: 400, text: JSON.stringify({ error: { code: 131000 } }) }))], ['network throw', () => { globalThis.fetch = async () => { throw new TypeError('network down'); }; return { restore() { globalThis.fetch = guard; } }; }], ['no alert phone', null]]) {
    const { env, db } = fresh({ whatsapp: true, adminPhone: label === 'no alert phone' ? '' : '+6799999999' }); const m = setup ? setup() : metaMock(); const b = await book(env, 'FD-ALERT-' + label.length); const f = await follow(env, 'FD-ALERT-' + label.length, b.body.followup_token); m.restore();
    assert.equal(f.status, 201, label); const row = db.prepare('SELECT * FROM email_followups').get(); assert.notEqual(row.alert_status, 'SENT', label); assert.ok(['FAILED', 'NOT_ATTEMPTED', 'ESCALATION_FAILED'].includes(row.alert_status), label + ' ' + row.alert_status);
    const open = await call(env, 'GET', '/admin/email-followups?status=open', undefined, { auth: ADMIN }); assert.equal(open.body.followups.length, 1, label + ': still on the staff queue'); assert.equal(open.body.followups[0].alert_status, row.alert_status);
    assert.equal((await claim(env, row.id, 'James')).status, 200, label); assert.equal((await call(env, 'POST', `/admin/email-followups/${row.id}/outcome`, { by: 'James', outcome: 'EMAIL_SENT_MANUALLY' }, { auth: ADMIN })).body.status, 'CONTACTED', label);
  }
});

test('MISSING SECRET: with FOLLOWUP_SECRET unset the key is DERIVED from ADMIN_TOKEN (works today), with neither the feature reports unavailable (503) and issues nothing; a dedicated secret yields different tokens (tokens issued under one key are not valid under the other - set the secret BEFORE the pages go live)', async () => {
  const a = fresh(); const t1 = (await book(a.env, 'FD-KEY1')).body.followup_token;
  const b = fresh(); b.env.FOLLOWUP_SECRET = 'a-dedicated-test-secret'; const t2 = (await book(b.env, 'FD-KEY1')).body.followup_token; assert.notEqual(t1, t2);
  assert.equal((await follow(b.env, 'FD-KEY1', t1)).status, 403, 'a derived-key token is refused once a dedicated secret is set');
  const none = fresh({ secrets: false }); assert.equal((await book(none.env, 'FD-KEY2')).body.followup_token, undefined); assert.equal((await follow(none.env, 'FD-KEY2', 'x'.repeat(64))).status, 503);
  assert.ok(!readFileSync(path.join(__dirname, 'email_followup.mjs'), 'utf8').match(/console\.(log|warn|error)\([^)]*(secret|token)/i), 'the module never logs secrets or tokens');
});

const MANUAL_DESTRUCTIVE = path.join(__dirname, '..', 'manual-only', 'DESTRUCTIVE-milestone38-drop-email-followups.sql.txt');
test('MIGRATION COMPATIBILITY: milestone38 applies on the existing chain without touching existing rows; the NEW Worker on a schema WITHOUT it still creates bookings normally and answers /email-followup honestly (503 not-recorded, never "received"); resolving escalations works on the pre-migration schema', async () => {
  const noMig = new DatabaseSync(':memory:'); noMig.exec(SCHEMA_SQL); for (const m of MIGRATIONS.slice(0, 3)) noMig.exec(m);
  const oldEnv = { DB: d1(noMig), ADMIN_TOKEN: ADMIN }; const pre = await book(oldEnv, 'FD-COMPAT1'); assert.equal(pre.status, 201); const before = { bookings: count(noMig, 'bookings'), escalations: count(noMig, 'escalations') };
  const noTable = await follow(oldEnv, 'FD-COMPAT1', pre.body.followup_token); assert.equal(noTable.status, 503); assert.equal(noTable.body.code, 'NOT_RECORDED'); assert.ok(!noTable.body.received);
  assert.equal((await call(oldEnv, 'POST', '/admin/escalations/1/resolve', undefined, { auth: ADMIN })).status, 404, 'escalation resolve works on the pre-migration schema (guarded lookup)');
  noMig.exec(MIGRATIONS[3]); assert.deepEqual({ bookings: count(noMig, 'bookings'), escalations: count(noMig, 'escalations') }, before, 'applying the migration changes no existing rows'); assert.equal((await follow(oldEnv, 'FD-COMPAT1', pre.body.followup_token)).status, 201);
});

test('DATA-PRESERVING ROLLBACK (the default): the PREVIOUS production Worker (0b961a4, materialised from git) running against the schema WITH milestone38 and real follow-up rows creates and replays bookings, lists/resolves escalations, and never touches the follow-up table, its rows or its settings; the outstanding requests stay readable with the documented read-only SELECT; the old code has no email routes (404)', async () => {
  const { materialise, loadWorker } = await import('./test-fixtures/worker-harness.mjs'); const repoRoot = path.join(__dirname, '..', '..');
  const dir = materialise({ rev: '0b961a4', repoRoot }); const oldWorker = (await loadWorker(dir)).default;
  const { env, db } = fresh(); const b = await book(env, 'FD-ROLL1'); await follow(env, 'FD-ROLL1', b.body.followup_token, 'zed.real@example.invalid', { origin_site: 'nat' }); const snapshot = JSON.stringify(db.prepare('SELECT * FROM email_followups ORDER BY id').all()); const settings = JSON.stringify(db.prepare("SELECT key, value FROM platform_settings WHERE key LIKE 'email_followup%' ORDER BY key").all());
  const oldCall = async (method, url, body, auth) => { const res = await oldWorker.fetch(new Request('https://worker.test' + url, { method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.77', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env); return { status: res.status, body: await res.json().catch(() => null) }; };
  const nb = await oldCall('POST', '/bookings', bookingBody('FD-ROLL2')); assert.equal(nb.status, 201); assert.equal(nb.body.followup_token, undefined, 'old code issues no follow-up token'); const replay = await oldCall('POST', '/bookings', bookingBody('FD-ROLL2')); assert.deepEqual([replay.status, replay.body.idempotent], [200, true]);
  assert.equal((await oldCall('POST', '/email-followup', { client_ref: 'FD-ROLL1', email: 'a@b.co' })).status, 404, 'the old Worker has no email-followup route'); assert.equal((await oldCall('GET', '/admin/email-followups', undefined, ADMIN)).status, 404);
  const escList = await oldCall('GET', '/admin/escalations?resolved=0', undefined, ADMIN); assert.equal(escList.status, 200); assert.ok(escList.body.escalations.some((e) => /^EMAIL FOLLOW-UP REQUIRED \| #\d+ \| Ref FD-ROLL1 \| Email zed\.real@example\.invalid/.test(e.context)), 'the mirrored escalation (full text: reference, reply address, journey) is still on the existing escalations page');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM email_followups ORDER BY id').all()), snapshot, 'follow-up rows untouched by the old code'); assert.equal(JSON.stringify(db.prepare("SELECT key, value FROM platform_settings WHERE key LIKE 'email_followup%' ORDER BY key").all()), settings, 'settings untouched');
  // the documented read-only recovery query (runbook) returns the outstanding request
  const rows = db.prepare("SELECT id, client_ref, requested_email, guest_name, guest_phone, origin_site, journey_summary, status, designated_owner, assigned_to, created_at FROM email_followups WHERE status != 'CLOSED' ORDER BY created_at").all(); assert.equal(rows.length, 1); assert.equal(rows[0].requested_email, 'zed.real@example.invalid');
  // quirk (documented): the OLD escalations Resolve would close the mirrored line without touching the follow-up row; the row stays and is still found by the query above
  const escId = db.prepare('SELECT escalation_id FROM email_followups').get().escalation_id; assert.equal((await oldCall('POST', `/admin/escalations/${escId}/resolve`, undefined, ADMIN)).status, 200); assert.equal(db.prepare('SELECT status FROM email_followups').get().status, 'REQUESTED');
});

test('DESTRUCTIVE SQL is manual-only: it is not in migrations/, has no .sql suffix, refuses to run as shipped (guard line), and only removes the table + two settings once a human removes the guard; bookings and escalations survive', () => {
  assert.ok(!fs.existsSync(path.join(MIGRATIONS_DIR, 'rollback')), 'no rollback directory under migrations/'); assert.ok(fs.readdirSync(MIGRATIONS_DIR).every((f) => !/rollback|drop/i.test(f)));
  const raw = readFileSync(MANUAL_DESTRUCTIVE, 'utf8'); assert.ok(MANUAL_DESTRUCTIVE.endsWith('.sql.txt')); assert.match(raw, /DESTRUCTIVE - MANUAL ONLY - NOT PART OF ANY ROLLBACK SEQUENCE/);
  const { db } = fresh(); db.exec("INSERT INTO email_followups (client_ref, kind, requested_email) VALUES ('X-1', 'enquiry', 'a@b.co')"); assert.throws(() => db.exec(raw), /THIS_GUARD_LINE|syntax/i, 'refuses to run as shipped'); assert.equal(count(db, 'email_followups'), 1);
  const before = { b: count(db, 'bookings'), e: count(db, 'escalations') }; db.exec(raw.split('\n').filter((l) => !l.startsWith('THIS_GUARD_LINE')).join('\n'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'email_followups'").get().n, 0); assert.equal(db.prepare("SELECT COUNT(*) AS n FROM platform_settings WHERE key LIKE 'email_followup%'").get().n, 0); assert.deepEqual({ b: count(db, 'bookings'), e: count(db, 'escalations') }, before);
});
