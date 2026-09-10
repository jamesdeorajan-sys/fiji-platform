// Vakaviti funnel observability Worker - CEO P0 Round 5, Track B.
// Isolated: own D1 database, own deploy, zero shared code with the
// nadi-dispatch-api Worker that handles real bookings. Nothing in this
// file can block, delay, or fail a booking - it is not on that call path
// at all, by construction (nothing here is imported or called by the
// booking Worker; the guest-facing client fires events at this Worker
// separately, via sendBeacon, fire-and-forget).

const ALLOWED_EVENTS = new Set([
  'booking_page_view',
  'route_selected',
  'vehicle_selected',
  'details_opened',
  'confirm_clicked',
  'booking_post_started',
  'booking_post_succeeded',
  'booking_post_failed',
  'human_notification_sent',
  'whatsapp_opened',
]);

const ALLOWED_PLATFORMS = new Set(['fijidash', 'nadi']);

// CEO P0 Round 6 fix - real bug found during Track C testing, not a
// tooling artifact: navigator.sendBeacon() sends this cross-origin request
// with credentials mode 'include' (browser default, not something the
// caller can override via the sendBeacon API), and a wildcard
// Access-Control-Allow-Origin is invalid on a credentialed response per
// the CORS spec - the browser accepted the beacon into its send queue
// (sendBeacon() correctly returned true) but then silently dropped the
// actual delivery at the network layer. sendBeacon returning true is NOT
// proof of delivery, only proof of queuing - a real, useful lesson from
// this bug. Fixed by echoing the exact request Origin instead of '*'.
// This endpoint holds no session/auth cookies to protect either way - the
// fix is about satisfying the browser's CORS rule, not tightening access.
function corsHeaders(request) {
  return {
    'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    // Required alongside a specific (non-wildcard) origin for a browser to
    // accept a credentialed request at all - an echoed origin alone isn't
    // sufficient per spec. This endpoint has no cookies/session to protect,
    // so allowing credentials costs nothing real; it exists purely to
    // satisfy the browser's CORS gate for sendBeacon's default credentials
    // mode.
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
}

function json(data, status = 200, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

// Hard length caps on every string field - a guest browser is untrusted
// input. No field here is ever guest-identity-shaped (no name/email/phone/
// booking_id), so there is nothing to redact, only to cap and type-check.
function cap(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).slice(0, max);
  return s.length ? s : null;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405, request);

    const url = new URL(request.url);
    if (url.pathname !== '/events') return json({ ok: false, error: 'not found' }, 404, request);

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid JSON' }, 400, request); }

    const eventType = cap(body.event_type, 40);
    const platform = cap(body.platform, 20);
    const sessionId = cap(body.session_id, 64);

    if (!eventType || !ALLOWED_EVENTS.has(eventType)) {
      return json({ ok: false, error: 'unknown event_type' }, 400, request);
    }
    if (!platform || !ALLOWED_PLATFORMS.has(platform)) {
      return json({ ok: false, error: 'unknown platform' }, 400, request);
    }
    if (!sessionId) {
      return json({ ok: false, error: 'session_id required' }, 400, request);
    }

    try {
      await env.DB.prepare(
        `INSERT INTO funnel_events
           (event_type, session_id, platform, first_source, first_medium, first_campaign, first_content, first_referrer, first_landing_path, route_slug)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        eventType, sessionId, platform,
        cap(body.first_source, 100), cap(body.first_medium, 100), cap(body.first_campaign, 100),
        cap(body.first_content, 100),
        cap(body.first_referrer, 300), cap(body.first_landing_path, 300),
        cap(body.route_slug, 100)
      ).run();
    } catch (err) {
      // Logged, never surfaced to the guest as an error - an analytics
      // write failure is never the guest's problem and never blocks
      // anything downstream (there is no downstream; this Worker isn't in
      // any booking call path).
      console.error('[funnel-events] insert failed:', err.message);
      return json({ ok: false }, 200, request); // still 200 - sendBeacon doesn't read the response anyway
    }

    return json({ ok: true }, 200, request);
  },
};
