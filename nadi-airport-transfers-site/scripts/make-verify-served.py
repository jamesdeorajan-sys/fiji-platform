#!/usr/bin/env python3
"""Writes scripts/verify-served.js with the sha256 MANIFEST of the current src/ tree embedded.
Run: python3 scripts/make-verify-served.py   (from the repo root, on the exact commit being deployed)."""
import hashlib, json, os
SNIP = '<!-- Cloudflare Pages Analytics --><script defer src=\'https://static.cloudflareinsights.com/beacon.min.js\' data-cf-beacon=\'{"token": "40d766fdaddc4cb68ce32a56801f1639"}\'></script><!-- Cloudflare Pages Analytics -->'
man, own = {}, {}
for root, _, files in os.walk('src'):
    for f in files:
        full = os.path.join(root, f); p = os.path.relpath(full, 'src')
        b = open(full, 'rb').read(); man[p] = hashlib.sha256(b).hexdigest()
        if p.endswith('.html'):
            n = b.decode('utf-8').count(SNIP)
            if n: own[p] = n
tpl = open('scripts/verify-served.tpl.js').read()
js = tpl.replace('__MANIFEST__', json.dumps(dict(sorted(man.items())), separators=(',', ':'))).replace('__OWN__', json.dumps(own)).replace('__SNIP__', json.dumps(SNIP))
open('scripts/verify-served.js', 'w').write(js); print(len(man), 'files; own-snippet pages:', own)
