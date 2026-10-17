import { createHash } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'
import type { Pool } from 'pg'
import { AvatarError, processAvatar } from './avatar.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_INPUT = 5 * 1024 * 1024

export const avatarUrl = (userId: string, version: number) => `/api/v1/users/${userId}/avatar?v=${version}`

async function readUpload(request: FastifyRequest) {
  if (!request.isMultipart()) throw new AvatarError('AVATAR_UNSUPPORTED')
  let image: Buffer | undefined
  let invalid = false
  try {
    for await (const part of request.parts({ limits: { files: 1, fields: 0, parts: 1, fileSize: MAX_INPUT } })) {
      if (part.type !== 'file') { invalid = true; continue }
      const content = await part.toBuffer()
      if (part.file.truncated) throw new AvatarError('AVATAR_TOO_LARGE')
      if (part.fieldname !== 'file' || image) invalid = true
      else image = content
    }
  } catch (error) {
    if (error instanceof AvatarError) throw error
    if (error && typeof error === 'object' && 'code' in error && String(error.code).includes('FILE_TOO_LARGE')) throw new AvatarError('AVATAR_TOO_LARGE')
    throw new AvatarError('INVALID_INPUT')
  }
  if (invalid || !image) throw new AvatarError('INVALID_INPUT')
  return image
}

function avatarError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof AvatarError)) throw error
  const status = error.code === 'AVATAR_TOO_LARGE' ? 413
    : error.code === 'AVATAR_BUSY' ? 429
      : error.code === 'AVATAR_UNSUPPORTED' || error.code === 'AVATAR_ANIMATED' ? 415
        : error.code === 'INVALID_INPUT' ? 400 : 422
  return reply.code(status).send({ error: error.code })
}

export function registerAvatarRoutes(app: FastifyInstance, pool: Pool, appOrigin: string, loadSession: preHandlerHookHandler) {
  app.put('/api/v1/me/avatar', { preHandler: loadSession }, async (request, reply) => {
    if (request.headers.origin !== appOrigin) return reply.code(403).send({ error: 'ORIGIN_FORBIDDEN' })
    if (!request.authSession) return reply.code(401).send({ error: 'UNAUTHENTICATED' })
    if (request.headers['x-csrf-token'] !== request.authSession.csrf_token) return reply.code(403).send({ error: 'CSRF_INVALID' })
    let webp: Buffer
    try { webp = await processAvatar(await readUpload(request)) }
    catch (error) { return avatarError(reply, error) }
    const client = await pool.connect()
    let version: number
    try {
      await client.query('BEGIN')
      await client.query('INSERT INTO user_avatars(user_id,body) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET body=EXCLUDED.body,updated_at=now()', [request.authSession.user_id, webp])
      const result = await client.query<{ avatar_version: number }>('UPDATE users SET avatar_version=avatar_version+1,updated_at=now() WHERE id=$1 RETURNING avatar_version', [request.authSession.user_id])
      if (!result.rows[0]) throw new Error('USER_NOT_FOUND')
      version = result.rows[0].avatar_version
      await client.query('COMMIT')
    } catch {
      await client.query('ROLLBACK').catch(() => undefined)
      return reply.code(503).send({ error: 'DATABASE_UNAVAILABLE' })
    } finally { client.release() }
    reply.header('Cache-Control', 'no-store')
    return { avatarUrl: avatarUrl(request.authSession.user_id, version), avatarVersion: version }
  })

  app.delete('/api/v1/me/avatar', { preHandler: loadSession }, async (request, reply) => {
    if (request.headers.origin !== appOrigin) return reply.code(403).send({ error: 'ORIGIN_FORBIDDEN' })
    if (!request.authSession) return reply.code(401).send({ error: 'UNAUTHENTICATED' })
    if (request.headers['x-csrf-token'] !== request.authSession.csrf_token) return reply.code(403).send({ error: 'CSRF_INVALID' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM user_avatars WHERE user_id=$1', [request.authSession.user_id])
      await client.query('UPDATE users SET avatar_version=avatar_version+1,updated_at=now() WHERE id=$1', [request.authSession.user_id])
      await client.query('COMMIT')
    } catch {
      await client.query('ROLLBACK').catch(() => undefined)
      return reply.code(503).send({ error: 'DATABASE_UNAVAILABLE' })
    } finally { client.release() }
    return reply.code(204).send()
  })

  app.get('/api/v1/users/:userId/avatar', async (request, reply) => {
    const userId = (request.params as { userId: string }).userId
    if (!UUID.test(userId)) return reply.code(404).send()
    const requestedVersion = Number((request.query as { v?: string }).v)
    if (!Number.isSafeInteger(requestedVersion) || requestedVersion < 0) return reply.code(400).send({ error: 'INVALID_INPUT' })
    const { rows } = await pool.query<{ avatar_version: number; body: Buffer | null }>(
      `SELECT u.avatar_version,a.body FROM users u LEFT JOIN user_avatars a ON a.user_id=u.id WHERE u.id=$1`, [userId],
    )
    if (!rows[0]) return reply.code(404).send()
    const currentUrl = avatarUrl(userId, rows[0].avatar_version)
    if (requestedVersion !== rows[0].avatar_version) {
      reply.header('Cache-Control', 'no-cache')
      return reply.redirect(currentUrl, 302)
    }
    if (!rows[0].body) return reply.code(404).send()
    const etag = `"${createHash('sha256').update(rows[0].body).digest('hex')}"`
    reply.header('ETag', etag).header('Content-Type', 'image/webp').header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'public, max-age=3600')
    if (request.headers['if-none-match']?.split(',').some(value => value.trim() === etag || value.trim() === '*')) return reply.code(304).send()
    return reply.send(rows[0].body)
  })
}
