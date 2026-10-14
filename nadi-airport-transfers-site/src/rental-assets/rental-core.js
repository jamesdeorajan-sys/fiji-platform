// Nadi Airport car-rental request form: validation and message helpers (browser module, no dependencies).
// The server (nadi-dispatch-api, rental.mjs) re-validates everything; these rules mirror it so guests see the same message before sending.
// A test (test/rental-page.test.js) runs both implementations over the same cases and fails if they ever disagree.

export const CONSENT_VERSION = 'rental-consent-2026-10-14';
const MAX_RENTAL_DAYS = 120;
const MAX_ADVANCE_DAYS = 550;

// Current Fiji local date and time as YYYY-MM-DDTHH:MM (Pacific/Fiji, whatever the visitor's own time zone is).
export function fijiNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Fiji', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const v = (t) => parts.find((p) => p.type === t)?.value;
  return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}`;
}
function validDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return false;
  const x = new Date(d + 'T00:00:00Z');
  return Number.isFinite(x.getTime()) && x.toISOString().slice(0, 10) === d;
}
function dayDiff(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Returns an error message, or '' when the trip step is valid.
export function validateTrip(d, now = fijiNow()) {
  if (!validDate(d.pickupDate) || !validDate(d.returnDate) || !TIME_RE.test(d.pickupTime || '') || !TIME_RE.test(d.returnTime || '')) return 'Please enter valid collection and return dates and times.';
  const start = d.pickupDate + 'T' + d.pickupTime;
  const end = d.returnDate + 'T' + d.returnTime;
  if (start < now) return 'Collection must be in the future, using Fiji local time.';
  if (end <= start) return 'Return must be after collection.';
  if (dayDiff(now.slice(0, 10), d.pickupDate) > MAX_ADVANCE_DAYS) return 'Collection is too far ahead. Please contact the team on WhatsApp.';
  if (dayDiff(d.pickupDate, d.returnDate) > MAX_RENTAL_DAYS) return `Rentals over ${MAX_RENTAL_DAYS} days need a conversation. Please contact the team on WhatsApp.`;
  const blank = (x) => x === undefined || x === null || String(x).trim() === '';
  const pax = Number(d.passengers), bags = Number(d.bags);
  if (blank(d.passengers) || blank(d.bags) || !Number.isInteger(pax) || pax < 1 || pax > 30 || !Number.isInteger(bags) || bags < 0 || bags > 30) return 'Please check the number of people and bags.';
  if ((String(d.pickup || '').startsWith('Other') || String(d.dropoff || '').startsWith('Other')) && !String(d.notes || '').trim()) return 'Please include your other collection or return address in the notes.';
  return '';
}

// '+' or '00' followed by 8-15 digits: a number without a country code cannot safely become a WhatsApp link.
export function normalisePhone(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s || s.length > 40 || /[^0-9+\s().\-]/.test(s)) return null;
  let digits = s.replace(/\D/g, '');
  if (s.startsWith('+')) { /* international */ } else if (s.startsWith('00')) digits = digits.slice(2); else return null;
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
  return '+' + digits;
}

// Returns { field, message } for the first problem on the contact step, or null.
export function validateContact(d) {
  const name = String(d.name || '').trim();
  if (name.length < 2 || name.length > 120 || /(?:\d[ \-]?){13,19}/.test(name)) return { field: 'name', message: 'Please enter your name.' };
  if (!normalisePhone(d.phone)) return { field: 'phone', message: 'Please enter your WhatsApp number with its country code, for example +61 400 000 000.' };
  const email = String(d.email || '').trim();
  if (email && (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { field: 'email', message: 'That email address does not look right. It is optional, so you can leave it blank.' };
  if (!d.age) return { field: 'age', message: 'Please choose the driver age band.' };
  const lic = String(d.licenceCountry || '').trim();
  if (lic.length < 2 || /\d/.test(lic)) return { field: 'licenceCountry', message: 'Please enter the country that issued the driving licence (country only, no licence number).' };
  const flight = String(d.flight || '').trim();
  if (flight && !/^[A-Za-z0-9][A-Za-z0-9 \-]{1,29}$/.test(flight)) return { field: 'flight', message: 'Flight number format looks wrong. It is optional.' };
  const notes = String(d.notes || '').trim();
  if (notes.length > 1000) return { field: 'notes', message: 'Please keep your notes under 1000 characters.' };
  if (/(?:\d[ \-]?){13,19}/.test(notes)) return { field: 'notes', message: 'Please do not enter card, passport or licence numbers. We only need your plans here.' };
  if (!d.consentShare || !d.consentWhatsappGroup) return { field: 'consentShare', message: 'Please tick both boxes so we can share your details with the rental partner and add you to a WhatsApp group.' };
  return null;
}

export function summary(d) {
  return [
    `Vehicle preference: ${d.vehicle}`,
    `Collect: ${d.pickupDate} ${d.pickupTime} at ${d.pickup}`,
    `Return: ${d.returnDate} ${d.returnTime} at ${d.dropoff}`,
    `${d.passengers} people, ${d.bags} bags`,
    'All dates and times are Fiji local time.',
    'The partner confirms the vehicle, price and rental terms.',
  ].join('\n');
}

// Used only for the optional "message us now" button and the WhatsApp fallback when the request could not be saved online.
export function whatsappMessage(d, ref) {
  return [
    'Bula NAT, please help arrange a rental quote with Best Adventure Fiji.',
    ref ? 'Rental reference: ' + ref : 'WhatsApp-only enquiry. Not saved online.',
    summary(d),
    'Name: ' + d.name,
    'WhatsApp: ' + d.phone,
    'Email: ' + (d.email || 'Not provided'),
    'Driver age: ' + d.age,
    'Licence country: ' + d.licenceCountry,
    'Flight: ' + (d.flight || 'Not provided'),
    'Notes: ' + (d.notes || 'None'),
    'I agree to sharing these enquiry details with the assigned rental agent and joining a WhatsApp group.',
  ].join('\n');
}
