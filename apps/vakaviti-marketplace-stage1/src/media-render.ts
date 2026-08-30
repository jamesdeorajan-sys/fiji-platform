// CEO AUTHORIZATION — IMPLEMENT MEDIA ACCURACY AND FALLBACK SYSTEM (2026-08-29/30), Phase 5.
//
// The one reusable, responsive media component every image-bearing route now goes through. It
// reads a MediaAsset (media-classification.ts) and renders either a real <img> (ENTITY_SPECIFIC /
// SEMANTIC_CATEGORY) or inline generated art (BRANDED_FALLBACK, media-fallback-art.ts) - never
// both, and never a location badge unless the asset's own class allows one.
import { brandedFallback } from './media-fallback-art';
import type { MediaAsset } from './media-classification';

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Intrinsic width/height pair for a given CSS aspect-ratio string, at a fixed base width. Emitted
// as real width/height attributes (not just the CSS aspect-ratio property) so a browser reserves
// layout space before the stylesheet or the image itself has loaded - belt-and-suspenders against
// layout shift, since aspect-ratio support alone is not universal across every historical browser
// this site may still be viewed in.
function dimsForAspect(aspect: string, baseWidth = 800): { w: number; h: number } {
  const [wPart, hPart] = aspect.split('/').map(Number);
  const ratio = wPart && hPart ? wPart / hPart : 16 / 9;
  return { w: baseWidth, h: Math.round(baseWidth / ratio) };
}

export interface RenderMediaOpts {
  variant: 'card' | 'hero';
  aspect?: string;
  radius?: string;
  seed?: string;
  eager?: boolean;
  focalPoint?: string; // CSS object-position value, e.g. "50% 30%" - defaults to centre
  // A second, same-size photo source at a smaller intrinsic width, for real multi-resolution
  // assets. Deliberately optional and unused by every CURRENT call site: every bundled photo in
  // public/images/ exists at exactly one resolution today, and fabricating a srcset entry that
  // points at the SAME file under a different claimed width would be dishonest, not responsive
  // design. The parameter exists so a future pipeline that actually generates multiple real
  // resolutions (e.g. an operator-uploaded photo processed at upload time) can use this component
  // without a rewrite - see the Phase 7 return for this explicitly flagged as unimplemented today.
  smallSrc?: { url: string; width: number };
}

const DISCLOSURE_STYLE = 'position:absolute;right:16px;bottom:16px;max-width:calc(100% - 32px);background:rgba(12,35,27,.72);color:#fff;padding:6px 12px;border-radius:999px;font-size:11px;line-height:1.3;backdrop-filter:blur(3px);text-align:right';

// Renders the media element ONLY - callers remain responsible for their own location badge
// (never emitted here) and must gate it on asset.allowLocationBadge themselves, since only the
// calling page knows the entity's real location text to show.
export function renderMedia(asset: MediaAsset, opts: RenderMediaOpts): string {
  const aspect = opts.aspect || (opts.variant === 'hero' ? '21/9' : '16/9');
  const radius = opts.radius || (opts.variant === 'hero' ? '20px' : '14px 14px 0 0');

  if (asset.class === 'BRANDED_FALLBACK' || !asset.url) {
    return `<div style="position:relative">${brandedFallback(asset.fallbackCategory, opts.variant, { aspect, radius, seed: opts.seed })}</div>`;
  }

  const { w, h } = dimsForAspect(aspect);
  const loading = opts.eager ? 'eager' : 'lazy';
  const fp = opts.eager ? ' fetchpriority="high"' : '';
  const objectPosition = opts.focalPoint || '50% 50%';
  // onerror safety net: if a real (potentially operator-supplied, externally-hosted) URL ever
  // 404s or otherwise fails to load, fall back to this entity's own generated branded art rather
  // than a broken-image icon - encoded as a same-origin data: URI, never a second network request
  // and never a remote asset. Fires at most once (onerror clears itself) so a persistently-broken
  // fallback can never loop.
  const fallbackDataUri = 'data:image/svg+xml,' + encodeURIComponent(brandedFallback(asset.fallbackCategory, opts.variant, { aspect, radius }));
  const srcset = opts.smallSrc ? ` srcset="${esc(opts.smallSrc.url)} ${opts.smallSrc.width}w, ${esc(asset.url)} ${w}w" sizes="(max-width: 640px) ${opts.smallSrc.width}px, ${w}px"` : '';
  // CEO VISUAL SIGN-OFF FIX (2026-08-31): width/height HTML attributes are kept (they still do
  // their job of hinting the browser's pre-load layout reservation and satisfying the intrinsic-
  // size accessibility/performance guidance), but the img is a replaced element - when both the
  // height ATTRIBUTE and the width CSS property resolve to definite values, aspect-ratio has no
  // remaining auto dimension to solve for and is silently ignored, pinning the image to the fixed
  // attribute height (343px at the 800px baseWidth) regardless of the container's real rendered
  // width. Explicit `height:auto` in the style makes height the auto dimension again, so
  // aspect-ratio correctly recomputes it from the actual 100%-driven width - reproduced and
  // confirmed via live getBoundingClientRect()/getComputedStyle() inspection before this fix.
  const img = `<img src="${esc(asset.url)}" alt="${esc(asset.alt)}" width="${w}" height="${h}" loading="${loading}"${fp}${srcset} decoding="async" onerror="this.onerror=null;this.src='${fallbackDataUri}'" style="width:100%;height:auto;aspect-ratio:${aspect};object-fit:cover;object-position:${esc(objectPosition)};border-radius:${radius};display:block;background:#0c2b23">`;

  if (asset.class === 'SEMANTIC_CATEGORY' && asset.disclosureLabel) {
    return `<div style="position:relative">${img}<span style="${DISCLOSURE_STYLE}">${esc(asset.disclosureLabel)}</span></div>`;
  }
  return img;
}

// The location badge, factored out so every call site renders it identically and only when the
// asset's own class permits it. Callers must check asset.allowLocationBadge before calling this -
// it does not re-check, so the check-then-call sequence stays visible at each call site during
// review rather than being hidden inside a shared function.
export function locationBadge(text: string): string {
  return `<span class="loc-badge">${esc(text)}</span>`;
}
