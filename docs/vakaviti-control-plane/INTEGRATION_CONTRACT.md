# Integration Contract (proposed — documentation only, not implemented)

Status: **design only.** No cross-database customer synchronisation is
implemented by this document. No code in this repository reads or writes
this contract yet. This defines the *shape* a future attribution record
should take once a real integration phase is separately authorized.

## Why this exists

`REVENUE_FUNNEL_MAP.md` found that **no CTA anywhere in the ecosystem
carries any attribution parameter today** — every WhatsApp handoff loses
all context except a hand-typed message string. This contract is the
minimum field set needed to fix that, without ever putting personal data in
a URL.

## Record shape

| Field | Type | Notes |
|---|---|---|
| `source_site` | opaque string | e.g. `"nadiairporttransfers.com"`, `"lagi.vakaviti.ai"` — never a full URL with a query string attached |
| `source_page` | opaque string | path only, e.g. `/transfer/hilton-fiji-beach-resort` |
| `source_campaign` | opaque string, nullable | for any future paid/referral campaign tag |
| `vakaviti_provider_id` | opaque ID, nullable | FK into `vakaviti-kb.partners` or Stage 1 `operators` |
| `vakaviti_product_id` | opaque ID, nullable | FK into Stage 1 `products` or `vakaviti-kb` product-equivalent |
| `vakaviti_deal_id` | opaque ID, nullable | FK into Stage 1 `deal_offer_candidates` / `deals` |
| `destination_product_id` | opaque ID, nullable | the receiving system's own product identifier (e.g. a Fiji Tour Transfers/WooCommerce product slug, or a Square catalog item ID) |
| `enquiry_id` | opaque ID, nullable | FK into whichever enquiries table originated the contact |
| `booking_reference` | opaque string, nullable | the fulfilling system's own booking id/reference (e.g. `nadi-marketplace-db.bookings.id`, or a Square/WooCommerce order number) |
| `booking_outcome` | enum | `pending` \| `confirmed` \| `completed` \| `cancelled` \| `lost` \| `unknown` |
| `revenue_amount` | decimal, nullable | only ever the fulfilling system's own recorded amount — never inferred |
| `currency` | ISO 4217 code | must match whatever currency the fulfilling system itself recorded |
| `fulfilment_operator` | opaque string | e.g. `"Fiji Dash"`, `"Fiji Tour Transfers"`, a specific vendor name |
| `consent_state` | enum | `not_applicable` \| `implied_by_direct_contact` \| `explicit` — placeholder until a real consent model is designed; never inferred silently |
| `created_at` | ISO 8601 timestamp | when the CTA was clicked/the record was opened |
| `converted_at` | ISO 8601 timestamp, nullable | when `booking_outcome` first became `confirmed` or later |

## Hard rules

- **Opaque IDs only.** Every `*_id` field is a reference key into an
  existing governed table — never a customer name, phone number, email, or
  payment token.
- **Never in a URL.** None of the above fields — especially
  `booking_reference` if it could ever be guessable/enumerable — should be
  placed in a query string that could leak via referrer headers, browser
  history, or analytics tools. If a WhatsApp deep link needs to carry a
  reference, it goes in the pre-filled message text (already the existing
  pattern, e.g. Stage 1's booking-reference-in-message design from earlier
  phases), not a tracked URL parameter.
- **`revenue_amount` is never inferred from request counts, page views, or
  enquiry counts** — it is copied, verbatim, from the one system that
  actually recorded a real transaction. This matches the existing
  `ceo-war-room` doctrine ("facts have one authority") and this
  engagement's own repeated "do not infer revenue from requests" rule from
  earlier phases.
- **No synchronisation job, cron, or write path is authorized by this
  document.** Building the actual pipeline that populates this record shape
  is a separate, explicitly-authorized phase.

## Addendum (2026-08-24): narrower URL-parameter contract for outbound Vakaviti links

The record shape above is the full backend attribution model for a later,
separately-authorized integration phase. It is intentionally too broad to
put in a URL. This addendum defines the **much smaller** field set that MAY
eventually be added as query parameters on Vakaviti-outbound links (e.g. the
microsite → Fiji Tour Transfers / Nadi Airport Transfers links in
`MICRO-CTA-001`, currently bare with zero attribution) — still design only,
nothing below is implemented or authorized to ship.

| Parameter | Type | Notes |
|---|---|---|
| `source_site` | opaque string | e.g. `diving.vakaviti.ai` |
| `source_page` | opaque string | path, e.g. `/` for the current single-page microsites |
| `campaign` | opaque string, nullable | for any future paid/referral tag |
| `vakaviti_provider_id` | opaque ID, nullable | which partner this click was routed toward |
| `vakaviti_product_id` | opaque ID, nullable | which product/topic this click was routed from |
| `vakaviti_deal_id` | opaque ID, nullable | if the click originated from a specific deal/offer |
| `enquiry_id` | opaque ID, nullable | only if an enquiry record was already created before the redirect (matches the existing Stage 1 `/enquire` pattern) |

This is a strict subset of the full record shape above — it omits every
field that could ever resolve to a person or a transaction amount
(`booking_reference`, `revenue_amount`, `currency`, `consent_state`,
`created_at`/`converted_at`), because those either identify a real
transaction (and so belong server-side, matched by opaque ID after the
fact) or have no reason to ever appear in a URL.

**Hard rules, restated for this narrower set:**
- **Never place names, phone numbers, emails, payment data, or customer
  notes in a URL.** This set has no field capable of carrying any of those
  by construction — every value is an opaque ID or a static site/page
  identifier already public in the link's own URL.
- **Do not assume Square conversion data can be connected to any of these
  parameters.** Whether a Fiji Tour Transfers/Square order can ever be
  matched back to a `vakaviti_provider_id`/`vakaviti_product_id` click
  depends entirely on Square/WooCommerce checkout and webhook architecture
  that has not been inspected in this engagement. That is a separate,
  explicitly-authorized inspection and integration phase — this addendum
  only defines what could travel in the link itself, not how (or whether)
  the receiving system would ever report back against it.
- Same no-sync-job rule as above: this addendum authorizes no code change,
  no query-parameter addition to any live link, and no receiving-side
  handling. It exists so that if/when this phase is authorized, the field
  set is already agreed rather than improvised.

## Where each existing system would plug in (proposed, not built)

- Stage 1's `/enquire/:slug` and `/deals/:slug/enquire` routes already
  capture `source_page`/`referrer` before redirecting — the closest existing
  analog to `source_site`/`source_page` above. A future phase would extend
  that same write to also populate `vakaviti_provider_id`/`vakaviti_product_id`.
- `nadi-dispatch-api`'s `bookings` table (now carrying `idempotency_key` as
  of the E3F migration) is the natural source of `booking_reference`/
  `booking_outcome`/`revenue_amount` for transfers.
- A Fiji Tour Transfers/Square order would be the natural source of the
  same three fields for tour bookings — no such read path exists today;
  building one is out of scope for this documentation phase.
