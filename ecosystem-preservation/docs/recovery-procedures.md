# Recovery procedures (derived from this phase's preservation artifacts)

These procedures describe how to restore from the artifacts this phase produced. They are
documentation only — no restoration action was performed or tested against production during this
engagement.

## Worker source recovery

1. Locate the target Worker's entry in `worker-manifest.json` (this branch) for its bundle
   SHA-256, compatibility date, bindings, and Cron schedule.
2. Retrieve the matching `.multipart` bundle from the private delivery (`worker_bundles_preserved_
   20260823.zip`, delivered directly to James — not in git).
3. Verify integrity: recompute SHA-256 of the retrieved bundle and compare against the manifest
   value before redeploying anything from it.
4. Redeploy via `PUT /accounts/{account_id}/workers/scripts/{name}` with the multipart body,
   restoring the same compatibility date and bindings recorded in the manifest. Secrets are not
   included in the bundle and must be re-entered from the operator's own secret store — this
   preservation phase never captured secret values.

## D1 recovery

1. Locate the target database's entry in `d1-manifest.json` for its export SHA-256, table list,
   and aggregate row counts.
2. Retrieve the matching `.sql` export from the private delivery (`d1_backups_20260823.zip`,
   delivered directly to James — not in git).
3. Verify integrity: recompute SHA-256 of the retrieved export and compare against the manifest
   value.
4. Restore via `wrangler d1 execute {name} --file={export}.sql` against a **new or explicitly
   confirmed-empty** database — never against a live database still receiving traffic, to avoid
   silent duplicate-row conflicts with rows written since the backup timestamp recorded in the
   manifest.

## Dependency-aware restore order

Because 15 Workers share `vakaviti-kb` (see `vakaviti-kb-dependency-matrix.json`), a full-fleet
restore should restore `vakaviti-kb` itself first, then redeploy dependent Workers in any order —
none of them create the schema themselves at runtime.

## What this phase could NOT capture, and must be sourced separately in a real recovery

- Secret values (ADMIN_TOKEN, API keys, WHATSAPP_TOKEN, CF_API_TOKEN, etc.) — never extracted by
  this or any read-only phase; must come from the operator's own secret manager or be reissued.
- DNS records, zone settings, and Access configuration — not modified or exported this phase;
  Cloudflare's own zone/DNS export tooling should be used directly at recovery time.
- Any Worker with no discoverable Git source and no exportable bundle beyond what
  `content/v2` returned (e.g. `nadi-guest-widget-preview`, a Pages project preserved as a static
  artifact only, not as buildable source).

## Verification after any restore

Re-run the same live health checks performed in the original ecosystem audit (minimal GET requests
to each restored Worker's known routes) before considering a restore complete, and re-run the
secret/PII scan (`verify_findings.py` pattern) against any redeployed bundle before it is ever
committed anywhere.
