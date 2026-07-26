import type {
  CurrencyCode,
  EntityId,
  IsoTimestamp,
  MinorUnits,
} from "../../shared-types/src/index.ts";
import type { DriverId } from "../../driver-engine/src/index.ts";
export type WalletId = EntityId<"WalletId">;
export interface Wallet {
  readonly id: WalletId;
  readonly driverId: DriverId;
  readonly currency: CurrencyCode;
}
export interface WalletTransaction {
  readonly id: EntityId<"WalletTransactionId">;
  readonly walletId: WalletId;
  readonly idempotencyKey: string;
  readonly amountMinor: MinorUnits;
  readonly kind: "credit" | "debit" | "commission" | "adjustment";
  readonly occurredAt: IsoTimestamp;
}
export const appendUnique = (
  ledger: readonly WalletTransaction[],
  tx: WalletTransaction,
): readonly WalletTransaction[] => {
  if (ledger.some((x) => x.idempotencyKey === tx.idempotencyKey))
    throw new Error("Duplicate wallet idempotency key");
  return [...ledger, tx];
};
