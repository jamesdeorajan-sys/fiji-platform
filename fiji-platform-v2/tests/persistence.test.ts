import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ApplicationError,
  AuditWriter,
  FakeClock,
  IdempotencyStore,
  Persistence,
  TransactionPatterns,
  UuidGenerator,
  isUuid,
  requestFingerprint,
  type SqlDatabase,
  type SqlStatement,
} from "../packages/persistence/src/index.ts";
import type { DestinationRepository } from "../packages/destination-engine/src/index.ts";
import type { GuestRepository } from "../packages/guest-engine/src/index.ts";
import type { QuoteRepository } from "../packages/fare-engine/src/index.ts";

class SQLiteDatabase implements SqlDatabase {
  readonly db: DatabaseSync;
  constructor(db = new DatabaseSync(":memory:")) {
    this.db = db;
  }
  async execute(statement: SqlStatement) {
    const result = this.db
      .prepare(statement.sql)
      .run(...(statement.params ?? []));
    return {
      changes: Number(result.changes),
      lastRowId: Number(result.lastInsertRowid),
    };
  }
  async query<T>(statement: SqlStatement) {
    return this.db
      .prepare(statement.sql)
      .all(...(statement.params ?? [])) as T[];
  }
  async batch(statements: readonly SqlStatement[]) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements)
        results.push(await this.execute(statement));
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
const migrations = () =>
  readdirSync(new URL("../migrations", import.meta.url))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
const migrated = () => {
  const adapter = new SQLiteDatabase();
  for (const file of migrations())
    adapter.db.exec(
      readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
    );
  return adapter;
};
const seedBooking = (db: DatabaseSync) =>
  db.exec(`
 INSERT INTO guests VALUES ('g','Guest','2026-01-01T00:00:00.000Z');
 INSERT INTO drivers VALUES ('d1','active','2026-01-01T00:00:00.000Z'),('d2','active','2026-01-01T00:00:00.000Z');
 INSERT INTO bookings VALUES ('b','g',NULL,'dispatching',NULL,'2026-02-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
`);

describe("IDs and time", () => {
  it("generates canonical UUID v4 IDs", () =>
    assert.equal(isUuid(new UuidGenerator().generate()), true));
  it("generates unique IDs without database access", () => {
    const ids = new Set(
      Array.from({ length: 1000 }, () => new UuidGenerator().generate()),
    );
    assert.equal(ids.size, 1000);
  });
  it("keeps fake time deterministic and injectable", () => {
    const clock = new FakeClock("2026-01-02T03:04:05.000Z");
    assert.equal(clock.now(), "2026-01-02T03:04:05.000Z");
    clock.set("2027-01-02T03:04:05.000Z");
    assert.equal(clock.now(), "2027-01-02T03:04:05.000Z");
  });
});

describe("persistence", () => {
  it("supports insert, query one, and query many", async () => {
    const store = new Persistence(migrated());
    await store.insert("INSERT INTO guests VALUES (?,?,?)", [
      "g",
      "Guest",
      "2026",
    ]);
    assert.equal(
      (
        await store.one<{ display_name: string }>(
          "SELECT display_name FROM guests WHERE id=?",
          ["g"],
        )
      )?.display_name,
      "Guest",
    );
    assert.equal((await store.many("SELECT * FROM guests")).length, 1);
  });
  it("returns undefined for a repository-style not found lookup", async () =>
    assert.equal(
      await new Persistence(migrated()).one("SELECT * FROM guests WHERE id=?", [
        "missing",
      ]),
      undefined,
    ));
  it("translates raw database errors", async () => {
    await assert.rejects(
      () => new Persistence(migrated()).execute("NOT SQL"),
      (error: unknown) =>
        error instanceof ApplicationError &&
        error.code === "DATABASE_ERROR" &&
        error.message === "Database operation failed",
    );
  });
  it("accepts exactly one conditional update", async () => {
    const adapter = migrated();
    seedBooking(adapter.db);
    const store = new Persistence(adapter);
    await store.conditionalUpdate(
      "UPDATE bookings SET assigned_driver_id=? WHERE id=? AND assigned_driver_id IS NULL",
      ["d1", "b"],
    );
    assert.equal(
      (
        await store.one<{ assigned_driver_id: string }>(
          "SELECT assigned_driver_id FROM bookings WHERE id='b'",
        )
      )?.assigned_driver_id,
      "d1",
    );
  });
  it("reports a lost conditional update as conflict", async () => {
    const adapter = migrated();
    seedBooking(adapter.db);
    const store = new Persistence(adapter);
    await store.conditionalUpdate(
      "UPDATE bookings SET assigned_driver_id='d1' WHERE id='b' AND assigned_driver_id IS NULL",
    );
    await assert.rejects(
      () =>
        store.conditionalUpdate(
          "UPDATE bookings SET assigned_driver_id='d2' WHERE id='b' AND assigned_driver_id IS NULL",
        ),
      (error: unknown) =>
        error instanceof ApplicationError && error.code === "CONFLICT",
    );
  });
  it("rolls back a booking update when event insertion fails", async () => {
    const adapter = migrated();
    seedBooking(adapter.db);
    const store = new Persistence(adapter);
    await assert.rejects(() =>
      store.transaction([
        { sql: "UPDATE bookings SET state='assigned' WHERE id='b'" },
        {
          sql: "INSERT INTO booking_events (id,booking_id,to_state,metadata_json,occurred_at) VALUES ('e','missing','assigned','{}','2026')",
        },
      ]),
    );
    assert.equal(
      (
        await store.one<{ state: string }>(
          "SELECT state FROM bookings WHERE id='b'",
        )
      )?.state,
      "dispatching",
    );
  });
});

describe("idempotency and audit", () => {
  it("replays persisted evidence for the same fingerprint", async () => {
    const store = new Persistence(migrated());
    const clock = new FakeClock("2026-01-01T00:00:00.000Z");
    const idempotency = new IdempotencyStore(store, new UuidGenerator(), clock);
    const fingerprint = await requestFingerprint('{"a":1}');
    await store.transaction([
      idempotency.evidence(
        "booking:create",
        "key",
        fingerprint,
        { id: "b" },
        "2026-02-01T00:00:00.000Z",
      ),
    ]);
    assert.deepEqual(
      await idempotency.replay("booking:create", "key", fingerprint),
      { id: "b" },
    );
  });
  it("rejects the same key with a different fingerprint", async () => {
    const store = new Persistence(migrated());
    const idempotency = new IdempotencyStore(
      store,
      new UuidGenerator(),
      new FakeClock("2026"),
    );
    await store.transaction([
      idempotency.evidence("wallet", "key", "first", { ok: true }, "2027"),
    ]);
    await assert.rejects(
      () => idempotency.replay("wallet", "key", "second"),
      (error: unknown) =>
        error instanceof ApplicationError &&
        error.code === "IDEMPOTENCY_CONFLICT",
    );
  });
  it("writes complete audit evidence", async () => {
    const adapter = migrated();
    const store = new Persistence(adapter);
    const writer = new AuditWriter(
      new UuidGenerator(),
      new FakeClock("2026-01-01T00:00:00.000Z"),
    );
    await store.transaction([
      writer.statement({
        actorType: "driver",
        actorId: "d1",
        action: "accept",
        entityType: "booking",
        entityId: "b",
        before: { state: "dispatching" },
        after: { state: "assigned" },
        metadata: { source: "test" },
        contextReference: "req-1",
      }),
    ]);
    const row = await store.one<{ action: string; context_reference: string }>(
      "SELECT action,context_reference FROM audit_events",
    );
    assert.equal(row?.action, "accept");
    assert.equal(row?.context_reference, "req-1");
  });
  it("canonicalizes JSON deterministically before fingerprinting", async () => {
    const first = await requestFingerprint({ z: [3, { b: 2, a: 1 }], a: true });
    const second = await requestFingerprint({
      a: true,
      z: [3, { a: 1, b: 2 }],
    });
    assert.equal(first, second);
  });
  it("lets concurrent duplicates execute once and replay one result", async () => {
    const store = new Persistence(migrated());
    const idempotency = new IdempotencyStore(
      store,
      new UuidGenerator(),
      new FakeClock("2026-01-01T00:00:00.000Z"),
    );
    const fingerprint = await requestFingerprint({ guest: "g" });
    let executions = 0;
    const execute = () =>
      idempotency.execute(
        "guest:create",
        "race",
        fingerprint,
        "2026-02-01T00:00:00.000Z",
        async () => {
          executions += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return {
            result: { id: "g" },
            statements: [
              { sql: "INSERT INTO guests VALUES ('g','Guest','2026')" },
            ],
          };
        },
      );
    const results = await Promise.all([execute(), execute()]);
    const laterReplay = await execute();
    assert.equal(executions, 1);
    assert.deepEqual(results, [{ id: "g" }, { id: "g" }]);
    assert.deepEqual(laterReplay, { id: "g" });
    assert.equal((await store.many("SELECT * FROM guests")).length, 1);
  });
  it("treats expiry as cleanup eligibility and replays until deletion", async () => {
    const store = new Persistence(migrated());
    const idempotency = new IdempotencyStore(
      store,
      new UuidGenerator(),
      new FakeClock("2030-01-01T00:00:00.000Z"),
    );
    await store.transaction([
      idempotency.evidence(
        "wallet",
        "expired",
        "same",
        { transactionId: "t" },
        "2020-01-01T00:00:00.000Z",
      ),
    ]);
    assert.deepEqual(await idempotency.replay("wallet", "expired", "same"), {
      transactionId: "t",
    });
  });
});

describe("migrations and ownership", () => {
  it("keeps forward migrations in strict contiguous order", () =>
    assert.deepEqual(migrations(), [
      "0001_initial_domain.sql",
      "0002_persistence_foundation.sql",
      "0003_dispatch_and_idempotency_claims.sql",
    ]));
  it("allows exactly one database-level booking owner", () => {
    const adapter = migrated();
    seedBooking(adapter.db);
    const claim = adapter.db.prepare(
      "UPDATE bookings SET assigned_driver_id=?,state='assigned' WHERE id='b' AND assigned_driver_id IS NULL",
    );
    const outcomes = [claim.run("d1").changes, claim.run("d2").changes];
    assert.deepEqual(outcomes, [1, 0]);
    const rows = adapter.db
      .prepare(
        "SELECT assigned_driver_id FROM bookings WHERE id='b' AND assigned_driver_id IS NOT NULL",
      )
      .all() as { assigned_driver_id: string }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.assigned_driver_id, "d1");
  });
  it("rolls back the complete losing dispatch transaction", async () => {
    const adapter = migrated();
    seedBooking(adapter.db);
    adapter.db.exec(`
      INSERT INTO dispatch_offers VALUES ('o1','b','d1','offered','2027','2026',NULL);
      INSERT INTO dispatch_offers VALUES ('o2','b','d2','offered','2027','2026',NULL);
    `);
    const store = new Persistence(adapter);
    const patterns = new TransactionPatterns(
      store,
      new AuditWriter(new UuidGenerator(), new FakeClock("2026")),
    );
    const attempt = (offerId: string, driverId: string) =>
      patterns.dispatch(
        {
          id: `claim-${driverId}`,
          bookingId: "b",
          offerId,
          driverId,
          claimedAt: "2026",
        },
        {
          sql: "UPDATE dispatch_offers SET state='accepted' WHERE id=? AND state='offered'",
          params: [offerId],
        },
        {
          sql: "UPDATE bookings SET assigned_driver_id=?,state='assigned' WHERE id='b' AND assigned_driver_id IS NULL",
          params: [driverId],
        },
        {
          sql: "INSERT INTO booking_events (id,booking_id,from_state,to_state,actor_id,metadata_json,occurred_at) VALUES (?,?, 'dispatching','assigned',?,'{}','2026')",
          params: [`event-${driverId}`, "b", driverId],
        },
        {
          actorType: "driver",
          actorId: driverId,
          action: "dispatch.accepted",
          entityType: "booking",
          entityId: "b",
        },
      );
    await attempt("o1", "d1");
    await assert.rejects(() => attempt("o2", "d2"));
    assert.equal(
      (
        await store.one<{ state: string }>(
          "SELECT state FROM dispatch_offers WHERE id='o2'",
        )
      )?.state,
      "offered",
    );
    assert.equal((await store.many("SELECT * FROM booking_events")).length, 1);
    assert.equal((await store.many("SELECT * FROM audit_events")).length, 1);
    assert.equal(
      (
        await store.one<{ assigned_driver_id: string }>(
          "SELECT assigned_driver_id FROM bookings WHERE id='b'",
        )
      )?.assigned_driver_id,
      "d1",
    );
  });
  it("keeps domain repository ports independent of SQL infrastructure", () => {
    const destination = {
      findById: async () => undefined,
      findActiveBySlug: async () => undefined,
    } satisfies DestinationRepository;
    const guest = {
      findById: async () => undefined,
      insert: async () => undefined,
    } satisfies GuestRepository;
    const quote = {
      findById: async () => undefined,
      insertImmutable: async () => undefined,
    } satisfies QuoteRepository;
    assert.ok(destination && guest && quote);
    assert.equal(
      readdirSync(
        new URL("../packages/persistence/src", import.meta.url),
      ).includes("repositories.ts"),
      false,
    );
  });
});
