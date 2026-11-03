#!/usr/bin/env bash
# READ-ONLY Cloudflare evidence collector for the Gate 1.5 proof. Every call below is an HTTP GET (no writes, no deploys). Run it ONLY from an environment that
# CEO-approved for this purpose, with a READ-scoped API token. It never prints the token. Output: JSON files under $OUT (default evidence/gate15/remote).
#   usage: CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... bash collect_remote_evidence.sh <label: before|after>
# "before" and "after" snapshots (taken around the proof window) are diffed by diff_production_snapshots.mjs to assert production was not touched.
set -euo pipefail
: "${CLOUDFLARE_ACCOUNT_ID:?}"; : "${CLOUDFLARE_API_TOKEN:?}"; LABEL="${1:?before|after}"
WORKER="driver-v2-gate15-isolated"; D1NAME="driver-v2-gate15-isolated-20261103"
OUT="${OUT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/evidence/gate15/remote}"; mkdir -p "$OUT"
api() { curl -fsS -X GET -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" "https://api.cloudflare.com/client/v4$1"; }
A="/accounts/$CLOUDFLARE_ACCOUNT_ID"
echo "== resource identity: the isolated D1";           api "$A/d1/database?name=$D1NAME"                      > "$OUT/$LABEL.d1_isolated.json"
echo "== isolated Worker: script settings (bindings)";  api "$A/workers/scripts/$WORKER/settings"              > "$OUT/$LABEL.worker_settings.json"  || echo '{"note":"worker settings not available"}' > "$OUT/$LABEL.worker_settings.json"
echo "== isolated Worker: workers.dev subdomain state"; api "$A/workers/scripts/$WORKER/subdomain"             > "$OUT/$LABEL.worker_subdomain.json" || echo '{"note":"subdomain endpoint not available"}' > "$OUT/$LABEL.worker_subdomain.json"
echo "== isolated Worker: cron schedules";              api "$A/workers/scripts/$WORKER/schedules"             > "$OUT/$LABEL.worker_schedules.json" || echo '{"note":"schedules endpoint not available"}' > "$OUT/$LABEL.worker_schedules.json"
echo "== custom domains attached to the isolated Worker"; api "$A/workers/domains?service=$WORKER"             > "$OUT/$LABEL.worker_domains.json"
echo "== zone routes that point at the isolated Worker (expect none)"
api "/zones?per_page=50" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const z of JSON.parse(s).result||[])console.log(z.id)})' | while read -r Z; do
  api "/zones/$Z/workers/routes" | WORKER="$WORKER" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=(JSON.parse(s).result||[]).filter(x=>x.script===process.env.WORKER);console.log(JSON.stringify(r))})'
done | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const all=s.trim().split("\n").filter(Boolean).flatMap(l=>JSON.parse(l));console.log(JSON.stringify({routes_pointing_at_isolated_worker:all}))})' > "$OUT/$LABEL.zone_routes.json"
echo "== production metadata snapshot (names/ids/modified_on only - NO production data, NO production D1 queries)"
api "$A/workers/scripts" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=(JSON.parse(s).result||[]).map(x=>({id:x.id,modified_on:x.modified_on,created_on:x.created_on,etag:x.etag}));console.log(JSON.stringify(r,null,1))})' > "$OUT/$LABEL.all_workers_modified_on.json"
api "$A/d1/database?per_page=100" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=(JSON.parse(s).result||[]).map(x=>({uuid:x.uuid,name:x.name,created_at:x.created_at,version:x.version}));console.log(JSON.stringify(r,null,1))})' > "$OUT/$LABEL.all_d1_identity.json"
echo "snapshot '$LABEL' written to $OUT"
