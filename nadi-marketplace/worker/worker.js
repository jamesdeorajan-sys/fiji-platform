/**
 * Nadi Airport Transfers — Driver Marketplace Backend
 * nadi-dispatch-api
 *
 * Phase 1, Milestone 2: driver onboarding (join form submission, admin
 * approval queue). No dispatch/broadcast/PWA job feed/wallet logic yet —
 * see Phase 1 spec sections 4 (core)/6/7/8/9, all still out of scope.
 *
 * Fully isolated: separate script, separate D1 database (nadi-marketplace-db),
 * separate R2 bucket (nadi-marketplace-driver-docs), zero shared bindings
 * with fiji-chat-widget or vakaviti-kb. Not connected to any production
 * route or domain. workers/chat-widget/worker.js was not touched to build
 * this — the WhatsApp send below is a new, independent implementation
 * against the same Meta Cloud API pattern, not a shared function.
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

    return json({ error: 'Not found.' }, 404);
  },
};

// ═══════════════════════════════════════════════════════════════
// HEALTH / ZONES
// ═══════════════════════════════════════════════════════════════

async function handleHealth(env) {
  const status = {
    service: 'nadi-dispatch-api',
    phase: 1,
    milestone: 'driver-onboarding',
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

  const driver = await env.DB.prepare(`SELECT id, phone, status FROM drivers WHERE id = ?`).bind(driverId).first();
  if (!driver) return json({ ok: false, error: 'Driver not found.' }, 404);

  await env.DB.prepare(`UPDATE drivers SET status = 'verified' WHERE id = ?`).bind(driverId).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO wallets (driver_id, balance_fjd) VALUES (?, 0)`).bind(driverId).run();

  const token = crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO driver_login_tokens (driver_id, token, expires_at) VALUES (?, ?, ?)`
  ).bind(driverId, token, expiresAt).run();

  const whatsappResult = await sendMagicLinkWhatsApp(env, driver.phone, token);

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
// WHATSAPP MAGIC LINK — same Meta Cloud API pattern as fiji-chat-widget's
// sendWhatsAppNotification, reimplemented independently here (that file
// was not touched). Requires env.WHATSAPP_TOKEN / env.WHATSAPP_PHONE_ID,
// which are NOT currently set on this Worker (see Milestone 2 report —
// the platform's shared token is known-broken, so a live test was
// deliberately skipped; this returns "not_configured" until secrets are
// set, which will surface the real Meta response once they are).
// ═══════════════════════════════════════════════════════════════

async function sendMagicLinkWhatsApp(env, phone, token) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    return { attempted: false, reason: 'WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not configured on this Worker.' };
  }

  const cleanNumber = (phone || '').replace(/[^0-9]/g, '');
  if (!cleanNumber || cleanNumber.length < 8) {
    return { attempted: false, reason: 'Driver phone number invalid for WhatsApp send.' };
  }

  const loginUrl = `https://nadi-marketplace-staging.pages.dev/driver-login?token=${token}`;
  const msgBody = [
    'Bula! Your Nadi Airport Transfers driver application has been approved.',
    '',
    'Tap below to log in to your driver dashboard:',
    loginUrl,
    '',
    'This link expires in 7 days.',
  ].join('\n');

  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanNumber,
        type: 'text',
        text: { body: msgBody },
      }),
    });
    const bodyText = await res.text().catch(() => '');
    return { attempted: true, ok: res.ok, status: res.status, response: bodyText.slice(0, 500) };
  } catch (err) {
    return { attempted: true, ok: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// UTIL
// ═══════════════════════════════════════════════════════════════

function json(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { ...JSON_CORS, 'Content-Type': 'application/json' },
  });
}
