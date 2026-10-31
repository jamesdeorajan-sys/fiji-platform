/* Bula Happiness runtime configuration. EVERYTHING defaults OFF. Names only; no secret values live in the repo. */
const on = (v) => v === 'on' || v === 'true' || v === '1';
export function loadConfig(env = {}) {
  return Object.freeze({
    outboxEnabled: on(env.BULA_OUTBOX_ENABLED),          // enqueue jobs on saved bookings
    emailSendEnabled: on(env.BULA_EMAIL_SEND_ENABLED),    // live provider send (no live sender exists in this candidate)
    creditsEnabled: on(env.BULA_CREDITS_ENABLED),         // grant / redeem promotional credit
    checkoutEnabled: on(env.BULA_CHECKOUT_ENABLED),
    editionPublishEnabled: on(env.BULA_EDITION_PUBLISH_ENABLED),
    syntheticTest: on(env.BULA_SYNTHETIC_TEST),           // fixtures/test balances only
    welcomeCents: Number.isInteger(+env.BULA_WELCOME_CENTS) && +env.BULA_WELCOME_CENTS > 0 ? +env.BULA_WELCOME_CENTS : 50000, // FJ$500 synthetic default
    creditTtlMs: Number.isInteger(+env.BULA_CREDIT_TTL_MS) && +env.BULA_CREDIT_TTL_MS > 0 ? +env.BULA_CREDIT_TTL_MS : null,
    holdTtlMs: Number.isInteger(+env.BULA_HOLD_TTL_MS) && +env.BULA_HOLD_TTL_MS > 0 ? +env.BULA_HOLD_TTL_MS : 10 * 60000,
    policyVersion: env.BULA_POLICY_VERSION || 'policy-unset',
    guestOrigin: env.BULA_GUEST_ORIGIN || '',             // https origin of the guest app
    staffInbox: env.BULA_STAFF_INBOX || '',               // receiving inbox for staff copies
    supportWhatsapp: env.BULA_SUPPORT_WHATSAPP || '',     // must be verified by James before production
    supportVerified: on(env.BULA_SUPPORT_VERIFIED),
    defaultCurrency: env.BULA_DEFAULT_CURRENCY || 'FJD',
    outboxMaxAttempts: 5, leaseMs: 60000,
  });
}
