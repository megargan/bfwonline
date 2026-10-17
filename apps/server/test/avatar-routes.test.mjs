import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import sharp from 'sharp'
import { registerAvatarRoutes } from '../src/avatar-routes.ts'

const userId = 'cbb12d80-4d06-4401-aee6-3fe905e626f0'
const origin = 'http://localhost:5173'

function setup() {
  const pool = { version: 0, body: null, failCommit: false }
  pool.query = async (sql, values = []) => {
    if (sql.startsWith('SELECT u.avatar_version,a.body')) return values[0] === userId ? { rows: [{ avatar_version: pool.version, body: pool.body }] } : { rows: [] }
    throw new Error(`unexpected query: ${sql}`)
  }
  pool.connect = async () => {
    let version = pool.version
    let body = pool.body
    return {
      async query(sql, values = []) {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] }
        if (sql.startsWith('INSERT INTO user_avatars')) { body = values[1]; return { rows: [] } }
        if (sql.startsWith('DELETE FROM user_avatars')) { body = null; return { rows: [] } }
        if (sql.startsWith('UPDATE users SET avatar_version')) { version++; return { rows: [{ avatar_version: version }] } }
        if (sql === 'COMMIT') {
          if (pool.failCommit) throw new Error('commit failed')
          pool.version = version; pool.body = body
          return { rows: [] }
        }
        throw new Error(`unexpected transaction query: ${sql}`)
      },
      release() {},
    }
  }
  const app = Fastify()
  app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
  app.decorateRequest('authSession', undefined)
  const loadSession = async request => { request.authSession = { user_id: userId, csrf_token: 'csrf' } }
  registerAvatarRoutes(app, pool, origin, loadSession)
  return { app, pool }
}

async function upload(app, contents, filename = 'avatar.png') {
  const boundary = 'bfw-avatar-boundary'
  const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`)
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`)
  return app.inject({
    method: 'PUT', url: '/api/v1/me/avatar',
    headers: { origin, 'x-csrf-token': 'csrf', 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([header, contents, footer]),
  })
}

test('stores only normalized WebP and serves versioned cacheable avatars', async t => {
  const { app, pool } = setup()
  t.after(() => app.close())
  const input = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#168aad' } }).png().toBuffer()
  const saved = await upload(app, input)
  assert.equal(saved.statusCode, 200)
  assert.deepEqual(saved.json(), { avatarUrl: `/api/v1/users/${userId}/avatar?v=1`, avatarVersion: 1 })
  assert.equal((await sharp(pool.body).metadata()).format, 'webp')

  const served = await app.inject({ method: 'GET', url: `/api/v1/users/${userId}/avatar?v=1` })
  assert.equal(served.statusCode, 200)
  assert.equal(served.headers['content-type'], 'image/webp')
  assert.equal(served.headers['x-content-type-options'], 'nosniff')
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/users/${userId}/avatar?v=0` })).headers.location, `/api/v1/users/${userId}/avatar?v=1`)
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/users/${userId}/avatar?v=1`, headers: { 'if-none-match': served.headers.etag } })).statusCode, 304)

  const deleted = await app.inject({ method: 'DELETE', url: '/api/v1/me/avatar', headers: { origin, 'x-csrf-token': 'csrf' } })
  assert.equal(deleted.statusCode, 204)
  assert.equal(pool.version, 2)
  assert.equal(pool.body, null)
})

test('bad uploads and failed replacement preserve the prior avatar', async t => {
  const { app, pool } = setup()
  t.after(() => app.close())
  const input = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#f00' } }).png().toBuffer()
  assert.equal((await upload(app, input)).statusCode, 200)
  const previous = pool.body
  assert.equal((await upload(app, Buffer.from('<svg></svg>'), 'avatar.svg')).statusCode, 415)
  pool.failCommit = true
  assert.equal((await upload(app, input)).statusCode, 503)
  assert.equal(pool.body, previous)
  assert.equal(pool.version, 1)
})
