import { Router } from 'express'
import { query } from '../db.js'
import { HttpError } from '../http.js'

export const catalog = Router()

catalog.get('/term', async (_req, res) => {
  const { rows } = await query(
    'SELECT name, starts_on::text, ends_on::text FROM term WHERE is_active'
  )
  if (!rows[0]) {
    throw new HttpError(404, 'NOT_FOUND', 'No active term')
  }
  res.json(rows[0])
})

catalog.get('/slots', async (_req, res) => {
  const { rows } = await query(
    `SELECT s.slot_no, s.start_time::text, s.end_time::text
     FROM time_slot s
     JOIN term t ON t.term_id = s.term_id
     WHERE t.is_active
     ORDER BY s.slot_no`
  )
  res.json(rows)
})
