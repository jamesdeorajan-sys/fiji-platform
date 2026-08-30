// CEO AUTHORIZATION — IMPLEMENT MEDIA ACCURACY AND FALLBACK SYSTEM (2026-08-29/30), Phase 1.
//
// Every image on the site now carries one explicit, structurally-enforced classification. This
// module is pure logic (no HTML, no D1, no fetch) so the rendering rules can be unit-tested
// independently of any page - the same discipline as deal-exchange-model.ts's evaluation gates.
//
// The three classes exist because a single "resolveImage() returns a URL or null" model (the
// prior design) could not distinguish "this photo IS the named business" from "this photo is
// generic Fiji context standing in for it" from "there is no photo at all" - and that missing
// distinction is exactly what produced this task's two real defects: a stock photo of a
// different island paired with an operator's own location badge, and a stock marina photo
// carrying a visible third-party boat name ("FIJI ONE") on an unrelated ground-transport
// operator's page.

export type MediaClass = 'ENTITY_SPECIFIC' | 'SEMANTIC_CATEGORY' | 'BRANDED_FALLBACK';

// The 6 Vakaviti-designed branded visuals (Phase 2). general_operator is the last-resort default
// for an entity with no clearer category signal - never used when a more specific category is
// knowable from the entity's own data.
export type BrandedFallbackCategory =
  | 'accommodation' | 'cruise_island' | 'transfer' | 'tour_activity' | 'dining' | 'general_operator';

export interface MediaAsset {
  class: MediaClass;
  // Non-null for ENTITY_SPECIFIC and SEMANTIC_CATEGORY; always null for BRANDED_FALLBACK (it is
  // rendered as inline generated art, not a photo request).
  url: string | null;
  alt: string;
  // Required non-null for SEMANTIC_CATEGORY (the honest "this is not the operator's own photo"
  // disclosure); always null for the other two classes - ENTITY_SPECIFIC needs no disclosure
  // (it may genuinely depict the entity), and BRANDED_FALLBACK's own generated-art nature makes
  // a photographic-representation disclosure meaningless.
  disclosureLabel: string | null;
  // Required non-null only for BRANDED_FALLBACK - selects which of the 6 generated visuals to
  // render. Always present (even for the other two classes) as the onerror safety-net category,
  // see media-render.ts.
  fallbackCategory: BrandedFallbackCategory;
  // Only ENTITY_SPECIFIC may pair the entity's own real-world location text directly over the
  // image (a "loc-badge" overlay). SEMANTIC_CATEGORY and BRANDED_FALLBACK must never render one -
  // that overlay is exactly what created the Blue Lagoon/Nacula mispairing this task fixes.
  allowLocationBadge: boolean;
}

// One real, rights-recorded photo assignment. label is the exact, evidenced disclosure text shown
// on-page for this specific placement - deliberately per-assignment, not per-photo-file, because
// the same photo can need a different honest caption in a different context (e.g. Blue Lagoon's
// operator hero needs to name Kuata Island explicitly to correct the prior Nacula mispairing,
// while the Island Transfer product using the same file needs no such correction since it was
// never paired with a location badge in the first place).
export interface SemanticAssignment {
  url: string;
  alt: string;
  disclosureLabel: string;
  fallbackCategory: BrandedFallbackCategory;
}

export interface EntityMediaInput {
  ownUrl: string | null | undefined;
  ownAlt: string;
  semanticAssignment: SemanticAssignment | null | undefined;
  // Used only when no ownUrl and no semanticAssignment exist - selects the BRANDED_FALLBACK
  // visual. Callers derive this from their own domain data (e.g. product.category); this module
  // makes no assumption about what "accommodation" or "transfer" means in the caller's schema.
  fallbackCategory: BrandedFallbackCategory;
}

// Priority order (unchanged from the prior resolveImage()): (1) the entity's own authorized
// photo, (2) an explicitly reviewed semantic-category assignment, (3) the branded fallback.
// "Never some Fiji image is better than no image" still holds - the branded fallback is a
// first-class, deliberately designed outcome, not a degraded one.
export function classifyEntityMedia(input: EntityMediaInput): MediaAsset {
  if (input.ownUrl) {
    return {
      class: 'ENTITY_SPECIFIC',
      url: input.ownUrl,
      alt: input.ownAlt,
      disclosureLabel: null,
      fallbackCategory: input.fallbackCategory,
      allowLocationBadge: true,
    };
  }
  if (input.semanticAssignment) {
    return {
      class: 'SEMANTIC_CATEGORY',
      url: input.semanticAssignment.url,
      alt: input.semanticAssignment.alt,
      disclosureLabel: input.semanticAssignment.disclosureLabel,
      fallbackCategory: input.semanticAssignment.fallbackCategory,
      allowLocationBadge: false,
    };
  }
  return {
    class: 'BRANDED_FALLBACK',
    url: null,
    alt: input.ownAlt,
    disclosureLabel: null,
    fallbackCategory: input.fallbackCategory,
    allowLocationBadge: false,
  };
}

// Structural invariant check - exercised directly by tests, and cheap enough to be safe to call
// from rendering code too if ever useful for a future admin/QA view. Returns every violation
// found rather than stopping at the first, so a test failure message is immediately actionable.
export function validateMediaAsset(asset: MediaAsset): string[] {
  const violations: string[] = [];

  if (asset.class === 'ENTITY_SPECIFIC') {
    if (!asset.url) violations.push('ENTITY_SPECIFIC must carry a url');
    if (asset.disclosureLabel !== null) violations.push('ENTITY_SPECIFIC must not carry a disclosureLabel');
  }

  if (asset.class === 'SEMANTIC_CATEGORY') {
    if (!asset.url) violations.push('SEMANTIC_CATEGORY must carry a url');
    if (!asset.disclosureLabel || !asset.disclosureLabel.trim()) violations.push('SEMANTIC_CATEGORY must carry a non-empty disclosureLabel');
    if (asset.allowLocationBadge) violations.push('SEMANTIC_CATEGORY must never allow a location badge over the image');
  }

  if (asset.class === 'BRANDED_FALLBACK') {
    if (asset.url !== null) violations.push('BRANDED_FALLBACK must not carry a url');
    if (asset.disclosureLabel !== null) violations.push('BRANDED_FALLBACK must not carry a disclosureLabel');
    if (asset.allowLocationBadge) violations.push('BRANDED_FALLBACK must never allow a location badge');
  }

  if (asset.class !== 'ENTITY_SPECIFIC' && asset.allowLocationBadge) {
    violations.push('only ENTITY_SPECIFIC may allow a location badge');
  }

  return violations;
}
