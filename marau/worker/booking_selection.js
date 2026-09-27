/* Marau Stage 1 (PREVIEW ONLY) — one shared rule for "which booking is
 * the default one to show/act on," used by BOTH the guest app's pickup
 * card (client) and the WhatsApp handoff composer (server), so the two
 * can never disagree about which trip is "the" current one.
 *
 * FIX (fourth independent review, finding 2 — pickup accuracy): the
 * render function picked the booking with the soonest pickup_datetime
 * with NO status filter at all — an old, cancelled or declined booking
 * with an earlier timestamp than a real upcoming one was wrongly shown
 * as "Next pickup." The rule now is: the soonest booking that is both
 * ACTIVE (not declined/cancelled) and still upcoming (pickup_datetime in
 * the future). Full history stays selectable in the guest app's own
 * switcher — this function only decides the DEFAULT, never hides
 * anything.
 */

export const ACTIVE_BOOKING_STATUSES = ['pending', 'confirmed', 'confirmed_unallocated'];

export function isActiveBookingStatus(status) {
  return ACTIVE_BOOKING_STATUSES.indexOf(status) !== -1;
}

/**
 * `bookings` is any array of objects carrying at least `status` and
 * `pickup_datetime`. Returns the single best default, or null if the
 * array is empty.
 *
 * Priority: soonest UPCOMING active booking; if none is upcoming, the
 * most recent PAST active booking (so a guest whose whole trip is behind
 * them still sees something sensible rather than an arbitrary declined
 * row); if there is no active booking at all, the soonest booking
 * regardless of status (last resort — never render nothing when a row
 * exists).
 */
export function selectDefaultBooking(bookings, nowIso) {
  if (!bookings || bookings.length === 0) return null;
  var now = nowIso || new Date().toISOString();
  var active = bookings.filter(function (b) { return ACTIVE_BOOKING_STATUSES.indexOf(b.status) !== -1; });

  var upcomingActive = active.filter(function (b) { return b.pickup_datetime >= now; });
  if (upcomingActive.length > 0) {
    return upcomingActive.slice().sort(function (a, b) { return new Date(a.pickup_datetime) - new Date(b.pickup_datetime); })[0];
  }

  if (active.length > 0) {
    return active.slice().sort(function (a, b) { return new Date(b.pickup_datetime) - new Date(a.pickup_datetime); })[0];
  }

  return bookings.slice().sort(function (a, b) { return new Date(a.pickup_datetime) - new Date(b.pickup_datetime); })[0];
}
