import type { EntityId, IsoTimestamp } from "../../shared-types/src/index.ts";
export type TemplateApproval =
  | "defined"
  | "submitted"
  | "approved"
  | "rejected";
export interface MessageTemplate {
  readonly id: EntityId<"MessageTemplateId">;
  readonly key: string;
  readonly channel: "whatsapp" | "sms" | "email";
  readonly approval: TemplateApproval;
}
export interface MessageDelivery {
  readonly id: EntityId<"MessageDeliveryId">;
  readonly templateId: MessageTemplate["id"];
  readonly status: "queued" | "sent" | "delivered" | "failed";
  readonly providerMessageId?: string;
  readonly verifiedAt?: IsoTimestamp;
}
export const isProductionReady = (
  template: MessageTemplate,
  delivery?: MessageDelivery,
): boolean =>
  template.approval === "approved" &&
  delivery?.status === "delivered" &&
  delivery.verifiedAt !== undefined;
