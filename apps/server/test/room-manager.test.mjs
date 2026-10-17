import test from 'node:test'
import assert from 'node:assert/strict'
import { cgroupMemoryOverloaded, RoomError, RoomManager } from '../src/room-manager.ts'
import { RoomTransport } from '../src/room-transport.ts'

const owner = { userId: 'owner', username: 'owner', displayName: 'Owner' }
const guest = { userId: 'guest', username: 'guest', displayName: 'Guest' }
const extra = { userId: 'third', username: 'third', displayName: 'Third' }

test('container memory pressure uses the cgroup limit and ignores unlimited or invalid limits', () => {
  assert.equal(cgroupMemoryOverloaded('1000', '849'), false)
  assert.equal(cgroupMemoryOverloaded('1000', '850'), true)
  assert.equal(cgroupMemoryOverloaded('max', '950'), null)
  assert.equal(cgroupMemoryOverloaded('9223372036854771712', '950'), null)
  assert.equal(cgroupMemoryOverloaded('invalid', '950'), null)
})

function startMatch(rooms, matchId) {
  rooms.selectDeck(owner.userId, 'owner-deck', 1, true)
  rooms.selectDeck(guest.userId, 'guest-deck', 1, true)
  rooms.setReady(owner.userId, true, 1)
  rooms.setReady(guest.userId, true, 1)
  rooms.start(owner.userId, matchId)
}

function activeRoom() {
  const rooms = new RoomManager()
  rooms.connect(owner, 'o1', 0)
  rooms.connect(guest, 'g1', 0)
  const room = rooms.create(owner.userId, 0).room
  rooms.join(guest.userId, room.code, 1)
  startMatch(rooms, 'active-match')
  return rooms
}

test('allows two connected players, blocks a third, and preserves owner room after guest leave', () => {
  const rooms = new RoomManager()
  rooms.connect(owner, 'socket-owner', 0)
  rooms.connect(guest, 'socket-guest', 0)
  rooms.connect(extra, 'socket-third', 0)
  const created = rooms.create(owner.userId, 0).room
  rooms.selectDeck(owner.userId, 'private-owner-deck', 3, true)
  const joined = rooms.join(guest.userId, created.code.toLowerCase(), 1)
  assert.equal(joined.participants.length, 2)
  const updates = rooms.roomUpdates(created.id)
  assert.equal(updates.find(update => update.userId === owner.userId).view.myDeckId, 'private-owner-deck')
  assert.equal(updates.find(update => update.userId === guest.userId).view.myDeckId, null)
  const ownerMessages = []
  const guestMessages = []
  const transport = new RoomTransport()
  transport.attach(owner.userId, { readyState: 1, send: message => ownerMessages.push(JSON.parse(message)) })
  transport.attach(guest.userId, { readyState: 1, send: message => guestMessages.push(JSON.parse(message)) })
  transport.publish(updates)
  assert.equal(ownerMessages[0].payload.myDeckId, 'private-owner-deck')
  assert.equal(guestMessages[0].payload.myDeckId, null)
  assert.throws(() => rooms.join(extra.userId, created.code, 2), error => error instanceof RoomError && error.code === 'ROOM_FULL')
  rooms.leave(guest.userId)
  assert.equal(rooms.current(owner.userId).participants.length, 1)
  assert.equal(rooms.current(guest.userId), null)
  assert.equal(rooms.join(extra.userId, created.code, 3).participants.length, 2)
})

test('owner leaving a room removes its code and both memberships immediately', () => {
  const rooms = new RoomManager()
  rooms.connect(owner, 'socket-owner', 0)
  rooms.connect(guest, 'socket-guest', 0)
  rooms.connect(extra, 'socket-third', 0)
  const created = rooms.create(owner.userId, 0).room
  rooms.join(guest.userId, created.code, 1)

  const exit = rooms.leave(owner.userId)

  assert.equal(exit.roomId, created.id)
  assert.deepEqual(exit.closedUserIds, [guest.userId])
  assert.equal(rooms.current(owner.userId), null)
  assert.equal(rooms.current(guest.userId), null)
  assert.throws(() => rooms.join(extra.userId, created.code, 2), error => error.code === 'ROOM_NOT_FOUND')
})

test('room creation refuses heap overload without preventing access to an existing room', () => {
  let overloaded = false
  const rooms = new RoomManager(() => overloaded)
  rooms.connect(owner, 'socket-owner', 0)
  rooms.connect(guest, 'socket-guest', 0)
  const room = rooms.create(owner.userId, 0).room

  overloaded = true
  assert.equal(rooms.create(owner.userId, 1).room.id, room.id)
  assert.throws(() => rooms.join(guest.userId, room.code, 1), error => error instanceof RoomError && error.code === 'SERVER_BUSY')
  assert.equal(rooms.current(owner.userId).participants.length, 1)
  rooms.leave(owner.userId)
  assert.throws(() => rooms.create(owner.userId, 2), error => error instanceof RoomError && error.code === 'SERVER_BUSY')
  assert.equal(rooms.current(owner.userId), null)
})

test('heap overload permits reconnecting a disconnected room seat only within its grace period', () => {
  let overloaded = false
  const rooms = new RoomManager(() => overloaded)
  rooms.connect(owner, 'socket-owner', 0)
  const room = rooms.create(owner.userId, 0).room
  overloaded = true
  assert.equal(rooms.connectionAllowed(owner.userId, 0), false)

  rooms.disconnect(owner.userId, 'socket-owner', 100)
  assert.equal(rooms.connectionAllowed(owner.userId, 15_099), true)
  assert.equal(rooms.connectionAllowed(owner.userId, 15_100), false)
  assert.equal(rooms.current(owner.userId).id, room.id)
})

test('stale room requests cannot mutate or leave a replacement room', () => {
  const rooms = new RoomManager(() => false)
  rooms.connect(owner, 'socket-owner', 0)
  const oldRoom = rooms.create(owner.userId, 0).room
  rooms.leave(owner.userId, oldRoom.id)
  const newRoom = rooms.create(owner.userId, 1).room

  assert.throws(() => rooms.selectDeck(owner.userId, 'stale-deck', 1, true, oldRoom.id), error => error.code === 'ROOM_NOT_FOUND')
  assert.throws(() => rooms.setReady(owner.userId, true, 1, oldRoom.id), error => error.code === 'ROOM_NOT_FOUND')
  assert.throws(() => rooms.leave(owner.userId, oldRoom.id), error => error.code === 'ROOM_NOT_FOUND')
  assert.equal(rooms.current(owner.userId).id, newRoom.id)
  assert.equal(rooms.current(owner.userId).myDeckId, null)
})

test('accepts exactly one of two simultaneous guests', async () => {
  const rooms = new RoomManager()
  rooms.connect(owner, 'o', 0)
  rooms.connect(guest, 'g', 0)
  rooms.connect(extra, 'x', 0)
  const room = rooms.create(owner.userId, 0).room
  const joined = await Promise.allSettled([
    Promise.resolve().then(() => rooms.join(guest.userId, room.code, 1)),
    Promise.resolve().then(() => rooms.join(extra.userId, room.code, 1)),
  ])
  assert.equal(joined.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(joined.filter(result => result.status === 'rejected').length, 1)
  assert.equal(rooms.current(owner.userId).participants.length, 2)
})

test('requires both online players to ready the selected playable deck before owner start', () => {
  const rooms = new RoomManager()
  rooms.connect(owner, 'o', 0)
  rooms.connect(guest, 'g', 0)
  rooms.connect(extra, 'x', 0)
  const room = rooms.create(owner.userId, 0).room
  rooms.join(guest.userId, room.code, 1)
  rooms.selectDeck(owner.userId, 'deck-owner', 3, true)
  rooms.selectDeck(guest.userId, 'deck-guest', 8, true)
  assert.throws(() => rooms.setReady(owner.userId, true, 2), error => error.code === 'DECK_CHANGED')
  rooms.setReady(owner.userId, true, 3)
  assert.throws(() => rooms.start(owner.userId, 'match'), error => error.code === 'PLAYERS_NOT_READY')
  rooms.setReady(guest.userId, true, 8)
  assert.equal(rooms.start(owner.userId, 'match').matchId, 'match')
  assert.equal(rooms.start(owner.userId, 'another-match').matchId, 'match')
  assert.throws(() => rooms.start(guest.userId, 'other'), error => error.code === 'OWNER_ONLY')
  const exit = rooms.leave(guest.userId)
  assert.equal(exit.endedMatchId, 'match')
  assert.equal(rooms.current(owner.userId).status, 'waiting')
  assert.equal(rooms.join(extra.userId, room.code, 2).participants.length, 2)
})

test('reconnect deadline is enforced; creator grace removes room and guest grace frees the seat', () => {
  const rooms = new RoomManager()
  rooms.connect(owner, 'o1', 0)
  rooms.connect(guest, 'g1', 0)
  const room = rooms.create(owner.userId, 0).room
  rooms.join(guest.userId, room.code, 1)
  rooms.disconnect(guest.userId, 'g1', 100)
  rooms.expireDisconnected(60_099)
  assert.equal(rooms.current(guest.userId).participants[1].connected, false)
  const [guestExpired] = rooms.expireDisconnected(60_100)
  assert.equal(guestExpired.reason, 'guest_disconnected')
  assert.equal(rooms.current(guest.userId), null)
  assert.equal(rooms.current(owner.userId).participants.length, 1)

  rooms.disconnect(owner.userId, 'o1', 70_000)
  assert.ok(rooms.connect(owner, 'o2', 84_999))
  rooms.disconnect(owner.userId, 'o2', 85_000)
  rooms.expireDisconnected(100_000)
  assert.equal(rooms.current(owner.userId), null)
  assert.equal(rooms.connect(owner, 'o3', 100_000), null)
  assert.equal(rooms.current(owner.userId), null)
})

test('guest and creator reconnect windows preserve the active match', () => {
  const rooms = activeRoom()

  rooms.disconnect(guest.userId, 'g1', 100)
  const guestReconnect = rooms.connect(guest, 'g2', 60_099)
  assert.equal(guestReconnect.status, 'playing')
  assert.equal(guestReconnect.matchId, 'active-match')

  rooms.disconnect(owner.userId, 'o1', 70_000)
  const ownerReconnect = rooms.connect(owner, 'o2', 84_999)
  assert.equal(ownerReconnect.status, 'playing')
  assert.equal(ownerReconnect.matchId, 'active-match')
  assert.equal(rooms.current(guest.userId).matchId, 'active-match')
})

test('guest timeout aborts the active match and keeps the room for its owner', () => {
  const rooms = activeRoom()
  rooms.disconnect(guest.userId, 'g1', 100)

  const [event] = rooms.expireDisconnected(60_100)

  assert.equal(event.matchId, 'active-match')
  assert.equal(event.reason, 'guest_disconnected')
  assert.equal(rooms.current(guest.userId), null)
  assert.equal(rooms.current(owner.userId).status, 'waiting')
  assert.equal(rooms.current(owner.userId).matchId, null)
  assert.equal(rooms.current(owner.userId).code !== null, true)
})

test('late creator reconnect starts a fresh session but cannot restore the room or match', () => {
  const rooms = activeRoom()
  rooms.disconnect(owner.userId, 'o1', 100)

  const newSessionRoom = rooms.connect(owner, 'o2', 15_100)
  const [event] = rooms.takeLifecycleEvents()

  assert.equal(event.matchId, 'active-match')
  assert.equal(event.reason, 'owner_disconnected')
  assert.equal(newSessionRoom, null)
  assert.equal(rooms.current(owner.userId), null)
  assert.equal(rooms.current(guest.userId), null)
  assert.notEqual(rooms.create(owner.userId, 15_101).room.id, event.roomId)
})

test('finishing a match returns both players to the lobby and clears readiness', () => {
  const rooms = new RoomManager()
  rooms.connect(owner, 'o')
  rooms.connect(guest, 'g')
  const room = rooms.create(owner.userId).room
  rooms.join(guest.userId, room.code)
  rooms.selectDeck(owner.userId, 'owner-deck', 1, true)
  rooms.selectDeck(guest.userId, 'guest-deck', 1, true)
  rooms.setReady(owner.userId, true, 1)
  rooms.setReady(guest.userId, true, 1)
  rooms.start(owner.userId, 'match-id')
  const updates = rooms.finishMatch(guest.userId, 'match-id')
  assert.equal(updates.length, 2)
  assert.equal(rooms.current(owner.userId).status, 'waiting')
  assert.equal(rooms.current(owner.userId).matchId, null)
  assert.equal(rooms.current(owner.userId).participants.every(player => !player.ready), true)
})
