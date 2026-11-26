import test, { describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { app } from '../src/app.js'
import { pool, query } from '../src/db.js'
import { checkRateLimit, recordRateLimit, MAX_CHECKINS_PER_WINDOW } from '../src/routes/checkin.js'

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
  try { await query('DELETE FROM fc.checkin') } catch (_) {}
  await new Promise((resolve) => server.close(resolve))
  await pool.end()
})

describe('Room Check-in & Traffic Concurrency Tests', () => {
  const TEST_ROOM = 'A-101'
  const TEST_ROOM_2 = 'B-216'

  before(async () => {
    // Clear checkins for clean test environment
    await query('DELETE FROM fc.checkin')
  })

  after(async () => {
    // Clean up all test checkins so database is left empty
    await query('DELETE FROM fc.checkin')
  })

  test('POST /api/checkin validates UUID and room_id', async () => {
    const badUuid = await fetch(`${baseUrl}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'not-a-uuid', room_id: TEST_ROOM }),
    })
    assert.equal(badUuid.status, 400)

    const badRoom = await fetch(`${baseUrl}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: randomUUID(), room_id: 'NONEXISTENT-999' }),
    })
    assert.equal(badRoom.status, 404)
  })

  test('Concurrency: 20 distinct devices + 5 identical devices simultaneously', async () => {
    const distinctDevices = Array.from({ length: 20 }, () => randomUUID())
    const repeatedDevice = randomUUID()
    const duplicateRequests = Array.from({ length: 5 }, () => repeatedDevice)

    // Fire all 25 requests simultaneously
    const allRequests = [
      ...distinctDevices.map((d) => ({ device_id: d, isDup: false })),
      ...duplicateRequests.map((d) => ({ device_id: d, isDup: true })),
    ]

    // Shuffle to interleave concurrent requests
    allRequests.sort(() => Math.random() - 0.5)

    const responses = await Promise.all(
      allRequests.map(async (req) => {
        const res = await fetch(`${baseUrl}/checkin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': `10.0.0.${Math.floor(Math.random() * 250) + 1}`, // Bypass per-IP limit in test
          },
          body: JSON.stringify({
            device_id: req.device_id,
            room_id: TEST_ROOM,
          }),
        })
        const data = await res.json()
        return { status: res.status, data, device_id: req.device_id }
      })
    )

    // For the repeated device, verify all 5 responses handled gracefully without 500 error
    const repeatedResponses = responses.filter((r) => r.device_id === repeatedDevice)
    assert.equal(repeatedResponses.length, 5)
    
    // Exactly 1 check-in succeeds (201) and the other 4 are gracefully rejected as duplicates (409)
    const successCount = repeatedResponses.filter((r) => r.status === 201).length
    const dupCount = repeatedResponses.filter((r) => r.status === 409).length
    assert.equal(successCount, 1, 'Exactly one concurrent request succeeds')
    assert.equal(dupCount, 4, 'Four concurrent requests rejected as duplicates')

    // Now query /api/rooms/status
    const statusRes = await fetch(`${baseUrl}/rooms/status`)
    assert.equal(statusRes.status, 200)
    const statusMap = await statusRes.json()

    const roomStatus = statusMap[TEST_ROOM]
    assert.ok(roomStatus, `Room ${TEST_ROOM} must be in status response`)

    // Exactly 21 distinct devices (20 distinct + 1 repeated) must be active
    assert.equal(
      roomStatus.active_count,
      21,
      `Expected exactly 21 active check-ins, got ${roomStatus.active_count}`
    )

    // With 21 check-ins, it should show active / "21 TFW"
    assert.equal(roomStatus.state, 'active')
    assert.match(roomStatus.label, /21 TFW/)
  })

  test('Single-room check-in constraint across rooms: moving to new room leaves old room', async () => {
    const testDevice = randomUUID()

    // 1. Check into TEST_ROOM (A-101)
    const res1 = await fetch(`${baseUrl}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: testDevice, room_id: TEST_ROOM }),
    })
    assert.equal(res1.status, 201)

    // 2. In same session, check into TEST_ROOM_2 (B-216)
    const res2 = await fetch(`${baseUrl}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '10.1.2.3',
      },
      body: JSON.stringify({ device_id: testDevice, room_id: TEST_ROOM_2 }),
    })
    assert.equal(res2.status, 201)

    // Query status with device header
    const statusRes = await fetch(`${baseUrl}/rooms/status?device_id=${testDevice}`)
    const statusMap = await statusRes.json()

    // Device should be checked in at TEST_ROOM_2, and NOT at TEST_ROOM
    assert.equal(statusMap[TEST_ROOM].user_checked_in, false)
    assert.equal(statusMap[TEST_ROOM_2].user_checked_in, true)
  })

  test('POST /api/leave removes active check-in', async () => {
    const testDevice = randomUUID()

    // Check into TEST_ROOM_2
    await fetch(`${baseUrl}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: testDevice, room_id: TEST_ROOM_2 }),
    })

    // Verify checked in
    let statusRes = await fetch(`${baseUrl}/rooms/status?device_id=${testDevice}`)
    let statusMap = await statusRes.json()
    assert.equal(statusMap[TEST_ROOM_2].user_checked_in, true)
    const countBefore = statusMap[TEST_ROOM_2].active_count

    // Leave TEST_ROOM_2
    const leaveRes = await fetch(`${baseUrl}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: testDevice, room_id: TEST_ROOM_2 }),
    })
    assert.equal(leaveRes.status, 200)

    // Verify checked out
    statusRes = await fetch(`${baseUrl}/rooms/status?device_id=${testDevice}`)
    statusMap = await statusRes.json()
    assert.equal(statusMap[TEST_ROOM_2].user_checked_in, false)
    assert.equal(statusMap[TEST_ROOM_2].active_count, countBefore - 1)
  })

  test('Rate limit allows up to 3 check-ins per minute and rejects the 4th', () => {
    const map = new Map()
    const testKey = 'test-device-rate-limit'

    // 1st, 2nd, and 3rd check-ins succeed
    for (let i = 1; i <= MAX_CHECKINS_PER_WINDOW; i++) {
      assert.doesNotThrow(() => checkRateLimit(testKey, map, 'device', true))
      recordRateLimit(testKey, map)
    }

    // 4th check-in is rejected with 429
    assert.throws(
      () => checkRateLimit(testKey, map, 'device', true),
      (err) => err.status === 429 && /limit: 3 per minute/.test(err.message)
    )
  })
})
