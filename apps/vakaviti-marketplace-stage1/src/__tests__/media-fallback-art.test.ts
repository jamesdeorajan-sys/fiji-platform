import { describe, it, expect } from 'vitest';
import { brandedFallbackCard, brandedFallbackHero, brandedFallback } from '../media-fallback-art';
import type { BrandedFallbackCategory } from '../media-classification';

const CATEGORIES: BrandedFallbackCategory[] = ['accommodation', 'cruise_island', 'transfer', 'tour_activity', 'dining', 'general_operator'];

describe('branded fallback art is safe, static, code-native SVG', () => {
  for (const category of CATEGORIES) {
    it(`${category} card and hero variants never contain a <script>, <foreignObject>, external href, or <text> element`, () => {
      for (const svg of [brandedFallbackCard(category), brandedFallbackHero(category)]) {
        expect(svg).not.toMatch(/<script/i);
        expect(svg).not.toMatch(/<foreignObject/i);
        expect(svg).not.toMatch(/on\w+\s*=/i); // no inline event handlers inside the SVG itself
        expect(svg).not.toMatch(/(?:xlink:)?href\s*=\s*["']https?:/i); // no remote reference
        expect(svg).not.toMatch(/<text/i); // no baked-in text/labels - the whole point of retiring the letter fallback
      }
    });
  }

  it('every category produces a visibly different icon (paths are not identical across categories)', () => {
    const cards = CATEGORIES.map(c => brandedFallbackCard(c));
    const unique = new Set(cards);
    expect(unique.size).toBe(CATEGORIES.length);
  });

  it('card and hero are separately composed, not one stretched into the other (different viewBox dimensions and internal layout)', () => {
    const card = brandedFallbackCard('accommodation');
    const hero = brandedFallbackHero('accommodation');
    expect(card).toMatch(/viewBox="0 0 400 225"/);
    expect(hero).toMatch(/viewBox="0 0 840 360"/);
    expect(card).not.toBe(hero);
  });

  it('brandedFallback(.... "card") and brandedFallback(..., "hero") dispatch to the matching composer', () => {
    expect(brandedFallback('transfer', 'card')).toBe(brandedFallbackCard('transfer'));
    expect(brandedFallback('transfer', 'hero')).toBe(brandedFallbackHero('transfer'));
  });

  it('a different seed on the same category produces a different gradient id, so two fallbacks on one page never collide', () => {
    const a = brandedFallbackCard('dining', { seed: 'offer-a' });
    const b = brandedFallbackCard('dining', { seed: 'offer-b' });
    expect(a).not.toBe(b);
  });

  it('respects the caller-supplied aspect ratio and radius', () => {
    const svg = brandedFallbackCard('tour_activity', { aspect: '4/3', radius: '8px' });
    expect(svg).toContain('aspect-ratio:4/3');
    expect(svg).toContain('border-radius:8px');
  });

  it('the general_operator visual is the Vakaviti brand mark, not a generic entity-initial glyph (no dynamic label ever drawn)', () => {
    const svg = brandedFallbackCard('general_operator');
    // The brand-mark path is a fixed constant, independent of any entity name - there is no
    // "initial" input to this function at all, structurally ruling out the retired pattern.
    expect(svg).not.toMatch(/<text/i);
  });
});
