import { useEffect, useState } from 'react'

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

const ERROR_COPY = {
  BAD_REQUEST: 'Check the highlighted fields.',
  UNAUTHORIZED: 'Log in again.',
  INVALID_CREDENTIALS: 'Wrong email or password.',
  EMAIL_TAKEN: 'That email is already registered. Log in instead.',
  SLOT_TAKEN: 'Someone just booked that period. Pick another.',
  INTERNAL: 'Something went wrong on our side. Try again.',
  NETWORK: "Can't reach the server. Check your connection and try again.",
}

export function errorText(err) {
  if (!err) return ''
  if (err.code === 'RESERVATION_REJECTED' && err.message) return err.message
  if (err.code && ERROR_COPY[err.code]) return ERROR_COPY[err.code]
  if (err.status >= 500) return ERROR_COPY.INTERNAL
  return err.message || ERROR_COPY.NETWORK
}

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

export async function request(path, { method = 'GET', body, token, signal } = {}) {
  const ctrl = new AbortController()
  let timedOut = false
  const onAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) ctrl.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, 8000)

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      const code = payload?.error?.code || (res.status >= 500 ? 'INTERNAL' : 'HTTP_ERROR')
      const message = payload?.error?.message || res.statusText || ERROR_COPY.INTERNAL
      throw new ApiError(res.status, code, message)
    }
    return payload
  } catch (err) {
    if (err instanceof ApiError) throw err
    if (err.name === 'AbortError' && !timedOut) throw err
    throw new ApiError(0, 'NETWORK', ERROR_COPY.NETWORK)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export function useApi(path, deps = [], { token, onUnauthorized } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false })
      return
    }
    const ctrl = new AbortController()
    setState((s) => ({ data: s.data, error: null, loading: true }))

    request(path, { token, signal: ctrl.signal })
      .then((data) => {
        if (!ctrl.signal.aborted) setState({ data, error: null, loading: false })
      })
      .catch((err) => {
        if (ctrl.signal.aborted || err.name === 'AbortError') return
        if (err.status === 401 && err.code !== 'INVALID_CREDENTIALS') onUnauthorized?.()
        setState((s) => ({ data: s.data, error: err, loading: false }))
      })

    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, token, tick, ...deps])

  return { ...state, reload: () => setTick((t) => t + 1) }
}
