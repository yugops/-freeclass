// Throwaway API tester. Every panel hits one endpoint and prints the raw response.
import { useState } from 'react'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body && JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

function Panel({ title, children, result }) {
  const isList = Array.isArray(result?.data)
  const aCount = isList ? result.data.filter(r => r?.block === 'A').length : 0
  const bCount = isList ? result.data.filter(r => r?.block === 'B').length : 0

  return (
    <section style={{ border: '1px solid #999', padding: 12, margin: '12px 0' }}>
      <h3 style={{ margin: '0 0 8px' }}>{title}</h3>
      {children}
      {result && (
        <div style={{ marginTop: 8 }}>
          {isList && (
            <div style={{ margin: '4px 0 8px', fontSize: 13, color: '#1a5f7a' }}>
              <strong>{result.data.length}</strong> rooms found
              {(aCount > 0 || bCount > 0) && (
                <span> ({aCount} Block A, {bCount} Block B)</span>
              )}
            </div>
          )}
          <pre style={{ background: '#f4f4f4', padding: 8, maxHeight: 420, overflow: 'auto' }}>
            {result.status} {JSON.stringify(result.data, null, 2)}
          </pre>
        </div>
      )}
    </section>
  )
}

export default function Tester() {
  const [day, setDay] = useState(1)
  const [time, setTime] = useState('13:00')
  const [block, setBlock] = useState('')
  const [charging, setCharging] = useState(false)
  const [name, setName] = useState('aijaz')
  const [auth, setAuth] = useState({ email: '', password: '', full_name: '' })
  const [token, setToken] = useState('')
  const [resv, setResv] = useState({ room_no: 'A-101', date: '2026-11-09', slot_no: 5 })
  const [out, setOut] = useState({})

  const run = (key, path, opts) => async () => {
    const r = await call(path, { ...opts, token })
    if (key === 'auth' && r.data?.token) setToken(r.data.token)
    setOut((o) => ({ ...o, [key]: r }))
  }
  const authField = (k, type = 'text') => (
    <input
      placeholder={k}
      type={type}
      value={auth[k]}
      onChange={(e) => setAuth({ ...auth, [k]: e.target.value })}
    />
  )
  const daySelect = (
    <select value={day} onChange={(e) => setDay(Number(e.target.value))}>
      {DAYS.map((d, i) => (
        <option key={d} value={i + 1}>{d}</option>
      ))}
    </select>
  )
  const blockSelect = (
    <select value={block} onChange={(e) => setBlock(e.target.value)}>
      <option value="">All Blocks</option>
      <option value="A">Block A</option>
      <option value="B">Block B</option>
    </select>
  )

  return (
    <div style={{ fontFamily: 'monospace', maxWidth: 760, margin: '0 auto', padding: 16 }}>
      <h1>#freeclass API tester</h1>

      <Panel title="GET /api/health" result={out.health}>
        <button onClick={run('health', '/health')}>send</button>
      </Panel>

      <Panel title="GET /api/free" result={out.free}>
        {daySelect}{' '}
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />{' '}
        {blockSelect}{' '}
        <label>
          <input type="checkbox" checked={charging} onChange={(e) => setCharging(e.target.checked)} />{' '}
          charging
        </label>{' '}
        <button onClick={run('free', `/free?day=${day}&time=${time}&charging=${charging}${block ? `&block=${block}` : ''}`)}>send</button>
      </Panel>

      <Panel title="GET /api/free-windows" result={out.windows}>
        {daySelect} {blockSelect}{' '}
        <label>
          <input type="checkbox" checked={charging} onChange={(e) => setCharging(e.target.checked)} />{' '}
          charging
        </label>{' '}
        <button onClick={run('windows', `/free-windows?day=${day}&charging=${charging}${block ? `&block=${block}` : ''}`)}>send</button>
      </Panel>

      <Panel title="GET /api/teacher" result={out.teacher}>
        <input value={name} onChange={(e) => setName(e.target.value)} /> {daySelect}{' '}
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />{' '}
        <button onClick={run('teacher', `/teacher?name=${encodeURIComponent(name)}&day=${day}&time=${time}`)}>
          send
        </button>
      </Panel>

      <Panel title="GET /api/utilisation" result={out.util}>
        <button onClick={run('util', '/utilisation')}>send</button>
      </Panel>

      <Panel title="GET /api/conflicts" result={out.conflicts}>
        <button onClick={run('conflicts', '/conflicts')}>send</button>
      </Panel>

      <Panel title={`POST /api/auth/register | login  (token: ${token ? 'set' : 'none'})`} result={out.auth}>
        {authField('email')} {authField('password', 'password')} {authField('full_name')}{' '}
        <button onClick={run('auth', '/auth/register', { method: 'POST', body: auth })}>register</button>{' '}
        <button onClick={run('auth', '/auth/login', { method: 'POST', body: auth })}>login</button>
      </Panel>

      <Panel title="POST /api/reservations (needs token)" result={out.resv}>
        <input value={resv.room_no} onChange={(e) => setResv({ ...resv, room_no: e.target.value })} />{' '}
        <input type="date" value={resv.date} onChange={(e) => setResv({ ...resv, date: e.target.value })} />{' '}
        <input
          type="number" min="1" max="8" value={resv.slot_no}
          onChange={(e) => setResv({ ...resv, slot_no: Number(e.target.value) })}
        />{' '}
        <button onClick={run('resv', '/reservations', { method: 'POST', body: resv })}>reserve</button>{' '}
        <button onClick={run('resv', '/reservations/mine')}>my reservations</button>
      </Panel>
    </div>
  )
}
