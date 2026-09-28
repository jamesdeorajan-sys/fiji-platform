# Rollback policy — corrected per CEO instruction (Issue #38, 2026-09-02)

**Correction:** an earlier note in this workstream treated `ALTER TABLE ... DROP COLUMN` as a plausible rollback mechanism for the additive migration. That is wrong as a primary strategy and is withdrawn.

## Corrected policy

For this and every additive migration in the Vakaviti Transfer Core work:

1. **Primary rollback is always code, not schema.** If a release misbehaves, roll the Worker back to its last known-good version (`wrangler rollback --version-id <prior>`) and, if a frontend shipped in the same window, redeploy its last known-good artifact. This is fast, safe, and is the same mechanism already proven end-to-end in the Issue #34/PR #35 release.
2. **Additive columns and indexes are left in place, inert.** Because they're nullable (or, for `canonical_source`, carry a safe default) and no old code path ever references them, a rolled-back Worker version simply ignores them — there is nothing to clean up for the system to keep working correctly.
3. **Destructive schema reversal (`DROP COLUMN`, dropping an index) is never the default response to a bad release.** It would only be considered as a separate, explicitly-requested, explicitly-tested piece of work — e.g. if a column were later found to hold genuinely sensitive data that needed removing, not as a knee-jerk "undo" for a code-level problem that a Worker rollback already fixes.
4. **Historical data integrity comes first.** Rolling back code after a bad release must never touch rows written in the interim (matches Issue #36 rule 12 — no historical booking mutation during feature releases) — a code rollback changes what future requests do, not what past rows say.

This applies to the `milestone35-booking-source-attribution.sql` migration specifically, and is the standing rollback policy for every future additive migration in this workstream unless a separate release explicitly says otherwise.
