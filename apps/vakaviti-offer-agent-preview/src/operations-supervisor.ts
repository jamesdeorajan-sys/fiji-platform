// OperationsSupervisorAgent - status reporting (CEO directive Phase 7's exact field list) and the
// safety controls that may run automatically (per-source pause on anomaly, stuck-run recovery).
// Anything a human must decide (approve a new source, flip the global kill switch) is NOT here -
// see authority-model.ts, which structurally refuses this agent's actor type for those transitions.
import type { Env } from './env';
import { pauseSource, type Actor } from './authority-model';

const MAX_RUNNING_MINUTES = 10; // same watchdog threshold this codebase already uses elsewhere
export const ANOMALY_AUTO_PAUSE_THRESHOLD = 3; // consecutive failed scans before auto-pause
export const MAX_PAGES_PER_SOURCE_PER_RUN = 5;
export const MAX_DAILY_AI_CALLS = 200;

const SUPERVISOR_ACTOR: Actor = { type: 'AGENT_OPERATIONS_SUPERVISOR', id: 'operations-supervisor-agent' };

export interface StatusReport {
  agentsScheduled: string[];
  lastSuccessfulRunByAgent: Record<string, string | null>;
  candidatesDiscovered: number;
  offersExtracted: number;
  offersPublished: number;
  reviewRequiredCount: number;
  quarantinedCount: number;
  sourceFailures: { sourceFamilyId: string; failureCount: number; status: string }[];
  aiCallsToday: number;
  publicationsToday: { sourceFamilyId: string; count: number }[];
  globalPublicationsToday: number;
  globalKillSwitchActive: boolean;
  nextScheduledRuns: { agentName: string; cron: string }[];
}

export async function getStatusReport(env: Env): Promise<StatusReport> {
  const today = new Date().toISOString().slice(0, 10);

  const lastSuccess = await env.DB.prepare(
    `SELECT agent_name, MAX(completed_at) as last FROM agent_runs WHERE status='COMPLETED' GROUP BY agent_name`
  ).all<any>();
  const lastSuccessfulRunByAgent: Record<string, string | null> = {
    DiscoveryAgent: null, OfferProcessingWorkflow: null, PublicationAgent: null, FreshnessAgent: null, OperationsSupervisorAgent: null,
  };
  for (const row of lastSuccess.results || []) lastSuccessfulRunByAgent[row.agent_name] = row.last;

  const candidatesDiscovered = (await env.DB.prepare(`SELECT COUNT(*) c FROM discovered_candidates`).first<any>())?.c ?? 0;
  const offersExtracted = (await env.DB.prepare(`SELECT COUNT(*) c FROM deal_exchange_offers`).first<any>())?.c ?? 0;
  const offersPublished = (await env.DB.prepare(`SELECT COUNT(*) c FROM deal_exchange_offers WHERE publication_decision='ELIGIBLE'`).first<any>())?.c ?? 0;
  const reviewRequiredCount = (await env.DB.prepare(`SELECT COUNT(*) c FROM deal_exchange_offers WHERE publication_decision='NOT_ELIGIBLE'`).first<any>())?.c ?? 0;
  const quarantinedCount = (await env.DB.prepare(
    `SELECT COUNT(*) c FROM authority_transitions WHERE transition_type='OFFER_QUARANTINE'`
  ).first<any>())?.c ?? 0;

  const sourceFailuresRows = await env.DB.prepare(
    `SELECT id as sourceFamilyId, failure_count as failureCount, source_approval_status as status FROM offer_source_families WHERE failure_count > 0`
  ).all<any>();

  const aiCallsToday = (await env.DB.prepare(`SELECT count FROM daily_ai_call_counter WHERE call_date=?`).bind(today).first<any>())?.count ?? 0;
  const pubTodayRows = await env.DB.prepare(`SELECT source_family_id as sourceFamilyId, count FROM daily_publication_counters WHERE publication_date=?`).bind(today).all<any>();
  const globalPublicationsToday = (await env.DB.prepare(`SELECT count FROM daily_global_publication_counter WHERE publication_date=?`).bind(today).first<any>())?.count ?? 0;

  const killSwitch = await env.DB.prepare(`SELECT active FROM kill_switches WHERE id='global'`).first<any>();

  return {
    agentsScheduled: ['DiscoveryAgent', 'OfferProcessingWorkflow', 'PublicationAgent', 'FreshnessAgent', 'OperationsSupervisorAgent'],
    lastSuccessfulRunByAgent,
    candidatesDiscovered, offersExtracted, offersPublished, reviewRequiredCount, quarantinedCount,
    sourceFailures: sourceFailuresRows.results || [],
    aiCallsToday,
    publicationsToday: pubTodayRows.results || [],
    globalPublicationsToday,
    globalKillSwitchActive: !!killSwitch?.active,
    nextScheduledRuns: [
      { agentName: 'DiscoveryAgent', cron: '*/10 * * * *' },
      { agentName: 'FreshnessAgent', cron: '*/12 * * * *' },
      { agentName: 'OperationsSupervisorAgent', cron: '*/15 * * * *' },
    ],
  };
}

/** Marks any agent_runs row stuck RUNNING past the threshold as FAILED - never touches offer data. */
export async function recoverStuckAgentRuns(env: Env): Promise<number> {
  const stuck = await env.DB.prepare(
    `SELECT id FROM agent_runs WHERE status='RUNNING' AND started_at < datetime('now', '-' || ? || ' minutes')`
  ).bind(MAX_RUNNING_MINUTES).all<any>();
  for (const row of stuck.results || []) {
    await env.DB.prepare(`UPDATE agent_runs SET status='FAILED', completed_at=CURRENT_TIMESTAMP WHERE id=? AND status='RUNNING'`).bind(row.id).run();
  }
  return (stuck.results || []).length;
}

/** Auto-pause any source family whose consecutive failure count has crossed the anomaly
 * threshold - via authority-model.ts's pauseSource(), which is the only legal way this ever
 * happens (OperationsSupervisorAgent's actor type is accepted there; approveSource() would reject
 * it, so this agent can never un-pause a source on its own). */
export async function checkAnomalyAndAutoPause(env: Env): Promise<string[]> {
  const candidates = await env.DB.prepare(
    `SELECT id FROM offer_source_families WHERE source_approval_status='APPROVED' AND (failure_count >= ? OR consecutive_anomaly_count >= ?)`
  ).bind(ANOMALY_AUTO_PAUSE_THRESHOLD, ANOMALY_AUTO_PAUSE_THRESHOLD).all<any>();
  const pausedIds: string[] = [];
  for (const row of candidates.results || []) {
    const transition = pauseSource(SUPERVISOR_ACTOR, 'APPROVED', 'ANOMALY_THRESHOLD_EXCEEDED', `${ANOMALY_AUTO_PAUSE_THRESHOLD}+ consecutive failures/anomalies`);
    await env.DB.prepare(`UPDATE offer_source_families SET source_approval_status='PAUSED', updated_at=CURRENT_TIMESTAMP WHERE id=? AND source_approval_status='APPROVED'`).bind(row.id).run();
    await env.DB.prepare(
      `INSERT INTO authority_transitions (id, transition_type, actor_type, actor_id, reason_code, evidence, prior_state, next_state, subject_id) VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(crypto.randomUUID(), 'SOURCE_PAUSE', transition.actorType, transition.actorId, transition.reasonCode, transition.evidence, transition.priorState, transition.nextState, row.id).run();
    pausedIds.push(row.id);
  }
  return pausedIds;
}

export async function isUnderDailyAiCallBudget(env: Env): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare(`SELECT count FROM daily_ai_call_counter WHERE call_date=?`).bind(today).first<any>();
  return (row?.count ?? 0) < MAX_DAILY_AI_CALLS;
}

export async function incrementAiCallCounter(env: Env): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(
    `INSERT INTO daily_ai_call_counter (call_date, count) VALUES (?, 1) ON CONFLICT(call_date) DO UPDATE SET count = count + 1`
  ).bind(today).run();
}
