# Fiji AI Ecosystem Governance

**Status:** Mandatory governance foundation. It authorizes no runtime implementation, deployment, D1 change, or Fare Service Phase 2.

## Mandatory laws

1. James is the sole stage-gate authority.
2. No phase is complete without a GitHub-visible branch, commit SHA and PR.
3. No production deployment without explicit James approval.
4. No D1 schema change without a versioned migration.
5. No operational secret in source.
6. No AI output becomes operational truth without an authoritative service.
7. No pricing data is copied into prompts as a competing authority.
8. No booking may exist only in WhatsApp.
9. WhatsApp is a communication channel, not the booking system of record.
10. There must be one pricing authority.
11. There must be one booking authority.
12. There must be one lead authority.
13. Every AI action affecting a traveler must be attributable and auditable.
14. Private traveler and partner data must be minimized and access-controlled.
15. AI must fail closed when an authoritative result is unavailable.
16. Architecture, implementation, verification, staging and production are separate stage gates.
17. No new revenue branch may bypass shared identity, pricing, booking, consent and audit foundations.
18. Codex and Claude may build but may not self-authorize phase advancement.

ComeToFiji is the traveler-facing platform and Lagi is the intelligence layer. D1-backed services own operational truth; Git owns implementation truth. AI owns none of pricing, bookings, dispatch, or payments.

## Git, branches, and pull requests

Protected `main` represents approved integration history. Work uses a scoped branch, small reviewable commits, and no direct production change. Every PR states base/head, scope and exclusions, authority/data impact, migrations, tests, security/privacy review, rollout, rollback, and unresolved risks; it links evidence and identifies James's required gate. Draft status is used while evidence or approval is incomplete. Agents do not merge or infer approval.

## Review gates and evidence

Each of architecture, implementation, verification, staging, and production has its own recorded James decision. Evidence must be reproducible and GitHub-visible: branch, exact commit SHA, PR, changed-file inventory, command/test output, schema and contract versions, fixture/parity reports, security and privacy checks, staging observations, rollback rehearsal, and known limitations. Statements without artifacts are not completion evidence.

| Gate | Entry criteria | Exit criteria and evidence owner | Approver | Invalidation condition | Rejection / rollback condition |
|---|---|---|---|---|---|
| Architecture | bounded problem, owners, authority map, privacy/threat assumptions | reviewed contracts, alternatives, risks and decision record; architecture owner supplies evidence | James | material scope, authority, threat or data-class change | return to architecture; no implementation authority |
| Implementation | approved architecture and scoped branch/PR plan | reviewed code/config/migrations, tests and traceability; implementation owner supplies evidence | James | material implementation, dependency, schema or contract change | reject artifact or revert branch change |
| Verification | immutable candidate and test plan | independent required checks, defect disposition and reproducible report; verification owner supplies evidence | James | candidate or acceptance-criteria change | reject candidate and return to implementation |
| Staging | verified candidate, staging/rollback plan and non-production controls | observed acceptance, security/privacy checks and rollback rehearsal; release owner supplies evidence | James | artifact, configuration, environment or material finding changes | remove candidate and invoke rehearsal plan |
| Production | approved staging evidence, exact artifact/config/migrations, owner and monitoring | explicit time-bound production decision and retained evidence; production release owner supplies evidence | James | artifact/config/migration change or expired approval | do not release, halt rollout, or roll back to named safe version |

## Testing standards

Changes require scope-appropriate unit, integration, contract, fixture, negative authorization, privacy/redaction, idempotency, migration, observability, and rollback tests. Pricing requires deterministic reconciliation and parity evidence; booking requires persistence and state-transition evidence. Documentation requires link, contradiction, production-claim, secret-pattern, whitespace, and changed-file checks. Failures are resolved or explicitly block the gate.

## Staging, production, and rollback

Staging uses non-production credentials and minimized synthetic/sanitized data, cannot silently call production, is clearly labeled, and requires an approved entry plan and exit evidence. Production needs explicit James approval tied to an exact reviewed artifact, versioned migrations, secrets provisioned outside source, monitoring, incident owner, feature controls, and rehearsed rollback.

Every releasable change identifies rollback owner, triggers, response window, last safe artifact/config/schema, data compatibility, communication path, and evidence-preservation plan. Rollback must not rewrite quote, booking, payment, dispatch, or audit history.

## Incident ownership

Each authority has a named human service owner and on-call/response path. The incident commander contains impact, protects travelers, preserves logs, and communicates verified status; data owners reconcile affected records. AI may assist drafting and analysis but cannot declare resolution or authorize restoration. James owns stage-gate decisions following an incident.

## Data-authority ownership

Authority ownership follows the [AI authority contracts](FIJI_AI_AUTHORITY_CONTRACTS.md): Knowledge and Destination own Fiji/place facts; Availability owns live inventory and bookability; the Interim Pricing Authority owns the narrowly approved current scope until an explicit transfer gate, after which Fare owns rules and prices for that scope; Promotion owns campaigns and redemptions while Fare owns their monetary application; Quote owns immutable quotes; Booking owns bookings; Partner Directory owns partners; one Lead Service owns leads; Dispatch, Payment, Communication, consent-controlled Traveler Profile, Verified Review, Currency Rate, Operational Notice, and Audit Evidence services own their respective records. Identity owns subject and actor identity, and the Consent Ledger owns purpose-scoped grants and revocations. Services use least privilege, classification, minimization, retention, consent, audit, and stable identifiers. Booking API publication remains a blocking dependency.

## AI safety boundaries

Lagi may interpret, retrieve, compare, draft, and request authorized service actions. It never becomes authority by confidence or fluent prose. It must label suggestions, preserve provenance, avoid secret/private leakage, resist prompt attempts to bypass policy, use consented context only, and fail closed without a fresh authoritative result. Human approval cannot substitute for missing persistence where an authoritative service is required.

Every tool call is authorized against the authenticated actor, declared purpose, target service, exact operation, resource scope, and current consent; default is deny, and delegation cannot exceed the initiating actor. Explicit traveler or authorized human confirmation is required immediately before booking creation, cancellation, payment initiation, or a material itinerary change. Confirmation does not bypass availability, quote, identity, consent, or service authorization.

Partner content, reviews, web content, retrieved documents, and traveler messages are untrusted data isolated from system instructions and tool authorization. They cannot supply credentials, change policy, select privileged tools, or be treated as executable instructions. Derived output retains source attribution and is validated before any service action.

Logs minimize and redact traveler, partner, credential, token, and payment data; prompts and model traces follow classification, access, and retention policy. Every AI-assisted decision or tool request records model/provider and model version, prompt/policy version, actor, purpose, sources, tool operation, authority response, correlation ID, and outcome in the Audit Evidence Service.

## Emergency changes

An emergency may accelerate timing but never allow an agent to self-authorize, expose secrets, bypass authoritative services, or erase evidence. The incident commander records impact, narrow scope, exact artifact/configuration, human authorizer, available validation, monitoring, expiry, and rollback trigger. James explicitly authorizes production emergency action where reachable; otherwise a pre-approved human emergency policy governs containment and safe rollback only. Within the recorded review window, the evidence owner supplies retrospective tests, security/privacy review, incident timeline, reconciliation, and a PR/commit record for James's ratification or rejection. Unratified temporary changes expire and are rolled back.

## Duplicate-system deprecation

Inventory duplicate tables, prompts, spreadsheets, scripts, and channel-only records. Name the canonical authority, capture approved behavior as fixtures, migrate consumers behind controls, reconcile results, monitor, and retain rollback. Disable and then remove duplicates only after James approves evidence that all consumers have moved and historical records remain readable. Never allow an unowned fallback to become a second authority.

## Future agents and releases

Future agents receive an explicit scope, branch, allowed files/actions, required checks, and stopping point. They may propose and build within scope but cannot expand a phase, deploy, merge, approve their own evidence, expose credentials, or begin dependent work. Ambiguity and missing authority block action and are escalated to James.

The first commercial release remains very small. Fare Service Phase 2 is not yet authorized, and no new revenue branch may start by evading these foundations.
