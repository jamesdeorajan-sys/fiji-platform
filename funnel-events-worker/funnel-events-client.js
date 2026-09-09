// Vakaviti funnel observability - client snippet. CEO P0 Round 5, Track B.
// REFERENCE ONLY - not included in any live page yet. Wiring this into
// book.fijidash.com or nadiairporttransfers.com's actual app.js is its own
// production change and needs its own approval, same as every booking-path
// change this engagement.
//
// Usage once wired in: <script src="funnel-events-client.js" data-platform="fijidash"></script>
// then call trackFunnelEvent('route_selected') etc. from the existing app.js
// at each step - no changes to booking submission logic itself.

(function () {
  const FUNNEL_EVENTS_URL = 'https://funnel-events-worker-preview.PLACEHOLDER.workers.dev/events';
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
      const sent = navigator.sendBeacon ? navigator.sendBeacon(FUNNEL_EVENTS_URL, blob) : false;
      if (!sent) {
        // sendBeacon unsupported/failed - best-effort fetch, but never
        // awaited by the caller and never allowed to throw into the
        // booking flow.
        fetch(FUNNEL_EVENTS_URL, { method: 'POST', body: blob, keepalive: true }).catch(() => {});
      }
    } catch (err) {
      // Analytics must never block or delay booking. Swallow, log only.
      console.warn('[funnel-events] tracking failed (non-blocking):', err);
    }
  };
})();
