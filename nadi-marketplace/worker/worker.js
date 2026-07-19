/**
 * Nadi Airport Transfers — Driver Marketplace Backend
 * nadi-dispatch-api
 *
 * Phase 1, Milestone 4: wallet lockout + commission accrual + max-hours cap
 * (rest of spec Section 4), on top of Milestone 3's driver PWA login,
 * online/offline + zones, job feed, atomic accept, dispatch broadcast, and
 * status transitions (spec sections 4 & 6).
 * Fuel index cron (Section 7), guest widget change (Section 8), and
 * cutover (Section 9) are still out of scope.
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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: JSON_CORS });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return handleHealth(env);
    }

    if (request.method === 'GET' && url.pathname === '/zones') {
      return handleZones(env);
    }

    if (request.method === 'POST' && url.pathname === '/drivers') {
      return handleDriverSubmit(request, env);
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

    return json({ error: 'Not found.' }, 404);
  },

  // Max-hours-cap sweep. Registered as a Cron Trigger in wrangler.toml
  // (every 15 minutes) — same enforceMaxHoursCap() logic the admin-only
  // /admin/max-hours-sweep endpoint calls on demand, so a manual run and a
  // real cron fire are provably identical, not two code paths that could
  // drift apart.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(enforceMaxHoursCap(env));
  },
};

// ═══════════════════════════════════════════════════════════════
// HEALTH / ZONES
// ═══════════════════════════════════════════════════════════════

async function handleHealth(env) {
  const status = {
    service: 'nadi-dispatch-api',
    phase: 1,
    milestone: 'wallet-lockout-and-max-hours-cap',
    db_connected: false,
    r2_connected: !!env.DOCS,
    tables: [],
  };

  if (!env.DB) {
    return json(status, 503);
  }

  try {
    const result = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    ).all();
    status.db_connected = true;
    status.tables = (result.results || []).map((r) => r.name);
    return json(status, 200);
  } catch (err) {
    status.error = err.message;
    return json(status, 500);
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
  const phone = normalisePhone((form.get('phone') || '').toString());
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

async function sendWhatsAppTemplate(env, phone, templateName, bodyParams) {
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
          language: { code: BOOKING_BROADCAST_LANG_CODE },
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
  return sendWhatsAppTemplate(env, phone, BOOKING_BROADCAST_TEMPLATE, [
    booking.pickup_zone,
    booking.destination_zone,
    booking.vehicle_type,
    fare,
    DRIVER_APP_URL,
  ]);
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
  const phone = normalisePhone((body.phone || '').toString());
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

  const insert = await env.DB.prepare(
    `INSERT INTO bookings (guest_name, guest_phone, pickup_zone, destination_zone, distance_km, vehicle_type,
       quoted_currency, quoted_amount, fx_rate_at_booking, settlement_amount_fjd, fuel_multiplier_applied, payment_method, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).bind(
    body.guest_name || 'Test Guest', body.guest_phone || null, body.pickup_zone, body.destination_zone,
    body.distance_km || null, body.vehicle_type, body.quoted_currency, body.quoted_amount,
    body.fx_rate_at_booking || 1, body.settlement_amount_fjd || body.quoted_amount,
    body.fuel_multiplier_applied || 1, body.payment_method
  ).run();

  const bookingId = insert.meta.last_row_id;
  const booking = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(bookingId).first();

  const candidates = await env.DB.prepare(`SELECT id, name, phone, zones FROM drivers WHERE status = 'verified' AND online = 1`).all();
  const matching = (candidates.results || []).filter((d) => JSON.parse(d.zones || '[]').includes(body.pickup_zone));

  const broadcastResults = [];
  for (const d of matching) {
    const whatsappResult = await sendBookingBroadcastWhatsApp(env, d.phone, booking);
    broadcastResults.push({ driver_id: d.id, driver_name: d.name, whatsapp: whatsappResult });
  }

  return json({ ok: true, booking_id: bookingId, booking, broadcast: { matched_drivers: matching.length, results: broadcastResults } }, 201);
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
