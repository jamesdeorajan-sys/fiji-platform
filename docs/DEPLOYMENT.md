# Deployment Guide

## Cloudflare Pages — current host

The booking widget is deployed to Cloudflare Pages. Free tier handles up to 500 builds/month, unlimited bandwidth, 100k requests/day. Plenty for current scale.

## How to deploy a new build

1. **Get the latest zip** — typically named `fiji-transfers-cloudflare.zip`
2. **Unzip locally** (you should see `index.html`, `app.js`, `styles.css`, `_headers`, `_redirects`, `wrangler.toml`)
3. **Log into Cloudflare** (https://dash.cloudflare.com)
4. **Pages → fiji-transfers** (or whatever the project is called)
5. **Click "Create deployment"**
6. **Upload the FILES** (not the folder — drag the unzipped files into the upload box)
7. **Wait for deploy** (usually 30–60 seconds)
8. **Test the live URL** before announcing

## Troubleshooting

### Customer reports they're seeing the old version
- This is the most common issue. Cause: browser caching.
- Fix: every build now uses cache-busting query strings (`app.js?v=20260428a`), so this should be solved.
- If it persists: tell the customer to do a hard refresh (Cmd+Shift+R / Ctrl+Shift+R).
- For chronic cases: open in incognito / private browsing.

### Tour images don't load
- Tour images are loaded directly from `fijitourtransfers.com`. If the live site is down or images are renamed, the booking widget shows fallback emoji.
- The `onerror` handler catches this gracefully.

### Pricing doesn't match the routes table
- Pricing constants live in `app.js` (`TIER` constant)
- Routes table prices are HARDCODED in `app.js` (`ROUTES_DATA`)
- These two MUST match. If they drift, the routes table is wrong.
- See `PRICING_MODEL.md` for the source of truth.

### Booking confirmation has emoji corruption (`�`)
- Solved in v0.5+ with `stripEmoji()`. If it happens again:
  1. Check the customer is on the latest build (cache version)
  2. Verify the customer's WhatsApp client supports UTF-8 emoji (most do)
  3. Check that `stripEmoji()` is being called in `buildConfirmation` and `buildWhatsAppURL`

## Custom domain

Currently the booking widget runs on a Cloudflare Pages subdomain (e.g. `fiji-transfers.pages.dev`).

To move to a custom domain:
1. Cloudflare Pages → project → Custom domains → Set up custom domain
2. Add `book.fijitourtransfers.com` (or similar)
3. Cloudflare will issue an SSL cert automatically
4. Update DNS at the domain registrar to CNAME to the Pages domain

## Cache control

Current `_headers` config:
```
/*.html
  Cache-Control: public, max-age=0, must-revalidate

/*.css
  Cache-Control: public, max-age=3600, must-revalidate

/*.js
  Cache-Control: public, max-age=3600, must-revalidate
```

Don't make CSS/JS `immutable` again — it caused the stale-cache issues we hit in v0.5.

## Cache version naming

Use this pattern: `?v=YYYYMMDDx`

Where:
- `YYYYMMDD` is the deploy date
- `x` is a letter (a, b, c...) for multiple deploys on the same day

Examples:
- `?v=20260428a` (first deploy on 28 April 2026)
- `?v=20260428b` (second deploy that day)
- `?v=20260429a` (next day)

When deploying:
1. Bump the version string in `index.html` (both the CSS and JS link)
2. Commit / deploy

## Rollback procedure

If a deploy breaks something:

1. **Cloudflare Pages → Deployments**
2. **Find the previous successful deploy** (green checkmark)
3. **Click "..." → Rollback to this deployment**
4. **Live site reverts within 1–2 minutes**

Then fix the issue locally, test, and deploy again.

## Environment variables / secrets

Currently the booking widget doesn't use any secrets — all logic runs client-side. Nothing in environment variables.

When Stripe is integrated, secrets needed:
- `STRIPE_PUBLISHABLE_KEY` (safe to expose; goes in client code)
- `STRIPE_SECRET_KEY` (server-only — needs Cloudflare Worker or external API)

## Backup procedure

Cloudflare Pages keeps the last 100 deployments forever. Plus:

- **Source files** are in this project (`fiji-platform-project/src/`)
- **Configuration** is in `_headers`, `_redirects`, `wrangler.toml`

To create a manual backup snapshot:
```bash
cd fiji-platform-project
tar -czf fiji-platform-snapshot-$(date +%Y%m%d).tar.gz .
```

## Performance budget

- HTML: < 50 KB gzipped
- CSS: < 30 KB gzipped
- JS: < 80 KB gzipped (currently ~45 KB)
- Total page weight: < 300 KB before tour images
- LCP target: < 2.5 seconds on 4G mobile
- TTI target: < 3 seconds on 4G mobile

Tour images are lazy-loaded from `fijitourtransfers.com`, so they don't block initial render.

## Monitoring

Currently no formal monitoring. To add:
- Cloudflare Web Analytics (free, privacy-respecting)
- Plausible / Fathom (paid, EU-friendly)
- Server-side error logging via Cloudflare Workers

For now, monitor manually:
- Test booking once a week
- Check Cloudflare Pages dashboard for deploy errors
- Monitor WhatsApp inbox for customer issues
