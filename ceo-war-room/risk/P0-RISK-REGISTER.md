# P0 RISK REGISTER

Status: ACTIVE
Last updated: 2026-08-15

Purpose: track risks capable of losing revenue, corrupting commercial truth, misleading travellers, damaging trust, or making production changes unsafe.

| Risk ID | Risk | Severity | Evidence state | Current control | Required next step |
|---|---|---|---|---|---|
| RISK-001 | Revenue cannot be reliably attributed end-to-end | P0 | FACT/HIGH CONFIDENCE | Historical metrics spec only; current dashboard incomplete | Reconcile live analytics/transaction IDs and implement minimum viable attribution |
| RISK-002 | Booking request may be mistaken for confirmed booking | P0 | FACT from live semantics + historical KPI language | None centrally enforced | Freeze canonical lifecycle and event names before dashboard work |
| RISK-003 | Commercial truth drift across prices/add-ons/policies | P0 | FACT: child-seat conflict and pricing duplication observed | Manual documents and per-surface code | Establish truth authority + conflict workflow before amplification |
| RISK-004 | Multiple/unclear fare authorities | P0 | FACT/HIGH CONFIDENCE from docs/code/history | Partial server-authoritative pricing in Fiji Dash | Reconcile live fare sources and select canonical implementation |
| RISK-005 | Lead/notification success may not equal actual delivery | P0 | HISTORICAL + CODE RISK | Some later reliability fixes documented | Verify deployed notification code and delivery telemetry |
| RISK-006 | Production asset/version mapping incomplete | P0 | FACT | Git archives and historical docs exist | Finish Production Register; prove deployment SHA/project/rollback per RED system |
| RISK-007 | Business/entity claims can conflict or lack evidence | P0/P1 | HIGH CONFIDENCE | Brand docs/history only | Build evidence-backed entity/claim register before broad structured-data syndication |
| RISK-008 | Historical Markdown labelled as source of truth conflicts with runtime code/data | P0 governance | FACT | CEO control plane now supersedes conflicting historical instructions | Mark stale docs non-authoritative over time; require conflict surfacing |
| RISK-009 | Fiji Dash critical lineage is unprotected/diverged | P0 asset protection | FACT/HIGH CONFIDENCE | Separate branch preserves work | Establish protected release/rollback policy before transaction-critical changes |
| RISK-010 | FTT live WordPress revenue platform is outside current HQ code governance | P0 operational | FACT | Production protected by no-change rule | Inventory host/theme/plugins/payments/backups and establish integration boundary |

## Escalation Rule
Any newly discovered issue that can cause silent booking loss, incorrect charge, misleading commercial claim, irreversible data corruption, broken fulfilment, or inability to recover production is P0 until evidence downgrades it.

## Closure Rule
A P0 risk is not closed because code was changed. It closes only after:
1. root cause is evidenced,
2. mitigation is deployed through an approved gate,
3. monitoring verifies expected behaviour,
4. rollback/recovery remains available,
5. CEO Decision/Performance ledgers are updated.
