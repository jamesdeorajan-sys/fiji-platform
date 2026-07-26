import type { Clock } from "./clock.ts";
import type { IdGenerator } from "./id.ts";
import type { SqlStatement } from "./database.ts";

export interface AuditEvent {
  actorType: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  contextReference?: string;
}
export class AuditWriter {
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  constructor(ids: IdGenerator, clock: Clock) {
    this.ids = ids;
    this.clock = clock;
  }
  statement(event: AuditEvent): SqlStatement {
    return {
      sql: `INSERT INTO audit_events (id,actor_type,actor_id,action,entity_type,entity_id,before_json,after_json,metadata_json,context_reference,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      params: [
        this.ids.generate(),
        event.actorType,
        event.actorId ?? null,
        event.action,
        event.entityType,
        event.entityId,
        event.before === undefined ? null : JSON.stringify(event.before),
        event.after === undefined ? null : JSON.stringify(event.after),
        event.metadata === undefined ? null : JSON.stringify(event.metadata),
        event.contextReference ?? null,
        this.clock.now(),
      ],
    };
  }
}
