# Marau PWA -> Bula Happiness: source-backed handover (1 Nov 2026)

Reply to Issue #60 (James's direct request, 31 Oct 23:03Z). Isolated candidate only.
**No production deploy, no real guest messages, no credit activation, no secrets in this file.**
Nothing in the existing Marau build was changed or deleted.

## 1. Exact source
Repo `jamesdeorajan-sys/fiji-platform`. Branch tips read from GitHub on 1 Nov 2026:

| Branch | Tip | Relationship |
|---|---|---|
| `ceo/marau-stage1-preview` | 3ccc5dc (tag `marau-preview-rc1`) | ancestor of all below |
| `ceo/marau-roundtrip-legs` | 6f93ce6 (tag `marau-roundtrip-preview-1`) | ancestor of acceptance |
| `ceo/marau-pilot-readiness` | 7f34cd9 (tag `marau-roundtrip-pilot-rc2`) | ancestor of acceptance |
| `ceo/marau-leg-clarity` | 7755fa9 (tag `marau-leg-clarity-rc3`: 13208ca) | ancestor of acceptance |
| `ceo/marau-rc4-uncertain-return` | 0e4fb8f (tag `marau-rc4-uncertain-return` -> 7df9958) | ancestor of acceptance |
| **`ceo/marau-rc4-acceptance`** | **058177e** | newest docs/acceptance tip. Does NOT contain the copy fix |
| `ceo/marau-rc4-copy-fix` | 8d399b2 (RC4b code 2084bc8, tag `marau-rc4b-copy-fix`) | sibling of acceptance, forked at 7df9958. Fixes the blank "Check and copy message" dialog (acceptance check H4 FAIL on RC4) |
| `ceo/email-followup-worker` / `-nat` / `-fijidash` / `-staff-page` | 3ff4cc5 / 5897656 / 335c26a / 719b5da | NAT-side email *fallback* queue for staff (human replies from the team inbox); not a transactional sender |

**Selected candidate baseline:** `ceo/bula-happiness-isolated-r0` = 058177e + merge of RC4b (no conflicts), merge commit d7eb690. It is built so that the acceptance record and the copy fix are both present. Neither source branch was rewritten.

Source layout (all under `marau/`):
- Worker (guest UI, staff console, API, PWA manifest): `worker/worker.js`, `worker/pages.js` (inline guest page; `<link rel=manifest href=/manifest.json>`), `worker/staff_console.js`
- Domain modules: `real_booking_sync.js`, `nadi_booking_reader.js`, `nadi_source_client.js`, `source_confirm.js`, `experience_offers.js`, `offer_eligibility.js`, `referrals.js`, `guest_contact.js`, `contact_policy.js`, `fiji_time.js`, `vehicle_allocation.js`, `whatsapp_handoff.js`, `ai_assist.js`
- Schema: `migrations/0007`-`0043` (on top of `smart-return-trigger-fill/migrations/0001`-`0006`)
- Tests: `test/*.test.mjs` (Marau), `../smart-return-trigger-fill/test/*.test.js` (engine)
- Configs: `wrangler.toml` (stage1), `wrangler.legs.toml`, `wrangler.rc4.toml`, `wrangler.rc4b.toml`
- Release record: `docs/MARAU_RELEASE_GATE.md`, `docs/MARAU_RC4_ACCEPTANCE_RECORD.md`

PWA facts from source: manifest is **static** and served at `/manifest.json`; install relaunches at start_url `/`; the guest token is kept in `localStorage` as well as `sessionStorage` (iOS installed-app fix, round 24). **No service worker file exists in `marau/worker`** (searched `sw.js`/`serviceWorker`/CACHE/VERSION: none). So today there is no offline cache and no versioned update path; the Issue #60 request for a build indicator + update-path test is therefore a real gap, not a regression.

## 2. James's installed October app: mapping
Cloudflare account lists four Marau Workers (read-only list, 1 Nov):

| Worker | Last modified (UTC) | Config |
|---|---|---|
| `marau-stage1-preview` | 2026-10-04 11:10 | `wrangler.toml`, D1 `marau-stage1-test-db` (e0c81ade...) |
| `marau-stage1-preview-legs` | 2026-10-05 01:24 | `wrangler.legs.toml`, D1 `marau-stage1-legs-db` (80880a7b...) |
| `marau-stage1-preview-rc4` | 2026-10-05 01:25 | `wrangler.rc4.toml`, same legs D1 |
| `marau-stage1-preview-rc4b` | 2026-10-05 01:25 | `wrangler.rc4b.toml`, same legs D1 |

The phone's referral prefix `marau-stage1-preview.helpronline.w...` matches the **original** Worker name `marau-stage1-preview` (workers.dev), not `-legs`/`-rc4`/`-rc4b`. Caveats, stated plainly:
- The visible prefix is consistent with that Worker but is **not proof** of the installed origin. The truncation could not distinguish it from a longer name. The full URL / manifest scope was not seen.
- That Worker was last modified 4 Oct 11:10Z, i.e. the RC1 era (tag `marau-preview-rc1`, 3ccc5dc). The round-trip legs, uncertain-return and RC4/RC4b work was deployed to **other** Workers. If the phone app is the original Worker, it does not have the round-trip/leg features; "Request a change" and referral/contact surfaces do exist in RC1 migrations (0011, 0035-0037).
- Deployed version IDs/code for the original Worker were not retrievable with the tools available here. **To close this:** open the installed app's `/manifest.json` and `/` (version shown in the page source) from the phone browser, or have James run `wrangler deployments list --name marau-stage1-preview`. I did not open any guest link or read Worker code (it can contain preview tokens).

## 3. Why Offers/Deals show empty (evidence, not assumption)
Read-only query of `marau-stage1-test-db` (the DB bound to `marau-stage1-preview`), 1 Nov: `smart_offers` 2 ACTIVE + 3 FILLED, all with `expires_at` on 28 Sep 2026; `marau_experience_offers` 36 published / 10 draft / 8 withdrawn, latest `expires_at` 9 Oct 2026. **Every seeded offer has expired.** That is consistent with the empty states and with an elapsed demo pickup. It is still an inference: I did not run the guest endpoint, and I have not confirmed the phone app is bound to this DB. Ongoing fix for the new work: 18:00 Fiji editions must never show expired rows (explicit empty state), and the demo fixture needs dates generated relative to "now".

## 4. Capability status
Legend: LIVE = verified in production; ISO = verified on isolated hosted preview (per repo evidence, not rerun today); LOCAL = passes in local tests; UNTESTED = built, no test; MISSING; UNKNOWN.

| Capability | Status | Notes |
|---|---|---|
| Real saved-booking sync | ISO (synthetic source) + LOCAL | `NADI_SOURCE_BASE_URL` unset on previews. Nadi read endpoint `ceo/nadi-booking-read-itinerary` 7d268e5 pushed, **not deployed**. Not LIVE |
| Human confirmation state | ISO + LOCAL | Pending/confirmed/uncertain; staff verify with evidence. Real-source confirm tests (9) SKIPPED locally: need the nadi worker checkout |
| Arrival / return legs | ISO (legs/rc4 Workers) | Not on the original Worker |
| Guest private access | ISO + LOCAL | Token links, revoke device, localStorage fix. Physical phone: partial (checklist rows 1-7 open) |
| AI assistant "Ask Marau" | `ai_assist.js` LOCAL; real-model status UNKNOWN | Not verified whether a model binding is configured on previews |
| WhatsApp handoff | ISO | Composes a message, **never sends**; groups are human-managed |
| **Automated email** | **MISSING** | No sender, provider, outbox or template in `marau/`. Copy seen on James's phone ("If WhatsApp is not available we will email you") must be gated on a working email path (Issue #60 point); I did not find that exact string in `worker/pages.js`, so its source location is still to be traced. `email-followup-*` is a staff queue for human replies |
| Offers (experience) | ISO (draft/published/withdrawn, staff-managed) | All seed rows expired. Pricing is **per place**, no party/vehicle basis, no credit field |
| Capacity | LOCAL | `capacity` + allocation; concurrency test file exists (`marau_concurrency`). See engine failures in section 5 |
| Checkout / payment / pay-on-arrival | MISSING | WhatsApp handoff only; no atomic reservation, no payment |
| Credits | Referral rewards exist but **OFF** | Earned-reward integrity rules (`0038`, `offer_eligibility.js`) are separate. **No welcome-grant ledger** |
| Referrals / invite QR | ISO | rewards OFF (hosted `rewards-OFF` evidence) |
| Staff operations | ISO via API; staff console LOCAL browser | Hosted staff console driven only via API (credential rule) |
| Installation | Phone-observed (James) | No service worker, no offline, no version indicator |
| Scheduler / editions | MISSING | No `[triggers]` cron in any wrangler config |
| 18:00 Fiji timezone logic | partial | `worker/fiji_time.js` exists; not an edition publisher |

## 5. Current evidence (run today, 1 Nov, on d7eb690, Node 22.22.0)
- `cd marau && node --test test/*.test.mjs` -> **440 tests: 431 pass, 0 fail, 9 skipped** (43 s). The 9 skips are the real-nadi-worker tests (`NADI_REAL_WORKER_DIR` / checkout not present in this environment). The earlier docs' "401/415/427" are historical counts, not today's.
- `cd smart-return-trigger-fill && node --test test/*.test.js` -> **247 tests: 241 pass, 6 FAIL**. Failing: `offers.js` async-store resolution (3) and `offers_atomicity` hold/fill/release (3: "one offer cannot be sold (held) twice", "hold -> fill is atomic", "released hold can be held again"). The docs recorded 247/247 earlier. **Cause not yet diagnosed** (could be environment, e.g. runtime version, or a regression in `c955110`). These are exactly the inventory-hold behaviours the last-place requirement depends on, so they are a blocker for reusing the engine hold as-is.
- Hosted API / browser / physical-phone evidence: only the historical files in `docs/evidence/` (hosted synthetic journeys 40/40 on `2024b8fe`, etc.). **None rerun today.** Hosted staff console and physical phone steps remain open per `MARAU_RELEASE_GATE.md`.

## 6. Gap vs Issue #60 (reuse / change / gap)
| Need | Reuse | Change | Gap |
|---|---|---|---|
| Saved-booking -> email job | `real_booking_sync` event point | add transactional outbox + idempotent keys | sender, templates, provider, reply routing |
| Private trip | guest sessions/tokens, trip page | revoke + no token in logs/referrer review | email CTA link |
| FJ$500 welcome balance | none (earned-reward ledger stays separate) | new grant type | integer-cents ledger, replay-safe grant per trip |
| Offers | `marau_experience_offers` lifecycle | add pricing basis, max credit, cutoff, cancellation terms, approval identity, quantity unit | simple entry template |
| 18:00 Fiji editions | `fiji_time.js` | | edition table, idempotent publisher, cron trigger, catch-up |
| Immediate booking | allocation, conflict checks | | atomic inventory+credit reservation with expiry, confirmation semantics |
| Staff queue | staff console, follow-up queue | | failed email / uncertain / cancellation views |

Required for launch vs can follow: outbox+sender, ledger, editions, reservation are launch-critical. Optional promotional notifications, referral rewards, AI ranking can follow.

## 7. Release readiness (names only)
Needs, not yet provided: transactional email provider + verified sender domain + reply-to routing (team inbox `tourfijitours@gmail.com` is receiving-only per the follow-up runbook), D1 binding(s) for a production Marau DB, migrations 0035-0043 plus new ones (not applied to production), `NADI_SOURCE_BASE_URL`/`NADI_SOURCE_ADMIN_TOKEN` (deploy of read endpoint), cron trigger. Kill switches proposed: `EMAIL_SEND_ENABLED`, `CREDIT_GRANTS_ENABLED`, `EDITION_PUBLISH_ENABLED`, `CHECKOUT_ENABLED` (all default OFF). Rollback: Worker version rollback; additive-only migrations. Open decisions for James: live credit amount/expiry/stacking/cancellation terms; confirmation semantics for instant booking; sender identity.

## 8. Credential hygiene note
`marau/wrangler*.toml` on existing branches contain a synthetic preview admin test token in `[vars]` (already in public history). It is not reproduced here. Recommend rotating it before any hosted acceptance and moving it to a Worker secret.

## 9. Next action / milestone
Started: yes. This session created the isolated branch and reran tests; no implementation code yet. First milestone (vertical slice, local only): saved booking -> outbox job -> **capture-only sender** -> guest + staff captured emails -> private-trip link, with idempotency and failure-isolation tests; plus welcome-grant ledger and 18:00 Fiji edition logic as pure tested modules. Evidence-based estimate is deferred until the engine-test failures are diagnosed and the installed-origin question is closed.
