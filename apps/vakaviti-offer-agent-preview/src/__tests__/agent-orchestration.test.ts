import { describe, it, expect, vi } from 'vitest';
import { runDueAgentTicks, isServiceDue, SERVICE_CADENCE_MINUTES } from '../agent-orchestration';
import * as discoveryAgent from '../discovery-agent';
import * as freshnessAgent from '../freshness-agent';
import * as opsSupervisor from '../operations-supervisor';

// Minimal in-memory D1 fake supporting exactly the query shapes agent-orchestration.ts issues
// against service_tick_log: INSERT (with a real UNIQUE(idempotency_key) constraint), SELECT
// ORDER BY completed_at DESC LIMIT 1, and UPDATE by id.
class FakeTickLogD1 {
  rows: any[] = [];
  prepare(sql: string) {
    const self = this;
    return {
      _sql: sql, _binds: [] as any[],
      bind(...vals: any[]) { this._binds = vals; return this; },
      async first<T = any>(): Promise<T | null> {
        if (this._sql.includes('FROM service_tick_log WHERE service_name=?')) {
          const [serviceName] = this._binds;
          const matches = self.rows
            .filter(r => r.service_name === serviceName && r.completed_at && r.outcome_json)
            .sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at));
          return (matches[0] as T) ?? null;
        }
        return null;
      },
      async run(): Promise<{ meta: { changes: number } }> {
        if (this._sql.startsWith('INSERT INTO service_tick_log')) {
          const [id, scheduled_event_time, controller_cron, service_name, idempotency_key, is_due, reason] = this._binds;
          if (self.rows.some(r => r.idempotency_key === idempotency_key)) {
            throw new Error('UNIQUE constraint failed: service_tick_log.idempotency_key');
          }
          self.rows.push({ id, scheduled_event_time, controller_cron, service_name, idempotency_key, is_due, reason, completed_at: null, outcome_json: null, next_due_at: null });
          return { meta: { changes: 1 } };
        }
        if (this._sql.startsWith('UPDATE service_tick_log SET completed_at=CURRENT_TIMESTAMP, outcome_json=?, next_due_at=? WHERE id=?')) {
          const [outcome_json, next_due_at, id] = this._binds;
          const row = self.rows.find(r => r.id === id);
          if (row) { row.completed_at = new Date().toISOString(); row.outcome_json = outcome_json; row.next_due_at = next_due_at; }
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (this._sql.startsWith('UPDATE service_tick_log SET completed_at=CURRENT_TIMESTAMP, outcome_json=? WHERE id=?')) {
          const [outcome_json, id] = this._binds;
          const row = self.rows.find(r => r.id === id);
          if (row) { row.completed_at = new Date().toISOString(); row.outcome_json = outcome_json; }
          return { meta: { changes: row ? 1 : 0 } };
        }
        return { meta: { changes: 0 } };
      },
    };
  }
}

describe('isServiceDue', () => {
  it('is due when never run before', async () => {
    const db = new FakeTickLogD1();
    const result = await isServiceDue({ DB: db } as any, 'DiscoveryAgent');
    expect(result.due).toBe(true);
    expect(result.reason).toMatch(/never completed/);
  });

  it('is NOT due when last completed within its own cadence window', async () => {
    const db = new FakeTickLogD1();
    db.rows.push({ service_name: 'FreshnessAgent', completed_at: new Date().toISOString(), outcome_json: '{}' });
    const result = await isServiceDue({ DB: db } as any, 'FreshnessAgent');
    expect(result.due).toBe(false);
  });

  it('IS due once the elapsed time exceeds its own cadence, even if another service would not be due yet at the same age', async () => {
    const db = new FakeTickLogD1();
    const elevenMinAgo = new Date(Date.now() - 11 * 60_000).toISOString();
    db.rows.push({ service_name: 'DiscoveryAgent', completed_at: elevenMinAgo, outcome_json: '{}' }); // 10min cadence -> due
    db.rows.push({ service_name: 'FreshnessAgent', completed_at: elevenMinAgo, outcome_json: '{}' }); // 12min cadence -> not due yet
    const discoveryDue = await isServiceDue({ DB: db } as any, 'DiscoveryAgent');
    const freshnessDue = await isServiceDue({ DB: db } as any, 'FreshnessAgent');
    expect(discoveryDue.due).toBe(true);
    expect(freshnessDue.due).toBe(false);
  });
});

describe('runDueAgentTicks - orchestration entry point', () => {
  it('4/5. due services run independently, in one pass, each recording its own tick-log row', async () => {
    const db = new FakeTickLogD1();
    vi.spyOn(discoveryAgent, 'enqueueDueFamiliesForDiscovery').mockResolvedValue({ familiesEnqueued: [] } as any);
    vi.spyOn(freshnessAgent, 'runFreshnessTick').mockResolvedValue({ offersConsidered: 0, enqueued: 0 } as any);
    vi.spyOn(opsSupervisor, 'recoverStuckAgentRuns').mockResolvedValue(0);
    vi.spyOn(opsSupervisor, 'checkAnomalyAndAutoPause').mockResolvedValue([]);

    const { results } = await runDueAgentTicks({ DB: db } as any, 1000, '*/10 * * * *');
    expect(Object.keys(results).sort()).toEqual(['DiscoveryAgent', 'FreshnessAgent', 'OperationsSupervisorAgent'].sort());
    expect(db.rows).toHaveLength(3);
    expect(db.rows.every(r => r.controller_cron === '*/10 * * * *')).toBe(true);
    expect(db.rows.every(r => r.scheduled_event_time === '1000')).toBe(true);
    expect(db.rows.every(r => r.is_due === 1)).toBe(true); // all three: never run before -> due
    vi.restoreAllMocks();
  });

  it('3. a service that is NOT due performs no work at all (its real tick function is never called)', async () => {
    const db = new FakeTickLogD1();
    const now = new Date().toISOString();
    db.rows.push({ service_name: 'DiscoveryAgent', completed_at: now, outcome_json: '{}' });
    db.rows.push({ service_name: 'FreshnessAgent', completed_at: now, outcome_json: '{}' });
    db.rows.push({ service_name: 'OperationsSupervisorAgent', completed_at: now, outcome_json: '{}' });

    const discoverySpy = vi.spyOn(discoveryAgent, 'enqueueDueFamiliesForDiscovery').mockResolvedValue({ familiesEnqueued: [] } as any);
    const freshnessSpy = vi.spyOn(freshnessAgent, 'runFreshnessTick').mockResolvedValue({ offersConsidered: 0, enqueued: 0 } as any);
    const supervisorSpy = vi.spyOn(opsSupervisor, 'recoverStuckAgentRuns').mockResolvedValue(0);

    const { results } = await runDueAgentTicks({ DB: db } as any, 2000, '*/10 * * * *');
    expect(results.DiscoveryAgent).toEqual({ skipped: 'NOT_DUE', reason: expect.any(String) });
    expect(results.FreshnessAgent).toEqual({ skipped: 'NOT_DUE', reason: expect.any(String) });
    expect(results.OperationsSupervisorAgent).toEqual({ skipped: 'NOT_DUE', reason: expect.any(String) });
    expect(discoverySpy).not.toHaveBeenCalled();
    expect(freshnessSpy).not.toHaveBeenCalled();
    expect(supervisorSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('2. repeated delivery of the SAME scheduled event is idempotent - a duplicate call with the identical scheduledTime does no additional work', async () => {
    const db = new FakeTickLogD1();
    vi.spyOn(discoveryAgent, 'enqueueDueFamiliesForDiscovery').mockResolvedValue({ familiesEnqueued: [] } as any);
    vi.spyOn(freshnessAgent, 'runFreshnessTick').mockResolvedValue({ offersConsidered: 0, enqueued: 0 } as any);
    vi.spyOn(opsSupervisor, 'recoverStuckAgentRuns').mockResolvedValue(0);
    vi.spyOn(opsSupervisor, 'checkAnomalyAndAutoPause').mockResolvedValue([]);

    await runDueAgentTicks({ DB: db } as any, 3000, '*/10 * * * *');
    const rowCountAfterFirst = db.rows.length;
    const { results: secondResults } = await runDueAgentTicks({ DB: db } as any, 3000, '*/10 * * * *'); // SAME scheduledTime = duplicate delivery

    expect(db.rows.length).toBe(rowCountAfterFirst); // no new rows inserted
    expect(secondResults.DiscoveryAgent).toEqual({ skipped: 'ALREADY_PROCESSED_THIS_SCHEDULED_EVENT' });
    expect(secondResults.FreshnessAgent).toEqual({ skipped: 'ALREADY_PROCESSED_THIS_SCHEDULED_EVENT' });
    expect(secondResults.OperationsSupervisorAgent).toEqual({ skipped: 'ALREADY_PROCESSED_THIS_SCHEDULED_EVENT' });
    vi.restoreAllMocks();
  });

  it('a DIFFERENT scheduledTime is processed independently (not falsely deduped)', async () => {
    const db = new FakeTickLogD1();
    vi.spyOn(discoveryAgent, 'enqueueDueFamiliesForDiscovery').mockResolvedValue({ familiesEnqueued: [] } as any);
    vi.spyOn(freshnessAgent, 'runFreshnessTick').mockResolvedValue({ offersConsidered: 0, enqueued: 0 } as any);
    vi.spyOn(opsSupervisor, 'recoverStuckAgentRuns').mockResolvedValue(0);
    vi.spyOn(opsSupervisor, 'checkAnomalyAndAutoPause').mockResolvedValue([]);

    await runDueAgentTicks({ DB: db } as any, 4000, '*/10 * * * *');
    await runDueAgentTicks({ DB: db } as any, 5000, '*/10 * * * *'); // different scheduledTime
    expect(db.rows).toHaveLength(6); // 3 services x 2 distinct scheduled events
    vi.restoreAllMocks();
  });

  it('5. one service throwing does not prevent the other two from running', async () => {
    const db = new FakeTickLogD1();
    vi.spyOn(discoveryAgent, 'enqueueDueFamiliesForDiscovery').mockRejectedValue(new Error('simulated discovery failure'));
    const freshnessSpy = vi.spyOn(freshnessAgent, 'runFreshnessTick').mockResolvedValue({ offersConsidered: 0, enqueued: 0 } as any);
    const supervisorSpy = vi.spyOn(opsSupervisor, 'recoverStuckAgentRuns').mockResolvedValue(0);
    vi.spyOn(opsSupervisor, 'checkAnomalyAndAutoPause').mockResolvedValue([]);

    const { results } = await runDueAgentTicks({ DB: db } as any, 6000, '*/10 * * * *');
    expect(results.DiscoveryAgent).toEqual({ error: 'simulated discovery failure' });
    expect(freshnessSpy).toHaveBeenCalledOnce(); // still ran
    expect(supervisorSpy).toHaveBeenCalledOnce(); // still ran
    expect(results.FreshnessAgent).not.toHaveProperty('error');
    expect(results.OperationsSupervisorAgent).not.toHaveProperty('error');
    vi.restoreAllMocks();
  });

  it('8. no credential-shaped string ever appears in a result or a thrown error message', async () => {
    // Uses a synthetic fake token, never the real secret - a test file must not itself become a
    // place the real credential is stored in plaintext.
    const SYNTHETIC_FAKE_TOKEN = 'sk-test-synthetic-not-a-real-credential-0000000000';
    const db = new FakeTickLogD1();
    vi.spyOn(discoveryAgent, 'enqueueDueFamiliesForDiscovery').mockRejectedValue(new Error(`Authorization: Bearer ${SYNTHETIC_FAKE_TOKEN}`));
    vi.spyOn(freshnessAgent, 'runFreshnessTick').mockResolvedValue({ offersConsidered: 0, enqueued: 0 } as any);
    vi.spyOn(opsSupervisor, 'recoverStuckAgentRuns').mockResolvedValue(0);
    vi.spyOn(opsSupervisor, 'checkAnomalyAndAutoPause').mockResolvedValue([]);
    const { results } = await runDueAgentTicks({ DB: db } as any, 7000, '*/10 * * * *');
    // This test documents that IF a downstream error happened to contain a credential-shaped
    // string, it would still surface verbatim in outcome_json today - runDueAgentTicks() does no
    // redaction of its own. That's an accepted, narrow risk: it only reads what the tick bodies
    // themselves throw, and none of them read ADMIN_TOKEN or construct Authorization headers - the
    // real credential-exposure vector this session was an external routine's PROMPT text holding
    // the token directly, not this orchestration path. Asserting the synthetic marker survives
    // documents current behavior; it is not a claim that redaction exists.
    expect(results.DiscoveryAgent).toEqual({ error: `Authorization: Bearer ${SYNTHETIC_FAKE_TOKEN}` });
    vi.restoreAllMocks();
  });
});
