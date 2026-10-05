// Dependable email follow-up requests (Milestone 38). A BACKUP contact channel for guests who cannot use WhatsApp.
//
//   POST /email-followup                       public, guest page. Records a durable request BEFORE answering.
//   GET  /admin/email-followups                staff queue (admin token)
//   POST /admin/email-followups/:id/assign     owner, or explicit unassigned queue (assigned_to: null)
//   POST /admin/email-followups/:id/acknowledge
//   POST /admin/email-followups/:id/outcome    recorded contact outcome
//
// What "received" means here: a row exists in email_followups and staff were flagged. It NEVER means the transfer is confirmed, and NEVER means any email was
// sent or delivered: this Worker has no outbound email sender, the human reply is manual, and responses say so explicitly.
//
// Security model (a booking reference alone must not read or change anyone's contact details):
//   * Every write for an existing reference needs the follow-up token = HMAC-SHA256(secret, ref). It is only ever issued to the caller that CREATED the
//     booking (201) or that replays the booking POST with the SAME phone number as the one on file (the lost-response recovery). The reference alone yields nothing.
//   * Responses never return a full email address (masked) and never return another guest's phone, name or booking.
//   * The requested email is stored beside, never over, bookings.guest_email; a differing address is flagged for staff to verify before they send anything.
//   * Once staff have acknowledged the request the guest can no longer change the address through the public endpoint (they must reply to the team).
// Syntax validation is NOT proof of deliverability: validateEmail() only rejects what cannot possibly be a single mailbox address.

export const DEFAULT_RECEIVING_INBOX = 'tourfijitours@gmail.com';   // James-confirmed central inbox monitored by the human team (receiving inbox ONLY - no sender is configured or authorised)
const ORIGIN_SITES = Object.freeze({ nat: 'nadiairporttransfers.com', fijidash: 'book.fijidash.com' });
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{4,63}$/;
const EMAIL_MAX = 254;
const TEXT_LIMITS = { guest_name: 120, journey: 400, notes: 300 };
export const OUTCOMES = Object.freeze({
  EMAIL_SENT_MANUALLY: 'CONTACTED',   // staff emailed the guest by hand; the guest has not necessarily read or answered it
  GUEST_CONFIRMED: 'CLOSED',
  CANNOT_REACH: 'CLOSED',
  NO_ACTION_NEEDED: 'CLOSED',
});

export function validateEmail(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'Enter an email address.' };
  if (/[\u0000-\u001f\u007f]/.test(raw)) return { ok: false, reason: 'Enter one plain email address (no line breaks).' };
  const email = raw.trim();
  if (!email) return { ok: false, reason: 'Enter an email address.' };
  if (email.length > EMAIL_MAX) return { ok: false, reason: 'That email address is too long.' };
  // one mailbox only: no whitespace / control characters (header injection), no list separators, no display-name or angle brackets, no quotes
  if (/[\s\u0000-\u001f\u007f,;<>"'()\[\]\\:]/.test(email)) return { ok: false, reason: 'Enter one plain email address (no spaces or list separators).' };
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return { ok: false, reason: 'An email address needs one @ sign.' };
  const local = email.slice(0, at); const domain = email.slice(at + 1).toLowerCase();
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return { ok: false, reason: 'The part before @ is not valid.' };
  if (!/^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+$/.test(local)) return { ok: false, reason: 'The part before @ has unsupported characters.' };
  if (domain.length > 253 || !domain.includes('.') || domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return { ok: false, reason: 'The domain after @ is not valid.' };
  const labels = domain.split('.');
  if (!labels.every((l) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return { ok: false, reason: 'The domain after @ is not valid.' };
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1]) && !/^xn--[a-z0-9-]{2,59}$/.test(labels[labels.length - 1])) return { ok: false, reason: 'The domain ending is not valid.' };
  return { ok: true, email: `${local}@${domain}` };
}

export function maskEmail(email) {
  const at = String(email || '').indexOf('@');
  if (at < 1) return '';
  const local = email.slice(0, at);
  return `${local[0]}${'*'.repeat(Math.max(2, Math.min(6, local.length - 1)))}${email.slice(at)}`;
}

export const digitsOnly = (s) => String(s || '').replace(/[^0-9]/g, '');

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// FOLLOWUP_SECRET is the dedicated secret. If it is not configured the key is DERIVED from ADMIN_TOKEN (so the feature works with today's secrets) - a
// dedicated secret is still recommended. With neither, the feature reports itself unavailable instead of issuing guessable tokens.
export function followupSecret(env) {
  const base = env.FOLLOWUP_SECRET || env.ADMIN_TOKEN;
  return base ? (env.FOLLOWUP_SECRET ? base : `email-followup-derived:${base}`) : null;
}
export async function followupToken(env, ref) {
  const secret = followupSecret(env);
  return secret ? hmacHex(secret, `email-followup:v1:${ref}`) : null;
}

const clip = (v, n) => (v === undefined || v === null ? null : String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, n) || null);

// Single-line text for the staff WhatsApp alert (Meta rejects newlines / tabs / runs of spaces).
const ONE_LINE_RE = new RegExp('[\r\n\t\v\f' + String.fromCharCode(0x85, 0x2028, 0x2029) + ']+', 'g');
const oneLine = (s, n) => String(s || '').replace(ONE_LINE_RE, ' ').replace(/ {2,}/g, ' ').trim().slice(0, n);

export function summariseEnquiry(e) {
  const x = e && typeof e === 'object' ? e : {};
  const parts = [
    clip(x.from, 60) && `From: ${clip(x.from, 60)}`, clip(x.to, 80) && `To: ${clip(x.to, 80)}`, clip(x.date, 20) && `Date: ${clip(x.date, 20)}`, clip(x.time, 10) && `Pickup: ${clip(x.time, 10)}`,
    clip(x.trip, 12) && `Trip: ${clip(x.trip, 12)}`, clip(x.vehicle, 30) && `Vehicle: ${clip(x.vehicle, 30)}`, Number.isFinite(Number(x.passengers)) && x.passengers !== null && x.passengers !== '' ? `Pax: ${Math.max(0, Math.min(99, Math.trunc(Number(x.passengers))))}` : null,
    clip(x.flight, 20) && `Flight: ${clip(x.flight, 20)}`, Number.isFinite(Number(x.amount_shown)) && x.amount_shown !== null && x.amount_shown !== '' ? `Fare shown: FJ$${Number(x.amount_shown)}` : null, clip(x.notes, TEXT_LIMITS.notes) && `Notes: ${clip(x.notes, TEXT_LIMITS.notes)}`,
  ].filter(Boolean);
  return parts.join(' | ').slice(0, TEXT_LIMITS.journey + 200);
}

const publicView = (row, extra = {}) => ({
  ok: true, received: true, followup_id: row.id, kind: row.kind, status: row.status, reference: row.client_ref, email_masked: maskEmail(row.requested_email),
  // explicit, so no guest page can read "received" as more than it is
  transfer_confirmed: false, acknowledgement_email: 'not_sent', reply: 'manual_by_our_team', team_inbox: row.receiving_inbox || DEFAULT_RECEIVING_INBOX, ...extra,
});

export function createEmailFollowupHandlers(deps) {
  const { json, getSetting, requireAdmin, createEscalation, logBookingEvent, timingSafeEqual } = deps;
  const inboxFor = async (env) => (await getSetting(env, 'email_followup_inbox', DEFAULT_RECEIVING_INBOX)) || DEFAULT_RECEIVING_INBOX;

  async function rateLimited(env, ip) {
    const max = Number(await getSetting(env, 'email_followup_rate_limit_max_per_day', '10'));
    const row = await env.DB.prepare(`SELECT COUNT(*) AS cnt FROM email_followups WHERE source_ip = ? AND created_at > datetime('now', '-1440 minutes')`).bind(ip).first();
    return (row ? row.cnt : 0) >= max;
  }

  // POST /email-followup
  async function handleCreate(request, env) {
    if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);
    let body; try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }
    if (!body || typeof body !== 'object') return json({ ok: false, error: 'Invalid JSON.' }, 400);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    const ref = typeof body.client_ref === 'string' ? body.client_ref.trim() : '';
    if (!REF_RE.test(ref)) return json({ ok: false, code: 'INVALID_REF', errors: ['client_ref is missing or malformed.'] }, 400);
    const ev = validateEmail(body.email);
    if (!ev.ok) return json({ ok: false, code: 'INVALID_EMAIL', errors: [ev.reason], deliverability: 'not_checked' }, 400);
    const expected = await followupToken(env, ref);
    if (!expected) return json({ ok: false, code: 'NOT_CONFIGURED', errors: ['Email follow-up is not available right now. Please use WhatsApp.'] }, 503);
    const token = typeof body.token === 'string' ? body.token : '';
    const originSite = Object.prototype.hasOwnProperty.call(ORIGIN_SITES, body.origin_site) ? body.origin_site : 'unknown';
    const tokenOk = token.length === expected.length && timingSafeEqual(token, expected);

    const booking = await env.DB.prepare(`SELECT id, guest_name, guest_phone, guest_email, pickup_zone, destination_zone, vehicle_type, pickup_date, pickup_time, return_date, flight_number FROM bookings WHERE client_booking_ref = ?`).bind(ref).first();
    const existing = await env.DB.prepare(`SELECT * FROM email_followups WHERE client_ref = ?`).bind(ref).first();

    // ---- an existing request for this reference: idempotent replay, or a (token-protected) correction. Never a second task.
    if (existing) {
      const phoneOk = digitsOnly(body.guest_phone) !== '' && digitsOnly(body.guest_phone) === digitsOnly(existing.guest_phone);
      const sameAsStored = existing.requested_email === ev.email;
      // A lost-response retry of the SAME enquiry (identical phone + email) is a replay and may be answered without a token; anything else needs the token.
      if (!tokenOk && !(existing.kind === 'enquiry' && phoneOk && sameAsStored)) return json({ ok: false, code: 'TOKEN_REQUIRED', errors: ['This request cannot be changed from here.'] }, 403);
      if (sameAsStored) {
        await env.DB.prepare(`UPDATE email_followups SET request_count = request_count + 1, updated_at = datetime('now') WHERE id = ?`).bind(existing.id).run();
        return json(publicView(existing, { created: false, changed: false, token: tokenOk || existing.kind === 'enquiry' ? expected : undefined }), 200);
      }
      if (existing.status !== 'REQUESTED') return json(publicView(existing, { created: false, changed: false, locked: true, message: 'Our team is already handling this request. Reply to them to change the address.' }), 200);
      const differs = existing.kind === 'booking' && existing.booking_email ? (existing.booking_email.toLowerCase() !== ev.email ? 1 : 0) : existing.email_differs;
      await env.DB.prepare(`UPDATE email_followups SET requested_email = ?, email_differs = ?, request_count = request_count + 1, updated_at = datetime('now') WHERE id = ?`).bind(ev.email, differs, existing.id).run();
      if (existing.escalation_id) await env.DB.prepare(`UPDATE escalations SET context = ? WHERE id = ? AND resolved = 0`).bind(buildContext({ ...existing, requested_email: ev.email, email_differs: differs, corrected: true }), existing.escalation_id).run();
      return json(publicView({ ...existing, requested_email: ev.email }, { created: false, changed: true, token: expected }), 200);
    }

    // ---- first request for this reference
    if (await rateLimited(env, ip)) return json({ ok: false, code: 'RATE_LIMITED', errors: ['Too many requests from this connection today. Please use WhatsApp.'] }, 429);

    let row;
    if (booking) {
      // attached to a saved reservation: the caller must hold the token (issued at creation / on a same-phone replay)
      if (!tokenOk) return json({ ok: false, code: 'TOKEN_REQUIRED', errors: ['This request cannot be created from here.'] }, 403);
      const summary = [`From: ${booking.pickup_zone}`, `To: ${booking.destination_zone}`, booking.pickup_date && `Date: ${booking.pickup_date}`, booking.pickup_time && `Pickup: ${booking.pickup_time}`, `Trip: ${booking.return_date ? 'return' : 'one-way'}`, `Vehicle: ${booking.vehicle_type}`, booking.flight_number && `Flight: ${booking.flight_number}`].filter(Boolean).join(' | ');
      row = { kind: 'booking', booking_id: booking.id, guest_name: booking.guest_name, guest_phone: booking.guest_phone, booking_email: booking.guest_email || null, journey_summary: summary.slice(0, 600), email_differs: booking.guest_email && booking.guest_email.toLowerCase() !== ev.email ? 1 : 0 };
    } else {
      // no saved booking (WhatsApp-only / unsupported route): an ENQUIRY for human review, never a booking
      const name = clip(body.guest_name, TEXT_LIMITS.guest_name); const phone = digitsOnly(body.guest_phone);
      if (!name || phone.length < 7 || phone.length > 15) return json({ ok: false, code: 'DETAILS_REQUIRED', errors: ['Your name and phone number are needed so our team can match this request.'] }, 400);
      row = { kind: 'enquiry', booking_id: null, guest_name: name, guest_phone: clip(body.guest_phone, 30), booking_email: null, journey_summary: summariseEnquiry(body.enquiry), email_differs: 0 };
    }
    let insertedId;
    try {
      const ins = await env.DB.prepare(`INSERT INTO email_followups (client_ref, kind, booking_id, guest_name, guest_phone, requested_email, booking_email, email_differs, journey_summary, source_ip, origin_site, receiving_inbox) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(ref, row.kind, row.booking_id, row.guest_name, row.guest_phone, ev.email, row.booking_email, row.email_differs, row.journey_summary, ip, originSite, await inboxFor(env)).run();
      insertedId = ins.meta.last_row_id;
    } catch (err) {
      // a concurrent double-click inserted it first (UNIQUE client_ref): answer from the winning row, never a second task
      const winner = await env.DB.prepare(`SELECT * FROM email_followups WHERE client_ref = ?`).bind(ref).first();
      if (winner) return json(publicView(winner, { created: false, changed: false, token: expected }), 200);
      return json({ ok: false, code: 'NOT_RECORDED', errors: ['We could not record your request. Nothing was received - please try again.'] }, 500);
    }
    const saved = await env.DB.prepare(`SELECT * FROM email_followups WHERE id = ?`).bind(insertedId).first();

    // staff visibility: reuse the existing escalation queue + staff alert (best effort; the durable row above is the source of truth)
    let alertStatus = 'NOT_ATTEMPTED'; let escalationId = null;
    try {
      const { escalation, alert } = await createEscalation(env, { source: 'guest', triggerType: 'other', context: buildContext(saved), bookingId: saved.booking_id, sourceIp: ip });
      escalationId = escalation.id; alertStatus = alert && alert.ok ? 'SENT' : (alert && alert.attempted === false ? 'NOT_ATTEMPTED' : 'FAILED');
    } catch (err) { alertStatus = 'ESCALATION_FAILED'; console.error('[email-followup] escalation/alert failed:', err.message); }
    await env.DB.prepare(`UPDATE email_followups SET escalation_id = ?, alert_status = ? WHERE id = ?`).bind(escalationId, alertStatus, insertedId).run();
    if (saved.booking_id) await logBookingEvent(env, { bookingId: saved.booking_id, eventType: 'email_followup_requested', actor: 'guest', metadata: { followup_id: insertedId } });
    return json(publicView(saved, { created: true, changed: false, token: expected }), 201);
  }

  function buildContext(r) {
    // the staff alert truncates at ~200 characters, so the essentials come first: required action, reference, email, kind
    return oneLine(`EMAIL FOLLOW-UP REQUIRED | #${r.id || 'new'} | Ref ${r.client_ref} | Email ${r.requested_email}${r.email_differs ? ' (DIFFERS from booking email - verify first)' : ''}${r.corrected ? ' (corrected by guest)' : ''} | ${r.kind === 'enquiry' ? 'ENQUIRY - no saved booking, human review, not a booking' : `Booking #${r.booking_id}`} | Site ${ORIGIN_SITES[r.origin_site] || 'unknown'} | Status ${r.status || 'REQUESTED'} | Owner ${r.assigned_to || 'UNASSIGNED QUEUE'} | Inbox ${r.receiving_inbox || DEFAULT_RECEIVING_INBOX} | Guest ${r.guest_name || '-'} ${r.guest_phone || ''} | ${r.journey_summary || ''} | No email has been sent`, 1500);
  }

  async function handleAdminList(request, env, url) {
    if (!(await requireAdmin(request, env))) return json({ error: 'Unauthorized.' }, 401);
    if (!env.DB) return json({ followups: [] }, 503);
    const status = url.searchParams.get('status');
    const where = status && status !== 'all' ? (status === 'open' ? `WHERE status IN ('REQUESTED','ACKNOWLEDGED')` : `WHERE status = ?`) : '';
    const stmt = env.DB.prepare(`SELECT * FROM email_followups ${where} ORDER BY created_at ASC LIMIT 200`);
    const res = status && status !== 'all' && status !== 'open' ? await stmt.bind(String(status).toUpperCase()).all() : await stmt.all();
    return json({ ok: true, followups: (res.results || []).map((r) => ({ ...r, assigned_to: r.assigned_to || null, queue: r.assigned_to ? 'ASSIGNED' : 'UNASSIGNED' })) }, 200);
  }

  async function readAdminBody(request) { try { const b = await request.json(); return b && typeof b === 'object' ? b : {}; } catch { return {}; } }
  const label = (v) => clip(v, 60);

  async function handleAdminAction(request, env, id, action) {
    if (!(await requireAdmin(request, env))) return json({ error: 'Unauthorized.' }, 401);
    if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);
    const row = await env.DB.prepare(`SELECT * FROM email_followups WHERE id = ?`).bind(id).first();
    if (!row) return json({ ok: false, error: 'Follow-up not found.' }, 404);
    const b = await readAdminBody(request);
    if (action === 'assign') {
      const owner = b.assigned_to === null ? null : label(b.assigned_to);
      if (b.assigned_to !== null && !owner) return json({ ok: false, errors: ['assigned_to must be a name, or null for the unassigned queue.'] }, 400);
      await env.DB.prepare(`UPDATE email_followups SET assigned_to = ?, assigned_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(owner, id).run();
      return json({ ok: true, id, assigned_to: owner, queue: owner ? 'ASSIGNED' : 'UNASSIGNED' }, 200);
    }
    if (action === 'acknowledge') {
      const by = label(b.by); if (!by) return json({ ok: false, errors: ['by (who is acknowledging) is required.'] }, 400);
      if (row.status !== 'REQUESTED') return json({ ok: true, id, status: row.status, already: true }, 200);
      await env.DB.prepare(`UPDATE email_followups SET status = 'ACKNOWLEDGED', acknowledged_at = datetime('now'), acknowledged_by = ?, updated_at = datetime('now') WHERE id = ?`).bind(by, id).run();
      return json({ ok: true, id, status: 'ACKNOWLEDGED', acknowledged_by: by }, 200);
    }
    if (action === 'outcome') {
      const by = label(b.by); const outcome = typeof b.outcome === 'string' ? b.outcome : '';
      if (!by) return json({ ok: false, errors: ['by (who made contact) is required.'] }, 400);
      if (!Object.prototype.hasOwnProperty.call(OUTCOMES, outcome)) return json({ ok: false, errors: [`outcome must be one of: ${Object.keys(OUTCOMES).join(', ')}`] }, 400);
      const status = OUTCOMES[outcome];
      await env.DB.prepare(`UPDATE email_followups SET status = ?, contact_outcome = ?, contact_outcome_note = ?, contact_outcome_at = datetime('now'), contact_outcome_by = ?, acknowledged_at = COALESCE(acknowledged_at, datetime('now')), acknowledged_by = COALESCE(acknowledged_by, ?), updated_at = datetime('now') WHERE id = ?`).bind(status, outcome, clip(b.note, 500), by, by, id).run();
      if (status === 'CLOSED' && row.escalation_id) await env.DB.prepare(`UPDATE escalations SET resolved = 1 WHERE id = ?`).bind(row.escalation_id).run();
      if (row.booking_id) await logBookingEvent(env, { bookingId: row.booking_id, eventType: 'email_followup_outcome', actor: 'admin', metadata: { followup_id: id, outcome } });
      return json({ ok: true, id, status, contact_outcome: outcome }, 200);
    }
    return json({ ok: false, error: 'Unknown action.' }, 400);
  }

  return { handleCreate, handleAdminList, handleAdminAction };
}
