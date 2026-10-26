// Server-only conversion sidecar. No booking/WhatsApp state is modified.
const ENDPOINT = 'https://bzr.openai.com/v1/events';
const SOURCES = new Set(['https://nadiairporttransfers.com', 'https://www.nadiairporttransfers.com', 'https://book.fijidash.com']);
const MAX_AGE = 6 * 86400000; // Stop before the API's seven-day limit.
const phone = value => String(value || '').replace(/[^0-9]/g, '').replace(/^0+/, '');
const marker = /(?:^|[^a-z0-9])(test|testing|dummy|synthetic|smoke|qa)(?:$|[^a-z0-9])/i;
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');

function config(env) {
  if (!['validate', 'live'].includes(env.OPENAI_ADS_MODE)) return null;
  if (!env.OPENAI_ADS_CONVERSION_API_KEY || !/^[a-zA-Z0-9_-]{1,128}$/.test(env.OPENAI_ADS_PIXEL_ID || '')) return null;
  // Explicit launch prerequisites; the secret alone can never enable traffic.
  if (env.OPENAI_ADS_MEASUREMENT_APPROVED !== 'true' || env.OPENAI_ADS_TEST_FILTERS_APPROVED !== 'true') return null;
  let excluded;
  try { excluded = JSON.parse(env.OPENAI_ADS_TEST_PHONES); } catch { return null; }
  if (!Array.isArray(excluded) || excluded.some(p => typeof p !== 'string' || !phone(p))) return null;
  return { mode: env.OPENAI_ADS_MODE, pixel: env.OPENAI_ADS_PIXEL_ID, excluded: excluded.map(phone) };
}

export async function prepareLead(env, request, body, booking, now = Date.now()) {
  const cfg = config(env);
  if (!cfg || !booking || !Number.isSafeInteger(Number(booking.id)) || Number(booking.id) <= 0) return null;
  const origin = request.headers.get('Origin');
  if (!SOURCES.has(origin) || body.ads_measurement_opt_out === true) return null;
  const p = phone(booking.guest_phone);
  const fields = [booking.guest_name, booking.client_booking_ref, booking.notes, booking.guest_email];
  if (body.is_test || body.test_mode || body.test || booking.is_test || fields.some(v => marker.test(String(v || '')))) return null;
  if (cfg.excluded.includes(p) || /^(\d)\1+$/.test(p) || /^(?:614000000|6790000)/.test(p)) return null;
  if (/@(?:example\.(?:com|org|net|invalid)|[^@]*\.invalid)$/i.test(booking.guest_email || '')) return null;
  // The journey fingerprint also catches fresh references for the same trip.
  if (!p || !booking.pickup_date || !booking.pickup_time || !booking.client_booking_ref) return null;
  const rawTime = String(booking.created_at || '');
  const timestamp = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(rawTime) ? rawTime.replace(' ', 'T') + 'Z' : rawTime);
  if (!Number.isFinite(timestamp) || timestamp > now + 600000 || now - timestamp > MAX_AGE) return null;
  const fingerprint = await hash(JSON.stringify([p, booking.pickup_zone, booking.destination_zone, booking.pickup_date, booking.pickup_time, booking.vehicle_type, booking.return_date || '', booking.return_time || '', booking.return_pickup_location || '']));
  const user = {};
  if (/^[0-9]{8,15}$/.test(p)) user.phone_numbers_sha256 = [await hash(p)];
  const email = String(booking.guest_email || '').trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) user.emails_sha256 = [await hash(email)];
  const event = { id: `nadi_booking_${booking.id}_lead_created`, type: 'lead_created', timestamp_ms: timestamp, source_url: origin + '/', action_source: 'web', opt_out: true, user, data: { type: 'customer_action' } };
  // Only opt-in measurement context is read; never forward arbitrary URLs or booking notes.
  const context = body.openai_ads;
  if (context?.consent === true) {
    if (typeof context.oppref === 'string' && context.oppref.length > 0 && context.oppref.length <= 2048) event.oppref = context.oppref;
    if (typeof context.obref === 'string' && context.obref.trim() && context.obref.length <= 2048) user.obref = context.obref;
  }
  return { cfg, fingerprint, event };
}

export function scheduleLeadConversion(env, ctx, request, body, booking) {
  // Without waitUntil, skip instead of delaying the guest response.
  if (!ctx || typeof ctx.waitUntil !== 'function') return;
  try { ctx.waitUntil(queueLead(env, request, body, booking).catch(() => console.warn('[openai-ads] sidecar failed'))); }
  catch { console.warn('[openai-ads] scheduling failed'); }
}

export async function queueLead(env, request, body, booking) {
  const lead = await prepareLead(env, request, body, booking);
  if (!lead) return;
  const { cfg, event, fingerprint } = lead;
  await env.DB.prepare(`INSERT OR IGNORE INTO openai_ads_outbox (event_id, booking_id, fingerprint, pixel_id, mode, payload, event_time_ms, next_attempt_ms) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
    .bind(event.id, booking.id, fingerprint, cfg.pixel, cfg.mode, JSON.stringify(event), event.timestamp_ms).run();
  await deliverLead(env, event.id);
}

export async function deliverLead(env, eventId, now = Date.now()) {
  const cfg = config(env);
  if (!cfg) return;
  const token = crypto.randomUUID();
  const claim = await env.DB.prepare(`UPDATE openai_ads_outbox SET lease_token = ?, lease_until_ms = ?, attempts = attempts + 1 WHERE event_id = ? AND mode = ? AND pixel_id = ? AND state = 'pending' AND attempts < 5 AND next_attempt_ms <= ? AND lease_until_ms <= ? AND event_time_ms >= ?`)
    .bind(token, now + 30000, eventId, cfg.mode, cfg.pixel, now, now, now - MAX_AGE).run();
  if (!claim.meta?.changes) return;
  const row = await env.DB.prepare(`SELECT * FROM openai_ads_outbox WHERE event_id = ? AND lease_token = ?`).bind(eventId, token).first();
  let state = 'pending', status = null;
  try {
    const response = await fetch(`${ENDPOINT}?pid=${encodeURIComponent(cfg.pixel)}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${env.OPENAI_ADS_CONVERSION_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ validate_only: cfg.mode === 'validate', integration_source: 'fiji_platform', events: [JSON.parse(row.payload)] })
    });
    status = response.status;
    // Do not persist or log provider bodies, identifiers or secrets.
    if (response.ok) state = cfg.mode === 'validate' ? 'validated' : 'sent';
    else if (status !== 429 && status < 500) state = 'rejected';
    await response.body?.cancel();
  } catch { /* Network/timeout: bounded durable retry, same event ID/time. */ }
  if (state === 'pending' && row.attempts >= 5) state = 'exhausted';
  await env.DB.prepare(`UPDATE openai_ads_outbox SET state = ?, last_http_status = ?, next_attempt_ms = ?, lease_until_ms = 0, lease_token = NULL WHERE event_id = ? AND lease_token = ?`)
    .bind(state, status, now + Math.min(3600000, 60000 * 2 ** row.attempts), eventId, token).run();
}

export async function sweepLeadConversions(env) {
  const cfg = config(env);
  if (!cfg) return;
  try {
    const now = Date.now();
    await env.DB.prepare(`UPDATE openai_ads_outbox SET state = 'exhausted' WHERE state = 'pending' AND attempts >= 5 AND lease_until_ms <= ?`).bind(now).run();
    await env.DB.prepare(`UPDATE openai_ads_outbox SET state = 'expired' WHERE state = 'pending' AND event_time_ms < ?`).bind(now - MAX_AGE).run();
    const rows = await env.DB.prepare(`SELECT event_id FROM openai_ads_outbox WHERE state = 'pending' AND mode = ? AND pixel_id = ? AND next_attempt_ms <= ? AND lease_until_ms <= ? AND attempts < 5 LIMIT 10`).bind(cfg.mode, cfg.pixel, now, now).all();
    await Promise.allSettled(rows.results.map(row => deliverLead(env, row.event_id)));
  } catch { console.warn('[openai-ads] sweep failed'); }
}
