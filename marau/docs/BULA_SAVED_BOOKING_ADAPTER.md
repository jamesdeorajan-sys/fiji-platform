# Bula Happiness — saved-booking adapter, My trip, staff request queue (isolated, synthetic)

## The missing integration (what already existed vs what was missing)
Existing and reused unchanged: real-booking sync mirror (`worker/real_booking_sync.js`: one guest session per source ref, never matched by phone), `processSavedBooking` / `reconcileAll`, outbox, snapshots, welcome grant, hold/credit/inventory modules.
Missing: nothing called Bula after the sync mirrored a booking. `bula/source_adapter.js` is that one wire. It adds no new tables and no new mutating logic.

## Adapter contract
- Switch: `BULA_SOURCE_SYNC=on` AND `BULA_OUTBOX_ENABLED=on`. Both default off. Real email sending (`BULA_EMAIL_SEND_ENABLED`) stays off; no live sender exists.
- Called after a successful sync/reconcile. Replay-safe: guest (linked by source ref), jobs (`INSERT OR IGNORE` on a stable key), grant (once per party), snapshot (new version only on change).
- Never throws; the sync response is unchanged. A failed step is repaired by the scheduled sweep, which builds source snapshots from the source reader and refuses to label a source booking as a Marau form.
- Source = whatever the sync already reads (synthetic table; the read-only NAT reader only if `NADI_SOURCE_*` is set — it is not, anywhere). Fixtures: `bula/source_fixtures.mjs` (contract-shaped; GET-only).

## Guest My trip (`GET /preview/bula/trip`)
Own session only. Itinerary, transfer status (received / confirmed / confirmed-no-driver / not accepted / cancelled), source details that exist (total, flight; passengers only if the source supplies them), "Not available from your booking record" for the rest, activity requests, support contact only if configured AND verified.
Wording: "Withdrawn" / "Declined" (never "Released"); "credit returned" only when the credit ledger proves the restore; otherwise "being processed" or "not returned under the cancellation terms".

## Staff queue
Claim / release claim / confirm / decline. Claim is an append-only audit fact written by one guarded INSERT (two simultaneous claims: one wins, the other is told who has it). Confirm/decline by someone else is refused (409) unless CEO (audited override). Decline attribution is written in the same atomic batch that releases the hold and returns credit and capacity. Queue shows the guest's transfer but no contact details.

## Also fixed
Guest/team receipts printed the pickup time as an object; receipts now quote the source reference (same as My trip) and optional details from the snapshot only.

## Activation requirements (not done; each needs James)
1. Hosted acceptance re-run on this commit (new routes, decline batch, claim rules). Not run yet.
2. Verified Bula support number + `BULA_SUPPORT_VERIFIED`.
3. A real email provider + sender + `BULA_EMAIL_SEND_ENABLED` (none exists).
4. Live source: separate approval of the NAT read endpoint; passengers need the negotiation join.

## Rollback
Set `BULA_SOURCE_SYNC=off` (adapter inert, no redeploy of code needed beyond var) or `lockdown`; redeploy the previous bundle (`5ec3f91`). No migrations were added; nothing to undo in D1.

## Switches: what each one stops
| Switch | Stops | Does NOT stop |
|---|---|---|
| `BULA_SOURCE_SYNC` off | The adapter after a sync; **and** the sweep's repair of source-mirrored bookings (snapshot, receipt jobs, welcome grant). Source rows are excluded in `reconcileMissing` and `reconcileAll`, so nothing is created or repaired for them. Turning it back on resumes the repair (bookings saved after the cutover). | Receipt jobs already queued (they belong to the outbox); ordinary Marau form bookings; the sync mirror itself. |
| `BULA_OUTBOX_ENABLED` off | Everything in the outbox: enqueue (form bookings and adapter), the sweep (`reconcileAll`), ambiguous-send resolution and dispatch. The adapter returns `outbox_disabled`. | The sync mirror; guest/staff screens; holds, credit, publishing. |
| `BULA_EMAIL_CAPTURE` off (default) | Capture. With the outbox on and capture off the only sender is the disabled live sender: jobs fail with `LIVE_SENDER_DISABLED`, nothing is sent. | — |
| `BULA_EMAIL_SEND_ENABLED` | Reserved for a future live provider. No live sender exists, so it has no effect today. The runner refuses a bundle where it is not `off`. | — |
| `BULA_CREDITS_ENABLED` off | Welcome grants (adapter and sweep) and credit use. | Receipts/snapshots. |
| `BULA_CHECKOUT_ENABLED` off | Reserve/confirm/cancel and the expiry sweep. | — |
| `BULA_EDITION_PUBLISH_ENABLED` off | The 6 pm publish (cron and guest lazy publish). | — |
| Cron triggers | The `*/15` and `0 6` crons run `bulaScheduled`: publish, expiry, credit-expiry, outbox sweep+dispatch — each behind its own flag above. Removing the triggers stops all of them. | Request-time work (the adapter after a sync). |

**Activation gate — outbox cutover.** Only bookings saved after `bula_settings.outbox_cutover_iso` are ever swept or replayed; with no cutover the sweep does nothing. The CEO sets it once (`POST /preview/admin/bula/outbox/cutover`; never moved or overwritten; audited). It is never set automatically.

## Hosted `source` step
`run_acceptance.mjs <bundle> source` (also the last part of `resume`/`all`): needs passing base evidence for the commit; redeploys the SAME isolated Worker with outbox + source sync + email **capture** on; runs `MODE=source`; **always** redeploys the base flags afterwards (a failed restore says to run `lockdown`). Evidence: `~/.bula-acceptance/evidence-source.json` (names and pass/fail only; no tokens, addresses or message text). The fault harness fails the Nth source read of one sync request only when `BULA_FAULT_HARNESS=on` and the admin key is sent.
