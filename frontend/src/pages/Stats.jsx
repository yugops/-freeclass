import { useRef, useEffect } from 'react'
import { errorText, useApi } from '../api.js'
import { Badge, Bar, Button, Card, Notice, Skeleton } from '../ui.jsx'

export default function Stats() {
  const headingRef = useRef(null)
  const retryRef = useRef(null)

  const { data: utilData, error: utilErr, loading: utilLoading, reload: reloadUtil } = useApi('/utilisation', [])
  const { data: conflictData } = useApi('/conflicts', [])

  useEffect(() => {
    if (utilErr && retryRef.current) retryRef.current.focus()
  }, [utilErr])

  const rooms = Array.isArray(utilData) ? utilData : []
  const conflicts = Array.isArray(conflictData) ? conflictData : []

  return (
    <div className="stack">
      <h1 ref={headingRef} tabIndex={-1}>Room utilisation</h1>

      {utilErr && (
        <Notice
          tone="error"
          action={<Button btnRef={retryRef} variant="secondary" onClick={reloadUtil}>Retry</Button>}
        >
          <span>{errorText(utilErr)}</span>
        </Notice>
      )}

      {conflicts.length > 0 && (
        <Notice tone="warning">
          <span>{conflicts.length} faculty scheduling conflict(s) detected.</span>
        </Notice>
      )}

      {utilLoading && !utilData && <Skeleton count={4} />}

      {rooms.length > 0 && (
        <>
          <p className="status-line" role="status">
            <span>{rooms.length} rooms tracked</span>
            {utilLoading && <Badge tone="yellow">Updating...</Badge>}
          </p>

          <ul className="grid" aria-busy={utilLoading || undefined}>
            {rooms.map((room) => {
              const util = Math.round(room.util_pct || 0)
              const segments = [
                { leftPct: 0, widthPct: util, tone: util > 70 ? 'red' : util > 40 ? 'yellow' : 'green' },
              ]
              return (
                <Card as="li" key={room.room_no}>
                  <div className="meta-row">
                    <h2 className="big-data">{room.room_no}</h2>
                    <Badge tone={util > 70 ? 'red' : util > 40 ? 'yellow' : 'green'}>
                      Rank #{room.busiest_rank}
                    </Badge>
                  </div>

                  <div className="stack-sm" style={{ marginTop: '0.5rem' }}>
                    <p>
                      <strong>{util}% utilised</strong> ({room.busy_slots} of {room.total_slots} slots busy)
                    </p>
                    <Bar segments={segments} label={`${room.room_no} ${util}% utilised`} />
                  </div>
                </Card>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
