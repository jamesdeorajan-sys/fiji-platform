# Legal Facts Required — Before Privacy Policy / Terms of Service Can Be Finalized

> **CEO DECISION 2026-08-30:** publication NOT APPROVED (`CEO-DECISIONS-2026-08-30.md`, decision 6).
> Every item below remains open. See `CEO-DECISIONS-2026-08-30.md` for two additional items
> surfaced since this file was first written.

**These drafts are operational placeholders written by an AI agent from the codebase's own known
behavior. They are NOT legal advice, and they must NOT be published as-is. A qualified lawyer
(ideally one familiar with Fiji consumer/tourism law and, if Vakaviti operates or has users outside
Fiji, applicable cross-border data/consumer law) must review and finalize both documents before
either is published or linked from the live site.**

This file lists every fact the drafts could not respond to, because inventing them here would be
worse than leaving them blank. Nothing below has been assumed or guessed anywhere in
`PRIVACY-POLICY-DRAFT.md` or `TERMS-OF-SERVICE-DRAFT.md` — each is instead marked inline as
**CEO INPUT REQUIRED**.

## Facts that must come from the CEO (or the CEO's lawyer), not from code inspection

1. **Legal entity name** — is "Vakaviti" a registered business name, and under what legal entity does
   it trade? (e.g. a specific Pty Ltd, sole trader, etc.)
2. **Company registration** — registration number/jurisdiction, if any.
3. **Business address** — the address a Privacy Policy/Terms document must legally state for notices,
   complaints, or service of process.
4. **Governing law and jurisdiction** — which country's/territory's law governs disputes (Fiji? the
   country of incorporation, if different? both, with a stated precedence?).
5. **Data-retention periods** — how long enquiry records, claim submissions, and analytics events are
   kept before deletion, and who is responsible for enforcing that.
6. **Refund liability** — does Vakaviti ever hold, process, or refund any payment? (Current code
   evidence: no payment-processing code exists anywhere in this repository — see
   "What the code actually does" in each draft.) This must be a deliberate confirmed policy, not an
   inference from absence of code.
7. **Payment-agent status** — is Vakaviti ever, now or in a planned future state, a payment
   intermediary/agent of record for any transaction? (Current code evidence: no.)
8. **Commission model** — how/whether Vakaviti charges operators (percentage of bookings, flat fee,
   free during "Founding Partner" preview, etc.) — the `/partners` page currently states "no setup fee
   and no monthly fee for founding partners while the program is in preview" and that final terms
   will be "confirmed with you directly," which the Terms draft should not contradict or expand upon
   without CEO confirmation.
9. **Operator contractual responsibility** — what Vakaviti's Terms should state an operator is
   contractually responsible for once listed (accuracy of their own information, fulfilling any
   booking made directly with them, etc.) — a legal, not technical, decision.
10. **Data Protection Officer / privacy contact**, if required by applicable law beyond the general
    support email already published (`helpronline@gmail.com`).
11. **Age restrictions / minors** policy, if any is required for a travel-enquiry service.
12. **Cross-border data transfer** disclosure, if Cloudflare's global infrastructure (see below) is
    considered a cross-border transfer requiring specific disclosure under applicable law.

## Facts already established by direct code/data inspection (safe to state as fact)

These are not legal opinions — they are what the running system actually does today, verified by
reading the source and querying production D1 read-only:

- Vakaviti is a directory/enquiry service connecting travellers to Fiji tourism operators —
  confirmed by every public page's own copy (`/about`, `/`, `/partners`).
- No payment processing exists anywhere in the codebase — confirmed by the absence of any
  payment-gateway integration, and the `/about` and `/terms` pages' own existing statement:
  "Vakaviti does not currently process payments or confirm bookings."
- Traveller enquiries are recorded server-side (operator, product, timestamp, status) — confirmed in
  `schema.sql`'s `enquiries` table and `src/index.ts`'s `/enquire/*` routes; the actual message text
  sent via WhatsApp is never captured server-side (it is generated client-side into a `wa.me` deep
  link and never round-trips through Vakaviti's own servers).
- Claim/Founding Partner form submissions (name, email, phone, business URL) are stored in D1 —
  confirmed in `schema.sql`'s `claims` table and `src/index.ts`'s `/api/claim` and
  `/api/partner-interest` handlers.
- Infrastructure is Cloudflare Workers + Cloudflare D1 (SQLite-compatible) — confirmed in
  `wrangler.toml`.
- Operator/product listing data is publicly discovered (AI-assisted) and/or human-reviewed before
  being marked "Vakaviti Verified" — confirmed by `verification_status`/`last_public_check_at`
  columns and the `/about` page's own explanation of what "publicly listed" vs "Vakaviti Verified"
  means.
- No automatic guarantee of provider availability, pricing, or booking confirmation is made anywhere
  in the code or copy — confirmed by the existing `/terms` draft language and the "Contact for
  price"/"Not yet verified" badges used throughout.
