# Section 8 — guest widget fuel-price transparency line

**Status: PREPARED, NOT APPLIED.** This file describes the exact change, ready for James to review
and apply, but `ftt-booking-site/src/app.js` and `ftt-booking-site/src/styles.css` — the real, live
production booking site behind nadiairporttransfers.com / fijitourtransfers.com — have **not been
touched**. Written as a standalone patch reference rather than an in-place edit specifically so
nothing here can accidentally end up in a commit or deploy of the live site before Section 9's test
plan passes and James signs off, per instruction.

Per spec guardrail 0.3, this is deliberately the *only* change to the guest-facing widget in all of
Phase 1 — everything else in this addition is additive and non-blocking (fetch failure = the line
just doesn't render; nothing about the existing booking flow, pricing math, or layout changes).

## What it does

Adds one small line to the booking confirmation card, near the "Total price" row:

> ⛽ Prices reflect current Fiji fuel cost: FJ$3.39/L · last updated 1 July 2026

Pulled live from `nadi-dispatch-api`'s new public `GET /fuel-index` endpoint (built in Milestone 5).
This is the **first** fetch() call this widget has ever made to an external API — checked
`app.js` for existing patterns first and found none; pricing today is entirely client-side/local.
That's worth flagging on its own: it's a new runtime dependency on `nadi-dispatch-api` staying up,
even though the line degrades silently (no line shown) if the fetch fails, times out, or the Worker
is down — the booking flow itself does not depend on it and cannot break because of it.

## Exact changes

### 1. `ftt-booking-site/src/app.js` — near the top, alongside other constants (e.g. `formatPrice`)

```js
// Section 8 — fuel price transparency line, reads from nadi-dispatch-api's
// public read-only fuel_index endpoint. Cached per page load; any failure
// (network, non-200, missing element) is silent — this line is decorative,
// never blocking, and must not be able to break the booking flow.
const FUEL_INDEX_API = 'https://nadi-dispatch-api.helpronline.workers.dev/fuel-index';
let cachedFuelIndex = null;

async function updateFuelPriceLine() {
  const el = document.getElementById('fuelPriceLine');
  if (!el) return;
  try {
    if (!cachedFuelIndex) {
      const res = await fetch(FUEL_INDEX_API);
      if (!res.ok) return;
      cachedFuelIndex = await res.json();
    }
    const price = Number(cachedFuelIndex.fuel_price_fjd_per_litre).toFixed(2);
    const updated = new Date(cachedFuelIndex.effective_from + 'T00:00:00')
      .toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
    el.textContent = `⛽ Prices reflect current Fiji fuel cost: FJ$${price}/L · last updated ${updated}`;
  } catch {
    // Silent - decorative line, never surfaces an error to the guest.
  }
}
```

### 2. `ftt-booking-site/src/app.js` — inside `buildConfirmation()`, where `card.innerHTML` is set

Current (verified live in the real file, lines 887-900):
```js
  card.innerHTML = [
    ['Passenger',       `${fn} ${ln}`],
    // ...
    ['Special requests',notes],
  ].map(([l,v]) => `<div class="confirm-row"><span class="confirm-label">${l}</span><span class="confirm-value">${v}</span></div>`).join('')
  + totalRows;
}
```

Change the closing to add the placeholder + trigger the async fill (function still returns
synchronously — this is purely additive, no control-flow change to anything existing):
```js
  card.innerHTML = [
    ['Passenger',       `${fn} ${ln}`],
    // ...
    ['Special requests',notes],
  ].map(([l,v]) => `<div class="confirm-row"><span class="confirm-label">${l}</span><span class="confirm-value">${v}</span></div>`).join('')
  + totalRows
  + '<div id="fuelPriceLine" class="confirm-fuel-line"></div>';
  updateFuelPriceLine();
}
```

### 3. `ftt-booking-site/src/styles.css` — new rule, matching the existing `.confirm-*` conventions

Existing conventions found in the real file (line 216-218):
```css
.confirm-label{font-size:13px;color:var(--mid)}
.confirm-value{font-size:14px;font-weight:500;color:var(--dark)}
.confirm-value.price{color:var(--ocean);font-family:'Sora',sans-serif;font-size:1.5rem;font-weight:700}
```

New rule, same file:
```css
.confirm-fuel-line{font-size:11px;color:var(--mid);margin-top:6px;text-align:right}
```

## Why not applied yet

1. Per instruction — this step doesn't happen until Section 9's full test plan passes and James
   explicitly says so.
2. It depends on `GET /fuel-index`, which currently returns the real seeded $3.39/L baseline — real,
   live data, verified in the Milestone 5 report. No blocker on the data side.
3. It has not been visually verified in a real browser against the real live widget, since applying
   it there before sign-off is exactly what's being deliberately avoided.

## To apply, when James is ready

1. Make the three edits above directly in `ftt-booking-site/src/app.js` and
   `ftt-booking-site/src/styles.css` (on `main`, or wherever the live site's source is actually
   edited from — this repo's zip-upload deploy process, not auto-deploy, per
   `docs/PARTNER_DEMO_BUILD_STANDARD.md`/skill guardrails).
2. Visually verify in a real browser before deploying (per the standing "test in browser before
   claiming success" rule) — confirm the line renders correctly, degrades silently if
   `nadi-dispatch-api` is unreachable, and doesn't shift any existing layout.
3. Deploy via the existing zip-upload process to the live Cloudflare Pages project — not a new
   process, just the one already documented for this site.
