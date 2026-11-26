import pg from 'pg'
import { config } from './config.js'

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  statement_timeout: 5000,
})

export const query = (text, params) => pool.query(text, params)
