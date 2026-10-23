#!/usr/bin/env bash
# Release gate for the NAT route-page taxi FAQ candidate (ceo/nat-route-taxi-faq). Run from a checkout of the exact commit proposed for deployment.
# 1. The src diff against the LIVE base is exactly 22 route pages, 2 lines added each, nothing removed (DoubleTree HELD, untouched);
# 2. every other upload file is byte-identical to the live base; 3. every test passes (taxi-faq.test.js proves the edit is exactly the FAQ).
set -euo pipefail
cd "$(dirname "$0")"
BASE=ba32f80   # live commit (Pages deployment 19ce27ac-2fa7-4a53-a259-dd4887469650, verified against the live site 2026-10-23)
got=$(git diff --numstat "$BASE" HEAD -- src | tr -s "\t" " ")
echo "src diff vs $BASE:"; echo "$got"
[ "$(echo "$got" | wc -l)" = "22" ] || { echo "FAIL: expected exactly 22 changed files"; exit 1; }
echo "$got" | grep -qvP '^2 0 (.*/)?src/transfer/[a-z0-9-]+\.html$' && { echo "FAIL: a change outside the route pages, or not exactly +2/-0"; exit 1; }
echo "$got" | grep -q 'doubletree-sonaisali-island' && { echo "FAIL: DoubleTree is HELD"; exit 1; }
[ "$(git ls-tree -r --name-only HEAD -- src | wc -l)" = "45" ] || { echo "FAIL: upload tree is not the 45-file production tree"; exit 1; }
[ "$(git ls-tree -r HEAD -- src | grep -vP '\t(.*/)?src/transfer/' | sha256sum)" = "$(git ls-tree -r "$BASE" -- src | grep -vP '\t(.*/)?src/transfer/' | sha256sum)" ] || { echo "FAIL: a non-route file differs from $BASE"; exit 1; }
echo "22 route pages +2 lines each; every non-route upload file byte-identical to $BASE"
node --test test/*.test.js > /tmp/nat-taxi-faq-gate.tap 2>&1 || { tail -40 /tmp/nat-taxi-faq-gate.tap; echo "FAIL: tests"; exit 1; }
grep -E '^# (tests|pass|fail)' /tmp/nat-taxi-faq-gate.tap
echo "PASS: NAT taxi FAQ release gate"
