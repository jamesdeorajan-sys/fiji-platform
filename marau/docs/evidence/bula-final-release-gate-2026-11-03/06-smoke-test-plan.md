# 8. Post-activation smoke test — PLAN ONLY (not run; do not run until activation is separately approved)

Preconditions: production Worker/D1 deployed from `1343f866…` with flags OFF; source endpoint and secrets in place; verified support number; CEO staff identity; one published, clearly-labelled test offer on a test operator; rollback target 5ec3f91 ready.

1. **Synthetic booking:** one booking created by James through the normal NAT flow with a James-controlled test email/phone and a pickup zone/date reserved for testing. Expected SOURCE record: new `bookings` row, status `pending`, price/route/time as entered. No other booking is touched.
2. Turn flags on (BULA_SOURCE_SYNC + OUTBOX) → CEO sets cutover **before** the test booking is saved.
3. **Expect within 2 minutes (guest state):** exactly 1 guest session + 1 link for that ref (`GET /preview/admin/bula/source-sync/<ref>` as CEO); My trip shows the source route/time/price and "not confirmed yet"; unavailable fields stated, none invented.
4. **Wallet:** FJ$500.00 available, 1 `granted` ledger row, balances sum to granted.
5. **Offer/request:** guest opens the private link, requests the test offer: credit −FJ$25.00 once, capacity −1 once, chip "Requested".
6. **Staff:** request in queue; CEO claims, then declines with a note; guest sees "Declined" + credit returned; wallet back to FJ$500, capacity back; second decline/withdraw changes nothing.
7. **Capture:** exactly 2 captured items for the ref (guest + team), each once; zero messages to anyone else (while no live sender exists).
8. **Logs/diagnostics:** audit shows `outbox_cutover_set`, one `hold_declined`; no `adapter_failed`; invariant query (buckets sum, remaining = total − live, ≤1 ledger row per hold/type) clean.

**Abort immediately (flags off, do not continue) if:** any second guest/grant/job/snapshot for the ref; wallet ≠ FJ$500 or not restored exactly; capacity moves other than ±1; any message transmitted; any other booking gets a Bula record; the source booking is altered or its creation is slowed/failed; any 5xx on the booking path; cutover instant not set or set earlier than expected.
**Rollback trigger (execute rollback in 04):** any abort condition above, or any unexplained difference in NAT booking creation, or any real guest affected.
