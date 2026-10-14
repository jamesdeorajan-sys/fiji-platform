#!/usr/bin/env bash
# Gate for the NAT car-rental release candidate (/nadi-airport-car-rentals/). Run from a checkout of the exact candidate commit. NOT approved, NOT deployed.
# 1. the src diff against the live production tree (b9dd9a8 = Pages deployment 4513f7e2) is exactly: the new page, its two scripts, three navigation lines on the home page and one sitemap entry;
# 2. the only other changed files are this gate and the two test files;
# 3. every test in the tree passes.
set -euo pipefail
cd "$(dirname "$0")"
BASE=b9dd9a8dca6bb25857ac4621c576f613b21e9ab0
want='A	nadi-airport-transfers-site/src/nadi-airport-car-rentals/index.html
A	nadi-airport-transfers-site/src/rental-assets/rental-core.js
A	nadi-airport-transfers-site/src/rental-assets/rental.js
M	nadi-airport-transfers-site/src/index.html
M	nadi-airport-transfers-site/src/sitemap.xml'
got=$(git diff --name-status "$BASE" HEAD -- src | sort)
echo "src diff vs ${BASE:0:7}:"; echo "$got"
[ "$got" = "$(printf '%s' "$want" | sort)" ] || { echo "FAIL: the src diff is not exactly the approved set"; exit 1; }
others=$(git diff --name-only "$BASE" HEAD | grep -v '^nadi-airport-transfers-site/src/' | sort)
wantother='nadi-airport-transfers-site/release-gate-nat-rental.sh
nadi-airport-transfers-site/test/rental-page.test.js
nadi-airport-transfers-site/test/route-seo-round2.test.js'
[ "$others" = "$(printf '%s' "$wantother" | sort)" ] || { echo "FAIL: unexpected non-src changes:"; echo "$others"; exit 1; }
for f in app.js styles.css route-handoff.js chat-widget.js booking-extras.js booking-extras.css fiji-pickup.js robots.txt _redirects; do
  [ -z "$(git diff "$BASE" HEAD -- "src/$f")" ] || { echo "FAIL: src/$f changed"; exit 1; }
done; echo "booking application, handoff, extras, robots and redirects byte-identical to ${BASE:0:7}"
[ -z "$(git diff "$BASE" HEAD -- src/transfer)" ] || { echo "FAIL: a transfer page changed"; exit 1; }
echo "every transfer page (including the held DoubleTree page) byte-identical to ${BASE:0:7}"
node --test test/*.test.js
echo "NAT RENTAL GATE: PASS at $(git rev-parse --short HEAD)"
