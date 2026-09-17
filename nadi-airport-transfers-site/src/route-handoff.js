/* Nadi route-page → FijiDash booking-handoff builder (CEO P0, 2026-09-15).
 *
 * ROOT PROBLEM this fixes: port-denarau.html, pacific-harbour.html and
 * suva.html each had the SAME book.fijidash.com URL hand-typed into five
 * separate CTA locations (nav, hero, mobile-assist, closing band, sticky
 * bar) with no `dest=` parameter at all — FijiDash's destination field
 * loaded blank and "Continue to vehicle selection" stayed disabled for
 * every real visitor. natadola-intercontinental.html and
 * coral-coast-outrigger.html had the same five-location duplication, just
 * with a correct dest= that happened to be typed right five times.
 *
 * This file is the single source of truth for enhanced CTA links. Exact-
 * resort pages keep their correct URL in HTML as a no-JavaScript fallback;
 * chooser pages keep a native GET form so booking still works if this file
 * is delayed or unavailable. JavaScript synchronises the remaining CTAs.
 *
 * Plain global-scope <script> (no module system) — matches app.js's own
 * convention (see its header comment) so every route page can load this
 * with a plain <script src="../route-handoff.js"> and no build step.
 */
(function () {
  'use strict';

  var FIJIDASH_BASE = 'https://book.fijidash.com/';

  // Verified against the real FijiDash destination <select>, including the
  // exact hotel each code selects. ROUTES_DATA contains grouped marketing
  // labels whose representative code may select only one hotel, so those
  // grouped labels must never be exposed as chooser options here.
  var VERIFIED_DESTINATIONS = {
    // Natadola — natadola-intercontinental.html (exact match, no chooser)
    INTERCONTINENTAL_NATADOLA: 'InterContinental Fiji Golf Resort Natadola',
    // Coral Coast / Outrigger — coral-coast-outrigger.html (exact match, no chooser)
    OUTRIGGER_FIJI: 'Outrigger Fiji Beach Resort',
    // Denarau resort strip — port-denarau.html (2 exact options).
    // Deliberately excludes PORT_DENARAU_MARINA - the ferry terminal is a
    // separate, already-correctly-wired page (port-denarau-marina.html)
    // and must never be silently offered as a "Port Denarau" resort choice.
    HILTON_DENARAU: 'Hilton Fiji Beach Resort & Spa',
    SOFITEL_DENARAU: 'Sofitel Fiji Resort & Spa',
    // Pacific Harbour — pacific-harbour.html (chooser: 4 options, all real
    // ROUTES_DATA entries in the "Pacific Harbour" area, identical fare tier)
    ARTS_VILLAGE: 'Pacific Harbour Arts Village Area',
    PEARL_SOUTH_PACIFIC: 'Pearl South Pacific Resort & Spa',
    UPRISING: 'Uprising Beach Resort',
    NANUKU_RESORT: 'Nanuku Resort (Auberge)',
    // Suva — suva.html (2 exact options). Deliberately excludes
    // NAUSORI_AIRPORT - a different "Nausori" area/product (airport-to-
    // airport transfer), not a Suva hotel transfer.
    GRAND_PACIFIC: 'Grand Pacific Hotel',
    TANOA_PLAZA_SUVA: 'Tanoa Plaza Hotel Suva',
  };

  /**
   * Builds the exact FijiDash handoff URL for a verified destination, or
   * returns null for anything not in VERIFIED_DESTINATIONS - fails safe,
   * never falls back to a guessed/default destination or a URL with a
   * missing dest= parameter. utmContent is the route-page slug (already
   * known statically by each page, never derived from user input).
   */
  function buildHandoffUrl(dest, utmContent) {
    if (!dest || !Object.prototype.hasOwnProperty.call(VERIFIED_DESTINATIONS, dest)) return null;
    if (!utmContent) return null;
    var params = new URLSearchParams();
    params.set('pickup', 'NAN');
    params.set('dest', dest);
    params.set('utm_source', 'organic');
    params.set('utm_medium', 'route_page');
    params.set('utm_campaign', 'nadi_transfer_acquisition');
    params.set('utm_content', utmContent);
    return FIJIDASH_BASE + '?' + params.toString();
  }

  /**
   * The one place that writes to every CTA on the page. Called once on
   * page load for an exact-resort page (fixed dest), and again on every
   * chooser change for a multi-hotel page. A null/invalid dest disables
   * every CTA (no href, aria-disabled, visual disabled state) rather than
   * leaving a stale or wrong-route link in place - "no enabled progression
   * under a different route" (CEO requirement).
   */
  function applyDestToAllCtas(dest, utmContent) {
    var url = buildHandoffUrl(dest, utmContent);
    var ctas = document.querySelectorAll('[data-route-cta]');
    for (var i = 0; i < ctas.length; i++) {
      var a = ctas[i];
      if (url) {
        a.setAttribute('href', url);
        a.removeAttribute('aria-disabled');
        a.removeAttribute('aria-describedby');
        a.classList.remove('rp-cta-disabled');
        a.classList.remove('rp-cta-pending');
      } else {
        a.removeAttribute('href');
        a.setAttribute('aria-disabled', 'true');
        a.classList.add('rp-cta-disabled');
      }
    }
    return url;
  }

  /**
   * Wires a server-rendered, native GET chooser form. The form is present
   * in HTML so the primary booking path survives blocked/delayed JavaScript.
   * `codes` is the page-specific subset that may update the other CTAs.
   * Before a valid selection, those CTAs guide the guest back to the chooser
   * instead of looking clickable while doing nothing.
   */
  function wireDestChooser(form, codes, utmContent) {
    if (!form || !utmContent) return;
    var select = form.querySelector('[name="dest"]');
    if (!select) return;

    var allowed = [];
    for (var i = 0; i < codes.length; i++) {
      if (Object.prototype.hasOwnProperty.call(VERIFIED_DESTINATIONS, codes[i])) {
        allowed.push(codes[i]);
      }
    }

    function isAllowedSelection() {
      return !!select.value && allowed.indexOf(select.value) !== -1;
    }

    function guideCtasToChooser() {
      var ctas = document.querySelectorAll('[data-route-cta]');
      for (var i = 0; i < ctas.length; i++) {
        var a = ctas[i];
        a.setAttribute('href', '#destChooser');
        a.removeAttribute('aria-disabled');
        a.setAttribute('aria-describedby', 'destChooserLabel');
        a.classList.remove('rp-cta-disabled');
        a.classList.add('rp-cta-pending');
      }
    }

    function syncCtas() {
      if (isAllowedSelection()) {
        applyDestToAllCtas(select.value, utmContent);
      } else {
        guideCtasToChooser();
      }
    }

    var ctas = document.querySelectorAll('[data-route-cta]');
    for (var i = 0; i < ctas.length; i++) {
      ctas[i].addEventListener('click', function (event) {
        if (isAllowedSelection()) return;
        event.preventDefault();
        if (typeof select.scrollIntoView === 'function') {
          select.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        select.focus();
      });
    }

    select.addEventListener('change', syncCtas);
    form.addEventListener('submit', function (event) {
      if (isAllowedSelection()) return;
      event.preventDefault();
      select.focus();
    });

    syncCtas();
    return select;
  }

  window.NadiRouteHandoff = {
    VERIFIED_DESTINATIONS: VERIFIED_DESTINATIONS,
    buildHandoffUrl: buildHandoffUrl,
    applyDestToAllCtas: applyDestToAllCtas,
    wireDestChooser: wireDestChooser,
  };
})();
