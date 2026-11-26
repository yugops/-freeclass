import { Component, useEffect, useRef, useState } from 'react'
import { errorText, useApi } from './api.js'
import { formatShortDate } from './time.js'
import { Badge, Button, Notice, Skeleton } from './ui.jsx'
import Find from './pages/Find.jsx'
import Timeline from './pages/Timeline.jsx'
import Teacher from './pages/Teacher.jsx'
import Stats from './pages/Stats.jsx'
import Mine from './pages/Mine.jsx'
import Tester from './debug/Tester.jsx'

const NAV_ITEMS = [
  { id: 'find', label: 'Find rooms', title: 'Find rooms' },
  { id: 'timeline', label: 'Timeline', title: 'Timeline' },
  { id: 'teacher', label: 'Teachers', title: 'Teachers' },
  { id: 'stats', label: 'Stats', title: 'Stats' },
  { id: 'mine', label: 'Bookings', title: 'Bookings' },
]

const ACTIVE_ROUTES = new Set(['find', 'timeline', 'teacher', 'stats', 'mine', 'debug'])

function parseRoute(hash) {
  const clean = (hash || '').replace(/^#/, '')
  return ACTIVE_ROUTES.has(clean) ? clean : 'find'
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
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
  } else if (route === 'stats') {
    body = <Stats />
  } else if (route === 'mine') {
    body = <Mine />
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

      <main id="main" ref={mainRef} tabIndex={-1} className="container main">
        {body}
      </main>

      <footer className="site-footer">
        <div className="container">
          <p>Only rooms with timetable data are listed. A room that is missing is unknown, not busy.</p>
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
