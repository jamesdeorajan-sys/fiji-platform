// Phase A-R, item 3: read-only lead consolidation WITHOUT a fourth pipeline (CEO directive 2026-08-29).
//
// No new "leads" table is created here - that migration is proposed separately (see
// docs/PHASE_A_R_BOUNDARY_MAP.md, section "Future canonical-lead migration proposal") and is NOT
// implemented in this phase. This module only reads the two existing, still-authoritative write
// systems - Stage 1's `enquiries` table and the Live Deal Exchange's `deal_exchange_enquiries`
// table - and presents them through one normalized, read-only view for a combined admin inbox.
//
// LeadRepository is deliberately given NO write method at all - not "a write method that throws,"
// an interface with no such member. A caller cannot accidentally call a write path that doesn't
// exist. This is the structural proof behind the "combined lead view is read-only" test.

export type CanonicalLeadStatus =
  | 'NEW' | 'WHATSAPP_OPENED' | 'HUMAN_ASSIGNED' | 'QUALIFIED' | 'QUOTE_REQUIRED'
  | 'QUOTE_SENT' | 'BOOKING_PENDING' | 'BOOKED' | 'LOST' | 'EXPIRED';

export type LeadOriginSystem = 'STAGE1_ENQUIRIES' | 'DEAL_EXCHANGE_ENQUIRIES';

export interface CentralLeadView {
  // originSystem + originId together are the ONLY identity this view assigns - there is no new
  // primary key minted for a lead. A human acting on a lead always acts in the originating
  // system's own admin surface, using originId, never through this view.
  originSystem: LeadOriginSystem;
  originId: string;
  operatorOrProviderName: string | null;
  productOrOfferReference: string | null;
  sourcePage: string | null;
  canonicalStatus: CanonicalLeadStatus;
  rawStatus: string; // the originating system's own literal status value, preserved for audit
  createdAt: string;
}

// A read-only query surface - deliberately narrower than a full D1Database. Each adapter is
// responsible for translating this into whatever SELECT its own table actually needs; neither
// adapter is ever given anything resembling `run()`/`exec()` write access.
export interface ReadOnlyRowSource {
  selectRecent(limit: number): Promise<Record<string, any>[]>;
  selectById(id: string): Promise<Record<string, any> | null>;
}

export interface LeadRepository {
  readonly originSystem: LeadOriginSystem;
  listRecent(limit: number): Promise<CentralLeadView[]>;
  findById(originId: string): Promise<CentralLeadView | null>;
}

// --- Stage 1 (`enquiries` table) -----------------------------------------------------------------
// Existing statuses observed in real production data this engagement: 'SENT' (legacy, pre-PR#29
// raw-GET write path), 'CREATED' and 'WHATSAPP_OPENED' (PR#29's honest lifecycle). Mapped forward-
// only - a legacy SENT row is presented as NEW, since no further lifecycle tracking exists for it
// and it must never be silently upgraded past what is actually known.
const STAGE1_STATUS_MAP: Record<string, CanonicalLeadStatus> = {
  SENT: 'NEW',
  CREATED: 'NEW',
  WHATSAPP_OPENED: 'WHATSAPP_OPENED',
};

export class Stage1LeadAdapter implements LeadRepository {
  readonly originSystem: LeadOriginSystem = 'STAGE1_ENQUIRIES';
  constructor(private readonly source: ReadOnlyRowSource) {}

  private toView(row: Record<string, any>): CentralLeadView {
    const rawStatus = String(row.status ?? '');
    return {
      originSystem: this.originSystem,
      originId: row.id,
      operatorOrProviderName: row.operator_id ?? null,
      productOrOfferReference: row.product_id ?? null,
      sourcePage: row.source_page ?? null,
      canonicalStatus: STAGE1_STATUS_MAP[rawStatus] ?? 'NEW',
      rawStatus,
      createdAt: row.created_at,
    };
  }

  async listRecent(limit: number): Promise<CentralLeadView[]> {
    const rows = await this.source.selectRecent(limit);
    return rows.map(r => this.toView(r));
  }

  async findById(originId: string): Promise<CentralLeadView | null> {
    const row = await this.source.selectById(originId);
    return row ? this.toView(row) : null;
  }
}

// --- Live Deal Exchange (`deal_exchange_enquiries` table) ----------------------------------------
// Existing enum (deal-exchange/0004_enquiry_lifecycle.sql): REVIEW_CREATED, WHATSAPP_LINK_OPENED,
// HUMAN_CONTACT_CONFIRMED. HUMAN_CONTACT_CONFIRMED maps to HUMAN_ASSIGNED, not further - this
// system has no QUALIFIED/QUOTE/BOOKING states today, and this adapter must never invent one.
const DEAL_EXCHANGE_STATUS_MAP: Record<string, CanonicalLeadStatus> = {
  REVIEW_CREATED: 'NEW',
  WHATSAPP_LINK_OPENED: 'WHATSAPP_OPENED',
  HUMAN_CONTACT_CONFIRMED: 'HUMAN_ASSIGNED',
};

export class DealExchangeLeadAdapter implements LeadRepository {
  readonly originSystem: LeadOriginSystem = 'DEAL_EXCHANGE_ENQUIRIES';
  constructor(private readonly source: ReadOnlyRowSource) {}

  private toView(row: Record<string, any>): CentralLeadView {
    const rawStatus = String(row.status ?? '');
    return {
      originSystem: this.originSystem,
      originId: row.id,
      operatorOrProviderName: row.provider_name ?? null,
      productOrOfferReference: row.offer_id ?? null,
      sourcePage: row.source_page ?? null,
      canonicalStatus: DEAL_EXCHANGE_STATUS_MAP[rawStatus] ?? 'NEW',
      rawStatus,
      createdAt: row.created_at,
    };
  }

  async listRecent(limit: number): Promise<CentralLeadView[]> {
    const rows = await this.source.selectRecent(limit);
    return rows.map(r => this.toView(r));
  }

  async findById(originId: string): Promise<CentralLeadView | null> {
    const row = await this.source.selectById(originId);
    return row ? this.toView(row) : null;
  }
}

// --- Combined admin inbox (read-only) -------------------------------------------------------------
// The ENTIRE public surface of this class is two read methods. There is deliberately no
// updateStatus()/assign()/etc - a human who needs to act on a lead goes to the originating
// system's own admin endpoint (Stage 1's or Deal Exchange's), using originId. This class only ever
// helps a human SEE both queues in one place.
export class CentralLeadInboxService {
  constructor(private readonly repositories: LeadRepository[]) {}

  async listCombined(limitPerSystem: number): Promise<CentralLeadView[]> {
    const perSystem = await Promise.all(this.repositories.map(r => r.listRecent(limitPerSystem)));
    return perSystem.flat().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async findByOrigin(originSystem: LeadOriginSystem, originId: string): Promise<CentralLeadView | null> {
    const repo = this.repositories.find(r => r.originSystem === originSystem);
    if (!repo) return null;
    return repo.findById(originId);
  }
}
