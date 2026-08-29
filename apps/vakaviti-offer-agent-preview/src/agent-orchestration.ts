// Phase 2 (CEO incident correction, 2026-08-29): ONE native Cron Trigger ("*/10 * * * *"), ONE
// idempotent orchestration entry point. Each service decides independently whether it is due,
// based on its OWN last-successful-run timestamp - never by comparing controller.cron against a
// literal string. This replaces the removed design (three overlapping cron expressions, each
// dispatched via `if (event.cron === '<exact string>')`) which is a fragile pattern regardless of
// the exact historical cause of the silence investigated this session, and which this design
// eliminates as a class of risk rather than merely working around.
import type { Env } from './env';
import { enqueueDueFamiliesForDiscovery } from './discovery-agent';
import { runFreshnessTick } from './freshness-agent';
import { recoverStuckAgentRuns, checkAnomalyAndAutoPause } from './operations-supervisor';

export type ServiceName = 'DiscoveryAgent' | 'FreshnessAgent' | 'OperationsSupervisorAgent';

// Each service's own target cadence in minutes - independent of the underlying cron's actual
// firing interval, as long as that interval is <= the smallest of these.
export const SERVICE_CADENCE_MINUTES: Record<ServiceName, number> = {
  DiscoveryAgent: 10,
  FreshnessAgent: 12,
  OperationsSupervisorAgent: 15,
};

export interface DueCheckResult {
  due: boolean;
  reason: string;
  nextDueAt: string;
}

export async function isServiceDue(env: Env, serviceName: ServiceName, now: number = Date.now()): Promise<DueCheckResult> {
  const cadenceMin = SERVICE_CADENCE_MINUTES[serviceName];
  const lastRow = await env.DB.prepare(
    `SELECT completed_at FROM service_tick_log WHERE service_name=? AND completed_at IS NOT NULL AND outcome_json IS NOT NULL ORDER BY completed_at DESC LIMIT 1`
  ).bind(serviceName).first<any>();
  if (!lastRow?.completed_at) {
    return { due: true, reason: 'never completed a tick before', nextDueAt: new Date(now).toISOString() };
  }
  const lastMs = Date.parse(lastRow.completed_at);
  const ageMin = (now - lastMs) / 60000;
  const nextDueAt = new Date(lastMs + cadenceMin * 60000).toISOString();
  if (ageMin >= cadenceMin) {
    return { due: true, reason: `last completed ${ageMin.toFixed(1)}min ago, >= its own ${cadenceMin}min cadence`, nextDueAt };
  }
  return { due: false, reason: `last completed ${ageMin.toFixed(1)}min ago, < its own ${cadenceMin}min cadence`, nextDueAt };
}

async function runTickBodyFor(env: Env, serviceName: ServiceName): Promise<any> {
  switch (serviceName) {
    case 'DiscoveryAgent':
      return await enqueueDueFamiliesForDiscovery(env);
    case 'FreshnessAgent':
      return await runFreshnessTick(env);
    case 'OperationsSupervisorAgent': {
      const recovered = await recoverStuckAgentRuns(env);
      const paused = await checkAnomalyAndAutoPause(env);
      return { recovered, paused };
    }
  }
}

export interface RunDueAgentTicksResult {
  results: Record<ServiceName, any>;
}

/**
 * The single orchestration entry point called by the native scheduled() handler. Idempotent under
 * duplicate delivery of the SAME scheduled event (idempotency_key includes scheduledTime, and
 * service_tick_log.idempotency_key is UNIQUE - a duplicate INSERT throws, caught and treated as an
 * already-processed no-op, never a duplicate side effect). One service's failure is caught and
 * logged without preventing the other two from running - each is fully isolated in its own
 * try/catch inside the loop.
 */
export async function runDueAgentTicks(env: Env, scheduledTime: number, controllerCron: string): Promise<RunDueAgentTicksResult> {
  const results: Record<string, any> = {};
  for (const serviceName of Object.keys(SERVICE_CADENCE_MINUTES) as ServiceName[]) {
    const idempotencyKey = `${serviceName}:${scheduledTime}`;
    const logId = crypto.randomUUID();
    const dueCheck = await isServiceDue(env, serviceName);

    try {
      await env.DB.prepare(
        `INSERT INTO service_tick_log (id, scheduled_event_time, controller_cron, service_name, idempotency_key, is_due, reason) VALUES (?,?,?,?,?,?,?)`
      ).bind(logId, String(scheduledTime), controllerCron, serviceName, idempotencyKey, dueCheck.due ? 1 : 0, dueCheck.reason).run();
    } catch {
      // UNIQUE(idempotency_key) violation: this exact scheduled event already produced a log row
      // for this service (duplicate delivery of the same scheduled event) - safe no-op, not an error.
      results[serviceName] = { skipped: 'ALREADY_PROCESSED_THIS_SCHEDULED_EVENT' };
      continue;
    }

    if (!dueCheck.due) {
      await env.DB.prepare(`UPDATE service_tick_log SET completed_at=CURRENT_TIMESTAMP, outcome_json=?, next_due_at=? WHERE id=?`)
        .bind(JSON.stringify({ skipped: 'NOT_DUE' }), dueCheck.nextDueAt, logId).run();
      results[serviceName] = { skipped: 'NOT_DUE', reason: dueCheck.reason };
      continue;
    }

    try {
      const outcome = await runTickBodyFor(env, serviceName);
      await env.DB.prepare(`UPDATE service_tick_log SET completed_at=CURRENT_TIMESTAMP, outcome_json=?, next_due_at=? WHERE id=?`)
        .bind(JSON.stringify(outcome), dueCheck.nextDueAt, logId).run();
      results[serviceName] = outcome;
    } catch (e: any) {
      // Never rethrow - a failure in ONE service's tick body must not prevent the loop from
      // reaching the next service.
      const errorMessage = String(e?.message || e);
      await env.DB.prepare(`UPDATE service_tick_log SET completed_at=CURRENT_TIMESTAMP, outcome_json=? WHERE id=?`)
        .bind(JSON.stringify({ error: errorMessage }), logId).run();
      results[serviceName] = { error: errorMessage };
    }
  }
  return { results: results as Record<ServiceName, any> };
}
