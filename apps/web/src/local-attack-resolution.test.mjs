import test from 'node:test'
import assert from 'node:assert/strict'
import { createAttackResolutionState, queuePendingDeath } from './local-attack-resolution.ts'

test('local matches keep independent attack death queues', () => {
  const first = createAttackResolutionState()
  const second = createAttackResolutionState()
  const unit = { id: 'unit-1' }

  first.depth++
  queuePendingDeath(first, unit, { burn: true }, false)

  assert.equal(first.depth, 1)
  assert.equal(first.pendingDeaths.length, 1)
  assert.equal(second.depth, 0)
  assert.deepEqual(second.pendingDeaths, [])
})

test('duplicate lethal callbacks merge death options into one queued resolution', () => {
  const state = createAttackResolutionState()
  const unit = { id: 'unit-1' }
  const killer = { id: 'killer' }

  queuePendingDeath(state, unit, { burn: true }, false)
  queuePendingDeath(state, { id: unit.id }, { flipTurns: 2, killer }, true)

  assert.equal(state.pendingDeaths.length, 1)
  assert.deepEqual(state.pendingDeaths[0].options, { burn: true, flipTurns: 2, killer })
  assert.equal(state.pendingDeaths[0].explicitlyDestroyed, true)
})
