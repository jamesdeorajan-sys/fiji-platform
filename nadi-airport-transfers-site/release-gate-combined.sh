#!/usr/bin/env bash
# Release gate for the CUMULATIVE NAT release candidate (incident 2026-10-11, r3 = 2026-10-12 return-details correction). Run from a checkout of the exact commit proposed for deployment.
# 1. The src diff against the LIVE base is exactly the approved set of files and line counts (nothing else can be in the release);
# 2. styles.css is byte-identical to the live base;
# 3. app.js is byte-identical to the live base EXCEPT inside the function buildWhatsAppURL(), and that function is exactly the approved text
#    (the existing RETURN JOURNEY block from book.fijidash.com added to the normal WhatsApp message). Any other change to app.js fails here;
# 4. every test in the tree passes.
set -euo pipefail
cd "$(dirname "$0")"
BASE=aebfab6   # live commit (Pages deployment b392d9c2)
want='22 1 nadi-airport-transfers-site/src/app.js
29 0 nadi-airport-transfers-site/src/booking-extras.css
379 0 nadi-airport-transfers-site/src/booking-extras.js
84 0 nadi-airport-transfers-site/src/chat-widget.js
103 0 nadi-airport-transfers-site/src/fiji-pickup.js
38 2 nadi-airport-transfers-site/src/index.html'
got=$(git diff --numstat "$BASE" HEAD -- src | tr -s "\t" " " | sort)
echo "src diff vs $BASE:"; echo "$got"
[ "$got" = "$(printf '%s' "$want" | sort)" ] || { echo "FAIL: the src diff is not exactly the approved set"; exit 1; }
[ -z "$(git diff "$BASE" HEAD -- src/styles.css)" ] || { echo "FAIL: styles.css changed"; exit 1; }; echo "styles.css byte-identical to $BASE"
# app.js: compare everything outside buildWhatsAppURL() with the live base, and pin the approved function text.
FN_SHA=59a03cef0a8fc64a055936b1803f61b07a274061236db40f1d2d470c8159b9db   # sha256 of the approved buildWhatsAppURL() text in app.js
BASE_JS="$(git show "$BASE:nadi-airport-transfers-site/src/app.js")" HEAD_JS="$(cat src/app.js)" FN_SHA="$FN_SHA" node -e '
const c = require("crypto"), sha = (s) => c.createHash("sha256").update(s).digest("hex");
const norm = (s) => s.replace(/\r/g, "") + "\n";
const split = (s) => { const a = s.indexOf("function buildWhatsAppURL(ref) {"); if (a < 0) throw new Error("buildWhatsAppURL not found"); const b = s.indexOf("\n}\n", a) + 3; return [s.slice(0, a) + s.slice(b), s.slice(a, b)]; };
const [br] = split(norm(process.env.BASE_JS)), [hr, hf] = split(norm(process.env.HEAD_JS));
if (sha(br) !== sha(hr)) { console.error("FAIL: app.js differs from the live base outside buildWhatsAppURL()"); process.exit(1); }
if (sha(hf) !== process.env.FN_SHA) { console.error("FAIL: buildWhatsAppURL() is not the approved text (" + sha(hf) + ")"); process.exit(1); }
console.log("app.js: identical to the live base outside buildWhatsAppURL(); buildWhatsAppURL() is the approved text");
'
node --test test/*.test.js
echo "RELEASE GATE (NAT combined): PASS at $(git rev-parse --short HEAD)"
