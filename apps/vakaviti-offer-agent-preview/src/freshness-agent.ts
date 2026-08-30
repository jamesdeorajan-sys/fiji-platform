// FreshnessAgent - CEO directive Phase 6 recheck cadence, expressed as a per-offer isDue()
// decision (offer-workflow.ts's RecheckerPort) rather than the cron interval itself. The cron
// fires every 12 minutes (wrangler.toml) purely so this preview can demonstrate frequent,
// genuinely unattended cycles within an observable window - the PER-OFFER cadence below is exactly
// the directive's real target windows, independent of how often the tick runs.
import type { Env } from './env';
import type { RecheckSubject, RecheckerPort } from './offer-workflow';

export const IMMINENT_EXPIRY_WINDOW_HOURS = 6;   // "imminent expiry: at least every 6 hours"
export const VOLATILE_OR_ORDINARY_WINDOW_HOURS = 24; // "volatile priced offers: daily" / "ordinary active offers: daily"
export const STABLE_LONG_VALIDITY_WINDOW_HOURS = 72; // "long-validity stable offers: maximum every 72 hours"
const IMMINENT_EXPIRY_THRESHOLD_HOURS = 72; // an offer whose deadline/travel-end is within this window counts as "imminent"

export type OfferVolatilityBucket = 'IMMINENT_EXPIRY' | 'VOLATILE_OR_ORDINARY' | 'STABLE_LONG_VALIDITY';

export function classifyOfferVolatility(offer: { bookingDeadline: string | null; hasExplicitPrice: boolean }, now: number = Date.now()): OfferVolatilityBucket {
  if (offer.bookingDeadline) {
    const deadlineMs = Date.parse(offer.bookingDeadline);
    if (!Number.isNaN(deadlineMs) && deadlineMs - now <= IMMINENT_EXPIRY_THRESHOLD_HOURS * 3600_000) {
      return 'IMMINENT_EXPIRY';
    }
  }
  if (!offer.bookingDeadline && !offer.hasExplicitPrice) {
    return 'STABLE_LONG_VALIDITY'; // no deadline, no price to go stale - a genuinely long-validity special
  }
  return 'VOLATILE_OR_ORDINARY';
}

export function recheckWindowHoursFor(bucket: OfferVolatilityBucket): number {
  switch (bucket) {
    case 'IMMINENT_EXPIRY': return IMMINENT_EXPIRY_WINDOW_HOURS;
    case 'VOLATILE_OR_ORDINARY': return VOLATILE_OR_ORDINARY_WINDOW_HOURS;
    case 'STABLE_LONG_VALIDITY': return STABLE_LONG_VALIDITY_WINDOW_HOURS;
  }
}

export function makeRechecker(): RecheckerPort {
  return {
    isDue(subject: RecheckSubject): boolean {
      const bucket = classifyOfferVolatility({
        bookingDeadline: (subject.currentFacts.booking_deadline as string | null) ?? null,
        hasExplicitPrice: !!subject.currentFacts.advertised_price,
      });
      const windowHours = recheckWindowHoursFor(bucket);
      const checkedAt = (subject.currentFacts._checkedAt as string | undefined) ?? null;
      if (!checkedAt) return true; // never checked - always due
      const ageHours = (Date.now() - Date.parse(checkedAt)) / 3600_000;
      return ageHours >= windowHours;
    },
  };
}

/** Enqueues every currently-PUBLISHED offer whose bucket window has elapsed. */
export async function runFreshnessTick(env: Env): Promise<{ offersConsidered: number; enqueued: number }> {
  const published = await env.DB.prepare(
    `SELECT id, provider_id, canonical_source_url, booking_deadline, price_amount, checked_at, source_family_id FROM deal_exchange_offers WHERE publication_decision='ELIGIBLE'`
  ).all<any>();

  const rechecker = makeRechecker();
  let enqueued = 0;
  for (const row of published.results || []) {
    const subject: RecheckSubject = {
      offerId: row.id, sourceId: row.source_family_id, canonicalUrl: row.canonical_source_url,
      currentFacts: { booking_deadline: row.booking_deadline, advertised_price: row.price_amount, _checkedAt: row.checked_at },
      currentState: 'PUBLISHED',
    };
    if (!rechecker.isDue(subject)) continue;
    const idempotencyKey = `recheck:${row.id}:${new Date().toISOString().slice(0, 13)}`; // at most one recheck attempt per offer per hour-slot
    await env.RECHECK_QUEUE.send({ offerId: row.id, idempotencyKey });
    enqueued++;
  }
  return { offersConsidered: (published.results || []).length, enqueued };
}
