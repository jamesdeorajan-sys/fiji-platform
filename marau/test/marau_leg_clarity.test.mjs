/* Marau (PREVIEW/TEST ONLY) - phone feedback: return date/time and route clarity. Red-first against branch ceo/marau-pilot-readiness
 * (RC2 candidate 2b8faea). Synthetic data; default-deny network. Evidence label: LOCAL, AUTHOR-RUN (the client renderers are executed
 * from the SERVED page text).
 *
 * James's screenshots showed the older RC1 test form with "Return transfer" selected, Nadi Airport -> Denarau still entered and ONE generic
 * pickup date/time. These tests pin: (1) each leg shows ITS OWN recorded date, pickup time, pickup location, destination and status, labelled
 * "Fiji time", with the year; (2) nothing is reused from another leg or inferred; (3) missing values read "Awaiting pickup details";
 * (4) the synthetic form asks for the right fields and refuses a contradictory direction instead of silently saving it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv, synthGuest } from './fixtures.mjs';
import worker from '../worker/worker.js';
import { GUEST_APP_HTML } from '../worker/pages.js';
import { formatFijiCurrency } from '../worker/guest_display.js';
import { formatFijiDateTime } from '../worker/fiji_time.js';

installNetworkGuard();

const call = async (env, p, { method = 'POST', body, headers = {} } = {}) => {
  const res = await worker.fetch(new Request('http://marau.test' + p, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, text };
};
const guestH = (t) => ({ authorization: `Bearer ${t}` });
const rows = async (env) => (await env.DB.prepare('SELECT * FROM marau_test_bookings ORDER BY id').all()).results.map((r) => ({ ...r }));
const iso = (d, h = 0) => new Date(Date.now() + d * 86400_000 + h * 3600_000).toISOString().slice(0, 16);
const base = (over = {}) => synthGuest({ pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', leg_type: 'arrival', pickup_datetime: '2031-10-06T09:00', quoted_amount: 80, ...over });

// ============================================================ 1. SERVER: direction and the round-trip fixture

test('A CONTRADICTORY DIRECTION IS FLAGGED, NOT SAVED: "Return to airport" with Nadi Airport -> Denarau is refused with a clear message and nothing is stored', async () => {
  const env = makeEnv();
  const r = await call(env, '/preview/bookings', { body: base({ leg_type: 'return' }) });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  const msg = r.data.details.join(' ');
  assert.match(msg, /return to the airport/i); assert.match(msg, /Nadi Airport/); assert.match(msg, /starts at the airport/i);
  assert.equal((await rows(env)).length, 0, 'nothing was saved');
  const arr = await call(env, '/preview/bookings', { body: base({ leg_type: 'arrival', pickup_zone: 'Denarau', destination_zone: 'Nadi Airport' }) });
  assert.equal(arr.status, 400); assert.match(arr.data.details.join(' '), /arrival/i);
  assert.equal((await rows(env)).length, 0);
});

test('A STANDALONE RETURN is saved with ITS OWN pickup date/time (the "Return pickup date & time"), pickup location and airport destination', async () => {
  const env = makeEnv();
  const r = await call(env, '/preview/bookings', { body: base({ leg_type: 'return', pickup_zone: 'Sofitel Denarau lobby', destination_zone: 'Nadi Airport', pickup_datetime: '2031-10-13T10:30' }) });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const [row] = await rows(env);
  assert.deepEqual([row.leg_type, row.pickup_zone, row.destination_zone, row.pickup_datetime], ['return', 'Sofitel Denarau lobby', 'Nadi Airport', '2031-10-12T22:30:00.000Z']); // 10:30 Fiji (UTC+12)
});

test('A ROUND-TRIP FIXTURE needs SEPARATE arrival and return fields and creates two legs with their own times, locations and amounts - nothing reused', async () => {
  const env = makeEnv();
  const ok = await call(env, '/preview/bookings', { body: base({ leg_type: 'round_trip', pickup_datetime: '2031-10-06T09:00', quoted_amount: 80, return_pickup_datetime: '2031-10-13T10:30', return_pickup_zone: 'Sofitel Denarau lobby', return_quoted_amount: 90 }) });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const rs = await rows(env);
  assert.equal(rs.length, 2);
  const [a, b] = rs;
  assert.deepEqual([a.leg_type, a.pickup_zone, a.destination_zone, a.pickup_datetime, a.quoted_amount], ['arrival', 'Nadi Airport', 'Denarau', '2031-10-05T21:00:00.000Z', 80]);
  assert.deepEqual([b.leg_type, b.pickup_zone, b.destination_zone, b.pickup_datetime, b.quoted_amount], ['return', 'Sofitel Denarau lobby', 'Nadi Airport', '2031-10-12T22:30:00.000Z', 90]);
  assert.equal(a.guest_session_id, b.guest_session_id);
  const trip = (await call(env, '/preview/trip', { method: 'GET', headers: guestH(ok.data.access_token) })).data;
  assert.deepEqual(trip.bookings.map((x) => x.leg_type), ['arrival', 'return']);
  // each missing field is named; nothing is silently defaulted from the arrival
  for (const [drop, pattern] of [['return_pickup_datetime', /return pickup date/i], ['return_pickup_zone', /return pickup location/i], ['return_quoted_amount', /return fare|return amount/i]]) {
    const body = base({ leg_type: 'round_trip', return_pickup_datetime: '2031-10-13T10:30', return_pickup_zone: 'Sofitel Denarau lobby', return_quoted_amount: 90 }); delete body[drop];
    const bad = await call(makeEnv(), '/preview/bookings', { body });
    assert.equal(bad.status, 400, drop); assert.match(bad.data.details.join(' '), pattern, drop);
  }
  const before = await call(makeEnv(), '/preview/bookings', { body: base({ leg_type: 'round_trip', return_pickup_datetime: '2031-10-05T08:00', return_pickup_zone: 'Sofitel Denarau lobby', return_quoted_amount: 90 }) });
  assert.equal(before.status, 400); assert.match(before.data.details.join(' '), /after the arrival/i);
  const wrongWay = await call(makeEnv(), '/preview/bookings', { body: base({ leg_type: 'round_trip', return_pickup_datetime: '2031-10-13T10:30', return_pickup_zone: 'Nadi Airport', return_quoted_amount: 90 }) });
  assert.equal(wrongWay.status, 400); assert.match(wrongWay.data.details.join(' '), /return to the airport/i);
});

test('A retried round-trip submit never duplicates the return leg', async () => {
  const env = makeEnv();
  const body = base({ leg_type: 'round_trip', client_booking_ref: 'MARAU-RT-FIXED-1', attempt_secret: 'secret-1', return_pickup_datetime: '2031-10-13T10:30', return_pickup_zone: 'Sofitel Denarau lobby', return_quoted_amount: 90 });
  assert.equal((await call(env, '/preview/bookings', { body })).status, 201);
  const again = await call(env, '/preview/bookings', { body });
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal((await rows(env)).length, 2);
});

// ============================================================ 2. CLIENT: each leg shows its own recorded values

function loadClient() {
  const start = GUEST_APP_HTML.indexOf('function createOffersClient(deps)');
  assert.ok(start !== -1);
  const shim = GUEST_APP_HTML.slice(GUEST_APP_HTML.indexOf('var __name = function'), GUEST_APP_HTML.indexOf('};', GUEST_APP_HTML.indexOf('var __name = function')) + 2);
  const end = GUEST_APP_HTML.indexOf('\n}\n', start) + 3;
  const create = new Function(`${shim}\n${GUEST_APP_HTML.slice(start, end)}\nreturn createOffersClient;`)();
  const store = new Map();
  return create({ authFetch: async () => ({ ok: true, data: {} }), toast() {}, renderMockWhatsApp() {}, formatFijiCurrency, formatFijiDateTime, humanizeZoneLabel: (z) => z, els: {}, storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } });
}
const arrival = (o = {}) => ({ id: 1, leg_type: 'arrival', leg_key: 'arrival', pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', pickup_datetime: '2031-10-05T21:00:00.000Z', status: 'confirmed', client_booking_ref: 'REAL-SYNC-1', ...o });
const ret = (o = {}) => ({ id: 2, leg_type: 'return', leg_key: 'return', pickup_zone: 'Sofitel Denarau lobby', destination_zone: 'Nadi Airport', pickup_datetime: '2031-10-12T22:30:00.000Z', status: 'confirmed', pickup_basis: 'recorded', client_booking_ref: 'REAL-SYNC-1-RETURN', ...o });

test('ARRIVAL card: role, date WITH YEAR, pickup time labelled Fiji time, pickup location, destination, status', () => {
  const c = loadClient();
  const html = c.legCardHtml(arrival());
  assert.match(html, /ARRIVAL/);
  assert.match(html, /Monday, Oct 6, 2031/);
  assert.match(html, /9:00 AM Fiji time/);
  assert.match(html, /Pickup time/); assert.match(html, /Pickup location[\s\S]*Nadi Airport/); assert.match(html, /Destination[\s\S]*Denarau/); assert.match(html, /Status[\s\S]*Confirmed/);
});

test('RETURN TO AIRPORT card: return date WITH YEAR, HOTEL pickup time labelled Fiji time, the exact recorded pickup location, airport destination, status - and NONE of the arrival\'s values', () => {
  const c = loadClient();
  const html = c.legCardHtml(ret());
  assert.match(html, /RETURN TO AIRPORT/);
  assert.match(html, /Return date[\s\S]*Monday, Oct 13, 2031/);
  assert.match(html, /Hotel pickup time[\s\S]*10:30 AM Fiji time/);
  assert.match(html, /Pickup location[\s\S]*Sofitel Denarau lobby/);
  assert.match(html, /Destination[\s\S]*Nadi Airport/);
  assert.match(html, /Status[\s\S]*Confirmed/);
  for (const arrivalValue of ['Oct 6', '9:00 AM', 'ARRIVAL']) assert.equal(html.includes(arrivalValue), false, `the return card must not carry the arrival's "${arrivalValue}"`);
});

test('MISSING VALUES read "Awaiting pickup details" - a recorded value is never guessed, and an inferred hotel pickup is not shown as recorded', () => {
  const c = loadClient();
  const noTime = c.legCardHtml(ret({ pickup_datetime: null }));
  assert.equal((noTime.match(/Awaiting pickup details/g) || []).length >= 2, true, 'date and time both awaiting');
  assert.equal(/10:30|Oct 13/.test(noTime), false);
  const inferred = c.legCardHtml(ret({ pickup_basis: 'inferred_from_outbound_destination', pickup_zone: 'Denarau' }));
  assert.match(inferred, /Pickup location[\s\S]*Awaiting pickup details/);
  assert.equal(/Pickup location[\s\S]{0,80}Denarau/.test(inferred), false, 'an inferred location is not presented as recorded');
  const noZone = c.legCardHtml(ret({ pickup_zone: '' }));
  assert.match(noZone, /Pickup location[\s\S]*Awaiting pickup details/);
});

test('A BOOKING WHOSE RETURN DETAILS ARE MISSING at the source still shows a RETURN TO AIRPORT section reading "Awaiting pickup details" (never the arrival\'s date, never a guess)', () => {
  const c = loadClient();
  const html = c.journeyHtml([arrival({ return_leg_state: 'missing_return_details' })]);
  assert.match(html, /ARRIVAL/); assert.match(html, /RETURN TO AIRPORT/);
  const returnPart = html.slice(html.indexOf('RETURN TO AIRPORT'));
  assert.equal((returnPart.match(/Awaiting pickup details/g) || []).length >= 4, true, 'date, time, location, status all awaiting');
  assert.equal(returnPart.includes('Oct 6'), false); assert.equal(returnPart.includes('9:00 AM'), false);
});

test('JOURNEY overview lists both legs in order, each with its own date+year and Fiji time; legs are labelled by role; an uncertain status is stated plainly', () => {
  const c = loadClient();
  const html = c.journeyHtml([ret({ status: 'pending', status_uncertainty: 'source_completed_while_return_upcoming' }), arrival()]);
  assert.ok(html.indexOf('ARRIVAL') < html.indexOf('RETURN TO AIRPORT'), 'chronological order');
  assert.match(html, /Oct 6, 2031/); assert.match(html, /Oct 13, 2031/);
  assert.equal((html.match(/Fiji time/g) || []).length >= 2, true);
  assert.match(html, /Awaiting human confirmation/);
  assert.match(c.legChipLabel(ret()), /RETURN TO AIRPORT/); assert.match(c.legChipLabel(ret()), /2031/);
});

test('every server-supplied string on the leg cards is escaped', () => {
  const c = loadClient();
  const html = c.legCardHtml(ret({ pickup_zone: '<img src=x onerror=alert(1)>', destination_zone: '"><script>x</script>' }));
  assert.equal(html.includes('<img src=x'), false); assert.equal(html.includes('<script>'), false);
});

test('the Trip view renders through the leg cards (the served page uses them)', () => {
  assert.match(GUEST_APP_HTML, /offersClient\.journeyHtml\(/); // journeyHtml renders every leg through legCardHtml
  assert.match(GUEST_APP_HTML, /offersClient\.legChipLabel\(/);
  assert.equal(GUEST_APP_HTML.includes('`'), false);
});

// ============================================================ 3. THE SYNTHETIC TEST FORM

test('FORM: offers Arrival / Return to airport / Round trip; labels the date fields for the chosen leg; round trip has SEPARATE arrival and return fields', () => {
  assert.match(GUEST_APP_HTML, /<option value="arrival">Arrival transfer/);
  assert.match(GUEST_APP_HTML, /<option value="return">Return to airport \(standalone\)/);
  assert.match(GUEST_APP_HTML, /<option value="round_trip">Round trip \(arrival \+ return\)/);
  for (const id of ['f-return-when', 'f-return-pickup', 'f-return-amount', 'f-when-label', 'f-pickup-label', 'f-dest-label', 'legHint']) assert.match(GUEST_APP_HTML, new RegExp(`id="${id}"`), id);
  assert.match(GUEST_APP_HTML, /Return pickup date &amp; time \(Fiji time\)/);
  assert.match(GUEST_APP_HTML, /Arrival pickup date &amp; time \(Fiji time\)/);
  assert.match(GUEST_APP_HTML, /return_pickup_datetime/);
});

test('FORM direction guard (client): a contradictory direction is explained before anything is sent', () => {
  const c = loadClient();
  assert.match(c.legDirectionProblem('return', 'Nadi Airport', 'Denarau'), /starts at the airport/i);
  assert.match(c.legDirectionProblem('arrival', 'Denarau', 'Nadi Airport'), /ends at the airport/i);
  assert.equal(c.legDirectionProblem('return', 'Sofitel Denarau lobby', 'Nadi Airport'), null);
  assert.equal(c.legDirectionProblem('arrival', 'Nadi Airport', 'Denarau'), null);
  assert.equal(c.legDirectionProblem('arrival', 'Denarau', 'Coral Coast'), null, 'a journey with no airport end is not guessed at');
});
