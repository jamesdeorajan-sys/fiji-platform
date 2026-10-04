/* Marau (PREVIEW/TEST ONLY) - who can be reached how, and what may be sent.
 *
 * Kept deliberately small and pure so every surface (staff lists, offer requests, referral follow-up) derives the same
 * answer from the same facts, and so a policy change is made in exactly one place.
 *
 * Three separate questions, never conflated:
 *   1. Can the guest receive WhatsApp?            -> `whatsapp_available`: true / false / null (unknown). RECORDED,
 *      never required: a guest without WhatsApp must still be able to book and be served.
 *   2. How do we follow up when WhatsApp is not an option?  -> email fallback; a NAMED staff owner is mandatory so the
 *      case cannot fall through (see followUpPlan).
 *   3. May we send PROMOTIONAL messages?          -> `marketing_consent`, separate from the always-allowed ESSENTIAL
 *      trip communication (confirmation, driver details, changes, safety). Consent is never assumed or inferred.
 *
 * Nothing in this file sends anything.
 */

export const MARKETING_CONSENT_VALUES = Object.freeze(['unknown', 'granted', 'withheld']);

// Essential = needed to deliver the trip the guest booked. Promotional = anything whose purpose is to sell.
export const MESSAGE_PURPOSES = Object.freeze({
  essential: ['booking_confirmation', 'driver_details', 'schedule_change', 'cancellation', 'safety', 'offer_request_status'],
  promotional: ['deal_edition', 'new_offer_announcement', 'referral_invitation', 'win_back'],
});

/** Preferred channel for ESSENTIAL follow-up. WhatsApp unless the guest is known not to have it. */
export function followUpChannel(whatsappAvailable) {
  if (whatsappAvailable === false || whatsappAvailable === 0) return 'email';
  return 'whatsapp';
}

/**
 * The full plan staff see: channel, why, and who owns it. `owner` is the NAMED staff member responsible for the follow-up;
 * when none is assigned the plan says so explicitly (`owner_missing`) instead of silently dropping the guest.
 */
export function followUpPlan({ whatsappAvailable, owner }) {
  const channel = followUpChannel(whatsappAvailable);
  const known = whatsappAvailable === true || whatsappAvailable === 1;
  return {
    channel,
    reason:
      channel === 'email'
        ? 'guest has no WhatsApp: follow up by email (and phone call if urgent)'
        : known
          ? 'guest can receive WhatsApp'
          : 'WhatsApp availability unknown: try WhatsApp, fall back to email if undelivered',
    fallback: channel === 'email' ? 'phone' : 'email',
    owner: owner || null,
    owner_missing: !owner,
  };
}

/** May a message with this purpose be sent to a guest with this consent? Essential: always. Promotional: only if granted. */
export function maySend({ purpose, marketingConsent }) {
  if (MESSAGE_PURPOSES.essential.includes(purpose)) return true;
  if (MESSAGE_PURPOSES.promotional.includes(purpose)) return marketingConsent === 'granted';
  return false; // an unrecognised purpose is never assumed to be allowed
}
