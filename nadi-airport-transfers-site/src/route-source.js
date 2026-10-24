/* Route page → FijiDash: send the visitor's real source instead of "organic" (2026-10-25).
 *
 * Every transfer page links to book.fijidash.com with utm_source=organic, whatever brought the visitor
 * (Google, Bing, an AI answer, a partner link, or typing the address). FijiDash then records every route-page
 * booking as "organic". This script replaces ONLY that one value, at the moment the visitor goes to FijiDash,
 * with where they actually came from:
 *   - a utm_source the visitor arrived with (e.g. a partner or campaign link), or
 *   - a short name for the site that referred them (google, bing, chatgpt, perplexity, facebook, …), or
 *   - "direct" when there is no referring site.
 * Only the referring SITE NAME is used: never its page, search words, a query string or any personal data.
 * utm_medium (route_page / legacy_route_page), utm_campaign and utm_content (the page) are left as they are,
 * so existing route-page reporting keeps working. Without this script (blocked, failed, old cache) the links
 * work exactly as before. Plain global-scope script, no build step, never throws.
 */
(function () {
  'use strict';
  var FD_HOST = 'book.fijidash.com';
  var SELF = /(^|\.)nadiairporttransfers\.com$/i;
  var KEY = 'nat_route_source_v1';
  var NAMES = [ // first match wins; host is lower-case with a leading "www." or "m." removed
    [/^gemini\.google\./, 'gemini'], [/(^|\.)google\./, 'google'],
    [/^copilot\.microsoft\.com$/, 'copilot'], [/(^|\.)bing\.com$/, 'bing'],
    [/^(chatgpt\.com|chat\.openai\.com)$/, 'chatgpt'], [/(^|\.)perplexity\.ai$/, 'perplexity'], [/^claude\.ai$/, 'claude'],
    [/(^|\.)duckduckgo\.com$/, 'duckduckgo'], [/(^|\.)yahoo\./, 'yahoo'], [/(^|\.)ecosia\.org$/, 'ecosia'],
    [/(^|\.)facebook\.com$/, 'facebook'], [/(^|\.)instagram\.com$/, 'instagram'], [/(^|\.)tripadvisor\./, 'tripadvisor'],
  ];

  function nameForHost(host) {
    var h = String(host || '').toLowerCase().replace(/^(www|m)\./, '');
    if (!h) return null;
    for (var i = 0; i < NAMES.length; i++) if (NAMES[i][0].test(h)) return NAMES[i][1];
    h = h.replace(/[^a-z0-9.-]/g, '').slice(0, 40);
    return h || null;
  }
  function cleanTag(v) { // a utm_source the visitor arrived with: short, plain characters only
    return typeof v === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(v) && v.toLowerCase() !== 'organic' ? v.toLowerCase() : null;
  }
  function stored() {
    try { var v = window.sessionStorage.getItem(KEY); return cleanTag(v); } catch (e) { return null; }
  }
  function store(v) { try { window.sessionStorage.setItem(KEY, v); } catch (e) { /* storage blocked: still works for this page */ } }
  function homepageSource() { // the homepage's own record (nat_attribution_v1, attribution release): its latest touch
    try {
      var s = JSON.parse(window.localStorage.getItem('nat_attribution_v1') || 'null');
      var l = s && (s.last || s.first);
      if (!l) return null;
      return cleanTag(l.source) || (l.referrer && l.referrer.indexOf('/') === -1 ? nameForHost(l.referrer) : null);
    } catch (e) { return null; }
  }

  function visitorSource() {
    var fromUrl = null, ref = null, external = false;
    try { fromUrl = cleanTag(new URLSearchParams(window.location.search).get('utm_source')); } catch (e) { fromUrl = null; }
    try {
      if (document.referrer) { var u = new URL(document.referrer); ref = u.hostname; external = !SELF.test(ref); }
    } catch (e) { ref = null; }
    if (fromUrl) { store(fromUrl); return fromUrl; }
    if (ref && external) { var n = nameForHost(ref); if (n) { store(n); return n; } }
    return stored() || homepageSource() || 'direct';
  }

  var SOURCE = 'direct';
  try { SOURCE = visitorSource(); } catch (e) { SOURCE = 'direct'; }

  function fixHref(a) {
    try {
      if (!a || !a.getAttribute) return;
      var href = a.getAttribute('href');
      if (!href || href.indexOf(FD_HOST) === -1) return;
      var u = new URL(href, window.location.href);
      if (u.hostname !== FD_HOST || u.searchParams.get('utm_source') !== 'organic') return;
      u.searchParams.set('utm_source', SOURCE);
      a.setAttribute('href', u.toString());
    } catch (e) { /* leave the link as it is */ }
  }
  function fixForm(f) {
    try {
      if (!f || !f.getAttribute) return;
      var action = new URL(f.getAttribute('action') || '', window.location.href);
      if (action.hostname !== FD_HOST) return;
      var input = f.querySelector('input[name="utm_source"]');
      if (input && input.value === 'organic') input.value = SOURCE;
    } catch (e) { /* leave the form as it is */ }
  }
  function closestLink(t) {
    while (t && t.nodeType === 1) { if (t.tagName === 'A') return t; t = t.parentNode; }
    return null;
  }

  function fixAll() {
    try {
      var links = document.querySelectorAll('a[href*="' + FD_HOST + '"]');
      for (var i = 0; i < links.length; i++) fixHref(links[i]);
      var forms = document.querySelectorAll('form');
      for (var j = 0; j < forms.length; j++) fixForm(forms[j]);
    } catch (e) { /* leave the page as it is */ }
  }

  try {
    fixAll();
    // The destination chooser rewrites its buttons on every change: correct them again right after it has.
    document.addEventListener('change', function () { setTimeout(fixAll, 0); }, true);
    // Any link set later by another script is also corrected at the moment it is used.
    ['pointerdown', 'click', 'auxclick', 'contextmenu', 'keydown'].forEach(function (type) {
      document.addEventListener(type, function (e) { fixHref(closestLink(e.target)); }, true);
    });
    document.addEventListener('submit', function (e) { fixForm(e.target); }, true);
  } catch (e) { /* never blocks the page */ }

  window.NadiRouteSource = { source: function () { return SOURCE; }, nameForHost: nameForHost };
})();
