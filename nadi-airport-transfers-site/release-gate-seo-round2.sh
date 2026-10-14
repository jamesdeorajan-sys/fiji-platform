#!/usr/bin/env bash
# Gate for NAT SEO ROUND 2 (five existing resort pages), local candidate. Run from a checkout of the exact candidate commit. NOT approved, NOT deployed.
# 1. the src diff against the approved production base (5144a7f = Pages deployment 89260407) is exactly these five page files and line counts;
# 2. the booking application and every indexing/asset file are untouched (the test suite pins their hashes as well);
# 3. every test in the tree passes.
set -euo pipefail
cd "$(dirname "$0")"
BASE=5144a7f981f29a3c8a1a2280cf636413bdd594d6
want='24 22 nadi-airport-transfers-site/src/transfer/shangri-la-yanuca-island.html
25 23 nadi-airport-transfers-site/src/transfer/naviti-resort.html
30 20 nadi-airport-transfers-site/src/transfer/pearl-south-pacific-resort.html
38 24 nadi-airport-transfers-site/src/transfer/doubletree-sonaisali-island.html
42 29 nadi-airport-transfers-site/src/transfer/hilton-fiji-beach-resort.html'
got=$(git diff --numstat "$BASE" HEAD -- src | tr -s "\t" " " | sort)
echo "src diff vs ${BASE:0:7}:"; echo "$got"
[ "$got" = "$(printf '%s' "$want" | sort)" ] || { echo "FAIL: the src diff is not exactly the approved set"; exit 1; }
for f in app.js styles.css route-handoff.js chat-widget.js booking-extras.js booking-extras.css fiji-pickup.js index.html sitemap.xml robots.txt _redirects; do
  [ -z "$(git diff "$BASE" HEAD -- "src/$f")" ] || { echo "FAIL: src/$f changed"; exit 1; }
done; echo "booking application, handoff, home page, sitemap, robots, redirects byte-identical to ${BASE:0:7}"
node --test test/*.test.js
echo "SEO ROUND 2 GATE: PASS at $(git rev-parse --short HEAD)"
