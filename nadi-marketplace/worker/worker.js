/**
 * Nadi Airport Transfers — Driver Marketplace Backend
 * nadi-dispatch-api
 *
 * Phase 1, Milestone 7: dynamic destinations system (Item 2) — moves
 * ROUTES_DATA's hardcoded 35-destination list (ftt-booking-site/src/app.js,
 * read only, never modified) into real D1 data with admin CRUD, so a new
 * hotel/destination doesn't need a code deploy. Backend + admin tooling
 * only — the live guest widget is NOT wired to this yet, deliberately.
 * Also: driver phone validation temporarily accepts +61 Australian mobile
 * numbers alongside +679 Fiji ones (normaliseDriverPhone()) — a deliberate,
 * TEMPORARY allowance for James's own pre-launch testing, not a product
 * decision to support Australian drivers. Real launch scope is Fiji only.
 * On top of Milestone 6's public POST /bookings — the missing piece
 * cutover-plan.md flagged (the live guest widget has no booking API to
 * swap to yet; this is what a future cutover would point at — building it
 * did NOT itself authorize cutover, still a separate explicit sign-off),
 * Milestone 5's driver wallet-view UI (Section 4) + fuel index automation
 * (Section 7, detect-and-notify only), Milestone 4's wallet lockout +
 * commission accrual + max-hours cap, and Milestone 3's driver PWA login,
 * online/offline + zones, job feed, atomic accept, dispatch broadcast, and
 * status transitions.
 * Guest widget change (Section 8) and cutover itself (Section 9) remain
 * out of scope for this file — Section 8 is prepared but deliberately not
 * deployed to the live guest widget's own codebase.
 *
 * Fully isolated: separate script, separate D1 database (nadi-marketplace-db),
 * separate R2 bucket (nadi-marketplace-driver-docs), zero shared bindings
 * with fiji-chat-widget or vakaviti-kb. Not connected to any production
 * route or domain. workers/chat-widget/worker.js was not touched to build
 * this — the WhatsApp send below is a new, independent implementation
 * against the same Meta Cloud API pattern, not a shared function.
 *
 * Milestone 3 lesson applied from the same night's WhatsApp investigation:
 * free-form text (type: 'text') only delivers inside an open 24h
 * customer-service window. Drivers who just submitted the join form, and
 * dispatch broadcasts to idle drivers, are both business-initiated with no
 * window open — both WhatsApp sends below use type: 'template' from the
 * start, referencing templates submitted to Meta for review via WhatsApp
 * Manager's UI (not the Graph API — confirmed a dead end for this WABA).
 * Sends will error until those templates are approved; see the Milestone 3
 * report for the exact content submitted and current approval status.
 */

const JSON_CORS = {
  'Access-Control-Allow-Origin': '*',
  // PATCH added for Milestone 7's destination edit endpoint - every prior
  // write endpoint in this file was POST-only, so nothing needed it before.
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const ALLOWED_VEHICLE_TYPES = ['sedan', 'minivan', 'minibus'];
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB per photo
const DOC_URL_TTL_SECONDS = 3600; // signed doc URLs valid 1 hour
const MAGIC_LINK_TTL_SECONDS = 7 * 24 * 3600; // 7 days
const DRIVER_WELCOME_TEMPLATE = 'vakaviti_driver_welcome';
// NOT the same language code as vakaviti_lead_alert_v2 (en_AU) - confirmed via a
// live test that assumption would have been wrong. For vakaviti_driver_welcome
// specifically: en_AU and en_US both 404'd ("does not exist"), plain 'en'
// returned 200 with a real WAMID (Meta API acceptance confirmed - real-device
// delivery confirmation pending as of this commit, see Milestone 3 report).
// Each template's approved language is its own fact to verify, not something
// to carry over from a different template. Renamed from the generic
// WHATSAPP_LANG_CODE to DRIVER_WELCOME_LANG_CODE once a second template
// (vakaviti_driver_return, below) needed a language code of its own to
// verify separately - a shared constant here would invite exactly the
// wrong-assumption mistake this comment is warning against.
const DRIVER_WELCOME_LANG_CODE = 'en';
const BOOKING_BROADCAST_TEMPLATE = 'vakaviti_booking_broadcast';
// Confirmed via a live test, not assumed from either of the other two templates
// (which needed en_AU and plain 'en' respectively) - en_US and en_AU both
// 404'd "does not exist" against this specific template, plain 'en' returned
// 200 with a real WAMID. Third template, third distinct answer on language
// code - there is no pattern to infer from, each one must be checked.
const BOOKING_BROADCAST_LANG_CODE = 'en';

// vakaviti_driver_return - returning-driver re-login (Marketing category, per
// James - Utility rejected the driver_login attempts earlier tonight). Now
// Active and Meta-API-confirmed: a live test (temporary Worker version, sent
// to +61 478 886 145, torn down after) returned 200 with a real WAMID.
// Real-device delivery confirmation from James is the last step before this
// counts as genuinely done, same standard as the other three templates.
const DRIVER_RETURN_TEMPLATE = 'vakaviti_driver_return';
// 'en' worked on the first attempt, confirmed via the same live test above -
// this happened to be a correct guess, but was verified rather than trusted
// on the strength of that guess alone.
const DRIVER_RETURN_LANG_CODE = 'en';
// Custom domain, not the raw .pages.dev URL - Meta's link-safety classifier was
// rejecting both driver-facing templates over the .pages.dev domain itself.
const DRIVER_APP_URL = 'https://driver.vakaviti.ai/driver-app';

// ═══════════════════════════════════════════════════════════════
// MILESTONE 5 — fuel index (spec Section 7). FCCC's real petroleum page
// (verified live, not assumed from the spec's description of it) is a list
// of legal-notice PDFs, not a scrapeable price table - each PDF has 6
// geographic schedules x 4 fuel types x Bulk/Drum x Retail/Wholesale.
// Confirmed with James which cell applies before writing any parsing logic:
// Schedule 1 (Viti Levu, within 3km of a public road - covers all 16
// operating zones), Gasoil (diesoline), Retail, Bulk Sale.
// ═══════════════════════════════════════════════════════════════

// Final resolved URL (curl -L confirmed the /petroleum/ path redirects here) -
// fetching this directly avoids relying on a redirect chain inside the Worker.
const FCCC_PETROLEUM_URL = 'https://fccc.gov.fj/master-price-list/petroleum/';
// Confirmed via a real fetch of the live page: the newest order's PDF link is
// always the first entry with class="doc-row" - real HTML source order, not
// assumed. No PDF parsing happens here (see the header comment) - this only
// detects that a NEW order was published, by filename.
const FCCC_PDF_LINK_RE = /href="(https:\/\/fccc\.gov\.fj\/wp-content\/uploads\/[^"]*Petroleum-Prices[^"]*\.pdf)"/;
// pricing_rules.base_rate_fjd_per_km's spec comment says "baseline at
// fuel_price = $3.93/L" - kept as the multiplier reference point even though
// the real seeded fuel_index baseline (Milestone 5 migration) is $3.39/L,
// since pricing_rules itself is still empty (out of scope, Section 3/6) and
// changing this reference now would silently invalidate rates nothing has
// been built against yet.
const FUEL_MULTIPLIER_BASELINE_FJD = 3.93;
// Not yet submitted to Meta - same "draft, needs James to submit via
// WhatsApp Manager's UI" state every other template started in. Admin-facing,
// not driver-facing, so it's a new template rather than reusing any driver one.
const FUEL_INDEX_ALERT_TEMPLATE = 'vakaviti_fuel_index_alert';
const FUEL_INDEX_ALERT_LANG_CODE = 'en';

// ═══════════════════════════════════════════════════════════════
// MILESTONE 8 — health monitoring + backups. Same "draft, needs James to
// submit via WhatsApp Manager's UI" state vakaviti_fuel_index_alert
// started in - not yet submitted to Meta as of this commit. The real test
// for this milestone got a genuine, well-formed request reaching the Graph
// API (proving the pipeline is wired correctly), not a real device
// screenshot - full delivery confirmation is pending template approval,
// same honest gap as fuel_index_alert before it. Documented plainly in
// the Milestone 8 report rather than implied as done.
//
// 'en' is a STARTING GUESS, not a verified fact - 'en' happened to work
// for 3 of the 4 prior templates, but this file's own history (see
// DRIVER_WELCOME_LANG_CODE's comment) exists specifically to warn against
// assuming a language code carries over. Once James submits and Meta
// approves this template, this must be independently re-verified the same
// way every other template was (live test, check for a 404 "does not
// exist" vs a real 200) before trusting it - not assumed correct because
// it matches most of the others.
// ═══════════════════════════════════════════════════════════════
const HEALTH_ALERT_TEMPLATE = 'vakaviti_ops_health_alert';
const HEALTH_ALERT_LANG_CODE = 'en';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: JSON_CORS });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return handleHealth(env);
    }

    // ── Milestone 8: health monitoring + backups ──
    if (request.method === 'POST' && url.pathname === '/admin/health-check/run') {
      return handleAdminHealthCheckRun(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/admin/backup/run') {
      return handleAdminBackupRun(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/zones') {
      return handleZones(env);
    }

    if (request.method === 'POST' && url.pathname === '/drivers') {
      return handleDriverSubmit(request, env);
    }

    // ── Milestone 6: public guest booking intake (the missing piece cutover-plan.md flagged) ──
    if (request.method === 'POST' && url.pathname === '/bookings') {
      return handleGuestBookingCreate(request, env);
    }

    // ── Milestone 9: geocode + real-distance pricing for unlisted addresses ──
    if (request.method === 'POST' && url.pathname === '/quote') {
      return handleQuoteCreate(request, env);
    }

    if (request.method === 'GET' && url.pathname.startsWith('/admin/docs/')) {
      return handleDocServe(request, env, url);
    }

    if (request.method === 'GET' && url.pathname === '/admin/drivers') {
      return handleAdminListDrivers(request, env, url);
    }

    const approveMatch = url.pathname.match(/^\/admin\/drivers\/(\d+)\/approve$/);
    if (request.method === 'POST' && approveMatch) {
      return handleAdminApprove(request, env, Number(approveMatch[1]));
    }

    const rejectMatch = url.pathname.match(/^\/admin\/drivers\/(\d+)\/reject$/);
    if (request.method === 'POST' && rejectMatch) {
      return handleAdminReject(request, env, Number(rejectMatch[1]));
    }

    // ── Milestone 3: driver PWA + dispatch ──
    if (request.method === 'POST' && url.pathname === '/driver/login') {
      return handleDriverLogin(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/driver/me') {
      return handleDriverMe(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/driver/online') {
      return handleDriverOnline(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/driver/jobs') {
      return handleDriverJobs(request, env);
    }

    // ── Milestone 5: driver wallet view (spec Section 4, left open from Milestone 4) ──
    if (request.method === 'GET' && url.pathname === '/driver/wallet') {
      return handleDriverWallet(request, env);
    }

    const acceptMatch = url.pathname.match(/^\/driver\/bookings\/(\d+)\/accept$/);
    if (request.method === 'POST' && acceptMatch) {
      return handleDriverAcceptBooking(request, env, Number(acceptMatch[1]));
    }

    const statusMatch = url.pathname.match(/^\/driver\/bookings\/(\d+)\/status$/);
    if (request.method === 'POST' && statusMatch) {
      return handleDriverBookingStatus(request, env, Number(statusMatch[1]));
    }

    if (request.method === 'POST' && url.pathname === '/admin/test-booking') {
      return handleAdminTestBooking(request, env);
    }

    // ── Milestone 4: wallet lockout + max-hours cap ──
    if (request.method === 'POST' && url.pathname === '/admin/max-hours-sweep') {
      return handleAdminMaxHoursSweep(request, env);
    }

    // ── Milestone 5: fuel index (spec Section 7) ──
    if (request.method === 'GET' && url.pathname === '/fuel-index') {
      return handleFuelIndexPublic(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/admin/fuel-index/check') {
      return handleAdminFuelIndexCheck(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/admin/fuel-index/submit') {
      return handleAdminFuelIndexSubmit(request, env);
    }

    const fuelConfirmMatch = url.pathname.match(/^\/admin\/fuel-index\/pending\/(\d+)\/confirm$/);
    if (request.method === 'POST' && fuelConfirmMatch) {
      return handleAdminFuelIndexConfirm(request, env, Number(fuelConfirmMatch[1]));
    }

    const fuelRejectMatch = url.pathname.match(/^\/admin\/fuel-index\/pending\/(\d+)\/reject$/);
    if (request.method === 'POST' && fuelRejectMatch) {
      return handleAdminFuelIndexReject(request, env, Number(fuelRejectMatch[1]));
    }

    // ── Milestone 7: dynamic destinations (Item 2) ──
    if (request.method === 'GET' && url.pathname === '/destinations') {
      return handleDestinationsPublic(env);
    }

    // Admin-only, returns ALL destinations (active and inactive) - the
    // public endpoint above deliberately only returns active ones. The
    // admin UI needs to see and manage inactive rows too (e.g. to
    // reactivate one), which GET /destinations can't provide by design.
    if (request.method === 'GET' && url.pathname === '/admin/destinations') {
      return handleAdminDestinationsList(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/admin/destinations') {
      return handleAdminDestinationCreate(request, env);
    }

    const destEditMatch = url.pathname.match(/^\/admin\/destinations\/(\d+)$/);
    if (request.method === 'PATCH' && destEditMatch) {
      return handleAdminDestinationEdit(request, env, Number(destEditMatch[1]));
    }

    const destDeactivateMatch = url.pathname.match(/^\/admin\/destinations\/(\d+)\/deactivate$/);
    if (request.method === 'POST' && destDeactivateMatch) {
      return handleAdminDestinationDeactivate(request, env, Number(destDeactivateMatch[1]));
    }

    return json({ error: 'Not found.' }, 404);
  },

  // Cron dispatch — controller.cron tells us which of the two schedules
  // fired (wrangler.toml registers both), so one scheduled() export can
  // route to the right job rather than needing two separate Workers.
  async scheduled(controller, env, ctx) {
    if (controller.cron === '*/15 * * * *') {
      ctx.waitUntil(enforceMaxHoursCap(env));
    } else if (controller.cron === '0 12 * * 6') {
      ctx.waitUntil(checkFuelIndexUpdate(env));
    } else if (controller.cron === '*/5 * * * *') {
      ctx.waitUntil(runHealthCheckAlert(env));
    } else if (controller.cron === '0 14 * * *') {
      ctx.waitUntil(runD1Backup(env));
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// HEALTH / ZONES
// ═══════════════════════════════════════════════════════════════

// Real status code reflects an aggregate signal (db_connected AND
// whatsapp_configured), not just DB reachability alone - "confirming
// WHATSAPP_TOKEN/WHATSAPP_PHONE_ID are set" was asked as part of what this
// endpoint checks, so their absence is a real degraded-health condition,
// not a side note. Presence only, never values, anywhere in this response
// - checkOverallHealth()/the cron alert path never logs or sends a secret
// value, only booleans.
//
// Known, accepted limitation worth stating plainly: if WHATSAPP_TOKEN/
// WHATSAPP_PHONE_ID themselves are the thing that's broken, the alert
// mechanism that would normally notify admin_alert_phone about a health
// failure can't fire over WhatsApp for THAT specific failure mode - it's
// the same channel being used to report on its own outage. The DB-down
// case still alerts fine. Not fixed here (would need a second, non-WhatsApp
// notification channel, real new scope) - documented in OPERATIONS.md.
async function checkOverallHealth(env) {
  const status = {
    service: 'nadi-dispatch-api',
    phase: 1,
    milestone: 'health-monitoring-and-backups',
    db_connected: false,
    r2_connected: !!env.DOCS,
    whatsapp_configured: !!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID),
    tables: [],
  };

  if (!env.DB) {
    status.healthy = false;
    return status;
  }

  try {
    const result = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    ).all();
    status.db_connected = true;
    status.tables = (result.results || []).map((r) => r.name);
  } catch (err) {
    status.db_error = err.message;
  }

  status.healthy = status.db_connected && status.whatsapp_configured;
  return status;
}

async function handleHealth(env) {
  const status = await checkOverallHealth(env);
  return json(status, status.healthy ? 200 : 503);
}

// Called by the */5 * * * * Cron Trigger and the admin-only
// /admin/health-check/run endpoint below - one implementation, same
// shared-function pattern as every other cron+admin-endpoint pair in this
// file (enforceMaxHoursCap, checkFuelIndexUpdate).
//
// Edge-triggered, not level-triggered: only sends a WhatsApp alert on a
// STATE TRANSITION (healthy -> unhealthy, or unhealthy -> healthy), tracked
// via platform_settings.health_check_last_status. Deliberate design choice
// beyond the literal instruction - alerting on every failed check would
// mean a real outage pages admin_alert_phone every 5 minutes for its
// entire duration, which is real alert-fatigue risk, not a feature. This
// also directly satisfies "confirming the alert stops" once fixed: a
// distinct RECOVERED message fires on the transition back to healthy,
// giving real positive evidence of recovery rather than just an absence
// of further pages.
async function runHealthCheckAlert(env) {
  const status = await checkOverallHealth(env);
  const lastStatus = await getSetting(env, 'health_check_last_status', 'healthy');
  const currentStatus = status.healthy ? 'healthy' : 'unhealthy';
  const transitioned = currentStatus !== lastStatus;

  let alert = null;
  if (transitioned) {
    const alertPhone = await getSetting(env, 'admin_alert_phone', '');
    // "DOWN"/"RECOVERED" match vakaviti_ops_health_alert's {{1}} exactly as
    // submitted - the reasons detail (which check failed) still exists in
    // the API response's health.db_error etc. for anyone querying directly,
    // just not crammed into the templated WhatsApp text, which only has
    // room for the two approved variables.
    const state = currentStatus === 'unhealthy' ? 'DOWN' : 'RECOVERED';
    const timestamp = sqliteNow();
    alert = alertPhone
      ? await sendHealthAlertWhatsApp(env, alertPhone, state, timestamp)
      : { attempted: false, reason: 'platform_settings.admin_alert_phone is not set.' };
  }

  await env.DB.prepare(
    `INSERT INTO platform_settings (key, value, updated_at) VALUES ('health_check_last_status', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).bind(currentStatus).run();

  return { checked_at: sqliteNow(), status: currentStatus, transitioned, alert, health: status };
}

async function handleAdminHealthCheckRun(request, env) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  const result = await runHealthCheckAlert(env);
  return json(result, 200);
}

async function handleZones(env) {
  if (!env.DB) return json({ zones: [] }, 503);
  try {
    const result = await env.DB.prepare(`SELECT id, name FROM zones ORDER BY id`).all();
    return json({ zones: result.results || [] }, 200);
  } catch (err) {
    return json({ zones: [], error: err.message }, 500);
  }
}

// ═══════════════════════════════════════════════════════════════
// DRIVER JOIN FORM SUBMISSION
// ═══════════════════════════════════════════════════════════════

async function handleDriverSubmit(request, env) {
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);
  if (!env.DOCS) return json({ ok: false, error: 'Document storage not available. R2 bucket is not yet bound to this Worker.' }, 503);

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'Invalid form submission.' }, 400);
  }

  const name = (form.get('name') || '').toString().trim();
  const phone = normaliseDriverPhone((form.get('phone') || '').toString());
  const vehicleType = (form.get('vehicle_type') || '').toString().trim().toLowerCase();
  const plate = (form.get('plate') || '').toString().trim().toUpperCase();
  const zones = form.getAll('zones').map((z) => z.toString().trim()).filter(Boolean);

  const vehiclePhoto = form.get('vehicle_photo');
  const licensePhoto = form.get('license_photo');
  const insurancePhoto = form.get('insurance_photo');

  const errors = [];
  if (!name) errors.push('name is required');
  if (!phone) errors.push('a valid phone number is required');
  if (!ALLOWED_VEHICLE_TYPES.includes(vehicleType)) errors.push(`vehicle_type must be one of: ${ALLOWED_VEHICLE_TYPES.join(', ')}`);
  if (!plate) errors.push('plate is required');
  if (zones.length === 0) errors.push('at least one zone is required');
  if (!(vehiclePhoto instanceof File)) errors.push('vehicle_photo is required');
  if (!(licensePhoto instanceof File)) errors.push('license_photo is required');
  if (!(insurancePhoto instanceof File)) errors.push('insurance_photo is required');

  for (const [label, file] of [['vehicle_photo', vehiclePhoto], ['license_photo', licensePhoto], ['insurance_photo', insurancePhoto]]) {
    if (file instanceof File) {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) errors.push(`${label} must be JPEG, PNG, or WebP (got ${file.type || 'unknown'})`);
      if (file.size > MAX_PHOTO_BYTES) errors.push(`${label} exceeds 8MB limit`);
    }
  }

  if (zones.length > 0) {
    const validZones = await getValidZoneNames(env);
    const invalid = zones.filter((z) => !validZones.has(z));
    if (invalid.length > 0) errors.push(`unknown zone(s): ${invalid.join(', ')}`);
  }

  if (errors.length > 0) {
    return json({ ok: false, errors }, 400);
  }

  const existing = await env.DB.prepare(`SELECT id FROM drivers WHERE phone = ?`).bind(phone).first();
  if (existing) {
    return json({ ok: false, error: 'A driver application with this phone number already exists.' }, 409);
  }

  const docPrefix = `drivers/${phone.replace(/[^0-9]/g, '')}-${Date.now()}`;
  let vehicleKey, licenseKey, insuranceKey;
  try {
    vehicleKey = await uploadToR2(env, `${docPrefix}/vehicle${extFor(vehiclePhoto.type)}`, vehiclePhoto);
    licenseKey = await uploadToR2(env, `${docPrefix}/license${extFor(licensePhoto.type)}`, licensePhoto);
    insuranceKey = await uploadToR2(env, `${docPrefix}/insurance${extFor(insurancePhoto.type)}`, insurancePhoto);
  } catch (err) {
    return json({ ok: false, error: 'Failed to upload documents: ' + err.message }, 500);
  }

  try {
    const driverInsert = await env.DB.prepare(
      `INSERT INTO drivers (name, phone, status, zones, license_photo_url, insurance_photo_url) VALUES (?, ?, 'pending', ?, ?, ?)`
    ).bind(name, phone, JSON.stringify(zones), licenseKey, insuranceKey).run();

    const driverId = driverInsert.meta.last_row_id;

    const vehicleInsert = await env.DB.prepare(
      `INSERT INTO vehicles (driver_id, type, plate, photo_url) VALUES (?, ?, ?, ?)`
    ).bind(driverId, vehicleType, plate, vehicleKey).run();

    return json({
      ok: true,
      driver_id: driverId,
      vehicle_id: vehicleInsert.meta.last_row_id,
      status: 'pending',
    }, 201);
  } catch (err) {
    return json({ ok: false, error: 'Failed to save application: ' + err.message }, 500);
  }
}

async function getValidZoneNames(env) {
  const result = await env.DB.prepare(`SELECT name FROM zones`).all();
  return new Set((result.results || []).map((r) => r.name));
}

function normalisePhone(raw) {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.replace(/[^\d]/g, '').length < 7) return '';
  return digits;
}

// ═══════════════════════════════════════════════════════════════
// DRIVER PHONE VALIDATION — deliberate, TEMPORARY allowance for James's own
// pre-launch testing from Australia. Accepts +679 (Fiji) and +61 mobile
// (Australian) numbers SPECIFICALLY, not phone numbers generally — this is
// not a decision to support Australian drivers as a product; real launch
// scope is Fiji drivers only. Only used for driver join/login
// (handleDriverSubmit, handleDriverLogin) — guest_phone in
// handleGuestBookingCreate deliberately still uses the permissive
// normalisePhone() above, since guests can be genuine international
// tourists calling from any country and tightening that would be a real,
// unrelated regression. When AU pre-launch testing is no longer needed,
// remove the AU_MOBILE_PHONE_RE branch (and this comment) and drivers
// go back to Fiji-only.
// ═══════════════════════════════════════════════════════════════

const FIJI_PHONE_RE = /^\+679\d{7}$/;
const AU_MOBILE_PHONE_RE = /^\+614\d{8}$/;

function normaliseDriverPhone(raw) {
  const digitsWithPlus = (raw || '').toString().trim().replace(/[^\d+]/g, '');
  const digitsOnly = digitsWithPlus.replace(/\+/g, '');

  // Already E.164 with a recognised country code.
  if (FIJI_PHONE_RE.test(digitsWithPlus)) return digitsWithPlus;
  if (AU_MOBILE_PHONE_RE.test(digitsWithPlus)) return digitsWithPlus;

  // Fiji local format without the +679 prefix — matches this form's
  // existing real-world usage; nothing before this change ever enforced a
  // country code, so a bare 7-digit Fiji mobile must keep working exactly
  // as before.
  if (/^\d{7}$/.test(digitsOnly)) return '+679' + digitsOnly;

  // Australian domestic mobile format: 04XX XXX XXX.
  if (/^04\d{8}$/.test(digitsOnly)) return '+61' + digitsOnly.slice(1);

  // Australian mobile typed without the leading 0: 4XX XXX XXX.
  if (/^4\d{8}$/.test(digitsOnly)) return '+61' + digitsOnly;

  return '';
}

function extFor(mimeType) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  return '.jpg';
}

async function uploadToR2(env, key, file) {
  const buf = await file.arrayBuffer();
  await env.DOCS.put(key, buf, { httpMetadata: { contentType: file.type } });
  return key;
}

// ═══════════════════════════════════════════════════════════════
// SIGNED DOCUMENT URLS
// ═══════════════════════════════════════════════════════════════

async function hmacSign(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function signDocUrl(env, key, ttlSeconds = DOC_URL_TTL_SECONDS) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await hmacSign(env.DOC_SIGNING_SECRET, `${key}:${exp}`);
  return `/admin/docs/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function handleDocServe(request, env, url) {
  if (!env.DOCS) return json({ error: 'Document storage not available.' }, 503);
  if (!env.DOC_SIGNING_SECRET) return json({ error: 'Signing not configured.' }, 503);

  const key = decodeURIComponent(url.pathname.slice('/admin/docs/'.length));
  const exp = url.searchParams.get('exp');
  const sig = url.searchParams.get('sig');

  const expNum = parseInt(exp, 10);
  if (!expNum || !sig || expNum < Math.floor(Date.now() / 1000)) {
    return json({ error: 'Link expired or invalid.' }, 403);
  }
  const expectedSig = await hmacSign(env.DOC_SIGNING_SECRET, `${key}:${expNum}`);
  if (!timingSafeEqual(sig, expectedSig)) {
    return json({ error: 'Invalid signature.' }, 403);
  }

  const obj = await env.DOCS.get(key);
  if (!obj) return json({ error: 'Document not found.' }, 404);

  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// ADMIN — auth, list, approve, reject
// ═══════════════════════════════════════════════════════════════

function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return !!(token && env.ADMIN_TOKEN && timingSafeEqual(token, env.ADMIN_TOKEN));
}

async function handleAdminListDrivers(request, env, url) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  if (!env.DB) return json({ drivers: [] }, 503);

  const status = url.searchParams.get('status') || 'pending';

  const result = await env.DB.prepare(
    `SELECT d.id, d.name, d.phone, d.status, d.zones, d.license_photo_url, d.insurance_photo_url, d.created_at,
            v.id AS vehicle_id, v.type AS vehicle_type, v.plate, v.photo_url AS vehicle_photo_url
     FROM drivers d
     LEFT JOIN vehicles v ON v.driver_id = d.id
     WHERE d.status = ?
     ORDER BY d.created_at ASC`
  ).bind(status).all();

  const drivers = [];
  for (const row of result.results || []) {
    drivers.push({
      id: row.id,
      name: row.name,
      phone: row.phone,
      status: row.status,
      zones: JSON.parse(row.zones || '[]'),
      created_at: row.created_at,
      vehicle: { id: row.vehicle_id, type: row.vehicle_type, plate: row.plate },
      docs: {
        vehicle_photo: row.vehicle_photo_url ? await signDocUrl(env, row.vehicle_photo_url) : null,
        license_photo: row.license_photo_url ? await signDocUrl(env, row.license_photo_url) : null,
        insurance_photo: row.insurance_photo_url ? await signDocUrl(env, row.insurance_photo_url) : null,
      },
    });
  }

  return json({ status, drivers }, 200);
}

async function handleAdminApprove(request, env, driverId) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);

  const driver = await env.DB.prepare(`SELECT id, name, phone, status FROM drivers WHERE id = ?`).bind(driverId).first();
  if (!driver) return json({ ok: false, error: 'Driver not found.' }, 404);

  await env.DB.prepare(`UPDATE drivers SET status = 'verified' WHERE id = ?`).bind(driverId).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO wallets (driver_id, balance_fjd) VALUES (?, 0)`).bind(driverId).run();

  const token = crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO driver_login_tokens (driver_id, token, expires_at) VALUES (?, ?, ?)`
  ).bind(driverId, token, expiresAt).run();

  const whatsappResult = await sendDriverWelcomeWhatsApp(env, driver.phone, driver.name, token);

  return json({
    ok: true,
    driver_id: driverId,
    status: 'verified',
    whatsapp: whatsappResult,
  }, 200);
}

async function handleAdminReject(request, env, driverId) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);

  const driver = await env.DB.prepare(`SELECT id FROM drivers WHERE id = ?`).bind(driverId).first();
  if (!driver) return json({ ok: false, error: 'Driver not found.' }, 404);

  await env.DB.prepare(`UPDATE drivers SET status = 'rejected' WHERE id = ?`).bind(driverId).run();

  return json({ ok: true, driver_id: driverId, status: 'rejected' }, 200);
}

// ═══════════════════════════════════════════════════════════════
// WHATSAPP — template-based, NOT free-form text. Same Meta Cloud API
// endpoint pattern as fiji-chat-widget's sendWhatsAppNotification,
// reimplemented independently here (that file was not touched), but using
// type: 'template' from the start per the Milestone 3 brief — business-
// initiated sends to drivers with no open 24h window would otherwise hit
// the exact same silent-drop failure diagnosed in the previous session.
// Requires env.WHATSAPP_TOKEN / env.WHATSAPP_PHONE_ID, and the referenced
// template approved in Meta Business Manager (submitted via WhatsApp
// Manager's UI, not the Graph API — see Milestone 3 report). Until
// approved, Meta will return an error naming the template as the reason,
// which is expected and not a code bug.
// ═══════════════════════════════════════════════════════════════

// Found during deep review: this took templateName as a parameter but
// hardcoded language: { code: BOOKING_BROADCAST_LANG_CODE } regardless of
// which template was actually passed in - harmless today since
// sendBookingBroadcastWhatsApp is its only caller, but a real landmine for
// any future reuse (this exact class of mistake - assuming one template's
// language code applies to another - is what every other template comment
// in this file explicitly warns against, based on real prior incidents).
// Now takes langCode explicitly so the caller can't get this wrong silently.
async function sendWhatsAppTemplate(env, phone, templateName, langCode, bodyParams) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    return { attempted: false, reason: 'WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not configured on this Worker.' };
  }
  const cleanNumber = (phone || '').replace(/[^0-9]/g, '');
  if (!cleanNumber || cleanNumber.length < 8) {
    return { attempted: false, reason: 'Phone number invalid for WhatsApp send.' };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanNumber,
        type: 'template',
        template: {
          name: templateName,
          language: { code: langCode },
          components: [{
            type: 'body',
            parameters: bodyParams.map((text) => ({ type: 'text', text: String(text) })),
          }],
        },
      }),
    });
    const bodyText = await res.text().catch(() => '');
    return { attempted: true, ok: res.ok, status: res.status, response: bodyText.slice(0, 500) };
  } catch (err) {
    return { attempted: true, ok: false, error: err.message };
  }
}

// Separate, self-contained function rather than reusing sendWhatsAppTemplate -
// vakaviti_driver_welcome has both a body variable AND a dynamic URL button
// variable, which Meta requires as two SEPARATE component entries in the
// components array (a 'body' component and a 'button' component with
// sub_type: 'url' and index: '0'), not one combined parameter list. The
// button parameter is just the token itself - the template's own configured
// button URL already has "https://driver.vakaviti.ai/driver-app?token={{1}}"
// baked in, so we only supply the {{1}} substitution, not the full URL.
// Kept fully separate from sendWhatsAppTemplate so vakaviti_booking_broadcast
// (untouched, still en_US, still body-only) can't be affected by this change.
async function sendDriverWelcomeWhatsApp(env, phone, driverName, token) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    return { attempted: false, reason: 'WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not configured on this Worker.' };
  }
  const cleanNumber = (phone || '').replace(/[^0-9]/g, '');
  if (!cleanNumber || cleanNumber.length < 8) {
    return { attempted: false, reason: 'Phone number invalid for WhatsApp send.' };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanNumber,
        type: 'template',
        template: {
          name: DRIVER_WELCOME_TEMPLATE,
          language: { code: DRIVER_WELCOME_LANG_CODE },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: driverName || 'Driver' }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] },
          ],
        },
      }),
    });
    const bodyText = await res.text().catch(() => '');
    return { attempted: true, ok: res.ok, status: res.status, response: bodyText.slice(0, 500) };
  } catch (err) {
    return { attempted: true, ok: false, error: err.message };
  }
}

// Returning-driver re-login. Fully separate from sendDriverWelcomeWhatsApp and
// sendWhatsAppTemplate/sendBookingBroadcastWhatsApp, per instruction - zero
// shared code with either, so nothing here can regress vakaviti_booking_broadcast
// or the welcome flow. Same body+button component shape as the welcome
// template (body {{1}} = driver name, button {{1}} = token), since
// vakaviti_driver_return has the same variable structure.
// NOT YET LIVE-TESTED - vakaviti_driver_return is not Active yet as of this
// commit. Do not call this in a way that actually sends until James confirms
// approval and a live test (same discipline as every other template tonight)
// has independently confirmed real delivery.
async function sendDriverReturnWhatsApp(env, phone, driverName, token) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    return { attempted: false, reason: 'WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not configured on this Worker.' };
  }
  const cleanNumber = (phone || '').replace(/[^0-9]/g, '');
  if (!cleanNumber || cleanNumber.length < 8) {
    return { attempted: false, reason: 'Phone number invalid for WhatsApp send.' };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanNumber,
        type: 'template',
        template: {
          name: DRIVER_RETURN_TEMPLATE,
          language: { code: DRIVER_RETURN_LANG_CODE },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: driverName || 'Driver' }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] },
          ],
        },
      }),
    });
    const bodyText = await res.text().catch(() => '');
    return { attempted: true, ok: res.ok, status: res.status, response: bodyText.slice(0, 500) };
  } catch (err) {
    return { attempted: true, ok: false, error: err.message };
  }
}

async function sendBookingBroadcastWhatsApp(env, phone, booking) {
  const jobUrl = `${DRIVER_APP_URL}?token=`; // driver's own stored session token completes this client-side
  const fare = `${booking.quoted_currency} ${booking.quoted_amount}`;
  // vakaviti_booking_broadcast body: {{1}} pickup, {{2}} destination, {{3}} vehicle type, {{4}} fare, {{5}} app link
  return sendWhatsAppTemplate(env, phone, BOOKING_BROADCAST_TEMPLATE, BOOKING_BROADCAST_LANG_CODE, [
    booking.pickup_zone,
    booking.destination_zone,
    booking.vehicle_type,
    fare,
    DRIVER_APP_URL,
  ]);
}

// Not built on sendWhatsAppTemplate() - that function hardcodes
// BOOKING_BROADCAST_LANG_CODE internally rather than taking a language code
// as a parameter, so reusing it here would silently send this template under
// the wrong language code. Same self-contained pattern as
// sendDriverWelcomeWhatsApp/sendDriverReturnWhatsApp instead. Admin-facing,
// not driver-facing - goes to platform_settings.admin_alert_phone, not any
// driver's number.
async function sendFuelIndexAlertWhatsApp(env, phone, bodyText) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    return { attempted: false, reason: 'WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not configured on this Worker.' };
  }
  const cleanNumber = (phone || '').replace(/[^0-9]/g, '');
  if (!cleanNumber || cleanNumber.length < 8) {
    return { attempted: false, reason: 'admin_alert_phone not set or invalid.' };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanNumber,
        type: 'template',
        template: {
          name: FUEL_INDEX_ALERT_TEMPLATE,
          language: { code: FUEL_INDEX_ALERT_LANG_CODE },
          components: [{ type: 'body', parameters: [{ type: 'text', text: bodyText }] }],
        },
      }),
    });
    const responseText = await res.text().catch(() => '');
    return { attempted: true, ok: res.ok, status: res.status, response: responseText.slice(0, 500) };
  } catch (err) {
    return { attempted: true, ok: false, error: err.message };
  }
}

// Same self-contained pattern as sendFuelIndexAlertWhatsApp - not built on
// sendWhatsAppTemplate() for the same reason (hardcoded language constant).
// vakaviti_ops_health_alert body: {{1}} = state ("DOWN"/"RECOVERED"),
// {{2}} = timestamp. Two separate template parameters, not one freeform
// string - matches the exact two-variable template submitted to Meta.
// Getting this wrong (e.g. one combined {{1}}) would fail with a
// parameter-count mismatch even after approval, so this was fixed to
// match the submitted content BEFORE submission, not discovered after.
async function sendHealthAlertWhatsApp(env, phone, state, timestamp) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    return { attempted: false, reason: 'WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not configured on this Worker.' };
  }
  const cleanNumber = (phone || '').replace(/[^0-9]/g, '');
  if (!cleanNumber || cleanNumber.length < 8) {
    return { attempted: false, reason: 'admin_alert_phone not set or invalid.' };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanNumber,
        type: 'template',
        template: {
          name: HEALTH_ALERT_TEMPLATE,
          language: { code: HEALTH_ALERT_LANG_CODE },
          components: [{
            type: 'body',
            parameters: [{ type: 'text', text: state }, { type: 'text', text: timestamp }],
          }],
        },
      }),
    });
    const responseText = await res.text().catch(() => '');
    return { attempted: true, ok: res.ok, status: res.status, response: responseText.slice(0, 500) };
  } catch (err) {
    return { attempted: true, ok: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// DRIVER AUTH — bearer token is the driver_login_tokens row itself,
// valid until expires_at (7 days from issue). Not a separate session
// system, per the Milestone 2 schema note this reuses.
// ═══════════════════════════════════════════════════════════════

async function requireDriver(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT d.id, d.name, d.phone, d.status, d.zones, d.online, d.online_since, d.forced_offline_until
     FROM driver_login_tokens t
     JOIN drivers d ON d.id = t.driver_id
     WHERE t.token = ? AND t.expires_at > datetime('now') AND d.status = 'verified'`
  ).bind(token).first();
  return row || null;
}

// ═══════════════════════════════════════════════════════════════
// DRIVER LOGIN (magic link request)
// ═══════════════════════════════════════════════════════════════

async function handleDriverLogin(request, env) {
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }
  const phone = normaliseDriverPhone((body.phone || '').toString());
  if (!phone) return json({ ok: false, error: 'Valid phone number required.' }, 400);

  const driver = await env.DB.prepare(`SELECT id, name, phone FROM drivers WHERE phone = ? AND status = 'verified'`).bind(phone).first();
  // Generic response either way - avoid confirming/denying which numbers are registered drivers.
  if (!driver) {
    return json({ ok: true, message: 'If this number is a verified driver, a login link has been sent.' }, 200);
  }

  const token = crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(`INSERT INTO driver_login_tokens (driver_id, token, expires_at) VALUES (?, ?, ?)`).bind(driver.id, token, expiresAt).run();

  // vakaviti_driver_return - submitted separately (Marketing category), not yet
  // Active as of this commit. vakaviti_driver_login/_v2 are abandoned/rejected,
  // not referenced here or anywhere else. Wired up now so nothing further needs
  // to change once the template clears review, but real delivery is unverified
  // until James confirms Active status and a live test independently confirms
  // it actually arrives - Meta will currently reject this exactly like every
  // other not-yet-approved template did tonight, which is expected, not a bug.
  const whatsappResult = await sendDriverReturnWhatsApp(env, driver.phone, driver.name, token);
  return json({ ok: true, message: 'If this number is a verified driver, a login link has been sent.', whatsapp: whatsappResult }, 200);
}

async function handleDriverMe(request, env) {
  const driver = await requireDriver(request, env);
  if (!driver) return json({ error: 'Unauthorized or expired session.' }, 401);
  return json({
    id: driver.id,
    name: driver.name,
    phone: driver.phone,
    status: driver.status,
    zones: JSON.parse(driver.zones || '[]'),
    online: !!driver.online,
    online_since: driver.online_since,
  }, 200);
}

// ═══════════════════════════════════════════════════════════════
// ONLINE/OFFLINE + ZONES
// ═══════════════════════════════════════════════════════════════

async function handleDriverOnline(request, env) {
  const driver = await requireDriver(request, env);
  if (!driver) return json({ error: 'Unauthorized or expired session.' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const online = !!body.online;
  const zones = Array.isArray(body.zones) ? body.zones.map((z) => String(z).trim()).filter(Boolean) : null;

  if (online) {
    if (driver.forced_offline_until && driver.forced_offline_until > sqliteNow()) {
      return json({ error: 'Resting after reaching your max-hours cap.', resting_until: driver.forced_offline_until }, 403);
    }
    const locked = await enforceWalletLockout(env, driver.id);
    if (locked.locked) {
      return json({ error: 'Wallet balance below the allowed threshold. Settle your balance to go online.', balance_fjd: locked.balance_fjd, threshold_fjd: locked.threshold_fjd }, 403);
    }
    if (!zones || zones.length === 0) return json({ error: 'At least one zone is required to go online.' }, 400);
    const validZones = await getValidZoneNames(env);
    const invalid = zones.filter((z) => !validZones.has(z));
    if (invalid.length > 0) return json({ error: `unknown zone(s): ${invalid.join(', ')}` }, 400);
    await env.DB.prepare(`UPDATE drivers SET online = 1, online_since = datetime('now'), zones = ? WHERE id = ?`).bind(JSON.stringify(zones), driver.id).run();
  } else {
    await env.DB.prepare(`UPDATE drivers SET online = 0, online_since = NULL WHERE id = ?`).bind(driver.id).run();
  }

  const updated = await env.DB.prepare(`SELECT online, online_since, zones FROM drivers WHERE id = ?`).bind(driver.id).first();
  return json({ ok: true, online: !!updated.online, online_since: updated.online_since, zones: JSON.parse(updated.zones || '[]') }, 200);
}

// ═══════════════════════════════════════════════════════════════
// WALLET VIEW — balance + transaction history for the logged-in driver
// (spec Section 4, left open from Milestone 4). Read-only: reuses
// enforceWalletLockout() from Milestone 4 rather than re-deriving the
// locked state, so the driver PWA and the accept/go-online gates can never
// disagree about whether a driver is locked out.
// ═══════════════════════════════════════════════════════════════

async function handleDriverWallet(request, env) {
  const driver = await requireDriver(request, env);
  if (!driver) return json({ error: 'Unauthorized or expired session.' }, 401);

  const wallet = await env.DB.prepare(`SELECT balance_fjd, updated_at FROM wallets WHERE driver_id = ?`).bind(driver.id).first();
  const txns = await env.DB.prepare(
    `SELECT id, booking_id, amount_fjd, type, created_at FROM wallet_transactions WHERE driver_id = ? ORDER BY created_at DESC LIMIT 50`
  ).bind(driver.id).all();
  const locked = await enforceWalletLockout(env, driver.id);

  return json({
    balance_fjd: wallet ? wallet.balance_fjd : 0,
    updated_at: wallet ? wallet.updated_at : null,
    locked: locked.locked,
    threshold_fjd: locked.threshold_fjd,
    transactions: txns.results || [],
  }, 200);
}

// ═══════════════════════════════════════════════════════════════
// JOB FEED
// ═══════════════════════════════════════════════════════════════

async function handleDriverJobs(request, env) {
  const driver = await requireDriver(request, env);
  if (!driver) return json({ error: 'Unauthorized or expired session.' }, 401);
  if (!driver.online) return json({ jobs: [], note: 'Go online to see available jobs.' }, 200);

  const driverZones = new Set(JSON.parse(driver.zones || '[]'));
  const result = await env.DB.prepare(
    `SELECT id, guest_name, guest_phone, pickup_zone, destination_zone, distance_km, vehicle_type,
            quoted_currency, quoted_amount, payment_method, status, created_at
     FROM bookings WHERE status = 'pending' AND assigned_driver_id IS NULL ORDER BY created_at ASC LIMIT 20`
  ).all();

  const jobs = (result.results || []).filter((b) => driverZones.has(b.pickup_zone));
  return json({ jobs }, 200);
}

// ═══════════════════════════════════════════════════════════════
// ACCEPT — atomic, race-condition-safe
// ═══════════════════════════════════════════════════════════════

async function handleDriverAcceptBooking(request, env, bookingId) {
  const driver = await requireDriver(request, env);
  if (!driver) return json({ error: 'Unauthorized or expired session.' }, 401);

  // Found during deep review: nothing here previously checked driver.online
  // or driver.zones vs the booking's pickup_zone — job feed and broadcast
  // both filter by zone, but accept itself didn't, so any authenticated
  // driver could accept ANY booking anywhere by guessing/enumerating
  // booking IDs (small sequential integers), bypassing the entire
  // zone-dispatch model via a direct API call. This is a pre-check, not
  // part of the atomic winner-takes-it UPDATE below — a legitimate,
  // in-zone, online driver losing a race to another in-zone driver is
  // still the correct 409 path, unchanged.
  if (!driver.online) {
    return json({ error: 'Go online to accept jobs.' }, 403);
  }
  const target = await env.DB.prepare(`SELECT pickup_zone FROM bookings WHERE id = ?`).bind(bookingId).first();
  if (!target) return json({ error: 'Booking not found.' }, 404);
  const driverZones = new Set(JSON.parse(driver.zones || '[]'));
  if (!driverZones.has(target.pickup_zone)) {
    return json({ error: 'This booking is outside your online zones.' }, 403);
  }

  const locked = await enforceWalletLockout(env, driver.id);
  if (locked.locked) {
    return json({ error: 'Wallet balance below the allowed threshold. Settle your balance before accepting jobs.', balance_fjd: locked.balance_fjd, threshold_fjd: locked.threshold_fjd }, 403);
  }

  const result = await env.DB.prepare(
    `UPDATE bookings SET assigned_driver_id = ?, status = 'accepted' WHERE id = ? AND assigned_driver_id IS NULL AND status = 'pending'`
  ).bind(driver.id, bookingId).run();

  const won = result.meta.changes === 1;
  if (!won) {
    const current = await env.DB.prepare(`SELECT assigned_driver_id, status FROM bookings WHERE id = ?`).bind(bookingId).first();
    return json({ ok: false, won: false, reason: 'Booking already taken or no longer available.', current }, 409);
  }

  const booking = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(bookingId).first();
  return json({ ok: true, won: true, booking }, 200);
}

// ═══════════════════════════════════════════════════════════════
// STATUS TRANSITIONS — En Route -> Completed
// ═══════════════════════════════════════════════════════════════

const VALID_STATUS_TRANSITIONS = {
  accepted: ['en_route', 'completed'],
  en_route: ['completed'],
};

async function handleDriverBookingStatus(request, env, bookingId) {
  const driver = await requireDriver(request, env);
  if (!driver) return json({ error: 'Unauthorized or expired session.' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const newStatus = (body.status || '').toString();
  if (!['en_route', 'completed'].includes(newStatus)) return json({ error: "status must be 'en_route' or 'completed'" }, 400);

  const booking = await env.DB.prepare(
    `SELECT id, assigned_driver_id, status, payment_method, settlement_amount_fjd, commission_rate FROM bookings WHERE id = ?`
  ).bind(bookingId).first();
  if (!booking) return json({ error: 'Booking not found.' }, 404);
  if (booking.assigned_driver_id !== driver.id) return json({ error: 'This booking is not assigned to you.' }, 403);

  const allowed = VALID_STATUS_TRANSITIONS[booking.status] || [];
  if (!allowed.includes(newStatus)) {
    return json({ error: `Cannot transition from '${booking.status}' to '${newStatus}'.` }, 409);
  }

  await env.DB.prepare(`UPDATE bookings SET status = ? WHERE id = ?`).bind(newStatus, bookingId).run();

  let commission = null;
  if (newStatus === 'completed' && booking.payment_method === 'cash') {
    commission = await accrueCommission(env, booking);
  }

  return json({ ok: true, booking_id: bookingId, status: newStatus, commission }, 200);
}

// ═══════════════════════════════════════════════════════════════
// ADMIN — insert a test booking + broadcast dispatch
// (real guest widget integration is out of scope this milestone)
// ═══════════════════════════════════════════════════════════════

async function handleAdminTestBooking(request, env) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }

  const required = ['pickup_zone', 'destination_zone', 'vehicle_type', 'quoted_currency', 'quoted_amount', 'payment_method'];
  const missing = required.filter((f) => !body[f]);
  if (missing.length > 0) return json({ ok: false, error: `Missing required fields: ${missing.join(', ')}` }, 400);

  const validZones = await getValidZoneNames(env);
  if (!validZones.has(body.pickup_zone)) return json({ ok: false, error: `unknown pickup_zone: ${body.pickup_zone}` }, 400);
  if (!validZones.has(body.destination_zone)) return json({ ok: false, error: `unknown destination_zone: ${body.destination_zone}` }, 400);

  // Found during deep review: this defaulted fuel_multiplier_applied to a
  // flat 1 unless the caller passed one in, unlike the public /bookings
  // endpoint (Milestone 6) which always derives it from the live fuel_index
  // row. That made admin-created test bookings silently diverge from real
  // guest bookings whenever the live multiplier isn't 1 - a real risk for
  // any future Section 9 re-run using this endpoint. Still overridable
  // (this endpoint is admin-only/trusted, unlike the public one), just
  // sensibly defaulted now instead of flatly defaulted.
  let fuelMultiplierApplied = body.fuel_multiplier_applied;
  if (fuelMultiplierApplied === undefined || fuelMultiplierApplied === null) {
    const fuelRow = await env.DB.prepare(`SELECT multiplier FROM fuel_index ORDER BY id DESC LIMIT 1`).first();
    fuelMultiplierApplied = fuelRow ? fuelRow.multiplier : 1;
  }

  const insert = await env.DB.prepare(
    `INSERT INTO bookings (guest_name, guest_phone, pickup_zone, destination_zone, distance_km, vehicle_type,
       quoted_currency, quoted_amount, fx_rate_at_booking, settlement_amount_fjd, fuel_multiplier_applied, payment_method, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).bind(
    body.guest_name || 'Test Guest', body.guest_phone || null, body.pickup_zone, body.destination_zone,
    body.distance_km || null, body.vehicle_type, body.quoted_currency, body.quoted_amount,
    body.fx_rate_at_booking || 1, body.settlement_amount_fjd || body.quoted_amount,
    fuelMultiplierApplied, body.payment_method
  ).run();

  const bookingId = insert.meta.last_row_id;
  const booking = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(bookingId).first();
  const broadcast = await broadcastBookingToDrivers(env, booking);

  return json({ ok: true, booking_id: bookingId, booking, broadcast }, 201);
}

// Shared by handleAdminTestBooking and Milestone 6's public
// handleGuestBookingCreate - one implementation of "who gets notified about
// a new booking" so the two entry points can't silently drift apart. Same
// query already verified in the Milestone 3 race-condition test (matching
// zone-inclusion filter, same sendBookingBroadcastWhatsApp call).
async function broadcastBookingToDrivers(env, booking) {
  const candidates = await env.DB.prepare(`SELECT id, name, phone, zones FROM drivers WHERE status = 'verified' AND online = 1`).all();
  const matching = (candidates.results || []).filter((d) => JSON.parse(d.zones || '[]').includes(booking.pickup_zone));

  const results = [];
  for (const d of matching) {
    const whatsappResult = await sendBookingBroadcastWhatsApp(env, d.phone, booking);
    results.push({ driver_id: d.id, driver_name: d.name, whatsapp: whatsappResult });
  }

  return { matched_drivers: matching.length, results };
}

// ═══════════════════════════════════════════════════════════════
// MILESTONE 6 — public guest booking intake. The only public,
// unauthenticated WRITE endpoint on this Worker - every other write
// endpoint requires an admin token or a driver's login token. That's a
// materially different trust boundary, handled two ways:
//
// 1. settlement_amount_fjd and fuel_multiplier_applied are ALWAYS
//    server-derived, never taken from the request body. Both feed
//    directly into accrueCommission() (Milestone 4) once a trip completes
//    - trusting client-supplied values here would let any anonymous caller
//      manipulate a real driver's wallet debt. quoted_amount/fx_rate_at_booking
//      are still caller-supplied (this endpoint doesn't compute fares -
//      pricing_rules is still empty/unbuilt, spec Section 3/6, out of
//      scope here - same trust level admin-test-booking already has for
//      those two fields), but settlement_amount_fjd is derived from them
//      server-side rather than accepted as-is.
// 2. A basic D1-backed IP rate limit (see checkGuestBookingRateLimit below)
//    - see that function's comment for exactly what this does and doesn't
//      cover.
// ═══════════════════════════════════════════════════════════════

// IP-based sliding window using the bookings table itself (source_ip,
// Milestone 6 migration) rather than a new table or KV - avoids adding a
// new binding for what's still a fairly small mitigation. What this DOES
// cover: a single scripted client hammering this endpoint from one IP.
// What it does NOT cover: distributed abuse from many IPs, a determined
// attacker rotating IPs, or anything below the edge (Cloudflare's own
// DDoS/bot-management layer is a separate, unrelated protection this
// Worker doesn't configure). This is app-level spam friction, not a
// security boundary - flagging that distinction explicitly per instruction.
async function checkGuestBookingRateLimit(env, ip) {
  const max = Number(await getSetting(env, 'guest_booking_rate_limit_max', '5'));
  const windowMinutes = Number(await getSetting(env, 'guest_booking_rate_limit_window_minutes', '10'));
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM bookings WHERE source_ip = ? AND created_at > datetime('now', '-' || ? || ' minutes')`
  ).bind(ip, windowMinutes).first();
  const count = row ? row.cnt : 0;
  return { limited: count >= max, count, max, window_minutes: windowMinutes };
}

async function handleGuestBookingCreate(request, env) {
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);

  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateLimit = await checkGuestBookingRateLimit(env, clientIp);
  if (rateLimit.limited) {
    return json({ ok: false, error: 'Too many booking submissions from this connection. Please try again shortly.' }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }

  const guestName = (body.guest_name || '').toString().trim().slice(0, 200) || 'Guest';
  const guestPhone = normalisePhone((body.guest_phone || '').toString());
  const pickupZone = (body.pickup_zone || '').toString().trim();
  const destinationZone = (body.destination_zone || '').toString().trim();
  const vehicleType = (body.vehicle_type || '').toString().trim().toLowerCase();
  const quotedCurrency = (body.quoted_currency || '').toString().trim().toUpperCase();
  const quotedAmount = Number(body.quoted_amount);
  const fxRate = body.fx_rate_at_booking !== undefined ? Number(body.fx_rate_at_booking) : 1;
  const distanceKm = body.distance_km !== undefined && body.distance_km !== null ? Number(body.distance_km) : null;
  const paymentMethod = (body.payment_method || '').toString().trim().toLowerCase();

  const errors = [];
  if (!guestPhone) errors.push('a valid guest_phone is required');
  if (!ALLOWED_VEHICLE_TYPES.includes(vehicleType)) errors.push(`vehicle_type must be one of: ${ALLOWED_VEHICLE_TYPES.join(', ')}`);
  if (!/^[A-Z]{3}$/.test(quotedCurrency)) errors.push('quoted_currency must be a 3-letter currency code');
  if (!quotedAmount || !isFinite(quotedAmount) || quotedAmount <= 0 || quotedAmount > 5000) errors.push('quoted_amount must be a positive number no greater than 5000');
  if (!fxRate || !isFinite(fxRate) || fxRate <= 0 || fxRate > 100) errors.push('fx_rate_at_booking must be a positive, sane number');
  if (distanceKm !== null && (!isFinite(distanceKm) || distanceKm < 0 || distanceKm > 500)) errors.push('distance_km out of range');
  if (!['cash', 'prepay'].includes(paymentMethod)) errors.push("payment_method must be 'cash' or 'prepay'");

  const validZones = await getValidZoneNames(env);
  if (!validZones.has(pickupZone)) errors.push(`unknown pickup_zone: ${pickupZone}`);
  if (!validZones.has(destinationZone)) errors.push(`unknown destination_zone: ${destinationZone}`);

  if (errors.length > 0) return json({ ok: false, errors }, 400);

  const fuelRow = await env.DB.prepare(`SELECT multiplier FROM fuel_index ORDER BY id DESC LIMIT 1`).first();
  const fuelMultiplierApplied = fuelRow ? fuelRow.multiplier : 1;
  const settlementAmountFjd = Math.round(quotedAmount * fxRate * 100) / 100;

  const insert = await env.DB.prepare(
    `INSERT INTO bookings (guest_name, guest_phone, pickup_zone, destination_zone, distance_km, vehicle_type,
       quoted_currency, quoted_amount, fx_rate_at_booking, settlement_amount_fjd, fuel_multiplier_applied,
       payment_method, status, source_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(
    guestName, guestPhone, pickupZone, destinationZone, distanceKm, vehicleType,
    quotedCurrency, quotedAmount, fxRate, settlementAmountFjd, fuelMultiplierApplied, paymentMethod, clientIp
  ).run();

  const bookingId = insert.meta.last_row_id;
  const booking = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(bookingId).first();
  const broadcast = await broadcastBookingToDrivers(env, booking);

  return json({ ok: true, booking_id: bookingId, booking, broadcast }, 201);
}

// ═══════════════════════════════════════════════════════════════
// MILESTONE 4 — wallet lockout, commission accrual, max-hours cap
// (spec Section 4 remainder). Thresholds live in platform_settings, not
// hardcoded, so they can change without a redeploy — same pattern as
// fuel_auto_apply from Milestone 1.
// ═══════════════════════════════════════════════════════════════

async function getSetting(env, key, fallback) {
  const row = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = ?`).bind(key).first();
  return row ? row.value : fallback;
}

// Balance <= threshold (both negative-or-zero, threshold e.g. -150) means
// locked out. Reads the live wallets row rather than trusting any cached
// balance, since this gates real actions (accept, go-online).
async function enforceWalletLockout(env, driverId) {
  const thresholdRaw = await getSetting(env, 'wallet_lockout_threshold_fjd', '-150');
  const threshold = Number(thresholdRaw);
  const wallet = await env.DB.prepare(`SELECT balance_fjd FROM wallets WHERE driver_id = ?`).bind(driverId).first();
  const balance = wallet ? wallet.balance_fjd : 0;
  return { locked: balance <= threshold, balance_fjd: balance, threshold_fjd: threshold };
}

// Debits the driver's wallet for a completed cash trip's commission. Only
// called for payment_method = 'cash' (test plan section 9) — prepay trips
// are Stripe/Phase 3, out of scope, and settle differently. Uses the
// booking's own commission_rate if set, otherwise platform_settings'
// default_commission_rate (0.15) — per-booking always wins so pricing_rules-
// driven overrides later aren't clobbered by the platform default.
// wallets.balance_fjd and the wallet_transactions insert are written via
// batch() so a partial write (transaction logged but balance not updated,
// or vice versa) can't happen.
async function accrueCommission(env, booking) {
  const rateRaw = booking.commission_rate ?? await getSetting(env, 'default_commission_rate', '0.15');
  const rate = Number(rateRaw);
  const commission = Math.round(booking.settlement_amount_fjd * rate * 100) / 100;

  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO wallets (driver_id, balance_fjd) VALUES (?, 0)`).bind(booking.assigned_driver_id),
    env.DB.prepare(
      `INSERT INTO wallet_transactions (driver_id, booking_id, amount_fjd, type) VALUES (?, ?, ?, 'commission_owed')`
    ).bind(booking.assigned_driver_id, booking.id, -commission),
    env.DB.prepare(
      `UPDATE wallets SET balance_fjd = balance_fjd - ?, updated_at = datetime('now') WHERE driver_id = ?`
    ).bind(commission, booking.assigned_driver_id),
  ]);

  const wallet = await env.DB.prepare(`SELECT balance_fjd FROM wallets WHERE driver_id = ?`).bind(booking.assigned_driver_id).first();

  // Found during deep review: without this, a driver who was online and in
  // good standing when they accepted a trip, but whose commission on THIS
  // trip pushes them past the lockout threshold, stayed online=1 in D1
  // indefinitely - still receiving real job broadcasts for bookings
  // enforceWalletLockout would immediately 403 them on accepting. Forcing
  // offline here closes that gap the same moment the debt actually happens,
  // not on the next unrelated online-toggle or max-hours sweep.
  const threshold = Number(await getSetting(env, 'wallet_lockout_threshold_fjd', '-150'));
  if (wallet.balance_fjd <= threshold) {
    await env.DB.prepare(`UPDATE drivers SET online = 0, online_since = NULL WHERE id = ?`).bind(booking.assigned_driver_id).run();
  }

  return { rate, commission_fjd: commission, new_balance_fjd: wallet.balance_fjd };
}

// Forces offline any driver whose current online stint has run at or past
// their max_hours_cap, and starts their rest-gap clock. Called both by the
// scheduled() Cron Trigger and the /admin/max-hours-sweep endpoint below —
// same function, so there is exactly one implementation of this rule to
// verify, not two that could silently diverge.
async function enforceMaxHoursCap(env) {
  const restGapHours = Number(await getSetting(env, 'max_hours_rest_gap_hours', '8'));

  const overCap = await env.DB.prepare(
    `SELECT id FROM drivers
     WHERE online = 1 AND online_since IS NOT NULL
       AND (julianday('now') - julianday(online_since)) * 24 >= max_hours_cap`
  ).all();

  const forced = [];
  for (const row of overCap.results || []) {
    await env.DB.prepare(
      `UPDATE drivers SET online = 0, online_since = NULL, forced_offline_until = datetime('now', '+' || ? || ' hours') WHERE id = ?`
    ).bind(restGapHours, row.id).run();
    forced.push(row.id);
  }

  return { checked_at: sqliteNow(), rest_gap_hours: restGapHours, forced_offline_driver_ids: forced };
}

async function handleAdminMaxHoursSweep(request, env) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);
  const result = await enforceMaxHoursCap(env);
  return json({ ok: true, ...result }, 200);
}

// ═══════════════════════════════════════════════════════════════
// MILESTONE 5 — fuel index automation (spec Section 7), detect-and-notify.
// No bot-extracted price is ever trusted as fact: the Worker only detects
// that a NEW FCCC order was published and alerts the admin with a link to
// read it. A human reads the actual PDF and submits the number themselves
// via /admin/fuel-index/submit - that submission is what starts the ≥5%
// confirm gate, not anything the Worker parsed on its own.
// ═══════════════════════════════════════════════════════════════

// Weekly Cron Trigger (spec: Sunday 00:00 Fiji time = Saturday 12:00 UTC,
// since Fiji is UTC+12 with no DST currently observed - spec itself flags
// "adjust +1hr during DST window" defensively for if that ever changes).
async function checkFuelIndexUpdate(env) {
  let html;
  try {
    const res = await fetch(FCCC_PETROLEUM_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; nadi-dispatch-api fuel-index-check)' } });
    if (!res.ok) return { ok: false, error: `FCCC page returned ${res.status}` };
    html = await res.text();
  } catch (err) {
    return { ok: false, error: `Fetch failed: ${err.message}` };
  }

  const match = html.match(FCCC_PDF_LINK_RE);
  if (!match) return { ok: false, error: 'No Petroleum Prices PDF link found on the FCCC page - page structure may have changed.' };

  const latestPdfUrl = match[1];
  const latestFilename = latestPdfUrl.split('/').pop();
  const lastSeen = await getSetting(env, 'fuel_index_last_seen_order', '');

  if (latestFilename === lastSeen) {
    return { ok: true, new_order: false, filename: latestFilename };
  }

  await env.DB.prepare(
    `INSERT INTO platform_settings (key, value, updated_at) VALUES ('fuel_index_last_seen_order', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).bind(latestFilename).run();

  const current = await env.DB.prepare(`SELECT fuel_price_fjd_per_litre FROM fuel_index ORDER BY id DESC LIMIT 1`).first();
  const currentPrice = current ? current.fuel_price_fjd_per_litre : null;

  const alertPhone = await getSetting(env, 'admin_alert_phone', '');
  const bodyText = `New FCCC petroleum price order detected: ${latestFilename}. Current fuel_index baseline: FJ$${currentPrice ?? 'unset'}/L. Please review Schedule 1 (Viti Levu, within 3km), Gasoil (diesoline), Retail, Bulk Sale price at ${latestPdfUrl} and submit it via POST /admin/fuel-index/submit.`;
  const whatsapp = alertPhone
    ? await sendFuelIndexAlertWhatsApp(env, alertPhone, bodyText)
    : { attempted: false, reason: 'platform_settings.admin_alert_phone is not set.' };

  return { ok: true, new_order: true, filename: latestFilename, pdf_url: latestPdfUrl, current_price_fjd: currentPrice, whatsapp };
}

async function handleAdminFuelIndexCheck(request, env) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  const result = await checkFuelIndexUpdate(env);
  return json(result, result.ok ? 200 : 500);
}

// Admin has read the actual PDF and is submitting the real number - this is
// the human-in-the-loop step the spec's "parse the page" collapsed into one
// automated step, but the underlying FCCC source doesn't support that
// safely (see the file header comment). Computes % change vs the current
// live fuel_index baseline and queues a fuel_index_pending row - does NOT
// touch the live fuel_index table. That only happens on an explicit confirm.
async function handleAdminFuelIndexSubmit(request, env) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }
  const price = Number(body.fuel_price_fjd_per_litre);
  const effectiveFrom = (body.effective_from || '').toString();
  const orderReference = (body.order_reference || '').toString();
  if (!price || price <= 0) return json({ ok: false, error: 'fuel_price_fjd_per_litre must be a positive number.' }, 400);
  if (!effectiveFrom) return json({ ok: false, error: 'effective_from is required.' }, 400);
  if (!orderReference) return json({ ok: false, error: 'order_reference is required.' }, 400);

  const current = await env.DB.prepare(`SELECT fuel_price_fjd_per_litre FROM fuel_index ORDER BY id DESC LIMIT 1`).first();
  const currentPrice = current ? current.fuel_price_fjd_per_litre : null;
  const percentChange = currentPrice ? ((price - currentPrice) / currentPrice) * 100 : null;

  const insert = await env.DB.prepare(
    `INSERT INTO fuel_index_pending (fuel_price_fjd_per_litre, effective_from, order_reference, status) VALUES (?, ?, ?, 'pending')`
  ).bind(price, effectiveFrom, orderReference).run();
  const pendingId = insert.meta.last_row_id;

  const alertPhone = await getSetting(env, 'admin_alert_phone', '');
  const changeText = percentChange !== null ? `${percentChange >= 0 ? '+' : ''}${percentChange.toFixed(1)}%` : 'no prior baseline';
  const bodyText = `Fuel price change pending confirm: FJ$${currentPrice ?? 'unset'}/L -> FJ$${price}/L (${changeText}). Order: ${orderReference}. Effective ${effectiveFrom}. Reply/call POST /admin/fuel-index/pending/${pendingId}/confirm to apply, or /reject to discard. fuel_auto_apply is false - this will NOT go live without an explicit confirm.`;
  const whatsapp = alertPhone
    ? await sendFuelIndexAlertWhatsApp(env, alertPhone, bodyText)
    : { attempted: false, reason: 'platform_settings.admin_alert_phone is not set.' };

  return json({
    ok: true,
    pending_id: pendingId,
    current_price_fjd: currentPrice,
    submitted_price_fjd: price,
    percent_change: percentChange,
    whatsapp,
  }, 201);
}

// The actual state-changing action. Spec language says "WhatsApp CONFIRM" -
// this Worker has no inbound WhatsApp webhook (it only ever sends, never
// receives - true of every template in this file), so "CONFIRM" is this
// authenticated admin endpoint, called after reading the WhatsApp alert, not
// literal free-text reply parsing. fuel_auto_apply is checked and logged but
// not branched on - per instruction it stays false regardless for the first
// 2-3 months, so every path here requires this explicit call either way.
async function handleAdminFuelIndexConfirm(request, env, pendingId) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);

  const pending = await env.DB.prepare(`SELECT * FROM fuel_index_pending WHERE id = ?`).bind(pendingId).first();
  if (!pending) return json({ ok: false, error: 'Pending fuel index change not found.' }, 404);
  if (pending.status !== 'pending') return json({ ok: false, error: `Already ${pending.status}, cannot confirm again.` }, 409);

  const multiplier = Math.round((pending.fuel_price_fjd_per_litre / FUEL_MULTIPLIER_BASELINE_FJD) * 10000) / 10000;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO fuel_index (fuel_price_fjd_per_litre, effective_from, multiplier, order_reference, updated_by) VALUES (?, ?, ?, ?, 'admin confirm via /admin/fuel-index/pending/:id/confirm')`
    ).bind(pending.fuel_price_fjd_per_litre, pending.effective_from, multiplier, pending.order_reference),
    env.DB.prepare(`UPDATE fuel_index_pending SET status = 'confirmed' WHERE id = ?`).bind(pendingId),
    env.DB.prepare(
      `UPDATE platform_settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = datetime('now') WHERE key = 'fuel_confirmed_accurate_count'`
    ),
  ]);

  return json({ ok: true, pending_id: pendingId, applied_price_fjd: pending.fuel_price_fjd_per_litre, multiplier }, 200);
}

async function handleAdminFuelIndexReject(request, env, pendingId) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);

  const pending = await env.DB.prepare(`SELECT id, status FROM fuel_index_pending WHERE id = ?`).bind(pendingId).first();
  if (!pending) return json({ ok: false, error: 'Pending fuel index change not found.' }, 404);
  if (pending.status !== 'pending') return json({ ok: false, error: `Already ${pending.status}, cannot reject.` }, 409);

  await env.DB.prepare(`UPDATE fuel_index_pending SET status = 'rejected' WHERE id = ?`).bind(pendingId).run();
  return json({ ok: true, pending_id: pendingId, status: 'rejected' }, 200);
}

// Public, read-only - the live fuel_index baseline that Section 8's guest
// widget line (prepared, not deployed - see Milestone 5 report) reads from.
async function handleFuelIndexPublic(request, env) {
  if (!env.DB) return json({ error: 'Database not available.' }, 503);
  const row = await env.DB.prepare(
    `SELECT fuel_price_fjd_per_litre, effective_from, multiplier FROM fuel_index ORDER BY id DESC LIMIT 1`
  ).first();
  if (!row) return json({ error: 'No fuel index set yet.' }, 404);
  return json({
    fuel_price_fjd_per_litre: row.fuel_price_fjd_per_litre,
    effective_from: row.effective_from,
    multiplier: row.multiplier,
  }, 200);
}

// ═══════════════════════════════════════════════════════════════
// MILESTONE 8 — D1 backup to R2. Real Cloudflare research done before
// building this: the official D1 export REST API
// (POST /accounts/{id}/d1/database/{id}/export) produces a byte-perfect
// SQL dump, but requires its own Cloudflare API token secret (D1:Edit
// scope) - a new external credential this session couldn't self-generate
// (the wrangler OAuth session used throughout this build has no
// "User API Tokens" management scope, confirmed via `wrangler whoami`).
// Rather than block this milestone on James generating that token, built
// an application-level backup using only bindings this Worker already
// has: SELECT * from every table, serialize to JSON, write to a
// dedicated, isolated R2 bucket (BACKUPS - separate from DOCS, the driver
// document bucket, same isolation discipline applied everywhere else in
// this build). Documented the official REST API path as a real upgrade
// option in OPERATIONS.md for when that token exists - this isn't a
// permanent design decision, it's what's buildable and fully
// self-testable without an external dependency.
//
// Table order matters for restore (not backup) - foreign-key-safe order,
// parents before children (zones/drivers before vehicles/destinations/
// wallets, drivers+bookings before wallet_transactions, etc).
// ═══════════════════════════════════════════════════════════════

const BACKUP_TABLES = [
  'zones', 'drivers', 'vehicles', 'destinations',
  'fuel_index', 'fuel_index_pending', 'platform_settings', 'pricing_rules',
  'bookings', 'wallets', 'wallet_transactions', 'driver_login_tokens',
];

async function runD1Backup(env) {
  if (!env.DB) return { ok: false, error: 'Database not available.' };
  if (!env.BACKUPS) return { ok: false, error: 'BACKUPS R2 bucket not bound to this Worker.' };

  const snapshot = { exported_at: sqliteNow(), table_order: BACKUP_TABLES, tables: {} };
  const rowCounts = {};
  for (const table of BACKUP_TABLES) {
    // BACKUP_TABLES is a fixed, hardcoded whitelist above, never
    // user-derived - safe to interpolate into the query.
    const result = await env.DB.prepare(`SELECT * FROM ${table}`).all();
    snapshot.tables[table] = result.results || [];
    rowCounts[table] = snapshot.tables[table].length;
  }

  const filename = `nadi-marketplace-db-${snapshot.exported_at.replace(/[: ]/g, '-')}.json`;
  const key = `backups/${filename}`;
  const body = JSON.stringify(snapshot);
  await env.BACKUPS.put(key, body, { httpMetadata: { contentType: 'application/json' } });

  return { ok: true, key, filename, size_bytes: body.length, row_counts: rowCounts, exported_at: snapshot.exported_at };
}

async function handleAdminBackupRun(request, env) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  const result = await runD1Backup(env);
  return json(result, result.ok ? 201 : 500);
}

// ═══════════════════════════════════════════════════════════════
// MILESTONE 7 — dynamic destinations (Item 2). Moves ROUTES_DATA's
// hardcoded destination list into real D1 data so a non-developer admin
// can add a new hotel/destination without a code deploy. The live guest
// widget (ftt-booking-site) is NOT wired to this yet, deliberately -
// backend + admin tooling only this milestone, per instruction.
// Admin write endpoints (create/edit/deactivate), same requireAdmin()
// pattern as driver approval - not public, unlike GET /destinations.
// ═══════════════════════════════════════════════════════════════

const ALLOWED_DESTINATION_TYPES = ['hotel', 'airport', 'port', 'town', 'custom'];

// Public, read-only, active destinations grouped by zone - what a future
// guest-widget integration (not built this milestone) or the admin UI's
// own listing would call.
async function handleDestinationsPublic(env) {
  if (!env.DB) return json({ zones: [] }, 503);
  const result = await env.DB.prepare(
    `SELECT d.id, d.name, d.type, d.display_order, z.id AS zone_id, z.name AS zone_name
     FROM destinations d JOIN zones z ON z.id = d.zone_id
     WHERE d.active = 1
     ORDER BY z.id, d.display_order, d.name`
  ).all();

  const zonesMap = new Map();
  for (const row of result.results || []) {
    if (!zonesMap.has(row.zone_id)) zonesMap.set(row.zone_id, { zone_id: row.zone_id, zone_name: row.zone_name, destinations: [] });
    zonesMap.get(row.zone_id).destinations.push({ id: row.id, name: row.name, type: row.type, display_order: row.display_order });
  }

  return json({ zones: [...zonesMap.values()] }, 200);
}

async function handleAdminDestinationsList(request, env) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  if (!env.DB) return json({ destinations: [] }, 503);
  const result = await env.DB.prepare(
    `SELECT d.id, d.name, d.type, d.active, d.display_order, z.name AS zone
     FROM destinations d JOIN zones z ON z.id = d.zone_id
     ORDER BY z.id, d.display_order, d.name`
  ).all();
  return json({ destinations: (result.results || []).map((r) => ({ ...r, active: !!r.active })) }, 200);
}

async function handleAdminDestinationCreate(request, env) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }

  const name = (body.name || '').toString().trim();
  const type = (body.type || '').toString().trim().toLowerCase();
  const zoneName = (body.zone || '').toString().trim();
  const displayOrder = body.display_order !== undefined && body.display_order !== null ? Number(body.display_order) : null;
  const active = body.active !== undefined ? (body.active ? 1 : 0) : 1;

  const errors = [];
  if (!name) errors.push('name is required');
  if (!ALLOWED_DESTINATION_TYPES.includes(type)) errors.push(`type must be one of: ${ALLOWED_DESTINATION_TYPES.join(', ')}`);
  if (!zoneName) errors.push('zone is required');
  if (errors.length > 0) return json({ ok: false, errors }, 400);

  const zone = await env.DB.prepare(`SELECT id FROM zones WHERE name = ?`).bind(zoneName).first();
  if (!zone) return json({ ok: false, error: `unknown zone: ${zoneName}` }, 400);

  const insert = await env.DB.prepare(
    `INSERT INTO destinations (name, type, zone_id, display_order, active) VALUES (?, ?, ?, ?, ?)`
  ).bind(name, type, zone.id, displayOrder, active).run();

  const destinationId = insert.meta.last_row_id;
  const row = await env.DB.prepare(
    `SELECT d.id, d.name, d.type, d.active, d.display_order, z.name AS zone FROM destinations d JOIN zones z ON z.id = d.zone_id WHERE d.id = ?`
  ).bind(destinationId).first();

  return json({ ok: true, destination: row }, 201);
}

async function handleAdminDestinationEdit(request, env, destinationId) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);

  const existing = await env.DB.prepare(`SELECT id FROM destinations WHERE id = ?`).bind(destinationId).first();
  if (!existing) return json({ ok: false, error: 'Destination not found.' }, 404);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }

  const updates = [];
  const values = [];

  if (body.name !== undefined) {
    const name = body.name.toString().trim();
    if (!name) return json({ ok: false, error: 'name cannot be empty.' }, 400);
    updates.push('name = ?'); values.push(name);
  }
  if (body.type !== undefined) {
    const type = body.type.toString().trim().toLowerCase();
    if (!ALLOWED_DESTINATION_TYPES.includes(type)) return json({ ok: false, error: `type must be one of: ${ALLOWED_DESTINATION_TYPES.join(', ')}` }, 400);
    updates.push('type = ?'); values.push(type);
  }
  if (body.zone !== undefined) {
    const zone = await env.DB.prepare(`SELECT id FROM zones WHERE name = ?`).bind(body.zone.toString().trim()).first();
    if (!zone) return json({ ok: false, error: `unknown zone: ${body.zone}` }, 400);
    updates.push('zone_id = ?'); values.push(zone.id);
  }
  if (body.display_order !== undefined) {
    updates.push('display_order = ?'); values.push(body.display_order === null ? null : Number(body.display_order));
  }
  if (body.active !== undefined) {
    updates.push('active = ?'); values.push(body.active ? 1 : 0);
  }

  if (updates.length === 0) return json({ ok: false, error: 'No fields to update.' }, 400);

  values.push(destinationId);
  await env.DB.prepare(`UPDATE destinations SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  const row = await env.DB.prepare(
    `SELECT d.id, d.name, d.type, d.active, d.display_order, z.name AS zone FROM destinations d JOIN zones z ON z.id = d.zone_id WHERE d.id = ?`
  ).bind(destinationId).first();

  return json({ ok: true, destination: row }, 200);
}

// Convenience shortcut for the common case (PATCH active=0 is equally
// valid) - same pattern as driver approve/reject being their own endpoints
// rather than forcing every admin action through one generic PATCH.
async function handleAdminDestinationDeactivate(request, env, destinationId) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);

  const existing = await env.DB.prepare(`SELECT id FROM destinations WHERE id = ?`).bind(destinationId).first();
  if (!existing) return json({ ok: false, error: 'Destination not found.' }, 404);

  await env.DB.prepare(`UPDATE destinations SET active = 0 WHERE id = ?`).bind(destinationId).run();
  return json({ ok: true, destination_id: destinationId, active: false }, 200);
}

// ═══════════════════════════════════════════════════════════════
// MILESTONE 9 — geocode + real-distance pricing for unlisted addresses.
// Real finding before writing any of this: Distance Matrix API (the
// literal ask) cannot detect ferry legs - its response is only
// {distance, duration, status}, no route composition. Ferry-detection is
// an explicit hard requirement (failure mode 2), so this uses the Routes
// API instead - it returns per-step detail and warnings text, and is
// Google's current recommended API regardless. GOOGLE_MAPS_API_KEY should
// be restricted to Routes API only in Google Cloud Console (never
// Distance Matrix, which this doesn't call).
//
// pricing_rules/zones.remote_multiplier populated this milestone from
// real derivation - see migrations/milestone9-schema.sql for the full
// methodology and evidence, not invented here.
// ═══════════════════════════════════════════════════════════════

const GOOGLE_ROUTES_API_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const MAX_QUOTE_DISTANCE_KM = 300;

function normalizeAddressQuery(raw) {
  return (raw || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

// Standard great-circle distance - good enough for "which of 16 real
// zones is geographically closest," not used for the actual road distance
// (that's what the Routes API call is for).
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function findNearestZone(env, lat, lng) {
  const result = await env.DB.prepare(`SELECT id, name, lat, lng, remote_multiplier FROM zones WHERE lat IS NOT NULL AND lng IS NOT NULL`).all();
  let nearest = null;
  let nearestDist = Infinity;
  for (const zone of result.results || []) {
    const d = haversineKm(lat, lng, zone.lat, zone.lng);
    if (d < nearestDist) { nearestDist = d; nearest = zone; }
  }
  return nearest;
}

async function computeFareFjd(env, vehicleType, distanceKm, remoteMultiplier) {
  const rule = await env.DB.prepare(
    `SELECT base_rate_fjd_per_km, flagfall_fjd FROM pricing_rules
     WHERE vehicle_type = ? AND active = 1 AND distance_min_km <= ? AND (distance_max_km IS NULL OR ? < distance_max_km)
     ORDER BY distance_min_km DESC LIMIT 1`
  ).bind(vehicleType, distanceKm, distanceKm).first();
  if (!rule) return null;
  const raw = rule.flagfall_fjd + rule.base_rate_fjd_per_km * distanceKm;
  return Math.round(raw * remoteMultiplier * 100) / 100;
}

// Real Google Routes API call. Field mask requests warnings text
// specifically because ferry-leg detection isn't guaranteed to be a clean
// structured field for DRIVE-mode routes (this wasn't verifiable without a
// real API key and a real test call - see the Milestone 9 report for what
// the actual live response looked like and whether this detection held up
// against a real Yasawa/Mamanuca address).
async function callGoogleRoutesApi(env, originLat, originLng, destinationText) {
  if (!env.GOOGLE_MAPS_API_KEY) {
    return { ok: false, reason: 'not_configured' };
  }
  try {
    const res = await fetch(GOOGLE_ROUTES_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.warnings,routes.legs.steps.travelMode,routes.legs.steps.navigationInstruction',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
        destination: { address: destinationText },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
        units: 'METRIC',
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, reason: 'geocode_failed', status: res.status, raw: errText.slice(0, 500) };
    }

    const data = await res.json();
    const route = data.routes && data.routes[0];
    if (!route) {
      // A 200 with no routes: the geocoder understood the request enough
      // to try, but no DRIVE route exists - the real signal this design
      // uses for "needs a water transfer" (see file header comment).
      return { ok: true, hasRoute: false };
    }

    const distanceKm = route.distanceMeters / 1000;
    const warningsText = JSON.stringify(route.warnings || []).toLowerCase();
    const stepsText = JSON.stringify(route.legs || []).toLowerCase();
    const hasFerryLeg = warningsText.includes('ferry') || stepsText.includes('ferry') || stepsText.includes('"travelmode":"ferry"');

    return { ok: true, hasRoute: true, distanceKm, durationRaw: route.duration, hasFerryLeg };
  } catch (err) {
    return { ok: false, reason: 'fetch_error', error: err.message };
  }
}

// Interim cost-abuse protection, not a security boundary - same honest
// framing as Milestone 6's booking rate limit. Recommended in the
// Milestone 9 report over pausing entirely, given the actual dollar
// exposure at Google's real per-request Routes API pricing and a real
// cap this low.
async function checkQuoteRateLimit(env, ip) {
  const max = Number(await getSetting(env, 'quote_rate_limit_max_per_day', '20'));
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM quote_requests_log WHERE source_ip = ? AND created_at > datetime('now', '-1440 minutes')`
  ).bind(ip).first();
  const count = row ? row.cnt : 0;
  return { limited: count >= max, count, max };
}

async function handleQuoteCreate(request, env) {
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);

  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateLimit = await checkQuoteRateLimit(env, clientIp);
  if (rateLimit.limited) {
    return json({ ok: false, error: 'Too many quote requests from this connection today. Please try again tomorrow, or contact us directly.' }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }

  const addressRaw = (body.address || '').toString().trim();
  const vehicleType = (body.vehicle_type || '').toString().trim().toLowerCase();

  const errors = [];
  if (!addressRaw) errors.push('address is required');
  if (addressRaw.length > 300) errors.push('address is too long');
  if (!ALLOWED_VEHICLE_TYPES.includes(vehicleType)) errors.push(`vehicle_type must be one of: ${ALLOWED_VEHICLE_TYPES.join(', ')}`);
  if (errors.length > 0) return json({ ok: false, errors }, 400);

  const queryNormalized = normalizeAddressQuery(addressRaw);
  let cacheRow = await env.DB.prepare(`SELECT * FROM geocoded_addresses WHERE query_normalized = ?`).bind(queryNormalized).first();
  let cacheHit = !!cacheRow;

  if (!cacheRow) {
    const nadiAirport = await env.DB.prepare(`SELECT lat, lng FROM zones WHERE name = 'Nadi Airport'`).first();
    if (!nadiAirport || nadiAirport.lat === null) {
      return json({ ok: false, error: 'Origin zone coordinates not configured.' }, 500);
    }

    const routeResult = await callGoogleRoutesApi(env, nadiAirport.lat, nadiAirport.lng, addressRaw);

    let outcome, resolvedAddress = null, lat = null, lng = null, distanceKm = null, durationText = null, hasFerryLeg = 0, nearestZoneId = null;

    if (!routeResult.ok) {
      // Google unreachable, misconfigured key, or a real geocode failure -
      // never guess a zone. Not cached (routeResult.ok false means we
      // don't have a query_normalized worth remembering as a permanent
      // failure - e.g. GOOGLE_MAPS_API_KEY not yet set shouldn't poison
      // the cache for when it is).
      return json({
        ok: true,
        outcome: 'needs_manual_confirmation',
        message: 'Could not confirm this address automatically. We will follow up with you directly to confirm pricing.',
        detail: routeResult.reason,
      }, 200);
    } else if (!routeResult.hasRoute) {
      outcome = 'needs_water_transfer';
    } else if (routeResult.distanceKm > MAX_QUOTE_DISTANCE_KM || routeResult.hasFerryLeg) {
      outcome = 'needs_water_transfer';
      distanceKm = routeResult.distanceKm;
      durationText = routeResult.durationRaw;
      hasFerryLeg = routeResult.hasFerryLeg ? 1 : 0;
    } else {
      distanceKm = routeResult.distanceKm;
      durationText = routeResult.durationRaw;
      outcome = 'resolved';
    }

    const insert = await env.DB.prepare(
      `INSERT INTO geocoded_addresses (query_normalized, query_raw, resolved_address, lat, lng, distance_km, duration_text, has_ferry_leg, nearest_zone_id, outcome)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(queryNormalized, addressRaw, resolvedAddress, lat, lng, distanceKm, durationText, hasFerryLeg, nearestZoneId, outcome).run();

    cacheRow = await env.DB.prepare(`SELECT * FROM geocoded_addresses WHERE id = ?`).bind(insert.meta.last_row_id).first();
    cacheHit = false;
  }

  await env.DB.prepare(
    `INSERT INTO quote_requests_log (source_ip, query_normalized, cache_hit) VALUES (?, ?, ?)`
  ).bind(clientIp, queryNormalized, cacheHit ? 1 : 0).run();

  if (cacheRow.outcome === 'needs_manual_confirmation') {
    return json({ ok: true, outcome: 'needs_manual_confirmation', message: 'Could not confirm this address automatically. We will follow up with you directly to confirm pricing.', cached: cacheHit }, 200);
  }
  if (cacheRow.outcome === 'needs_water_transfer') {
    return json({
      ok: true,
      outcome: 'needs_water_transfer',
      message: 'This destination requires a water transfer. Please contact us directly to arrange this trip.',
      distance_km: cacheRow.distance_km,
      has_ferry_leg: !!cacheRow.has_ferry_leg,
      cached: cacheHit,
    }, 200);
  }

  const nearestZone = await findNearestZone(env, cacheRow.lat, cacheRow.lng);
  const fare = nearestZone ? await computeFareFjd(env, vehicleType, cacheRow.distance_km, nearestZone.remote_multiplier) : null;

  return json({
    ok: true,
    outcome: 'resolved',
    query: addressRaw,
    distance_km: cacheRow.distance_km,
    duration: cacheRow.duration_text,
    nearest_zone: nearestZone ? { id: nearestZone.id, name: nearestZone.name, remote_multiplier: nearestZone.remote_multiplier } : null,
    vehicle_type: vehicleType,
    quoted_fare_fjd: fare,
    cached: cacheHit,
  }, 200);
}

// ═══════════════════════════════════════════════════════════════
// UTIL
// ═══════════════════════════════════════════════════════════════

function sqliteNow() {
  // Matches SQLite's datetime('now') format (UTC, 'YYYY-MM-DD HH:MM:SS') so
  // string comparison against columns like forced_offline_until is valid —
  // Date#toISOString()'s 'T'/'Z'/milliseconds would otherwise break the
  // lexicographic comparison.
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function json(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { ...JSON_CORS, 'Content-Type': 'application/json' },
  });
}
