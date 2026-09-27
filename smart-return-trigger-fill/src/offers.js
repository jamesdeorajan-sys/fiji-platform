/* Issue #54 Stage 1 (SHADOW MODE) — trigger-fill offer state machine.
 *
 * DISCOVERED -> VALIDATED -> ACTIVE -> HELD -> FILLED
 *                                  \-> EXPIRED
 *                            ACTIVE -> EXPIRED
 *                             HELD -> ACTIVE   (releaseHold; not in the
 *                                               issue's diagram literally,
 *                                               but required so a timed-out
 *                                               or cancelled hold doesn't
 *                                               strand inventory forever —
 *                                               flagged explicitly in
 *                                               docs/CEO_RELEASE_REPORT.md)
 *
 * Every transition goes through store.casOfferStatus, i.e. a single
 * conditional write keyed on the CURRENT status. Two callers racing for
 * the same offer_id can only ever have one succeed — that's the whole
 * double-sell prevention mechanism, not an application-level lock.
 *
 * Marau Stage 1 fix (2026-09-28): every exported function here is now
 * `async` and every store call is `await`ed. Before this fix, every
 * function below called store methods and used their return values
 * SYNCHRONOUSLY. That was silently correct only because the only store
 * ever exercised (createMemoryStore, src/db.js) returns plain values, not
 * Promises. createD1Store — written for real Cloudflare D1 — returns a
 * Promise from every method, per the real D1 API. Called synchronously
 * against a Promise-returning store, `store.getOffer(id)` would hand back
 * a pending Promise object (not the offer), `offer.expires_at` would be
 * `undefined` (a Promise has no such property), and `result.success` in
 * holdOffer would likewise be `undefined` — always falsy — so holdOffer
 * would report every hold attempt as a failure regardless of what the
 * database actually did, while the real write raced on, unawaited, in
 * the background. See test/async_store_regression.test.js for the
 * reproduction (it fails on every function below without these awaits).
 */
import { cryptoRandomId } from './model.js';

export async function discoverOffer(store, params) {
  const nowIso = new Date().toISOString();
  const offer = {
    offer_id: params.offer_id ?? `off_${cryptoRandomId()}`,
    source_movement_id: params.source_movement_id,
    origin_zone: params.origin_zone,
    destination_zone: params.destination_zone,
    corridor_aliases: params.corridor_aliases ?? null,
    earliest_pickup: params.earliest_pickup,
    latest_pickup: params.latest_pickup,
    vehicle_class: params.vehicle_class,
    capacity: params.capacity ?? 1,
    standard_price: params.standard_price,
    smart_match_price: params.smart_match_price ?? null,
    absolute_floor: params.absolute_floor ?? null,
    expires_at: params.expires_at,
    inventory_count: params.inventory_count ?? 1,
    status: 'DISCOVERED',
    test_data: params.test_data,
    created_at: nowIso,
    updated_at: nowIso,
  };
  return await store.createOffer(offer);
}

const REQUIRED_TO_VALIDATE = ['vehicle_class', 'capacity', 'standard_price', 'earliest_pickup', 'latest_pickup'];

export async function validateOffer(store, offerId) {
  const offer = await store.getOffer(offerId);
  if (!offer) return { success: false, reason: 'NOT_FOUND' };
  const missing = REQUIRED_TO_VALIDATE.filter((f) => offer[f] == null);
  if (missing.length > 0) {
    return { success: false, reason: `MISSING_FIELDS:${missing.join(',')}` };
  }
  return await store.casOfferStatus(offerId, 'DISCOVERED', 'VALIDATED');
}

export async function activateOffer(store, offerId) {
  return await store.casOfferStatus(offerId, 'VALIDATED', 'ACTIVE');
}

/** Atomic hold — see file header. Fails cleanly if already HELD/FILLED/EXPIRED. */
export async function holdOffer(store, offerId) {
  const offer = await store.getOffer(offerId);
  if (offer && offer.expires_at && new Date(offer.expires_at) <= new Date()) {
    await store.casOfferStatus(offerId, offer.status, 'EXPIRED');
    return { success: false, reason: 'EXPIRED' };
  }
  const result = await store.casOfferStatus(offerId, 'ACTIVE', 'HELD');
  if (!result.success) {
    return { success: false, reason: `NOT_ACTIVE_CURRENT_STATUS_${result.offer?.status ?? 'UNKNOWN'}` };
  }
  return result;
}

export async function releaseHold(store, offerId) {
  return await store.casOfferStatus(offerId, 'HELD', 'ACTIVE');
}

export async function fillOffer(store, offerId, { movement_id } = {}) {
  return await store.casOfferStatus(offerId, 'HELD', 'FILLED', { source_movement_id: movement_id });
}

export async function expireOffer(store, offerId) {
  const offer = await store.getOffer(offerId);
  if (!offer) return { success: false, reason: 'NOT_FOUND' };
  if (['FILLED', 'EXPIRED'].includes(offer.status)) {
    return { success: false, reason: 'ALREADY_TERMINAL' };
  }
  return await store.casOfferStatus(offerId, offer.status, 'EXPIRED');
}

export async function sweepExpiredOffers(store, { nowIso = new Date().toISOString() } = {}) {
  const expired = [];
  const all = await store.listOffers();
  for (const offer of all) {
    if (['FILLED', 'EXPIRED'].includes(offer.status)) continue;
    if (offer.expires_at && offer.expires_at <= nowIso) {
      const result = await store.casOfferStatus(offer.offer_id, offer.status, 'EXPIRED');
      if (result.success) expired.push(result.offer);
    }
  }
  return expired;
}
