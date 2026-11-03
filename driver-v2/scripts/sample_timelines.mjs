// Generates the five sample diagnostic timelines required by the Gate 1 evidence contract (synthetic data only).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { makeWorld } from '../test-harness/fixture.mjs';
import { diagnose } from '../src/diagnose.js';
const here = path.dirname(fileURLToPath(import.meta.url)); const S = (n) => n * 1000; const NO = () => 'NO_RECEIPT';
const out = {};
const t0 = (w) => Date.parse('2031-03-01T00:00:00.000Z');
const render = async (w, b) => { const d = await diagnose(w.db, b); const base = t0(w);
  return { summary: { last_proven_boundary: d.last_proven_boundary, first_missing_or_failed_boundary: d.first_missing_or_failed_boundary, reason_code: d.reason_code, responsible_subsystem: d.responsible_subsystem, retry_state: d.retry_state, human_fallback_invoked: d.human_fallback_invoked },
    offers: d.offers.map((o) => ({ driver: o.driver_id, state: o.state, phase: o.phase, reason_code: o.reason_code })), delivery_attempts: d.delivery_attempts,
    timeline: d.timeline.map((e) => ({ t_plus_s: Math.round((Date.parse(e.at) - base) / 100) / 10, event: e.event, driver: e.driver_id, offer: e.offer_id ? e.offer_id.slice(0, 8) + '…' : null, actor: e.actor, reason_code: e.reason_code, phase: e.phase })) }; };
const begin = async (w) => { const b = await w.newBooking(); await w.service.startDispatch(b); return b; };
let w = await makeWorld({ drivers: 3 }); let b = await begin(w); let o = w.offerFor(b, 1); w.clock.advance(S(7)); await w.service.view({ driverId: 1, offerId: o.offer_id }); w.clock.advance(S(5)); await w.service.accept({ driverId: 1, offerId: o.offer_id }); out['1_normal_accept'] = await render(w, b);
w = await makeWorld({ drivers: 3 }); b = await begin(w); o = w.offerFor(b, 1); w.clock.advance(S(9)); await w.service.decline({ driverId: 1, offerId: o.offer_id }); w.clock.advance(S(14)); await w.service.accept({ driverId: 2, offerId: w.offerFor(b, 2).offer_id }); out['2_decline_then_next_driver_accepts'] = await render(w, b);
w = await makeWorld({ drivers: 2, deliveryMode: NO }); b = await begin(w); o = w.offerFor(b, 1); w.clock.advance(S(71)); out['3a_slow_no_delivery_receipt_at_71s_BEFORE_view'] = await render(w, b);
w.clock.advance(S(24)); await w.service.view({ driverId: 1, offerId: o.offer_id }); w.clock.advance(S(3)); await w.service.accept({ driverId: 1, offerId: o.offer_id }); out['3b_slow_connection_view_at_95s_accept_at_98s'] = await render(w, b);
w = await makeWorld({ drivers: 3, deliveryMode: NO }); b = await begin(w); o = w.offerFor(b, 1); w.clock.advance(S(62)); await w.service.sweep(b); const o2 = w.offerFor(b, 2); w.clock.advance(S(3));
await Promise.all([w.service.accept({ driverId: 1, offerId: o.offer_id }), w.service.accept({ driverId: 2, offerId: o2.offer_id })]); out['4_simultaneous_accept_one_winner'] = await render(w, b);
w = await makeWorld({ drivers: 2, deliveryMode: NO }); b = await begin(w); for (const s of [61, 60, 60]) { w.clock.advance(S(s)); await w.service.sweep(b); } out['5_unresolved_180s_human_fallback'] = await render(w, b);
fs.writeFileSync(path.join(here, '..', 'evidence', 'diagnostic-timelines.json'), JSON.stringify(out, null, 2));
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(52), JSON.stringify(v.summary));
