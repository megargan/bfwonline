import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldApplyMatchSnapshot, shouldApplyRoomView } from './online-snapshot.ts'

const snapshot = (id, version) => ({ public: { id, version } })

test('snapshot acceptance rejects older and unrelated room state but accepts a newer version', () => {
  const current = snapshot('match-1', 4)

  assert.equal(shouldApplyMatchSnapshot('match-1', current, snapshot('match-1', 3)), false)
  assert.equal(shouldApplyMatchSnapshot('match-2', current, snapshot('match-1', 5)), false)
  assert.equal(shouldApplyMatchSnapshot('match-1', current, snapshot('match-1', 5)), true)
  assert.equal(shouldApplyMatchSnapshot('match-1', null, snapshot('match-1', 0)), true)
  assert.equal(shouldApplyMatchSnapshot('match-2', current, snapshot('match-2', 0)), true)
})

test('room view acceptance rejects stale revisions for the same room', () => {
  const current = { id: 'room-1', revision: 8 }

  assert.equal(shouldApplyRoomView(current, { id: 'room-1', revision: 7 }), false)
  assert.equal(shouldApplyRoomView(current, { id: 'room-1', revision: 8 }), true)
  assert.equal(shouldApplyRoomView(current, { id: 'room-1', revision: 9 }), true)
  assert.equal(shouldApplyRoomView(current, { id: 'room-2', revision: 1 }), true)
  assert.equal(shouldApplyRoomView(null, { id: 'room-1', revision: 1 }), true)
})
