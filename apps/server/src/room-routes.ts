import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'
import type { Pool } from 'pg'
import { cardCatalog } from '@bfw/game-data'
import { validateDeck } from '@bfw/game-core'
import { RoomError, RoomManager } from './room-manager.ts'
import { RoomTransport } from './room-transport.ts'
import { startMatchForRoom } from './match-start.ts'
import type { MatchState } from '@bfw/game-core'
import { projectMatchForPlayer } from './match-profile.ts'

const joinBuckets = new Map<string, number[]>()
function errorStatus(code: string) {
  if (code === 'SERVER_BUSY') return 503
  if (code === 'ROOM_NOT_FOUND') return 404
  if (code === 'ROOM_FULL' || code === 'ROOM_ALREADY_PLAYING' || code === 'ALREADY_IN_ROOM') return 409
  if (code === 'PLAYER_OFFLINE' || code === 'PLAYERS_NOT_READY' || code === 'DECK_NOT_SELECTED' || code === 'DECK_NOT_PLAYABLE' || code === 'DECK_CHANGED' || code === 'ACTIVE_CONNECTION_EXISTS') return 409
  if (code === 'OWNER_ONLY') return 403
  return 400
}
function respondError(reply: FastifyReply, error: unknown) {
  if (error instanceof RoomError) return reply.code(errorStatus(error.code)).send({ error: error.code })
  throw error
}
function signedIn(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authSession) { reply.code(401).send({ error: 'UNAUTHENTICATED' }); return false }
  return true
}
function mutationAllowed(request: FastifyRequest, reply: FastifyReply, origin: string) {
  if (request.headers.origin !== origin) { reply.code(403).send({ error: 'ORIGIN_FORBIDDEN' }); return false }
  if (!request.authSession || request.headers['x-csrf-token'] !== request.authSession.csrf_token) {
    reply.code(403).send({ error: 'CSRF_INVALID' }); return false
  }
  return true
}
function objectBody(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function uuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }

export function registerRoomRoutes(
  app: FastifyInstance, pool: Pool, appOrigin: string, rooms: RoomManager, transport: RoomTransport,
  loadSession: preHandlerHookHandler, queueAbort: (matchId: string, reason: string) => void = () => {},
) {
  app.post('/api/v1/rooms', { preHandler: loadSession }, async (request, reply) => {
    if (!signedIn(request, reply)) return
    if (!mutationAllowed(request, reply, appOrigin)) return
    if (request.body !== undefined && (!objectBody(request.body) || Object.keys(request.body).length)) return reply.code(400).send({ error: 'INVALID_INPUT' })
    try {
      const result = rooms.create(request.authSession!.user_id)
      transport.publish(rooms.roomUpdates(result.room.id))
      reply.header('Cache-Control', 'no-store')
      return reply.code(result.created ? 201 : 200).send(result.room)
    } catch (error) { return respondError(reply, error) }
  })

  app.get('/api/v1/rooms/current', { preHandler: loadSession }, async (request, reply) => {
    if (!signedIn(request, reply)) return
    const room = rooms.current(request.authSession!.user_id)
    if (!room) return reply.code(404).send({ error: 'ROOM_NOT_FOUND' })
    reply.header('Cache-Control', 'no-store')
    return room
  })

  app.post('/api/v1/rooms/join', { config: { rateLimit: { max: 10, timeWindow: 60_000 } }, preHandler: loadSession }, async (request, reply) => {
    if (!signedIn(request, reply)) return
    if (!mutationAllowed(request, reply, appOrigin)) return
    if (!objectBody(request.body) || Object.keys(request.body).some(key => key !== 'code') || typeof request.body.code !== 'string' || !/^[A-HJ-NP-Z2-9]{8}$/i.test(request.body.code.trim())) return reply.code(400).send({ error: 'INVALID_CODE' })
    const now = Date.now()
    const userId = request.authSession!.user_id
    if (joinBuckets.size > 10_000) {
      for (const [key, values] of joinBuckets) {
        if (values.at(-1)! <= now - 60_000) joinBuckets.delete(key)
        if (joinBuckets.size <= 10_000) break
      }
      while (joinBuckets.size > 10_000) joinBuckets.delete(joinBuckets.keys().next().value!)
    }
    const hits = (joinBuckets.get(userId) ?? []).filter(time => now - time < 60_000)
    if (hits.length >= 10) return reply.code(429).send({ error: 'RATE_LIMITED' })
    hits.push(now)
    joinBuckets.set(userId, hits)
    try {
      const room = rooms.join(userId, request.body.code)
      transport.publish(rooms.roomUpdates(room.id))
      reply.header('Cache-Control', 'no-store')
      return room
    } catch (error) { return respondError(reply, error) }
  })

  app.get('/api/v1/rooms/:roomId', { preHandler: loadSession }, async (request, reply) => {
    if (!signedIn(request, reply)) return
    const room = rooms.current(request.authSession!.user_id)
    if (!room || room.id !== (request.params as { roomId: string }).roomId) return reply.code(404).send({ error: 'ROOM_NOT_FOUND' })
    reply.header('Cache-Control', 'no-store')
    return room
  })

  app.put('/api/v1/rooms/:roomId/selection', { preHandler: loadSession }, async (request, reply) => {
    if (!signedIn(request, reply)) return
    if (!mutationAllowed(request, reply, appOrigin)) return
    const room = rooms.current(request.authSession!.user_id)
    if (!room || room.id !== (request.params as { roomId: string }).roomId) return reply.code(404).send({ error: 'ROOM_NOT_FOUND' })
    if (!objectBody(request.body) || Object.keys(request.body).some(key => key !== 'deckId') || !uuid(request.body.deckId)) return reply.code(400).send({ error: 'INVALID_INPUT' })
    const { rows } = await pool.query('SELECT d.id,d.revision,dc.card_id,dc.quantity FROM decks d LEFT JOIN deck_cards dc ON dc.deck_id=d.id WHERE d.id=$1 AND d.owner_id=$2', [request.body.deckId, request.authSession!.user_id])
    if (!rows.length) return reply.code(404).send({ error: 'DECK_NOT_FOUND' })
    const selected = rows.filter(row => row.card_id).flatMap(row => Array(Number(row.quantity)).fill(row.card_id) as string[])
    if (!validateDeck(selected, cardCatalog.filter(card => !card.Tags?.includes('в разработке')))) return reply.code(422).send({ error: 'DECK_NOT_PLAYABLE' })
    try {
      const updated = rooms.selectDeck(request.authSession!.user_id, rows[0].id, rows[0].revision, true, room.id)
      transport.publish(rooms.roomUpdates(updated.id))
      reply.header('Cache-Control', 'no-store')
      return updated
    } catch (error) { return respondError(reply, error) }
  })

  app.put('/api/v1/rooms/:roomId/ready', { preHandler: loadSession }, async (request, reply) => {
    if (!signedIn(request, reply)) return
    if (!mutationAllowed(request, reply, appOrigin)) return
    const room = rooms.current(request.authSession!.user_id)
    if (!room || room.id !== (request.params as { roomId: string }).roomId) return reply.code(404).send({ error: 'ROOM_NOT_FOUND' })
    if (!objectBody(request.body) || typeof request.body.ready !== 'boolean'
      || Object.keys(request.body).some(key => key !== 'ready' && key !== 'deckRevision')
      || (request.body.ready && !Number.isSafeInteger(request.body.deckRevision))) return reply.code(400).send({ error: 'INVALID_INPUT' })
    if (request.body.ready) {
      const selectedDeckId = room.myDeckId
      const result = await pool.query('SELECT revision FROM decks WHERE id=$1 AND owner_id=$2', [selectedDeckId, request.authSession!.user_id])
      if (rooms.current(request.authSession!.user_id)?.id !== room.id) return reply.code(404).send({ error: 'ROOM_NOT_FOUND' })
      if (!result.rows[0]) return reply.code(404).send({ error: 'DECK_NOT_FOUND' })
      if (result.rows[0].revision !== room.myDeckRevision) {
        const updated = rooms.setReady(request.authSession!.user_id, false, undefined, room.id)
        transport.publish(rooms.roomUpdates(updated.id))
        return reply.code(409).send({ error: 'DECK_CHANGED', currentRevision: result.rows[0].revision })
      }
    }
    try {
      const updated = rooms.setReady(request.authSession!.user_id, request.body.ready, Number(request.body.deckRevision), room.id)
      transport.publish(rooms.roomUpdates(updated.id))
      reply.header('Cache-Control', 'no-store')
      return updated
    } catch (error) { return respondError(reply, error) }
  })

  app.post('/api/v1/rooms/:roomId/leave', { preHandler: loadSession }, async (request, reply) => {
    if (!signedIn(request, reply)) return
    if (!mutationAllowed(request, reply, appOrigin)) return
    const current = rooms.current(request.authSession!.user_id)
    if (!current || current.id !== (request.params as { roomId: string }).roomId) return reply.code(204).send()
    const reason = current.ownerUserId === request.authSession!.user_id ? 'owner_left' : 'guest_left'
    let abortPending = false
    if (current.status === 'playing' && current.matchId) {
      try { await pool.query(`UPDATE matches SET status='aborted',ended_at=now(),end_reason=$2,state_json=NULL WHERE id=$1 AND status='active'`, [current.matchId, reason]) }
      catch { abortPending = true }
    }
    let result
    try { result = rooms.leave(request.authSession!.user_id, current.id) }
    catch (error) {
      if (error instanceof RoomError && error.code === 'ROOM_NOT_FOUND') return reply.code(204).send()
      return respondError(reply, error)
    }
    if (result.updates.length) transport.publish(result.updates)
    for (const userId of result.closedUserIds) transport.send(userId, 'room.closed', { roomId: result.roomId, reason })
    if (abortPending && current.matchId) {
      queueAbort(current.matchId, reason)
      return reply.code(503).send({ error: 'DATABASE_UNAVAILABLE' })
    }
    reply.header('Cache-Control', 'no-store')
    return reply.code(204).send()
  })

  app.get('/api/v1/matches/:matchId/snapshot', { preHandler: loadSession }, async (request, reply) => {
    if (!signedIn(request, reply)) return
    const matchId = (request.params as { matchId: string }).matchId
    if (!uuid(matchId)) return reply.code(400).send({ error: 'INVALID_INPUT' })
    const { rows } = await pool.query<{ state_json: MatchState; seat: number }>(
      `SELECT m.state_json,mp.seat FROM matches m JOIN match_players mp ON mp.match_id=m.id
       WHERE m.id=$1 AND mp.user_id=$2`, [matchId, request.authSession!.user_id],
    )
    if (!rows[0]) return reply.code(404).send({ error: 'MATCH_NOT_FOUND' })
    reply.header('Cache-Control', 'no-store')
    return projectMatchForPlayer(pool, matchId, rows[0].state_json, rows[0].seat)
  })

  app.post('/api/v1/rooms/:roomId/start', { preHandler: loadSession }, async (request, reply) => {
    if (!signedIn(request, reply)) return
    if (!mutationAllowed(request, reply, appOrigin)) return
    const room = rooms.current(request.authSession!.user_id)
    if (!room || room.id !== (request.params as { roomId: string }).roomId) return reply.code(404).send({ error: 'ROOM_NOT_FOUND' })
    if (room.ownerUserId !== request.authSession!.user_id) return reply.code(403).send({ error: 'OWNER_ONLY' })
    try {
      const started = await startMatchForRoom(pool, rooms, transport, request.authSession!.user_id, room.id)
      reply.header('Cache-Control', 'no-store')
      return started
    } catch (error) { return respondError(reply, error) }
  })
}
