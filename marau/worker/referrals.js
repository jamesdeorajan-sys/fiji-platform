/* Marau (PREVIEW/TEST ONLY) - referral -> qualifying purchase -> return-transfer credit.
 *
 * THE RULES, stated once and enforced in code + schema (see migration 0036 and test/marau_referrals.test.mjs):
 *
 *  PUBLIC vs PRIVATE. A guest's referral code is public and unrelated to their private trip-access token. The public link
 *  (/r/CODE), QR and the validate endpoint disclose NOTHING about the referrer, any booking, or any guest.
 *
 *  ATTRIBUTION. A friend is attributed only at the moment their own NEW guest session is created, first-touch only
 *  (UNIQUE referred_session_id). Self-referral (same session, same normalised phone, or same email as the referrer) and
 *  "not a new guest" (that phone already has an earlier session) are recorded as rejected and can never earn.
 *
 *  QUALIFICATION. Saving a request never earns anything (these are pay-later purchases). A credit is created only when the
 *  referred guest's experience purchase is CONFIRMED by a human and, by default, FULFILLED (policy.qualify_on), at or above
 *  the policy's minimum purchase, while the referrer is within the per-referrer cap. One credit per referred friend, ever.
 *
 *  STATES. pending (purchase confirmed, not yet fulfilled) -> earned (fulfilled) -> applied (to the referrer's RETURN
 *  transfer, by staff) | reversed. Cancelling the qualifying purchase reverses a pending or earned credit; if the credit
 *  was already APPLIED it is marked reversed and flagged for a human - a fare is never silently increased.
 *
 *  MONEY. Amounts are FJD cents. Applying a credit writes an ADJUSTMENT row; the booking's original quote and the operator
 *  payout are never modified. The guest sees original fare, credit and amount due as three separate numbers. Reward
 *  funding is recorded on every credit and totalled in the staff report.
 *
 *  POLICY GATE. Rewards ship OFF with no amount and no cap. 'preview' only ever rewards synthetic (test_data) guests.
 *  'live' needs an owner approval no API here can set, plus an explicit environment flag. FJ$10 was an illustration.
 */
import { qrSvg } from './qr.js';
import { followUpPlan } from './contact_policy.js';
import { legStatusBasis } from './leg_type.js';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L: survives being read aloud or typed
const CODE_LENGTH = 8;
const COUNTED_STATUSES = ['pending', 'earned', 'applied'];
const RETURN_BOOKING_STATUSES = ['pending', 'confirmed', 'confirmed_unallocated'];

const toCents = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : null; };
const fjd = (c) => (c == null ? null : c / 100);

export function generateReferralCode(randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const bytes = randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}
export const isWellFormedCode = (c) => typeof c === 'string' && c.length === CODE_LENGTH && [...c].every((ch) => CODE_ALPHABET.includes(ch));

/**
 * THE QUALIFICATION CONTRACT, as a pure function of facts (so it is unit-testable and order-independent).
 *   requestStatus : the referred guest's purchase state
 *   totals        : payment-evidence totals {paid, refunded, net} in cents
 *   policy        : {qualify_on: 'confirmed'|'fulfilled', require_payment: 'none'|'paid_in_full'}
 * Returns {state: 'none'|'pending'|'earned'|'reverse', reason?}.
 *   - a saved (still 'requested') purchase earns nothing;
 *   - cancelled / declined / expired purchases, and ANY recorded refund, reverse the credit - terminally;
 *   - confirmed but not yet qualifying -> pending;
 *   - earned only when the stage has been reached (fulfilled, or confirmed if the policy says so) AND, when the policy
 *     requires payment, the purchase is paid in full by evidence (net paid >= total). Fulfilled-but-unpaid stays PENDING.
 */
export function qualificationState({ requestStatus, totalCents, totals, policy }) {
  if (['cancelled_by_guest', 'cancelled_by_staff', 'declined', 'expired'].includes(requestStatus)) return { state: 'reverse', reason: `purchase ${requestStatus.replace(/_/g, ' ')}` };
  if (totals.refunded > 0) return { state: 'reverse', reason: 'purchase refunded' };
  if (requestStatus !== 'confirmed' && requestStatus !== 'fulfilled') return { state: 'none' };
  const stageReached = requestStatus === 'fulfilled' || policy.qualify_on === 'confirmed';
  const paidOk = policy.require_payment === 'none' || totals.net >= totalCents;
  return { state: stageReached && paidOk ? 'earned' : 'pending' };
}

export function createReferrals(deps) {
  const { json, html, requireStaffIdentity, requireGuestSession, nowIso, cryptoRandomId, guestAppHtml } = deps;
  const idFor = (p) => `${p}_${cryptoRandomId()}`;

  async function readPolicy(env) { return env.DB.prepare('SELECT * FROM marau_reward_policy WHERE id = 1').first(); }

  /** Whether rewards may be earned for this referrer RIGHT NOW. Unset/off/unapproved -> never. */
  function policyPermits(policy, referrerIsTestData, env, liveEligible = false) {
    if (!policy || policy.mode === 'off') return false;
    if (!(policy.amount_cents > 0 && policy.cap_cents_per_referrer > 0)) return false; // not configured: nothing is promised
    if (policy.mode === 'preview') return referrerIsTestData === 1;
    // LIVE needs (1) an owner approval no API here can set, (2) the environment flag, and (3) a referrer whose trip reached Marau
    // through an AUTHENTICATED source on the approved integration path. test_data = 0 alone is never enough: it is an output of
    // provenance, so flipping it by hand on a demonstration record earns nothing.
    if (policy.mode === 'live') return Boolean(policy.live_approved_by) && env.MARAU_ALLOW_LIVE_REWARDS === '1' && liveEligible === true;
    return false;
  }

  async function sessionLiveEligible(env, sessionId) {
    const r = await env.DB.prepare(
      `SELECT 1 AS ok FROM guest_sessions g WHERE g.session_id = ? AND g.test_data = 0
         AND EXISTS (SELECT 1 FROM marau_test_bookings b WHERE b.guest_session_id = g.session_id AND b.source_authenticated = 1 AND b.source_kind = 'nadi_dispatch_api' AND b.test_data = 0)`
    ).bind(sessionId).first();
    return Boolean(r);
  }

  // `sessionIsTestData`: whether THIS guest could actually earn under the policy. A guest who could not is promised nothing.
  function publicPolicyView(policy, sessionIsTestData, env, liveEligible = false) {
    const active = policyPermits(policy, sessionIsTestData, env, liveEligible);
    if (!active) return { rewards_active: false, message: 'Referral rewards are not switched on yet. You can still share the link.' };
    return { rewards_active: true, requires_payment: policy.require_payment === 'paid_in_full', reward_fjd: fjd(policy.amount_cents), cap_fjd: fjd(policy.cap_cents_per_referrer), qualify_on: policy.qualify_on, minimum_purchase_fjd: fjd(policy.min_purchase_cents) };
  }

  // ------------------------------------------------------------- codes / links

  async function ensureCode(env, sessionId) {
    // A guest who merged an earlier session keeps the code that session already shared (the OLDEST in their lineage).
    const inLineage = () => env.DB.prepare(
      `SELECT code FROM marau_referral_codes WHERE guest_session_id = ? OR guest_session_id IN (SELECT from_session_id FROM marau_session_merges WHERE to_session_id = ?) ORDER BY created_at, code LIMIT 1`
    ).bind(sessionId, sessionId).first();
    const existing = await inLineage();
    if (existing) return existing.code;
    for (let i = 0; i < 6; i += 1) {
      const code = generateReferralCode();
      try {
        await env.DB.prepare('INSERT INTO marau_referral_codes (code, guest_session_id, created_at) VALUES (?, ?, ?)').bind(code, sessionId, nowIso()).run();
        return code;
      } catch (err) {
        if (!/UNIQUE/i.test(String(err && err.message))) throw err;
        const raced = await inLineage();
        if (raced) return raced.code; // a concurrent call for the same guest won
      }
    }
    throw new Error('could not allocate a referral code');
  }

  const baseUrl = (request, env) => (env.MARAU_PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/+$/, '');

  // --------------------------------------------------------------- attribution

  /** Called from booking creation for a brand-new session. Never throws into the booking: a bad code just doesn't attribute. */
  async function attribute(env, { code, referredSession }) {
    const clean = String(code || '').trim().toUpperCase();
    if (!isWellFormedCode(clean)) return { attributed: false, reason: 'no_valid_code' };
    const codeRow = await env.DB.prepare('SELECT * FROM marau_referral_codes WHERE code = ?').bind(clean).first();
    if (!codeRow) return { attributed: false, reason: 'unknown_code' };
    const owner = await env.DB.prepare('SELECT to_session_id FROM marau_session_merges WHERE from_session_id = ?').bind(codeRow.guest_session_id).first();
    const referrer = await env.DB.prepare('SELECT * FROM guest_sessions WHERE session_id = ?').bind(owner ? owner.to_session_id : codeRow.guest_session_id).first();
    if (!referrer) return { attributed: false, reason: 'unknown_code' };

    const sameEmail = referrer.guest_email && referredSession.guest_email && String(referrer.guest_email).toLowerCase() === String(referredSession.guest_email).toLowerCase();
    const isSelf = referrer.session_id === referredSession.session_id || referrer.guest_contact_key === referredSession.guest_contact_key || sameEmail;
    let status = 'attributed';
    if (isSelf) status = 'rejected_self_referral';
    else {
      const earlier = await env.DB.prepare('SELECT COUNT(*) AS n FROM guest_sessions WHERE guest_contact_key = ? AND session_id != ?').bind(referredSession.guest_contact_key, referredSession.session_id).first();
      if (earlier.n > 0) status = 'rejected_not_new_guest';
    }
    try {
      await env.DB.prepare('INSERT INTO marau_referrals (referral_id, code, referrer_session_id, referred_session_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(idFor('ref'), clean, referrer.session_id, referredSession.session_id, status, nowIso()).run();
    } catch (err) {
      if (/UNIQUE/i.test(String(err && err.message))) return { attributed: false, reason: 'already_attributed' }; // first touch wins
      throw err;
    }
    return { attributed: status === 'attributed', reason: status === 'attributed' ? null : status };
  }

  // ------------------------------------------------------------ credit ledger

  /** Total paid, total refunded for one purchase, from the append-only payment-evidence ledger. */
  async function paymentTotals(env, requestId) {
    const r = await env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN event_type = 'paid' THEN amount_cents ELSE 0 END), 0) AS paid, COALESCE(SUM(CASE WHEN event_type = 'refunded' THEN amount_cents ELSE 0 END), 0) AS refunded FROM marau_offer_payments WHERE request_id = ?`
    ).bind(requestId).first();
    return { paid: r.paid, refunded: r.refunded, net: r.paid - r.refunded };
  }

  /**
   * Hook: ANYTHING about the referred guest's purchase changed (a staff transition, a guest cancellation, a payment or refund
   * event). The credit state is re-derived from the purchase's CURRENT facts (qualificationState), never from the event that
   * happened to trigger the call, so repeated and out-of-order events converge on the same state.
   */
  async function onRequestTransition(env, { request }) { return reconcileRequest(env, request.request_id); }

  /**
   * THE STORED SNAPSHOT'S PURPOSE. Every credit stores, at creation, the commercial terms it was promised under (amount, stage,
   * payment requirement, minimum purchase, cap, mode). Those terms - not the policy as it stands today - decide whether THAT credit
   * is earned. A later policy change therefore never silently loosens or tightens a promise already made; it affects NEW credits
   * only. A snapshot that predates payment evidence has no require_payment key and keeps its original fulfilled-only promise.
   * The ONE live switch is mode: 'off' FREEZES everything (no new credits, no promotion, no application) without deleting or
   * reversing anything; turning it back on resumes under the stored terms.
   */
  function snapshotTerms(snapshot) {
    let t = {};
    try { t = JSON.parse(snapshot || '{}'); } catch { t = {}; }
    return { qualify_on: t.qualify_on === 'confirmed' ? 'confirmed' : 'fulfilled', require_payment: t.require_payment === 'paid_in_full' ? 'paid_in_full' : 'none' };
  }

  // The purchase must STILL be eligible at the instant of every write: confirmed/fulfilled and never refunded. These predicates
  // sit INSIDE the creating / promoting / applying statements so a late write cannot make a credit redeemable after a
  // cancellation or refund landed in between (the read-then-write window of the older code).
  const PURCHASE_LIVE = (reqRef) => `EXISTS (SELECT 1 FROM marau_offer_requests r WHERE r.request_id = ${reqRef} AND r.status IN ('confirmed', 'fulfilled')
      AND NOT EXISTS (SELECT 1 FROM marau_offer_payments p WHERE p.request_id = r.request_id AND p.event_type = 'refunded'))`;
  const PROMOTABLE = `(
      EXISTS (SELECT 1 FROM marau_offer_requests r WHERE r.request_id = marau_reward_credits.qualifying_request_id
        AND r.status IN ('confirmed', 'fulfilled')
        AND NOT EXISTS (SELECT 1 FROM marau_offer_payments p WHERE p.request_id = r.request_id AND p.event_type = 'refunded')
        AND (r.status = 'fulfilled' OR json_extract(marau_reward_credits.policy_snapshot, '$.qualify_on') = 'confirmed')
        AND (COALESCE(json_extract(marau_reward_credits.policy_snapshot, '$.require_payment'), 'none') = 'none'
             OR (SELECT COALESCE(SUM(CASE p.event_type WHEN 'paid' THEN p.amount_cents ELSE -p.amount_cents END), 0) FROM marau_offer_payments p WHERE p.request_id = r.request_id) >= r.total_cents)))`;

  async function reconcileRequest(env, requestId) {
    const req = await env.DB.prepare('SELECT * FROM marau_offer_requests WHERE request_id = ?').bind(requestId).first();
    if (!req) return { handled: false };
    const referral = await env.DB.prepare(
      `SELECT r.*, gs.test_data AS referrer_test_data FROM marau_referrals r JOIN guest_sessions gs ON gs.session_id = r.referrer_session_id
       WHERE r.referred_session_id = ? AND r.status IN ('attributed', 'capped')`
    ).bind(req.guest_session_id).first();
    if (!referral) return { handled: false };

    const policy = await readPolicy(env);
    const totals = await paymentTotals(env, requestId);
    const existing = await env.DB.prepare('SELECT credit_id, status, policy_snapshot FROM marau_reward_credits WHERE qualifying_request_id = ?').bind(requestId).first();
    const terms = existing ? snapshotTerms(existing.policy_snapshot) : policy;
    const want = qualificationState({ requestStatus: req.status, totalCents: req.total_cents, totals, policy: terms });

    // A cancellation / refund always reverses, even while rewards are OFF: OFF freezes earning, it never keeps a bad credit alive.
    if (want.state === 'reverse') return existing ? reverseForRequest(env, requestId, want.reason) : { handled: true, nothing_to_reverse: true };
    if (want.state === 'none') return { handled: false };
    if (!policyPermits(policy, referral.referrer_test_data, env, await sessionLiveEligible(env, referral.referrer_session_id))) return { handled: false, blocked: 'policy' };

    const now = nowIso();
    let created = false;
    if (!existing) {
      if (req.total_cents < policy.min_purchase_cents) return { handled: false, blocked: 'below_minimum_purchase' };
      const snapshot = JSON.stringify({ amount_cents: policy.amount_cents, cap_cents_per_referrer: policy.cap_cents_per_referrer, min_purchase_cents: policy.min_purchase_cents, qualify_on: policy.qualify_on, require_payment: policy.require_payment, mode: policy.mode });
      try {
        // ONE statement: the cap AND the purchase's still-live eligibility are checked in the same atomic INSERT that creates the
        // credit (always 'pending'; promotion to 'earned' is a separate guarded statement). UNIQUE(referral_id) = one credit per friend.
        const res = await env.DB.prepare(
          `INSERT INTO marau_reward_credits (credit_id, referral_id, beneficiary_session_id, referred_session_id, qualifying_request_id, amount_cents, status, funding_source, policy_snapshot, created_at, earned_at)
           SELECT ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NULL
           WHERE (SELECT COALESCE(SUM(amount_cents), 0) FROM marau_reward_credits WHERE beneficiary_session_id = ? AND status IN ('pending', 'earned', 'applied')) + ? <= ?
             AND ${PURCHASE_LIVE('?')}`
        ).bind(idFor('cr'), referral.referral_id, referral.referrer_session_id, referral.referred_session_id, requestId, policy.amount_cents,
          policy.funding_source, snapshot, now, referral.referrer_session_id, policy.amount_cents, policy.cap_cents_per_referrer, requestId).run();
        created = res.meta.changes === 1;
        if (!created) {
          const raced = await env.DB.prepare('SELECT 1 AS ok FROM marau_reward_credits WHERE referral_id = ?').bind(referral.referral_id).first();
          if (!raced) {
            const stillLive = await env.DB.prepare(`SELECT 1 AS ok WHERE ${PURCHASE_LIVE('?')}`).bind(requestId).first();
            if (!stillLive) return { handled: true, ineligible: true }; // a cancellation/refund landed in the window: no credit
            await env.DB.prepare(`UPDATE marau_referrals SET status = 'capped' WHERE referral_id = ? AND status = 'attributed'`).bind(referral.referral_id).run();
            return { handled: true, capped: true };
          }
        }
      } catch (err) {
        if (!/UNIQUE/i.test(String(err && err.message))) throw err; // a concurrent event already created this friend's credit
      }
    }
    // Promotion: guarded in SQL by the credit's OWN stored terms and the purchase's still-live facts.
    await env.DB.prepare(`UPDATE marau_reward_credits SET status = 'earned', earned_at = ? WHERE qualifying_request_id = ? AND status = 'pending' AND ${PROMOTABLE}`).bind(now, requestId).run();
    return { handled: true, created };
  }

  /**
   * Reverse the credit for a purchase - in ONE atomic batch with the flagging of any live discount it already gave, so a
   * reversal racing a redemption can never leave the credit reversed while its adjustment still reads as a clean discount.
   */
  async function reverseForRequest(env, requestId, reason) {
    const now = nowIso();
    const res = await env.DB.batch([
      env.DB.prepare(
        `UPDATE marau_reward_credits SET status = 'reversed', reversed_at = ?, reversal_reason = ?, needs_manual_adjustment = CASE WHEN status = 'applied' THEN 1 ELSE 0 END
         WHERE qualifying_request_id = ? AND status IN ('pending', 'earned', 'applied')`
      ).bind(now, reason, requestId),
      env.DB.prepare(
        `UPDATE marau_booking_adjustments SET status = 'reversal_pending_staff'
         WHERE status = 'applied' AND credit_id IN (SELECT credit_id FROM marau_reward_credits WHERE qualifying_request_id = ? AND status = 'reversed' AND needs_manual_adjustment = 1)`
      ).bind(requestId),
    ]);
    return { handled: true, reversed: res[0].meta.changes === 1 };
  }

  const LIVE_ADJ = `('applied', 'reversal_pending_staff')`;
  const ACTIVE_RULE = `(SELECT r.rule_id FROM marau_return_allocation_rules r WHERE r.status = 'approved' AND (r.approval_basis = 'owner' OR marau_test_bookings.source_authenticated = 0) ORDER BY r.approved_at DESC, r.rule_id DESC LIMIT 1)`;
  const CANCELLED_BOOKING = `('cancelled', 'declined')`;

  /**
   * Idempotent repair sweep, safe to run at any time by any number of callers, and run on every staff read, every apply and every
   * guest trip/referral read - so recovery needs NO particular guest action and does not depend on any hook having run (there is no
   * timer: if nobody reads, nothing sweeps, and nothing is redeemable either because every apply re-checks in SQL):
   *   1. a credit whose purchase is no longer eligible (cancelled/declined/expired, or ANY refund recorded) is reversed - and a
   *      discount it already gave is flagged for a human;
   *   2. a credit applied to a cancelled/declined return goes back to 'earned' and its discount is released;
   *   3. a pending credit whose own stored terms are now met is promoted to 'earned' (preview mode, synthetic holders only here;
   *      live promotion is event-driven and needs the environment flag, which SQL cannot see);
   *   4. a flagged reversal on a cancelled booking needs no human any more.
   */
  async function reconcileApplications(env) {
    const now = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE marau_reward_credits SET status = 'reversed', reversed_at = ?, reversal_reason = 'purchase no longer eligible (cancelled, declined, expired or refunded)',
           needs_manual_adjustment = CASE WHEN status = 'applied' THEN 1 ELSE 0 END
         WHERE status IN ('pending', 'earned', 'applied') AND NOT ${PURCHASE_LIVE('marau_reward_credits.qualifying_request_id')}`
      ).bind(now),
      env.DB.prepare(
        `UPDATE marau_booking_adjustments SET status = 'reversal_pending_staff'
         WHERE status = 'applied' AND credit_id IN (SELECT credit_id FROM marau_reward_credits WHERE status = 'reversed' AND needs_manual_adjustment = 1)`
      ),
      env.DB.prepare(
        `UPDATE marau_reward_credits SET status = 'earned', applied_at = NULL, applied_by = NULL, applied_booking_id = NULL, applied_cents = NULL
         WHERE status = 'applied' AND applied_booking_id IN (SELECT id FROM marau_test_bookings WHERE status IN ${CANCELLED_BOOKING})`
      ),
      env.DB.prepare(
        `UPDATE marau_booking_adjustments SET status = 'released_booking_cancelled'
         WHERE status IN ${LIVE_ADJ} AND booking_id IN (SELECT id FROM marau_test_bookings WHERE status IN ${CANCELLED_BOOKING})`
      ),
      env.DB.prepare(
        `UPDATE marau_reward_credits SET needs_manual_adjustment = 0
         WHERE status = 'reversed' AND needs_manual_adjustment = 1
           AND NOT EXISTS (SELECT 1 FROM marau_booking_adjustments a WHERE a.credit_id = marau_reward_credits.credit_id AND a.status IN ${LIVE_ADJ})
           AND EXISTS (SELECT 1 FROM marau_booking_adjustments a WHERE a.credit_id = marau_reward_credits.credit_id AND a.status = 'released_booking_cancelled')`
      ),
      // Return-leg VALUE: unapplied legs whose rule is no longer approved go back to unresolved; unresolved FJD legs are allocated by
      // the active APPROVED rule (a synthetic-preview approval can only ever resolve non-authenticated, i.e. demonstration, legs).
      env.DB.prepare(
        `UPDATE marau_test_bookings SET leg_value_status = 'unresolved', leg_value_cents = NULL, leg_value_rule_id = NULL
         WHERE leg_key = 'return' AND leg_value_status = 'allocated'
           AND NOT EXISTS (SELECT 1 FROM marau_return_allocation_rules r WHERE r.rule_id = marau_test_bookings.leg_value_rule_id AND r.status = 'approved')
           AND NOT EXISTS (SELECT 1 FROM marau_booking_adjustments a WHERE a.booking_id = marau_test_bookings.id AND a.status IN ${LIVE_ADJ})`
      ),
      env.DB.prepare(
        `UPDATE marau_test_bookings SET leg_value_status = 'allocated', leg_value_rule_id = ${ACTIVE_RULE},
           leg_value_cents = (SELECT CASE r.kind WHEN 'percent_of_total' THEN CAST(ROUND(marau_test_bookings.source_total_cents * r.value / 10000.0) AS INTEGER) ELSE MIN(r.value, marau_test_bookings.source_total_cents) END
                              FROM marau_return_allocation_rules r WHERE r.rule_id = ${ACTIVE_RULE})
         WHERE leg_key = 'return' AND leg_value_status = 'unresolved' AND source_total_cents IS NOT NULL AND UPPER(COALESCE(source_currency, 'FJD')) = 'FJD'
           AND ${ACTIVE_RULE} IS NOT NULL`
      ),
      env.DB.prepare(
        `UPDATE marau_reward_credits SET status = 'earned', earned_at = ?
         WHERE status = 'pending' AND (SELECT mode FROM marau_reward_policy WHERE id = 1) = 'preview'
           AND EXISTS (SELECT 1 FROM guest_sessions g WHERE g.session_id = marau_reward_credits.beneficiary_session_id AND g.test_data = 1)
           AND ${PROMOTABLE}`
      ).bind(now),
    ]);
  }

  // The adjustment insert is ONE statement that, in the same atomic step, checks the credit is still in the expected state, the
  // booking is the holder's own upcoming uncancelled eligible leg, and that amount due remains - and sizes the credit to what remains.
  // Eligible legs: a return DECLARED in Marau ('return'), or - only with explicit staff confirmation - a standalone airport-bound
  // booking ('departure', relationship to any arrival unproven). Round trips held in one booking, 'other' and 'unclassified' never.
  const ADJUSTMENT_SOURCE = `
    FROM (
      SELECT c.credit_id AS credit_id, c.amount_cents AS amount, c.funding_source AS funding, b.id AS booking_id, b.leg_type AS leg, b.leg_key AS leg_key, b.source_total_cents AS total0,
             CASE WHEN b.leg_key IS NULL THEN CAST(ROUND(b.quoted_amount * 100) AS INTEGER) ELSE b.leg_value_cents END AS orig,
             COALESCE((SELECT SUM(a.credit_cents) FROM marau_booking_adjustments a WHERE a.booking_id = b.id AND a.status IN ${LIVE_ADJ}), 0) AS used
      FROM marau_reward_credits c
      JOIN marau_test_bookings b ON b.id = ? AND b.guest_session_id = c.beneficiary_session_id AND (b.leg_type = 'return' OR (b.leg_type = 'departure' AND ? = 1))
                                AND (b.leg_key IS NULL OR (b.leg_key = 'return' AND b.leg_value_status = 'allocated' AND b.leg_value_cents > 0))
                                AND b.status_uncertainty IS NULL
                                AND b.status IN ('pending', 'confirmed', 'confirmed_unallocated') AND b.pickup_datetime > ?
      WHERE c.credit_id = ?`;
  const BASIS = `CASE WHEN x.leg_key IS NOT NULL THEN 'source_round_trip_return_leg' WHEN x.leg = 'return' THEN 'declared_return_leg' ELSE 'staff_confirmed_departure' END`;

  async function applyCredit(request, env, creditId) {
    const staff = await requireStaffIdentity(request, env);
    if (!staff) return json({ error: 'unauthorized - a valid staff identity token (x-marau-staff-token) is required' }, 401);
    let body; try { body = await request.json(); } catch { body = {}; }
    const bookingId = Number(body.booking_id);
    if (!Number.isInteger(bookingId) || bookingId <= 0) return json({ error: 'booking_id is required' }, 400);
    const confirmed = body.relationship_confirmed === true ? 1 : 0;

    await reconcileApplications(env);
    const credit0 = await env.DB.prepare('SELECT credit_id FROM marau_reward_credits WHERE credit_id = ?').bind(creditId).first();
    if (!credit0) return json({ error: 'credit not found' }, 404);

    const now = nowIso();
    const adjId = idFor('adj');
    // ONE batch = ONE transaction: the adjustment, then the claim of the credit that is conditional on THAT adjustment existing.
    // The adjustment statement re-checks, atomically: rewards not OFF, the credit still earned, its purchase still live (not
    // cancelled, not refunded), the booking eligible and amount due remaining.
    let batch;
    try {
      batch = await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO marau_booking_adjustments (adjustment_id, booking_id, credit_id, kind, original_quote_cents, credit_cents, amount_due_cents, operator_payout_cents, operator_payout_unchanged, funded_by, status, created_by, created_at, relationship_basis, booking_total_at_apply_cents)
           SELECT ?, x.booking_id, x.credit_id, 'referral_credit', x.orig, MIN(x.amount, x.orig - x.used), x.orig - x.used - MIN(x.amount, x.orig - x.used), NULL, 1, x.funding, 'applied', ?, ?, ${BASIS}, x.total0
           ${ADJUSTMENT_SOURCE} AND c.status = 'earned'
             AND (SELECT mode FROM marau_reward_policy WHERE id = 1) != 'off'
             AND ${PURCHASE_LIVE('c.qualifying_request_id')}) x
           WHERE x.orig - x.used > 0`
        ).bind(adjId, staff.operatorName, now, bookingId, confirmed, now, creditId),
        env.DB.prepare(
          `UPDATE marau_reward_credits SET status = 'applied', applied_at = ?, applied_by = ?, applied_booking_id = ?, applied_cents = (SELECT credit_cents FROM marau_booking_adjustments WHERE adjustment_id = ?)
           WHERE credit_id = ? AND status = 'earned' AND EXISTS (SELECT 1 FROM marau_booking_adjustments WHERE adjustment_id = ?)`
        ).bind(now, staff.operatorName, bookingId, adjId, creditId, adjId),
      ]);
    } catch (err) {
      // The batch rolled back as a unit: nothing is half-applied. Report it; the retry starts from a clean 'earned' credit.
      console.error('[marau-preview] credit application failed and was rolled back', err);
      return json({ error: 'APPLICATION_FAILED_NOTHING_CHANGED', detail: 'the credit was not applied and no partial state was left; it is safe to retry' }, 503);
    }
    if (batch[0].meta.changes === 1 && batch[1].meta.changes === 1) {
      const credit = await env.DB.prepare('SELECT amount_cents, applied_cents FROM marau_reward_credits WHERE credit_id = ?').bind(creditId).first();
      return json({ ok: true, operator: staff.operatorName, applied_fjd: fjd(credit.applied_cents), unused_fjd: fjd(credit.amount_cents - credit.applied_cents), fare: await fareFor(env, bookingId), demonstration_data: true });
    }
    return explainNotApplied(env, creditId, bookingId, confirmed);
  }

  /** The batch changed nothing: decide whether this is a harmless replay (report the WINNER), a repair, or a real refusal. */
  async function explainNotApplied(env, creditId, bookingId, confirmed) {
    const credit = await env.DB.prepare('SELECT * FROM marau_reward_credits WHERE credit_id = ?').bind(creditId).first();
    if (credit.status === 'applied') {
      if (credit.applied_booking_id !== bookingId) return json({ error: 'CREDIT_ALREADY_APPLIED_ELSEWHERE', applied_booking_id: credit.applied_booking_id }, 409);
      const repaired = await repairMissingAdjustment(env, credit);
      return json({ ok: true, repeated: true, repaired, operator: credit.applied_by, applied_fjd: fjd(credit.applied_cents), unused_fjd: fjd(credit.amount_cents - credit.applied_cents), fare: await fareFor(env, bookingId), demonstration_data: true });
    }
    if (credit.status !== 'earned') return json({ error: 'CREDIT_NOT_APPLICABLE', status: credit.status, detail: credit.status === 'pending' ? 'the purchase is not yet fulfilled and paid' : credit.status === 'reversed' ? 'the qualifying purchase was cancelled, refunded or is no longer eligible' : undefined }, 409);
    const policy = await readPolicy(env);
    if (policy.mode === 'off') return json({ error: 'REWARDS_OFF', detail: 'rewards are switched off: credits are frozen, not lost, and resume when rewards are switched back on' }, 409);
    const booking = await env.DB.prepare('SELECT id, leg_type, leg_key, leg_value_status, source_currency, status, status_uncertainty, pickup_datetime FROM marau_test_bookings WHERE id = ? AND guest_session_id = ?').bind(bookingId, credit.beneficiary_session_id).first();
    const live = booking && ['pending', 'confirmed', 'confirmed_unallocated'].includes(booking.status) && booking.pickup_datetime > nowIso();
    if (live && booking.status_uncertainty) return json({ error: 'LEG_STATUS_UNVERIFIED', status_uncertainty: booking.status_uncertainty, detail: 'the source marks this booking completed while this return is still upcoming, so its operational status is uncertain; a named staff member must record evidence (POST /preview/admin/bookings/:id/verify-status) before a credit can apply. Nothing was changed.' }, 409);
    if (live && booking.leg_key === 'return' && booking.leg_value_status !== 'allocated') {
      const nonFjd = booking.source_currency && String(booking.source_currency).toUpperCase() !== 'FJD';
      return json({ error: 'RETURN_VALUE_UNRESOLVED', reason: nonFjd ? 'source_currency_not_fjd' : 'no_approved_allocation_rule',
        detail: 'the source holds ONE quote for the whole round trip and no separate return amount; an approved return-value allocation rule (in FJD) is required before a credit can apply to the return leg. Nothing was changed.' }, 409);
    }
    if (live && ['round_trip', 'unclassified', 'other'].includes(booking.leg_type)) return json({ error: 'UNSUPPORTED_SHAPE', leg_type: booking.leg_type, detail: 'this booking is not a leg a credit can be applied to (a round trip held in one booking has one combined fare; unclassified and non-airport legs have no provable relationship)' }, 409);
    if (live && booking.leg_type === 'departure' && !confirmed) return json({ error: 'RELATIONSHIP_NOT_CONFIRMED', detail: 'this is a standalone airport-bound booking; its relationship to the holder\'s trip is unproven. Re-send with relationship_confirmed: true only if you have verified it is the holder\'s own departure.' }, 409);
    if (!live || !['return', 'departure'].includes(booking.leg_type)) return json({ error: 'NOT_AN_ELIGIBLE_RETURN_TRANSFER', detail: "the booking must be the credit holder's own upcoming, uncancelled return or confirmed departure transfer" }, 409);
    return json({ error: 'BOOKING_FULLY_COVERED', detail: 'this return transfer already has no amount left to discount' }, 409);
  }

  /** A credit the OLD workflow left 'applied' with no adjustment: write the adjustment it should have, attributed to the original operator. */
  async function repairMissingAdjustment(env, credit) {
    const live = await env.DB.prepare(`SELECT 1 AS ok FROM marau_booking_adjustments WHERE credit_id = ? AND status IN ${LIVE_ADJ}`).bind(credit.credit_id).first();
    if (live) return false;
    try {
      const res = await env.DB.prepare(
        `INSERT INTO marau_booking_adjustments (adjustment_id, booking_id, credit_id, kind, original_quote_cents, credit_cents, amount_due_cents, operator_payout_cents, operator_payout_unchanged, funded_by, status, created_by, created_at, relationship_basis, booking_total_at_apply_cents)
         SELECT ?, x.booking_id, x.credit_id, 'referral_credit', x.orig, MIN(COALESCE(?, x.amount), x.orig - x.used), x.orig - x.used - MIN(COALESCE(?, x.amount), x.orig - x.used), NULL, 1, x.funding, 'applied', ?, ?, ${BASIS}, x.total0
         ${ADJUSTMENT_SOURCE} AND c.status = 'applied') x
         WHERE x.orig - x.used > 0`
      ).bind(idFor('adj'), credit.applied_cents, credit.applied_cents, credit.applied_by || 'unknown', nowIso(), credit.applied_booking_id, 1, nowIso(), credit.credit_id).run();
      return res.meta.changes === 1;
    } catch (err) {
      if (/UNIQUE/i.test(String(err && err.message))) return false; // a concurrent retry already repaired it
      throw err;
    }
  }

  /** Staff settle a flagged reversal (e.g. the extra amount was collected): the discount leaves the amount due, attributed. */
  async function resolveAdjustment(request, env, adjustmentId) {
    const staff = await requireStaffIdentity(request, env);
    if (!staff) return json({ error: 'unauthorized - a valid staff identity token (x-marau-staff-token) is required' }, 401);
    let b; try { b = await request.json(); } catch { b = {}; }
    const note = String(b.note || '').trim().slice(0, 300);
    if (note.length < 3) return json({ error: 'a resolution note is required' }, 400);
    const adj = await env.DB.prepare('SELECT * FROM marau_booking_adjustments WHERE adjustment_id = ?').bind(adjustmentId).first();
    if (!adj) return json({ error: 'adjustment not found' }, 404);
    const res = await env.DB.batch([
      env.DB.prepare(`UPDATE marau_booking_adjustments SET status = 'reversal_resolved', resolved_by = ?, resolved_at = ?, resolution_note = ? WHERE adjustment_id = ? AND status = 'reversal_pending_staff'`).bind(staff.operatorName, nowIso(), note, adjustmentId),
      env.DB.prepare(
        `UPDATE marau_reward_credits SET needs_manual_adjustment = 0 WHERE credit_id = ? AND status = 'reversed'
           AND NOT EXISTS (SELECT 1 FROM marau_booking_adjustments a WHERE a.credit_id = marau_reward_credits.credit_id AND a.status = 'reversal_pending_staff')`
      ).bind(adj.credit_id),
    ]);
    if (res[0].meta.changes !== 1) {
      const cur = await env.DB.prepare('SELECT status, resolved_by FROM marau_booking_adjustments WHERE adjustment_id = ?').bind(adjustmentId).first();
      if (cur.status === 'reversal_resolved') return json({ ok: true, repeated: true, original_operator: cur.resolved_by, fare: await fareFor(env, adj.booking_id), demonstration_data: true });
      return json({ error: 'NOT_AWAITING_A_STAFF_DECISION', status: cur.status }, 409);
    }
    return json({ ok: true, resolved_by: staff.operatorName, fare: await fareFor(env, adj.booking_id), demonstration_data: true });
  }

  /**
   * One BOOKING balance for a round trip held in one source booking: the ORIGINAL booking total (both legs), the credits on either
   * leg, and the amount due - identical from either leg. The return leg's own value is shown separately and is either allocated by an
   * approved rule or explicitly RETURN_VALUE_UNRESOLVED; it is never the whole quote and never an arbitrary share. The operator
   * payout is never part of this and never changes.
   */
  async function legFare(env, b) {
    const { results: legRows } = await env.DB.prepare(`SELECT id, leg_key, leg_value_status, leg_value_cents, leg_value_rule_id, created_at FROM marau_test_bookings WHERE source_booking_ref = ? AND leg_key IS NOT NULL`).bind(b.source_booking_ref).all();
    const ids = legRows.map((x) => x.id);
    const total = b.source_total_cents != null ? b.source_total_cents : Math.round(Number(b.quoted_amount) * 100);
    const { results: adjs } = await env.DB.prepare(`SELECT * FROM marau_booking_adjustments WHERE booking_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at, adjustment_id`).bind(...ids).all();
    const live = adjs.filter((a) => a.status === 'applied' || a.status === 'reversal_pending_staff');
    const credit = Math.min(live.reduce((n, a) => n + a.credit_cents, 0), total);
    const ret = legRows.find((x) => x.leg_key === 'return');
    let returnValue = { status: 'RETURN_VALUE_UNRESOLVED' };
    if (ret && ret.leg_value_status === 'allocated') {
      const rule = await env.DB.prepare('SELECT kind, value FROM marau_return_allocation_rules WHERE rule_id = ?').bind(ret.leg_value_rule_id).first();
      returnValue = { status: 'allocated', value_fjd: fjd(ret.leg_value_cents), rule_basis: rule ? (rule.kind === 'percent_of_total' ? `percent_of_total ${rule.value / 100}%` : `fixed_return_fjd ${fjd(rule.value)}`) : 'rule' };
    }
    const totalAtCredit = live.map((a) => a.booking_total_at_apply_cents).find((v) => v != null);
    const quoteChanged = totalAtCredit != null && totalAtCredit !== total;
    return {
      scope: 'round_trip_booking', leg: b.leg_key,
      ...(quoteChanged ? { quote_changed_since_credit: true, booking_total_at_credit_fjd: fjd(totalAtCredit) } : {}),
      original_fare_fjd: fjd(total), booking_total_fjd: fjd(total),
      referral_credit_fjd: fjd(credit), amount_due_fjd: fjd(total - credit),
      return_value: returnValue,
      operator_payout_unchanged: true,
      funded_by: live.length ? live[0].funded_by : null,
      adjustment_status: live.some((a) => a.status === 'reversal_pending_staff') ? 'reversal_pending_staff' : live.length ? 'applied' : null,
      adjustments: live.map((a) => ({ adjustment_id: a.adjustment_id, credit_fjd: fjd(a.credit_cents), status: a.status, leg_booking_id: a.booking_id })),
      quote_history: [{ event: 'original_booking_total', fjd: fjd(total), at: b.created_at }, ...adjs.map((a) => ({ event: `referral_credit_${a.status}`, credit_fjd: fjd(a.credit_cents), at: a.created_at }))],
    };
  }

  /** Original fare, credits and amount due as SEPARATE numbers, plus the quote history. Never mutates anything. */
  async function fareFor(env, bookingId) {
    const b = await env.DB.prepare('SELECT id, quoted_amount, leg_type, leg_key, source_booking_ref, source_total_cents, created_at FROM marau_test_bookings WHERE id = ?').bind(bookingId).first();
    if (!b) return null;
    if (b.leg_key) return legFare(env, b);
    const original = Math.round(Number(b.quoted_amount) * 100);
    const { results: adjs } = await env.DB.prepare('SELECT * FROM marau_booking_adjustments WHERE booking_id = ? ORDER BY created_at, adjustment_id').bind(bookingId).all();
    const history = [{ event: 'original_quote', fjd: fjd(original), at: b.created_at }];
    const live = adjs.filter((a) => a.status === 'applied' || a.status === 'reversal_pending_staff');
    for (const a of adjs) history.push({ event: `referral_credit_${a.status}`, credit_fjd: fjd(a.credit_cents), at: a.created_at });
    // The amount due always follows the CURRENT quote (the source may re-quote after a credit was applied); the credit shown
    // never exceeds it, so amount due can never go negative, and a re-quote is flagged rather than hidden.
    const credit = Math.min(live.reduce((n, a) => n + a.credit_cents, 0), original);
    if (!adjs.length) return { original_fare_fjd: fjd(original), referral_credit_fjd: 0, amount_due_fjd: fjd(original), operator_payout_unchanged: true, quote_history: history };
    const quoteChanged = live.some((a) => a.original_quote_cents !== original);
    return {
      original_fare_fjd: fjd(original),
      ...(quoteChanged ? { quote_changed_since_credit: true, quote_at_credit_fjd: fjd(live[0].original_quote_cents) } : {}),
      referral_credit_fjd: fjd(credit),
      amount_due_fjd: fjd(original - credit),
      operator_payout_unchanged: adjs.every((a) => a.operator_payout_unchanged === 1),
      funded_by: live.length ? live[0].funded_by : adjs[0].funded_by,
      adjustment_status: live.some((a) => a.status === 'reversal_pending_staff') ? 'reversal_pending_staff' : live.length ? 'applied' : adjs[adjs.length - 1].status,
      adjustments: live.map((a) => ({ adjustment_id: a.adjustment_id, credit_fjd: fjd(a.credit_cents), status: a.status })),
      quote_history: history,
    };
  }

  // -------------------------------------------------------------- guest views

  async function guestReferral(request, env) {
    const session = await requireGuestSession(request, env);
    if (!session) return json({ error: 'unauthorized - invalid or revoked access token' }, 401);
    await reconcileApplications(env);
    const code = await ensureCode(env, session.session_id);
    const base = baseUrl(request, env);
    const policy = await readPolicy(env);
    const friends = await env.DB.prepare(`SELECT COUNT(*) AS n FROM marau_referrals WHERE referrer_session_id = ? AND status IN ('attributed', 'capped')`).bind(session.session_id).first();
    const shares = await env.DB.prepare('SELECT COUNT(*) AS n FROM marau_share_events WHERE guest_session_id = ?').bind(session.session_id).first();
    const { results: credits } = await env.DB.prepare(`SELECT credit_id, amount_cents, status, applied_booking_id, applied_cents, needs_manual_adjustment, created_at FROM marau_reward_credits WHERE beneficiary_session_id = ? ORDER BY created_at DESC`).bind(session.session_id).all();
    return json({
      code,
      share_url: `${base}/r/${code}`,
      qr_svg_url: `${base}/preview/referral/qr.svg?code=${code}`,
      // A share link carries only the public code. It reveals no booking, name, contact or trip detail.
      share_reveals: 'only that a friend invited them to Marau',
      policy: publicPolicyView(policy, session.test_data, env, await sessionLiveEligible(env, session.session_id)),
      friends_joined: friends.n,
      shares_tapped: shares.n,
      credits: credits.map((c) => ({ credit_id: c.credit_id, status: c.status, amount_fjd: fjd(c.amount_cents), applied_to_booking: c.applied_booking_id, applied_fjd: fjd(c.applied_cents), needs_staff_attention: c.needs_manual_adjustment === 1 })),
      demonstration_data: true,
    });
  }

  async function recordShare(request, env) {
    const session = await requireGuestSession(request, env);
    if (!session) return json({ error: 'unauthorized - invalid or revoked access token' }, 401);
    await env.DB.prepare('INSERT INTO marau_share_events (guest_session_id, created_at) VALUES (?, ?)').bind(session.session_id, nowIso()).run();
    return json({ ok: true });
  }

  async function qrForCode(request, env, url) {
    const code = String(url.searchParams.get('code') || '').toUpperCase();
    if (!isWellFormedCode(code)) return json({ error: 'not found' }, 404);
    const row = await env.DB.prepare('SELECT 1 AS ok FROM marau_referral_codes WHERE code = ?').bind(code).first();
    if (!row) return json({ error: 'not found' }, 404);
    return new Response(qrSvg(`${baseUrl(request, env)}/r/${code}`), { headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  }

  async function validateCode(env, code) {
    const c = String(code || '').toUpperCase();
    const ok = isWellFormedCode(c) && Boolean(await env.DB.prepare('SELECT 1 AS ok FROM marau_referral_codes WHERE code = ?').bind(c).first());
    return json({ valid: ok }, ok ? 200 : 404); // deliberately nothing else: no referrer, no counts
  }

  // ----------------------------------------------------- staff verification of an uncertain leg status

  async function verifyLegStatus(request, env, bookingId) {
    const staff = await requireStaffIdentity(request, env);
    if (!staff) return json({ error: 'unauthorized - a valid staff identity token (x-marau-staff-token) is required' }, 401);
    let b; try { b = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
    const errors = [];
    if (!['return_upcoming', 'return_not_going_ahead'].includes(b.verdict)) errors.push("verdict must be 'return_upcoming' or 'return_not_going_ahead'");
    const evidence = typeof b.evidence === 'string' ? b.evidence.trim() : '';
    if (evidence.length < 10) errors.push('evidence is required: say what was checked, with whom and when (at least 10 characters)');
    if (typeof b.itinerary_basis !== 'string' || !b.itinerary_basis) errors.push('itinerary_basis is required: the itinerary you checked, exactly as shown in Needs attention, so the verification is tied to it');
    if (errors.length) return json({ error: 'validation failed', details: errors }, 400);
    const leg = await env.DB.prepare(`SELECT id, leg_key, status, status_uncertainty, source_status, pickup_datetime, pickup_zone, destination_zone,
      (SELECT a.pickup_datetime FROM marau_test_bookings a WHERE a.source_booking_ref = marau_test_bookings.source_booking_ref AND a.leg_key = 'arrival') AS arrival_pickup_datetime FROM marau_test_bookings WHERE id = ?`).bind(bookingId).first();
    if (!leg) return json({ error: 'booking not found' }, 404);
    if (!leg.status_uncertainty) return json({ error: 'NOTHING_TO_VERIFY', detail: 'this leg carries no status uncertainty' }, 409);
    const now = nowIso();
    const basis = legStatusBasis({ source_status: leg.source_status, return_pickup_datetime: leg.pickup_datetime, return_pickup_zone: leg.pickup_zone, return_destination_zone: leg.destination_zone, arrival_pickup_datetime: leg.arrival_pickup_datetime });
    if (b.itinerary_basis !== basis) {
      return json({ error: 'ITINERARY_CHANGED', detail: 'The itinerary changed since you looked at it - nothing was recorded. Reload Needs attention, check the current return details and verify again.',
        current: { booking_id: bookingId, return_pickup_datetime: leg.pickup_datetime, pickup_zone: leg.pickup_zone, destination_zone: leg.destination_zone, source_status: leg.source_status, itinerary_basis: basis } }, 409);
    }
    const newStatus = b.verdict === 'return_upcoming' ? 'confirmed' : 'cancelled';
    // The source is NEVER written or read here: this records a Marau-side fact with its evidence, attributed to the named actor.
    await env.DB.batch([
      env.DB.prepare('INSERT INTO marau_leg_status_verifications (booking_id, verdict, evidence, actor, basis, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(bookingId, b.verdict, evidence.slice(0, 500), staff.operatorName, basis, now),
      env.DB.prepare(`UPDATE marau_test_bookings SET status = ?, status_uncertainty = NULL, status_verified_by = ?, status_verified_at = ?, status_verification_evidence = ?, leg_note = ?, updated_at = ? WHERE id = ? AND status_uncertainty IS NOT NULL`)
        .bind(newStatus, staff.operatorName, now, evidence.slice(0, 500), b.verdict === 'return_upcoming' ? 'verified_by_staff_upcoming' : 'verified_by_staff_not_going_ahead', now, bookingId),
    ]);
    await reconcileApplications(env);
    return json({ ok: true, source_unchanged: true, leg: { id: bookingId, status: newStatus, status_uncertainty: null, verified_by: staff.operatorName, verified_at: now, evidence: evidence.slice(0, 500) }, demonstration_data: true });
  }

  // ------------------------------------------------------- return-value allocation rules

  const ruleShape = (r) => ({ rule_id: r.rule_id, kind: r.kind, percent: r.kind === 'percent_of_total' ? r.value / 100 : undefined, fixed_return_fjd: r.kind === 'fixed_return_fjd' ? fjd(r.value) : undefined,
    status: r.status, proposed_by: r.proposed_by, approved_by: r.approved_by, approval_basis: r.approval_basis, approval_note: r.approval_note });

  async function proposeRule(request, env) {
    const staff = await requireStaffIdentity(request, env);
    if (!staff) return json({ error: 'unauthorized - a valid staff identity token (x-marau-staff-token) is required' }, 401);
    let b; try { b = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
    let value;
    if (b.kind === 'percent_of_total') {
      const pct = Number(b.percent);
      value = Math.round(pct * 100);
      if (!(typeof b.percent === 'number' && pct > 0 && pct < 100 && value >= 1 && value <= 9999)) return json({ error: 'validation failed', details: ['percent must be a number above 0 and below 100'] }, 400);
    } else if (b.kind === 'fixed_return_fjd') {
      value = toCents(b.amount_fjd);
      if (!(typeof b.amount_fjd === 'number' && value > 0 && value <= 10_000_000)) return json({ error: 'validation failed', details: ['amount_fjd must be a positive FJD amount'] }, 400);
    } else return json({ error: 'validation failed', details: ["kind must be 'percent_of_total' or 'fixed_return_fjd'"] }, 400);
    const id = idFor('rule');
    await env.DB.prepare('INSERT INTO marau_return_allocation_rules (rule_id, kind, value, status, proposed_by, proposed_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, b.kind, value, 'proposed', staff.operatorName, nowIso()).run();
    const row = await env.DB.prepare('SELECT * FROM marau_return_allocation_rules WHERE rule_id = ?').bind(id).first();
    return json({ ok: true, rule: ruleShape(row), note: 'a proposal changes nothing; it must be approved, and the only approval this API can record is a synthetic-preview approval', demonstration_data: true }, 201);
  }

  async function decideRule(request, env, ruleId, action) {
    const staff = await requireStaffIdentity(request, env);
    if (!staff) return json({ error: 'unauthorized - a valid staff identity token (x-marau-staff-token) is required' }, 401);
    let b; try { b = await request.json(); } catch { b = {}; }
    const note = String(b.note || '').trim().slice(0, 300);
    if (note.length < 1) return json({ error: 'a note is required' }, 400);
    const cur = await env.DB.prepare('SELECT * FROM marau_return_allocation_rules WHERE rule_id = ?').bind(ruleId).first();
    if (!cur) return json({ error: 'rule not found' }, 404);
    const now = nowIso();
    if (action === 'approve') {
      if (cur.status !== 'proposed') return json({ error: 'RULE_NOT_PROPOSED', status: cur.status }, 409);
      // `approval_basis` is NEVER read from the body: this API can only record a synthetic-preview approval.
      await env.DB.batch([
        env.DB.prepare(`UPDATE marau_return_allocation_rules SET status = 'retired', retired_by = ?, retired_at = ? WHERE status = 'approved'`).bind(staff.operatorName, now),
        env.DB.prepare(`UPDATE marau_return_allocation_rules SET status = 'approved', approved_by = ?, approved_at = ?, approval_basis = 'synthetic_preview', approval_note = ? WHERE rule_id = ? AND status = 'proposed'`).bind(staff.operatorName, now, note, ruleId),
      ]);
    } else {
      if (cur.status === 'retired') return json({ ok: true, repeated: true, rule: ruleShape(cur) });
      await env.DB.prepare(`UPDATE marau_return_allocation_rules SET status = 'retired', retired_by = ?, retired_at = ? WHERE rule_id = ?`).bind(staff.operatorName, now, ruleId).run();
    }
    await reconcileApplications(env);
    return json({ ok: true, rule: ruleShape(await env.DB.prepare('SELECT * FROM marau_return_allocation_rules WHERE rule_id = ?').bind(ruleId).first()), demonstration_data: true });
  }

  async function listRules(request, env) {
    const staff = await requireStaffIdentity(request, env);
    if (!staff) return json({ error: 'unauthorized - a valid staff identity token (x-marau-staff-token) is required' }, 401);
    const { results } = await env.DB.prepare('SELECT * FROM marau_return_allocation_rules ORDER BY proposed_at DESC').all();
    return json({ rules: results.map(ruleShape), demonstration_data: true });
  }

  // --------------------------------------------------------------- staff views

  async function getPolicy(request, env) {
    const staff = await requireStaffIdentity(request, env);
    if (!staff) return json({ error: 'unauthorized - a valid staff identity token (x-marau-staff-token) is required' }, 401);
    const p = await readPolicy(env);
    return json({ policy: { mode: p.mode, amount_fjd: fjd(p.amount_cents), cap_per_referrer_fjd: fjd(p.cap_cents_per_referrer), min_purchase_fjd: fjd(p.min_purchase_cents), qualify_on: p.qualify_on, require_payment: p.require_payment, funding_source: p.funding_source, live_approved_by: p.live_approved_by, updated_by: p.updated_by },
      policy_change_note: 'A change applies to NEW credits only: every existing credit keeps the terms stored in its own snapshot (amount, stage, payment requirement). Switching mode to off pauses (freezes) earning, promotion and application without deleting or reversing anything; switching back on resumes under the stored terms. A cancellation or refund always reverses, even while off.',
      demonstration_data: true });
  }

  async function setPolicy(request, env) {
    const staff = await requireStaffIdentity(request, env);
    if (!staff) return json({ error: 'unauthorized - a valid staff identity token (x-marau-staff-token) is required' }, 401);
    let b; try { b = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
    const errors = [];
    const mode = b.mode === undefined ? null : String(b.mode);
    if (mode !== null && !['off', 'preview', 'live'].includes(mode)) errors.push("mode must be 'off', 'preview' or 'live'");
    if (mode === 'live') return json({ error: 'LIVE_REWARDS_REQUIRE_OWNER_APPROVAL', detail: 'live mode cannot be switched on through this API; it needs an explicit owner approval and an environment flag' }, 409);
    const amount = b.amount_fjd === undefined ? undefined : toCents(b.amount_fjd);
    const cap = b.cap_per_referrer_fjd === undefined ? undefined : toCents(b.cap_per_referrer_fjd);
    const min = b.min_purchase_fjd === undefined ? undefined : toCents(b.min_purchase_fjd);
    if (amount !== undefined && !(amount > 0 && amount <= 100000)) errors.push('amount_fjd must be a positive FJD amount');
    if (cap !== undefined && !(cap > 0 && cap <= 1000000)) errors.push('cap_per_referrer_fjd must be a positive FJD amount');
    if (min !== undefined && !(min >= 0)) errors.push('min_purchase_fjd must be zero or more');
    if (b.qualify_on !== undefined && !['confirmed', 'fulfilled'].includes(b.qualify_on)) errors.push("qualify_on must be 'confirmed' or 'fulfilled'");
    if (b.require_payment !== undefined && !['none', 'paid_in_full'].includes(b.require_payment)) errors.push("require_payment must be 'none' or 'paid_in_full'");
    if (errors.length) return json({ error: 'validation failed', details: errors }, 400);
    const cur = await readPolicy(env);
    const next = {
      mode: mode ?? cur.mode,
      amount: amount ?? cur.amount_cents, cap: cap ?? cur.cap_cents_per_referrer, min: min ?? cur.min_purchase_cents,
      qualify_on: b.qualify_on ?? cur.qualify_on, require_payment: b.require_payment ?? cur.require_payment, funding: b.funding_source ? String(b.funding_source).slice(0, 80) : cur.funding_source,
    };
    await env.DB.prepare(`UPDATE marau_reward_policy SET mode = ?, amount_cents = ?, cap_cents_per_referrer = ?, min_purchase_cents = ?, qualify_on = ?, require_payment = ?, funding_source = ?, updated_by = ?, updated_at = ? WHERE id = 1`)
      .bind(next.mode, next.amount, next.cap, next.min, next.qualify_on, next.require_payment, next.funding, staff.operatorName, nowIso()).run();
    return getPolicy(request, env);
  }

  async function listCredits(request, env) {
    const staff = await requireStaffIdentity(request, env);
    if (!staff) return json({ error: 'unauthorized - a valid staff identity token (x-marau-staff-token) is required' }, 401);
    await reconcileApplications(env);
    const { results } = await env.DB.prepare(
      `SELECT c.*, gs.guest_phone, gs.guest_email, gs.whatsapp_available, fo.owner AS follow_up_owner FROM marau_reward_credits c JOIN guest_sessions gs ON gs.session_id = c.beneficiary_session_id
       LEFT JOIN marau_follow_up_owners fo ON fo.guest_session_id = c.beneficiary_session_id ORDER BY c.created_at DESC LIMIT 200`
    ).all();
    const out = [];
    for (const c of results) {
      const { results: returns } = c.status === 'earned'
        ? await env.DB.prepare(`SELECT id, client_booking_ref, pickup_datetime, quoted_amount, leg_type, leg_key, leg_value_status, leg_value_cents, source_total_cents, source_settlement_fjd_cents, status_uncertainty, source_status, pickup_zone, destination_zone, (SELECT a.pickup_datetime FROM marau_test_bookings a WHERE a.source_booking_ref = marau_test_bookings.source_booking_ref AND a.leg_key = 'arrival') AS arrival_pickup_datetime FROM marau_test_bookings WHERE guest_session_id = ? AND leg_type IN ('return', 'departure') AND status IN ('pending', 'confirmed', 'confirmed_unallocated') AND pickup_datetime > ? ORDER BY pickup_datetime ASC`).bind(c.beneficiary_session_id, nowIso()).all()
        : { results: [] };
      const { results: noteRows } = await env.DB.prepare(`SELECT source_booking_ref, return_leg_state FROM marau_test_bookings WHERE guest_session_id = ? AND leg_key = 'arrival' AND return_leg_state IN ('missing_return_details', 'unsupported_direction')`).bind(c.beneficiary_session_id).all();
      const notes = noteRows.map((x) => ({ code: x.return_leg_state === 'missing_return_details' ? 'RETURN_DETAILS_MISSING' : 'RETURN_SHAPE_UNSUPPORTED', source_booking_ref: x.source_booking_ref }));
      out.push({
        credit_id: c.credit_id, status: c.status, amount_fjd: fjd(c.amount_cents), funding_source: c.funding_source, needs_manual_adjustment: c.needs_manual_adjustment === 1,
        applied_booking_id: c.applied_booking_id, applied_by: c.applied_by, reversal_reason: c.reversal_reason,
        eligible_return_transfers: returns.map((r) => (r.leg_key
          ? { booking_id: r.id, reference: r.client_booking_ref, pickup_datetime: r.pickup_datetime, leg_type: r.leg_type, leg_key: r.leg_key, needs_staff_confirmation: false, status_uncertainty: r.status_uncertainty || null, needs_status_verification: Boolean(r.status_uncertainty),
              itinerary_basis: r.status_uncertainty ? legStatusBasis({ source_status: r.source_status, return_pickup_datetime: r.pickup_datetime, return_pickup_zone: r.pickup_zone, return_destination_zone: r.destination_zone, arrival_pickup_datetime: r.arrival_pickup_datetime }) : null,
              return_value_status: r.leg_value_status === 'allocated' ? 'allocated' : 'RETURN_VALUE_UNRESOLVED', original_fare_fjd: r.leg_value_status === 'allocated' ? fjd(r.leg_value_cents) : null,
              source_total_fjd: fjd(r.source_total_cents), source_settlement_fjd: fjd(r.source_settlement_fjd_cents) }
          : { booking_id: r.id, reference: r.client_booking_ref, pickup_datetime: r.pickup_datetime, original_fare_fjd: r.quoted_amount, leg_type: r.leg_type, needs_staff_confirmation: r.leg_type === 'departure' })),
        booking_notes: notes,
        // STAFF-ONLY: how to reach the credit holder.
        holder: { phone: c.guest_phone, email: c.guest_email, follow_up: followUpPlan({ whatsappAvailable: c.whatsapp_available, owner: c.follow_up_owner }) },
      });
    }
    return json({ credits: out, demonstration_data: true });
  }

  async function reportExtras(env) {
    await reconcileApplications(env); // the funding figures below must not count a credit whose purchase has been cancelled or refunded
    const q = async (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
    const shares = await q('SELECT COUNT(*) AS n FROM marau_share_events');
    const joined = await q(`SELECT COUNT(*) AS n FROM marau_referrals WHERE status IN ('attributed', 'capped')`);
    const rejected = await q(`SELECT COUNT(*) AS n FROM marau_referrals WHERE status LIKE 'rejected_%'`);
    const { results: byStatus } = await env.DB.prepare(`SELECT status, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents, COALESCE(SUM(applied_cents), 0) AS applied_cents FROM marau_reward_credits GROUP BY status`).all();
    const s = Object.fromEntries(byStatus.map((r) => [r.status, r]));
    const pick = (st, k) => (s[st] ? s[st][k] : 0);
    return {
      referral_shares_tapped: shares.n,
      referral_friends_attributed: joined.n,
      referral_attributions_rejected: rejected.n,
      reward_credits: { pending: pick('pending', 'n'), earned: pick('earned', 'n'), applied: pick('applied', 'n'), reversed: pick('reversed', 'n') },
      reward_funding_committed_fjd: fjd(pick('pending', 'cents') + pick('earned', 'cents') + pick('applied', 'cents')),
      reward_funding_applied_fjd: fjd(pick('applied', 'applied_cents')),
      reward_funding_note: 'reward credits are funded from the recorded funding source (default marau_marketing_budget); the operator payout is never reduced',
    };
  }

  // ------------------------------------------------------------------ router

  async function route(request, env, url) {
    const m = request.method; const p = url.pathname;
    let x = p.match(/^\/r\/([A-Za-z0-9]{8})$/); if (m === 'GET' && x) return html(guestAppHtml);
    if (m === 'GET' && p === '/preview/referral') return guestReferral(request, env);
    if (m === 'POST' && p === '/preview/referral/share') return recordShare(request, env);
    if (m === 'GET' && p === '/preview/referral/qr.svg') return qrForCode(request, env, url);
    x = p.match(/^\/preview\/referral\/validate\/([A-Za-z0-9]{8})$/); if (m === 'GET' && x) return validateCode(env, x[1]);
    if (m === 'GET' && p === '/preview/admin/rewards/policy') return getPolicy(request, env);
    if (m === 'POST' && p === '/preview/admin/rewards/policy') return setPolicy(request, env);
    if (m === 'GET' && p === '/preview/admin/rewards/credits') return listCredits(request, env);
    x = p.match(/^\/preview\/admin\/rewards\/credits\/(cr_[^/]+)\/apply$/); if (m === 'POST' && x) return applyCredit(request, env, x[1]);
    x = p.match(/^\/preview\/admin\/bookings\/(\d+)\/verify-status$/); if (m === 'POST' && x) return verifyLegStatus(request, env, Number(x[1]));
    if (m === 'POST' && p === '/preview/admin/rewards/allocation-rules') return proposeRule(request, env);
    if (m === 'GET' && p === '/preview/admin/rewards/allocation-rules') return listRules(request, env);
    x = p.match(/^\/preview\/admin\/rewards\/allocation-rules\/(rule_[^/]+)\/(approve|retire)$/); if (m === 'POST' && x) return decideRule(request, env, x[1], x[2]);
    x = p.match(/^\/preview\/admin\/rewards\/adjustments\/(adj_[^/]+)\/resolve$/); if (m === 'POST' && x) return resolveAdjustment(request, env, x[1]);
    return null;
  }

  return { route, attribute, ensureCode, onRequestTransition, reconcileRequest, reconcileApplications, reportExtras, fareFor };
}
