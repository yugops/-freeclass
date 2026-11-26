import { useEffect, useRef, useState } from 'react'
import { errorText, request, useApi } from '../api.js'
import { getDeviceId } from '../device.js'
import {
  DAYS, dateForDay, dayName, dayOfDate, defaultDay, formatDate,
  hhmm, isWeekend, localNow, localToday, slotForTime, toMin,
} from '../time.js'
import { Badge, Button, Card, Check, Choice, Empty, Field, Notice, Skeleton } from '../ui.jsx'

function ReservePanel({ roomNo, day, time, term, slots }) {
  const minDate = localToday() > term.starts_on ? localToday() : term.starts_on
  const maxDate = term.ends_on
  const initialDate = dateForDay(day, minDate, maxDate)
  const tMin = toMin(time)
  const initialSlot = slotForTime(slots, time)?.slot_no
    ?? slots.find((s) => toMin(s.start_time) > tMin)?.slot_no
    ?? slots[0]?.slot_no ?? 1

  const [date, setDate] = useState(initialDate || '')
  const [slotNo, setSlotNo] = useState(initialSlot)
  const [dateErr, setDateErr] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [apiErr, setApiErr] = useState('')
  const [booked, setBooked] = useState(null)

  const dateRef = useRef(null)
  const successRef = useRef(null)

  useEffect(() => {
    if (booked && successRef.current) successRef.current.focus()
  }, [booked])

  const checkDate = (val) => {
    if (!val || val < minDate || val > maxDate || dayOfDate(val) !== day) {
      return `Pick a ${dayName(day, 'long')}.`
    }
    return ''
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setTouched(true)
    setApiErr('')
    const err = checkDate(date)
    setDateErr(err)
    if (err) {
      dateRef.current?.focus()
      return
    }
    setBusy(true)
    try {
      await request('/reservations', {
        method: 'POST',
        body: { room_no: roomNo, date, slot_no: Number(slotNo) },
      })
      const slot = slots.find((s) => s.slot_no === Number(slotNo))
      setBooked({ date, slot })
    } catch (errRes) {
      setApiErr(errorText(errRes))
    } finally {
      setBusy(false)
    }
  }

  if (!initialDate) {
    return (
      <div className="sub-panel">
        <Notice tone="warning"><span>No {dayName(day, 'long')} left in this term.</span></Notice>
      </div>
    )
  }

  if (booked) {
    return (
      <div className="sub-panel">
        <Notice
          tone="success"
          noticeRef={successRef}
          action={<a className="btn btn-secondary" href="#mine">View bookings</a>}
        >
          <span>
            Booked {roomNo} on {formatDate(booked.date)}, {hhmm(booked.slot?.start_time)} to {hhmm(booked.slot?.end_time)}.
          </span>
        </Notice>
      </div>
    )
  }

  return (
    <form className="sub-panel stack" onSubmit={handleSubmit} noValidate>
      <p><strong>Room:</strong> <span className="mono">{roomNo}</span></p>
      <Field id={`res-date-${roomNo}`} label="Date" error={dateErr}>
        {(props) => (
          <input
            {...props}
            ref={dateRef}
            className="input"
            type="date"
            min={minDate}
            max={maxDate}
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              if (touched) setDateErr(checkDate(e.target.value))
            }}
            onBlur={() => { if (touched) setDateErr(checkDate(date)) }}
            required
          />
        )}
      </Field>
      <Field id={`res-slot-${roomNo}`} label="Period">
        {(props) => (
          <select
            {...props}
            className="select"
            value={slotNo}
            onChange={(e) => setSlotNo(Number(e.target.value))}
          >
            {slots.map((s) => (
              <option key={s.slot_no} value={s.slot_no}>
                {s.slot_no} · {hhmm(s.start_time)} to {hhmm(s.end_time)}
              </option>
            ))}
          </select>
        )}
      </Field>
      {apiErr && <Notice tone="error"><span>{apiErr}</span></Notice>}
      <div><Button type="submit" variant="primary" busy={busy}>Reserve this room</Button></div>
    </form>
  )
}

export default function Find({ term, slots }) {
  const [day, setDay] = useState(() => defaultDay())
  const [time, setTime] = useState(() => localNow())
  const [charging, setCharging] = useState(false)
  const [sort, setSort] = useState('longest')
  const [openRoom, setOpenRoom] = useState(null)
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const [reloadTick, setReloadTick] = useState(0)

  // Live room traffic / check-in state
  const [roomStatuses, setRoomStatuses] = useState({})
  const [checkinBusy, setCheckinBusy] = useState({})
  const [checkinToast, setCheckinToast] = useState(null)

  const retryRef = useRef(null)
  const firstRunRef = useRef(true)
  const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  const deviceId = getDeviceId()

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

    // Optimistic UI update
    setRoomStatuses((s) => {
      const nextCount = willCheckIn ? prev.active_count + 1 : Math.max(0, prev.active_count - 1)
      const nextLabel = willCheckIn
        ? (nextCount >= 2 ? (nextCount > 24 ? `🔴 Crowded (${nextCount} people)` : `🟡 ${nextCount} people`) : '🟢 1 person')
        : (nextCount >= 2 ? `🟡 ${nextCount} people` : '🟢 Empty')
      return {
        ...s,
        [roomNo]: {
          ...prev,
          user_checked_in: willCheckIn,
          active_count: nextCount,
          label: nextLabel,
          state: nextCount > 24 ? 'crowded' : nextCount >= 10 ? 'moderate' : 'empty',
        },
      }
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
      setRoomStatuses((s) => ({ ...s, [roomNo]: prev }))
      setCheckinToast({ tone: 'error', text: errorText(err) })
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
        <Notice
          tone={checkinToast.tone}
          action={<Button variant="secondary" onClick={() => setCheckinToast(null)}>Dismiss</Button>}
        >
          <span>{checkinToast.text}</span>
        </Notice>
      )}

      <Card>
        <div className="stack">
          <Choice
            legend="Day"
            name="find-day"
            value={day}
            onChange={(v) => { setDay(v); setOpenRoom(null) }}
            options={DAYS.map((d) => ({ value: d.value, label: d.short }))}
          />
          <div className="row">
            <Field id="find-time" label="Time" error={!validTime ? 'Enter a time in HH:MM format.' : undefined}>
              {(props) => (
                <div className="input-row">
                  <input {...props} className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
                  <Button variant="secondary" onClick={() => setTime(localNow())}>Now</Button>
                </div>
              )}
            </Field>
            <Check id="find-charging" label="Charging only" checked={charging} onChange={setCharging} />
          </div>
          <Choice
            legend="Sort"
            name="find-sort"
            value={sort}
            onChange={setSort}
            options={[{ value: 'longest', label: 'Longest free' }, { value: 'room', label: 'Room' }]}
          />
        </div>
      </Card>

      {/* Special Mention for verified charging rooms without scheduled timetable */}
      {unmentionedRooms.length > 0 && (
        <Card>
          <div className="meta-row">
            <h2>Charging Ports (Timetable Not Published)</h2>
            <Badge tone="blue">CHARGING</Badge>
          </div>
          <p style={{ marginTop: '0.5rem', marginBottom: '0.75rem' }}>
            The following rooms are confirmed to have charging ports, though no official timetable has been posted for them. They are generally accessible for charging and quiet study:
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {unmentionedRooms.map((r) => (
              <Badge key={r.room_no} tone="green">
                {r.room_no} (Block {r.block})
              </Badge>
            ))}
          </div>
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
        <>
          <p className="status-line" role="status">
            <span>
              {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'} free at {queryTime} on {dayName(queryDay, 'short')}
            </span>
            {state.loading && <Badge tone="yellow">Updating...</Badge>}
          </p>

          {rooms.length === 0 && !outsideHours && (
            <Empty>No free rooms at {queryTime} on {dayName(queryDay, 'short')}. Try another time or turn off the charging filter.</Empty>
          )}

          {rooms.length > 0 && (
            <ul className="grid" aria-busy={state.loading || undefined}>
              {rooms.map((room) => {
                const isOpen = openRoom === room.room_no
                const statusInfo = roomStatuses[room.room_no]
                const isCheckedIn = Boolean(statusInfo?.user_checked_in)
                const trafficLabel = statusInfo?.label || '🟢 Empty'
                const trafficTone = statusInfo?.state === 'crowded' ? 'red' : statusInfo?.state === 'moderate' ? 'yellow' : 'green'

                return (
                  <Card as="li" key={room.room_no}>
                    <div className="meta-row">
                      <h2 className="big-data">{room.room_no}</h2>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', alignItems: 'center' }}>
                        {room.has_charging && <Badge tone="blue">Charging</Badge>}
                        <Badge tone={trafficTone}>{trafficLabel}</Badge>
                      </div>
                    </div>

                    <div className="stack-sm">
                      <p className="big-line">Free until {hhmm(room.freeTo)}</p>
                      <p className="mono">{room.minsLeft} min left</p>
                      {room.win && (
                        <p className="small-meta">Free window {hhmm(room.win.free_from)} to {hhmm(room.win.free_to)}</p>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
                      <Button
                        variant={isCheckedIn ? 'secondary' : 'confirm'}
                        busy={Boolean(checkinBusy[room.room_no])}
                        onClick={() => handleToggleCheckin(room.room_no)}
                      >
                        {isCheckedIn ? 'Leave room' : "I'm using this room"}
                      </Button>
                      <Button
                        variant={isOpen ? 'secondary' : 'primary'}
                        aria-expanded={isOpen}
                        onClick={() => setOpenRoom(isOpen ? null : room.room_no)}
                      >
                        {isOpen ? 'Close reserve' : 'Reserve'}
                      </Button>
                    </div>

                    {isOpen && (
                      <ReservePanel
                        roomNo={room.room_no}
                        day={queryDay}
                        time={queryTime}
                        term={term}
                        slots={slots}
                      />
                    )}
                  </Card>
                )
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
