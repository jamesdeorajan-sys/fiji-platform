/* Fiji-time pickup handling (2026-10-11 candidate). Plain global-scope script, loaded after app.js on a storefront page.
 *
 * Problem it fixes: the page computed the pickup-date minimum and the "tomorrow" default from the UTC date (toISOString) and never compared the pickup with the clock, so on a Fiji
 * morning the default was already today in Fiji with a pickup time that had passed, and a guest on a Sydney, Auckland or Los Angeles device saw a different "today" from one in Fiji.
 *
 * What it does, always in Pacific/Fiji time whatever the device clock or time zone says:
 *   1. date minimum = today in Fiji; default date = tomorrow in Fiji (the intended default, now calculated in Fiji time);
 *   2. WARNS (never blocks, never edits) when the chosen pickup date/time is earlier than the current Fiji minute, asking the guest to check the Fiji pickup date and time;
 *   3. exposes window.NadiFijiTime (now, today, tomorrow, hasPassed, ...) so the journey draft uses the same clock.
 * It adds no minimum lead time: a pickup later in the current hour is not warned about. It sends nothing, stores nothing, and changes no price, payload or Worker behaviour.
 */
(function () {
  'use strict';
  var TZ = 'Pacific/Fiji';
  var FALLBACK_OFFSET_MIN = 720;          // used only if the browser cannot format in Pacific/Fiji (Fiji currently observes no daylight saving)
  var fmt = null;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    if (typeof fmt.formatToParts !== 'function') fmt = null;
  } catch (e) { fmt = null; }

  function isDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z')); }
  function isTime(v) { return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v); }

  // the current (or given) instant as Fiji calendar date and clock time: { date: 'YYYY-MM-DD', time: 'HH:MM' }
  function now(ms) {
    var t = ms == null ? Date.now() : ms;
    if (fmt) {
      var p = {};
      fmt.formatToParts(new Date(t)).forEach(function (x) { p[x.type] = x.value; });
      return { date: p.year + '-' + p.month + '-' + p.day, time: (p.hour === '24' ? '00' : p.hour) + ':' + p.minute };
    }
    var iso = new Date(t + FALLBACK_OFFSET_MIN * 60000).toISOString();
    return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
  }
  function addDays(date, n) { var d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function today(ms) { return now(ms).date; }
  function tomorrow(ms) { return addDays(today(ms), 1); }
  // True when the pickup (a Fiji date, and a Fiji time if given) is EARLIER than the current Fiji minute. A pickup later in the current hour, or in the current minute, has not passed.
  // With a date but no valid time, it has passed only if the date itself is before today in Fiji.
  function hasPassed(date, time, ms) {
    if (!isDate(date)) return false;
    var n = now(ms);
    if (!isTime(time)) return date < n.date;
    return (date + 'T' + time) < (n.date + 'T' + n.time);
  }
  function longDate(date) {
    try { return new Date(date + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch (e) { return date; }
  }
  function warningText(date, time, ms) {
    var n = now(ms);
    return 'Please check your Fiji pickup date and time. ' + longDate(date) + ' at ' + time + ' has already passed in Fiji (it is now ' + n.time + ' on ' + longDate(n.date) + ' in Fiji). We have not changed what you entered.';
  }

  var api = { TZ: TZ, now: now, today: today, tomorrow: tomorrow, addDays: addDays, hasPassed: hasPassed, isDate: isDate, isTime: isTime, longDate: longDate, warningText: warningText };
  if (typeof window !== 'undefined') window.NadiFijiTime = api;
  if (typeof document === 'undefined') return;

  // ── page wiring ───────────────────────────────────────────────────────
  var warnings = [];
  function ensureStyle() {
    if (document.getElementById('fiji-pickup-style')) return;
    var st = document.createElement('style');
    st.id = 'fiji-pickup-style';
    st.textContent = '.pickup-warning{margin:8px 0 0;padding:8px 10px;border-left:4px solid #e8820c;background:#fff6e8;color:#5c3500;font-size:13px;line-height:1.4;border-radius:6px}.pickup-warning[hidden]{display:none}';
    document.head.appendChild(st);
  }
  function makeWarning() {
    var el = document.createElement('div');
    el.className = 'pickup-warning';
    el.setAttribute('role', 'status');
    el.hidden = true;
    warnings.push(el);
    return el;
  }
  function check() {
    var d = document.getElementById('travelDate'), t = document.getElementById('travelTime');
    if (!d || !t) return;
    var passed = hasPassed(d.value, t.value);
    warnings.forEach(function (el) {
      if (passed) { el.textContent = warningText(d.value, t.value); el.hidden = false; } else { el.textContent = ''; el.hidden = true; }
    });
  }
  function init() {
    var d = document.getElementById('travelDate'), t = document.getElementById('travelTime');
    if (!d || !t) return;
    ensureStyle();
    d.min = today();                       // Fiji today (the page used the UTC date)
    d.value = tomorrow();                  // the intended default, in Fiji time
    var row = t.closest ? t.closest('.field-row') : null, first = makeWarning();     // full width, directly under the date / time / passengers row
    if (row && row.parentNode) row.parentNode.insertBefore(first, row.nextSibling); else if (t.parentNode) t.parentNode.appendChild(first);
    var review = document.getElementById('step4');
    if (review) review.insertBefore(makeWarning(), review.firstChild);               // and again at the top of the review step, so it is seen before Confirm
    ['input', 'change'].forEach(function (evt) { d.addEventListener(evt, check); t.addEventListener(evt, check); });
    document.addEventListener('click', function () { setTimeout(check, 0); });
    setInterval(check, 30000);             // the clock moves on while the page is open
    check();
  }
  api.check = check;                     // lets the journey draft re-evaluate after it fills the fields
  // This file is loaded BEFORE app.js (so the two storefront index.html edits stay on separate lines). app.js sets its own default date inside a DOMContentLoaded handler, so initialise on a zero-delay
  // timer queued from DOMContentLoaded: it runs after every DOMContentLoaded handler, and the Fiji values win.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); }); else init();
})();
