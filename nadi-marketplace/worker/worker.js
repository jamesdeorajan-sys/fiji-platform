/**
 * Fiji Dash — Driver Marketplace Backend
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

// Milestone 18 (server-authoritative pricing, Recommendation 2): the
// named, individually-testable pricing steps live in pricing.mjs, shared
// with the Node test suite (pricing.test.js / pricing-steps.test.mjs) -
// this file no longer has its own separate copy of the fare formula.
import {
  RETURN_MULTIPLIER, computeBaseFare, applyZoneMultiplier,
  applyTripTypeMultiplier, applyNightSurcharge, applyExtras,
  applyLoyaltyDiscount, computeFinalTotal, computeBoatFare, assertSanePricing,
} from './pricing.mjs';

const JSON_CORS = {
  'Access-Control-Allow-Origin': '*',
  // PATCH added for Milestone 7's destination edit endpoint - every prior
  // write endpoint in this file was POST-only, so nothing needed it before.
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// 'boat' (Milestone 13) never reaches the road-quote vehicle-tier check in
// handleQuoteCreate (the destination_id branch returns before it), but is
// a real, valid vehicle_type for /bookings and admin test bookings.
const ALLOWED_VEHICLE_TYPES = ['sedan', 'minivan', 'minibus', 'boat'];
// MILESTONE 16: real floor on Flexible Fare proposals, enforced here -
// server-side - not just as a client-side hint. Guest widget shows the
// same ratio as a "propose from" UX hint (NEGOTIATION_FLOOR_RATIO in
// app.js), but a guest can always bypass client JS, so this check is the
// one that actually matters.
const NEGOTIATION_FLOOR_RATIO = 0.80;
const NADI_AIRPORT_ZONE_NAME = 'Nadi Airport';
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
const DRIVER_APP_URL = 'https://driver.fijidash.com/driver-app';

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
// Still not submitted to Meta as of 2026-07-25 - confirmed absent (not
// assumed) via a real GET /admin/whatsapp/templates call against WABA
// 4150314405223931, which lists every template that WABA actually has.
// Admin-facing, not driver-facing, so it's a new template rather than
// reusing any driver one.
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
// CORRECTED 2026-07-25: every prior comment here assumed this was a
// language-code problem (tried en, en_US, en_GB, en_AU - all real 404s).
// It isn't. GET /admin/whatsapp/templates (real Graph API call, WABA
// 4150314405223931) lists every template this WABA actually has -
// vakaviti_driver_welcome, vakaviti_booking_broadcast, vakaviti_driver_return
// (all APPROVED, lang 'en'), vakaviti_driver_login_v2 (REJECTED, still
// listed), vakaviti_lead_alert_v2, hello_world. vakaviti_ops_health_alert is
// NOT in that list at all, under any language or status - REJECTED
// templates still show up (see driver_login_v2), so this isn't a
// rejected-and-hidden case either. It was never actually created/submitted
// in this WABA (or was fully deleted after the "edited 22 Jul 2026" state
// the old comment referenced) - no language code fixes this. Needs a real
// template submitted and approved in WhatsApp Manager before this constant
// means anything; the same is true of FUEL_INDEX_ALERT_TEMPLATE below,
// confirmed absent from the same real list.
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

    // Diagnostic only, admin-authenticated, read-only against Meta's own
    // Graph API - the authoritative source for a template's actual current
    // approved language code (WhatsApp Manager's UI reflects the same data
    // this reads directly). Built because the file's own template language
    // constants have drifted from reality before (see DRIVER_WELCOME_LANG_CODE
    // and HEALTH_ALERT_LANG_CODE's comments) and guessing codes one real send
    // at a time is slow and can trip template-messaging rate limits.
    if (request.method === 'GET' && url.pathname === '/admin/whatsapp/templates') {
      return handleAdminWhatsAppTemplatesList(request, env);
    }

    // Diagnostic only, admin-authenticated, read-only against Meta's own
    // Graph API - real check for a hard cutover precondition (cutover-plan.md
    // step 2): WHATSAPP_PHONE_ID must be a real production number before any
    // guest-facing traffic, not Meta's test/sandbox number. display_phone_number
    // is the authoritative answer, not something inferable from a send response.
    if (request.method === 'GET' && url.pathname === '/admin/whatsapp/phone-info') {
      return handleAdminWhatsAppPhoneInfo(request, env);
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

    // ── Milestone 15: guest price negotiation, in-house drivers only ──
    if (request.method === 'POST' && url.pathname === '/negotiate') {
      return handleNegotiationCreate(request, env);
    }

    // ── Milestone 16: real reference-fare preview, before a proposal exists ──
    if (request.method === 'GET' && url.pathname === '/reference-fare') {
      return handleReferenceFarePreview(request, env);
    }

    const negotiationStatusMatch = url.pathname.match(/^\/negotiate\/(\d+)$/);
    if (request.method === 'GET' && negotiationStatusMatch) {
      return handleNegotiationStatus(request, env, Number(negotiationStatusMatch[1]));
    }

    const negotiationAcceptMatch = url.pathname.match(/^\/negotiate\/(\d+)\/accept-offer$/);
    if (request.method === 'POST' && negotiationAcceptMatch) {
      return handleNegotiationAcceptOffer(request, env, Number(negotiationAcceptMatch[1]));
    }

    // ── Milestone 9: geocode + real-distance pricing for unlisted addresses ──
    if (request.method === 'POST' && url.pathname === '/quote') {
      return handleQuoteCreate(request, env);
    }

    // ── Milestone 10: human escalation / "back to base" system ──
    if (request.method === 'POST' && url.pathname === '/escalate') {
      return handleEscalationCreate(request, env);
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

    // ── Milestone 15: driver side of price negotiation ──
    if (request.method === 'GET' && url.pathname === '/driver/negotiation-requests') {
      return handleDriverNegotiationRequests(request, env);
    }

    const negotiationOfferMatch = url.pathname.match(/^\/driver\/negotiation-requests\/(\d+)\/offer$/);
    if (request.method === 'POST' && negotiationOfferMatch) {
      return handleDriverNegotiationOffer(request, env, Number(negotiationOfferMatch[1]));
    }

    if (request.method === 'POST' && url.pathname === '/admin/test-booking') {
      return handleAdminTestBooking(request, env);
    }

    // ── real gap James flagged: no way to see his own bookings without
    // asking us to query D1 directly. Read-only list, admin-bookings.html ──
    if (request.method === 'GET' && url.pathname === '/admin/bookings') {
      return handleAdminListBookings(request, env, url);
    }

    // ── Milestone 19: per-booking event history, for admin-bookings.html's
    // expand-a-row view ──
    const bookingEventsMatch = url.pathname.match(/^\/admin\/bookings\/(\d+)\/events$/);
    if (request.method === 'GET' && bookingEventsMatch) {
      return handleAdminListBookingEvents(request, env, Number(bookingEventsMatch[1]));
    }

    // ── double-dispatch fix: James/Ben manually arranging a driver via
    // WhatsApp instead of the automated broadcast/accept flow ──
    if (request.method === 'POST' && url.pathname === '/admin/bookings/manual-assign') {
      return handleAdminManualAssign(request, env);
    }

    // ── Milestone 20: operational dashboard metrics, admin-dashboard.html ──
    if (request.method === 'GET' && url.pathname === '/admin/dashboard-stats') {
      return handleAdminDashboardStats(request, env);
    }

    // ── Milestone 21: staff escalation queue, admin-escalations.html ──
    if (request.method === 'GET' && url.pathname === '/admin/escalations') {
      return handleAdminListEscalations(request, env, url);
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

// Two real Graph API calls, both read-only: (1) resolve WHATSAPP_PHONE_ID
// to its parent WhatsApp Business Account id, (2) list that WABA's
// message_templates. Returns name/language/status/category for every
// template so a stale in-code language constant can be corrected against
// ground truth instead of guessed via trial-and-error sends.
async function handleAdminWhatsAppTemplatesList(request, env) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    return json({ ok: false, error: 'WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not configured on this Worker.' }, 503);
  }

  try {
    // ?waba_id=... lets the caller skip auto-discovery entirely (real gap
    // found live: the Cloud API's phone-number node has no scalar
    // whatsapp_business_account_id field - GET .../{phone-id}?fields=
    // whatsapp_business_account_id returns a real 400 "(#100) Tried
    // accessing nonexisting field"). Nested-field syntax is the documented
    // correct form; tried first, with the override as a real fallback
    // rather than a second guess.
    const url = new URL(request.url);
    let wabaId = url.searchParams.get('waba_id');

    if (!wabaId) {
      const phoneRes = await fetch(
        `https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}?fields=whatsapp_business_account{id}`,
        { headers: { 'Authorization': `Bearer ${env.WHATSAPP_TOKEN}` } }
      );
      const phoneBody = await phoneRes.json().catch(() => null);
      if (!phoneRes.ok || !phoneBody?.whatsapp_business_account?.id) {
        return json({
          ok: false,
          error: 'Could not resolve WABA id from WHATSAPP_PHONE_ID. Pass ?waba_id=<id> explicitly (find it in WhatsApp Manager > Account overview) to skip auto-discovery.',
          detail: phoneBody,
        }, 502);
      }
      wabaId = phoneBody.whatsapp_business_account.id;
    }

    const templatesRes = await fetch(
      `https://graph.facebook.com/v19.0/${wabaId}/message_templates?fields=name,language,status,category&limit=100`,
      { headers: { 'Authorization': `Bearer ${env.WHATSAPP_TOKEN}` } }
    );
    const templatesBody = await templatesRes.json().catch(() => null);
    if (!templatesRes.ok) {
      return json({ ok: false, error: 'Graph API templates list failed.', detail: templatesBody }, 502);
    }

    return json({ ok: true, waba_id: wabaId, templates: templatesBody.data || [] }, 200);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

async function handleAdminWhatsAppPhoneInfo(request, env) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    return json({ ok: false, error: 'WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not configured on this Worker.' }, 503);
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}?fields=display_phone_number,verified_name,quality_rating`,
      { headers: { 'Authorization': `Bearer ${env.WHATSAPP_TOKEN}` } }
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return json({ ok: false, error: 'Graph API phone lookup failed.', detail: body }, 502);
    }
    return json({ ok: true, phone_info: body }, 200);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
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

    // Real ops alert, same mechanism as health-check/fuel-index/escalation
    // alerts - not exposed in the response (this endpoint is public-facing,
    // called directly by driver-join.html; same "don't leak admin-facing
    // detail to the public caller" discipline already used for /escalate).
    const applicationSummary = `New driver application: ${name} (${phone}), ${vehicleType}, plate ${plate}, zones: ${zones.join(', ')}.`;
    for (const alertPhone of await getAdminAlertPhones(env)) {
      await sendHealthAlertWhatsApp(env, alertPhone, applicationSummary, sqliteNow());
    }

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

// Real gap James flagged directly: no admin panel or API to list/view
// bookings at all - admin-drivers.html only manages driver applications,
// destinations-admin.html only manages zones, and the only existing
// /admin/bookings endpoint was POST manual-assign, no GET list. He had
// no way to see his own bookings without asking us to query D1 directly.
// Read-only for now (matches the ask) - a real driver_name JOIN is
// included since "who's this assigned to" is exactly the kind of context
// that motivated this page, at no real added cost over the base query.
async function handleAdminListBookings(request, env, url) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  if (!env.DB) return json({ bookings: [] }, 503);

  // Bounded, not unlimited - this is a dashboard view, not an export tool.
  // Real range: 1-200, defaults to 50 (a full day or two of real traffic
  // at current volume, per the live bookings count seen this session).
  const requestedLimit = Number(url.searchParams.get('limit'));
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 && requestedLimit <= 200 ? requestedLimit : 50;
  const status = url.searchParams.get('status'); // optional filter, e.g. ?status=pending

  const conditions = [];
  const params = [];
  if (status) {
    conditions.push('b.status = ?');
    params.push(status);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  const result = await env.DB.prepare(
    `SELECT b.id, b.guest_name, b.guest_phone, b.pickup_zone, b.destination_zone, b.distance_km,
            b.vehicle_type, b.quoted_currency, b.quoted_amount, b.payment_method, b.status,
            b.pickup_date, b.pickup_time, b.created_at, d.name AS driver_name
     FROM bookings b
     LEFT JOIN drivers d ON d.id = b.assigned_driver_id
     ${whereClause}
     ORDER BY b.created_at DESC
     LIMIT ?`
  ).bind(...params).all();

  return json({ bookings: result.results || [] }, 200);
}

// Point 4 of the ask: a basic admin view of events for a given booking -
// an expand-a-row addition to admin-bookings.html, not a whole new page.
// Chronological (oldest first) - reads as a real timeline/history, not a
// most-recent-first activity feed.
async function handleAdminListBookingEvents(request, env, bookingId) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  if (!env.DB) return json({ events: [] }, 503);

  const booking = await env.DB.prepare(`SELECT id FROM bookings WHERE id = ?`).bind(bookingId).first();
  if (!booking) return json({ ok: false, error: 'Booking not found.' }, 404);

  const result = await env.DB.prepare(
    `SELECT id, event_type, previous_status, new_status, actor, metadata, created_at
     FROM booking_events WHERE booking_id = ? ORDER BY created_at ASC, id ASC`
  ).bind(bookingId).all();

  const events = (result.results || []).map(e => ({
    ...e,
    metadata: e.metadata ? JSON.parse(e.metadata) : null,
  }));

  return json({ booking_id: bookingId, events }, 200);
}

// Milestone 20: operational dashboard - all metrics read from existing
// tables, nothing new stored. "Unassigned" reuses the exact same
// definition handleDriverJobs already uses for the live driver feed
// (status = 'pending' AND assigned_driver_id IS NULL), so this number
// always agrees with what drivers are actually seeing. "Upcoming
// transfers" is pickup_date/pickup_time, not created_at - when the ride
// is scheduled, not when it was booked.
async function handleAdminDashboardStats(request, env) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  if (!env.DB) return json({ error: 'Database unavailable.' }, 503);

  const [todayResult, byStatusResult, unassignedResult, escalationsResult, upcomingResult] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM bookings WHERE date(created_at) = date('now')`),
    env.DB.prepare(`SELECT status, COUNT(*) AS count FROM bookings GROUP BY status`),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM bookings WHERE status = 'pending' AND assigned_driver_id IS NULL`),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM escalations WHERE resolved = 0`),
    env.DB.prepare(
      `SELECT b.id, b.guest_name, b.pickup_zone, b.destination_zone, b.vehicle_type, b.status,
              b.pickup_date, b.pickup_time, d.name AS driver_name
       FROM bookings b
       LEFT JOIN drivers d ON d.id = b.assigned_driver_id
       WHERE b.pickup_date >= date('now')
       ORDER BY b.pickup_date ASC, b.pickup_time ASC
       LIMIT 20`
    ),
  ]);

  const bookingsByStatus = {};
  for (const row of byStatusResult.results || []) bookingsByStatus[row.status] = row.count;

  return json({
    bookings_today: todayResult.results?.[0]?.count || 0,
    bookings_by_status: bookingsByStatus,
    unassigned_bookings: unassignedResult.results?.[0]?.count || 0,
    active_escalations: escalationsResult.results?.[0]?.count || 0,
    upcoming_transfers: upcomingResult.results || [],
  }, 200);
}

// Milestone 21: read-only staff queue for the real, live escalations
// table (Milestone 10) - until now the only way to see an open
// escalation was the WhatsApp alert at the moment it fired, or a direct
// D1 query. Defaults to open (resolved = 0) since that's the actual
// work queue; ?resolved=1 available for looking back at history.
// escalations has no priority column today - honestly reflected here by
// simply not returning one, rather than fabricating a value.
async function handleAdminListEscalations(request, env, url) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  if (!env.DB) return json({ escalations: [] }, 503);

  const requestedLimit = Number(url.searchParams.get('limit'));
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 && requestedLimit <= 200 ? requestedLimit : 50;
  const resolvedParam = url.searchParams.get('resolved');
  const resolved = resolvedParam === '1' ? 1 : 0; // default: open queue

  const result = await env.DB.prepare(
    `SELECT e.id, e.source, e.trigger_type, e.context, e.booking_id, e.driver_id,
            e.created_at, e.resolved,
            b.pickup_zone, b.destination_zone, b.guest_name AS booking_guest_name,
            d.name AS driver_name
     FROM escalations e
     LEFT JOIN bookings b ON b.id = e.booking_id
     LEFT JOIN drivers d ON d.id = e.driver_id
     WHERE e.resolved = ?
     ORDER BY e.created_at DESC
     LIMIT ?`
  ).bind(resolved, limit).all();

  return json({ escalations: result.results || [] }, 200);
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
// LIVE-TESTED 2026-07-25 (checkpoint regression pass): vakaviti_driver_return
// is Active and confirmed delivering for real (Graph API 200, real wamid, to
// a real device) - this comment previously said "not yet Active", which had
// gone stale since an earlier commit.
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
          components: [{ type: 'body', parameters: [{ type: 'text', parameter_name: 'alert_message', text: bodyText }] }],
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
// vakaviti_ops_health_alert body: {{alert_summary}} = state ("DOWN"/
// "RECOVERED"), {{timestamp}} = timestamp. Two separate template
// parameters, not one freeform string - matches the two-variable template
// submitted to Meta. Real 2026-07-28 bug: the template was recreated in
// WhatsApp Manager using NAMED variables, but Meta's Cloud API only
// resolves a named variable if the request also carries a matching
// parameter_name on that parameter - positional-only parameters (no
// parameter_name) get rejected with 400 "(#100) Parameter name is missing
// or empty" even though the values and count are otherwise correct.
async function sendHealthAlertWhatsApp(env, phone, state, timestamp, langCodeOverride) {
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
          language: { code: langCodeOverride || HEALTH_ALERT_LANG_CODE },
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', parameter_name: 'alert_summary', text: state },
              { type: 'text', parameter_name: 'timestamp', text: timestamp },
            ],
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
  await logBookingEvent(env, { bookingId, eventType: 'accepted', previousStatus: 'pending', newStatus: 'accepted', actor: `driver:${driver.id}` });
  return json({ ok: true, won: true, booking }, 200);
}

// ═══════════════════════════════════════════════════════════════
// MANUAL ASSIGN — double-dispatch fix. James/Ben sometimes arrange a
// driver directly over WhatsApp instead of the automated broadcast/
// accept flow above. Without this, the automated system could still
// independently dispatch a second, different driver to the same guest
// while a human is mid-conversation - two real drivers turning up.
// Reuses the exact atomic "winner-takes-it" guard from
// handleDriverAcceptBooking() rather than a separate hold flag - same
// invariant (assigned_driver_id written exactly once, by whoever gets
// there first), just admin as a second possible writer alongside a
// driver's own accept. Registered drivers only (confirmed with James
// 2026-07-27: manually-arranged drivers are always already in the
// drivers table) - no unregistered/external-driver path.
// ═══════════════════════════════════════════════════════════════

async function handleAdminManualAssign(request, env) {
  if (!requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401);
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }

  const driverId = Number(body.driver_id);
  if (!Number.isInteger(driverId) || driverId <= 0) return json({ ok: false, error: 'driver_id must be a positive integer' }, 400);

  const driver = await env.DB.prepare(`SELECT id, name, status FROM drivers WHERE id = ?`).bind(driverId).first();
  if (!driver) return json({ ok: false, error: 'No driver found with that driver_id.' }, 404);
  if (driver.status !== 'verified') return json({ ok: false, error: `Driver ${driver.name} is not verified (status: ${driver.status}).` }, 403);

  // Path A - taking over a booking that already exists (e.g. the guest
  // used the widget, is sitting in the pending/broadcast pool, and a
  // human is now handling them directly instead).
  if (body.booking_id !== undefined && body.booking_id !== null) {
    const bookingId = Number(body.booking_id);
    if (!Number.isInteger(bookingId) || bookingId <= 0) return json({ ok: false, error: 'booking_id must be a positive integer' }, 400);

    const result = await env.DB.prepare(
      `UPDATE bookings SET assigned_driver_id = ?, status = 'accepted' WHERE id = ? AND assigned_driver_id IS NULL AND status = 'pending'`
    ).bind(driverId, bookingId).run();

    const won = result.meta.changes === 1;
    if (!won) {
      const current = await env.DB.prepare(`SELECT assigned_driver_id, status FROM bookings WHERE id = ?`).bind(bookingId).first();
      if (!current) return json({ ok: false, error: 'Booking not found.' }, 404);
      return json({ ok: false, won: false, reason: 'Booking already taken or no longer available.', current }, 409);
    }

    const booking = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(bookingId).first();
    await logBookingEvent(env, {
      bookingId, eventType: 'accepted', previousStatus: 'pending', newStatus: 'accepted', actor: 'admin',
      metadata: { assigned_driver_id: driverId, via: 'manual_assign' },
    });
    return json({ ok: true, won: true, booking }, 200);
  }

  // Path B - a guest arranged entirely over WhatsApp, no existing
  // booking row at all. Creates it directly via createBookingRecord()
  // with status='accepted' and assigned_driver_id pre-set, same pattern
  // handleNegotiationAcceptOffer() already uses - it never enters the
  // pending/broadcastable pool, so there's nothing for the automated
  // system to race against.
  const result = await createBookingRecord(env, {
    guestName: (body.guest_name || '').toString().trim().slice(0, 200) || 'Guest',
    guestPhone: normalisePhone((body.guest_phone || '').toString()),
    pickupZone: (body.pickup_zone || '').toString().trim(),
    destinationZone: (body.destination_zone || '').toString().trim(),
    vehicleType: (body.vehicle_type || '').toString().trim().toLowerCase(),
    quotedCurrency: (body.quoted_currency || '').toString().trim().toUpperCase(),
    quotedAmount: Number(body.quoted_amount),
    fxRate: body.fx_rate_at_booking !== undefined ? Number(body.fx_rate_at_booking) : 1,
    distanceKm: body.distance_km !== undefined && body.distance_km !== null ? Number(body.distance_km) : null,
    paymentMethod: (body.payment_method || '').toString().trim().toLowerCase(),
    sourceIp: request.headers.get('CF-Connecting-IP') || 'unknown',
    assignedDriverId: driverId,
    status: 'accepted',
    actor: 'admin', // manually arranged over WhatsApp, no existing booking row - an admin action created this
  });
  if (!result.ok) return json({ ok: false, errors: result.errors }, 400);

  return json({ ok: true, booking_id: result.bookingId, booking: result.booking }, 201);
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
    `SELECT id, assigned_driver_id, status, payment_method, settlement_amount_fjd, commission_rate, pickup_zone, destination_zone
     FROM bookings WHERE id = ?`
  ).bind(bookingId).first();
  if (!booking) return json({ error: 'Booking not found.' }, 404);
  if (booking.assigned_driver_id !== driver.id) return json({ error: 'This booking is not assigned to you.' }, 403);

  const allowed = VALID_STATUS_TRANSITIONS[booking.status] || [];
  if (!allowed.includes(newStatus)) {
    return json({ error: `Cannot transition from '${booking.status}' to '${newStatus}'.` }, 409);
  }

  await env.DB.prepare(`UPDATE bookings SET status = ? WHERE id = ?`).bind(newStatus, bookingId).run();
  await logBookingEvent(env, { bookingId, eventType: newStatus, previousStatus: booking.status, newStatus, actor: `driver:${driver.id}` });

  let commission = null;
  if (newStatus === 'completed' && booking.payment_method === 'cash') {
    commission = await accrueCommission(env, booking);
  }

  // Real gap James flagged: 'completed'/'cancelled' had no admin
  // notification at all - only booking creation did. No 'cancelled' path
  // exists yet (see booking_events' own migration comment), so this only
  // covers 'completed' for now. Reuses the exact same
  // sendHealthAlertWhatsApp/getAdminAlertPhones pattern the creation
  // alert already uses - no new abstraction, per the explicit ask.
  if (newStatus === 'completed') {
    const completedSummary = `Booking #${bookingId} completed: ${driver.name || 'driver ' + driver.id}, `
      + `${booking.pickup_zone} -> ${booking.destination_zone}, FJD ${booking.settlement_amount_fjd}`
      + (commission ? `, commission FJD ${commission.commission_fjd}` : '') + '.';
    for (const alertPhone of await getAdminAlertPhones(env)) {
      await sendHealthAlertWhatsApp(env, alertPhone, completedSummary, sqliteNow());
    }
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

  // Milestone 19 - this endpoint has its own raw INSERT (predates
  // createBookingRecord), not the shared insert path, so it needs its
  // own logBookingEvent() call rather than getting one for free.
  await logBookingEvent(env, { bookingId, eventType: 'created', previousStatus: null, newStatus: 'pending', actor: 'admin', metadata: { via: 'admin_test_booking' } });

  return json({ ok: true, booking_id: bookingId, booking, broadcast }, 201);
}

// Milestone 15: factored out of broadcastBookingToDrivers so the new
// negotiation-request broadcast (a real, separate notification - open
// request, not a confirmed job) can reuse the exact same "who's actually
// eligible" logic instead of a second, driftable copy of this query.
async function findMatchingOnlineDrivers(env, pickupZone) {
  const candidates = await env.DB.prepare(`SELECT id, name, phone, zones FROM drivers WHERE status = 'verified' AND online = 1`).all();
  return (candidates.results || []).filter((d) => JSON.parse(d.zones || '[]').includes(pickupZone));
}

// Shared by handleAdminTestBooking and Milestone 6's public
// handleGuestBookingCreate - one implementation of "who gets notified about
// a new booking" so the two entry points can't silently drift apart. Same
// query already verified in the Milestone 3 race-condition test (matching
// zone-inclusion filter, same sendBookingBroadcastWhatsApp call).
async function broadcastBookingToDrivers(env, booking) {
  const matching = await findMatchingOnlineDrivers(env, booking.pickup_zone);

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
// Trims/caps an optional itinerary string, normalising '' to null so it's
// stored as a real absence rather than an empty string. Shared by the
// pickup_date/pickup_time/notes/return_* fields on the public booking
// endpoint below.
function normalisedItineraryString(v, maxLen) {
  if (v === undefined || v === null) return null;
  const s = v.toString().trim().slice(0, maxLen);
  return s === '' ? null : s;
}

async function checkGuestBookingRateLimit(env, ip) {
  const max = Number(await getSetting(env, 'guest_booking_rate_limit_max', '5'));
  const windowMinutes = Number(await getSetting(env, 'guest_booking_rate_limit_window_minutes', '10'));
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM bookings WHERE source_ip = ? AND created_at > datetime('now', '-' || ? || ' minutes')`
  ).bind(ip, windowMinutes).first();
  const count = row ? row.cnt : 0;
  return { limited: count >= max, count, max, window_minutes: windowMinutes };
}

// Milestone 19: additive audit trail (booking_events) - never blocks or
// fails the real transition it's logging. A logging failure here must
// never break dispatch/wallet/booking logic, so this swallows its own
// errors rather than propagating them. metadata is stored as JSON text
// (or null) - the column itself imposes no shape, callers pass whatever
// context is useful for that event.
async function logBookingEvent(env, { bookingId, eventType, previousStatus = null, newStatus = null, actor = null, metadata = null }) {
  try {
    await env.DB.prepare(
      `INSERT INTO booking_events (booking_id, event_type, previous_status, new_status, actor, metadata) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(bookingId, eventType, previousStatus, newStatus, actor, metadata ? JSON.stringify(metadata) : null).run();
  } catch (err) {
    console.warn(`[booking-events] failed to log '${eventType}' for booking ${bookingId}: ${err.message}`);
  }
}

// Milestone 15: factored out of handleGuestBookingCreate so a negotiated
// booking (guest accepted a driver's offer) goes through the exact same
// validation/derivation as a normal fixed-fare booking - same bounds
// checks, same server-derived fuel_multiplier_applied/settlement_amount_fjd,
// never a hand-rolled parallel insert. assignedDriverId/status let the
// caller create either an open job (null/'pending', the existing flow,
// unchanged) or an already-agreed one (a known driver, 'accepted' - no
// race needed, that driver already committed by making their offer).
async function createBookingRecord(env, {
  guestName, guestPhone, pickupZone, destinationZone, distanceKm, vehicleType,
  quotedCurrency, quotedAmount, fxRate, paymentMethod, sourceIp,
  commissionBaseFjd = null, assignedDriverId = null, status = 'pending',
  // Itinerary fields - informational only, never used for pricing/commission
  // math. Added after a real return-trip booking reached dispatch with no
  // return date, time, or pickup location captured anywhere - the bookings
  // table previously stored zero itinerary detail for either leg. All
  // optional/null by default so the two other callers (admin test booking,
  // negotiation accept-offer) are unaffected.
  pickupDate = null, pickupTime = null, notes = null,
  returnDate = null, returnTime = null, returnPickupLocation = null,
  // Milestone 18 (Recommendation 1) - see computeAuthoritativePrice's own
  // header comment for the full scope/tier reasoning. verificationMode
  // defaults to 'trusted' (today's existing behavior, unchanged) so the
  // two other callers (admin test booking, negotiation accept-offer - both
  // already have their own, different, already-correct trust model) are
  // completely unaffected without having to pass anything new at all.
  // Only handleGuestBookingCreate passes 'authoritative'.
  verificationMode = 'trusted',
  tripType = 'one-way', isCustomAddress = false, hasTour = false,
  hasChildSeat = false, hasSurfboard = false,
  // Milestone 19 - who/what is actually creating this row. Each of the
  // three callers (guest create, negotiation accept-offer, admin manual-
  // assign) knows this for itself, so it's passed explicitly rather than
  // guessed from other fields. 'system' is a deliberately honest fallback
  // for any future caller that forgets to set it, not a real actor.
  actor = 'system',
}) {
  const errors = [];
  if (!guestPhone) errors.push('a valid guest_phone is required');
  if (!ALLOWED_VEHICLE_TYPES.includes(vehicleType)) errors.push(`vehicle_type must be one of: ${ALLOWED_VEHICLE_TYPES.join(', ')}`);
  if (!/^[A-Z]{3}$/.test(quotedCurrency)) errors.push('quoted_currency must be a 3-letter currency code');
  if (!quotedAmount || !isFinite(quotedAmount) || quotedAmount <= 0 || quotedAmount > 5000) errors.push('quoted_amount must be a positive number no greater than 5000');
  if (!fxRate || !isFinite(fxRate) || fxRate <= 0 || fxRate > 100) errors.push('fx_rate_at_booking must be a positive, sane number');
  if (distanceKm !== null && (!isFinite(distanceKm) || distanceKm < 0 || distanceKm > 500)) errors.push('distance_km out of range');
  if (!['cash', 'prepay'].includes(paymentMethod)) errors.push("payment_method must be 'cash' or 'prepay'");
  if (commissionBaseFjd !== null && (!isFinite(commissionBaseFjd) || commissionBaseFjd < 0 || commissionBaseFjd > quotedAmount)) errors.push('commission_base_fjd out of range');
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE = /^\d{2}:\d{2}$/;
  if (pickupDate !== null && !DATE_RE.test(pickupDate)) errors.push('pickup_date must be in YYYY-MM-DD format');
  if (pickupTime !== null && !TIME_RE.test(pickupTime)) errors.push('pickup_time must be in HH:MM format');
  if (returnDate !== null && !DATE_RE.test(returnDate)) errors.push('return_date must be in YYYY-MM-DD format');
  if (returnTime !== null && !TIME_RE.test(returnTime)) errors.push('return_time must be in HH:MM format');

  const validZones = await getValidZoneNames(env);
  if (!validZones.has(pickupZone)) errors.push(`unknown pickup_zone: ${pickupZone}`);
  if (!validZones.has(destinationZone)) errors.push(`unknown destination_zone: ${destinationZone}`);

  if (errors.length > 0) return { ok: false, errors };

  // Milestone 18 (Recommendation 1) - the actual trust-boundary flip.
  // isBoatBooking mirrors the existing commission_base_fjd convention:
  // that field is only ever set for boat bookings (see its own comment
  // below), so its presence is already a reliable signal, no new field
  // needed to detect this case.
  let pricingNote = null;
  const isBoatBooking = vehicleType === 'boat';
  if (verificationMode === 'authoritative') {
    if (isBoatBooking) {
      // Real gap found during Step 4 planning: a boat fare depends on the
      // adult/child passenger split, which never reaches this endpoint
      // today - full server recompute isn't possible without that field
      // (a named v1.1 follow-up). Lightweight consistency check instead:
      // the bundled total must be at least the already-verified land-leg
      // portion, and both must be positive.
      if (commissionBaseFjd !== null && quotedAmount < commissionBaseFjd) {
        pricingNote = `boat booking quoted_amount (${quotedAmount}) is less than its own verified land-leg portion (${commissionBaseFjd})`;
        console.warn(`[pricing-sanity] ${pricingNote} - ${pickupZone} -> ${destinationZone}`);
      }
    } else {
      const authoritative = await computeAuthoritativePrice(env, {
        pickupZone, destinationZone, vehicleType, tripType, pickupTime, hasChildSeat, hasSurfboard,
      });
      if (!authoritative.ok) {
        // Real-evidence fallback, not a new failure mode: if the server
        // can't compute a reference price right now (e.g. a transient
        // Google Routes API hiccup), keep trusting the client's number
        // rather than turning a previously-always-succeeding booking flow
        // into a new way to fail. Logged for visibility either way.
        console.warn(`[pricing-authoritative-unavailable] ${authoritative.error} - ${pickupZone} -> ${destinationZone} ${vehicleType} ${tripType}, falling back to client-trusted quoted_amount`);
      } else {
        // Real bug caught by live testing before this shipped: the client's
        // calculateTotal() applies the 10% loyalty discount (subtotal >
        // FJ$50, transfer-only) to what the guest actually sees and agrees
        // to - computeAuthoritativePrice() deliberately returns the
        // PRE-discount figure (see its own comment), so it must be applied
        // here, matching the client's exact whole-dollar rounding
        // (applyLoyaltyDiscount's own comment). hasTour=false is correct
        // for both non-tour branches below; the tour branch uses the raw,
        // undiscounted serverFjd, matching calculateTotal()'s own rule
        // that a tour booking never qualifies for this discount.
        const serverFjd = authoritative.transferPlusExtrasFjd;
        const serverFjdDiscounted = applyLoyaltyDiscount(serverFjd, false).finalFjd;
        if (!hasTour && !isCustomAddress) {
          // Recommendation 4: the real runtime guardrail, wired into the
          // live path here - assertSanePricing (pricing.mjs) was written
          // and unit-tested in Step 3 but never actually called until now.
          // Only meaningful for a return trip (assertSanePricing is a
          // no-op otherwise). A second computeAuthoritativePrice call
          // (identical inputs, tripType forced to 'one-way') gives an
          // apples-to-apples comparison with the same extras on both
          // sides, so extras don't dilute the return/one-way ratio being
          // checked. If it fails, the booking is NOT silently created
          // with a bad price - it's blocked and routed to a real human
          // via createEscalation(), the same alert path every other
          // needs-manual-confirmation case already uses.
          if (tripType === 'return') {
            const oneWayEquivalent = await computeAuthoritativePrice(env, {
              pickupZone, destinationZone, vehicleType, tripType: 'one-way', pickupTime, hasChildSeat, hasSurfboard,
            });
            if (oneWayEquivalent.ok) {
              const saneCheck = assertSanePricing({
                oneWayEquivalentFjd: oneWayEquivalent.transferPlusExtrasFjd,
                finalTotalFjd: serverFjd,
                tripType,
              });
              if (!saneCheck.sane) {
                await createEscalation(env, {
                  source: 'guest',
                  triggerType: 'needs_manual_confirmation',
                  context: `Pricing sanity check failed for a return-trip booking: ${saneCheck.reason}. ${pickupZone} -> ${destinationZone}, ${vehicleType} - computed return total FJD ${serverFjd} vs one-way equivalent FJD ${oneWayEquivalent.transferPlusExtrasFjd}. Booking blocked, needs manual confirmation.`,
                  sourceIp,
                });
                return { ok: false, errors: ['Could not confirm a reliable price for this booking automatically. We\'ve alerted our team and will follow up via WhatsApp to confirm your fare.'] };
              }
            }
          }
          // Real gap found via live testing after this shipped (James,
          // checking an unrelated applyExtras question): computeAuthoritativePrice
          // always uses the pricing_rules FORMULA (computeFareFjd), but the
          // client's real quoted_amount for a known route (e.g. Nadi Airport
          // -> Denarau) comes from a separate, curated PUBLISHED price table
          // (ROUTES_DATA, client-only - the server has no representation of
          // it at all). The two are close but not identical (e.g. $49
          // published vs $47.87 formula for that exact route) - full-replace
          // was silently overriding a real guest's real, published, agreed
          // price with a different number from a different source. That's
          // exactly the class of drift this whole initiative exists to
          // prevent, just from the server side this time.
          //
          // Narrowed to a sanity band rather than full replace (a real,
          // named v1.1 follow-up to fully close: port the published price
          // table server-side so full-replace can return - see the
          // README). Band is tighter than custom-address's 0.7x-3x
          // (published-vs-formula drift observed so far is a few percent,
          // not a real distance difference) but still generous enough not
          // to false-positive on normal route-to-route variation.
          //
          // Within the band, the client's number is genuinely trusted and
          // KEPT (it's the real published price, not overridden by the
          // formula approximation - this is the actual fix). Outside the
          // band is a different situation entirely - not legitimate
          // published-price drift anymore, either tampering or a genuinely
          // broken reference - and still falls back to the safe server
          // number, so this narrowing doesn't reopen the tampering gap
          // Step 4 closed; it just widens the untouched zone around a
          // real guest's real published price.
          if (quotedAmount < serverFjdDiscounted * 0.8 || quotedAmount > serverFjdDiscounted * 1.3) {
            console.warn(`[pricing-drift] client sent ${quotedAmount}, outside the plausible published-price range (formula reference ${serverFjdDiscounted}) for ${pickupZone} -> ${destinationZone} ${vehicleType} ${tripType} - replacing with the server number`);
            quotedAmount = serverFjdDiscounted;
          }
          distanceKm = authoritative.distanceKm; // server-derived distance is still trustworthy independent of which price source is used
        } else if (isCustomAddress && !hasTour) {
          // Real gap found during Step 4 planning: the server can't yet
          // re-derive a custom address's exact geocoded distance (no
          // address text reaches this endpoint) - a named v1.1 follow-up.
          // Sanity floor/ceiling instead of full replace: a real
          // point-to-point distance is usually >= the zone-centroid
          // distance, sometimes notably more, so 0.7x-3x is a deliberately
          // wide band, not a tight tolerance.
          if (quotedAmount < serverFjdDiscounted * 0.7 || quotedAmount > serverFjdDiscounted * 3) {
            pricingNote = `custom-address quoted_amount (${quotedAmount}) is outside the plausible range for this route (zone-floor reference ${serverFjdDiscounted})`;
            console.warn(`[pricing-sanity] ${pricingNote} - ${pickupZone} -> ${destinationZone}`);
          }
        }
        if (hasTour) {
          // Tour cost itself has zero server-side pricing data (out of
          // scope until v2) - only the transfer+extras portion is
          // verified. The remainder must be non-negative; no upper bound
          // yet (TOURS_DATA prices vary widely by tour). Raw serverFjd
          // (undiscounted) is correct here - a tour booking never
          // qualifies for the loyalty discount, matching the client.
          //
          // Recommendation 4: this used to only log a warning and still
          // create the booking anyway - the exact gap James asked to
          // close. Now actually blocks it and alerts a human via the
          // same createEscalation() / WhatsApp path every other
          // needs-manual-confirmation case already uses, instead of
          // silently dispatching a booking with an impossible price.
          const remainder = quotedAmount - serverFjd;
          if (remainder < 0) {
            const reason = `tour booking quoted_amount (${quotedAmount}) is less than its own verified transfer+extras portion (${serverFjd})`;
            console.warn(`[pricing-sanity] ${reason} - ${pickupZone} -> ${destinationZone}`);
            await createEscalation(env, {
              source: 'guest',
              triggerType: 'needs_manual_confirmation',
              context: `Pricing sanity check failed for a tour booking: ${reason}. ${pickupZone} -> ${destinationZone}, ${vehicleType}. Booking blocked, needs manual confirmation.`,
              sourceIp,
            });
            return { ok: false, errors: ['Could not confirm a reliable price for this tour booking automatically. We\'ve alerted our team and will follow up via WhatsApp to confirm your fare.'] };
          }
        }
      }
    }
  }

  const fuelRow = await env.DB.prepare(`SELECT multiplier FROM fuel_index ORDER BY id DESC LIMIT 1`).first();
  const fuelMultiplierApplied = fuelRow ? fuelRow.multiplier : 1;
  const settlementAmountFjd = Math.round(quotedAmount * fxRate * 100) / 100;

  const insert = await env.DB.prepare(
    `INSERT INTO bookings (guest_name, guest_phone, pickup_zone, destination_zone, distance_km, vehicle_type,
       quoted_currency, quoted_amount, fx_rate_at_booking, settlement_amount_fjd, fuel_multiplier_applied,
       payment_method, status, source_ip, commission_base_fjd, assigned_driver_id,
       pickup_date, pickup_time, notes, return_date, return_time, return_pickup_location)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    guestName, guestPhone, pickupZone, destinationZone, distanceKm, vehicleType,
    quotedCurrency, quotedAmount, fxRate, settlementAmountFjd, fuelMultiplierApplied,
    paymentMethod, status, sourceIp, commissionBaseFjd, assignedDriverId,
    pickupDate, pickupTime, notes, returnDate, returnTime, returnPickupLocation
  ).run();

  const bookingId = insert.meta.last_row_id;
  const booking = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(bookingId).first();

  await logBookingEvent(env, {
    bookingId, eventType: 'created', previousStatus: null, newStatus: status, actor,
    metadata: assignedDriverId ? { assigned_driver_id: assignedDriverId } : null,
  });

  // pricingNote is never blocking (see the tiered logic above) - surfaced
  // here so a caller can decide whether to also raise a real ops alert.
  // Wiring that alert (Recommendation 4's escalation routing) is the next
  // step, not this one.
  return { ok: true, bookingId, booking, pricingNote };
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

  const result = await createBookingRecord(env, {
    guestName: (body.guest_name || '').toString().trim().slice(0, 200) || 'Guest',
    guestPhone: normalisePhone((body.guest_phone || '').toString()),
    pickupZone: (body.pickup_zone || '').toString().trim(),
    destinationZone: (body.destination_zone || '').toString().trim(),
    vehicleType: (body.vehicle_type || '').toString().trim().toLowerCase(),
    quotedCurrency: (body.quoted_currency || '').toString().trim().toUpperCase(),
    quotedAmount: Number(body.quoted_amount),
    fxRate: body.fx_rate_at_booking !== undefined ? Number(body.fx_rate_at_booking) : 1,
    distanceKm: body.distance_km !== undefined && body.distance_km !== null ? Number(body.distance_km) : null,
    paymentMethod: (body.payment_method || '').toString().trim().toLowerCase(),
    // Milestone 13: for a boat booking, the land-leg-only portion of the
    // bundled quoted_amount - kept separate so a future commission pass
    // never charges/credits a driver commission on the boat operator's
    // pass-through fare. null for every ordinary road booking, unchanged.
    commissionBaseFjd: body.commission_base_fjd !== undefined && body.commission_base_fjd !== null ? Number(body.commission_base_fjd) : null,
    sourceIp: clientIp,
    pickupDate: normalisedItineraryString(body.pickup_date, 10),
    pickupTime: normalisedItineraryString(body.pickup_time, 5),
    notes: normalisedItineraryString(body.notes, 1000),
    returnDate: normalisedItineraryString(body.return_date, 10),
    returnTime: normalisedItineraryString(body.return_time, 5),
    returnPickupLocation: normalisedItineraryString(body.return_pickup_location, 300),
    // Milestone 18 (Recommendation 1) - the only caller that opts into
    // server-authoritative pricing. tripType/hasChildSeat/hasSurfboard/
    // hasTour/isCustomAddress are new fields the guest widget now sends
    // (see app.js's submitMarketplaceBooking) specifically so this trust-
    // boundary flip has what it needs - see computeAuthoritativePrice's
    // own comment for exactly how each is used.
    verificationMode: 'authoritative',
    tripType: (body.trip_type || 'one-way').toString().trim() === 'return' ? 'return' : 'one-way',
    isCustomAddress: body.is_custom_address === true,
    hasTour: body.has_tour === true,
    hasChildSeat: body.has_child_seat === true,
    hasSurfboard: body.has_surfboard === true,
    actor: 'guest', // the public guest widget - a real guest's own booking submission
  });
  if (!result.ok) return json({ ok: false, errors: result.errors }, 400);

  const broadcast = await broadcastBookingToDrivers(env, result.booking);

  // Real ops alert, same mechanism as health-check/fuel-index/escalation
  // alerts - not exposed in the response, same discipline as the driver-
  // application alert above and every other admin-facing detail in this
  // build that a public caller doesn't need to see.
  const b = result.booking;
  const bookingSummary = `New booking #${b.id}: ${b.guest_name}, ${b.pickup_zone} -> ${b.destination_zone}, ${b.vehicle_type}, ${b.quoted_currency} ${b.quoted_amount}.`;
  for (const alertPhone of await getAdminAlertPhones(env)) {
    await sendHealthAlertWhatsApp(env, alertPhone, bookingSummary, sqliteNow());
  }

  return json({ ok: true, booking_id: result.bookingId, booking: result.booking, broadcast }, 201);
}

// ═══════════════════════════════════════════════════════════════
// MILESTONE 15 — guest price negotiation, in-house drivers only. A guest
// proposes their own price instead of accepting the fitted rate-card fare;
// zone-matching online drivers can accept it as-is or counter with a
// different number (one response each, enforced by negotiation_offers'
// UNIQUE(request_id, driver_id)); the guest picks one offer to accept,
// which creates a real bookings row via createBookingRecord() above -
// same validation every fixed-fare booking already gets, on the actual
// agreed price, never the original proposal or the reference fare.
// ═══════════════════════════════════════════════════════════════

async function checkNegotiationRateLimit(env, ip) {
  const max = Number(await getSetting(env, 'negotiation_rate_limit_max_per_day', '5'));
  const windowMinutes = Number(await getSetting(env, 'negotiation_rate_limit_window_minutes', '10'));
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM negotiation_requests WHERE source_ip = ? AND created_at > datetime('now', '-' || ? || ' minutes')`
  ).bind(ip, windowMinutes).first();
  const count = row ? row.cnt : 0;
  return { limited: count >= max, count, max, window_minutes: windowMinutes };
}

// MILESTONE 16: a much higher-traffic limit than negotiation_rate_limit -
// this is hit on every eligible step-4 render (a real fare preview), not
// just on an actual proposal submit. Tracked in its own table so a burst
// of previews doesn't skew negotiation_requests' own rate-limit counting.
async function checkReferenceFareRateLimit(env, ip) {
  const max = Number(await getSetting(env, 'reference_fare_rate_limit_max_per_day', '60'));
  const windowMinutes = Number(await getSetting(env, 'reference_fare_rate_limit_window_minutes', '10'));
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM reference_fare_lookups WHERE source_ip = ? AND created_at > datetime('now', '-' || ? || ' minutes')`
  ).bind(ip, windowMinutes).first();
  const count = row ? row.cnt : 0;
  return { limited: count >= max, count, max, window_minutes: windowMinutes };
}

// MILESTONE 16: lets the guest widget show the SAME real reference fare
// /negotiate will actually enforce, before the guest ever submits a
// proposal - closes the display-layer inconsistency between the client's
// own published-price/formula estimate and the server's real number.
// Public, GET, no guest identity needed (mirrors GET /destinations) -
// this only ever returns a route-level fare, never anything guest- or
// booking-specific.
async function handleReferenceFarePreview(request, env) {
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);

  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateLimit = await checkReferenceFareRateLimit(env, clientIp);
  if (rateLimit.limited) {
    return json({ ok: false, error: 'Too many fare lookups from this connection. Please try again shortly.' }, 429);
  }

  const url = new URL(request.url);
  const pickupZone = (url.searchParams.get('pickup_zone') || '').trim();
  const destinationZone = (url.searchParams.get('destination_zone') || '').trim();
  const vehicleType = (url.searchParams.get('vehicle_type') || '').trim().toLowerCase();
  // Real bug fix (Milestone 17) - see applyTripTypeMultiplier's comment in
  // pricing.mjs. Defaults to 'one-way' so this stays backward-compatible
  // with any caller that doesn't send it.
  const tripType = (url.searchParams.get('trip_type') || 'one-way').trim();

  const errors = [];
  if (!['sedan', 'minivan', 'minibus'].includes(vehicleType)) errors.push('vehicle_type must be one of: sedan, minivan, minibus');
  if (!['one-way', 'return'].includes(tripType)) errors.push("trip_type must be one of: one-way, return");
  const validZones = await getValidZoneNames(env);
  if (!validZones.has(pickupZone)) errors.push(`unknown pickup_zone: ${pickupZone}`);
  if (!validZones.has(destinationZone)) errors.push(`unknown destination_zone: ${destinationZone}`);
  if (errors.length === 0 && pickupZone !== NADI_AIRPORT_ZONE_NAME && destinationZone !== NADI_AIRPORT_ZONE_NAME) {
    errors.push('one of pickup_zone or destination_zone must be Nadi Airport - reference fares are scoped to airport-anchored routes only');
  }
  if (errors.length > 0) return json({ ok: false, errors }, 400);

  const result = await computeRealReferenceFare(env, pickupZone, destinationZone, vehicleType, tripType);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);

  // Real fix: only a genuine cache miss (a real, billable Google Routes API
  // call) counts against the rate limit - a cache hit costs nothing, so it
  // shouldn't consume the same daily allowance. Previously incremented
  // unconditionally, which meant a guest re-visiting step 4 on an
  // already-cached route (or several guests behind one hotel/NAT IP) could
  // get falsely rate-limited for completely free requests.
  if (!result.cacheHit) {
    await env.DB.prepare(`INSERT INTO reference_fare_lookups (source_ip) VALUES (?)`).bind(clientIp).run();
  }

  return json({ ok: true, reference_fare_fjd: result.referenceFareFjd, distance_km: result.distanceKm, cached: result.cacheHit }, 200);
}

async function handleNegotiationCreate(request, env) {
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);

  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateLimit = await checkNegotiationRateLimit(env, clientIp);
  if (rateLimit.limited) {
    return json({ ok: false, error: 'Too many price proposals from this connection. Please try again shortly.' }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }

  const guestName = (body.guest_name || '').toString().trim().slice(0, 200) || 'Guest';
  const guestPhone = normalisePhone((body.guest_phone || '').toString());
  const pickupZone = (body.pickup_zone || '').toString().trim();
  const destinationZone = (body.destination_zone || '').toString().trim();
  const vehicleType = (body.vehicle_type || '').toString().trim().toLowerCase();
  const passengers = body.passengers !== undefined && body.passengers !== null ? Number(body.passengers) : null;
  const pickupDatetime = body.pickup_datetime ? body.pickup_datetime.toString().trim() : null;
  const guestProposedAmountFjd = Number(body.guest_proposed_amount_fjd);
  // Real bug fix (Milestone 17) - see applyTripTypeMultiplier's comment in
  // pricing.mjs. Without this, the negotiation floor below was enforced
  // against a one-way reference fare even for a return-trip proposal - a
  // real, exploitable underpricing gap,
  // not just a display bug (a driver could actually accept a return-trip
  // job at ~80% of the one-way fare). Defaults to 'one-way' for
  // backward-compatibility with any caller that doesn't send it.
  const tripType = (body.trip_type || 'one-way').toString().trim();
  // reference_fare_fjd is deliberately NEVER read from the request body -
  // see the real fare computation below. Whatever a client sends for it is
  // ignored entirely, not just bounds-checked.

  const errors = [];
  if (!guestPhone) errors.push('a valid guest_phone is required');
  // Boat excluded deliberately - a boat fare is a real third-party bundled
  // price FTT doesn't set, negotiating it doesn't make sense.
  if (!['sedan', 'minivan', 'minibus'].includes(vehicleType)) errors.push('vehicle_type must be one of: sedan, minivan, minibus');
  if (!['one-way', 'return'].includes(tripType)) errors.push("trip_type must be one of: one-way, return");
  if (passengers !== null && (!Number.isInteger(passengers) || passengers < 1 || passengers > 20)) errors.push('passengers must be an integer between 1 and 20');
  if (!guestProposedAmountFjd || !isFinite(guestProposedAmountFjd) || guestProposedAmountFjd <= 0 || guestProposedAmountFjd > 5000) errors.push('guest_proposed_amount_fjd must be a positive number no greater than 5000');

  const validZones = await getValidZoneNames(env);
  if (!validZones.has(pickupZone)) errors.push(`unknown pickup_zone: ${pickupZone}`);
  if (!validZones.has(destinationZone)) errors.push(`unknown destination_zone: ${destinationZone}`);
  // Real, in-scope hardening: the guest widget only ever constructs this
  // request for the two airport-anchored routes (see
  // resolveNegotiationEligibility in app.js), but nothing stopped a direct
  // API caller from submitting an arbitrary zone pair. Negotiated fares
  // are scoped to airport-anchored routes only - enforce that server-side
  // too, not just trust the client to have checked it.
  if (errors.length === 0 && pickupZone !== NADI_AIRPORT_ZONE_NAME && destinationZone !== NADI_AIRPORT_ZONE_NAME) {
    errors.push('one of pickup_zone or destination_zone must be Nadi Airport - negotiated fares are scoped to airport-anchored routes only');
  }

  if (errors.length > 0) return json({ ok: false, errors }, 400);

  // MILESTONE 16 real fix: reference_fare_fjd is computed here, server-side
  // (see computeRealReferenceFare) - never trusted from the client. Closes
  // a real gap: a guest could previously submit a fake low
  // reference_fare_fjd alongside a proportionally low-balled proposal and
  // pass the 80% floor check against a number they invented.
  const refFareResult = await computeRealReferenceFare(env, pickupZone, destinationZone, vehicleType, tripType);
  if (!refFareResult.ok) {
    return json({ ok: false, error: refFareResult.error }, refFareResult.status);
  }
  const { referenceFareFjd: realReferenceFareFjd, distanceKm: realDistanceKm } = refFareResult;

  // Real floor enforcement against the real, server-computed reference
  // fare - not whatever the client claimed it was.
  const floorFjd = realReferenceFareFjd * NEGOTIATION_FLOOR_RATIO;
  if (guestProposedAmountFjd < floorFjd) {
    return json({
      ok: false,
      errors: [`guest_proposed_amount_fjd must be at least ${Math.round(floorFjd * 100) / 100} (${Math.round(NEGOTIATION_FLOOR_RATIO * 100)}% of the real standard fare for this route, ${realReferenceFareFjd})`],
    }, 400);
  }

  const insert = await env.DB.prepare(
    `INSERT INTO negotiation_requests (guest_name, guest_phone, pickup_zone, destination_zone, distance_km, vehicle_type,
       passengers, pickup_datetime, reference_fare_fjd, guest_proposed_amount_fjd, source_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    guestName, guestPhone, pickupZone, destinationZone, realDistanceKm, vehicleType,
    passengers, pickupDatetime, realReferenceFareFjd, guestProposedAmountFjd, clientIp
  ).run();

  const requestId = insert.meta.last_row_id;
  const negotiationRequest = await env.DB.prepare(`SELECT * FROM negotiation_requests WHERE id = ?`).bind(requestId).first();

  // Reuses vakaviti_booking_broadcast as-is for this build (see the
  // Milestone 15 report) - the guest's proposed price goes in the
  // existing {{4}} fare slot. A dedicated negotiation template with
  // clearer wording is a real, natural fast-follow, not a blocker: the
  // driver has to open the app to see full context and respond either
  // way, so nothing about accept/counter itself depends on the template.
  const matching = await findMatchingOnlineDrivers(env, pickupZone);
  const results = [];
  for (const d of matching) {
    const whatsappResult = await sendBookingBroadcastWhatsApp(env, d.phone, {
      pickup_zone: pickupZone,
      destination_zone: destinationZone,
      vehicle_type: vehicleType,
      quoted_currency: 'FJD',
      quoted_amount: guestProposedAmountFjd,
    });
    results.push({ driver_id: d.id, driver_name: d.name, whatsapp: whatsappResult });
  }

  return json({
    ok: true,
    request_id: requestId,
    request: negotiationRequest,
    broadcast: { matched_drivers: matching.length, results },
  }, 201);
}

// Polling endpoint for the guest widget - no guest auth/session system
// exists to push to, so the guest stays on a "waiting for driver" screen
// that polls this. Lazy-expires the request on read rather than adding a
// new cron trigger - a guest watching this poll is the only real
// consumer, nothing to sweep proactively in the background.
async function handleNegotiationStatus(request, env, requestId) {
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);

  const negotiationRequest = await env.DB.prepare(`SELECT * FROM negotiation_requests WHERE id = ?`).bind(requestId).first();
  if (!negotiationRequest) return json({ ok: false, error: 'Negotiation request not found.' }, 404);

  if (negotiationRequest.status === 'open') {
    const expiryMinutes = Number(await getSetting(env, 'negotiation_expiry_minutes', '20'));
    const ageRow = await env.DB.prepare(
      `SELECT (julianday('now') - julianday(created_at)) * 24 * 60 AS age_minutes FROM negotiation_requests WHERE id = ?`
    ).bind(requestId).first();
    if (ageRow && ageRow.age_minutes >= expiryMinutes) {
      await env.DB.prepare(`UPDATE negotiation_requests SET status = 'expired' WHERE id = ? AND status = 'open'`).bind(requestId).run();
      negotiationRequest.status = 'expired';
    }
  }

  const offers = await env.DB.prepare(
    `SELECT id, driver_id, offer_type, offer_amount_fjd, guest_decision, created_at FROM negotiation_offers WHERE request_id = ? ORDER BY created_at ASC`
  ).bind(requestId).all();

  return json({ ok: true, request: negotiationRequest, offers: offers.results || [] }, 200);
}

async function handleNegotiationAcceptOffer(request, env, requestId) {
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }
  const offerId = Number(body.offer_id);
  if (!Number.isInteger(offerId) || offerId <= 0) return json({ ok: false, error: 'offer_id must be a positive integer' }, 400);

  const negotiationRequest = await env.DB.prepare(`SELECT * FROM negotiation_requests WHERE id = ?`).bind(requestId).first();
  if (!negotiationRequest) return json({ ok: false, error: 'Negotiation request not found.' }, 404);
  if (negotiationRequest.status !== 'open') {
    return json({ ok: false, error: `This request is ${negotiationRequest.status}, cannot accept an offer.` }, 409);
  }

  const offer = await env.DB.prepare(`SELECT * FROM negotiation_offers WHERE id = ? AND request_id = ?`).bind(offerId, requestId).first();
  if (!offer) return json({ ok: false, error: 'Offer not found for this request.' }, 404);
  if (offer.guest_decision !== 'pending') {
    return json({ ok: false, error: `This offer is already ${offer.guest_decision}.` }, 409);
  }

  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';

  // The exact requirement #6 ask - the FINAL agreed price (this offer's
  // amount, not the guest's original proposal, not reference_fare_fjd)
  // goes through createBookingRecord(), the same validation/derivation
  // every fixed-fare booking already uses. The driver is already known,
  // so this skips 'pending'/broadcast entirely - status='accepted' with
  // assignedDriverId pre-set, no accept race needed.
  const result = await createBookingRecord(env, {
    guestName: negotiationRequest.guest_name,
    guestPhone: negotiationRequest.guest_phone,
    pickupZone: negotiationRequest.pickup_zone,
    destinationZone: negotiationRequest.destination_zone,
    distanceKm: negotiationRequest.distance_km,
    vehicleType: negotiationRequest.vehicle_type,
    quotedCurrency: 'FJD',
    quotedAmount: offer.offer_amount_fjd,
    fxRate: 1,
    paymentMethod: 'cash',
    sourceIp: clientIp,
    assignedDriverId: offer.driver_id,
    status: 'accepted',
    // Milestone 18 - explicit, not just the default. This price is
    // intentionally different from the standard fare (that's the whole
    // point of negotiation) and is already independently verified via
    // the trip-type-aware floor check at negotiation-create time -
    // re-running the standard-fare check here would incorrectly flag a
    // legitimate negotiated price.
    verificationMode: 'trusted',
    actor: 'guest', // the guest's own tap accepting a driver's counter-offer created this row
  });
  if (!result.ok) return json({ ok: false, errors: result.errors }, 400);

  await env.DB.batch([
    env.DB.prepare(`UPDATE negotiation_offers SET guest_decision = 'accepted' WHERE id = ?`).bind(offerId),
    env.DB.prepare(`UPDATE negotiation_offers SET guest_decision = 'declined' WHERE request_id = ? AND id != ?`).bind(requestId, offerId),
    env.DB.prepare(`UPDATE negotiation_requests SET status = 'accepted', booking_id = ? WHERE id = ?`).bind(result.bookingId, requestId),
  ]);

  // Admin visibility on the real, agreed outcome only - not on every
  // intermediate offer, matching "same visibility as everything else"
  // without paging James/Ben on every counter that comes in. Reuses
  // sendHealthAlertWhatsApp() the same way sendEscalationAlert() does.
  const alertPhone = await getSetting(env, 'admin_alert_phone', '');
  const alert = alertPhone
    ? await sendHealthAlertWhatsApp(env, alertPhone, `Negotiated booking #${result.bookingId} agreed: FJD ${offer.offer_amount_fjd} (${negotiationRequest.pickup_zone} -> ${negotiationRequest.destination_zone})`, sqliteNow())
    : { attempted: false, reason: 'platform_settings.admin_alert_phone is not set.' };

  return json({ ok: true, booking_id: result.bookingId, booking: result.booking, alert }, 200);
}

// Same online+zone filter handleDriverJobs already uses for the fixed-job
// feed, plus excludes requests this driver already responded to (a clean
// UX filter - negotiation_offers' UNIQUE(request_id, driver_id) is the
// real backstop against a second response, not this list).
async function handleDriverNegotiationRequests(request, env) {
  const driver = await requireDriver(request, env);
  if (!driver) return json({ error: 'Unauthorized or expired session.' }, 401);
  if (!driver.online) return json({ requests: [], note: 'Go online to see available requests.' }, 200);

  const driverZones = new Set(JSON.parse(driver.zones || '[]'));
  const result = await env.DB.prepare(
    `SELECT id, guest_name, pickup_zone, destination_zone, distance_km, vehicle_type, passengers,
            pickup_datetime, reference_fare_fjd, guest_proposed_amount_fjd, status, created_at
     FROM negotiation_requests WHERE status = 'open' ORDER BY created_at ASC LIMIT 20`
  ).all();

  const alreadyResponded = await env.DB.prepare(
    `SELECT request_id FROM negotiation_offers WHERE driver_id = ?`
  ).bind(driver.id).all();
  const respondedIds = new Set((alreadyResponded.results || []).map((r) => r.request_id));

  const requests = (result.results || [])
    .filter((r) => driverZones.has(r.pickup_zone) && !respondedIds.has(r.id));
  return json({ requests }, 200);
}

async function handleDriverNegotiationOffer(request, env, requestId) {
  const driver = await requireDriver(request, env);
  if (!driver) return json({ error: 'Unauthorized or expired session.' }, 401);
  if (!driver.online) return json({ error: 'Go online to respond to requests.' }, 403);

  const target = await env.DB.prepare(`SELECT pickup_zone, status FROM negotiation_requests WHERE id = ?`).bind(requestId).first();
  if (!target) return json({ error: 'Negotiation request not found.' }, 404);
  const driverZones = new Set(JSON.parse(driver.zones || '[]'));
  if (!driverZones.has(target.pickup_zone)) {
    return json({ error: 'This request is outside your online zones.' }, 403);
  }
  if (target.status !== 'open') {
    return json({ error: `This request is ${target.status}, no longer open.` }, 409);
  }

  const locked = await enforceWalletLockout(env, driver.id);
  if (locked.locked) {
    return json({ error: 'Wallet balance below the allowed threshold. Settle your balance before responding to requests.', balance_fjd: locked.balance_fjd, threshold_fjd: locked.threshold_fjd }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const offerType = (body.type || '').toString().trim().toLowerCase();
  if (!['accept', 'counter'].includes(offerType)) return json({ error: "type must be 'accept' or 'counter'" }, 400);

  let offerAmount;
  if (offerType === 'accept') {
    const req = await env.DB.prepare(`SELECT guest_proposed_amount_fjd FROM negotiation_requests WHERE id = ?`).bind(requestId).first();
    offerAmount = req.guest_proposed_amount_fjd;
  } else {
    offerAmount = Number(body.amount_fjd);
    if (!offerAmount || !isFinite(offerAmount) || offerAmount <= 0 || offerAmount > 5000) {
      return json({ error: 'amount_fjd must be a positive number no greater than 5000 for a counter' }, 400);
    }
  }

  try {
    const insert = await env.DB.prepare(
      `INSERT INTO negotiation_offers (request_id, driver_id, offer_type, offer_amount_fjd) VALUES (?, ?, ?, ?)`
    ).bind(requestId, driver.id, offerType, offerAmount).run();
    const offer = await env.DB.prepare(`SELECT * FROM negotiation_offers WHERE id = ?`).bind(insert.meta.last_row_id).first();
    return json({ ok: true, offer }, 201);
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return json({ error: 'You have already responded to this request.' }, 409);
    }
    throw err;
  }
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

// Single-recipient today (platform_settings.admin_alert_phone), returned as
// a list so callers already loop over it - a future multi-recipient rollout
// becomes a data change (more entries) rather than a rewrite of every call
// site. Deliberately not multi-recipient yet, per instruction: confirm
// single-number delivery works cleanly first.
async function getAdminAlertPhones(env) {
  const phone = await getSetting(env, 'admin_alert_phone', '');
  return phone ? [phone] : [];
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
  // Milestone 13: boat-transfer fields, all optional - only meaningful when
  // transfer_type='boat'. Left null for the normal road-destination case.
  const transferType = (body.transfer_type || 'road').toString().trim().toLowerCase();
  const boatAdultFareFjd = body.boat_adult_fare_fjd !== undefined && body.boat_adult_fare_fjd !== null ? Number(body.boat_adult_fare_fjd) : null;
  const boatChildFareFjd = body.boat_child_fare_fjd !== undefined && body.boat_child_fare_fjd !== null ? Number(body.boat_child_fare_fjd) : null;
  const boatLandLegFareFjd = body.boat_land_leg_fare_fjd !== undefined && body.boat_land_leg_fare_fjd !== null ? Number(body.boat_land_leg_fare_fjd) : null;
  const boatOperatorName = body.boat_operator_name ? body.boat_operator_name.toString().trim() : null;
  const boatFareSourcedAt = body.boat_fare_sourced_at ? body.boat_fare_sourced_at.toString().trim() : null;
  const boatFareSourceNote = body.boat_fare_source_note ? body.boat_fare_source_note.toString().trim() : null;
  // Milestone 14: explicit if provided; otherwise inferred from whether a
  // fare was given, so existing callers that already pass a real fare
  // (the original 5 boat destinations' creation calls) keep working
  // unchanged. Only meaningful for transfer_type='boat' - null for road.
  const pricingStatus = body.pricing_status
    ? body.pricing_status.toString().trim().toLowerCase()
    : (transferType === 'boat' ? (boatAdultFareFjd ? 'sourced' : 'pending') : null);

  const errors = [];
  if (!name) errors.push('name is required');
  if (!ALLOWED_DESTINATION_TYPES.includes(type)) errors.push(`type must be one of: ${ALLOWED_DESTINATION_TYPES.join(', ')}`);
  if (!zoneName) errors.push('zone is required');
  if (!['road', 'boat'].includes(transferType)) errors.push(`transfer_type must be one of: road, boat`);
  if (transferType === 'boat' && !['sourced', 'pending'].includes(pricingStatus)) errors.push(`pricing_status must be one of: sourced, pending (required for transfer_type=boat)`);
  if (transferType === 'boat' && pricingStatus === 'sourced' && !boatAdultFareFjd) errors.push('boat_adult_fare_fjd is required when pricing_status is sourced');
  if (errors.length > 0) return json({ ok: false, errors }, 400);

  const zone = await env.DB.prepare(`SELECT id FROM zones WHERE name = ?`).bind(zoneName).first();
  if (!zone) return json({ ok: false, error: `unknown zone: ${zoneName}` }, 400);

  const insert = await env.DB.prepare(
    `INSERT INTO destinations (name, type, zone_id, display_order, active, transfer_type, boat_adult_fare_fjd, boat_child_fare_fjd, boat_land_leg_fare_fjd, boat_operator_name, boat_fare_sourced_at, boat_fare_source_note, pricing_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(name, type, zone.id, displayOrder, active, transferType, boatAdultFareFjd, boatChildFareFjd, boatLandLegFareFjd, boatOperatorName, boatFareSourcedAt, boatFareSourceNote, pricingStatus).run();

  const destinationId = insert.meta.last_row_id;
  const row = await env.DB.prepare(
    `SELECT d.id, d.name, d.type, d.active, d.display_order, z.name AS zone,
            d.transfer_type, d.pricing_status, d.boat_adult_fare_fjd, d.boat_child_fare_fjd, d.boat_land_leg_fare_fjd, d.boat_operator_name
     FROM destinations d JOIN zones z ON z.id = d.zone_id WHERE d.id = ?`
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
  // Milestone 14: lets a 'pending' boat destination be updated to
  // 'sourced' in place once a real fare comes in (per Milestone 13's
  // journal-style boat_fare_sourced_at/source_note discipline) - the same
  // row, never a duplicate insert. Every boat-specific field is editable
  // independently since a re-verification (Milestone 13's documented
  // monthly-recheck cadence) may only need to touch the fare, not the
  // whole row.
  if (body.pricing_status !== undefined) {
    const pricingStatus = body.pricing_status === null ? null : body.pricing_status.toString().trim().toLowerCase();
    if (pricingStatus !== null && !['sourced', 'pending'].includes(pricingStatus)) {
      return json({ ok: false, error: "pricing_status must be 'sourced', 'pending', or null" }, 400);
    }
    updates.push('pricing_status = ?'); values.push(pricingStatus);
  }
  if (body.transfer_type !== undefined) {
    const transferType = body.transfer_type.toString().trim().toLowerCase();
    if (!['road', 'boat'].includes(transferType)) return json({ ok: false, error: 'transfer_type must be one of: road, boat' }, 400);
    updates.push('transfer_type = ?'); values.push(transferType);
  }
  if (body.boat_adult_fare_fjd !== undefined) {
    updates.push('boat_adult_fare_fjd = ?'); values.push(body.boat_adult_fare_fjd === null ? null : Number(body.boat_adult_fare_fjd));
  }
  if (body.boat_child_fare_fjd !== undefined) {
    updates.push('boat_child_fare_fjd = ?'); values.push(body.boat_child_fare_fjd === null ? null : Number(body.boat_child_fare_fjd));
  }
  if (body.boat_land_leg_fare_fjd !== undefined) {
    updates.push('boat_land_leg_fare_fjd = ?'); values.push(body.boat_land_leg_fare_fjd === null ? null : Number(body.boat_land_leg_fare_fjd));
  }
  if (body.boat_operator_name !== undefined) {
    updates.push('boat_operator_name = ?'); values.push(body.boat_operator_name ? body.boat_operator_name.toString().trim() : null);
  }
  if (body.boat_fare_sourced_at !== undefined) {
    updates.push('boat_fare_sourced_at = ?'); values.push(body.boat_fare_sourced_at ? body.boat_fare_sourced_at.toString().trim() : null);
  }
  if (body.boat_fare_source_note !== undefined) {
    updates.push('boat_fare_source_note = ?'); values.push(body.boat_fare_source_note ? body.boat_fare_source_note.toString().trim() : null);
  }

  if (updates.length === 0) return json({ ok: false, error: 'No fields to update.' }, 400);

  values.push(destinationId);
  await env.DB.prepare(`UPDATE destinations SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  const row = await env.DB.prepare(
    `SELECT d.id, d.name, d.type, d.active, d.display_order, z.name AS zone,
            d.transfer_type, d.pricing_status, d.boat_adult_fare_fjd, d.boat_child_fare_fjd,
            d.boat_land_leg_fare_fjd, d.boat_operator_name, d.boat_fare_sourced_at, d.boat_fare_source_note
     FROM destinations d JOIN zones z ON z.id = d.zone_id WHERE d.id = ?`
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
// Real evidence (live diagnostic call): when Google can't place a text
// address, it doesn't reliably fail - it can silently fall back to a
// broad administrative area (country/region/province) and still report a
// "successful" geocode. A route waypoint resolved to one of these is
// never a real pickup/drop-off point, regardless of partialMatch.
const LOW_CONFIDENCE_GEOCODE_TYPES = new Set([
  'country',
  'administrative_area_level_1',
  'administrative_area_level_2',
]);

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

// Milestone 18: the DB lookup (which pricing_rules row applies) stays
// here - the actual formula (steps 2-3-7 of pricing.mjs) is now the same
// named, independently-unit-tested functions the pricing test suite
// exercises directly, not a separate inline copy.
async function computeFareFjd(env, vehicleType, distanceKm, remoteMultiplier) {
  const rule = await env.DB.prepare(
    `SELECT base_rate_fjd_per_km, flagfall_fjd FROM pricing_rules
     WHERE vehicle_type = ? AND active = 1 AND distance_min_km <= ? AND (distance_max_km IS NULL OR ? < distance_max_km)
     ORDER BY distance_min_km DESC LIMIT 1`
  ).bind(vehicleType, distanceKm, distanceKm).first();
  if (!rule) return null;
  const baseFare = computeBaseFare({ flagfallFjd: rule.flagfall_fjd, baseRateFjdPerKm: rule.base_rate_fjd_per_km, distanceKm });
  const withZoneMultiplier = applyZoneMultiplier(baseFare, remoteMultiplier);
  return computeFinalTotal(withZoneMultiplier);
}

// MILESTONE 16: real driving distance between two KNOWN zone coordinates
// (used for /negotiate's server-computed reference fare) - both ends come
// from the zones table, already-verified data, not free text, so this
// skips geocoding/confidence-gating entirely and just asks Routes API for
// the real distance between two location points.
async function computeZoneToZoneDistanceKm(env, lat1, lng1, lat2, lng2) {
  if (!env.GOOGLE_MAPS_API_KEY) return null;
  try {
    const res = await fetch(GOOGLE_ROUTES_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'routes.distanceMeters',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: lat1, longitude: lng1 } } },
        destination: { location: { latLng: { latitude: lat2, longitude: lng2 } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
        units: 'METRIC',
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const route = data.routes && data.routes[0];
    if (!route || !route.distanceMeters) return null;
    return route.distanceMeters / 1000;
  } catch (err) {
    return null;
  }
}

// MILESTONE 16: the real driving distance between two zones never changes
// (fixed reference coordinates, not per-guest addresses) - cached
// indefinitely rather than re-fetched from Google on every call. Canonical
// alphabetical ordering so A->B and B->A share one cache row.
async function getZoneDistanceKm(env, zoneAName, zoneBName, latA, lngA, latB, lngB) {
  const [sortedA, sortedB, sortedLatA, sortedLngA, sortedLatB, sortedLngB] =
    zoneAName <= zoneBName
      ? [zoneAName, zoneBName, latA, lngA, latB, lngB]
      : [zoneBName, zoneAName, latB, lngB, latA, lngA];

  const cached = await env.DB.prepare(
    `SELECT distance_km FROM zone_distance_cache WHERE zone_a = ? AND zone_b = ?`
  ).bind(sortedA, sortedB).first();
  if (cached) return { distanceKm: cached.distance_km, cacheHit: true };

  const distanceKm = await computeZoneToZoneDistanceKm(env, sortedLatA, sortedLngA, sortedLatB, sortedLngB);
  if (distanceKm === null) return { distanceKm: null, cacheHit: false };

  await env.DB.prepare(
    `INSERT OR IGNORE INTO zone_distance_cache (zone_a, zone_b, distance_km) VALUES (?, ?, ?)`
  ).bind(sortedA, sortedB, distanceKm).run();
  return { distanceKm, cacheHit: false };
}

// MILESTONE 16: the single, shared source of truth for a real,
// server-computed reference fare - used by both handleNegotiationCreate
// (to enforce the real 80% floor) and handleReferenceFarePreview (so the
// guest widget can show the SAME real number before ever submitting a
// proposal, closing the display-layer inconsistency the client's own
// separate published-price/formula estimate could otherwise show).
// Assumes pickupZone/destinationZone are already validated real zone
// names and that exactly one of them is Nadi Airport - callers must check
// that themselves (both current callers already do, for their own reasons).
async function computeRealReferenceFare(env, pickupZone, destinationZone, vehicleType, tripType = 'one-way') {
  const remoteZoneName = pickupZone === NADI_AIRPORT_ZONE_NAME ? destinationZone : pickupZone;
  const [airportZoneRow, remoteZoneRow] = await Promise.all([
    env.DB.prepare(`SELECT lat, lng FROM zones WHERE name = ?`).bind(NADI_AIRPORT_ZONE_NAME).first(),
    env.DB.prepare(`SELECT lat, lng, remote_multiplier FROM zones WHERE name = ?`).bind(remoteZoneName).first(),
  ]);
  if (!airportZoneRow || !remoteZoneRow || airportZoneRow.lat === null || remoteZoneRow.lat === null) {
    return { ok: false, error: 'Could not compute a real fare for this route right now. Please try again shortly.', status: 503 };
  }
  const { distanceKm, cacheHit } = await getZoneDistanceKm(
    env, NADI_AIRPORT_ZONE_NAME, remoteZoneName,
    airportZoneRow.lat, airportZoneRow.lng, remoteZoneRow.lat, remoteZoneRow.lng
  );
  if (distanceKm === null) {
    return { ok: false, error: 'Could not compute a real fare for this route right now. Please try again shortly.', status: 503 };
  }
  const oneWayFareFjd = await computeFareFjd(env, vehicleType, distanceKm, remoteZoneRow.remote_multiplier);
  if (!oneWayFareFjd) {
    return { ok: false, error: 'No pricing rule found for this route and vehicle type.', status: 400 };
  }
  // Milestone 17 bug fix, now via the named step (pricing.mjs) instead of
  // an inline ternary - this used to always be the one-way fare, silently
  // wrong for any return-trip preview or negotiation floor.
  const referenceFareFjd = computeFinalTotal(applyTripTypeMultiplier(oneWayFareFjd, tripType));
  // cacheHit propagated so callers that meter real API-cost calls (see
  // handleReferenceFarePreview) can tell a free cache read apart from a
  // real, billable Google Routes API call.
  return { ok: true, referenceFareFjd, distanceKm, cacheHit };
}

// ═══════════════════════════════════════════════════════════════
// MILESTONE 18 — server-authoritative pricing (Recommendation 1). The
// single source of truth POST /bookings uses to verify (or, for the
// confidently-authoritative case, fully replace) whatever quoted_amount
// the client sent. Deliberately reuses computeRealReferenceFare's exact
// zone-to-zone distance resolution (zone_distance_cache, independent of
// anything the client sends) rather than trusting a client-supplied
// distance_km - this is what makes the fixed-zone-pair case genuinely
// tamper-proof, not just "recomputed from client-supplied inputs."
//
// Scope, decided during Step 4 planning (both real gaps James caught
// before code was written - see the approved plan's Recommendation 1
// section for the full reasoning):
//   - Fixed zone-pair road transfers: this IS the authoritative price.
//   - Custom-address / boat bookings: this becomes a FLOOR/consistency
//     check only, not a full replace - the server can't yet re-derive a
//     custom address's exact geocoded distance (no address text reaches
//     this endpoint) or a boat's exact adult/child fare split (no
//     passenger count reaches this endpoint either). Both are real,
//     named v1.1 follow-ups, not silently dropped.
//   - Tours: only the transfer+extras portion is ever verified here: the
//     tour cost itself has zero server-side pricing data (TOURS_DATA is
//     client-only) and is out of scope until v2.
// ═══════════════════════════════════════════════════════════════
async function computeAuthoritativePrice(env, { pickupZone, destinationZone, vehicleType, tripType, pickupTime, hasChildSeat, hasSurfboard }) {
  const remoteZoneName = pickupZone === NADI_AIRPORT_ZONE_NAME ? destinationZone : pickupZone;
  const [airportZoneRow, remoteZoneRow] = await Promise.all([
    env.DB.prepare(`SELECT lat, lng FROM zones WHERE name = ?`).bind(NADI_AIRPORT_ZONE_NAME).first(),
    env.DB.prepare(`SELECT lat, lng, remote_multiplier FROM zones WHERE name = ?`).bind(remoteZoneName).first(),
  ]);
  if (!airportZoneRow || !remoteZoneRow || airportZoneRow.lat === null || remoteZoneRow.lat === null) {
    return { ok: false, error: 'Could not resolve zone coordinates for authoritative pricing.' };
  }
  const { distanceKm } = await getZoneDistanceKm(
    env, NADI_AIRPORT_ZONE_NAME, remoteZoneName,
    airportZoneRow.lat, airportZoneRow.lng, remoteZoneRow.lat, remoteZoneRow.lng
  );
  if (distanceKm === null) {
    return { ok: false, error: 'Could not resolve a real distance for authoritative pricing.' };
  }
  const oneWayFareFjd = await computeFareFjd(env, vehicleType, distanceKm, remoteZoneRow.remote_multiplier);
  if (!oneWayFareFjd) {
    return { ok: false, error: 'No pricing rule found for this route and vehicle type.' };
  }
  const withTripType = applyTripTypeMultiplier(oneWayFareFjd, tripType);
  const withNightSurcharge = applyNightSurcharge(withTripType, pickupTime);
  const withExtras = applyExtras(withNightSurcharge, { hasChildSeat, hasSurfboard });
  // Loyalty discount is deliberately NOT applied here - this function
  // returns the pre-discount transfer+extras baseline used for both the
  // exact-replace case (discount applied once, below, on the final
  // combined figure - matching calculateTotal()'s existing behavior of
  // discounting transfer+extras+tour together) and the tour-remainder
  // floor check, where discount timing doesn't matter for a >= comparison.
  return { ok: true, transferPlusExtrasFjd: computeFinalTotal(withExtras), distanceKm };
}

// Real Google Routes API call. Field mask requests warnings text
// specifically because ferry-leg detection isn't guaranteed to be a clean
// structured field for DRIVE-mode routes (this wasn't verifiable without a
// real API key and a real test call - see the Milestone 9 report for what
// the actual live response looked like and whether this detection held up
// against a real Yasawa/Mamanuca address).
// direction: 'from_airport' (airportLatLng -> free-text address, the
// original arriving-guest flow) or 'to_airport' (free-text address ->
// airportLatLng, Milestone 12's departing-guest flow). Google's Waypoint
// object accepts either a location or an address on BOTH ends, so this is
// a symmetric swap, not two different API shapes.
async function callGoogleRoutesApi(env, airportLat, airportLng, addressText, direction = 'from_airport') {
  if (!env.GOOGLE_MAPS_API_KEY) {
    return { ok: false, reason: 'not_configured' };
  }
  const airportPoint = { location: { latLng: { latitude: airportLat, longitude: airportLng } } };
  const addressPoint = { address: addressText };
  const origin = direction === 'to_airport' ? addressPoint : airportPoint;
  const destination = direction === 'to_airport' ? airportPoint : addressPoint;
  try {
    const res = await fetch(GOOGLE_ROUTES_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY,
        // routes.legs.endLocation added after a real test caught a real bug:
        // without it, the destination's resolved lat/lng was never in the
        // response at all, and findNearestZone() was silently computing
        // distance from (0,0) instead - see the Milestone 9 report for
        // exactly how this was caught (a real Denarau address matched
        // "Natadola" as nearest zone, which is nowhere near it).
        // routes.legs.startLocation added for Milestone 12: when the
        // free-text address is the ORIGIN (direction='to_airport'), its
        // resolved point is the first leg's start, not the last leg's end.
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.warnings,routes.legs.startLocation,routes.legs.endLocation,routes.legs.steps.travelMode,routes.legs.steps.navigationInstruction,geocodingResults',
      },
      body: JSON.stringify({
        origin,
        destination,
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
        units: 'METRIC',
        // Disambiguates short/ambiguous text addresses (e.g. "Waila",
        // "Namaka") to Fiji without altering the address string itself -
        // confirmed via the real Routes API docs that regionCode is a
        // top-level ccTLD hint the API applies during geocoding, not a
        // display/formatting-only field.
        regionCode: 'FJ',
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, reason: 'geocode_failed', status: res.status, raw: errText.slice(0, 500) };
    }

    const data = await res.json();

    // Confidence gate - confirmed via a real, live diagnostic call (not
    // assumed from docs) that computeRoutes DOES expose a geocoding
    // confidence signal via the top-level geocodingResults field, contrary
    // to what the old comment here claimed. Real evidence: "waila, fiji"
    // and "Vuda Point, Fiji" - two unrelated real places Google couldn't
    // actually place - both silently resolved to the SAME coordinate
    // (Fiji's country-level centroid), with geocodingResults reporting
    // type:["country","political"] and partialMatch:true for both. A
    // genuinely resolved address (e.g. "namaka") reports neither. Treated
    // as equivalent to "no route" below (never guesses a zone/price) -
    // conservative by design: a driver going to the wrong place is a real
    // safety problem, a guest routed to a human is a minor inconvenience.
    const addressSideWaypoint = direction === 'to_airport'
      ? data.geocodingResults?.origin
      : data.geocodingResults?.destination;
    const geocoderStatusCode = addressSideWaypoint?.geocoderStatus?.code;
    const isLowConfidence = !addressSideWaypoint
      || (geocoderStatusCode !== undefined && geocoderStatusCode !== 0)
      || addressSideWaypoint.partialMatch === true
      || (addressSideWaypoint.type || []).some((t) => LOW_CONFIDENCE_GEOCODE_TYPES.has(t));
    if (isLowConfidence) {
      return { ok: true, hasRoute: false };
    }

    const route = data.routes && data.routes[0];
    if (!route) {
      // A 200 with no routes: the geocoder placed the address with real
      // confidence (passed the check above) but no DRIVE route exists -
      // the real signal this design uses for "needs a water transfer".
      return { ok: true, hasRoute: false };
    }

    const distanceKm = route.distanceMeters / 1000;
    const warningsText = JSON.stringify(route.warnings || []).toLowerCase();
    const stepsText = JSON.stringify(route.legs || []).toLowerCase();
    const hasFerryLeg = warningsText.includes('ferry') || stepsText.includes('ferry') || stepsText.includes('"travelmode":"ferry"');

    // The free-text address's own resolved point: the last leg's endLocation
    // when it's the destination (from_airport), or the first leg's
    // startLocation when it's the origin (to_airport, Milestone 12).
    const firstLeg = route.legs && route.legs[0];
    const lastLeg = route.legs && route.legs[route.legs.length - 1];
    const addressLatLng = direction === 'to_airport'
      ? (firstLeg && firstLeg.startLocation && firstLeg.startLocation.latLng)
      : (lastLeg && lastLeg.endLocation && lastLeg.endLocation.latLng);
    const geocodedLat = addressLatLng ? addressLatLng.latitude : null;
    const geocodedLng = addressLatLng ? addressLatLng.longitude : null;

    return { ok: true, hasRoute: true, distanceKm, durationRaw: route.duration, hasFerryLeg, geocodedLat, geocodedLng };
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

// Milestone 13: fixed-fare boat-transfer quote. destination_id must be a
// real, active, transfer_type='boat' row - never a guess. Fares are
// per-passenger (adult/child), not per-vehicle-tier, matching how the
// real operator actually prices these routes (confirmed: no "minibus"
// equivalent exists for a scheduled ferry). Total is the full bundled
// fare Fiji Dash collects (confirmed real resale arrangement),
// while land_leg_fare_fjd is carried separately for future commission use.
async function handleBoatQuote(env, body, clientIp) {
  const destinationId = Number(body.destination_id);
  const adults = body.adults !== undefined ? Number(body.adults) : 1;
  const children = body.children !== undefined ? Number(body.children) : 0;

  const errors = [];
  if (!Number.isInteger(destinationId) || destinationId <= 0) errors.push('destination_id must be a positive integer');
  if (!Number.isInteger(adults) || adults < 1 || adults > 20) errors.push('adults must be an integer between 1 and 20');
  if (!Number.isInteger(children) || children < 0 || children > 20) errors.push('children must be an integer between 0 and 20');
  if (errors.length > 0) return json({ ok: false, errors }, 400);

  const dest = await env.DB.prepare(
    `SELECT d.id, d.name, d.active, d.transfer_type, d.pricing_status, z.name AS zone_name,
            d.boat_adult_fare_fjd, d.boat_child_fare_fjd, d.boat_land_leg_fare_fjd, d.boat_operator_name
     FROM destinations d JOIN zones z ON z.id = d.zone_id WHERE d.id = ?`
  ).bind(destinationId).first();

  if (!dest || !dest.active || dest.transfer_type !== 'boat') {
    return json({ ok: false, error: 'Unknown or unsupported boat destination_id.' }, 400);
  }

  // Milestone 14: a real, named, guest-findable boat destination whose fare
  // hasn't been sourced yet (South Sea Cruises' booking engine has no
  // static rate sheet - see Milestone 13's own research - so this is a
  // real, expected, non-error state, not an edge case). Never fabricate a
  // price and never silently fail here - route into the same real
  // escalation/WhatsApp-concierge flow Milestone 10 built for addresses
  // Google can't resolve, so the guest sees "we'll confirm your price"
  // rather than a dead end. Reuses the exact needs_manual_confirmation
  // response shape the frontend already renders for that path.
  if (dest.pricing_status !== 'sourced') {
    const { escalation } = await createEscalation(env, {
      source: 'guest',
      triggerType: 'boat_pricing_pending',
      context: `Boat transfer price requested for "${dest.name}" (${dest.zone_name}) - fare not yet sourced.`,
      sourceIp: clientIp,
    });
    return json({
      ok: true,
      outcome: 'needs_manual_confirmation',
      transfer_type: 'boat',
      destination_id: dest.id,
      destination_name: dest.name,
      message: `We're confirming your real-time price for ${dest.name} via WhatsApp.`,
      escalation_id: escalation.id,
      whatsapp_link: buildConciergeWhatsAppLink('boat_pricing_pending', dest.name),
    }, 200);
  }

  if (children > 0 && dest.boat_child_fare_fjd === null) {
    return json({ ok: false, error: `${dest.name} does not accept children on this transfer.` }, 400);
  }

  // Milestone 18: same computeBoatFare() (pricing.mjs) that /bookings will
  // use once the trust-boundary flip lands - one formula, not two copies.
  const totalFjd = computeBoatFare({
    adults, children, adultFareFjd: dest.boat_adult_fare_fjd, childFareFjd: dest.boat_child_fare_fjd,
  });

  return json({
    ok: true,
    outcome: 'resolved',
    transfer_type: 'boat',
    destination_id: dest.id,
    destination_name: dest.name,
    zone: dest.zone_name,
    operator_name: dest.boat_operator_name,
    adults,
    children,
    adult_fare_fjd: dest.boat_adult_fare_fjd,
    child_fare_fjd: dest.boat_child_fare_fjd,
    land_leg_fare_fjd: dest.boat_land_leg_fare_fjd,
    quoted_fare_fjd: totalFjd,
  }, 200);
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

  // Milestone 13: fixed-fare boat-transfer path, a clean branch from the
  // road/km model below - never calls callGoogleRoutesApi, never touches
  // geocoded_addresses (there's nothing to geocode, the destination is
  // already a known row with a real, sourced fare). Selected via
  // destination_id instead of address, since this is a known destination,
  // not free text.
  if (body.destination_id !== undefined && body.destination_id !== null) {
    return handleBoatQuote(env, body, clientIp);
  }

  const addressRaw = (body.address || '').toString().trim();
  const vehicleType = (body.vehicle_type || '').toString().trim().toLowerCase();
  // Milestone 12: which real trip this address represents. 'from_airport'
  // (default, unchanged) = arriving guest, Nadi Airport -> address.
  // 'to_airport' = departing guest, address -> Nadi Airport. Same address
  // text means two different real journeys depending on this, so it must
  // never be inferred or defaulted away once present.
  const direction = (body.direction || 'from_airport').toString().trim();

  const errors = [];
  if (!addressRaw) errors.push('address is required');
  if (addressRaw.length > 300) errors.push('address is too long');
  if (!ALLOWED_VEHICLE_TYPES.includes(vehicleType)) errors.push(`vehicle_type must be one of: ${ALLOWED_VEHICLE_TYPES.join(', ')}`);
  if (!['from_airport', 'to_airport'].includes(direction)) errors.push(`direction must be one of: from_airport, to_airport`);
  if (errors.length > 0) return json({ ok: false, errors }, 400);

  // direction is folded into the cache key itself (not just a separate
  // column) so "address X as pickup, airport as destination" and "airport
  // as pickup, address X as destination" can never share a cached fare -
  // real distance/duration is looked up fresh for each, even though in
  // practice they'll often be close. The direction column below exists so
  // it can be read straight back off a cached row without re-parsing the key.
  const queryNormalized = `${direction}:${normalizeAddressQuery(addressRaw)}`;
  let cacheRow = await env.DB.prepare(`SELECT * FROM geocoded_addresses WHERE query_normalized = ?`).bind(queryNormalized).first();
  let cacheHit = !!cacheRow;

  if (!cacheRow) {
    const nadiAirport = await env.DB.prepare(`SELECT lat, lng FROM zones WHERE name = 'Nadi Airport'`).first();
    if (!nadiAirport || nadiAirport.lat === null) {
      return json({ ok: false, error: 'Origin zone coordinates not configured.' }, 500);
    }

    const routeResult = await callGoogleRoutesApi(env, nadiAirport.lat, nadiAirport.lng, addressRaw, direction);

    let outcome, resolvedAddress = null, lat = null, lng = null, distanceKm = null, durationText = null, hasFerryLeg = 0, nearestZoneId = null;

    if (!routeResult.ok) {
      // Google unreachable, misconfigured key, or a real geocode failure -
      // never guess a zone. Not cached (routeResult.ok false means we
      // don't have a query_normalized worth remembering as a permanent
      // failure - e.g. GOOGLE_MAPS_API_KEY not yet set shouldn't poison
      // the cache for when it is).
      // trigger_type 'geocode_failed', not 'needs_manual_confirmation' -
      // Google itself was unreachable/misconfigured here (an operational
      // problem), distinct from Google answering fine but the destination
      // genuinely needing a human (the branch below).
      const { escalation: geoFailEscalation } = await createEscalation(env, {
        source: 'guest',
        triggerType: 'geocode_failed',
        context: `Quote request for "${addressRaw}" (${direction}) could not be geocoded (${routeResult.reason || 'unknown reason'}).`,
        sourceIp: clientIp,
      });
      return json({
        ok: true,
        outcome: 'needs_manual_confirmation',
        message: 'Could not confirm this address automatically. We will follow up with you directly to confirm pricing.',
        detail: routeResult.reason,
        escalation_id: geoFailEscalation.id,
        whatsapp_link: buildConciergeWhatsAppLink('needs_manual_confirmation', addressRaw, direction),
      }, 200);
    } else if (!routeResult.hasRoute) {
      // hasRoute is false for two distinct real cases callGoogleRoutesApi
      // deliberately collapses into one outcome here: (a) the address
      // failed the confidence gate (low-confidence/fallback geocode - see
      // LOW_CONFIDENCE_GEOCODE_TYPES) or (b) Google confidently placed the
      // address but no DRIVE route exists (e.g. a real outer island).
      // Both get the same safe treatment - never guessing water-transfer
      // OR a zone/price - kept separate from the ferry/>300km case below
      // (which requires Google to have found a REAL, confident route worth
      // trusting the distance/warnings on).
      outcome = 'needs_manual_confirmation';
    } else if (routeResult.distanceKm > MAX_QUOTE_DISTANCE_KM || routeResult.hasFerryLeg) {
      outcome = 'needs_water_transfer';
      distanceKm = routeResult.distanceKm;
      durationText = routeResult.durationRaw;
      hasFerryLeg = routeResult.hasFerryLeg ? 1 : 0;
      lat = routeResult.geocodedLat;
      lng = routeResult.geocodedLng;
    } else {
      distanceKm = routeResult.distanceKm;
      durationText = routeResult.durationRaw;
      outcome = 'resolved';
      lat = routeResult.geocodedLat;
      lng = routeResult.geocodedLng;
    }

    // The guest widget fires one /quote request per vehicle type in
    // parallel for the same address, so concurrent requests can race here
    // for a brand-new (not-yet-cached) address. query_normalized is UNIQUE,
    // so use INSERT OR IGNORE + re-SELECT rather than a plain INSERT: a
    // request that loses the race still gets the winning row instead of
    // throwing on the UNIQUE constraint.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO geocoded_addresses (query_normalized, query_raw, resolved_address, lat, lng, distance_km, duration_text, has_ferry_leg, nearest_zone_id, outcome, direction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(queryNormalized, addressRaw, resolvedAddress, lat, lng, distanceKm, durationText, hasFerryLeg, nearestZoneId, outcome, direction).run();

    cacheRow = await env.DB.prepare(`SELECT * FROM geocoded_addresses WHERE query_normalized = ?`).bind(queryNormalized).first();
    cacheHit = false;
  }

  await env.DB.prepare(
    `INSERT INTO quote_requests_log (source_ip, query_normalized, cache_hit) VALUES (?, ?, ?)`
  ).bind(clientIp, queryNormalized, cacheHit ? 1 : 0).run();

  if (cacheRow.outcome === 'needs_manual_confirmation') {
    // Fires on every request, cache hit or not - the geocode result (real
    // road distance) is what's cached to save the paid Google call, but
    // each request here is a different real guest who needs a real human
    // follow-up. Per Milestone 9's real finding, this is the actual
    // reachable path for BOTH garbage addresses AND every genuine real
    // inter-island/water-transfer address (Fiji has no land border, so
    // Google's DRIVE-mode routing can never resolve those) - expect this
    // to carry real volume, not rare typo-only traffic.
    const { escalation: manualConfEscalation } = await createEscalation(env, {
      source: 'guest',
      triggerType: 'needs_manual_confirmation',
      context: `Quote request for "${addressRaw}" (${direction}) needs manual confirmation.`,
      sourceIp: clientIp,
    });
    return json({
      ok: true,
      outcome: 'needs_manual_confirmation',
      message: 'Could not confirm this address automatically. We will follow up with you directly to confirm pricing.',
      cached: cacheHit,
      escalation_id: manualConfEscalation.id,
      whatsapp_link: buildConciergeWhatsAppLink('needs_manual_confirmation', addressRaw, direction),
    }, 200);
  }
  if (cacheRow.outcome === 'needs_water_transfer') {
    return json({
      ok: true,
      outcome: 'needs_water_transfer',
      message: 'This destination requires a water transfer. Please contact us directly to arrange this trip.',
      distance_km: cacheRow.distance_km,
      has_ferry_leg: !!cacheRow.has_ferry_leg,
      direction,
      cached: cacheHit,
    }, 200);
  }

  const nearestZone = await findNearestZone(env, cacheRow.lat, cacheRow.lng);
  const fare = nearestZone ? await computeFareFjd(env, vehicleType, cacheRow.distance_km, nearestZone.remote_multiplier) : null;

  return json({
    ok: true,
    outcome: 'resolved',
    query: addressRaw,
    direction,
    distance_km: cacheRow.distance_km,
    duration: cacheRow.duration_text,
    nearest_zone: nearestZone ? { id: nearestZone.id, name: nearestZone.name, remote_multiplier: nearestZone.remote_multiplier } : null,
    vehicle_type: vehicleType,
    quoted_fare_fjd: fare,
    cached: cacheHit,
  }, 200);
}

// ═══════════════════════════════════════════════════════════════
// MILESTONE 10 — human escalation / "back to base" system
// ═══════════════════════════════════════════════════════════════

const ESCALATION_SOURCES = ['guest', 'driver'];
const ESCALATION_TRIGGER_TYPES = ['geocode_failed', 'needs_manual_confirmation', 'wallet_dispute', 'app_issue', 'other', 'boat_pricing_pending'];

// Same real number already live on nadiairporttransfers.com's WhatsApp
// buttons (wa.me/61478886145) - confirmed with James this is intentionally
// the same physical number as admin_alert_phone today. Kept as its own
// constant, not read from platform_settings.admin_alert_phone at runtime,
// so the two purposes (private ops alerts vs. public guest concierge line)
// stay logically independent even though the value matches right now - if
// James ever splits them onto separate numbers, only this line changes.
const CONCIERGE_WHATSAPP_NUMBER = '61478886145';

// direction (Milestone 12): 'to_airport' means the address being quoted is
// the guest's PICKUP (departing guest), not the destination - the message
// wording needs to match, since this is what the guest actually sends.
function buildConciergeWhatsAppLink(triggerType, contextText, direction = 'from_airport') {
  const which = direction === 'to_airport' ? 'pickup' : 'destination';
  const preface = {
    geocode_failed: `Hi, I'm trying to book a Nadi Airport transfer but the online quote tool couldn't process my ${which}.`,
    needs_manual_confirmation: `Hi, I'm trying to book a Nadi Airport transfer but couldn't get an automatic quote for my ${which}.`,
    wallet_dispute: 'Hi, I have a question about my driver wallet balance.',
    app_issue: "Hi, I'm having a problem with the driver app.",
    other: 'Hi, I need some help with my Nadi Airport transfer.',
    boat_pricing_pending: "Hi, I'd like to book a boat transfer to my resort and need the current price confirmed.",
  }[triggerType] || 'Hi, I need some help with my Nadi Airport transfer.';
  const message = contextText ? `${preface} Details: ${contextText}` : preface;
  return `https://wa.me/${CONCIERGE_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

// Reuses sendHealthAlertWhatsApp() directly rather than a new function or a
// new template - vakaviti_ops_health_alert's approved body ("Vakaviti
// Alert: nadi-dispatch-api status changed to {{1}} at {{2}}") is generic
// system-notification wording, not hardcoded to health-check semantics, so
// {{1}} carries an escalation summary here instead of "DOWN"/"RECOVERED".
// Deliberate reuse to avoid a third async Meta template submission for
// materially the same "something needs a human" alert shape - flagged
// plainly in the Milestone 10 report, not a hidden repurposing. If this
// stretches Meta's template-content-match tolerance in practice, the fix
// is a dedicated vakaviti_ops_escalation_alert template later, same
// submission pattern as every other template in this build.
async function sendEscalationAlert(env, escalation) {
  const alertPhone = await getSetting(env, 'admin_alert_phone', '');
  const summary = `ESCALATION #${escalation.id} (${escalation.source}/${escalation.trigger_type}): ${(escalation.context || 'no context provided').slice(0, 200)}`;
  return alertPhone
    ? await sendHealthAlertWhatsApp(env, alertPhone, summary, sqliteNow())
    : { attempted: false, reason: 'platform_settings.admin_alert_phone is not set.' };
}

// Found during deep review: unlike every other public write endpoint on
// this Worker (POST /bookings has checkGuestBookingRateLimit, POST /quote
// has checkQuoteRateLimit), POST /escalate had NO rate limiting at all -
// a real gap, since every real call here triggers an actual WhatsApp send
// to James's personal phone (admin_alert_phone). Unbounded, that's a
// genuine spam/harassment vector against a real human, not just a cost
// concern. Same IP-based sliding-window pattern as the other two, same
// honest framing: app-level friction, not a security boundary.
async function checkEscalationRateLimit(env, ip) {
  const max = Number(await getSetting(env, 'escalation_rate_limit_max_per_day', '10'));
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM escalations WHERE source_ip = ? AND created_at > datetime('now', '-1440 minutes')`
  ).bind(ip).first();
  const count = row ? row.cnt : 0;
  return { limited: count >= max, count, max };
}

// Shared by both POST /escalate and the automatic Milestone 9 wiring below
// - one insert-and-alert path, not duplicated per caller. sourceIp is
// recorded for every escalation (observability + the rate limit above),
// even though only the direct POST /escalate endpoint enforces a cap on
// it - the Milestone 9 auto-wired calls are already bounded by /quote's
// own rate limit before any escalation is created.
async function createEscalation(env, { source, triggerType, context, bookingId = null, driverId = null, sourceIp = null }) {
  const insert = await env.DB.prepare(
    `INSERT INTO escalations (source, trigger_type, context, booking_id, driver_id, source_ip) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(source, triggerType, context, bookingId, driverId, sourceIp).run();
  const escalation = { id: insert.meta.last_row_id, source, trigger_type: triggerType, context };
  const alert = await sendEscalationAlert(env, escalation);
  // Milestone 19 - only when this escalation actually relates to a real
  // booking (most don't - a /quote geocode failure has no bookingId at
  // all). previous_status/new_status are null: an escalation doesn't
  // change the booking's own status, it just flags it for a human.
  if (bookingId) {
    await logBookingEvent(env, {
      bookingId, eventType: 'escalated', actor: source,
      metadata: { escalation_id: escalation.id, trigger_type: triggerType },
    });
  }
  return { escalation, alert };
}

async function handleEscalationCreate(request, env) {
  if (!env.DB) return json({ ok: false, error: 'Database not available.' }, 503);

  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateLimit = await checkEscalationRateLimit(env, clientIp);
  if (rateLimit.limited) {
    return json({ ok: false, error: 'Too many escalation requests from this connection today. Please try again tomorrow, or contact us directly.' }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }

  const source = (body.source || '').toString().trim().toLowerCase();
  const triggerType = (body.trigger_type || '').toString().trim().toLowerCase();
  const context = (body.context !== undefined && body.context !== null) ? body.context.toString().slice(0, 2000) : null;
  const bookingId = Number.isInteger(body.booking_id) ? body.booking_id : null;
  const driverId = Number.isInteger(body.driver_id) ? body.driver_id : null;

  const errors = [];
  if (!ESCALATION_SOURCES.includes(source)) errors.push(`source must be one of: ${ESCALATION_SOURCES.join(', ')}`);
  if (!ESCALATION_TRIGGER_TYPES.includes(triggerType)) errors.push(`trigger_type must be one of: ${ESCALATION_TRIGGER_TYPES.join(', ')}`);
  if (errors.length > 0) return json({ ok: false, errors }, 400);

  const { escalation, alert } = await createEscalation(env, { source, triggerType, context, bookingId, driverId, sourceIp: clientIp });

  return json({
    ok: true,
    escalation_id: escalation.id,
    whatsapp_link: buildConciergeWhatsAppLink(triggerType, context),
    alert,
  }, 201);
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
