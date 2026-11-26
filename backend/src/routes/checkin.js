import { Router } from 'express'
import { z } from 'zod'
import { pool, query } from '../db.js'
import { HttpError, validate } from '../http.js'

// Occupancy status thresholds (configured in one place for easy tuning)
export const STATUS_THRESHOLDS = {
  LOW_MAX_PCT: 0.25,         // < 25% capacity
  MODERATE_MAX_PCT: 0.60,    // 25% - 60% capacity
  MIN_DISTINCT_FOR_LIVE: 2,  // Require at least 2 distinct devices before showing non-idle status
}

// In-memory rate limiting: max 3 check-ins per minute per IP and per device_id
const ipCheckinMap = new Map()
const deviceCheckinMap = new Map()
const RATE_LIMIT_WINDOW_MS = 60 * 1000
export const MAX_CHECKINS_PER_WINDOW = 3

export function checkRateLimit(key, map, label, force = false) {
  if (!force && (process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT || process.env.DISABLE_RATE_LIMIT === 'true')) {
    return
  }
  const now = Date.now()
  const history = (map.get(key) || []).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS)
  map.set(key, history)
  if (history.length >= MAX_CHECKINS_PER_WINDOW) {
    const oldest = history[0]
    const waitSec = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000)
    throw new HttpError(429, 'RATE_LIMITED', `Too many check-ins (limit: ${MAX_CHECKINS_PER_WINDOW} per minute). Please wait ${waitSec}s before checking in again.`)
  }
}

export function recordRateLimit(key, map) {
  const now = Date.now()
  const history = (map.get(key) || []).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS)
  history.push(now)
  map.set(key, history)
  // Prevent map growth
  if (map.size > 10000) {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS
    for (const [k, v] of map.entries()) {
      const valid = v.filter((ts) => ts >= cutoff)
      if (valid.length === 0) map.delete(k)
      else map.set(k, valid)
    }
  }
}

export function refundRateLimit(key, map) {
  const history = map.get(key)
  if (Array.isArray(history) && history.length > 0) {
    history.pop()
    map.set(key, history)
  }
}

const checkinSchema = z.object({
  device_id: z.string().uuid({ message: 'device_id must be a valid UUID' }),
  room_id: z.union([z.coerce.number().int().positive(), z.string().min(1)]),
})

const leaveSchema = z.object({
  device_id: z.string().uuid({ message: 'device_id must be a valid UUID' }),
  room_id: z.union([z.coerce.number().int().positive(), z.string().min(1)]),
})

export const checkinRouter = Router()

/**
 * Execute a function inside a PostgreSQL transaction with an explicit isolation level.
 * CHOICE OF ISOLATION LEVEL:
 * READ COMMITTED is the standard SQL isolation level for high-concurrency OLTP workloads.
 * Each query in the transaction sees only committed data. Row-level locks on UPDATE prevent
 * race conditions when modifying existing device check-ins, while PostgreSQL's atomic
 * UNIQUE(device_id, room_id, slot_id) index constraint strictly prevents duplicate check-ins
 * without incurring SERIALIZABLE transaction cancellation overhead (SQLSTATE 40001).
 */
async function withDbTransaction(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// 1. POST /api/checkin
checkinRouter.post('/checkin', validate(checkinSchema, 'body'), async (req, res) => {
  const { device_id, room_id: roomInput } = req.valid
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown'

  // Apply rate limiting (IP + device_id)
  checkRateLimit(clientIp, ipCheckinMap, 'IP')
  checkRateLimit(device_id, deviceCheckinMap, 'device')

  try {
    const result = await withDbTransaction(async (client) => {
      // Step A: Validate room exists and resolve room_id
      const roomRes = await client.query(
        typeof roomInput === 'number'
          ? 'SELECT room_id, room_no, capacity FROM fc.room WHERE room_id = $1'
          : 'SELECT room_id, room_no, capacity FROM fc.room WHERE room_no = $1',
        [roomInput]
      )
      if (roomRes.rows.length === 0) {
        throw new HttpError(404, 'NOT_FOUND', `Room ${roomInput} not found`)
      }
      const room = roomRes.rows[0]

      // Step B: Find current active timetable slot for calculating expiration
      const slotRes = await client.query(
        `SELECT s.slot_id, s.slot_no, s.start_time, s.end_time
         FROM fc.time_slot s
         JOIN fc.term t ON t.term_id = s.term_id
         WHERE t.is_active
           AND (CURRENT_TIME >= s.start_time AND CURRENT_TIME < s.end_time)
         LIMIT 1`
      )

      let slotId
      let slotEndTime = null

      if (slotRes.rows.length > 0) {
        slotId = slotRes.rows[0].slot_id
        slotEndTime = slotRes.rows[0].end_time
      } else {
        // Outside official period hours: link to first slot or nearest slot of active term
        const defaultSlotRes = await client.query(
          `SELECT s.slot_id, s.end_time
           FROM fc.time_slot s
           JOIN fc.term t ON t.term_id = s.term_id
           WHERE t.is_active
           ORDER BY s.slot_no ASC LIMIT 1`
        )
        if (defaultSlotRes.rows.length === 0) {
          throw new HttpError(400, 'BAD_REQUEST', 'No active term or time slots configured')
        }
        slotId = defaultSlotRes.rows[0].slot_id
        slotEndTime = defaultSlotRes.rows[0].end_time
      }

      // Step C: If device has an active check-in in another room, expire it in the same transaction
      await client.query(
        `UPDATE fc.checkin
         SET status = 'left', expires_at = clock_timestamp()
         WHERE device_id = $1
           AND room_id <> $2
           AND status = 'active'
           AND expires_at > clock_timestamp()`,
        [device_id, room.room_id]
      )

      // Step D: Check if device already has an active check-in for this room and slot
      const existingRes = await client.query(
        `SELECT checkin_id FROM fc.checkin
         WHERE device_id = $1 AND room_id = $2 AND slot_id = $3
           AND status = 'active' AND expires_at > clock_timestamp()`,
        [device_id, room.room_id, slotId]
      )
      if (existingRes.rows.length > 0) {
        return {
          alreadyCheckedIn: true,
          room_no: room.room_no,
        }
      }

      // Step E: Calculate expires_at: created_at + 45 minutes or slot end time, whichever is earlier
      const expRes = await client.query(
        `SELECT LEAST(
           clock_timestamp() + INTERVAL '45 minutes',
           CASE 
             WHEN $1::time > clock_timestamp()::time THEN (CURRENT_DATE + $1::time)::timestamptz
             ELSE clock_timestamp() + INTERVAL '45 minutes'
           END
         ) AS expires_at`,
        [slotEndTime]
      )
      const expiresAt = expRes.rows[0].expires_at

      // Step F: Insert checkin inside transaction.
      // Relies on UNIQUE(device_id, room_id, slot_id) to atomically reject concurrent duplicates
      const insertRes = await client.query(
        `INSERT INTO fc.checkin (device_id, room_id, slot_id, created_at, expires_at, status)
         VALUES ($1, $2, $3, clock_timestamp(), $4, 'active')
         RETURNING checkin_id, room_id, slot_id, created_at, expires_at, status`,
        [device_id, room.room_id, slotId, expiresAt]
      )

      return {
        checkin: insertRes.rows[0],
        room_no: room.room_no,
      }
    })

    if (result.alreadyCheckedIn) {
      return res.status(409).json({
        success: false,
        status: 'already_checked_in',
        message: 'Already checked into this room for this time slot',
      })
    }

    // Record rate limit only on successful transaction
    recordRateLimit(clientIp, ipCheckinMap)
    recordRateLimit(device_id, deviceCheckinMap)

    res.status(201).json({
      success: true,
      status: 'checked_in',
      room_no: result.room_no,
      room_id: result.checkin.room_id,
      expires_at: result.checkin.expires_at,
      message: `Checked into ${result.room_no} successfully`,
    })
  } catch (err) {
    if (err.code === '23505') {
      // UNIQUE constraint violation caught atomically
      return res.status(409).json({
        success: false,
        status: 'already_checked_in',
        message: 'Already checked into this room for this time slot',
      })
    }
    throw err
  }
})

// 2. POST /api/leave
checkinRouter.post('/leave', validate(leaveSchema, 'body'), async (req, res) => {
  const { device_id, room_id: roomInput } = req.valid

  const result = await withDbTransaction(async (client) => {
    // Resolve room
    const roomRes = await client.query(
      typeof roomInput === 'number'
        ? 'SELECT room_id, room_no FROM fc.room WHERE room_id = $1'
        : 'SELECT room_id, room_no FROM fc.room WHERE room_no = $1',
      [roomInput]
    )
    if (roomRes.rows.length === 0) {
      throw new HttpError(404, 'NOT_FOUND', `Room ${roomInput} not found`)
    }
    const room = roomRes.rows[0]

    // Atomically expire the active check-in for this room
    const updateRes = await client.query(
      `UPDATE fc.checkin
       SET status = 'left', expires_at = clock_timestamp()
       WHERE device_id = $1
         AND room_id = $2
         AND status = 'active'
         AND expires_at > clock_timestamp()
       RETURNING checkin_id`,
      [device_id, room.room_id]
    )

    return {
      room_no: room.room_no,
      modified: updateRes.rowCount > 0,
    }
  })

  if (result.modified) {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown'
    refundRateLimit(clientIp, ipCheckinMap)
    refundRateLimit(device_id, deviceCheckinMap)
  }

  res.json({
    success: true,
    status: 'left',
    room_no: result.room_no,
    message: result.modified ? `Left room ${result.room_no}` : `No active check-in found for ${result.room_no}`,
  })
})

// 3. GET /api/rooms/status -> live traffic computed via COUNT(DISTINCT device_id)
checkinRouter.get('/rooms/status', async (req, res) => {
  const deviceId = req.query.device_id || req.headers['x-device-id']

  // Compute live traffic using COUNT(DISTINCT device_id) over active, non-expired rows.
  // No stored counter is used, eliminating lost updates.
  const { rows } = await query(
    `SELECT 
       r.room_id,
       r.room_no,
       b.code AS block,
       COALESCE(r.capacity, 40) AS capacity,
       COUNT(DISTINCT c.device_id) FILTER (WHERE c.status = 'active' AND c.expires_at > clock_timestamp())::int AS active_count,
       BOOL_OR(c.device_id = $1 AND c.status = 'active' AND c.expires_at > clock_timestamp()) AS user_checked_in
     FROM fc.room r
     JOIN fc.block b ON b.block_id = r.block_id
     LEFT JOIN fc.checkin c ON c.room_id = r.room_id
     GROUP BY r.room_id, r.room_no, b.code, r.capacity
     ORDER BY r.room_no ASC`,
    [deviceId || null]
  )

  const statusMap = {}

  for (const r of rows) {
    const count = r.active_count
    const cap = r.capacity || 40
    const ratio = count / cap

    let state = 'idle'
    let label = '0 TFW'
    let tone = 'lilac'

    if (count === 1) {
      state = 'active'
      label = '1 TFW'
      tone = 'green'
    } else if (count > 1) {
      state = 'active'
      label = `${count} TFW`
      tone = count > 5 ? 'yellow' : 'green'
    }

    statusMap[r.room_no] = {
      room_id: r.room_id,
      room_no: r.room_no,
      block: r.block,
      capacity: cap,
      active_count: count,
      state,
      label,
      tone,
      user_checked_in: Boolean(r.user_checked_in),
    }
  }

  res.json(statusMap)
})

// 4. GET /api/rooms/traffic-stats -> Real live check-in traffic analytics for Stats page
checkinRouter.get('/rooms/traffic-stats', async (_req, res) => {
  const { rows } = await query(
    `SELECT 
       r.room_id,
       r.room_no,
       b.code AS block,
       COALESCE(r.capacity, 40) AS capacity,
       COUNT(DISTINCT c.device_id) FILTER (WHERE c.status = 'active' AND c.expires_at > clock_timestamp())::int AS active_count,
       COUNT(c.checkin_id)::int AS total_checkins,
       COUNT(DISTINCT c.device_id)::int AS unique_visitors
     FROM fc.room r
     JOIN fc.block b ON b.block_id = r.block_id
     LEFT JOIN fc.checkin c ON c.room_id = r.room_id
     GROUP BY r.room_id, r.room_no, b.code, r.capacity
     ORDER BY active_count DESC, total_checkins DESC, r.room_no ASC`
  )

  let totalActive = 0
  let totalCheckins = 0
  let roomsInUse = 0

  const items = rows.map((r, index) => {
    const active = Number(r.active_count)
    const cap = Number(r.capacity)
    const occPct = cap > 0 ? Math.min(100, Math.round((active / cap) * 100)) : 0

    totalActive += active
    totalCheckins += Number(r.total_checkins)
    if (active > 0) roomsInUse++

    let state = 'idle'
    let label = '0 TFW'
    let tone = 'lilac'

    if (active >= STATUS_THRESHOLDS.MIN_DISTINCT_FOR_LIVE) {
      if (active / cap > STATUS_THRESHOLDS.MODERATE_MAX_PCT) {
        state = 'crowded'
        label = `🔴 ${active} TFW`
        tone = 'red'
      } else if (active / cap >= STATUS_THRESHOLDS.LOW_MAX_PCT) {
        state = 'moderate'
        label = `🟡 ${active} TFW`
        tone = 'yellow'
      } else {
        state = 'active'
        label = `🟢 ${active} TFW`
        tone = 'green'
      }
    } else if (active === 1) {
      state = 'active'
      label = '🟢 1 TFW'
      tone = 'green'
    }

    return {
      room_id: r.room_id,
      room_no: r.room_no,
      block: r.block,
      capacity: cap,
      active_count: active,
      occupancy_pct: occPct,
      total_checkins: Number(r.total_checkins),
      unique_visitors: Number(r.unique_visitors),
      state,
      label,
      tone,
      rank: index + 1,
    }
  })

  res.json({
    summary: {
      total_active_users: totalActive,
      rooms_in_use: roomsInUse,
      total_rooms: rows.length,
      total_checkins_all_time: totalCheckins,
    },
    rooms: items,
  })
})
