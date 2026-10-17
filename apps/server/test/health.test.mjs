import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.ts'

test('live health stays available independently of PostgreSQL', async t => {
  const app = buildApp({ pool: { query: async () => { throw new Error('database unavailable') } } })
  t.after(() => app.close())

  const response = await app.inject('/health/live')
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { status: 'ok' })
})

test('ready health requires a working PostgreSQL connection', async t => {
  const app = buildApp({ pool: { query: async () => { throw new Error('database unavailable') } } })
  t.after(() => app.close())

  const response = await app.inject('/health/ready')
  assert.equal(response.statusCode, 503)
  assert.deepEqual(response.json(), { status: 'unavailable' })
})

test('ready health waits until the initial schema migration has been applied', async t => {
  const app = buildApp({ pool: { query: async () => ({ rows: [] }) } })
  t.after(() => app.close())
  const response = await app.inject('/health/ready')
  assert.equal(response.statusCode, 503)
})

test('cards are public and exclude cards still in development', async t => {
  const app = buildApp({ pool: { query: async () => { throw new Error('database must not be queried') } } })
  t.after(() => app.close())
  const response = await app.inject('/api/v1/cards')
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().cards.length, 209)
  assert.ok(response.json().cards.some(card => card.Name === 'Салюбра'))
  assert.ok(response.json().cards.some(card => card.Name === 'Янгуша'))
  assert.ok(response.json().cards.some(card => card.Name === 'Жёлтый'))
  assert.ok(response.headers.etag)
})

test('private deck listing requires a session before it queries PostgreSQL', async t => {
  let queried = false
  const app = buildApp({ pool: { query: async () => { queried = true; return { rows: [] } } } })
  t.after(() => app.close())
  const response = await app.inject('/api/v1/decks')
  assert.equal(response.statusCode, 401)
  assert.equal(queried, false)
})

test('WebSocket handshake rejects a foreign Origin before session lookup', async t => {
  let queried = false
  const app = buildApp({ pool: { query: async () => { queried = true; return { rows: [] } } } })
  t.after(() => app.close())
  const response = await app.inject({ url: '/ws', headers: { origin: 'https://attacker.example' } })
  assert.equal(response.statusCode, 403)
  assert.equal(queried, false)
})

test('WebSocket handshake requires a valid cookie session on the allowed Origin', async t => {
  const app = buildApp({ pool: { query: async () => ({ rows: [] }) } })
  t.after(() => app.close())
  const response = await app.inject({ url: '/ws', headers: { origin: 'http://localhost:5173' } })
  assert.equal(response.statusCode, 401)
})

test('WebSocket upgrade runs its authentication hook before the handler', async t => {
  const origin = 'http://localhost:5173'
  const app = buildApp({ pool: { query: async () => ({ rows: [] }) }, appOrigin: origin })
  t.after(() => app.close())
  await app.ready()
  await assert.rejects(app.injectWS('/ws', { headers: { origin } }), /Unexpected server response: 401/u)
})

test('registration rejects a missing or foreign Origin before touching the database', async t => {
  let queried = false
  const app = buildApp({ pool: { query: async () => { queried = true; throw new Error('unexpected query') } } })
  t.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
    payload: { username: 'player1', displayName: 'Player', password: 'a secure password' },
  })
  assert.equal(response.statusCode, 403)
  assert.equal(queried, false)
})
