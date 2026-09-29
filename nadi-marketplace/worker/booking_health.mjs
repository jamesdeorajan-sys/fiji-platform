/* Nadi/FijiDash — isolated booking-health read service (Issue #59).
 *
 * NOT WIRED INTO worker.js's router and NOT DEPLOYED — built and
 * tested in isolation per the explicit authorization ("isolated
 * implementation/testing" is authorized now; "production deployment"
 * is separately approved). This file has no side effect on the real
 * Worker until something imports and mounts it.
 *
 * Why this exists, not a reuse of /admin/dashboard-stats: that
 * endpoint (a) unconditionally calls `expireStaleNegotiationRequests`
 * on every GET — a genuine write on what should be a pure read for an
 * always-on external monitor — and (b) returns guest_name/guest_phone/
 * driver_name/driver_phone in plaintext in two of its fields. Neither
 * is acceptable for a scheduled, external, automated consumer. This
 * module never writes booking/negotiation/guest state, and never
 * returns an individual guest or driver's contact details — only
 * fixed, hardcoded aggregate COUNT/SUM/MAX queries, never a
 * caller-supplied or dynamically-built query of any kind.
 *
 * Auth: a single, dedicated bearer secret this service alone checks
 * (`env.BOOKING_HEALTH_SERVICE_TOKEN`), timing-safe compared. This is
 * NOT a Cloudflare account API token and is never used to talk to
 * Cloudflare's own API — it is this endpoint's own, independently
 * generated credential, exactly the same shape as `ADMIN_TOKEN`
 * already uses elsewhere in this Worker. Whatever the scheduled
 * watch's own connector turns out to support is a separate, unverified
 * question (see the Issue #59 checkpoint) — this design does not
 * assume an answer to it.
 *
 * On ANY read failure (a thrown error from any of the queries below),
 * the response reports `status: 'unavailable'` and every count as
 * `null`/`'UNKNOWN'` — never a fabricated zero. A genuine zero (e.g.
 * "0 admin-notification failures") only ever appears when the read
 * that produced it actually succeeded.
 */

const WINDOWS_HOURS = [1, 6, 12, 24, 48];

function timingSafeEqual(a, b) {
  const ea = new TextEncoder().encode(String(a ?? ''));
  const eb = new TextEncoder().encode(String(b ?? ''));
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

function requireHealthServiceAuth(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token || !env.BOOKING_HEALTH_SERVICE_TOKEN) return false;
  return timingSafeEqual(token, env.BOOKING_HEALTH_SERVICE_TOKEN);
}

// The established QA name-based exclusion rule (2026-09-21 evidence
// package). The phone-based leg of that same rule is intentionally NOT
// hardcoded here — it is injected at deploy time via
// `env.QA_TEST_PHONES` (a comma-separated Worker secret, never
// committed to source), so this module can apply the COMPLETE
// documented rule in production without this file ever containing or
// exposing the actual value.
const NAME_TEST_PATTERNS = ['%CLAUDE%', '%JAMES DER%', '%JAMES DEO%'];

function qaExclusionSql(env) {
  const namePreds = NAME_TEST_PATTERNS.map(() => `UPPER(COALESCE(guest_name,'')) LIKE ?`).join(' OR ');
  const phones = (env.QA_TEST_PHONES || '').split(',').map((p) => p.trim()).filter(Boolean);
  const phonePreds = phones.map(() => `guest_phone = ?`).join(' OR ');
  const clauses = [namePreds, phonePreds].filter(Boolean).join(' OR ');
  const binds = [...NAME_TEST_PATTERNS, ...phones];
  return { clause: clauses || '0', binds, phoneRuleApplied: phones.length > 0 };
}

const SITE_CASE = `CASE WHEN client_booking_ref LIKE 'FTT-%' THEN 'FTT' WHEN client_booking_ref LIKE 'FD-%' THEN 'FD' WHEN client_booking_ref IS NULL THEN 'NOREF' ELSE 'OTHER' END`;
const NAT_ATTRIBUTED_FD = `(client_booking_ref LIKE 'FD-%' AND (COALESCE(last_referrer,'') LIKE '%nadiairporttransfers%' OR COALESCE(first_referrer,'') LIKE '%nadiairporttransfers%' OR COALESCE(first_campaign,'') LIKE '%nadi%' OR COALESCE(last_campaign,'') LIKE '%nadi%'))`;

async function readSavedRequestWindows(env) {
  const { clause: qaClause, binds: qaBinds } = qaExclusionSql(env);
  const windowSums = WINDOWS_HOURS.map(
    (h) => `SUM(CASE WHEN created_at >= datetime('now','-${h} hours') AND NOT (${qaClause}) THEN 1 ELSE 0 END) AS w${h}h`
  ).join(', ');
  const sql = `SELECT ${SITE_CASE} AS site, ${windowSums}, SUM(CASE WHEN ${NAT_ATTRIBUTED_FD} AND created_at >= datetime('now','-48 hours') AND NOT (${qaClause}) THEN 1 ELSE 0 END) AS nat_attributed_fd_48h FROM bookings GROUP BY site`;
  // Two independent placeholder sets: one per window-SUM, one for the NAT clause.
  const binds = [...Array(WINDOWS_HOURS.length).fill(qaBinds).flat(), ...qaBinds];
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return results || [];
}

async function readDataAge(env) {
  const row = await env.DB.prepare(`SELECT MAX(created_at) AS latest FROM bookings`).first();
  return row?.latest ?? null;
}

async function readNotificationBacklog(env) {
  const admin = await env.DB
    .prepare(
      `SELECT COUNT(*) AS eligible, SUM(CASE WHEN ans.state = 'SENT' THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN ans.state IN ('FAILED_RETRYABLE','ATTEMPTING') THEN 1 ELSE 0 END) AS in_progress_or_retrying,
              SUM(CASE WHEN ans.booking_id IS NULL THEN 1 ELSE 0 END) AS never_attempted
       FROM bookings b LEFT JOIN admin_notification_state ans ON ans.booking_id = b.id
       WHERE b.created_at >= datetime('now','-48 hours')`
    )
    .first();
  const driver = await env.DB
    .prepare(
      `SELECT COUNT(*) AS attempts, SUM(CASE WHEN state = 'SENT' THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN state IN ('FAILED_RETRYABLE','ATTEMPTING') THEN 1 ELSE 0 END) AS in_progress_or_retrying
       FROM driver_broadcast_attempts dba
       JOIN bookings b ON b.id = dba.booking_id
       WHERE b.created_at >= datetime('now','-48 hours')`
    )
    .first();
  const exhausted = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM booking_events WHERE event_type = 'admin_notification_exhausted' AND created_at >= datetime('now','-48 hours')`)
    .first();
  return { admin, driver, exhausted_48h: exhausted?.n ?? 0 };
}

async function readLastHeartbeat(env) {
  const row = await env.DB.prepare(`SELECT value, updated_at FROM platform_settings WHERE key = 'booking_health_last_check_at'`).first();
  return row || null;
}

// Optional, off unless the caller explicitly asks for it — writing this
// service's own invocation heartbeat is the only way a LATER,
// independent caller can detect "this endpoint itself stopped being
// reached", rather than trusting the cron's own self-report (the same
// distinction the Issue #59 checkpoint already draws for the existing
// health-check cron). Recording it is still a write, so it stays
// disabled by default and subject to the same deploy approval as
// everything else in this file.
async function recordHeartbeatIfEnabled(env, nowIso) {
  if (!env.BOOKING_HEALTH_RECORD_HEARTBEAT) return { recorded: false };
  await env.DB
    .prepare(
      `INSERT INTO platform_settings (key, value, updated_at) VALUES ('booking_health_last_check_at', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(nowIso)
    .run();
  return { recorded: true };
}

export async function handleBookingHealth(request, env) {
  if (!requireHealthServiceAuth(request, env)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }

  const nowIso = new Date().toISOString();
  const { phoneRuleApplied } = qaExclusionSql(env);
  const priorHeartbeat = await readLastHeartbeat(env).catch(() => null);

  let payload;
  try {
    const [sitesRaw, latestBookingAt, notifications] = await Promise.all([
      readSavedRequestWindows(env),
      readDataAge(env),
      readNotificationBacklog(env),
    ]);
    const dataAgeSeconds = latestBookingAt ? Math.round((Date.now() - new Date(latestBookingAt.replace(' ', 'T') + 'Z').getTime()) / 1000) : null;

    payload = {
      status: 'ok',
      extraction_cutoff_utc: nowIso,
      data_age_seconds_since_latest_booking: dataAgeSeconds,
      latest_booking_at_utc: latestBookingAt,
      qa_exclusion: { name_rule_applied: true, phone_rule_applied: phoneRuleApplied, label: 'candidate non-test saves under partial exclusions unless phone_rule_applied is true' },
      sites: sitesRaw,
      notification_backlog_48h: notifications,
      heartbeat: {
        previous_check_at: priorHeartbeat?.value ?? null,
        previous_check_recorded_at: priorHeartbeat?.updated_at ?? null,
      },
    };
  } catch (err) {
    // A failed read is reported honestly — never a fabricated zero.
    return new Response(
      JSON.stringify({
        status: 'unavailable',
        extraction_cutoff_utc: nowIso,
        reason: String(err && err.message ? err.message : err),
        sites: null,
        notification_backlog_48h: null,
      }),
      { status: 503, headers: { 'content-type': 'application/json' } }
    );
  }

  const heartbeat = await recordHeartbeatIfEnabled(env, nowIso).catch((err) => ({ recorded: false, error: String(err && err.message) }));
  payload.heartbeat.recorded_this_call = heartbeat.recorded;

  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
}
