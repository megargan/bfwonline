import { Pool } from 'pg'
import { migrationDatabaseUrl, runMigrations } from './migrate.ts'
import { seedCards } from './seed-cards.ts'

const migrationUrl = migrationDatabaseUrl(process.env)
if (!migrationUrl) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required')
const pool = new Pool({ connectionString: migrationUrl })
try {
  await runMigrations(pool)
  await seedCards(pool)
} finally {
  await pool.end()
}
