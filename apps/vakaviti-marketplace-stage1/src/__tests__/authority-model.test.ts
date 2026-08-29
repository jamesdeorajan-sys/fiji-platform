import { describe, it, expect } from 'vitest';
import {
  setGlobalKillSwitch, pauseSource, approveSource, quarantineOffer, restoreByHuman,
  restoreViaCleanRevalidation, type Actor, type CleanRevalidationResult,
} from '../authority-model';

const human: Actor = { type: 'HUMAN', id: 'ceo-1' };
const opsSupervisor: Actor = { type: 'AGENT_OPERATIONS_SUPERVISOR', id: 'ops-1' };
const expiryAgent: Actor = { type: 'AGENT_EXPIRY_QUARANTINE', id: 'expiry-1' };
const deterministicRule: Actor = { type: 'SYSTEM_DETERMINISTIC_RULE', id: 'rule-1' };

describe('global kill switch - human only, no exception', () => {
  it('a human can flip it and the record carries actor/reason/evidence/states/timestamp', () => {
    const r = setGlobalKillSwitch(human, 'INACTIVE', 'ACTIVE', 'MANUAL_PAUSE', 'CEO directive', () => 'T0');
    expect(r).toEqual({ actorType: 'HUMAN', actorId: 'ceo-1', reasonCode: 'MANUAL_PAUSE', evidence: 'CEO directive', priorState: 'INACTIVE', nextState: 'ACTIVE', timestamp: 'T0' });
  });

  it('an agent (of any kind) cannot change the global kill switch', () => {
    for (const agent of [opsSupervisor, expiryAgent, deterministicRule]) {
      expect(() => setGlobalKillSwitch(agent, 'INACTIVE', 'ACTIVE', 'x', null)).toThrow(/authenticated human/i);
    }
  });
});

describe('source pause vs approve', () => {
  it('OperationsSupervisor can pause an APPROVED source', () => {
    const r = pauseSource(opsSupervisor, 'APPROVED', 'ANOMALY_THRESHOLD', 'trust score dropped');
    expect(r.nextState).toBe('PAUSED');
    expect(r.actorType).toBe('AGENT_OPERATIONS_SUPERVISOR');
  });

  it('a human can also pause', () => {
    expect(pauseSource(human, 'APPROVED', 'MANUAL', 'x').nextState).toBe('PAUSED');
  });

  it('an unrelated agent type cannot pause', () => {
    expect(() => pauseSource(expiryAgent, 'APPROVED', 'x', 'x')).toThrow(/OperationsSupervisor/i);
  });

  it('cannot pause a source that is not currently APPROVED', () => {
    expect(() => pauseSource(human, 'PAUSED', 'x', 'x')).toThrow(/not currently APPROVED/i);
  });

  it('source can be auto-paused but NEVER auto-approved - approveSource rejects every agent type', () => {
    expect(() => approveSource(opsSupervisor, 'PAUSED', 'x', 'x')).toThrow(/authenticated human/i);
    expect(() => approveSource(deterministicRule, 'PENDING_REVIEW', 'x', 'x')).toThrow(/authenticated human/i);
    expect(approveSource(human, 'PAUSED', 'REVIEWED', 'looks fine').nextState).toBe('APPROVED');
  });
});

describe('offer quarantine', () => {
  it('the deterministic rule may quarantine for EXPIRY or MATERIAL_CHANGE only', () => {
    expect(quarantineOffer(deterministicRule, 'PUBLISHED', 'EXPIRY', 'past deadline').nextState).toBe('QUARANTINED');
    expect(quarantineOffer(deterministicRule, 'PUBLISHED', 'MATERIAL_CHANGE', 'price changed').nextState).toBe('QUARANTINED');
  });

  it('the deterministic rule may NOT quarantine for HUMAN_DECISION or DISPUTE reason codes', () => {
    expect(() => quarantineOffer(deterministicRule, 'PUBLISHED', 'HUMAN_DECISION', 'x')).toThrow(/requires an authenticated human/i);
    expect(() => quarantineOffer(deterministicRule, 'PUBLISHED', 'DISPUTE', 'x')).toThrow(/requires an authenticated human/i);
  });

  it('a human may quarantine for any reason code', () => {
    expect(quarantineOffer(human, 'PUBLISHED', 'DISPUTE', 'provider disputed the price').nextState).toBe('QUARANTINED');
  });

  it('a generic operations/expiry agent type (not the deterministic rule) cannot quarantine', () => {
    expect(() => quarantineOffer(opsSupervisor, 'PUBLISHED', 'EXPIRY', 'x')).toThrow();
    expect(() => quarantineOffer(expiryAgent, 'PUBLISHED', 'EXPIRY', 'x')).toThrow();
  });

  it('cannot quarantine an offer that is not PUBLISHED', () => {
    expect(() => quarantineOffer(human, 'QUARANTINED', 'DISPUTE', 'x')).toThrow(/not currently PUBLISHED/i);
  });
});

describe('restore - two distinct, independently-gated paths', () => {
  it('restoreByHuman works for a human and rejects every agent type', () => {
    expect(restoreByHuman(human, 'QUARANTINED', 'PUBLISHED', 'RESOLVED', 'provider confirmed').nextState).toBe('PUBLISHED');
    for (const agent of [opsSupervisor, expiryAgent, deterministicRule]) {
      expect(() => restoreByHuman(agent, 'QUARANTINED', 'PUBLISHED', 'x', 'x')).toThrow(/authenticated human/i);
    }
  });

  const passingRevalidation: CleanRevalidationResult = {
    allGatesRePassed: true, failedGates: [], evidenceIsFresh: true, revalidatedAt: '2026-08-29T00:00:00Z',
  };

  it('restoreViaCleanRevalidation succeeds only when every gate re-passed with fresh evidence', () => {
    const r = restoreViaCleanRevalidation(deterministicRule, 'QUARANTINED', 'PUBLISHED', passingRevalidation, 'full re-check clean');
    expect(r.nextState).toBe('PUBLISHED');
    expect(r.reasonCode).toBe('CLEAN_REVALIDATION_PASSED');
  });

  it('restoreViaCleanRevalidation rejects if any gate failed, even one', () => {
    const failing: CleanRevalidationResult = { ...passingRevalidation, allGatesRePassed: false, failedGates: ['no_unresolved_contradiction'] };
    expect(() => restoreViaCleanRevalidation(deterministicRule, 'QUARANTINED', 'PUBLISHED', failing, 'x')).toThrow(/ALL gates to re-pass/i);
  });

  it('restoreViaCleanRevalidation rejects stale/carried-over evidence even if gates report passing', () => {
    const stale: CleanRevalidationResult = { ...passingRevalidation, evidenceIsFresh: false };
    expect(() => restoreViaCleanRevalidation(deterministicRule, 'QUARANTINED', 'PUBLISHED', stale, 'x')).toThrow(/fresh evidence/i);
  });

  it('restoreViaCleanRevalidation rejects a generic (non-deterministic-rule) agent type', () => {
    expect(() => restoreViaCleanRevalidation(opsSupervisor, 'QUARANTINED', 'PUBLISHED', passingRevalidation, 'x')).toThrow(/never a generic AI agent/i);
    expect(() => restoreViaCleanRevalidation(expiryAgent, 'QUARANTINED', 'PUBLISHED', passingRevalidation, 'x')).toThrow(/never a generic AI agent/i);
  });
});
