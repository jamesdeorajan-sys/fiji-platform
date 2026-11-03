// Driver PWA v2 — Gate 1 client (ISOLATED, synthetic). The server is the only authority:
//  - countdowns are display aids derived from server time; they never expire or hide an offer by themselves
//  - Accept => local CONFIRMING immediately, replay-safe retries, "assigned" shown ONLY after the server confirms
//  - reload/reconnect recovers truth from GET /api/state (and resumes an in-flight accept idempotently)
const LIFECYCLE = ['DRIVER_ASSIGNED', 'EN_ROUTE_PICKUP', 'ARRIVED_PICKUP', 'PICKUP_VALIDATED', 'PASSENGER_ONBOARD', 'EN_ROUTE_DESTINATION', 'ARRIVED_DESTINATION', 'COMPLETED'];
const LABEL = { DRIVER_ASSIGNED: 'Job assigned', EN_ROUTE_PICKUP: 'Driving to pickup', ARRIVED_PICKUP: 'Arrived at pickup', PICKUP_VALIDATED: 'Pickup validated', PASSENGER_ONBOARD: 'Passenger on board', EN_ROUTE_DESTINATION: 'Driving to destination', ARRIVED_DESTINATION: 'Arrived at destination', COMPLETED: 'Completed' };
const ACTION = { EN_ROUTE_PICKUP: 'Start driving to pickup', ARRIVED_PICKUP: "I've arrived at pickup", PICKUP_VALIDATED: 'Validate pickup', PASSENGER_ONBOARD: 'Passenger on board', EN_ROUTE_DESTINATION: 'Start driving to destination', ARRIVED_DESTINATION: "I've arrived at destination", COMPLETED: 'Complete trip' };
const PHASE_TEXT = { PRIORITY: 'PRIORITY', CONNECTIVITY_GRACE: 'CONNECTIVITY GRACE', ESCALATED_DISPATCH: 'ESCALATED' };

const $ = (s) => document.querySelector(s);
const main = $('#main');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* storage optional */ } }, del: (k) => { try { sessionStorage.removeItem(k); } catch { /* storage optional */ } } };

let token = (() => { const m = location.hash.match(/token=([\w-]+)/); if (m) { store.set('tok', m[1]); history.replaceState(null, '', location.pathname); return m[1]; } return store.get('tok'); })();
let serverOffset = 0;
let state = { offers: [], trips: [], driver: null };
const local = { confirming: null, notice: null, evidence: {}, busy: false, authExpired: false };
let sig = '';

async function api(method, path, body, timeoutMs = 8000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ac.signal, cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    setConn(true);
    return { status: res.status, json };
  } catch (e) { setConn(false); throw e; } finally { clearTimeout(t); }
}
function setConn(ok) { const c = $('#conn'); c.textContent = ok ? 'Online' : 'Reconnecting…'; c.className = `chip ${ok ? 'ok' : 'warn'}`; c.dataset.state = ok ? 'online' : 'reconnecting'; }

// Retry until the server actually answers (any HTTP status). Safe only because every call is idempotent server-side.
async function persist(method, path, body) {
  let delay = 400;
  for (;;) { try { return await api(method, path, body, 15000); } catch { await sleep(delay); delay = Math.min(delay * 2, 3000); } }
}

async function poll() {
  try {
    const r = await api('GET', '/api/state');
    if (r.status === 401) { local.authExpired = true; render(); return; }
    local.authExpired = false;
    serverOffset = Date.parse(r.json.server_now) - Date.now();
    state = r.json; render();
  } catch { /* connection chip already shows Reconnecting…; keep last known server truth on screen */ }
}

async function accept(offerId) {
  if (local.confirming) return;                       // prevents accidental repeat interaction
  local.confirming = offerId; store.set('pending_accept', offerId); render();
  const r = await persist('POST', `/api/offers/${offerId}/accept`, {});
  local.confirming = null; store.del('pending_accept');
  const code = r.json.code;
  if (code === 'ASSIGNED') { local.notice = null; }
  else if (code === 'ASSIGNMENT_ALREADY_TAKEN') local.notice = { kind: 'taken', text: 'Job already taken by another driver.' };
  else if (code === 'OFFER_EXPIRED') local.notice = { kind: 'expired', text: 'This offer is no longer available.' };
  else local.notice = { kind: 'error', text: `Could not accept (${code}).` };
  await poll(); render();
}
async function decline(offerId) { await persist('POST', `/api/offers/${offerId}/decline`, {}); await poll(); }
async function view(offerId) { try { await api('POST', `/api/offers/${offerId}/view`, {}); } catch { /* best effort; session polling also proves reachability */ } }

async function advance(trip) {
  if (local.busy) return; local.busy = true; render();
  const r = await persist('POST', `/api/trips/${trip.booking_id}/stage`, { stage: trip.next_stage });
  local.busy = false;
  if (r.json.code === 'EVIDENCE_REQUIRED') local.notice = { kind: 'error', text: 'Take the pickup photo first.' };
  else if (!r.json.ok) local.notice = { kind: 'error', text: `Step refused (${r.json.code}).` };
  else { local.notice = null; if (r.json.stage === 'COMPLETED') local.notice = { kind: 'done', text: 'Trip completed. Well done.' }; }
  await poll(); render();
}
async function captureEvidence(trip) {
  if (local.busy) return; local.busy = true; render();
  const r = await persist('POST', `/api/trips/${trip.booking_id}/evidence`, { kind: 'PICKUP', client_evidence_id: `cli-${trip.booking_id}-pickup`, sha256: 'c'.repeat(64), bytes: 48213 });
  local.busy = false;
  if (r.json.ok) { local.evidence[trip.booking_id] = true; local.notice = null; } else local.notice = { kind: 'error', text: `Photo upload failed (${r.json.code}) — tap again to retry.` };
  await poll(); render();
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const serverNow = () => Date.now() + serverOffset;

function countdownHtml(o) {
  const elapsed = Math.max(0, (serverNow() - Date.parse(o.offered_at)) / 1000);
  if (elapsed < 60) { const left = Math.ceil(60 - elapsed); return `<div class="count" data-testid="countdown" data-offered="${esc(o.offered_at)}">0:${String(left).padStart(2, '0')}<small>Fast-response target · the offer stays open until the server says otherwise</small></div>`; }
  return `<div class="count" data-testid="countdown" data-offered="${esc(o.offered_at)}">Still open<small>Past the 60 s target — confirm when your connection allows. The server decides.</small></div>`;
}

function offerCard(o, confirming) {
  const t = o.trip;
  return `<section class="card" data-testid="offer-card" data-offer="${esc(o.offer_id)}">
    <div><span class="phase ${esc(o.phase_now || o.dispatch_phase)}" data-testid="phase-chip">${esc(PHASE_TEXT[o.phase_now || o.dispatch_phase] || '')}</span></div>
    <h2>New job offer</h2>
    <div class="route">${esc(t.pickup_zone)}<span class="arrow">→</span>${esc(t.destination_zone)}</div>
    <div class="meta"><span>${esc(t.vehicle_type)}</span><span>${esc(t.distance_km)} km</span><span>${esc(t.fare.currency)} ${esc(t.fare.amount)}</span><span>${esc(t.payment_method)}</span></div>
    ${confirming ? `<div class="confirming" data-testid="state-confirming"><div class="spin"></div><div><strong>Confirming with server…</strong><div class="note">You will see the job only once the server confirms it.</div></div></div>
       <div class="row"><button disabled data-testid="btn-accept">Accepting…</button></div>`
      : `${countdownHtml(o)}<div class="row"><button class="secondary" data-act="decline" data-offer="${esc(o.offer_id)}" data-testid="btn-decline">Decline</button><button data-act="accept" data-offer="${esc(o.offer_id)}" data-testid="btn-accept">Accept</button></div>`}
  </section>`;
}

function tripCard(trip) {
  const idx = LIFECYCLE.indexOf(trip.stage);
  const steps = LIFECYCLE.map((s, i) => `<li class="${i < idx ? 'done' : i === idx ? 'cur done' : ''}" data-stage="${s}"><span class="dot"></span>${LABEL[s]}</li>`).join('');
  const needsPhoto = trip.next_stage === 'PICKUP_VALIDATED';
  const hasPhoto = trip.evidence?.pickup || local.evidence[trip.booking_id];
  const g = trip.guest || {};
  const btn = !trip.next_stage ? '' : needsPhoto
    ? `<button class="secondary" data-act="evidence" ${local.busy || hasPhoto ? 'disabled' : ''} data-testid="btn-evidence">${hasPhoto ? 'Pickup photo stored ✓' : 'Take pickup photo (simulated)'}</button>
       <button data-act="next" ${local.busy || !hasPhoto ? 'disabled' : ''} data-testid="btn-next">${ACTION.PICKUP_VALIDATED}</button>`
    : `<button data-act="next" ${local.busy ? 'disabled' : ''} data-testid="btn-next">${ACTION[trip.next_stage]}</button>`;
  return `<section class="card" data-testid="trip-view" data-booking="${trip.booking_id}">
    <h2>Your job <span class="chip ok" data-testid="stage">${esc(LABEL[trip.stage])}</span></h2>
    <div class="route">${esc(trip.pickup_zone)}<span class="arrow">→</span>${esc(trip.destination_zone)}</div>
    <dl class="guest" data-testid="guest-details"><dt>Guest</dt><dd>${esc(g.name)}</dd><dt>Phone</dt><dd>${esc(g.phone)}</dd><dt>Flight</dt><dd>${esc(g.flight_number)}</dd><dt>Notes</dt><dd>${esc(g.pickup_notes)}</dd></dl>
    <ul class="steps">${steps}</ul>${btn}
  </section>`;
}

function render() {
  const drv = $('#drv'); drv.textContent = state.driver ? `${state.driver.name}` : '–';
  let html = '';
  if (local.authExpired) html += `<div class="banner bad" data-testid="auth-expired">Session expired (AUTH_EXPIRED). Please sign in again.</div>`;
  if (local.notice) html += `<div class="banner ${local.notice.kind === 'done' ? 'ok' : local.notice.kind === 'error' ? 'bad' : 'warn'}" data-testid="notice-${esc(local.notice.kind)}">${esc(local.notice.text)}</div>`;
  const confirmingOffer = local.confirming ? state.offers.find((o) => o.offer_id === local.confirming) : null;
  if (local.confirming) html += confirmingOffer ? offerCard(confirmingOffer, true)
    : `<section class="card" data-testid="offer-card"><h2>New job offer</h2><div class="confirming" data-testid="state-confirming"><div class="spin"></div><div><strong>Confirming with server…</strong><div class="note">You will see the job only once the server confirms it.</div></div></div></section>`;
  else if (state.offers.length || state.trips.length) html += state.offers.map((o) => offerCard(o, false)).join('') + state.trips.map(tripCard).join('');   // a new offer is never hidden by an active trip
  else html += `<section class="card" data-testid="idle"><h2>No jobs right now</h2><div class="note">Stay online. New offers appear here automatically.</div></section>`;
  const s = html.replace(/data-offered="[^"]*"/g, '').replace(/<div class="count"[\s\S]*?<\/div>/g, '<c/>');
  if (s === sig) { tick(); return; }
  sig = s; main.innerHTML = html;
  for (const o of state.offers) if (!o.viewed_at && !local.confirming) view(o.offer_id);
}
function tick() { document.querySelectorAll('[data-testid="countdown"]').forEach((el) => { const o = { offered_at: el.dataset.offered }; const tmp = document.createElement('div'); tmp.innerHTML = countdownHtml(o); el.replaceWith(tmp.firstElementChild); }); }

main.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]'); if (!b || b.disabled) return;
  const act = b.dataset.act; const trip = state.trips[0];
  if (act === 'accept') accept(b.dataset.offer); else if (act === 'decline') decline(b.dataset.offer);
  else if (act === 'next' && trip) advance(trip); else if (act === 'evidence' && trip) captureEvidence(trip);
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* optional */ });
window.addEventListener('online', () => poll()); window.addEventListener('offline', () => setConn(false));
(async () => { const pending = store.get('pending_accept'); await poll(); if (pending) accept(pending); })();   // resume an in-flight accept after refresh (idempotent)
setInterval(poll, 1500); setInterval(tick, 500);
