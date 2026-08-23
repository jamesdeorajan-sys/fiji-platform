# Security map (read-only, staged Access / least-privilege proposal)

## Admin / mutation surfaces found

| Surface | Auth today | CSRF/Origin | Public exposure | Notes |
|---|---|---|---|---|
| vakaviti-marketplace-stage1 | ADMIN_TOKEN cookie-session | Yes (HMAC nonce + Origin/Referer, verified this engagement) | workers.dev only, noindex | Most rigorously hardened surface in the account |
| nadi-dispatch-api | Own `ADMIN_TOKEN` secret | Unknown — not inspectable without source commit | `api.nadiairporttransfers.com`, `api.fijidash.com` (both public custom domains) | Also contains hardcoded `ADMIN_LOGIN_PHONE` literal — see secret scan |
| vakaviti-onboard | Own `ADMIN_TOKEN` secret | Unknown | workers.dev only | Writes to `partners`/`embed_config`/`contact_channels` in the shared vakaviti-kb DB |
| vakaviti-reviews | Own `ADMIN_TOKEN` secret | Unknown | workers.dev only | Writes to `reviews` |
| vakaviti-zone-manager | `MANAGER_KEY` secret + independent `CF_API_TOKEN` | Unknown | workers.dev only, but scheduled weekly (2 near-duplicate crons) | The only Worker in the account that can act on Cloudflare's own API on its own account's behalf |

Three separate `ADMIN_TOKEN`-shaped secrets exist across the account (marketplace-stage1,
nadi-dispatch-api, vakaviti-onboard/reviews may share one — not confirmed without source access)
with no evidence of coordinated rotation, and **zero Cloudflare Access applications** exist
anywhere in the account.

## Least-privilege observations

- `vakaviti-zone-manager`'s `CF_API_TOKEN` scope cannot be read (secrets are never exposed), but
  its mere existence means a compromise of this one low-traffic, dashboard-edited Worker has a
  blast radius up to the account's own zone/DNS configuration — disproportionate to its apparent
  purpose (weekly compliance/speed auditing).
- `nadi-dispatch-api` is the only Worker holding both an `ADMIN_TOKEN` and public custom-domain
  exposure simultaneously across two different brand domains.

## Staged plan (proposal only — nothing below was executed)

1. **Stage 0 (no infrastructure change):** rotate the `ADMIN_LOGIN_PHONE` out of
   `nadi-dispatch-api` source into a secret binding; audit whether `vakaviti-zone-manager`'s
   `CF_API_TOKEN` can be scoped down to DNS-read + zone-analytics-read only (it does not need
   `#member:edit`/`#organization:edit`, which the account's own token permission list shows are
   available to Cloudflare API tokens issued on this account).
2. **Stage 1:** stand up Cloudflare Access (Zero Trust org has never been created — see the
   2026-08-23 05:58 audit) with email-OTP for James, scoped first to `vakaviti-marketplace-stage1`
   admin routes only (already scaffolded in that app per this engagement's prior work).
3. **Stage 2:** extend Access coverage to `nadi-dispatch-api`'s two custom domains, since they are
   the only account surfaces with both public exposure and a bearer-token admin path today.
4. **Stage 3:** extend Access coverage to the remaining dashboard-only admin Workers
   (`vakaviti-onboard`, `vakaviti-reviews`, `vakaviti-zone-manager`) once each has a real Git
   source to review before wrapping it in a new auth layer blind.
5. **Stage 4:** review and, where possible, replace `vakaviti-zone-manager`'s standing
   `CF_API_TOKEN` with a narrowly-scoped, short-lived token or a scheduled least-privilege service
   token issued through Access.
