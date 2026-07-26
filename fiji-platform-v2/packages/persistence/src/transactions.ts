import type { AuditEvent, AuditWriter } from "./audit.ts";
import type { Persistence, SqlStatement } from "./database.ts";

export class TransactionPatterns {
  private readonly persistence: Persistence;
  private readonly audit: AuditWriter;
  constructor(persistence: Persistence, audit: AuditWriter) {
    this.persistence = persistence;
    this.audit = audit;
  }
  booking(update: SqlStatement, event: SqlStatement, audit: AuditEvent) {
    return this.persistence.transaction([
      update,
      event,
      this.audit.statement(audit),
    ]);
  }
  dispatch(
    claim: {
      id: string;
      bookingId: string;
      offerId: string;
      driverId: string;
      claimedAt: string;
    },
    acceptOffer: SqlStatement,
    assignIfUnassigned: SqlStatement,
    event: SqlStatement,
    audit: AuditEvent,
  ) {
    return this.persistence.transaction([
      {
        sql: "INSERT INTO dispatch_claims (id,booking_id,offer_id,driver_id,claimed_at) VALUES (?,?,?,?,?)",
        params: [
          claim.id,
          claim.bookingId,
          claim.offerId,
          claim.driverId,
          claim.claimedAt,
        ],
      },
      acceptOffer,
      assignIfUnassigned,
      event,
      this.audit.statement(audit),
    ]);
  }
  wallet(ledger: SqlStatement, idempotency: SqlStatement, audit: AuditEvent) {
    return this.persistence.transaction([
      ledger,
      idempotency,
      this.audit.statement(audit),
    ]);
  }
}
