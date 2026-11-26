import { Router } from 'express'
import { z } from 'zod'
import { query } from '../db.js'
import { HttpError, validate } from '../http.js'

const reserveSchema = z.object({
  room_no: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
    (d) => {
      const today = new Date().toISOString().slice(0, 10)
      return d >= today
    },
    { message: 'Date cannot be in the past' }
  ),
  slot_no: z.coerce.number().int().min(1),
})

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
})

export const reservations = Router()

reservations.post('/reservations', validate(reserveSchema, 'body'), async (req, res) => {
  const { room_no, date, slot_no } = req.valid
  const userId = 1 // default guest user
  await query('CALL sp_reserve_room($1, $2, $3, $4)', [
    userId,
    room_no,
    date,
    slot_no,
  ])
  res.status(201).json({ room_no, date, slot_no })
})

reservations.get('/reservations', async (_req, res) => {
  const { rows } = await query(
    `SELECT res.reservation_id::text, r.room_no, res.on_date::text AS date,
            s.slot_no, s.start_time::text, s.end_time::text, res.status, res.created_at::text
     FROM reservation res
     JOIN room r ON r.room_id = res.room_id
     JOIN time_slot s ON s.slot_id = res.slot_id
     WHERE res.status = 'active'
     ORDER BY res.on_date DESC, s.slot_no ASC`
  )
  res.json(rows)
})

reservations.get('/reservations/mine', async (_req, res) => {
  const { rows } = await query(
    `SELECT res.reservation_id::text, r.room_no, res.on_date::text AS date,
            s.slot_no, s.start_time::text, s.end_time::text, res.status, res.created_at::text
     FROM reservation res
     JOIN room r ON r.room_id = res.room_id
     JOIN time_slot s ON s.slot_id = res.slot_id
     WHERE res.status = 'active'
     ORDER BY res.on_date DESC, s.slot_no ASC`
  )
  res.json(rows)
})

reservations.delete('/reservations/:id', validate(idParamSchema, 'params'), async (req, res) => {
  const { id } = req.valid
  const { rowCount } = await query(
    `UPDATE reservation
     SET status = 'cancelled'
     WHERE reservation_id = $1 AND status = 'active'`,
    [id]
  )
  if (rowCount === 0) {
    throw new HttpError(404, 'NOT_FOUND', 'Reservation not found or already cancelled')
  }
  res.json({ status: 'cancelled' })
})
