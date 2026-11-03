#!/usr/bin/env bash
# One-command LOCAL validation of the Gate 1.5 package. Touches no Cloudflare account: wrangler runs in --local mode (workerd + local SQLite D1) on loopback.
# Usage: bash cloudflare/scripts/run_local_validation.sh [races=200]     (run from driver-v2/; needs Node 22 and `npx wrangler@4.156.2` reachable via npm)
set -euo pipefail
RACES="${1:-200}"; HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"
WORK="$(mktemp -d)"; TOKEN="localproof-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"; PORT="${GATE15_LOCAL_PORT:-8787}"
export WRANGLER_SEND_METRICS=false CLOUDFLARE_API_TOKEN="" CLOUDFLARE_ACCOUNT_ID=""
unset HTTPS_PROXY HTTP_PROXY https_proxy http_proxy
WR="${WRANGLER_BIN:-npx --yes wrangler@4.156.2}"
cleanup() { [ -n "${DEVPID:-}" ] && kill "$DEVPID" 2>/dev/null || true; rm -rf "$WORK"; }; trap cleanup EXIT
echo "== 1. package safety assertion";                node "$HERE/scripts/assert_package_safe.mjs" >/dev/null && echo "   PASS"
echo "== 2. isolation negative controls";             node --no-warnings --test "$HERE/tests/safety.test.mjs" 2>&1 | grep -E "^# (tests|pass|fail)"
echo "== 3. deterministic Gate 1 + 1.5 suites";       (cd "$ROOT" && node --no-warnings --test tests/gate1.test.mjs tests/stress.test.mjs tests/gate15_policy.test.mjs 2>&1 | grep -E "^# (tests|pass|fail|skipped)")
echo "== 4. local D1 schema (LOCAL sqlite, not Cloudflare)"
(cd "$HERE" && $WR d1 execute DB --local --persist-to "$WORK" --file schema/gate15_d1_schema.sql >/dev/null)
echo "== 5. start local workerd on 127.0.0.1:$PORT"
(cd "$HERE" && exec $WR dev --local --persist-to "$WORK" --port "$PORT" --ip 127.0.0.1 --var "GATE15_CONTROL_TOKEN:$TOKEN" >"$WORK/dev.log" 2>&1) &
DEVPID=$!
for i in $(seq 1 60); do curl -fsS -m 2 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS -m 2 "http://127.0.0.1:$PORT/healthz" >/dev/null
echo "== 6. real-HTTP proof ($RACES contested races)"
(cd "$ROOT" && GATE15_BASE_URL="http://127.0.0.1:$PORT" GATE15_CONTROL_TOKEN="$TOKEN" GATE15_RACES="$RACES" GATE15_TARGET=local-workerd node --no-warnings cloudflare/scripts/gate15_proof.mjs | tail -3)
echo "== 7. teardown script returns the local D1 to empty"
(cd "$HERE" && $WR d1 execute DB --local --persist-to "$WORK" --file schema/gate15_teardown.sql >/dev/null && $WR d1 execute DB --local --persist-to "$WORK" --command "SELECT COUNT(*) AS user_tables FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'" 2>&1 | grep -E "user_tables")
echo "DONE"
