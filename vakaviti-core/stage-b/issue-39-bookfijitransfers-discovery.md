# Issue #39 — Book Fiji Transfers infrastructure/source recovery

**Mode honored: strict read-only discovery. No DNS edit. No deployment. No code change. Nothing beyond public DNS lookups and plain HTTP GETs to pages this session would visit anyway as part of inventorying the CEO's own live property.**

## CONFIRMED (2026-09-02 update): the hosting platform is OpenAI's own infrastructure

This is no longer an inference. `robots.txt` on the live site discloses real, functional internal paths (`/owner/`, `/ops`, `/api/owner/`, `/partner/apply`, `/partner/invite/`, `/api/operator-applications`) — themselves a useful finding (a real operator/partner-application backend exists). Following the disclosed `/ops` path with a plain GET (no login attempted, no credentials used):

```
GET https://bookfijitransfers.com/ops
→ 302 Location: /signin-with-chatgpt?return_to=%2Fops
→ 302 Location: https://auth.openai.com/oauth/authorize?response_type=code
    &client_id=oaiapp_Ux7yeuPAZrPbZJW0LZ9sW2xX
    &redirect_uri=https%3A%2F%2Fbookfijitransfers.com%2Fcallback
    &scope=openid+profile+email
    &code_challenge=...&code_challenge_method=S256
→ https://auth.openai.com/log-in
```

**This is a genuine OAuth 2.0 / OIDC authorization-code-with-PKCE flow against `auth.openai.com` — OpenAI's own, real authentication domain, not a lookalike.** The `client_id` prefix `oaiapp_` is consistent with OpenAI's "Apps" client-id naming. `redirect_uri` points back to `bookfijitransfers.com/callback` (which 404s to a bare GET, as expected — it needs a real authorization code). Nothing was submitted to this flow beyond following redirects; no OpenAI account was used or attempted.

**Conclusion, now at high confidence rather than "very likely":** `bookfijitransfers.com` is built and hosted on OpenAI's own app-hosting platform (the "Apps in ChatGPT" / custom-domain product), with owner/operator access gated behind sign-in to the OpenAI account that created it — not any Cloudflare or GitHub credential available in this engagement. This single piece of evidence resolves the "hosting provider" and "ownership/access path" line items below outright, and gives a strong, well-evidenced explanation for "deployment mechanism" and "source repository" (the app almost certainly was built and lives inside that OpenAI product, not as a linkable git repo).

## Prior finding (still valid, now corroborating evidence): the custom-domain layer

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
| Hosting provider/project | **Confirmed: OpenAI's app-hosting platform** (`custom-domains.chatgpt.site` dispatcher + genuine `auth.openai.com` OAuth flow for `/ops` and `/owner/`, `client_id=oaiapp_Ux7yeuPAZrPbZJW0LZ9sW2xX`). Not Cloudflare Pages/Workers, not this GitHub org. Exact internal product name (e.g. whether this is a public or beta OpenAI offering) not knowable from outside — that detail would come from whoever's OpenAI account owns it. |
| Source repository/branch/commit | Still not located in any of the 5 repos under `jamesdeorajan-sys`. Now well-explained rather than just plausible: the app almost certainly lives inside the OpenAI product itself (built/generated there), not as a separate linkable git repo. |
| Deployment mechanism | Almost certainly managed entirely within that OpenAI product's own build/publish flow — this session has no visibility into it and none was attempted. |
| API dependencies | Confirmed from R1: `POST /api/quotes`, `POST /api/bookings`, `POST /api/bookings/{reference}/whatsapp` — all same-origin (`bookfijitransfers.com/api/...`). New this pass: `/api/owner/`, `/api/operator-applications` (disclosed via `robots.txt`, not tested) — a real operator/partner-application backend exists on the same platform. |
| Database/storage dependencies | Unknown — no D1/KV/R2 binding was ever found because there almost certainly isn't one *in this Cloudflare account*; OpenAI's platform manages its own. |
| Current live version | Unknown — no version identifier is exposed anywhere in the observed responses. |
| Rollback target | **Still none identified from outside.** The actual rollback/version-history mechanism is whatever OpenAI's app platform provides internally — only accessible via the owning OpenAI account. This remains the hard blocker Issue #36 requires resolved before any cutover work touches this storefront, but the *path* to resolving it is now clear: sign in to the OpenAI account that owns this app (via `/ops` or `/owner/` on the live site) rather than continuing to search Cloudflare/GitHub. |
| Ownership/access path (Issue #39's own explicit ask) | **Resolved.** Access is gated behind OpenAI account authentication (OIDC `openid profile email` scope) on `auth.openai.com`. Whoever controls that OpenAI account is the real owner/operator of this site — not a Cloudflare or GitHub credential. |

## The exact residual scope gap (as required: reported, not worked around)

The wrangler OAuth session used throughout this engagement has confirmed (`wrangler whoami`) scopes including `account (read)`, `zone (read)`, `d1 (write)`, `pages (write)`, `workers_routes (write)`, etc. — **it does not include a DNS-records scope.** `GET /zones/:id/dns_records` and `GET /zones/:id/custom_hostnames` both return `Authentication error, code 10000` for this token, while `GET /zones/:id` (zone metadata only) and `GET /zones/:id/workers/routes` succeed cleanly — this is a genuine, specific scope gap, not a zone-level restriction (the zone itself is `type: "full"`, `paused: false`, `status: "active"`).

**Exact additional permission needed:** a Cloudflare API token (issued via the dashboard, since wrangler's own OAuth grant is a fixed scope list not user-extensible) with the **`Zone → DNS → Read`** permission group, scoped at minimum to the `bookfijitransfers.com` zone (id `9e809d89568519f193876182feba8d4c`). That single addition would let a future pass read the zone's actual configured DNS records directly — confirming or correcting the "likely CNAME-flattened at apex" inference above — without needing any further public-DNS guesswork.

## What was deliberately NOT done

- No DNS record was modified to test or confirm anything.
- No Host-header-spoofed or otherwise non-standard request was sent to `custom-domains.chatgpt.site` — only a plain, ordinary GET, the same kind any browser would send.
- The `/ops` and `/owner/` paths were only ever GET-requested and their redirect chain followed passively — **no OpenAI sign-in was attempted, no credentials of any kind were entered, no account was used.** The chain was followed only as far as `auth.openai.com/log-in` (a public, unauthenticated page) to confirm the domain and OAuth parameters; nothing beyond that.
- The `robots.txt`-disclosed paths (`/owner/`, `/ops`, `/api/owner/`, `/partner/apply`, `/partner/invite/`, `/api/operator-applications`) were checked only for their HTTP status/redirect target — `/api/owner/` and `/api/operator-applications` were not called at all, since they're POST-shaped API paths, not something a plain inventory GET should touch.
- The site was not recreated, forked, or reimplemented anywhere because its source couldn't be found — per instruction, a missing source is reported as a gap, not treated as license to rebuild it.

## Status against Issue #39's release gate

**Not satisfied yet, but the path to satisfying it is now clear.** No rollback target is confirmable from outside OpenAI's platform. What changed this pass: this is no longer an open-ended infrastructure hunt — it's now a single, specific next step: **whoever controls the OpenAI account that owns this app needs to sign in at `bookfijitransfers.com/ops` (or `/owner/`) and report back its actual version-history/rollback mechanism**, since that's the only place it exists. No cutover, contract adoption, or Fare Authority integration work should touch this storefront's production path until that happens.
