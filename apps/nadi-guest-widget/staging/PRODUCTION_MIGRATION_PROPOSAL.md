# Production migration proposal — durable idempotency + custom-address hardening

**Status: proposal only. Nothing in this document has been applied to
`nadi-dispatch-api` or `nadi-marketplace-db`.** Everything below was proven
first against the isolated `nadi-dispatch-api-staging` /
`nadi-marketplace-staging-db-v2` pair (E3D) — real concurrent-request tests,
not just code review.

## 1. Exact production schema migration

```sql
-- New migration on nadi-marketplace-db
ALTER TABLE bookings ADD COLUMN idempotency_key TEXT;
ALTER TABLE bookings ADD COLUMN idempotency_fingerprint TEXT;

CREATE UNIQUE INDEX idx_bookings_idempotency_key
  ON bookings (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```
Both columns are nullable and the index is partial (`WHERE idempotency_key
IS NOT NULL`), so every one of the 15 existing real production booking rows
is valid immediately, unchanged, with no backfill required — satisfying
"existing bookings without keys remain valid" for real production data, not
just the staging fixture.

## 2. Exact Worker diff (`nadi-dispatch-api`)

Two independent changes, each already proven in staging:

**A. Durable idempotency in `createBookingRecord`/`handleGuestBookingCreate`:**
replace nothing — this is purely additive. Before the existing
`INSERT INTO bookings`, add the idempotency-key validation (require an
`Idempotency-Key` header, validate UUID format, 400 if missing/malformed),
compute the material-facts fingerprint (excluding `guest_name`/`guest_phone`/
`notes`), look up any existing row for that key, and branch exactly as the
staging Worker does: identical fingerprint → return the original booking;
different fingerprint → 409 `idempotency_key_reused`; no existing row →
proceed to the existing INSERT, wrapped in a try/catch for the UNIQUE
constraint race (see staging `worker.js` for the exact, tested code).

**B. Custom-address hardening:** exactly the patch already written and
tested in `apps/nadi-guest-widget/server-proposal/nadi-dispatch-api-custom-address-hardening.md`
(E3B) — reuse the resolved `geocoded_addresses` row from the guest's own
prior `/quote` call instead of the current log-only 0.7×–3× tolerance.
Requires the matching additive client change already made to `app.js`
(`custom_address`/`custom_address_direction` fields, E3B) plus the new
`idempotency_key`/`Idempotency-Key` header (E3D, already added to `app.js`
in this same branch).

## 3. Backward compatibility

- Old clients that never send `Idempotency-Key` at all: today's booking
  path currently has no such requirement, so production must decide whether
  to make the header **required** (matching staging, which returns 400
  without it) or **optional with a server-generated fallback** for a
  transition window. Recommend: optional for one deploy cycle (server
  generates a UUID server-side if absent, logs a `missing_client_idempotency_key`
  reason code for visibility), then required once the live client (this
  branch's `app.js`) is confirmed to be the only caller.
- Existing rows: unaffected, per the partial index above.
- `/quote` contract: unchanged in both proposals — only `/bookings`'
  request/response shape gains fields, nothing is removed.

## 4. Migration rehearsal

Already performed, functionally: the staging pair *is* the rehearsal. Same
schema shape, same Worker logic, same D1 engine (SQLite via D1), same
UNIQUE-partial-index mechanism. The one thing staging could not rehearse is
the ALTER TABLE against a live table with real traffic — recommend running
the two `ALTER TABLE`/`CREATE UNIQUE INDEX` statements once against a fresh
`wrangler d1 execute --local` copy seeded from a real production export
(the E1 preserved backup, `d1_backups_20260823.zip`, already gives you an
exact byte-for-byte copy to rehearse against without touching the live
database).

## 5. Production idempotency rollout (staged)

1. Deploy the schema migration alone (additive, zero behavior change).
2. Deploy the Worker change with `Idempotency-Key` optional (server-generated
   fallback), monitor for a normal traffic cycle.
3. Deploy the current `app.js` (already generates a real client-side UUID,
   in this branch) to whichever Pages project serves real guests.
4. Flip `Idempotency-Key` to required once step 3's rollout is confirmed.

## 6. Custom-address hardening rollout

Independent of idempotency — can ship in either order. Recommend idempotency
first (lower behavioral risk, purely additive), then custom-address
hardening (changes what a guest is charged in the narrow custom-address
case, so worth its own monitoring window).

## 7. Monitoring

Watch, for at least one full week post-rollout: rate of `409
idempotency_key_reused` responses (should be ~0 in real traffic — a nonzero
rate means something is generating a real key collision, worth
investigating rather than ignoring), rate of `manual_quote_required` outcomes
for custom addresses (expected to rise slightly since the hardened path is
stricter than today's log-only tolerance), and `pricing_note` frequency on
standard routes (should stay at today's level, since that logic is
unchanged).

## 8. Rollback

Both changes are pure additive schema + logic; rollback is a straight
Worker redeploy to the previous version (Cloudflare retains full deployment
history, already verified reachable in E3A) plus, if ever necessary,
dropping the two new columns and the index (a normal, reversible `ALTER
TABLE`/`DROP INDEX` — no data loss, since nothing else reads those columns).

## 9. Zero-downtime sequence

Schema migration (additive) → Worker deploy (additive, backward-compatible
per §3) → client deploy → flip-to-required. No step requires downtime; each
is independently reversible without the others.
