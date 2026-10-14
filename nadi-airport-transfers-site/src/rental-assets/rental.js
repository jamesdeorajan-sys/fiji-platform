// Nadi Airport car-rental request form.
// A saved request is NOT a confirmed rental. The page saves the request to the NAT backend (which alerts staff automatically),
// shows the reference, and offers WhatsApp only as an optional extra. If saving fails the guest keeps their details and can
// retry (same request id, so a retry never creates a second request) or send a WhatsApp-only enquiry instead.
import { CONSENT_VERSION, fijiNow, validateTrip, validateContact, normalisePhone, summary, whatsappMessage } from './rental-core.js';

const NAT_WHATSAPP = '61478886145';
const form = document.querySelector('#rental-form');
if (form) {
  const trip = document.querySelector('#trip-step');
  const contact = document.querySelector('#contact-step');
  const errorEl = document.querySelector('#error');
  const result = document.querySelector('#result');
  const send = document.querySelector('#send');
  const label = document.querySelector('#step-label');
  const field = (n) => form.elements.namedItem(n);
  const endpoint = form.dataset.endpoint;
  const SEND_LABEL = 'Send rental request';
  const ID_KEY = 'nat_rental_request_id';

  // One id per request, kept for the browser session so a retry or a reload re-sends the SAME id (server-side idempotency).
  function requestId() {
    try { const s = sessionStorage.getItem(ID_KEY); if (s) return s; } catch { /* storage may be blocked */ }
    const id = crypto.randomUUID();
    try { sessionStorage.setItem(ID_KEY, id); } catch { /* ignore */ }
    return id;
  }
  function resetRequestId() { try { sessionStorage.removeItem(ID_KEY); } catch { /* ignore */ } }

  const today = fijiNow().slice(0, 10);
  field('pickupDate').min = today; field('returnDate').min = today;
  field('pickupDate').addEventListener('change', () => { field('returnDate').min = field('pickupDate').value || today; });

  const data = () => {
    const o = Object.fromEntries(new FormData(form).entries());
    o.consentShare = field('consentShare').checked; o.consentWhatsappGroup = field('consentWhatsappGroup').checked;
    return o;
  };

  function step(n, focus = true) {
    trip.hidden = n === 2; // hidden, NOT disabled: a disabled fieldset's fields would be left out of FormData on step 2
    contact.hidden = n === 1; contact.disabled = n === 1;
    label.textContent = n === 1 ? 'Step 1 of 2: Your rental' : 'Step 2 of 2: Your contact details';
    errorEl.textContent = '';
    if (focus) { document.querySelector('#request').scrollIntoView({ behavior: 'smooth', block: 'start' }); (n === 1 ? field('pickup') : field('name')).focus({ preventScroll: true }); }
  }

  document.querySelector('#next').addEventListener('click', () => {
    if (!form.reportValidity()) { errorEl.textContent = 'Please complete the required fields.'; return; }
    const issue = validateTrip(data());
    if (issue) { errorEl.textContent = issue; return; }
    document.querySelector('#summary').textContent = summary(data());
    step(2);
  });
  document.querySelector('#back').addEventListener('click', () => step(1));
  for (const b of document.querySelectorAll('[data-vehicle]')) {
    b.addEventListener('click', () => { field('vehicle').value = b.dataset.vehicle; if (!result.hidden) return; step(1); });
  }

  function add(tag, text, parent = result) { const e = document.createElement(tag); e.textContent = text; parent.append(e); return e; }
  function waLink(d, ref, text, parent) {
    const a = add('a', text, parent);
    a.href = `https://wa.me/${NAT_WHATSAPP}?text=` + encodeURIComponent(whatsappMessage(d, ref));
    a.target = '_blank'; a.rel = 'noopener'; a.className = 'rt-btn sec';
    return a;
  }

  function showSaved(d, ref, duplicate) {
    form.hidden = true; result.hidden = false; result.replaceChildren();
    document.querySelector('#wa-fallback')?.remove();
    add('h3', duplicate ? 'We already have this request.' : 'Your rental request is saved.');
    add('span', ref).className = 'rt-ref';
    add('p', 'This is not a confirmed rental. Best Adventure Fiji confirms the vehicle, the full price and the rental terms after our team connects you.');
    add('p', 'Our team is alerted automatically. We will message you on WhatsApp to start the conversation with the rental agent. You do not need to send anything else.');
    add('p', 'Quote this reference if you contact us. Want to say hello now? You can also message us, but this is optional.');
    waLink(d, ref, 'Message NAT on WhatsApp (optional)', result);
    result.focus();
    resetRequestId();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const d = data();
    const tripIssue = validateTrip(d);
    if (tripIssue) { step(1); errorEl.textContent = tripIssue; return; }
    if (!form.reportValidity()) { errorEl.textContent = 'Please complete the required fields and tick both consent boxes.'; return; }
    const contactIssue = validateContact(d);
    if (contactIssue) { errorEl.textContent = contactIssue.message; field(contactIssue.field)?.focus(); return; }
    d.phone = normalisePhone(d.phone);

    send.disabled = true; send.textContent = 'Saving your request...';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({
          id: requestId(), name: d.name, phone: d.phone, email: d.email || '', pickup: d.pickup, dropoff: d.dropoff,
          pickupDate: d.pickupDate, pickupTime: d.pickupTime, returnDate: d.returnDate, returnTime: d.returnTime,
          passengers: Number(d.passengers), bags: Number(d.bags), vehicle: d.vehicle, age: d.age, licenceCountry: d.licenceCountry, flight: d.flight || '', notes: d.notes || '',
          consentShare: d.consentShare, consentWhatsappGroup: d.consentWhatsappGroup, consentVersion: form.dataset.consentVersion || CONSENT_VERSION,
          websiteTrap: d.websiteTrap || '', source: location.origin + location.pathname,
          utm: Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign'].map((k) => [k, new URLSearchParams(location.search).get(k) || ''])),
        }),
      });
      let body = null; try { body = await res.json(); } catch { /* not json */ }
      if (res.ok && body && body.saved === true && body.reference) { showSaved(d, body.reference, !!body.duplicate); return; }
      throw new Error((body && body.error) || 'We could not confirm your request was saved.');
    } catch (err) {
      // Never show raw browser error text ("Failed to fetch"): a dropped or blocked connection gets a plain sentence; server messages are already guest-ready.
      const aborted = err && err.name === 'AbortError';
      const network = err instanceof TypeError;
      const lead = aborted ? 'The connection was slow and we could not confirm your request was saved. '
        : network ? 'We could not reach our server, so we could not confirm your request was saved. '
        : (err && err.message ? err.message.replace(/\s*$/, ' ') : 'We could not confirm your request was saved. ');
      errorEl.textContent = lead + 'Your details are still here. You can try again (it is safe: the same request is never saved twice) or send a WhatsApp-only enquiry instead.';
      document.querySelector('#wa-fallback')?.remove();
      const wrap = document.createElement('div'); wrap.id = 'wa-fallback'; wrap.className = 'rt-actions';
      waLink(d, null, 'Send a WhatsApp-only enquiry instead', wrap);
      errorEl.after(wrap);
    } finally {
      clearTimeout(timer);
      send.disabled = false; send.textContent = SEND_LABEL;
    }
  });
}
