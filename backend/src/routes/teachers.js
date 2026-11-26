import { Router } from 'express'
import { z } from 'zod'
import { query } from '../db.js'
import { validate } from '../http.js'

const teacherQuery = z.object({
  name: z.string().min(1).max(60),
  day: z.coerce.number().int().min(1).max(5),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
})

export const teachers = Router()

teachers.get('/teachers', async (_req, res) => {
  const { rows } = await query(
    `SELECT DISTINCT f.full_name
     FROM faculty f
     JOIN timetable_entry e ON e.faculty_id = f.faculty_id
     JOIN term t ON t.term_id = e.term_id AND t.is_active
     ORDER BY f.full_name`
  )
  res.json(rows.map((r) => r.full_name))
})

teachers.get('/teacher', validate(teacherQuery, 'query'), async (req, res) => {
  const { name, day, time } = req.valid
  if (time) {
    const { rows } = await query(
      'SELECT faculty, room_no, subject, until::text FROM fn_find_teacher($1, $2, $3)',
      [name, day, time]
    )
    return res.json(rows)
  }

  const { rows } = await query(
    `SELECT f.full_name AS faculty, r.room_no, s.name AS subject, ts.slot_no,
            ts.start_time::text, ts.end_time::text,
            b.label AS batch
     FROM timetable_entry e
     JOIN term t ON t.term_id = e.term_id AND t.is_active
     JOIN faculty f ON f.faculty_id = e.faculty_id AND (f.full_name ILIKE '%' || $1 || '%' OR $1 = '')
     JOIN room r ON r.room_id = e.room_id
     JOIN subject s ON s.subject_id = e.subject_id
     JOIN time_slot ts ON ts.slot_id = e.slot_id
     LEFT JOIN entry_batch eb ON eb.entry_id = e.entry_id
     LEFT JOIN batch b ON b.batch_id = eb.batch_id
     WHERE e.day_no = $2
     ORDER BY ts.slot_no, r.room_no`,
    [name, day]
  )
  res.json(rows)
})
