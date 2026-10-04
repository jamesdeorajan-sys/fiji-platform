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

export function createReferrals(deps) {
  const { json, html, requireStaffIdentity, requireGuestSession, nowIso, cryptoRandomId, guestAppHtml } = deps;
  const idFor = (p) => `${p}_${cryptoRandomId()}`;

  async function readPolicy(env) { return env.DB.prepare('SELECT * FROM marau_reward_policy WHERE id = 1').first(); }

  /** Whether rewards may be earned for this referrer RIGHT NOW. Unset/off/unapproved -> never. */
  function policyPermits(policy, referrerIsTestData, env) {
    if (!policy || policy.mode === 'off') return false;
    if (!(policy.amount_cents > 0 && policy.cap_cents_per_referrer > 0)) return false; // not configured: nothing is promised
    if (policy.mode === 'preview') return referrerIsTestData === 1;
    if (policy.mode === 'live') return Boolean(policy.live_approved_by) && env.MARAU_ALLOW_LIVE_REWARDS === '1';
    return false;
  }

  function publicPolicyView(policy, env) {
    const active = policyPermits(policy, 1, env);
    if (!active) return { rewards_active: false, message: 'Referral rewards are not switched on yet. You can still share the link.' };
    return { rewards_active: true, reward_fjd: fjd(policy.amount_cents), cap_fjd: fjd(policy.cap_cents_per_referrer), qualify_on: policy.qualify_on, minimum_purchase_fjd: fjd(policy.min_purchase_cents) };
  }

  // ------------------------------------------------------------- codes / links

  async function ensureCode(env, sessionId) {
    const existing = await env.DB.prepare('SELECT code FROM marau_referral_codes WHERE guest_session_id = ?').bind(sessionId).first();
    if (existing) return existing.code;
    for (let i = 0; i < 6; i += 1) {
      const code = generateReferralCode();
      try {
        await env.DB.prepare('INSERT INTO marau_referral_codes (code, guest_session_id, created_at) VALUES (?, ?, ?)').bind(code, sessionId, nowIso()).run();
        return code;
      } catch (err) {
        if (!/UNIQUE/i.test(String(err && err.message))) throw err;
        const raced = await env.DB.prepare('SELECT code FROM marau_referral_codes WHERE guest_session_id = ?').bind(sessionId).first();
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
    const referrer = await env.DB.prepare('SELECT * FROM guest_sessions WHERE session_id = ?').bind(codeRow.guest_session_id).first();
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

  /** Hook: the referred guest's offer purchase changed state. */
  async function onRequestTransition(env, { request, from, to }) {
    const referral = await env.DB.prepare(
      `SELECT r.*, gs.test_data AS referrer_test_data FROM marau_referrals r JOIN guest_sessions gs ON gs.session_id = r.referrer_session_id
       WHERE r.referred_session_id = ? AND r.status IN ('attributed', 'capped')`
    ).bind(request.guest_session_id).first();
    if (!referral) return { handled: false };

    if (to === 'cancelled_by_staff' || to === 'cancelled_by_guest') return reverseForRequest(env, request, `purchase ${to.replace(/_/g, ' ')} (was ${from})`);
    if (to !== 'confirmed' && to !== 'fulfilled') return { handled: false };

    const policy = await readPolicy(env);
    if (!policyPermits(policy, referral.referrer_test_data, env)) return { handled: false, blocked: 'policy' };
    if (request.total_cents < policy.min_purchase_cents) return { handled: false, blocked: 'below_minimum_purchase' };

    const earnedNow = to === 'fulfilled' || policy.qualify_on === 'confirmed';
    const now = nowIso();
    const snapshot = JSON.stringify({ amount_cents: policy.amount_cents, cap_cents_per_referrer: policy.cap_cents_per_referrer, min_purchase_cents: policy.min_purchase_cents, qualify_on: policy.qualify_on, mode: policy.mode });
    let created = false;
    try {
      // One statement: the cap is checked in the same atomic INSERT that creates the credit. UNIQUE(referral_id) makes a
      // second credit for this friend impossible.
      const res = await env.DB.prepare(
        `INSERT INTO marau_reward_credits (credit_id, referral_id, beneficiary_session_id, referred_session_id, qualifying_request_id, amount_cents, status, funding_source, policy_snapshot, created_at, earned_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE (SELECT COALESCE(SUM(amount_cents), 0) FROM marau_reward_credits WHERE beneficiary_session_id = ? AND status IN ('pending', 'earned', 'applied')) + ? <= ?`
      ).bind(idFor('cr'), referral.referral_id, referral.referrer_session_id, referral.referred_session_id, request.request_id, policy.amount_cents,
        earnedNow ? 'earned' : 'pending', policy.funding_source, snapshot, now, earnedNow ? now : null,
        referral.referrer_session_id, policy.amount_cents, policy.cap_cents_per_referrer).run();
      created = res.meta.changes === 1;
      if (!created) {
        // Zero rows can mean the CAP stopped a new credit - or that this friend ALREADY has a credit whose own amount
        // counts toward the cap (a second event for the same purchase). Only the former is "capped".
        const existing = await env.DB.prepare('SELECT 1 AS ok FROM marau_reward_credits WHERE referral_id = ?').bind(referral.referral_id).first();
        if (!existing) {
          await env.DB.prepare(`UPDATE marau_referrals SET status = 'capped' WHERE referral_id = ? AND status = 'attributed'`).bind(referral.referral_id).run();
          return { handled: true, capped: true };
        }
      }
    } catch (err) {
      if (!/UNIQUE/i.test(String(err && err.message))) throw err;
      // A credit for this friend already exists (an earlier confirmed -> now fulfilled, or a repeat call): never a second.
    }
    if (!created && earnedNow) {
      await env.DB.prepare(`UPDATE marau_reward_credits SET status = 'earned', earned_at = ? WHERE referral_id = ? AND qualifying_request_id = ? AND status = 'pending'`).bind(now, referral.referral_id, request.request_id).run();
    }
    return { handled: true, created };
  }

  async function reverseForRequest(env, request, reason) {
    const now = nowIso();
    const before = await env.DB.prepare(`SELECT credit_id, status FROM marau_reward_credits WHERE qualifying_request_id = ?`).bind(request.request_id).first();
    if (!before || before.status === 'reversed') return { handled: false };
    const res = await env.DB.prepare(
      `UPDATE marau_reward_credits SET status = 'reversed', reversed_at = ?, reversal_reason = ?, needs_manual_adjustment = CASE WHEN status = 'applied' THEN 1 ELSE 0 END
       WHERE qualifying_request_id = ? AND status IN ('pending', 'earned', 'applied')`
    ).bind(now, reason, request.request_id).run();
    if (res.meta.changes === 1 && before.status === 'applied') {
      // The discount was already given on a return transfer: surface it for a human; never silently change a fare.
      await env.DB.prepare(`UPDATE marau_booking_adjustments SET status = 'reversal_pending_staff' WHERE credit_id = ?`).bind(before.credit_id).run();
    }
    return { handled: true, reversed: res.meta.changes === 1, was: before.status };
  }

  async function applyCredit(request, env, creditId) {
    const staff = await requireStaffIdentity(request, env);
    if (!staff) return json({ error: 'unauthorized - a valid staff identity token (x-marau-staff-token) is required' }, 401);
    let body; try { body = await request.json(); } catch { body = {}; }
    const bookingId = Number(body.booking_id);
    if (!Number.isInteger(bookingId) || bookingId <= 0) return json({ error: 'booking_id is required' }, 400);

    const credit = await env.DB.prepare('SELECT * FROM marau_reward_credits WHERE credit_id = ?').bind(creditId).first();
    if (!credit) return json({ error: 'credit not found' }, 404);

    // Idempotent repair: a retry for the SAME booking after a partial failure finishes the job instead of failing.
    if (credit.status === 'applied') {
      if (credit.applied_booking_id !== bookingId) return json({ error: 'CREDIT_ALREADY_APPLIED_ELSEWHERE' }, 409);
      await ensureAdjustment(env, credit, bookingId, staff.operatorName);
      return json({ ok: true, repeated: true, fare: await fareFor(env, bookingId), demonstration_data: true });
    }
    if (credit.status !== 'earned') return json({ error: 'CREDIT_NOT_APPLICABLE', status: credit.status, detail: credit.status === 'pending' ? 'the purchase is not yet fulfilled' : undefined }, 409);

    const now = nowIso();
    const booking = await env.DB.prepare(
      `SELECT * FROM marau_test_bookings WHERE id = ? AND guest_session_id = ? AND leg_type = 'return' AND status IN ('pending', 'confirmed', 'confirmed_unallocated') AND pickup_datetime > ?`
    ).bind(bookingId, credit.beneficiary_session_id, now).first();
    if (!booking) return json({ error: 'NOT_AN_ELIGIBLE_RETURN_TRANSFER', detail: "the booking must be the credit holder's own upcoming, uncancelled RETURN transfer" }, 409);
    const original = Math.round(Number(booking.quoted_amount) * 100);
    const applied = Math.min(credit.amount_cents, original);

    const cas = await env.DB.prepare(
      `UPDATE marau_reward_credits SET status = 'applied', applied_at = ?, applied_by = ?, applied_booking_id = ?, applied_cents = ? WHERE credit_id = ? AND status = 'earned'`
    ).bind(now, staff.operatorName, bookingId, applied, creditId).run();
    if (cas.meta.changes !== 1) return json({ error: 'CREDIT_NOT_APPLICABLE', detail: 'another redemption won the race' }, 409);

    try {
      await ensureAdjustment(env, { ...credit, applied_cents: applied }, bookingId, staff.operatorName, original);
    } catch (err) {
      // The booking already carries a credit (UNIQUE booking_id): hand the credit back so it can be used elsewhere.
      await env.DB.prepare(`UPDATE marau_reward_credits SET status = 'earned', applied_at = NULL, applied_by = NULL, applied_booking_id = NULL, applied_cents = NULL WHERE credit_id = ? AND applied_booking_id = ?`).bind(creditId, bookingId).run();
      if (/UNIQUE/i.test(String(err && err.message))) return json({ error: 'BOOKING_ALREADY_HAS_A_CREDIT' }, 409);
      throw err;
    }
    return json({ ok: true, fare: await fareFor(env, bookingId), demonstration_data: true });
  }

  async function ensureAdjustment(env, credit, bookingId, operator, originalCents) {
    const existing = await env.DB.prepare('SELECT adjustment_id FROM marau_booking_adjustments WHERE credit_id = ?').bind(credit.credit_id).first();
    if (existing) return existing.adjustment_id;
    let original = originalCents;
    if (original == null) {
      const b = await env.DB.prepare('SELECT quoted_amount FROM marau_test_bookings WHERE id = ?').bind(bookingId).first();
      original = Math.round(Number(b.quoted_amount) * 100);
    }
    const creditCents = credit.applied_cents ?? Math.min(credit.amount_cents, original);
    const id = idFor('adj');
    await env.DB.prepare(
      `INSERT INTO marau_booking_adjustments (adjustment_id, booking_id, credit_id, kind, original_quote_cents, credit_cents, amount_due_cents, operator_payout_cents, operator_payout_unchanged, funded_by, status, created_by, created_at)
       VALUES (?, ?, ?, 'referral_credit', ?, ?, ?, NULL, 1, ?, 'applied', ?, ?)`
    ).bind(id, bookingId, credit.credit_id, original, creditCents, original - creditCents, credit.funding_source, operator, nowIso()).run();
    return id;
  }

  /** Original fare, credit and amount due as three SEPARATE numbers, plus the quote history. Never mutates anything. */
  async function fareFor(env, bookingId) {
    const b = await env.DB.prepare('SELECT id, quoted_amount, leg_type, created_at FROM marau_test_bookings WHERE id = ?').bind(bookingId).first();
    if (!b) return null;
    const original = Math.round(Number(b.quoted_amount) * 100);
    const adj = await env.DB.prepare('SELECT * FROM marau_booking_adjustments WHERE booking_id = ?').bind(bookingId).first();
    const history = [{ event: 'original_quote', fjd: fjd(original), at: b.created_at }];
    if (!adj) return { original_fare_fjd: fjd(original), referral_credit_fjd: 0, amount_due_fjd: fjd(original), operator_payout_unchanged: true, quote_history: history };
    history.push({ event: adj.status === 'applied' ? 'referral_credit_applied' : 'referral_credit_reversal_pending_staff', credit_fjd: fjd(adj.credit_cents), at: adj.created_at });
    return {
      original_fare_fjd: fjd(adj.original_quote_cents),
      referral_credit_fjd: fjd(adj.credit_cents),
      amount_due_fjd: fjd(adj.amount_due_cents),
      operator_payout_unchanged: adj.operator_payout_unchanged === 1,
      funded_by: adj.funded_by,
      adjustment_status: adj.status,
      quote_history: history,
    };
  }

  // -------------------------------------------------------------- guest views

  async function guestReferral(request, env) {
    const session = await requireGuestSession(request, env);
    if (!session) return json({ error: 'unauthorized - invalid or revoked access token' }, 401);
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
      policy: publicPolicyView(policy, env),
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

  // --------------------------------------------------------------- staff views

  async function getPolicy(request, env) {
    const staff = await requireStaffIdentity(request, env);
    if (!staff) return json({ error: 'unauthorized - a valid staff identity token (x-marau-staff-token) is required' }, 401);
    const p = await readPolicy(env);
    return json({ policy: { mode: p.mode, amount_fjd: fjd(p.amount_cents), cap_per_referrer_fjd: fjd(p.cap_cents_per_referrer), min_purchase_fjd: fjd(p.min_purchase_cents), qualify_on: p.qualify_on, funding_source: p.funding_source, live_approved_by: p.live_approved_by, updated_by: p.updated_by }, demonstration_data: true });
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
    if (errors.length) return json({ error: 'validation failed', details: errors }, 400);
    const cur = await readPolicy(env);
    const next = {
      mode: mode ?? cur.mode,
      amount: amount ?? cur.amount_cents, cap: cap ?? cur.cap_cents_per_referrer, min: min ?? cur.min_purchase_cents,
      qualify_on: b.qualify_on ?? cur.qualify_on, funding: b.funding_source ? String(b.funding_source).slice(0, 80) : cur.funding_source,
    };
    await env.DB.prepare(`UPDATE marau_reward_policy SET mode = ?, amount_cents = ?, cap_cents_per_referrer = ?, min_purchase_cents = ?, qualify_on = ?, funding_source = ?, updated_by = ?, updated_at = ? WHERE id = 1`)
      .bind(next.mode, next.amount, next.cap, next.min, next.qualify_on, next.funding, staff.operatorName, nowIso()).run();
    return getPolicy(request, env);
  }

  async function listCredits(request, env) {
    const staff = await requireStaffIdentity(request, env);
    if (!staff) return json({ error: 'unauthorized - a valid staff identity token (x-marau-staff-token) is required' }, 401);
    const { results } = await env.DB.prepare(
      `SELECT c.*, gs.guest_phone, gs.guest_email, gs.whatsapp_available FROM marau_reward_credits c JOIN guest_sessions gs ON gs.session_id = c.beneficiary_session_id ORDER BY c.created_at DESC LIMIT 200`
    ).all();
    const out = [];
    for (const c of results) {
      const { results: returns } = c.status === 'earned'
        ? await env.DB.prepare(`SELECT id, client_booking_ref, pickup_datetime, quoted_amount FROM marau_test_bookings WHERE guest_session_id = ? AND leg_type = 'return' AND status IN ('pending', 'confirmed', 'confirmed_unallocated') AND pickup_datetime > ? ORDER BY pickup_datetime ASC`).bind(c.beneficiary_session_id, nowIso()).all()
        : { results: [] };
      out.push({
        credit_id: c.credit_id, status: c.status, amount_fjd: fjd(c.amount_cents), funding_source: c.funding_source, needs_manual_adjustment: c.needs_manual_adjustment === 1,
        applied_booking_id: c.applied_booking_id, applied_by: c.applied_by, reversal_reason: c.reversal_reason,
        eligible_return_transfers: returns.map((r) => ({ booking_id: r.id, reference: r.client_booking_ref, pickup_datetime: r.pickup_datetime, original_fare_fjd: r.quoted_amount })),
        // STAFF-ONLY: how to reach the credit holder.
        holder: { phone: c.guest_phone, email: c.guest_email, follow_up: followUpPlan({ whatsappAvailable: c.whatsapp_available, owner: null }) },
      });
    }
    return json({ credits: out, demonstration_data: true });
  }

  async function reportExtras(env) {
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
    return null;
  }

  return { route, attribute, ensureCode, onRequestTransition, reportExtras, fareFor };
}
