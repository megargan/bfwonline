import test from 'node:test'
import assert from 'node:assert/strict'
import { RoomTransport } from '../src/room-transport.ts'
const { sendSocketMessage } = await import('../src/room-transport.ts')

test('closes slow clients and oversized snapshots instead of buffering them', () => {
  const transport = new RoomTransport()
  const closed = []
  const sent = []
  const socket = { readyState: 1, bufferedAmount: 2_097_153, send: value => sent.push(value), close: (...args) => closed.push(args) }
  transport.attach('player', socket)
  transport.send('player', 'match.snapshot', {})
  assert.equal(sent.length, 0)
  assert.deepEqual(closed.pop(), [1013, 'slow client'])

  socket.bufferedAmount = 0
  transport.send('player', 'match.snapshot', 'x'.repeat(1_048_576))
  assert.equal(sent.length, 0)
  assert.deepEqual(closed.pop(), [1009, 'message too large'])

  socket.bufferedAmount = 1_500_000
  transport.send('player', 'match.snapshot', 'x'.repeat(600_000))
  assert.equal(sent.length, 0)
  assert.deepEqual(closed.pop(), [1013, 'slow client'])
})

test('direct WebSocket replies apply the same size and backpressure limits as room updates', () => {
  assert.equal(typeof sendSocketMessage, 'function')
  const closed = []
  const sent = []
  const socket = { readyState: 1, bufferedAmount: 0, send: value => sent.push(value), close: (...args) => closed.push(args) }

  sendSocketMessage(socket, 'match.snapshot', { data: 'x'.repeat(1_050_000) })
  assert.deepEqual(closed.pop(), [1009, 'message too large'])
  assert.equal(sent.length, 0)

  socket.bufferedAmount = 2_097_100
  sendSocketMessage(socket, 'command.ack', { commandId: 'command-1' })
  assert.deepEqual(closed.pop(), [1013, 'slow client'])
  assert.equal(sent.length, 0)
})
