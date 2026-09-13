// Nadi Airport Transfers — P0 admin-notification retry fix (2026-09-14).
//
// CONFIRMED PRODUCTION INCIDENT this fixes: booking #60 (client_booking_ref
// FD-PYC5VE). The rich admin WhatsApp notification failed at 15:13:47 with
// Meta error 132018 ("Param text cannot have new-line/tab characters or
// more than 4 consecutive spaces"); a guest retry at 15:15:47 replayed the
// same client_booking_ref and was logged admin_notification_skipped_
// idempotent - ops was never notified, and never could be, because
// booking-level idempotency (client_booking_ref already has a row) was
// being used as a proxy for notification-level idempotency, with zero
// regard for whether the first notification attempt had actually
// succeeded. See migrations/milestone36-admin-notification-retry-state.sql
// for the full contract this fixes.
//
// Offline, no network, no live D1 - drives the REAL worker.js `fetch()`
// handler (imported directly) against an in-memory SQLite database loaded
// with the real schema.sql plus the FULL cumulative migration chain (this
// suite exercises handleGuestBookingCreate end to end - client_booking_ref
// idempotency, itinerary fields, attribution capture all touch columns
// spread across several migrations, unlike the narrower suites elsewhere
// in this directory). global.fetch is mocked per-test to stand in for
// Meta's Graph API - one mock (installValidatingMetaMock) genuinely
// enforces Meta's own 132018 rule against the real outgoing request body,
// so a passing test proves the actual bytes sent are clean, not just that
// a regex ran; the other (installScriptedMetaMock) returns a scripted
// sequence of responses to drive the retry state machine through a
// specific fail/retry/succeed scenario.
//
// Run: node --test nadi-marketplace/worker/admin_notification_retry.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const SCHEMA_SQL = readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

// schema.sql on this branch is NOT a "milestone 1 only" base file - it has
// been kept flattened/cumulative over time (verified directly: it already
// contains, inline, the ALTER/CREATE statements from milestone4 through
// milestone29, e.g. bookings.pickup_date/notes/return_* from milestone17,
// booking_events from milestone19). Re-applying an already-flattened
// migration fails closed with "duplicate column name" (confirmed by
// actually running this suite) rather than silently double-applying, which
// is how this was caught. Only the migrations NOT yet folded into
// schema.sql (checked one by one against its literal content) need to be
// applied on top: milestone34 (client_booking_ref/guest_email/
// flight_number - what createBookingRecord's idempotency and
// buildFullBookingAdminSummary both need), milestone35 (attribution
// columns - createBookingRecord reads/writes these unconditionally), and
// this mission's own milestone36 (admin_notification_state).
const MIGRATION_ORDER = [
  'milestone34-booking-idempotency-and-contact-fields.sql',
  'milestone35-revenue-attribution.sql',
  'milestone36-admin-notification-retry-state.sql',
];
const MIGRATIONS_SQL = MIGRATION_ORDER.map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));

/**
 * Minimal D1-compatible shim over node:sqlite's synchronous API - same
 * shape/precedent as human_confirmation.test.mjs's own shim.
 */
function createD1Shim(db) {
  return {
    prepare(sql) {
      let boundArgs = [];
      const api = {
        bind(...args) { boundArgs = args; return api; },
        async first() {
          const stmt = db.prepare(sql);
          const row = stmt.get(...boundArgs);
          return row === undefined ? null : row;
        },
        async all() {
          const stmt = db.prepare(sql);
          return { results: stmt.all(...boundArgs) };
        },
        async run() {
          const stmt = db.prepare(sql);
          const info = stmt.run(...boundArgs);
          return { meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
        },
      };
      return api;
    },
  };
}

const TEST_WHATSAPP_PHONE_ID = 'test-phone-id';
const TEST_WHATSAPP_TOKEN = 'test-whatsapp-token';
const DEFAULT_ADMIN_PHONE = '+6799999999';

function freshEnv({ adminAlertPhone = DEFAULT_ADMIN_PHONE } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  for (const sql of MIGRATIONS_SQL) db.exec(sql);
  // schema.sql already seeds 'Nadi Airport'/'Denarau' (and 17 other real
  // zones) - no need to insert them ourselves.
  if (adminAlertPhone) {
    db.prepare(`UPDATE platform_settings SET value = ? WHERE key = 'admin_alert_phone'`).run(adminAlertPhone);
  }
  const env = { DB: createD1Shim(db), WHATSAPP_TOKEN: TEST_WHATSAPP_TOKEN, WHATSAPP_PHONE_ID: TEST_WHATSAPP_PHONE_ID };
  return { env, db };
}

function baseBookingPayload(overrides = {}) {
  return {
    guest_name: 'Test Guest',
    guest_phone: '+6799112233',
    pickup_zone: 'Nadi Airport',
    destination_zone: 'Denarau',
    vehicle_type: 'sedan',
    quoted_currency: 'FJD',
    quoted_amount: 49,
    payment_method: 'cash',
    pickup_date: '2026-10-05',
    pickup_time: '09:30',
    ...overrides,
  };
}

function postBookingRequest(body, { ip = '203.0.113.10' } = {}) {
  return new Request('https://worker.test/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

async function postBooking(env, body, opts) {
  const res = await worker.fetch(postBookingRequest(body, opts), env);
  const respBody = await res.json();
  return { status: res.status, body: respBody };
}

// ─── mocked Meta Graph API ───────────────────────────────────────────────

// The real Meta constraint (132018): no \r\n\t and no run of 5+ spaces.
const META_INVALID_PARAM_RE = /[\r\n\t]| {5,}/;

function metaSuccessResponse(wamid = 'wamid.TEST123') {
  return { ok: true, status: 200, bodyText: JSON.stringify({ messages: [{ id: wamid }] }) };
}
function meta132018Response() {
  return {
    ok: false, status: 400,
    bodyText: JSON.stringify({ error: { message: '(#132018) Param text cannot have new-line/tab characters or more than 4 consecutive spaces', code: 132018 } }),
  };
}
function extractAlertSummary(bodyText) {
  try {
    const parsed = JSON.parse(bodyText);
    const params = parsed?.template?.components?.[0]?.parameters || [];
    const p = params.find((x) => x.parameter_name === 'alert_summary');
    return p ? p.text : null;
  } catch { return null; }
}

// Genuinely enforces Meta's own rule against the real outgoing request body
// - a passing test using this mock proves the actual bytes sent are clean,
// not just that sanitiseWhatsAppParamText ran.
function installValidatingMetaMock() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const bodyText = opts && opts.body ? opts.body.toString() : '';
    const alertSummary = extractAlertSummary(bodyText);
    calls.push({ url, bodyText, alertSummary });
    const r = (alertSummary != null && META_INVALID_PARAM_RE.test(alertSummary)) ? meta132018Response() : metaSuccessResponse();
    return { ok: r.ok, status: r.status, text: async () => r.bodyText };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

// Returns a scripted sequence of responses, in order; once exhausted,
// further calls default to success (so an unrelated extra call - e.g. the
// short alert on a path a given test isn't focused on - doesn't crash it).
function installScriptedMetaMock(responses) {
  const calls = [];
  const queue = [...responses];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const bodyText = opts && opts.body ? opts.body.toString() : '';
    calls.push({ url, bodyText, alertSummary: extractAlertSummary(bodyText) });
    const next = queue.length > 0 ? queue.shift() : metaSuccessResponse();
    return { ok: next.ok, status: next.status, text: async () => next.bodyText };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

// ─── 1. TEMPLATE SANITIZATION — incident #60 fixture ────────────────────

test('Incident #60 fixture (newline, tab, 5+ consecutive spaces in guest-authored notes/guest_name) is sanitized before send and accepted by the mocked provider on the very first attempt', async () => {
  const { env, db } = freshEnv();
  const mock = installValidatingMetaMock();
  try {
    const dirtyNotes = 'Please\ncall\ton\narrival.    Room 402   -   VIP guest.';
    const dirtyName = 'Mr\tTest     Guest';
    assert.ok(META_INVALID_PARAM_RE.test(dirtyNotes), 'fixture sanity: raw notes really contains newline/tab/5+ spaces');
    assert.ok(META_INVALID_PARAM_RE.test(dirtyName), 'fixture sanity: raw guest_name really contains a tab and 5+ spaces');

    const { status, body } = await postBooking(env, baseBookingPayload({
      client_booking_ref: 'FD-PYC5VE-TEST',
      guest_name: dirtyName,
      notes: dirtyNotes,
    }));
    assert.equal(status, 201);
    assert.equal(body.ok, true);

    // Both the short alert and the rich notification must have been sent,
    // and both must have been ACCEPTED by the mocked provider (which
    // itself enforces Meta's real rule) - proof the actual outgoing bytes
    // were clean, not just that a regex ran locally.
    assert.equal(mock.calls.length, 2, 'short alert + rich notification, both attempted');
    for (const call of mock.calls) {
      assert.ok(call.alertSummary != null, 'every call must carry a real alert_summary param');
      assert.ok(!META_INVALID_PARAM_RE.test(call.alertSummary), `provider must have accepted this text: ${JSON.stringify(call.alertSummary)}`);
    }

    const richCall = mock.calls.find((c) => c.alertSummary.startsWith('NEW BOOKING'));
    assert.ok(richCall, 'the rich notification must be identifiable by its own format');
    assert.ok(richCall.alertSummary.includes('Please call on arrival. Room 402 - VIP guest.'), 'sanitized text must still be readable - words/order preserved, not stripped to nothing');
    assert.ok(richCall.alertSummary.includes('Mr Test Guest'), 'sanitized guest name must still be readable');

    const state = db.prepare('SELECT state FROM admin_notification_state WHERE booking_id = ?').get(body.booking_id);
    assert.equal(state.state, 'SENT');

    // Sanitization must apply ONLY to the outgoing notification payload,
    // never to the stored booking row.
    const stored = db.prepare('SELECT notes, guest_name FROM bookings WHERE id = ?').get(body.booking_id);
    assert.equal(stored.notes, dirtyNotes, 'stored notes must keep every raw character exactly as submitted');
    assert.equal(stored.guest_name, dirtyName, 'stored guest_name must keep every raw character exactly as submitted');
  } finally {
    mock.restore();
  }
});

// ─── 2/3. NOTIFICATION DELIVERY STATE + RETRY BEHAVIOR ──────────────────

test('provider failure -> guest retry (same client_booking_ref) -> success -> a third replay is skipped_idempotent with zero additional provider calls', async () => {
  const { env, db } = freshEnv();
  const mock = installScriptedMetaMock([
    metaSuccessResponse(), // short alert, on the original (non-replay) creation
    meta132018Response(),  // rich notification, on the original creation - FAILS
    metaSuccessResponse(), // rich notification, on the retry (first replay) - SUCCEEDS
  ]);
  try {
    const ref = 'FD-RETRY-TEST-1';
    const create = await postBooking(env, baseBookingPayload({ client_booking_ref: ref }));
    assert.equal(create.status, 201);
    const bookingId = create.body.booking_id;

    let state = db.prepare('SELECT state, attempt_count FROM admin_notification_state WHERE booking_id = ?').get(bookingId);
    assert.equal(state.state, 'FAILED_RETRYABLE', 'a failed send must NOT be treated as SENT');
    assert.equal(state.attempt_count, 1);

    let failedEvents = db.prepare(`SELECT * FROM booking_events WHERE booking_id = ? AND event_type = 'admin_notification_failed'`).all(bookingId);
    assert.equal(failedEvents.length, 1);
    const failedMeta = JSON.parse(failedEvents[0].metadata);
    assert.match(failedMeta.response, /132018/, 'the raw Meta rejection must be retained (response field), not just a generic reason string');
    assert.equal(failedMeta.status, 400);

    // Guest retry: same client_booking_ref -> booking-level idempotent
    // replay. Must NOT create a second booking, and must retry the
    // notification for real (it was never actually delivered).
    const retry = await postBooking(env, baseBookingPayload({ client_booking_ref: ref }));
    assert.equal(retry.status, 200);
    assert.equal(retry.body.idempotent, true);
    assert.equal(retry.body.booking_id, bookingId, 'must be the SAME booking - no second booking created');

    state = db.prepare('SELECT state, attempt_count FROM admin_notification_state WHERE booking_id = ?').get(bookingId);
    assert.equal(state.state, 'SENT');
    assert.equal(state.attempt_count, 2, 'the retry is attempt #2 on the SAME durable row, not a fresh #1');

    const sentEvents = db.prepare(`SELECT * FROM booking_events WHERE booking_id = ? AND event_type = 'admin_notification_sent'`).all(bookingId);
    assert.equal(sentEvents.length, 1, 'admin_notification_sent recorded exactly once');

    const callsBeforeSecondReplay = mock.calls.length;
    assert.equal(callsBeforeSecondReplay, 3);

    // A further (third overall) request replaying the same ref must be
    // skipped_idempotent - now correctly, because a real send genuinely
    // already succeeded.
    const secondReplay = await postBooking(env, baseBookingPayload({ client_booking_ref: ref }));
    assert.equal(secondReplay.status, 200);
    assert.equal(secondReplay.body.booking_id, bookingId);
    assert.equal(mock.calls.length, callsBeforeSecondReplay, 'a booking already SENT must trigger zero additional provider calls');

    const skippedEvents = db.prepare(`SELECT * FROM booking_events WHERE booking_id = ? AND event_type = 'admin_notification_skipped_idempotent'`).all(bookingId);
    assert.equal(skippedEvents.length, 1);
    const skippedMeta = JSON.parse(skippedEvents[0].metadata);
    assert.match(skippedMeta.reason, /already sent/);

    // Exactly one booking row ever exists for this ref, throughout.
    const rows = db.prepare('SELECT COUNT(*) as n FROM bookings WHERE client_booking_ref = ?').get(ref);
    assert.equal(rows.n, 1);
  } finally {
    mock.restore();
  }
});

test('no admin_alert_phone configured leaves the notification FAILED_RETRYABLE (never SENT) - configuring one and retrying then succeeds', async () => {
  const { env, db } = freshEnv({ adminAlertPhone: '' });
  const mock = installScriptedMetaMock([]); // no phone configured yet -> zero provider calls expected on create
  try {
    const ref = 'FD-NO-PHONE-TEST';
    const create = await postBooking(env, baseBookingPayload({ client_booking_ref: ref }));
    assert.equal(create.status, 201);
    const bookingId = create.body.booking_id;
    assert.equal(mock.calls.length, 0, 'no admin_alert_phone configured -> no provider call attempted at all');

    let state = db.prepare('SELECT state FROM admin_notification_state WHERE booking_id = ?').get(bookingId);
    assert.equal(state.state, 'FAILED_RETRYABLE');
    const failedEvents = db.prepare(`SELECT * FROM booking_events WHERE booking_id = ? AND event_type = 'admin_notification_failed'`).all(bookingId);
    assert.equal(failedEvents.length, 1);
    assert.match(JSON.parse(failedEvents[0].metadata).reason, /admin_alert_phone is not set/);

    db.prepare(`UPDATE platform_settings SET value = ? WHERE key = 'admin_alert_phone'`).run(DEFAULT_ADMIN_PHONE);
    mock.restore();
    const mock2 = installScriptedMetaMock([metaSuccessResponse()]);
    try {
      const retry = await postBooking(env, baseBookingPayload({ client_booking_ref: ref }));
      assert.equal(retry.status, 200);
      state = db.prepare('SELECT state FROM admin_notification_state WHERE booking_id = ?').get(bookingId);
      assert.equal(state.state, 'SENT');
    } finally {
      mock2.restore();
    }
  } finally {
    // mock already restored above; guard against double-restore issues
  }
});

// ─── 4. CONCURRENCY ──────────────────────────────────────────────────────

test('two simultaneous notification attempts for the same booking never both produce a real send - the atomic durable claim allows only one', async () => {
  const { env, db } = freshEnv();
  const mock = installScriptedMetaMock([
    metaSuccessResponse(), // short alert on create
    meta132018Response(),  // rich notification on create - FAILS, leaves it retryable
  ]);
  try {
    const ref = 'FD-CONCURRENCY-TEST';
    const create = await postBooking(env, baseBookingPayload({ client_booking_ref: ref }));
    assert.equal(create.status, 201);
    const bookingId = create.body.booking_id;
    let state = db.prepare('SELECT state FROM admin_notification_state WHERE booking_id = ?').get(bookingId);
    assert.equal(state.state, 'FAILED_RETRYABLE');

    // Two concurrent replays race to retry the same booking's notification.
    // The mock's scripted queue is exhausted, so whichever wins the claim
    // gets a default success.
    const [a, b] = await Promise.all([
      postBooking(env, baseBookingPayload({ client_booking_ref: ref })),
      postBooking(env, baseBookingPayload({ client_booking_ref: ref })),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.body.booking_id, bookingId);
    assert.equal(b.body.booking_id, bookingId);

    state = db.prepare('SELECT state, attempt_count FROM admin_notification_state WHERE booking_id = ?').get(bookingId);
    assert.equal(state.state, 'SENT');
    assert.equal(state.attempt_count, 2, 'only ONE of the two concurrent replays could claim the attempt (count goes 1 -> 2, never 3)');

    const sentEvents = db.prepare(`SELECT * FROM booking_events WHERE booking_id = ? AND event_type = 'admin_notification_sent'`).all(bookingId);
    assert.equal(sentEvents.length, 1, 'exactly one real send happened across both concurrent attempts');

    const skippedEvents = db.prepare(`SELECT * FROM booking_events WHERE booking_id = ? AND event_type = 'admin_notification_skipped_idempotent'`).all(bookingId);
    assert.equal(skippedEvents.length, 1, 'the loser of the race logs a skip, never a silent no-op and never a second send');

    const rows = db.prepare('SELECT COUNT(*) as n FROM bookings WHERE client_booking_ref = ?').get(ref);
    assert.equal(rows.n, 1);
  } finally {
    mock.restore();
  }
});

// ─── 6. PRESERVED: booking save/idempotency, fares, D1 rows ────────────

test('a fresh (non-replay) booking whose notification succeeds on the first attempt goes straight from NOT_ATTEMPTED to SENT - no retry needed for the common case', async () => {
  const { env, db } = freshEnv();
  const mock = installScriptedMetaMock([metaSuccessResponse(), metaSuccessResponse()]);
  try {
    const { status, body } = await postBooking(env, baseBookingPayload({ client_booking_ref: 'FD-HAPPY-PATH' }));
    assert.equal(status, 201);
    const state = db.prepare('SELECT state, attempt_count FROM admin_notification_state WHERE booking_id = ?').get(body.booking_id);
    assert.equal(state.state, 'SENT');
    assert.equal(state.attempt_count, 1);
  } finally {
    mock.restore();
  }
});

test('booking idempotency, fares, and D1 rows are completely unaffected by this fix - two different client_booking_ref values create two distinct bookings, each with its own correct quoted_amount', async () => {
  const { env, db } = freshEnv();
  const mock = installScriptedMetaMock([]); // all default to success; content not under test here
  try {
    const a = await postBooking(env, baseBookingPayload({ client_booking_ref: 'FD-ROW-A', quoted_amount: 49 }));
    const b = await postBooking(env, baseBookingPayload({ client_booking_ref: 'FD-ROW-B', quoted_amount: 199 }));
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.notEqual(a.body.booking_id, b.body.booking_id);

    const rowA = db.prepare('SELECT quoted_amount, status, client_booking_ref FROM bookings WHERE id = ?').get(a.body.booking_id);
    const rowB = db.prepare('SELECT quoted_amount, status, client_booking_ref FROM bookings WHERE id = ?').get(b.body.booking_id);
    assert.equal(rowA.quoted_amount, 49);
    assert.equal(rowA.status, 'pending');
    assert.equal(rowA.client_booking_ref, 'FD-ROW-A');
    assert.equal(rowB.quoted_amount, 199);
    assert.equal(rowB.client_booking_ref, 'FD-ROW-B');

    const totalRows = db.prepare('SELECT COUNT(*) as n FROM bookings').get();
    assert.equal(totalRows.n, 2, 'exactly two booking rows, one per distinct client_booking_ref - booking-level idempotency (Milestone 34) is untouched by this fix');
  } finally {
    mock.restore();
  }
});
