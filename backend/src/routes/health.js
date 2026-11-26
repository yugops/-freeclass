import { Router } from 'express'
import { query } from '../db.js'

export const health = Router()

health.get('/health', async (_req, res) => {
  await query('SELECT 1')
  res.json({ status: 'ok' })
})
