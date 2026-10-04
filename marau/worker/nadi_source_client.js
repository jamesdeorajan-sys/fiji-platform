/* Marau (PREVIEW/TEST ONLY) - client for the PROPOSED real source contract.
 *
 * Status, stated plainly: this adapts worker/source_confirm.js's injected `client` interface to the endpoints that
 * branch `ceo/nadi-source-confirm-attempt-identity` (commit 0d0976e) proposes on nadi-dispatch-api:
 *
 *   POST /admin/bookings/manual-assign     { driver_id, booking_id, attempt_id, operator }   (extended, optional fields)
 *   GET  /admin/bookings/:id/confirmation  -> { status, assigned_driver_id, confirmation_attempt_id, confirmed_operator, ... }
 *
 * Neither extension is deployed, and milestone38 is not applied to any database. Until James approves that release
 * this client can only be exercised against the real worker.js executed IN-PROCESS by test/marau_source_real_contract
 * .test.mjs. It is NOT wired to any production URL, and the preview Worker never configures it: the preview keeps
 * using the synthetic source unless NADI_SOURCE_BASE_URL is explicitly set (it is not set anywhere).
 *
 * Keeps source confirmation separate from Marau's local persistence: this file performs only the two source calls and
 * maps their results; the durable local ledger, classification and recovery all stay in source_confirm.js.
 *
 * Error policy - what is AMBIGUOUS (throw, so source_confirm.js recovers via readback rather than guessing):
 *   network failure, timeout, 401/403 (misconfigured credential), 404 on the write, 5xx, 501 (contract not deployed),
 *   and any non-JSON body. What is DEFINITE and returned as data: 200 won, 200 replayed, 409 not-won with `current`.
 * `sourceBookingRef` for the real source is the numeric booking id as a string.
 */

const DEFAULT_TIMEOUT_MS = 8000;

// Only a plain positive decimal booking id ever reaches the URL path: no whitespace, signs, dots, slashes, queries.
export function bookingIdFromRef(sourceBookingRef) {
  if (typeof sourceBookingRef !== 'string' && typeof sourceBookingRef !== 'number') throw new Error('SOURCE_REF_NOT_A_BOOKING_ID');
  const text = String(sourceBookingRef);
  if (!/^[1-9][0-9]{0,14}$/.test(text)) throw new Error('SOURCE_REF_NOT_A_BOOKING_ID');
  return Number(text);
}

// The source must be reached over https (loopback http is allowed only for in-process/local tests), with no embedded
// credentials, query or fragment: the admin credential is only ever attached to requests for this exact origin + path.
export function validatedRoot(baseUrl) {
  let u;
  try { u = new URL(String(baseUrl)); } catch { throw new Error('SOURCE_BASE_URL_INVALID'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) throw new Error('SOURCE_BASE_URL_MUST_BE_HTTPS');
  if (u.username || u.password || u.search || u.hash) throw new Error('SOURCE_BASE_URL_MUST_NOT_CARRY_CREDENTIALS_OR_QUERY');
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

function pickConfirmationState(row) {
  if (!row) return null;
  return {
    status: row.status,
    assigned_driver_id: row.assigned_driver_id ?? null,
    confirmation_attempt_id: row.confirmation_attempt_id ?? null,
    confirmed_operator: row.confirmed_operator ?? null,
    // The source's own label for how that operator name was established. 'service-asserted' = vouched for by the calling
    // service, NOT independently authenticated human identity.
    confirmed_operator_attestation: row.confirmed_operator_attestation ?? null,
  };
}

export function createNadiSourceClient({ baseUrl, adminToken, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!baseUrl) throw new Error('baseUrl is required');
  if (!adminToken) throw new Error('adminToken is required');
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const root = validatedRoot(baseUrl);

  async function call(method, pathname, body) {
    const res = await doFetch(`${root}${pathname}`, {
      method,
      headers: { authorization: `Bearer ${adminToken}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      // Never follow a redirect: the admin credential must not be replayed to wherever a (mis)configured host points.
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 300 && res.status < 400) throw new Error(`SOURCE_REDIRECT_REFUSED_${res.status}`);
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`SOURCE_NON_JSON_RESPONSE_${res.status}`);
    }
    return { status: res.status, data };
  }

  return {
    async getReservation(sourceBookingRef) {
      const id = bookingIdFromRef(sourceBookingRef);
      const { status, data } = await call('GET', `/admin/bookings/${id}/confirmation`);
      if (status === 404) return null;
      if (status !== 200 || !data.ok) throw new Error(`SOURCE_READBACK_FAILED_${status}`);
      return pickConfirmationState(data);
    },

    async confirmReservation(sourceBookingRef, { driverId, attemptId, operator }) {
      const id = bookingIdFromRef(sourceBookingRef);
      const { status, data } = await call('POST', '/admin/bookings/manual-assign', {
        driver_id: Number(driverId),
        booking_id: id,
        attempt_id: attemptId,
        operator,
      });
      // The win response carries the whole booking row (guest details included) - keep only the decision fields.
      if (status === 200 && data.won === true) return { won: true, current: pickConfirmationState(data.booking) };
      if (status === 200 && data.replayed === true) return { won: false, replayed: true, current: pickConfirmationState(data.current) };
      if (status === 409 && data.won === false && data.current) return { won: false, current: pickConfirmationState(data.current) };
      // Everything else (caller errors like ATTEMPT_ID_DRIVER_MISMATCH, auth failures, 404, 501, 5xx) is not a
      // decision: throw so the caller recovers from the source's own readback instead of guessing.
      throw new Error(`SOURCE_CONFIRM_UNEXPECTED_${status}_${data && (data.error || data.reason) ? data.error || data.reason : 'NO_DETAIL'}`);
    },
  };
}
