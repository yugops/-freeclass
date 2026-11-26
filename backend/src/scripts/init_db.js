import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '../../../')
const dbDir = path.resolve(rootDir, 'db')
const dataDir = path.resolve(rootDir, 'data/odd-2026')

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:root@localhost:5432/freeclass'

async function init() {
  console.log('Connecting to database:', databaseUrl.replace(/:[^:@]*@/, ':****@'))
  const isLocal = databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1')
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  })
  await client.connect()

  try {
    console.log('1. Running 01_schema.sql...')
    const schemaSql = fs.readFileSync(path.join(dbDir, '01_schema.sql'), 'utf8')
    await client.query(schemaSql)

    console.log('2. Running 03_logic.sql...')
    const logicSql = fs.readFileSync(path.join(dbDir, '03_logic.sql'), 'utf8')
    await client.query(logicSql)

    console.log('3. Running 04_seed.sql...')
    const seedSql = fs.readFileSync(path.join(dbDir, '04_seed.sql'), 'utf8')
    await client.query(seedSql)

    console.log('4. Running 05_checkin.sql...')
    const checkinSql = fs.readFileSync(path.join(dbDir, '05_checkin.sql'), 'utf8')
    await client.query(checkinSql)

    console.log('5. Loading semester data from data/odd-2026 into staging...')
    await client.query('TRUNCATE fc.stg_room_json;')
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'))
    for (const f of files) {
      const fullPath = path.join(dataDir, f)
      const doc = fs.readFileSync(fullPath, 'utf8')
      await client.query('INSERT INTO fc.stg_room_json(src, doc) VALUES ($1, $2::jsonb)', [f, doc])
      console.log(`   - Loaded ${f}`)
    }

    console.log('6. Running ETL for Odd 2026...')
    const termName = 'Odd 2026'
    const termStart = '2026-07-20'
    const termEnd = '2026-12-05'

    await client.query('BEGIN;')

    await client.query(`
      UPDATE fc.term SET is_active = false
      WHERE is_active AND name <> $1;
    `, [termName])

    await client.query(`
      INSERT INTO fc.term(name, starts_on, ends_on, is_active)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (name) DO UPDATE
        SET starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on, is_active = EXCLUDED.is_active;
    `, [termName, termStart, termEnd])

    await client.query(`
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
      FROM fc.stg_room_json j
      CROSS JOIN LATERAL jsonb_array_elements(j.doc) r
      LEFT  JOIN LATERAL jsonb_array_elements(r->'schedule') s ON true;
    `)

    await client.query(`
      INSERT INTO fc.block(code) SELECT DISTINCT block_code FROM flat ON CONFLICT (code) DO NOTHING;
    `)

    await client.query(`
      INSERT INTO fc.room(block_id, room_no, has_charging)
      SELECT DISTINCT ON (f.room_no) b.block_id, f.room_no, f.has_charging
      FROM flat f JOIN fc.block b ON b.code = f.block_code
      ON CONFLICT (room_no) DO UPDATE SET has_charging = EXCLUDED.has_charging;
    `)

    await client.query(`
      INSERT INTO fc.subject(name, name_key, is_lab)
      SELECT DISTINCT ON (k) subject, k, subject ~* '\\(lab\\)'
      FROM (SELECT subject, btrim(regexp_replace(lower(subject),'[^a-z0-9]+',' ','g')) AS k
            FROM flat WHERE NOT is_free AND subject IS NOT NULL) s
      ORDER BY k, subject
      ON CONFLICT (name_key) DO NOTHING;
    `)

    await client.query(`
      INSERT INTO fc.faculty(full_name)
      SELECT DISTINCT ON (lower(regexp_replace(faculty,'\\s+',' ','g'))) faculty
      FROM flat WHERE NOT is_free AND faculty IS NOT NULL
      ORDER BY lower(regexp_replace(faculty,'\\s+',' ','g')), faculty
      ON CONFLICT (name_key) DO NOTHING;
    `)

    await client.query(`
      INSERT INTO fc.batch(label, kind, program, sem_no, section, n_sections)
      SELECT lbl,
             CASE WHEN lbl ~ '^\\d+ Sections combined$' THEN 'combined' ELSE 'section' END,
             substring(lbl from '^(.*?) Sem \\d'),
             substring(lbl from ' Sem (\\d+)')::smallint,
             substring(lbl from 'Section(.*)$'),
             substring(lbl from '^(\\d+) Sections combined$')::smallint
      FROM (SELECT DISTINCT btrim(x) AS lbl
            FROM flat, unnest(string_to_array(batch,';')) x WHERE batch IS NOT NULL) q
      ON CONFLICT (label) DO NOTHING;
    `)

    await client.query(`
      DELETE FROM fc.timetable_entry WHERE term_id = (SELECT term_id FROM fc.term WHERE name = $1);
    `, [termName])
    await client.query(`
      DELETE FROM fc.room_term_coverage WHERE term_id = (SELECT term_id FROM fc.term WHERE name = $1);
    `, [termName])

    await client.query(`
      INSERT INTO fc.time_slot(term_id, slot_no, start_time, end_time)
      SELECT t.term_id, row_number() OVER (ORDER BY x.start_time), x.start_time, x.end_time
      FROM (SELECT DISTINCT start_time, end_time FROM flat WHERE start_time IS NOT NULL) x
      JOIN fc.term t ON t.name = $1
      ON CONFLICT (term_id, slot_no) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time;
    `, [termName])

    await client.query(`
      INSERT INTO fc.room_term_coverage(term_id, room_id)
      SELECT DISTINCT t.term_id, r.room_id
      FROM flat f JOIN fc.room r ON r.room_no = f.room_no, fc.term t
      WHERE t.name = $1 AND f.day_name IS NOT NULL;
    `, [termName])

    await client.query(`
      INSERT INTO fc.timetable_entry(term_id, room_id, day_no, slot_id, subject_id, faculty_id)
      SELECT t.term_id, r.room_id, w.day_no, ts.slot_id, su.subject_id, fa.faculty_id
      FROM flat f
      JOIN fc.term t       ON t.name = $1
      JOIN fc.room r       ON r.room_no = f.room_no
      JOIN fc.weekday w    ON w.name = f.day_name
      JOIN fc.time_slot ts ON ts.term_id = t.term_id AND ts.start_time = f.start_time
      JOIN fc.subject su   ON su.name_key = btrim(regexp_replace(lower(f.subject),'[^a-z0-9]+',' ','g'))
      JOIN fc.faculty fa   ON fa.name_key = lower(regexp_replace(f.faculty,'\\s+',' ','g'))
      WHERE NOT f.is_free;
    `, [termName])

    await client.query(`
      INSERT INTO fc.entry_batch(entry_id, batch_id)
      SELECT DISTINCT e.entry_id, b.batch_id
      FROM flat f
      JOIN fc.term t       ON t.name = $1
      JOIN fc.room r       ON r.room_no = f.room_no
      JOIN fc.weekday w    ON w.name = f.day_name
      JOIN fc.time_slot ts ON ts.term_id = t.term_id AND ts.start_time = f.start_time
      JOIN fc.timetable_entry e ON e.term_id = t.term_id AND e.room_id = r.room_id
                                AND e.day_no = w.day_no AND e.slot_id = ts.slot_id
      CROSS JOIN LATERAL unnest(string_to_array(f.batch,';')) x
      JOIN fc.batch b ON b.label = btrim(x)
      WHERE NOT f.is_free;
    `, [termName])

    const countCheck = await client.query(`
      SELECT
        (SELECT count(*) FROM fc.timetable_entry e JOIN fc.term t USING (term_id) WHERE t.name = $1) AS entry_count,
        (SELECT count(*) FROM flat WHERE NOT is_free) AS flat_count;
    `, [termName])

    const { entry_count, flat_count } = countCheck.rows[0]
    if (parseInt(entry_count) !== parseInt(flat_count)) {
      throw new Error(`ETL verification failed: loaded ${entry_count} timetable entries, expected ${flat_count}`)
    }

    await client.query('COMMIT;')
    console.log(`   - Verified ${entry_count} timetable entries cleanly loaded.`)

    console.log('7. Refreshing materialized view...')
    await client.query('REFRESH MATERIALIZED VIEW fc.mv_room_utilisation;')

    console.log('✓ Database initialization completed successfully!')
  } catch (err) {
    try { await client.query('ROLLBACK;') } catch (_) {}
    console.error('Initialization failed:', err)
    process.exit(1)
  } finally {
    await client.end()
  }
}

init()
