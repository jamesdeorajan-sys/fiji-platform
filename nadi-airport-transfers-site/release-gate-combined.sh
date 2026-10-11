#!/usr/bin/env bash
# Release gate for the CUMULATIVE NAT release candidate (incident 2026-10-11). Run from a checkout of the exact commit proposed for deployment.
# 1. The src diff against the LIVE base is exactly the approved set of files and line counts (nothing else can be in the release);
# 2. app.js and styles.css is byte-identical to the live base;
# 3. every test in the tree passes.
set -euo pipefail
cd "$(dirname "$0")"
BASE=aebfab6   # live commit (Pages deployment b392d9c2)
want='29 0 nadi-airport-transfers-site/src/booking-extras.css
379 0 nadi-airport-transfers-site/src/booking-extras.js
52 0 nadi-airport-transfers-site/src/chat-widget.js
103 0 nadi-airport-transfers-site/src/fiji-pickup.js
37 1 nadi-airport-transfers-site/src/index.html'
got=$(git diff --numstat "$BASE" HEAD -- src | tr -s "\t" " " | sort)
echo "src diff vs $BASE:"; echo "$got"
[ "$got" = "$(printf '%s' "$want" | sort)" ] || { echo "FAIL: the src diff is not exactly the approved set"; exit 1; }
[ -z "$(git diff "$BASE" HEAD -- src/app.js src/styles.css)" ] || { echo "FAIL: app.js or styles.css changed"; exit 1; }; echo "app.js and styles.css byte-identical to $BASE"
node --test test/*.test.js
echo "RELEASE GATE (NAT combined): PASS at $(git rev-parse --short HEAD)"
