import type { EntityId, IsoTimestamp } from "../../shared-types/src/index.ts";
import type { GuestId } from "../../guest-engine/src/index.ts";
import type { QuoteId } from "../../fare-engine/src/index.ts";
export type BookingId = EntityId<"BookingId">;
export type BookingState =
  | "pending"
  | "confirmed"
  | "dispatching"
  | "assigned"
  | "in_progress"
  | "completed"
  | "cancelled";
const transitions: Readonly<Record<BookingState, readonly BookingState[]>> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["dispatching", "cancelled"],
  dispatching: ["assigned", "cancelled"],
  assigned: ["in_progress", "dispatching", "cancelled"],
  in_progress: ["completed"],
  completed: [],
  cancelled: [],
};
export const canTransition = (from: BookingState, to: BookingState): boolean =>
  transitions[from].includes(to);
export const transition = (
  from: BookingState,
  to: BookingState,
): BookingState => {
  if (!canTransition(from, to))
    throw new Error(`Invalid booking transition: ${from} -> ${to}`);
  return to;
};
export interface Booking {
  readonly id: BookingId;
  readonly guestId: GuestId;
  readonly quoteId?: QuoteId;
  readonly state: BookingState;
  readonly createdAt: IsoTimestamp;
}
export interface BookingEvent {
  readonly bookingId: BookingId;
  readonly fromState?: BookingState;
  readonly toState: BookingState;
  readonly occurredAt: IsoTimestamp;
  readonly actorId?: string;
}
export interface BookingRepository {
  findById(id: BookingId): Promise<Booking | undefined>;
  transition(
    id: BookingId,
    expected: BookingState,
    next: BookingState,
    event: BookingEvent,
  ): Promise<Booking>;
}
