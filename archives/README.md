# Deploy Archives

Exact zips of what was uploaded to Cloudflare on each deploy.

## Why these exist

When something breaks on a live site, the question is: "what was different between the working version and this version?" The git history of source files answers part of that, but the actual zip uploaded to Cloudflare is the ground truth — it's the literal bytes the live site is serving.

Keep these around. They're cheap (~150KB each) and invaluable when debugging.

## Naming convention

`{site}-v{version}-{YYYYMMDD}.zip`

Examples:
- `ftt-booking-site-v0.17-20260505.zip` — FTT booking site v0.17, deployed 5 May 2026
- `vakaviti-v1.1-20260505.zip` — Vakaviti v1.1, deployed 5 May 2026

## When to add a new archive

After every deploy to Cloudflare Pages. Same zip you uploaded → copy here with the proper name.

## When to remove old archives

Don't, unless space becomes a concern (which won't happen for years given current sizes). Even old archives have value for investigating "when did this bug start?"
