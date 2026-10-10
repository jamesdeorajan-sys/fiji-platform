/* Nadi Airport Transfers - small booking improvements (CANDIDATE, not released).
 *
 * Two additive behaviours, loaded AFTER app.js as a plain global-scope script (same convention as app.js and route-handoff.js):
 *
 *  1. JOURNEY DRAFT. The guest's hotel selection and journey details survive a reload, a tab being discarded by the phone, or a trip to another app
 *     and back. Stored in sessionStorage (this tab only, gone when the tab closes), expires after 6 hours, never holds name / email / phone / notes,
 *     is skipped when the page was opened with ?pickup= / ?dest= route links, and is cleared once a request has been completed. Every storage call
 *     is wrapped: with storage blocked the form simply behaves as it does today.
 *
 *  2. OPTIONAL PRICE-BEAT REQUEST (the approved "beat a verified lower price by 10%" offer). A collapsed block on the result card, below the normal
 *     WhatsApp button. It only builds a WhatsApp message to the SAME team number, carrying the journey details and the guest's own words about the
 *     lower price. It never calculates or shows a reduced fare, never says an offer was accepted, and never changes the booking, the fare or the save:
 *     a person on the Fiji team verifies the quote and confirms any new fare with the guest.
 *
 * What this file deliberately does NOT do: it does not edit, wrap or replace any function in app.js (submitNadiBooking, confirmBooking, pricing, payload
 * or the WhatsApp message builder are untouched and a test pins that app.js is byte-identical to the live version). It reads the form and the global
 * `state` object, and calls existing public functions (setSelectByValue, onPickupChange, onDestinationChange, changePax, changeLuggage, setTripType,
 * updateExtras, selectVehicle) the same way the existing ?pickup= / ?dest= prefill does.
 */
(function () {
  'use strict';

  var TEAM_WA = 'https://wa.me/61478886145';
  var DRAFT_KEY = 'ftt_journey_draft_v1';
  var DRAFT_TTL_MS = 6 * 60 * 60 * 1000;
  var VEHICLE_KEYS = ['sedan', 'minivan', 'minibus'];
  var VEHICLE_NAMES = { sedan: 'Private Sedan', minivan: 'Private Minivan', minibus: 'Minibus' };

  // ── small helpers ─────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function val(id) { var el = $(id); return el && typeof el.value === 'string' ? el.value : ''; }
  function checked(id) { var el = $(id); return !!(el && el.checked); }
  function cap(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) : s; }
  // Guest-typed text that ends up inside a WhatsApp message: no control characters, collapsed whitespace, bounded length.
  function clean(s, n) {
    return cap(String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim(), n);
  }
  function getState() { try { return typeof state !== 'undefined' ? state : null; } catch (e) { return null; } }
  function call(name) {
    // Calls an existing top-level function of app.js by name (function declarations are window properties); absent or throwing means "skip".
    try {
      var fn = typeof window !== 'undefined' ? window[name] : null;
      if (typeof fn !== 'function') return undefined;
      return fn.apply(null, Array.prototype.slice.call(arguments, 1));
    } catch (e) { return undefined; }
  }
  function store() {
    try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch (e) { return null; }
  }
  function todayIso() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }

  // ── 1. journey draft ─────────────────────────────────────────────────────
  // Returns the draft object for the current form, or null when there is nothing worth keeping.
  function snapshotDraft() {
    var st = getState();
    if (!st) return null;
    if (st.selectedTour) return null;                                   // tour bundles are not drafted
    var destination = val('destination');
    if (!destination) return null;                                      // a pickup alone is not a journey
    var returnEl = $('returnPickupLocation');
    return {
      v: 1,
      t: Date.now(),
      pickup: cap(val('pickup'), 80),
      destination: cap(destination, 80),
      customPickupAddress: cap(val('customPickupAddress'), 200),
      customPickupZone: cap(val('customPickupZone'), 80),
      customDestAddress: cap(val('customDestAddress'), 200),
      customDestZone: cap(val('customDestZone'), 80),
      travelDate: cap(val('travelDate'), 10),
      travelTime: cap(val('travelTime'), 5),
      returnDate: cap(val('returnDate'), 10),
      returnTime: cap(val('returnTime'), 5),
      returnPickupLocation: returnEl && returnEl.dataset && returnEl.dataset.dirty === 'true' ? cap(returnEl.value, 200) : '',
      flightNum: cap(val('flightNum'), 20),
      flightUnknown: checked('flightUnknown'),
      extras: { lei: checked('extra-lei'), seat: checked('extra-seat'), stop: checked('extra-stop'), surf: checked('extra-surf') },
      tripType: st.tripType === 'return' ? 'return' : 'one-way',
      passengers: Math.max(1, Math.min(12, parseInt(st.passengers, 10) || 1)),
      luggage: Math.max(0, Math.min(20, parseInt(st.luggage, 10) || 0)),
      vehicle: VEHICLE_KEYS.indexOf(st.selectedVehicle) >= 0 ? st.selectedVehicle : ''
    };
  }

  function saveDraft() {
    var s = store();
    if (!s) return false;
    try {
      var success = $('bulaSuccess');
      if (success && success.style && success.style.display !== 'none') return false;     // the request is finished: do not re-draft it
      var d = snapshotDraft();
      if (!d) return false;
      s.setItem(DRAFT_KEY, JSON.stringify(d));
      return true;
    } catch (e) { return false; }
  }

  function clearDraft() {
    var s = store();
    try { if (s) s.removeItem(DRAFT_KEY); } catch (e) { /* storage blocked: nothing was stored */ }
  }

  function readDraft() {
    var s = store();
    if (!s) return null;
    try {
      var raw = s.getItem(DRAFT_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || d.v !== 1 || typeof d.t !== 'number' || Date.now() - d.t > DRAFT_TTL_MS || d.t > Date.now() + 60000) { s.removeItem(DRAFT_KEY); return null; }
      return d;
    } catch (e) { try { s.removeItem(DRAFT_KEY); } catch (e2) { /* ignore */ } return null; }
  }

  function setField(id, value) { var el = $(id); if (el && typeof value === 'string') el.value = value; }

  function urlHasRoutePrefill() {
    try {
      var p = new URLSearchParams(window.location.search);
      return !!(p.get('pickup') || p.get('dest'));
    } catch (e) { return false; }
  }

  // Applies a draft to the form by driving the page's own public functions. Returns true when something was restored.
  function applyDraft(d) {
    var st = getState();
    if (!d || !st) return false;
    if (!call('setSelectByValue', 'destination', d.destination)) return false;     // the hotel must still exist as an option; otherwise restore nothing
    if (d.pickup) call('setSelectByValue', 'pickup', d.pickup);
    call('onPickupChange');
    call('onDestinationChange');
    call('setSelectByValue', 'customPickupZone', d.customPickupZone);
    call('setSelectByValue', 'customDestZone', d.customDestZone);
    setField('customPickupAddress', d.customPickupAddress);
    setField('customDestAddress', d.customDestAddress);
    if (typeof d.travelDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.travelDate) && d.travelDate >= todayIso()) setField('travelDate', d.travelDate);
    if (typeof d.travelTime === 'string' && /^\d{2}:\d{2}$/.test(d.travelTime)) setField('travelTime', d.travelTime);
    if (typeof d.returnDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.returnDate) && d.returnDate >= todayIso()) setField('returnDate', d.returnDate);
    if (typeof d.returnTime === 'string' && /^\d{2}:\d{2}$/.test(d.returnTime)) setField('returnTime', d.returnTime);
    setField('flightNum', d.flightNum);
    var fu = $('flightUnknown'); if (fu && d.flightUnknown === true) fu.checked = true;
    // passengers and luggage move by the page's own +/- functions so capacity checks and vehicle re-rendering run as they do for a guest
    var paxTarget = Math.max(1, Math.min(12, parseInt(d.passengers, 10) || 1));
    if (paxTarget !== st.passengers) call('changePax', paxTarget - st.passengers);
    var bagTarget = Math.max(0, Math.min(20, parseInt(d.luggage, 10) || 0));
    if (bagTarget !== st.luggage) call('changeLuggage', bagTarget - st.luggage);
    if (d.tripType === 'return') {
      var btns = document.querySelectorAll('.trip-btn');
      if (btns && btns[1]) call('setTripType', 'return', btns[1]);
      if (d.returnPickupLocation) { var rp = $('returnPickupLocation'); if (rp) { rp.value = d.returnPickupLocation; if (rp.dataset) rp.dataset.dirty = 'true'; } }
    }
    var ex = d.extras || {};
    var map = { lei: 'extra-lei', seat: 'extra-seat', stop: 'extra-stop', surf: 'extra-surf' };
    Object.keys(map).forEach(function (k) { var el = $(map[k]); if (el) el.checked = ex[k] === true; });
    call('updateExtras');
    call('updatePricing');
    if (VEHICLE_KEYS.indexOf(d.vehicle) >= 0) {
      // Only a vehicle that still fits is re-selected, so no capacity alert() can appear while the page is loading.
      var fits = true;
      try {
        var list = typeof VEHICLES !== 'undefined' ? VEHICLES : [];
        var v = list.filter(function (x) { return x.key === d.vehicle; })[0];
        fits = !v || window.vehicleFits(v) === true;
      } catch (e) { fits = false; }
      if (fits) { call('selectVehicle', d.vehicle); call('refreshAfterCapacityChange'); }
    }
    return true;
  }

  function showDraftNotice() {
    var step1 = $('step1');
    if (!step1 || $('draftNotice')) return;
    var box = document.createElement('div');
    box.id = 'draftNotice';
    box.className = 'draft-notice';
    box.setAttribute('role', 'status');
    var text = document.createElement('span');
    text.textContent = 'We kept your trip details from earlier. ';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'draft-notice-clear';
    btn.textContent = 'Start again';
    btn.addEventListener('click', function () { clearDraft(); try { window.location.reload(); } catch (e) { /* ignore */ } });
    box.appendChild(text); box.appendChild(btn);
    step1.insertBefore(box, step1.firstChild);
  }

  function restoreDraftIfAny() {
    if (urlHasRoutePrefill()) return false;                           // a route link the guest followed always wins over an old draft
    var success = $('bulaSuccess');
    if (success && success.style && success.style.display === 'block') return false;
    var d = readDraft();
    if (!d) return false;
    var ok = false;
    try { ok = applyDraft(d); } catch (e) { ok = false; }
    if (ok) showDraftNotice(); else clearDraft();
    return ok;
  }

  var saveTimer = null;
  var restoring = false;
  function scheduleSave() {
    if (restoring) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveTimer = null; saveDraft(); }, 400);
  }

  // ── 2. optional price-beat request ──────────────────────────────────────
  var claimContext = null;

  // Same long date style as the existing reservation message ("Sun, 11 October 2026"); falls back to the raw value if the date cannot be formatted.
  function longDate(iso) {
    try {
      var d = new Date(iso + 'T00:00:00');
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) { return iso; }
  }

  function stripEmojiSafe(s) { var r = call('stripEmoji', s); return typeof r === 'string' ? r : String(s == null ? '' : s); }

  // Journey details for the message, read from the live form + page state (the same sources the existing WhatsApp message uses).
  function journeyContext() {
    var st = getState();
    var ctx = { reference: '', route: '', trip: '', when: '', returnWhen: '', vehicle: '', passengers: '', fare: '', flight: '' };
    var ref = $('bulaRef');
    if (ref) ctx.reference = clean(ref.textContent, 80);
    if (st) {
      var from = st.pickup ? stripEmojiSafe(st.pickup.name) : '';
      var to = st.destination ? stripEmojiSafe(st.destination.hotel || st.destination.name) : '';
      if (from && to) ctx.route = clean(from + ' → ' + to, 160);
      ctx.trip = st.tripType === 'return' ? 'Return' : 'One-way';
      ctx.vehicle = VEHICLE_NAMES[st.selectedVehicle] || '';
      ctx.passengers = String(st.passengers || '');
    }
    var date = val('travelDate'), time = val('travelTime');
    if (date) ctx.when = clean(longDate(date) + (time ? ', ' + time : ''), 60);
    if (ctx.trip === 'Return' && val('returnDate')) ctx.returnWhen = clean(longDate(val('returnDate')) + (val('returnTime') ? ', ' + val('returnTime') : ''), 60);
    ctx.flight = clean(val('flightNum'), 20);
    try {
      var t = window.calculateTotal();
      if (t && isFinite(t.final)) ctx.fare = 'FJ$' + window.fareText(t.final);
    } catch (e) { /* fare line omitted rather than guessed */ }
    return ctx;
  }

  // The message the guest sends. It states what the guest said they found; it never states a reduced price, an accepted offer or a confirmation.
  function buildClaimMessage(ctx, claim) {
    ctx = ctx || {}; claim = claim || {};
    var price = clean(claim.price, 40), where = clean(claim.where, 120);
    var lines = [
      'Hi Fiji Tour Transfers, I found a lower price for the same private transfer and would like to use your 10% price-beat offer.',
      '',
      'MY BOOKING' + (ctx.reference ? '' : ' (not saved online yet)'),
      ctx.reference ? ctx.reference : null,
      ctx.route ? 'Route: ' + ctx.route + (ctx.trip ? ' (' + ctx.trip + ')' : '') : (ctx.trip ? 'Trip: ' + ctx.trip : null),
      ctx.when ? 'Pickup: ' + ctx.when : null,
      ctx.returnWhen ? 'Return pickup: ' + ctx.returnWhen : null,
      ctx.flight ? 'Flight: ' + ctx.flight : null,
      ctx.vehicle || ctx.passengers ? 'Vehicle: ' + [ctx.vehicle, ctx.passengers ? ctx.passengers + (ctx.passengers === '1' ? ' passenger' : ' passengers') : ''].filter(Boolean).join(', ') : null,
      ctx.fare ? 'Fare I was shown: ' + ctx.fare : null,
      '',
      'THE LOWER PRICE I FOUND',
      'Their price: ' + (price || 'I will attach their quote'),
      'Where I saw it: ' + (where || 'I will attach a screenshot or link'),
      '',
      'Please check it and confirm any new fare with me here before anything changes. Thank you.'
    ];
    return lines.filter(function (l) { return l !== null; }).join('\n');
  }

  function buildClaimUrl(ctx, claim) {
    return TEAM_WA + '?text=' + encodeURIComponent(buildClaimMessage(ctx, claim));
  }

  function refreshClaimLink() {
    var link = $('pbSend');
    if (!link) return;
    link.href = buildClaimUrl(claimContext || journeyContext(), { price: val('pbPrice'), where: val('pbWhere') });
  }

  // ── wiring ───────────────────────────────────────────────────────────────
  function onSuccessCardShown() {
    claimContext = journeyContext();
    refreshClaimLink();
    var retry = $('bulaRetry');
    // A saved request, or a WhatsApp-only request, is finished: the draft is cleared. An unknown save keeps it (the guest may press "Review and retry").
    if (!retry || retry.hidden) clearDraft();
  }

  function wire() {
    var widget = $('bookingWidget');
    ['input', 'change', 'click'].forEach(function (evt) {
      if (widget) widget.addEventListener(evt, scheduleSave, true);
    });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') saveDraft(); });
    window.addEventListener('pagehide', saveDraft);

    var success = $('bulaSuccess');
    if (success && typeof MutationObserver === 'function') {
      new MutationObserver(function () {
        if (success.style.display === 'block') onSuccessCardShown();
      }).observe(success, { attributes: true, attributeFilter: ['style'] });
    }
    ['pbPrice', 'pbWhere'].forEach(function (id) { var el = $(id); if (el) el.addEventListener('input', refreshClaimLink); });
    var details = $('priceBeat');
    if (details) details.addEventListener('toggle', refreshClaimLink);

    // Runs after app.js's own DOMContentLoaded work (loaded earlier, so its listener is registered first) and after the typeahead is built.
    restoring = true;
    try { restoreDraftIfAny(); } finally { restoring = false; }
  }

  if (typeof window !== 'undefined') {
    window.NadiBookingExtras = {
      snapshotDraft: snapshotDraft, saveDraft: saveDraft, readDraft: readDraft, clearDraft: clearDraft, applyDraft: applyDraft, restoreDraftIfAny: restoreDraftIfAny,
      journeyContext: journeyContext, buildClaimMessage: buildClaimMessage, buildClaimUrl: buildClaimUrl, clean: clean,
      DRAFT_KEY: DRAFT_KEY, DRAFT_TTL_MS: DRAFT_TTL_MS, TEAM_WA: TEAM_WA
    };
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
    else wire();
  }
})();
