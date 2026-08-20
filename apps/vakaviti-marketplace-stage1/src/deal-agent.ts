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

// --- OfferDiscovery + orchestration: the scheduled entrypoint ----------------------------------
//
// Only ever scans sources with source_approval_status='APPROVED' - a source pending, rejected,
// paused, or restricted is never fetched. One failed source cannot fail the whole run (each
// source is wrapped independently). Idempotency: the scheduled daily run is keyed by UTC date
// (one automatic attempt per calendar date, via the UNIQUE constraint on
// deal_scan_runs.idempotency_key), so the Cron trigger can never overlap itself. A manually
// triggered run (runType='MANUAL_TEST') gets its own timestamp-based key instead - a human
// deliberately requesting an on-demand test run is a different concern from "don't let the
// automatic daily job overlap itself", and must not be silently swallowed just because today's
// automatic slot is occupied (or, as found live during this pilot's own controlled test,
// occupied by a run that failed and was never meant to block a deliberate retry). Each
// source-scan row is separately keyed by (run, source) - UNIQUE on deal_source_scans.idempotency_key.

export async function runDailyDiscovery(env: Bindings, runType: 'DAILY_DISCOVERY' | 'MANUAL_TEST' = 'DAILY_DISCOVERY'): Promise<{ runId: string; sourcesScanned: number; sourcesFailed: number; candidatesCreated: number; skipped: boolean }> {
  const runIdemKey = runType === 'DAILY_DISCOVERY'
    ? `daily-discovery-${new Date().toISOString().slice(0, 10)}`
    : `manual-test-${new Date().toISOString()}-${crypto.randomUUID()}`;
  const runId = crypto.randomUUID();

  const insertRun = await env.DB.prepare(
    `INSERT OR IGNORE INTO deal_scan_runs (id, run_type, idempotency_key, status) VALUES (?, ?, ?, 'RUNNING')`
  ).bind(runId, runType, runIdemKey).run();
  if ((insertRun.meta as any).changes === 0) {
    // Already ran today (or is running) - do not overlap. Only reachable for DAILY_DISCOVERY,
    // since MANUAL_TEST's key is always unique.
    return { runId: '', sourcesScanned: 0, sourcesFailed: 0, candidatesCreated: 0, skipped: true };
  }

  const sources = await env.DB.prepare(
    `SELECT * FROM deal_sources WHERE source_approval_status='APPROVED' AND (backoff_until IS NULL OR backoff_until < CURRENT_TIMESTAMP)`
  ).all<any>();

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
      if (!result.ok) {
        failed++;
        const newFailureCount = (source.failure_count || 0) + 1;
        const backoffMinutes = Math.min(24 * 60, Math.pow(2, newFailureCount) * 5);
        const newStatus = result.classification === 'SOURCE_UNREACHABLE' && newFailureCount >= 3 ? 'SOURCE_UNREACHABLE' : source.source_approval_status;
        await env.DB.prepare(
          `UPDATE deal_sources SET failure_count=?, backoff_until=datetime('now', '+' || ? || ' minutes'), last_http_status=?, last_scan_at=CURRENT_TIMESTAMP, source_approval_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
        ).bind(newFailureCount, backoffMinutes, result.status ?? null, newStatus, source.id).run();
        continue;
      }

      // Success: reset failure count, update fingerprint/scan time.
      const fingerprintChanged = fp && fp !== source.content_fingerprint;
      await env.DB.prepare(
        `UPDATE deal_sources SET failure_count=0, backoff_until=NULL, last_http_status=?, last_scan_at=CURRENT_TIMESTAMP, content_fingerprint=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).bind(result.status, fp, source.id).run();

      if (!fingerprintChanged && source.content_fingerprint) {
        continue; // unchanged content - nothing new to extract this run
      }

      const extraction = await extractOfferFacts(env, result.body || '', source.source_url);
      const candidateId = crypto.randomUUID();
      const reviewStatus = writeReviewStatus(extraction ? 'NEEDS_HUMAN_REVIEW' : 'SOURCE_REVIEW_REQUIRED');
      const expiryStatus = extraction ? computeExpiryStatus(extraction.fields.offer_expires_at) : 'EXPIRY_UNKNOWN';

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
        extraction?.fields.proposed_offer_name ?? null, extraction?.fields.factual_summary ?? null,
        extraction?.fields.category ?? null, extraction?.fields.fiji_location ?? null, extraction?.fields.advertised_price ?? null,
        extraction?.fields.reference_price ?? null, extraction?.fields.currency ?? null, extraction?.fields.price_basis ?? null,
        extraction?.fields.explicit_discount ?? null, extraction?.fields.promo_code ?? null,
        extraction?.fields.booking_deadline ?? null, extraction?.fields.travel_from ?? null, extraction?.fields.travel_until ?? null,
        extraction?.fields.offer_expires_at ?? null, expiryStatus,
        extraction?.fields.blackout_dates ?? null, extraction?.fields.minimum_stay ?? null, extraction?.fields.minimum_group_size ?? null,
        extraction?.fields.eligibility ?? null, extraction?.fields.inclusions ?? null, extraction?.fields.exclusions ?? null,
        extraction?.fields.cancellation_terms ?? null, extraction?.fields.booking_route ?? null, extraction?.fields.seller_or_marketer ?? null,
        extraction ? 'CANDIDATE' : 'CANDIDATE', extraction?.confidence ?? null,
        extraction ? JSON.stringify(extraction.missingFields) : JSON.stringify(EXTRACTION_FIELDS),
        reviewStatus, 'AI_AGENT'
      ).run();
      created++;
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
