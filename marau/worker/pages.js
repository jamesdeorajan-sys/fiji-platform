/* Marau Stage 1 (PREVIEW ONLY) — guest app + ops console, served as plain
 * HTML/CSS/JS strings from the same Worker (no separate build step, no
 * separate Pages project needed for this stage).
 *
 * DESIGN (queued requirement, applied after correctness passed review):
 * palette, Familjen Grotesk/Onest typography, the brand mark and the
 * prominent pickup card are ported directly from the approved design
 * reference, marau-app-prototype.html — same CSS custom properties, same
 * font pairing, same `.pickup`/`.route`/`.facts`/`.deal` component shapes.
 * Gamified tasks/credit-earning/install-banner are NOT ported — those
 * features (credits, book-ahead rewards) are explicitly deferred per the
 * mission and never built here. The synthetic booking-creation form is
 * deliberately styled as a separate, plainly-labelled test harness
 * (dashed border, monospace accents), NOT the branded guest experience —
 * a real Marau guest always lands on their Trip directly from a booking
 * link and never sees this screen at all.
 *
 * No Lagi reference anywhere — Lagi is excluded from this stage per the
 * mission. WhatsApp only ever appears as a composed message in an in-page
 * mock panel with a copy button — no wa.me URL, no navigation, anywhere
 * (see whatsapp_handoff.js and renderMockWhatsApp() below).
 *
 * THIRD REVIEW — correctness: the booking form now also generates and
 * sends `attempt_secret` (see client_idempotency.js and worker.js#
 * handleCreateBooking) — the "separate secure attempt/recovery capability"
 * that replaces the removed time-window heuristic.
 *
 * THIRD REVIEW — design completion: an install invitation (finding 4,
 * independent of deferred credits), Fiji-time pickup display with a real
 * booking switcher, and internal offer/movement IDs removed from
 * guest-facing copy (finding 5).
 */
import { getOrCreateClientBookingRef, clearClientBookingRef, getOrCreateAttemptSecret, clearAttemptSecret, defaultRandomSource } from './client_idempotency.js';
import { formatFijiDateTime, toFijiWallClockInputValue } from './fiji_time.js';
import { selectDefaultBooking, ACTIVE_BOOKING_STATUSES } from './booking_selection.js';
import { shortBookingReference, humanizeZoneLabel, humanizeVehicleClassLabel, formatFijiCurrency } from './guest_display.js';

// Splicing these functions' own source into the emitted <script> means
// the browser runs literally the same code marau/test/*.test.mjs already
// unit-tests against a fake storage — not a hand-copied duplicate that
// could silently drift out of sync with it (marau_codex_fixes_round3.test.mjs
// proves this exact splicing mechanism works, after a real embedding bug —
// a shared constant that didn't survive extraction — was found and fixed).
//
// FOURTH REVIEW additions: formatFijiDateTime (fiji_time.js) and
// selectDefaultBooking/ACTIVE_BOOKING_STATUSES (booking_selection.js) are
// spliced the SAME way — both were written with no outer-scope constant
// referenced from inside a function body, honouring the exact lesson
// from the round-3 STORAGE_KEY bug. A regression test reproduces this
// embedding mechanism for these too (not just an ES-module import).
//
// BOUNDED MOBILE-COPY CORRECTIONS: guest_display.js's four formatting
// helpers are spliced the same way — used both here (client rendering)
// and server-side in whatsapp_handoff.js/worker.js, so the guest's own
// screen and the composed WhatsApp summary can never show the route,
// vehicle, reference, or price differently.
const EMBEDDED_CLIENT_IDEMPOTENCY = `
${getOrCreateClientBookingRef.toString()}
${clearClientBookingRef.toString()}
${getOrCreateAttemptSecret.toString()}
${clearAttemptSecret.toString()}
${defaultRandomSource.toString()}
${formatFijiDateTime.toString()}
${toFijiWallClockInputValue.toString()}
const ACTIVE_BOOKING_STATUSES = ${JSON.stringify(ACTIVE_BOOKING_STATUSES)};
${selectDefaultBooking.toString()}
${shortBookingReference.toString()}
${humanizeZoneLabel.toString()}
${humanizeVehicleClassLabel.toString()}
${formatFijiCurrency.toString()}
`;

const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@500;600;700&family=Onest:wght@400;500;600&display=swap" rel="stylesheet">`;

// Palette, type scale and component shapes ported verbatim (selectors
// renamed only where Marau's markup differs) from marau-app-prototype.html.
const SHARED_STYLE = `
<style>
:root{
  --ink:#152A2E; --muted:#56696C; --paper:#F2F6F5; --surface:#FFFFFF;
  --lagoon:#0F5E63; --lagoon-ink:#FFFFFF; --shallows:#D3EBE6; --line:#D7E2E0;
  --hibiscus:#C4304A; --frangipani:#F3C33C; --frang-ink:#3A2D00;
  --shadow:0 1px 0 rgba(21,42,46,.06);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --ink:#E4EFED; --muted:#9BB1B3; --paper:#0C1819; --surface:#132527;
    --lagoon:#4DB0AA; --lagoon-ink:#06201F; --shallows:#1A3739; --line:#243B3D;
    --hibiscus:#F0687E; --frangipani:#F3C33C; --frang-ink:#2A2000; --shadow:none;
  }
}
:root[data-theme="dark"]{
  --ink:#E4EFED; --muted:#9BB1B3; --paper:#0C1819; --surface:#132527;
  --lagoon:#4DB0AA; --lagoon-ink:#06201F; --shallows:#1A3739; --line:#243B3D;
  --hibiscus:#F0687E; --frangipani:#F3C33C; --frang-ink:#2A2000; --shadow:none;
}
:root{box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
*,*::before,*::after{box-sizing:inherit}
body{margin:0;background:var(--paper);color:var(--ink);font:400 16px/1.5 "Onest",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:"Familjen Grotesk","Onest",system-ui,sans-serif;margin:0;line-height:1.15;letter-spacing:-.01em}
h1{font-size:1.5rem;font-weight:700}
h2{font-size:1.05rem;font-weight:600}
p{margin:0}
button,input,select,textarea{font:inherit;color:inherit}
button{cursor:pointer}
:focus-visible{outline:3px solid var(--frangipani);outline-offset:2px;border-radius:6px}

.app{max-width:480px;margin:0 auto;padding:12px 16px 110px}
.top{display:flex;align-items:center;justify-content:space-between;padding:8px 0 16px}
.brand{font-family:"Familjen Grotesk",sans-serif;font-weight:700;font-size:1.15rem;display:flex;align-items:baseline;gap:8px}
.brand-sub{font-family:"Onest",sans-serif;font-weight:400;font-size:.72rem;color:var(--muted)}
.brand-mark{width:28px;height:28px;border-radius:50%;background:var(--lagoon);position:relative;overflow:hidden;flex:none}
.brand-mark::after{content:"";position:absolute;left:-4px;right:-4px;bottom:6px;height:6px;border-radius:6px;background:var(--frangipani);transform:rotate(-8deg)}
.preview-pill{border:0;background:var(--frangipani);color:var(--frang-ink);font-weight:600;border-radius:999px;padding:6px 12px;font-size:.78rem;letter-spacing:.02em;text-transform:uppercase}
.sample-note{font-size:.8rem;color:var(--muted);background:var(--surface);border:1px dashed var(--line);border-radius:10px;padding:8px 12px;margin-bottom:16px}

.view{display:none}
.view.active{display:block}
.stack{display:grid;gap:14px}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:18px;box-shadow:var(--shadow);margin-bottom:14px}
.muted{color:var(--muted)}
.small{font-size:.875rem}

/* Prominent pickup card, ported from the design reference */
.pickup{background:var(--lagoon);color:var(--lagoon-ink);border:0;border-radius:22px;padding:20px}
.pickup .sub{opacity:.85;font-size:.95rem}
.pickup .when{font-family:"Familjen Grotesk",sans-serif;font-size:clamp(1.4rem,7vw,1.9rem);font-weight:700;line-height:1.1;margin:4px 0 2px}
.route{margin-top:16px;display:grid;gap:0}
.stop{display:grid;grid-template-columns:22px 1fr;gap:12px;position:relative;padding-bottom:14px}
.stop:last-child{padding-bottom:0}
.stop .dot{width:14px;height:14px;border-radius:50%;border:3px solid currentColor;margin-top:4px;margin-left:4px;background:transparent}
.stop.fill .dot{background:currentColor}
.stop:not(:last-child)::before{content:"";position:absolute;left:10px;top:20px;bottom:0;border-left:2px dashed currentColor;opacity:.5}
.stop strong{display:block;font-weight:600}
.stop span{font-size:.875rem;opacity:.85}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}
.fact{background:rgba(255,255,255,.14);border-radius:12px;padding:10px 12px;font-size:.85rem}
.fact b{display:block;font-weight:600;font-size:.95rem}
.pickup-actions{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}

.btn{border:0;border-radius:12px;padding:11px 16px;font-weight:600;min-height:44px;font-size:15px;text-align:center}
.btn-primary{background:var(--lagoon);color:var(--lagoon-ink)}
.btn-light{background:var(--shallows);color:var(--lagoon)}
.btn-onlagoon{background:rgba(255,255,255,.18);color:var(--lagoon-ink)}
.btn-block{display:block;width:100%;margin-top:10px}
.btn[disabled]{opacity:.5;cursor:not-allowed}

label{display:block;font-size:13px;font-weight:600;margin:10px 0 4px}
input,select{width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid var(--line);background:var(--paper);color:var(--ink);font-size:15px;min-height:44px}
.row{display:flex;gap:8px}
.row>*{flex:1}

.tabs{position:fixed;left:0;right:0;bottom:0;display:flex;background:var(--surface);border-top:1px solid var(--line);padding:6px max(8px,env(safe-area-inset-left)) calc(6px + env(safe-area-inset-bottom));z-index:10}
.tab{flex:1;border:none;background:none;padding:8px 4px;font-size:12px;font-weight:700;color:var(--muted)}
.tab[aria-selected="true"]{color:var(--lagoon)}

/* Deals — pct/price treatment ported from the design reference */
.deal{background:var(--surface);border:1px solid var(--line);border-radius:20px;overflow:hidden;margin-bottom:12px}
.deal-top{display:grid;grid-template-columns:1fr auto;gap:12px;padding:16px 16px 10px}
.deal-kind{font-size:.78rem;font-weight:600;color:var(--lagoon)}
.deal-route{font-weight:700;font-size:1rem;margin-top:2px}
.pct{font-family:"Familjen Grotesk",sans-serif;font-weight:700;font-size:1.9rem;line-height:1;color:var(--hibiscus);text-align:right}
.pct small{display:block;font-size:.72rem;font-family:"Onest",sans-serif;font-weight:500;color:var(--muted)}
.why{margin:0 16px;padding:9px 12px;background:var(--paper);border-radius:10px;font-size:.85rem}
.deal-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 16px 16px;flex-wrap:wrap}
.price s{color:var(--muted);font-size:.85rem;margin-right:6px}
.price b{font-size:1.25rem;font-family:"Familjen Grotesk",sans-serif}
.meta{font-size:.78rem;color:var(--muted)}

.pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;background:var(--shallows);color:var(--lagoon)}
.pill.warn{background:#FCEBCD;color:var(--frang-ink)}
.pill.bad{background:#FBE1E6;color:var(--hibiscus)}

.harness{border:1.5px dashed var(--muted);border-radius:16px;padding:16px;background:var(--surface)}
.harness .tag{display:inline-block;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;font-weight:700;letter-spacing:.03em;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:2px 6px;margin-bottom:8px}

.toast{position:fixed;left:16px;right:16px;bottom:70px;background:var(--ink);color:var(--paper);padding:10px 14px;border-radius:10px;text-align:center;opacity:0;transform:translateY(8px);transition:.2s;pointer-events:none;z-index:30}
.toast.show{opacity:1;transform:translateY(0)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:6px 4px;border-bottom:1px solid var(--line);vertical-align:top}
code{font-size:12px;background:var(--shallows);padding:1px 5px;border-radius:6px;word-break:break-all}
.banner{background:var(--frangipani);color:var(--frang-ink);border-radius:10px;padding:8px 12px;font-size:13px;font-weight:600;margin-bottom:12px}
.mock-wa{border:1px dashed var(--lagoon);border-radius:12px;padding:12px;margin-top:8px;background:var(--shallows)}
.mock-wa .label{font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--lagoon)}
.mock-wa .msg{background:var(--surface);border-radius:8px;padding:10px;margin:8px 0;font-size:13px;white-space:pre-wrap}
.link-code{font-size:24px;font-weight:800;letter-spacing:.08em;text-align:center;padding:10px;background:var(--shallows);border-radius:10px;margin:6px 0}
.install{display:flex;gap:14px;align-items:center;background:var(--shallows);border-radius:18px;padding:14px 16px;margin-bottom:14px}
.install p{font-size:.9rem}
.install .btn{white-space:nowrap;margin-top:0}
.switcher{display:flex;gap:8px;overflow-x:auto;padding:2px 0 4px;margin-bottom:10px}
.switcher button{flex:none;border:1.5px solid var(--line);background:var(--surface);border-radius:999px;padding:8px 14px;font-size:.85rem;font-weight:600;color:var(--ink);white-space:nowrap}
.switcher button[aria-pressed="true"]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
</style>`;

export const GUEST_APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0F5E63">
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="icon" href="/icon-192.png" sizes="192x192" type="image/png">
<link rel="apple-touch-icon" href="/icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Marau">
<title>Marau by Vakaviti AI</title>
${FONT_LINK}
${SHARED_STYLE}
</head>
<body>
<div class="app">
  <header class="top">
    <div class="brand"><span class="brand-mark" aria-hidden="true"></span>Marau<span class="brand-sub"> by Vakaviti AI</span></div>
    <span class="preview-pill">Preview</span>
  </header>
  <p class="sample-note">Isolated preview build. Nothing here is a real booking, message or payment — every screen carries its own demonstration-data label.</p>

  <div class="install" id="installBanner" style="display:none">
    <p><strong>Add Marau to your home screen</strong><br><span class="muted">Get back to your trip in one tap, with pickup and deal updates.</span></p>
    <button class="btn btn-primary" id="installBtn" type="button">Add</button>
  </div>

  <section id="view-start" class="view">
    <div class="harness">
      <span class="tag">PREVIEW TEST HARNESS</span>
      <h2>Create a synthetic booking</h2>
      <p class="small muted" style="margin-top:6px">A real Marau guest never sees this screen — they land straight on their Trip from a booking-confirmation link. This form exists only so this preview can be explored from a cold start. Save a request below to get secure access immediately.</p>
      <form id="bookingForm">
        <label for="f-email">Email</label>
        <input id="f-email" type="email" required autocomplete="email">
        <label for="f-phone">Mobile number</label>
        <input id="f-phone" type="tel" required autocomplete="tel">
        <label><input id="f-wa" type="checkbox" style="width:auto;display:inline;vertical-align:middle;margin-right:6px;min-height:auto"> This number can receive WhatsApp</label>
        <div class="row">
          <div><label for="f-pickup">Pickup zone</label><input id="f-pickup" required value="Nadi Airport"></div>
          <div><label for="f-dest">Destination zone</label><input id="f-dest" required value="Denarau"></div>
        </div>
        <div class="row">
          <div><label for="f-vehicle">Vehicle type</label><input id="f-vehicle" required value="Sedan"></div>
          <div><label for="f-amount">Quoted amount</label><input id="f-amount" type="number" min="0" step="0.01" required value="45"></div>
        </div>
        <label for="f-when">Pickup date &amp; time</label>
        <input id="f-when" type="datetime-local" required>
        <button class="btn btn-primary btn-block" type="submit">Save booking request</button>
      </form>
      <p id="startError" class="small" style="color:var(--hibiscus)"></p>
    </div>
  </section>

  <section id="view-trip" class="view">
    <div id="linkOfferPanel" class="panel" style="display:none"></div>
    <div id="linkInboxPanel" class="panel" style="display:none"></div>
    <div id="pickupCard"></div>
    <section class="panel" id="dealRequestsPanel" style="display:none">
      <h2>Your deal requests</h2>
      <div id="dealRequestsList" style="margin-top:8px"></div>
    </section>
    <section class="panel">
      <h2>Ask Marau</h2>
      <p class="small muted" id="aiDisclosure" style="margin-top:4px"></p>
      <input id="assistQ" placeholder="e.g. when is my pickup?" style="margin-top:8px">
      <button class="btn btn-light btn-block" id="assistBtn" type="button">Ask</button>
      <div id="assistAnswer" class="small" style="margin-top:8px"></div>
      <button class="btn btn-light btn-block" id="humanHandoffBtn" type="button">Talk to our team on WhatsApp</button>
      <div id="tripHandoffPanel"></div>
    </section>
    <button class="btn btn-light btn-block" id="revokeBtn" type="button">Revoke this device's access</button>
  </section>

  <section id="view-deals" class="view">
    <h1>Deals</h1>
    <p class="muted small" style="margin-top:6px">Open browsing — every current deal is shown here, demonstration data only.</p>
    <div id="dealsList" style="margin-top:14px"><p class="muted">Loading deals…</p></div>
  </section>
</div>

<nav class="tabs" role="tablist">
  <button class="tab" data-view="trip" aria-selected="true">Trip</button>
  <button class="tab" data-view="deals" aria-selected="false">Deals</button>
</nav>
<div class="toast" id="toast"></div>

<script>
${EMBEDDED_CLIENT_IDEMPOTENCY}
(function () {
  var API = '';
  var els = {};
  ['bookingForm','startError','pickupCard','dealsList','assistQ','assistAnswer','assistBtn','revokeBtn','humanHandoffBtn','tripHandoffPanel','aiDisclosure','toast','linkOfferPanel','linkInboxPanel','dealRequestsPanel','dealRequestsList','installBanner','installBtn'].forEach(function(id){ els[id] = document.getElementById(id); });

  // Home-screen installation (finding 4) — independent of credits, which
  // stay deferred. Chrome/Android fire beforeinstallprompt when the
  // manifest+icon are valid and the page qualifies; Safari/iOS never
  // fires it, so the banner falls back to manual "Share > Add to Home
  // Screen" guidance there. Hidden entirely once already installed
  // (standalone display mode).
  var deferredInstallPrompt = null;
  var alreadyInstalled = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  if (!alreadyInstalled && els.installBanner) {
    els.installBanner.style.display = 'flex';
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstallPrompt = e;
  });
  if (els.installBtn) {
    els.installBtn.addEventListener('click', function () {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then(function () { deferredInstallPrompt = null; });
      } else {
        toast('Use your browser’s Share or menu button, then "Add to Home Screen".');
      }
    });
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { els.toast.classList.remove('show'); }, 2600);
  }

  // Shown for BOTH the main "Talk to our team" handoff and a per-deal
  // handoff — never a live link, never navigation. "container" is the
  // element to render into; "handoff" is { to, message, note }.
  function renderMockWhatsApp(container, handoff) {
    if (!container || !handoff) return;
    var msgId = 'wa-msg-' + Math.random().toString(36).slice(2);
    container.innerHTML = '<div class="mock-wa">' +
      '<div class="label">Preview mock — nothing is sent</div>' +
      '<p class="small muted">' + handoff.note + '</p>' +
      '<p class="small"><strong>To:</strong> ' + handoff.to + '</p>' +
      '<div class="msg" id="' + msgId + '"></div>' +
      '<button class="btn btn-light btn-block" data-copy="' + msgId + '" type="button">Copy message</button>' +
      '</div>';
    container.querySelector('#' + msgId).textContent = handoff.message;
    var copyBtn = container.querySelector('[data-copy]');
    copyBtn.addEventListener('click', function () {
      var text = handoff.message;
      var done = function () { toast('Message copied.'); };
      var fail = function () {
        var range = document.createRange();
        range.selectNodeContents(document.getElementById(msgId));
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        toast('Copy failed — message selected instead.');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(fail);
      } else {
        fail();
      }
    });
  }

  // FIX (fourth independent review, finding 3 — installed-app acceptance):
  // an installed PWA relaunches at the static manifest start_url ("/"),
  // with NO "#tok=" fragment and no sessionStorage carried over from the
  // browser tab that installed it (a new top-level launch context gets
  // fresh session storage). sessionStorage-only persistence therefore
  // could not survive install → close → reopen at all — the guest would
  // land back on the synthetic-entry "start" screen every time, unable
  // to reach their own trip. localStorage is per-ORIGIN, device-local
  // storage that DOES survive that relaunch, so the token is now ALSO
  // persisted there (never in the shared manifest.json itself — that
  // file is static and identical for every guest). Revoke/clear removes
  // it from BOTH storages so a revoked token is fully gone from the
  // device state we control; server-side revocation (access_token_revoked)
  // remains the authoritative check regardless of what is cached here.
  //
  // FIX (iPhone installation blocker, round 24): a real device proved
  // this assumption wrong for at least some iOS versions — James's own
  // browser tab correctly showed his confirmed Trip (localStorage set
  // there), but the SEPARATE container the freshly-installed home-screen
  // icon launches from did not see it (screenshot evidence, 2026-09-29:
  // the icon opened straight to the synthetic-entry screen). Per
  // instruction, "do not assume localStorage transfers between them" —
  // a cookie is now ALSO written whenever the token is established, as a
  // genuinely INDEPENDENT third recovery path (never assumed to work
  // either — just tried, last, after both storages have already been
  // checked). Cookies are attached automatically by the browser to every
  // same-origin request regardless of which JS storage container reads
  // them, which is what makes this resilient even if a given device's
  // exact standalone-vs-Safari storage-sharing behavior is unknown or
  // inconsistent; worker.js's own requireGuestSession reads the SAME
  // cookie server-side as a second-line fallback. Still the exact same
  // opaque access_token everywhere — isolation, expiry and
  // server-side revocation are completely unchanged.
  // FIX (round 25): the original new-RegExp-from-a-string version of
  // this function was broken by exactly the double-escaping this
  // codebase has been bitten by before (the round-3 STORAGE_KEY /
  // round-15 outer-scope-const embedding lessons, same class, different
  // mechanism): this function's own source sits inside GUEST_APP_HTML's
  // OUTER template literal (pages.js), which processes a backslash as
  // an escape sequence ITSELF before this code is ever served — an
  // ordinary (non-tagged) template literal drops an unrecognized
  // single-backslash escape exactly like a string literal does (a
  // template literal containing "backslash-s-star", parsed once,
  // evaluates to just the two plain characters "s" and "*" — no
  // backslash survives). Writing that same escape twice in this file's
  // own source therefore reaches the BROWSER as only a SINGLE backslash
  // inside a STRING passed to the RegExp constructor — and a lone
  // backslash before a non-special character inside a JS STRING literal
  // (not a regex literal) is ALSO dropped by the string-literal escape
  // rules, leaving a bare "s" with no regex meaning at all. Codex
  // reproduced this directly by executing the real served script: with
  // document.cookie set to "other=1; marau_tok=test-token", getToken()
  // returned null. Fixed by removing the regex (and therefore the
  // backslash, and therefore the entire class of bug) rather than
  // trying to get the escaping "more correct" — trim() and
  // indexOf()/slice() need no escape sequences of any kind, so no
  // number of template-literal layers this code passes through can ever
  // corrupt them. (This comment itself deliberately avoids backtick
  // characters and doubled backslashes for the exact same reason —
  // either would risk corrupting the SAME outer template literal this
  // function's own code lives inside.)
  function getCookie(name) {
    var pairs = document.cookie.split(';');
    for (var i = 0; i < pairs.length; i++) {
      var trimmed = pairs[i].trim();
      if (trimmed.indexOf(name + '=') === 0) {
        return decodeURIComponent(trimmed.slice(name.length + 1));
      }
    }
    return null;
  }
  function setCookie(name, value) {
    document.cookie = name + '=' + encodeURIComponent(value) + '; path=/; max-age=31536000; samesite=lax; secure';
  }
  function clearCookie(name) {
    document.cookie = name + '=; path=/; max-age=0; samesite=lax; secure';
  }
  function getToken() {
    var m = location.hash.match(/tok=([^&]+)/);
    if (m) {
      try { sessionStorage.setItem('marau_tok', m[1]); } catch (e) {}
      try { localStorage.setItem('marau_tok', m[1]); } catch (e) {}
      try { setCookie('marau_tok', m[1]); } catch (e) {}
      return m[1];
    }
    try {
      var fromSession = sessionStorage.getItem('marau_tok');
      if (fromSession) return fromSession;
    } catch (e) {}
    try {
      var fromLocal = localStorage.getItem('marau_tok');
      if (fromLocal) return fromLocal;
    } catch (e) {}
    try {
      var fromCookie = getCookie('marau_tok');
      if (fromCookie) return fromCookie;
    } catch (e) {}
    return null;
  }
  function setToken(tok) {
    try { sessionStorage.setItem('marau_tok', tok); } catch (e) {}
    try { localStorage.setItem('marau_tok', tok); } catch (e) {}
    try { setCookie('marau_tok', tok); } catch (e) {}
    location.hash = 'tok=' + tok;
  }
  function clearToken() {
    try { sessionStorage.removeItem('marau_tok'); } catch (e) {}
    try { localStorage.removeItem('marau_tok'); } catch (e) {}
    try { clearCookie('marau_tok'); } catch (e) {}
    location.hash = '';
  }

  function authFetch(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers, { 'content-type': 'application/json' });
    var tok = getToken();
    if (tok) opts.headers['authorization'] = 'Bearer ' + tok;
    return fetch(API + path, opts).then(function (r) { return r.json().then(function (data) { return { ok: r.ok, status: r.status, data: data }; }); });
  }

  function showView(name) {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    var el = document.getElementById('view-' + name);
    if (el) el.classList.add('active');
    document.querySelectorAll('.tab').forEach(function (t) { t.setAttribute('aria-selected', t.dataset.view === name ? 'true' : 'false'); });
  }
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { showView(t.dataset.view); });
  });

  var STATUS_LABEL = { pending: 'Awaiting human confirmation', confirmed: 'Confirmed', confirmed_unallocated: 'Confirmed — vehicle pending assignment', declined: 'Declined', cancelled: 'Cancelled' };
  var STATUS_PILL = { pending: 'warn', confirmed: '', confirmed_unallocated: 'warn', declined: 'bad', cancelled: 'bad' };
  // formatFijiDateTime and selectDefaultBooking/ACTIVE_BOOKING_STATUSES
  // are spliced in above (EMBEDDED_CLIENT_IDEMPOTENCY) from fiji_time.js
  // and booking_selection.js — the SAME functions the server and the
  // test suite use, not a hand-duplicated copy that could drift.

  var selectedBookingId = null;

  function renderPickupCard(data) {
    var bookings = data.bookings || [];
    if (bookings.length === 0) {
      els.pickupCard.innerHTML = '<div class="panel"><p class="muted">No bookings yet on this trip.</p></div>';
      return;
    }
    var sorted = bookings.slice().sort(function (a, b) { return new Date(a.pickup_datetime) - new Date(b.pickup_datetime); });
    // FIX (fourth independent review, finding 2 — pickup accuracy): the
    // DEFAULT selection now uses the shared selectDefaultBooking rule
    // (soonest upcoming ACTIVE booking; never an old cancelled/declined
    // one) — the exact same rule the server's WhatsApp summary uses, so
    // the two can never disagree. Full history stays selectable via the
    // switcher below regardless of status.
    var defaultBooking = selectDefaultBooking(sorted, new Date().toISOString());
    var active = sorted.find(function (b) { return b.id === selectedBookingId; }) || defaultBooking || sorted[0];
    selectedBookingId = active.id;

    var fiji = formatFijiDateTime(active.pickup_datetime);
    var pillClass = STATUS_PILL[active.status] || 'warn';
    var statusLabel = STATUS_LABEL[active.status] || active.status;

    var switcher = '';
    if (sorted.length > 1) {
      // A real switcher (finding 5) — every other booking is individually
      // selectable, not just a "+N more" hint.
      switcher = '<div class="switcher" role="tablist" aria-label="Your bookings">' +
        sorted.map(function (b) {
          var f = formatFijiDateTime(b.pickup_datetime);
          var label = f.day + ' · ' + humanizeZoneLabel(b.pickup_zone) + ' → ' + humanizeZoneLabel(b.destination_zone);
          return '<button data-booking="' + b.id + '" aria-pressed="' + (b.id === active.id ? 'true' : 'false') + '">' + label + '</button>';
        }).join('') +
        '</div>';
    }

    // Mobile-copy finding 8: "Next pickup" implies a confirmed
    // arrangement — a still-pending booking hasn't actually been
    // confirmed by an operator yet, so it reads "Requested pickup"
    // instead until it reaches a confirmed status.
    var isConfirmedArrangement = active.status === 'confirmed' || active.status === 'confirmed_unallocated';
    var headingLabel = defaultBooking && active.id === defaultBooking.id
      ? (isConfirmedArrangement ? 'Next pickup' : 'Requested pickup')
      : 'Selected booking';

    els.pickupCard.innerHTML = switcher + '<article class="pickup panel" aria-label="Pickup">' +
      // Mobile-copy finding 1: a short, stable display reference — never
      // the full identifier, and never used for access anywhere.
      '<p class="sub">' + headingLabel + ' · booking ' + shortBookingReference(active.client_booking_ref) + '</p>' +
      '<p class="when">' + fiji.time + '<span class="small" style="opacity:.75;font-weight:600;margin-left:8px">Fiji time</span></p>' +
      '<p class="sub">' + fiji.day + '</p>' +
      '<div class="route">' +
        '<div class="stop fill"><span class="dot"></span><div><strong>' + humanizeZoneLabel(active.pickup_zone) + '</strong><span>Pickup</span></div></div>' +
        '<div class="stop"><span class="dot"></span><div><strong>' + humanizeZoneLabel(active.destination_zone) + '</strong><span>Destination</span></div></div>' +
      '</div>' +
      '<div class="facts">' +
        '<div class="fact">Vehicle<b>' + active.vehicle_type + '</b></div>' +
        '<div class="fact">Status<b>' + statusLabel + '</b></div>' +
      '</div>' +
      '<div class="pickup-actions"><button class="btn btn-onlagoon" id="changeBtn" type="button">Request a change</button></div>' +
      '</article>';

    if (sorted.length > 1) {
      els.pickupCard.querySelectorAll('[data-booking]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          selectedBookingId = Number(btn.dataset.booking);
          renderPickupCard(data);
        });
      });
    }

    document.getElementById('changeBtn').addEventListener('click', function () {
      // FIX (bounded round-5 correction, finding 3): the default must be
      // the ACTUAL Fiji wall-clock representation of the stored UTC
      // instant, not a raw slice of the UTC string itself — an unedited
      // submission must be a genuine no-op (normalizePickupDatetime is
      // idempotent on this value specifically because it IS the correct
      // Fiji-local reading, not a mislabelled UTC one).
      var newTime = prompt('New pickup date/time (YYYY-MM-DDTHH:MM), Fiji time:', toFijiWallClockInputValue(active.pickup_datetime));
      if (!newTime) return;
      authFetch('/preview/bookings/' + active.id + '/change-request', { method: 'POST', body: JSON.stringify({ requested_fields: { pickup_datetime: newTime } }) }).then(function (res) {
        toast(res.ok ? 'Change requested — awaiting operator approval.' : (res.data.error || 'Could not request a change.'));
      });
    });
    void pillClass;
  }

  var DEAL_REQUEST_PILL = { REQUESTED: 'warn', CONFIRMED: '', DECLINED: 'bad', WITHDRAWN: 'bad' };
  // Mobile-copy finding 5: "Requested (REQUESTED)" read as a raw enum
  // value echoed back at the guest. Subsequent confirmed/declined states
  // stay accurate, plain English — not reworded away from what actually
  // happened.
  var DEAL_REQUEST_STATUS_LABEL = { REQUESTED: 'Awaiting confirmation', CONFIRMED: 'Confirmed', DECLINED: 'Declined', WITHDRAWN: 'Withdrawn' };
  function renderDealRequests(dealRequests) {
    if (!dealRequests || dealRequests.length === 0) { els.dealRequestsPanel.style.display = 'none'; return; }
    els.dealRequestsPanel.style.display = 'block';
    // No internal offer_id/source_movement_id in guest-facing copy
    // (finding 5) — those stay in the underlying data for the assistant
    // and for ops, never rendered as visible text here.
    els.dealRequestsList.innerHTML = dealRequests.map(function (r) {
      var statusLabel = DEAL_REQUEST_STATUS_LABEL[r.status] || r.status;
      return '<div style="border-bottom:1px solid var(--line);padding:10px 0">' +
        '<p style="font-weight:700">' + humanizeZoneLabel(r.origin_zone) + ' → ' + humanizeZoneLabel(r.destination_zone) + ' <span class="pill ' + (DEAL_REQUEST_PILL[r.status] || '') + '">' + statusLabel + '</span></p>' +
        '<p class="small muted">Requested at ' + formatFijiCurrency(r.requested_price) + (r.current_price !== r.requested_price ? ' · now ' + formatFijiCurrency(r.current_price) : '') + ' · ' + humanizeVehicleClassLabel(r.vehicle_class) + '</p>' +
        '</div>';
    }).join('');
  }

  var pendingLinkOffer = null;

  function renderLinkOffer() {
    if (!pendingLinkOffer) { els.linkOfferPanel.style.display = 'none'; return; }
    els.linkOfferPanel.style.display = 'block';
    els.linkOfferPanel.innerHTML = '<h2>Link an earlier booking?</h2>' +
      '<p class="small muted" style="margin-top:6px">' + pendingLinkOffer.message + '</p>' +
      '<label for="linkCode">Verification code</label>' +
      '<input id="linkCode" inputmode="numeric" maxlength="6" placeholder="6-digit code">' +
      '<button class="btn btn-primary btn-block" id="linkConfirmBtn" type="button">Confirm link</button>' +
      '<p id="linkError" class="small" style="color:var(--hibiscus)"></p>';
    document.getElementById('linkConfirmBtn').addEventListener('click', function () {
      var code = document.getElementById('linkCode').value.trim();
      authFetch('/preview/trip/link', { method: 'POST', body: JSON.stringify({ link_request_id: pendingLinkOffer.link_request_id, verification_code: code }) }).then(function (res) {
        if (!res.ok) { document.getElementById('linkError').textContent = res.data.error || 'Could not link.'; return; }
        pendingLinkOffer = null;
        toast('Linked — your earlier bookings now show here too.');
        loadTrip();
      });
    });
  }

  // The verification code for a link request targeting THIS session only
  // ever appears here — GET /preview/trip/link-requests requires this
  // session's own access token, standing in for "only the real phone/
  // email owner receives it" without a real SMS/email provider.
  function loadLinkInbox() {
    authFetch('/preview/trip/link-requests').then(function (res) {
      if (!res.ok) { els.linkInboxPanel.style.display = 'none'; return; }
      var rows = res.data.link_requests || [];
      if (rows.length === 0) { els.linkInboxPanel.style.display = 'none'; return; }
      els.linkInboxPanel.style.display = 'block';
      els.linkInboxPanel.innerHTML = '<h2>A device is trying to link to this trip</h2>' +
        rows.map(function (r) {
          return '<p class="small muted" style="margin-top:6px">' + r.note + '</p>' +
            '<div class="link-code">' + r.verification_code + '</div>' +
            '<p class="small muted">Share this code with the other device, or revoke it if you don’t recognize this.</p>' +
            '<button class="btn btn-light btn-block" data-revoke-link="' + r.link_request_id + '" type="button">Revoke</button>';
        }).join('<hr style="border:none;border-top:1px solid var(--line);margin:12px 0">');
      els.linkInboxPanel.querySelectorAll('[data-revoke-link]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          authFetch('/preview/trip/link-requests/' + btn.dataset.revokeLink + '/revoke', { method: 'POST' }).then(function () { loadLinkInbox(); });
        });
      });
    });
  }

  function loadTrip() {
    if (!getToken()) {
      showView('start');
      return;
    }
    authFetch('/preview/trip').then(function (res) {
      if (!res.ok) { clearToken(); showView('start'); return; }
      renderPickupCard(res.data);
      renderDealRequests(res.data.deal_requests);
      renderLinkOffer();
      loadLinkInbox();
      showView('trip');
    });
  }

  els.bookingForm.addEventListener('submit', function (e) {
    e.preventDefault();
    els.startError.textContent = '';
    // Generated ONCE, before the first network attempt, and persisted —
    // a reload or a retried submit (timeout, double-click) reuses this
    // SAME reference AND the same attempt_secret instead of minting new
    // ones each time. attempt_secret (not timing) is what proves a
    // resubmit is the same attempt — see worker.js#handleCreateBooking.
    var clientBookingRef = getOrCreateClientBookingRef(sessionStorage, defaultRandomSource);
    var attemptSecret = getOrCreateAttemptSecret(sessionStorage, defaultRandomSource);
    var body = {
      client_booking_ref: clientBookingRef,
      attempt_secret: attemptSecret,
      guest_email: document.getElementById('f-email').value,
      guest_phone: document.getElementById('f-phone').value,
      whatsapp_available: document.getElementById('f-wa').checked,
      pickup_zone: document.getElementById('f-pickup').value,
      destination_zone: document.getElementById('f-dest').value,
      vehicle_type: document.getElementById('f-vehicle').value,
      quoted_amount: Number(document.getElementById('f-amount').value),
      pickup_datetime: document.getElementById('f-when').value,
    };
    var tok = getToken();
    var headers = { 'content-type': 'application/json' };
    if (tok) headers.authorization = 'Bearer ' + tok;
    fetch('/preview/bookings', { method: 'POST', headers: headers, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
      .then(function (res) {
        if (!res.ok) { els.startError.textContent = (res.data.details || [res.data.error]).join('; '); return; }
        clearClientBookingRef(sessionStorage); // this attempt is done — a genuinely NEW booking later gets a fresh key
        clearAttemptSecret(sessionStorage);
        if (res.data.access_token) {
          setToken(res.data.access_token);
        } else if (res.data.recovery_offer) {
          setToken(res.data.recovery_offer.access_token);
        }
        pendingLinkOffer = res.data.link_offer || null;
        toast('Saved. Reference ' + res.data.booking_reference + ' — ' + res.data.message);
        loadTrip();
      })
      .catch(function () { els.startError.textContent = 'Could not save — check your connection and try again.'; });
  });

  els.revokeBtn.addEventListener('click', function () {
    authFetch('/preview/trip/revoke', { method: 'POST' }).then(function () {
      clearToken();
      toast('Access revoked on this device.');
      showView('start');
    });
  });

  // Mobile-copy finding 5: after a real request, the button used to echo
  // the raw enum ("Requested (REQUESTED)"). A fresh request is always
  // REQUESTED, but stay accurate if an idempotent resubmit ever returns
  // an already-decided status instead.
  var DEAL_REQUEST_BUTTON_LABEL = { REQUESTED: 'Request received — awaiting confirmation.', CONFIRMED: 'Confirmed', DECLINED: 'Declined' };

  function renderDeals(deals) {
    if (deals.length === 0) { els.dealsList.innerHTML = '<p class="muted">No deals available right now.</p>'; return; }
    els.dealsList.innerHTML = deals.map(function (d) {
      var pctOff = d.standard_price ? Math.round((1 - d.total_price / d.standard_price) * 100) : null;
      // Mobile-copy finding 7: the deal's own expiry used to fall back to
      // the phone's own implicit local timezone via toLocaleString(). It
      // now always reads in explicit Fiji time, the same formatter used
      // everywhere else in this app.
      var expiry = formatFijiDateTime(d.expires_at);
      return '<div class="deal">' +
        '<div class="deal-top">' +
          '<div><div class="deal-kind">' + (d.label || 'Deal') + '</div><div class="deal-route">' + humanizeZoneLabel(d.origin_zone) + ' → ' + humanizeZoneLabel(d.destination_zone) + '</div></div>' +
          (pctOff ? '<div class="pct">' + pctOff + '%<small>off</small></div>' : '') +
        '</div>' +
        '<p class="why">' + d.conditions + '</p>' +
        '<div class="deal-foot">' +
          '<span class="price">' + (d.standard_price && d.standard_price !== d.total_price ? '<s>' + formatFijiCurrency(d.standard_price) + '</s>' : '') + '<b>' + formatFijiCurrency(d.total_price) + '</b></span>' +
          '<span class="meta">Expires ' + expiry.day + ' ' + expiry.time + '<span style="opacity:.75;font-weight:600">&nbsp;Fiji time</span></span>' +
        '</div>' +
        '<div style="padding:0 16px 16px"><button class="btn btn-primary btn-block" data-offer="' + d.offer_id + '">Request this deal</button>' +
        '<div class="small" data-handoff="' + d.offer_id + '" style="margin-top:8px"></div></div>' +
        '</div>';
    }).join('');
    els.dealsList.querySelectorAll('[data-offer]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var offerId = btn.dataset.offer;
        authFetch('/preview/deals/' + encodeURIComponent(offerId) + '/request', { method: 'POST' }).then(function (res) {
          if (!res.ok) { toast(res.data.error || 'Could not request this deal.'); return; }
          var target = els.dealsList.querySelector('[data-handoff="' + offerId + '"]');
          btn.disabled = true;
          btn.textContent = DEAL_REQUEST_BUTTON_LABEL[res.data.status] || res.data.status;
          renderMockWhatsApp(target, res.data.whatsapp_handoff);
        });
      });
    });
  }

  function loadDeals() {
    fetch('/preview/deals').then(function (r) { return r.json(); }).then(function (data) { renderDeals(data.deals || []); });
  }

  els.assistBtn.addEventListener('click', function () {
    authFetch('/preview/assist', { method: 'POST', body: JSON.stringify({ question: els.assistQ.value }) }).then(function (res) {
      if (!res.ok) { els.assistAnswer.textContent = res.data.error || 'Could not reach the assistant.'; return; }
      els.aiDisclosure.textContent = res.data.disclosure;
      var offersHtml = (res.data.ranked_offers || []).slice(0, 3).map(function (o) {
        return '<li>' + o.origin_zone + ' → ' + o.destination_zone + ' — $' + Number(o.price).toFixed(2) + ' (' + o.reason + ')</li>';
      }).join('');
      els.assistAnswer.innerHTML = '<p>' + res.data.answer + '</p>' + (offersHtml ? '<ul style="margin:8px 0 0;padding-left:1.1em">' + offersHtml + '</ul>' : '');
    });
  });

  els.humanHandoffBtn.addEventListener('click', function () {
    // FIX (fourth independent review, finding 2): send the CURRENTLY
    // SELECTED booking (the switcher's own state) so the WhatsApp summary
    // always matches what the guest is actually looking at, rather than
    // always the server's own independent default.
    var payload = selectedBookingId ? JSON.stringify({ booking_id: selectedBookingId }) : JSON.stringify({});
    authFetch('/preview/trip/whatsapp-handoff', { method: 'POST', body: payload }).then(function (res) {
      if (!res.ok) { toast(res.data.error || 'Could not compose a message.'); return; }
      renderMockWhatsApp(els.tripHandoffPanel, res.data.whatsapp_handoff);
    });
  });

  loadTrip();
  loadDeals();
})();
</script>
</body>
</html>`;

export const ADMIN_APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0F5E63">
<title>Marau ops (preview)</title>
${FONT_LINK}
${SHARED_STYLE}
</head>
<body>
<div class="app" style="max-width:640px;padding-bottom:24px">
  <header class="top">
    <div class="brand"><span class="brand-mark" aria-hidden="true"></span>Marau ops<span class="brand-sub"> console</span></div>
    <span class="preview-pill">Test only</span>
  </header>
  <div class="banner">Authenticated test interface. Confirming here is the ONLY action that ever confirms anything — WhatsApp is never sent by this system.</div>

  <div class="panel" id="loginPanel">
    <h2>Ops test token</h2>
    <input id="tokenInput" placeholder="paste the test admin token" style="margin-top:8px">
    <button class="btn btn-primary btn-block" id="loginBtn" type="button">Use this token</button>
  </div>

  <div id="consolePanel" style="display:none">
    <div class="panel">
      <h2>Deal requests awaiting a decision</h2>
      <div id="dealRequests" style="margin-top:8px"></div>
    </div>
    <div class="panel">
      <h2>Bookings awaiting confirmation</h2>
      <div id="bookings" style="margin-top:8px"></div>
    </div>
    <div class="panel">
      <h2>Change requests awaiting a decision</h2>
      <div id="changeRequests" style="margin-top:8px"></div>
    </div>
  </div>
</div>
<div class="toast" id="toast"></div>

<script>
(function () {
  var token = null;
  var els = {};
  ['loginPanel','consolePanel','tokenInput','loginBtn','dealRequests','bookings','changeRequests','toast'].forEach(function (id) { els[id] = document.getElementById(id); });

  function toast(msg) { els.toast.textContent = msg; els.toast.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { els.toast.classList.remove('show'); }, 2600); }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers, { 'content-type': 'application/json', authorization: 'Bearer ' + token });
    return fetch(path, opts).then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); });
  }

  els.loginBtn.addEventListener('click', function () {
    token = els.tokenInput.value.trim();
    if (!token) return;
    try { sessionStorage.setItem('marau_admin_tok', token); } catch (e) {}
    els.loginPanel.style.display = 'none';
    els.consolePanel.style.display = 'block';
    refreshAll();
  });

  function refreshAll() { loadDealRequests(); loadBookings(); loadChangeRequests(); }

  function loadDealRequests() {
    api('/preview/admin/deal-requests').then(function (res) {
      var rows = (res.data.deal_requests || []).filter(function (r) { return r.status === 'REQUESTED'; });
      if (rows.length === 0) { els.dealRequests.innerHTML = '<p class="muted small">None pending.</p>'; return; }
      els.dealRequests.innerHTML = rows.map(function (r) {
        return '<div style="border-bottom:1px solid var(--line);padding:10px 0">' +
          '<p><strong>' + r.origin_zone + ' → ' + r.destination_zone + '</strong> · ' + r.vehicle_class + ' · $' + (r.smart_match_price || r.standard_price) + '</p>' +
          '<p class="small muted">Guest: ' + r.guest_email + ' / ' + r.guest_phone + ' · request ' + r.request_id + ' · offer ' + r.offer_id + '</p>' +
          '<div class="row"><button class="btn btn-primary" data-confirm="' + r.request_id + '">Confirm</button><button class="btn btn-light" data-decline="' + r.request_id + '">Decline</button></div>' +
          '</div>';
      }).join('');
      els.dealRequests.querySelectorAll('[data-confirm]').forEach(function (b) {
        b.addEventListener('click', function () {
          api('/preview/admin/deal-requests/' + b.dataset.confirm + '/confirm', { method: 'POST' }).then(function (res) {
            toast(res.ok ? 'Confirmed.' : (res.data.error || 'Could not confirm.'));
            loadDealRequests();
          });
        });
      });
      els.dealRequests.querySelectorAll('[data-decline]').forEach(function (b) {
        b.addEventListener('click', function () {
          api('/preview/admin/deal-requests/' + b.dataset.decline + '/decline', { method: 'POST' }).then(function () { loadDealRequests(); });
        });
      });
    });
  }

  function loadBookings() {
    api('/preview/admin/bookings').then(function (res) {
      var rows = (res.data.bookings || []).filter(function (b) { return b.status === 'pending'; });
      if (rows.length === 0) { els.bookings.innerHTML = '<p class="muted small">None pending.</p>'; return; }
      els.bookings.innerHTML = rows.map(function (b) {
        return '<div style="border-bottom:1px solid var(--line);padding:10px 0">' +
          '<p><strong>' + b.client_booking_ref + '</strong> · ' + b.pickup_zone + ' → ' + b.destination_zone + '</p>' +
          '<p class="small muted">' + b.guest_email + ' / ' + b.guest_phone + '</p>' +
          '<div class="row"><button class="btn btn-primary" data-confirm="' + b.id + '">Confirm</button><button class="btn btn-light" data-decline="' + b.id + '">Decline</button></div>' +
          '</div>';
      }).join('');
      els.bookings.querySelectorAll('[data-confirm]').forEach(function (b) { b.addEventListener('click', function () { api('/preview/admin/bookings/' + b.dataset.confirm + '/confirm', { method: 'POST' }).then(function (res) { toast(res.ok ? ('Status: ' + res.data.status) : (res.data.error || 'Could not confirm.')); loadBookings(); }); }); });
      els.bookings.querySelectorAll('[data-decline]').forEach(function (b) { b.addEventListener('click', function () { api('/preview/admin/bookings/' + b.dataset.decline + '/decline', { method: 'POST' }).then(loadBookings); }); });
    });
  }

  function loadChangeRequests() {
    api('/preview/admin/change-requests').then(function (res) {
      var rows = (res.data.change_requests || []).filter(function (r) { return r.status === 'PENDING'; });
      if (rows.length === 0) { els.changeRequests.innerHTML = '<p class="muted small">None pending.</p>'; return; }
      els.changeRequests.innerHTML = rows.map(function (r) {
        return '<div style="border-bottom:1px solid var(--line);padding:10px 0">' +
          '<p><strong>' + r.client_booking_ref + '</strong></p>' +
          '<p class="small muted">Currently: ' + r.current_pickup_zone + ' → ' + r.current_destination_zone + ' at ' + r.current_pickup_datetime + '</p>' +
          '<p class="small">Requested: <code>' + r.requested_fields_json + '</code></p>' +
          '<div class="row"><button class="btn btn-primary" data-approve="' + r.change_request_id + '">Approve</button><button class="btn btn-light" data-reject="' + r.change_request_id + '">Reject</button></div>' +
          '</div>';
      }).join('');
      els.changeRequests.querySelectorAll('[data-approve]').forEach(function (b) { b.addEventListener('click', function () { api('/preview/admin/change-requests/' + b.dataset.approve + '/approve', { method: 'POST' }).then(loadChangeRequests); }); });
      els.changeRequests.querySelectorAll('[data-reject]').forEach(function (b) { b.addEventListener('click', function () { api('/preview/admin/change-requests/' + b.dataset.reject + '/reject', { method: 'POST' }).then(loadChangeRequests); }); });
    });
  }

  try {
    var saved = sessionStorage.getItem('marau_admin_tok');
    if (saved) { els.tokenInput.value = saved; }
  } catch (e) {}
})();
</script>
</body>
</html>`;
