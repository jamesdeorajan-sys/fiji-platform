/* Marau (PREVIEW/TEST ONLY) - what "morning and afternoon editions" MEANS today, as executable fact.
 *
 * Implemented level: GROUPING + FIJI-TIME SLOT LOGIC + RECIPIENT PREVIEW. Staff prepare an edition (a set of published offers
 * for a Fiji date and slot) and publish it; the guest app shows it under "Morning deals" / "Afternoon deals" in the right
 * slot in Fiji time; staff can preview which guests a promotional edition could reach. NOT implemented, and asserted absent:
 * scheduled generation, any timer/cron, any outbound message or notification. Browsing every published offer is always open.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installNetworkGuard } from './network_guard.mjs';
import worker from '../worker/worker.js';
import { editionSlotAt, OFFER_DEFAULTS } from '../worker/experience_offers.js';
import { toFijiWallClockInputValue } from '../worker/fiji_time.js';

installNetworkGuard();

test('NOT SCHEDULED: the Worker exports no scheduled/queue handler and wrangler.toml defines no cron trigger', () => {
  assert.equal(typeof worker.scheduled, 'undefined');
  assert.equal(typeof worker.queue, 'undefined');
  const toml = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.equal(/^\s*\[triggers\]/m.test(toml), false);
  assert.equal(/crons\s*=/.test(toml), false);
});

test('SLOT LOGIC (Fiji time): morning from 07:00, afternoon from 14:00, rolling over on the FIJI date, not the UTC date', () => {
  const at = (iso) => editionSlotAt(Date.parse(iso), toFijiWallClockInputValue, OFFER_DEFAULTS);
  // Fiji is UTC+12. 18:59Z on the 9th = 06:59 Fiji on the 10th.
  assert.deepEqual([at('2031-03-09T18:59:00Z').fiji_date, at('2031-03-09T18:59:00Z').current_slot, at('2031-03-09T18:59:00Z').next_slot], ['2031-03-10', null, 'morning']);
  assert.deepEqual([at('2031-03-09T19:00:00Z').current_slot, at('2031-03-09T19:00:00Z').next_slot], ['morning', 'afternoon']);
  assert.deepEqual([at('2031-03-10T01:59:00Z').current_slot], ['morning']);
  assert.deepEqual([at('2031-03-10T02:00:00Z').current_slot, at('2031-03-10T02:00:00Z').next_slot], ['afternoon', null]);
  assert.equal(at('2031-03-10T11:59:00Z').fiji_date, '2031-03-10');
  assert.equal(at('2031-03-10T12:00:00Z').fiji_date, '2031-03-11', 'midnight Fiji time starts the next edition date');
});
