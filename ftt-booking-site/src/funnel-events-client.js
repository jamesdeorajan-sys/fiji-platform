// Vakaviti funnel observability - client snippet. CEO P0 Round 6, Track C.
// ISOLATED PREVIEW ONLY - wired into this preview's index.html, NOT into
// book.fijidash.com production. Points at the isolated
// vakaviti-funnel-events-preview Worker (its own D1 database, zero shared
// code with the booking Worker).
//
// Route attribution RC: adds first_content (from utm_content) and
// route_slug (from the /transfer/<slug> landing path where available,
// falling back to utm_content) so events can be broken down by which Nadi
// acquisition page sent the guest. Still no guest-identity-shaped field
// (no name/email/phone/flight/notes), still capped in length, still
// fire-and-forget and non-blocking - nothing here touches the booking
// payload built elsewhere in app.js.

(function () {
  const FUNNEL_EVENTS_URL = 'https://vakaviti-funnel-events-preview.helpronline.workers.dev/events';
  const PLATFORM = document.currentScript?.dataset?.platform || 'unknown';

  function getSessionId() {
    try {
      let id = sessionStorage.getItem('vk_funnel_sid');
      if (!id) {
        id = crypto.randomUUID();
        sessionStorage.setItem('vk_funnel_sid', id);
      }
      return id;
    } catch {
      // Storage blocked (private mode, etc) - fall back to an in-memory
      // id for this page load only. Never blocks tracking, never blocks
      // booking.
      window.__vkFunnelFallbackSid = window.__vkFunnelFallbackSid || crypto.randomUUID();
      return window.__vkFunnelFallbackSid;
    }
  }

  // Derives the route slug from the current path if it's one of the Nadi
  // /transfer/<slug> acquisition pages. Falls back to utm_content when the
  // path itself doesn't carry it - on book.fijidash.com the guest almost
  // always lands at "/" (this is the booking widget itself, not a route
  // page), so in practice this resolves via utm_content here, while the
  // same client logic on a Nadi route page itself would resolve via the
  // path directly. Covers both firing points with one function.
  function deriveRouteSlug(utmContent) {
    const match = location.pathname.match(/\/transfer\/([a-z0-9-]+)/i);
    if (match) return match[1];
    return utmContent || null;
  }

  // First-touch UTM/referrer - captured ONCE per session, on first call,
  // never overwritten by a later page view in the same session.
  function getFirstTouch() {
    try {
      const cached = sessionStorage.getItem('vk_funnel_first_touch');
      if (cached) return JSON.parse(cached);
    } catch { /* fall through to compute fresh, uncached, this call only */ }

    const params = new URLSearchParams(location.search);
    const firstContent = params.get('utm_content') || null;
    const firstTouch = {
      first_source: params.get('utm_source') || null,
      first_medium: params.get('utm_medium') || null,
      first_campaign: params.get('utm_campaign') || null,
      first_content: firstContent,
      first_referrer: document.referrer ? document.referrer.slice(0, 300) : null,
      first_landing_path: location.pathname,
      route_slug: deriveRouteSlug(firstContent),
    };
    try { sessionStorage.setItem('vk_funnel_first_touch', JSON.stringify(firstTouch)); } catch { /* private mode - fine, just not cached */ }
    return firstTouch;
  }

  window.trackFunnelEvent = function (eventType) {
    try {
      const payload = {
        event_type: eventType,
        platform: PLATFORM,
        session_id: getSessionId(),
        ...getFirstTouch(),
      };
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      // sendBeacon queues the send and returns immediately - the browser
      // delivers it in the background, even across a page navigation
      // (e.g. the WhatsApp CTA opening a new tab). Never awaited, never
      // blocks or delays anything in the caller.
      const sent = navigator.sendBeacon ? navigator.sendBeacon(FUNNEL_EVENTS_URL, blob) : false;
      if (!sent) {
        // sendBeacon unsupported/failed - best-effort fetch, deliberately
        // NOT awaited by the caller (no `await` here), so a slow or
        // offline analytics endpoint cannot delay the booking flow either.
        fetch(FUNNEL_EVENTS_URL, { method: 'POST', body: blob, keepalive: true }).catch(() => {});
      }
    } catch (err) {
      // Analytics must never block or delay booking. Swallow, log only.
      console.warn('[funnel-events] tracking failed (non-blocking):', err);
    }
  };
})();
