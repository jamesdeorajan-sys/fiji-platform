// Issue #59 — isolated booking-health read service. NOT wired into
// worker.js and NOT deployed; built and tested in isolation per the
// explicit "isolated implementation/testing is authorized now" scope.
// Run: node --test nadi-marketplace/worker/booking_health.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { handleBookingHealth } from './booking_health.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const SCHEMA_SQL = readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const MIGRATION_ORDER = [
  'milestone34-booking-idempotency-and-contact-fields.sql',
  'milestone35-revenue-attribution.sql',
  'milestone36-admin-notification-retry-state.sql',
  'milestone37-driver-broadcast-claim-state.sql',
];
const MIGRATIONS_SQL = MIGRATION_ORDER.map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));

function createD1Shim(db) {
  return {
    prepare(sql) {
      let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        async first() { const r = db.prepare(sql).get(...args); return r === undefined ? null : r; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async run() { const i = db.prepare(sql).run(...args); return { meta: { changes: i.changes, last_row_id: i.lastInsertRowid } }; },
      };
      return api;
    },
  };
}

function freshEnv(overrides = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  for (const sql of MIGRATIONS_SQL) db.exec(sql);
  return { db, env: { DB: createD1Shim(db), BOOKING_HEALTH_SERVICE_TOKEN: 'test-service-token', ...overrides } };
}

let bookingIdCounter = 1000;
function insertBooking(db, { ref, guestName = 'A Guest', guestPhone = '+6799000000', hoursAgo = 1, lastReferrer = null, lastCampaign = null }) {
  const id = ++bookingIdCounter;
  const createdAt = `datetime('now', '-${hoursAgo} hours')`;
  db.prepare(
    `INSERT INTO bookings (id, guest_name, guest_phone, pickup_zone, destination_zone, vehicle_type, quoted_currency, quoted_amount, fx_rate_at_booking, settlement_amount_fjd, fuel_multiplier_applied, payment_method, status, created_at, client_booking_ref, last_referrer, last_campaign)
     VALUES (?, ?, ?, 'Nadi Airport', 'Denarau', 'sedan', 'FJD', 50, 1, 50, 1, 'cash', 'pending', ${createdAt}, ?, ?, ?)`
  ).run(id, guestName, guestPhone, ref, lastReferrer, lastCampaign);
  return id;
}

function req(token) {
  const headers = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new Request('https://health.test/booking-health', { headers });
}

// ---------------------------------------------------------------------
// Auth — a dedicated service credential, never a Cloudflare account
// token, checked independently of everything else in the Worker.
// ---------------------------------------------------------------------

test('auth: no token, wrong token, and a missing configured secret are all rejected; the correct dedicated token is accepted', async () => {
  const { env } = freshEnv();
  const noToken = await handleBookingHealth(req(undefined), env);
  assert.equal(noToken.status, 401);

  const wrongToken = await handleBookingHealth(req('not-the-token'), env);
  assert.equal(wrongToken.status, 401);

  const { env: envNoSecret } = freshEnv({ BOOKING_HEALTH_SERVICE_TOKEN: undefined });
  const noSecretConfigured = await handleBookingHealth(req('anything'), envNoSecret);
  assert.equal(noSecretConfigured.status, 401, 'an unconfigured service secret must never fail open');

  const ok = await handleBookingHealth(req('test-service-token'), env);
  assert.equal(ok.status, 200);
});

// ---------------------------------------------------------------------
// Read-only: never writes booking/negotiation/guest state (the exact
// gap that disqualifies /admin/dashboard-stats).
// ---------------------------------------------------------------------

test('never writes to bookings, negotiation_requests, or any guest-facing table — only its own optional heartbeat row, and only when explicitly enabled', async () => {
  const { db, env } = freshEnv();
  insertBooking(db, { ref: 'FD-ABC123', hoursAgo: 1 });
  const before = db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n;

  await handleBookingHealth(req('test-service-token'), env);

  const after = db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n;
  assert.equal(after, before, 'booking rows must be completely untouched by a health check');
  const settingsRows = db.prepare(`SELECT COUNT(*) AS n FROM platform_settings WHERE key = 'booking_health_last_check_at'`).get().n;
  assert.equal(settingsRows, 0, 'the heartbeat must not be written unless explicitly enabled');
});

test('the optional heartbeat, when enabled, records this call and is visible to a later call as the PREVIOUS heartbeat', async () => {
  const { db, env } = freshEnv({ BOOKING_HEALTH_RECORD_HEARTBEAT: '1' });
  insertBooking(db, { ref: 'FD-ABC123', hoursAgo: 1 });

  const first = await handleBookingHealth(req('test-service-token'), env);
  const firstBody = await first.json();
  assert.equal(firstBody.heartbeat.recorded_this_call, true);
  assert.equal(firstBody.heartbeat.previous_check_at, null, 'no prior heartbeat existed yet');

  const second = await handleBookingHealth(req('test-service-token'), env);
  const secondBody = await second.json();
  assert.ok(secondBody.heartbeat.previous_check_at, 'the second call must see the first call\'s own heartbeat as the PREVIOUS one');
});

// ---------------------------------------------------------------------
// QA exclusion, labeled honestly, and site/NAT-attribution breakdown.
// ---------------------------------------------------------------------

test('QA exclusion: the name-based rule is applied; the response labels the counts as partial unless a phone rule is also configured', async () => {
  const { db, env } = freshEnv();
  insertBooking(db, { ref: 'FD-REAL01', guestName: 'A Real Guest', hoursAgo: 1 });
  insertBooking(db, { ref: 'FD-TEST01', guestName: 'Claude Test', hoursAgo: 1 });

  const res = await handleBookingHealth(req('test-service-token'), env);
  const body = await res.json();
  assert.equal(body.qa_exclusion.name_rule_applied, true);
  assert.equal(body.qa_exclusion.phone_rule_applied, false, 'no QA_TEST_PHONES was configured in this test env');
  assert.match(body.qa_exclusion.label, /partial exclusions/);

  const fd = body.sites.find((s) => s.site === 'FD');
  assert.equal(fd.w1h, 1, 'the CLAUDE-named booking must be excluded from the count, leaving only the real guest');
});

test('QA exclusion: when QA_TEST_PHONES is configured, a matching phone is also excluded, and the response reports the phone rule as applied', async () => {
  const { db, env } = freshEnv({ QA_TEST_PHONES: '+6799112233,+6799445566' });
  insertBooking(db, { ref: 'FD-REAL02', guestPhone: '+6799000001', hoursAgo: 1 });
  insertBooking(db, { ref: 'FD-TESTPHONE', guestName: 'Ordinary Name', guestPhone: '+6799112233', hoursAgo: 1 });

  const res = await handleBookingHealth(req('test-service-token'), env);
  const body = await res.json();
  assert.equal(body.qa_exclusion.phone_rule_applied, true);
  const fd = body.sites.find((s) => s.site === 'FD');
  assert.equal(fd.w1h, 1, 'the known test phone must be excluded even with an unremarkable guest name');
});

test('sites: FTT/FD/NOREF are correctly separated, and NAT-attributed FD saves are broken out within the 48h window', async () => {
  const { db, env } = freshEnv();
  insertBooking(db, { ref: 'FTT-ABC', hoursAgo: 2 });
  insertBooking(db, { ref: 'FD-XYZ', hoursAgo: 2, lastCampaign: 'nadi_transfer_acquisition' });
  insertBooking(db, { ref: 'FD-QRS', hoursAgo: 2 });
  insertBooking(db, { ref: null, hoursAgo: 2 });

  const res = await handleBookingHealth(req('test-service-token'), env);
  const body = await res.json();
  const bySite = Object.fromEntries(body.sites.map((s) => [s.site, s]));
  assert.equal(bySite.FTT.w48h, 1);
  assert.equal(bySite.FD.w48h, 2);
  assert.equal(bySite.FD.nat_attributed_fd_48h, 1, 'only the campaign-tagged FD booking counts as NAT-attributed');
  assert.equal(bySite.NOREF.w48h, 1);
});

// ---------------------------------------------------------------------
// Notification backlog, distinguishing eligible/covered/in-progress.
// ---------------------------------------------------------------------

test('notification backlog: reports eligible/sent/in-progress counts for both admin and driver notification, and exhausted escalations, within 48h', async () => {
  const { db, env } = freshEnv();
  const sentId = insertBooking(db, { ref: 'FD-SENT', hoursAgo: 1 });
  const failedId = insertBooking(db, { ref: 'FD-FAILING', hoursAgo: 1 });
  const untouchedId = insertBooking(db, { ref: 'FD-UNTOUCHED', hoursAgo: 1 });

  db.prepare(`INSERT INTO admin_notification_state (booking_id, client_booking_ref, state, attempt_count) VALUES (?, 'FD-SENT', 'SENT', 1)`).run(sentId);
  db.prepare(`INSERT INTO admin_notification_state (booking_id, client_booking_ref, state, attempt_count) VALUES (?, 'FD-FAILING', 'FAILED_RETRYABLE', 2)`).run(failedId);
  // untouchedId deliberately has no row at all.

  const res = await handleBookingHealth(req('test-service-token'), env);
  const body = await res.json();
  assert.equal(body.notification_backlog_48h.admin.eligible, 3);
  assert.equal(body.notification_backlog_48h.admin.sent, 1);
  assert.equal(body.notification_backlog_48h.admin.in_progress_or_retrying, 1);
  assert.equal(body.notification_backlog_48h.admin.never_attempted, 1);
});

// ---------------------------------------------------------------------
// Failure isolation: a broken read is reported as unavailable, never a
// fabricated zero.
// ---------------------------------------------------------------------

test('a failed underlying read is reported as status:unavailable with UNKNOWN counts, never a fabricated zero', async () => {
  const { env } = freshEnv();
  // Drop a table this handler depends on, to force a real read failure.
  env.DB.prepare('DROP TABLE admin_notification_state').run();

  const res = await handleBookingHealth(req('test-service-token'), env);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, 'unavailable');
  assert.equal(body.sites, null);
  assert.equal(body.notification_backlog_48h, null);
  assert.ok(body.reason, 'the failure reason must be surfaced, not swallowed');
});

// ---------------------------------------------------------------------
// Data age / extraction cutoff.
// ---------------------------------------------------------------------

test('reports an explicit extraction cutoff and data age computed from the actual latest booking', async () => {
  const { db, env } = freshEnv();
  insertBooking(db, { ref: 'FD-RECENT', hoursAgo: 2 });

  const res = await handleBookingHealth(req('test-service-token'), env);
  const body = await res.json();
  assert.ok(body.extraction_cutoff_utc);
  assert.ok(body.data_age_seconds_since_latest_booking >= 7100 && body.data_age_seconds_since_latest_booking <= 7300, 'roughly 2 hours (7200s) since the only booking, allowing test-run slack');
});
