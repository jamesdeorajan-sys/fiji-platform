// Phase A-R, item 5: discovery-channel interfaces (CEO directive 2026-08-29).
//
// A DiscoveryProvider's ONLY job is to propose candidate URLs to fetch. It never carries a fact
// (price, date, inclusion) forward - "search results, social posts and directories are discovery-
// only; publication facts must resolve to authoritative provider/seller sources." This is enforced
// structurally, not just documented: DiscoveredCandidateUrl has no field a fact could occupy, and
// sanitizeDiscoveredCandidate() strips anything a misbehaving provider implementation tries to add.

export type DiscoveryAuthority = 'DISCOVERY_ONLY';

export interface DiscoveredCandidateUrl {
  url: string;
  discoveredVia: string; // provider name, for audit trail only
  authority: DiscoveryAuthority; // always 'DISCOVERY_ONLY' - see sanitizeDiscoveredCandidate()
}

/**
 * Every DiscoveryProvider MUST route its raw output through this before returning it. It copies
 * exactly three fields and no others, and hard-codes authority - a provider implementation that
 * tries to smuggle a price/date/fact field through has it silently dropped, not merely ignored by
 * convention.
 */
export function sanitizeDiscoveredCandidate(raw: { url: unknown; discoveredVia?: unknown }): DiscoveredCandidateUrl {
  return {
    url: String(raw.url),
    discoveredVia: raw.discoveredVia !== undefined ? String(raw.discoveredVia) : 'unknown',
    authority: 'DISCOVERY_ONLY',
  };
}

export interface DiscoveryProvider<TInput = unknown> {
  readonly name: string;
  discover(input: TInput): Promise<DiscoveredCandidateUrl[]>;
}

// --- The six required channels --------------------------------------------------------------------
// Each is a distinct interface (not a type alias) so a Workflow can depend on exactly the discovery
// channel it needs via dependency injection, and a test can supply a trivial fake for just that one
// channel without implementing the other five.

export interface SearchDiscoveryProvider extends DiscoveryProvider<{ query: string }> {}

export interface SitemapDiscoveryProvider extends DiscoveryProvider<{ sitemapUrl: string }> {}

export interface CategoryPageDiscoveryProvider extends DiscoveryProvider<{ categoryPageUrl: string }> {}

export interface FeedDiscoveryProvider extends DiscoveryProvider<{ feedUrl: string }> {}

// Reuses an already-approved source family's own domain to find NEW pages under it (e.g. a fresh
// crawl of an approved provider's site for pages not yet known) - still discovery-only output;
// being from an already-approved family does not itself make a newly-found page's CONTENT
// authoritative, only eligible to be fetched and then judged like any other candidate.
export interface ExistingSourceDiscoveryProvider extends DiscoveryProvider<{ sourceFamilyId: string }> {}

// A human pasting a URL into a submission form - still routed through the same sanitize step and
// the same downstream Fetch/Extract/Eligibility pipeline as every other channel. Being human-
// submitted does not bypass any gate.
export interface HumanSubmissionDiscoveryProvider extends DiscoveryProvider<{ submittedUrl: string; submittedByActorId: string }> {}
