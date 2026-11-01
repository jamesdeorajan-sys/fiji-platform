/* Minimal versioned snapshot of what the AUTHORITATIVE source says about a booking (read-only mirror, with provenance).
 * Nothing is invented or recomputed: a field the source does not carry stays NULL and is recorded as 'not_in_source'.
 * FINDING (nadi-dispatch-api `bookings`, branch ceo/nadi-booking-read-itinerary): the source stores flight_number, quoted_currency and
 * quoted_amount (the final total as saved), but has NO passengers, luggage, add-on or discount column. The optional fields below are
 * accepted ONLY if a future source contract supplies them; today they are 'not_in_source'. */
export const SNAPSHOT_FIELDS = ['currency', 'total_minor', 'flight_number', 'passengers', 'luggage', 'add_ons', 'discount_minor'];
const minor = (n) => { if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null; const m = Math.round(n * 100); return Math.abs(m / 100 - n) < 1e-9 && Number.isSafeInteger(m) ? m : null; };
const cnt = (n) => (Number.isInteger(n) && n >= 0 && n <= 99 ? n : null);

/** reader output (nadi_booking_reader shape) -> snapshot row. */
export function snapshotFromSource(bookingRef, src, provenance, nowMs) {
  const total = src.quoted_amount == null ? null : minor(src.quoted_amount);
  const vals = { currency: typeof src.quoted_currency === 'string' && /^[A-Z]{3}$/.test(src.quoted_currency) ? src.quoted_currency : null, total_minor: total, flight_number: typeof src.flight_number === 'string' && src.flight_number.trim() ? src.flight_number.trim().slice(0, 20) : null,
    passengers: cnt(src.passengers), luggage: cnt(src.luggage_count), add_ons: typeof src.add_ons === 'string' && src.add_ons.trim() ? src.add_ons.trim().slice(0, 300) : null, discount_minor: src.discount_amount == null ? null : minor(src.discount_amount) };
  const availability = Object.fromEntries(SNAPSHOT_FIELDS.map((k) => [k, vals[k] == null ? 'not_in_source' : 'source']));
  if (src.quoted_amount != null && total == null) availability.total_minor = 'rejected_not_whole_cents';
  return { booking_ref: bookingRef, source_kind: 'nadi_dispatch_api', source_ref: src.source_booking_ref ?? null, provenance, captured_at: nowMs, ...vals, availability };
}
/** Synthetic Marau form booking -> snapshot (clearly labelled; only what the form really holds). */
export function snapshotFromMarauRow(b, nowMs, defaultCurrency) {
  const total = typeof b.quoted_amount === 'number' ? minor(b.quoted_amount) : null;
  const vals = { currency: b.source_currency || defaultCurrency || null, total_minor: b.source_total_cents ?? total, flight_number: null, passengers: null, luggage: null, add_ons: null, discount_minor: null };
  const availability = Object.fromEntries(SNAPSHOT_FIELDS.map((k) => [k, vals[k] == null ? 'not_in_source' : 'marau_form']));
  return { booking_ref: b.client_booking_ref, source_kind: 'marau_synthetic_form', source_ref: null, provenance: { kind: 'marau_synthetic_form', authenticated: false }, captured_at: nowMs, ...vals, availability };
}
/** Insert a new version only if something changed (idempotent re-reads do not churn versions). */
export async function saveSnapshot(db, s) {
  const cur = await db.prepare('SELECT * FROM bula_booking_snapshots WHERE booking_ref = ?').bind(s.booking_ref).first();
  const next = { currency: s.currency, total_minor: s.total_minor, flight_number: s.flight_number, passengers: s.passengers, luggage: s.luggage, add_ons_json: s.add_ons == null ? null : JSON.stringify(s.add_ons), discount_minor: s.discount_minor };
  if (cur && Object.keys(next).every((k) => (cur[k] ?? null) === (next[k] ?? null)) && cur.source_kind === s.source_kind) return { version: cur.version, changed: false };
  const v = cur ? cur.version + 1 : 1;
  await db.prepare(`INSERT INTO bula_booking_snapshots (booking_ref, version, source_kind, source_ref, provenance_json, captured_at, currency, total_minor, flight_number, passengers, luggage, add_ons_json, discount_minor, availability_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(booking_ref) DO UPDATE SET version = excluded.version, source_kind = excluded.source_kind, source_ref = excluded.source_ref, provenance_json = excluded.provenance_json, captured_at = excluded.captured_at,
      currency = excluded.currency, total_minor = excluded.total_minor, flight_number = excluded.flight_number, passengers = excluded.passengers, luggage = excluded.luggage, add_ons_json = excluded.add_ons_json, discount_minor = excluded.discount_minor, availability_json = excluded.availability_json`)
    .bind(s.booking_ref, v, s.source_kind, s.source_ref, JSON.stringify(s.provenance), s.captured_at, next.currency, next.total_minor, next.flight_number, next.passengers, next.luggage, next.add_ons_json, next.discount_minor, JSON.stringify(s.availability)).run();
  return { version: v, changed: true };
}
