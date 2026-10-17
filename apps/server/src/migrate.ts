import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

type MigrationClient = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows?: { name: string }[] }>
  release: () => void
}
type MigrationPool = { connect: () => Promise<MigrationClient> }

const MIGRATION_DIR = join(dirname(fileURLToPath(import.meta.url)), '../migrations')
const LOCK_ID = '4242123401'

export const migrationDatabaseUrl = (env: Record<string, string | undefined>) => env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL

export async function runMigrations(pool: MigrationPool, directory = MIGRATION_DIR) {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [LOCK_ID])
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows?.map(row => row.name) ?? [])
    const files = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort()
    for (const name of files) {
      if (applied.has(name)) continue
      const sql = await readFile(join(directory, name), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1::bigint)', [LOCK_ID]) }
    finally { client.release() }
  }
}
