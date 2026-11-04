# Sprint 7 — booking audit and listing intelligence (not deployed)

## Business requirement
Every real online booking request is saved server-side before success is shown. Preserve an immutable booking reference, UTC creation timestamp, operator/listing attribution, FJD quote in integer cents, request source, consent and lifecycle transitions. Record operator response timestamps, cancellation/expiry reasons and support escalation. Never confuse saved requests with accepted bookings or paid revenue.

## Recommended data model — staging migration required
- booking_records: booking_id UNIQUE, operator_id, listing_id, created_at, service_date, status, currency CHECK='FJD', quoted_total_cents, source, campaign, referrer_domain (sanitized), guest_contact_encrypted, consent_version, is_test, retention_until.
- booking_audit_events: event_id UNIQUE, booking_id, actor_type, actor_id, previous_status, next_status, occurred_at, correlation_id, sanitized_reason. Append-only; no silent status edits.
- analytics_events: event_id UNIQUE, occurred_at, provider_id, listing_id, event_name, source, booking_id NULL, session_pseudonym NULL, consent_class; no names, phone numbers, raw URLs containing tokens, message bodies or IP addresses.
- listing_visibility_snapshots: provider_id, listing_id, snapshot_date, canonical_url, HTTP/indexability, sitemap status, rendered text checks, schema validation, mobile status, last_verified_at.
- search_metrics_daily: listing_id, date, search_engine, country, device, impressions, clicks, CTR, average_position, data_source. Import only verified GSC/Bing data.
- ai_discovery_observations: listing_id, observed_at, assistant_or_referrer, method, query_or_campaign_id, observed_referrals, evidence_source, limitations. AI assistant rankings and citation frequency are not universally measurable; never fabricate them.
- notification_outbox: event_id UNIQUE, booking_id, channel, state, attempt_count, next_attempt_at, delivered_at, failure_code.

## CEO dashboard
Funnel: impressions -> listing views -> booking starts -> saved requests -> operator accepted -> completed; report conversion by provider, listing, category, acquisition channel, date, device and country where consent and source data allow. Separate transfer handoffs from completed NAT/FijiDash transfer bookings; reconcile by correlation ID.

Provider scorecard: published listings, indexable listings, SEO readiness failures, Google/Bing impressions/clicks/position from actual integrations, observed AI referrals, requests, accepted bookings, cancellation rate, gross FJD quoted, support responsiveness and verified reviews. Use minimum reporting thresholds to avoid disclosing personal customer details.

## Reliability and privacy
Durable transaction plus outbox before acknowledgement; unique idempotency keys, immutable event IDs, retries, reconciliation job, monitored delivery lag, daily backup and recovery tests. Protect booking confirmation pages from indexing; role-scope provider access. Apply retention, encryption, consent, deletion requests, staff audit logs and anti-fraud controls.

## Truth in reporting
- 'Booking created' means persisted request, not accepted/paid.
- 'Accepted' means operator-confirmed, not necessarily paid.
- 'Quoted FJD' is not recognized revenue.
- Technical SEO readiness is not proof of ranking or AI citation.
- AI visibility requires real observed referrals, citations or reproducible checks, with source/method/time documented.
- GSC and Bing data can lag; mark reporting windows as provisional.
- These modules are contracts only; no data is being collected yet.
