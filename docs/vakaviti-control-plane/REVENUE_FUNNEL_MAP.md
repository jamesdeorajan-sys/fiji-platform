# Revenue Funnel Map

Status: read-only documentation. Complements `REVENUE_LINK_REGISTRY.json` and the
existing `ceo-war-room/` control-plane registers (`00-CEO-CONTROL.md`,
`04-BRAND-ENTITY-MAP.md`, `05-COMMERCIAL-TRUTH-REGISTER.md`) rather than
replacing them.

## Primary revenue platforms (per CEO addendum, 2026-08-24)

- **Fiji Tour Transfers** (`fijitourtransfers.com`) — principal tour/activity
  booking and Square-enabled revenue platform. Confirmed live via a real
  WooCommerce + Square payment-gateway checkout path (see `FTT-CTA-004` in
  the registry) — the only genuinely transactional, non-WhatsApp CTA found
  on that domain.
- **Nadi Airport Transfers** (`nadiairporttransfers.com`) — principal direct
  transfer booking platform. Its live production build today has **no**
  backend-integrated booking path (`NAT-CTA-002`) — every booking attempt
  becomes a WhatsApp message to the shared concierge number. A real,
  backend-integrated version of the same flow already exists and works on
  `book.fijidash.com` (`BOOK-CTA-001`), and is the prepared-but-frozen E3F
  migration target for this domain.
- **Fiji Dash** — booking/dispatch technology, confirmed by evidence:
  `nadi-dispatch-api` + `nadi-marketplace-db` are real, live, and process
  real bookings (16 rows as of this observation window) with real
  drivers/vehicles/wallets. Not a customer-facing brand in its own right on
  `nadiairporttransfers.com` (Fiji Dash branding is deliberately not shown
  there, per the CEO's own E3C content decisions).

## Documented funnels

### 1. Vakaviti discovery → Fiji Tour Transfers product → Square booking
**Status: not yet built.** No live link was found anywhere in this pass
routing traffic from a Vakaviti-branded surface (`vakaviti.ai`,
`lagi.vakaviti.ai`, the `vakaviti-kb`-backed chat widget) directly to a
specific `fijitourtransfers.com` product page. The chat widget's own routing
(`LAGI-CTA-001`) resolves to a partner name and hands off to the shared
WhatsApp number, not to a Fiji Tour Transfers product URL. This funnel is a
**gap**, not a working path today.

### 2. Vakaviti transfer demand → Nadi Airport Transfers
**Status: partially built.** `lagi.vakaviti.ai`'s partner-routing can
plausibly resolve to Nadi Airport Transfers (it exists as a partner row,
per Phase E1), but the destination is the same shared WhatsApp number as
every other path, not a Nadi-specific booking form or a tagged handoff.
No attribution parameter survives the handoff (confirmed: `LAGI-CTA-001`
carries none).

### 3. Content/niche site → relevant Vakaviti page
**Status: confirmed built (2026-08-24).** All five Vakaviti microsites
(`diving.vakaviti.ai`, `familyresorts.vakaviti.ai`, `honeymoon.vakaviti.ai`,
`mamanuca.vakaviti.ai`, `yasawa.vakaviti.ai`) link to both `vakaviti.ai`
directly (`MICRO-CTA-003`) and to `lagi.vakaviti.ai` (`MICRO-CTA-002`),
each with multiple CTA instances per page. No attribution parameter
survives either hop.

### 4. Content/niche site → Fiji Tour Transfers product where direct booking intent exists
**Status: partially built, not to a specific product (2026-08-24).** All
five microsites carry multiple CTAs to `fijitourtransfers.com`
(`MICRO-CTA-001` — "Book Tours", "Book Transfer Now", etc.), confirming
this funnel is live. However every link found goes to the bare
`fijitourtransfers.com` homepage, never to a specific product/tour page
relevant to that microsite's topic (e.g. the diving guide does not link to
a diving-specific tour listing) — so intent expressed on the microsite is
lost at the handoff. No attribution parameter is present on any of these
links. Given Fiji Tour Transfers is the principal Square-enabled revenue
platform, tightening this to topic-relevant product links (still with no
personal data in the URL, per `INTEGRATION_CONTRACT.md`) is the highest-
value next build step for this funnel.

### 5. Deal enquiry → Vakaviti WhatsApp team → provider or owned fulfilment
**Status: built, but coarse.** Both the Vakaviti/Lagi chat widget and
Stage 1's own `/enquire` routes (E3 work) already redirect to WhatsApp with
a pre-filled message. Stage 1's version is the more rigorous of the two —
it writes an `enquiries`/`deal_enquiries` row with source page and referrer
*before* redirecting (real, code-verified in earlier phases), so
attribution survives up to the point of WhatsApp handoff. The Lagi/chat
widget path does not write an equivalent record for its own routing
decision.

### 6. Failed/abandoned booking → human recovery path
**Status: not inspected.** No customer data was accessed to check this
during this read-only audit, per the explicit constraint. This funnel
requires a separately-authorized phase with real (not aggregate) booking
state — out of scope here by design.

## Cross-cutting gaps this map surfaces

- **No product-level or campaign-level attribution parameter exists on any
  CTA inventoried.** Every WhatsApp handoff across every domain lands on
  the same static number with only a hand-authored message string — there
  is no way today to know, from the WhatsApp side alone, which page or
  brand a conversation started from. This is the exact problem
  `INTEGRATION_CONTRACT.md` is written to solve for a future build phase.
- **Update, 2026-08-24: Fiji Tour Transfers IS linked from elsewhere in the
  ecosystem.** All five Vakaviti microsites link to it directly
  (`MICRO-CTA-001`), refuting the "stands alone" concern raised in the
  prior pass. The remaining gap is precision, not existence: every link
  goes to the homepage, not a relevant product, and none carries an
  attribution parameter.
- **Update, 2026-08-24: ComeToFiji and Natadola Bay Horse Riding inspected.**
  James supplied both live URLs (cometofiji.com, natadolabayhorseriding.com).
  ComeToFiji links directly to Fiji Tour Transfers and carries the
  ecosystem's only attribution-tagged outbound link found to date (a UTM-
  tagged Fiji Airways affiliate link) — proof the pattern is technically
  easy to add, making its absence on every FTT/NAT link more clearly a
  choice not made yet, not a platform limitation. Natadola Bay Horse Riding
  does not link to fijitourtransfers.com at all; it links instead to a
  newly-discovered fourth domain, tourfijitours.com, and runs its own
  overlapping Nadi-airport-transfer product catalogue. See
  `REVENUE_LINK_REGISTRY.json` `cometofiji_and_natadola_ctas` and
  `05-COMMERCIAL-TRUTH-REGISTER.md` TRUTH-016 through TRUTH-018 for full
  detail. Neither site's commercial claims have been imported into
  Vakaviti.
- **tourfijitours.com and bulahappiness.com are new, still-uninspected
  domains** surfaced by the Natadola pass — see coverage_gaps.
