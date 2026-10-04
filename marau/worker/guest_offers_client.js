/* Marau (PREVIEW/TEST ONLY) - guest-facing client for experience offers, the referral card, fare breakdown and contact
 * preferences. Written as ONE self-contained function so pages.js can splice its own source into the served <script>
 * (exactly like client_idempotency.js), which means the browser runs the very code test/marau_guest_offers_client.test.mjs
 * exercises, and no backslash/backtick lives inside the served template literal.
 *
 * Self-contained on purpose: nothing from outer scope is referenced from inside the body - everything arrives through
 * `deps`. Every piece of server data is passed through esc() before it touches innerHTML.
 */
export function createOffersClient(deps) {
  var authFetch = deps.authFetch;
  // A failed network call must never leave a control disabled or the guest wondering what happened.
  var OFFLINE = 'No connection - nothing was sent. Please try again.';
  var toast = deps.toast;
  var renderMockWhatsApp = deps.renderMockWhatsApp;
  var formatFijiCurrency = deps.formatFijiCurrency;
  var els = deps.els;
  var storage = deps.storage; // sessionStorage-like: getItem/setItem
  var share = deps.share; // optional navigator.share wrapper
  var copyText = deps.copyText; // (text) => Promise
  var onChanged = deps.onChanged || function () {};

  function esc(value) {
    return String(value == null ? '' : value)
      .split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;').split("'").join('&#39;');
  }

  var STATE_LABEL = { open: 'Open', sold_out: 'Sold out', deadline_passed: 'Booking closed' };
  var REQUEST_LABEL = {
    requested: 'Awaiting confirmation', confirmed: 'Confirmed by our team', declined: 'Not available', cancelled_by_guest: 'Cancelled by you',
    cancelled_by_staff: 'Cancelled by our team', expired: 'Request lapsed - you can request again', fulfilled: 'Completed',
  };
  var REQUEST_PILL = { requested: 'warn', confirmed: '', declined: 'bad', cancelled_by_guest: 'bad', cancelled_by_staff: 'bad', expired: 'bad', fulfilled: '' };
  var CREDIT_LABEL = { pending: 'Pending - waiting for your friend\'s experience to be completed', earned: 'Earned - ready for your return transfer', applied: 'Applied to your return transfer', reversed: 'Reversed' };

  function fiji(o) { return o.starts_at_fiji ? o.starts_at_fiji.day + ' at ' + o.starts_at_fiji.time + ' Fiji time' : ''; }

  function requestRefFor(offerId) {
    // One retry key per offer for this browser session: a double-tap or reload re-sends the SAME request, never a second.
    var key = 'marau_offer_ref_' + offerId;
    var ref = storage && storage.getItem(key);
    if (!ref) {
      ref = 'orq_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      if (storage) storage.setItem(key, ref);
    }
    return ref;
  }

  function placesOptions(max) {
    var out = '';
    for (var i = 1; i <= Math.min(max, 8); i += 1) out += '<option value="' + i + '">' + i + (i === 1 ? ' place' : ' places') + '</option>';
    return out;
  }

  function offerCardHtml(o) {
    var inclusions = (o.inclusions || []).map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('');
    var pills = '<span class="pill ' + (o.state === 'open' ? '' : 'bad') + '">' + esc(STATE_LABEL[o.state] || o.state) + '</span>';
    if (o.suggested_for_you) pills += ' <span class="pill">Suggested for your stay</span>';
    (o.in_editions || []).forEach(function (e) { pills += ' <span class="pill">' + (e === 'morning' ? 'Morning deal' : 'Afternoon deal') + '</span>'; });
    var action = '';
    if (o.my_request) {
      action = '<p class="small" style="margin-top:10px"><strong>Your request ' + esc(o.my_request.reference) + '</strong> - ' + esc(REQUEST_LABEL[o.my_request.status] || o.my_request.status) + ' (' + esc(o.my_request.places) + (o.my_request.places === 1 ? ' place' : ' places') + ', ' + esc(formatFijiCurrency(o.my_request.total_fjd)) + ' total)</p>';
    } else if (o.state === 'open') {
      action = '<div class="row" style="margin-top:10px;align-items:flex-end"><div><label>Places</label><select data-places="' + esc(o.offer_id) + '">' + placesOptions(o.places_left) + '</select></div>' +
        '<div><button class="btn btn-primary btn-block" style="margin-top:0" data-request-offer="' + esc(o.offer_id) + '" type="button">Request</button></div></div>' +
        '<p class="small muted" style="margin-top:6px">Nothing is charged. A member of our team will confirm with you personally.</p>';
    }
    return '<article class="deal" data-offer-card="' + esc(o.offer_id) + '">' +
      '<div class="deal-top"><div><div class="deal-kind">' + esc(o.supplier && o.supplier.name) + (o.supplier && o.supplier.verified ? ' - verified' : '') + '</div>' +
      '<div class="deal-route">' + esc(o.title) + '</div><p class="small muted" style="margin-top:2px">' + esc(o.location) + ' - ' + esc(fiji(o)) + '</p></div></div>' +
      '<div style="padding:0 16px"><p class="small" style="margin:0 0 6px">' + pills + '</p>' +
      (o.description ? '<p class="small" style="margin:0 0 6px">' + esc(o.description) + '</p>' : '') +
      '<ul class="small" style="margin:0 0 6px 18px;padding:0">' + inclusions + '</ul></div>' +
      '<div class="deal-foot"><span class="price"><b>' + esc(formatFijiCurrency(o.price_per_place_fjd)) + '</b> <span class="small muted">per place, all inclusive</span></span>' +
      '<span class="meta">' + esc(o.places_left) + ' of ' + esc(o.capacity) + ' places left</span></div>' +
      '<div style="padding:0 16px 16px">' + action + '<div class="small" data-offer-handoff="' + esc(o.offer_id) + '"></div></div></article>';
  }

  function requestRowHtml(r) {
    var actions = '';
    if (r.status === 'requested' || r.status === 'confirmed') actions += '<button class="btn btn-light" data-cancel-request="' + esc(r.request_id) + '" type="button">Cancel</button> ';
    actions += '<button class="btn btn-light" data-handoff-request="' + esc(r.request_id) + '" type="button">Message the team on WhatsApp</button>';
    return '<div style="border-bottom:1px solid var(--line);padding:10px 0">' +
      '<p style="font-weight:700">' + esc(r.title) + ' <span class="pill ' + (REQUEST_PILL[r.status] || '') + '">' + esc(REQUEST_LABEL[r.status] || r.status) + '</span></p>' +
      '<p class="small muted">' + esc(r.reference) + ' - ' + esc(r.location) + ' - ' + esc(fiji(r)) + ' - ' + esc(r.places) + (r.places === 1 ? ' place' : ' places') + ' - ' + esc(formatFijiCurrency(r.total_fjd)) + ' total</p>' +
      '<div style="margin-top:6px">' + actions + '</div><div class="small" data-request-handoff="' + esc(r.request_id) + '"></div></div>';
  }

  // Three SEPARATE numbers: the original fare, the credit, and what is now due. Quote history and payout are untouched.
  function fareHtml(fare) {
    if (!fare || !fare.referral_credit_fjd) return '';
    return '<div class="panel" style="margin:10px 0 0;box-shadow:none"><p class="small muted" style="margin:0 0 4px">Your return transfer fare</p>' +
      '<p class="small" style="margin:0">Original fare <b style="float:right">' + esc(formatFijiCurrency(fare.original_fare_fjd)) + '</b></p>' +
      '<p class="small" style="margin:4px 0 0">Referral credit <b style="float:right">- ' + esc(formatFijiCurrency(fare.referral_credit_fjd)) + '</b></p>' +
      '<p style="margin:6px 0 0;font-weight:700">Amount due <span style="float:right">' + esc(formatFijiCurrency(fare.amount_due_fjd)) + '</span></p>' +
      '<p class="small muted" style="margin:6px 0 0">The credit is funded by Marau. Your original quote and your driver\'s payout are unchanged.' +
      (fare.adjustment_status === 'reversal_pending_staff' ? ' Our team is reviewing this credit and will contact you.' : '') + '</p></div>';
  }

  function referralHtml(ref) {
    var credits = (ref.credits || []).map(function (c) {
      return '<p class="small" style="margin:4px 0"><span class="pill ' + (c.status === 'reversed' ? 'bad' : '') + '">' + esc(c.status) + '</span> ' + esc(formatFijiCurrency(c.amount_fjd)) + ' - ' + esc(CREDIT_LABEL[c.status] || '') + (c.needs_staff_attention ? ' (our team will be in touch)' : '') + '</p>';
    }).join('');
    var policy = ref.policy && ref.policy.rewards_active
      ? '<p class="small">When a friend you invite ' + (ref.policy.requires_payment ? 'books, pays for and completes' : 'completes') + ' an experience, you earn ' + esc(formatFijiCurrency(ref.policy.reward_fjd)) + ' off your return transfer (up to ' + esc(formatFijiCurrency(ref.policy.cap_fjd)) + ' in total).</p>'
      : '<p class="small muted">' + esc(ref.policy && ref.policy.message) + '</p>';
    return '<h2>Invite a friend</h2>' + policy +
      '<p class="small muted" style="margin-top:6px">This link is safe to share. It shows only that a friend invited them - never your trip, name or contact details.</p>' +
      '<input id="refLink" readonly value="' + esc(ref.share_url) + '" aria-label="Your invitation link" style="margin-top:8px">' +
      '<div class="row" style="margin-top:8px"><button class="btn btn-light" id="refCopy" type="button">Copy link</button><button class="btn btn-primary" id="refShare" type="button">Share</button></div>' +
      '<div style="text-align:center;margin-top:12px"><img src="' + esc(ref.qr_svg_url) + '" alt="QR code for your invitation link" width="168" height="168" style="background:#fff;border-radius:8px"></div>' +
      '<p class="small muted" style="margin-top:8px">' + esc(ref.friends_joined) + (ref.friends_joined === 1 ? ' friend has' : ' friends have') + ' joined through your link.</p>' + credits;
  }

  function contactHtml(c) {
    return '<h2>How we reach you</h2>' +
      '<label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="ctWa" style="width:auto;min-height:auto"' + (c.whatsapp_available ? ' checked' : '') + '> This number can receive WhatsApp</label>' +
      '<p class="small muted" style="margin-top:4px">' + (c.whatsapp_available === false ? 'No problem - we will email you instead.' : 'If WhatsApp is not available we will email you.') + '</p>' +
      '<label style="display:flex;gap:8px;align-items:center;font-weight:500;margin-top:12px"><input type="checkbox" id="ctMk" style="width:auto;min-height:auto"' + (c.marketing_consent === 'granted' ? ' checked' : '') + '> Send me occasional deals (optional)</label>' +
      '<p class="small muted" style="margin-top:4px">' + esc(c.essential_messages) + '</p>' +
      (c.contact_person ? '<p class="small" style="margin-top:8px">Your contact at Marau: <b>' + esc(c.contact_person) + '</b></p>' : '');
  }

  function editionsHtml(data, offersById) {
    var ed = data.editions || {};
    function section(slot, label) {
      var ids = ed[slot] || [];
      if (!ids.length) return '';
      var live = ed.current_slot === slot;
      return '<h2 style="margin-top:14px">' + label + (live ? ' <span class="pill">Live now</span>' : '') + '</h2>' +
        ids.map(function (id) { return offersById[id] ? offerCardHtml(offersById[id]) : ''; }).join('');
    }
    var html = section('morning', 'Morning deals') + section('afternoon', 'Afternoon deals');
    if (!html && ed.next_slot) html = '<p class="small muted">The ' + esc(ed.next_slot) + ' deals go live later today (Fiji time). Everything is still open to browse below.</p>';
    return html;
  }

  // -------------------------------------------------------------------- wiring

  function bindOfferCards(root, reload) {
    root.querySelectorAll('[data-request-offer]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var offerId = btn.getAttribute('data-request-offer');
        var select = root.querySelector('[data-places="' + offerId + '"]');
        var places = select ? Number(select.value) : 1;
        btn.disabled = true;
        authFetch('/preview/offers/' + encodeURIComponent(offerId) + '/request', { method: 'POST', body: JSON.stringify({ places: places, client_request_ref: requestRefFor(offerId) }) }).then(function (res) {
          if (!res.ok) { btn.disabled = false; toast((res.data && (res.data.detail || res.data.error)) || 'Could not send your request.'); return; }
          toast('Request ' + res.data.request.reference + ' received. Nothing was charged.');
          reload();
          onChanged();
        }, function () { btn.disabled = false; toast(OFFLINE); });
      });
    });
  }

  function loadOffers() {
    return authFetch('/preview/offers').then(function (res) {
      if (!res.ok) return;
      var offers = res.data.offers || [];
      var byId = {};
      offers.forEach(function (o) { byId[o.offer_id] = o; });
      if (els.offersEditions) els.offersEditions.innerHTML = editionsHtml(res.data, byId);
      if (els.offersList) {
        els.offersList.innerHTML = offers.length ? offers.map(offerCardHtml).join('') : '<p class="muted">No offers are open right now. Please check back soon.</p>';
        bindOfferCards(els.offersList, loadOffers);
      }
      if (els.offersEditions) bindOfferCards(els.offersEditions, loadOffers);
      var near = offers.filter(function (o) { return o.suggested_for_you && o.state === 'open' && !o.my_request; }).slice(0, 2);
      if (els.offersNearTrip) {
        els.offersNearTrip.style.display = near.length ? 'block' : 'none';
        els.offersNearTrip.innerHTML = near.length ? '<h2>Suggested for your stay</h2>' + near.map(offerCardHtml).join('') + '<button class="btn btn-light btn-block" id="seeAllOffers" type="button">See all offers</button>' : '';
        bindOfferCards(els.offersNearTrip, loadOffers);
        var all = els.offersNearTrip.querySelector('#seeAllOffers');
        if (all) all.addEventListener('click', function () { if (deps.showView) deps.showView('offers'); });
      }
    }, function () { /* offline: keep what is already on screen */ });
  }

  function renderMyRequests(requests) {
    if (!els.myOffersPanel) return;
    if (!requests || !requests.length) { els.myOffersPanel.style.display = 'none'; return; }
    els.myOffersPanel.style.display = 'block';
    els.myOffersList.innerHTML = requests.map(requestRowHtml).join('');
    els.myOffersList.querySelectorAll('[data-cancel-request]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        authFetch('/preview/offers/requests/' + encodeURIComponent(btn.getAttribute('data-cancel-request')) + '/cancel', { method: 'POST' }).then(function (res) {
          toast(res.ok ? 'Request cancelled.' : ((res.data && (res.data.detail || res.data.error)) || 'Could not cancel.'));
          onChanged();
          loadOffers();
        }, function () { toast(OFFLINE); });
      });
    });
    els.myOffersList.querySelectorAll('[data-handoff-request]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-handoff-request');
        authFetch('/preview/offers/requests/' + encodeURIComponent(id) + '/whatsapp-handoff', { method: 'POST' }).then(function (res) {
          if (!res.ok) { toast('Could not prepare the message.'); return; }
          renderMockWhatsApp(els.myOffersList.querySelector('[data-request-handoff="' + id + '"]'), res.data.handoff);
        }, function () { toast(OFFLINE); });
      });
    });
  }

  function loadReferral() {
    if (!els.referralPanel) return Promise.resolve();
    return authFetch('/preview/referral').then(function (res) {
      if (!res.ok) { els.referralPanel.style.display = 'none'; return; }
      els.referralPanel.style.display = 'block';
      els.referralPanel.innerHTML = referralHtml(res.data);
      var copy = els.referralPanel.querySelector('#refCopy');
      var shareBtn = els.referralPanel.querySelector('#refShare');
      copy.addEventListener('click', function () { copyText(res.data.share_url).then(function () { toast('Link copied.'); }); });
      shareBtn.addEventListener('click', function () {
        authFetch('/preview/referral/share', { method: 'POST' }).catch(function () { /* the share tap is only a count; never block sharing on it */ });
        if (share) share({ title: 'Marau', text: 'Join me on Marau for Fiji deals', url: res.data.share_url }).catch(function () { copyText(res.data.share_url).then(function () { toast('Link copied.'); }); });
        else copyText(res.data.share_url).then(function () { toast('Link copied.'); });
      });
    }, function () { /* offline: leave the card as it is */ });
  }

  function loadContact() {
    if (!els.contactPanel) return Promise.resolve();
    return authFetch('/preview/trip/contact').then(function (res) {
      if (!res.ok) { els.contactPanel.style.display = 'none'; return; }
      els.contactPanel.style.display = 'block';
      els.contactPanel.innerHTML = contactHtml(res.data);
      els.contactPanel.querySelector('#ctWa').addEventListener('change', function (e) {
        authFetch('/preview/trip/contact', { method: 'POST', body: JSON.stringify({ whatsapp_available: e.target.checked }) }).then(function () { toast('Saved.'); loadContact(); }, function () { toast(OFFLINE); loadContact(); });
      });
      els.contactPanel.querySelector('#ctMk').addEventListener('change', function (e) {
        authFetch('/preview/trip/contact', { method: 'POST', body: JSON.stringify({ marketing_consent: e.target.checked ? 'granted' : 'withheld' }) }).then(function () { toast(e.target.checked ? 'Thanks - we will send occasional deals.' : 'Done - no promotional messages.'); loadContact(); }, function () { toast(OFFLINE); loadContact(); });
      });
    }, function () { /* offline: leave the card as it is */ });
  }

  return { esc: esc, offerCardHtml: offerCardHtml, requestRowHtml: requestRowHtml, fareHtml: fareHtml, referralHtml: referralHtml, contactHtml: contactHtml, editionsHtml: editionsHtml, requestRefFor: requestRefFor, loadOffers: loadOffers, renderMyRequests: renderMyRequests, loadReferral: loadReferral, loadContact: loadContact };
}
