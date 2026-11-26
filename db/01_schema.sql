-- #freeclass : PostgreSQL schema (v1)
DROP SCHEMA IF EXISTS fc CASCADE;
CREATE SCHEMA fc;
SET search_path = fc, public;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ========== STABLE (survive across semesters) ==========
CREATE TABLE block (
  block_id   serial PRIMARY KEY,
  code       text NOT NULL UNIQUE            -- 'A','B'
);
CREATE TABLE room (
  room_id    serial PRIMARY KEY,
  block_id   int  NOT NULL REFERENCES block,
  room_no    text NOT NULL UNIQUE,           -- 'A-101'
  floor_no   int  GENERATED ALWAYS AS (substring(room_no from '\d')::int) STORED,
  has_charging boolean NOT NULL DEFAULT false
);
CREATE TABLE faculty (
  faculty_id serial PRIMARY KEY,
  full_name  text NOT NULL,
  name_key   text GENERATED ALWAYS AS (lower(regexp_replace(full_name,'\s+',' ','g'))) STORED UNIQUE
);
CREATE TABLE subject (
  subject_id serial PRIMARY KEY,
  name       text NOT NULL,
  name_key   text NOT NULL UNIQUE,           -- normalized (kills NODE JS vs NODE.JS dupes)
  is_lab     boolean NOT NULL DEFAULT false
);
CREATE TABLE weekday (
  day_no smallint PRIMARY KEY CHECK (day_no BETWEEN 1 AND 7),
  name text NOT NULL UNIQUE
);
CREATE TABLE batch (                          -- a section / class group
  batch_id   serial PRIMARY KEY,
  label      text NOT NULL UNIQUE,           -- raw label e.g. 'B.Tech CSE Sem 3 SectionA-CSE'
  kind       text NOT NULL CHECK (kind IN ('section','combined')),
  program    text,                           -- parsed, nullable for 'N Sections combined'
  sem_no     smallint,
  section    text,
  n_sections smallint                        -- only for combined
);

-- ========== SEMESTER-SCOPED (the only thing replaced every sem) ==========
CREATE TABLE term (
  term_id    serial PRIMARY KEY,
  name       text NOT NULL UNIQUE,           -- 'Odd 2026'
  starts_on  date NOT NULL,
  ends_on    date NOT NULL,
  is_active  boolean NOT NULL DEFAULT false,
  CHECK (ends_on > starts_on)
);
CREATE UNIQUE INDEX one_active_term ON term (is_active) WHERE is_active;   -- partial unique index

CREATE TABLE time_slot (                      -- period grid belongs to a term: it can change per semester
  slot_id    serial PRIMARY KEY,
  term_id    int      NOT NULL REFERENCES term ON DELETE CASCADE,
  slot_no    smallint NOT NULL,                -- 1..N within the term
  start_time time     NOT NULL,
  end_time   time     NOT NULL,
  CHECK (end_time > start_time),
  UNIQUE (term_id, slot_no),
  UNIQUE (term_id, start_time),
  UNIQUE (term_id, slot_id)                    -- target for composite FKs
);

CREATE TABLE timetable_entry (
  entry_id   bigserial PRIMARY KEY,
  term_id    int      NOT NULL REFERENCES term    ON DELETE CASCADE,
  room_id    int      NOT NULL REFERENCES room,
  day_no     smallint NOT NULL REFERENCES weekday,
  slot_id    int      NOT NULL,
  subject_id int      NOT NULL REFERENCES subject,
  faculty_id int      NOT NULL REFERENCES faculty,
  FOREIGN KEY (term_id, slot_id) REFERENCES time_slot (term_id, slot_id),
  UNIQUE (term_id, room_id, day_no, slot_id)         -- a room hosts ONE class per slot
);
CREATE TABLE entry_batch (                            -- M:N, handles 'Sec A; Sec B' + combined
  entry_id bigint NOT NULL REFERENCES timetable_entry ON DELETE CASCADE,
  batch_id int    NOT NULL REFERENCES batch,
  PRIMARY KEY (entry_id, batch_id)
);
-- NOTE: no is_free column. Free = (room x day x slot) with NO timetable_entry row.
-- Rooms never scanned must not look "free all week":
CREATE TABLE room_term_coverage (
  term_id int NOT NULL REFERENCES term ON DELETE CASCADE,
  room_id int NOT NULL REFERENCES room,
  PRIMARY KEY (term_id, room_id)
);

-- Hot-path index: "what's free at day D slot S" / "where is teacher X"
CREATE INDEX ix_entry_lookup  ON timetable_entry (term_id, day_no, slot_id) INCLUDE (room_id);
CREATE INDEX ix_entry_faculty ON timetable_entry (term_id, faculty_id, day_no, slot_id);

-- ========== USERS / RBAC ==========
CREATE TABLE app_role (role_id serial PRIMARY KEY, name text UNIQUE NOT NULL);
CREATE TABLE app_user (
  user_id serial PRIMARY KEY,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  role_id int NOT NULL REFERENCES app_role
);

-- ========== BOOKING (transactions / concurrency) ==========
CREATE TABLE reservation (
  reservation_id bigserial PRIMARY KEY,
  term_id  int NOT NULL REFERENCES term,
  room_id  int NOT NULL REFERENCES room,
  user_id  int NOT NULL REFERENCES app_user,
  on_date  date NOT NULL,
  slot_id  int NOT NULL,
  FOREIGN KEY (term_id, slot_id) REFERENCES time_slot (term_id, slot_id),
  status   text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- DB-level guarantee: no two ACTIVE reservations for same room+date+slot
CREATE UNIQUE INDEX ux_res_active ON reservation (room_id, on_date, slot_id) WHERE status='active';

CREATE TABLE audit_log (
  audit_id bigserial PRIMARY KEY, table_name text, action text,
  row_data jsonb, changed_by text DEFAULT current_user, changed_at timestamptz DEFAULT now()
);

-- ========== STAGING (ETL) ==========
CREATE TABLE stg_room_json (load_id serial PRIMARY KEY, src text, doc jsonb NOT NULL, loaded_at timestamptz DEFAULT now());

INSERT INTO weekday VALUES (1,'Monday'),(2,'Tuesday'),(3,'Wednesday'),(4,'Thursday'),(5,'Friday'),(6,'Saturday'),(7,'Sunday');
