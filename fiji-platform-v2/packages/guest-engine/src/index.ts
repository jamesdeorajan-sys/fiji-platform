import type { EntityId, IsoTimestamp } from "../../shared-types/src/index.ts";
export type GuestId = EntityId<"GuestId">;
export interface Guest {
  readonly id: GuestId;
  readonly displayName?: string;
  readonly createdAt: IsoTimestamp;
}
export type ContactKind = "email" | "phone" | "whatsapp";
export interface GuestContact {
  readonly guestId: GuestId;
  readonly kind: ContactKind;
  readonly normalizedValue: string;
  readonly isPrimary: boolean;
}
export interface GuestStay {
  readonly guestId: GuestId;
  readonly destinationId: EntityId<"DestinationId">;
  readonly startsAt: IsoTimestamp;
  readonly endsAt: IsoTimestamp;
}
export interface GuestPreference {
  readonly guestId: GuestId;
  readonly key: string;
  readonly value: string;
}
export interface GuestInterest {
  readonly guestId: GuestId;
  readonly key: string;
}
export interface GuestEvent {
  readonly guestId: GuestId;
  readonly type: string;
  readonly occurredAt: IsoTimestamp;
  readonly payload: Readonly<Record<string, unknown>>;
}
