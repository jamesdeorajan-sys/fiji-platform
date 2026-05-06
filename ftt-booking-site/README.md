# FTT Booking Site

Source files for **nadiairporttransfers.com**.

## What's here

`src/` — the actual files deployed to Cloudflare Pages.

- `index.html` — main page with hero, booking widget, FAQ, schema markup
- `app.js` — booking widget logic (90 KB, contains hotels, routes, pricing)
- `styles.css` — all styling
- `chat-widget.js` — floating chat widget (calls the chat Worker)
- `sitemap.xml` — submitted to Google + Bing (23 URLs)
- `_headers`, `_redirects` — Cloudflare Pages config
- `wrangler.toml` — Cloudflare config (currently mostly stub)
- `worker.js` — Pages-attached Worker (currently stub, real logic is client-side)
- `transfer/` — 22 hotel landing pages, each is its own SEO page

## Current version

**v0.17** deployed 5 May 2026 with cache version `?v=20260505a`.

The exact zip uploaded to Cloudflare is preserved in `../archives/ftt-booking-site-v0.17-20260505.zip`.

## How to deploy

1. Make changes in `src/`
2. Bump cache version in `src/index.html` (CSS link AND JS script tag — search for `?v=2026`)
3. Zip up the contents of `src/` (NOT the `src/` folder itself — drag the files in)
4. Upload to Cloudflare Pages → `nadiairporttransfers` project → Create deployment

See `../docs/DEPLOYMENT.md` for full deploy guide.

## Active integration points

- **Chat widget** → calls `https://fiji-chat-widget.helpronline.workers.dev/`
- **Pricing calculator** → all client-side in `app.js`, no backend required
- **WhatsApp confirmation** → uses `wa.me/61478886145` deep link

## Known issues

- 22 hotel pages have `[NEEDS YOUR INPUT]` markers for driver-perspective content
- "500+ five-star reviews" claim on homepage needs verification
