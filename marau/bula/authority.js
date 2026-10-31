/* Confirmation / cancellation authority. Only SERVER code that has itself verified evidence (a staff session, a signed
 * operator-acceptance record, a verified provider callback) may mint one. A plain object arriving from a browser or
 * JSON body is never in the registry, so it cannot confirm anything. */
const issued = new WeakSet();
const CONFIRM_KINDS = new Set(['operator_acceptance_contract', 'staff_confirmation', 'payment_provider_callback']);
const CANCEL_KINDS = new Set(['guest_cancel', 'staff_cancel', 'operator_cancel']);
export function issueConfirmationAuthority({ kind, ref, verifiedBy }) {
  if (!CONFIRM_KINDS.has(kind) || !ref || !verifiedBy) throw new Error('bad confirmation authority');
  const a = Object.freeze({ kind, ref: String(ref), verifiedBy: String(verifiedBy) }); issued.add(a); return a;
}
export function issueCancellationAuthority({ kind, ref, verifiedBy, refundCredit = false }) {
  if (!CANCEL_KINDS.has(kind) || !verifiedBy) throw new Error('bad cancellation authority');
  if (kind !== 'guest_cancel' && !ref) throw new Error('staff/operator cancellation needs evidence ref');
  const a = Object.freeze({ kind, ref: ref ? String(ref) : null, verifiedBy: String(verifiedBy), refundCredit: !!refundCredit }); issued.add(a); return a;
}
export const isIssued = (a) => !!a && typeof a === 'object' && issued.has(a);
export const isConfirmation = (a) => isIssued(a) && CONFIRM_KINDS.has(a.kind);
export const isCancellation = (a) => isIssued(a) && CANCEL_KINDS.has(a.kind);
