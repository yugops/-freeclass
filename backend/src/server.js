import { app } from './app.js'
import { config } from './config.js'
import { pool } from './db.js'

const server = app.listen(config.PORT, () => {
  console.log(`Server listening on port ${config.PORT}`)
})

const shutdown = async () => {
  server.close(async () => {
    await pool.end()
    process.exit(0)
  })
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
