import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { RoomManager } from '../src/room-manager.ts'
import { registerRoomRoutes } from '../src/room-routes.ts'
import { RoomTransport } from '../src/room-transport.ts'

test('leaving a room closes local access and queues match abort when PostgreSQL is unavailable', async t => {
  const owner = { userId: 'owner', username: 'owner', displayName: 'Owner' }
  const guest = { userId: 'guest', username: 'guest', displayName: 'Guest' }
  const rooms = new RoomManager(() => false)
  rooms.connect(owner, 'owner-socket')
  rooms.connect(guest, 'guest-socket')
  const room = rooms.create(owner.userId).room
  rooms.join(guest.userId, room.code)
  rooms.selectDeck(owner.userId, 'owner-deck', 1, true)
  rooms.selectDeck(guest.userId, 'guest-deck', 1, true)
  rooms.setReady(owner.userId, true, 1)
  rooms.setReady(guest.userId, true, 1)
  const matchId = '11111111-1111-4111-8111-111111111111'
  rooms.start(owner.userId, matchId)

  const queued = []
  const app = Fastify()
  app.decorateRequest('authSession', null)
  registerRoomRoutes(
    app,
    { async query() { throw new Error('database unavailable') } },
    'https://example.test',
    rooms,
    new RoomTransport(),
    async request => { request.authSession = { user_id: owner.userId, csrf_token: 'csrf' } },
    (id, reason) => queued.push([id, reason]),
  )
  t.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/rooms/${room.id}/leave`,
    headers: { origin: 'https://example.test', 'x-csrf-token': 'csrf' },
  })
  assert.equal(response.statusCode, 503)
  assert.equal(rooms.current(owner.userId), null)
  assert.deepEqual(queued, [[matchId, 'owner_left']])
})
