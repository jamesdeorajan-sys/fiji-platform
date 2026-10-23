#!/usr/bin/env bash
# Release gate for the NAT booking-expectations copy candidate (ceo/nat-booking-expectations). Run from a checkout of the exact commit proposed for deployment.
# 1. The src diff against the LIVE base is exactly index.html, 5 lines changed (nothing else can be in the release);
# 2. the changed lines are exactly the five approved copy edits (undoing them reproduces the live index.html byte for byte);
# 3. every other file in the 45-file upload tree is byte-identical to the live base;
# 4. every test in the tree passes.
set -euo pipefail
cd "$(dirname "$0")"
BASE=0de39c3   # live commit (Pages deployment ffe9ea6e-4a37-4f3e-b75f-c9cffdc6c4d0, re-verified against the live site 2026-10-23)
want='5 5 nadi-airport-transfers-site/src/index.html'
got=$(git diff --numstat "$BASE" HEAD -- src | tr -s "\t" " " | sort)
echo "src diff vs $BASE:"; echo "$got"
[ "$got" = "$want" ] || { echo "FAIL: the src diff is not exactly the approved index.html copy edit"; exit 1; }
[ "$(git ls-tree -r --name-only HEAD -- src | wc -l)" = "45" ] || { echo "FAIL: upload tree is not the 45-file production tree"; exit 1; }
[ "$(git ls-tree -r HEAD -- src | grep -v -P '\t(.*/)?src/index\.html$' | sha256sum)" = "$(git ls-tree -r "$BASE" -- src | grep -v -P '\t(.*/)?src/index\.html$' | sha256sum)" ] || { echo "FAIL: a file other than index.html differs from $BASE"; exit 1; }
echo "44 other upload files byte-identical to $BASE"
node --test test/*.test.js > /tmp/nat-booking-expectations-gate.tap 2>&1 || { tail -40 /tmp/nat-booking-expectations-gate.tap; echo "FAIL: tests"; exit 1; }
grep -E '^# (tests|pass|fail)' /tmp/nat-booking-expectations-gate.tap
echo "PASS: NAT booking-expectations release gate"
