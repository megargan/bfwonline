import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import net from 'node:net'
import { Pool } from 'pg'
import { cardCatalog } from '@bfw/game-data'
import { randomLegalDeck } from '@bfw/game-core/deck'
import { buildApp } from '../src/app.ts'
import { runMigrations } from '../src/migrate.ts'
import { seedCards } from '../src/seed-cards.ts'

const connectionString = process.env.BFW_TEST_DATABASE_URL
const require = createRequire(import.meta.resolve('@fastify/websocket'))
const WebSocket = require('ws')

function inbox(socket) {
  const pending = []
  const waiters = []
  socket.on('message', raw => {
    const packet = JSON.parse(raw.toString())
    const index = waiters.findIndex(waiter => waiter.predicate(packet))
    if (index < 0) { pending.push(packet); return }
    const [waiter] = waiters.splice(index, 1)
    clearTimeout(waiter.timer)
    waiter.resolve(packet)
  })
  return {
    next(predicate, timeoutMs = 5000) {
      const index = pending.findIndex(predicate)
      if (index >= 0) return Promise.resolve(pending.splice(index, 1)[0])
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: undefined }
        waiter.timer = setTimeout(() => {
          const position = waiters.indexOf(waiter)
          if (position >= 0) waiters.splice(position, 1)
          reject(new Error('Timed out waiting for WebSocket packet'))
        }, timeoutMs)
        waiters.push(waiter)
      })
    },
  }
}

async function connect(socketUrl, user, origin, sockets) {
  const socket = new WebSocket(socketUrl, { headers: { Origin: origin, Cookie: user.cookie } })
  sockets.push(socket)
  const messages = inbox(socket)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate()
      reject(new Error('Timed out opening the authenticated WebSocket'))
    }, 5000)
    socket.once('open', () => { clearTimeout(timer); resolve() })
    socket.once('error', error => { clearTimeout(timer); reject(error) })
  })
  assert.equal((await messages.next(packet => packet.type === 'session.ready')).payload.protocolVersion, 1)
  const ack = messages.next(packet => packet.type === 'session.hello.ack')
  socket.send(JSON.stringify({ type: 'session.hello', payload: { protocolVersion: 1 } }))
  await ack
  return { socket, messages }
}

test('two authenticated clients create, pause, reconnect, and finish a private match', { skip: !connectionString }, async t => {
  const pool = new Pool({ connectionString })
  let app
  const sockets = []
  const userIds = []
  let roomId
  t.after(async () => {
    await Promise.all(sockets.map(socket => new Promise(resolve => {
      if (socket.readyState === WebSocket.CLOSED) return resolve()
      const timer = setTimeout(() => { socket.terminate(); resolve() }, 1000)
      socket.once('close', () => { clearTimeout(timer); resolve() })
      if (socket.readyState === WebSocket.CONNECTING) socket.terminate()
      else socket.close()
    })))
    if (app) await app.close()
    if (roomId) await pool.query('DELETE FROM matches WHERE room_id=$1', [roomId])
    if (userIds.length) {
      await pool.query('DELETE FROM decks WHERE owner_id=ANY($1::uuid[])', [userIds])
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [userIds])
    }
    await pool.end()
  })

  await runMigrations(pool)
  await seedCards(pool)
  const reservation = net.createServer()
  await new Promise((resolve, reject) => reservation.listen(0, '127.0.0.1', resolve).once('error', reject))
  const address = reservation.address()
  assert.ok(address && typeof address === 'object')
  await new Promise(resolve => reservation.close(resolve))
  const origin = `http://127.0.0.1:${address.port}`
  app = buildApp({ pool, appOrigin: origin })
  await app.listen({ host: '127.0.0.1', port: address.port })

  async function request(user, path, method = 'GET', body) {
    const response = await fetch(`${origin}${path}`, {
      method,
      signal: AbortSignal.timeout(10000),
      headers: {
        Origin: origin,
        ...(user ? { Cookie: user.cookie, 'x-csrf-token': user.csrf } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const payload = response.status === 204 ? null : await response.json()
    assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(payload)}`)
    return payload
  }

  async function register(prefix) {
    const username = `${prefix}${randomUUID().replaceAll('-', '').slice(0, 16)}`
    const response = await fetch(`${origin}/api/v1/auth/register`, {
      method: 'POST', headers: { Origin: origin, 'content-type': 'application/json' }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ username, password: 'Integration-test-password-42' }),
    })
    const payload = await response.json()
    assert.equal(response.status, 201, JSON.stringify(payload))
    userIds.push(payload.user.id)
    return { cookie: response.headers.get('set-cookie').split(';', 1)[0], csrf: payload.csrfToken, id: payload.user.id }
  }

  const raceUsername = `race${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const registrations = await Promise.all([raceUsername, ` ${raceUsername.toUpperCase()} `].map(username =>
    fetch(`${origin}/api/v1/auth/register`, {
      method: 'POST', headers: { Origin: origin, 'content-type': 'application/json' }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ username, password: 'Integration-test-password-42' }),
    }).then(async response => ({ status: response.status, payload: await response.json() })),
  ))
  assert.deepEqual(registrations.map(result => result.status).sort(), [201, 409])
  assert.equal(registrations.find(result => result.status === 409).payload.error, 'USERNAME_TAKEN')
  userIds.push(registrations.find(result => result.status === 201).payload.user.id)

  const owner = await register('e2e')
  const guest = await register('e2g')
  const originalUsername = await pool.query('SELECT username FROM users WHERE id=$1', [owner.id])
  await assert.rejects(pool.query('UPDATE users SET username=$2 WHERE id=$1', [owner.id, `${owner.id.slice(0, 8)}changed`]), error => error.code === '23514')
  const immutableUsername = await pool.query('SELECT username FROM users WHERE id=$1', [owner.id])
  assert.equal(immutableUsername.rows[0].username, originalUsername.rows[0].username)
  const wsUrl = `${origin.replace(/^http/u, 'ws')}/ws`
  const ownerClient = await connect(wsUrl, owner, origin, sockets)
  let guestClient = await connect(wsUrl, guest, origin, sockets)

  const cardIds = randomLegalDeck(cardCatalog, () => 0.42)
  const counts = new Map()
  for (const id of cardIds) counts.set(id, (counts.get(id) ?? 0) + 1)
  const cards = [...counts].map(([cardId, quantity]) => ({ cardId, quantity }))
  const ownerDeck = await request(owner, '/api/v1/decks', 'POST', { name: 'Integration deck owner', cards })
  const guestDeck = await request(guest, '/api/v1/decks', 'POST', { name: 'Integration deck guest', cards })
  assert.equal(ownerDeck.validation.valid, true)
  assert.equal(guestDeck.validation.valid, true)

  const room = await request(owner, '/api/v1/rooms', 'POST', {})
  roomId = room.id
  await request(guest, '/api/v1/rooms/join', 'POST', { code: room.code })
  const ownerSelection = await request(owner, `/api/v1/rooms/${roomId}/selection`, 'PUT', { deckId: ownerDeck.id })
  const guestSelection = await request(guest, `/api/v1/rooms/${roomId}/selection`, 'PUT', { deckId: guestDeck.id })
  await request(owner, `/api/v1/rooms/${roomId}/ready`, 'PUT', { ready: true, deckRevision: ownerSelection.myDeckRevision })
  await request(guest, `/api/v1/rooms/${roomId}/ready`, 'PUT', { ready: true, deckRevision: guestSelection.myDeckRevision })

  const started = await request(owner, `/api/v1/rooms/${roomId}/start`, 'POST', {})
  assert.equal(started.status, 'playing')
  const snapshots = await Promise.all([ownerClient, guestClient].map(async client => {
    await client.messages.next(packet => packet.type === 'match.started')
    return client.messages.next(packet => packet.type === 'match.snapshot')
  }))
  const [ownerPacket, guestPacket] = snapshots
  const [ownerSnapshot, guestSnapshot] = [ownerPacket, guestPacket].map(packet => packet.payload)
  assert.equal(ownerPacket.matchId, started.matchId)
  assert.equal(guestPacket.matchId, started.matchId)
  assert.equal(ownerSnapshot.private.seat, 0)
  assert.equal(guestSnapshot.private.seat, 1)
  assert.equal(ownerSnapshot.private.hand.length, 4)
  assert.equal(guestSnapshot.private.hand.length, 4)
  assert.ok(ownerSnapshot.public.players.every(player => !('hand' in player) && !('deck' in player)))
  assert.ok(guestSnapshot.public.players.every(player => !('hand' in player) && !('deck' in player)))

  const paused = ownerClient.messages.next(packet => packet.type === 'match.paused' && packet.payload.matchId === started.matchId)
  const guestClosed = new Promise(resolve => guestClient.socket.once('close', resolve))
  guestClient.socket.close()
  await Promise.all([paused, guestClosed])
  const pausedCommandId = randomUUID()
  const pausedRejection = ownerClient.messages.next(packet => packet.type === 'command.rejected' && packet.payload.commandId === pausedCommandId)
  ownerClient.socket.send(JSON.stringify({ type: 'game.command', payload: {
    matchId: started.matchId, commandId: pausedCommandId, expectedVersion: 0, action: 'match.concede', data: {},
  } }))
  assert.equal((await pausedRejection).payload.code, 'MATCH_PAUSED')
  assert.deepEqual((await pool.query('SELECT status,version FROM matches WHERE id=$1', [started.matchId])).rows[0], { status: 'active', version: 0 })

  guestClient = await connect(wsUrl, guest, origin, sockets)
  const resumedSnapshot = guestClient.messages.next(packet => packet.type === 'match.snapshot' && packet.matchId === started.matchId)
  guestClient.socket.send(JSON.stringify({ type: 'match.resync', payload: { matchId: started.matchId, lastKnownVersion: 0 } }))
  assert.equal((await resumedSnapshot).payload.private.hand.length, 4)

  const command = { type: 'game.command', payload: {
    matchId: started.matchId, commandId: randomUUID(), expectedVersion: 0, action: 'match.concede', data: {},
  } }
  const firstAck = guestClient.messages.next(packet => packet.type === 'command.ack' && packet.payload.commandId === command.payload.commandId)
  const ended = ownerClient.messages.next(packet => packet.type === 'match.ended' && packet.matchId === started.matchId)
  guestClient.socket.send(JSON.stringify(command))
  assert.equal((await firstAck).payload.appliedVersion, 1)
  assert.equal((await ended).payload.status, 'finished')

  const duplicateAck = guestClient.messages.next(packet => packet.type === 'command.ack' && packet.payload.commandId === command.payload.commandId)
  const duplicateSnapshot = guestClient.messages.next(packet => packet.type === 'match.snapshot' && packet.matchId === started.matchId)
  guestClient.socket.send(JSON.stringify(command))
  assert.equal((await duplicateAck).payload.appliedVersion, 1)
  await duplicateSnapshot
  const persisted = await pool.query('SELECT status,version FROM matches WHERE id=$1', [started.matchId])
  const receipts = await pool.query('SELECT count(*)::int AS count FROM match_commands WHERE match_id=$1', [started.matchId])
  assert.deepEqual(persisted.rows[0], { status: 'finished', version: 1 })
  assert.equal(receipts.rows[0].count, 1)
})
