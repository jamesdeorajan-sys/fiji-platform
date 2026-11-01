# Local phone-browser evidence — saved booking, My trip, staff queue (NOT a physical device)
Produced by `bula/trip_journey.mjs` (Playwright, iPhone-13 profile, 390x844) against `bula/trip_demo_server.mjs` (real Worker code on an in-memory SQLite D1, synthetic NAT-shaped source, capture sender; nothing sent anywhere).
Code under test: commit `e7e43eb` (later commits change evidence/docs only). Result: 11/11 checks passed, no page errors.
- t1-my-trip.png — saved transfer, "not confirmed yet", available details, "Not available from your booking record", verified support contact
- t2-staff-queue.png — request with the guest's transfer, unclaimed, Claim button, no contact details
- t3-confirmed.png — after staff claim + confirm: activity Confirmed, transfer still "not confirmed yet"
- t4-withdrawn.png — My bookings: "Withdrawn" (never "Released"), "FJ$20.00 credit returned." shown only with ledger proof
Evidence classes: LOCAL (this folder, node tests) · HOSTED (the isolated Worker, `~/.bula-acceptance/evidence*.json`) · PHYSICAL (James's iPhone, 2026-11-01: install, connect, reopen without another code). Only LOCAL exists for this milestone so far.
