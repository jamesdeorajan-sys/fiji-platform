# Smart Return / Trigger Fill — Stage 1 (SHADOW MODE)

Issue: [#54](https://github.com/jamesdeorajan-sys/fiji-platform/issues/54)
Branch: `ceo/smart-return-trigger-fill-shadow`

Centralized foundation for the 3-storefront transfer revenue engine
(NadiAirportTransfers.com, BookFijiTransfers.com, book.fijidash.com) ->
one route-price truth -> one booking/movement ledger -> one match engine
-> one smart-offer inventory -> one WhatsApp ops channel.

**This branch changes nothing live.** No storefront UI, live fare, D1
binding, or DNS record is touched. Everything here runs against an
in-memory store and synthetic data; see `docs/CEO_RELEASE_REPORT.md` for
the full accounting of what was and wasn't built.

## Layout

```
migrations/            SQL schema: movements, smart_offers, route_price_truth, credit eligibility, duration fields, booking_contact_ref
src/model.js            enums, constants, movement input validation, PII denylist, source-completion helper
src/db.js                 storage adapters: createMemoryStore() (used by every test) + createD1Store() (Stage 2, unused here)
src/geo_seed.js             PLACEHOLDER zone adjacency/distance data — classification/hints only, never feasibility
src/matcher.js                deterministic match engine (reverse/nearby/corridor/extension/multi-leg-chain), completion-based chronology
src/pricing.js                 fare-class eligibility + hard floor enforcement + AU$50 EARN/REDEEM split
src/offers.js                    smart_offers atomic state machine (compare-and-swap transitions)
src/ledger.js                     movement ingestion (idempotent)
src/pipeline.js                    orchestration: persist -> match (best-effort) -> ops card (best-effort)
src/whatsapp_cards.js                internal-only recommendation card builder (never sends)
src/route_price_truth.js              contract validation
src/board.js                            7-day movement board (read-only aggregation)
test/                                    76 tests, node:test, zero dependencies
scripts/demo.js                           run the pipeline + board over the synthetic fixtures
docs/                                      contract, rollback, security review, sample scenarios, CEO release report
```

## Running

```bash
cd smart-return-trigger-fill
node --test test/*.test.js
node scripts/demo.js
```

No `npm install` needed — everything uses Node's built-in `node:test` and
zero external dependencies.
