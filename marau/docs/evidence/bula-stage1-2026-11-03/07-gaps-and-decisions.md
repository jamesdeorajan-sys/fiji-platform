# 7. Additional findings and decisions

## New blocker found: nothing tells Bula that a booking was saved
Bula's mirror is driven by `POST /preview/admin/synthetic-source/:ref/sync-event`. NAT emits no event to Marau (7d268e5 does not add one), and Marau has no poller. The read endpoint alone lets Bula *read* a booking it already knows about; it does not make Bula *discover* one. Options (CEO decision; none implemented):
- A. NAT → Bula notification after booking save (a change inside NAT's booking path: highest risk; not recommended).
- B. **Bula polls a minimal read-only "recent booking ids since N" endpoint** on NAT (second additive read-only route; recommended; no change to the booking path).
- C. Manual: staff enter a booking ref in Bula (works with today's code; not automatic).

## Rollback baseline re-verified
`5ec3f91cec81d33d84fc7b45f3e1d6eb91e3b563` bundle: all six files re-hashed against its manifest. Compatible: identical `schema.sql`, no migration since, and this stage adds no migration. Not executed.
