/* Marau (PREVIEW/TEST ONLY) - the staff console for offers, requests, editions, referral credits and the follow-up queue.
 *
 * Served at /staff. It authenticates EVERY call with both the shared admin credential and the individual staff identity
 * token (the operator on every recorded decision comes from that token, never from a field typed here). Neither token is
 * ever placed in a URL; both live only in sessionStorage for the tab. It composes nothing for sending and sends nothing.
 *
 * Like the guest client, the logic is ONE self-contained function whose own source is spliced into the page, so there is no
 * backslash/backtick inside the served template literal and the tests execute the very text that ships.
 */
export function createStaffConsole(deps) {
  var doc = deps.document;
  var storage = deps.storage;
  var fetchImpl = deps.fetchImpl;
  var prompt = deps.prompt;
  var adminToken = null;
  var staffToken = null;

  function esc(v) {
    return String(v == null ? '' : v).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;').split("'").join('&#39;');
  }
  function el(id) { return doc.getElementById(id); }
  function money(n) { return n == null ? '-' : 'FJ$' + Number(n).toFixed(2); }

  function toast(msg) {
    var t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 3200);
  }

  function call(method, path, body) {
    var headers = { 'content-type': 'application/json', authorization: 'Bearer ' + adminToken, 'x-marau-staff-token': staffToken };
    return fetchImpl(path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      return r.json().then(function (data) { return { ok: r.ok, status: r.status, data: data }; });
    });
  }

  function failMessage(res) {
    var d = res.data || {};
    return d.detail || (d.details && d.details.join('; ')) || d.error || ('request failed (' + res.status + ')');
  }

  // Runs a staff action, reports the real outcome (including HTTP failures), then refreshes.
  function act(method, path, body, doneMessage) {
    return call(method, path, body).then(function (res) {
      toast(res.ok ? doneMessage : failMessage(res));
      return refresh();
    });
  }

  // ---------------------------------------------------------------- renderers (pure)

  function reportHtml(r) {
    function row(k, v) { return '<tr><td>' + esc(k) + '</td><td style="text-align:right"><b>' + esc(v) + '</b></td></tr>'; }
    return '<table class="small" style="width:100%">' +
      row('Requests (all)', r.requests_total) + row('Awaiting a human', r.requests_open_awaiting_human) + row('Confirmed', r.requests_confirmed) + row('Fulfilled', r.requests_fulfilled) +
      row('Quoted value of open requests (NOT revenue)', money(r.quoted_value_open_fjd)) + row('Confirmed sales value', money(r.confirmed_sales_value_fjd)) + row('Fulfilled sales value', money(r.fulfilled_sales_value_fjd)) +
      row('Expected contribution, before rewards', money(r.expected_contribution_fjd_before_rewards)) + row('Realised contribution, before rewards', money(r.realised_contribution_fjd_before_rewards)) +
      row('Shares tapped', r.referral_shares_tapped) + row('Friends attributed', r.referral_friends_attributed) +
      row('Reward credits pending/earned/applied/reversed', [r.reward_credits.pending, r.reward_credits.earned, r.reward_credits.applied, r.reward_credits.reversed].join(' / ')) +
      row('Reward funding committed / applied', money(r.reward_funding_committed_fjd) + ' / ' + money(r.reward_funding_applied_fjd)) +
      '</table><p class="small muted" style="margin-top:6px">Shares, requests and quoted value are NOT sales. Contribution is price minus supplier cost.</p>';
  }

  function guestsHtml(guests) {
    if (!guests.length) return '<p class="muted small">Nobody needs attention.</p>';
    return guests.map(function (g) {
      var flags = g.attention.map(function (a) { return '<span class="pill warn">' + esc(a.split('_').join(' ')) + '</span>'; }).join(' ');
      return '<div style="border-bottom:1px solid var(--line);padding:8px 0"><p class="small"><b>' + esc(g.contact.phone) + '</b> - ' + esc(g.contact.email) + '</p>' +
        '<p class="small muted">Follow up by <b>' + esc(g.follow_up.channel) + '</b> (' + esc(g.follow_up.reason) + ') - owner: <b>' + esc(g.follow_up.owner || 'none') + '</b> - marketing: ' + esc(g.marketing_consent) + '</p>' +
        '<p style="margin:4px 0">' + flags + '</p>' +
        '<div class="row"><input data-owner-input="' + esc(g.session_id) + '" placeholder="owner (a staff name)"><button class="btn btn-light" data-assign-owner="' + esc(g.session_id) + '" type="button">Assign owner</button></div></div>';
    }).join('');
  }

  function offersHtml(offers) {
    if (!offers.length) return '<p class="muted small">No offers yet.</p>';
    return offers.map(function (o) {
      var actions = '';
      if (o.status === 'draft') actions += '<button class="btn btn-primary" data-publish="' + esc(o.offer_id) + '" type="button">Publish</button> ';
      if (o.status !== 'withdrawn') actions += '<button class="btn btn-light" data-withdraw="' + esc(o.offer_id) + '" type="button">Withdraw</button>';
      return '<div style="border-bottom:1px solid var(--line);padding:8px 0"><p><b>' + esc(o.title) + '</b> <span class="pill ' + (o.status === 'published' ? '' : 'warn') + '">' + esc(o.status) + '</span></p>' +
        '<p class="small muted">' + esc(o.supplier) + ' (' + esc(o.supplier_verification) + ') - owner ' + esc(o.fulfilment_owner) + ' - ' + esc(o.places_left) + '/' + esc(o.capacity) + ' left - price ' + money(o.price_per_place_fjd) + ', cost ' + money(o.cost_per_place_fjd) + ' - ' + esc(o.open_requests) + ' open, ' + esc(o.confirmed_requests) + ' confirmed</p>' +
        '<p class="small muted">id ' + esc(o.offer_id) + '</p>' + actions + '</div>';
    }).join('');
  }

  function requestsHtml(requests) {
    if (!requests.length) return '<p class="muted small">No requests.</p>';
    return requests.map(function (r) {
      var a = '';
      if (r.status === 'requested') a += '<button class="btn btn-primary" data-act="confirm" data-id="' + esc(r.request_id) + '" type="button">Confirm</button> <button class="btn btn-light" data-act="decline" data-id="' + esc(r.request_id) + '" type="button">Decline</button>';
      if (r.status === 'confirmed') a += '<button class="btn btn-primary" data-act="fulfil" data-id="' + esc(r.request_id) + '" type="button">Mark fulfilled</button> <button class="btn btn-light" data-act="cancel" data-id="' + esc(r.request_id) + '" type="button">Cancel</button>';
      if (r.status === 'fulfilled') a += '<button class="btn btn-light" data-act="cancel" data-id="' + esc(r.request_id) + '" type="button">Reverse</button>';
      return '<div style="border-bottom:1px solid var(--line);padding:8px 0"><p><b>' + esc(r.reference) + '</b> ' + esc(r.title) + ' <span class="pill ' + (r.status === 'requested' ? 'warn' : '') + '">' + esc(r.status) + '</span>' + (r.needs_human_follow_up ? ' <span class="pill bad">offer withdrawn - contact guest</span>' : '') + '</p>' +
        '<p class="small muted">' + esc(r.places) + ' place(s), ' + money(r.total_fjd) + ' - ' + esc(r.contact.phone) + ' / ' + esc(r.contact.email) + ' - follow up by ' + esc(r.follow_up.channel) + (r.decided_by ? ' - decided by ' + esc(r.decided_by) : '') + '</p>' + a + '</div>';
    }).join('');
  }

  function creditsHtml(credits) {
    if (!credits.length) return '<p class="muted small">No reward credits.</p>';
    return credits.map(function (c) {
      var apply = '';
      if (c.status === 'earned') {
        var options = c.eligible_return_transfers.map(function (b) { return '<option value="' + esc(b.booking_id) + '">' + esc(b.reference) + ' - ' + money(b.original_fare_fjd) + '</option>'; }).join('');
        apply = options ? '<div class="row"><select data-credit-booking="' + esc(c.credit_id) + '">' + options + '</select><button class="btn btn-primary" data-apply-credit="' + esc(c.credit_id) + '" type="button">Apply to return transfer</button></div>' : '<p class="small muted">No eligible upcoming return transfer yet.</p>';
      }
      return '<div style="border-bottom:1px solid var(--line);padding:8px 0"><p><b>' + money(c.amount_fjd) + '</b> <span class="pill ' + (c.status === 'reversed' ? 'bad' : '') + '">' + esc(c.status) + '</span>' + (c.needs_manual_adjustment ? ' <span class="pill bad">needs your decision</span>' : '') + '</p>' +
        '<p class="small muted">funded by ' + esc(c.funding_source) + ' - holder ' + esc(c.holder.phone) + '</p>' + apply + '</div>';
    }).join('');
  }

  function policyHtml(p) {
    return '<p class="small">Mode <b>' + esc(p.mode) + '</b> - reward ' + money(p.amount_fjd) + ' - cap per referrer ' + money(p.cap_per_referrer_fjd) + ' - minimum purchase ' + money(p.min_purchase_fjd) + ' - earned on <b>' + esc(p.qualify_on) + '</b> - funded by ' + esc(p.funding_source) + '</p>' +
      '<p class="small muted">Rewards are OFF until configured. Live mode cannot be switched on from here: it needs the owner\'s approval.</p>';
  }

  // ------------------------------------------------------------------- loading

  function refresh() {
    return Promise.all([
      call('GET', '/preview/admin/offers/report'), call('GET', '/preview/admin/guests?attention=1'), call('GET', '/preview/admin/suppliers'),
      call('GET', '/preview/admin/offers'), call('GET', '/preview/admin/offers/requests'), call('GET', '/preview/admin/rewards/credits'), call('GET', '/preview/admin/rewards/policy'), call('GET', '/preview/admin/editions'),
    ]).then(function (r) {
      if (r.some(function (x) { return x.status === 401; })) { toast('Both the admin token and your staff token are required.'); signOut(); return; }
      el('rReport').innerHTML = r[0].ok ? reportHtml(r[0].data) : '';
      el('rGuests').innerHTML = r[1].ok ? guestsHtml(r[1].data.guests) : '';
      var suppliers = r[2].ok ? r[2].data.suppliers : [];
      el('rSuppliers').innerHTML = suppliers.map(function (s) {
        return '<p class="small"><b>' + esc(s.name) + '</b> - ' + esc(s.verification_status) + ' - owner ' + esc(s.fulfilment_owner) + ' <button class="btn btn-light" data-verify="' + esc(s.supplier_id) + '" type="button">Verify</button> <button class="btn btn-light" data-suspend="' + esc(s.supplier_id) + '" type="button">Suspend</button></p>';
      }).join('') || '<p class="muted small">No suppliers yet.</p>';
      el('oSupplier').innerHTML = suppliers.map(function (s) { return '<option value="' + esc(s.supplier_id) + '">' + esc(s.name) + '</option>'; }).join('');
      el('rOffers').innerHTML = r[3].ok ? offersHtml(r[3].data.offers) : '';
      el('rRequests').innerHTML = r[4].ok ? requestsHtml(r[4].data.requests) : '';
      el('rCredits').innerHTML = r[5].ok ? creditsHtml(r[5].data.credits) : '';
      el('rPolicy').innerHTML = r[6].ok ? policyHtml(r[6].data.policy) : '';
      el('rEditions').innerHTML = r[7].ok ? r[7].data.editions.map(function (e) {
        return '<p class="small"><b>' + esc(e.edition_id) + '</b> <span class="pill ' + (e.status === 'published' ? '' : 'warn') + '">' + esc(e.status) + '</span> - ' + e.offers.map(function (o) { return esc(o.title); }).join(', ') + (e.status === 'draft' ? ' <button class="btn btn-light" data-publish-edition="' + esc(e.edition_id) + '" type="button">Publish</button>' : '') + '</p>';
      }).join('') || '<p class="muted small">No editions prepared.</p>' : '';
      wire();
    });
  }

  function wire() {
    function each(sel, fn) { var nodes = doc.querySelectorAll(sel); for (var i = 0; i < nodes.length; i += 1) fn(nodes[i]); }
    each('[data-publish]', function (b) { b.onclick = function () { act('POST', '/preview/admin/offers/' + b.getAttribute('data-publish') + '/publish', {}, 'Published.'); }; });
    each('[data-withdraw]', function (b) { b.onclick = function () { var why = prompt('Reason for withdrawing this offer?'); if (why) act('POST', '/preview/admin/offers/' + b.getAttribute('data-withdraw') + '/withdraw', { reason: why }, 'Withdrawn.'); }; });
    each('[data-verify]', function (b) { b.onclick = function () { act('POST', '/preview/admin/suppliers/' + b.getAttribute('data-verify') + '/verify', {}, 'Supplier verified.'); }; });
    each('[data-suspend]', function (b) { b.onclick = function () { act('POST', '/preview/admin/suppliers/' + b.getAttribute('data-suspend') + '/suspend', {}, 'Supplier suspended.'); }; });
    each('[data-act]', function (b) {
      b.onclick = function () {
        var action = b.getAttribute('data-act');
        var body = {};
        if (action === 'cancel' || action === 'decline') { var note = prompt(action === 'cancel' ? 'Reason (required)?' : 'Note for the record (optional)?'); if (action === 'cancel' && !note) return; if (note) body.note = note; }
        act('POST', '/preview/admin/offers/requests/' + b.getAttribute('data-id') + '/' + action, body, 'Done: ' + action + '.');
      };
    });
    each('[data-assign-owner]', function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-assign-owner');
        var input = doc.querySelector('[data-owner-input="' + id + '"]');
        act('POST', '/preview/admin/guests/' + id + '/follow-up-owner', { owner: input.value }, 'Owner assigned.');
      };
    });
    each('[data-apply-credit]', function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-apply-credit');
        var sel = doc.querySelector('[data-credit-booking="' + id + '"]');
        act('POST', '/preview/admin/rewards/credits/' + id + '/apply', { booking_id: Number(sel.value) }, 'Credit applied.');
      };
    });
    each('[data-publish-edition]', function (b) { b.onclick = function () { act('POST', '/preview/admin/editions/' + encodeURIComponent(b.getAttribute('data-publish-edition')) + '/publish', {}, 'Edition published.'); }; });
  }

  function signOut() {
    adminToken = null; staffToken = null;
    try { storage.removeItem('marau_staff_admin'); storage.removeItem('marau_staff_tok'); } catch (e) { /* ignore */ }
    el('loginPanel').style.display = 'block';
    el('consolePanel').style.display = 'none';
  }

  function signIn(admin, staff) {
    adminToken = admin; staffToken = staff;
    try { storage.setItem('marau_staff_admin', admin); storage.setItem('marau_staff_tok', staff); } catch (e) { /* ignore */ }
    el('loginPanel').style.display = 'none';
    el('consolePanel').style.display = 'block';
    return refresh();
  }

  function init() {
    el('loginBtn').onclick = function () { var a = el('adminTok').value.trim(); var s = el('staffTok').value.trim(); if (a && s) signIn(a, s); else toast('Enter both tokens.'); };
    el('logoutBtn').onclick = signOut;
    el('supplierForm').onsubmit = function (e) { e.preventDefault(); act('POST', '/preview/admin/suppliers', { name: el('sName').value, fulfilment_owner: el('sOwner').value }, 'Supplier created (unverified).'); };
    el('offerForm').onsubmit = function (e) {
      e.preventDefault();
      act('POST', '/preview/admin/offers', {
        supplier_id: el('oSupplier').value, title: el('oTitle').value, location: el('oLocation').value, inclusions: el('oIncl').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean),
        starts_at: el('oStarts').value, book_by: el('oBookBy').value || undefined, expires_at: el('oExpires').value || undefined,
        capacity: Number(el('oCap').value), price_per_place_fjd: Number(el('oPrice').value), cost_per_place_fjd: Number(el('oCost').value || 0),
      }, 'Draft offer created.');
    };
    el('editionForm').onsubmit = function (e) {
      e.preventDefault();
      act('POST', '/preview/admin/editions', { fiji_date: el('eDate').value, slot: el('eSlot').value, offer_ids: el('eOffers').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean) }, 'Edition prepared (draft).');
    };
    el('policyForm').onsubmit = function (e) {
      e.preventDefault();
      var body = { mode: el('pMode').value };
      if (el('pAmount').value) body.amount_fjd = Number(el('pAmount').value);
      if (el('pCap').value) body.cap_per_referrer_fjd = Number(el('pCap').value);
      if (el('pMin').value) body.min_purchase_fjd = Number(el('pMin').value);
      body.qualify_on = el('pQualify').value;
      act('POST', '/preview/admin/rewards/policy', body, 'Policy saved.');
    };
    var a = null; var s = null;
    try { a = storage.getItem('marau_staff_admin'); s = storage.getItem('marau_staff_tok'); } catch (e) { /* ignore */ }
    if (a && s) signIn(a, s);
  }

  return { init: init, esc: esc, reportHtml: reportHtml, guestsHtml: guestsHtml, offersHtml: offersHtml, requestsHtml: requestsHtml, creditsHtml: creditsHtml, policyHtml: policyHtml, call: call, failMessage: failMessage, signIn: signIn };
}
