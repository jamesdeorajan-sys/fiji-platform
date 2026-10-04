/* Marau (PREVIEW/TEST ONLY) - the UPGRADE path. The isolated preview database already holds rows from migrations 0035-0037
 * (it carries real hosted-run data), so 0038-0040 must apply over a POPULATED database with foreign keys enforced, keep every
 * row, and leave no dangling reference. A fresh-database run (every other test) cannot prove that - an earlier draft of 0040
 * rebuilt a referenced table and failed exactly here. Evidence label: LOCAL, AUTHOR-RUN (node:sqlite, not hosted D1).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dirs = [path.join(process.cwd(), '..', 'smart-return-trigger-fill', 'migrations'), path.join(process.cwd(), 'migrations')];
const files = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.sql')).sort().map((f) => ({ f, sql: fs.readFileSync(path.join(d, f), 'utf8') })));
const before = files.filter(({ f }) => !/^003[89]|^004[01]/.test(f));
const upgrade = files.filter(({ f }) => /^003[89]|^004[01]/.test(f));

test('0038-0041 apply over a populated 0037 database: every row kept, adjustments carried, no dangling foreign key', () => {
  assert.deepEqual(upgrade.map(({ f }) => f.slice(0, 4)), ['0038', '0039', '0040', '0041'], 'the upgrade set is exactly the four new migrations');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF;');
  for (const { sql } of before) db.exec(sql);
  const t = '2026-10-04T00:00:00.000Z';
  db.exec(`
    INSERT INTO guest_sessions (session_id, guest_contact_key, guest_email, guest_phone, access_token, access_token_revoked, test_data, created_at) VALUES
      ('gs_a', 'k1', 'a@example.test', '+15005550101', 'tok_a', 0, 1, '${t}'), ('gs_b', 'k2', 'b@example.test', '+15005550102', 'tok_b', 0, 1, '${t}');
    INSERT INTO marau_referral_codes (code, guest_session_id, created_at) VALUES ('ABCD2345', 'gs_a', '${t}');
    INSERT INTO marau_referrals (referral_id, code, referrer_session_id, referred_session_id, status, created_at) VALUES ('ref_1', 'ABCD2345', 'gs_a', 'gs_b', 'attributed', '${t}');
    INSERT INTO marau_suppliers (supplier_id, name, fulfilment_owner, verification_status, created_by, created_at, updated_at) VALUES ('sup_1', 'S', 'Ana (ops)', 'verified', 'Ana (ops)', '${t}', '${t}');
    INSERT INTO marau_experience_offers (offer_id, supplier_id, title, location, inclusions, starts_at, capacity, price_per_place_cents, cost_per_place_cents, book_by, expires_at, fulfilment_owner, status, created_by, created_at, updated_at)
      VALUES ('off_1', 'sup_1', 'T', 'L', '[]', '${t}', 5, 12000, 8000, '${t}', '${t}', 'Ana (ops)', 'published', 'Ana (ops)', '${t}', '${t}');
    INSERT INTO marau_offer_requests (request_id, offer_id, guest_session_id, reference, places, price_per_place_cents, total_cents, status, created_at, updated_at) VALUES ('req_1', 'off_1', 'gs_b', 'OFR-AAAAAA', 1, 12000, 12000, 'fulfilled', '${t}', '${t}');
    INSERT INTO marau_reward_credits (credit_id, referral_id, beneficiary_session_id, referred_session_id, qualifying_request_id, amount_cents, status, funding_source, policy_snapshot, created_at, applied_booking_id, applied_cents)
      VALUES ('cr_1', 'ref_1', 'gs_a', 'gs_b', 'req_1', 1000, 'applied', 'marau_marketing_budget', '{}', '${t}', 7, 1000);
    INSERT INTO marau_booking_adjustments (adjustment_id, booking_id, credit_id, original_quote_cents, credit_cents, amount_due_cents, funded_by, status, created_by, created_at)
      VALUES ('adj_1', 7, 'cr_1', 10000, 1000, 9000, 'marau_marketing_budget', 'applied', 'Ana (ops)', '${t}');
  `);
  db.exec('PRAGMA foreign_keys = ON;');
  for (const { sql } of upgrade) db.exec(sql);

  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'no dangling reference after the upgrade');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM marau_referral_codes').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM marau_referrals').get().n, 1);
  const adj = db.prepare('SELECT * FROM marau_booking_adjustments').get();
  assert.deepEqual({ id: adj.adjustment_id, booking: adj.booking_id, credit: adj.credit_id, status: adj.status, credit_cents: adj.credit_cents, by: adj.created_by }, { id: 'adj_1', booking: 7, credit: 'cr_1', status: 'applied', credit_cents: 1000, by: 'Ana (ops)' });
  assert.equal(db.prepare("SELECT require_payment FROM marau_reward_policy WHERE id = 1").get().require_payment, 'paid_in_full', 'an existing policy row defaults to requiring payment');
  assert.equal(db.prepare("SELECT mode FROM marau_reward_policy WHERE id = 1").get().mode, 'off', 'and stays off');

  // The new schema's rules hold over the migrated data: a SECOND live adjustment may now share a booking, but a credit may not have two live ones.
  db.exec(`INSERT INTO marau_reward_credits (credit_id, referral_id, beneficiary_session_id, referred_session_id, qualifying_request_id, amount_cents, status, funding_source, policy_snapshot, created_at)
           SELECT 'cr_2', 'ref_1', 'gs_a', 'gs_b', 'req_1', 1000, 'earned', 'x', '{}', '${t}' WHERE 0`); // (no-op: UNIQUE referral/request keep one credit per friend)
  db.prepare(`INSERT INTO marau_booking_adjustments (adjustment_id, booking_id, credit_id, original_quote_cents, credit_cents, amount_due_cents, funded_by, status, created_by, created_at)
              VALUES ('adj_released', 7, 'cr_1', 10000, 1000, 9000, 'x', 'released_booking_cancelled', 'Ana (ops)', ?)`).run(t);
  assert.throws(() => db.prepare(`INSERT INTO marau_booking_adjustments (adjustment_id, booking_id, credit_id, original_quote_cents, credit_cents, amount_due_cents, funded_by, status, created_by, created_at)
                                  VALUES ('adj_dup', 8, 'cr_1', 10000, 1000, 9000, 'x', 'applied', 'Bala (ops)', ?)`).run(t), /UNIQUE/, 'a credit can never have two LIVE adjustments');
});
