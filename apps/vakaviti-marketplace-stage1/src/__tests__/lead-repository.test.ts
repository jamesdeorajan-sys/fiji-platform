import { describe, it, expect } from 'vitest';
import {
  Stage1LeadAdapter, DealExchangeLeadAdapter, CentralLeadInboxService, type ReadOnlyRowSource,
} from '../lead-repository';

// A read-only fake that throws if anything other than the two allowed methods is ever invoked on
// it - a Proxy would catch an unexpected property access too, but calling the two real methods and
// asserting no OTHER interaction occurred is sufficient to prove these adapters never attempt a
// write against the underlying store.
class RecordingReadOnlySource implements ReadOnlyRowSource {
  calls: string[] = [];
  constructor(private rows: Record<string, any>[]) {}
  async selectRecent(limit: number): Promise<Record<string, any>[]> {
    this.calls.push(`selectRecent(${limit})`);
    return this.rows.slice(0, limit);
  }
  async selectById(id: string): Promise<Record<string, any> | null> {
    this.calls.push(`selectById(${id})`);
    return this.rows.find(r => r.id === id) ?? null;
  }
}

describe('Stage1LeadAdapter', () => {
  it('maps legacy SENT and new CREATED to NEW, and WHATSAPP_OPENED unchanged', async () => {
    const src = new RecordingReadOnlySource([
      { id: 'a', operator_id: 'op-1', product_id: null, source_page: '/enquire/op-1', status: 'SENT', created_at: '2026-08-21T00:00:00Z' },
      { id: 'b', operator_id: 'op-2', product_id: null, source_page: '/enquire/op-2', status: 'CREATED', created_at: '2026-08-29T03:00:00Z' },
      { id: 'c', operator_id: 'op-2', product_id: null, source_page: '/enquire/op-2', status: 'WHATSAPP_OPENED', created_at: '2026-08-29T03:01:00Z' },
    ]);
    const adapter = new Stage1LeadAdapter(src);
    const views = await adapter.listRecent(10);
    expect(views.map(v => v.canonicalStatus)).toEqual(['NEW', 'NEW', 'WHATSAPP_OPENED']);
    expect(views.map(v => v.rawStatus)).toEqual(['SENT', 'CREATED', 'WHATSAPP_OPENED']);
    expect(views.every(v => v.originSystem === 'STAGE1_ENQUIRIES')).toBe(true);
  });

  it('never invokes anything on the row source except the two read methods', async () => {
    const src = new RecordingReadOnlySource([{ id: 'a', status: 'SENT', created_at: 'x' }]);
    const adapter = new Stage1LeadAdapter(src);
    await adapter.listRecent(5);
    await adapter.findById('a');
    expect(src.calls).toEqual(['selectRecent(5)', 'selectById(a)']);
  });

  it('an unrecognized future status defaults to NEW rather than throwing or being dropped', async () => {
    const src = new RecordingReadOnlySource([{ id: 'z', status: 'SOME_FUTURE_STATUS', created_at: 'x' }]);
    const view = await new Stage1LeadAdapter(src).findById('z');
    expect(view?.canonicalStatus).toBe('NEW');
    expect(view?.rawStatus).toBe('SOME_FUTURE_STATUS');
  });
});

describe('DealExchangeLeadAdapter', () => {
  it('maps REVIEW_CREATED/WHATSAPP_LINK_OPENED/HUMAN_CONTACT_CONFIRMED correctly, and never invents QUALIFIED/QUOTE/BOOKING states', async () => {
    const src = new RecordingReadOnlySource([
      { id: 'x1', provider_name: 'South Sea Cruises', offer_id: 'off-1', source_page: '/go/deal/off-1', status: 'REVIEW_CREATED', created_at: '2026-08-28T00:00:00Z' },
      { id: 'x2', provider_name: 'South Sea Cruises', offer_id: 'off-1', source_page: '/go/deal/off-1', status: 'WHATSAPP_LINK_OPENED', created_at: '2026-08-28T01:00:00Z' },
      { id: 'x3', provider_name: 'South Sea Cruises', offer_id: 'off-1', source_page: '/go/deal/off-1', status: 'HUMAN_CONTACT_CONFIRMED', created_at: '2026-08-28T02:00:00Z' },
    ]);
    const views = await new DealExchangeLeadAdapter(src).listRecent(10);
    expect(views.map(v => v.canonicalStatus)).toEqual(['NEW', 'WHATSAPP_OPENED', 'HUMAN_ASSIGNED']);
    const allCanonical: string[] = ['NEW', 'WHATSAPP_OPENED', 'HUMAN_ASSIGNED', 'QUALIFIED', 'QUOTE_REQUIRED', 'QUOTE_SENT', 'BOOKING_PENDING', 'BOOKED', 'LOST', 'EXPIRED'];
    for (const v of views) expect(allCanonical).toContain(v.canonicalStatus);
    expect(views.some(v => ['QUALIFIED', 'QUOTE_REQUIRED', 'QUOTE_SENT', 'BOOKING_PENDING', 'BOOKED'].includes(v.canonicalStatus))).toBe(false);
  });
});

describe('CentralLeadInboxService (read-only combined inbox)', () => {
  const stage1Src = new RecordingReadOnlySource([
    { id: 's1', status: 'CREATED', created_at: '2026-08-29T01:00:00Z' },
  ]);
  const dealExchangeSrc = new RecordingReadOnlySource([
    { id: 'd1', status: 'REVIEW_CREATED', created_at: '2026-08-29T02:00:00Z' },
  ]);
  const service = new CentralLeadInboxService([
    new Stage1LeadAdapter(stage1Src), new DealExchangeLeadAdapter(dealExchangeSrc),
  ]);

  it('combines both systems, tagging each record with its true origin', async () => {
    const combined = await service.listCombined(10);
    expect(combined).toHaveLength(2);
    expect(combined.map(v => v.originSystem).sort()).toEqual(['DEAL_EXCHANGE_ENQUIRIES', 'STAGE1_ENQUIRIES']);
    // Most recent first.
    expect(combined[0].originId).toBe('d1');
  });

  it('findByOrigin routes to the correct underlying system and never fabricates a cross-system id', async () => {
    const found = await service.findByOrigin('STAGE1_ENQUIRIES', 's1');
    expect(found?.originSystem).toBe('STAGE1_ENQUIRIES');
    const notFound = await service.findByOrigin('STAGE1_ENQUIRIES', 'd1'); // d1 only exists in the OTHER system
    expect(notFound).toBeNull();
  });

  it('exposes no write-shaped method - the class has no member that could mutate a lead', () => {
    const methodNames = Object.getOwnPropertyNames(CentralLeadInboxService.prototype);
    const forbidden = /write|insert|update|delete|assign|set|mutate|create|advance|transition/i;
    const offending = methodNames.filter(n => n !== 'constructor' && forbidden.test(n));
    expect(offending).toEqual([]);
    expect(methodNames.sort()).toEqual(['constructor', 'findByOrigin', 'listCombined'].sort());
  });

  it('LeadRepository implementations expose no write-shaped method either', () => {
    for (const proto of [Stage1LeadAdapter.prototype, DealExchangeLeadAdapter.prototype]) {
      const methodNames = Object.getOwnPropertyNames(proto);
      const forbidden = /write|insert|update|delete|assign|set|mutate|create|advance|transition/i;
      expect(methodNames.filter(n => n !== 'constructor' && forbidden.test(n))).toEqual([]);
    }
  });
});
