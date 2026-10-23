#!/usr/bin/env bash
# Release gate for the NAT route-page title/description candidate (ceo/nat-route-titles). Run from a checkout of the exact commit proposed for deployment.
# 1. The src diff against the LIVE base is exactly the 13 listed route pages, 2 lines changed each (title + description); DoubleTree untouched;
# 2. every other upload file is byte-identical to the live base; 3. every test passes (route-titles.test.js proves only title/description changed).
set -euo pipefail
cd "$(dirname "$0")"
BASE=a50f436   # live commit (Pages deployment 035d4603-e578-4dde-94f5-0209c67907dd, verified against the live site 2026-10-23)
got=$(git diff --numstat "$BASE" HEAD -- src | tr -s "\t" " ")
echo "src diff vs $BASE:"; echo "$got"
[ "$(echo "$got" | wc -l)" = "13" ] || { echo "FAIL: expected exactly 13 changed files"; exit 1; }
echo "$got" | grep -qvP '^2 2 (.*/)?src/transfer/[a-z0-9-]+\.html$' && { echo "FAIL: a change outside the route pages, or not exactly 2 lines"; exit 1; }
echo "$got" | grep -q 'doubletree-sonaisali-island' && { echo "FAIL: DoubleTree is HELD"; exit 1; }
[ "$(git ls-tree -r --name-only HEAD -- src | wc -l)" = "45" ] || { echo "FAIL: upload tree is not the 45-file production tree"; exit 1; }
[ "$(git ls-tree -r HEAD -- src | grep -vP '\t(.*/)?src/transfer/' | sha256sum)" = "$(git ls-tree -r "$BASE" -- src | grep -vP '\t(.*/)?src/transfer/' | sha256sum)" ] || { echo "FAIL: a non-route file differs from $BASE"; exit 1; }
echo "13 route pages, title + description only; every non-route upload file byte-identical to $BASE"
node --test test/*.test.js > /tmp/nat-route-titles-gate.tap 2>&1 || { tail -40 /tmp/nat-route-titles-gate.tap; echo "FAIL: tests"; exit 1; }
grep -E '^# (tests|pass|fail)' /tmp/nat-route-titles-gate.tap
echo "PASS: NAT route titles release gate"
