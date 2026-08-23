# Local development — no production, no Cloudflare

This directory exists because the CEO production freeze prohibits any Cloudflare
deployment, and this session's environment does not have Node.js/npm/wrangler
installed (`node`, `npm`, `wrangler` all resolve to "command not found" in both the
bash and PowerShell tool this session used). Real `wrangler pages dev` — the actual
Cloudflare Pages local emulator — could not be run here.

To still produce genuine, executable local evidence rather than an untested design,
these two scripts port the **behavior** (not the literal Cloudflare-only APIs) into
Python, which is available in this environment:

- `local_static_emulator.py` — serves the static site from `apps/nadi-guest-widget/`
  and applies the same brand-substitution rules as `functions/_middleware.js`
  (title, og:title/description, canonical, JSON-LD, footer, logo-text, and the two
  branded strings in app.js/chat-widget.js), keyed off a `Host` request header —
  standing in for what a real `wrangler pages dev` + Pages Function would do.
  **This is a faithful logic port for local proof, not the deployment artifact.**
  The real artifact is `functions/_middleware.js`, written against Cloudflare's
  actual `HTMLRewriter` API, and it has not been executed by a real Workers runtime
  in this task — only by this Python stand-in.
- `mock_nadi_dispatch_api.py` — an in-memory (non-persistent, resets on restart)
  reimplementation of `nadi-dispatch-api`'s `/quote` and `/bookings` contract,
  including both the **current production behavior** (log-only 0.7x–3x tolerance
  for custom-address bookings) and the **proposed hardened behavior** (reject/
  manual-quote instead of silently accepting an under-priced custom-address
  booking), toggled by a header so both can be tested side by side. No real
  Google Maps key, no real WhatsApp number, no real D1 — sanitized fixture data
  only (`fixtures/`).

Run:
```
python local_static_emulator.py       # serves the static site on :8791
python mock_nadi_dispatch_api.py      # serves the mock API on :8792
python run_tests.py                   # exercises both against the scenarios below
```

Nothing in this directory calls any `*.workers.dev`, `*.pages.dev`, or Cloudflare API
endpoint. Nothing writes to any real D1 database. No real phone number or Maps key
appears anywhere in this directory (verified by the same secret-scan pattern used
throughout this engagement — see `../SECRET_SCAN_RESULT.md`).
