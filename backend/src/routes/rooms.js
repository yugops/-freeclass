import { Router } from 'express'
import { z } from 'zod'
import { query } from '../db.js'
import { validate } from '../http.js'

const freeQuery = z.object({
  day: z.coerce.number().int().min(1).max(5),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  charging: z.stringbool().default(false),
  block: z.string().optional(),
})

const windowsQuery = z.object({
  day: z.coerce.number().int().min(1).max(5),
  charging: z.stringbool().default(false),
  block: z.string().optional(),
})

export const rooms = Router()

rooms.get('/free', validate(freeQuery, 'query'), async (req, res) => {
  const { day, time, charging, block } = req.valid
  const { rows } = await query(
    `SELECT v.room_no, split_part(v.room_no, '-', 1) AS block, v.has_charging, v.free_until::text
     FROM fn_free_rooms($1, $2, $3) v
     WHERE ($4::text IS NULL OR split_part(v.room_no, '-', 1) = upper($4))
     ORDER BY v.room_no`,
    [day, time, charging, block || null]
  )
  res.json(rows)
})

rooms.get('/free-windows', validate(windowsQuery, 'query'), async (req, res) => {
  const { day, charging, block } = req.valid
  const { rows } = await query(
    `SELECT room_no, split_part(room_no, '-', 1) AS block, has_charging, day_name, free_from::text, free_to::text, n_slots::int
     FROM v_free_windows
     WHERE day_no = $1 AND (NOT $2 OR has_charging)
       AND ($3::text IS NULL OR split_part(room_no, '-', 1) = upper($3))
     ORDER BY room_no, free_from`,
    [day, charging, block || null]
  )
  res.json(rows)
})

rooms.get('/utilisation', async (_req, res) => {
  const { rows } = await query(
    `SELECT room_no, block, busy_slots::int, total_slots::int, util_pct::float, busiest_rank::int
     FROM mv_room_utilisation
     ORDER BY busiest_rank, room_no`
  )
  res.json(rows)
})

rooms.get('/conflicts', async (_req, res) => {
  const { rows } = await query(
    'SELECT term_id, full_name, day_no, slot_id, rooms FROM v_faculty_conflicts'
  )
  res.json(rows)
})

const getUnmentionedCharging = async (_req, res) => {
  const { rows } = await query(
    `SELECT r.room_no, b.code AS block, r.has_charging
     FROM room r
     JOIN block b ON b.block_id = r.block_id
     WHERE r.has_charging = true
       AND r.room_id NOT IN (
         SELECT room_id FROM room_term_coverage c JOIN term t ON t.term_id = c.term_id WHERE t.is_active
       )
     ORDER BY b.code, r.room_no`
  )
  res.json(rows)
}

rooms.get('/unmentioned-charging', getUnmentionedCharging)
rooms.get('/rooms/unmentioned-charging', getUnmentionedCharging)
