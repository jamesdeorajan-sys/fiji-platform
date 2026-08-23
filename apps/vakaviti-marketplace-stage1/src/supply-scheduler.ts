import { discoverProviderFromSource } from './discovery-bridge';
import { promoteCandidateToDirectoryListing } from './candidates';
import { evaluateDirectoryListingGates } from './directory-gate';
import { safeFetchSource } from './deal-agent';
import { autoPublishDealIfEligible } from './deals';

// Declared locally (not imported from candidates.ts, whose own Bindings is narrower - just
// {DB, ADMIN_TOKEN?}) because this file also needs AI (for discoverProviderFromSource) and
// ENVIRONMENT (structural superset requirement of discovery-bridge.ts's own Bindings type).
type Bindings = { DB: D1Database; AI: Ai; ENVIRONMENT: string; ADMIN_TOKEN?: string };

// Vakaviti P1.5 - the Cron-driven supply scheduler. This is what removes the manual "Start
// sprint" click from routine operations: the existing scheduled() Worker entrypoint
// (src/index.ts) now calls runSupplyBootstrap() on every Cron firing, alongside the pre-existing
// runDailyDiscovery() (deal-offer scanning, src/deal-agent.ts, unchanged). No public HTTP route
// triggers this file - Cloudflare's own Cron Trigger is the only caller, matching the CEO
// directive's explicit "never require a public HTTP trigger" instruction.
//
// Reuses the exact tables and idempotency/watchdog discipline already proven in
// src/supply-sprint-ui.ts (supply_sprint_runs/supply_sprint_scans) - the only difference is WHO
// starts and continues a run: a scheduled Cron tick instead of an authenticated human click. The
// Access-protected admin page at /admin/supply/sprint remains for monitoring, pausing, and
// manually retrying - not for starting routine work, exactly as directed.
//
// AUTO-PUBLISH LAW (Class A, factual directory listings only): once a candidate is created, its
// gates are evaluated immediately via evaluateDirectoryListingGates() - the exact same pure
// function the human batch-review console uses. If eligible, promoteCandidateToDirectoryListing()
// is called directly - the SAME governed function the human console calls, which independently
// re-validates every gate, the standing policy, and duplicate/already-promoted state on every
// call regardless of caller. This file never writes to operators/products itself, never sets
// VAKAVITI_VERIFIED, and never touches provider_ceo_confirmations or deal_offer_candidates -
// see regression-guards.mjs check 24.
//
// Class B (source-evidenced deals) is deliberately NOT auto-published by this file - see
// src/deal-quality.ts's evaluateDealAutoPublishGates() header comment for the structural reason
// (rights/fulfilment/response-owner assignment are human judgment calls with no safe default,
// not facts extractable from a webpage) and the P1.5 final report for what would need to change.

const BOOTSTRAP_SOURCE_DOMAINS = [
  'bluelagooncruises.com',
  'matangiisland.com',
  'savasiisland.com',
  'serenitysands.com.fj',
  'captaincookcruisesfiji.com',
  'fiji.intercontinental.com',
  'plantationisland.com',
];
const MAX_SOURCES_PER_TICK = 3;
const MAX_RUNNING_MINUTES = 10;
const BOOTSTRAP_IDEMPOTENCY_KEY = 'supply-bootstrap-p1.5-2026-08-21';
const AUTO_PUBLISH_ACTOR = 'AI (standing policy auto-publish, Cron-triggered)';

async function recoverStuckSprints(env: Bindings): Promise<void> {
  const stuck = await env.DB.prepare(
    `SELECT id FROM supply_sprint_runs WHERE status='RUNNING' AND started_at < datetime('now', '-' || ? || ' minutes')`
  ).bind(MAX_RUNNING_MINUTES).all<any>();
  for (const row of stuck.results || []) {
    await env.DB.prepare(
      `UPDATE supply_sprint_runs SET status='FAILED', completed_at=CURRENT_TIMESTAMP, summary_json=? WHERE id=? AND status='RUNNING'`
    ).bind(JSON.stringify({ failure_reason: 'TIMED_OUT', reason: `Exceeded ${MAX_RUNNING_MINUTES}-minute running threshold` }), row.id).run();
  }
}

async function autoPublishIfEligible(env: Bindings, candidateId: string): Promise<{ attempted: boolean; published: boolean; reason?: string }> {
  const row = await env.DB.prepare(
    `SELECT co.*, (SELECT COUNT(*) FROM product_candidates pc WHERE pc.operator_candidate_id = co.id) AS product_count
     FROM candidate_operators co WHERE co.id = ?`
  ).bind(candidateId).first<any>();
  if (!row) return { attempted: false, published: false, reason: 'candidate_not_found' };

  const gate = evaluateDirectoryListingGates({
    canonical_name: row.canonical_name, website_url: row.website_url, primary_url: row.primary_url,
    locality: row.locality, region: row.region, duplicate_of_id: row.duplicate_of_id,
    product_count: Number(row.product_count || 0),
  });
  if (gate.decision !== 'ELIGIBLE') return { attempted: false, published: false, reason: 'gate_not_eligible' };

  const result = await promoteCandidateToDirectoryListing(env, candidateId, AUTO_PUBLISH_ACTOR);
  return { attempted: true, published: result.ok, reason: result.ok ? undefined : result.error };
}

// One bootstrap run, auto-started on the first Cron tick after this code deploys (idempotency_key
// is a fixed constant, so exactly one bootstrap run can ever exist - re-deploys never start a
// second one). Once the bootstrap's 7 sources are exhausted, ongoing discovery continues through
// the pre-existing deal-agent.ts Cron path for OFFER re-scanning; a future new source list would
// need its own run (this function only ever processes BOOTSTRAP_SOURCE_DOMAINS, by design, so a
// completed bootstrap is a terminal, auditable, one-time event, not a recurring loop).
export async function runSupplyBootstrap(env: Bindings): Promise<{ ranBatch: boolean; runId?: string; skipReason?: string }> {
  await recoverStuckSprints(env);

  let run = await env.DB.prepare(`SELECT * FROM supply_sprint_runs WHERE idempotency_key=?`).bind(BOOTSTRAP_IDEMPOTENCY_KEY).first<any>();

  if (!run) {
    const otherRunning = await env.DB.prepare(`SELECT id FROM supply_sprint_runs WHERE status='RUNNING' LIMIT 1`).first<any>();
    if (otherRunning) return { ranBatch: false, skipReason: 'another_run_in_progress' };

    const runId = crypto.randomUUID();
    const insertRun = await env.DB.prepare(
      `INSERT OR IGNORE INTO supply_sprint_runs (id, idempotency_key, started_by, source_domains_json) VALUES (?,?,?,?)`
    ).bind(runId, BOOTSTRAP_IDEMPOTENCY_KEY, 'CRON (P1.5 automated bootstrap)', JSON.stringify(BOOTSTRAP_SOURCE_DOMAINS)).run();
    if ((insertRun.meta as any).changes === 0) {
      // Another concurrent tick won the race to create it - re-read and proceed to continue it.
      run = await env.DB.prepare(`SELECT * FROM supply_sprint_runs WHERE idempotency_key=?`).bind(BOOTSTRAP_IDEMPOTENCY_KEY).first<any>();
    } else {
      run = await env.DB.prepare(`SELECT * FROM supply_sprint_runs WHERE id=?`).bind(runId).first<any>();
    }
  }

  if (!run || run.status !== 'RUNNING') {
    return { ranBatch: false, runId: run?.id, skipReason: run ? `bootstrap_${String(run.status).toLowerCase()}` : 'no_run' };
  }

  const domains: string[] = JSON.parse(run.source_domains_json);
  const batch = domains.slice(run.next_batch_offset, run.next_batch_offset + MAX_SOURCES_PER_TICK);

  let processed = run.sources_processed, failed = run.sources_failed;
  let created = run.candidates_created, rejected = run.candidates_rejected_weak, products = run.product_candidates_created;

  for (const domain of batch) {
    const idemKey = `${run.idempotency_key}-${domain}`;
    const already = await env.DB.prepare(`SELECT id FROM supply_sprint_scans WHERE idempotency_key=?`).bind(idemKey).first<any>();
    if (already) continue;

    let result: Awaited<ReturnType<typeof discoverProviderFromSource>>;
    try {
      result = await discoverProviderFromSource(env, domain);
    } catch (e: any) {
      result = { outcome: 'FETCH_FAILED', error: String(e?.message || e) };
    }
    processed++;

    if (result.outcome === 'FETCH_FAILED') failed++;
    if (result.outcome === 'REJECTED_WEAK') rejected++;
    let autoPublishNote: string | null = null;
    if (result.outcome === 'CANDIDATE_CREATED') {
      created++;
      products += (result as any).productsFound || 0;
      const pub = await autoPublishIfEligible(env, (result as any).candidateId);
      autoPublishNote = pub.attempted ? (pub.published ? 'auto_published' : `auto_publish_failed:${pub.reason}`) : `not_eligible:${pub.reason}`;
    }

    await env.DB.prepare(
      `INSERT INTO supply_sprint_scans (id, sprint_run_id, source_domain, idempotency_key, http_status, classification, outcome, resulted_candidate_id, missing_fields_json, products_found, error)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      crypto.randomUUID(), run.id, domain, idemKey,
      (result as any).httpStatus ?? null, (result as any).classification ?? null, result.outcome,
      (result as any).candidateId ?? null,
      (result as any).missingFields ? JSON.stringify((result as any).missingFields) : null,
      (result as any).productsFound ?? 0,
      (result as any).error ?? ((result as any).reason ?? autoPublishNote ?? null)
    ).run();
  }

  const nextOffset = run.next_batch_offset + batch.length;
  const isDone = nextOffset >= domains.length;
  await env.DB.prepare(
    `UPDATE supply_sprint_runs SET
       next_batch_offset=?, sources_processed=?, sources_failed=?, candidates_created=?,
       candidates_rejected_weak=?, product_candidates_created=?,
       status=?, completed_at=?
     WHERE id=?`
  ).bind(
    nextOffset, processed, failed, created, rejected, products,
    isDone ? 'COMPLETED' : 'RUNNING', isDone ? new Date().toISOString() : null,
    run.id
  ).run();

  return { ranBatch: true, runId: run.id };
}

const MAX_DEALS_PER_TICK = 3;

// Class B orchestration (P1.5A): decides WHEN to re-check a deal candidate, never WHETHER it may
// publish - that decision is entirely inside autoPublishDealIfEligible() (src/deals.ts), which
// re-runs evaluateDealAutoPublishGates() fresh on every call regardless of what this loop
// believes. Deliberately NOT placed inside src/deal-agent.ts, which is AI-facing and must never
// gain a path to review_status='PUBLISHED' - this orchestration lives here instead, alongside the
// Class A auto-publish orchestration, both Cron-triggered only. Bounded to
// MAX_DEALS_PER_TICK per tick, same discipline as every other scheduled loop in this app.
// Includes MATERIAL_CHANGE_DETECTED so a re-scanned, now-fully-qualifying deal can re-publish
// (Phase 4) - the gate re-checks the fingerprint against the CURRENT source on every call, so a
// stale approval is never trusted.
export async function runClassBAutoPublishPass(env: Bindings): Promise<{ checked: number; published: number; results: any[] }> {
  const candidates = await env.DB.prepare(
    `SELECT id FROM deal_offer_candidates
     WHERE review_status IN ('NEEDS_HUMAN_REVIEW','DISCOVERED','SOURCE_APPROVED','EVIDENCE_EXTRACTED','MATERIAL_CHANGE_DETECTED')
     ORDER BY created_at ASC LIMIT ?`
  ).bind(MAX_DEALS_PER_TICK).all<any>();

  let published = 0;
  const results: any[] = [];
  for (const row of candidates.results || []) {
    const result = await autoPublishDealIfEligible(env, row.id);
    if (result.ok) published++;
    results.push({ candidateId: row.id, ...result });
  }
  return { checked: (candidates.results || []).length, published, results };
}

// Freshness Agent (Phase 4/6): rechecks the single stalest AI-discovered directory listing per
// Cron tick (oldest last_public_check_at first) - deliberately one at a time, matching the same
// bounded-per-tick discipline as everything else scheduled in this app. A listing whose source no
// longer resolves is not silently kept live forever; commercial_status is turned back to INACTIVE
// (private) rather than deleted, preserving history exactly like every other withdrawal path in
// this app.
export async function runFreshnessCheck(env: Bindings): Promise<{ checked: boolean; operatorId?: string; outcome?: string }> {
  const stale = await env.DB.prepare(
    `SELECT id, website_url FROM operators WHERE last_public_check_at IS NOT NULL ORDER BY last_public_check_at ASC LIMIT 1`
  ).first<any>();
  if (!stale || !stale.website_url) return { checked: false };

  const result = await safeFetchSource(stale.website_url);
  if (result.ok) {
    await env.DB.prepare(`UPDATE operators SET last_public_check_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(stale.id).run();
    return { checked: true, operatorId: stale.id, outcome: 'REFRESHED' };
  }

  // Persistent unreachable source: withdraw from public eligibility (INACTIVE), never delete the
  // row or its evidence. A future successful recheck can re-activate it the same way the initial
  // publish did (via hasContact / a fresh sprint run), so this is a reversible pause, not a ban.
  if (['SOURCE_UNREACHABLE', 'DNS_FAILURE'].includes(result.classification)) {
    await env.DB.prepare(`UPDATE operators SET commercial_status='INACTIVE', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(stale.id).run();
    return { checked: true, operatorId: stale.id, outcome: 'WITHDRAWN_SOURCE_UNREACHABLE' };
  }
  return { checked: true, operatorId: stale.id, outcome: `NO_ACTION_${result.classification}` };
}
