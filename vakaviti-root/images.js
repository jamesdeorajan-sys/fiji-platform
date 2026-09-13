/*
 * Centralized image references for vakaviti.ai's guide cards.
 *
 * STATUS: Unsplash placeholders (properly licensed, real photos, real
 * photographer credit below) — NOT final. Pending real partner/operator
 * photography. See vakaviti-root/BUILD_LOG.md, 2026-08-09 homepage
 * visual refresh entry, for the follow-up task this is tracked under.
 *
 * TO SWAP IN A REAL PHOTO LATER: replace the `url` (and update `alt` /
 * `credit`) for the relevant key below. Nothing else in index.html needs
 * to change — every guide-card image is pulled from this one file.
 *
 * The network map itself (vakaviti-root/hero-network-map.svg) is NOT in
 * this file — it's a custom SVG, not an Unsplash placeholder, so it
 * doesn't need the swap-later treatment this file exists for.
 * `heroOceanBg` below is a separate thing: an Unsplash placeholder used
 * as the hero SECTION's background photo, sitting behind the map (which
 * has its own opaque background and is unaffected by it) and behind the
 * hero text (which the dark overlay in index.html's CSS protects).
 */
var VAKAVITI_IMAGES = {
  heroOceanBg: {
    url: "https://images.unsplash.com/photo-1516135533926-3acfaffde030?w=1600&auto=format&fit=crop&q=80",
    alt: "Aerial view of ocean waves",
    credit: "Photo by Zoe Hoole on Unsplash"
  },
  guideNadiAirport: {
    url: "https://images.unsplash.com/photo-1764555737101-6c9cf9aea376?w=800&auto=format&fit=crop&q=80",
    alt: "Airplane on approach for landing",
    credit: "Photo by Hieu on Unsplash"
  },
  guideAccommodation: {
    url: "https://images.unsplash.com/photo-1594068217043-26028fb5b0c8?w=800&auto=format&fit=crop&q=80",
    alt: "Beachfront resort bungalow in Fiji",
    credit: "Photo by Josaia Cakacaka on Unsplash"
  },
  guideHorseRiding: {
    url: "https://images.unsplash.com/photo-1633767979501-6225d151ba70?w=800&auto=format&fit=crop&q=80",
    alt: "Horse riding on the beach at sunset",
    credit: "Photo by Carolin Thiergart on Unsplash"
  },
  guideVisaMoney: {
    url: "https://images.unsplash.com/photo-1553697388-94e804e2f0f6?w=800&auto=format&fit=crop&q=80",
    alt: "Passport and travel documents",
    credit: "Photo by Spencer Davis on Unsplash"
  },
  guideCulture: {
    url: "https://images.unsplash.com/photo-1579264670959-286d7b06f1ae?w=800&auto=format&fit=crop&q=80",
    alt: "Coastal village scene in Fiji",
    credit: "Photo by Savir C on Unsplash"
  },
  guideWeather: {
    url: "https://images.unsplash.com/photo-1694604359217-8e992b813d3c?w=800&auto=format&fit=crop&q=80",
    alt: "Beach sunset in Nadi, Fiji",
    credit: "Photo by Timothy Ah Koy on Unsplash"
  }
};
