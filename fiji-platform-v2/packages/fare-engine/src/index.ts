import type {
  CurrencyCode,
  EntityId,
  IsoTimestamp,
  MinorUnits,
  Money,
} from "../../shared-types/src/index.ts";
import type { DestinationId } from "../../destination-engine/src/index.ts";
export type PricingVersionId = EntityId<"PricingVersionId">;
export type QuoteId = EntityId<"QuoteId">;
export interface Quote {
  readonly id: QuoteId;
  readonly originId: DestinationId;
  readonly destinationId: DestinationId;
  readonly pricingVersionId: PricingVersionId;
  readonly currency: CurrencyCode;
  readonly standardFareMinor: MinorUnits;
  readonly flexibleFareMinor?: MinorUnits;
  readonly expiresAt: IsoTimestamp;
  readonly createdAt: IsoTimestamp;
}
export interface QuoteComponent {
  readonly quoteId: QuoteId;
  readonly kind:
    | "standard"
    | "flexible_adjustment"
    | "fee"
    | "tax"
    | "discount";
  readonly amount: Money;
}
export const withFlexibleFare = (
  quote: Quote,
  flexibleFareMinor: MinorUnits,
): Quote => ({ ...quote, flexibleFareMinor });
