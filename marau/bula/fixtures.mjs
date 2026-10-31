import { loadConfig } from './config.js';
export const FIJI = (s) => Date.parse(`${s}Z`) - 12 * 3600e3;   // Fiji wall clock -> UTC ms (UTC+12; test dates have no DST)
export const cfg = (over = {}) => ({ ...loadConfig({ BULA_CREDITS_ENABLED: 'on', BULA_CHECKOUT_ENABLED: 'on', BULA_SYNTHETIC_TEST: 'on', BULA_POLICY_VERSION: 'synthetic-v1', BULA_CREDIT_TTL_MS: String(90 * 86400000) }), ...over });
export const NOW = FIJI('2026-11-02T19:00:00');   // after 18:00 Fiji: edition for 3 Nov is visible
export async function seedOffer(db, o = {}) {
  const d = { offer_id: 'O1', version: 1, status: 'published', title: 'SYNTHETIC Island Cruise', operator_id: 'op_synthetic', service_date: '2026-11-03', service_start_utc: FIJI('2026-11-03T09:00:00'),
    pickup_zones: 'Denarau', pricing_basis: 'person', price_cents: 15000, max_credit_cents: 2500, capacity_unit: 'seat', capacity_total: 10, remaining: 10,
    booking_cutoff_utc: FIJI('2026-11-02T22:00:00'), inclusions: 'Lunch', exclusions: 'Drinks', min_spend_cents: 0, cancellation_terms: 'Free cancel 24h before',
    credit_restore_hours_before: 24, inventory_restore_hours_before: 24, funding_party: 'vakaviti', operator_payout_cents: 12000, instant_confirm: 0, operator_contract_id: null,
    approved_by: 'staff:james', approved_at: NOW - 1000, created_by: 'staff:james', created_at: NOW - 5000, updated_at: NOW - 5000, ...o };
  const k = Object.keys(d);
  await db.prepare(`INSERT INTO bula_offers (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).bind(...k.map((x) => d[x])).run();
  return d;
}
