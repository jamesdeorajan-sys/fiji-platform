import type { EntityId, IsoTimestamp } from "../../shared-types/src/index.ts";
import type { ZoneId } from "../../destination-engine/src/index.ts";
export type DriverId = EntityId<"DriverId">;
export type VehicleId = EntityId<"VehicleId">;
export interface Driver {
  readonly id: DriverId;
  readonly status: "onboarding" | "active" | "suspended" | "inactive";
}
export interface DriverRepository {
  findById(id: DriverId): Promise<Driver | undefined>;
  findActiveById(id: DriverId): Promise<Driver | undefined>;
}
export interface Vehicle {
  readonly id: VehicleId;
  readonly driverId: DriverId;
  readonly registration: string;
  readonly active: boolean;
}
export interface DriverZone {
  readonly driverId: DriverId;
  readonly zoneId: ZoneId;
}
export interface DriverDocument {
  readonly driverId: DriverId;
  readonly kind: string;
  readonly privateObjectKey: string;
  readonly verification: "pending" | "verified" | "rejected";
}
export interface DriverSession {
  readonly driverId: DriverId;
  readonly startedAt: IsoTimestamp;
  readonly endedAt?: IsoTimestamp;
}
export interface DriverStatusEvent {
  readonly driverId: DriverId;
  readonly status: Driver["status"];
  readonly occurredAt: IsoTimestamp;
}
