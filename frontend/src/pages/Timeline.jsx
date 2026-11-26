import { useEffect, useRef, useState } from 'react'
import { errorText, useApi } from '../api.js'
import { DAYS, dayName, defaultDay, hhmm, isWeekend, toMin } from '../time.js'
import { Badge, Bar, Button, Card, Check, Choice, Empty, Notice, Skeleton } from '../ui.jsx'

export default function Timeline({ slots }) {
  const [day, setDay] = useState(() => defaultDay())
  const [charging, setCharging] = useState(false)
  const retryRef = useRef(null)

  const { data, error, loading, reload } = useApi(
    `/free-windows?day=${day}&charging=${charging}`,
    [day, charging]
  )

  useEffect(() => {
    if (error && retryRef.current) retryRef.current.focus()
  }, [error])

  const firstStart = slots.length ? toMin(slots[0].start_time) : 0
  const lastEnd = slots.length ? toMin(slots[slots.length - 1].end_time) : 1
  const span = Math.max(1, lastEnd - firstStart)

  const grouped = new Map()
  for (const row of data || []) {
    if (!grouped.has(row.room_no)) {
      grouped.set(row.room_no, {
        room_no: row.room_no,
        has_charging: row.has_charging,
        windows: [],
        totalMin: 0,
      })
    }
    const entry = grouped.get(row.room_no)
    entry.windows.push(row)
    entry.totalMin += Math.max(0, toMin(row.free_to) - toMin(row.free_from))
  }

  const rooms = Array.from(grouped.values()).map((r) => {
    r.windows.sort((a, b) => toMin(a.free_from) - toMin(b.free_from))
    return r
  })
  rooms.sort((a, b) => b.totalMin - a.totalMin || a.room_no.localeCompare(b.room_no))

  return (
    <div className="stack">
      <h1 tabIndex={-1}>Timeline</h1>
      {isWeekend() && day === 1 && <Notice tone="info"><span>Weekend: showing Monday</span></Notice>}

      <Card>
        <div className="stack">
          <Choice
            legend="Day"
            name="tl-day"
            value={day}
            onChange={setDay}
            options={DAYS.map((d) => ({ value: d.value, label: d.short }))}
          />
          <Check id="tl-charging" label="Charging only" checked={charging} onChange={setCharging} />
        </div>
      </Card>

      {error && (
        <Notice
          tone="error"
          action={<Button btnRef={retryRef} variant="secondary" onClick={reload}>Retry</Button>}
        >
          <span>{errorText(error)}</span>
        </Notice>
      )}

      {loading && !data && <Skeleton count={3} />}

      {data && (
        <>
          <div className="stack-sm">
            <h2 className="status-line" role="status">
              <span>Rooms with free time on {dayName(day, 'long')}</span>
              {loading && <Badge tone="yellow">Updating...</Badge>}
            </h2>
            <p className="small-meta">Rooms with no free time are not listed.</p>
          </div>

          {rooms.length === 0 ? (
            <Empty>
              No rooms have free time on {dayName(day, 'long')}. Try another day or turn off the charging filter.
            </Empty>
          ) : (
            <ul className="stack" aria-busy={loading || undefined} style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {rooms.map((room) => {
                const segments = room.windows.map((w) => ({
                  leftPct: ((toMin(w.free_from) - firstStart) / span) * 100,
                  widthPct: ((toMin(w.free_to) - toMin(w.free_from)) / span) * 100,
                }))
                const summary = `${room.room_no}: ` + room.windows
                  .map((w) => `free ${hhmm(w.free_from)} to ${hhmm(w.free_to)}`)
                  .join(', ')

                return (
                  <Card as="li" key={room.room_no}>
                    <div className="meta-row">
                      <h3 className="big-data">{room.room_no}</h3>
                      {room.has_charging && <Badge tone="blue">Charging</Badge>}
                    </div>
                    <Bar segments={segments} label={summary} />
                    <ul className="stack-sm" style={{ paddingLeft: '1.25rem', margin: 0 }}>
                      {room.windows.map((w) => (
                        <li key={`${w.free_from}-${w.free_to}`} className="mono small-meta">
                          Free {hhmm(w.free_from)} to {hhmm(w.free_to)} ({w.n_slots} {w.n_slots === 1 ? 'period' : 'periods'})
                        </li>
                      ))}
                    </ul>
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
