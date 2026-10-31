// SYNTHETIC. Separate OS processes = separate connections racing on ONE database file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os';
import { openD1 } from './test_db.mjs';
import { cfg, seedOffer, NOW } from './fixtures.mjs';
import { grantWelcome } from './inventory_credit.js';

const run = (file, args) => new Promise((res) => { const c = spawn(process.execPath, ['bula/concurrency_worker.mjs', file, ...args], { cwd: new URL('..', import.meta.url).pathname }); let o = ''; c.stdout.on('data', (d) => (o += d)); c.on('close', () => res(JSON.parse(o.trim().split('\n').pop()))); });
const race = async (file, jobs) => { const start = Date.now() + 1500; return Promise.all(jobs.map((j) => run(file, [start, NOW, ...j]))); };
const fresh = async () => { const file = `${fs.mkdtempSync(`${os.tmpdir()}/bula-c-`)}/d.db`; const db = openD1(file, { init: true }); return { file, db }; };

test('8 processes, 1 place left: exactly one wins, nobody errors, stock never negative', async () => {
  const { file, db } = await fresh(); await seedOffer(db, { remaining: 1, capacity_total: 10 });
  for (let i = 0; i < 8; i++) await grantWelcome(db, cfg(), { partyKey: `trip:${i}`, actor: 'a', source: 's', nowMs: NOW });
  const rs = await race(file, [...Array(8).keys()].map((i) => [`trip:${i}`, 'k', 'O1', 1]));
  assert.equal(rs.filter((r) => r.ok).length, 1, JSON.stringify(rs)); assert.ok(rs.every((r) => r.code !== 'THROWN'), JSON.stringify(rs));
  assert.equal((await db.prepare('SELECT remaining FROM bula_offers').first()).remaining, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM bula_holds WHERE state='held'").first()).n, 1);
});
test('6 processes spend ONE FJ$30 balance on six offers (FJ$25 max each): total credit <= balance, never negative', async () => {
  const { file, db } = await fresh(); for (let i = 0; i < 6; i++) await seedOffer(db, { offer_id: `X${i}` });
  await grantWelcome(db, cfg(), { partyKey: 'trip:S', cents: 3000, actor: 'a', source: 's', nowMs: NOW });
  const rs = await race(file, [...Array(6).keys()].map((i) => ['trip:S', `k${i}`, `X${i}`, 1]));
  assert.ok(rs.every((r) => r.code !== 'THROWN'), JSON.stringify(rs));
  const acct = await db.prepare('SELECT * FROM bula_credit_accounts').first();
  assert.equal(rs.reduce((a, r) => a + r.credit, 0), 3000); assert.equal(acct.available_cents, 0); assert.equal(acct.reserved_cents, 3000);
  assert.equal(acct.available_cents + acct.reserved_cents + acct.redeemed_cents + acct.expired_cents, acct.granted_cents);
});
test('5 processes replay the SAME idempotency key: exactly one hold, one stock decrement, same hold id for all', async () => {
  const { file, db } = await fresh(); await seedOffer(db); await grantWelcome(db, cfg(), { partyKey: 'trip:R', actor: 'a', source: 's', nowMs: NOW });
  const rs = await race(file, Array.from({ length: 5 }, () => ['trip:R', 'same', 'O1', 1]));
  assert.equal(new Set(rs.map((r) => r.holdId)).size, 1, JSON.stringify(rs)); assert.ok(rs.every((r) => r.ok));
  assert.equal((await db.prepare('SELECT remaining FROM bula_offers').first()).remaining, 9); assert.equal((await db.prepare('SELECT COUNT(*) n FROM bula_holds').first()).n, 1);
});
