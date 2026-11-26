import { useRef, useState } from 'react'
import { errorText, request } from '../api.js'
import { Button, Card, Choice, Field, Notice } from '../ui.jsx'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validate(mode, vals) {
  const errs = {}
  const email = vals.email.trim()
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    errs.email = 'Enter a valid email address.'
  }
  if (vals.password.length < 8 || vals.password.length > 72) {
    errs.password = 'Password must be 8 to 72 characters.'
  }
  if (mode === 'register') {
    const name = vals.full_name.trim()
    if (name.length < 2 || name.length > 80) {
      errs.full_name = 'Enter your full name (2 to 80 characters).'
    }
  }
  return errs
}

export default function Account({ session, notice, onLogin, onLogout }) {
  const [mode, setMode] = useState('login')
  const [vals, setVals] = useState({ full_name: '', email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [apiError, setApiError] = useState('')

  const refs = {
    full_name: useRef(null),
    email: useRef(null),
    password: useRef(null),
  }

  if (session) {
    return (
      <div className="stack">
        <h1 tabIndex={-1}>Account</h1>
        <Card className="form-card">
          <h2>Signed in</h2>
          <div className="stack-sm">
            <p className="big-line">{session.user.full_name}</p>
            <p className="mono">{session.user.email}</p>
          </div>
          <div>
            <Button variant="danger" onClick={onLogout}>Log out</Button>
          </div>
        </Card>
      </div>
    )
  }

  const update = (key) => (e) => {
    const next = { ...vals, [key]: e.target.value }
    setVals(next)
    if (touched) setErrors(validate(mode, next))
  }

  const handleBlur = () => {
    if (touched) setErrors(validate(mode, vals))
  }

  const switchMode = (next) => {
    setMode(next)
    setErrors({})
    setTouched(false)
    setApiError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setTouched(true)
    setApiError('')
    const errs = validate(mode, vals)
    setErrors(errs)

    const order = mode === 'register' ? ['full_name', 'email', 'password'] : ['email', 'password']
    const firstBad = order.find((k) => errs[k])
    if (firstBad) {
      refs[firstBad].current?.focus()
      return
    }

    setBusy(true)
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register'
      const body = mode === 'login'
        ? { email: vals.email.trim(), password: vals.password }
        : { full_name: vals.full_name.trim(), email: vals.email.trim(), password: vals.password }
      const data = await request(path, { method: 'POST', body })
      onLogin(data)
    } catch (err) {
      setApiError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <h1 tabIndex={-1}>Account</h1>
      {notice && <Notice tone="warning" role="status"><span>{notice}</span></Notice>}

      <Card className="form-card">
        <form className="stack" onSubmit={handleSubmit} noValidate>
          <Choice
            legend="Action"
            name="auth-mode"
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'login', label: 'Log in' },
              { value: 'register', label: 'Register' },
            ]}
          />

          {mode === 'register' && (
            <Field id="acc-name" label="Full name" error={errors.full_name}>
              {(props) => (
                <input
                  {...props}
                  ref={refs.full_name}
                  className="input"
                  type="text"
                  autoComplete="name"
                  minLength={2}
                  maxLength={80}
                  value={vals.full_name}
                  onChange={update('full_name')}
                  onBlur={handleBlur}
                  required
                />
              )}
            </Field>
          )}

          <Field id="acc-email" label="Email" error={errors.email}>
            {(props) => (
              <input
                {...props}
                ref={refs.email}
                className="input"
                type="email"
                autoComplete="email"
                inputMode="email"
                maxLength={254}
                value={vals.email}
                onChange={update('email')}
                onBlur={handleBlur}
                required
              />
            )}
          </Field>

          <Field
            id="acc-password"
            label="Password"
            hint={mode === 'register' ? 'At least 8 characters.' : undefined}
            error={errors.password}
          >
            {(props) => (
              <div className="input-row">
                <input
                  {...props}
                  ref={refs.password}
                  className="input"
                  type={showPw ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  minLength={8}
                  maxLength={72}
                  value={vals.password}
                  onChange={update('password')}
                  onBlur={handleBlur}
                  required
                />
                <Button
                  variant="secondary"
                  aria-pressed={showPw}
                  onClick={() => setShowPw((s) => !s)}
                >
                  {showPw ? 'Hide password' : 'Show password'}
                </Button>
              </div>
            )}
          </Field>

          {apiError && <Notice tone="error"><span>{apiError}</span></Notice>}

          <div>
            <Button type="submit" variant="primary" busy={busy}>
              {mode === 'login' ? 'Log in' : 'Create account'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
