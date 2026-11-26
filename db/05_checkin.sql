-- Check-in system: live traffic / room occupancy
SET search_path = fc, public;

ALTER TABLE room ADD COLUMN IF NOT EXISTS capacity int DEFAULT 40;

CREATE TABLE IF NOT EXISTS checkin (
  checkin_id bigserial PRIMARY KEY,
  device_id text NOT NULL,
  room_id int NOT NULL REFERENCES room(room_id) ON DELETE CASCADE,
  slot_id int NOT NULL REFERENCES time_slot(slot_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left', 'expired')),
  UNIQUE (device_id, room_id, slot_id)
);

CREATE INDEX IF NOT EXISTS ix_checkin_active ON checkin (room_id, expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS ix_checkin_device ON checkin (device_id, expires_at) WHERE status = 'active';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fc_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON checkin TO fc_app;
    GRANT USAGE, SELECT ON SEQUENCE checkin_checkin_id_seq TO fc_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fc_reader') THEN
    GRANT SELECT ON checkin TO fc_reader;
  END IF;
END $$;
