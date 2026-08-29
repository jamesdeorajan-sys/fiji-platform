# Branded Domain Decision — Stage 1 Marketplace

> **CEO DECISIONS 2026-08-30:** `marketplace.vakaviti.ai` is **APPROVED FOR PLANNING ONLY**
> (decision 2) — no DNS, route, certificate, Worker, or indexing change is authorized by this. The
> Lagi/root-domain relationship below is **DEFERRED** (decision 3) — do not alter `vakaviti.ai`,
> Lagi, or its existing deployment. See `CEO-DECISIONS-2026-08-30.md`.

## Important cross-project fact (must be resolved before picking a hostname)

This session's own context indicates `vakaviti.ai` (the root domain) is **already the live main
domain for a different, existing Vakaviti product** — the "Lagi" AI concierge / chat-widget partner
network (its own D1 database, its own partner table, its own dashboard at
`dashboard.vakaviti.ai` and join flow at `join.vakaviti.ai`). This Stage 1 marketplace
(`vakaviti-marketplace-stage1`, the codebase this whole document set concerns) is a **separate
Cloudflare Worker with its own, different D1 database** and appears to be a distinct, newer
initiative, not the same system as Lagi.

**CEO INPUT REQUIRED, before any hostname choice below is safe to act on:** are Stage 1 and the Lagi
concierge product meant to become one unified Vakaviti presence, stay permanently separate, or is
Stage 1 actually the intended eventual replacement/successor for part of Lagi's scope? This
document cannot recommend a hostname without knowing whether it risks colliding with, or confusing
visitors against, an already-live product on the same brand.

## Options compared

| Option | Pros | Cons | Readiness today |
|---|---|---|---|
| **Root `vakaviti.ai`** | Simplest, most trusted-looking URL | **Likely already in use by the Lagi product** (see above) — using it for Stage 1 too, without a resolved relationship between the two products, risks visitor confusion or an actual routing conflict | Not safe to assume available — CEO decision required first |
| **`marketplace.vakaviti.ai`** | Clearly names what it is; no collision risk with the root Lagi product; easy to set up as a Cloudflare Worker custom domain independent of whatever serves the root | Slightly less "clean" than a bare root domain | Technically ready — no DNS/route work has been done, but nothing here blocks it once authorized |
| **`discover.vakaviti.ai`** | Also collision-safe; frames the product as exploratory/discovery, which matches its actual current maturity (thin supply, "publicly listed ≠ verified" everywhere) | Less obviously "the marketplace" than the `marketplace.` option; naming this before deciding it's genuinely just a discovery tool (vs. a transactional marketplace later) could require a rename | Technically ready |
| **Temporary `workers.dev` soft launch** | Zero DNS work, zero risk of touching the Lagi domain, fully reversible, already how every check this whole engagement has verified the product | Not indexable in any credible way (Cloudflare's own `*.workers.dev` subdomains are not meant for durable public branding); looks unfinished to a skeptical visitor; the CEO's own prior directive already named "no branded domain" as a blocker | **Already the current live state** — zero work required to keep using it |

## Recommendation — APPROVED FOR PLANNING 2026-08-30

**`marketplace.vakaviti.ai`** as the canonical public hostname for Stage 1 is now the approved
planning target (`CEO-DECISIONS-2026-08-30.md`, decision 2), on this exact basis — the Lagi
relationship question (decision 3) is deferred, not resolved, and this hostname was chosen
specifically because it does not require resolving it. This choice:
- Avoids any DNS/routing conflict with the already-live root domain and its existing subdomains
  (`dashboard.`, `join.`) without requiring the CEO to resolve the deeper "are these one product or
  two" question just to unblock a domain choice.
- Is self-explanatory to a visitor.
- Requires no change to the Lagi product's existing DNS at all.

If the CEO resolves the cross-project question in favor of full unification, this recommendation
should be revisited — moving to a unified root-domain experience is a bigger decision than this
document is scoped to make.

**No DNS, route, or domain change has been made.** This is a decision document only.
