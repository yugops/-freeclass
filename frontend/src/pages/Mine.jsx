import { useEffect, useRef, useState } from 'react'
import { errorText, request, useApi } from '../api.js'
import { formatDate, hhmm, localToday } from '../time.js'
import { Badge, Button, Card, Empty, Notice, Skeleton } from '../ui.jsx'

export default function Mine() {
  const [confirmId, setConfirmId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [cancelErr, setCancelErr] = useState('')

  const headingRef = useRef(null)
  const retryRef = useRef(null)

  const { data, error, loading, reload } = useApi('/reservations/mine', [])

  useEffect(() => {
    if (error && retryRef.current) retryRef.current.focus()
  }, [error])

  const today = localToday()

  const handleCancel = async (id) => {
    setBusyId(id)
    setCancelErr('')
    try {
      await request(`/reservations/${id}`, {
        method: 'DELETE',
      })
      setConfirmId(null)
      reload()
      headingRef.current?.focus()
    } catch (err) {
      setCancelErr(errorText(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="stack">
      <h1 ref={headingRef} tabIndex={-1}>Bookings</h1>

      {cancelErr && <Notice tone="error"><span>{cancelErr}</span></Notice>}

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
          <p className="status-line" role="status">
            <span>{data.length} {data.length === 1 ? 'active booking' : 'active bookings'}</span>
            {loading && <Badge tone="yellow">Updating...</Badge>}
          </p>

          {data.length === 0 ? (
            <Empty action={<a className="btn btn-primary" href="#find">Find rooms</a>}>
              No active bookings yet.
            </Empty>
          ) : (
            <ul className="grid" aria-busy={loading || undefined}>
              {data.map((row) => {
                const isPast = row.date < today
                const isActive = row.status === 'active'
                const canCancel = isActive && !isPast
                const confirming = confirmId === row.reservation_id

                return (
                  <Card as="li" key={row.reservation_id}>
                    <div className="meta-row">
                      <h2 className="big-data">{row.room_no}</h2>
                      <Badge tone={isActive ? 'green' : 'red'}>{row.status}</Badge>
                    </div>

                    <div className="stack-sm">
                      <p><strong>{formatDate(row.date)}</strong></p>
                      <p className="mono">
                        Slot {row.slot_no} · {hhmm(row.start_time)} to {hhmm(row.end_time)}
                      </p>
                    </div>

                    {canCancel && (
                      <div className="row" style={{ marginTop: '0.75rem' }}>
                        {confirming ? (
                          <>
                            <Button
                              variant="danger"
                              busy={busyId === row.reservation_id}
                              onClick={() => handleCancel(row.reservation_id)}
                            >
                              Confirm cancel
                            </Button>
                            <Button variant="secondary" onClick={() => setConfirmId(null)}>
                              Keep
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setConfirmId(row.reservation_id)
                              setCancelErr('')
                            }}
                          >
                            Cancel booking
                          </Button>
                        )}
                      </div>
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
