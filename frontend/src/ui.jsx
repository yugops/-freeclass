export function Button({
  variant = 'secondary',
  type = 'button',
  busy = false,
  disabled = false,
  btnRef,
  children,
  ...rest
}) {
  return (
    <button
      ref={btnRef}
      type={type}
      className={`btn btn-${variant}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? 'Working...' : children}
    </button>
  )
}

export function Card({ as: Tag = 'section', className = '', children }) {
  return <Tag className={`card ${className}`.trim()}>{children}</Tag>
}

export function Notice({ tone = 'info', action, noticeRef, role, children, id }) {
  const liveRole = role ?? (tone === 'error' ? 'alert' : tone === 'success' ? 'status' : undefined)
  return (
    <div id={id} ref={noticeRef} tabIndex={noticeRef ? -1 : undefined} role={liveRole} className={`notice notice-${tone}`}>
      <div className="stack-sm">{children}</div>
      {action}
    </div>
  )
}

export function Field({ id, label, hint, error, children }) {
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? 'true' : undefined,
      })}
      {hint && <p id={hintId} className="field-hint">{hint}</p>}
      {error && (
        <Notice id={errId} tone="error">
          <span>{error}</span>
        </Notice>
      )}
    </div>
  )
}

export function Choice({ legend, name, value, onChange, options }) {
  return (
    <fieldset className="choice-set">
      <legend className="choice-legend">{legend}</legend>
      <div className="choice-list">
        {options.map((opt) => {
          const optId = `${name}-${opt.value}`
          return (
            <div key={opt.value} className="choice-item">
              <input
                className="choice-input"
                type="radio"
                id={optId}
                name={name}
                value={opt.value}
                checked={value === opt.value}
                onChange={() => onChange(opt.value)}
              />
              <label className="choice-label" htmlFor={optId}>{opt.label}</label>
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}

export function Check({ id, label, checked, onChange, disabled }) {
  return (
    <label className="check-wrap" htmlFor={id}>
      <input
        id={id}
        className="check-input"
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span>{label}</span>
    </label>
  )
}

export function Badge({ tone = 'paper', strike = false, children }) {
  return (
    <span className={`badge badge-${tone}${strike ? ' strike' : ''}`}>
      {children}
    </span>
  )
}

export function Bar({ segments, label }) {
  return (
    <div className="bar-track" role="img" aria-label={label}>
      {segments.map((seg, i) => (
        <div
          key={i}
          className={`bar-seg${seg.tone ? ` bar-seg-${seg.tone}` : ''}`}
          style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%` }}
        />
      ))}
    </div>
  )
}

export function Skeleton({ count = 3, label = 'Loading' }) {
  return (
    <div className="grid" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-box hatch" aria-hidden="true" />
      ))}
    </div>
  )
}

export function Empty({ children, action }) {
  return (
    <Notice tone="info" action={action}>
      <span>{children}</span>
    </Notice>
  )
}
