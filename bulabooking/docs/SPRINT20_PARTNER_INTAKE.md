# Sprint 20 — accommodation intake and approval contract

This sprint implements pure validation functions for authenticated operator draft submission, tenant ownership, staff review, booking-origin verification, price/claims/terms checks and fact-bound AI drafting briefs. The functions do not issue sessions, persist offers, contact AI services, or publish pages.

## Safety and integration gates
- Build real authentication and tenant membership server-side. Never accept client-asserted session roles.
- Verify official booking domain ownership using approved manual or technical evidence; an input field claiming an approved origin is NOT evidence.
- Store pending and approved offers with actor IDs, audit events, moderation outcomes and operator approval of final AI copy.
- Capture exact terms, price basis, taxes, blackout dates, minimum nights, eligibility and stay windows.
- Require trusted server-time revalidation at outbound click. Astro static build-time expiry cannot enforce live offer expiry. Do not activate public links until a dynamic, authenticated source and redirect endpoint exist.
- Use outbound clicks as referrals, not confirmed accommodation bookings. Partner retains checkout and payments.
- AI may draft from supplied facts but never invent discounts, inventory, ratings or search rankings.
- Unit tests written, not executed. No live submission, production deploy or database migration.
