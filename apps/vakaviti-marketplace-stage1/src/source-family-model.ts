// Phase A-R, item 4: source-family approval model - design only, no migration applied this phase.
//
// This is a TYPE-LEVEL schema proposal plus its deterministic authorization function. The actual
// `offer_sources`/`source_families` table (see docs/PHASE_A_R_BOUNDARY_MAP.md, section "Revised
// schema proposal") is not migrated in Phase A-R. What IS real and tested here is
// isPathAuthorized() - the exact rule that "domain approval alone must never authorize every URL
// on that domain."
//
// Reuses MaterialField (deal-exchange-model.ts) and PageClassification-shaped strings
// (deal-quality.ts's classifyPage() output) rather than inventing parallel enums.
import type { MaterialField } from './deal-exchange-model';

export type ExtractionProfile = 'STANDARD_HTML' | 'JS_RENDERED' | 'FEED_XML' | 'FEED_JSON';
export type RobotsAccessPolicy = 'ROBOTS_TXT_HONORED' | 'EXPLICIT_PERMISSION_ON_FILE';
export type PermittedPageType =
  | 'OFFER_PAGE' | 'MULTI_OFFER_PAGE' | 'PRODUCT_PAGE' | 'PROVIDER_HOME_PAGE' | 'BOOKING_ENGINE_PAGE';

export interface SourceFamily {
  id: string;
  legalProviderOrSellerIdentity: string;
  approvedDomain: string; // registrable domain only, e.g. "southseacruisesfiji.com" - never a scheme/path
  // Both pattern lists use the same minimal glob syntax: '*' matches any run of characters within
  // a path segment or across segments (simple substring-style wildcard, not full glob semantics).
  // An EMPTY allowedPathPatterns list authorizes NOTHING - approving a domain grants no implicit
  // "/*" - a family must explicitly list what it covers.
  allowedPathPatterns: string[];
  excludedPathPatterns: string[]; // checked FIRST and always wins over an overlapping allowed pattern
  authoritativeFields: MaterialField[];
  extractionProfile: ExtractionProfile;
  currencyExpectations: string[]; // ISO 4217 codes, e.g. ['FJD', 'USD']
  permittedPageTypes: PermittedPageType[];
  recheckScheduleHours: number;
  rateLimitPerHour: number;
  robotsAccessPolicy: RobotsAccessPolicy;
  approvalActorId: string;
  approvalActorType: 'HUMAN'; // structurally the only legal value - see authority-model.ts approveSource()
  approvalEvidenceUrl: string | null;
  approvedAt: string;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

/**
 * The one function that decides "is this exact path authorized under this source family."
 * Domain match is the caller's responsibility (compare the fetch URL's hostname to
 * approvedDomain before calling this) - this function is deliberately path-only, so a domain-level
 * mistake can never be papered over by a permissive path pattern.
 */
export function isPathAuthorized(family: SourceFamily, path: string): { authorized: boolean; reason: string } {
  for (const excluded of family.excludedPathPatterns) {
    if (globToRegExp(excluded).test(path)) {
      return { authorized: false, reason: `Path matches excluded pattern "${excluded}" - exclusions always win.` };
    }
  }
  if (family.allowedPathPatterns.length === 0) {
    return { authorized: false, reason: 'This source family has no allowed path patterns - domain approval alone never authorizes any path.' };
  }
  for (const allowed of family.allowedPathPatterns) {
    if (globToRegExp(allowed).test(path)) {
      return { authorized: true, reason: `Path matches allowed pattern "${allowed}".` };
    }
  }
  return { authorized: false, reason: 'Path does not match any allowed pattern for this source family.' };
}

export function isFieldAuthoritativeForFamily(family: SourceFamily, field: MaterialField): boolean {
  return family.authoritativeFields.includes(field);
}

export function isPageTypePermitted(family: SourceFamily, pageType: string): boolean {
  return (family.permittedPageTypes as string[]).includes(pageType);
}
