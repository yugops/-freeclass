import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

// If running in an environment where .env exists (e.g. local dev), load it
const envPath = path.resolve(process.cwd(), '.env')
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath)
  } catch (_) {}
}

const envSchema = z.object({
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  CORS_ORIGIN: z.string().default('*'),
})

export const config = envSchema.parse(process.env)
