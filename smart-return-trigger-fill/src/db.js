/* Issue #54 Stage 1 (SHADOW MODE) — storage adapters.
 *
 * Two implementations share one interface:
 *   - createMemoryStore()  — in-process, used by every test in this package.
 *   - createD1Store(env)   — real Cloudflare D1 adapter, written for Stage 2
 *     wiring but never invoked in this branch. No D1 binding is created or
 *     provisioned by this change; wiring it up is an explicit next step
 *     that needs its own CEO approval (see docs/CEO_RELEASE_REPORT.md).
 *
 * The interface is deliberately narrow: every mutation that must be
 * race-safe (offer status transitions, idempotent movement insert) is
 * expressed as a single conditional write so the same logic is exercised
 * whether the backing store is a JS Map or a real SQL table.
 */

export function createMemoryStore() {
  const movements = new Map(); // movement_id -> movement
  const movementsByIdempotencyKey = new Map(); // idempotency_key -> movement_id
  const offers = new Map(); // offer_id -> offer
  const routePriceTruth = new Map(); // `${origin}|${dest}|${vehicleClass}` -> entry
  const creditEligibility = new Map(); // eligibility_id -> entry

  return {
    kind: 'memory',

    insertMovementIfNew(movement) {
      const existingId = movementsByIdempotencyKey.get(movement.idempotency_key);
      if (existingId) {
        return { inserted: false, movement: movements.get(existingId) };
      }
      movements.set(movement.movement_id, { ...movement });
      movementsByIdempotencyKey.set(movement.idempotency_key, movement.movement_id);
      return { inserted: true, movement: { ...movement } };
    },

    getMovement(movementId) {
      const m = movements.get(movementId);
      return m ? { ...m } : null;
    },

    listMovements({ fromIso, toIso } = {}) {
      const all = [...movements.values()];
      if (!fromIso && !toIso) return all.map((m) => ({ ...m }));
      return all
        .filter((m) => (!fromIso || m.pickup_datetime >= fromIso) && (!toIso || m.pickup_datetime <= toIso))
        .map((m) => ({ ...m }));
    },

    updateMovement(movementId, patch) {
      const existing = movements.get(movementId);
      if (!existing) return null;
      const updated = { ...existing, ...patch, updated_at: patch.updated_at ?? new Date().toISOString() };
      movements.set(movementId, updated);
      return { ...updated };
    },

    createOffer(offer) {
      offers.set(offer.offer_id, { ...offer });
      return { ...offer };
    },

    getOffer(offerId) {
      const o = offers.get(offerId);
      return o ? { ...o } : null;
    },

    listOffers({ status } = {}) {
      const all = [...offers.values()];
      return (status ? all.filter((o) => o.status === status) : all).map((o) => ({ ...o }));
    },

    /**
     * Atomic compare-and-swap: succeeds only if the offer's current status
     * equals `expectedStatus`. This is the same shape as the SQL
     * `UPDATE ... WHERE offer_id = ? AND status = ?` used by createD1Store,
     * so two "concurrent" callers racing for the same offer can only ever
     * have one succeed.
     */
    casOfferStatus(offerId, expectedStatus, nextStatus, patch = {}) {
      const existing = offers.get(offerId);
      if (!existing || existing.status !== expectedStatus) {
        return { success: false, offer: existing ? { ...existing } : null };
      }
      const updated = {
        ...existing,
        ...patch,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      };
      offers.set(offerId, updated);
      return { success: true, offer: { ...updated } };
    },

    upsertRoutePriceTruth(entry) {
      const key = `${entry.origin_zone}|${entry.destination_zone}|${entry.vehicle_class}`;
      routePriceTruth.set(key, { ...entry });
      return { ...entry };
    },

    getRoutePriceTruth(originZone, destinationZone, vehicleClass) {
      const key = `${originZone}|${destinationZone}|${vehicleClass}`;
      const entry = routePriceTruth.get(key);
      return entry ? { ...entry } : null;
    },

    recordExperienceCreditEligibility(entry) {
      creditEligibility.set(entry.eligibility_id, { ...entry });
      return { ...entry };
    },

    listExperienceCreditEligibility() {
      return [...creditEligibility.values()].map((e) => ({ ...e }));
    },
  };
}

/**
 * Real D1-backed store. Written to match the schema in migrations/, ready
 * for Stage 2 — not exercised by any test or code path in this branch, and
 * `env.SMART_RETURN_DB` is not bound anywhere yet.
 */
export function createD1Store(env) {
  const db = env.SMART_RETURN_DB;

  return {
    kind: 'd1',

    async insertMovementIfNew(movement) {
      const cols = Object.keys(movement);
      const placeholders = cols.map(() => '?').join(', ');
      const values = cols.map((c) => (typeof movement[c] === 'boolean' ? (movement[c] ? 1 : 0) : movement[c]));
      // INSERT OR IGNORE + unique index on idempotency_key = atomic idempotent write.
      const result = await db
        .prepare(`INSERT OR IGNORE INTO movements (${cols.join(', ')}) VALUES (${placeholders})`)
        .bind(...values)
        .run();
      if (result.meta.changes === 1) {
        return { inserted: true, movement };
      }
      const existing = await db
        .prepare('SELECT * FROM movements WHERE idempotency_key = ?')
        .bind(movement.idempotency_key)
        .first();
      return { inserted: false, movement: existing };
    },

    async getMovement(movementId) {
      return db.prepare('SELECT * FROM movements WHERE movement_id = ?').bind(movementId).first();
    },

    async listMovements({ fromIso, toIso } = {}) {
      if (!fromIso && !toIso) {
        const { results } = await db.prepare('SELECT * FROM movements').all();
        return results;
      }
      const { results } = await db
        .prepare('SELECT * FROM movements WHERE pickup_datetime >= ? AND pickup_datetime <= ?')
        .bind(fromIso ?? '0000-01-01', toIso ?? '9999-12-31')
        .all();
      return results;
    },

    async createOffer(offer) {
      const cols = Object.keys(offer);
      const placeholders = cols.map(() => '?').join(', ');
      const values = cols.map((c) => offer[c]);
      await db.prepare(`INSERT INTO smart_offers (${cols.join(', ')}) VALUES (${placeholders})`).bind(...values).run();
      return offer;
    },

    async getOffer(offerId) {
      return db.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offerId).first();
    },

    /**
     * The real atomicity guarantee: a single conditional UPDATE. If two
     * requests race, only the one whose WHERE clause still matches at
     * execution time changes a row — D1/SQLite serializes writes per
     * database, so `meta.changes` tells us unambiguously who won.
     */
    async casOfferStatus(offerId, expectedStatus, nextStatus, patch = {}) {
      const patchCols = Object.keys(patch);
      const setClause = ['status = ?', 'updated_at = ?', ...patchCols.map((c) => `${c} = ?`)].join(', ');
      const values = [nextStatus, new Date().toISOString(), ...patchCols.map((c) => patch[c]), offerId, expectedStatus];
      const result = await db
        .prepare(`UPDATE smart_offers SET ${setClause} WHERE offer_id = ? AND status = ?`)
        .bind(...values)
        .run();
      const offer = await db.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offerId).first();
      return { success: result.meta.changes === 1, offer };
    },

    async upsertRoutePriceTruth(entry) {
      const cols = Object.keys(entry);
      const placeholders = cols.map(() => '?').join(', ');
      const updateClause = cols.map((c) => `${c} = excluded.${c}`).join(', ');
      await db
        .prepare(
          `INSERT INTO route_price_truth (${cols.join(', ')}) VALUES (${placeholders})
           ON CONFLICT(origin_zone, destination_zone, vehicle_class) DO UPDATE SET ${updateClause}`
        )
        .bind(...cols.map((c) => entry[c]))
        .run();
      return entry;
    },

    async getRoutePriceTruth(originZone, destinationZone, vehicleClass) {
      return db
        .prepare('SELECT * FROM route_price_truth WHERE origin_zone = ? AND destination_zone = ? AND vehicle_class = ?')
        .bind(originZone, destinationZone, vehicleClass)
        .first();
    },

    async recordExperienceCreditEligibility(entry) {
      const cols = Object.keys(entry);
      const placeholders = cols.map(() => '?').join(', ');
      await db
        .prepare(`INSERT INTO experience_credit_eligibility (${cols.join(', ')}) VALUES (${placeholders})`)
        .bind(...cols.map((c) => entry[c]))
        .run();
      return entry;
    },
  };
}
