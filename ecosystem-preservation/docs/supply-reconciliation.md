# Supply reconciliation (read-only comparison — nothing imported or published)

## Counts observed this session

| Source | Table | Count |
|---|---|---|
| vakaviti-kb | partners | 39 |
| vakaviti-kb | deals | 10 |
| vakaviti-kb | leads | 139 |
| come_to_fiji_db | tours | 65 |
| discoverfiji-content | tours | 14 |
| Stage 1 (vakaviti-marketplace-stage1) | operators | (Stage 1 supply-bootstrap set, 7 source domains — see P1.5) |
| Stage 1 | deals/deal_candidates | 10 pre-existing weak candidates + Class B pipeline output |

## Identity conflicts found

1. **Direct duplicate: "Nadi Airport Transfers."** Exists as `vakaviti-kb.partners` row `op_nadi_001`
   AND as a Stage 1 operator record populated by the P1.5 supply bootstrap from
   nadiairporttransfers.com. These are the same real-world business represented twice, in two
   separate databases, with no cross-reference between them. Merging or de-duplicating these
   records was explicitly out of scope for this read-only phase — flagged for a separately
   authorized reconciliation pass.
2. **Possible duplicate, unconfirmed: "Tour Fiji Tours."** `vakaviti-kb.partners` row
   `op_tourfiji_001` (domain `tourfiji.tours`) may or may not be the same business as
   "Fiji Tour Transfers" (`fijitourtransfers.com`) referenced elsewhere in the ecosystem and in
   Stage 1's supply-source list. The names, domains, and TLDs differ enough that this should be
   verified with James directly rather than assumed either way.

## Records safe to promote (source-evidenced, no personal data, no known conflict)

- The 63 non-Nadi-Airport-Transfers, non-Tour-Fiji-Tours `vakaviti-kb.partners` rows not already
  represented in Stage 1's operator set are, on their face, candidates for a future factual-only
  Class A listing pass — subject to the same auto-publish gates already enforced in
  `deal-quality.ts`/`supply-scheduler.ts`, and subject to a full duplicate check against Stage 1's
  current operator table before any import (not performed here — read-only phase).

## Records requiring research before any promotion

- "Nadi Airport Transfers" and "Tour Fiji Tours" / "Fiji Tour Transfers" (identity conflicts above).
- `come_to_fiji_db.tours` (65 rows) and `discoverfiji-content.tours` (14 rows) were not
  cross-checked against either vakaviti-kb or Stage 1 in this phase — both databases are bound to
  Workers (`come-to-fiji-*`, `fiji-drafting-console`) with no discovered connection to Stage 1's
  own supply pipeline. Whether any of their 79 combined rows overlap with existing supply is
  unknown and unverified.

## Records containing personal data that must not be moved

- `vakaviti-kb.leads` (139 rows) — contains guest contact information; must never be exported,
  copied, or promoted into any public-facing table by an automated process.
- `nadi-marketplace-db.bookings`/`drivers`/`wallets`/`wallet_transactions` — real transactional and
  driver personal data; same rule applies.
- Stage 1's own `enquiries`/`deal_enquiries` tables — same rule applies.

## Price/material contradictions

None were checked in this phase — a line-by-line price/inclusion comparison between
`vakaviti-kb.partners`/`deals` and Stage 1's operator/deal records was out of scope for a read-only
reconciliation pass and would require the same kind of fact-level review the Class B auto-publish
gates already perform automatically for Stage 1's own pipeline.

## Conclusion

No import or publish action was taken. The two identity conflicts above (Nadi Airport Transfers
confirmed duplicate; Tour Fiji Tours possible duplicate) are the most material findings and should
be resolved by James directly before any cross-database supply consolidation is attempted.
