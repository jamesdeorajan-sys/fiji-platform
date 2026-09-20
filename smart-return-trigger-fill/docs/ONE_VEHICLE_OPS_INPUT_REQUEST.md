# Smallest practical ops request — ONE vehicle, ONE day, then seven days

Recovery branch, 2026-09-21. No customer details belong here or on GitHub; the filled sheets stay in the private ops worksheet and only a sanitized
movement file (opaque refs) is derived from them.

**Step 1 (now): one verified vehicle, one operating day** — the day with the most saved requests (24 Sep). Ops supply:
1. **The vehicle, once:** a label (e.g. `Van-1`), class, real seats and luggage capacity.
2. **Its actual movements for that day** — every one, from our saved bookings *and* any other job, rest or maintenance block. Per job: local start time, from/to zone (real zone names), passengers, bags, the realistic duration in minutes, who confirmed it, when (date + time + timezone) and an evidence pointer (a row or message reference, not its text).
3. **An attestation** that the list is complete for the period (this is what makes "vehicle available" a fact rather than a guess).
4. **Route facts for only the zone pairs used:** drive minutes each way, and one turnaround number (minutes between finishing one job and starting the next).
5. *Optional now, needed before any price:* operator payout and extra cost (fuel, tolls, other) for those legs. James separately supplies the minimum contribution he approves.

**Acceptance for step 1:** the pilot run for that vehicle-day (`scripts/seven_day_pilot.js`, hypothetical empty legs, sold chains, rejected matches with reasons) is reproducible by Codex from the sanitized file, and every remaining HOLD names the input still missing. A "no feasible opportunity" result under missing inputs is **not** evidence of zero demand or fleet potential.

**Step 2: expand to seven days for the same vehicle**, then add vehicles. Only after a vehicle-week works does anything further (economics review, lifecycle build) make sense.

Private templates (in James's private worksheet folder, not in the repo): `ONE-VEHICLE-DAY-JOBS-PRIVATE-2026-09-24.csv` and `ONE-VEHICLE-VEHICLE-AND-ROUTES-PRIVATE.csv`.
