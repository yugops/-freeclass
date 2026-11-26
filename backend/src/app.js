import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import { HttpError, errorHandler } from './http.js'
import { health } from './routes/health.js'
import { catalog } from './routes/catalog.js'
import { rooms } from './routes/rooms.js'
import { teachers } from './routes/teachers.js'
import { auth } from './routes/auth.js'
import { reservations } from './routes/reservations.js'
import { checkinRouter } from './routes/checkin.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const frontendDist = path.resolve(__dirname, '../../frontend/dist')

export const app = express()

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
)
app.use(cors({ origin: config.CORS_ORIGIN }))
app.use(express.json({ limit: '10kb' }))

app.use(express.static(frontendDist))

app.use('/api', health)
app.use('/api', catalog)
app.use('/api', rooms)
app.use('/api', teachers)
app.use('/api', auth)
app.use('/api', reservations)
app.use('/api', checkinRouter)

app.use('/api', (_req, _res, next) => {
  next(new HttpError(404, 'NOT_FOUND', 'Route not found'))
})

app.use((req, res, next) => {
  if (req.method !== 'GET') return next()
  res.sendFile(path.join(frontendDist, 'index.html'))
})

app.use(errorHandler)
