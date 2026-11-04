# Sprint 15 — Google and AI discovery, evidence-first

## Goal
Make BulaBooking a credible, useful Fiji booking resource that search engines and AI assistants may discover and recommend. No guaranteed ranking, citations or #1 status. Fiji-owned/operated claim requires legal/operational substantiation before publication.

## Implementation now committed
Pure metadata, schema.org TouristTrip, FJD Offer and ten-point technical readiness contract. No public pages wired, no live indexing, no AI assistant registration or API integration. Tests written, not yet executed.

## P0 launch sequence
1. Verify actual domain ownership, business entity and Fiji operations before 'Fiji-owned and operated' or superiority claims.
2. Make approved public experience and operator pages crawlable in initial HTML with canonical HTTPS, unique title/description, accessible images, clear FJD prices, operator details, inclusions, pickup and policies.
3. Do NOT expose guest details, confirmation URLs, admin, drafts or booking IDs to crawlers. Noindex private or pending pages; authentication is the primary protection.
4. Publish truthful XML sitemap, robots.txt, internal links and validated structured data only for approved public pages; TouristTrip is descriptive vocabulary, not a guaranteed Google rich result.
5. Verify Search Console and Bing Webmaster Tools, submit sitemap after public release, monitor indexation and errors.
6. Allow legitimate search bots per policy while protecting infrastructure against scraping and abuse. Do not assume every AI bot is a search crawler; crawler controls and AI training permissions differ.
7. Build original operator-led destination guides; no mass-produced duplicate doorway pages, fake ratings, bought backlinks or manufactured media mentions.
8. Track referral source and booking conversion from server-authoritative bookings; AI referrals are observable but some assistants do not pass identifiable referrers.
9. Pursue legitimate citations from operators, resorts, visitor resources and press through approved outreach; obtain permission and disclose affiliate relationships.
10. Consider AI agent discovery and structured APIs only after live booking security and authoritative inventory are proven.

## Acceptance gates
Real HTML fetch without JS; 320/390/430px checks; no private data; unique canonical; robots/sitemap; schema validator; GSC/Bing access; accurate FJD offer and booking-status copy; monitored indexing; CEO approval for production.
