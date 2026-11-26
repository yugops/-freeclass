import { useEffect, useRef, useState } from 'react'
import { errorText, request, useApi } from '../api.js'
import { getDeviceId } from '../device.js'
import {
  DAYS, dayName, defaultDay, hhmm, isWeekend, localNow, toMin,
} from '../time.js'
import { Badge, Button, Card, Check, Choice, Empty, Field, Notice, Skeleton } from '../ui.jsx'

export default function Find({ term, slots }) {
  const [day, setDay] = useState(() => defaultDay())
  const [time, setTime] = useState(() => localNow())
  const [charging, setCharging] = useState(false)
  const [sort, setSort] = useState('longest')
  const [showChargingRooms, setShowChargingRooms] = useState(false)
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const [reloadTick, setReloadTick] = useState(0)

  // Live room traffic / check-in state
  const [roomStatuses, setRoomStatuses] = useState({})
  const [checkinBusy, setCheckinBusy] = useState({})
  const [checkinToast, setCheckinToast] = useState(null)

  const resultsRef = useRef(null)
  const toastRef = useRef(null)
  const retryRef = useRef(null)
  const firstRunRef = useRef(true)
  const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  const deviceId = getDeviceId()

  const scrollToResults = () => {
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }

  // Poll /api/rooms/status every 30 seconds for live occupancy traffic
  const fetchStatus = () => {
    request(`/rooms/status?device_id=${encodeURIComponent(deviceId)}`)
      .then((data) => {
        if (data && typeof data === 'object') {
          setRoomStatuses(data)
        }
      })
      .catch(() => {})
  }

  useEffect(() => {
    fetchStatus()
    const timer = setInterval(fetchStatus, 30000)
    return () => clearInterval(timer)
  }, [])

  // Check-in or Leave room with optimistic UI update and error rollback
  const handleToggleCheckin = async (roomNo) => {
    const prev = roomStatuses[roomNo] || { active_count: 0, user_checked_in: false }
    const willCheckIn = !prev.user_checked_in
    setCheckinBusy((b) => ({ ...b, [roomNo]: true }))
    setCheckinToast(null)

    // Snapshot of previous statuses for rollback on error
    const previousSnapshot = { ...roomStatuses }

    // Optimistic UI update:
    // If checking into roomNo, clear user_checked_in and decrement active_count for any previous room
    setRoomStatuses((s) => {
      const next = { ...s }
      if (willCheckIn) {
        for (const [rNo, rData] of Object.entries(next)) {
          if (rNo !== roomNo && rData.user_checked_in) {
            const decrCount = Math.max(0, (rData.active_count || 1) - 1)
            next[rNo] = {
              ...rData,
              user_checked_in: false,
              active_count: decrCount,
              label: `${decrCount} TFW`,
              tone: decrCount === 0 ? 'lilac' : decrCount > 5 ? 'yellow' : 'green',
              state: decrCount > 0 ? 'active' : 'idle',
            }
          }
        }
      }
      const nextCount = willCheckIn ? prev.active_count + 1 : Math.max(0, prev.active_count - 1)
      const nextLabel = `${nextCount} TFW`
      const nextTone = nextCount === 0 ? 'lilac' : nextCount > 5 ? 'yellow' : 'green'
      next[roomNo] = {
        ...prev,
        user_checked_in: willCheckIn,
        active_count: nextCount,
        label: nextLabel,
        tone: nextTone,
        state: nextCount > 0 ? 'active' : 'idle',
      }
      return next
    })

    try {
      if (willCheckIn) {
        await request('/checkin', {
          method: 'POST',
          body: { device_id: deviceId, room_id: roomNo },
        })
        setCheckinToast({ tone: 'success', text: `You are now checked into ${roomNo}!` })
      } else {
        await request('/leave', {
          method: 'POST',
          body: { device_id: deviceId, room_id: roomNo },
        })
        setCheckinToast({ tone: 'info', text: `Left room ${roomNo}.` })
      }
      fetchStatus()
    } catch (err) {
      // Rollback to previous state on error
      const errMsg = errorText(err)
      setRoomStatuses(previousSnapshot)
      setCheckinToast({ tone: 'error', text: errMsg, roomNo })
      // Auto-scroll to where the error appears
      setTimeout(() => {
        toastRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 60)
    } finally {
      setCheckinBusy((b) => ({ ...b, [roomNo]: false }))
    }
  }

  // Fetch rooms with charging ports whose timetable is unmentioned
  const unmentionedApi = useApi('/rooms/unmentioned-charging', [])
  const unmentionedRooms = Array.isArray(unmentionedApi.data) ? unmentionedApi.data : []

  useEffect(() => {
    if (!validTime) return
    const ctrl = new AbortController()
    const run = () => {
      setState((s) => ({ data: s.data, error: null, loading: true }))
      Promise.all([
        request(`/free?day=${day}&time=${time}&charging=${charging}`, { signal: ctrl.signal }),
        request(`/free-windows?day=${day}&charging=${charging}`, { signal: ctrl.signal }),
      ])
        .then(([free, windows]) => {
          if (!ctrl.signal.aborted) setState({ data: { free, windows, queryTime: time, queryDay: day }, error: null, loading: false })
        })
        .catch((err) => {
          if (ctrl.signal.aborted || err.name === 'AbortError') return
          setState((s) => ({ data: s.data, error: err, loading: false }))
        })
    }
    const delay = firstRunRef.current ? 0 : 300
    firstRunRef.current = false
    const timer = setTimeout(run, delay)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [day, time, charging, reloadTick, validTime])

  useEffect(() => {
    if (state.error && retryRef.current) retryRef.current.focus()
  }, [state.error])

  const queryTime = state.data?.queryTime || time
  const queryDay = state.data?.queryDay || day
  const qMin = toMin(queryTime)
  const rooms = (state.data?.free || []).map((r) => {
    const win = (state.data?.windows || []).find(
      (w) => w.room_no === r.room_no && toMin(w.free_from) <= qMin && qMin < toMin(w.free_to)
    )
    const freeTo = win ? win.free_to : r.free_until
    return { ...r, win, freeTo, minsLeft: Math.max(0, toMin(freeTo) - qMin) }
  })
  rooms.sort((a, b) =>
    sort === 'room'
      ? a.room_no.localeCompare(b.room_no)
      : b.minsLeft - a.minsLeft || a.room_no.localeCompare(b.room_no)
  )

  const firstSlot = slots[0]
  const lastSlot = slots[slots.length - 1]
  const outsideHours = validTime && slots.length > 0
    && (toMin(time) < toMin(firstSlot.start_time) || toMin(time) >= toMin(lastSlot.end_time))

  return (
    <div className="stack">
      <h1 tabIndex={-1}>Find rooms</h1>
      {isWeekend() && day === 1 && <Notice tone="info"><span>Weekend: showing Monday</span></Notice>}

      {checkinToast && (
        <div ref={toastRef} style={{ scrollMarginTop: '2rem' }}>
          <Notice
            tone={checkinToast.tone}
            action={<Button variant="secondary" onClick={() => setCheckinToast(null)}>Dismiss</Button>}
          >
            <span>{checkinToast.text}</span>
          </Notice>
        </div>
      )}

      <Card>
        <div className="stack">
          <Choice
            legend="Day"
            name="find-day"
            value={day}
            onChange={(v) => { setDay(v); scrollToResults() }}
            options={DAYS.map((d) => ({ value: d.value, label: d.short }))}
          />
          <div className="row">
            <Field id="find-time" label="Time" error={!validTime ? 'Enter a time in HH:MM format.' : undefined}>
              {(props) => (
                <div className="input-row">
                  <input {...props} className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
                  <Button variant="secondary" onClick={() => { setTime(localNow()); scrollToResults() }}>Now</Button>
                </div>
              )}
            </Field>
            <Check id="find-charging" label="Charging only" checked={charging} onChange={(v) => { setCharging(v); scrollToResults() }} />
          </div>
          <Choice
            legend="Sort"
            name="find-sort"
            value={sort}
            onChange={(v) => { setSort(v); scrollToResults() }}
            options={[{ value: 'longest', label: 'Longest free' }, { value: 'room', label: 'Room' }]}
          />
        </div>
      </Card>

      {/* Collapsible Special Mention for verified charging rooms without scheduled timetable */}
      {unmentionedRooms.length > 0 && (
        <Card style={{ padding: '0.875rem 1.25rem' }}>
          <div className="meta-row" style={{ alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
              <Badge tone="blue">CHARGING</Badge>
              <strong>Unscheduled Rooms with Charging ({unmentionedRooms.length})</strong>
            </div>
            <Button
              variant="secondary"
              onClick={() => setShowChargingRooms(!showChargingRooms)}
              aria-expanded={showChargingRooms}
            >
              {showChargingRooms ? 'Hide ▴' : 'Expand ▾'}
            </Button>
          </div>

          {showChargingRooms && (
            <div style={{ marginTop: '0.875rem', borderTop: 'var(--bw) solid var(--ink)', paddingTop: '0.75rem' }}>
              <p style={{ marginBottom: '0.75rem', fontSize: '0.9375rem' }}>
                The following rooms are confirmed to have charging ports, though no official timetable has been posted for them. They are generally accessible for charging and quiet study:
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {unmentionedRooms.map((r) => (
                  <Badge key={r.room_no} tone="green">
                    {r.room_no} (Block {r.block})
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {outsideHours && (
        <Notice tone="info">
          <span>No classes run at this time. Periods run {hhmm(firstSlot.start_time)} to {hhmm(lastSlot.end_time)}.</span>
        </Notice>
      )}

      {state.error && (
        <Notice
          tone="error"
          action={<Button btnRef={retryRef} variant="secondary" onClick={() => setReloadTick((t) => t + 1)}>Retry</Button>}
        >
          <span>{errorText(state.error)}</span>
        </Notice>
      )}

      {state.loading && !state.data && <Skeleton count={3} />}

      {state.data && (
        <div ref={resultsRef} style={{ scrollMarginTop: '1.5rem' }}>
          <p className="status-line" role="status">
            <span>
              {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'} free at {queryTime} on {dayName(queryDay, 'short')}
            </span>
            {state.loading && <Badge tone="yellow">Updating...</Badge>}
          </p>

          <p className="small-meta" style={{ marginTop: '0.25rem', marginBottom: '0.875rem' }}>
            * <strong>TFW</strong> = Traffic came from website (student check-ins recorded via this site)
          </p>

          {rooms.length === 0 && !outsideHours && (
            <Empty>No free rooms at {queryTime} on {dayName(queryDay, 'short')}. Try another time or turn off the charging filter.</Empty>
          )}

          {rooms.length > 0 && (
            <ul className="grid" aria-busy={state.loading || undefined}>
              {rooms.map((room) => {
                const statusInfo = roomStatuses[room.room_no]
                const isCheckedIn = Boolean(statusInfo?.user_checked_in)
                const trafficLabel = statusInfo?.label || '0 TFW'
                const trafficTone = statusInfo?.tone || 'lilac'

                return (
                  <Card as="li" key={room.room_no}>
                    <div className="meta-row">
                      <h2 className="big-data">{room.room_no}</h2>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', alignItems: 'center' }}>
                        {room.has_charging && <Badge tone="blue">Charging</Badge>}
                        <Badge tone={trafficTone} title="TFW: Traffic came from website">{trafficLabel}</Badge>
                      </div>
                    </div>

                    <div className="stack-sm">
                      <p className="big-line">Free until {hhmm(room.freeTo)}</p>
                      <p className="mono">{room.minsLeft} min left</p>
                      {room.win && (
                        <p className="small-meta">Free window {hhmm(room.win.free_from)} to {hhmm(room.win.free_to)}</p>
                      )}
                    </div>

                    {checkinToast?.roomNo === room.room_no && checkinToast?.tone === 'error' && (
                      <div ref={toastRef} style={{ marginTop: '0.5rem', scrollMarginTop: '2rem' }}>
                        <Notice tone="error">
                          <span>{checkinToast.text}</span>
                        </Notice>
                      </div>
                    )}

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
                      <Button
                        variant={isCheckedIn ? 'secondary' : 'confirm'}
                        busy={Boolean(checkinBusy[room.room_no])}
                        onClick={() => handleToggleCheckin(room.room_no)}
                      >
                        {isCheckedIn ? 'Leave room' : 'Contribute to traffic'}
                      </Button>
                    </div>
                  </Card>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
