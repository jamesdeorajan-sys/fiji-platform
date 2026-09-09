// Vakaviti funnel observability - client snippet. CEO P0 Round 6, Track C.
// ISOLATED PREVIEW ONLY - wired into this preview's index.html, NOT into
// book.fijidash.com production. Points at the isolated
// vakaviti-funnel-events-preview Worker (its own D1 database, zero shared
// code with the booking Worker).

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

  // First-touch UTM/referrer - captured ONCE per session, on first call,
  // never overwritten by a later page view in the same session.
  function getFirstTouch() {
    try {
      const cached = sessionStorage.getItem('vk_funnel_first_touch');
      if (cached) return JSON.parse(cached);
    } catch { /* fall through to compute fresh, uncached, this call only */ }

    const params = new URLSearchParams(location.search);
    const firstTouch = {
      first_source: params.get('utm_source') || null,
      first_medium: params.get('utm_medium') || null,
      first_campaign: params.get('utm_campaign') || null,
      first_referrer: document.referrer ? document.referrer.slice(0, 300) : null,
      first_landing_path: location.pathname,
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
