/* Marau Stage 1 (PREVIEW/TEST ONLY) — bounded AI assistance.
 *
 * PREVIEW STUB, not a real AI call. Per the mission's explicit instruction
 * ("Do not send customer data to a new AI provider; use synthetic data in
 * preview and identify the proposed production integration for review"),
 * this module makes NO network call and NO LLM call of any kind. It is a
 * small, fully deterministic rule engine over the guest's OWN booking rows
 * and the ALREADY-APPROVED offer rows passed in — nothing else. It cannot
 * invent a price, an availability figure, a pickup instruction, or a
 * confirmation status, because it has no code path that writes a field it
 * wasn't given verbatim from a real row.
 *
 * ---- Proposed production integration (for review, not implemented) ----
 * A real assistant would call the Claude API (model: claude-sonnet-5 or
 * later at time of build) server-side only, from this same Worker, never
 * from the guest's browser. The prompt would be scoped to exactly this
 * guest's own booking rows and the offer rows already returned by
 * GET /preview/deals for their session — never the full deals table,
 * never other guests' data, never raw D1 access. It would need: a
 * decision from James on which Cloudflare secret binding holds the API
 * key, a real system prompt review (this file's rules — no invented
 * prices/availability/confirmation status, always disclose it's AI,
 * always keep "Talk to our team on WhatsApp" visible, never claim 24/7
 * human staffing without confirmed coverage), and a rate limit per
 * guest_session_id before any real key is wired in. None of that exists
 * yet — this file is the bounded placeholder that keeps that door open
 * without opening it.
 */

export const AI_DISCLOSURE =
  'This is Marau’s automated assistant, not a person. It only uses your booking details and approved offers — nothing is invented.';

// No claim of round-the-clock staffing without a real, James-confirmed
// coverage decision — see docs/MARAU_STAGE1_REVIEW_PACKAGE.md.
export const HUMAN_HANDOFF_LABEL = 'Talk to our team on WhatsApp';

function zonesOf(booking) {
  return [booking.pickup_zone, booking.destination_zone].filter(Boolean);
}

/**
 * Ranks already-approved offers (status ACTIVE or VALIDATED, never
 * DISCOVERED/HELD/FILLED/EXPIRED) against the guest's own bookings. Every
 * field in the output is copied verbatim from a real offer row — nothing
 * is computed, guessed, or invented.
 */
export function rankOffersForGuest(offers, bookings) {
  const knownZones = new Set(bookings.flatMap(zonesOf));
  const eligible = offers.filter((o) => o.status === 'ACTIVE' || o.status === 'VALIDATED');

  const scored = eligible.map((offer) => {
    const zoneMatch = knownZones.has(offer.origin_zone) || knownZones.has(offer.destination_zone);
    return { offer, zoneMatch };
  });

  scored.sort((a, b) => {
    if (a.zoneMatch !== b.zoneMatch) return a.zoneMatch ? -1 : 1;
    return new Date(a.offer.earliest_pickup).getTime() - new Date(b.offer.earliest_pickup).getTime();
  });

  return scored.map(({ offer, zoneMatch }) => ({
    offer_id: offer.offer_id,
    origin_zone: offer.origin_zone,
    destination_zone: offer.destination_zone,
    vehicle_class: offer.vehicle_class,
    price: offer.smart_match_price ?? offer.standard_price,
    expires_at: offer.expires_at,
    reason: zoneMatch
      ? 'Matches a route on one of your existing bookings.'
      : 'Currently available; does not overlap a route you’ve already booked.',
  }));
}

/**
 * Answers a routine guest question from real booking data only. Anything
 * outside its narrow known-field vocabulary defers to the human handoff
 * rather than guessing — this is the "must not invent pickup instructions
 * or confirmation status" rule made concrete.
 */
export function answerRoutineQuestion(question, bookings) {
  const q = (question || '').toLowerCase();
  const soonest = [...bookings].sort(
    (a, b) => new Date(a.pickup_datetime).getTime() - new Date(b.pickup_datetime).getTime()
  )[0];

  if (!soonest) {
    return {
      answered: false,
      text: 'I don’t see a booking on this trip yet.',
    };
  }

  if (/pickup|when|time|collect/.test(q)) {
    return {
      answered: true,
      text: `Your next pickup (booking ${soonest.client_booking_ref}) is recorded as ${soonest.pickup_datetime}, from ${soonest.pickup_zone} to ${soonest.destination_zone}. This is exactly what's on file — I can't change it here.`,
    };
  }

  if (/status|confirm/.test(q)) {
    return {
      answered: true,
      text: `Booking ${soonest.client_booking_ref} is currently "${soonest.status}". Only our human operations team can confirm a booking — I can't do that for you.`,
    };
  }

  if (/vehicle|car|van/.test(q)) {
    return {
      answered: true,
      text: `Booking ${soonest.client_booking_ref} is on file as vehicle type "${soonest.vehicle_type}".`,
    };
  }

  return {
    answered: false,
    text: `I can help with pickup times, booking status and vehicle details from what's on file. For anything else, ${HUMAN_HANDOFF_LABEL} is the fastest way to reach a person.`,
  };
}

export function buildAssistResponse({ question, bookings, offers }) {
  const answer = answerRoutineQuestion(question, bookings);
  const ranked = rankOffersForGuest(offers, bookings);
  return {
    ai: true,
    disclosure: AI_DISCLOSURE,
    answer: answer.text,
    answered_from_records: answer.answered,
    ranked_offers: ranked,
    human_handoff_label: HUMAN_HANDOFF_LABEL,
  };
}
