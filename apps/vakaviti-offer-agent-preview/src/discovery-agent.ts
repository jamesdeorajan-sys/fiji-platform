// DiscoveryAgent - real implementations of the six discovery-channel interfaces from Phase A-R's
// discovery-providers.ts (reused unchanged), plus the tick logic that decides which approved
// source families are due for a scan and enqueues their candidate URLs for FETCH/EXTRACT.
import type { Env } from './env';
import { safeFetchSource } from './deal-agent';
import { isPathAuthorized, type SourceFamily } from './source-family-model';
import {
  sanitizeDiscoveredCandidate, type SearchDiscoveryProvider, type SitemapDiscoveryProvider,
  type CategoryPageDiscoveryProvider, type FeedDiscoveryProvider, type ExistingSourceDiscoveryProvider,
  type HumanSubmissionDiscoveryProvider, type DiscoveredCandidateUrl,
} from './discovery-providers';

function extractLinksFromHtml(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html))) {
    try {
      const abs = new URL(m[1], baseUrl);
      if (abs.protocol === 'https:') links.add(abs.toString());
    } catch { /* ignore malformed href */ }
  }
  return [...links];
}

export function makeCategoryPageDiscoveryProvider(): CategoryPageDiscoveryProvider {
  return {
    name: 'category-page',
    async discover(input: { categoryPageUrl: string }): Promise<DiscoveredCandidateUrl[]> {
      const result = await safeFetchSource(input.categoryPageUrl);
      if (!result.ok || !result.body) return [];
      return extractLinksFromHtml(result.body, input.categoryPageUrl)
        .map(url => sanitizeDiscoveredCandidate({ url, discoveredVia: 'category-page' }));
    },
  };
}

export function makeSitemapDiscoveryProvider(): SitemapDiscoveryProvider {
  return {
    name: 'sitemap',
    async discover(input: { sitemapUrl: string }): Promise<DiscoveredCandidateUrl[]> {
      const result = await safeFetchSource(input.sitemapUrl);
      if (!result.ok || !result.body) return [];
      const locRe = /<loc>\s*([^<]+)\s*<\/loc>/gi;
      const urls: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = locRe.exec(result.body))) urls.push(m[1].trim());
      return urls.map(url => sanitizeDiscoveredCandidate({ url, discoveredVia: 'sitemap' }));
    },
  };
}

export function makeFeedDiscoveryProvider(): FeedDiscoveryProvider {
  return {
    name: 'feed',
    async discover(input: { feedUrl: string }): Promise<DiscoveredCandidateUrl[]> {
      const result = await safeFetchSource(input.feedUrl);
      if (!result.ok || !result.body) return [];
      const linkRe = /<link>\s*([^<]+)\s*<\/link>/gi;
      const urls: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(result.body))) urls.push(m[1].trim());
      return urls.map(url => sanitizeDiscoveredCandidate({ url, discoveredVia: 'feed' }));
    },
  };
}

export function makeExistingSourceDiscoveryProvider(env: Env): ExistingSourceDiscoveryProvider {
  return {
    name: 'existing-source',
    async discover(input: { sourceFamilyId: string }): Promise<DiscoveredCandidateUrl[]> {
      const family = await env.DB.prepare(`SELECT approved_domain FROM offer_source_families WHERE id=?`).bind(input.sourceFamilyId).first<any>();
      if (!family) return [];
      const homepage = `https://${family.approved_domain}/`;
      const result = await safeFetchSource(homepage);
      if (!result.ok || !result.body) return [];
      return extractLinksFromHtml(result.body, homepage)
        .filter(u => { try { return new URL(u).hostname.replace(/^www\./, '') === family.approved_domain.replace(/^www\./, ''); } catch { return false; } })
        .map(url => sanitizeDiscoveredCandidate({ url, discoveredVia: 'existing-source' }));
    },
  };
}

// No credential is configured for this MVP (Brave Search API recommended separately, per the
// directive's "do not create or expose credentials" instruction) - this provider is real and
// wired, but returns [] until a key is explicitly added later, rather than silently failing or
// being omitted from the interface set.
export function makeSearchDiscoveryProvider(env: { BRAVE_SEARCH_API_KEY?: string }): SearchDiscoveryProvider {
  return {
    name: 'search',
    async discover(input: { query: string }): Promise<DiscoveredCandidateUrl[]> {
      if (!env.BRAVE_SEARCH_API_KEY) return [];
      const resp = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(input.query)}`, {
        headers: { 'X-Subscription-Token': env.BRAVE_SEARCH_API_KEY, Accept: 'application/json' },
      });
      if (!resp.ok) return [];
      const data: any = await resp.json();
      const results = data?.web?.results ?? [];
      return results.map((r: any) => sanitizeDiscoveredCandidate({ url: r.url, discoveredVia: 'search' }));
    },
  };
}

export function makeHumanSubmissionDiscoveryProvider(): HumanSubmissionDiscoveryProvider {
  return {
    name: 'human-submission',
    async discover(input: { submittedUrl: string; submittedByActorId: string }): Promise<DiscoveredCandidateUrl[]> {
      return [sanitizeDiscoveredCandidate({ url: input.submittedUrl, discoveredVia: `human:${input.submittedByActorId}` })];
    },
  };
}

function rowToSourceFamily(row: any): SourceFamily {
  return {
    id: row.id, legalProviderOrSellerIdentity: row.legal_provider_or_seller_identity, approvedDomain: row.approved_domain,
    allowedPathPatterns: JSON.parse(row.allowed_path_patterns_json), excludedPathPatterns: JSON.parse(row.excluded_path_patterns_json),
    authoritativeFields: JSON.parse(row.authoritative_fields_json), extractionProfile: row.extraction_profile,
    currencyExpectations: JSON.parse(row.currency_expectations_json), permittedPageTypes: JSON.parse(row.permitted_page_types_json),
    recheckScheduleHours: row.recheck_schedule_hours, rateLimitPerHour: row.rate_limit_per_hour,
    robotsAccessPolicy: row.robots_access_policy, approvalActorId: row.approval_actor_id, approvalActorType: 'HUMAN',
    approvalEvidenceUrl: row.approval_evidence, approvedAt: row.approved_at,
  };
}

/** Cron-tick side (lightweight): find APPROVED, due source families and enqueue ONE discovery
 * message per family to DISCOVERY_QUEUE - the actual fetch/link-extraction work happens in the
 * queue consumer (processDiscoveryForFamily below), not here, so a slow provider fetch never
 * blocks the scheduled handler itself. */
export async function enqueueDueFamiliesForDiscovery(env: Env): Promise<{ familiesEnqueued: string[] }> {
  const due = await env.DB.prepare(
    `SELECT id FROM offer_source_families WHERE source_approval_status='APPROVED' AND (next_scan_at IS NULL OR next_scan_at <= CURRENT_TIMESTAMP) LIMIT 5`
  ).all<any>();
  const familiesEnqueued: string[] = [];
  for (const row of due.results || []) {
    const idempotencyKey = `discovery:${row.id}:${new Date().toISOString().slice(0, 13)}`; // at most one discovery attempt per family per hour-slot
    await env.DISCOVERY_QUEUE.send({ sourceFamilyId: row.id, idempotencyKey });
    await env.DB.prepare(`UPDATE offer_source_families SET next_scan_at=datetime('now', '+' || ? || ' hours') WHERE id=?`)
      .bind(10 / 60, row.id).run(); // provisionally advance by the tick interval; processDiscoveryForFamily sets the real cadence on completion
    familiesEnqueued.push(row.id);
  }
  return { familiesEnqueued };
}

/** DISCOVERY_QUEUE consumer: does the real category-page + existing-source discovery for ONE
 * family, filters through isPathAuthorized(), persists new candidates, and enqueues each to
 * FETCH_EXTRACT_QUEUE with a deterministic idempotency key so duplicate queue delivery is a safe
 * no-op (the same key is INSERT-OR-IGNORE'd against agent_runs by offer-workflow.ts). */
export async function processDiscoveryForFamily(env: Env, sourceFamilyId: string, categoryPageUrlsByFamily: Record<string, string[]>): Promise<{ candidatesFound: number; enqueued: number }> {
  const row = await env.DB.prepare(`SELECT * FROM offer_source_families WHERE id=? AND source_approval_status='APPROVED'`).bind(sourceFamilyId).first<any>();
  if (!row) return { candidatesFound: 0, enqueued: 0 };
  const family = rowToSourceFamily(row);
  const categoryProvider = makeCategoryPageDiscoveryProvider();
  const existingProvider = makeExistingSourceDiscoveryProvider(env);
  const categoryUrls = categoryPageUrlsByFamily[family.id] || [];

  const raw: DiscoveredCandidateUrl[] = [];
  for (const categoryPageUrl of categoryUrls) raw.push(...await categoryProvider.discover({ categoryPageUrl }));
  raw.push(...await existingProvider.discover({ sourceFamilyId: family.id }));

  let candidatesFound = 0, enqueued = 0;
  for (const candidate of raw.slice(0, 20)) { // MAX_PAGES_PER_SOURCE_PER_RUN-adjacent cap, generous ceiling before per-family gate below
    let path: string;
    let hostname: string;
    try { const u = new URL(candidate.url); path = u.pathname; hostname = u.hostname.replace(/^www\./, ''); } catch { continue; }
    if (hostname !== family.approvedDomain.replace(/^www\./, '')) continue; // never authorize a path on a different domain
    if (!isPathAuthorized(family, path).authorized) continue;

    candidatesFound++;
    const insertResult = await env.DB.prepare(
      `INSERT OR IGNORE INTO discovered_candidates (id, url, discovered_via, authority, source_family_id, status) VALUES (?,?,?,?,?,'PENDING')`
    ).bind(crypto.randomUUID(), candidate.url, candidate.discoveredVia, candidate.authority, family.id).run();
    if ((insertResult.meta as any).changes === 0) continue; // already known - not a new candidate this tick

    const idempotencyKey = `fetch-extract:${family.id}:${candidate.url}`;
    await env.FETCH_EXTRACT_QUEUE.send({ sourceFamilyId: family.id, url: candidate.url, idempotencyKey });
    await env.DB.prepare(`UPDATE discovered_candidates SET status='QUEUED' WHERE url=?`).bind(candidate.url).run();
    enqueued++;
    if (enqueued >= 5) break; // MAX_PAGES_PER_SOURCE_PER_RUN
  }

  await env.DB.prepare(`UPDATE offer_source_families SET next_scan_at=datetime('now', '+' || ? || ' hours'), updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(family.recheckScheduleHours, family.id).run();
  return { candidatesFound, enqueued };
}
