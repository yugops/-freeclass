import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import { query } from '../db.js'
import { HttpError, validate } from '../http.js'
import { signToken } from '../auth.js'

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
})

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(1),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const auth = Router()

auth.post('/auth/register', authLimiter, validate(registerSchema, 'body'), async (req, res) => {
  const { email, password, full_name } = req.valid
  const passwordHash = bcrypt.hashSync(password, 12)

  const { rows } = await query(
    `INSERT INTO app_user (email, password_hash, full_name, role_id)
     VALUES ($1, $2, $3, (SELECT role_id FROM app_role WHERE name = 'student'))
     RETURNING user_id, email, full_name`,
    [email, passwordHash, full_name]
  )

  const user = rows[0]
  const token = signToken(user.user_id)
  res.status(201).json({ token, user })
})

auth.post('/auth/login', validate(loginSchema, 'body'), async (req, res) => {
  const { email, password } = req.valid

  const { rows } = await query(
    'SELECT user_id, email, full_name, password_hash FROM app_user WHERE email = $1',
    [email]
  )

  const user = rows[0]
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password')
  }

  const token = signToken(user.user_id)
  res.json({
    token,
    user: {
      user_id: user.user_id,
      email: user.email,
      full_name: user.full_name,
    },
  })
})
