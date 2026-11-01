/* Bula Happiness — durable email outbox on D1 (ISOLATED). Capture sender only; no live provider exists in this candidate.
 * Stable job identity per saved booking+recipient+template version; leases + recovery for interrupted sends;
 * provider-accepted / delivered / bounced / human-ack are separate evidence columns; the message and the private
 * link are rendered at SEND time from the live booking/session rows (no body or token is persisted in the outbox). */
import { formatFijiDateTime } from '../worker/fiji_time.js';
import { fjd } from './money.js';
import { fijiWhen } from './trip.js';

export const TEMPLATE_VERSION = 'v2';
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const eventKey = (ref) => `saved-booking:${ref}`;

/** Called from the verified server-side save. Never throws into the booking path (callers wrap it anyway). */
export async function enqueueSavedBooking(db, cfg, booking, nowMs) {
  const key = eventKey(booking.client_booking_ref); const rows = [];
  const guestOk = EMAIL_RE.test(booking.guest_email || '');
  rows.push(['guest', booking.guest_email || '', guestOk ? 'queued' : 'blocked', guestOk ? null : 'invalid_guest_email']);
  const staffOk = EMAIL_RE.test(cfg.staffInbox || '');
  rows.push(['staff', cfg.staffInbox || '', staffOk ? 'queued' : 'blocked', staffOk ? null : 'staff_inbox_not_configured']);
  await db.batch(rows.map(([kind, addr, state, why]) => db.prepare(
    `INSERT OR IGNORE INTO bula_outbox (job_key, source_event_key, booking_ref, session_id, recipient_kind, recipient_address, template, template_version, state, blocked_reason, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(`${key}|${kind}|${TEMPLATE_VERSION}`, key, booking.client_booking_ref, booking.guest_session_id, kind, addr, `${kind}-booking-received`, TEMPLATE_VERSION, state, why, nowMs, nowMs)));
  return { event: key };
}
/** Reconciliation: any booking saved AFTER the cutover with no job gets one (covers a crash between save and enqueue).
 *  Bookings that predate the cutover are never replayed. */
export async function reconcileMissing(db, cfg, nowMs) {
  const cut = await db.prepare("SELECT value FROM bula_settings WHERE key = 'outbox_cutover_iso'").first();
  if (!cut) return 0;
  // a booking with FEWER than the two expected jobs (none, or only one after a partial failure) gets the missing ones; inserts are idempotent
  const { results } = await db.prepare(`SELECT b.* FROM marau_test_bookings b WHERE b.created_at >= ? AND b.parent_booking_id IS NULL
      AND (SELECT COUNT(*) FROM bula_outbox o WHERE o.source_event_key = 'saved-booking:' || b.client_booking_ref) < 2`).bind(cut.value).all();
  for (const b of results) await enqueueSavedBooking(db, cfg, b, nowMs);
  return results.length;
}

/* ---- rendering ------------------------------------------------------------------------------------------- */
function bookingFacts(b, cfg) {
  const miss = [];
  if (!b.pickup_datetime) miss.push('pickup'); if (!b.pickup_zone || !b.destination_zone) miss.push('route');
  if (!(Number.isFinite(b.quoted_amount))) miss.push('amount');
  const currency = b.source_currency || cfg.defaultCurrency; if (!currency) miss.push('currency');
  return { miss, currency, when: fijiWhen(b.pickup_datetime) };
}
const line = (label, v) => (v === undefined || v === null || v === '' ? null : `${label}: ${v}`);
export function renderGuest(b, session, cfg, credit = null) {
  const f = bookingFacts(b, cfg); if (f.miss.length) return { blocked: `missing_${f.miss.join('_')}` };
  if (session.access_token_revoked) return { blocked: 'session_revoked' };
  if (!/^https:\/\//.test(cfg.guestOrigin || '') && !cfg.syntheticTest) return { blocked: 'guest_origin_not_https' };
  const verified = !!(cfg.supportWhatsapp && cfg.supportVerified);
  if (!verified && !cfg.syntheticTest) return { blocked: 'support_contact_unverified' };
  const status = { pending: 'received', confirmed: 'confirmed', cancelled: 'cancelled', declined: 'declined' }[b.status] || 'received';
  const head = { received: 'Bula! We have received your booking request. It is NOT confirmed yet — you will hear from our team once it is.', confirmed: 'Bula! Your transfer is confirmed.',
    cancelled: 'Your booking has been cancelled.', declined: 'Sorry — we could not accept this booking.' }[status];
  const wa = session.whatsapp_available === 1 ? 'WhatsApp number confirmed as working' : session.whatsapp_available === 0 ? 'No WhatsApp on this number — we will use email and phone' : null;
  const cta = status === 'cancelled' || status === 'declined' ? null : `${status === 'confirmed' ? 'View your trip' : 'Check your booking status'}: ${cfg.guestOrigin}/#tok=${session.access_token}`;
  const text = [head, '', line('Reference', b.source_booking_ref || b.client_booking_ref), line('Pickup (Fiji time)', f.when), line('From', b.pickup_zone), line('To', b.destination_zone), line('Vehicle', b.vehicle_type),
    line('Quoted total', `${f.currency} ${Number(b.quoted_amount).toFixed(2)}`), line('Discount applied', b.discount_amount != null ? `${f.currency} ${Number(b.discount_amount).toFixed(2)}` : null),
    credit && cfg.creditsEnabled && cfg.checkoutEnabled ? `Welcome promotional credit: ${fjd(credit.available_cents)} toward eligible offers (no cash value${credit.expires_at ? '; expires ' + formatFijiDateTime(new Date(credit.expires_at).toISOString()) : ''}). Limits apply per offer.` : null,
    line('Flight', b.flight_number), line('Passengers', b.passengers), line('Luggage', b.luggage), line('Add-ons', b.add_ons), line('WhatsApp', wa), '',
    cta, `Questions? Bula Happiness support: ${verified ? cfg.supportWhatsapp : '(synthetic test)'}`].filter((x) => x !== null).join('\n');
  return { message: { to: b.guest_email, subject: `Booking ${status} ${b.source_booking_ref || b.client_booking_ref}`, text } };
}
export function renderStaff(b, cfg) {
  const f = bookingFacts(b, cfg); if (f.miss.length) return { blocked: `missing_${f.miss.join('_')}` };
  const text = [`New saved booking ${b.source_booking_ref || b.client_booking_ref} — status: ${b.status}`, line('Pickup (Fiji time)', f.when), line('Route', `${b.pickup_zone} -> ${b.destination_zone}`), line('Vehicle', b.vehicle_type),
    line('Quoted total', `${f.currency} ${Number(b.quoted_amount).toFixed(2)}`), line('Guest email', b.guest_email), line('Guest phone', b.guest_phone),
    b.status === 'pending' ? 'ACTION: confirm or decline in the staff console. The guest has been told it is not yet confirmed.' : null].filter(Boolean).join('\n');
  return { message: { to: cfg.staffInbox, subject: `[Bula] New booking ${b.source_booking_ref || b.client_booking_ref}`, text } };
}

/* ---- dispatcher: lease claim, send, record evidence ------------------------------------------------------- */
export async function recoverInterrupted(db, nowMs) { // a lease that expired mid-send MAY have sent: never blind-resend
  const r = await db.prepare("UPDATE bula_outbox SET state = 'ambiguous', last_error = 'interrupted_during_send', lease_owner = NULL, updated_at = ? WHERE state = 'sending' AND lease_until < ?").bind(nowMs, nowMs).run();
  return r.meta.changes;
}
const evt = (db, key, at, kind, detail) => db.prepare('INSERT INTO bula_outbox_events (job_key, at, kind, detail) VALUES (?,?,?,?)').bind(key, at, kind, detail ?? null);
export async function dispatch(db, cfg, sender, { workerId = 'w1', nowMs, limit = 20 }) {
  await recoverInterrupted(db, nowMs);
  const { results } = await db.prepare("SELECT job_key FROM bula_outbox WHERE state IN ('queued','failed') AND attempts < ? ORDER BY created_at LIMIT ?").bind(cfg.outboxMaxAttempts, limit).all();
  const stats = { accepted: 0, failed: 0, ambiguous: 0, blocked: 0, skipped: 0 };
  for (const { job_key } of results) {
    const claim = await db.prepare("UPDATE bula_outbox SET state = 'sending', attempts = attempts + 1, lease_owner = ?, lease_until = ?, updated_at = ? WHERE job_key = ? AND state IN ('queued','failed')").bind(workerId, nowMs + cfg.leaseMs, nowMs, job_key).run();
    if (claim.meta.changes !== 1) { stats.skipped++; continue; }   // another worker owns it
    const job = await db.prepare('SELECT * FROM bula_outbox WHERE job_key = ?').bind(job_key).first();
    const b = await db.prepare('SELECT * FROM marau_test_bookings WHERE client_booking_ref = ?').bind(job.booking_ref).first();
    const s = await db.prepare('SELECT * FROM guest_sessions WHERE session_id = ?').bind(job.session_id).first();
    // Optional itinerary details come ONLY from the saved source snapshot, and only when the source supplied them; absent stays absent.
    try { const sn = b && await db.prepare('SELECT * FROM bula_booking_snapshots WHERE booking_ref = ?').bind(b.client_booking_ref).first(); if (sn) { if (sn.flight_number) b.flight_number = sn.flight_number; if (sn.passengers != null) b.passengers = sn.passengers; if (sn.luggage != null) b.luggage = sn.luggage; if (sn.currency && !b.source_currency) b.source_currency = sn.currency; if (sn.discount_minor != null) b.discount_amount = sn.discount_minor / 100;
      if (sn.add_ons_json) { const a = JSON.parse(sn.add_ons_json); if (a) b.add_ons = String(a); } } } catch (e) { /* a snapshot fault must never block a receipt */ }
    let credit = null;
    if (job.recipient_kind === 'guest' && cfg.creditsEnabled) {
      try { credit = await db.prepare('SELECT available_cents, expires_at FROM bula_credit_accounts WHERE party_key = ?').bind(`trip:${job.booking_ref}`).first(); } catch (e) { credit = null; }   // a credit-store fault must never block or crash the email
      // The receipt is never delayed for a promotion: credit is mentioned only if it already exists; otherwise it appears in the trip page wallet once allocated (no second email).
    }
    const out = !b || !s ? { blocked: 'booking_or_session_missing' } : job.recipient_kind === 'guest' ? renderGuest(b, s, cfg, credit) : renderStaff(b, cfg);
    if (out.blocked) { await db.batch([db.prepare("UPDATE bula_outbox SET state = 'blocked', blocked_reason = ?, lease_owner = NULL, updated_at = ? WHERE job_key = ? AND lease_owner = ?").bind(out.blocked, nowMs, job_key, workerId), evt(db, job_key, nowMs, 'blocked', out.blocked)]); stats.blocked++; continue; }
    try {
      const r = await sender.send({ idempotencyKey: job_key, ...out.message });
      await db.batch([db.prepare("UPDATE bula_outbox SET state = 'accepted', provider_id = ?, provider_accepted_at = ?, lease_owner = NULL, last_error = NULL, updated_at = ? WHERE job_key = ? AND lease_owner = ? AND state = 'sending'").bind(r && r.id ? String(r.id) : null, nowMs, nowMs, job_key, workerId), evt(db, job_key, nowMs, 'provider_accepted')]); stats.accepted++;
    } catch (e) {
      const amb = !!(e && e.ambiguous); const st = amb ? 'ambiguous' : 'failed';
      await db.batch([db.prepare('UPDATE bula_outbox SET state = ?, last_error = ?, lease_owner = NULL, updated_at = ? WHERE job_key = ? AND lease_owner = ? AND state = \'sending\'').bind(st, String((e && e.message) || e).slice(0, 120), nowMs, job_key, workerId), evt(db, job_key, nowMs, st, null)]); stats[st]++;
    }
  }
  return stats;
}
/** Resolve uncertain provider outcomes without resending: ask the provider by idempotency key. */
export async function reconcileAmbiguous(db, sender, nowMs) {
  const { results } = await db.prepare("SELECT job_key FROM bula_outbox WHERE state = 'ambiguous'").all(); let n = 0;
  if (!sender.lookup) return 0;
  for (const { job_key } of results) {
    const f = await sender.lookup(job_key);
    if (f === undefined) continue;
    if (f) await db.prepare("UPDATE bula_outbox SET state = 'accepted', provider_id = ?, provider_accepted_at = ?, updated_at = ? WHERE job_key = ? AND state = 'ambiguous'").bind(f.id ?? null, nowMs, nowMs, job_key).run();
    else await db.prepare("UPDATE bula_outbox SET state = 'queued', updated_at = ? WHERE job_key = ? AND state = 'ambiguous'").bind(nowMs, job_key).run();   // provider has no record: safe to retry
    n++;
  }
  return n;
}
export async function recordDelivery(db, key, kind, nowMs) { // provider webhook evidence; never inferred from acceptance
  const col = { delivered: 'delivered_at', bounced: 'bounced_at' }[kind]; if (!col) throw new Error('bad evidence kind');
  await db.prepare(`UPDATE bula_outbox SET ${col} = ?, updated_at = ? WHERE job_key = ? AND state = 'accepted'`).bind(nowMs, nowMs, key).run();
}
export async function humanAcknowledge(db, key, staffName, nowMs) {
  await db.prepare("UPDATE bula_outbox SET human_ack_at = ?, human_ack_by = ?, updated_at = ? WHERE job_key = ?").bind(nowMs, staffName, nowMs, key).run();
}
/** Staff queue: everything that needs a human (failed / ambiguous / blocked / dead, plus bounced). */
export async function staffQueue(db) {
  const { results } = await db.prepare(`SELECT job_key, booking_ref, recipient_kind, state, attempts, blocked_reason, last_error, bounced_at FROM bula_outbox
    WHERE state IN ('failed','ambiguous','blocked','dead') OR bounced_at IS NOT NULL ORDER BY updated_at DESC`).all();
  return results;
}
export function createCaptureSender({ failTimes = 0, ambiguousTimes = 0, ambiguousButSent = true } = {}) {
  const sent = []; let f = failTimes, a = ambiguousTimes;
  return { sent,
    async send(m) {
      if (a-- > 0) { if (ambiguousButSent && !sent.some((x) => x.idempotencyKey === m.idempotencyKey)) sent.push(m); const e = new Error('timeout'); e.ambiguous = true; throw e; }
      if (f-- > 0) throw new Error('provider 503');
      const ex = sent.find((x) => x.idempotencyKey === m.idempotencyKey); if (ex) return { id: `cap-${sent.indexOf(ex) + 1}` };
      sent.push(m); return { id: `cap-${sent.length}` };
    },
    async lookup(key) { const i = sent.findIndex((x) => x.idempotencyKey === key); return i >= 0 ? { id: `cap-${i + 1}` } : null; } };
}
export const liveSenderDisabled = { async send() { throw new Error('LIVE_SENDER_DISABLED'); } };
