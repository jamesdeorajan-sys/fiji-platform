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
