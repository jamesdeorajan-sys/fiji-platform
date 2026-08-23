# Revenue-system map (read-only, derived from live bindings + source inspection)

## Nadi Airport Transfers

```
Booking widget (nadi-guest-widget-preview, book.fijidash.com, no Git source)
   -> nadi-dispatch-api  (custom domains: api.nadiairporttransfers.com, api.fijidash.com)
        -> nadi-marketplace-db  (drivers=1, vehicles=1, wallets=1, wallet_transactions=1, bookings=15, zones=19)
        -> GOOGLE_MAPS_API_KEY (fare/distance calculation)
        -> WHATSAPP_PHONE_ID / WHATSAPP_TOKEN (driver/customer messaging)
        -> BACKUPS / DOCS (R2 buckets)
        -> Cron: */5min (dispatch polling), */15min, daily 14:00 UTC, weekly Sat 12:00 UTC
```
This is the most mature transactional path in the entire account — real bookings, real driver/
vehicle/wallet rows, frequent automated polling. It also has an independent `ADMIN_TOKEN` and the
hardcoded `ADMIN_LOGIN_PHONE` literal noted in the secret scan.

**Missing attribution handoff:** the booking widget (`nadi-guest-widget-preview`) has no
discoverable Git source, so there is no way to confirm from source what data it sends to
`nadi-dispatch-api`, or whether campaign/referrer attribution survives the handoff at all.

## Fiji Tour Transfers

```
Public origin (fijitourtransfers.com — intermittent, see health findings)
   -> /guides Worker route -> fijitourtransfers-guides (no D1, no env bindings, static content only)
   -> everything else on the domain -> unknown origin (DNS records not readable this session)
```
`fijitourtransfers-guides` cannot be the lead/booking destination for anything — it has zero
storage or external bindings. **No code path was found anywhere in this account's Workers that
identifies itself as "Fiji Tour Transfers"'s booking/lead backend.** `vakaviti-kb.partners`
contains a `tourfiji.tours` entry ("Tour Fiji Tours") with its own WhatsApp routing, which may be
a *different* but similarly-named business — the two should not be assumed to be the same brand
without confirmation.

**Missing attribution handoff:** the entire lead/booking destination for fijitourtransfers.com's
main content is unresolved from this account's Cloudflare configuration alone.

## Vakaviti (Stage 1)

```
Stage 1 enquiry (/enquire/:operatorSlug, /deals/:slug/enquire)
   -> MARKETPLACE_ENQUIRY_WHATSAPP var (preview-only routing to James directly — number withheld
      from this document, see cross-cutting observation below)
   -> enquiries / deal_enquiries tables (own D1, attribution preserved: source_page, referrer)
   -> no further automated fulfilment - a human (James/team) must act on the WhatsApp message
```
This is the only path in the account with **complete, code-verified attribution preservation**
(source page, referrer, product/deal ID, timestamp all written before the WhatsApp redirect) -
but it also has no automated fulfilment beyond alerting a human.

## Fiji chat widget / Lagi (cross-cutting)

```
fiji-chat-widget (Anthropic + Vectorize + vakaviti-kb)
   <- vakaviti-whatsapp (service binding: CHAT_WORKER)
        -> WhatsApp Business API (WHATSAPP_ACCESS_TOKEN/APP_SECRET)
   -> writes: leads, conversation_events, knowledge_queue, knowledge_items
```
This is a distribution layer that can route a conversation to **any** partner in `vakaviti-kb`
(routing logic keys on partner name matches, e.g. "Nadi Airport Transfers" or "Tour Fiji Tours"),
independent of and parallel to Stage 1's own enquiry flow. It represents a second, older lead
pipeline that Stage 1 does not currently interoperate with.

## Cross-cutting observation

There are now **two independent central WhatsApp numbers** in this ecosystem: `+61 478 886 145`
(the Lagi/vakaviti-kb fleet's public concierge number, hardcoded in 5 Workers — low sensitivity,
already advertised on live `wa.me` links, so reproduced here) and a second number, deliberately
**not reproduced in this document**, that serves as both Stage 1's `MARKETPLACE_ENQUIRY_WHATSAPP`
and `nadi-dispatch-api`'s `ADMIN_LOGIN_PHONE` — see `secret-scan-summary.md` for why that value is
withheld from this public branch. No code path was found reconciling leads or conversations
between these two numbers/pipelines.
