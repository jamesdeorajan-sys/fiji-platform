/* SUPERSEDED reference model (in-memory). Kept for history; the D1-backed inventory_credit.js / outbox_d1.js replace it and fix the review findings (scoped idempotency, authority, cancel policy, durable leases). Do not wire this file. */
/* Bula Happiness — transactional email outbox (ISOLATED). Capture sender only; live sender is a disabled stub.
 * Email failure can never fail or lose a saved booking. Provider acceptance != delivery != human acknowledgement. */
export const TEMPLATE_VERSION = 'booking-received-v1';
export const jobKey = (e) => `${e.eventId}|${e.bookingRef}|${e.recipient}|${e.template}`;

export function createOutbox() {
  const jobs = new Map();
  return {
    jobs: () => [...jobs.values()],
    /** Called from the verified server-side saved-booking event, in the same unit as the booking write. */
    enqueueForSavedBooking(evt) {
      const out = [];
      for (const [recipient, template] of [['guest', 'guest-' + TEMPLATE_VERSION], ['staff', 'staff-' + TEMPLATE_VERSION]]) {
        const key = jobKey({ ...evt, recipient, template });
        if (!jobs.has(key)) jobs.set(key, { key, recipient, template, bookingRef: evt.bookingRef, state: 'queued', attempts: 0, evidence: { providerAccepted: false, delivered: false, bounced: false, humanAck: false }, payload: evt });
        out.push(jobs.get(key));
      }
      return out;
    },
    /** state: queued -> sending -> accepted | failed(retriable) | ambiguous(needs reconciliation, never blind-resent). */
    async run(sender, render, { maxAttempts = 5 } = {}) {
      for (const j of jobs.values()) {
        if (j.state !== 'queued' && j.state !== 'failed') continue;
        if (j.attempts >= maxAttempts) { j.state = 'dead'; continue; }
        j.attempts++; j.state = 'sending';
        try {
          const r = await sender.send({ idempotencyKey: j.key, ...render(j) });
          j.state = 'accepted'; j.evidence.providerAccepted = true; j.providerId = r && r.id;
        } catch (e) {
          if (e && e.ambiguous) { j.state = 'ambiguous'; j.error = 'ambiguous_outcome'; } else { j.state = 'failed'; j.error = String(e && e.message || e).slice(0, 120); }
        }
      }
    },
    /** Provider webhook / lookup resolves ambiguity without resending. */
    reconcile(key, { accepted }) { const j = jobs.get(key); if (j && j.state === 'ambiguous') { j.state = accepted ? 'accepted' : 'queued'; j.evidence.providerAccepted = !!accepted; } },
  };
}
export function createCaptureSender({ failTimes = 0, ambiguousTimes = 0 } = {}) {
  const sent = []; let f = failTimes, a = ambiguousTimes;
  return { sent, async send(msg) {
    if (a-- > 0) { const e = new Error('timeout'); e.ambiguous = true; throw e; }
    if (f-- > 0) throw new Error('provider 503');
    if (sent.some((m) => m.idempotencyKey === msg.idempotencyKey)) return { id: 'dup-' + msg.idempotencyKey };
    sent.push(msg); return { id: 'cap-' + sent.length };
  } };
}
export const liveSenderDisabled = { async send() { throw new Error('LIVE_SENDER_DISABLED: EMAIL_SEND_ENABLED is off / provider not configured'); } };

/** Guest copy: "received" until a human/source confirmation exists; never invents driver, payment terms, or WhatsApp group. */
export function renderGuestEmail(job, { privateTripUrl, supportWhatsapp }) {
  const b = job.payload; const confirmed = b.status === 'confirmed';
  const lines = [
    confirmed ? 'Bula! Your transfer is confirmed.' : 'Bula! We have received your booking. It is not confirmed until our team confirms it.',
    `Ref: ${b.bookingRef}`, `Pickup: ${b.pickupFijiLocal} (Fiji time)`, `Route: ${b.from} -> ${b.to}`,
    `Price saved: ${b.currency} ${(b.priceCents / 100).toFixed(2)}`,
    b.passengers != null ? `Passengers: ${b.passengers}${b.luggage != null ? ', luggage: ' + b.luggage : ''}` : null,
    `Your private trip page: ${privateTripUrl}`, `Need help? Bula Happiness support: ${supportWhatsapp || '(support number to be verified)'}`,
  ];
  return { to: b.guestEmail, subject: confirmed ? `Booking confirmed ${b.bookingRef}` : `Booking received ${b.bookingRef}`, text: lines.filter((x) => x !== null).join('\n') };
}
