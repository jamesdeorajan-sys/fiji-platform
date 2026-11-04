#!/usr/bin/env bash
# Release gate for the NAT route-to-vehicle conversion candidate (ceo/nat-route-vehicle-conversion-r1). Run from a checkout of the exact commit proposed for deployment.
# 1. The src diff against the LIVE base is exactly app.js, index.html and funnel-nat.js (no fare, route page, style, hand-off, chat, worker or sitemap file moves);
# 2. every other upload file is byte-identical to the live base and the upload tree has the same file count;
# 3. the new Pages upload is exactly those 3 changed files on top of the live tree; 4. every test passes.
set -euo pipefail
cd "$(dirname "$0")"
BASE=9eff91b   # live commit: every served file was verified byte-identical to this commit on 2026-11-04 (see docs/AGENT_SYNC.md)
got=$(git diff --numstat "$BASE" HEAD -- src | awk '{print $3}' | sed 's#^.*src/##' | sort)
want=$(printf '%s\n' app.js funnel-nat.js index.html)
echo "changed upload files vs $BASE:"; echo "$got"
[ "$got" = "$want" ] || { echo "FAIL: changed-file set differs from the 3 approved files"; exit 1; }
[ "$(git ls-tree -r --name-only HEAD -- src | wc -l)" = "$(git ls-tree -r --name-only "$BASE" -- src | wc -l)" ] || { echo "FAIL: upload tree file count changed"; exit 1; }
others() { git ls-tree -r "$1" -- src | grep -vP '\t(.*/)?src/(app\.js|funnel-nat\.js|index\.html)$'; }
[ "$(others HEAD)" = "$(others "$BASE")" ] || { echo "FAIL: another upload file differs from $BASE"; exit 1; }
git diff --quiet "$BASE" HEAD -- ../workers ../ftt-booking-site ../vakaviti || { echo "FAIL: a Worker or other site changed"; exit 1; }
echo "3 files changed; all other upload files byte-identical to $BASE; no Worker or other site touched"
node --test --test-concurrency=1 test/*.test.js > /tmp/nat-route-vehicle-gate.tap 2>&1 || { tail -40 /tmp/nat-route-vehicle-gate.tap; echo "FAIL: tests"; exit 1; }
grep -E '^# (tests|pass|fail)' /tmp/nat-route-vehicle-gate.tap
echo "PASS: NAT route-vehicle release gate"
