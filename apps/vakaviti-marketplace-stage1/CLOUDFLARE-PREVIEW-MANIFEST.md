# Cloudflare Preview Manifest — Vakaviti Marketplace Stage 1

Status: APPROVED FOR PREVIEW PREPARATION ONLY
Production cutover: NOT AUTHORIZED

## Isolation rule
Create a completely separate Cloudflare deployment boundary for this app. Do not reuse `nadi-marketplace-staging`, `vakaviti-lagi-public`, Fiji Dash driver projects, existing D1 databases, existing KV/R2 stores, or production custom domains.

## Intended preview resources
- Worker/application name: `vakaviti-marketplace-stage1`
- Git repository: `jamesdeorajan-sys/fiji-platform`
- Git branch: `ceo/vakaviti-marketplace-stage1`
- App root: `apps/vakaviti-marketplace-stage1`
- Environment: `preview`
- Custom production domain: NONE
- Production DNS changes: NONE
- Dedicated D1 database: `vakaviti-marketplace-stage1-db`
- Dedicated D1 database ID: `f2753057-4319-40d6-bcd8-84eccd28bfe1`
- Workers AI binding: `AI`
- D1 binding: `DB`
- Admin secret: `ADMIN_TOKEN` (must be set through Cloudflare secret storage, never committed)

## Explicit prohibitions
Do not attach or alter:
- `bookfijitours.com.au`
- `tourfiji.tours`
- `driver.fijidash.com`
- `driver.vakaviti.ai`
- `nadi-marketplace-staging`
- `vakaviti-lagi-public`
- Fiji Dash production resources
- FTT/WordPress resources
- any existing production D1/KV/R2 resource

## Creation order
1. Validate branch and TypeScript in CI.
2. Create isolated preview application/project.
3. Create dedicated preview D1 database.
4. Bind D1 as `DB`.
5. Bind Workers AI as `AI`.
6. Configure `ENVIRONMENT=preview`.
7. Configure `ADMIN_TOKEN` as a Cloudflare secret.
8. Apply schema/migrations to preview D1 only.
9. Deploy preview.
10. Run health, claim-flow, candidate-ingestion and AI-enrichment smoke tests.
11. Record preview URL and resource IDs in CEO Production Register.

## Stage 1 acceptance gates before inviting providers
- health endpoint returns expected preview environment
- no production/custom domain attached
- admin routes fail closed without correct secret
- public operator pages expose neutral verification language
- claim flow persists successfully
- candidate ingestion records provenance and never auto-verifies
- AI output remains suggestions/candidate evidence
- human-gate queue works
- migrations are repeatable on clean preview database
- rollback is delete/disable preview only, with no production dependency

## Production cutover gate
A future BookFijiTours.com.au cutover requires a separate CEO decision after provider pilot, booking attribution, URL/SEO preservation plan, rollback test and commercial-truth verification.
