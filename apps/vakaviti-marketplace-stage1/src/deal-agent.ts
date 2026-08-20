// Vakaviti Deal Intelligence - discovery-side agent code (OfferDiscovery, OfferEvidence,
// OfferFreshness modules). This file is the ONLY place AI/scheduled logic runs, and it is
// structurally incapable of granting publication authority: no function in this file ever
// writes review_status to VAKAVITI_HUMAN_REVIEWED, PROVIDER_APPROVED, PUBLICATION_APPROVED,
// PUBLISHED, or a human-issued QUARANTINED/REJECTED/WITHDRAWN - those five transitions exist
// only in src/deals.ts, behind requireAdmin, each writing its own deal_approvals audit row.
// This file's only write surface for review_status is the DISCOVERY_WRITABLE_STATES set below,
// enforced at every write site - see writeReviewStatus().
//
// The OfferApprovalCoordinator and DeterministicOfferPublisher modules live in src/deals.ts,
// not here, by design - keeping "AI can propose" and "only a human can approve" in two
// separate files makes the separation something a regression guard can verify structurally,
// not just something documented in a comment.
//
// P1.2 addition: a low-information scan must never reach the human review queue just because
// its content-fingerprint changed. src/deal-quality.ts holds the deterministic (non-AI-judged)
// quality gate, page classifier, URL canonicalizer, and deal-identity/dedup logic used below -
// it makes no D1 call and no AI.run() call, so its output is fully inspectable and testable in
// isolation from the discovery loop that calls it.
import {
  canonicalizeUrl, classifyPage, computeDealIdentity, diffMaterialFacts,
  evaluateQualityGates, type ExtractedFields,
} from './deal-quality';

type Bindings = { DB: D1Database; AI: Ai; ENVIRONMENT: string; ADMIN_TOKEN?: string };

const DISCOVERY_WRITABLE_STATES = new Set([
  'DISCOVERED', 'SOURCE_REVIEW_REQUIRED', 'EVIDENCE_EXTRACTED', 'NEEDS_HUMAN_REVIEW',
  'MATERIAL_CHANGE_DETECTED', 'EXPIRED'
]);

const writeReviewStatus = (target: string): string => {
  if (!DISCOVERY_WRITABLE_STATES.has(target)) {
    throw new Error(`discovery code attempted to write disallowed review_status '${target}' - only a human-actioned endpoint in deals.ts may set this value`);
  }
  return target;
};

// --- SSRF-safe fetch -------------------------------------------------------------------------
//
// Cloudflare Workers' own network layer already refuses to let a Worker's fetch() reach
// RFC1918/loopback/link-local address space or the platform's internal network - that
// protection exists below the application regardless of what this code does. The checks here
// are the application-level layer on top: scheme, credentials, known-bad hostnames/literals,
// redirect-target re-validation, timeout, content-type allowlist, and a byte cap enforced by
// streaming (not just trusting Content-Length, which a hostile server could lie about).
// Genuine DNS-rebinding protection (resolving a hostname and checking the IP before connecting)
// is not achievable in this runtime - there is no raw DNS/socket API exposed to Workers - and
// this limitation is reported honestly rather than silently claimed as covered.

const BLOCKED_HOSTNAMES = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]',
  '169.254.169.254', // cloud metadata endpoint (AWS/GCP/Azure IMDS)
  'metadata.google.internal',
]);
const PRIVATE_IPV4_PATTERNS = [
  /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./, /^127\./
];
const isBlockedHost = (hostname: string): boolean => {
  const h = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (PRIVATE_IPV4_PATTERNS.some(p => p.test(h))) return true;
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true; // ULA/link-local IPv6
  return false;
};

export type FetchClassification =
  | 'PROVIDER_RESPONSE' | 'DNS_FAILURE' | 'TLS_FAILURE' | 'TIMEOUT' | 'CLOUDFLARE_EGRESS_FAILURE'
  | 'PROXY_FAILURE' | 'ACCESS_DENIED' | 'ROBOTS_RESTRICTED' | 'UNSUPPORTED_CONTENT' | 'SOURCE_UNREACHABLE';

export interface SafeFetchResult {
  ok: boolean;
  status?: number;
  body?: string;
  error?: string;
  classification: FetchClassification;
}

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 12000;
const MAX_BODY_BYTES = 2_000_000;

export async function safeFetchSource(url: string): Promise<SafeFetchResult> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, error: 'invalid-url', classification: 'ACCESS_DENIED' }; }
  if (parsed.protocol !== 'https:') return { ok: false, error: 'non-https-scheme', classification: 'ACCESS_DENIED' };
  if (parsed.username || parsed.password) return { ok: false, error: 'credentials-in-url', classification: 'ACCESS_DENIED' };
  if (isBlockedHost(parsed.hostname)) return { ok: false, error: 'blocked-hostname', classification: 'ACCESS_DENIED' };

  let currentUrl = parsed.toString();
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'VakavitiDealIntelligenceBot/1.0 (+https://vakaviti-marketplace-stage1.helpronline.workers.dev/about; preview pilot, human-reviewed before any publication)' }
      });
    } catch (e: any) {
      clearTimeout(timer);
      if (e?.name === 'AbortError') return { ok: false, error: 'timeout', classification: 'TIMEOUT' };
      return { ok: false, error: String(e?.message || e), classification: 'DNS_FAILURE' };
    }
    clearTimeout(timer);

    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const loc = resp.headers.get('location');
      if (!loc) return { ok: false, error: 'redirect-missing-location', classification: 'ACCESS_DENIED' };
      let next: URL;
      try { next = new URL(loc, currentUrl); } catch { return { ok: false, error: 'redirect-invalid-location', classification: 'ACCESS_DENIED' }; }
      if (next.protocol !== 'https:') return { ok: false, error: 'redirect-to-non-https', classification: 'ACCESS_DENIED' };
      if (isBlockedHost(next.hostname)) return { ok: false, error: 'redirect-to-blocked-host', classification: 'ACCESS_DENIED' };
      if (redirects === MAX_REDIRECTS) return { ok: false, error: 'too-many-redirects', classification: 'ACCESS_DENIED' };
      currentUrl = next.toString();
      continue;
    }

    if (resp.status === 404 || resp.status === 410) {
      return { ok: false, status: resp.status, classification: 'SOURCE_UNREACHABLE', error: `http-${resp.status}` };
    }
    // Cloudflare's own edge issues these specific 52x/530 codes when IT cannot reach the
    // origin - they are not the provider's own server responding, and must not be classified
    // (or logged) as if the provider rejected Vakaviti. Found live during Phase 6 controlled
    // testing: a genuinely nonexistent domain returned 530 (Cloudflare "origin DNS error"),
    // which the previous blanket ">=500 => PROVIDER_RESPONSE" rule mislabeled.
    if (resp.status === 530) return { ok: false, status: resp.status, classification: 'DNS_FAILURE', error: 'cloudflare-origin-dns-error' };
    if (resp.status === 525 || resp.status === 526) return { ok: false, status: resp.status, classification: 'TLS_FAILURE', error: `cloudflare-edge-${resp.status}` };
    if (resp.status === 522 || resp.status === 524) return { ok: false, status: resp.status, classification: 'TIMEOUT', error: `cloudflare-edge-${resp.status}` };
    if (resp.status === 521 || resp.status === 523) return { ok: false, status: resp.status, classification: 'SOURCE_UNREACHABLE', error: `cloudflare-edge-${resp.status}` };
    if (resp.status >= 500) return { ok: false, status: resp.status, classification: 'PROVIDER_RESPONSE', error: 'server-error' };
    if (resp.status < 200 || resp.status >= 300) return { ok: false, status: resp.status, classification: 'ACCESS_DENIED', error: `http-${resp.status}` };

    const contentType = resp.headers.get('content-type') || '';
    if (!/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
      return { ok: false, status: resp.status, classification: 'UNSUPPORTED_CONTENT', error: `content-type: ${contentType}` };
    }

    const reader = resp.body?.getReader();
    if (!reader) return { ok: false, status: resp.status, classification: 'UNSUPPORTED_CONTENT', error: 'no-body' };
    let received = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, status: resp.status, classification: 'UNSUPPORTED_CONTENT', error: 'response-too-large' };
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
    const body = new TextDecoder().decode(merged);
    return { ok: true, status: resp.status, body, classification: 'PROVIDER_RESPONSE' };
  }
  return { ok: false, error: 'too-many-redirects', classification: 'ACCESS_DENIED' };
}

export const fingerprint = async (text: string): Promise<string> => {
  const data = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
};

// --- OfferEvidence: AI extraction, strict schema validation, never fabricates ------------------
//
// Reuses the extractJsonPayload discipline from Pilot 4 (src/products.ts / src/ai.ts): the
// model is asked for JSON only, output is stripped of preamble/fences, and any field the model
// doesn't clearly support is left null/omitted rather than guessed. AI output here can only
// ever land in EVIDENCE_EXTRACTED-stage columns - it has no path to any approval column.

const EXTRACTION_FIELDS = [
  'proposed_offer_name', 'factual_summary', 'category', 'fiji_location', 'advertised_price',
  'reference_price', 'currency', 'price_basis', 'explicit_discount', 'promo_code',
  'booking_deadline', 'travel_from', 'travel_until', 'offer_expires_at', 'blackout_dates',
  'minimum_stay', 'minimum_group_size', 'eligibility', 'inclusions', 'exclusions',
  'cancellation_terms', 'booking_route', 'seller_or_marketer'
];

function extractJsonPayload(raw: string): any | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try { return JSON.parse(s); } catch {}
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch {}
  }
  return null;
}

export interface ExtractionResult {
  fields: Record<string, string | null>;
  missingFields: string[];
  confidence: number;
  raw: string;
}

export async function extractOfferFacts(env: Bindings, pageText: string, sourceUrl: string): Promise<ExtractionResult | null> {
  const truncated = pageText.slice(0, 12000);
  const prompt = `You are extracting FACTUAL travel-offer fields from a Fiji tourism provider's own web page. Only report a fact if it is explicitly stated in the text below. If a field is not clearly present, use null - never guess, infer, or invent a value (especially prices, discounts, and dates). Return ONLY a JSON object with exactly these keys: ${EXTRACTION_FIELDS.join(', ')}.

Source URL: ${sourceUrl}
Page text:
${truncated}`;

  let aiResp: any;
  try {
    aiResp = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fp8', {
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
  } catch {
    return null; // AI call failure - no candidate is fabricated; caller marks NEEDS_HUMAN_REVIEW with missing extraction
  }
  const text = typeof aiResp === 'string' ? aiResp : (aiResp?.response ?? JSON.stringify(aiResp));
  const parsed = extractJsonPayload(text);
  if (!parsed || typeof parsed !== 'object') return null;

  const fields: Record<string, string | null> = {};
  const missingFields: string[] = [];
  for (const key of EXTRACTION_FIELDS) {
    const v = parsed[key];
    if (v === undefined || v === null || v === '' || String(v).toLowerCase() === 'null') {
      fields[key] = null;
      missingFields.push(key);
    } else {
      fields[key] = String(v);
    }
  }
  const confidence = Math.max(0, 1 - missingFields.length / EXTRACTION_FIELDS.length);
  return { fields, missingFields, confidence, raw: text };
}

// --- OfferFreshness: deterministic date-comparison only, never AI judgment --------------------

export function computeExpiryStatus(offerExpiresAt: string | null): 'EXPIRY_UNKNOWN' | 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' {
  if (!offerExpiresAt) return 'EXPIRY_UNKNOWN';
  const exp = Date.parse(offerExpiresAt);
  if (Number.isNaN(exp)) return 'EXPIRY_UNKNOWN';
  const now = Date.now();
  if (exp < now) return 'EXPIRED';
  if (exp - now < 7 * 24 * 3600 * 1000) return 'EXPIRING_SOON';
  return 'ACTIVE';
}

// --- P1.2 quality-gate integration helpers ------------------------------------------------------
//
// recordScanOutcome() always UPDATEs the deal_source_scans row already INSERTed for this scan
// (keyed by its idempotency_key, unique) - complete scan evidence is preserved on every single
// scan regardless of outcome, exactly as the CEO directive requires ("preserve complete scan
// evidence while allowing only sufficiently complete, offer-like extractions to enter the human
// review queue"). resulted_candidate_id links to whichever candidate row this scan is about (the
// one it created, or the existing one it attached a change event to) - null for a rejection or a
// cosmetic no-op with no prior candidate to point to.
const EMPTY_FIELDS: ExtractedFields = {
  proposed_offer_name: null, factual_summary: null, category: null, fiji_location: null,
  advertised_price: null, reference_price: null, currency: null, price_basis: null,
  explicit_discount: null, promo_code: null, booking_deadline: null, travel_from: null,
  travel_until: null, offer_expires_at: null, blackout_dates: null, minimum_stay: null,
  minimum_group_size: null, eligibility: null, inclusions: null, exclusions: null,
  cancellation_terms: null, booking_route: null, seller_or_marketer: null,
};

async function recordScanOutcome(
  env: Bindings,
  scanIdemKey: string,
  outcome: 'REJECTED' | 'NEW_CANDIDATE' | 'COSMETIC_DRIFT_NO_OP' | 'MATERIAL_CHANGE' | 'EXACT_DUPLICATE_SKIPPED',
  canonicalUrl: string | null,
  resultedCandidateId: string | null,
  quality: { pageClassification: string; passedGates: string[]; failedGates: string[]; missingFields: string[]; contradictionFlags: string[]; confidence: number; decision: string; rejectionReason: string | null } | null,
  dealIdentityHash: string | null = null
): Promise<void> {
  await env.DB.prepare(
    `UPDATE deal_source_scans SET
       canonical_url=?, deal_identity_hash=?, page_classification=?, quality_decision=?, quality_gates_passed=?,
       quality_gates_failed=?, quality_missing_fields=?, quality_contradiction_flags=?,
       quality_confidence=?, quality_rejection_reason=?, resulted_candidate_id=?, resulted_outcome=?
     WHERE idempotency_key=?`
  ).bind(
    canonicalUrl, dealIdentityHash, quality?.pageClassification ?? null, quality?.decision ?? null,
    quality ? JSON.stringify(quality.passedGates) : null, quality ? JSON.stringify(quality.failedGates) : null,
    quality ? JSON.stringify(quality.missingFields) : null, quality ? JSON.stringify(quality.contradictionFlags) : null,
    quality?.confidence ?? null, quality?.rejectionReason ?? null,
    resultedCandidateId, outcome, scanIdemKey
  ).run();
}

async function insertCandidate(
  env: Bindings, candidateId: string, source: any, fp: string | null,
  extraction: { fields: Record<string, string | null>; missingFields: string[]; confidence: number }, expiryStatus: string
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO deal_offer_candidates (
      id, source_id, source_url, source_checked_at, source_fingerprint,
      proposed_offer_name, factual_summary, category, fiji_location, advertised_price,
      reference_price, currency, price_basis, explicit_discount, promo_code,
      booking_deadline, travel_from, travel_until, offer_expires_at, expiry_status,
      blackout_dates, minimum_stay, minimum_group_size, eligibility, inclusions, exclusions,
      cancellation_terms, booking_route, seller_or_marketer,
      evidence_state, extraction_confidence, missing_fields, review_status, created_by
    ) VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?, ?,?,?, ?,?,?,?,?)`
  ).bind(
    candidateId, source.id, source.source_url, new Date().toISOString(), fp,
    extraction.fields.proposed_offer_name ?? null, extraction.fields.factual_summary ?? null,
    extraction.fields.category ?? null, extraction.fields.fiji_location ?? null, extraction.fields.advertised_price ?? null,
    extraction.fields.reference_price ?? null, extraction.fields.currency ?? null, extraction.fields.price_basis ?? null,
    extraction.fields.explicit_discount ?? null, extraction.fields.promo_code ?? null,
    extraction.fields.booking_deadline ?? null, extraction.fields.travel_from ?? null, extraction.fields.travel_until ?? null,
    extraction.fields.offer_expires_at ?? null, expiryStatus,
    extraction.fields.blackout_dates ?? null, extraction.fields.minimum_stay ?? null, extraction.fields.minimum_group_size ?? null,
    extraction.fields.eligibility ?? null, extraction.fields.inclusions ?? null, extraction.fields.exclusions ?? null,
    extraction.fields.cancellation_terms ?? null, extraction.fields.booking_route ?? null, extraction.fields.seller_or_marketer ?? null,
    'CANDIDATE', extraction.confidence,
    JSON.stringify(extraction.missingFields),
    writeReviewStatus('NEEDS_HUMAN_REVIEW'), 'AI_AGENT'
  ).run();
}

// Reconstructs the ExtractedFields shape from an existing deal_offer_candidates row, so its
// deal-identity can be recomputed the same way a fresh extraction's identity is - this is what
// lets a new scan be compared against "the deal as it was last recorded" without a redundant
// stored hash column on deal_offer_candidates itself (zero migration surface on that table).
function candidateRowToFields(row: any): ExtractedFields {
  return {
    proposed_offer_name: row.proposed_offer_name ?? null, factual_summary: row.factual_summary ?? null,
    category: row.category ?? null, fiji_location: row.fiji_location ?? null,
    advertised_price: row.advertised_price ?? null, reference_price: row.reference_price ?? null,
    currency: row.currency ?? null, price_basis: row.price_basis ?? null,
    explicit_discount: row.explicit_discount ?? null, promo_code: row.promo_code ?? null,
    booking_deadline: row.booking_deadline ?? null, travel_from: row.travel_from ?? null,
    travel_until: row.travel_until ?? null, offer_expires_at: row.offer_expires_at ?? null,
    blackout_dates: row.blackout_dates ?? null, minimum_stay: row.minimum_stay ?? null,
    minimum_group_size: row.minimum_group_size ?? null, eligibility: row.eligibility ?? null,
    inclusions: row.inclusions ?? null, exclusions: row.exclusions ?? null,
    cancellation_terms: row.cancellation_terms ?? null, booking_route: row.booking_route ?? null,
    seller_or_marketer: row.seller_or_marketer ?? null,
  };
}

// --- Stuck-run watchdog (Phase 4) --------------------------------------------------------------
//
// Called at the start of every invocation, scheduled or manual. Idempotent: only ever touches
// rows still RUNNING past the threshold, so re-running it is a no-op for anything already
// recovered. Never touches deal_offer_candidates - an abandoned run says nothing about whether
// an offer was withdrawn, and a published offer is never quarantined just because the Worker
// that happened to be scanning something else was terminated.
//
// Uses status='FAILED' (not a new 'TIMED_OUT' enum value) deliberately: a disposable-database
// rehearsal of the CHECK-constraint migration this would have needed found that D1 blocks
// DROP TABLE on a table referenced by another table's foreign key even with
// PRAGMA foreign_keys=OFF in the same request (unlike plain SQLite, where DDL isn't
// FK-checked) - deal_source_scans.scan_run_id references this table. Rather than compound risk
// by also rebuilding the child table, the specific reason (TIMED_OUT vs ABANDONED) is recorded
// in summary_json.failure_reason instead, which achieves the same "no false RUNNING record,
// reason is inspectable" outcome without a schema change. See the pilot report for the full
// rehearsal finding.
const MAX_RUNNING_MINUTES = 10;

async function recoverStuckRuns(env: Bindings): Promise<void> {
  const stuck = await env.DB.prepare(
    `SELECT id FROM deal_scan_runs WHERE status='RUNNING' AND started_at < datetime('now', '-' || ? || ' minutes')`
  ).bind(MAX_RUNNING_MINUTES).all<any>();
  for (const row of stuck.results || []) {
    const lastStep = await env.DB.prepare(`SELECT COUNT(*) c FROM deal_source_scans WHERE scan_run_id=?`).bind(row.id).first<any>();
    await env.DB.prepare(
      `UPDATE deal_scan_runs SET status='FAILED', completed_at=CURRENT_TIMESTAMP, summary_json=? WHERE id=? AND status='RUNNING'`
    ).bind(JSON.stringify({ failure_reason: 'TIMED_OUT', reason: `Exceeded ${MAX_RUNNING_MINUTES}-minute running threshold`, last_completed_step_count: lastStep?.c ?? 0 }), row.id).run();
  }
}

// --- OfferDiscovery + orchestration: the scheduled entrypoint (Phase 2 bounded-rotating-scan) --
//
// Processes at most MAX_SOURCES_PER_ACTIVATION sources per invocation - never the full approved
// set. Selection is deterministic (next_scan_at ascending, id as tiebreaker) so every source
// gets fair rotation across activations, and next_scan_at is only advanced through an auditable
// scan outcome (success or a classified failure), never speculatively. One failed source cannot
// block another - each is wrapped independently and next_scan_at still advances on failure so a
// persistently-broken source doesn't hog every future activation's two slots forever (it also
// gets backoff_until on top, which is checked separately and is shorter-lived).
//
// Idempotency: the scheduled run is keyed by UTC date+hour (so up to one automatic attempt per
// hour - the actual cadence is set by the Cron expression itself, see wrangler.toml), and a
// manual run gets its own timestamp+uuid key, in a fully separate namespace - a manual test can
// never be blocked by, or consume, an automatic activation's slot. Only one run may be RUNNING
// at a time (checked after the watchdog clears any genuinely stuck rows) - this is the
// no-overlap guarantee, simpler and sufficient at this pilot's scale than per-source locking.
const MAX_SOURCES_PER_ACTIVATION = 2;

export async function runDailyDiscovery(
  env: Bindings,
  runType: 'DAILY_DISCOVERY' | 'MANUAL_TEST' = 'DAILY_DISCOVERY',
  opts: { consumeScheduledSlot?: boolean } = {}
): Promise<{ runId: string; sourcesScanned: number; sourcesFailed: number; candidatesCreated: number; skipped: boolean; skipReason?: string }> {
  await recoverStuckRuns(env);

  const stillRunning = await env.DB.prepare(`SELECT id FROM deal_scan_runs WHERE status='RUNNING' LIMIT 1`).first<any>();
  if (stillRunning) {
    return { runId: '', sourcesScanned: 0, sourcesFailed: 0, candidatesCreated: 0, skipped: true, skipReason: 'another_run_in_progress' };
  }

  const now = new Date();
  const runIdemKey = runType === 'DAILY_DISCOVERY'
    ? `daily-discovery-${now.toISOString().slice(0, 13)}` // date+hour: at most one automatic attempt per hour-slot
    : `manual-test-${now.toISOString()}-${crypto.randomUUID()}`;
  const runId = crypto.randomUUID();
  // A manual test run only advances next_scan_at (consuming the source's scheduled slot) if the
  // caller explicitly asks for that - otherwise a human spot-checking a source doesn't disturb
  // the automatic rotation's timing.
  const shouldAdvanceSchedule = runType === 'DAILY_DISCOVERY' || opts.consumeScheduledSlot === true;

  const insertRun = await env.DB.prepare(
    `INSERT OR IGNORE INTO deal_scan_runs (id, run_type, idempotency_key, status) VALUES (?, ?, ?, 'RUNNING')`
  ).bind(runId, runType, runIdemKey).run();
  if ((insertRun.meta as any).changes === 0) {
    return { runId: '', sourcesScanned: 0, sourcesFailed: 0, candidatesCreated: 0, skipped: true, skipReason: 'idempotency_key_already_used' };
  }

  const sources = await env.DB.prepare(
    `SELECT * FROM deal_sources
     WHERE source_approval_status='APPROVED'
       AND (backoff_until IS NULL OR backoff_until < CURRENT_TIMESTAMP)
       AND (next_scan_at IS NULL OR next_scan_at <= CURRENT_TIMESTAMP)
     ORDER BY next_scan_at ASC, id ASC
     LIMIT ?`
  ).bind(MAX_SOURCES_PER_ACTIVATION).all<any>();

  let scanned = 0, failed = 0, created = 0;
  for (const source of sources.results || []) {
    const scanIdemKey = `${runIdemKey}-${source.id}`;
    try {
      const result = await safeFetchSource(source.source_url);
      const fp = result.body ? await fingerprint(result.body) : null;
      await env.DB.prepare(
        `INSERT OR IGNORE INTO deal_source_scans (id, scan_run_id, source_id, idempotency_key, http_status, classification, content_fingerprint, error) VALUES (?,?,?,?,?,?,?,?)`
      ).bind(crypto.randomUUID(), runId, source.id, scanIdemKey, result.status ?? null, result.classification, fp, result.error ?? null).run();

      scanned++;
      const nextScanClause = shouldAdvanceSchedule ? `, next_scan_at=datetime('now', '+24 hours')` : '';

      if (!result.ok) {
        failed++;
        const newFailureCount = (source.failure_count || 0) + 1;
        const backoffMinutes = Math.min(24 * 60, Math.pow(2, newFailureCount) * 5);
        const newStatus = result.classification === 'SOURCE_UNREACHABLE' && newFailureCount >= 3 ? 'SOURCE_UNREACHABLE' : source.source_approval_status;
        await env.DB.prepare(
          `UPDATE deal_sources SET failure_count=?, backoff_until=datetime('now', '+' || ? || ' minutes'), last_http_status=?, last_scan_at=CURRENT_TIMESTAMP, source_approval_status=?, updated_at=CURRENT_TIMESTAMP${nextScanClause} WHERE id=?`
        ).bind(newFailureCount, backoffMinutes, result.status ?? null, newStatus, source.id).run();
        continue; // one failed source never blocks the next
      }

      // Success: reset failure count, update fingerprint/scan time, advance rotation.
      const fingerprintChanged = fp && fp !== source.content_fingerprint;
      await env.DB.prepare(
        `UPDATE deal_sources SET failure_count=0, backoff_until=NULL, last_http_status=?, last_scan_at=CURRENT_TIMESTAMP, content_fingerprint=?, updated_at=CURRENT_TIMESTAMP${nextScanClause} WHERE id=?`
      ).bind(result.status, fp, source.id).run();

      if (!fingerprintChanged && source.content_fingerprint) {
        continue; // unchanged content - nothing new to extract this run
      }

      // Exact-duplicate guard: a retry (or two activations racing on stale state) must never
      // create a second candidate for a fingerprint already represented.
      const existingExact = await env.DB.prepare(`SELECT id FROM deal_offer_candidates WHERE source_id=? AND source_fingerprint=?`).bind(source.id, fp).first<any>();
      if (existingExact) {
        await recordScanOutcome(env, scanIdemKey, 'EXACT_DUPLICATE_SKIPPED', null, null, null);
        continue;
      }

      const extraction = await extractOfferFacts(env, result.body || '', source.source_url);
      const canonicalUrl = canonicalizeUrl(source.source_url);

      // P1.2 quality gate: extraction failing outright (AI call/parse failure) is treated the
      // same as a quality rejection - a page nothing could be read from is exactly the case that
      // must never reach the human review queue, per the CEO directive's weak-extraction rule.
      if (!extraction) {
        await recordScanOutcome(env, scanIdemKey, 'REJECTED', canonicalUrl, null, {
          pageClassification: classifyPage(canonicalUrl, EMPTY_FIELDS, result.body || ''),
          passedGates: [], failedGates: ['gate_10_schema_valid'], missingFields: EXTRACTION_FIELDS,
          contradictionFlags: [], confidence: 0, decision: 'QUALITY_REJECTED',
          rejectionReason: 'AI extraction failed or returned unparseable output - no fields to gate.',
        });
        continue;
      }

      const quality = evaluateQualityGates(canonicalUrl, extraction.fields as unknown as ExtractedFields, extraction.confidence, result.body || '');

      if (quality.decision === 'QUALITY_REJECTED') {
        await recordScanOutcome(env, scanIdemKey, 'REJECTED', canonicalUrl, null, quality);
        continue; // no candidate created, no existing candidate touched - complete scan evidence already recorded above
      }

      // Quality gates passed - now decide whether this is a first-time discovery, an unchanged/
      // cosmetically-drifted re-scan of an already-known deal (no-op), or a genuine material
      // change to an already-known deal (change event on the existing row, never a duplicate).
      const newIdentity = await computeDealIdentity(canonicalUrl, source.id, extraction.fields as unknown as ExtractedFields);
      const latestLive = await env.DB.prepare(
        `SELECT * FROM deal_offer_candidates WHERE source_id=? AND review_status NOT IN ('REJECTED','WITHDRAWN','DISPUTED','ARCHIVED') ORDER BY created_at DESC LIMIT 1`
      ).bind(source.id).first<any>();

      if (!latestLive) {
        // First-time discovery for this source.
        const candidateId = crypto.randomUUID();
        const expiryStatus = computeExpiryStatus(extraction.fields.offer_expires_at);
        await insertCandidate(env, candidateId, source, fp, extraction, expiryStatus);
        await recordScanOutcome(env, scanIdemKey, 'NEW_CANDIDATE', canonicalUrl, candidateId, quality, newIdentity);
        created++;
        continue;
      }

      const existingFields = candidateRowToFields(latestLive);
      const existingIdentity = await computeDealIdentity(canonicalizeUrl(latestLive.source_url), source.id, existingFields);

      if (existingIdentity === newIdentity) {
        // Cosmetic drift (or a literal re-scan of the same deal with a churned fingerprint) -
        // the deal itself hasn't changed, so no new row and no change event either.
        await recordScanOutcome(env, scanIdemKey, 'COSMETIC_DRIFT_NO_OP', canonicalUrl, latestLive.id, quality, newIdentity);
        continue;
      }

      // Material change to an already-known deal: one auditable change event per changed field,
      // the existing row's own factual columns are never overwritten (historical evidence is
      // preserved exactly as extracted at the time), only its review_status flips so it resurfaces
      // for human re-review.
      const diffs = diffMaterialFacts(existingFields, extraction.fields as unknown as ExtractedFields);
      for (const d of diffs) {
        await env.DB.prepare(
          `INSERT INTO deal_change_events (id, offer_candidate_id, event_type, old_value, new_value) VALUES (?,?,?,?,?)`
        ).bind(crypto.randomUUID(), latestLive.id, `${d.field.toUpperCase()}_CHANGED`, d.oldValue, d.newValue).run();
      }
      await env.DB.prepare(
        `UPDATE deal_offer_candidates SET review_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).bind(writeReviewStatus('MATERIAL_CHANGE_DETECTED'), latestLive.id).run();
      await recordScanOutcome(env, scanIdemKey, 'MATERIAL_CHANGE', canonicalUrl, latestLive.id, quality, newIdentity);
    } catch (e: any) {
      failed++;
      await env.DB.prepare(
        `INSERT OR IGNORE INTO deal_source_scans (id, scan_run_id, source_id, idempotency_key, classification, error) VALUES (?,?,?,?,?,?)`
      ).bind(crypto.randomUUID(), runId, source.id, scanIdemKey + '-error', 'ACCESS_DENIED', String(e?.message || e)).run();
    }
  }

  await env.DB.prepare(
    `UPDATE deal_scan_runs SET status=?, completed_at=CURRENT_TIMESTAMP, sources_scanned=?, sources_failed=?, candidates_created=?, summary_json=? WHERE id=?`
  ).bind(failed > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED', scanned, failed, created, JSON.stringify({ scanned, failed, created }), runId).run();

  return { runId, sourcesScanned: scanned, sourcesFailed: failed, candidatesCreated: created, skipped: false };
}
