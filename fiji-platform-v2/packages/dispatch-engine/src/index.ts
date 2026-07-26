import type { EntityId, IsoTimestamp } from "../../shared-types/src/index.ts";
import type { BookingId } from "../../booking-engine/src/index.ts";
import type { DriverId } from "../../driver-engine/src/index.ts";
export type DispatchOfferId = EntityId<"DispatchOfferId">;
export type DispatchOfferState =
  | "offered"
  | "accepted"
  | "declined"
  | "expired"
  | "withdrawn";
export interface DispatchOffer {
  readonly id: DispatchOfferId;
  readonly bookingId: BookingId;
  readonly driverId: DriverId;
  readonly state: DispatchOfferState;
  readonly expiresAt: IsoTimestamp;
}
export interface EligibilityModel {
  evaluate(
    bookingId: BookingId,
    driverId: DriverId,
  ): Promise<{ eligible: boolean; reasons: readonly string[] }>;
}
export interface AtomicAcceptanceStore {
  acceptIfUnassigned(
    offerId: DispatchOfferId,
    bookingId: BookingId,
    driverId: DriverId,
  ): Promise<{
    accepted: boolean;
    reason?: "already_assigned" | "offer_inactive";
  }>;
}
export interface DispatchRepository extends AtomicAcceptanceStore {
  findOfferById(id: DispatchOfferId): Promise<DispatchOffer | undefined>;
}
