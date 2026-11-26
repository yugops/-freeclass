import { useEffect, useRef, useState } from 'react'
import { errorText, request, useApi } from '../api.js'
import { DAYS, dayName, defaultDay, hhmm, isWeekend } from '../time.js'
import { Badge, Button, Card, Choice, Empty, Field, Notice, Skeleton } from '../ui.jsx'

export default function Teacher() {
  const [name, setName] = useState('')
  const [day, setDay] = useState(() => defaultDay())
  const [searched, setSearched] = useState('')
  const [state, setState] = useState({ data: null, error: null, loading: false })
  const [tick, setTick] = useState(0)

  const nameRef = useRef(null)
  const retryRef = useRef(null)

  // Fetch list of all faculty members for the roll over dropdown menu
  const teachersListApi = useApi('/teachers', [])
  const teachers = Array.isArray(teachersListApi.data) ? teachersListApi.data : []

  useEffect(() => {
    if (!searched) {
      setState({ data: null, error: null, loading: false })
      return
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      setState((s) => ({ data: s.data, error: null, loading: true }))
      const q = `/teacher?name=${encodeURIComponent(searched)}&day=${day}`
      request(q, { signal: ctrl.signal })
        .then((rows) => {
          if (!ctrl.signal.aborted) {
            setState({
              data: { rows, queryName: searched, queryDay: day },
              error: null,
              loading: false,
            })
          }
        })
        .catch((err) => {
          if (ctrl.signal.aborted || err.name === 'AbortError') return
          setState((s) => ({ data: s.data, error: err, loading: false }))
        })
    }, 200)

    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [searched, day, tick])

  useEffect(() => {
    if (state.error && retryRef.current) retryRef.current.focus()
  }, [state.error])

  const handleSelectTeacher = (teacherName) => {
    setName(teacherName)
    setSearched(teacherName)
    setTick((t) => t + 1)
  }

  return (
    <div className="stack">
      <h1 tabIndex={-1}>Teachers</h1>
      {isWeekend() && day === 1 && (
        <Notice tone="info">
          <span>Weekend: showing Monday</span>
        </Notice>
      )}

      <Card>
        <div className="stack">
          <Field
            id="t-name"
            label="Teacher name"
            hint="Choose a teacher to see their schedule."
          >
            {(props) => (
              <select
                {...props}
                ref={nameRef}
                className="input"
                value={name}
                onChange={(e) => handleSelectTeacher(e.target.value)}
              >
                <option value="">-- Select a teacher --</option>
                {teachers.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Choice
            legend="Day"
            name="t-day"
            value={day}
            onChange={(newDay) => {
              setDay(newDay)
              if (searched) setTick((t) => t + 1)
            }}
            options={DAYS.map((d) => ({ value: d.value, label: d.short }))}
          />
        </div>
      </Card>

      {state.error && (
        <Notice
          tone="error"
          action={
            <Button
              btnRef={retryRef}
              variant="secondary"
              onClick={() => setTick((t) => t + 1)}
            >
              Retry
            </Button>
          }
        >
          <span>{errorText(state.error)}</span>
        </Notice>
      )}

      {state.loading && !state.data && <Skeleton count={2} />}

      {!searched && !state.loading && (
        <Notice tone="info">
          <span>Select a teacher above to view their schedule for {dayName(day, 'long')}.</span>
        </Notice>
      )}

      {state.data && (
        <>
          <p className="status-line" role="status">
            <span>
              {state.data.queryName} · {dayName(state.data.queryDay, 'long')} (
              {state.data.rows.length} {state.data.rows.length === 1 ? 'class' : 'classes'})
            </span>
            {state.loading && <Badge tone="yellow">Updating...</Badge>}
          </p>

          {state.data.rows.length === 0 ? (
            <Empty>
              {state.data.queryName} has no scheduled classes on {dayName(state.data.queryDay, 'long')}.
            </Empty>
          ) : (
            <ul className="grid" aria-busy={state.loading || undefined}>
              {state.data.rows.map((row, idx) => (
                <Card as="li" key={`${row.faculty}-${row.room_no}-${row.slot_no}-${idx}`}>
                  <div className="badge-row">
                    <Badge tone="yellow">
                      Slot {row.slot_no} · {hhmm(row.start_time)} – {hhmm(row.end_time)}
                    </Badge>
                  </div>
                  <h2 style={{ marginTop: '0.5rem' }}>{row.room_no}</h2>
                  <p className="big-data" style={{ fontSize: '1.1rem', marginTop: '0.25rem' }}>
                    {row.subject}
                  </p>
                  {row.batch && (
                    <p className="mono" style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
                      {row.batch}
                    </p>
                  )}
                </Card>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
