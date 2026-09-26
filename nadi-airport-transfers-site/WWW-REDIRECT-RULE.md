# Canonical-host redirect for www.nadiairporttransfers.com (NOT applied - needs approval)

Finding (live, 2026-09-27): `https://www.nadiairporttransfers.com/...` answers **200** with the full page
(canonical points at the apex), so search engines can crawl every URL on two hosts.
Cloudflare Pages `_redirects` cannot match on host, so this must be a zone-level **Redirect Rule**
(dashboard: nadiairporttransfers.com -> Rules -> Redirect Rules), not a code change.

Rule (Single Redirect, dynamic):
- Name: www to apex (canonical host)
- When: Hostname equals `www.nadiairporttransfers.com`
- Then: Dynamic redirect
  - Expression: `concat("https://nadiairporttransfers.com", http.request.uri.path)`
  - Status: 301
  - **Preserve query string: ON** (so `?pickup=...&dest=...` deep links survive)

The DNS record for `www` must stay proxied (orange cloud) for the rule to fire.

Verify after applying (read-only):
    curl -sI "https://www.nadiairporttransfers.com/transfer/hilton-fiji-beach-resort?x=1"
    -> HTTP 301, location: https://nadiairporttransfers.com/transfer/hilton-fiji-beach-resort?x=1
    curl -sI "http://www.nadiairporttransfers.com/"  -> 301 to https://nadiairporttransfers.com/ (one hop is ideal)

Rollback: disable or delete the rule; nothing else depends on it.
Reference: `fijidash.com` and `www.fijidash.com` already do this via two Page Rules
(301 to `https://book.fijidash.com/$1`, verified to keep path and query string).
