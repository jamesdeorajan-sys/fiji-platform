/* Bula Happiness runtime configuration. EVERYTHING defaults OFF. Names only; no secret values live in the repo. */
const on = (v) => v === 'on' || v === 'true' || v === '1';
export function loadConfig(env = {}) {
  return Object.freeze({
    outboxEnabled: on(env.BULA_OUTBOX_ENABLED),          // enqueue jobs on saved bookings
    emailSendEnabled: on(env.BULA_EMAIL_SEND_ENABLED),    // live provider send (no live sender exists in this candidate)
    creditsEnabled: on(env.BULA_CREDITS_ENABLED),         // grant / redeem promotional credit
    checkoutEnabled: on(env.BULA_CHECKOUT_ENABLED),
    editionPublishEnabled: on(env.BULA_EDITION_PUBLISH_ENABLED),
    devicePairingEnabled: on(env.BULA_DEVICE_PAIRING),     // connect an installed Home Screen app to an existing guest (strict flag)
    sourceSyncEnabled: on(env.BULA_SOURCE_SYNC),          // saved-booking adapter for the real-booking sync mirror (strict flag; also needs the outbox flag). Separately switchable.
    emailCaptureEnabled: on(env.BULA_EMAIL_CAPTURE),      // HOSTED ACCEPTANCE ONLY: record would-be emails in the audit log instead of the (nonexistent) live sender. Nothing is transmitted.
    syntheticTest: on(env.BULA_SYNTHETIC_TEST),           // fixtures/test balances only
    welcomeCents: Number.isInteger(+env.BULA_WELCOME_CENTS) && +env.BULA_WELCOME_CENTS > 0 ? +env.BULA_WELCOME_CENTS : 50000, // FJ$500 synthetic default
    creditTtlMs: Number.isInteger(+env.BULA_CREDIT_TTL_MS) && +env.BULA_CREDIT_TTL_MS > 0 ? +env.BULA_CREDIT_TTL_MS : null,
    requestHoldTtlMs: Number.isInteger(+env.BULA_REQUEST_HOLD_TTL_MS) && +env.BULA_REQUEST_HOLD_TTL_MS > 0 ? +env.BULA_REQUEST_HOLD_TTL_MS : 12 * 3600000,
    holdTtlMs: Number.isInteger(+env.BULA_HOLD_TTL_MS) && +env.BULA_HOLD_TTL_MS > 0 ? +env.BULA_HOLD_TTL_MS : 10 * 60000,
    deviceTtlMs: Number.isInteger(+env.BULA_DEVICE_TTL_MS) && +env.BULA_DEVICE_TTL_MS > 0 ? +env.BULA_DEVICE_TTL_MS : 30 * 24 * 3600e3,
    pairingTtlMs: 10 * 60e3, maxDevices: 5, pairFailLimit: 10, pairFailWindowMs: 10 * 60e3,
    cronOnlyOperators: Object.freeze(String(env.BULA_CRON_ONLY_OPERATORS || '').split(',').map((x) => x.trim()).filter(Boolean)),   // offers of these operators are published ONLY by the scheduled publisher (cron:*); guest reads and manual publish skip them (test isolation; empty in production)
    hiddenOperators: Object.freeze(String(env.BULA_CATALOGUE_HIDDEN_OPERATORS || '').split(',').map((x) => x.trim()).filter(Boolean)),   // operators whose offers are test fixtures: kept out of the GUEST catalogue (still bookable by id, so automated tests are unchanged)
    policyVersion: env.BULA_POLICY_VERSION || 'policy-unset',
    guestOrigin: env.BULA_GUEST_ORIGIN || '',             // https origin of the guest app
    staffInbox: env.BULA_STAFF_INBOX || '',               // receiving inbox for staff copies
    supportWhatsapp: env.BULA_SUPPORT_WHATSAPP || '',     // must be verified by James before production
    supportVerified: on(env.BULA_SUPPORT_VERIFIED),
    defaultCurrency: env.BULA_DEFAULT_CURRENCY || 'FJD',
    grantGraceMs: 15 * 60000, outboxMaxAttempts: 5, leaseMs: 60000,
  });
}
