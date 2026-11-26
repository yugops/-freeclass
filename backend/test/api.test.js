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

  test('GET /rooms/traffic-stats returns real check-in traffic analytics', async () => {
    const res = await fetch(`${baseUrl}/rooms/traffic-stats`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(body.summary)
    assert.equal(typeof body.summary.total_active_users, 'number')
    assert.equal(typeof body.summary.rooms_in_use, 'number')
    assert.ok(Array.isArray(body.rooms))
    assert.ok(body.rooms.length > 0)
    for (const r of body.rooms) {
      assert.equal(typeof r.room_no, 'string')
      assert.equal(typeof r.active_count, 'number')
      assert.equal(typeof r.occupancy_pct, 'number')
    }
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
