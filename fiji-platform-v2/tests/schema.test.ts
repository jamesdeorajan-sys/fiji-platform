import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
const migrate = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../migrations/0001_initial_domain.sql", import.meta.url),
      "utf8",
    ),
  );
  return db;
};
const seed = (db: DatabaseSync) =>
  db.exec(
    `INSERT INTO guests VALUES ('g1','Guest','2026'); INSERT INTO zones VALUES ('z1','Nadi',1); INSERT INTO destinations VALUES ('d1','z1','airport','Airport',1); INSERT INTO destinations VALUES ('d2','z1','denarau','Denarau',1); INSERT INTO pricing_versions VALUES ('p1',1,'FJD','active','2026','2026'); INSERT INTO drivers VALUES ('r1','active','2026');`,
  );
const fails = (fn: () => unknown) => assert.throws(fn);
describe("canonical migration", () => {
  it("creates all 27 Phase 0 tables", () => {
    const names = (
      migrate()
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[]
    ).map((x) => x.name);
    assert.equal(names.length, 27);
    for (const n of [
      "guests",
      "quotes",
      "bookings",
      "dispatch_offers",
      "wallet_transactions",
      "message_deliveries",
      "audit_events",
      "platform_events",
    ])
      assert.ok(names.includes(n));
  });
  it("enforces destination slug uniqueness", () => {
    const db = migrate();
    seed(db);
    fails(() =>
      db.exec(
        "INSERT INTO destinations VALUES ('d3','z1','airport','Other',1)",
      ),
    );
  });
  it("enforces currency and integer fare shapes", () => {
    const db = migrate();
    seed(db);
    fails(() =>
      db.exec(
        "INSERT INTO quotes VALUES ('q1','g1','d1','d2','p1','fjd',100,NULL,'2027','2026')",
      ),
    );
    fails(() =>
      db.exec(
        "INSERT INTO quotes VALUES ('q2','g1','d1','d2','p1','FJD',10.5,NULL,'2027','2026')",
      ),
    );
  });
  it("requires quote pricing versions", () => {
    const db = migrate();
    seed(db);
    fails(() =>
      db.exec(
        "INSERT INTO quotes VALUES ('q','g1','d1','d2','missing','FJD',100,NULL,'2027','2026')",
      ),
    );
  });
  it("requires booking guest, quote, and event relationships", () => {
    const db = migrate();
    seed(db);
    fails(() =>
      db.exec(
        "INSERT INTO bookings VALUES ('b','missing',NULL,'pending',NULL,'2027','2026','2026')",
      ),
    );
    fails(() =>
      db.exec(
        "INSERT INTO bookings VALUES ('b','g1','missing','pending',NULL,'2027','2026','2026')",
      ),
    );
    fails(() =>
      db.exec(
        "INSERT INTO booking_events VALUES ('e','missing',NULL,'pending',NULL,'{}','2026')",
      ),
    );
  });
  it("requires each vehicle driver", () => {
    const db = migrate();
    fails(() => db.exec("INSERT INTO vehicles VALUES ('v','missing','REG',1)"));
  });
  it("enforces dispatch assignment constraints", () => {
    const db = migrate();
    seed(db);
    db.exec(
      "INSERT INTO bookings VALUES ('b','g1',NULL,'dispatching',NULL,'2027','2026','2026'); INSERT INTO drivers VALUES ('r2','active','2026'); INSERT INTO dispatch_offers VALUES ('o1','b','r1','accepted','2027','2026','2026')",
    );
    fails(() =>
      db.exec(
        "INSERT INTO dispatch_offers VALUES ('o2','b','r1','offered','2027','2026',NULL)",
      ),
    );
    fails(() =>
      db.exec(
        "INSERT INTO dispatch_offers VALUES ('o3','b','r2','accepted','2027','2026','2026')",
      ),
    );
  });
  it("enforces wallet idempotency and template keys", () => {
    const db = migrate();
    seed(db);
    db.exec(
      "INSERT INTO wallets VALUES ('w','r1','FJD','2026'); INSERT INTO wallet_transactions VALUES ('t1','w','same','credit',100,NULL,NULL,'2026'); INSERT INTO message_templates VALUES ('m1','booking.confirmed','whatsapp','en','Hi','defined','2026')",
    );
    fails(() =>
      db.exec(
        "INSERT INTO wallet_transactions VALUES ('t2','w','same','credit',100,NULL,NULL,'2026')",
      ),
    );
    fails(() =>
      db.exec(
        "INSERT INTO message_templates VALUES ('m2','booking.confirmed','sms','en','Hi','defined','2026')",
      ),
    );
  });
});
