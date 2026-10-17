import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import { lookupSession, sessionCookieName } from './auth-routes.ts'
import { RoomError, RoomManager } from './room-manager.ts'
import { RoomTransport, sendSocketMessage } from './room-transport.ts'
import { parseClientMessage } from '@bfw/contracts'
import { applyMatchCommand, MatchCommandError, readMatchSnapshot } from './match-commands.ts'

type WebSocket = {
  readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
  terminate: () => void
  ping: () => void
  on: (event: string, listener: (value?: { toString: () => string }) => void) => void
}

function send(socket: WebSocket, type: string, payload: unknown, metadata: Record<string, unknown> = {}) {
  sendSocketMessage(socket, type, payload, metadata)
}

export function registerRealtime(app: FastifyInstance, pool: Pool, appOrigin: string, rooms: RoomManager, transport: RoomTransport) {
  app.get('/ws', {
    websocket: true,
    preValidation: async (request, reply) => {
      if (request.headers.origin !== appOrigin) return reply.code(403).send({ error: 'ORIGIN_FORBIDDEN' })
      const token = request.cookies[sessionCookieName(appOrigin)]
      if (!token) return reply.code(401).send({ error: 'UNAUTHENTICATED' })
      const session = await lookupSession(pool, token)
      if (!session) return reply.code(401).send({ error: 'UNAUTHENTICATED' })
      if (!rooms.connectionAllowed(session.user_id)) return reply.code(503).send({ error: 'SERVER_BUSY' })
      request.authSession = session
    },
  }, (socket, request: FastifyRequest) => {
    const session = request.authSession!
    const connectionId = randomUUID()
    let handshaken = false
    let closed = false
    let queued = 0
    const messageTimes: number[] = []
    const commandTimes: number[] = []
    let lastPong = Date.now()
    const keepalive = setInterval(() => {
      if (Date.now() - lastPong > 45_000) { socket.terminate(); return }
      socket.ping()
    }, 15_000)
    const sessionCheck = setInterval(async () => {
      try {
        const active = await lookupSession(pool, request.cookies[sessionCookieName(appOrigin)] ?? '')
        if (!active) socket.close(4001, 'session expired')
      } catch { socket.close(1011, 'session check failed') }
    }, 30_000)
    const closeTimers = () => { clearInterval(keepalive); clearInterval(sessionCheck) }

    send(socket, 'session.ready', { protocolVersion: 1, userId: session.user_id })
    socket.on('pong', () => { lastPong = Date.now() })
    socket.on('message', (raw: { toString: () => string }) => {
      queued++
      if (queued > 50) { socket.close(1008, 'message queue limit'); return }
      void (async () => {
        try {
          const now = Date.now()
          while (messageTimes.length && now - messageTimes[0] >= 1_000) messageTimes.shift()
          if (messageTimes.length >= 20) { socket.close(1008, 'rate limit'); return }
          messageTimes.push(now)
          let packet
          try { packet = parseClientMessage(JSON.parse(raw.toString())) }
          catch (error) {
            const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'INVALID_MESSAGE'
            send(socket, 'command.rejected', { code })
            if (code !== 'UNSUPPORTED_ACTION') socket.close(1008, 'invalid message')
            return
          }
          if (packet.type === 'game.command') {
            while (commandTimes.length && now - commandTimes[0] >= 60_000) commandTimes.shift()
            if (commandTimes.length >= 60) { socket.close(1008, 'command rate limit'); return }
            commandTimes.push(now)
          }
          if (!handshaken) {
            if (packet.type !== 'session.hello') {
              send(socket, 'command.rejected', { code: 'PROTOCOL_MISMATCH' })
              socket.close(1008, 'protocol mismatch')
              return
            }
            const roomView = rooms.connect({ userId: session.user_id, username: session.username, displayName: session.display_name }, connectionId)
            handshaken = true
            transport.attach(session.user_id, socket)
            if (roomView) transport.publish(rooms.roomUpdates(roomView.id))
            send(socket, 'session.hello.ack', { protocolVersion: 1 })
            return
          }
          if (packet.type === 'match.subscribe' || packet.type === 'match.resync') {
            try {
              const snapshot = await readMatchSnapshot(pool, session.user_id, packet.payload.matchId)
              const matchId = packet.payload.matchId
              send(socket, 'match.snapshot', snapshot, { matchId, version: snapshot.public.version })
            } catch (error) {
              send(socket, 'command.rejected', { code: error instanceof MatchCommandError ? error.code : 'SNAPSHOT_FAILED' }, { matchId: packet.payload.matchId })
            }
            return
          }
          if (packet.type === 'game.command') {
            try {
              const result = await applyMatchCommand(pool, session.user_id, packet.payload, () => rooms.matchCommandsAllowed(session.user_id, packet.payload.matchId))
              if (result.kind === 'rejected') {
                send(socket, 'command.rejected', { commandId: result.commandId, code: result.code, currentVersion: result.currentVersion, requestId: randomUUID(), snapshot: result.snapshots[0]!.snapshot }, { matchId: packet.payload.matchId, version: result.currentVersion })
                return
              }
              send(socket, 'command.ack', { commandId: result.commandId, appliedVersion: result.appliedVersion }, { matchId: packet.payload.matchId, version: result.appliedVersion })
              if (result.kind === 'duplicate') {
                send(socket, 'match.snapshot', result.snapshots[0]!.snapshot, { matchId: packet.payload.matchId, version: result.snapshots[0]!.snapshot.public.version })
                return
              }
              for (const item of result.snapshots) transport.send(item.userId, 'match.updated', { snapshot: item.snapshot, events: result.events }, { matchId: result.matchId, version: result.version, commandId: result.commandId })
              if (result.snapshots[0]?.snapshot.public.status === 'finished') {
                for (const item of result.snapshots) transport.send(item.userId, 'match.ended', { status: 'finished', reason: item.snapshot.public.endReason ?? 'unknown', winnerUserId: item.snapshot.public.winnerUserId }, { matchId: result.matchId, version: result.version })
                transport.publish(rooms.finishMatch(session.user_id, result.matchId))
              }
              return
            } catch (error) {
              const code = error instanceof MatchCommandError ? error.code : 'COMMAND_FAILED'
              send(socket, 'command.rejected', { commandId: packet.payload.commandId, code, requestId: randomUUID() }, { matchId: packet.payload.matchId })
              return
            }
          }
          send(socket, 'command.rejected', { code: 'UNSUPPORTED_MESSAGE' })
        } catch (error) {
          if (error instanceof RoomError) send(socket, 'command.rejected', { code: error.code })
          else send(socket, 'command.rejected', { code: 'INVALID_MESSAGE' })
          socket.close(1008, 'invalid message')
        } finally { queued-- }
      })()
    })
    socket.on('close', () => {
      if (closed) return
      closed = true
      closeTimers()
      transport.detach(session.user_id, socket)
      if (handshaken) {
        const disconnected = rooms.disconnect(session.user_id, connectionId)
        if (disconnected) {
          transport.publish(disconnected.updates)
          if (disconnected.status === 'playing' && disconnected.matchId) {
            for (const userId of [disconnected.ownerUserId, disconnected.guestUserId].filter((id): id is string => !!id))
              transport.send(userId, 'match.paused', { matchId: disconnected.matchId, reason: session.user_id === disconnected.ownerUserId ? 'owner_disconnected' : 'guest_disconnected', deadline: disconnected.deadline })
          }
        }
      }
    })
    socket.on('error', () => { closeTimers(); socket.terminate() })
  })
}
