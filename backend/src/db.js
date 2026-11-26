import pg from 'pg'
import { config } from './config.js'

const isLocal = config.DATABASE_URL.includes('localhost') || config.DATABASE_URL.includes('127.0.0.1')

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  statement_timeout: 5000,
  ssl: isLocal ? false : { rejectUnauthorized: false },
})

export const query = (text, params) => pool.query(text, params)
