import test from 'node:test'
import assert from 'node:assert/strict'
import { migrationDatabaseUrl, runMigrations } from '../src/migrate.ts'

test('prefers the dedicated migration database URL and keeps the single-role fallback', () => {
  assert.equal(migrationDatabaseUrl({ MIGRATION_DATABASE_URL: 'postgres://migrator/db', DATABASE_URL: 'postgres://app/db' }), 'postgres://migrator/db')
  assert.equal(migrationDatabaseUrl({ DATABASE_URL: 'postgres://app/db' }), 'postgres://app/db')
})

test('runs each migration atomically under a lock and releases its connection', async () => {
  const calls = []
  let released = false
  const pool = { connect: async () => ({
    query: async (sql, values) => {
      calls.push([sql, values])
      return { rows: sql === 'SELECT name FROM schema_migrations' ? [] : undefined }
    },
    release: () => { released = true },
  }) }
  await runMigrations(pool)
  assert.equal(calls[0][0], 'SELECT pg_advisory_lock($1::bigint)')
  assert.ok(calls.some(([sql]) => sql === 'BEGIN'))
  assert.ok(calls.some(([sql]) => sql === 'COMMIT'))
  assert.equal(calls.at(-1)[0], 'SELECT pg_advisory_unlock($1::bigint)')
  assert.equal(released, true)
})

test('rolls back a failed migration and releases its lock', async () => {
  const calls = []
  let released = false
  const pool = { connect: async () => ({
    query: async sql => {
      calls.push(sql)
      if (sql.includes('CREATE TABLE users')) throw new Error('migration failed')
      return { rows: [] }
    },
    release: () => { released = true },
  }) }
  await assert.rejects(runMigrations(pool), /migration failed/)
  assert.ok(calls.includes('ROLLBACK'))
  assert.ok(calls.includes('SELECT pg_advisory_unlock($1::bigint)'))
  assert.equal(released, true)
})
