# Marau — smallest production-integration plan for the existing booking and human WhatsApp loop

2026-09-28. Issue #54. Planning document only — **no code, no production change, no live send in this document or its preparation.**

## Purpose

Marau (this branch, `ceo/marau-stage1-preview`) has been built and hardened as a fully isolated preview: its own D1 database, its own synthetic booking/offer data, its own admin token, every WhatsApp interaction mocked. This document is the plan for the **smallest possible step** that connects Marau to the *real* systems it is meant to eventually sit alongside — the real booking flow (nadiairporttransfers.com / FijiDash / book.fijidash.com, all backed by the shared Issue #54 engine) and the real, already-working human WhatsApp workflow (ops staff messaging guests directly, entirely outside any app). It does not propose flipping any of that on; it identifies exactly what already exists versus what a real integration would still need, so the actual decision to proceed is James's, made with a concrete, bounded picture rather than an open-ended one.

## What "the existing loop" already is, today, in production

This is unchanged by anything Marau has built and remains exactly as it has operated throughout this whole project (see [[p0-incident-fijidash-release-2026-09-26]] and the WhatsApp-template memories): a guest books on a live storefront, the booking lands in a real database, and **a human ops person handles fulfillment by messaging the guest directly on WhatsApp** — not through any automated send, not through any app. Marau was explicitly instructed, from its very first authorization, never to replace or route around that loop, only to potentially sit *alongside* it as a guest-facing trip/deals surface. That constraint is unchanged here.

## Implemented today (Marau preview, verified through round 10)

| Capability | Status |
|---|---|
| Guest booking capture, immediate secure access (no waiting for confirmation) | ✅ Built, tested locally (349+ tests) and against real hosted D1 (round 9–10) |
| Trip view: current + past bookings, Fiji-time-correct display, change requests | ✅ Built and verified |
| Deal browsing and requesting, with idempotent, race-safe request handling | ✅ Built and verified |
| Admin confirm/decline of deal requests, with atomic vehicle/time exclusivity across offers **and** ordinary bookings | ✅ Built and verified, including two additional real-infra concurrency checks this round |
| Confirmation/recovery lifecycle: non-final claim states, statement-level ownership, stable journal identity, resource-level ownership (`smart_offers.marau_attempt_id`), commit boundary, audit-repair vs. interrupted-recovery distinction | ✅ Built, independently reviewed (round 8), and re-verified against real hosted D1 with real SQL fault injection (round 10) |
| WhatsApp handoff — composed message shown to the guest/ops, **never sent, never a `wa.me` link** | ✅ Built and verified; this is a deliberate design constraint, not a gap |
| PWA install, token persistence across close/reopen (browser-storage evidence; real-device evidence still pending James's own test) | ✅ Built and verified locally; ⏳ device checklist outstanding |
| Isolated hosted deployment (`marau-stage1-preview.helpronline.workers.dev`, its own D1) | ✅ Live |

## What is still required for any real production integration — nothing here is built yet

1. **Real booking source.** Marau's own `marau_test_bookings` table is a self-contained, Marau-only booking record, populated only through Marau's own synthetic test-harness form. It has no connection to the real bookings landing on nadiairporttransfers.com/FijiDash/book.fijidash.com (the `movements` table in the shared Issue #54 engine). A real integration needs a decision on **how a real guest gets a Marau trip at all**: most likely, a link sent alongside the guest's existing real booking-confirmation message (SMS/WhatsApp/email, all currently human-or-existing-automation-driven, unchanged), pointing at a Marau session created from that real booking's own data — not a new booking captured a second time through Marau's own form.
2. **Real deal/offer sourcing.** Every offer a Marau guest can see today is seeded synthetically by hand. Real deals depend on the Issue #54 engine's own `discoverOffer`/`validateOffer`/`activateOffer` pipeline, which in turn depends on **ops-verified vehicle/availability data that Issue #54 itself has been missing since 2026-09-14** (a pre-existing, longstanding gap, not something Marau introduced or can itself close).
3. **Real vehicle/driver assignment data.** Marau's `vehicle_windows` table (which its own confirm flow already correctly refuses to proceed without — "unknown vehicle/availability must block confirmation") is entirely hand-seeded in every environment so far. A real integration needs a real feed of this data from however dispatch/assignment actually happens today — which, per this project's own history, is presently **the same WhatsApp group workflow**, not a structured data source. This is the same gap as #2, from a different angle.
4. **A decision on how the human WhatsApp loop and Marau's own mocked handoff relate.** Two real options, not yet decided:
   - **(a) Minimal, reversible:** Marau's composed-message panel gains a real `wa.me` link (one tap opens WhatsApp with the message pre-filled, still requires a human to actually hit send) — a small, deliberate, easily-reversible product decision that was explicitly *deferred*, not rejected, in every round so far ("no AI WhatsApp bot," never "no WhatsApp link at all").
   - **(b) No change:** keep the composed-message panel exactly as it is (copy button, no navigation) and let ops continue exactly as they do today, entirely outside Marau, treating Marau purely as a guest-facing trip/status surface with zero WhatsApp involvement.
   Either is small; neither has been decided, and this plan does not decide it.
5. **A real Cloudflare D1 and Worker for production**, distinct from `marau-stage1-test-db` and `marau-stage1-preview` (both must remain preview-only forever, per every round's own isolation constraint) — its own creation, its own migration rollout (the same 23-migration stack, applied to a fresh production database, following the same review discipline already used for every other production migration in this project), and its own custom domain if `myfiji.app` is the intended public address (not yet configured — no DNS work has been done).
6. **Guest data handling for real PII.** Every guest record in every Marau environment so far is synthetic (`test_data = 1`, `*.example.test` emails, `+1500555...` test phone numbers). A real deployment handles real names, phone numbers, and emails — this needs the same privacy/data-handling review any other real-guest-data system in this project already goes through, not a new one invented for Marau specifically.
7. **Monitoring and an ops runbook**, matching what the other live properties in this project already have (health checks, alerting, a documented rollback path) — none of that exists for Marau yet because nothing of Marau's has been in a position needing it until now.

## The smallest actual step, if James wants to take one

Given all of the above, the smallest **real** integration step that is meaningfully smaller than "turn on all of it" is:

**Phase 1 (smallest, fully reversible):** pick **one** real, already-confirmed booking on one storefront, manually create the matching Marau session/trip for it (the same way this round's hosted-acceptance seeds were created — direct, reviewed D1 writes, not a new automated pipeline), and give **one real, consenting guest** the resulting Marau trip link, entirely by hand. No deal/offer capability is exposed in this phase (skip gaps #2/#3 entirely by simply not offering any deal to this one guest). The human WhatsApp loop is completely untouched — ops keeps doing exactly what they do today; Marau is purely an additional, read-only-ish trip-status link this one guest also has. This tests exactly one thing: whether a real guest, on a real phone, on a real booking, finds the Trip view useful and the install/reopen flow (this round's one still-outstanding gap) actually works for them — with a blast radius of one person and an instant, trivial rollback (stop sending that one link).

**Phase 2 (only after Phase 1's result is reviewed):** if Phase 1 is worth continuing, decide #2/#3 (real offer sourcing) and #4 (WhatsApp link or not) as their own, separate, explicit decisions — each is independently smaller than doing both at once.

**Phase 3:** production Cloudflare resources, domain, monitoring, and a real rollout plan — only after Phases 1–2 have produced enough real signal to justify the operational cost of standing those up.

This plan proposes nothing be executed without a further, explicit go-ahead — it exists to make the size and shape of "smallest step" concrete and reviewable, per this round's instruction.
