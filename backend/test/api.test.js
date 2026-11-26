import test, { describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../src/app.js'
import { pool, query } from '../src/db.js'

let server
let baseUrl

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port
      baseUrl = `http://localhost:${port}/api`
      resolve()
    })
  })
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  await pool.end()
})

describe('#freeclass API Invariant and Contract Tests', () => {
  let activeTerm
  let dynamicTestDate
  let dynamicTestDay
  let dynamicSlotNo
  let dynamicFreeRoom

  test('GET /health returns 200 { status: "ok" }', async () => {
    const res = await fetch(`${baseUrl}/health`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(body, { status: 'ok' })
  })

  test('GET /term returns active term', async () => {
    const res = await fetch(`${baseUrl}/term`)
    assert.equal(res.status, 200)
    activeTerm = await res.json()
    assert.ok(activeTerm.name)
    assert.ok(activeTerm.starts_on)
    assert.ok(activeTerm.ends_on)

    // Compute dynamic test date inside term range and not in past
    const today = new Date().toISOString().slice(0, 10)
    let candidate = new Date(Math.max(new Date(today).getTime(), new Date(activeTerm.starts_on).getTime()))
    
    // Find next Monday-Friday
    while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
      candidate.setUTCDate(candidate.getUTCDate() + 1)
    }
    dynamicTestDate = candidate.toISOString().slice(0, 10)
    dynamicTestDay = candidate.getUTCDay() // 1 (Mon) to 5 (Fri)
  })

  test('GET /slots returns ordered time slots', async () => {
    const res = await fetch(`${baseUrl}/slots`)
    assert.equal(res.status, 200)
    const slots = await res.json()
    assert.ok(Array.isArray(slots))
    assert.ok(slots.length > 0)
    for (let i = 0; i < slots.length; i++) {
      assert.equal(slots[i].slot_no, i + 1)
      assert.ok(slots[i].start_time)
      assert.ok(slots[i].end_time)
      assert.ok(slots[i].start_time < slots[i].end_time)
    }
    dynamicSlotNo = slots[0].slot_no
  })

  test('GET /free returns free rooms with correct schema and ordering', async () => {
    const res = await fetch(`${baseUrl}/free?day=${dynamicTestDay}&time=10:15&charging=false`)
    assert.equal(res.status, 200)
    const rooms = await res.json()
    assert.ok(Array.isArray(rooms))
    assert.ok(rooms.length > 0)

    for (const r of rooms) {
      assert.equal(typeof r.room_no, 'string')
      assert.equal(typeof r.block, 'string')
      assert.equal(typeof r.has_charging, 'boolean')
      assert.match(r.free_until, /^\d{2}:\d{2}:\d{2}$/)
    }

    // Pick a free room for reservation tests
    dynamicFreeRoom = rooms[0].room_no
  })

  test('GET /free-windows returns free windows', async () => {
    const res = await fetch(`${baseUrl}/free-windows?day=${dynamicTestDay}&charging=false`)
    assert.equal(res.status, 200)
    const windows = await res.json()
    assert.ok(Array.isArray(windows))
    assert.ok(windows.length > 0)
    for (const w of windows) {
      assert.equal(typeof w.room_no, 'string')
      assert.equal(typeof w.n_slots, 'number')
      assert.ok(w.n_slots >= 1)
    }
  })

  test('GET /utilisation returns star schema analytics', async () => {
    const res = await fetch(`${baseUrl}/utilisation`)
    assert.equal(res.status, 200)
    const util = await res.json()
    assert.ok(Array.isArray(util))
    assert.ok(util.length > 0)
    for (const u of util) {
      assert.equal(typeof u.room_no, 'string')
      assert.equal(typeof u.busy_slots, 'number')
      assert.equal(typeof u.total_slots, 'number')
      assert.equal(typeof u.util_pct, 'number')
      assert.equal(typeof u.busiest_rank, 'number')
    }
  })

  test('GET /teachers returns list of all faculty members', async () => {
    const res = await fetch(`${baseUrl}/teachers`)
    assert.equal(res.status, 200)
    const teachers = await res.json()
    assert.ok(Array.isArray(teachers))
    assert.ok(teachers.length > 0)
  })

  test('GET /teacher finds teacher schedule', async () => {
    const res = await fetch(`${baseUrl}/teacher?name=Aarti&day=1`)
    assert.equal(res.status, 200)
    const schedule = await res.json()
    assert.ok(Array.isArray(schedule))
  })

  test('GET /rooms/unmentioned-charging returns charging rooms without timetable', async () => {
    const res = await fetch(`${baseUrl}/rooms/unmentioned-charging`)
    assert.equal(res.status, 200)
    const list = await res.json()
    assert.ok(Array.isArray(list))
    assert.ok(list.length > 0)
    for (const r of list) {
      assert.equal(typeof r.room_no, 'string')
      assert.equal(r.has_charging, true)
    }
  })

  test('Reservations: rejection on scheduled class (422)', async () => {
    const { rows } = await query(
      `SELECT r.room_no, s.slot_no, e.day_no
       FROM timetable_entry e
       JOIN room r ON r.room_id = e.room_id
       JOIN time_slot s ON s.slot_id = e.slot_id
       WHERE e.term_id = (SELECT term_id FROM term WHERE is_active)
       LIMIT 1`
    )
    assert.ok(rows.length > 0)
    const occupied = rows[0]

    let d = new Date(dynamicTestDate)
    while (d.getUTCDay() !== occupied.day_no) {
      d.setUTCDate(d.getUTCDate() + 1)
    }
    const occupiedDate = d.toISOString().slice(0, 10)

    const res = await fetch(`${baseUrl}/reservations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_no: occupied.room_no,
        date: occupiedDate,
        slot_no: occupied.slot_no,
      }),
    })
    assert.equal(res.status, 422)
    const body = await res.json()
    assert.equal(body.error?.code, 'RESERVATION_REJECTED')
  })

  test('Reservations: concurrent double-booking (one 201, one 409 SLOT_TAKEN)', async () => {
    // Clear any prior test reservations on this room/date/slot
    await query(
      `DELETE FROM reservation WHERE room_id = (SELECT room_id FROM room WHERE room_no = $1) AND on_date = $2 AND slot_id = (SELECT slot_id FROM time_slot WHERE term_id = (SELECT term_id FROM term WHERE is_active) AND slot_no = $3)`,
      [dynamicFreeRoom, dynamicTestDate, dynamicSlotNo]
    )

    const [resA, resB] = await Promise.all([
      fetch(`${baseUrl}/reservations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_no: dynamicFreeRoom,
          date: dynamicTestDate,
          slot_no: dynamicSlotNo,
        }),
      }),
      fetch(`${baseUrl}/reservations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_no: dynamicFreeRoom,
          date: dynamicTestDate,
          slot_no: dynamicSlotNo,
        }),
      }),
    ])

    const statuses = [resA.status, resB.status].sort()
    assert.deepEqual(statuses, [201, 409], 'Exactly one request succeeds (201) and one conflicts (409)')

    const conflictRes = resA.status === 409 ? resA : resB
    const conflictBody = await conflictRes.json()
    assert.equal(conflictBody.error?.code, 'SLOT_TAKEN')
  })

  test('Reservations: mine and cancel', async () => {
    const mineRes = await fetch(`${baseUrl}/reservations/mine`)
    assert.equal(mineRes.status, 200)
    const mine = await mineRes.json()
    assert.ok(mine.length > 0)
    const resvId = mine[0].reservation_id

    const cancelRes = await fetch(`${baseUrl}/reservations/${resvId}`, {
      method: 'DELETE',
    })
    assert.equal(cancelRes.status, 200)

    const afterCancel = await fetch(`${baseUrl}/reservations/mine`)
    const afterList = await afterCancel.json()
    const match = afterList.find((r) => r.reservation_id === resvId)
    assert.equal(match, undefined, 'Cancelled reservation is no longer in active list')
  })

  test('Validation and Error Mapping tests', async () => {
    const badQuery = await fetch(`${baseUrl}/free?day=99&time=12:00`)
    assert.equal(badQuery.status, 400)
    const badQueryData = await badQuery.json()
    assert.equal(badQueryData.error?.code, 'BAD_REQUEST')

    const notFound = await fetch(`${baseUrl}/unknown-path`)
    assert.equal(notFound.status, 404)
    const notFoundData = await notFound.json()
    assert.equal(notFoundData.error?.code, 'NOT_FOUND')
  })
})
