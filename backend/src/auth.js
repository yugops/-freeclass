import jwt from 'jsonwebtoken'
import { config } from './config.js'
import { HttpError } from './http.js'

export const signToken = (userId) =>
  jwt.sign({ sub: userId }, config.JWT_SECRET, { expiresIn: '8h' })

export const requireAuth = (req, _res, next) => {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Invalid or missing authentication token')
  }
  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, config.JWT_SECRET)
    req.user = { id: payload.sub }
    next()
  } catch (_err) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Invalid or missing authentication token')
  }
}
