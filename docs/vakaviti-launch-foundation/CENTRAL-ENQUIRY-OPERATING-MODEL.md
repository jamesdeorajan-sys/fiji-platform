# Central Vakaviti Enquiry Operating Model

> **CEO DECISION 2026-08-30: APPROVED for initial launch.** See
> `CEO-DECISIONS-2026-08-30.md` decision 1. Direct provider routing must not be implemented for the
> initial launch.

## The model

```
Traveller → Vakaviti (central WhatsApp inbox) → human/controlled provider assignment
   → provider response → Vakaviti follow-up → traveller
```

This is the recommended model for initial launch. Not the only technically possible model — see the
comparison below — but the one repository evidence supports as the safest starting point.

## Why Vakaviti should initially own the traveller relationship

1. **It's already how the code works.** `resolveEnquiryDestination()` in `src/index.ts` routes every
   enquiry to one Vakaviti-operated WhatsApp number
   (`MARKETPLACE_ENQUIRY_WHATSAPP`), regardless of operator or product. This is not a limitation to
   route around before launch — it's the existing, tested, working design. Changing it to direct
   provider routing before launch would be new, untested surface area, not a simplification.
2. **Quality control while trust is being built.** With only 2 real operators carrying products
   today (see `DEALS-LIVE-TRUTH.md`'s sibling finding in the broader launch-blocker inventory — thin
   supply), a human relay lets Vakaviti catch a bad operator response, a missed enquiry, or a wrong
   assignment before it damages a traveller's first impression of the whole platform.
3. **A single acknowledgement point.** Vakaviti can guarantee *some* response to every enquiry (even
   just "we're finding you the right contact") without depending on each individual operator's own
   responsiveness, which is unverified and unverifiable at this scale.
4. **Every enquiry is auditable in one place** rather than scattered across N operators' own personal
   WhatsApp accounts, which matters for both quality control and the eventual Terms of Service
   commitments around enquiry handling.
5. **It's reversible and incremental.** Central routing can transition to hybrid or direct routing
   per-operator as trust and volume justify it (see the capacity threshold below) — the reverse
   transition (direct back to central) is much harder once travellers have an operator's direct
   number.

## Central WhatsApp inbox workflow

1. Traveller taps "Ask Vakaviti on WhatsApp" on a listing → pre-filled message names the operator and
   experience (already implemented, `buildEnquiryMessage()` in `src/index.ts`).
2. Message arrives in the single central Vakaviti WhatsApp inbox.
3. A human (initially: the founder/CEO, or a designated first hire) reads it and identifies the
   named operator and product from the message text.
4. Human either forwards the enquiry to the operator's own contact channel (phone call, WhatsApp
   forward, email) or, once volume justifies it, uses a lightweight internal tool to log the
   assignment (see "Status tracking" below).
5. Operator responds (to Vakaviti, not directly to the traveller, in this model).
6. Vakaviti relays the operator's response back to the traveller and confirms details are current.

## Enquiry acknowledgement target

**CEO INPUT REQUIRED** — no target currently exists in code or documentation. Recommend committing to
a concrete, honest number before launch (e.g. "within 2 hours during Fiji business hours") rather
than an implicit but unstated expectation. Whatever number is chosen must be realistic for a
single-person (or very small team) operation, since that is the current real staffing model.

## Provider assignment rules

- The enquiry message already names the specific operator and product the traveller asked about
  (built into `buildEnquiryMessage()`) — assignment is not a matching problem, it's a forwarding
  problem: get the message to that specific operator's own contact channel.
- **Partially ready, verified by direct query:** `operators.whatsapp` is populated for 2 of the 4
  current operators (Blue Lagoon Beach Resort, Nadi Airport Transfers) and empty for the other 2
  (InterContinental, South Sea Cruises). One populated value (Nadi Airport Transfers'
  `+61413335007`) is identical to the site-wide central `MARKETPLACE_ENQUIRY_WHATSAPP` number — this
  is worth a deliberate check with the CEO before treating it as that operator's real, own number,
  since it could be a leftover placeholder rather than a genuine confirmed contact.
  **CEO INPUT REQUIRED:** confirm which stored `whatsapp` values are real, operator-confirmed
  numbers versus placeholders, and capture the missing 2 as part of onboarding (see
  `FOUNDING-OPERATOR-ONBOARDING-SOP.md`) before any of this data is used for direct/hybrid routing.

## Provider response deadline

**CEO INPUT REQUIRED.** Recommend stating an internal target (e.g. "operator response requested
within 4 business hours") distinct from the traveller-facing acknowledgement target above — the
traveller-facing promise should always be the one Vakaviti itself controls, never one that depends
on an operator Vakaviti cannot yet guarantee is responsive.

## Fallback provider procedure

If an operator does not respond within the internal deadline:
1. Vakaviti follows up directly with the operator (phone call is the fastest fallback).
2. If still unresponsive, Vakaviti tells the traveller honestly that the operator hasn't yet
   responded and offers to suggest a comparable alternative operator, if one exists.
3. Record the non-response against that operator's own reliability record (see "Status tracking")
   — repeated non-response should feed into the removal/suspension procedure in
   `FOUNDING-OPERATOR-ONBOARDING-SOP.md`.

## Status tracking

At launch scale (a handful of enquiries per day), a simple shared tracking method (e.g. a spreadsheet
or the existing `enquiries` table's own `status` column, read via direct D1 query) is sufficient.
The schema already supports `CREATED` → `WHATSAPP_OPENED` as states (see the enquiry-lifecycle fix
comment in `src/index.ts`); a production operating model should add a lightweight internal status
for "forwarded to operator" / "operator responded" / "traveller notified" / "closed", tracked
wherever is fastest to start with — this does not require new code to begin operating manually.

## Escalation process

**CEO INPUT REQUIRED** — who is the second point of contact if the primary person handling the
central inbox is unavailable? A single point of failure here is a real operational risk the moment
Vakaviti has any live enquiries; recommend naming a backup before or immediately at launch, even if
that backup is informal at first.

## Customer follow-up

After an operator responds, Vakaviti should confirm with the traveller that they received a response
and it addressed their question — a brief check-in, not a full satisfaction survey at this scale.
This also gives Vakaviti a second read on whether the operator handled the enquiry well.

## Evidence/audit trail

The existing `enquiries` table already records operator, product, timestamp, and status for every
enquiry that reaches the "review" page (a GET, zero writes) and progresses to `CREATED`/
`WHATSAPP_OPENED` (a real, deliberate action). This is already a real audit trail for "an enquiry
happened" — it does not currently capture "what the operator said" or "how it was resolved," which
would need to be added to whatever lightweight tracking method is chosen above.

## Daily enquiry reconciliation

Recommend a daily (or, at very low volume, every-other-day) manual reconciliation: compare the count
of `WHATSAPP_OPENED` enquiry rows in D1 against the count of enquiries actually acted upon in the
tracking method, to catch anything that fell through. This is a read-only D1 query
(`SELECT COUNT(*) FROM enquiries WHERE status='WHATSAPP_OPENED' AND created_at > date('now','-1 day')`)
against the count in whatever tracker is used — no new code required to start this practice.

## Capacity threshold for automation / per-provider routing

Recommend re-evaluating the central model once **any one** of these is true:
- Enquiry volume exceeds what one person can triage same-day (a concrete number depends on the
  CEO's own available time — CEO INPUT REQUIRED for the actual number, but "more than a handful a
  day, consistently" is the qualitative signal).
- 10+ operators are live with individually-confirmed, reliable contact channels, making the
  "assignment" step trivial and low-risk to delegate directly.
- A dedicated person (not the founder) is staffing the central inbox full-time, at which point the
  quality-control argument for centralization weakens relative to the latency cost.

At that point, a **hybrid** model (below) is the natural next step, not a jump straight to full
direct routing.

## Model comparison

| | Central Vakaviti routing (recommended) | Direct provider routing | Hybrid |
|---|---|---|---|
| **Matches current code today** | Yes — exactly what `resolveEnquiryDestination()` already does | No — requires new routing logic per operator, plus a confirmed (not placeholder) `operators.whatsapp` value for every operator (today: populated for 2 of 4, one of those 2 possibly a placeholder — see above) | Partial — needs the same per-operator contact data as direct, applied selectively |
| **Quality control** | High — every enquiry passes a human before reaching an operator | None — Vakaviti has no visibility into whether/how an operator responded | Medium — only non-central-flagged operators get proactive oversight |
| **Latency** | Adds one human relay step | Fastest possible (no relay) | Fast for trusted operators, relayed for others |
| **Scales past founder's personal capacity** | No, without additional staffing | Yes, immediately | Partially |
| **Risk if an operator is unresponsive/unreliable** | Contained — Vakaviti sees it and can intervene | Traveller has a bad experience with no Vakaviti visibility until they complain | Contained only for operators still on the central path |
| **Engineering work required before launch** | **None** — already implemented and tested | New per-operator routing logic + a data-capture step in onboarding + new Terms language about direct operator responsibility | Same per-operator data capture, plus a rule for which operators get which path |

**Recommendation: central Vakaviti routing for initial launch.** Nothing in the repository suggests
direct routing is technically unworkable — the schema already has a `whatsapp` column and it's
already partially populated — but the data isn't yet trustworthy enough to route on blindly (half
empty, and one populated value looks like it may be a placeholder), and the quality-control case for
staying central while supply and trust are still thin is strong regardless. Revisit at the capacity
threshold above.
