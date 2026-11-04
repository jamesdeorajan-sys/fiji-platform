-- Apply after 0001 to a NEW staging-only BulaBooking D1 database.
-- Authorisation is enforced by the application adapter. These triggers enforce lifecycle integrity.
CREATE TRIGGER IF NOT EXISTS bb_booking_transition_guard
BEFORE UPDATE OF status ON bb_bookings
BEGIN
 SELECT CASE WHEN NOT (
  (OLD.status='pending' AND NEW.status IN ('accepted','declined','cancelled','expired'))
  OR (OLD.status='accepted' AND NEW.status IN ('completed','cancelled'))
 ) THEN RAISE(ABORT,'invalid_booking_transition') END;
END;
-- Record every successful lifecycle change and enqueue an event in the same SQLite transaction.
CREATE TRIGGER IF NOT EXISTS bb_booking_transition_audit
AFTER UPDATE OF status ON bb_bookings
BEGIN
 INSERT INTO bb_booking_events(id,booking_id,event_type,actor_type,occurred_at)
 VALUES(lower(hex(randomblob(16))),NEW.id,'booking_'||NEW.status,'system_transition',NEW.updated_at);
 INSERT INTO bb_outbox(id,booking_id,event_type,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.id,'booking_'||NEW.status,NEW.updated_at);
END;
-- Do not allow deletion of immutable booking or audit records.
CREATE TRIGGER IF NOT EXISTS bb_no_booking_delete
BEFORE DELETE ON bb_bookings BEGIN SELECT RAISE(ABORT,'booking_deletion_prohibited'); END;
CREATE TRIGGER IF NOT EXISTS bb_no_audit_update
BEFORE UPDATE ON bb_booking_events BEGIN SELECT RAISE(ABORT,'audit_update_prohibited'); END;
CREATE TRIGGER IF NOT EXISTS bb_no_audit_delete
BEFORE DELETE ON bb_booking_events BEGIN SELECT RAISE(ABORT,'audit_deletion_prohibited'); END;
