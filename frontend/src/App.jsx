import { Component, useEffect, useRef, useState } from 'react'
import { errorText, useApi } from './api.js'
import { formatShortDate } from './time.js'
import { Badge, Button, Card, Notice, Skeleton } from './ui.jsx'
import Find from './pages/Find.jsx'
import Timeline from './pages/Timeline.jsx'
import Teacher from './pages/Teacher.jsx'
import Tester from './debug/Tester.jsx'

const NAV_ITEMS = [
  { id: 'find', label: 'Find rooms', title: 'Find rooms' },
  { id: 'timeline', label: 'Timeline', title: 'Timeline' },
  { id: 'teacher', label: 'Teachers', title: 'Teachers' },
]

const ACTIVE_ROUTES = new Set(['find', 'timeline', 'teacher', 'debug'])

function parseRoute(hash) {
  const clean = (hash || '').replace(/^#/, '')
  if (!clean || clean === 'main') return 'find'
  return ACTIVE_ROUTES.has(clean) ? clean : '404'
}

function NotFound() {
  return (
    <Card as="section" style={{ textAlign: 'center', padding: '3.5rem 1.5rem', marginBlock: '1rem' }}>
      <div className="stack" style={{ alignItems: 'center', gap: '1.25rem' }}>
        <Badge tone="pink" style={{ fontSize: '1rem', padding: '0.35rem 0.75rem' }}>
          404 · PAGE NOT FOUND
        </Badge>
        <h1 style={{ fontSize: 'clamp(2.5rem, 8vw, 4.5rem)', lineHeight: 1 }}>
          LOST IN THE CORRIDORS?
        </h1>
        <p style={{ fontSize: '1.125rem', maxWidth: '32rem', fontWeight: 600 }}>
          The room, timetable, or page you are looking for does not exist or has been moved.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'center', marginTop: '0.5rem' }}>
          <a href="#find" className="btn btn-primary">Find Free Rooms</a>
          <a href="#timeline" className="btn btn-secondary">View Timeline</a>
        </div>
      </div>
    </Card>
  )
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Unhandled UI Error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="container main">
          <h1>#freeclass</h1>
          <Notice
            tone="error"
            action={
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Reload
              </Button>
            }
          >
            <span>Something broke. Reload the page.</span>
          </Notice>
        </main>
      )
    }
    return this.props.children
  }
}

function Shell() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  const [disclaimerOpen, setDisclaimerOpen] = useState(false)
  const [disclaimerDismissed, setDisclaimerDismissed] = useState(false)

  const mainRef = useRef(null)
  const retryRef = useRef(null)
  const mountedRef = useRef(false)

  const term = useApi('/term', [])
  const slots = useApi('/slots', [])

  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === '#main') return
      setRoute(parseRoute(window.location.hash))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const meta = NAV_ITEMS.find((n) => n.id === route)
    const label = route === 'debug' ? 'Debug' : meta?.title || 'Find rooms'
    document.title = `${label} · #freeclass`

    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    const h1 = mainRef.current?.querySelector('h1')
    if (h1) h1.focus()
  }, [route])

  const startupError = term.error && term.error.status !== 404 ? term.error : slots.error
  useEffect(() => {
    if (startupError && retryRef.current) retryRef.current.focus()
  }, [startupError])

  const termText = term.data
    ? `${term.data.name} · ${formatShortDate(term.data.starts_on)} to ${formatShortDate(term.data.ends_on)}`
    : null
  const routeTitle = NAV_ITEMS.find((n) => n.id === route)?.title || 'Find rooms'

  let body
  if (route === 'debug') {
    body = <Tester />
  } else if (term.loading || slots.loading) {
    body = (
      <div className="stack">
        <h1 tabIndex={-1}>{routeTitle}</h1>
        <Skeleton count={3} />
      </div>
    )
  } else if (term.error?.status === 404) {
    body = (
      <div className="stack">
        <h1 tabIndex={-1}>{routeTitle}</h1>
        <Notice tone="info"><span>No timetable is loaded yet.</span></Notice>
      </div>
    )
  } else if (startupError) {
    body = (
      <div className="stack">
        <h1 tabIndex={-1}>{routeTitle}</h1>
        <Notice
          tone="error"
          action={
            <Button
              btnRef={retryRef}
              variant="secondary"
              onClick={() => {
                term.reload()
                slots.reload()
              }}
            >
              Retry
            </Button>
          }
        >
          <span>{errorText(startupError)}</span>
        </Notice>
      </div>
    )
  } else if (route === 'find') {
    body = (
      <Find
        term={term.data}
        slots={slots.data || []}
      />
    )
  } else if (route === 'timeline') {
    body = <Timeline slots={slots.data || []} />
  } else if (route === 'teacher') {
    body = <Teacher />
  } else if (route === '404') {
    body = <NotFound />
  }

  return (
    <div className="shell">
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault()
          mainRef.current?.focus()
        }}
      >
        Skip to content
      </a>

      <header className="site-header">
        <div className="container">
          <div className="header-top">
            <a className="wordmark" href="#find">#freeclass</a>
            {termText && <Badge tone="pink">{termText}</Badge>}
          </div>

          <nav aria-label="Main" className="nav-grid">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="nav-link"
                aria-current={route === item.id ? 'page' : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      {!disclaimerDismissed && (
        <div className="container" style={{ paddingTop: '1rem' }}>
          <Notice
            tone="error"
            action={
              <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
                <Button
                  variant="secondary"
                  onClick={() => setDisclaimerOpen(!disclaimerOpen)}
                  aria-expanded={disclaimerOpen}
                >
                  {disclaimerOpen ? 'Hide ▴' : 'Expand ▾'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setDisclaimerDismissed(true)}
                  aria-label="Dismiss disclaimer"
                >
                  ✕
                </Button>
              </div>
            }
          >
            <div>
              <strong>⚠️ Disclaimer:</strong> Data sourced from classroom gate timetables.
              {disclaimerOpen && (
                <p style={{ marginTop: '0.375rem', fontSize: '0.875rem', fontWeight: 600 }}>
                  Timetable data has been transcribed from physical paper schedules pasted on classroom gates and doors. It may not always be true or reflect real-time teacher adjustments, cancellations, or unscheduled room occupancy.
                </p>
              )}
            </div>
          </Notice>
        </div>
      )}

      <main id="main" ref={mainRef} tabIndex={-1} className="container main">
        {body}
      </main>

      <footer className="site-footer">
        <div className="container" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.875rem' }}>
          <p style={{ margin: 0, fontWeight: 600 }}>
            Only rooms with timetable data are listed. A missing room is unknown, not busy.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap', fontWeight: 800, fontSize: '0.9375rem' }}>
            <span>Made by <strong>Yug</strong> &amp; <strong>Rohan</strong></span>
            <span>·</span>
            <a
              href="https://instagram.com/yugishuman"
              target="_blank"
              rel="noopener noreferrer"
              className="badge badge-pink"
              style={{ textDecoration: 'none', color: 'var(--ink)' }}
            >
              📸 @yugishuman
            </a>
            <a
              href="https://github.com/yugops"
              target="_blank"
              rel="noopener noreferrer"
              className="badge badge-yellow"
              style={{ textDecoration: 'none', color: 'var(--ink)' }}
            >
              🐙 @yugops
            </a>
            <a
              href="https://instagram.com/__rohanvashisth"
              target="_blank"
              rel="noopener noreferrer"
              className="badge badge-pink"
              style={{ textDecoration: 'none', color: 'var(--ink)' }}
            >
              📸 @__rohanvashisth
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <Shell />
    </ErrorBoundary>
  )
}
