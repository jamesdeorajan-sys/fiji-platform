# Driver PWA v2 — Gate 1 evidence (isolated, synthetic) — 2026-11-03

**Classification: TESTED_NOT_LIVE.** Nothing here is deployed, migrated or connected to production. Gate 2 remains **HOLD**.

## How to reproduce (no network, no credentials)
```
cd driver-v2
node --no-warnings --test tests/gate1.test.mjs      # G01–G36 (+G16b, G37-meta)         -> 38/38
node --no-warnings --test tests/stress.test.mjs     # G37, G38, G38b, G39               -> 4/4
node --no-warnings scripts/browser_evidence.mjs     # phone viewport + slow network      -> 15/15
node --no-warnings scripts/sample_timelines.mjs     # five diagnostic timelines
```
Requires Node 22 (`node:sqlite`) and, for the browser run only, Playwright + Chromium. Stress seed: `GATE1_SEED` (default 20261103; also run green at 1, 7, 424242).

## Production-untouched assertion
* Every change is under `driver-v2/` (plus an append-only checkpoint in `docs/AGENT_SYNC.md`). `git diff --name-only origin/ceo/driver-pwa-v2-recovery-notes-2026-11-03` lists no other path.
* Database: in-memory `node:sqlite` only (`schema/gate1_isolated_schema.sql`). No D1 binding, database id, hostname, secret, Worker, route, cron/scheduled handler or deployment exists in product code (G03, G06 scan `src/ pwa/ server/`).
* Network: every unit/stress test runs under a guard that records **and throws** on `fetch`, sockets, TLS and DNS. Result: **0 attempts** (G04, G37, G37-meta, `stress-summary.json`). The browser run made **0 non-loopback requests**.
* Messaging: only `CaptureNotifier` exists. Guest, admin and driver WhatsApp/email intents are recorded as `suppressed:true, real_send:false` (326 captured intents in the 100-journey run, **0 real sends**). There is no real messaging adapter in the codebase.
* Money: wallet/commission tables are present only to be asserted unchanged (invariant I7 after every suite). `financialEffectsEnabled:true` is refused with `FINANCIAL_EFFECTS_DISABLED`.
* Identity: driver 1 is the only real-test identity and carries an obvious placeholder number (`+000-GATE1-PLACEHOLDER-1`); the real number was never retrieved or copied. `realPhoneMode` refuses every id except 1 (G02).

## Branch / commits
Branch `ceo/driver-pwa-v2-gate1-isolated`, based on `ceo/driver-pwa-v2-recovery-notes-2026-11-03` @ `288e7f0`. Head SHA is reported with the hand-off message (it cannot be self-referenced in a file committed on that head).

## Files (all new, under `driver-v2/`)
| Area | Files |
|---|---|
| Isolated schema fixture | `schema/gate1_isolated_schema.sql` (drivers, driver_sessions, bookings, booking_events, driver_broadcast_attempts, **driver_offers**, dispatch_runs, dispatch_escalations, driver_evidence, wallets*) — *wallets only to assert untouched* |
| Core | `src/constants.js` (phases, stable reason codes, lifecycle, boundary model), `src/service.js`, `src/diagnose.js`, `src/http.js`, `src/adapters.js` |
| Harness | `test-harness/d1_sqlite.mjs` (D1-shaped adapter, atomic `batch`, chaos interleaving), `network_guard.mjs`, `fixture.mjs`, `invariants.mjs` |
| PWA | `pwa/index.html`, `app.js`, `style.css`, `manifest.webmanifest`, `sw.js`; `server/dev_server.mjs` (127.0.0.1 only; `/__test/*` controls exist only here) |
| Tests / scripts | `tests/gate1.test.mjs`, `tests/stress.test.mjs`, `scripts/browser_evidence.mjs`, `scripts/sample_timelines.mjs` |

## Design as implemented (the contract, made concrete)
* **Offer lifetime (server clock only).** Phase from dispatch start: `<60 s PRIORITY`, `<120 s CONNECTIVITY_GRACE`, `<180 s ESCALATED_DISPATCH`, `>=180 s HUMAN_FALLBACK_REQUIRED`. An offer is actionable while `now < run_start+180 s` **and** (`now < offered_at+120 s` **or** it has reachability evidence: delivery receipt, view, or authenticated session activity). 60 s is a KPI label only — nothing expires or cancels at 60 s.
* **Dispatch targets per sweep (idempotent):** PRIORITY 1 open offer; GRACE 2 open if no open offer has reachability evidence, else 1; ESCALATED up to 3 open (unreachable offers expire first). Decline advances immediately. Pool exhausted, or ≥180 s ⇒ one `HUMAN_FALLBACK_REQUIRED` escalation + critical event; the booking stays `pending` and valid.
* **Atomic first-wins accept** = one `db.batch`: (1) claim `UPDATE bookings … WHERE unassigned AND status='pending' AND offer actionable on server clock AND driver online`; (2) offer → ACCEPTED only if (1) took effect; (3) all other open offers → SUPERSEDED; (4) four critical audit events inserted only for the batch that won. Any failing statement rolls the whole batch back and the result is `AUDIT_PERSIST_FAILED` (never a success).
* **Pre-assignment payload** is a server-built projection (`pickup_zone, destination_zone, distance_km, vehicle_type, fare, payment_method`). Guest fields are only returned by `tripState` to `bookings.assigned_driver_id`; unknown id and "not yours" are indistinguishable.
* **Replay safety:** accept/decline are one-decision-per-offer; lifecycle stages, assignment, fallback and completion are guarded by a partial unique index on `booking_events` plus `NOT EXISTS` guards; evidence uses a client idempotency key.

## All 39 gates
| Gate | Evidence | Result |
|---|---|---|
| 1 synthetic ids cannot collide; non-synthetic refused | `G01` | PASS |
| 2 driver_id=1 only; no second real phone | `G02` | PASS |
| 3 no production D1 binding/ID/hostname | `G03` | PASS |
| 4 capture adapters; any real send fails the test | `G04`, `G37-meta`, browser | PASS |
| 5 wallet/commission disabled and asserted unchanged | `G05`, invariant I7 everywhere | PASS |
| 6 no scheduled handler / deploy / secret / live POST | `G06` | PASS |
| 7 pre-accept payload has no guest PII (service **and** HTTP **and** DOM) | `G07`, browser check 1 & 14 | PASS |
| 8 0–60 s view/decline/accept | `G08` | PASS |
| 9 at 60 s not cancelled; deterministic grace | `G09` | PASS |
| 10 60–120 s grace: delivered-unconfirmed, viewed-late, no-reachability | `G10` | PASS |
| 11 120–180 s escalation, next drivers, first valid accept wins | `G11` | PASS |
| 12 ≥180 s human fallback, booking intact | `G12`, `G38b` | PASS |
| 13 server time at 59/60, 119/120, 179/180 | `G13` | PASS |
| 14 double-tap Accept idempotent | `G14` (sequential + concurrent) | PASS |
| 15 simultaneous accepts cannot both win | `G15` (50 trials), `G38` (200 races) | PASS |
| 16 loser/stale gets stable code; cannot overwrite winner | `G16`, `G16b` (manual staff assignment, staff cancel, mid-batch flip) | PASS |
| 17 expired offer cannot assign | `G17` | PASS |
| 18 request started pre-expiry, arriving after | `G18` (client timestamp ignored) | PASS |
| 19 lost response after commit, safe retry | `G19`, browser offline→reconnect | PASS |
| 20 refresh/reconnect preserves server truth | `G20`, browser reload | PASS |
| 21 decline durable with code, advances, no cancel | `G21` | PASS |
| 22 no-response ends in human fallback, not cancel | `G22` | PASS |
| 23 offline ≠ decline ≠ provider failure | `G23` | PASS |
| 24 fallback idempotent under repeated sweeps | `G24`, `G38b` | PASS |
| 25 critical mutation + audit atomic | `G25` (trigger-injected audit failure; accept and lifecycle) | PASS |
| 26 correlation by booking/offer/driver/actor/time, no PII | `G26`, invariant I9 | PASS |
| 27 stable machine-readable reason codes | `G27` | PASS |
| 28 diagnostic read answers the six questions | `G28`, `diagnostic-timelines.json` | PASS |
| 29 responsibilities not mixed | `G29` | PASS |
| 30 only the winner progresses the trip | `G30` | PASS |
| 31 required sequence enforced | `G31` | PASS |
| 32 invalid/skipped → INVALID_TRANSITION, no corruption | `G32` | PASS |
| 33 repeated stage submission replay-safe | `G33` (concurrent) | PASS |
| 34 evidence failure/retry never false-validates | `G34` | PASS |
| 35 reconnect mid-trip recovers state | `G35`, browser | PASS |
| 36 completion retry duplicates nothing | `G36` | PASS |
| 37 ≥100 consecutive end-to-end journeys, all four zeros | `G37`: 100/100 complete, 8 scenario families | PASS |
| 38 concurrent-accept, repeated sweeps, delayed responses, reconnect in the evidence set | `G38` (200 contested races, random interleaving, 3,237 batches), `G38b` | PASS |
| 39 failures never waived; fix + rerun affected suites + 100-journey | `G39` negative controls; defect log below | PASS |

## 100-journey and race stress (`evidence/stress-summary.json`)
Journeys 100/100 completed · double assignments **0** · forbidden pre-assignment PII exposures **0** · unexpected network sends **0** · lost authoritative transitions **0** · wallet changed **no**. Races: 200/200 had ≥2 open offers and exactly one winner; winners spread across 5 drivers (the race is genuinely contested); 0 duplicate escalations.

## Defects found and fixed during Gate 1 (none waived)
1. **Concurrent duplicate Accept in the same millisecond returned `AUDIT_PERSIST_FAILED`** (loser's audit inserts fired because the win-guard keyed only on `decision_at`). State stayed consistent (rollback) but the result was wrong. Fixed: win-guard also requires no existing `DRIVER_ASSIGNED` event; same hardening applied to Decline. Re-run: G14 + full suites + 100-journey green.
2. **Test gap (found by mutation testing):** removing both first-wins booking guards was *not* caught, because offer-supersede masked them. Added `G16b` (manual staff assignment, staff cancellation, and a mid-batch flip after the pre-check). Added stable result `SUPERSEDED` for "booking no longer assignable".
3. **PWA hid new offers while a trip was active** (found by the browser run). Offers now always render alongside the active trip.
4. Two test expectations were wrong, not the product (G28 decline/fallback boundaries); the diagnostic semantics were then improved: *break point = first un-proven boundary after the last proven one*, declines do not advance the journey, upstream gaps (e.g. a delivery receipt that never arrived) are listed separately.

### Mutation check (tests can fail)
| Mutant | Caught by |
|---|---|
| expiry/window ignored on accept | G13, G17, G18, G27 |
| guest PII added to pre-assignment projection | G07, G38 |
| audit no longer atomic with the mutation | 21 tests incl. G25, G37, G38, G39 |
| both first-wins booking guards removed | G16b (after the fix above) |
| status guard removed (cancelled booking assignable) | G16b |
| only `assigned_driver_id IS NULL` removed | *equivalent mutant*: the overlapping `status='pending'` guard enforces the same invariant (defence in depth, kept) |

## Sample diagnostic timelines — `evidence/diagnostic-timelines.json`
Normal accept · decline→next driver · slow connection (71 s before view; view at 95 s, accept at 98 s) · simultaneous accept (one winner, loser `ASSIGNMENT_ALREADY_TAKEN`) · 180 s fallback (`last proven DRIVER_NOTIFICATION_ATTEMPTED`, reason `HUMAN_FALLBACK_REQUIRED`, subsystem `DISPATCH`, retry `HUMAN`).

## Phone-viewport browser/PWA evidence — `evidence/browser/` (390×844 @2×, touch; CDP slow network 600 ms / 40 KB/s, Accept response delayed 3.5 s)
`01` offer received · `02` CONNECTIVITY_GRACE at 75 s ("Still open") · `03` Accept → **CONFIRMING** (slow network) · `04` assigned only after server confirmation · `05` pickup journey · `06` pickup validation blocked until evidence · `07` evidence stored · `08` pickup validated · `09` passenger on board · `10` destination journey · `11` completed · `12` offline: Reconnecting… + CONFIRMING · `13` reconnect recovered, one assignment · `14` reload recovers server state · `15` competing driver: "already taken", no guest PII. 15/15 checks (`browser-results.json`).

## Unresolved / UNKNOWN (nothing hidden)
* **Competing-driver fixtures.** The brief says the only driver identity is driver 1; Gates 11/15/16 need competitors. Drivers 2..N are synthetic placeholders (`+000-GATE1-SYNTH-n`), exist only in the throw-away DB, and `realPhoneMode` refuses them. Flagging for CEO awareness.
* **UNKNOWN — busy drivers.** The contract is silent on whether a driver with an active trip should receive new offers. Currently eligibility does **not** exclude them (matches the historical code); the PWA shows both. Needs a CEO/ops decision before Gate 2.
* **Design interpretations to confirm:** (a) a delivery receipt, a view, or authenticated session activity all count as reachability evidence, but a delivery receipt is never recorded as "seen"; (b) unreachable offers end at offered_at+120 s, reachable ones at the 180 s envelope; (c) a driver with an old open offer can still accept in 120–180 s only with reachability evidence. Windows are constants in `src/constants.js` — tune from measured Fiji driver behaviour as AGENT_SYNC requires.
* **UNKNOWN — real D1.** Proven on a D1-shaped `node:sqlite` adapter only. The code relies on documented D1 semantics (atomic `batch`, partial unique indexes, `INSERT OR IGNORE … SELECT`, `json_extract`). First proof on real D1 needs an isolated D1 database (not authorised in Gate 1) and is a Gate 2 prerequisite.
* **UNKNOWN — true multi-isolate concurrency.** "Simultaneous" accepts are in-process interleavings against serialized SQLite transactions; the guards are in SQL, so they should hold under D1, but that is unproven.
* **Not built / simulated:** real WhatsApp adapter (HOLD), real object storage (R2) for evidence (the adapter records key + hash only; the PWA "photo" is simulated), review request/receipt are event hooks only (nothing published), service worker is a minimal app shell (registered, not stress-tested), admin/staff console for human-fallback queue is not part of Gate 1 (the escalation row + event exist).
* **Not tested:** real devices, real mobile networks, camera capture, push/WhatsApp deep-link ("Read More") handoff — all Gate 2 scope.
