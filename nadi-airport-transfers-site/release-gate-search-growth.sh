#!/usr/bin/env bash
# Release gate for the NAT search-growth candidate (ceo/nat-search-growth-r1). Run from a checkout of the exact commit proposed for deployment.
# 1. The src diff against the LIVE base is exactly 8 existing pages edited + 1 new page (DoubleTree HELD, untouched);
# 2. every other upload file is byte-identical to the live base; the upload tree is the 45 production files + the 1 new page;
# 3. every test passes.
set -euo pipefail
cd "$(dirname "$0")"
BASE=49d0776   # live commit (Pages deployment 658a9733-d75b-4632-a765-88c8c91c8a49, verified against the live site 2026-10-25)
got=$(git diff --numstat "$BASE" HEAD -- src | awk '{print $3}' | sed 's#^.*src/##' | sort)
want=$(printf '%s\n' index.html nadi-airport-transfers-with-child-seats/index.html sitemap.xml transfer/hilton-fiji-beach-resort.html transfer/naviti-resort.html transfer/pearl-south-pacific-resort.html transfer/port-denarau-marina.html transfer/port-denarau.html transfer/shangri-la-yanuca-island.html | sort)
echo "changed upload files vs $BASE:"; echo "$got"
[ "$got" = "$want" ] || { echo "FAIL: changed-file set differs from the 9 approved files"; exit 1; }
echo "$got" | grep -q doubletree && { echo "FAIL: DoubleTree is HELD"; exit 1; }
[ "$(git ls-tree -r --name-only HEAD -- src | wc -l)" = "46" ] || { echo "FAIL: upload tree is not 45 production files + 1 new page"; exit 1; }
others() { git ls-tree -r "$1" -- src | grep -vP '\t(.*/)?src/(index\.html|sitemap\.xml|nadi-airport-transfers-with-child-seats/|transfer/(hilton-fiji-beach-resort|naviti-resort|pearl-south-pacific-resort|port-denarau-marina|port-denarau|shangri-la-yanuca-island)\.html)$' | sha256sum; }
[ "$(others HEAD)" = "$(others "$BASE")" ] || { echo "FAIL: another upload file differs from $BASE"; exit 1; }
echo "9 files changed/added; all other upload files byte-identical to $BASE"
node --test test/*.test.js > /tmp/nat-search-growth-gate.tap 2>&1 || { tail -40 /tmp/nat-search-growth-gate.tap; echo "FAIL: tests"; exit 1; }
grep -E '^# (tests|pass|fail)' /tmp/nat-search-growth-gate.tap
echo "PASS: NAT search-growth release gate"
