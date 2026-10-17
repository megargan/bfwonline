import { Pool } from 'pg'
import { buildApp } from './app.ts'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
if (!process.env.APP_ORIGIN) throw new Error('APP_ORIGIN is required')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const app = buildApp({ pool, appOrigin: process.env.APP_ORIGIN })

try {
  await pool.query(`UPDATE matches SET status='aborted', ended_at=now(), end_reason='server_restart', state_json=NULL WHERE status='active'`)
  await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 3000) })
} catch (error) {
  app.log.error(error)
  await pool.end()
  process.exitCode = 1
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close()
    await pool.end()
  })
}
