// Wires authority-model.ts's quarantineOffer() (already called inside offer-workflow.ts's
// runRecheckWorkflow before this function ever runs) to real D1 writes. Never deletes a record -
// deal_exchange_offer_history is append-only (trigger-enforced) and this function only ever
// UPDATEs publication_decision, preserving every prior fact column untouched.
import type { Env } from './env';
import type { QuarantinerPort } from './offer-workflow';

export function makeQuarantiner(env: Env): QuarantinerPort {
  return {
    async quarantine(offerId, transition): Promise<void> {
      const current = await env.DB.prepare(`SELECT publication_decision FROM deal_exchange_offers WHERE id=?`).bind(offerId).first<any>();
      if (!current) return; // offer no longer exists - nothing to quarantine, nothing to fabricate

      await env.DB.prepare(
        `INSERT INTO deal_exchange_offer_history (id, offer_id, field, old_value, new_value, reason) VALUES (?,?,?,?,?,?)`
      ).bind(crypto.randomUUID(), offerId, 'publication_decision', current.publication_decision, 'NOT_ELIGIBLE', `${transition.reasonCode}: ${transition.evidence}`).run();

      await env.DB.prepare(
        `UPDATE deal_exchange_offers SET publication_decision='NOT_ELIGIBLE', updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).bind(offerId).run();

      await env.DB.prepare(
        `INSERT INTO authority_transitions (id, transition_type, actor_type, actor_id, reason_code, evidence, prior_state, next_state, subject_id) VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(crypto.randomUUID(), 'OFFER_QUARANTINE', transition.actorType, transition.actorId, transition.reasonCode, transition.evidence, transition.priorState, transition.nextState, offerId).run();
    },
  };
}
