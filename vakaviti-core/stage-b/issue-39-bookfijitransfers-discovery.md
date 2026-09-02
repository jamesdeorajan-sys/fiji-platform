# Issue #39 — Book Fiji Transfers infrastructure/source recovery

**Mode honored: strict read-only discovery. No DNS edit. No deployment. No code change. Nothing beyond public DNS lookups and plain HTTP GETs to pages this session would visit anyway as part of inventorying the CEO's own live property.**

## Major finding this pass: the real hosting platform is not Cloudflare Pages/Workers at all

| Evidence | Result |
|---|---|
| `www.bookfijitransfers.com` CNAME (public DNS) | **`custom-domains.chatgpt.site`** |
| That CNAME target's own A/AAAA records | `104.18.22.186`, `104.18.23.186` / `2606:4700::6812:17ba`, `2606:4700::6812:16ba` — Cloudflare-proxied, but a **different** anycast range than the apex's own A records (`172.66.3.26`, `162.159.143.30`) |
| Visiting `custom-domains.chatgpt.site` directly, no Host override | `404`, page titled "Site not found", assets served from `/_sites/dispatch-assets/...` |
| `www.bookfijitransfers.com` live response | `200`, byte-for-byte the same distinctive framework fingerprint (`X-Vinext-*` headers, RSC, Rolldown-bundled assets) as the apex |
| Apex `bookfijitransfers.com` | Serves the identical fingerprint, but via direct A-records rather than a CNAME (expected — DNS doesn't allow a CNAME at a zone apex, so an apex-flattening/ALIAS-style A-record pair is the standard workaround SaaS platforms use for this exact situation) |

**Reading this evidence together:** `/_sites/dispatch-assets/` is the signature of a generic, multi-tenant "custom domain dispatch" router — the same box answers for many different customers' domains and returns a branded 404 when the requested Host isn't recognized. `www.bookfijitransfers.com` is confirmed, via plain public DNS, to be routed through that dispatcher at `chatgpt.site`. The apex serves identical application output through a different Cloudflare-anycast entry point, consistent with the same platform also being configured as the apex's custom hostname (the standard second half of a "give the customer a CNAME for www, an A-record for apex" SaaS onboarding flow) — **this is a well-evidenced strong inference, not a literal DNS record read**, since the apex's own configured record type (A vs. Cloudflare-flattened CNAME) could not be confirmed without zone DNS-read access (see the scope gap below).

**Conclusion:** bookfijitransfers.com is very likely built and hosted on a third-party site-building/deployment platform associated with the domain `chatgpt.site`, not on any Cloudflare Pages project, Worker, or GitHub repository under `jamesdeorajan-sys`. This explains every prior negative result from the R1 pass (not in `wrangler pages project list`, no Worker Custom Domain, no Worker Route, no matching GitHub repo) — those all came back negative because the true origin was never a Cloudflare Workers/Pages product to begin with; Cloudflare here is only acting as the domain's DNS/edge layer in front of an external platform.

**This is reported as a technical finding, not a conclusion about who built it or why.** Only you would know whether `bookfijitransfers.com` was deployed through a specific AI website-builder or app-hosting product that uses this `chatgpt.site` custom-domain mechanism — that's the one piece this session cannot determine from infrastructure alone, and is exactly the "ownership/access path" question Issue #39 asks a human to close out.

## Point-by-point against Issue #39's required evidence list

| Required item | Finding |
|---|---|
| Apex DNS target | A records `172.66.3.26`, `162.159.143.30` (Cloudflare-proxied). Underlying configured record type (literal A vs. CNAME-flattening) not confirmed — needs zone DNS-read. |
| `www` DNS target | **Confirmed via public DNS: CNAME to `custom-domains.chatgpt.site`.** |
| Hosting provider/project | Very likely a third-party platform reachable via `chatgpt.site`'s custom-domain dispatcher (see above) — not Cloudflare Pages/Workers, not this GitHub org. Exact product name not confirmed. |
| Source repository/branch/commit | Still not located in any of the 5 repos under `jamesdeorajan-sys` (re-confirmed no change from the R1 pass). Given the hosting platform is now believed external, the source may simply live outside GitHub entirely (many AI site-builder platforms keep generated source in their own system, not a linkable public repo) — this is a plausible, not confirmed, explanation for the earlier zero-hit search. |
| Deployment mechanism | Unknown — consistent with an external platform's own deploy pipeline, which this session has no visibility into. |
| API dependencies | Confirmed from R1: `POST /api/quotes`, `POST /api/bookings`, `POST /api/bookings/{reference}/whatsapp` — all same-origin (`bookfijitransfers.com/api/...`), so whatever platform this is, it also hosts the backend API, not just static frontend assets. |
| Database/storage dependencies | Unknown — no D1/KV/R2 binding was ever found because there almost certainly isn't one *in this Cloudflare account*; the external platform likely has its own. |
| Current live version | Unknown — no version identifier is exposed anywhere in the observed responses. |
| Rollback target | **Still none identified.** This remains the hard blocker Issue #36 requires resolved before any cutover work touches this storefront. |

## The exact residual scope gap (as required: reported, not worked around)

The wrangler OAuth session used throughout this engagement has confirmed (`wrangler whoami`) scopes including `account (read)`, `zone (read)`, `d1 (write)`, `pages (write)`, `workers_routes (write)`, etc. — **it does not include a DNS-records scope.** `GET /zones/:id/dns_records` and `GET /zones/:id/custom_hostnames` both return `Authentication error, code 10000` for this token, while `GET /zones/:id` (zone metadata only) and `GET /zones/:id/workers/routes` succeed cleanly — this is a genuine, specific scope gap, not a zone-level restriction (the zone itself is `type: "full"`, `paused: false`, `status: "active"`).

**Exact additional permission needed:** a Cloudflare API token (issued via the dashboard, since wrangler's own OAuth grant is a fixed scope list not user-extensible) with the **`Zone → DNS → Read`** permission group, scoped at minimum to the `bookfijitransfers.com` zone (id `9e809d89568519f193876182feba8d4c`). That single addition would let a future pass read the zone's actual configured DNS records directly — confirming or correcting the "likely CNAME-flattened at apex" inference above — without needing any further public-DNS guesswork.

## What was deliberately NOT done

- No DNS record was modified to test or confirm anything.
- No Host-header-spoofed or otherwise non-standard request was sent to `custom-domains.chatgpt.site` — only a plain, ordinary GET, the same kind any browser would send.
- No attempt was made to log in to, enumerate, or otherwise probe whatever platform sits behind `chatgpt.site` beyond the one plain page load above.
- The site was not recreated, forked, or reimplemented anywhere because its source couldn't be found — per instruction, a missing source is reported as a gap, not treated as license to rebuild it.

## Status against Issue #39's release gate

**Not satisfied yet.** No verified rollback target exists. No cutover, contract adoption, or Fare Authority integration work should touch this storefront's production path until a human (most likely you, given the platform is unrecognized from this side) confirms which platform `chatgpt.site` actually is and how its own release/rollback mechanism works.
