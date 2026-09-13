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
 */
import { cryptoRandomId } from './model.js';

export function discoverOffer(store, params) {
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
  return store.createOffer(offer);
}

const REQUIRED_TO_VALIDATE = ['vehicle_class', 'capacity', 'standard_price', 'earliest_pickup', 'latest_pickup'];

export function validateOffer(store, offerId) {
  const offer = store.getOffer(offerId);
  if (!offer) return { success: false, reason: 'NOT_FOUND' };
  const missing = REQUIRED_TO_VALIDATE.filter((f) => offer[f] == null);
  if (missing.length > 0) {
    return { success: false, reason: `MISSING_FIELDS:${missing.join(',')}` };
  }
  return store.casOfferStatus(offerId, 'DISCOVERED', 'VALIDATED');
}

export function activateOffer(store, offerId) {
  return store.casOfferStatus(offerId, 'VALIDATED', 'ACTIVE');
}

/** Atomic hold — see file header. Fails cleanly if already HELD/FILLED/EXPIRED. */
export function holdOffer(store, offerId) {
  const offer = store.getOffer(offerId);
  if (offer && offer.expires_at && new Date(offer.expires_at) <= new Date()) {
    store.casOfferStatus(offerId, offer.status, 'EXPIRED');
    return { success: false, reason: 'EXPIRED' };
  }
  const result = store.casOfferStatus(offerId, 'ACTIVE', 'HELD');
  if (!result.success) {
    return { success: false, reason: `NOT_ACTIVE_CURRENT_STATUS_${result.offer?.status ?? 'UNKNOWN'}` };
  }
  return result;
}

export function releaseHold(store, offerId) {
  return store.casOfferStatus(offerId, 'HELD', 'ACTIVE');
}

export function fillOffer(store, offerId, { movement_id } = {}) {
  return store.casOfferStatus(offerId, 'HELD', 'FILLED', { source_movement_id: movement_id });
}

export function expireOffer(store, offerId) {
  const offer = store.getOffer(offerId);
  if (!offer) return { success: false, reason: 'NOT_FOUND' };
  if (['FILLED', 'EXPIRED'].includes(offer.status)) {
    return { success: false, reason: 'ALREADY_TERMINAL' };
  }
  return store.casOfferStatus(offerId, offer.status, 'EXPIRED');
}

export function sweepExpiredOffers(store, { nowIso = new Date().toISOString() } = {}) {
  const expired = [];
  for (const offer of store.listOffers()) {
    if (['FILLED', 'EXPIRED'].includes(offer.status)) continue;
    if (offer.expires_at && offer.expires_at <= nowIso) {
      const result = store.casOfferStatus(offer.offer_id, offer.status, 'EXPIRED');
      if (result.success) expired.push(result.offer);
    }
  }
  return expired;
}
