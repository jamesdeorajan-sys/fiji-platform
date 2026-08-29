import { describe, it, expect } from 'vitest';
import { classifyEntityMedia, validateMediaAsset, type SemanticAssignment } from '../media-classification';

const semantic: SemanticAssignment = {
  url: '/images/category-adventure.webp',
  alt: 'Boat at Kuata, Yasawa Islands, Fiji',
  disclosureLabel: 'Representative Yasawa Islands scenery — Kuata Island',
  fallbackCategory: 'cruise_island',
};

describe('classifyEntityMedia', () => {
  it('an own image_url always produces ENTITY_SPECIFIC, regardless of any semantic assignment', () => {
    const asset = classifyEntityMedia({ ownUrl: 'https://operator.example/photo.jpg', ownAlt: 'Real photo', semanticAssignment: semantic, fallbackCategory: 'accommodation' });
    expect(asset.class).toBe('ENTITY_SPECIFIC');
    expect(asset.url).toBe('https://operator.example/photo.jpg');
    expect(asset.disclosureLabel).toBeNull();
    expect(asset.allowLocationBadge).toBe(true);
  });

  it('no own url but a semantic assignment produces SEMANTIC_CATEGORY carrying the disclosure label', () => {
    const asset = classifyEntityMedia({ ownUrl: null, ownAlt: 'Entity name', semanticAssignment: semantic, fallbackCategory: 'accommodation' });
    expect(asset.class).toBe('SEMANTIC_CATEGORY');
    expect(asset.url).toBe(semantic.url);
    expect(asset.disclosureLabel).toBe(semantic.disclosureLabel);
    expect(asset.allowLocationBadge).toBe(false);
  });

  it('no own url and no semantic assignment produces BRANDED_FALLBACK with a null url', () => {
    const asset = classifyEntityMedia({ ownUrl: null, ownAlt: 'Entity name', semanticAssignment: null, fallbackCategory: 'dining' });
    expect(asset.class).toBe('BRANDED_FALLBACK');
    expect(asset.url).toBeNull();
    expect(asset.fallbackCategory).toBe('dining');
    expect(asset.disclosureLabel).toBeNull();
    expect(asset.allowLocationBadge).toBe(false);
  });

  it('an empty-string own url is treated as absent (falsy), not as a real photo', () => {
    const asset = classifyEntityMedia({ ownUrl: '', ownAlt: 'Entity name', semanticAssignment: null, fallbackCategory: 'transfer' });
    expect(asset.class).toBe('BRANDED_FALLBACK');
  });
});

describe('validateMediaAsset - structural rendering-rule enforcement', () => {
  it('a correctly-formed ENTITY_SPECIFIC asset has zero violations', () => {
    const asset = classifyEntityMedia({ ownUrl: 'https://x.example/p.jpg', ownAlt: 'x', semanticAssignment: null, fallbackCategory: 'accommodation' });
    expect(validateMediaAsset(asset)).toEqual([]);
  });

  it('a correctly-formed SEMANTIC_CATEGORY asset has zero violations', () => {
    const asset = classifyEntityMedia({ ownUrl: null, ownAlt: 'x', semanticAssignment: semantic, fallbackCategory: 'accommodation' });
    expect(validateMediaAsset(asset)).toEqual([]);
  });

  it('a correctly-formed BRANDED_FALLBACK asset has zero violations', () => {
    const asset = classifyEntityMedia({ ownUrl: null, ownAlt: 'x', semanticAssignment: null, fallbackCategory: 'general_operator' });
    expect(validateMediaAsset(asset)).toEqual([]);
  });

  it('flags a SEMANTIC_CATEGORY asset that allows a location badge (the exact Blue Lagoon/Nacula defect shape)', () => {
    const violations = validateMediaAsset({ class: 'SEMANTIC_CATEGORY', url: semantic.url, alt: semantic.alt, disclosureLabel: semantic.disclosureLabel, fallbackCategory: 'cruise_island', allowLocationBadge: true });
    expect(violations).toContain('SEMANTIC_CATEGORY must never allow a location badge over the image');
  });

  it('flags a SEMANTIC_CATEGORY asset with no disclosure label', () => {
    const violations = validateMediaAsset({ class: 'SEMANTIC_CATEGORY', url: semantic.url, alt: semantic.alt, disclosureLabel: null, fallbackCategory: 'cruise_island', allowLocationBadge: false });
    expect(violations.some(v => v.includes('disclosureLabel'))).toBe(true);
  });

  it('flags a SEMANTIC_CATEGORY asset with a blank (whitespace-only) disclosure label', () => {
    const violations = validateMediaAsset({ class: 'SEMANTIC_CATEGORY', url: semantic.url, alt: semantic.alt, disclosureLabel: '   ', fallbackCategory: 'cruise_island', allowLocationBadge: false });
    expect(violations.some(v => v.includes('disclosureLabel'))).toBe(true);
  });

  it('flags a BRANDED_FALLBACK asset that carries a url (the exact "photo behind generated art" defect shape)', () => {
    const violations = validateMediaAsset({ class: 'BRANDED_FALLBACK', url: '/images/should-not-be-here.webp', alt: 'x', disclosureLabel: null, fallbackCategory: 'transfer', allowLocationBadge: false });
    expect(violations).toContain('BRANDED_FALLBACK must not carry a url');
  });

  it('flags a BRANDED_FALLBACK asset that allows a location badge', () => {
    const violations = validateMediaAsset({ class: 'BRANDED_FALLBACK', url: null, alt: 'x', disclosureLabel: null, fallbackCategory: 'transfer', allowLocationBadge: true });
    expect(violations.some(v => v.includes('location badge'))).toBe(true);
  });

  it('flags an ENTITY_SPECIFIC asset carrying a disclosure label (would wrongly imply it is not the entity\'s own photo)', () => {
    const violations = validateMediaAsset({ class: 'ENTITY_SPECIFIC', url: 'https://x.example/p.jpg', alt: 'x', disclosureLabel: 'Representative imagery', fallbackCategory: 'accommodation', allowLocationBadge: true });
    expect(violations).toContain('ENTITY_SPECIFIC must not carry a disclosureLabel');
  });

  it('flags an ENTITY_SPECIFIC asset missing a url', () => {
    const violations = validateMediaAsset({ class: 'ENTITY_SPECIFIC', url: null, alt: 'x', disclosureLabel: null, fallbackCategory: 'accommodation', allowLocationBadge: true });
    expect(violations).toContain('ENTITY_SPECIFIC must carry a url');
  });
});
