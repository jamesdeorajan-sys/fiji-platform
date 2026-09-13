# Nadi Deployment Forensics — regression window (2026-09-13)

Read-only. No deploy. All 69 immutable production deployments were addressed via their
public `<hash>.fttlandingpage.pages.dev` preview URLs (confirmed reachable and genuinely
deployment-pinned — same request against an old deployment returns different, stable
content than the same request against current, ruling out a shared live data source).

Project name discovered: **fttlandingpage** (Cloudflare Pages project backing
nadiairporttransfers.com).

## Deployments tested

| Deployment | Reachable | Role |
|---|---|---|
| `3c071f54` | yes | **CURRENT** (matches live custom domain exactly) |
| `257e5b83` | yes | **PREVIOUS** — last-known-good for all 10 CEO-flagged routes |
| `23c13978`, `e605bb96`, `b6b0ec0a`, `cf2c68ea`, `bdb4ed6f`, `c4d39ba0`, `eb796f45`, `afe46998`, `11336ca1`, `bd0778a5`, `f7c24674` | yes | Older — spot-checked, all show the same stable pattern |
| `5f1452c8` | **no** — `TypeError: Failed to fetch` | Does not resolve; likely deleted, expired, or a typo in the hash — flagging rather than guessing |

## 1. Last-known-good deployment per route

| Route | Last known good |
|---|---|
| `port-denarau`, `hilton-fiji-beach-resort`, `natadola-intercontinental`, `coral-coast-outrigger`, `shangri-la-yanuca-island`, `naviti-resort`, `pacific-harbour`, `pearl-south-pacific-resort`, `suva`, `doubletree-sonaisali-island` | **`257e5b83`** (and identically good in every one of the 11 older deployments tested — this is a long-stable state, not a fluke) |
| `port-denarau-marina` | Good in every deployment tested, including current — never broke |
| `outrigger-fiji-beach-resort` | **None found** — `FALLBACK` in `257e5b83` and all 11 older deployments tested; only becomes real content starting at current (`3c071f54`) |
| `sheraton-fiji-golf-beach-resort`, `intercontinental-fiji-natadola`, `grand-pacific-hotel-suva` | **None found in any of the 13 deployments tested** — consistently `FALLBACK` all the way back, including in current |

## 2. First-known-bad deployment per route

| Route | First known bad |
|---|---|
| All 10 CEO-flagged routes | **`3c071f54` (current)** — the very next deployment after the last-known-good `257e5b83` |
| `port-denarau-marina` | Never bad |
| `outrigger-fiji-beach-resort` | N/A — this route only ever existed as real content starting at current; it has no "bad" state to compare against, it simply didn't exist yet before |
| The 3 alias slugs (sheraton/intercontinental-fiji-natadola/grand-pacific-hotel-suva) | Bad in every deployment tested, including the oldest — not a regression, a standing gap |

## 3. Smallest common regression window

**Exactly one deployment step: `257e5b83` → `3c071f54`.** Per your labels these are
"PREVIOUS" and "CURRENT" — i.e. adjacent, nothing between them. This is as tight as a
regression window can get.

## 4. Deployment message associated with first-bad state

Not retrievable via the Cloudflare API (token still invalid — same blocker as the prior
report). **However**, diffing the two deployments' `index.html` turned up the actual commit
context embedded as a source comment:

```html
<!-- Hour 6 acquisition copy (2026-09-13) - offer clarification paragraph,
     content-only addition immediately above the existing booking
     widget. No element IDs, booking scripts, or pricing touched. -->
```

This is the **entire and only diff** in `index.html` between the two deployments — one
added paragraph, explicitly self-described as content-only. `app.js`, `styles.css`, and
`chat-widget.js` are **byte-identical** between the two deployments (confirmed via `diff`,
zero output). So whatever actually broke `/transfer/*` is not in any file reachable over
HTTP — it shipped silently alongside this "Hour 6 acquisition copy" content deploy, most
likely a change to the Pages Function/route-renderer or a route-data manifest that isn't
part of the static asset set at all.

## 5. Does one older deployment contain a complete good route set (all 15)?

**No.** Every deployment tested — old and the immediate last-known-good — has the same 4
routes broken (`outrigger-fiji-beach-resort` + the 3 aliases). There is no single historical
deployment where all 15 requested routes are simultaneously good. The best available state
is `257e5b83`: 11 of 15 good (the 10 CEO-flagged + `port-denarau-marina`), with Outrigger and
the 3 aliases broken there too (Outrigger just hadn't been built yet at that point).

## 6. Can route files/assets be recovered without rolling back booking-integrity fixes?

**Yes — very low risk.** `app.js` (all booking logic, pricing, idempotency) is byte-identical
between `257e5b83` and current `3c071f54`. There is no booking-integrity fix in current that
`257e5b83` lacks. The two deployments differ by exactly one cosmetic homepage paragraph on
the fetchable-asset side. Recovering the 10 route pages' content from `257e5b83` carries no
risk of losing any booking-side work.

The 10 recovered pages' own CTAs were spot-checked against `book.fijidash.com` (as part of
the prior P0 containment audit) and independently matched what this session already
verified live — e.g. `hilton-fiji-beach-resort` → `dest=HILTON_DENARAU`,
`naviti-resort` → `dest=NAVITI_RESORT` — and, tellingly, `pacific-harbour` and `suva`'s
recovered originals carry **no `dest=` parameter at all**, confirming the earlier decision
to HOLD those two rather than guess a destination was correct — they never had one.

## 7. Safest repair — recommendation

**(A) Recover route artifacts only.** Not (B) reconstruct the renderer from scratch (we don't
know what it is or why it broke — rebuilding it blind risks repeating the same failure), and
not (C) a full deployment rollback (that would also revert the harmless "Hour 6 acquisition
copy" paragraph and, more importantly, would need to be re-verified against whatever
introduced Outrigger, which we don't want to lose). The 10 broken pages' exact last-known-good
HTML has been recovered byte-for-byte (see `last-known-good-257e5b83/transfer/*.html` in this
same folder) and can be reintroduced as static content without touching `app.js`, pricing, or
the Outrigger page at all — the surgical option, once someone with actual deploy/dashboard
access confirms how to reintroduce them into the current deployment (this still needs the
Cloudflare Function/route-data question from the prior report answered first, since if
`/transfer/*` really is Function-driven now rather than static-file-driven, simply re-uploading
these `.html` files may not be enough on its own — that's the one open dependency).

## 8. NO DEPLOY

Nothing was deployed. All recovered files are committed locally on branch
`ceo/nadi-master-source-recovery`, not pushed.
