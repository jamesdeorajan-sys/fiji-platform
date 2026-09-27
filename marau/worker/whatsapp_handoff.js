/* Marau Stage 1 (PREVIEW ONLY) — composes a WhatsApp handoff message. This
 * module NEVER sends anything and never constructs a wa.me URL — see its
 * callers and pages.js's mock interface. A Codex review found the main
 * "Talk to our team on WhatsApp" button only showed a toast (i.e. did
 * nothing useful), while the per-deal handoff DID build a real
 * `https://wa.me/...` link with real navigation — inconsistent, and the
 * wrong side won: per the mission, NEITHER path may navigate to WhatsApp
 * in this preview. Both now go through this one composer and are shown
 * in an in-page mock panel (pages.js) instead.
 */

export function composeDealHandoffMessage({ opsNumber, dealRequestId, offer }) {
  const price = offer.smart_match_price ?? offer.standard_price;
  return {
    to: opsNumber,
    message: `Marau deal request ${dealRequestId}: guest wants offer ${offer.offer_id} (${offer.origin_zone} -> ${offer.destination_zone}, ${offer.vehicle_class}) at ${price}. Reply to confirm or decline in the ops console.`,
    note: 'PREVIEW MOCK — this message is composed for review only. Marau never sends it and never opens WhatsApp. Confirming happens only in the ops console.',
  };
}

export function composeTripHandoffMessage({ opsNumber, booking }) {
  if (!booking) {
    return {
      to: opsNumber,
      booking_id: null,
      message: 'Marau guest has no booking yet and would like to talk to the team.',
      note: 'PREVIEW MOCK — this message is composed for review only. Marau never sends it and never opens WhatsApp.',
    };
  }
  return {
    to: opsNumber,
    // FIX (fourth independent review, finding 2): exposes WHICH booking
    // this summary is for, so the client (and this file's own tests) can
    // confirm the WhatsApp summary matches the relevant selected trip —
    // this is the row's own database id, never an internal movement/offer
    // id (those stay excluded from guest-facing copy per round 3).
    booking_id: booking.id,
    message: `Marau booking ${booking.client_booking_ref}: ${booking.pickup_zone} -> ${booking.destination_zone} on ${booking.pickup_datetime}, vehicle ${booking.vehicle_type}, currently "${booking.status}". Guest would like to speak with the team about this booking.`,
    note: 'PREVIEW MOCK — this message is composed for review only. Marau never sends it and never opens WhatsApp.',
  };
}
