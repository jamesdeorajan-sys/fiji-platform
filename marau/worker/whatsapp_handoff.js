/* Marau Stage 1 (PREVIEW ONLY) — composes a WhatsApp handoff message. This
 * module NEVER sends anything and never constructs a wa.me URL — see its
 * callers and pages.js's mock interface. A Codex review found the main
 * "Talk to our team on WhatsApp" button only showed a toast (i.e. did
 * nothing useful), while the per-deal handoff DID build a real
 * `https://wa.me/...` link with real navigation — inconsistent, and the
 * wrong side won: per the mission, NEITHER path may navigate to WhatsApp
 * in this preview. Both now go through this one composer and are shown
 * in an in-page mock panel (pages.js) instead.
 *
 * BOUNDED MOBILE-COPY CORRECTIONS, finding 6: the composed text used to
 * embed raw internal IDs (`offer_id`, the deal request's own full id)
 * and a raw UTC timestamp directly in the human-readable message. Full
 * internal linkage is fully PRESERVED — every id is still returned as
 * its own structured field on the result (`request_id`, `offer_id`,
 * `booking_id`) for the ops console / assistant / tests to use — but the
 * MESSAGE TEXT itself now reads in plain English: a readable route name,
 * a short stable reference, and an explicit Fiji date/time, matching
 * exactly what the guest sees on their own selected Trip (findings 2, 3,
 * 7 — the same `humanizeZoneLabel`/`humanizeVehicleClassLabel`/
 * `formatFijiCurrency`/`shortBookingReference` used on the client side,
 * imported here rather than duplicated, and `formatFijiDateTime` from
 * fiji_time.js — the same functions, not a second copy that could drift).
 */
import { humanizeZoneLabel, humanizeVehicleClassLabel, formatFijiCurrency, shortBookingReference } from './guest_display.js';
import { formatFijiDateTime } from './fiji_time.js';

export function composeDealHandoffMessage({ opsNumber, dealRequestId, offer }) {
  const price = offer.smart_match_price ?? offer.standard_price;
  const route = `${humanizeZoneLabel(offer.origin_zone)} -> ${humanizeZoneLabel(offer.destination_zone)}`;
  return {
    to: opsNumber,
    // Full internal linkage preserved as structured fields — never
    // dropped, only kept out of the human-readable message text itself.
    request_id: dealRequestId,
    offer_id: offer.offer_id,
    message: `Marau deal request ${shortBookingReference(dealRequestId)}: guest wants ${route} (${humanizeVehicleClassLabel(offer.vehicle_class)}) at ${formatFijiCurrency(price)}. Reply to confirm or decline in the ops console.`,
    note: 'PREVIEW MOCK — this message is composed for review only. Marau never sends it and never opens WhatsApp. Confirming happens only in the ops console.',
  };
}

/**
 * Private enquiry text for ONE experience-offer request. Retains the offer and the human-readable reference so staff can
 * find the request instantly; full internal ids stay as structured fields, out of the message text. NEVER sends and never
 * builds a wa.me link - same rule as every other composer in this file.
 */
export function composeOfferHandoffMessage({ opsNumber, request, offer }) {
  const fiji = formatFijiDateTime(offer.starts_at);
  const total = formatFijiCurrency(request.total_cents / 100);
  return {
    to: opsNumber,
    reference: request.reference,
    request_id: request.request_id,
    offer_id: request.offer_id,
    message: `Marau offer enquiry ${request.reference}: ${offer.title} (${offer.location}) on ${fiji.day} at ${fiji.time} Fiji time, ${request.places} place${request.places === 1 ? '' : 's'}, ${total} total, currently "${request.status}". Guest would like to speak with the team about this offer.`,
    note: 'PREVIEW MOCK - this message is composed for review only. Marau never sends it and never opens WhatsApp.',
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
  const fiji = formatFijiDateTime(booking.pickup_datetime);
  return {
    to: opsNumber,
    // FIX (fourth independent review, finding 2): exposes WHICH booking
    // this summary is for, so the client (and this file's own tests) can
    // confirm the WhatsApp summary matches the relevant selected trip —
    // this is the row's own database id, never an internal movement/offer
    // id (those stay excluded from guest-facing copy per round 3).
    booking_id: booking.id,
    message: `Marau booking ${shortBookingReference(booking.client_booking_ref)}: ${humanizeZoneLabel(booking.pickup_zone)} -> ${humanizeZoneLabel(booking.destination_zone)} on ${fiji.day} at ${fiji.time} Fiji time, vehicle ${booking.vehicle_type}, currently "${booking.status}". Guest would like to speak with the team about this booking.`,
    note: 'PREVIEW MOCK — this message is composed for review only. Marau never sends it and never opens WhatsApp.',
  };
}
