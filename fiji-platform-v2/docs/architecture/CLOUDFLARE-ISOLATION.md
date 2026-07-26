# Cloudflare Isolation

## Forbidden V1 bindings

- `vakaviti-kb`
- `nadi-marketplace-db`
- `CHAT_USAGE`
- every existing V1 R2 bucket
- every existing V1 Worker
- every existing production domain

No V2 environment may reference these names, identifiers, routes, or credentials.

## Planned V2 resources

- `fiji-platform-v2-api-staging`
- `fiji-platform-v2-staging-db`
- `fiji-platform-v2-staging-assets`
- `fiji-platform-v2-events-staging`
- `fiji-platform-v2-preview`

Local emulation and staging are distinct. The committed D1 UUID is deliberately fake/non-deployable. Production configuration, IDs, routes, resources, and domains remain intentionally absent pending approval. Phase 0 performs no Cloudflare deployment or resource creation.
