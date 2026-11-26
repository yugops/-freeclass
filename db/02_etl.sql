-- ETL for ONE semester: stg_room_json (raw JSONB) -> normalized tables.
-- Run through load_term.sh. Safe to re-run for the same term (that term's rows are replaced).
-- Never touches other terms, so history is kept.
SET search_path = fc, public;
\set ON_ERROR_STOP on

BEGIN;

-- only one active term allowed (partial unique index), so deactivate the old one first
UPDATE term SET is_active = false
WHERE :activate AND is_active AND name <> :'term_name';

INSERT INTO term(name, starts_on, ends_on, is_active)
VALUES (:'term_name', :'term_start', :'term_end', :activate)
ON CONFLICT (name) DO UPDATE
  SET starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on, is_active = EXCLUDED.is_active;

-- flatten: one row per (room, slot)
CREATE TEMP TABLE flat ON COMMIT DROP AS
SELECT r->>'room_number'                          AS room_no,
       r->>'block'                                AS block_code,
       (r->>'available_charging_slots')::boolean  AS has_charging,
       s->>'day'                                  AS day_name,
       (s->>'start_time')::time                   AS start_time,
       (s->>'end_time')::time                     AS end_time,
       (s->>'is_free')::boolean                   AS is_free,
       nullif(btrim(s->>'subject'),'')            AS subject,
       nullif(btrim(s->>'batch'),'')              AS batch,
       nullif(btrim(s->>'faculty'),'')            AS faculty
FROM stg_room_json j
CROSS JOIN LATERAL jsonb_array_elements(j.doc) r
LEFT  JOIN LATERAL jsonb_array_elements(r->'schedule') s ON true;

-- stable tables: upsert, never delete
INSERT INTO block(code) SELECT DISTINCT block_code FROM flat ON CONFLICT (code) DO NOTHING;

INSERT INTO room(block_id, room_no, has_charging)
SELECT DISTINCT ON (f.room_no) b.block_id, f.room_no, f.has_charging
FROM flat f JOIN block b ON b.code = f.block_code
ON CONFLICT (room_no) DO UPDATE SET has_charging = EXCLUDED.has_charging;

-- subjects: normalized key removes punctuation/case differences
INSERT INTO subject(name, name_key, is_lab)
SELECT DISTINCT ON (k) subject, k, subject ~* '\(lab\)'
FROM (SELECT subject, btrim(regexp_replace(lower(subject),'[^a-z0-9]+',' ','g')) AS k
      FROM flat WHERE NOT is_free AND subject IS NOT NULL) s
ORDER BY k, subject
ON CONFLICT (name_key) DO NOTHING;

INSERT INTO faculty(full_name)
SELECT DISTINCT ON (lower(regexp_replace(faculty,'\s+',' ','g'))) faculty
FROM flat WHERE NOT is_free AND faculty IS NOT NULL
ORDER BY lower(regexp_replace(faculty,'\s+',' ','g')), faculty
ON CONFLICT (name_key) DO NOTHING;

-- batches: 'A; B' => two batches
INSERT INTO batch(label, kind, program, sem_no, section, n_sections)
SELECT lbl,
       CASE WHEN lbl ~ '^\d+ Sections combined$' THEN 'combined' ELSE 'section' END,
       substring(lbl from '^(.*?) Sem \d'),
       substring(lbl from ' Sem (\d+)')::smallint,
       substring(lbl from 'Section(.*)$'),
       substring(lbl from '^(\d+) Sections combined$')::smallint
FROM (SELECT DISTINCT btrim(x) AS lbl
      FROM flat, unnest(string_to_array(batch,';')) x WHERE batch IS NOT NULL) q
ON CONFLICT (label) DO NOTHING;

-- term-scoped tables: replace THIS term only
DELETE FROM timetable_entry     WHERE term_id = (SELECT term_id FROM term WHERE name = :'term_name');
DELETE FROM room_term_coverage  WHERE term_id = (SELECT term_id FROM term WHERE name = :'term_name');

-- the period grid is read from the data, so a new semester with new timings just works
INSERT INTO time_slot(term_id, slot_no, start_time, end_time)
SELECT t.term_id, row_number() OVER (ORDER BY x.start_time), x.start_time, x.end_time
FROM (SELECT DISTINCT start_time, end_time FROM flat WHERE start_time IS NOT NULL) x
JOIN term t ON t.name = :'term_name'
ON CONFLICT (term_id, slot_no) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time;

INSERT INTO room_term_coverage(term_id, room_id)
SELECT DISTINCT t.term_id, r.room_id
FROM flat f JOIN room r ON r.room_no = f.room_no, term t
WHERE t.name = :'term_name' AND f.day_name IS NOT NULL;      -- only rooms that HAVE schedule rows

INSERT INTO timetable_entry(term_id, room_id, day_no, slot_id, subject_id, faculty_id)
SELECT t.term_id, r.room_id, w.day_no, ts.slot_id, su.subject_id, fa.faculty_id
FROM flat f
JOIN term t       ON t.name = :'term_name'
JOIN room r       ON r.room_no = f.room_no
JOIN weekday w    ON w.name = f.day_name
JOIN time_slot ts ON ts.term_id = t.term_id AND ts.start_time = f.start_time
JOIN subject su   ON su.name_key = btrim(regexp_replace(lower(f.subject),'[^a-z0-9]+',' ','g'))
JOIN faculty fa   ON fa.name_key = lower(regexp_replace(f.faculty,'\s+',' ','g'))
WHERE NOT f.is_free;

INSERT INTO entry_batch(entry_id, batch_id)
SELECT DISTINCT e.entry_id, b.batch_id
FROM flat f
JOIN term t       ON t.name = :'term_name'
JOIN room r       ON r.room_no = f.room_no
JOIN weekday w    ON w.name = f.day_name
JOIN time_slot ts ON ts.term_id = t.term_id AND ts.start_time = f.start_time
JOIN timetable_entry e ON e.term_id = t.term_id AND e.room_id = r.room_id
                      AND e.day_no = w.day_no AND e.slot_id = ts.slot_id
CROSS JOIN LATERAL unnest(string_to_array(f.batch,';')) x
JOIN batch b ON b.label = btrim(x)
WHERE NOT f.is_free;

-- guard: an inner join that drops rows would silently lose classes. Fail loudly instead.
SELECT (SELECT count(*) FROM timetable_entry e JOIN term t USING (term_id) WHERE t.name = :'term_name')
    <> (SELECT count(*) FROM flat WHERE NOT is_free) AS lost_rows \gset
\if :lost_rows
  DO $$ BEGIN RAISE EXCEPTION 'ETL aborted: some occupied slots did not load (bad time, subject or faculty). Nothing was changed.'; END $$;
\endif

COMMIT;
