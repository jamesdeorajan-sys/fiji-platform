// CEO AUTHORIZATION — IMPLEMENT MEDIA ACCURACY AND FALLBACK SYSTEM (2026-08-29/30), Phase 2.
//
// Six Vakaviti-designed, code-native BRANDED_FALLBACK visuals, replacing the retired single-
// letter hero fallback. Every SVG here is fully static: no <script>, no <foreignObject>, no
// external href/xlink:href, no <text> element (the entity's name is never drawn as pixels - it
// stays normal accessible HTML in the calling page, per the CEO's explicit instruction). Card and
// hero variants are separately composed, not one stretched into the other - a hero gets a wider
// horizon/wave composition and an off-center icon; a card gets a simpler centered icon so it
// reads clearly at small size.
import type { BrandedFallbackCategory } from './media-classification';

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Deterministic small hash so repeated fallback SVGs on one page never collide on gradient/mask
// ids - same technique the prior single-letter fallback used.
const idFor = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return 'mf' + h.toString(36);
};

const PALETTE: Record<BrandedFallbackCategory, { from: string; to: string; icon: string }> = {
  accommodation: { from: '#1c5c3f', to: '#0c2b23', icon: '#eaf3ee' },
  cruise_island: { from: '#0f6e6a', to: '#0a3c39', icon: '#e8f7f5' },
  transfer: { from: '#134a3f', to: '#0c2b23', icon: '#eaf3ee' },
  tour_activity: { from: '#2a4d6e', to: '#12283d', icon: '#eaf2fb' },
  dining: { from: '#7a4a1c', to: '#3d2510', icon: '#fbf1e6' },
  general_operator: { from: '#12231b', to: '#0a1712', icon: '#eef5f1' },
};

// One hand-authored icon glyph per category, drawn as plain geometric shapes centred on a
// 0,0-anchored 40x40 box (positioned by the caller via a <g transform="translate(...)">).
// Deliberately simple/iconographic - never intended to be mistaken for a real photo of anyone's
// specific property, vessel, vehicle or dish.
function iconPaths(category: BrandedFallbackCategory, color: string): string {
  switch (category) {
    case 'accommodation':
      // Simple roofline + building + window - generic accommodation motif.
      return `<path d="M0 18 L20 2 L40 18 V38 H0 Z" fill="${color}" fill-opacity="0.92"/><rect x="16" y="24" width="8" height="14" fill="${PALETTE.accommodation.to}"/><rect x="6" y="22" width="6" height="6" fill="${PALETTE.accommodation.to}"/><rect x="28" y="22" width="6" height="6" fill="${PALETTE.accommodation.to}"/>`;
    case 'cruise_island':
      // Hull + cabin + a couple of wave crests - generic boat/cruise motif.
      return `<path d="M2 26 L38 26 L33 37 H7 Z" fill="${color}" fill-opacity="0.92"/><rect x="14" y="14" width="12" height="12" rx="2" fill="${color}" fill-opacity="0.92"/><rect x="18" y="6" width="3" height="10" fill="${color}" fill-opacity="0.92"/><path d="M0 33 Q10 29 20 33 T40 33" stroke="${color}" stroke-width="2.4" fill="none" stroke-opacity="0.85"/>`;
    case 'transfer':
      // Simple car silhouette - body + two wheels - generic ground-transport motif.
      return `<path d="M3 27 L7 16 H30 L36 27 Z" fill="${color}" fill-opacity="0.92"/><rect x="0" y="26" width="40" height="7" rx="3.5" fill="${color}" fill-opacity="0.92"/><circle cx="11" cy="34" r="4.2" fill="${PALETTE.transfer.to}" stroke="${color}" stroke-width="2"/><circle cx="29" cy="34" r="4.2" fill="${PALETTE.transfer.to}" stroke="${color}" stroke-width="2"/>`;
    case 'tour_activity':
      // Compass - outer ring + needle - generic tour/activity/adventure motif.
      return `<circle cx="20" cy="20" r="17" fill="none" stroke="${color}" stroke-width="2.6" opacity="0.92"/><path d="M20 9 L24 20 L20 31 L16 20 Z" fill="${color}" fill-opacity="0.9"/><circle cx="20" cy="20" r="2.6" fill="${PALETTE.tour_activity.to}"/>`;
    case 'dining':
      // Fork + knife pair - generic dining motif.
      return `<rect x="8" y="4" width="3" height="32" rx="1.5" fill="${color}" fill-opacity="0.92"/><path d="M4 4 V14 M8 4 V14 M12 4 V14" stroke="${color}" stroke-width="2.2" opacity="0.92"/><path d="M27 4 C22 8 22 16 27 18 V36 H29 V4 Z" fill="${color}" fill-opacity="0.92"/>`;
    case 'general_operator':
    default:
      // The Vakaviti brand mark itself (same "V" motif as the site favicon) - a deliberate brand
      // identity, never a generic entity-name initial, so this is categorically not a
      // reintroduction of the retired letter-placeholder pattern.
      return `<path d="M6 6 L20 32 L34 6 H27 L20 20 L13 6 Z" fill="${color}" fill-opacity="0.95"/>`;
  }
}

function waveLayer(gid: string, opacity1: number, opacity2: number, w: number, h: number): string {
  const y1 = h * 0.76, y2 = h * 0.88;
  return `<path d="M0 ${y1} Q${w * 0.25} ${y1 - 22} ${w * 0.5} ${y1 - 8} T${w} ${y1 - 12} V${h} H0 Z" fill="#ffffff" opacity="${opacity1}"/><path d="M0 ${y2} Q${w * 0.25} ${y2 - 16} ${w * 0.5} ${y2 - 7} T${w} ${y2 - 10} V${h} H0 Z" fill="#ffffff" opacity="${opacity2}"/>`;
}

export interface BrandedFallbackOpts {
  aspect?: string;
  radius?: string;
  seed?: string;
}

// Card variant: a simple, centred icon at moderate scale - reads clearly in a small grid tile.
export function brandedFallbackCard(category: BrandedFallbackCategory, opts: BrandedFallbackOpts = {}): string {
  const aspect = opts.aspect || '16/9';
  const radius = opts.radius || '14px 14px 0 0';
  const { from, to, icon } = PALETTE[category];
  const gid = idFor((opts.seed || category) + ':card');
  const w = 400, h = 225;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" style="width:100%;aspect-ratio:${aspect};display:block;border-radius:${radius}">
<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${esc(from)}"/><stop offset="100%" stop-color="${esc(to)}"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#${gid})"/>
${waveLayer(gid, 0.06, 0.09, w, h)}
<g transform="translate(${w / 2 - 20} ${h / 2 - 34})">${iconPaths(category, icon)}</g>
</svg>`;
}

// Hero variant: a wider horizon-style composition with the icon off-centre - a deliberately
// different layout from the card, not a stretched copy of it.
export function brandedFallbackHero(category: BrandedFallbackCategory, opts: BrandedFallbackOpts = {}): string {
  const aspect = opts.aspect || '21/9';
  const radius = opts.radius || '20px';
  const { from, to, icon } = PALETTE[category];
  const gid = idFor((opts.seed || category) + ':hero');
  const w = 840, h = 360;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" style="width:100%;aspect-ratio:${aspect};display:block;border-radius:${radius}">
<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${esc(from)}"/><stop offset="100%" stop-color="${esc(to)}"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#${gid})"/>
${waveLayer(gid, 0.05, 0.08, w, h)}
<path d="M0 ${h * 0.42} Q${w * 0.3} ${h * 0.34} ${w * 0.62} ${h * 0.44} T${w} ${h * 0.4}" stroke="#ffffff" stroke-width="2" fill="none" opacity="0.12"/>
<g transform="translate(${w * 0.72} ${h * 0.32}) scale(1.6)">${iconPaths(category, icon)}</g>
</svg>`;
}

export function brandedFallback(category: BrandedFallbackCategory, variant: 'card' | 'hero', opts: BrandedFallbackOpts = {}): string {
  return variant === 'hero' ? brandedFallbackHero(category, opts) : brandedFallbackCard(category, opts);
}
