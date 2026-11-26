export const DAYS = [
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
]

const pad2 = (n) => String(n).padStart(2, '0')

export function hhmm(str) {
  return str ? str.slice(0, 5) : ''
}

export function toMin(str) {
  if (!str) return 0
  const [h, m] = str.split(':').map(Number)
  return h * 60 + m
}

function fromLocalDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function parseYMD(str) {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function localToday(now = new Date()) {
  return fromLocalDate(now)
}

export function localNow(now = new Date()) {
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
}

export function isWeekend(now = new Date()) {
  const d = now.getDay()
  return d === 0 || d === 6
}

export function defaultDay(now = new Date()) {
  const d = now.getDay()
  return d >= 1 && d <= 5 ? d : 1
}

export function dayName(dayNo, form = 'short') {
  return DAYS.find((d) => d.value === dayNo)?.[form] || ''
}

export function dayOfDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return 0
  return parseYMD(ymd).getDay()
}

export function dateForDay(dayNo, min, max) {
  if (!min || !max || min > max) return null
  const cur = parseYMD(min)
  const delta = (dayNo - cur.getDay() + 7) % 7
  cur.setDate(cur.getDate() + delta)
  const out = fromLocalDate(cur)
  return out <= max ? out : null
}

export function slotForTime(slots, timeStr) {
  if (!slots?.length || !timeStr) return null
  const t = toMin(timeStr)
  return slots.find((s) => toMin(s.start_time) <= t && t < toMin(s.end_time)) || null
}

const fullDateFmt = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

const shortDateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
})

export function formatDate(ymd) {
  if (!ymd) return ''
  return fullDateFmt.format(parseYMD(ymd))
}

export function formatShortDate(ymd) {
  if (!ymd) return ''
  return shortDateFmt.format(parseYMD(ymd))
}
