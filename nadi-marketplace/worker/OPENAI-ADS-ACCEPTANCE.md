# OpenAI Ads lead_created candidate — 26 October 2026

Status: implemented and tested offline; NOT deployed; NO conversion API requests, validation requests, WhatsApp messages or production writes were made.

## Baseline and production inspection

Repository default main does not contain the live dispatch Worker. The isolated branch starts at `2a37469` (existing Worker source branch), then recovers the complete production bundle in baseline commit `8cacb17e3dd81518b31953d601dc93911510631e`. This preserves the live rental modules and console, pricing and notification changes that cannot safely be reconstructed from the old branch. Do not deploy the old source branch or merge this into main as a routine small source patch.

Read-only Cloudflare inspection confirmed production deployment `80a23f96-0b3d-4b5a-b13f-c4ac09c9d78f`, version `136d7aeb-fcdb-4818-bb7f-4b1f6b5a8a8d`, 100% traffic, created 26 October 2026 at 13:35:19 Sydney (02:35:19 UTC). The annotation is `Add secret: OPENAI_ADS_CONVERSION_API_KEY`. Existing DB, DOCS, BACKUPS and WhatsApp bindings remain present. Secret NAME verified only; secret VALUE was never retrieved, copied or logged. Production version was rechecked after testing and had not changed.

Recovered production entry-module SHA-256: `e00c599e79d13ae7ca2a276d864ee6acd9b3c2594c930c6bb268476f55510e94` (multipart transport headers/boundary removed; one terminal newline added on recovery). The original source-map reference is present; source map was not recovered. Treat the recovered bundle as the deployment-authoritative baseline, not a replacement for eventual source reconciliation.

## Exact integration delta from recovered baseline

- `worker.js`: import conversion sidecar; schedule it after existing new-booking side effects on successful public `POST /bookings`; add isolated conversion retry sweep to the existing five-minute cron. Existing response objects, pricing, booking persistence, replay notification path and WhatsApp functions are unchanged.
- `openai-ads.mjs`: fixed server-only endpoint `https://bzr.openai.com/v1/events?pid=...`, existing secret in Bearer header, `lead_created` / `customer_action`, saved creation timestamp, stable `nadi_booking_<id>_lead_created` event ID. No purchase/revenue claims. Hash normalized saved email and phone. Never forward raw names, email, phone, notes, itinerary, arbitrary URLs, guest IP or user agent. Source URL is canonical approved origin root. Optional consented `openai_ads.oppref` and `openai_ads.obref` are passed unchanged. Event personalization opt-out is true.
- `milestone39-openai-ads-outbox.sql`: additive table/index only; unique booking ID, event ID and hashed journey fingerprint; pending/sent/validated/rejected/exhausted/expired states; atomic 30-second claim; five-second HTTP deadline; five attempts maximum; exponential backoff; retry batches of ten; stop after six days. Provider bodies are not logged or stored. Outbox contains hashed matching identifiers and optional attribution references; it requires normal access/retention controls.
- `openai-ads.test.mjs`: offline network-guarded unit and real-handler acceptance checks using in-memory SQLite and fake credentials.

## Exclusion and duplicate rules

Only a new successful public `/bookings` save qualifies. Idempotent replay, validation failure, admin test creation, rentals, negotiations and other endpoints cannot schedule conversions. Unknown or preview origins are excluded; only NAT apex/www and book.fijidash.com qualify. Missing stable client reference, phone, pickup date/time or valid creation timestamp is excluded rather than guessed.

Test exclusions: request test flags, saved test flag, whole-word test/testing/dummy/synthetic/smoke/QA markers in saved name/reference/notes/email, reserved example/invalid email domains, repeated-digit/known fixture phone patterns, and the explicitly configured normalized test-phone list. Historical operational test numbers have NOT been authoritatively resolved in this session: activation requires that list be reviewed. A marker filter alone cannot prove every unmarked booking is genuine.

Duplicate journey fingerprint uses normalized phone, pickup/destination zones, pickup date/time, vehicle and return date/time/location. Identical journeys with fresh client references count once even across NAT/FijiDash. Deliberate identical multi-vehicle requests could also be suppressed; review this business rule before launch. Outbox deduplication applies from activation onwards; no historical backfill is implemented. Stable event ID also supports OpenAI's documented platform deduplication if a response is lost after acceptance.

## Acceptance results

Command:

`node --test nadi-marketplace/worker/openai-ads.test.mjs nadi-marketplace/worker/admin_notification_retry.test.mjs nadi-marketplace/worker/notification_fencing.test.mjs nadi-marketplace/worker/driver_broadcast_recovery.test.mjs nadi-marketplace/worker/quote-consent.test.mjs`

**40 passed, 0 failed, 0 skipped.** This includes 12 new conversion tests and 28 existing booking/notification/pricing tests.

New acceptance checks cover disabled/missing configuration (no network or conversion DB access); payload schema/hash checks for NAT/www/FijiDash; test/opt-out/stale/unknown-origin exclusions; optional context consent; concurrent claim and fresh-reference deduplication; validate-only behavior and no automatic promotion; 429/500/network retry versus permanent 400/401/403; original IDs and timestamps on retry; lease/pixel/mode/age/attempt limits; cron retry; five-second hung-provider abort; missing migration and waitUntil failure containment.

Real booking-handler comparison with the recovered baseline covers both NAT and FijiDash origins in disabled, enabled-with-mocked-delivery and missing-migration conditions: HTTP status/body and saved booking rows match (volatile timestamps normalized); all WhatsApp request URLs/bodies match exactly. Successful new genuine saves schedule one mock conversion; same-reference replay, rejected save and marked test save schedule none. Missing conversion schema still yields the same successful booking and WhatsApp behavior.

The live-target `booking-handoff.test.js` suite was observed to skip without NADI_API_BASE_TEST; it is NOT included in the 40-pass acceptance total and was not pointed at production. No live forms were submitted. Wrangler/esbuild were unavailable locally, so a Wrangler dry-run/build has NOT been claimed. Node imported and executed the full candidate successfully.

## Activation requirements — approval still required

Default/missing `OPENAI_ADS_MODE` is off. The existing API key alone cannot activate delivery. No production configuration was changed.

Required reviewed configuration: actual `OPENAI_ADS_PIXEL_ID`; `OPENAI_ADS_MODE` (`validate` or separately approved `live`); `OPENAI_ADS_MEASUREMENT_APPROVED=true` after site measurement policy review; `OPENAI_ADS_TEST_FILTERS_APPROVED=true`; `OPENAI_ADS_TEST_PHONES` as a reviewed JSON array. These flags are an operational gate, not a substitute for the site's actual consent requirements. Requests can additionally opt out with `ads_measurement_opt_out=true`.

The current frontends were not changed. Existing ordinary booking requests can be matched with hashed saved contact identifiers once policy approval/configuration is in place. Automatic capture and cross-domain persistence of `oppref` / `__obref` are NOT implemented here; current requests may lack these references. Browser consent wiring and any Pixel `lead_created` event must be reviewed before live activation. If Pixel also sends this lead, it must use the same Pixel ID and event ID. Do not enable a second independent lead event ID.

Negotiated-offer acceptance and rental enquiries are deliberately outside this first standard-booking integration. Do not describe the result as covering every enquiry type.

After approval: reconcile source ownership, run an offline Wrangler dry-run with no production secrets, confirm binding preservation and latest production baseline, apply only the additive migration, deploy with delivery off, then separately approve a synthetic `validate_only` check and finally live mode. Validation rows are never promoted automatically to real conversions; do not validate genuine guest rows and later reuse that same outbox as a live backfill. No deployment or request to the real conversion endpoint is authorized by this report.

Rollback: disable `OPENAI_ADS_MODE` first; restore production version `136d7aeb-fcdb-4818-bb7f-4b1f6b5a8a8d` if required. Leave additive outbox table intact for audit. Existing booking tables are untouched.

Official contract reviewed: https://developers.openai.com/ads/conversions-api (26 October 2026).
