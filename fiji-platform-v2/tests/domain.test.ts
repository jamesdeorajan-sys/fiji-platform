import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  currencyCode,
  minorUnits,
  type IsoTimestamp,
} from "../packages/shared-types/src/index.ts";
import {
  withFlexibleFare,
  type Quote,
} from "../packages/fare-engine/src/index.ts";
import {
  canTransition,
  transition,
} from "../packages/booking-engine/src/index.ts";
import type {
  AtomicAcceptanceStore,
  EligibilityModel,
} from "../packages/dispatch-engine/src/index.ts";
import {
  appendUnique,
  type WalletTransaction,
} from "../packages/wallet-engine/src/index.ts";
import {
  isProductionReady,
  type MessageDelivery,
  type MessageTemplate,
} from "../packages/messaging-engine/src/index.ts";
describe("fare", () => {
  it("requires integer minor units and currency shape", () => {
    assert.equal(minorUnits(125), 125);
    assert.throws(() => minorUnits(1.25));
    assert.equal(currencyCode("FJD"), "FJD");
    assert.throws(() => currencyCode("fjd"));
  });
  it("preserves standard fare when adding flexible fare", () => {
    const q = withFlexibleFare(
      { standardFareMinor: minorUnits(1000) } as Quote,
      minorUnits(1250),
    );
    assert.equal(q.standardFareMinor, 1000);
    assert.equal(q.flexibleFareMinor, 1250);
  });
});
describe("booking", () => {
  it("allows valid transitions", () =>
    assert.equal(canTransition("confirmed", "dispatching"), true));
  it("rejects invalid transitions", () =>
    assert.throws(() => transition("completed", "pending"), /Invalid/));
});
describe("dispatch", () => {
  it("contracts support eligibility and conditional acceptance", async () => {
    const eligibility: EligibilityModel = {
      evaluate: async () => ({ eligible: true, reasons: [] }),
    };
    let assigned = false;
    const store: AtomicAcceptanceStore = {
      acceptIfUnassigned: async () =>
        assigned
          ? { accepted: false, reason: "already_assigned" }
          : ((assigned = true), { accepted: true }),
    };
    assert.equal(
      (await eligibility.evaluate("b" as never, "d" as never)).eligible,
      true,
    );
    assert.equal(
      (await store.acceptIfUnassigned("o" as never, "b" as never, "d" as never))
        .accepted,
      true,
    );
    assert.equal(
      (
        await store.acceptIfUnassigned(
          "o2" as never,
          "b" as never,
          "d2" as never,
        )
      ).reason,
      "already_assigned",
    );
  });
});
describe("wallet", () => {
  it("rejects duplicate idempotency keys", () => {
    const tx = { idempotencyKey: "once" } as WalletTransaction;
    assert.equal(appendUnique([], tx).length, 1);
    assert.throws(
      () => appendUnique([tx], { ...tx, id: "other" as never }),
      /Duplicate/,
    );
  });
});
describe("messaging", () => {
  it("separates defined, approved, and verified", () => {
    const t = { approval: "defined" } as MessageTemplate;
    const d = { status: "delivered" } as MessageDelivery;
    assert.equal(isProductionReady(t, d), false);
    assert.equal(isProductionReady({ ...t, approval: "approved" }, d), false);
    assert.equal(
      isProductionReady(
        { ...t, approval: "approved" },
        { ...d, verifiedAt: "2026" as IsoTimestamp },
      ),
      true,
    );
  });
});
