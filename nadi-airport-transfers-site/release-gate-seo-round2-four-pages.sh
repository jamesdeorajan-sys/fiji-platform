#!/usr/bin/env bash
# Gate for NAT SEO ROUND 2, FOUR-PAGE release candidate (Naviti, Shangri-La, Hilton, Pearl). Run from a checkout of the exact candidate commit. NOT approved, NOT deployed.
# DoubleTree is HELD pending ground-team confirmation of the road drop-off: its page must be byte-identical to production.
# 1. the src diff against the approved production base (5144a7f = Pages deployment 89260407) is exactly these four page files and line counts;
# 2. the DoubleTree page, the booking application and every indexing/asset file are untouched (the test suite pins their hashes as well);
# 3. every test in the tree passes.
set -euo pipefail
cd "$(dirname "$0")"
BASE=5144a7f981f29a3c8a1a2280cf636413bdd594d6
want='25 23 nadi-airport-transfers-site/src/transfer/shangri-la-yanuca-island.html
26 24 nadi-airport-transfers-site/src/transfer/naviti-resort.html
30 20 nadi-airport-transfers-site/src/transfer/pearl-south-pacific-resort.html
42 29 nadi-airport-transfers-site/src/transfer/hilton-fiji-beach-resort.html'
got=$(git diff --numstat "$BASE" HEAD -- src | tr -s "\t" " " | sort)
echo "src diff vs ${BASE:0:7}:"; echo "$got"
[ "$got" = "$(printf '%s' "$want" | sort)" ] || { echo "FAIL: the src diff is not exactly the approved four-page set"; exit 1; }
[ -z "$(git diff "$BASE" HEAD -- src/transfer/doubletree-sonaisali-island.html)" ] || { echo "FAIL: the held DoubleTree page differs from production"; exit 1; }
echo "DoubleTree page byte-identical to ${BASE:0:7} (held)"
for f in app.js styles.css route-handoff.js chat-widget.js booking-extras.js booking-extras.css fiji-pickup.js index.html sitemap.xml robots.txt _redirects; do
  [ -z "$(git diff "$BASE" HEAD -- "src/$f")" ] || { echo "FAIL: src/$f changed"; exit 1; }
done; echo "booking application, handoff, home page, sitemap, robots, redirects byte-identical to ${BASE:0:7}"
node --test test/*.test.js
echo "SEO ROUND 2 FOUR-PAGE GATE: PASS at $(git rev-parse --short HEAD)"
