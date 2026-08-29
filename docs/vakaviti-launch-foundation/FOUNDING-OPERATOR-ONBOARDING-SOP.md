# Founding-Operator Onboarding SOP

> **CEO DECISION 2026-08-30: APPROVED** — controlled manual onboarding for the founding cohort
> (`CEO-DECISIONS-2026-08-30.md`, decision 5). Target: **first controlled cohort of 10 credible
> operators**, expanding to **30** once that cohort is proven out. Self-service onboarding remains
> explicitly not authorized before launch.

This is a controlled, manual, human-run process — no self-service signup is required or assumed.
The existing `/admin/providers` tooling (`src/provider-onboarding.ts` /
`src/provider-onboarding-ui.ts`) already supports an admin-run onboarding record; this SOP is the
human process around it, not a new build. **No messages have been sent and no operator has been
onboarded in producing this document** — it is a procedure, not an execution. This decision
approves running this SOP; it does not itself authorize contacting any specific operator, which
remains an action for the CEO/founder to take when ready.

## 1. Operator selection criteria

For the first cohort of 10 (and the subsequent expansion to 30), prioritize operators that:
- Have a real, verifiable public web presence (a real website or Facebook page, not just a phone
  number) — the existing `hasSafeOfficialSource()` gate already requires this for AI-discovered
  listings, so selecting for it up front avoids listings that would later fail publication anyway.
- Serve a Fiji tourism category with clear existing demand signal (airport/ground transport,
  accommodation, day tours, diving/water activities — matching the categories the codebase already
  models: `ACCOMMODATION`, `DINING`, `ACTIVITY`, `TRANSPORT`/`GROUND_TRANSPORT`, `EXPERIENCE`).
- Are reachable by a real person who can confirm details within a reasonable timeframe (avoid
  operators with only an automated/unmonitored inbox).
- **CEO INPUT REQUIRED:** any relationship-based priority (existing contacts, referrals) — not
  visible from the repository.

## 2. Identity verification

- Confirm the business is real and currently operating (not defunct, not seasonal-closed) via its
  own official website/social page and, ideally, a live phone/WhatsApp contact.
- Record the exact official source URL checked and the date — this becomes the operator's
  `website_url` and `last_public_check_at`, which the live site already displays publicly as
  "Official source used by Vakaviti: [domain] · last checked [date]" for any AI-discovered listing.
  **Do not skip this** — `hasSafeOfficialSource()` fail-closed hides the entire listing if this
  isn't a genuine, resolvable HTTPS URL.

## 3. Official-source evidence

- Screenshot or save the specific page(s) used to confirm business name, location, and services —
  this is the evidence a future dispute or accuracy question would need.
- Record which specific facts came from which source, especially price and availability claims
  (the existing `evidence` table already supports field-level provenance — `entity_type`,
  `entity_id`, `field_name`, `source_type`, `source_url`, `observed_value`).

## 4. Product and price capture

- For each product/service the operator offers, capture: canonical name, category (from the fixed
  set above), price and currency if publicly stated (or "Contact for price" if not), pricing basis
  (per person / per night / per group, matching `PRICING_UNIT_LABEL` in `src/index.ts`), and
  duration if applicable.
- Never fabricate a price. If unconfirmed, leave it as "Contact for price" — this is already the
  system's own designed fallback (`priceLabel()`), not a gap to fill with a guess.

## 5. Image rights

- Ask the operator directly whether they can supply their own photo(s) with confirmed usage rights.
  If yes, that becomes their `image_url` — an ENTITY_SPECIFIC image under the media classification
  system (see PR #32), the most trustworthy category.
- If no usable photo is available, the listing correctly falls back to a Vakaviti-generated branded
  visual (see PR #32's `BRANDED_FALLBACK`) — this is an acceptable, intentional outcome, not a
  blocker to onboarding. **Never substitute a stock photo of a different business, and never proceed
  without the operator's explicit confirmation if a Vakaviti-sourced generic photo is proposed to
  stand in for their category** (i.e. a `SEMANTIC_CATEGORY` assignment) — that decision should be
  made deliberately per operator, the same way it was for the 2 existing operators using it today,
  not applied automatically.

## 6. WhatsApp/contact verification

- Confirm a real, monitored WhatsApp number directly with the operator before storing it in
  `operators.whatsapp` — do not infer or reuse another number. (Direct read-only inspection during
  this task found one existing operator's stored `whatsapp` value identical to the site-wide central
  enquiry number, which is worth double-checking before treating any pre-existing stored value as
  confirmed — see `CENTRAL-ENQUIRY-OPERATING-MODEL.md`.)
- Under the recommended central-routing model (see that same document), this number is not yet used
  for direct traveller contact — it's the number Vakaviti's own staff use to forward enquiries.

## 7. Operator approval of listing

- Before publishing, show the operator exactly what their public listing will say (name, location,
  services, prices, and whichever image class applies) and get explicit approval — a phone call or
  a screenshot sent over WhatsApp/email is sufficient at this scale.
- Record the approval (date, who approved, how) — this becomes part of the evidence trail.

## 8. Claim invitation

- Once listed, send the operator their `/claim/:slug` link so they can formally claim their own
  profile through the existing flow (`app.get('/claim/:slug')` → `POST /api/claim`, already live and
  functional — confirmed by direct code read, not a gap needing new work).
- Note: claiming does not itself grant "Vakaviti Verified" status (the existing claim page already
  says so) — verification remains a separate, deliberate human step.

## 9. Correction workflow

- Give the operator a direct, fast way to flag an error (phone/WhatsApp to the same contact used
  for onboarding, or the existing "Claim this business or report incorrect information" CTA already
  shown on AI-discovered listings).
- **CEO INPUT REQUIRED:** target turnaround time for correcting a reported error.

## 10. Response-time expectations

- Set with the operator, at onboarding, what response time Vakaviti expects from them for a
  traveller enquiry (this feeds directly into `CENTRAL-ENQUIRY-OPERATING-MODEL.md`'s provider
  response deadline). **CEO INPUT REQUIRED** for the exact target.

## 11. Commercial-status decision

- Confirm with the operator (and internally) whether this listing is a free "Founding Partner"
  preview listing per the existing `/partners` page commitment ("no setup fee and no monthly fee...
  while the program is in preview") before setting `commercial_status='ACTIVE'`.
- **CEO INPUT REQUIRED:** any operator-specific exceptions to that standard Founding Partner term.

## 12. Publication checklist (before flipping `commercial_status='ACTIVE'`)

- [ ] Official source URL confirmed reachable and genuinely represents this business
- [ ] At least one product/service captured with a real or honestly-absent price
- [ ] Image decision made deliberately (own photo / semantic category with operator's awareness /
      branded fallback) — never silently defaulted
- [ ] WhatsApp/contact number confirmed directly with the operator, not assumed
- [ ] Operator has seen and approved the exact listing content
- [ ] Claim link sent
- [ ] Founding Partner commercial terms confirmed with the operator

## 13. Removal/suspension procedure

- Set `commercial_status` away from `ACTIVE` (the existing fail-closed pattern already hides an
  inactive operator/product from every public route — confirmed by direct code read of
  `/operators/:slug`, `/experiences/:slug`, and the listing queries, all of which filter on
  `commercial_status='ACTIVE'`).
- Trigger conditions: operator requests removal, repeated non-response to enquiries (see
  `CENTRAL-ENQUIRY-OPERATING-MODEL.md`'s fallback procedure), confirmed inaccurate information not
  corrected within the agreed turnaround, or the business ceases operating.
- **CEO INPUT REQUIRED:** whether removal requires operator notice/appeal before taking effect.

---

## Provider invitation script (concise, for phone or WhatsApp — not to be sent as-is without CEO review)

> Hi [Operator name], I'm [name] from Vakaviti — we're building a directory that connects travellers
> in Fiji directly with real, trusted local operators like you, at no cost while we're in our
> Founding Partner preview. I'd like to list [Business name] with your [service/tour name] — could I
> confirm a few quick details with you: your current price for [product], the best WhatsApp number
> for us to forward traveller enquiries to, and whether you have a photo we could use (with your
> permission)? I'll send you exactly what the listing will say before it goes live, and you can
> correct anything at any time.

## Claim-verification checklist (for confirming a claim submitted via `/claim/:slug`)

- [ ] Claimant's name/phone/email match, or are plausibly connected to, the operator's known contact
- [ ] A follow-up call/message to the operator's own known number (not the number the claim form
      submitted, to avoid trusting an unverified self-report) confirms the claim is genuine
- [ ] If verified, proceed to the same operator-approval and publication-checklist steps as above
- [ ] If unable to verify, do not act on the claim until it can be confirmed by an independent
      channel
