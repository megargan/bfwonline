import test from 'node:test'
import assert from 'node:assert/strict'
import { cardCatalog } from '@bfw/game-data'
import { randomLegalDeck } from '@bfw/game-core/deck'
import { startMatchForRoom } from '../src/match-start.ts'
import { RoomManager } from '../src/room-manager.ts'
import { RoomTransport } from '../src/room-transport.ts'

const owner = { userId: 'owner', username: 'owner', displayName: 'Owner' }
const guest = { userId: 'guest', username: 'guest', displayName: 'Guest' }
const deck = randomLegalDeck(cardCatalog, () => 0.42)
const quantities = [...new Set(deck)].map(card_id => ({ card_id, quantity: deck.filter(id => id === card_id).length }))

function setup({ failMatchInsert = false, staleLockedDeck = false } = {}) {
  const rooms = new RoomManager()
  rooms.connect(owner, 'owner-socket')
  rooms.connect(guest, 'guest-socket')
  const room = rooms.create(owner.userId).room
  rooms.join(guest.userId, room.code)
  rooms.selectDeck(owner.userId, 'owner-deck', 1, true)
  rooms.selectDeck(guest.userId, 'guest-deck', 1, true)
  rooms.setReady(owner.userId, true, 1)
  rooms.setReady(guest.userId, true, 1)
  const statements = []
  let matchInserts = 0
  const client = {
    async query(sql, values = []) {
      statements.push({ sql, values })
      if (sql.includes('SELECT d.id,d.revision')) return { rows: [{ id: values[0], revision: 1, ...quantities[0] }, ...quantities.slice(1).map(card => ({ id: values[0], revision: 1, ...card }))] }
      if (sql.includes('SELECT revision FROM decks')) return { rows: [{ revision: staleLockedDeck ? 2 : 1 }] }
      if (sql.includes('SELECT id,state_json FROM matches')) return { rows: [] }
      if (sql.includes('INSERT INTO matches')) {
        matchInserts++
        if (failMatchInsert) throw new Error('write failed')
      }
      return { rows: [] }
    },
    release() { statements.push({ sql: 'RELEASE' }) },
  }
  const pool = {
    query: client.query,
    async connect() { return client },
  }
  const sent = new Map()
  const transport = new RoomTransport()
  for (const profile of [owner, guest]) {
    const messages = []
    sent.set(profile.userId, messages)
    transport.attach(profile.userId, { readyState: 1, send: value => messages.push(JSON.parse(value)) })
  }
  return { rooms, room, pool, transport, statements, sent, get matchInserts() { return matchInserts } }
}

test('starting a ready room commits one private match snapshot even for concurrent start requests', async () => {
  const state = setup()
  const [first, second] = await Promise.all([
    startMatchForRoom(state.pool, state.rooms, state.transport, owner.userId, state.room.id),
    startMatchForRoom(state.pool, state.rooms, state.transport, owner.userId, state.room.id),
  ])
  assert.equal(first.matchId, second.matchId)
  assert.equal(state.rooms.current(owner.userId).status, 'playing')
  assert.equal(state.matchInserts, 1)
  assert.ok(state.statements.some(statement => statement.sql === 'COMMIT'))
  const ownerSnapshot = state.sent.get(owner.userId).find(message => message.type === 'match.snapshot').payload
  const guestSnapshot = state.sent.get(guest.userId).find(message => message.type === 'match.snapshot').payload
  assert.equal(ownerSnapshot.private.hand.length, 4)
  assert.equal('hand' in guestSnapshot.public.players[0], false)
  assert.equal('deck' in ownerSnapshot.private, false)
})

test('database failure rolls back and leaves the room ready to retry', async () => {
  const state = setup({ failMatchInsert: true })
  await assert.rejects(startMatchForRoom(state.pool, state.rooms, state.transport, owner.userId, state.room.id), /write failed/)
  assert.equal(state.rooms.current(owner.userId).status, 'waiting')
  assert.ok(state.statements.some(statement => statement.sql === 'ROLLBACK'))
  assert.equal(state.sent.get(owner.userId).some(message => message.type === 'match.started'), false)
})

test('a deck edited during match preparation cannot enter the match snapshot', async () => {
  const state = setup({ staleLockedDeck: true })
  await assert.rejects(startMatchForRoom(state.pool, state.rooms, state.transport, owner.userId, state.room.id), error => error.code === 'DECK_CHANGED')
  assert.equal(state.rooms.current(owner.userId).status, 'waiting')
  assert.equal(state.matchInserts, 0)
})

test('a room replaced while its decks load cannot receive the old room match', async () => {
  const state = setup()
  let releaseDeckReads
  const deckReadGate = new Promise(resolve => { releaseDeckReads = resolve })
  const pool = {
    ...state.pool,
    async query(sql, values) {
      if (sql.includes('SELECT d.id,d.revision')) await deckReadGate
      return state.pool.query(sql, values)
    },
  }
  const start = startMatchForRoom(pool, state.rooms, state.transport, owner.userId, state.room.id)
  await new Promise(resolve => setImmediate(resolve))

  state.rooms.leave(owner.userId, state.room.id)
  const replacement = state.rooms.create(owner.userId).room
  state.rooms.join(guest.userId, replacement.code)
  state.rooms.selectDeck(owner.userId, 'owner-deck', 1, true)
  state.rooms.selectDeck(guest.userId, 'guest-deck', 1, true)
  state.rooms.setReady(owner.userId, true, 1)
  state.rooms.setReady(guest.userId, true, 1)
  releaseDeckReads()

  await assert.rejects(start, error => error.code === 'PLAYERS_NOT_READY')
  assert.equal(state.rooms.current(owner.userId).id, replacement.id)
  assert.equal(state.rooms.current(owner.userId).status, 'waiting')
  assert.equal(state.matchInserts, 0)
})
