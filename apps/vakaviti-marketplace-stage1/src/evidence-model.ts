// Phase A-R, item 7: minimal-by-default evidence storage (CEO directive 2026-08-29).
//
// DefaultEvidenceRecord is the ONLY shape the standard pipeline produces. It structurally cannot
// carry full HTML, a screenshot, a full description, or an image - there is no field for any of
// them. R2 (EvidenceEscalation) is a separate, optional type that nothing in the default pipeline
// ever constructs - it exists only for a human or an explicit escalation rule to request, with a
// reason, on a specific already-evidenced offer.

export const MAX_EXCERPT_CHARS = 240; // "short necessary excerpts" - enforced, not just described

export interface DefaultEvidenceRecord {
  canonicalUrl: string;
  checkedAt: string;
  httpStatus: number;
  httpContentType: string | null;
  contentHash: string; // sha256 of the fetched body - reuses the existing fingerprint() pattern from deal-agent.ts
  structuredFacts: Record<string, string | null>; // extracted fields only, never raw page text
  // One short, truncated excerpt per field, used only to support attributability review - never the
  // full paragraph/description the excerpt was drawn from.
  shortExcerpts: Record<string, string>;
  extractorModel: string;
  extractorVersion: string;
  ruleResults: { gate: string; passed: boolean }[];
}

export interface BuildDefaultEvidenceInput {
  canonicalUrl: string;
  checkedAt: string;
  httpStatus: number;
  httpContentType: string | null;
  contentHash: string;
  structuredFacts: Record<string, string | null>;
  rawExcerpts: Record<string, string>; // may exceed MAX_EXCERPT_CHARS - truncated below, never stored whole
  extractorModel: string;
  extractorVersion: string;
  ruleResults: { gate: string; passed: boolean }[];
}

export function buildDefaultEvidenceRecord(input: BuildDefaultEvidenceInput): DefaultEvidenceRecord {
  const shortExcerpts: Record<string, string> = {};
  for (const [field, excerpt] of Object.entries(input.rawExcerpts)) {
    shortExcerpts[field] = excerpt.length > MAX_EXCERPT_CHARS ? excerpt.slice(0, MAX_EXCERPT_CHARS) : excerpt;
  }
  return {
    canonicalUrl: input.canonicalUrl, checkedAt: input.checkedAt, httpStatus: input.httpStatus,
    httpContentType: input.httpContentType, contentHash: input.contentHash,
    structuredFacts: { ...input.structuredFacts }, shortExcerpts,
    extractorModel: input.extractorModel, extractorVersion: input.extractorVersion,
    ruleResults: input.ruleResults.map(r => ({ ...r })),
  };
}

// --- Optional R2 escalation - never populated by the default pipeline ----------------------------
export type EscalationContentType = 'FULL_HTML_SNAPSHOT' | 'SCREENSHOT';

export interface EvidenceEscalationRequest {
  offerOrSourceId: string;
  escalationReason: string; // required, non-empty - see requestEscalation()
  requestedByActorId: string;
  contentType: EscalationContentType;
}

export interface EvidenceEscalation extends EvidenceEscalationRequest {
  r2ObjectKey: string;
  requestedAt: string;
}

/**
 * The only function that may produce an EvidenceEscalation. Requires a non-empty reason - there is
 * no "ingest everything just in case" path. Nothing in offer-workflow.ts's default pipeline calls
 * this; it is wired only to an explicit human or dispute-driven trigger.
 */
export function requestEvidenceEscalation(
  request: EvidenceEscalationRequest, r2ObjectKey: string, now: () => string = () => new Date().toISOString()
): EvidenceEscalation {
  if (!request.escalationReason || !request.escalationReason.trim()) {
    throw new Error('Evidence escalation requires a non-empty reason - R2 ingestion is never unconditional.');
  }
  return { ...request, r2ObjectKey, requestedAt: now() };
}
