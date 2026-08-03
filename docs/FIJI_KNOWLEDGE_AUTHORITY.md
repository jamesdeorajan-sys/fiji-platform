# Fiji Knowledge Authority

**Status:** Data-governance design. It does not authorize ingestion, migration, deployment, or Fare Service Phase 2.

## Truth classes

- **Stable Fiji knowledge:** curated geography, culture, and durable travel guidance. Lagi may answer from a verified, current-enough record and cite provenance.
- **Changing commercial information:** offers, products, partner status, and published details. The owning authority must verify freshness; live checking may be required.
- **Real-time operational facts:** availability, pickup changes, disruption, booking, dispatch, and payment state. Lagi must query the live authoritative service and fail closed.
- **Private customer or partner information:** access-controlled, purpose-limited, minimized, consented where required, and never used as general knowledge.
- **AI-generated suggestions:** clearly suggestions, derived from authoritative inputs, never written back as fact without human/authority verification.

Operational records belong to D1-backed authoritative services; implementation and schema truth belongs in Git. WhatsApp is a communication channel, not a knowledge, lead, or booking record.

## Category register

“Qualified” means Lagi states material uncertainty. “Live” means verification at answer or transaction time. Retention always follows approved policy, legal requirements, minimization, version history, and access/audit logs.

| Category | System of record / owner | Data source and verification | Freshness / update process | Class | Lagi direct? | Qualified? / Live? | Retention and audit |
|---|---|---|---|---|---|---|---|
| Airports | Destination Authority / knowledge steward | official airport/aviation sources; verified | quarterly and on notice; steward review | Public stable | Yes | if stale / for disruption | version, source, reviewer |
| Destinations | Destination Authority / destination editor | official/local validated sources | six-month review; proposed change workflow | Public stable | Yes | if subjective / No | full provenance/history |
| Resorts and hotels | Partner Directory + Knowledge Authority / partner steward | property and independent verification | monthly/partner change; re-approve | Public + partner confidential | Public fields | Yes / before commercial claim | consented submissions, revisions |
| Islands and regions | Destination Authority / knowledge steward | government/geospatial sources | annual and on notice | Public stable | Yes | where access varies / No | source/version audit |
| Transfer routes | Destination Authority / transport steward | approved route catalogue/operator evidence | monthly and on change | Public changing | Yes for description | Yes / before quote | canonical IDs and revisions |
| Travel times | Knowledge Authority / transport steward | observed ranges and official notices | monthly; recalculate approved ranges | Public changing | As ranges | Always / Live for disruption | method, samples, timestamps |
| Tours | Partner Directory / product owner | approved operator product record | before display and monthly | Public + partner confidential | Public fields | Yes / Availability Service at booking-time | owner, terms, versions |
| Attractions | Knowledge Authority / destination editor | venue/official sources | monthly and on notice | Public changing | Yes | if stale / Live for hours | source snapshots/revisions |
| Activities | Partner Directory / product owner | approved provider records | monthly and booking-time | Public changing | Public fields | Yes / Availability Service live | product/version/access logs |
| Cruise excursions | Partner Directory / cruise product owner | operator, port and ship schedule | per sailing and change | Public changing | Public fields | Always / Availability Service live | sailing/source/decision logs |
| Family suitability | Knowledge Authority / content safety owner | verified facilities, restrictions, editorial criteria | six-month and product change | Public guidance | Yes | Always / restrictions live | criteria, evidence, reviewer |
| Honeymoon suitability | Knowledge Authority / editorial owner | verified features plus attributed reviews | six-month review | Public guidance | Yes | subjective qualification / No | evidence and editorial version |
| Accessibility | Knowledge Authority + partner record / accessibility owner | first-party details, structured verification | quarterly and before reliance | Public + optional private needs | Only verified facts | Always / contact live when critical | evidence, consent, access audit |
| Cultural guidance | Knowledge Authority / cultural reviewer | recognized community/government sources | annual and on correction | Public stable | Yes | where context-specific / No | source and reviewer history |
| Safety guidance | Knowledge Authority / safety owner | government, emergency, operator notices | continuous notices; scheduled monthly review | Public changing | Yes with attribution | Always / Yes when material | alert source/time/version |
| Pickup instructions | Booking/Dispatch Service / operator | persisted booking and approved location instruction | per booking/operational change | Traveler private real-time | Only authorized traveler | Yes / Always | access and change history |
| Operator records | Partner Directory / partner operations | due diligence and operator submissions | onboarding, annual, event-driven | Partner confidential; selected public | Only public fields | Yes / Live for eligibility | approvals/access/history |
| Partner records | Partner Directory / partner owner | contracts, verification, partner submissions | onboarding and event-driven | Partner confidential; selected public | Only public fields | Yes / Live for status | contractual retention/access |
| Deals | Promotion Service / commercial promotions owner | approved campaign and funding record | effective window; automatic expiry | Public + confidential rules | Published terms only | Yes / Promotion Service live for eligibility and redemption | approval, campaign version, budget and redemption audit |
| Verified reviews | Verified Review Service / trust owner | completed-booking link and moderation | event-driven; correction workflow | Public + traveler private | Published fields | attribution / status live | verification/moderation history |
| Operational notices | Operational Notice Service / operations incident owner | authenticated airport, operator, emergency or incident-owner event | immediate, expire explicitly; incident owner reviews publication and closure | Public/Internal real-time | Only approved public fields | Always / Operational Notice Service live | issuer, source, scope, severity, approval, effective/expiry time, version and access |

## Publication and correction

Every record carries canonical ID, owner, source, verification state, effective and reviewed times, classification, and version. Changes are proposed, reviewed by the named owner, published through the authority, and retained as auditable history. Corrections supersede rather than silently erase evidence. Expired or unverifiable records are withheld or clearly qualified.

The first release uses only a small approved subset. Booking API publication remains blocking. AI owns none of pricing, bookings, dispatch, or payments, and Fare Service Phase 2 remains unauthorized.
