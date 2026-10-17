import test from 'node:test'
import assert from 'node:assert/strict'
import { registerRealtime } from '../src/realtime.ts'
import { sessionCookieName } from '../src/auth-routes.ts'
import { RoomTransport } from '../src/room-transport.ts'
import { RoomManager } from '../src/room-manager.ts'
import { createMatch } from '@bfw/game-core'
import { randomLegalDeck } from '@bfw/game-core/deck'
import { cardCatalog } from '@bfw/game-data'

class FakeSocket {
  readyState = 1
  listeners = new Map()
  closed = []
  sent = []
  on(event, listener) { this.listeners.set(event, listener) }
  send(value) { this.sent.push(JSON.parse(value)) }
  close(...args) { this.closed.push(args) }
  terminate() { this.closed.push(['terminated']) }
  ping() {}
  message(value) { this.listeners.get('message')({ toString: () => JSON.stringify(value) }) }
  finish() { this.listeners.get('close')() }
}

test('WebSocket command throttle does not count hello or match subscriptions', async () => {
  const socket = new FakeSocket()
  let handler
  const app = { get(_path, _options, callback) { handler = callback } }
  const pool = { async query() { return { rows: [] } } }
  registerRealtime(app, pool, 'https://example.test', new RoomManager(), new RoomTransport())

  const realNow = Date.now
  let now = 1_000
  Date.now = () => now
  try {
    handler(socket, { authSession: { user_id: 'user-1', username: 'User', display_name: 'User' }, cookies: {} })
    socket.message({ type: 'session.hello', payload: { protocolVersion: 1 } })
    await new Promise(resolve => setImmediate(resolve))
    for (let index = 0; index < 61; index++) {
      now += 53
      socket.message({ type: 'match.subscribe', payload: { matchId: '11111111-1111-4111-8111-111111111111' } })
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.deepEqual(socket.closed, [])
  } finally {
    Date.now = realNow
    socket.finish()
  }
})

test('WebSocket closes after 60 game commands in a minute', async () => {
  const socket = new FakeSocket()
  let handler
  const app = { get(_path, _options, callback) { handler = callback } }
  const pool = { async query() { return { rows: [] } } }
  registerRealtime(app, pool, 'https://example.test', new RoomManager(), new RoomTransport())

  const realNow = Date.now
  let now = 1_000
  Date.now = () => now
  try {
    handler(socket, { authSession: { user_id: 'user-1', username: 'User', display_name: 'User' }, cookies: {} })
    socket.message({ type: 'session.hello', payload: { protocolVersion: 1 } })
    await new Promise(resolve => setImmediate(resolve))
    for (let index = 0; index < 61; index++) {
      now += 53
      socket.message({
        type: 'game.command',
        payload: {
          matchId: '11111111-1111-4111-8111-111111111111',
          commandId: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
          expectedVersion: 0,
          action: 'match.concede',
          data: {},
        },
      })
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.deepEqual(socket.closed, [[1008, 'command rate limit']])
  } finally {
    Date.now = realNow
    socket.finish()
  }
})

test('WebSocket handshake returns 503 under heap overload without rejecting a reconnect', async () => {
  let options
  const app = { get(_path, routeOptions) { options = routeOptions } }
  const pool = { async query() { return { rows: [{ user_id: 'user-1' }] } } }
  let overloaded = true
  const rooms = new RoomManager(() => overloaded)
  const origin = 'https://example.test'
  registerRealtime(app, pool, origin, rooms, new RoomTransport())

  let statusCode
  const reply = { code(code) { statusCode = code; return this }, send() {} }
  const request = { headers: { origin }, cookies: { [sessionCookieName(origin)]: 'session-token' } }
  await options.preValidation(request, reply)
  assert.equal(statusCode, 503)

  statusCode = undefined
  overloaded = false
  const now = Date.now()
  rooms.connect({ userId: 'user-1', username: 'User', displayName: 'User' }, 'old', now)
  rooms.create('user-1', now)
  rooms.disconnect('user-1', 'old', now)
  overloaded = true
  await options.preValidation(request, reply)
  assert.equal(statusCode, undefined)
})

test('match commands are rejected while either room participant is disconnected', async () => {
  const owner = { userId: 'owner', username: 'owner', displayName: 'Owner' }
  const guest = { userId: 'guest', username: 'guest', displayName: 'Guest' }
  const rooms = new RoomManager(() => false)
  const ownerSocket = new FakeSocket()
  let handler
  const app = { get(_path, _options, callback) { handler = callback } }
  let transactionCount = 0
  const pool = { async connect() {
    transactionCount++
    return { async query(sql) {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] }
      if (sql.includes('SELECT status,version,state_json')) return { rows: [{ status: 'active', version: 0, state_json: { status: 'active' } }] }
      if (sql.includes('SELECT user_id,seat')) return { rows: [{ user_id: 'owner', seat: 0 }, { user_id: 'guest', seat: 1 }] }
      if (sql.includes('SELECT actor_user_id,request_hash,applied_version')) return { rows: [] }
      throw new Error(`unexpected SQL: ${sql}`)
    }, release() {} }
  } }
  registerRealtime(app, pool, 'https://example.test', rooms, new RoomTransport())
  handler(ownerSocket, { authSession: { user_id: owner.userId, username: owner.username, display_name: owner.displayName }, cookies: {} })
  ownerSocket.message({ type: 'session.hello', payload: { protocolVersion: 1 } })
  await new Promise(resolve => setImmediate(resolve))

  rooms.connect(guest, 'guest-socket', Date.now())
  const room = rooms.create(owner.userId).room
  rooms.join(guest.userId, room.code)
  rooms.selectDeck(owner.userId, 'owner-deck', 1, true)
  rooms.selectDeck(guest.userId, 'guest-deck', 1, true)
  rooms.setReady(owner.userId, true, 1)
  rooms.setReady(guest.userId, true, 1)
  const matchId = '11111111-1111-4111-8111-111111111111'
  rooms.start(owner.userId, matchId)
  rooms.disconnect(guest.userId, 'guest-socket', Date.now())

  ownerSocket.message({
    type: 'game.command',
    payload: {
      matchId,
      commandId: '22222222-2222-4222-8222-222222222222',
      expectedVersion: 0,
      action: 'match.concede',
      data: {},
    },
  })
  await new Promise(resolve => setImmediate(resolve))
  const rejected = ownerSocket.sent.some(packet => packet.type === 'command.rejected' && packet.payload.code === 'MATCH_PAUSED')
  ownerSocket.finish()
  assert.equal(transactionCount, 1)
  assert.ok(rejected)
})

test('accepted turn end updates both connected seats without changing either seat view', async () => {
  const profiles = [
    { userId: 'owner', username: 'owner', displayName: 'Ник владельца' },
    { userId: 'guest', username: 'guest', displayName: 'Ник гостя' },
  ]
  const matchId = '11111111-1111-4111-8111-111111111111'
  const deck = randomLegalDeck(cardCatalog, () => 0.42)
  let state = createMatch({
    matchId,
    catalog: cardCatalog,
    players: profiles.map(profile => ({ userId: profile.userId, displayName: profile.displayName, deck })),
    random: () => 0.25,
  })
  let status = 'active'
  const client = {
    async query(sql, values = []) {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] }
      if (sql.includes('SELECT status,version,state_json')) return { rows: [{ status, version: state.version, state_json: state }] }
      if (sql.includes('SELECT user_id,seat')) return { rows: profiles.map((profile, seat) => ({ user_id: profile.userId, seat })) }
      if (sql.includes('SELECT actor_user_id,request_hash,applied_version')) return { rows: [] }
      if (sql.includes('FROM match_players mp JOIN users u')) return { rows: profiles.map((profile, seat) => ({ seat, user_id: profile.userId, avatar_version: 0, has_avatar: false })) }
      if (sql.startsWith('UPDATE matches')) { status = values[1]; state = JSON.parse(values[3]); return { rows: [] } }
      if (sql.startsWith('INSERT INTO match_commands') || sql === 'COMMIT') return { rows: [] }
      throw new Error(`unexpected SQL: ${sql}`)
    },
    release() {},
  }
  const pool = { async connect() { return client } }
  const rooms = new RoomManager()
  const transport = new RoomTransport()
  const sockets = profiles.map(() => new FakeSocket())
  let handler
  registerRealtime({ get(_path, _options, callback) { handler = callback } }, pool, 'https://example.test', rooms, transport)

  for (let seat = 0; seat < profiles.length; seat++) {
    const profile = profiles[seat]
    const socket = sockets[seat]
    handler(socket, { authSession: { user_id: profile.userId, username: profile.username, display_name: profile.displayName }, cookies: {} })
    socket.message({ type: 'session.hello', payload: { protocolVersion: 1 } })
    await new Promise(resolve => setImmediate(resolve))
  }
  const room = rooms.create('owner').room
  rooms.join('guest', room.code)
  rooms.selectDeck('owner', 'owner-deck', 1, true)
  rooms.selectDeck('guest', 'guest-deck', 1, true)
  rooms.setReady('owner', true, 1)
  rooms.setReady('guest', true, 1)
  rooms.start('owner', matchId)

  sockets[0].message({
    type: 'game.command',
    payload: { matchId, commandId: '22222222-2222-4222-8222-222222222222', expectedVersion: 0, action: 'turn.end', data: { option: 'no_penalty' } },
  })
  await new Promise(resolve => setImmediate(resolve))

  const ownerUpdate = sockets[0].sent.find(packet => packet.type === 'match.updated')?.payload.snapshot
  const guestUpdate = sockets[1].sent.find(packet => packet.type === 'match.updated')?.payload.snapshot
  assert.equal(ownerUpdate.public.current, 1)
  assert.equal(ownerUpdate.private.seat, 0)
  assert.equal(guestUpdate.public.current, 1)
  assert.equal(guestUpdate.private.seat, 1)
  assert.deepEqual(ownerUpdate.public.players.map(player => player.name), ['Ник владельца', 'Ник гостя'])
  assert.equal('hand' in guestUpdate.public.players[0], false)

  sockets.forEach(socket => socket.finish())
})
