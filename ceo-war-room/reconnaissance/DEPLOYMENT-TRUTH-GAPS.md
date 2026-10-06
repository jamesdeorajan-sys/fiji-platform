# DEPLOYMENT TRUTH GAPS

Status: ACTIVE — DAY 1–3 READ-ONLY RECONCILIATION
Date: 2026-08-15

## Finding
Historical deployment documentation is materially stale relative to the current estate.

`docs/DEPLOYMENT.md` describes a Cloudflare Pages booking widget deployed manually from ZIP files, with pricing entirely client-side, no secrets, no formal monitoring, and a Pages rollback workflow.

`docs/STATUS.md` is explicitly a 28 April 2026 snapshot and records a v0.10 WhatsApp-centric widget with no Stripe, no email confirmation, no driver app and no analytics dashboard.

Subsequent forensic review has found later systems, branches and production assets that exceed or differ from those assumptions, including Fiji Dash/Nadi Marketplace infrastructure and the live WordPress/Hostinger Fiji Tour Transfers platform.

Therefore these deployment/status documents are useful historical evidence but must not be treated as current production authority.

## Specific stale assumptions requiring reconciliation
1. `DEPLOYMENT.md` assumes current booking-widget deployment is manual ZIP upload to a `fiji-transfers` Pages project.
2. It states all booking logic is client-side and no environment secrets exist.
3. It points to `PRICING_MODEL.md` as source of truth, despite observed pricing-model/code drift.
4. It states there is no formal monitoring, while later branches introduced monitoring/error-sentinel/health-check patterns.
5. `STATUS.md` states no driver app exists, while Fiji Dash lineage later implemented a driver PWA and operational workflow.
6. `STATUS.md` describes WhatsApp-only confirmation and no analytics as of 28 April 2026; current live state must be verified rather than inferred from this snapshot.
7. Neither document represents the live WordPress/Hostinger FTT transactional platform as clarified by the owner.

## CEO rule
Historical deployment documents may inform recovery/rollback understanding but cannot authorize production changes.

Before any RED change, the Production Register must record:
- current public URL
- actual host/project/service
- deployed code source/version where determinable
- database/storage dependencies
- current secrets/bindings where relevant
- payment/booking dependencies
- monitoring/alerts
- backup evidence
- tested rollback path

## Consequence
P0-06 (incomplete production mapping) remains OPEN.

The next production-reconciliation work must compare current Cloudflare/Hostinger/live properties against Git evidence instead of following old deployment instructions.
