/* Bula Happiness — guest "My trip" view-model and the staff request-queue workflow (claim / unclaim). Pure D1 reads plus two guarded audit inserts.
 *  - Guest isolation: every query is scoped to the authenticated session id (or its party key); nothing is looked up by a client-supplied ref.
 *  - Unavailable means unavailable: a field the source did not supply is returned as { available:false } and rendered as such. Nothing is inferred.
 *  - "Credit returned" is derived from the credit LEDGER (a restore row for that hold) - never from the hold's state alone.
 *  - A claim is an attributable, append-only audit fact. The claim insert is ONE guarded statement, so two staff claiming at once cannot both win. */
import { fjd } from './money.js';
import { refusalSummary } from './source_discovery.js';
import { formatFijiDateTime } from '../worker/fiji_time.js';

export function holdView(h) {
  const s = JSON.parse(h.snapshot_json);
  return { holdId: h.hold_id, state: h.state, title: s.title, serviceDate: s.serviceDate, serviceStartUtc: s.serviceStartUtc, qty: h.qty, capacityUnit: s.capacityUnit, pricingBasis: s.pricingBasis,
    offerPriceCents: h.price_cents, creditCents: h.credit_cents, netPayableCents: h.net_cents, expiresAt: h.expires_at, cancellationTerms: s.cancellationTerms, instantConfirm: s.instantConfirm,
    confirmedAt: h.confirmed_at, creditRestored: h.credit_restored == null ? null : !!h.credit_restored, inventoryRestored: h.inventory_restored == null ? null : !!h.inventory_restored,
    message: { held: s.instantConfirm ? 'Reserving…' : 'Requested — not confirmed until our team confirms it.', confirmed: 'Confirmed.', released: 'Request withdrawn.', expired: 'Request expired — nothing was charged.', cancelled: 'Cancelled.' }[h.state] };
}

const CLAIM_ACTIONS = ['hold_claimed', 'hold_claim_released'];
const inList = (n) => Array.from({ length: n }, () => '?').join(',');

/** Adds verified facts to a hold: claim state, who ended it, and whether credit/inventory were really returned. */
export async function presentHolds(db, rows, { forStaff = false } = {}) {
  if (!rows.length) return [];
  const ids = rows.map((h) => h.hold_id); const ph = inList(ids.length);
  const { results: led } = await db.prepare(`SELECT hold_id, type FROM bula_credit_ledger WHERE hold_id IN (${ph}) AND type IN ('released','expired_hold','restored','forfeited')`).bind(...ids).all();
  const { results: dec } = await db.prepare(`SELECT subject, actor, detail FROM bula_audit WHERE action = 'hold_declined' AND subject IN (${ph})`).bind(...ids).all();
  const { results: clm } = await db.prepare(`SELECT a.subject, a.action, a.actor, a.at FROM bula_audit a WHERE a.action IN (?,?) AND a.subject IN (${ph}) AND a.seq = (SELECT MAX(b.seq) FROM bula_audit b WHERE b.subject = a.subject AND b.action IN (?,?))`).bind(...CLAIM_ACTIONS, ...ids, ...CLAIM_ACTIONS).all();
  const ledBy = new Map(led.map((r) => [r.hold_id, r.type])); const decBy = new Map(dec.map((r) => [r.subject, r])); const clmBy = new Map(clm.map((r) => [r.subject, r]));
  return rows.map((h) => {
    const v = holdView(h); const credit = h.credit_cents; const L = ledBy.get(h.hold_id);
    const declined = h.state === 'released' && decBy.has(h.hold_id);
    const c = clmBy.get(h.hold_id); const claimed = h.state === 'held' && !!c && c.action === 'hold_claimed';
    let creditReturned = null, inventoryReturned = null;
    if (h.state === 'released' || h.state === 'expired') { inventoryReturned = h.settled === 1; if (credit > 0) creditReturned = h.settled === 1 && (L === 'released' || L === 'expired_hold') ? true : null; }   // unproven -> null ("being processed"), never a guess
    if (h.state === 'cancelled') { inventoryReturned = !!h.inventory_restored; if (credit > 0) creditReturned = !!h.credit_restored && L === 'restored'; }
    const chip = h.state === 'held' ? 'Requested' : h.state === 'confirmed' ? 'Confirmed' : h.state === 'released' ? (declined ? 'Declined' : 'Withdrawn') : h.state === 'expired' ? 'Expired' : 'Cancelled';
    const message = h.state === 'held' ? (v.instantConfirm ? 'Reserving…' : claimed ? 'Our team is reviewing this request. It is not confirmed yet.' : 'Requested — not confirmed until our team confirms it.')
      : h.state === 'released' ? (declined ? 'Our team could not confirm this request. Nothing was charged.' : 'You withdrew this request. Nothing was charged.') : v.message;
    let creditLine = null;
    if (credit > 0 && (h.state === 'released' || h.state === 'expired' || h.state === 'cancelled')) creditLine = creditReturned === true ? `${fjd(credit)} credit returned.` : creditReturned === false ? 'Credit was not returned under the cancellation terms.' : 'Credit return is being processed.';
    const o = { ...v, message, chip, declinedByTeam: declined, underReview: claimed, creditReturned, inventoryReturned, creditLine };
    if (forStaff) { o.claimedBy = claimed ? c.actor : null; o.claimedAt = claimed ? c.at : null; o.partyKey = h.party_key; o.createdAt = h.created_at; if (declined) { o.declinedBy = decBy.get(h.hold_id).actor; o.declineNote = decBy.get(h.hold_id).detail; } }
    return o;
  });
}

/** Attributable claim. ONE guarded INSERT: it lands only if the hold is still 'held' and the latest claim event is not an open claim. */
export async function claimHold(db, { holdId, actor, nowMs }) {
  const h = await db.prepare('SELECT state FROM bula_holds WHERE hold_id = ?').bind(holdId).first(); if (!h) return { ok: false, code: 'unknown_hold' };
  if (h.state !== 'held') return { ok: false, code: `hold_${h.state}` };
  const who = `${actor.staffId}(${actor.role})`;
  const cur = await db.prepare('SELECT action, actor FROM bula_audit WHERE subject = ? AND action IN (?,?) ORDER BY seq DESC LIMIT 1').bind(holdId, ...CLAIM_ACTIONS).first();
  if (cur && cur.action === 'hold_claimed') return cur.actor === who ? { ok: true, replay: true, claimedBy: cur.actor } : { ok: false, code: 'already_claimed', claimedBy: cur.actor };
  const r = await db.prepare(`INSERT INTO bula_audit (at, actor, action, subject, detail) SELECT ?,?,'hold_claimed',?,NULL WHERE EXISTS (SELECT 1 FROM bula_holds WHERE hold_id = ? AND state = 'held')
      AND COALESCE((SELECT action FROM bula_audit WHERE subject = ? AND action IN (?,?) ORDER BY seq DESC LIMIT 1), 'hold_claim_released') = 'hold_claim_released'`).bind(nowMs, who, holdId, holdId, holdId, ...CLAIM_ACTIONS).run();
  if (r.meta.changes === 1) return { ok: true, replay: false, claimedBy: who };
  const now = await db.prepare('SELECT action, actor FROM bula_audit WHERE subject = ? AND action IN (?,?) ORDER BY seq DESC LIMIT 1').bind(holdId, ...CLAIM_ACTIONS).first();
  return { ok: false, code: 'already_claimed', claimedBy: now && now.action === 'hold_claimed' ? now.actor : null };
}
/** Release a claim: the claimant, or the CEO as an audited override. */
export async function unclaimHold(db, { holdId, actor, nowMs }) {
  const cur = await db.prepare('SELECT seq, action, actor FROM bula_audit WHERE subject = ? AND action IN (?,?) ORDER BY seq DESC LIMIT 1').bind(holdId, ...CLAIM_ACTIONS).first();
  if (!cur || cur.action !== 'hold_claimed') return { ok: true, replay: true };
  const who = `${actor.staffId}(${actor.role})`; if (cur.actor !== who && actor.role !== 'ceo') return { ok: false, code: 'claimed_by_other', claimedBy: cur.actor };
  const r = await db.prepare(`INSERT INTO bula_audit (at, actor, action, subject, detail) SELECT ?,?,'hold_claim_released',?,? WHERE (SELECT MAX(seq) FROM bula_audit WHERE subject = ? AND action IN (?,?)) = ?`)
    .bind(nowMs, who, holdId, cur.actor === who ? 'released by claimant' : `override of ${cur.actor}`, holdId, ...CLAIM_ACTIONS, cur.seq).run();
  return { ok: true, replay: r.meta.changes !== 1 };
}
/** May this staff member confirm/decline? Unclaimed: yes (their identity is recorded either way). Claimed by someone else: no, except the CEO. */
export async function mayDecide(db, holdId, actor) {
  const cur = await db.prepare('SELECT action, actor FROM bula_audit WHERE subject = ? AND action IN (?,?) ORDER BY seq DESC LIMIT 1').bind(holdId, ...CLAIM_ACTIONS).first();
  if (!cur || cur.action !== 'hold_claimed' || cur.actor === `${actor.staffId}(${actor.role})` || actor.role === 'ceo') return { ok: true };
  return { ok: false, code: 'claimed_by_other', claimedBy: cur.actor };
}

const DETAIL_KEYS = [['total', 'total_minor'], ['flightNumber', 'flight_number'], ['passengers', 'passengers'], ['luggage', 'luggage'], ['addOns', 'add_ons_json'], ['discount', 'discount_minor']];
const LEG_STATUS = { pending: 'Received — our team has not confirmed it yet', confirmed: 'Confirmed', confirmed_unallocated: 'Confirmed — driver not assigned yet', declined: 'Not accepted by our team', cancelled: 'Cancelled' };
/** "Friday, Nov 20, 2026, 2:30 PM" (Fiji time) or null. formatFijiDateTime returns an object; it must be flattened before display. */
export function fijiWhen(dt) { try { if (!dt) return null; const f = formatFijiDateTime(dt); return f && f.dayFull ? `${f.dayFull}, ${f.time}` : null; } catch { return null; } }
const when = fijiWhen;
function detailsFrom(snap) {
  const av = snap ? JSON.parse(snap.availability_json || '{}') : {}; const d = {};
  for (const [name, col] of DETAIL_KEYS) {
    const key = col === 'add_ons_json' ? 'add_ons' : col; const ok = !!snap && snap[col] != null && (av[key] === 'source' || av[key] === 'marau_form');
    d[name] = { available: ok };
    if (ok) { if (name === 'total') d[name].value = { currency: snap.currency || null, cents: snap.total_minor }; else if (name === 'addOns') { try { d[name].value = JSON.parse(snap.add_ons_json); } catch { d[name] = { available: false }; } } else if (name === 'discount') d[name].value = { currency: snap.currency || null, cents: snap.discount_minor }; else d[name].value = snap[col]; }
  }
  return d;
}
/** The guest's saved trip(s): itinerary, accurate status, the source details that exist, requests, and the configured support contact. */
export async function buildTrip(db, cfg, session, nowMs) {
  const { results: rows } = await db.prepare(`SELECT id, client_booking_ref, parent_booking_id, leg_type, pickup_zone, destination_zone, vehicle_type, pickup_datetime, status, source_booking_ref, source_sync_owned, source_assigned_driver_id
      FROM marau_test_bookings WHERE guest_session_id = ? ORDER BY id`).bind(session.session_id).all();
  const parents = rows.filter((r) => r.parent_booking_id == null);
  const trips = [];
  for (const p of parents) {
    const snap = await db.prepare('SELECT * FROM bula_booking_snapshots WHERE booking_ref = ?').bind(p.client_booking_ref).first();
    const legs = [p, ...rows.filter((r) => r.parent_booking_id === p.id)].map((r) => ({ leg: r.parent_booking_id == null ? (r.leg_type === 'return' ? 'Return' : r.leg_type === 'departure' ? 'Departure' : 'Transfer') : 'Return', from: r.pickup_zone, to: r.destination_zone, vehicle: r.vehicle_type,
      pickupFijiTime: when(r.pickup_datetime), status: r.status, statusLabel: LEG_STATUS[r.status] || 'Status not available', driverAssigned: r.source_assigned_driver_id ? true : (r.source_sync_owned === 1 ? false : null) }));
    trips.push({ reference: p.source_booking_ref || p.client_booking_ref, from: p.source_sync_owned === 1 ? 'booking_system' : 'preview_form', legs, details: detailsFrom(snap),
      snapshot: snap ? { version: snap.version, source: snap.source_kind === 'nadi_dispatch_api' ? 'booking system' : 'booking form', capturedAt: snap.captured_at } : null });
  }
  const party = parents.length ? `trip:${parents[0].client_booking_ref}` : `session:${session.session_id}`;
  const { results: holds } = await db.prepare('SELECT * FROM bula_holds WHERE party_key = ? ORDER BY created_at DESC LIMIT 50').bind(party).all();
  const verified = !!(cfg.supportWhatsapp && cfg.supportVerified);
  return { trips, requests: await presentHolds(db, holds), support: { configured: !!cfg.supportWhatsapp, verified, whatsapp: verified ? cfg.supportWhatsapp : null, note: verified ? null : 'Support contact details are not set up for this test.' }, serverNowUtc: nowMs };
}

/** Staff queue: what a person needs to decide - the request, who has it, and the guest's saved transfer (no contact details). */
export async function buildQueue(db, nowMs) {
  const { results: held } = await db.prepare("SELECT * FROM bula_holds WHERE state = 'held' ORDER BY created_at").all();
  const { results: conf } = await db.prepare("SELECT * FROM bula_holds WHERE state = 'confirmed' ORDER BY COALESCE(confirmed_at, updated_at) DESC LIMIT 30").all();
  const { results: closed } = await db.prepare("SELECT * FROM bula_holds WHERE state IN ('released','expired','cancelled') ORDER BY updated_at DESC LIMIT 30").all();
  const ctx = async (h) => { const m = /^trip:(.+)$/.exec(h.party_key); if (!m) return null; const b = await db.prepare('SELECT pickup_zone, destination_zone, pickup_datetime, status, source_booking_ref FROM marau_test_bookings WHERE client_booking_ref = ?').bind(m[1]).first(); return b ? { reference: b.source_booking_ref || m[1], from: b.pickup_zone, to: b.destination_zone, pickupFijiTime: when(b.pickup_datetime), status: b.status } : null; };
  const lift = async (rows) => { const v = await presentHolds(db, rows, { forStaff: true }); for (let i = 0; i < v.length; i++) v[i].transfer = await ctx(rows[i]); return v; };
  return { requests: await lift(held), confirmed: await lift(conf), closed: await lift(closed), sourceRefusals: await refusalSummary(db) };
}

/** Read-only diagnostics for hosted acceptance (CEO only): what the adapter produced for one source booking. No contact details; tokens never included. */
export async function sourceSyncState(db, ref) {
  const link = await db.prepare('SELECT guest_session_id, marau_booking_id FROM marau_real_booking_links WHERE source_booking_ref = ?').bind(ref).first();
  if (!link) return { linked: false };
  const b = await db.prepare('SELECT client_booking_ref FROM marau_test_bookings WHERE id = ?').bind(link.marau_booking_id).first(); const cref = b && b.client_booking_ref;
  const snap = cref ? await db.prepare('SELECT version, source_kind, provenance_json, availability_json, flight_number, total_minor, currency FROM bula_booking_snapshots WHERE booking_ref = ?').bind(cref).first() : null;
  const { results: jobs } = await db.prepare('SELECT recipient_kind k, state FROM bula_outbox WHERE booking_ref = ? ORDER BY k').bind(cref || '').all();
  const n = async (sql, ...a) => (await db.prepare(sql).bind(...a).first()).n;
  return { linked: true, guestSessions: await n('SELECT COUNT(*) n FROM marau_real_booking_links WHERE source_booking_ref = ?', ref), mirrorRows: await n('SELECT COUNT(*) n FROM marau_test_bookings WHERE source_booking_ref = ? AND parent_booking_id IS NULL', ref),
    welcomeGrants: await n("SELECT COUNT(*) n FROM bula_credit_ledger WHERE type = 'granted' AND party_key = ?", `trip:${cref}`), jobs: jobs.map((j) => `${j.k}:${j.state}`),
    captured: await n("SELECT COUNT(*) n FROM bula_audit WHERE action = 'email_captured' AND subject LIKE ?", `saved-booking:${cref}|%`),
    snapshot: snap ? { version: snap.version, sourceKind: snap.source_kind, provenance: JSON.parse(snap.provenance_json), availability: JSON.parse(snap.availability_json), flightNumber: snap.flight_number, totalMinor: snap.total_minor, currency: snap.currency } : null };
}
/** Captured would-be emails for one source booking (CEO only; acceptance reads the guest's private link out of the guest copy, in memory, never into evidence). */
export async function capturedFor(db, ref) {
  const link = await db.prepare('SELECT marau_booking_id FROM marau_real_booking_links WHERE source_booking_ref = ?').bind(ref).first(); if (!link) return [];
  const b = await db.prepare('SELECT client_booking_ref FROM marau_test_bookings WHERE id = ?').bind(link.marau_booking_id).first();
  const { results } = await db.prepare("SELECT subject, detail FROM bula_audit WHERE action = 'email_captured' AND subject LIKE ? ORDER BY seq").bind(`saved-booking:${b.client_booking_ref}|%`).all();
  return results.map((r) => ({ jobKey: r.subject, ...JSON.parse(r.detail) }));
}
