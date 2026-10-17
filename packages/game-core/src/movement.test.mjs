import test from 'node:test'
import assert from 'node:assert/strict'
import { applyMovementStateTriggers } from './movement.ts'

test('shared movement triggers collect wheat, draw for Basil and buff Doggo', () => {
  const doggo = { id: 'doggo', card: { Name: 'Догго', Type: 0 }, owner: 0, row: 2, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1 }
  const mover = { id: 'basil', card: { Name: 'Базилик', Type: 0 }, owner: 1, row: 3, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1 }
  const drawn = { Id: 'top-card', instanceId: 'top-card', Name: 'Top', Type: 0 }
  const state = {
    board: [doggo, mover],
    players: [{ mana: 0, deck: [], hand: [] }, { mana: 0, deck: [drawn], hand: [] }],
    wheatTokens: [{ row: 3, col: 2 }],
  }

  const result = applyMovementStateTriggers(state, mover, 4, 0, 1, () => {})

  assert.equal(result.wheatCollected, true)
  assert.equal(result.basilDraw, true)
  assert.equal(state.players[1].mana, 1)
  assert.deepEqual(state.wheatTokens, [])
  assert.deepEqual([doggo.attack, doggo.health, doggo.maxHealth, doggo.speed, doggo.doggoBuffs], [2, 4, 4, 0, 1])
  assert.equal(state.players[1].deck.length, 0)
  assert.deepEqual(state.players[1].hand, [drawn])
})
