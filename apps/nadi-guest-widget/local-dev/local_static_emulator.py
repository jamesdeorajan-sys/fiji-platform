"""
Local stand-in for `wrangler pages dev` + functions/_middleware.js.

wrangler/Node are not installed in this environment, so this ports the SAME
brand-substitution rules from ../functions/_middleware.js into Python so the
branding behavior can be genuinely exercised and screenshotted locally. The
real deployment artifact remains functions/_middleware.js (Cloudflare
HTMLRewriter API) - this script never touches Cloudflare and is not itself
what would be deployed.

Usage: python local_static_emulator.py [port]
Then, e.g.:
  curl -H "Host: nadiairporttransfers.com" http://localhost:8791/
  curl -H "Host: book.fijidash.com"        http://localhost:8791/
Or point a browser at http://localhost:8791/?__brand=nadiairporttransfers.com
(query-param override included only because browsers can't set custom Host
headers from the address bar - production would key off the real Host header,
exactly as functions/_middleware.js does).
"""
import http.server
import json
import os
import re
import sys
import urllib.parse

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
CONFIG_PATH = os.path.join(ROOT, "brand.config.json")

with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    BRAND_CONFIG = json.load(f)


def resolve_brand(hostname):
    entry = BRAND_CONFIG.get(hostname)
    if entry and "$ref" in entry:
        entry = BRAND_CONFIG.get(entry["$ref"])
    return entry or BRAND_CONFIG["default"]


LD_JSON_DESC = (
    "Fiji Dash operates a real-time, automated driver dispatch marketplace for "
    "airport transfers and private tours across Fiji - a guest requests a ride, "
    "online drivers get the job broadcast to them, and the first to accept is "
    "confirmed within seconds."
)


def rewrite_html(html, brand):
    out = html

    # <title>...Fiji Dash...</title> and any other bare-text "Fiji Dash" mentions
    # (logo-text spans, testimonial signatures, comparison-table header) - all of
    # them are plain text nodes with no other brand-varying substring, matching
    # functions/_middleware.js's BrandTextRewriter.
    out = out.replace("Fiji Dash", brand["name"])
    # The .replace(...) above already covers og:title/description content
    # attributes and JSON-LD "name" values too, since "Fiji Dash" is literal
    # inside those attribute/JSON strings in the source. Handle the two
    # exceptions that need brand-specific (not just substring-swapped) text:
    out = out.replace(
        f'content="{brand["name"]} — Book Your Airport Transfer Instantly"'
        if brand["name"] != "Fiji Dash" else "__no_op__",
        f'content="{brand["name"]} — Book Your Airport Transfer Instantly"'
    )
    out = re.sub(
        r'<meta name="description" content="[^"]*">',
        f'<meta name="description" content="{brand["metaDescription"]}">',
        out,
    )
    out = re.sub(
        r'<meta property="og:description" content="[^"]*">',
        f'<meta property="og:description" content="{brand["metaDescription"]}">',
        out,
    )
    out = out.replace(
        LD_JSON_DESC.replace("Fiji Dash", brand["name"]),
        brand["structuredDataDescription"],
    )
    # Canonical / og:url host swap, path preserved.
    def swap_host(match):
        url = match.group(1)
        parsed = urllib.parse.urlparse(url)
        new_url = brand["canonicalBase"].rstrip("/") + parsed.path
        return match.group(0).replace(url, new_url)

    out = re.sub(r'rel="canonical" href="(https://[^"]+)"', swap_host, out)
    out = re.sub(r'property="og:url" content="(https://[^"]+)"', swap_host, out)

    # Footer legal line - matched by its own distinctive "All rights reserved"
    # phrase (no class/id exists on it in the recovered source).
    out = re.sub(
        r"© 2026 [^<]*All rights reserved\.[^<]*",
        brand["footerLegalLine"],
        out,
    )
    return out


JS_BRAND_LITERALS = [
    ("`Fiji Dash`,", "whatsappMessageBrandLine", lambda v: f"`{v}`,"),
    (
        "Hi Fiji Dash, I'd like to modify booking",
        "whatsappMessageBrandLine",
        lambda v: f"Hi {v}, I'd like to modify booking",
    ),
    (
        "const BRAND_NAME = 'Fiji Dash';",
        "chatWidgetBrandName",
        lambda v: f"const BRAND_NAME = '{v}';",
    ),
    (
        'aria-label="Chat with Fiji Dash"',
        "chatWidgetBrandName",
        lambda v: f'aria-label="Chat with {v}"',
    ),
]


def rewrite_js(text, brand):
    out = text
    for needle, field, wrap in JS_BRAND_LITERALS:
        if needle in out:
            out = out.replace(needle, wrap(brand[field]))
    return out


CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".json": "application/json; charset=utf-8",
}


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("[local-emulator] " + (fmt % args) + "\n")

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)
        override_host = qs.get("__brand", [None])[0]
        hostname = override_host or self.headers.get("Host", "default").split(":")[0]
        brand = resolve_brand(hostname)

        if path == "/":
            path = "/index.html"
        local_path = os.path.normpath(os.path.join(ROOT, "src" if os.path.isdir(os.path.join(ROOT, "src")) else ".", path.lstrip("/")))
        if not local_path.startswith(ROOT):
            self.send_response(403)
            self.end_headers()
            return
        if not os.path.isfile(local_path):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not found (local emulator)")
            return

        ext = os.path.splitext(local_path)[1]
        ctype = CONTENT_TYPES.get(ext, "application/octet-stream")

        with open(local_path, "rb") as f:
            raw = f.read()

        if ext == ".html":
            body = rewrite_html(raw.decode("utf-8"), brand).encode("utf-8")
        elif path in ("/app.js", "/chat-widget.js"):
            body = rewrite_js(raw.decode("utf-8"), brand).encode("utf-8")
        else:
            body = raw

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Local-Emulator-Brand", brand["brandId"])
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
    print(f"Local static emulator serving {ROOT} on http://localhost:{port}")
    print("Brands available:", list(BRAND_CONFIG.keys()))
    http.server.HTTPServer(("0.0.0.0", port), Handler).serve_forever()
