// NAT on-site booking funnel events (platform "nadi"), the same event names, endpoint and payload shape FijiDash already sends
// (funnel-events-client.js). OBSERVE-ONLY: it listens to the page and never calls, wraps or changes any booking function, price,
// payload or request. No guest details are sent (no name, email, phone, flight, notes, price or reference): only the event name,
// a random per-tab session id and first-touch UTM / referrer / landing path. Fire-and-forget; any error is swallowed.
(function () {
  var URL_EVENTS = 'https://vakaviti-funnel-events-preview.helpronline.workers.dev/events';
  var PLATFORM = 'nadi';
  var once = {};

  function sid() {
    try {
      var id = sessionStorage.getItem('vk_funnel_sid');
      if (!id) { id = rid(); sessionStorage.setItem('vk_funnel_sid', id); }
      return id;
    } catch (e) { window.__vkFunnelFallbackSid = window.__vkFunnelFallbackSid || rid(); return window.__vkFunnelFallbackSid; }
  }
  function rid() {
    try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* plain http or old browser */ }
    var a = new Uint8Array(16); try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256); }
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function firstTouch() {
    try { var c = sessionStorage.getItem('vk_funnel_first_touch'); if (c) return JSON.parse(c); } catch (e) { /* compute below */ }
    var p = new URLSearchParams(location.search);
    var m = location.pathname.match(/\/transfer\/([a-z0-9-]+)/i);
    var ft = {
      first_source: p.get('utm_source') || null, first_medium: p.get('utm_medium') || null, first_campaign: p.get('utm_campaign') || null,
      first_content: p.get('utm_content') || null, first_referrer: document.referrer ? document.referrer.slice(0, 300) : null,
      first_landing_path: location.pathname, route_slug: m ? m[1] : (p.get('utm_content') || null)
    };
    try { sessionStorage.setItem('vk_funnel_first_touch', JSON.stringify(ft)); } catch (e) { /* private mode */ }
    return ft;
  }
  function send(eventType, key) {
    try {
      if (key !== undefined) { if (once[key]) return; once[key] = true; }
      var payload = Object.assign({ event_type: eventType, platform: PLATFORM, session_id: sid() }, firstTouch());
      if (Array.isArray(window.__NAT_FUNNEL_CAPTURE)) { window.__NAT_FUNNEL_CAPTURE.push(payload); return; } // preview / test sink: nothing leaves the page
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      var ok = navigator.sendBeacon ? navigator.sendBeacon(URL_EVENTS, blob) : false;
      if (!ok) fetch(URL_EVENTS, { method: 'POST', body: blob, keepalive: true }).catch(function () {});
    } catch (e) { /* analytics must never affect booking */ }
  }
  window.__natFunnelSend = send; // for tests only

  function visible(el) { return !!el && el.style.display !== 'none' && !el.hidden && el.offsetParent !== null; }
  function init() {
    try {
      if (!document.getElementById('booking')) return; // only pages with the booking form
      send('booking_page_view', 'view');
      document.addEventListener('change', function (e) {
        var t = e.target; if (!t) return;
        if (t.id === 'pickup' || t.id === 'destination') {
          var p = document.getElementById('pickup'), d = document.getElementById('destination');
          if (p && d && p.value && d.value) send('route_selected', 'route');
        }
        if (t.classList && t.classList.contains('vehicle-radio') && t.checked) send('vehicle_selected', 'vehicle');
      }, true);
      document.addEventListener('click', function (e) {
        var t = e.target && e.target.closest ? e.target : null; if (!t) return;
        if (t.closest('.btn-confirm')) { delete once.outcome; send('confirm_clicked'); } // each press may lead to its own save attempt and outcome
        var a = t.closest('a[href]'); if (a && /^https:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(a.href)) send('whatsapp_opened', 'wa');
      }, true);
      var step3 = document.getElementById('step3'), bula = document.getElementById('bulaSuccess');
      var mo = new MutationObserver(function () {
        if (visible(step3)) send('details_opened', 'details');
        if (visible(bula)) {
          var ref = (document.getElementById('bulaRef') || {}).textContent || '';
          var lead = (document.getElementById('bulaLeadText') || {}).textContent || '';
          // a save was attempted only when the outcome is "saved" or "could not confirm"; started is sent with the outcome so it counts attempts exactly
          if (/Booking #\d+/.test(ref)) { if (!once.outcome) send('booking_post_started'); send('booking_post_succeeded', 'outcome'); }
          else if (/could not confirm/i.test(lead)) { if (!once.outcome) send('booking_post_started'); send('booking_post_failed', 'outcome'); }
          // "not saved online" = WhatsApp-only path (custom address): no save was attempted, so no outcome event
        }
      });
      var opts = { attributes: true, attributeFilter: ['style', 'class', 'hidden', 'disabled'] };
      [step3, bula].forEach(function (el) { if (el) mo.observe(el, opts); });
      var lead = document.getElementById('bulaLeadText'); if (lead) mo.observe(lead, { childList: true, characterData: true, subtree: true });
      var ref = document.getElementById('bulaRef'); if (ref) mo.observe(ref, { childList: true, characterData: true, subtree: true });
    } catch (e) { /* never affect booking */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
