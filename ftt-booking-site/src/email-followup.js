/* Email follow-up fallback for the reservation result screens ("No WhatsApp? Request confirmation by email").
 *
 * WhatsApp stays the primary handoff. This is a BACKUP contact channel: it durably records a follow-up request against the existing reservation reference
 * (POST /email-followup) BEFORE it shows any success. It never opens a mail client by itself, never claims an email was sent or delivered, and never claims the
 * transfer is confirmed - a human on our team replies manually from the monitored inbox.
 *
 * Shared file: the NAT and FijiDash copies are byte-identical. The page supplies a context per result card:
 *   { site: 'nat'|'fijidash', apiBase, ref, token, mode: 'saved'|'uncertain'|'enquiry', getEmail(), getGuest() -> {name, phone}, getEnquiry() -> {...},
 *     reconcile() -> Promise<{ok, followupToken}>   (uncertain only: re-submits the SAME reference so nothing is duplicated),
 *     onReconciled(result)  (optional: lets the page switch the screen to its "saved" state) }
 */
(function (global) {
  'use strict';
  var TEAM_INBOX = 'tourfijitours@gmail.com';   // receiving inbox for guests who prefer to write themselves; the server returns the authoritative value
  var SITE_HOSTS = { nat: 'nadiairporttransfers.com', fijidash: 'book.fijidash.com' };
  var sessions = {};   // per reservation reference: survives the page switching between result cards

  function basicEmailOk(v) {
    v = String(v || '').trim();
    return v.length >= 5 && v.length <= 254 && /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[A-Za-z]{2,}$/.test(v);
  }
  function mask(e) { var at = String(e).indexOf('@'); return at < 1 ? '' : e.charAt(0) + '******' + e.slice(at); }

  async function post(url, body, timeoutMs) {
    var controller = new AbortController(); var timer;
    try {
      return await Promise.race([
        (async function () {
          var res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
          var data = await res.json().catch(function () { return null; });
          return { status: res.status, data: data };
        })(),
        new Promise(function (_, reject) { timer = setTimeout(function () { controller.abort(); reject(new Error('timeout')); }, timeoutMs || 15000); }),
      ]);
    } finally { clearTimeout(timer); }
  }

  function q(box, sel) { return box.querySelector(sel); }
  function setStatus(box, kind, text) {
    var el = q(box, '.ef-status'); if (!el) return;
    el.textContent = text; el.setAttribute('data-kind', kind); el.hidden = !text;
  }
  function setBusy(box, busy) {
    var b = q(box, '.ef-send'); if (b) { b.disabled = !!busy; b.setAttribute('aria-busy', busy ? 'true' : 'false'); }
    var i = q(box, '.ef-email'); if (i) i.readOnly = !!busy;
  }

  function renderDone(sess, data, email) {
    var box = sess.box; if (!box) return;
    sess.done = true; sess.email = email; sess.maskedEmail = data.email_masked || mask(email); sess.inbox = data.team_inbox || TEAM_INBOX;
    var inp = q(box, '.ef-email'); if (inp) inp.value = email;
    var pnl = q(box, '.ef-panel'); if (pnl) pnl.hidden = false; var tg = q(box, '.ef-toggle'); if (tg) tg.setAttribute('aria-expanded', 'true');
    var locked = data.locked === true;
    setStatus(box, 'ok', locked
      ? 'Our team is already handling this request, so the address cannot be changed here. Please reply to them if it needs to change. Reference ' + sess.ref + '.'
      : 'Request received. Our Fiji team will follow up by email at ' + sess.maskedEmail + '. Reference ' + sess.ref + '. This is not a confirmation of your transfer, and no email has been sent yet.');
    var send = q(box, '.ef-send'); if (send) send.textContent = 'Update email address';
    var info = q(box, '.ef-inbox');
    if (info) {
      var subject = 'Reservation ' + sess.ref;
      var body = 'Reference: ' + sess.ref + '\nWebsite: ' + (SITE_HOSTS[sess.ctx.site] || '') + '\nReply to: ' + email + '\n';
      info.textContent = '';
      info.appendChild(document.createTextNode('Optional: you can also write to our team yourself at '));
      var a = document.createElement('a'); a.href = 'mailto:' + sess.inbox + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body); a.textContent = sess.inbox;
      info.appendChild(a); info.appendChild(document.createTextNode(', quoting reference ' + sess.ref + '. Your request above is already recorded.'));
      info.hidden = false;
    }
  }

  async function run(sess) {
    if (sess.inFlight) return;                       // duplicate click / double tap: ignored while a request is running
    var box = sess.box; var input = q(box, '.ef-email'); var email = (input.value || '').trim();
    if (!basicEmailOk(email)) { setStatus(box, 'error', 'Please enter a valid email address (for example name@example.com). Nothing has been requested yet.'); input.focus(); return; }
    if (sess.done && email === sess.email) { setStatus(box, 'ok', 'That is the address we already have for reference ' + sess.ref + '. Change it above if it needs correcting.'); return; }
    sess.inFlight = true; setBusy(box, true); setStatus(box, 'info', 'Sending your request…');
    try {
      if (sess.mode === 'uncertain' && !sess.token) {
        // reconcile FIRST: re-submit the same reservation reference; the booking system returns the existing booking if it was saved. Nothing new is created.
        var rec = null;
        try { rec = await sess.ctx.reconcile(); } catch (e) { rec = null; }
        if (!rec || !rec.ok) { setStatus(box, 'error', 'We could not reach our booking system, so nothing has been requested yet. Your details are kept. Please try again, or use WhatsApp.'); return; }
        if (sess.ctx.onReconciled) { try { sess.ctx.onReconciled(rec); } catch (e) { /* display only */ } }
        box = sess.box;   // the page may have switched to its "saved" card, which re-mounted this session
        var typed = q(box, '.ef-email'); if (typed) typed.value = email;   // carry the guest's (possibly corrected) address onto the new card so a retry never reverts it
        var panelNow = q(box, '.ef-panel'); if (panelNow) panelNow.hidden = false;
        if (!rec.followupToken) { setStatus(box, 'error', 'Your reservation request is saved, but email follow-up is not available right now. Please use WhatsApp.'); return; }
        sess.token = rec.followupToken; sess.mode = 'saved';
      }
      var guest = sess.ctx.getGuest ? sess.ctx.getGuest() : {};
      var payload = { client_ref: sess.ref, email: email, origin_site: sess.ctx.site, guest_name: guest.name || '', guest_phone: guest.phone || '' };
      if (sess.token) payload.token = sess.token;
      if (sess.mode === 'enquiry') payload.enquiry = sess.ctx.getEnquiry ? sess.ctx.getEnquiry() : {};
      var r = await post(sess.ctx.apiBase + '/email-followup', payload, 15000);
      var d = r.data || {};
      if ((r.status === 200 || r.status === 201) && d.ok && d.received) {
        if (d.token) sess.token = d.token;
        renderDone(sess, d, email);
      } else if (r.status === 400 && d.code === 'INVALID_EMAIL') {
        setStatus(box, 'error', (d.errors && d.errors[0] ? d.errors[0] + ' ' : '') + 'Nothing has been requested yet.');
      } else if (r.status === 429) {
        setStatus(box, 'error', 'Too many requests from this connection today, so nothing was requested. Please use WhatsApp.');
      } else if (r.status === 503) {
        setStatus(box, 'error', 'Email follow-up is not available right now, so nothing was requested. Please use WhatsApp.');
      } else {
        setStatus(box, 'error', 'We could not record your request, so nothing has been received. Your details are kept. Please try again, or use WhatsApp.');
      }
    } catch (err) {
      // timeout / network loss: the request may or may not have been recorded; repeating it is safe (same reference = same follow-up, never a duplicate)
      setStatus(sess.box, 'error', 'We could not confirm that your request was recorded, so please do not assume it was. Your details are kept. Tap the button again - repeating it is safe and will not create a duplicate - or use WhatsApp.');
    } finally {
      sess.inFlight = false; setBusy(sess.box, false);
    }
  }

  function mount(card, ctx) {
    if (!card || !ctx || !ctx.ref) return null;
    var box = card.querySelector('[data-ef]'); if (!box) return null;
    var sess = sessions[ctx.ref] || (sessions[ctx.ref] = { ref: ctx.ref, token: null, mode: ctx.mode, done: false, inFlight: false });
    sess.ctx = ctx; sess.box = box;
    if (ctx.token) sess.token = ctx.token;
    if (!sess.done) sess.mode = sess.token && sess.mode === 'uncertain' ? 'saved' : ctx.mode;
    box.__efSess = sess;
    var input = q(box, '.ef-email');
    if (input && !input.value) input.value = (ctx.getEmail && ctx.getEmail()) || '';
    if (!box.__efWired) {
      box.__efWired = true;
      var toggle = q(box, '.ef-toggle'); var panel = q(box, '.ef-panel');
      toggle.addEventListener('click', function () { var open = panel.hidden; panel.hidden = !open; toggle.setAttribute('aria-expanded', open ? 'true' : 'false'); if (open) { var i = q(box, '.ef-email'); if (i) i.focus(); } });
      q(box, '.ef-send').addEventListener('click', function () { run(box.__efSess); });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); run(box.__efSess); } });
    }
    box.hidden = false;
    if (sess.done) { var p = q(box, '.ef-panel'); p.hidden = false; q(box, '.ef-toggle').setAttribute('aria-expanded', 'true'); if (input) input.value = sess.email; renderDone(sess, { email_masked: sess.maskedEmail, team_inbox: sess.inbox }, sess.email); }
    return sess;
  }

  global.EmailFollowup = { mount: mount, _basicEmailOk: basicEmailOk, _sessions: sessions };
})(typeof window !== 'undefined' ? window : globalThis);
