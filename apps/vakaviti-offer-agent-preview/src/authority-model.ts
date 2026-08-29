// Phase A-R, item 6: corrected authority matrix (CEO directive 2026-08-29).
//
// Every state transition in this module returns a StateTransitionRecord carrying actor type/id,
// reason code, evidence, prior state, next state and timestamp - the uniform audit shape the
// directive requires. Each function throws (never silently no-ops) when the calling actor lacks
// authority for that specific transition - a caller cannot "successfully" perform an unauthorized
// change and only discover the rejection by inspecting a return value.
//
// This is the corrected version of the authority statements in the original pre-implementation
// report: that report's Human Review Queue section listed RESTORE as a human action without also
// stating that an agent could ever restore anything - restoreByHuman()/restoreViaCleanRevalidation()
// below make that explicit as two separate, independently-gated functions, so "restore" is never a
// single ambiguous capability.

export type ActorType = 'HUMAN' | 'AGENT_OPERATIONS_SUPERVISOR' | 'AGENT_EXPIRY_QUARANTINE' | 'SYSTEM_DETERMINISTIC_RULE';

export interface Actor {
  type: ActorType;
  id: string;
}

export interface StateTransitionRecord<S extends string> {
  actorType: ActorType;
  actorId: string;
  reasonCode: string;
  evidence: string | null;
  priorState: S;
  nextState: S;
  timestamp: string;
}

const defaultNow = () => new Date().toISOString();

class AuthorityError extends Error {}

// --- 1. Global kill switch: authenticated human only, no exception -------------------------------
export type KillSwitchState = 'ACTIVE' | 'INACTIVE';

export function setGlobalKillSwitch(
  actor: Actor, priorState: KillSwitchState, nextState: KillSwitchState,
  reasonCode: string, evidence: string | null, now: () => string = defaultNow
): StateTransitionRecord<KillSwitchState> {
  if (actor.type !== 'HUMAN') {
    throw new AuthorityError(`Global kill switch may only be changed by an authenticated human actor (got actor type "${actor.type}").`);
  }
  return { actorType: actor.type, actorId: actor.id, reasonCode, evidence, priorState, nextState, timestamp: now() };
}

// --- 2. Source pause: OperationsSupervisor OR authenticated human ---------------------------------
// Source APPROVAL (PENDING/PAUSED/REJECTED -> APPROVED) is intentionally a SEPARATE function
// (approveSource) requiring HUMAN only - pause and approve are not symmetric operations.
export type SourceApprovalState = 'PENDING_REVIEW' | 'APPROVED' | 'PAUSED' | 'REJECTED';

export function pauseSource(
  actor: Actor, priorState: SourceApprovalState, reasonCode: string, evidence: string,
  now: () => string = defaultNow
): StateTransitionRecord<SourceApprovalState> {
  if (actor.type !== 'HUMAN' && actor.type !== 'AGENT_OPERATIONS_SUPERVISOR') {
    throw new AuthorityError(`Source pause requires the OperationsSupervisor agent or an authenticated human actor (got "${actor.type}").`);
  }
  if (priorState !== 'APPROVED') {
    throw new AuthorityError(`Cannot pause a source that is not currently APPROVED (was "${priorState}").`);
  }
  return { actorType: actor.type, actorId: actor.id, reasonCode, evidence, priorState, nextState: 'PAUSED', timestamp: now() };
}

export function approveSource(
  actor: Actor, priorState: SourceApprovalState, reasonCode: string, evidence: string,
  now: () => string = defaultNow
): StateTransitionRecord<SourceApprovalState> {
  if (actor.type !== 'HUMAN') {
    throw new AuthorityError(`Source approval requires an authenticated human actor - no agent type may approve or self-approve a source (got "${actor.type}").`);
  }
  return { actorType: actor.type, actorId: actor.id, reasonCode, evidence, priorState, nextState: 'APPROVED', timestamp: now() };
}

// --- 3. Offer quarantine: deterministic expiry/material-change rule, OR authenticated human -------
// "Deterministic rule" is its own actor type (SYSTEM_DETERMINISTIC_RULE), never a generic AI agent
// type - this function additionally restricts which reason codes a non-human actor may use, so a
// deterministic rule can never quarantine for an arbitrary/undocumented reason.
export type OfferQuarantineState = 'PUBLISHED' | 'QUARANTINED';
export type QuarantineReasonCode = 'EXPIRY' | 'MATERIAL_CHANGE' | 'HUMAN_DECISION' | 'DISPUTE';

const DETERMINISTIC_RULE_ALLOWED_REASONS: Set<QuarantineReasonCode> = new Set(['EXPIRY', 'MATERIAL_CHANGE']);

export function quarantineOffer(
  actor: Actor, priorState: OfferQuarantineState, reasonCode: QuarantineReasonCode, evidence: string,
  now: () => string = defaultNow
): StateTransitionRecord<OfferQuarantineState> {
  const actorIsHuman = actor.type === 'HUMAN';
  const actorIsAllowedRule = actor.type === 'SYSTEM_DETERMINISTIC_RULE' && DETERMINISTIC_RULE_ALLOWED_REASONS.has(reasonCode);
  if (!actorIsHuman && !actorIsAllowedRule) {
    throw new AuthorityError(
      `Offer quarantine requires an authenticated human, or the deterministic rule engine using an EXPIRY/MATERIAL_CHANGE reason code (got actor "${actor.type}" with reason "${reasonCode}").`
    );
  }
  if (priorState !== 'PUBLISHED') {
    throw new AuthorityError(`Cannot quarantine an offer that is not currently PUBLISHED (was "${priorState}").`);
  }
  return { actorType: actor.type, actorId: actor.id, reasonCode, evidence, priorState, nextState: 'QUARANTINED', timestamp: now() };
}

// --- 4. Offer/source restore: authenticated human, OR an explicitly-approved, fully-tested clean- --
//        revalidation transition. These are two DISTINCT functions - there is no single "restore"
//        capability that both a human and an automated path share implicitly.
export type RestorableState = 'QUARANTINED' | 'PAUSED' | 'REJECTED';
export type RestoredState = 'PUBLISHED' | 'APPROVED';

export function restoreByHuman(
  actor: Actor, priorState: RestorableState, nextState: RestoredState, reasonCode: string, evidence: string,
  now: () => string = defaultNow
): StateTransitionRecord<string> {
  if (actor.type !== 'HUMAN') {
    throw new AuthorityError(`Human-path restore requires an authenticated human actor (got "${actor.type}"). Use restoreViaCleanRevalidation() for the automated path.`);
  }
  return { actorType: actor.type, actorId: actor.id, reasonCode, evidence, priorState, nextState, timestamp: now() };
}

// A "complete clean revalidation" is not a claim this module takes on faith - the caller must
// supply proof that every gate the offer/source would need to pass on FIRST approval has been
// re-run and passed, with fresh (not carried-over) evidence. Any missing or failed gate throws -
// there is no partial-credit automated restore.
export interface CleanRevalidationResult {
  allGatesRePassed: boolean;
  failedGates: string[];
  evidenceIsFresh: boolean; // false if any reused/stale evidence timestamp was involved
  revalidatedAt: string;
}

export function restoreViaCleanRevalidation(
  actor: Actor, priorState: RestorableState, nextState: RestoredState,
  revalidation: CleanRevalidationResult, evidence: string,
  now: () => string = defaultNow
): StateTransitionRecord<string> {
  if (actor.type !== 'SYSTEM_DETERMINISTIC_RULE' && actor.type !== 'HUMAN') {
    throw new AuthorityError(`Automated restore may only run as the deterministic rule engine, never a generic AI agent (got "${actor.type}").`);
  }
  if (!revalidation.allGatesRePassed || revalidation.failedGates.length > 0) {
    throw new AuthorityError(`Clean-revalidation restore requires ALL gates to re-pass with zero failures (failed: ${revalidation.failedGates.join(', ') || 'none listed but allGatesRePassed=false'}).`);
  }
  if (!revalidation.evidenceIsFresh) {
    throw new AuthorityError('Clean-revalidation restore requires fresh evidence - carried-over/stale evidence cannot support an automated restore.');
  }
  return {
    actorType: actor.type, actorId: actor.id, reasonCode: 'CLEAN_REVALIDATION_PASSED', evidence,
    priorState, nextState, timestamp: now(),
  };
}
