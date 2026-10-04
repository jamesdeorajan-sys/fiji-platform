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

// ---------------------------------------------------------------------------------------------------------------
// Server-side validation. The real transfer sites require phone client-side and enforce only phone server-side (Issue
// #59's own open item); Marau enforces BOTH from the start, with checks stricter than a bare pattern match.
// ---------------------------------------------------------------------------------------------------------------

/** Returns the digits-with-optional-leading-plus form when `raw` is a plausible phone number, else null. */
export function validatePhone(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^[+0-9()\-.\s]+$/.test(trimmed)) return null;
  const plus = trimmed.startsWith('+') ? '+' : '';
  if (trimmed.indexOf('+', 1) !== -1) return null; // a plus is only ever a leading international prefix
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (digits.length < 7 || digits.length > 15) return null; // E.164 allows at most 15 digits
  if (/^(\d)\1+$/.test(digits)) return null; // 0000000, 1111111...: placeholder numbers
  return plus + digits;
}

/** Returns the lower-cased address when `raw` is a plausible email address, else null. */
export function validateEmail(raw) {
  if (typeof raw !== 'string') return null;
  const e = raw.trim();
  if (e.length < 6 || e.length > 254) return null;
  const at = e.indexOf('@');
  if (at < 1 || at !== e.lastIndexOf('@')) return null;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (local.length > 64 || /\s/.test(e) || e.includes('..')) return null;
  if (local.startsWith('.') || local.endsWith('.')) return null;
  const labels = domain.split('.');
  if (labels.length < 2) return null;
  if (!labels.every((l) => l.length >= 1 && l.length <= 63 && /^[A-Za-z0-9-]+$/.test(l) && !l.startsWith('-') && !l.endsWith('-'))) return null;
  if (labels[labels.length - 1].length < 2) return null;
  return e.toLowerCase();
}
