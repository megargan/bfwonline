import test from 'node:test'
import assert from 'node:assert/strict'
import { Pool } from 'pg'
import { runMigrations } from '../src/migrate.ts'

const connectionString = process.env.BFW_TEST_DATABASE_URL

test('fresh PostgreSQL accepts migrations once and a second run is a no-op', { skip: !connectionString }, async t => {
  const pool = new Pool({ connectionString })
  t.after(() => pool.end())

  await runMigrations(pool)
  await runMigrations(pool)

  const migrations = await pool.query('SELECT name FROM schema_migrations ORDER BY name')
  assert.deepEqual(migrations.rows.map(row => row.name), ['001_initial.sql'])

  const requiredTables = await pool.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name`)
  assert.deepEqual(requiredTables.rows.map(row => row.table_name), [
    'cards', 'deck_cards', 'decks', 'match_commands', 'match_players', 'matches', 'schema_migrations',
    'user_avatars', 'user_sessions', 'users',
  ])
})
