-- #freeclass : Seed and Role Setup (v1)
SET search_path = fc, public;

-- 1. App roles
INSERT INTO app_role (name) VALUES ('student'), ('faculty'), ('admin')
ON CONFLICT (name) DO NOTHING;

-- 2. API role and permissions (least privilege, connecting as fc_api)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fc_api') THEN
    CREATE ROLE fc_api LOGIN PASSWORD 'change_me';
  END IF;
END $$;

GRANT fc_app TO fc_api;
ALTER ROLE fc_api SET search_path = fc, public;

-- 3. Default guest user for reservations without login
INSERT INTO app_user (user_id, email, password_hash, full_name, role_id)
VALUES (1, 'guest@freeclass.local', 'none', 'Guest Student', (SELECT role_id FROM app_role WHERE name='student'))
ON CONFLICT (user_id) DO NOTHING;
SELECT setval('app_user_user_id_seq', (SELECT GREATEST(MAX(user_id), 1) FROM app_user));
