import { createHash, randomBytes, randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Pool } from 'pg'
import { cardCatalog, STARTER_DECKS } from '@bfw/game-data'
import { normalizeDisplayName, normalizeUsername, validPassword } from './auth-input.ts'
import { registerDeckRoutes } from './deck-routes.ts'
import { registerRoomRoutes } from './room-routes.ts'
import { registerRealtime } from './realtime.ts'
import { RoomManager } from './room-manager.ts'
import { RoomTransport } from './room-transport.ts'
import { avatarUrl, registerAvatarRoutes } from './avatar-routes.ts'

const SESSION_MS = 30 * 24 * 60 * 60 * 1000
const HASH_OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const
const DUMMY_PASSWORD = randomBytes(32).toString('hex')
const DUMMY_HASH = await argon2.hash(DUMMY_PASSWORD, HASH_OPTIONS)
const loginBuckets = new Map<string, number[]>()
let hashesInFlight = 0
const hashQueue: Array<() => void> = []

async function withArgon<T>(operation: () => Promise<T>): Promise<T> {
  if (hashesInFlight >= 2) {
    if (hashQueue.length >= 10) throw new Error('HASH_CAPACITY')
    await new Promise<void>(resolve => hashQueue.push(resolve))
  }
  hashesInFlight++
  try { return await operation() }
  finally {
    hashesInFlight--
    hashQueue.shift()?.()
  }
}
const hashPassword = (password: string) => withArgon(() => argon2.hash(password, HASH_OPTIONS))

function rateLimited(key: string, max: number, windowMs: number) {
  const now = Date.now()
  if (loginBuckets.size > 10_000) {
    for (const [bucket, times] of loginBuckets) {
      if (times.at(-1)! <= now - windowMs) loginBuckets.delete(bucket)
      if (loginBuckets.size <= 10_000) break
    }
    while (loginBuckets.size > 10_000) loginBuckets.delete(loginBuckets.keys().next().value!)
  }
  const hits = (loginBuckets.get(key) ?? []).filter(time => now - time < windowMs)
  if (hits.length >= max) return true
  hits.push(now)
  loginBuckets.set(key, hits)
  return false
}

function digest(token: string) { return createHash('sha256').update(token).digest() }
export function sessionCookieName(origin: string) { return origin.startsWith('https://') ? '__Host-bfw_session' : 'bfw_session_dev' }
function setSessionCookie(reply: FastifyReply, origin: string, token: string) {
  reply.setCookie(sessionCookieName(origin), token, {
    httpOnly: true, secure: origin.startsWith('https://'), sameSite: 'lax', path: '/', maxAge: SESSION_MS / 1000,
  })
}
function jsonObject(body: unknown): body is Record<string, unknown> { return !!body && typeof body === 'object' && !Array.isArray(body) }
function hasOrigin(request: FastifyRequest, origin: string) { return request.headers.origin === origin }
function csrfMatches(request: FastifyRequest, token: string) { return request.headers['x-csrf-token'] === token }

export type Session = { id: string; user_id: string; csrf_token: string; username: string; display_name: string; avatar_version: number; has_avatar: boolean }
declare module 'fastify' {
  interface FastifyRequest { authSession?: Session }
}

export async function lookupSession(pool: Pool, token: string) {
  const { rows } = await pool.query<Session & { expires_at: Date }>(
    `SELECT s.id, s.user_id, s.csrf_token, s.expires_at, u.username, u.display_name, u.avatar_version,
     EXISTS(SELECT 1 FROM user_avatars a WHERE a.user_id=u.id) AS has_avatar
     FROM user_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`, [digest(token)],
  )
  return rows[0] ?? null
}

export function registerAuthRoutes(app: FastifyInstance, pool: Pool, appOrigin: string) {
  const sessionName = sessionCookieName(appOrigin)
  const rooms = new RoomManager()
  const transport = new RoomTransport()
  const pendingAborts = new Map<string, string>()
  app.decorateRequest('authSession', undefined)

  const loadSession = async (request: FastifyRequest) => {
    const token = request.cookies[sessionName]
    if (token) request.authSession = await lookupSession(pool, token)
  }


  app.post('/api/v1/auth/register', { config: { rateLimit: { max: 5, timeWindow: 60 * 60 * 1000 } } }, async (request, reply) => {
    if (!hasOrigin(request, appOrigin)) return reply.code(403).send({ error: 'ORIGIN_FORBIDDEN' })
    if (!jsonObject(request.body) || Object.keys(request.body).some(key => !['username', 'password'].includes(key))) return reply.code(400).send({ error: 'INVALID_INPUT' })
    const username = normalizeUsername(request.body.username)
    const password = request.body.password
    const displayName = username && normalizeDisplayName(username)
    if (!username || !displayName || !validPassword(password)) return reply.code(400).send({ error: 'INVALID_INPUT' })
    if (rateLimited(`register:${request.ip}`, 5, 60 * 60 * 1000)) return reply.code(429).send({ error: 'RATE_LIMITED' })
    let passwordHash: string
    try { passwordHash = await hashPassword(password) }
    catch (error) {
      if (error instanceof Error && error.message === 'HASH_CAPACITY') return reply.code(429).send({ error: 'BUSY' })
      throw error
    }
    const client = await pool.connect()
    const userId = randomUUID()
    const token = randomBytes(32).toString('base64url')
    const csrf = randomBytes(32).toString('base64url')
    try {
      await client.query('BEGIN')
      await client.query('INSERT INTO users(id, username, display_name, password_hash) VALUES($1,$2,$3,$4)', [userId, username, displayName, passwordHash])
      const cardIds = new Map(cardCatalog.map(card => [card.Name, card.Id]))
      for (const starter of STARTER_DECKS) {
        const deckId = randomUUID()
        const counts = new Map<string, number>()
        for (const name of starter.cards) {
          const cardId = cardIds.get(name)
          if (!cardId) throw new Error(`Missing starter card: ${name}`)
          counts.set(cardId, (counts.get(cardId) ?? 0) + 1)
        }
        await client.query('INSERT INTO decks(id,owner_id,name) VALUES($1,$2,$3)', [deckId, userId, starter.name])
        await client.query('INSERT INTO deck_cards(deck_id,card_id,quantity) SELECT $1,card_id,quantity FROM unnest($2::uuid[],$3::smallint[]) AS c(card_id,quantity)', [deckId, [...counts.keys()], [...counts.values()]])
      }
      await client.query(`INSERT INTO user_sessions(id,user_id,token_hash,csrf_token,expires_at)
        VALUES($1,$2,$3,$4,now()+($5 * interval '1 millisecond'))`, [randomUUID(), userId, digest(token), csrf, SESSION_MS])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      if ((error as { code?: string; constraint?: string }).code === '23505' && (error as { constraint?: string }).constraint === 'users_username_key')
        return reply.code(409).send({ error: 'USERNAME_TAKEN' })
      throw error
    } finally { client.release() }
    reply.header('Cache-Control', 'no-store')
    setSessionCookie(reply, appOrigin, token)
    return reply.code(201).send({ user: { id: userId, username, displayName, avatarVersion: 0, avatarUrl: null }, csrfToken: csrf })
  })

  app.post('/api/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: 60 * 1000 } } }, async (request, reply) => {
    if (!hasOrigin(request, appOrigin)) return reply.code(403).send({ error: 'ORIGIN_FORBIDDEN' })
    if (!jsonObject(request.body) || Object.keys(request.body).some(key => !['username', 'password'].includes(key)) || typeof request.body.password !== 'string') return reply.code(400).send({ error: 'INVALID_CREDENTIALS' })
    const suppliedPassword = request.body.password
    const username = normalizeUsername(request.body.username)
    if (!username || suppliedPassword.length > 1024) return reply.code(401).send({ error: 'INVALID_CREDENTIALS' })
    if (rateLimited(`login:${username}`, 5, 60 * 1000)) return reply.code(429).send({ error: 'RATE_LIMITED' })
    const { rows } = await pool.query<Session & { password_hash: string }>(
      `SELECT id AS user_id, username, display_name, avatar_version, password_hash,
       EXISTS(SELECT 1 FROM user_avatars a WHERE a.user_id=users.id) AS has_avatar FROM users WHERE username=$1`, [username],
    )
    const user = rows[0]
    let verified = false
    try { verified = await withArgon(() => argon2.verify(user?.password_hash ?? DUMMY_HASH, suppliedPassword)) }
    catch (error) {
      if (error instanceof Error && error.message === 'HASH_CAPACITY') return reply.code(429).send({ error: 'BUSY' })
    }
    if (!user || !verified) return reply.code(401).send({ error: 'INVALID_CREDENTIALS' })
    const token = randomBytes(32).toString('base64url')
    const csrf = randomBytes(32).toString('base64url')
    const client = await pool.connect()
    try {
      await client.query('INSERT INTO user_sessions(id,user_id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,$4,now()+($5 * interval \'1 millisecond\'))', [randomUUID(), user.user_id, digest(token), csrf, SESSION_MS])
    } finally { client.release() }
    reply.header('Cache-Control', 'no-store')
    setSessionCookie(reply, appOrigin, token)
    return { user: { id: user.user_id, username: user.username, displayName: user.display_name, avatarVersion: user.avatar_version, avatarUrl: user.has_avatar ? avatarUrl(user.user_id, user.avatar_version) : null }, csrfToken: csrf }
  })

  app.get('/api/v1/auth/csrf', { preHandler: loadSession }, async (request, reply) => {
    if (!request.authSession) return reply.code(401).send({ error: 'UNAUTHENTICATED' })
    reply.header('Cache-Control', 'no-store')
    return { csrfToken: request.authSession.csrf_token }
  })

  app.get('/api/v1/me', { preHandler: loadSession }, async (request, reply) => {
    if (!request.authSession) return reply.code(401).send({ error: 'UNAUTHENTICATED' })
    reply.header('Cache-Control', 'no-store')
    const { user_id, username, display_name, avatar_version } = request.authSession
    return { user: { id: user_id, username, displayName: display_name, avatarVersion: avatar_version, avatarUrl: request.authSession.has_avatar ? avatarUrl(user_id, avatar_version) : null } }
  })

  app.patch('/api/v1/me', { preHandler: loadSession }, async (request, reply) => {
    if (!hasOrigin(request, appOrigin)) return reply.code(403).send({ error: 'ORIGIN_FORBIDDEN' })
    if (!request.authSession) return reply.code(401).send({ error: 'UNAUTHENTICATED' })
    if (!csrfMatches(request, request.authSession.csrf_token)) return reply.code(403).send({ error: 'CSRF_INVALID' })
    if (!jsonObject(request.body) || Object.keys(request.body).some(key => key !== 'displayName')) return reply.code(400).send({ error: 'INVALID_INPUT' })
    const displayName = normalizeDisplayName(request.body.displayName)
    if (!displayName) return reply.code(400).send({ error: 'INVALID_INPUT' })
    const { rows } = await pool.query('UPDATE users SET display_name=$2,updated_at=now() WHERE id=$1 RETURNING id,username,display_name,avatar_version', [request.authSession.user_id, displayName])
    reply.header('Cache-Control', 'no-store')
    return { user: { id: rows[0].id, username: rows[0].username, displayName: rows[0].display_name, avatarVersion: rows[0].avatar_version, avatarUrl: request.authSession.has_avatar ? avatarUrl(rows[0].id, rows[0].avatar_version) : null } }
  })

  app.put('/api/v1/me/password', { preHandler: loadSession }, async (request, reply) => {
    if (!hasOrigin(request, appOrigin)) return reply.code(403).send({ error: 'ORIGIN_FORBIDDEN' })
    if (!request.authSession) return reply.code(401).send({ error: 'UNAUTHENTICATED' })
    if (!csrfMatches(request, request.authSession.csrf_token)) return reply.code(403).send({ error: 'CSRF_INVALID' })
    if (!jsonObject(request.body) || Object.keys(request.body).some(key => !['currentPassword', 'newPassword'].includes(key))
      || typeof request.body.currentPassword !== 'string' || !validPassword(request.body.newPassword)) return reply.code(400).send({ error: 'INVALID_INPUT' })
    const currentPassword = request.body.currentPassword
    let { rows } = await pool.query('SELECT password_hash FROM users WHERE id=$1', [request.authSession.user_id])
    let currentMatches = false
    try { currentMatches = await withArgon(() => argon2.verify(rows[0].password_hash, currentPassword)) }
    catch (error) {
      if (error instanceof Error && error.message === 'HASH_CAPACITY') return reply.code(429).send({ error: 'BUSY' })
      throw error
    }
    if (!currentMatches) return reply.code(401).send({ error: 'CURRENT_PASSWORD_INVALID' })
    let nextHash: string
    try { nextHash = await hashPassword(request.body.newPassword) }
    catch (error) {
      if (error instanceof Error && error.message === 'HASH_CAPACITY') return reply.code(429).send({ error: 'BUSY' })
      throw error
    }
    const token = randomBytes(32).toString('base64url')
    const csrf = randomBytes(32).toString('base64url')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1', [request.authSession.user_id, nextHash])
      await client.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL', [request.authSession.user_id, request.authSession.id])
      await client.query(`UPDATE user_sessions SET token_hash=$2,csrf_token=$3,created_at=now(),expires_at=now()+($4 * interval '1 millisecond')
        WHERE id=$1`, [request.authSession.id, digest(token), csrf, SESSION_MS])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
    reply.header('Cache-Control', 'no-store')
    setSessionCookie(reply, appOrigin, token)
    return { csrfToken: csrf }
  })

  app.post('/api/v1/auth/logout', { preHandler: loadSession }, async (request, reply) => {
    if (!hasOrigin(request, appOrigin)) return reply.code(403).send({ error: 'ORIGIN_FORBIDDEN' })
    if (!request.authSession) return reply.code(204).clearCookie(sessionName, { path: '/' }).send()
    if (!csrfMatches(request, request.authSession.csrf_token)) return reply.code(403).send({ error: 'CSRF_INVALID' })
    const room = rooms.current(request.authSession.user_id)
    const reason = room?.ownerUserId === request.authSession.user_id ? 'owner_left' : 'guest_left'
    const result = room ? rooms.leave(request.authSession.user_id, room.id) : null
    if (result?.updates.length) transport.publish(result.updates)
    for (const userId of result?.closedUserIds ?? []) transport.send(userId, 'room.closed', { roomId: result!.roomId, reason })
    let abortPending = false
    if (room?.status === 'playing' && room.matchId) {
      try { await pool.query(`UPDATE matches SET status='aborted',ended_at=now(),end_reason=$2,state_json=NULL WHERE id=$1 AND status='active'`, [room.matchId, reason]) }
      catch { pendingAborts.set(room.matchId, reason); abortPending = true }
    }
    transport.close(request.authSession.user_id)
    try { await pool.query('UPDATE user_sessions SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL', [request.authSession.id]) }
    catch { return reply.code(503).send({ error: 'DATABASE_UNAVAILABLE' }) }
    if (abortPending) return reply.code(503).clearCookie(sessionName, { path: '/' }).send({ error: 'DATABASE_UNAVAILABLE' })
    return reply.code(204).clearCookie(sessionName, { path: '/' }).send()
  })

  registerDeckRoutes(app, pool, loadSession, appOrigin)
  registerAvatarRoutes(app, pool, appOrigin, loadSession)
  registerRoomRoutes(app, pool, appOrigin, rooms, transport, loadSession, (matchId, reason) => pendingAborts.set(matchId, reason))
  registerRealtime(app, pool, appOrigin, rooms, transport)
  let sweeping = false
  const roomSweep = setInterval(async () => {
    if (sweeping) return
    sweeping = true
    try {
      for (const event of rooms.expireDisconnected()) {
      if (event.matchId) {
        pendingAborts.set(event.matchId, event.reason)
        for (const userId of [event.ownerUserId, event.guestUserId].filter((id): id is string => !!id))
          transport.send(userId, 'match.ended', { matchId: event.matchId, status: 'aborted', reason: event.reason })
      }
      if (event.reason === 'owner_disconnected') {
        for (const userId of [event.ownerUserId, event.guestUserId].filter((id): id is string => !!id))
          transport.send(userId, 'room.closed', { roomId: event.roomId, reason: event.reason })
      } else {
        if (event.guestUserId) transport.send(event.guestUserId, 'room.closed', { roomId: event.roomId, reason: event.reason })
        const view = rooms.current(event.ownerUserId)
        if (view) transport.publish(rooms.roomUpdates(view.id))
      }
      }
      for (const [matchId, reason] of pendingAborts) {
        try {
          await pool.query(`UPDATE matches SET status='aborted',ended_at=now(),end_reason=$2,state_json=NULL WHERE id=$1 AND status='active'`, [matchId, reason])
          pendingAborts.delete(matchId)
        } catch { /* Retry on the next room sweep. */ }
      }
    } finally { sweeping = false }
  }, 5_000)
  roomSweep.unref()
  app.addHook('onClose', async () => clearInterval(roomSweep))
}
