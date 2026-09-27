/* Marau Stage 1 (PREVIEW ONLY) — guest app + ops console, served as plain
 * HTML/CSS/JS strings from the same Worker (no separate build step, no
 * separate Pages project needed for this stage). Visual language is
 * carried over from marau-app-prototype.html (the approved design
 * reference), rewired from localStorage-simulated data to the real
 * /preview/* API. No Lagi reference anywhere — Lagi is excluded from this
 * stage per the mission. WhatsApp only ever appears as a plain link the
 * guest or operator clicks themselves; nothing here sends anything.
 */

const SHARED_STYLE = `
<style>
  :root {
    --ink:#152A2E; --muted:#56696C; --paper:#F2F6F5; --surface:#FFFFFF;
    --lagoon:#0F5E63; --lagoon-ink:#FFFFFF; --shallows:#D3EBE6; --line:#D7E2E0;
    --hibiscus:#C4304A; --frangipani:#F3C33C; --frang-ink:#3A2D00;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink:#E4EFED; --muted:#9BB1B3; --paper:#0C1819; --surface:#132527;
      --lagoon:#4DB0AA; --lagoon-ink:#06201F; --shallows:#1A3739; --line:#243B3D;
      --hibiscus:#F0687E; --frangipani:#F3C33C; --frang-ink:#2A2000;
    }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 16px 16px 90px; }
  h1 { font-size: 20px; margin: 4px 0 12px; }
  h2 { font-size: 15px; margin: 0 0 8px; }
  p { line-height: 1.45; }
  .muted { color: var(--muted); }
  .small { font-size: 13px; }
  .panel { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 16px; margin-bottom: 14px; }
  .pill { display:inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--shallows); color: var(--lagoon); }
  .pill.warn { background: #FCEBCD; color: var(--frang-ink); }
  .pill.bad { background: #FBE1E6; color: var(--hibiscus); }
  label { display:block; font-size: 13px; font-weight: 600; margin: 10px 0 4px; }
  input, select { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--paper); color: var(--ink); font-size: 15px; }
  .btn { display:inline-block; text-align:center; padding: 11px 16px; border-radius: 12px; border: none; font-weight: 700; font-size: 15px; cursor: pointer; text-decoration:none; }
  .btn-primary { background: var(--lagoon); color: var(--lagoon-ink); }
  .btn-light { background: var(--shallows); color: var(--lagoon); }
  .btn-block { display:block; width:100%; margin-top: 10px; }
  .row { display:flex; gap:8px; }
  .row > * { flex:1; }
  .tabs { position: fixed; left:0; right:0; bottom:0; display:flex; background: var(--surface); border-top: 1px solid var(--line); padding: 6px max(8px, env(safe-area-inset-left)) calc(6px + env(safe-area-inset-bottom)); }
  .tab { flex:1; border:none; background:none; padding: 8px 4px; font-size: 12px; font-weight:700; color: var(--muted); cursor:pointer; }
  .tab[aria-selected="true"] { color: var(--lagoon); }
  .view { display:none; }
  .view.active { display:block; }
  .deal-card { border:1px solid var(--line); border-radius: 12px; padding: 12px; margin-bottom: 10px; }
  .deal-card .price { font-size: 18px; font-weight: 800; }
  .deal-card .was { text-decoration: line-through; color: var(--muted); font-size: 13px; margin-left: 6px; }
  .toast { position: fixed; left: 16px; right: 16px; bottom: 70px; background: var(--ink); color: var(--paper); padding: 10px 14px; border-radius: 10px; text-align:center; opacity:0; transform: translateY(8px); transition: .2s; pointer-events:none; }
  .toast.show { opacity: 1; transform: translateY(0); }
  a.wa-link { word-break: break-word; }
  table { width:100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align:left; padding: 6px 4px; border-bottom: 1px solid var(--line); vertical-align: top; }
  code { font-size: 12px; background: var(--shallows); padding: 1px 5px; border-radius: 6px; }
  .banner { background: var(--frangipani); color: var(--frang-ink); border-radius: 10px; padding: 8px 12px; font-size: 13px; font-weight:600; margin-bottom: 12px; }
</style>`;

export const GUEST_APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Marau — your trip</title>
${SHARED_STYLE}
</head>
<body>
<div class="wrap">
  <h1>Marau <span class="muted small">— PREVIEW / DEMONSTRATION DATA</span></h1>
  <div class="banner">This is an isolated preview build. Nothing here is a real booking, message or payment.</div>

  <section id="view-start" class="view">
    <div class="panel">
      <h2>Start a trip</h2>
      <p class="small muted">Save a booking request. You'll get secure access to Marau immediately — no need to wait for confirmation.</p>
      <form id="bookingForm">
        <label for="f-email">Email</label>
        <input id="f-email" type="email" required autocomplete="email">
        <label for="f-phone">Mobile number</label>
        <input id="f-phone" type="tel" required autocomplete="tel">
        <label><input id="f-wa" type="checkbox" style="width:auto;display:inline;vertical-align:middle;margin-right:6px"> This number can receive WhatsApp</label>
        <div class="row">
          <div><label for="f-pickup">Pickup zone</label><input id="f-pickup" required value="Nadi Airport"></div>
          <div><label for="f-dest">Destination zone</label><input id="f-dest" required value="Denarau"></div>
        </div>
        <div class="row">
          <div><label for="f-vehicle">Vehicle type</label><input id="f-vehicle" required value="Sedan"></div>
          <div><label for="f-amount">Quoted amount</label><input id="f-amount" type="number" min="0" step="0.01" required value="45"></div>
        </div>
        <label for="f-when">Pickup date & time</label>
        <input id="f-when" type="datetime-local" required>
        <button class="btn btn-primary btn-block" type="submit">Save booking request</button>
      </form>
      <p id="startError" class="small" style="color:var(--hibiscus)"></p>
    </div>
  </section>

  <section id="view-trip" class="view">
    <div class="panel" id="tripPanel"><p class="muted">Loading your trip…</p></div>
    <div class="panel">
      <h2>Ask Marau</h2>
      <p class="small muted" id="aiDisclosure"></p>
      <input id="assistQ" placeholder="e.g. when is my pickup?">
      <button class="btn btn-light btn-block" id="assistBtn" type="button">Ask</button>
      <div id="assistAnswer" class="small" style="margin-top:8px"></div>
      <a class="btn btn-light btn-block" id="humanHandoffLink" href="#" target="_blank" rel="noopener">Talk to our team on WhatsApp</a>
    </div>
    <button class="btn btn-light btn-block" id="revokeBtn" type="button">Revoke this device's access</button>
  </section>

  <section id="view-deals" class="view">
    <div class="panel">
      <h2>Deals</h2>
      <p class="small muted">Open browsing — every current deal is shown here, demonstration data only.</p>
      <div id="dealsList"><p class="muted">Loading deals…</p></div>
    </div>
  </section>
</div>

<nav class="tabs" role="tablist">
  <button class="tab" data-view="trip" aria-selected="true">Trip</button>
  <button class="tab" data-view="deals" aria-selected="false">Deals</button>
</nav>
<div class="toast" id="toast"></div>

<script>
(function () {
  var API = '';
  var els = {};
  ['bookingForm','startError','tripPanel','dealsList','assistQ','assistAnswer','assistBtn','revokeBtn','humanHandoffLink','aiDisclosure','toast'].forEach(function(id){ els[id] = document.getElementById(id); });

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { els.toast.classList.remove('show'); }, 2600);
  }

  function getToken() {
    var m = location.hash.match(/tok=([^&]+)/);
    if (m) { try { sessionStorage.setItem('marau_tok', m[1]); } catch (e) {} return m[1]; }
    try { return sessionStorage.getItem('marau_tok'); } catch (e) { return null; }
  }
  function setToken(tok) {
    try { sessionStorage.setItem('marau_tok', tok); } catch (e) {}
    location.hash = 'tok=' + tok;
  }
  function clearToken() {
    try { sessionStorage.removeItem('marau_tok'); } catch (e) {}
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

  function renderTrip(data) {
    var bookings = data.bookings || [];
    if (bookings.length === 0) {
      els.tripPanel.innerHTML = '<p class="muted">No bookings yet on this trip.</p>';
      return;
    }
    var sorted = bookings.slice().sort(function (a, b) { return new Date(a.pickup_datetime) - new Date(b.pickup_datetime); });
    var html = '';
    sorted.forEach(function (b, i) {
      var pillClass = b.status === 'confirmed' ? '' : b.status === 'declined' || b.status === 'cancelled' ? 'bad' : 'warn';
      var label = b.status === 'pending' ? 'Awaiting human confirmation' : b.status;
      html += '<div style="' + (i > 0 ? 'margin-top:14px;padding-top:14px;border-top:1px solid var(--line)' : '') + '">' +
        '<p class="sub muted small">Booking ' + b.client_booking_ref + '</p>' +
        '<p style="font-weight:700;font-size:16px">' + b.pickup_zone + ' → ' + b.destination_zone + '</p>' +
        '<p class="small muted">' + new Date(b.pickup_datetime).toLocaleString() + ' · ' + b.vehicle_type + '</p>' +
        '<span class="pill ' + pillClass + '">' + label + '</span>' +
        '</div>';
    });
    els.tripPanel.innerHTML = html;
  }

  function loadTrip() {
    if (!getToken()) {
      showView('start');
      return;
    }
    authFetch('/preview/trip').then(function (res) {
      if (!res.ok) { clearToken(); showView('start'); return; }
      renderTrip(res.data);
      showView('trip');
    });
  }

  els.bookingForm.addEventListener('submit', function (e) {
    e.preventDefault();
    els.startError.textContent = '';
    var body = {
      guest_email: document.getElementById('f-email').value,
      guest_phone: document.getElementById('f-phone').value,
      whatsapp_available: document.getElementById('f-wa').checked,
      pickup_zone: document.getElementById('f-pickup').value,
      destination_zone: document.getElementById('f-dest').value,
      vehicle_type: document.getElementById('f-vehicle').value,
      quoted_amount: Number(document.getElementById('f-amount').value),
      pickup_datetime: document.getElementById('f-when').value,
    };
    fetch('/preview/bookings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
      .then(function (res) {
        if (!res.ok) { els.startError.textContent = (res.data.details || [res.data.error]).join('; '); return; }
        setToken(res.data.access_token);
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

  function renderDeals(deals) {
    if (deals.length === 0) { els.dealsList.innerHTML = '<p class="muted">No deals available right now.</p>'; return; }
    els.dealsList.innerHTML = deals.map(function (d) {
      return '<div class="deal-card">' +
        '<p class="small muted">' + (d.label || '') + '</p>' +
        '<p style="font-weight:700">' + d.origin_zone + ' → ' + d.destination_zone + '</p>' +
        '<p class="price">$' + d.total_price.toFixed(2) + (d.standard_price && d.standard_price !== d.total_price ? '<span class="was">$' + d.standard_price.toFixed(2) + '</span>' : '') + '</p>' +
        '<p class="small muted">' + d.conditions + '</p>' +
        '<p class="small muted">Expires ' + new Date(d.expires_at).toLocaleString() + '</p>' +
        '<button class="btn btn-primary btn-block" data-offer="' + d.offer_id + '">Request this deal</button>' +
        '<div class="small" data-handoff="' + d.offer_id + '" style="margin-top:8px"></div>' +
        '</div>';
    }).join('');
    els.dealsList.querySelectorAll('[data-offer]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var offerId = btn.dataset.offer;
        authFetch('/preview/deals/' + encodeURIComponent(offerId) + '/request', { method: 'POST' }).then(function (res) {
          if (!res.ok) { toast(res.data.error || 'Could not request this deal.'); return; }
          var handoff = res.data.whatsapp_handoff;
          var target = els.dealsList.querySelector('[data-handoff="' + offerId + '"]');
          btn.disabled = true;
          btn.textContent = 'Requested (' + res.data.status + ')';
          if (target && handoff) {
            target.innerHTML = '<p class="muted">' + handoff.note + '</p>' +
              '<a class="btn btn-light btn-block wa-link" target="_blank" rel="noopener" href="https://wa.me/' + handoff.to.replace(/[^0-9]/g, '') + '?text=' + encodeURIComponent(handoff.message) + '">Open WhatsApp to reach our team</a>';
          }
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
      els.assistAnswer.innerHTML = '<p>' + res.data.answer + '</p>' + (offersHtml ? '<ul>' + offersHtml + '</ul>' : '');
    });
  });

  els.humanHandoffLink.addEventListener('click', function (e) {
    e.preventDefault();
    toast('Use "Request this deal" or the assistant to reach our team with your booking details.');
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
<title>Marau ops (preview)</title>
${SHARED_STYLE}
</head>
<body>
<div class="wrap" style="padding-bottom:24px">
  <h1>Marau ops console <span class="muted small">— PREVIEW / TEST ONLY</span></h1>
  <div class="banner">Authenticated test interface. Confirming here is the ONLY action that ever confirms anything — WhatsApp is never sent by this system.</div>

  <div class="panel" id="loginPanel">
    <h2>Ops test token</h2>
    <input id="tokenInput" placeholder="paste the test admin token">
    <button class="btn btn-primary btn-block" id="loginBtn" type="button">Use this token</button>
  </div>

  <div id="consolePanel" style="display:none">
    <div class="panel">
      <h2>Deal requests awaiting a decision</h2>
      <div id="dealRequests"></div>
    </div>
    <div class="panel">
      <h2>Bookings awaiting confirmation</h2>
      <div id="bookings"></div>
    </div>
    <div class="panel">
      <h2>Change requests awaiting a decision</h2>
      <div id="changeRequests"></div>
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
      els.bookings.querySelectorAll('[data-confirm]').forEach(function (b) { b.addEventListener('click', function () { api('/preview/admin/bookings/' + b.dataset.confirm + '/confirm', { method: 'POST' }).then(loadBookings); }); });
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
