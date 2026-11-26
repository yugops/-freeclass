SET search_path = fc, public;

-- VIEW: every (room, day, slot) in the active term, with status. Free is DERIVED.
CREATE OR REPLACE VIEW v_room_slot_status AS
SELECT t.term_id, r.room_id, r.room_no, r.has_charging, w.day_no, w.name AS day_name,
       s.slot_id, s.slot_no, s.start_time, s.end_time,
       CASE WHEN e.entry_id IS NOT NULL THEN 'occupied' ELSE 'free' END AS status,
       sub.name AS subject, f.full_name AS faculty
FROM term t
JOIN room_term_coverage c ON c.term_id = t.term_id          -- skip unscanned rooms
JOIN room r ON r.room_id = c.room_id
CROSS JOIN weekday w
JOIN time_slot s ON s.term_id = t.term_id
LEFT JOIN timetable_entry e ON e.term_id=t.term_id AND e.room_id=r.room_id AND e.day_no=w.day_no AND e.slot_id=s.slot_id
LEFT JOIN subject sub ON sub.subject_id=e.subject_id
LEFT JOIN faculty f   ON f.faculty_id=e.faculty_id
WHERE t.is_active AND w.day_no <= 5;

-- Function: free rooms at a day+time (parameterised -> injection-safe from Express)
CREATE OR REPLACE FUNCTION fn_free_rooms(p_day int, p_time time, p_need_charging boolean DEFAULT false)
RETURNS TABLE(room_no text, has_charging boolean, free_until time) LANGUAGE sql STABLE AS $$
  SELECT v.room_no, v.has_charging, v.end_time
  FROM v_room_slot_status v
  WHERE v.day_no = p_day AND v.status='free' AND p_time >= v.start_time AND p_time < v.end_time
    AND (NOT p_need_charging OR v.has_charging)
  ORDER BY v.room_no;
$$;

-- Window function + CTE (gaps & islands): merge consecutive free slots into free WINDOWS
CREATE OR REPLACE VIEW v_free_windows AS
WITH free AS (
  SELECT room_no, has_charging, day_name, day_no, slot_no, start_time, end_time,
         slot_no - ROW_NUMBER() OVER (PARTITION BY room_no, day_no ORDER BY slot_no) AS grp
  FROM v_room_slot_status WHERE status='free')
SELECT room_no, has_charging, day_name, day_no, MIN(start_time) AS free_from, MAX(end_time) AS free_to,
       COUNT(*) AS n_slots
FROM free GROUP BY room_no, has_charging, day_name, day_no, grp;

-- Where is teacher X right now?
CREATE OR REPLACE FUNCTION fn_find_teacher(p_name text, p_day int, p_time time)
RETURNS TABLE(faculty text, room_no text, subject text, until time) LANGUAGE sql STABLE AS $$
  SELECT f.full_name, r.room_no, s.name, ts.end_time
  FROM timetable_entry e
  JOIN term t ON t.term_id=e.term_id AND t.is_active
  JOIN faculty f ON f.faculty_id=e.faculty_id AND f.full_name ILIKE '%'||p_name||'%'
  JOIN room r ON r.room_id=e.room_id JOIN subject s ON s.subject_id=e.subject_id
  JOIN time_slot ts ON ts.slot_id=e.slot_id
  WHERE e.day_no=p_day AND p_time >= ts.start_time AND p_time < ts.end_time;
$$;

-- All classes for teacher X on a given day
CREATE OR REPLACE FUNCTION fn_teacher_schedule(p_name text, p_day int)
RETURNS TABLE(faculty text, room_no text, subject text, slot_no smallint, start_time time, end_time time, batch text) LANGUAGE sql STABLE AS $$
  SELECT f.full_name, r.room_no, s.name, ts.slot_no, ts.start_time, ts.end_time, b.label
  FROM timetable_entry e
  JOIN term t ON t.term_id=e.term_id AND t.is_active
  JOIN faculty f ON f.faculty_id=e.faculty_id AND (f.full_name ILIKE '%'||p_name||'%' OR p_name = '')
  JOIN room r ON r.room_id=e.room_id
  JOIN subject s ON s.subject_id=e.subject_id
  JOIN time_slot ts ON ts.slot_id=e.slot_id
  LEFT JOIN entry_batch eb ON eb.entry_id=e.entry_id
  LEFT JOIN batch b ON b.batch_id=eb.batch_id
  WHERE e.day_no=p_day
  ORDER BY ts.slot_no, r.room_no;
$$;

-- Data-quality view: same teacher in 2 rooms at once
CREATE OR REPLACE VIEW v_faculty_conflicts AS
SELECT e.term_id, f.full_name, e.day_no, e.slot_id, array_agg(r.room_no) AS rooms
FROM timetable_entry e JOIN faculty f USING (faculty_id) JOIN room r USING (room_id)
GROUP BY e.term_id, f.full_name, e.day_no, e.slot_id HAVING COUNT(DISTINCT e.room_id) > 1;

-- Star schema for analytics (utilisation)
CREATE MATERIALIZED VIEW mv_room_utilisation AS
SELECT room_no, block, COUNT(*) FILTER (WHERE status='occupied') AS busy_slots, COUNT(*) AS total_slots,
       ROUND(100.0*COUNT(*) FILTER (WHERE status='occupied')/COUNT(*),1) AS util_pct,
       RANK() OVER (ORDER BY COUNT(*) FILTER (WHERE status='occupied') DESC) AS busiest_rank
FROM (SELECT v.*, split_part(v.room_no,'-',1) AS block FROM v_room_slot_status v) x
GROUP BY room_no, block;

-- Stored procedure: reserve a FREE room (transaction + concurrency). p_slot_no = period number in the active term.
CREATE OR REPLACE PROCEDURE sp_reserve_room(p_user int, p_room text, p_date date, p_slot_no int)
LANGUAGE plpgsql AS $$
DECLARE v_room int; v_term int; v_slot int; v_dow smallint := EXTRACT(ISODOW FROM p_date);
BEGIN
  SELECT term_id INTO v_term FROM term WHERE is_active AND p_date BETWEEN starts_on AND ends_on;
  SELECT room_id INTO v_room FROM room WHERE room_no = p_room;
  SELECT slot_id INTO v_slot FROM time_slot WHERE term_id = v_term AND slot_no = p_slot_no;
  IF v_room IS NULL OR v_term IS NULL OR v_slot IS NULL THEN
    RAISE EXCEPTION 'unknown room, slot, or date outside the active term';
  END IF;
  IF EXISTS (SELECT 1 FROM timetable_entry WHERE term_id=v_term AND room_id=v_room AND day_no=v_dow AND slot_id=v_slot)
    THEN RAISE EXCEPTION 'room % has a scheduled class in that slot', p_room; END IF;
  INSERT INTO reservation(term_id,room_id,user_id,on_date,slot_id) VALUES (v_term,v_room,p_user,p_date,v_slot);
  -- race-safe: partial unique index ux_res_active rejects a concurrent duplicate
END $$;

-- Trigger: audit every reservation change
CREATE OR REPLACE FUNCTION trg_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log(table_name, action, row_data)
  VALUES (TG_TABLE_NAME, TG_OP, to_jsonb(COALESCE(NEW, OLD)));
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER reservation_audit AFTER INSERT OR UPDATE OR DELETE ON reservation
FOR EACH ROW EXECUTE FUNCTION trg_audit();

-- RBAC (DB level)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='fc_reader') THEN CREATE ROLE fc_reader NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='fc_app')    THEN CREATE ROLE fc_app NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA fc TO fc_reader, fc_app;
GRANT SELECT ON ALL TABLES IN SCHEMA fc TO fc_reader, fc_app;
GRANT INSERT, UPDATE, DELETE ON reservation TO fc_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA fc TO fc_app;

-- app-role grants needed at runtime (trigger + register endpoint run as the caller)
GRANT INSERT ON audit_log, app_user TO fc_app;
GRANT SELECT ON mv_room_utilisation TO fc_reader, fc_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA fc TO fc_reader, fc_app;
GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA fc TO fc_app;
