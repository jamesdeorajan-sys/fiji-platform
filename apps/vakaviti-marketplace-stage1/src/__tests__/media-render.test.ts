import { describe, it, expect } from 'vitest';
import { renderMedia, locationBadge } from '../media-render';
import { classifyEntityMedia } from '../media-classification';

describe('renderMedia', () => {
  it('ENTITY_SPECIFIC renders a real <img> with width/height, no disclosure badge, no <script>', () => {
    const asset = classifyEntityMedia({ ownUrl: 'https://operator.example/photo.jpg', ownAlt: 'Real operator photo', semanticAssignment: null, fallbackCategory: 'accommodation' });
    const html = renderMedia(asset, { variant: 'hero' });
    expect(html).toContain('<img');
    expect(html).toContain('src="https://operator.example/photo.jpg"');
    expect(html).toContain('alt="Real operator photo"');
    expect(html).toMatch(/width="\d+" height="\d+"/);
    expect(html).not.toContain('media-disclosure');
    expect(html).not.toContain('Representative');
    expect(html).not.toMatch(/<script/i);
  });

  it('SEMANTIC_CATEGORY renders the photo AND a visible, escaped disclosure label naming it representative', () => {
    const asset = classifyEntityMedia({
      ownUrl: null, ownAlt: 'Blue Lagoon Beach Resort',
      semanticAssignment: { url: '/images/category-adventure.webp', alt: 'Boat at Kuata Island', disclosureLabel: 'Representative Yasawa Islands scenery — Kuata Island', fallbackCategory: 'accommodation' },
      fallbackCategory: 'accommodation',
    });
    const html = renderMedia(asset, { variant: 'hero' });
    expect(html).toContain('src="/images/category-adventure.webp"');
    expect(html).toContain('Representative Yasawa Islands scenery — Kuata Island');
  });

  it('BRANDED_FALLBACK renders inline generated art, never an <img> tag, never a broken/missing image', () => {
    const asset = classifyEntityMedia({ ownUrl: null, ownAlt: 'InterContinental Fiji Golf Resort & Spa', semanticAssignment: null, fallbackCategory: 'accommodation' });
    const html = renderMedia(asset, { variant: 'hero' });
    expect(html).not.toContain('<img');
    expect(html).toContain('<svg');
    expect(html).not.toMatch(/<script/i);
  });

  it('BRANDED_FALLBACK never renders a single large initial letter (the retired defect) - no <text> element at all', () => {
    const asset = classifyEntityMedia({ ownUrl: null, ownAlt: 'South Sea Cruises', semanticAssignment: null, fallbackCategory: 'cruise_island' });
    const html = renderMedia(asset, { variant: 'hero' });
    expect(html).not.toMatch(/<text/i);
  });

  it('card and hero variants of the same BRANDED_FALLBACK asset are composed differently, not one stretched into the other', () => {
    const asset = classifyEntityMedia({ ownUrl: null, ownAlt: 'x', semanticAssignment: null, fallbackCategory: 'transfer' });
    const card = renderMedia(asset, { variant: 'card' });
    const hero = renderMedia(asset, { variant: 'hero' });
    expect(card).toContain('viewBox="0 0 400 225"');
    expect(hero).toContain('viewBox="0 0 840 360"');
  });

  it('escapes HTML-special characters in alt text and disclosure labels', () => {
    const asset = classifyEntityMedia({
      ownUrl: null, ownAlt: 'x',
      semanticAssignment: { url: '/images/x.webp', alt: '<b>bad</b> alt & "quotes"', disclosureLabel: '<script>alert(1)</script>', fallbackCategory: 'dining' },
      fallbackCategory: 'dining',
    });
    const html = renderMedia(asset, { variant: 'card' });
    expect(html).not.toContain('<b>bad</b>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes a malicious URL rather than injecting it raw', () => {
    const asset = classifyEntityMedia({ ownUrl: '"><script>alert(1)</script>', ownAlt: 'x', semanticAssignment: null, fallbackCategory: 'accommodation' });
    const html = renderMedia(asset, { variant: 'card' });
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('carries an onerror load-error fallback for a real <img>, pointing at a same-origin data URI, never a second remote request', () => {
    const asset = classifyEntityMedia({ ownUrl: 'https://operator.example/maybe-404.jpg', ownAlt: 'x', semanticAssignment: null, fallbackCategory: 'transfer' });
    const html = renderMedia(asset, { variant: 'card' });
    expect(html).toMatch(/onerror="[^"]*data:image\/svg\+xml/);
    expect(html).not.toMatch(/onerror="[^"]*https?:\/\//);
  });

  it('eager option sets loading=eager and fetchpriority=high; default is lazy with no fetchpriority', () => {
    const asset = classifyEntityMedia({ ownUrl: 'https://x.example/p.jpg', ownAlt: 'x', semanticAssignment: null, fallbackCategory: 'accommodation' });
    const eager = renderMedia(asset, { variant: 'hero', eager: true });
    const lazy = renderMedia(asset, { variant: 'card' });
    expect(eager).toContain('loading="eager"');
    expect(eager).toContain('fetchpriority="high"');
    expect(lazy).toContain('loading="lazy"');
    expect(lazy).not.toContain('fetchpriority');
  });

  it('CEO VISUAL SIGN-OFF FIX: a real <img> sets style height:auto alongside its width/height attributes, so CSS aspect-ratio - not the fixed HTML height attribute - governs the rendered height at any container width (the fix for the 471px container / 343px image blank-gap defect)', () => {
    const asset = classifyEntityMedia({ ownUrl: 'https://operator.example/photo.jpg', ownAlt: 'x', semanticAssignment: null, fallbackCategory: 'accommodation' });
    const html = renderMedia(asset, { variant: 'hero', aspect: '21/9' });
    const styleMatch = html.match(/style="([^"]*)"/);
    expect(styleMatch).not.toBeNull();
    expect(styleMatch![1]).toContain('height:auto');
    expect(styleMatch![1]).toContain('aspect-ratio:21/9');
    // height:auto must come from the width:100% declaration onward, not override object-fit etc.
    expect(styleMatch![1]).toMatch(/width:100%;height:auto;aspect-ratio:/);
  });

  it('applies a custom focal point via object-position when supplied, defaults to center', () => {
    const asset = classifyEntityMedia({ ownUrl: 'https://x.example/p.jpg', ownAlt: 'x', semanticAssignment: null, fallbackCategory: 'accommodation' });
    const custom = renderMedia(asset, { variant: 'card', focalPoint: '20% 80%' });
    const def = renderMedia(asset, { variant: 'card' });
    expect(custom).toContain('object-position:20% 80%');
    expect(def).toContain('object-position:50% 50%');
  });
});

describe('locationBadge', () => {
  it('escapes its text', () => {
    expect(locationBadge('<b>Nadi</b>')).not.toContain('<b>Nadi</b>');
    expect(locationBadge('<b>Nadi</b>')).toContain('&lt;b&gt;');
  });

  it('renderMedia itself never emits a loc-badge - only the dedicated locationBadge() export does, so callers cannot accidentally get one for free', () => {
    const asset = classifyEntityMedia({ ownUrl: 'https://x.example/p.jpg', ownAlt: 'x', semanticAssignment: null, fallbackCategory: 'accommodation' });
    const html = renderMedia(asset, { variant: 'hero' });
    expect(html).not.toContain('loc-badge');
  });
});
