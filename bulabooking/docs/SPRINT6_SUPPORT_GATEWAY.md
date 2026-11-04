# Sprint 6: support gateway (isolated, not deployed)

The new modules implement **pure support classification and HMAC primitives**, not an active webhook endpoint or live WhatsApp integration.

## Required live architecture
1. Provider-specific webhook handler: verify raw bytes against the official provider signature scheme and validate timestamp/replay requirements where applicable.
2. Persist inbound message with unique provider message ID, channel and event timestamp; return success on safe duplicates.
3. Apply consent, topic routing, authoritative booking lookup and operator/guest access control.
4. Persist durable staff queue and event outbox before acknowledging an event.
5. Route urgent airport pickup, missing driver, safety and booking-change cases to staffed escalation with acknowledgement SLA.
6. AI only answers approved FAQs using verified, current operator content. AI cannot change prices, confirm bookings, or promise refunds.
7. Track human availability from actual roster/heartbeat, not assumed 24/7 staffing.
8. Enforce retention, encryption, audit logs, redaction, opt-out, message template compliance and monitoring.

## Not yet complete
No real Meta WhatsApp Business webhook handler, provider signature header integration, outbound WhatsApp messages, AI model calls, database-backed queue, authentication, booking lookup or staff console. Never claim live WhatsApp support in the preview.

## Tests to run
Run node --test tests/*.test.mjs from bulabooking after installing compatible Node.js (20+). Run an independent security review and staging integration tests before production approval.
