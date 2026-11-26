import { useRef, useEffect } from 'react'
import { errorText, useApi } from '../api.js'
import { Badge, Bar, Button, Card, Notice, Skeleton } from '../ui.jsx'

export default function Stats() {
  const headingRef = useRef(null)
  const retryRef = useRef(null)

  const { data, error, loading, reload } = useApi('/rooms/traffic-stats', [])

  useEffect(() => {
    if (error && retryRef.current) retryRef.current.focus()
  }, [error])

  const summary = data?.summary || { total_active_users: 0, rooms_in_use: 0, total_rooms: 0, total_checkins_all_time: 0 }
  const rooms = Array.isArray(data?.rooms) ? data.rooms : []

  return (
    <div className="stack">
      <div className="meta-row">
        <h1 ref={headingRef} tabIndex={-1}>Live Room Traffic</h1>
        <Button variant="secondary" onClick={reload} busy={loading}>
          {loading ? 'Refreshing...' : '🔄 Refresh Live Stats'}
        </Button>
      </div>

      <Notice tone="info">
        <span>
          <strong>Live data:</strong> All traffic counts below are calculated in real time directly from anonymous <strong>"I'm using this room"</strong> check-ins.
        </span>
      </Notice>

      {error && (
        <Notice
          tone="error"
          action={<Button btnRef={retryRef} variant="secondary" onClick={reload}>Retry</Button>}
        >
          <span>{errorText(error)}</span>
        </Notice>
      )}

      {/* KPI Highlight Cards */}
      <div className="kpi-grid">
        <div className="kpi-card kpi-card-green">
          <span className="kpi-label">Students Active Now</span>
          <span className="kpi-num">{summary.total_active_users}</span>
          <span className="small-meta">People checked in across all rooms</span>
        </div>

        <div className="kpi-card kpi-card-lilac">
          <span className="kpi-label">Rooms in Use</span>
          <span className="kpi-num">{summary.rooms_in_use} <span style={{ fontSize: '1.25rem' }}>/ {summary.total_rooms}</span></span>
          <span className="small-meta">Classrooms currently occupied</span>
        </div>

        <div className="kpi-card kpi-card-yellow">
          <span className="kpi-label">Total Visits Recorded</span>
          <span className="kpi-num">{summary.total_checkins_all_time}</span>
          <span className="small-meta">All-time check-in sessions</span>
        </div>
      </div>

      {loading && !data && <Skeleton count={4} />}

      {rooms.length > 0 && (
        <>
          <p className="status-line" role="status">
            <span>{rooms.length} rooms tracked by live traffic</span>
            {loading && <Badge tone="yellow">Updating...</Badge>}
          </p>

          <ul className="grid" aria-busy={loading || undefined}>
            {rooms.map((room) => {
              const occPct = room.occupancy_pct || 0
              const segments = [
                { leftPct: 0, widthPct: occPct, tone: room.tone || (occPct > 60 ? 'red' : occPct > 25 ? 'yellow' : 'green') },
              ]

              return (
                <Card as="li" key={room.room_no} className="room-stat-card">
                  <div className="meta-row">
                    <h2 className="big-data">{room.room_no}</h2>
                    <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                      <Badge tone={room.tone || 'green'}>{room.label}</Badge>
                      <Badge tone="lilac">Block {room.block}</Badge>
                    </div>
                  </div>

                  <div className="stack-sm" style={{ marginTop: '0.75rem' }}>
                    <p className="big-line">
                      <strong>{room.active_count}</strong> of {room.capacity} seats in use ({occPct}%)
                    </p>
                    <Bar segments={segments} label={`${room.room_no} ${occPct}% occupied`} />
                    <div className="meta-row small-meta" style={{ marginTop: '0.25rem' }}>
                      <span>Total visits: <strong>{room.total_checkins}</strong></span>
                      <span>Unique people: <strong>{room.unique_visitors}</strong></span>
                    </div>
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
