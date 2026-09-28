# PRODUCTION REGISTER

Status: ACTIVE — READ-ONLY RECONCILIATION
Last updated: 2026-08-15

Purpose: prove what is actually live, where it runs, what code/config owns it, and how it can be rolled back. A Git artifact is not production truth until matched to a live deployment.

| System | Public URL | Host/platform | Production code source | Data stores | Payment/booking authority | Current verification state | Rollback evidence |
|---|---|---|---|---|---|---|---|
| Fiji Tour Transfers | https://fijitourtransfers.com/ | WordPress / Hostinger | OPEN QUESTION: separate production codebase/theme/plugins, not governed by current HQ repo | OPEN QUESTION | Live transactional marketplace; exact booking/payment stack pending reconciliation | FACT: owner confirms live real-time booking platform | OPEN QUESTION |
| Nadi Airport Transfers | https://nadiairporttransfers.com/ | Cloudflare-oriented estate; exact resource pending | Related code exists in HQ; exact deployed commit/project OPEN QUESTION | OPEN QUESTION | Booking-request flow observed; confirmation/payment boundary pending | FACT: public production surface exists | OPEN QUESTION |
| Fiji Dash booking | https://book.fijidash.com/ | Cloudflare-oriented estate; exact Pages/Worker resources pending | Nadi Marketplace branch lineage; exact deployed SHA OPEN QUESTION | D1/R2/Workers documented historically; exact production bindings pending | Candidate operations/fulfilment authority; current booking/payment boundary pending | FACT: owner supplied live URL; Git lineage confirmed | OPEN QUESTION |
| ComeToFiji | https://cometofiji.com/ | OPEN QUESTION | Referenced as separate private repo historically; unavailable through current GitHub installation | OPEN QUESTION | Discovery/commerce integration pending reconciliation | FACT: owner identifies as core live/build asset | OPEN QUESTION |
| Vakaviti | https://vakaviti.ai/ | Cloudflare-oriented estate; exact resources pending | HQ contains root site/governance/Workers; exact production mapping pending | D1/Workers historically referenced | Knowledge/AI authority direction | HIGH CONFIDENCE live strategic asset; exact runtime mapping incomplete | OPEN QUESTION |
| Lagi | https://lagi.vakaviti.ai/ | Cloudflare-oriented | Worker/PWA lineage documented historically | D1/conversation events historically referenced | Intent/conversation layer | Live history documented; current runtime mapping pending | OPEN QUESTION |

## Reconciliation Checklist Per Production System
- DNS and canonical hostname
- hosting provider/account/project name
- repository and branch
- deployed commit SHA or immutable release identifier
- build/deploy pipeline
- environment variables/secrets owner (names only, never secret values in Git)
- Workers/Pages routes
- D1/KV/R2/Queues/Durable Objects/Cron dependencies
- WordPress theme/plugins and plugin versions where relevant
- payment processor and merchant account relationship
- booking database/system of record
- fare source
- notification channels
- analytics
- Search Console
- GBP relationship
- backup frequency
- last verified restore/rollback
- incident owner
- last production verification timestamp

## Production Rule
No RED-class change is authorized until the affected row has sufficient deployment, backup and rollback evidence to recover safely.
