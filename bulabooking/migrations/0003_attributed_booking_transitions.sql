-- STAGING ONLY: apply after 0001 and 0002.
-- Attribution must be supplied from a trusted authenticated session by the application.
ALTER TABLE bb_bookings ADD COLUMN last_actor_id TEXT;
ALTER TABLE bb_bookings ADD COLUMN last_actor_role TEXT;
ALTER TABLE bb_booking_events ADD COLUMN actor_id TEXT;
DROP TRIGGER IF EXISTS bb_booking_transition_audit;
CREATE TRIGGER bb_booking_transition_attribution_guard
BEFORE UPDATE OF status ON bb_bookings
BEGIN
 SELECT CASE WHEN NEW.last_actor_id IS NULL OR length(NEW.last_actor_id)<8
 OR NEW.last_actor_role NOT IN ('operator','staff','system')
 THEN RAISE(ABORT,'missing_authenticated_actor') END;
END;
CREATE TRIGGER bb_booking_transition_audit
AFTER UPDATE OF status ON bb_bookings
BEGIN
 INSERT INTO bb_booking_events(id,booking_id,event_type,actor_type,actor_id,occurred_at)
 VALUES(lower(hex(randomblob(16))),NEW.id,'booking_'||NEW.status,NEW.last_actor_role,NEW.last_actor_id,NEW.updated_at);
 INSERT INTO bb_outbox(id,booking_id,event_type,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.id,'booking_'||NEW.status,NEW.updated_at);
END;
-- Attribution columns cannot be changed independently of a status transition.
CREATE TRIGGER bb_booking_actor_change_guard
BEFORE UPDATE OF last_actor_id,last_actor_role ON bb_bookings
WHEN NEW.status=OLD.status
BEGIN SELECT RAISE(ABORT,'actor_change_requires_transition'); END;
