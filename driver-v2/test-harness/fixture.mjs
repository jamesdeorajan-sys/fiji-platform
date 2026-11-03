// Controlled isolated fixture. Driver 1 is the ONLY identity representing the real test driver; its phone is a deliberately
// obvious NON-production placeholder (the real number is never retrieved or copied). Drivers 2..N exist only so the
// competing-driver gates (11, 15, 16) can be exercised; they are synthetic, carry placeholder numbers, and the
// real-phone guard (cfg.realPhoneMode) refuses every id except 1.
import { D1Sqlite } from './d1_sqlite.mjs';
import { createDriverService } from '../src/service.js';
import { CaptureNotifier, CaptureEvidenceStore } from '../src/adapters.js';
import { SYNTHETIC_BOOKING_ID_FLOOR, SYNTHETIC_REF_PREFIX } from '../src/constants.js';

export class FakeClock { constructor(t = Date.parse('2031-03-01T00:00:00.000Z')) { this.t = t; } now() { return this.t; } advance(ms) { this.t += ms; return this.t; } set(t) { this.t = t; } }

// Obviously fake guest data: canary strings so any leak is detectable by substring scan.
export const CANARY = Object.freeze({ name: 'CANARY-GUEST-NAME-Zxq', phone: '+000-CANARY-PHONE-7788', email: 'canary-guest@example.invalid', flight: 'CANARY-FJ-999', notes: 'CANARY-NOTE-meet-at-pillar-9' });

export async function makeWorld({ drivers = 3, chaos = null, deliveryMode, config, clock: clockOpt } = {}) {
  const db = D1Sqlite.fromSchema({ chaos });
  const clock = clockOpt || new FakeClock();
  const notifier = new CaptureNotifier(deliveryMode ? { deliveryMode } : {});
  const evidenceStore = new CaptureEvidenceStore();
  const service = createDriverService({ db, clock, notifier, evidenceStore, config });
  const iso = (t) => new Date(t).toISOString();
  for (let id = 1; id <= drivers; id++) {
    db.raw.prepare(`INSERT INTO drivers (id,name,phone,status,zones,online,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(id, id === 1 ? 'Gate1 Test Driver 1' : `Gate1 Synthetic Driver ${id}`, id === 1 ? '+000-GATE1-PLACEHOLDER-1' : `+000-GATE1-SYNTH-${id}`, 'verified', JSON.stringify(['Nadi Airport']), 1, iso(clock.now()));
    db.raw.prepare(`INSERT INTO driver_sessions (token,driver_id,expires_at,last_seen_at) VALUES (?,?,?,?)`).run(`tok-gate1-driver-${id}`, id, iso(clock.now() + 86_400_000), null);
    db.raw.prepare(`INSERT INTO wallets (driver_id,balance_fjd) VALUES (?,?)`).run(id, 100 + id);
  }
  let seq = 0;
  async function newBooking(over = {}) {
    seq++;
    const id = SYNTHETIC_BOOKING_ID_FLOOR + seq;
    db.raw.prepare(`INSERT INTO bookings (id,booking_ref,guest_name,guest_phone,guest_email,flight_number,pickup_notes,pickup_zone,destination_zone,distance_km,vehicle_type,quoted_currency,quoted_amount,payment_method,status,created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, `${SYNTHETIC_REF_PREFIX}${String(seq).padStart(6, '0')}-${Math.random().toString(36).slice(2, 7)}`, CANARY.name, CANARY.phone, CANARY.email, CANARY.flight, CANARY.notes,
        over.pickup_zone ?? 'Nadi Airport', 'Denarau', 12.5, 'minivan', 'FJD', 45, 'cash', 'pending', iso(clock.now()));
    return id;
  }
  const walletChecksum = () => JSON.stringify([db.q('SELECT * FROM wallets ORDER BY driver_id'), db.q('SELECT * FROM wallet_transactions ORDER BY id')]);
  const tok = (id) => `tok-gate1-driver-${id}`;
  const offerFor = (bookingId, driverId) => db.q1(`SELECT * FROM driver_offers WHERE booking_id = ? AND driver_id = ?`, bookingId, driverId);
  const w = { db, clock, notifier, evidenceStore, service, newBooking, walletChecksum, tok, offerFor, iso, canary: CANARY };
  w._walletBaseline = walletChecksum();
  return w;
}

// Full happy-path journey helper used by tests and the stress run.
export async function runJourney(w, { winner = 1 } = {}) {
  const b = await w.newBooking();
  await w.service.startDispatch(b);
  const o = w.offerFor(b, winner) || (await (async () => { await w.service.sweep(b); return w.offerFor(b, winner); })());
  const res = { bookingId: b, steps: [] };
  await w.service.view({ driverId: winner, offerId: o.offer_id });
  const a = await w.service.accept({ driverId: winner, offerId: o.offer_id }); res.steps.push(['accept', a.code]);
  for (const s of ['EN_ROUTE_PICKUP', 'ARRIVED_PICKUP']) res.steps.push([s, (await w.service.advanceTrip({ driverId: winner, bookingId: b, stage: s })).code]);
  const ev = await w.service.submitEvidence({ driverId: winner, bookingId: b, kind: 'PICKUP', clientEvidenceId: `cli-${b}-p`, sha256: 'a'.repeat(64), bytes: 1234 }); res.steps.push(['evidence', ev.code]);
  for (const s of ['PICKUP_VALIDATED', 'PASSENGER_ONBOARD', 'EN_ROUTE_DESTINATION', 'ARRIVED_DESTINATION', 'COMPLETED']) res.steps.push([s, (await w.service.advanceTrip({ driverId: winner, bookingId: b, stage: s })).code]);
  return res;
}
