import type { EntityId } from "../../shared-types/src/index.ts";
export type ZoneId = EntityId<"ZoneId">;
export type DestinationId = EntityId<"DestinationId">;
export interface Zone {
  readonly id: ZoneId;
  readonly name: string;
  readonly active: boolean;
}
export interface Destination {
  readonly id: DestinationId;
  readonly zoneId: ZoneId;
  readonly slug: string;
  readonly name: string;
  readonly active: boolean;
}
export interface DestinationRepository {
  findById(id: DestinationId): Promise<Destination | undefined>;
  findActiveBySlug(slug: string): Promise<Destination | undefined>;
}
