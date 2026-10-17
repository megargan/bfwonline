import test from 'node:test'
import assert from 'node:assert/strict'
import { applyStatBuff, effectiveUnitSpeed, resolveFlipTrigger } from './card-effects.ts'
import { applyMovementStateTriggers } from './movement.ts'

test('energy buffs lower movement cost, with a floor of one except for original zero-cost cards', () => {
  for (const base of [0, 1, 3]) {
    const unit = { card: { Name: 'Существо', Speed: base }, shield: false, attack: 1, health: 3, maxHealth: 3, speed: base }
    for (const bonus of [1, 3, 10]) {
      const buffed = applyStatBuff(unit, bonus)
      assert.equal(effectiveUnitSpeed(buffed), Math.max(base === 0 ? 0 : 1, base - bonus))
      assert.equal(effectiveUnitSpeed({ ...buffed, energyCostReduction: 10 }), base === 0 ? 0 : 1)
    }
    assert.equal(effectiveUnitSpeed(resolveFlipTrigger('.Хихо', unit).state), Math.max(base === 0 ? 0 : 1, base - 1))
  }
  assert.equal(effectiveUnitSpeed({ card: { Name: 'Существо', Speed: 3 }, shield: false, speed: 0 }), 1)
})

test('stacked Doggo bonuses preserve permanent reductions when temporary buffs expire at the floor', () => {
  const doggo = { id: 'doggo', card: { Name: 'Догго', Type: 0, Speed: 5 }, owner: 0, row: 2, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 5, shield: false }
  const mover = { ...doggo, id: 'mover', card: { Name: 'Существо', Type: 0, Speed: 1 }, col: 1 }
  const state = { board: [doggo, mover], players: [{ mana: 0, deck: [], hand: [] }] }
  for (let i = 0; i < 7; i++) applyMovementStateTriggers(state, mover, mover.row, 0, 1, () => {})
  Object.assign(doggo, applyStatBuff(doggo, 1))
  assert.equal(effectiveUnitSpeed(doggo), 1)
  doggo.speed += doggo.doggoBuffs
  doggo.doggoBuffs = 0
  assert.equal(effectiveUnitSpeed(doggo), 4)
})
