import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.ts'

function fakePool({ duplicate = false } = {}) {
  const sessions = new Map()
  const seededDecks = []
  const pool = {
    seededDecks,
    query: async (sql, values = []) => {
      if (sql.startsWith('UPDATE users SET display_name')) {
        pool.user.display_name = values[1]
        return { rows: [{ id: values[0], username: pool.user.username, display_name: values[1], avatar_version: pool.user.avatar_version ?? 0 }] }
      }
      if (sql.includes('FROM user_sessions')) {
        const session = [...sessions.values()].find(item => item.tokenHash.equals(values[0]))
        return { rows: session ? [{ ...session, has_avatar: false, expires_at: new Date(Date.now() + 1000) }] : [] }
      }
      if (sql.includes('FROM users')) return { rows: [] }
      if (sql.startsWith('UPDATE user_sessions')) return { rows: [] }
      throw new Error(`unexpected pool query: ${sql}`)
    },
    connect: async () => ({
      query: async (sql, values = []) => {
        if (sql.startsWith('INSERT INTO decks')) seededDecks.push(values[2])
        if (sql.startsWith('INSERT INTO users')) {
          if (duplicate || pool.user?.username === values[1]) throw Object.assign(new Error('duplicate'), { code: '23505', constraint: 'users_username_key' })
          pool.user = { id: values[0], username: values[1], display_name: values[2], avatar_version: 0 }
          return { rows: [] }
        }
        if (sql.startsWith('INSERT INTO user_sessions')) {
          sessions.set(values[2].toString('hex'), {
            id: values[0], user_id: values[1], tokenHash: values[2], csrf_token: values[3],
            username: pool.user.username, display_name: pool.user.display_name, avatar_version: pool.user.avatar_version,
          })
          return { rows: [] }
        }
        return { rows: [] }
      },
      release() {},
    }),
  }
  return pool
}

test('registration creates a session cookie and me exposes only the profile', async t => {
  const pool = fakePool()
  const app = buildApp({ pool, appOrigin: 'http://localhost:5173' })
  t.after(() => app.close())
  const registration = await app.inject({
    method: 'POST', url: '/api/v1/auth/register',
    headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
    payload: { username: 'Player_1', password: 'a long secure password' },
  })
  assert.equal(registration.statusCode, 201)
  assert.match(registration.json().user.id, /^[0-9a-f-]{36}$/)
  assert.deepEqual({ username: registration.json().user.username, displayName: registration.json().user.displayName }, { username: 'player_1', displayName: 'player_1' })
  assert.match(registration.headers['set-cookie'], /^bfw_session_dev=/)
  assert.equal(registration.json().csrfToken.length, 43)
  assert.deepEqual(pool.seededDecks, ['Передовая', 'Контроль поля', 'Ресурсный прорыв'])

  const cookie = registration.headers['set-cookie'].split(';')[0]
  const profile = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })
  assert.equal(profile.statusCode, 200)
  assert.deepEqual(profile.json().user, registration.json().user)
  assert.equal(JSON.stringify(profile.json()).includes('password'), false)

  const changed = await app.inject({
    method: 'PATCH', url: '/api/v1/me',
    headers: { cookie, origin: 'http://localhost:5173', 'x-csrf-token': registration.json().csrfToken, 'content-type': 'application/json' },
    payload: { displayName: 'Лесной маг' },
  })
  assert.equal(changed.statusCode, 200)
  assert.equal(changed.json().user.displayName, 'Лесной маг')

  const renameLogin = await app.inject({
    method: 'PATCH', url: '/api/v1/me',
    headers: { cookie, origin: 'http://localhost:5173', 'x-csrf-token': registration.json().csrfToken, 'content-type': 'application/json' },
    payload: { username: 'attacker' },
  })
  assert.equal(renameLogin.statusCode, 400)
  assert.deepEqual(renameLogin.json(), { error: 'INVALID_INPUT' })

  const roomWithoutSocket = await app.inject({
    method: 'POST', url: '/api/v1/rooms',
    headers: { cookie, origin: 'http://localhost:5173', 'x-csrf-token': registration.json().csrfToken },
  })
  assert.equal(roomWithoutSocket.statusCode, 409)
  assert.deepEqual(roomWithoutSocket.json(), { error: 'PLAYER_OFFLINE' })
})

test('registration maps only the username unique constraint to conflict', async t => {
  const app = buildApp({ pool: fakePool({ duplicate: true }), appOrigin: 'http://localhost:5173' })
  t.after(() => app.close())
  const response = await app.inject({
    method: 'POST', url: '/api/v1/auth/register',
    headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
    payload: { username: 'player1', password: 'a long secure password' },
  })
  assert.equal(response.statusCode, 409)
  assert.deepEqual(response.json(), { error: 'USERNAME_TAKEN' })
})

test('concurrent registrations of the same normalized login produce one account', async t => {
  const app = buildApp({ pool: fakePool(), appOrigin: 'http://localhost:5173' })
  t.after(() => app.close())
  const register = username => app.inject({
    method: 'POST', url: '/api/v1/auth/register',
    headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
    payload: { username, password: 'a long secure password' },
  })

  const responses = await Promise.all([register('Player_1'), register(' player_1 ')])
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [201, 409])
  assert.equal(responses.find(response => response.statusCode === 409).json().error, 'USERNAME_TAKEN')
})

test('login rate limit is keyed by normalized username', async t => {
  const app = buildApp({ pool: fakePool(), appOrigin: 'http://localhost:5173' })
  t.after(() => app.close())
  const login = username => app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
    payload: { username, password: 'a long secure password' },
  })

  const responses = []
  for (const username of ['Player_1', ' player_1 ', 'PLAYER_1', 'player_1', 'player_1', 'player_1']) responses.push(await login(username))
  assert.deepEqual(responses.slice(0, 5).map(response => response.statusCode), [401, 401, 401, 401, 401])
  assert.equal(responses[5].statusCode, 429)
  assert.deepEqual(responses[5].json(), { error: 'RATE_LIMITED' })
})
