#!/usr/bin/env bash
# Gate for the NAT SEO route-page CANDIDATE (2026-10-12). Run from a checkout of the exact candidate commit. Local candidate: NOT approved, NOT deployed.
# 1. The src diff against the LIVE base (ac3642e = Pages deployment 18f5caa4) is exactly these six page files and line counts;
# 2. the booking application and its assets (app.js, styles.css, route-handoff.js, chat-widget.js, booking-extras.*, fiji-pickup.js, index.html, sitemap.xml, robots.txt, _redirects) are byte-identical to the live base;
# 3. every test in the tree passes.
set -euo pipefail
cd "$(dirname "$0")"
BASE=ac3642e
want='1 0 nadi-airport-transfers-site/src/transfer/radisson-blu-resort-fiji-denarau.html
1 0 nadi-airport-transfers-site/src/transfer/sofitel-fiji-resort-spa.html
1 0 nadi-airport-transfers-site/src/transfer/westin-denarau-island-resort.html
25 3 nadi-airport-transfers-site/src/transfer/natadola-intercontinental.html
26 4 nadi-airport-transfers-site/src/transfer/coral-coast-outrigger.html
27 4 nadi-airport-transfers-site/src/transfer/port-denarau.html'
got=$(git diff --numstat "$BASE" HEAD -- src | tr -s "\t" " " | sort)
echo "src diff vs $BASE:"; echo "$got"
[ "$got" = "$(printf '%s' "$want" | sort)" ] || { echo "FAIL: the src diff is not exactly the approved set"; exit 1; }
for f in app.js styles.css route-handoff.js chat-widget.js booking-extras.js booking-extras.css fiji-pickup.js index.html sitemap.xml robots.txt _redirects; do
  [ -z "$(git diff "$BASE" HEAD -- "src/$f")" ] || { echo "FAIL: src/$f changed"; exit 1; }
done; echo "booking application, handoff, sitemap, robots, redirects and home page byte-identical to $BASE"
node --test test/*.test.js
echo "SEO CANDIDATE GATE: PASS at $(git rev-parse --short HEAD)"
