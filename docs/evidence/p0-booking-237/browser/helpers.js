(() => {
  window.__blocked = []; window.__api = []; window.__gate = null;
  const origFetch = window.fetch.bind(window);
  const local = (u) => { try { return new URL(u, location.href).origin === location.origin; } catch { return false; } };
  window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url;
    if (/^https:\/\/api\.nadiairporttransfers\.com\//.test(url)) { const p = new URL(url).pathname; window.__api.push((init && init.method || 'GET') + ' ' + p);
      const r = await origFetch('/api' + p, init).catch((e) => { throw e; }); if (window.__gate) await window.__gate; return r; }
    if (local(url)) return origFetch(input, init); window.__blocked.push('fetch ' + (init && init.method || 'GET') + ' ' + url.slice(0, 100)); throw new TypeError('blocked by the test harness'); };
  const xo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, u, ...r) { if (!local(u)) { window.__blocked.push('xhr ' + m + ' ' + String(u).slice(0, 100)); u = '/__blocked'; } return xo.call(this, m, u, ...r); };
  navigator.sendBeacon = (u) => { window.__blocked.push('beacon ' + String(u).slice(0, 100)); return false; }; window.open = (u) => { window.__blocked.push('open ' + String(u).slice(0, 100)); return null; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); window.__sleep = sleep;
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  window.__set = set;
  window.__vis = () => ['step1','step2','step3','step4','stepSuccess'].filter((id) => getComputedStyle(document.getElementById(id)).display !== 'none');
  window.__trip = async (t) => {
    set('pickup', 'NAN'); set('destination', t.dest); set('travelDate', t.date); set('travelTime', t.time);
    const btns = document.querySelectorAll('.trip-btn');
    if (t.tripType === 'return') { setTripType('return', btns[1]); set('returnDate', t.returnDate); set('returnTime', t.returnTime); set('returnPickupLocation', t.returnPickup); } else setTripType('one-way', btns[0]);
    while (state.passengers < t.pax) changePax(1); while (state.passengers > t.pax) changePax(-1); while (state.luggage < t.bags) changeLuggage(1); while (state.luggage > t.bags) changeLuggage(-1);
    const seat = document.getElementById('extra-seat'), surf = document.getElementById('extra-surf'); if (seat.checked !== !!t.seat) seat.click(); if (surf.checked !== !!t.surf) surf.click();
    updatePricing(); await sleep(300);
    document.querySelector(`#vehicleCards input[type=radio][value="${t.vehicle}"]`).click(); await sleep(200);
    document.getElementById('nextBtn1').click(); await sleep(250); document.getElementById('nextBtn2').click(); await sleep(250);
    set('firstName', 'Zed'); set('lastName', 'Testperson'); set('email', 'zed.testperson@example.invalid'); set('phone', '+61411222333');
    [...document.querySelectorAll('button')].find((x) => /Review booking/.test(x.textContent)).click(); await sleep(400);
    return { visible: window.__vis(), shown: calculateTotal().final, vehicle: state.selectedVehicle };
  };
  window.__confirm = async () => { document.querySelector('.btn-confirm').click(); await sleep(900); return window.__snap(); };
  window.__snap = async () => { const st = await (await fetch('/api/state')).json(); const n = document.getElementById('fareChangeNotice');
    return { visible: window.__vis(), notice: n ? n.innerText.replace(/\n+/g, ' / ') : null, button: document.querySelector('.btn-confirm').textContent.trim(), total: [...document.querySelectorAll('#confirmationCard .confirm-row')].map((r) => r.innerText.replace(/\s+/g, ' ')).slice(-3),
      success: getComputedStyle(document.getElementById('bulaSuccess')).display, fareLine: (document.getElementById('bulaFare') || {}).innerText || null, retryShown: !document.getElementById('bulaRetry').hidden, bulaRef: (document.getElementById('bulaRef') || {}).innerText,
      override: state.fareOverride ? { amount: state.fareOverride.amount, original: state.fareOverride.original } : null, inFlight: state.confirmBookingInFlight,
      server: { bookings: st.bookings, outbound: st.outbound_calls, escalations: st.escalations, alerts: st.alert_texts, decisions: st.events.map((e) => e && e.pricing_decision && [e.pricing_decision.outcome, e.pricing_decision.submitted_amount_fjd, e.pricing_decision.accepted_amount_fjd, e.pricing_decision.original_shown_amount_fjd]), api: st.api_log.map((a) => [a.status, a.code, a.created, a.amountSubmitted, a.revisedFrom, a.outcome || '']) }, blocked: window.__blocked }; };
  return 'helpers ok';
})()
