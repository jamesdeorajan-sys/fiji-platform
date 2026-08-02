# Fiji AI Authority Contracts

**Status:** Normative design. No implementation or production authority is granted.

## Lagi boundary

Lagi may understand traveler intent; ask clarifying questions; retrieve approved Fiji knowledge; compare suitable options; request authoritative fare quotes and booking creation; retrieve permitted booking status; generate itineraries; route leads; draft customer communications; and use consented traveler preferences.

Lagi may not invent prices; maintain competing fare tables in prompts; claim availability without an authoritative result; claim a booking exists before Booking API persistence; change booking status or assign drivers directly; claim payment success; expose private traveler or partner data; or treat generated prose as operational truth. It must fail closed when authority is unavailable.

## Contract registry

Privacy classes are **Public**, **Internal**, **Partner confidential**, and **Traveler private**. All service mutations use authenticated actor, correlation, purpose, consent where applicable, and idempotency identifiers. D1-backed services own operational truth; Git owns implementation truth.

| Contract / authority owner | Input | Authoritative output | Permitted AI action | Prohibited AI action | Failure behavior | Audit requirement | Privacy |
|---|---|---|---|---|---|---|---|
| Fiji facts — **Fiji Knowledge Authority** | topic, locale, effective time | sourced fact, verification and freshness | retrieve, summarize, qualify | invent or silently override facts | state uncertainty; offer review | query, sources, version, response refs | Public/Internal |
| Destinations and locations — **Destination Authority** | names, coordinates or canonical IDs | canonical place, relationships, access facts | resolve and compare | create operational location IDs | return unresolved/ambiguous | input, candidates, selected ID/version | Public/Internal |
| Prices and rules — **Fare Service** | canonical trip, product, time, party, context | deterministic line items, total, FJD, rule version | request and explain result | calculate, alter, or cache a competing fare | return pricing unavailable/manual review | request hash, actor, rule/calculation IDs | Public/Partner confidential |
| Quotes — **Quote Service** | successful fare result, terms, traveler/lead ref | immutable quote snapshot, expiry, quote ID | request, present, retrieve | edit, extend, or fabricate quote | no quote; explain next step | source calculation, creator, terms/version | Traveler private |
| Bookings — **Booking Service** | accepted quote, traveler details, consent, idempotency | persisted booking ID and status | request creation; retrieve permitted status | assert existence early or mutate status directly | say not booked; preserve retry key | actor, request, quote, transitions | Traveler private |
| Partners — **Partner Directory** | partner identity and approved filters | verified partner record and status | find eligible partners | reveal private terms or invent approval | exclude unverified partner | access, record/version, result | Public/Partner confidential |
| Leads — **one Lead Service** | consented contact, intent, source | lead ID, owner, status | create and route a lead | keep lead only in prose/WhatsApp | disclose failure; safe retry | consent, source, routing, transitions | Traveler private |
| Dispatch — **Dispatch Service** | persisted booking, service requirements | assignment/status from authorized operation | request/read permitted status | assign driver or vehicle | do not claim assignment | actor, booking, assignment transitions | Traveler private/Partner confidential |
| Payments — **Payment Service** | booking/quote, amount, payment token/reference | provider-backed payment state and receipt ref | initiate approved flow; retrieve state | handle secrets or claim success itself | pending/failed; never infer success | provider ref, amount, transitions | Traveler private/Partner confidential |
| Communications — **Communication Service** | approved template/draft, recipient, purpose, consent | delivery ID and provider status | draft and request send | equate message with booking truth | record unsent/failed delivery | content/template version, actor, delivery | Traveler private |
| Preferences — **consent-controlled Traveler Profile Service** | traveler, scoped preference, consent/purpose | permitted profile facts | personalize within scope | infer sensitive traits or exceed consent | omit preference | access, consent, purpose, changes | Traveler private |
| Reviews — **Verified Review Service** | completed booking, reviewer, moderation evidence | verified review and publication state | request, summarize with attribution | fabricate or mark unverified text verified | label unavailable/unverified | booking link, moderation, versions | Public/Traveler private |

## Cross-service rules

Service outputs include schema and record versions, authoritative timestamps, stable status/reason codes, and trace identifiers. Consumer-friendly prose is never the authoritative payload. Least privilege and field-level minimization apply. Prompts contain instructions and identifiers, not operational secrets or executable pricing tables.

Booking API publication remains a blocking dependency. WhatsApp remains only a communication channel. The first commercial release remains very small, and Fare Service Phase 2 is not yet authorized.
