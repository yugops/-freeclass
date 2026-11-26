export class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const validate = (schema, source) => (req, _res, next) => {
  const result = schema.safeParse(req[source])
  if (!result.success) {
    return next(new HttpError(400, 'BAD_REQUEST', result.error.issues?.[0]?.message || 'Validation failed'))
  }
  req.valid = result.data
  next()
}

export const errorHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message },
    })
  }

  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: { code: 'BAD_REQUEST', message: err.issues?.[0]?.message || 'Validation failed' },
    })
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' },
    })
  }

  if (err.code === '23505') {
    if (err.constraint === 'ux_res_active') {
      return res.status(409).json({
        error: { code: 'SLOT_TAKEN', message: 'This slot has already been reserved' },
      })
    }
    if (err.constraint?.includes('app_user') || err.detail?.includes('email')) {
      return res.status(409).json({
        error: { code: 'EMAIL_TAKEN', message: 'Email is already registered' },
      })
    }
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'Resource already exists' },
    })
  }

  if (err.code === 'P0001') {
    return res.status(422).json({
      error: { code: 'RESERVATION_REJECTED', message: err.message },
    })
  }

  console.error(err)
  return res.status(500).json({
    error: { code: 'INTERNAL', message: 'Internal server error' },
  })
}
