PRAGMA foreign_keys = ON;

CREATE TABLE guests (id TEXT PRIMARY KEY, display_name TEXT, created_at TEXT NOT NULL);
CREATE TABLE guest_contacts (id TEXT PRIMARY KEY, guest_id TEXT NOT NULL REFERENCES guests(id), kind TEXT NOT NULL CHECK(kind IN ('email','phone','whatsapp')), normalized_value TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)), UNIQUE(kind, normalized_value));
CREATE TABLE zones (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)));
CREATE TABLE destinations (id TEXT PRIMARY KEY, zone_id TEXT NOT NULL REFERENCES zones(id), slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)));
CREATE TABLE guest_stays (id TEXT PRIMARY KEY, guest_id TEXT NOT NULL REFERENCES guests(id), destination_id TEXT NOT NULL REFERENCES destinations(id), starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, CHECK(ends_at > starts_at));
CREATE TABLE guest_preferences (id TEXT PRIMARY KEY, guest_id TEXT NOT NULL REFERENCES guests(id), key TEXT NOT NULL, value_json TEXT NOT NULL, UNIQUE(guest_id,key));
CREATE TABLE guest_interests (id TEXT PRIMARY KEY, guest_id TEXT NOT NULL REFERENCES guests(id), key TEXT NOT NULL, UNIQUE(guest_id,key));
CREATE TABLE guest_events (id TEXT PRIMARY KEY, guest_id TEXT NOT NULL REFERENCES guests(id), event_type TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', occurred_at TEXT NOT NULL);

CREATE TABLE pricing_versions (id TEXT PRIMARY KEY, version INTEGER NOT NULL UNIQUE, currency TEXT NOT NULL CHECK(currency GLOB '[A-Z][A-Z][A-Z]' AND length(currency)=3), status TEXT NOT NULL CHECK(status IN ('draft','active','retired')), effective_from TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE pricing_rules (id TEXT PRIMARY KEY, pricing_version_id TEXT NOT NULL REFERENCES pricing_versions(id), origin_zone_id TEXT NOT NULL REFERENCES zones(id), destination_zone_id TEXT NOT NULL REFERENCES zones(id), rule_type TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer'), configuration_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE quotes (id TEXT PRIMARY KEY, guest_id TEXT REFERENCES guests(id), origin_destination_id TEXT NOT NULL REFERENCES destinations(id), destination_id TEXT NOT NULL REFERENCES destinations(id), pricing_version_id TEXT NOT NULL REFERENCES pricing_versions(id), currency TEXT NOT NULL CHECK(currency GLOB '[A-Z][A-Z][A-Z]' AND length(currency)=3), standard_fare_minor INTEGER NOT NULL CHECK(typeof(standard_fare_minor)='integer' AND standard_fare_minor>=0), flexible_fare_minor INTEGER CHECK(flexible_fare_minor IS NULL OR (typeof(flexible_fare_minor)='integer' AND flexible_fare_minor>=0)), expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE quote_components (id TEXT PRIMARY KEY, quote_id TEXT NOT NULL REFERENCES quotes(id), component_type TEXT NOT NULL CHECK(component_type IN ('standard','flexible_adjustment','fee','tax','discount')), amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer'), currency TEXT NOT NULL CHECK(currency GLOB '[A-Z][A-Z][A-Z]' AND length(currency)=3));

CREATE TABLE drivers (id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('onboarding','active','suspended','inactive')), created_at TEXT NOT NULL);
CREATE TABLE vehicles (id TEXT PRIMARY KEY, driver_id TEXT NOT NULL REFERENCES drivers(id), registration TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)));
CREATE TABLE driver_zones (driver_id TEXT NOT NULL REFERENCES drivers(id), zone_id TEXT NOT NULL REFERENCES zones(id), PRIMARY KEY(driver_id,zone_id));
CREATE TABLE driver_documents (id TEXT PRIMARY KEY, driver_id TEXT NOT NULL REFERENCES drivers(id), document_type TEXT NOT NULL, private_object_key TEXT NOT NULL UNIQUE, verification_status TEXT NOT NULL CHECK(verification_status IN ('pending','verified','rejected')), created_at TEXT NOT NULL);
CREATE TABLE driver_sessions (id TEXT PRIMARY KEY, driver_id TEXT NOT NULL REFERENCES drivers(id), started_at TEXT NOT NULL, ended_at TEXT, CHECK(ended_at IS NULL OR ended_at>started_at));
CREATE TABLE driver_status_events (id TEXT PRIMARY KEY, driver_id TEXT NOT NULL REFERENCES drivers(id), status TEXT NOT NULL, reason TEXT, occurred_at TEXT NOT NULL);

CREATE TABLE bookings (id TEXT PRIMARY KEY, guest_id TEXT NOT NULL REFERENCES guests(id), quote_id TEXT REFERENCES quotes(id), state TEXT NOT NULL CHECK(state IN ('pending','confirmed','dispatching','assigned','in_progress','completed','cancelled')), assigned_driver_id TEXT REFERENCES drivers(id), pickup_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE booking_events (id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id), from_state TEXT, to_state TEXT NOT NULL, actor_id TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', occurred_at TEXT NOT NULL);
CREATE TABLE dispatch_offers (id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id), driver_id TEXT NOT NULL REFERENCES drivers(id), state TEXT NOT NULL CHECK(state IN ('offered','accepted','declined','expired','withdrawn')), expires_at TEXT NOT NULL, created_at TEXT NOT NULL, responded_at TEXT, UNIQUE(booking_id,driver_id));
CREATE UNIQUE INDEX one_accepted_offer_per_booking ON dispatch_offers(booking_id) WHERE state='accepted';

CREATE TABLE wallets (id TEXT PRIMARY KEY, driver_id TEXT NOT NULL REFERENCES drivers(id), currency TEXT NOT NULL CHECK(currency GLOB '[A-Z][A-Z][A-Z]' AND length(currency)=3), created_at TEXT NOT NULL, UNIQUE(driver_id,currency));
CREATE TABLE wallet_transactions (id TEXT PRIMARY KEY, wallet_id TEXT NOT NULL REFERENCES wallets(id), idempotency_key TEXT NOT NULL UNIQUE, transaction_type TEXT NOT NULL CHECK(transaction_type IN ('credit','debit','commission','adjustment')), amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor!=0), reference_type TEXT, reference_id TEXT, occurred_at TEXT NOT NULL);

CREATE TABLE message_templates (id TEXT PRIMARY KEY, template_key TEXT NOT NULL UNIQUE, channel TEXT NOT NULL CHECK(channel IN ('whatsapp','sms','email')), locale TEXT NOT NULL, body TEXT NOT NULL, provider_approval_state TEXT NOT NULL CHECK(provider_approval_state IN ('defined','submitted','approved','rejected')), created_at TEXT NOT NULL);
CREATE TABLE message_deliveries (id TEXT PRIMARY KEY, template_id TEXT NOT NULL REFERENCES message_templates(id), recipient_normalized TEXT NOT NULL, provider_message_id TEXT UNIQUE, delivery_state TEXT NOT NULL CHECK(delivery_state IN ('queued','sent','delivered','failed')), verified_at TEXT, context_type TEXT, context_id TEXT, created_at TEXT NOT NULL);

CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor_type TEXT NOT NULL, actor_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, before_json TEXT, after_json TEXT, occurred_at TEXT NOT NULL);
CREATE TABLE platform_events (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL, payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL, published_at TEXT);
