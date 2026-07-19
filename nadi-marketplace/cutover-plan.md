# Phase 1 cutover plan — PREPARED, NOT EXECUTED

**This is a hard stop.** Nothing in this document has been actioned. Cutover requires James's
explicit sign-off in a separate conversation, per instruction — this file exists so that sign-off
can be an informed decision, not a blocker to get past automatically.

## A real finding this plan has to account for: the spec's "single URL swap" premise doesn't hold

The spec's cutover procedure (Section 9 close) says: *"Point the existing live widget's booking
submission at the new Worker API endpoint (this is the only change to the live site — a single
endpoint URL swap, not a redesign)."*

Checked what the live widget's booking submission actually does today, rather than assume the spec's
premise was still accurate — it isn't:

- `ftt-booking-site/src/app.js` has **no fetch() call to any booking API**. On confirm, it does two
  things: fires a lead notification to the `vakaviti-leads` Worker (`WORKER_URL`, `site_id:
  'op_nadi_001'` — an email to James, unrelated to driver dispatch), and builds a `wa.me/...` deep
  link (`buildWhatsAppURL()`) that the **guest** taps to manually send a pre-filled WhatsApp message
  to the business number. A human reads that message and handles the booking — there is no automated
  dispatch today.
- `ftt-booking-site/src/worker.js` does have a `POST /api/booking` route, but it's a stub — its own
  comment says *"In production: save to D1 database or send via email/webhook"* — it generates a
  reference code and returns `{success: true}` without persisting anything. Nothing in `app.js` calls
  it.

**Consequence:** there is no single existing endpoint to redirect at `nadi-dispatch-api`. Real
cutover needs a genuinely new piece of work this Phase 1 build hasn't built yet — a public,
guest-safe `POST /bookings` endpoint on `nadi-dispatch-api` (the only booking-creation endpoint that
exists right now is `POST /admin/test-booking`, which is admin-token-gated and explicitly documented
in every milestone report as "real guest widget integration is still out of scope") — plus wiring
`app.js`'s confirm handler to call it instead of (or alongside) the current WhatsApp-handoff. That is
real, unbuilt scope, not a same-day URL edit, and building it wasn't asked for in this session's
instructions (which said prepare the plan, not build the missing piece it depends on). Flagging this
now rather than writing a plan that implies cutover is one line away when it isn't.

## What cutover would actually require, in order

1. ~~**Build the missing piece**~~ **DONE** (separate session after this plan was written) — real,
   public `POST /bookings` on `nadi-dispatch-api`, guest-safe validation, server-derived
   `settlement_amount_fjd`/`fuel_multiplier_applied` (never client-trusted, since this is now an
   anonymous-caller endpoint feeding real driver commission math), IP-based rate limit. Full report
   and real evidence in `README.md`'s Milestone 6 section. **Building this did not authorize
   cutover** — that's still step 2 onward, still James's call.
2. **Wire `app.js`'s confirm handler** to call it — replacing or supplementing the current
   WhatsApp-deep-link handoff. This *is* close to the spec's "single URL swap" once step 1 exists,
   but decide deliberately whether the WhatsApp-handoff stays as a fallback/backup channel or is
   fully replaced — not decided yet, real product question for James, not a default to pick silently.
3. **Deploy Section 8's guest-widget fuel line** (prepared, `section8-guest-widget-fuel-line.md`) at
   the same time or before, since it's the one other planned change to this same file.
4. Re-run Section 9's test plan item 1 for real at that point — it's the one item this session
   couldn't honestly test, and it becomes testable (and necessary) once there's an actual endpoint to
   test against.

## Rollback plan — this part is genuinely ready

- **The old flow needs no changes to stay rollback-ready** — `ftt-booking-site`'s current deploy
  (WhatsApp-handoff + lead-notification email) is untouched, confirmed via `git diff --stat` showing
  zero changes to `ftt-booking-site/` across this entire build (Section 9 item 7). It stays exactly
  as deployable as it is today, with zero dependency on `nadi-marketplace-phase1-staging` existing at
  all.
- **Rollback mechanism**: since cutover (once built) is a code change to `app.js`'s confirm handler,
  not a DNS/routing change, rollback is a revert-and-redeploy of that one file via the same zip-upload
  process already used for this site — no infrastructure to unwind, no DNS TTL to wait out.
- **Isolation holds throughout**: confirmed via the Cloudflare API (`wrangler pages project list`,
  Section 9 item 8) that `nadi-marketplace-staging` and `nadiairporttransfers` share zero domains.
  `nadi-marketplace-db` is a fully separate D1 database from `vakaviti-kb`. Nothing about cutover, when
  it happens, touches DNS or a shared resource — it's a source change to one file, always revertible.
- **Monitoring window**: spec's own guidance (first 48 hours closely watched: bookings, WhatsApp
  delivery, driver accept flow) is sound and unchanged by this finding — still the right plan once
  step 1 above exists and cutover actually happens.
- **Keep-old-deployable window**: per spec Section 0.5, the pre-cutover flow (WhatsApp-handoff) should
  stay deployable for 1-2 weeks post-cutover. Since nothing about it needs to change even after
  cutover (it can coexist as a fallback per the open question in step 2), this requirement is easy to
  satisfy once the product decision in step 2 is made.

## Status

**Not ready to execute.** Step 1 is now built and real-evidenced (Milestone 6). What's still
outstanding: step 2 (wiring `app.js` to actually call it, and the WhatsApp-handoff-fallback product
decision that requires), step 3 (deploying Section 8's fuel line, still just prepared), and re-running
Section 9 item 1 for real once there's an actual endpoint for the live widget to hit. None of that has
been done. **This remains a hard stop pending James's explicit sign-off**, unchanged by step 1 being
done — building the endpoint was scoped and requested separately from authorizing cutover itself.
