import test from 'node:test'
import assert from 'node:assert/strict'
import { parseClientMessage } from './index.ts'

const id = '915c3b5b-e899-4bd7-a812-2306142ec0f8'
const matchId = '9fdcc87e-11d2-4c72-9cdf-819e3d9c5c8a'

test('validates match command identifiers, version and the concede schema', () => {
  assert.deepEqual(parseClientMessage({ type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 0, action: 'match.concede', data: {} } }), {
    type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 0, action: 'match.concede', data: {} },
  })
  assert.throws(() => parseClientMessage({ type: 'game.command', payload: { matchId, commandId: id, expectedVersion: -1, action: 'match.concede', data: {} } }), { code: 'INVALID_MESSAGE' })
  assert.throws(() => parseClientMessage({ type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 0, action: 'match.concede', data: { winner: 0 } } }), { code: 'INVALID_MESSAGE' })
  const play = { type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 0, action: 'card.play', data: { cardInstanceId: 'ci_1', target: { row: 4, col: 2 }, payment: 'mana' } } }
  assert.deepEqual(parseClientMessage(play).payload.data, play.payload.data)
  const hornyPlay = { ...play, payload: { ...play.payload, data: { ...play.payload.data, horny: true } } }
  assert.deepEqual(parseClientMessage(hornyPlay).payload.data, hornyPlay.payload.data)
  assert.throws(() => parseClientMessage({ ...hornyPlay, payload: { ...hornyPlay.payload, data: { ...hornyPlay.payload.data, horny: 'yes' } } }), { code: 'INVALID_MESSAGE' })
  assert.throws(() => parseClientMessage({ ...play, payload: { ...play.payload, data: { ...play.payload.data, target: { row: 4, col: 5 } } } }), { code: 'INVALID_MESSAGE' })
  assert.throws(() => parseClientMessage({ ...play, payload: { ...play.payload, data: { ...play.payload.data, payment: 'gold' } } }), { code: 'INVALID_MESSAGE' })
})

test('rejects extra envelope fields and validates subscribe/resync messages', () => {
  assert.throws(() => parseClientMessage({ type: 'session.hello', payload: { protocolVersion: 1, userId: 'spoof' } }), { code: 'INVALID_MESSAGE' })
  assert.deepEqual(parseClientMessage({ type: 'match.subscribe', payload: { matchId } }).type, 'match.subscribe')
  assert.deepEqual(parseClientMessage({ type: 'match.resync', payload: { matchId, lastKnownVersion: 4 } }).type, 'match.resync')
})

test('validates ordinary turn ending options and selected discard instance IDs', () => {
  const command = data => ({ type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 3, action: 'turn.end', data } })
  assert.equal(parseClientMessage(command({})).payload.action, 'turn.end')
  assert.deepEqual(parseClientMessage(command({ option: 'no_penalty' })).payload.data, { option: 'no_penalty' })
  assert.deepEqual(parseClientMessage(command({ option: 'discard_and_decrease_limit', discardedCardInstanceIds: ['ci-a', 'ci-b'] })).payload.data, {
    option: 'discard_and_decrease_limit', discardedCardInstanceIds: ['ci-a', 'ci-b'],
  })
  assert.deepEqual(parseClientMessage(command({ option: 'increase_limit_after_round_5' })).payload.data, { option: 'increase_limit_after_round_5' })
  assert.throws(() => parseClientMessage(command({ option: 'discard_and_decrease_limit', discardedCardInstanceIds: ['ci-a', 'ci-a'] })), { code: 'INVALID_MESSAGE' })
  assert.throws(() => parseClientMessage(command({ option: 'no_penalty', discardedCardInstanceIds: ['ci-a'] })), { code: 'INVALID_MESSAGE' })
})

test('validates unit movement intent and board coordinates', () => {
  const data = { unitId: 'unit-1', to: { row: 3, col: 4 } }
  const command = { type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 5, action: 'unit.move', data } }
  assert.deepEqual(parseClientMessage(command).payload.data, data)
  assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data: { ...data, to: { row: 5, col: 0 } } } }), { code: 'INVALID_MESSAGE' })
  assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data: { ...data, to: { row: 0, col: 0, seat: 1 } } } }), { code: 'INVALID_MESSAGE' })
})

test('validates unit attack identifiers and rejects extra targeting data', () => {
  const command = { type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 5, action: 'unit.attack', data: { unitId: 'unit-a', targetUnitId: 'unit-b' } } }
  assert.deepEqual(parseClientMessage(command).payload.data, command.payload.data)
  assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data: { ...command.payload.data, targetUnitId: '' } } }), { code: 'INVALID_MESSAGE' })
  assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data: { ...command.payload.data, damage: 99 } } }), { code: 'INVALID_MESSAGE' })
})

test('validates direct player attack intent', () => {
  const command = { type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 5, action: 'unit.attackPlayer', data: { unitId: 'unit-a' } } }
  assert.deepEqual(parseClientMessage(command), command)
  assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data: { unitId: 'unit-a', damage: 99 } } }), { code: 'INVALID_MESSAGE' })
})

test('validates an indexed unit ability command', () => {
  const command = { type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 5, action: 'ability.use', data: { unitId: 'unit-a', abilityIndex: 1 } } }
  assert.deepEqual(parseClientMessage(command), command)
  const scoreChoice = { ...command, payload: { ...command.payload, data: { ...command.payload.data, scoreAdjustment: -1 } } }
  assert.deepEqual(parseClientMessage(scoreChoice), scoreChoice)
  assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data: { ...command.payload.data, scoreAdjustment: 0 } } }), { code: 'INVALID_MESSAGE' })
  assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data: { unitId: 'unit-a', abilityIndex: -1 } } }), { code: 'INVALID_MESSAGE' })
})

test('validates item equip intent without accepting client stat changes', () => {
  const command = { type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 5, action: 'item.equip', data: { cardInstanceId: 'item-1', targetUnitId: 'unit-a', payment: 'mana' } } }
  assert.deepEqual(parseClientMessage(command), command)
  assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data: { ...command.payload.data, attack: 999 } } }), { code: 'INVALID_MESSAGE' })
})

test('validates saved-card retrieval intent without accepting a source owner or card outcome', () => {
  const command = { type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 5, action: 'card.takeSaved', data: { cardInstanceId: 'saved-card' } } }
  assert.deepEqual(parseClientMessage(command), command)
  for (const data of [{}, { cardInstanceId: '' }, { cardInstanceId: 'x'.repeat(129) }, { cardInstanceId: 'saved-card', owner: 1 }, { cardInstanceId: 'saved-card', card: { Name: 'Injected card' } }]) {
    assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data } }), { code: 'INVALID_MESSAGE' })
  }
})

test('validates targetless spell casts and rejects client supplied effects', () => {
  const command = { type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 5, action: 'spell.cast', data: { cardInstanceId: 'spell-1', payment: 'mana' } } }
  assert.deepEqual(parseClientMessage(command), command)
  assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data: { ...command.payload.data, heal: 999 } } }), { code: 'INVALID_MESSAGE' })
  assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data: { cardInstanceId: 'spell-1', payment: 'mana', targetUnitId: 'enemy' } } }), { code: 'INVALID_MESSAGE' })
})

test('validates the resource choice for «Гнилое ворьё»', () => {
  const command = { type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 5, action: 'spell.cast', data: { cardInstanceId: 'spell-1', payment: 'mana', choice: 'energy' } } }
  assert.deepEqual(parseClientMessage(command), command)
  for (const choice of ['gold', '', null]) assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data: { ...command.payload.data, choice } } }), { code: 'INVALID_MESSAGE' })
})

test('validates an optional integer mana amount for variable-cost spells', () => {
  const command = { type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 5, action: 'spell.cast', data: { cardInstanceId: 'spell-1', payment: 'mana', manaAmount: 3 } } }
  assert.deepEqual(parseClientMessage(command), command)
  for (const manaAmount of [-1, 1.5, 1001, '3']) assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data: { ...command.payload.data, manaAmount } } }), { code: 'INVALID_MESSAGE' })
})

test('validates an optional integer health amount for variable-health spells', () => {
  const command = { type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 5, action: 'spell.cast', data: { cardInstanceId: 'spell-1', payment: 'mana', healthAmount: 4 } } }
  assert.deepEqual(parseClientMessage(command), command)
  for (const healthAmount of [-1, 1.5, 1001, '4']) assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data: { ...command.payload.data, healthAmount } } }), { code: 'INVALID_MESSAGE' })
})

test('validates optional spell target coordinates for server-parsed area spells', () => {
  const command = { type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 5, action: 'spell.cast', data: { cardInstanceId: 'spell-1', payment: 'mana', target: { row: 4, col: 2 } } } }
  assert.deepEqual(parseClientMessage(command), command)
  assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data: { ...command.payload.data, target: { row: 5, col: 2 } } } }), { code: 'INVALID_MESSAGE' })
  assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data: { ...command.payload.data, target: { row: 2, col: 2, damage: 999 } } } }), { code: 'INVALID_MESSAGE' })
})

test('validates unit and player targets for server-parsed damage spells', () => {
  const base = { type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 5, action: 'spell.cast', data: { cardInstanceId: 'spell-1', payment: 'mana' } } }
  for (const target of [{ unitId: 'unit-7' }, { player: 'opponent' }, { player: 'self' }]) assert.deepEqual(parseClientMessage({ ...base, payload: { ...base.payload, data: { ...base.payload.data, target } } }).payload.data.target, target)
  for (const target of [{ unitId: '' }, { player: 'all' }, { unitId: 'unit-7', player: 'opponent' }]) assert.throws(() => parseClientMessage({ ...base, payload: { ...base.payload, data: { ...base.payload.data, target } } }), { code: 'INVALID_MESSAGE' })
})

test('validates bounded hand selections larger than the twenty-five board cells', () => {
  const command = unitIds => ({ type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 5, action: 'choice.resolve', data: { choiceId: 'hand-limit', selection: { unitIds } } } })
  for (const count of [29, 60, 128]) {
    const value = command(Array.from({ length: count }, (_, index) => `card-${index}`))
    assert.deepEqual(parseClientMessage(value), value)
  }
  assert.throws(() => parseClientMessage(command(Array.from({ length: 129 }, (_, index) => `card-${index}`))), { code: 'INVALID_MESSAGE' })
})

test('validates a server-owned choice resolution without accepting effect results', () => {
  const command = { type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 5, action: 'choice.resolve', data: { choiceId: 'choice-1', selection: { unitId: 'unit-1' } } } }
  assert.deepEqual(parseClientMessage(command), command)
  assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data: { ...command.payload.data, selection: { unitId: 'unit-1', health: 999 } } } }), { code: 'INVALID_MESSAGE' })
  const multi = { ...command, payload: { ...command.payload, data: { ...command.payload.data, selection: { unitIds: ['one', 'two', 'three'] } } } }
  assert.deepEqual(parseClientMessage(multi), multi)
  const keepAll = { ...multi, payload: { ...multi.payload, data: { ...multi.payload.data, selection: { unitIds: [] } } } }
  assert.deepEqual(parseClientMessage(keepAll), keepAll)
  assert.throws(() => parseClientMessage({ ...multi, payload: { ...multi.payload, data: { ...multi.payload.data, selection: { unitIds: ['one', 'one'] } } } }), { code: 'INVALID_MESSAGE' })
  const cell = { ...command, payload: { ...command.payload, data: { ...command.payload.data, selection: { cell: { row: 2, col: 2 } } } } }
  assert.deepEqual(parseClientMessage(cell), cell)
  assert.throws(() => parseClientMessage({ ...cell, payload: { ...cell.payload, data: { ...cell.payload.data, selection: { cell: { row: 5, col: 2 } } } } }), { code: 'INVALID_MESSAGE' })
  assert.throws(() => parseClientMessage({ ...cell, payload: { ...cell.payload, data: { ...cell.payload.data, selection: { cell: { row: 2, col: 2, owner: 1 } } } } }), { code: 'INVALID_MESSAGE' })
  const player = { ...command, payload: { ...command.payload, data: { ...command.payload.data, selection: { player: 'opponent' } } } }
  assert.deepEqual(parseClientMessage(player), player)
  const self = { ...player, payload: { ...player.payload, data: { ...player.payload.data, selection: { player: 'self' } } } }
  assert.deepEqual(parseClientMessage(self), self)
  assert.throws(() => parseClientMessage({ ...player, payload: { ...player.payload, data: { ...player.payload.data, selection: { player: 'opponent', health: 0 } } } }), { code: 'INVALID_MESSAGE' })
  const abilityChoice = { ...command, payload: { ...command.payload, data: { ...command.payload.data, selection: { choice: 'draw' } } } }
  assert.deepEqual(parseClientMessage(abilityChoice), abilityChoice)
  assert.throws(() => parseClientMessage({ ...abilityChoice, payload: { ...abilityChoice.payload, data: { ...abilityChoice.payload.data, selection: { choice: 'gain-100-mana' } } } }), { code: 'INVALID_MESSAGE' })
  for (const selection of [{ choice: 'librarian-cost', cost: 1 }, { choice: 'librarian-cost', cost: 2 }, { choice: 'librarian-cost', cost: 4 }, { choice: 'librarian-pile', pile: 'deck' }, { choice: 'librarian-pile', pile: 'discard' }]) {
    const librarian = { ...command, payload: { ...command.payload, data: { ...command.payload.data, selection } } }
    assert.deepEqual(parseClientMessage(librarian), librarian)
  }
  for (const selection of [{ choice: 'librarian-cost', cost: 3 }, { choice: 'librarian-cost', cost: 1, extra: true }, { choice: 'librarian-pile', pile: 'hand' }]) {
    assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data: { ...command.payload.data, selection } } }), { code: 'INVALID_MESSAGE' })
  }
})

test('validates a private gamba resource choice without accepting a client roll', () => {
  const command = { type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 5, action: 'choice.resolve', data: { choiceId: 'dodep-choice', selection: { choice: 'energy' } } } }
  assert.deepEqual(parseClientMessage(command), command)
  for (const choice of ['mana', 'energy']) assert.deepEqual(parseClientMessage({ ...command, payload: { ...command.payload, data: { ...command.payload.data, selection: { choice } } } }).payload.data.selection, { choice })
  for (const choice of ['swarm-mana', 'swarm-draw']) assert.deepEqual(parseClientMessage({ ...command, payload: { ...command.payload, data: { ...command.payload.data, selection: { choice } } } }).payload.data.selection, { choice })
  for (const choice of ['keep', 'discard']) assert.deepEqual(parseClientMessage({ ...command, payload: { ...command.payload, data: { ...command.payload.data, selection: { choice } } } }).payload.data.selection, { choice })
  assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data: { ...command.payload.data, selection: { choice: 'roll', amount: 6 } } } }), { code: 'INVALID_MESSAGE' })
})

test('validates a selected Jex type token class', () => {
  const command = { type: 'game.command', payload: { matchId, commandId: id, expectedVersion: 5, action: 'choice.resolve', data: { choiceId: 'jex-choice', selection: { tokenClass: 2 } } } }
  assert.deepEqual(parseClientMessage(command), command)
  for (const tokenClass of [-1, 6, 2.5]) assert.throws(() => parseClientMessage({ ...command, payload: { ...command.payload, data: { ...command.payload.data, selection: { tokenClass } } } }), { code: 'INVALID_MESSAGE' })
})
