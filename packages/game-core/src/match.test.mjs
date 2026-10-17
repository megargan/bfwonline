import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCommand, createMatch, projectForPlayer } from './match.ts'
import { abilityDescriptions, effectiveUnitSpeed, entryTargetOperation, startTurnEffect, supportedEntryEffect, targetedAbilityOperation } from './card-effects.ts'
import realCatalog from '../../../reference/cards.json' with { type: 'json' }

const catalog = Array.from({ length: 30 }, (_, index) => ({
  Id: `card-${index}`, Name: `Card ${index}`, Description: '', Rarity: index < 15 ? 0 : index < 27 ? 1 : 2,
  Class: index % 2, Type: 0, Attack: 1, Health: 1, Speed: 1, Cost: index % 3,
}))
const deck = catalog.map(card => card.Id)
const input = {
  matchId: 'match-1',
  players: [
    { userId: 'user-1', displayName: 'Player One', deck },
    { userId: 'user-2', displayName: 'Player Two', deck },
  ],
  catalog,
  random: () => 0.3,
}

function turnUnit(name, owner, row, col, changes = {}) {
  const card = realCatalog.find(card => card.Name === name)
  assert.ok(card, `catalog card: ${name}`)
  return { id: `turn_${name}_${owner}`, card: { ...card, instanceId: `board_${name}_${owner}` }, owner, row, col, health: card.Health, maxHealth: card.Health, attack: card.Attack, speed: card.Speed, summoned: 0, attacks: 0, blackTokens: 0, ...changes }
}

test('every playable catalog card reaches its normal command validation without an unsupported-effect rejection', () => {
  const playable = realCatalog.filter(card => !card.Tags?.includes('в разработке'))
  for (const card of playable) {
    const match = createMatch(input)
    const instance = { ...card, instanceId: `probe-${card.Id}` }
    match.players[0].hand = [instance]
    match.players[0].mana = 100
    match.players[0].health = 100
    if (card.Type === 1) match.board.push({ id: 'probe-target', card: { ...catalog[0], instanceId: 'probe-target-card' }, owner: 0, row: 3, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })
    const action = card.Type === 1 ? 'item.equip' : card.Type === 2 ? 'spell.cast' : 'card.play'
    const data = card.Type === 1
      ? { cardInstanceId: instance.instanceId, targetUnitId: 'probe-target', payment: 'mana' }
      : card.Type === 2
        ? { cardInstanceId: instance.instanceId, payment: 'mana' }
        : { cardInstanceId: instance.instanceId, target: { row: card.Type === 0 ? 4 : 2, col: 2 }, payment: 'mana' }
    try { applyCommand(match, 0, { action, data }, () => 0.4) }
    catch (error) {
      assert.notEqual(error.code, 'UNSUPPORTED_EFFECT', card.Name)
      assert.equal(typeof error.code, 'string', `${card.Name} leaked an unhandled runtime exception: ${error}`)
    }
  }
})

test('playable entry effects not handled by the shared parser are explicit card-specific rules', () => {
  const cards = realCatalog.filter(card => !card.Tags?.includes('в разработке') && [0, 3].includes(card.Type) && /(?:^|\r?\n)Вход:/iu.test(card.Description ?? ''))
  assert.deepEqual(cards.filter(card => !supportedEntryEffect(card.Description ?? '')).map(card => card.Name), [
    'Hameleonew', 'Lazerwygs34', 'Бараш', 'Безумный манекен', 'Бёрдли', 'Вискас',
    'Висмут Шифера', 'ГендаБосс', 'Железная няня', 'Жёлтый алмаз', 'Жёлтый', 'Индиголит',
    'Исчезающий парень', 'Турбот',
  ])
})

test('every playable creature and item crown reaches server attack resolution', () => {
  const cards = realCatalog.filter(card => !card.Tags?.includes('в разработке') && /(?:^|\r?\n)Коронный(?:\s+и\s+Ловушка)?\s*:/iu.test(card.Description ?? ''))
  for (const card of cards) {
    const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
    const sourceCard = card.Type === 1 ? { ...catalog[0], instanceId: `crown-host-${card.Id}` } : { ...card, instanceId: `crown-${card.Id}` }
    const source = { id: `crown-source-${card.Id}`, card: sourceCard, ...(card.Type === 1 ? { item: { ...card, instanceId: `crown-item-${card.Id}` } } : {}), owner: 0, row: 3, col: 2, health: 30, maxHealth: 30, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
    const target = { id: `crown-target-${card.Id}`, card: { ...catalog[1], instanceId: `crown-target-card-${card.Id}` }, owner: 1, row: 2, col: 2, health: 100, maxHealth: 100, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
    match.board = [source, target]
    if (card.Name === 'TheVolkeR') match.players[0].saved = [{ ...realCatalog.find(saved => saved.Name === '@.hiho'), instanceId: 'crown-saved-spell' }]
    try { applyCommand(match, 0, { action: 'unit.attack', data: { unitId: source.id, targetUnitId: target.id } }, () => 0.5) }
    catch (error) {
      assert.notEqual(error.code, 'UNSUPPORTED_EFFECT', `${card.Name}: ${card.Description}`)
      assert.equal(typeof error.code, 'string', `${card.Name} leaked an unhandled runtime exception: ${error}`)
    }
  }
})

test('every playable catalog trap reaches server attack resolution without an unsupported-effect rejection', () => {
  const traps = realCatalog.filter(card => !card.Tags?.includes('в разработке') && /(?:^|\r?\n)(?:Ловушка|Коронный\s+и\s+Ловушка)\s*:/iu.test(card.Description ?? ''))
  assert.deepEqual(traps.map(card => card.Name).sort(), ['Админский арбалет', 'Джон совиный дом', 'Кекич', 'Оранжевая', 'Pantlessterrorist', 'Собирающий жук'].sort())
  for (const card of traps) {
    const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
    const host = card.Type === 1 ? catalog[0] : card
    const defender = { id: `trap-defender-${card.Id}`, card: { ...host, instanceId: `trap-host-card-${card.Id}` }, ...(card.Type === 1 ? { item: { ...card, instanceId: `trap-item-${card.Id}` } } : {}), owner: 1, row: 3, col: 2, health: 20, maxHealth: 20, attack: 4, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
    if (card.Name === 'Собирающий жук') defender.item = { ...catalog[2], Name: 'Test item', Type: 1, instanceId: `trap-loot-${card.Id}` }
    match.board = [
      { id: `trap-attacker-${card.Id}`, card: { ...catalog[1], instanceId: `trap-attacker-card-${card.Id}` }, owner: 0, row: 4, col: 2, health: 20, maxHealth: 20, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
      defender,
    ]
    const attackingPlayerHealth = match.players[0].health
    let result
    try {
      result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: `trap-attacker-${card.Id}`, targetUnitId: `trap-defender-${card.Id}` } }, () => 0.5)
    } catch (error) {
      assert.notEqual(error.code, 'UNSUPPORTED_EFFECT', `${card.Name}: ${card.Description}`)
      assert.fail(`${card.Name}: attack fixture failed with ${error.code}`)
    }
    const attacker = result.state.board.find(unit => unit.id === `trap-attacker-${card.Id}`)
    const resolvedDefender = result.state.board.find(unit => unit.id === `trap-defender-${card.Id}`)
    if (card.Name === 'Pantlessterrorist') assert.equal(attacker?.health, 20, card.Name)
    if (card.Name === 'Собирающий жук') {
      assert.equal(attacker?.item?.Name, 'Test item', card.Name)
      assert.equal(resolvedDefender?.attack, 6, card.Name)
    }
    if (card.Name === 'Админский арбалет' || card.Name === 'Кекич') {
      assert.equal(attacker, undefined, card.Name)
      assert.ok(result.state.players[0].discard.some(discarded => discarded.Name === catalog[1].Name), card.Name)
    }
    if (card.Name === 'Джон совиный дом') assert.equal(attacker?.owner, 1, card.Name)
    if (card.Name === 'Оранжевая') assert.equal(result.state.players[0].health, attackingPlayerHealth - 2, card.Name)
  }
})

test('every playable catalog death effect reaches server death resolution', () => {
  const cards = realCatalog.filter(card => !card.Tags?.includes('в разработке') && card.Description?.includes('Посмертно:'))
  assert.deepEqual(cards.map(card => card.Name).sort(), ['Бёрдли', 'Броненосец', 'Ваня Веремеев', 'Висмут Шифера', 'Горящий тромбик', 'Горыныч', 'ДастАроникс', 'Диохазавр', 'Дрон', 'Ёжик', 'ИНТИВИ', 'Крипер', 'Новички', 'Ноэль', 'Обсидиан пчёла', 'Оранжевая', 'Подрывник', 'Янгуша'].sort())
  for (const card of cards) {
    const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
    const host = card.Type === 1 ? catalog[0] : card
    match.players[1].health = 40
    match.players[1].hand = [{ ...realCatalog.find(candidate => candidate.Type === 2), instanceId: `death-spell-${card.Id}` }]
    match.players[1].discard = [{ ...realCatalog.find(candidate => candidate.Type === 2), instanceId: `death-discard-spell-${card.Id}` }]
    match.board = [
      { id: `death-attacker-${card.Id}`, card: { ...catalog[1], Description: 'Досягаемость', instanceId: `death-attacker-card-${card.Id}` }, owner: 0, row: 4, col: 2, health: 100, maxHealth: 100, attack: 100, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
      { id: `death-target-${card.Id}`, card: { ...host, Description: (host.Description ?? '').replace('Клоун', ''), instanceId: `death-target-card-${card.Id}` }, ...(card.Type === 1 ? { item: { ...card, Description: (card.Description ?? '').replace('Клоун', ''), instanceId: `death-item-${card.Id}` } } : {}), owner: 1, row: 3, col: 2, health: 1, maxHealth: 1, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    ]
    try {
      applyCommand(match, 0, { action: 'unit.attack', data: { unitId: `death-attacker-${card.Id}`, targetUnitId: `death-target-${card.Id}` } }, () => 0.5)
    } catch (error) {
      assert.notEqual(error.code, 'UNSUPPORTED_EFFECT', `${card.Name}: ${card.Description}`)
      assert.fail(`${card.Name}: attack fixture failed with ${error.code}`)
    }
  }
})

test('Ёжик privately selects a target to damage and weaken after death', () => {
  const hedgehog = realCatalog.find(card => card.Name === 'Ёжик')
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const target = { id: 'hedgehog-target', card: { ...catalog[2], instanceId: 'hedgehog-target-card' }, owner: 0, row: 2, col: 1, health: 5, maxHealth: 5, attack: 4, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  match.board = [
    { id: 'hedgehog-killer', card: { ...catalog[1], instanceId: 'hedgehog-killer-card' }, owner: 0, row: 3, col: 2, health: 20, maxHealth: 20, attack: 100, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'hedgehog', card: { ...hedgehog, instanceId: 'hedgehog-card' }, owner: 1, row: 4, col: 2, health: 1, maxHealth: 1, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }, target,
  ]
  const died = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'hedgehog-killer', targetUnitId: 'hedgehog' } })
  assert.equal(died.state.pendingChoice.kind, 'death-weaken-target')
  assert.ok(projectForPlayer(died.state, 1).private.pendingChoice.options.some(option => option.unitId === 'hedgehog-target'))
  assert.equal(projectForPlayer(died.state, 0).private.pendingChoice, null)
  const resolved = applyCommand(died.state, 1, { action: 'choice.resolve', data: { choiceId: died.state.pendingChoice.id, selection: { unitId: target.id } } })
  assert.equal(resolved.state.board.find(unit => unit.id === target.id).health, 4)
  assert.equal(resolved.state.board.find(unit => unit.id === target.id).attack, 3)
  const playerHit = applyCommand(died.state, 1, { action: 'choice.resolve', data: { choiceId: died.state.pendingChoice.id, selection: { player: 'opponent' } } })
  assert.equal(playerHit.state.players[0].health, died.state.players[0].health - 1)
})

test('Бёрдли flips for three rounds instead of entering the discard pile on death', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Бёрдли')
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  match.board = [
    { id: 'birdli-killer', card: { ...catalog[1], Description: 'Досягаемость', instanceId: 'birdli-killer-card' }, owner: 0, row: 4, col: 2, health: 20, maxHealth: 20, attack: 100, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'birdli', card: { ...card, instanceId: 'birdli-card' }, owner: 1, row: 3, col: 2, health: 1, maxHealth: 1, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  ]
  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'birdli-killer', targetUnitId: 'birdli' } })
  assert.equal(result.state.board.find(unit => unit.id === 'birdli')?.flippedTurns, 3)
  assert.equal(result.state.players[1].discard.some(candidate => candidate.instanceId === 'birdli-card'), false)
})

test('Горящий тромбик burns the only flipped card when it dies', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Горящий тромбик')
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  match.board = [
    { id: 'burn-killer', card: { ...catalog[1], Description: 'Досягаемость', instanceId: 'burn-killer-card' }, owner: 0, row: 4, col: 2, health: 20, maxHealth: 20, attack: 100, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'burning-trombik', card: { ...card, instanceId: 'burning-trombik-card' }, owner: 1, row: 3, col: 2, health: 1, maxHealth: 1, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'flipped-target', card: { ...catalog[2], instanceId: 'flipped-target-card' }, owner: 1, row: 3, col: 1, health: 0, maxHealth: 3, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0, flippedTurns: 2 },
  ]
  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'burn-killer', targetUnitId: 'burning-trombik' } })
  assert.equal(result.state.board.some(unit => unit.id === 'flipped-target'), false)
  assert.ok(result.state.players[1].burned.some(candidate => candidate.instanceId === 'flipped-target-card'))
  assert.equal(result.state.pendingChoice, undefined)
})

test('Горящий тромбик privately asks its owner which flipped card to burn', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Горящий тромбик')
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  match.board = [
    { id: 'burn-killer-choice', card: { ...catalog[1], Description: 'Досягаемость', instanceId: 'burn-killer-choice-card' }, owner: 0, row: 4, col: 2, health: 20, maxHealth: 20, attack: 100, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'burning-trombik-choice', card: { ...card, instanceId: 'burning-trombik-choice-card' }, owner: 1, row: 3, col: 2, health: 1, maxHealth: 1, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'flipped-choice-one', card: { ...catalog[2], instanceId: 'flipped-choice-one-card' }, owner: 1, row: 3, col: 0, health: 0, maxHealth: 3, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0, flippedTurns: 2 },
    { id: 'flipped-choice-two', card: { ...catalog[3], instanceId: 'flipped-choice-two-card' }, owner: 1, row: 3, col: 4, health: 0, maxHealth: 3, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0, flippedTurns: 2 },
  ]
  const attacked = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'burn-killer-choice', targetUnitId: 'burning-trombik-choice' } })
  const choice = attacked.state.pendingChoice
  assert.equal(choice.kind, 'death-burn-flipped')
  assert.equal(choice.owner, 1)
  assert.deepEqual(projectForPlayer(attacked.state, 0).private.pendingChoice, null)
  assert.deepEqual(projectForPlayer(attacked.state, 1).private.pendingChoice.options.map(option => option.unitId).sort(), ['flipped-choice-one', 'flipped-choice-two'])

  const burned = applyCommand(attacked.state, 1, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: 'flipped-choice-one' } } })
  assert.equal(burned.state.board.some(unit => unit.id === 'flipped-choice-one'), false)
  assert.ok(burned.state.players[1].burned.some(candidate => candidate.instanceId === 'flipped-choice-one-card'))
  assert.equal(burned.state.board.some(unit => unit.id === 'flipped-choice-two'), true)
})

test('Дрон privately saves up to two deck cards within its total mana limit', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Дрон')
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const cheap = { ...catalog[1], Cost: 1, instanceId: 'drone-cheap' }
  const second = { ...catalog[2], Cost: 3, instanceId: 'drone-second' }
  const overBudgetPair = { ...catalog[3], Cost: 4, instanceId: 'drone-over-budget-pair' }
  const tooExpensive = { ...catalog[3], Cost: 5, instanceId: 'drone-expensive' }
  match.players[1].deck = [cheap, second, overBudgetPair, tooExpensive]
  match.board = [
    { id: 'drone-killer', card: { ...catalog[1], Description: 'Досягаемость', instanceId: 'drone-killer-card' }, owner: 0, row: 4, col: 2, health: 20, maxHealth: 20, attack: 100, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'drone', card: { ...card, instanceId: 'drone-card' }, owner: 1, row: 3, col: 2, health: 1, maxHealth: 1, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  ]
  const attacked = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'drone-killer', targetUnitId: 'drone' } })
  const choice = attacked.state.pendingChoice
  assert.equal(choice.kind, 'death-save-deck-cards')
  assert.equal(choice.count, 2)
  assert.equal(choice.totalCost, 4)
  assert.deepEqual(choice.unitIds, ['drone-cheap', 'drone-second', 'drone-over-budget-pair'])
  assert.deepEqual(projectForPlayer(attacked.state, 0).private.pendingChoice, null)
  assert.deepEqual(projectForPlayer(attacked.state, 1).private.pendingChoice.options.map(option => option.unitId), ['drone-cheap', 'drone-second', 'drone-over-budget-pair'])
  assert.throws(() => applyCommand(attacked.state, 1, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: ['drone-second', 'drone-over-budget-pair'] } } }), { code: 'INVALID_CHOICE' })

  const saved = applyCommand(attacked.state, 1, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: ['drone-cheap', 'drone-second'] } } })
  assert.deepEqual(saved.state.players[1].saved.map(candidate => candidate.instanceId), ['drone-second', 'drone-cheap'])
  assert.deepEqual(saved.state.players[1].deck.map(candidate => candidate.instanceId), ['drone-over-budget-pair', 'drone-expensive'])
  assert.equal(saved.state.pendingChoice, null)
})

test('ИНТИВИ takes an item from the deck and privately offers to discard it', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'ИНТИВИ')
  const item = { ...catalog[1], Name: 'Test item', Type: 1, Cost: 2, instanceId: 'intivi-item' }
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  match.players[1].deck = [item]
  match.board = [
    { id: 'intivi-killer', card: { ...catalog[1], Description: 'Досягаемость', instanceId: 'intivi-killer-card' }, owner: 0, row: 4, col: 2, health: 20, maxHealth: 20, attack: 100, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'intivi', card: { ...card, instanceId: 'intivi-card' }, owner: 1, row: 3, col: 2, health: 1, maxHealth: 1, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  ]
  const attacked = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'intivi-killer', targetUnitId: 'intivi' } }, () => 0.5)
  const choice = attacked.state.pendingChoice
  assert.equal(choice.kind, 'death-intivi')
  assert.deepEqual(projectForPlayer(attacked.state, 0).private.pendingChoice, null)
  assert.equal(projectForPlayer(attacked.state, 0).private.hand.some(candidate => candidate.instanceId === item.instanceId), false)
  assert.equal(projectForPlayer(attacked.state, 1).private.pendingChoice.cardName, 'Test item')
  assert.deepEqual(projectForPlayer(attacked.state, 1).private.pendingChoice.choices.map(option => option.value.choice), ['keep', 'discard'])

  const discarded = applyCommand(attacked.state, 1, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { choice: 'discard' } } })
  assert.equal(discarded.state.players[1].hand.some(candidate => candidate.instanceId === item.instanceId), false)
  assert.ok(discarded.state.players[1].discard.some(candidate => candidate.instanceId === item.instanceId))
  assert.equal(discarded.state.pendingChoice, null)
})

test('Новички grants energy before round ten and privately saves a spell from hand at round ten', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Новички')
  const spell = realCatalog.find(candidate => candidate.Type === 2 && !candidate.Tags?.includes('в разработке'))
  const createNewcomersMatch = (round, hand) => {
    const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
    match.round = round
    match.players[1].hand = hand.map((candidate, index) => ({ ...candidate, instanceId: `newcomers-spell-${round}-${index}` }))
    match.board = [
      { id: `newcomers-attacker-${round}`, card: { ...catalog[1], instanceId: `newcomers-attacker-card-${round}` }, owner: 0, row: 4, col: 2, health: 20, maxHealth: 20, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
      { id: `newcomers-${round}`, card: { ...card, instanceId: `newcomers-card-${round}` }, owner: 1, row: 3, col: 2, health: 1, maxHealth: 1, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    ]
    return match
  }
  const attackNewcomers = match => applyCommand(match, 0, { action: 'unit.attack', data: { unitId: `newcomers-attacker-${match.round}`, targetUnitId: `newcomers-${match.round}` } }, () => 0.5)

  const earlyDeath = createNewcomersMatch(9, [spell])
  const earlyResult = attackNewcomers(earlyDeath)
  assert.equal(earlyResult.state.players[1].energy, earlyDeath.players[1].energy + 3)
  assert.equal(earlyResult.state.pendingChoice, undefined)

  const lateDeath = createNewcomersMatch(10, [spell])
  const lateResult = attackNewcomers(lateDeath)
  const choice = lateResult.state.pendingChoice
  assert.equal(choice.kind, 'spell-save-hand')
  assert.equal(choice.sourceCardName, 'Новички')
  assert.deepEqual(choice.unitIds, [`newcomers-spell-10-0`])
  assert.deepEqual(projectForPlayer(lateResult.state, 0).private.pendingChoice, null)
  assert.equal(projectForPlayer(lateResult.state, 1).private.pendingChoice.options[0].unitId, 'newcomers-spell-10-0')
  assert.throws(() => applyCommand(lateResult.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: ['newcomers-spell-10-0'] } } }), { code: 'NOT_CHOICE_OWNER' })

  const saved = applyCommand(lateResult.state, 1, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: ['newcomers-spell-10-0'] } } })
  assert.ok(saved.state.players[1].saved.some(candidate => candidate.instanceId === 'newcomers-spell-10-0'))
  assert.equal(saved.state.players[1].hand.some(candidate => candidate.instanceId === 'newcomers-spell-10-0'), false)
  assert.equal(saved.state.pendingChoice, null)

  const noSpell = attackNewcomers(createNewcomersMatch(10, []))
  assert.equal(noSpell.state.pendingChoice, undefined)
})

test('Pantlessterrorist doubles its attack damage and does not counterattack', () => {
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const attacker = turnUnit('Pantlessterrorist', 0, 3, 2, { attack: 3, health: 20, maxHealth: 20 })
  const target = { id: 'pantless-target', card: { ...catalog[1], instanceId: 'pantless-target-card' }, owner: 1, row: 2, col: 2, health: 20, maxHealth: 20, attack: 4, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  match.board = [attacker, target]
  const doubled = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: attacker.id, targetUnitId: target.id } }, () => 0.5)
  assert.equal(doubled.state.board.find(unit => unit.id === target.id).health, 14)

  const reverse = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const ordinary = { id: 'ordinary-attacker', card: { ...catalog[0], instanceId: 'ordinary-card' }, owner: 0, row: 3, col: 2, health: 20, maxHealth: 20, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  const pantless = turnUnit('Pantlessterrorist', 1, 2, 2, { attack: 4, health: 20, maxHealth: 20 })
  reverse.board = [ordinary, pantless]
  const blocked = applyCommand(reverse, 0, { action: 'unit.attack', data: { unitId: ordinary.id, targetUnitId: pantless.id } }, () => 0.5)
  assert.equal(blocked.state.board.find(unit => unit.id === ordinary.id).health, 20)
})

test('Громила only offers sideways destinations and validates the chosen cell', () => {
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const source = turnUnit('Громила', 0, 3, 2)
  const target = { id: 'gromila-target', card: { ...catalog[1], instanceId: 'gromila-target-card' }, owner: 1, row: 2, col: 2, health: 20, maxHealth: 20, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  match.board = [source, target]
  const attack = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: source.id, targetUnitId: target.id } }, () => 0.5)
  const choice = attack.state.pendingChoice
  assert.equal(choice.mode, 'sideways')
  assert.deepEqual(choice.cells, [{ row: 2, col: 1 }, { row: 2, col: 3 }])
  assert.throws(() => applyCommand(attack.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { cell: { row: 1, col: 2 } } } }), { code: 'INVALID_CHOICE' })
  const moved = applyCommand(attack.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { cell: { row: 2, col: 3 } } } }, () => 0.5)
  assert.deepEqual([moved.state.board.find(unit => unit.id === target.id).row, moved.state.board.find(unit => unit.id === target.id).col], [2, 3])
})

test('Коза moves the attacked creature one socket backward toward its owner', () => {
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const source = turnUnit('Коза', 0, 3, 2)
  const target = { id: 'goat-target', card: { ...catalog[1], instanceId: 'goat-target-card' }, owner: 1, row: 2, col: 2, health: 20, maxHealth: 20, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  match.board = [source, target]
  const moved = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: source.id, targetUnitId: target.id } }, () => 0.5)
  assert.equal(moved.state.board.find(unit => unit.id === target.id).row, 1)
})

test('Крипер crown death damages only adjacent buildings through the death resolver', () => {
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const source = turnUnit('Крипер', 0, 3, 2)
  const target = { id: 'creeper-target', card: { ...catalog[1], instanceId: 'creeper-target-card' }, owner: 1, row: 2, col: 2, health: 20, maxHealth: 20, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  const building = (id, row, col, health) => ({ id, card: { ...catalog[2], Type: 3, instanceId: `${id}-card` }, owner: 1, row, col, health, maxHealth: health, attack: 0, speed: 0, summoned: 0, attacks: 0, blackTokens: 0 })
  match.board = [source, target, building('adjacent-building', 3, 1, 4), building('near-building', 3, 3, 5), building('far-building', 1, 0, 2)]
  const attack = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: source.id, targetUnitId: target.id } }, () => 0.5)
  assert.equal(attack.state.board.some(unit => unit.id === source.id), false)
  assert.equal(attack.state.board.some(unit => unit.id === 'adjacent-building'), false)
  assert.equal(attack.state.board.some(unit => unit.id === 'near-building'), true)
  assert.equal(attack.state.board.find(unit => unit.id === 'near-building').health, 1)
  assert.equal(attack.state.board.find(unit => unit.id === 'far-building').health, 2)
})

test('every playable catalog start-turn effect reaches resolution without an unsupported-effect rejection', () => {
  const sources = realCatalog.filter(card => !card.Tags?.includes('в разработке') && card.Type !== 2 && /В начале (?:вашего |каждого |своего )?хода/iu.test(card.Description ?? ''))
  assert.deepEqual(sources.filter(card => !startTurnEffect(card.Description ?? '')).map(card => [card.Name, card.Type]), [['Щит', 1]])
  for (const card of sources) {
    const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
    match.round = 2
    const isItem = card.Type === 1
    const host = isItem ? catalog[0] : card
    match.board.push({ id: 'start-turn-source', card: { ...host, instanceId: `start-${card.Id}` }, ...(isItem ? { item: { ...card } } : {}), owner: 1, row: card.Type === 3 ? 1 : 0, col: 2, health: host.Health, maxHealth: host.Health, attack: host.Attack, speed: host.Speed, summoned: 0, attacks: 0, blackTokens: 0 })
    try { applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } }, () => 0.5) }
    catch (error) {
      assert.notEqual(error.code, 'UNSUPPORTED_EFFECT', `${card.Name}: ${card.Description}`)
      assert.equal(typeof error.code, 'string', `${card.Name} leaked an unhandled runtime exception: ${error}`)
    }
  }
})

test('every playable catalog ability reaches its normal validation without an unsupported-effect rejection', () => {
  const playable = realCatalog.filter(card => !card.Tags?.includes('в разработке') && abilityDescriptions(card.Description ?? '').length)
  assert.deepEqual(playable.flatMap(card => abilityDescriptions(card.Description ?? '').flatMap((_, abilityIndex) => targetedAbilityOperation(card.Description ?? '', abilityIndex) ? [] : [card.Name])), ['Библиотекарь', 'Генератор потех', 'Конвейерное производство', 'Тау-пушка'])
  for (const card of playable) for (let abilityIndex = 0; abilityIndex < abilityDescriptions(card.Description ?? '').length; abilityIndex++) {
    const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
    match.round = 2
    match.players[0].mana = 100
    match.players[0].energy = 100
    const isItem = card.Type === 1
    const host = isItem ? catalog[0] : card
    const source = { id: 'ability-source', card: { ...host, instanceId: `ability-${card.Id}` }, ...(isItem ? { item: { ...card } } : {}), owner: 0, row: card.Type === 3 ? 2 : 3, col: 2, health: host.Health, maxHealth: host.Health, attack: host.Attack, speed: host.Speed, summoned: 0, attacks: 0, blackTokens: 100 }
    match.board.push(source,
      ...(card.Name === 'Герсон Бум' ? [{ id: 'ability-suzie', card: realCatalog.find(candidate => candidate.Name === 'Сьюзи'), owner: 0, row: 3, col: 0, health: 10, maxHealth: 10, attack: 2, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }] : []),
      { id: 'ability-ally', card: { ...catalog[0] }, owner: 0, row: 3, col: 1, health: 10, maxHealth: 10, attack: 2, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
      { id: 'ability-enemy', card: { ...catalog[1] }, owner: 1, row: 2, col: 3, health: 10, maxHealth: 10, attack: 2, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
      { id: 'ability-building', card: { ...catalog[2], Type: 3 }, owner: 0, row: 1, col: 1, health: 10, maxHealth: 10, attack: 0, speed: 0, summoned: 0, attacks: 0, blackTokens: 0 },
    )
    try { applyCommand(match, 0, { action: 'ability.use', data: { unitId: source.id, abilityIndex } }, () => 0.5) }
    catch (error) {
      assert.notEqual(error.code, 'UNSUPPORTED_EFFECT', `${card.Name} ability ${abilityIndex}: ${card.Description}`)
      assert.equal(typeof error.code, 'string', `${card.Name} ability ${abilityIndex} leaked an unhandled runtime exception: ${error}`)
    }
  }
})

test('Gerson Boom spends its ability tokens, destroys one enemy target, and burns itself', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Герсон Бум')
  const suzie = realCatalog.find(candidate => candidate.Name === 'Сьюзи')
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  match.players[0].mana = 8
  const source = { id: 'gerson', card: { ...card, instanceId: 'gerson-instance' }, owner: 0, row: 3, col: 2, health: card.Health, maxHealth: card.Health, attack: card.Attack, speed: card.Speed, summoned: 0, attacks: 0, blackTokens: 0 }
  const target = { id: 'gerson-target', card: { ...catalog[0], Name: 'Enemy' }, owner: 1, row: 2, col: 2, health: 10, maxHealth: 10, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  match.board.push(source,
    { id: 'gerson-suzie', card: { ...suzie }, owner: 0, row: 4, col: 0, health: suzie.Health, maxHealth: suzie.Health, attack: suzie.Attack, speed: suzie.Speed, summoned: 0, attacks: 0, blackTokens: 0 },
    target,
  )

  const activated = applyCommand(match, 0, { action: 'ability.use', data: { unitId: source.id, abilityIndex: 0 } })
  assert.equal(activated.state.players[0].mana, 0)
  assert.equal(activated.state.board.find(unit => unit.id === source.id).blackTokens, 0)
  assert.equal(activated.state.pendingChoice.kind, 'ability-damage-target')
  assert.deepEqual(activated.state.pendingChoice.unitIds, [target.id])
  const resolved = applyCommand(activated.state, 0, { action: 'choice.resolve', data: { choiceId: activated.state.pendingChoice.id, selection: { unitId: target.id } } })
  assert.equal(resolved.state.board.some(unit => unit.id === source.id), false)
  assert.ok(resolved.state.players[0].burned.some(item => item.instanceId === source.card.instanceId))
  assert.equal(resolved.state.players[1].discard.at(-1).Name, 'Enemy')
  assert.equal(resolved.state.pendingChoice, null)
})

test('TheVolkeR privately offers a saved spell after a crown attack and makes its cast free', () => {
  const savedSpell = realCatalog.find(card => card.Name === '@.hiho')
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  match.players[0].saved = [
    { ...savedSpell, instanceId: 'saved-volker-spell' },
    { ...realCatalog.find(card => card.Name === 'Обсидиан пчёла'), instanceId: 'saved-volker-creature' },
  ]
  match.players[0].mana = 0
  match.board = [
    turnUnit('TheVolkeR', 0, 3, 2, { health: 30, maxHealth: 30 }),
    { id: 'volker-target', card: { ...catalog[1], instanceId: 'volker-target-card' }, owner: 1, row: 2, col: 2, health: 30, maxHealth: 30, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  ]

  const attack = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: match.board[0].id, targetUnitId: 'volker-target' } }, () => 0.5)
  const choice = attack.state.pendingChoice
  assert.equal(choice.kind, 'crown-play-saved-spell')
  assert.deepEqual(projectForPlayer(attack.state, 0).private.pendingChoice.options, [{ unitId: 'saved-volker-spell', name: '@.hiho' }])
  assert.equal(projectForPlayer(attack.state, 1).private.pendingChoice, null)
  assert.throws(() => applyCommand(attack.state, 1, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: 'saved-volker-spell' } } }), { code: 'NOT_CHOICE_OWNER' })
  assert.throws(() => applyCommand(attack.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: 'saved-volker-creature' } } }), { code: 'INVALID_CHOICE' })

  const resolved = applyCommand(attack.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: 'saved-volker-spell' } } }, () => 0.5)
  assert.deepEqual(resolved.state.players[0].saved.map(card => card.instanceId), ['saved-volker-creature'])
  assert.ok(resolved.state.players[0].hand.some(card => card.instanceId === 'saved-volker-spell'))
  assert.deepEqual(resolved.state.players[0].freePlayCardIds, ['saved-volker-spell'])
  assert.equal(projectForPlayer(resolved.state, 0).private.hand.find(card => card.instanceId === 'saved-volker-spell').freeToPlay, true)

  const cast = applyCommand(resolved.state, 0, { action: 'spell.cast', data: { cardInstanceId: 'saved-volker-spell', payment: 'mana', target: { unitId: 'volker-target' } } }, () => 0.5)
  assert.equal(cast.state.board.some(unit => unit.id === 'volker-target'), false)
  assert.equal(cast.state.players[0].mana, 0)
})

test('DastAronix draws once on death through combat, spell burn, and start-turn burn', () => {
  for (const mode of ['combat', 'spell', 'start']) {
    const match = createMatch(input)
    const target = turnUnit('ДастАроникс', mode === 'start' ? 0 : 1, 3, 2)
    match.board.push(target)
    const owner = match.players[target.owner]
    const drawn = owner.deck[0].instanceId
    const before = structuredClone(match)
    let command
    if (mode === 'combat') {
      match.board.push({ id: 'attacker', card: catalog[0], owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })
      command = { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: target.id } }
    } else if (mode === 'spell') {
      const spell = { ...realCatalog.find(card => card.Name === 'Бан'), instanceId: 'ban-instance' }
      match.players[0].hand.push(spell)
      match.players[0].mana = 10
      command = { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: target.id } } }
    } else {
      match.board.push(turnUnit('Дедруби', 1, 0, 2))
      command = { action: 'turn.end', data: { option: 'no_penalty' } }
    }
    const result = applyCommand(match, 0, command)
    assert.equal(result.state.board.some(unit => unit.id === target.id), false)
    assert.equal(result.state.players[target.owner].hand.at(-1).instanceId, drawn)
    assert.equal(result.state.players[target.owner].deck.length, before.players[target.owner].deck.length - 1)
    assert.equal(result.state.version, 1)
    assert.ok(!JSON.stringify(result.events).includes(drawn))
  }
})

test('mutual DastAronix combat deaths each draw once and preserve both card instances', () => {
  let match = createMatch(input)
  const attacker = turnUnit('ДастАроникс', 0, 4, 2, { attack: 3 })
  const defender = turnUnit('ДастАроникс', 1, 3, 2, { attack: 3 })
  match.board.push(attacker, defender)
  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: attacker.id, targetUnitId: defender.id } })
  assert.equal(result.state.board.length, 0)
  assert.deepEqual(result.state.players.map(player => player.hand.length), [5, 5])
  assert.deepEqual(result.state.players.map(player => player.discard[0].instanceId), [attacker.card.instanceId, defender.card.instanceId])
})

test('Noel takes the top discard cards after its equipment is discarded and excludes only itself', () => {
  for (const withItem of [false, true]) {
    const match = createMatch(input)
    const noel = turnUnit('Ноэль', 1, 3, 2)
    const earlierNoel = { ...noel.card, instanceId: 'earlier-noel' }
    const oldest = { ...catalog[0], instanceId: 'oldest' }
    match.players[1].discard.push(oldest, earlierNoel)
    if (withItem) noel.item = { ...catalog[1], Type: 1, instanceId: 'noel-item' }
    match.board.push(noel, { id: 'attacker', card: catalog[0], owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })
    const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: noel.id } })
    assert.deepEqual(result.state.players[1].hand.slice(-2).map(card => card.instanceId), withItem ? ['noel-item', 'earlier-noel'] : ['earlier-noel', 'oldest'])
    assert.deepEqual(result.state.players[1].discard.map(card => card.instanceId), withItem ? ['oldest', noel.card.instanceId] : [noel.card.instanceId])
  }
})

test('Noel cannot take itself from an otherwise empty discard', () => {
  const match = createMatch(input)
  const noel = turnUnit('Ноэль', 1, 3, 2)
  match.board.push(noel, { id: 'attacker', card: catalog[0], owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })
  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: noel.id } })
  assert.equal(result.state.players[1].hand.length, 4)
  assert.equal(result.state.players[1].discard[0].instanceId, noel.card.instanceId)
})

test('Diohazavr saves itself once after ordinary death or a burn with a burn-save modifier', () => {
  for (const burn of [false, true]) for (const burnSave of [false, true]) {
    const match = createMatch(input)
    const target = turnUnit('Диохазавр', 0, 4, 2, { expiresAtTurnEnd: !burn })
    match.players[0].nextBurnToSave = burnSave ? 1 : 0
    match.board.push(target)
    let command
    if (burn) {
      const spell = { ...realCatalog.find(card => card.Name === 'Бан'), instanceId: 'ban-instance' }
      match.players[0].hand.push(spell)
      match.players[0].mana = 10
      command = { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: target.id } } }
    } else {
      command = { action: 'turn.end', data: { option: 'no_penalty' } }
    }
    const result = applyCommand(match, 0, command)
    assert.deepEqual(result.state.players[0].saved.map(card => card.instanceId), [target.card.instanceId])
    assert.equal(result.state.players[0].discard.length, 0)
    assert.equal(result.state.players[0].burned.filter(card => card.Type === 0).length, 0)
    assert.equal(result.state.players[0].nextBurnToSave, burnSave && !burn ? 1 : 0)
  }
})

test('Gorynych takes only the top matching spell from discard after death', () => {
  const match = createMatch(input)
  const source = turnUnit('Горыныч', 1, 3, 2)
  const spell = { ...realCatalog.find(card => card.Name === 'Бан'), instanceId: 'discard-spell' }
  match.players[1].discard.push({ ...spell, instanceId: 'older-spell' }, spell, { ...catalog[0], instanceId: 'top-creature' })
  match.board.push(source, { id: 'attacker', card: catalog[0], owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })
  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: source.id } })
  assert.equal(result.state.players[1].hand.at(-1).instanceId, spell.instanceId)
  assert.deepEqual(result.state.players[1].discard.map(card => card.instanceId), ['older-spell', 'top-creature', source.card.instanceId])
})

test('DastAronix and Gorynych full catalog entries draw through the shared pile helpers', () => {
  for (const name of ['ДастАроникс', 'Горыныч']) {
    const match = createMatch(input)
    const card = { ...realCatalog.find(card => card.Name === name), instanceId: 'entry-card' }
    const spell = { ...realCatalog.find(card => card.Name === 'Бан'), instanceId: 'deck-spell' }
    match.players[0].deck.splice(1, 0, spell)
    match.players[0].hand = [card]
    match.players[0].mana = 10
    const drawn = name === 'ДастАроникс' ? match.players[0].deck[0].instanceId : spell.instanceId
    const before = match.players[0].deck.map(card => card.instanceId)
    const result = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 2 } } })
    assert.deepEqual(result.state.players[0].hand.map(card => card.instanceId), [drawn])
    assert.deepEqual(result.state.players[0].deck.map(card => card.instanceId), before.filter(id => id !== drawn))
    assert.equal(result.state.players[0].mana, 10 - card.Cost)
    assert.ok(!JSON.stringify(result.events).includes(drawn))
  }
})

test('Vanya Vereemeev death buffs only living allied creature sockets and repeats with Marinates Meat', () => {
  for (const repeat of [false, true]) {
    const match = createMatch(input)
    match.players[0].played = true
    const vanya = turnUnit('Ваня Веремеев', 0, 2, 2, { expiresAtTurnEnd: true })
    const neighbors = [-1, 0, 1].flatMap(row => [-1, 0, 1].filter(col => row || col).map(col => ({
      id: `ally-${row}-${col}`, card: { ...catalog[0], instanceId: `ally-card-${row}-${col}` }, owner: 0,
      row: 2 + row, col: 2 + col, health: 3, maxHealth: 5, attack: 2, speed: 4, blackTokens: 0,
      ...(row === -1 && col === 0 ? { flippedTurns: 2 } : {}),
    })))
    const dying = { id: 'dying-ally', card: catalog[1], owner: 0, row: 2, col: 4, health: 0, maxHealth: 2, attack: 2, speed: 4, dying: true, blackTokens: 0 }
    const enemy = { ...neighbors[0], id: 'enemy', owner: 1 }
    const building = { ...neighbors[1], id: 'building', card: { ...catalog[1], Type: 3 } }
    const distant = { ...neighbors[2], id: 'distant', row: 4, col: 4 }
    match.board.push(vanya, ...neighbors, dying, enemy, building, distant)
    if (repeat) match.board.push(turnUnit('Маринует мясо', 0, 4, 4))
    const result = applyCommand(match, 0, { action: 'turn.end', data: {} })
    const amount = repeat ? 2 : 1
    for (const ally of neighbors) {
      const buffed = result.state.board.find(unit => unit.id === ally.id)
      assert.deepEqual([buffed.attack, buffed.health, buffed.maxHealth, buffed.speed], [2 + amount, 3 + amount, 5 + amount, 4 - amount])
    }
    assert.deepEqual([result.state.board.find(unit => unit.id === 'dying-ally').attack, dying.attack], [2, 2])
    assert.deepEqual([result.state.board.find(unit => unit.id === 'enemy').attack, enemy.attack], [2, 2])
    assert.deepEqual([result.state.board.find(unit => unit.id === 'building').attack, building.attack], [2, 2])
    assert.deepEqual([result.state.board.find(unit => unit.id === 'distant').attack, distant.attack], [2, 2])
    assert.equal(result.state.players[0].discard.filter(card => card.instanceId === vanya.card.instanceId).length, 1)
    assert.equal(result.state.version, 1)
  }
})

test('active Marinates Meat repeats creature death draws on both combat and triggered paths', () => {
  for (const mode of ['combat', 'spell']) for (const active of [false, true]) {
    const match = createMatch(input)
    const source = turnUnit('Маринует мясо', 1, 1, 2, { flippedTurns: active ? 0 : 2 })
    const target = turnUnit('ДастАроникс', 1, 3, 2)
    match.board.push(source, target)
    let command
    if (mode === 'combat') {
      match.board.push({ id: 'attacker', card: catalog[0], owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })
      command = { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: target.id } }
    } else {
      const spell = { ...realCatalog.find(card => card.Name === 'Бан'), instanceId: 'ban-instance' }
      match.players[0].hand.push(spell)
      match.players[0].mana = 10
      command = { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: target.id } } }
    }
    const result = applyCommand(match, 0, command)
    assert.equal(result.state.players[1].hand.length, active ? 6 : 5)
    assert.equal(result.state.players[1][mode === 'spell' ? 'burned' : 'discard'].filter(card => card.instanceId === target.card.instanceId).length, 1)
    assert.equal(result.state.version, 1)
  }
})

test('combat adjacent death chain uses the same draw resolver without losing or duplicating a card', () => {
  const match = createMatch(input)
  const handCount = match.players[0].hand.length
  const attacker = turnUnit('ДастАроникс', 0, 4, 2, { attack: 3 })
  const bee = turnUnit('Обсидиан пчёла', 1, 3, 2, { attack: 0 })
  match.board.push(attacker, bee)
  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: attacker.id, targetUnitId: bee.id } })
  assert.equal(result.state.board.length, 0)
  assert.equal(result.state.players[0].hand.length, handCount + 1)
  assert.equal(result.state.players[0].discard[0].instanceId, attacker.card.instanceId)
  assert.equal(result.state.players[1].discard[0].instanceId, bee.card.instanceId)
  assert.equal(result.state.version, 1)
})

test('an unknown card death is not masked by a known equipped death effect', () => {
  const match = createMatch(input)
  const target = { id: 'unknown-death', card: { ...catalog[0], Name: 'Unknown death', Description: 'Посмертно: Украдите все карты.' }, owner: 1, row: 3, col: 2, health: 1, maxHealth: 1, attack: 0, speed: 1, blackTokens: 0, item: { Name: 'Броненосец', Type: 1 } }
  match.board.push(target, { id: 'attacker', card: catalog[0], owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })
  const before = structuredClone(match)
  assert.throws(() => applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: target.id } }), { code: 'UNSUPPORTED_EFFECT' })
  assert.deepEqual(match, before)
})

test('empty entry draws and an ordinary Noel death do not spend a burn-save modifier', () => {
  const match = createMatch(input)
  const card = { ...realCatalog.find(card => card.Name === 'ДастАроникс'), instanceId: 'dasta-empty' }
  match.players[0].hand = [card]
  match.players[0].deck = []
  match.players[0].mana = 10
  const played = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 2 } } })
  assert.equal(played.state.players[0].hand.length, 0)
  const noel = turnUnit('Ноэль', 1, 3, 2)
  played.state.board.push(noel)
  played.state.players[1].nextBurnToSave = 1
  played.state.board[0].summoned = 0
  played.state.board[0].attack = 3
  const attacked = applyCommand(played.state, 0, { action: 'unit.attack', data: { unitId: played.state.board[0].id, targetUnitId: noel.id } })
  assert.equal(attacked.state.players[1].nextBurnToSave, 1)
  assert.equal(attacked.state.players[1].saved.length, 0)
  assert.equal(attacked.state.players[1].discard[0].instanceId, noel.card.instanceId)
})

test('entry draw support still rejects an extra unsupported action atomically', () => {
  for (const name of ['ДастАроникс', 'Горыныч']) {
    const match = createMatch(input)
    const card = { ...realCatalog.find(card => card.Name === name), instanceId: 'entry-card' }
    card.Description = card.Description.replace(/(Вход:[^\n]*)/u, '$1 Украдите все карты.')
    match.players[0].hand = [card]
    match.players[0].mana = 10
    const before = structuredClone(match)
    assert.throws(() => applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 2 } } }), { code: 'UNSUPPORTED_EFFECT' })
    assert.deepEqual(match, before)
  }
})

test('catalog Shield equips and restores its bearer shield only on the owner next turn', () => {
  const match = createMatch(input)
  const item = { ...realCatalog.find(card => card.Name === 'Щит'), instanceId: 'shield-item' }
  match.players[0].hand.push(item)
  match.players[0].mana = 10
  match.board.push({ id: 'bearer', card: catalog[0], owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })
  const equipped = applyCommand(match, 0, { action: 'item.equip', data: { cardInstanceId: item.instanceId, targetUnitId: 'bearer', payment: 'mana' } })
  assert.equal(equipped.state.board[0].shield, true)
  assert.equal(equipped.state.board[0].maxHealth, 5 + item.Health)
  equipped.state.board[0].shield = false
  const ended = applyCommand(equipped.state, 0, { action: 'turn.end', data: {} })
  assert.equal(ended.state.board[0].shield, false)
  const returned = applyCommand(ended.state, 1, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(returned.state.board[0].shield, true)
  assert.equal(returned.state.board[0].maxHealth, 5 + item.Health)
  assert.equal(returned.state.pendingTurnStart, null)
  assert.ok(!returned.state.pendingChoice)
})

test('every playable catalog item can be equipped in an online match', () => {
  const playableItems = realCatalog.filter(card => card.Type === 1 && !card.Tags?.includes('в разработке'))
  for (const item of playableItems) {
    const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
    match.players[0].mana = 45
    match.players[0].hand = [{ ...item, instanceId: `item-${item.Id}` }]
    match.board.push({ id: 'bearer', card: catalog[0], owner: 0, row: 2, col: 2, health: 10, maxHealth: 10, attack: 1, speed: 1, blackTokens: 0 })

    let result
    assert.doesNotThrow(() => { result = applyCommand(match, 0, { action: 'item.equip', data: { cardInstanceId: `item-${item.Id}`, targetUnitId: 'bearer', payment: 'mana' } }) }, item.Name)

    assert.equal(result.state.board[0].item.Name, item.Name, item.Name)
  }
})

test('Пилюля resolves its crown gamble to damage or healing on the attacked creature', () => {
  for (const [roll, expectedHealth] of [[0, 23], [0.2, 30]]) {
    const match = createMatch(input)
    const attacker = turnUnit('Аскетик', 0, 4, 2, { item: { ...realCatalog.find(card => card.Name === 'Пилюля'), instanceId: 'pill-item' } })
    const target = turnUnit('Аскетик', 1, 3, 2, { health: 30, maxHealth: 30 })
    match.board.push(attacker, target)

    const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: attacker.id, targetUnitId: target.id } }, () => roll)

    assert.equal(result.state.board.find(unit => unit.id === target.id).health, expectedHealth)
  }
})

test('Банхаммер crown burns both the attacked creature and its bearer', () => {
  const match = createMatch(input)
  const attacker = turnUnit('Аскетик', 0, 4, 2, { item: { ...realCatalog.find(card => card.Name === 'Банхаммер'), instanceId: 'banhammer-item' } })
  const target = turnUnit('Аскетик', 1, 3, 2)
  match.board.push(attacker, target)
  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: attacker.id, targetUnitId: target.id } })
  assert.equal(result.state.board.some(unit => unit.id === attacker.id || unit.id === target.id), false)
  assert.ok(result.state.players[0].burned.some(card => card.instanceId === attacker.card.instanceId))
  assert.ok(result.state.players[1].burned.some(card => card.instanceId === target.card.instanceId))
})

test('Грави пушка and Тулган move their surviving attack target only to offered sockets', () => {
  for (const [cardName, targetName, cell, mode] of [['Грави пушка', 'Аскетик', { row: 3, col: 1 }, 'adjacent'], ['Тулган', 'Аскетик', { row: 2, col: 2 }, 'any']]) {
    const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
    const attacker = turnUnit(cardName, 0, 4, 2)
    const target = turnUnit(targetName, 1, 3, 2)
    match.board.push(attacker, target)
    const attack = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: attacker.id, targetUnitId: target.id } })
    assert.equal(attack.state.pendingChoice?.kind, 'spell-move-target')
    assert.equal(attack.state.pendingChoice?.mode, mode)
    assert.ok(attack.state.pendingChoice?.cells.some(option => option.row === cell.row && option.col === cell.col))
    assert.throws(() => applyCommand(attack.state, 0, { action: 'choice.resolve', data: { choiceId: attack.state.pendingChoice.id, selection: { cell: { row: 3, col: 2 } } } }), error => error.code === 'INVALID_CHOICE')
    const moved = applyCommand(attack.state, 0, { action: 'choice.resolve', data: { choiceId: attack.state.pendingChoice.id, selection: { cell } } })
    assert.deepEqual([moved.state.board.find(unit => unit.id === target.id).row, moved.state.board.find(unit => unit.id === target.id).col], [cell.row, cell.col])
  }
})

test('Загребущий рой privately offers mana or a card when an allied creature dies on its owner turn', () => {
  for (const choice of ['swarm-mana', 'swarm-draw']) {
    const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
    const swarm = turnUnit('Аскетик', 0, 4, 1, { id: 'swarm-source', item: { ...realCatalog.find(card => card.Name === 'Загребущий рой'), instanceId: 'swarm-item' } })
    const attacker = turnUnit('Аскетик', 0, 4, 2, { id: 'swarm-victim', health: 1, maxHealth: 1, attack: 1 })
    const defender = turnUnit('Аскетик', 1, 3, 2, { attack: 5 })
    match.board.push(swarm, attacker, defender)
    const attack = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: attacker.id, targetUnitId: defender.id } })
    assert.equal(attack.state.pendingChoice?.kind, 'swarm-reward')
    assert.deepEqual(projectForPlayer(attack.state, 0).private.pendingChoice.choices.map(option => option.value.choice), ['swarm-mana', 'swarm-draw'])
    assert.equal(projectForPlayer(attack.state, 1).private.pendingChoice, null)
    const resolved = applyCommand(attack.state, 0, { action: 'choice.resolve', data: { choiceId: attack.state.pendingChoice.id, selection: { choice } } })
    assert.equal(resolved.state.pendingChoice, null)
    assert.equal(resolved.state.players[0].mana, match.players[0].mana + Number(choice === 'swarm-mana'))
    assert.equal(resolved.state.players[0].hand.length, match.players[0].hand.length + Number(choice === 'swarm-draw'))
  }
})

test('multiple Загребущий рой rewards queue separately and each can be resolved once', () => {
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const item = realCatalog.find(card => card.Name === 'Загребущий рой')
  match.board.push(...[0, 1].map(col => turnUnit('Аскетик', 0, 4, col, { id: `swarm-${col}`, item: { ...item, instanceId: `swarm-item-${col}` } })))
  const attacker = turnUnit('Аскетик', 0, 4, 2, { id: 'swarm-queued-victim', health: 1, maxHealth: 1, attack: 1 })
  const defender = turnUnit('Аскетик', 1, 3, 2, { id: 'swarm-queued-killer', attack: 5 })
  match.board.push(attacker, defender)
  const attack = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: attacker.id, targetUnitId: defender.id } })
  assert.equal(attack.state.queuedChoices?.length, 1)
  const first = applyCommand(attack.state, 0, { action: 'choice.resolve', data: { choiceId: attack.state.pendingChoice.id, selection: { choice: 'swarm-mana' } } })
  assert.equal(first.state.pendingChoice?.kind, 'swarm-reward')
  const second = applyCommand(first.state, 0, { action: 'choice.resolve', data: { choiceId: first.state.pendingChoice.id, selection: { choice: 'swarm-draw' } } })
  assert.equal(second.state.pendingChoice, null)
  assert.equal(second.state.players[0].mana, match.players[0].mana + 1)
  assert.equal(second.state.players[0].hand.length, match.players[0].hand.length + 1)
})

test('Загребущий рой reward also resolves when Doggo dies at the end of its buffed turn', () => {
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const swarm = turnUnit('Аскетик', 0, 4, 1, { id: 'doggo-swarm', item: { ...realCatalog.find(card => card.Name === 'Загребущий рой'), instanceId: 'doggo-swarm-item' } })
  const doggo = turnUnit('Догго', 0, 4, 0, { doggoBuffs: 1, health: 1, maxHealth: 1 })
  match.board.push(swarm, doggo)
  match.players[0].played = true
  const ended = applyCommand(match, 0, { action: 'turn.end', data: {} })
  assert.equal(ended.state.board.some(unit => unit.id === doggo.id), false)
  assert.equal(ended.state.pendingChoice?.kind, 'swarm-reward')
  const resolved = applyCommand(ended.state, 0, { action: 'choice.resolve', data: { choiceId: ended.state.pendingChoice.id, selection: { choice: 'swarm-mana' } } })
  assert.equal(resolved.state.players[0].mana, ended.state.players[0].mana + 1)
})

test('catalog Dedrubi parses its owner-turn weakest-creature burn', () => {
  assert.deepEqual(startTurnEffect(realCatalog.find(card => card.Name === 'Дедруби').Description), { scope: 'owner-turn', operations: [{ kind: 'burn-weakest-creature' }] })
})

test('Dedrubi automatically burns the only weakest creature on either seat turn', () => {
  for (const seat of [0, 1]) for (const burnSave of [false, true]) {
    const match = createMatch(input)
    match.current = 1 - seat
    const source = turnUnit('Дедруби', seat, seat === 0 ? 4 : 0, 2)
    const target = { id: 'weakest', card: { ...catalog[0], instanceId: 'weakest-card' }, owner: 1 - seat, row: 2, col: 2, health: 1, maxHealth: 3, attack: 1, speed: 1, shield: true, flippedTurns: 2, blackTokens: 0, item: { ...catalog[1], Type: 1, instanceId: 'weakest-item' } }
    match.board.push(source, target)
    match.players[target.owner].nextBurnToSave = burnSave ? 1 : 0
    const before = structuredClone(match)
    const ended = applyCommand(match, 1 - seat, { action: 'turn.end', data: { option: 'no_penalty' } })
    assert.deepEqual(match, before)
    assert.deepEqual(ended.state.board.map(unit => unit.id), [source.id])
    assert.equal(ended.state.players[target.owner][burnSave ? 'saved' : 'burned'][0].instanceId, 'weakest-card')
    assert.equal(ended.state.players[target.owner].discard[0].instanceId, 'weakest-item')
    assert.equal(ended.state.players[target.owner].nextBurnToSave, 0)
    assert.equal(ended.state.version, 1)
    assert.ok(!ended.state.pendingChoice)
  }
})

test('Dedrubi tied health asks its owner privately and validates the weakest target', () => {
  const match = createMatch(input)
  const source = turnUnit('Дедруби', 1, 0, 2)
  const own = { id: 'weak-own', card: { ...catalog[0], instanceId: 'weak-own-card' }, owner: 1, row: 1, col: 2, health: 1, maxHealth: 3, attack: 1, speed: 1, blackTokens: 0 }
  const enemy = { ...own, id: 'weak-enemy', card: { ...catalog[1], instanceId: 'weak-enemy-card' }, owner: 0, row: 3, col: 2, flippedTurns: 3 }
  const building = { ...own, id: 'building', card: { ...catalog[2], Type: 3 }, row: 2, col: 2 }
  match.board.push(source, own, enemy, building)
  const ended = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  const choice = ended.state.pendingChoice
  assert.equal(choice?.kind, 'start-turn-weakest-burn')
  assert.deepEqual(choice.unitIds, [own.id, enemy.id])
  assert.equal(projectForPlayer(ended.state, 0).private.pendingChoice, null)
  const options = projectForPlayer(ended.state, 1).private.pendingChoice.options
  assert.deepEqual(options.map(option => option.unitId), [own.id, enemy.id])
  assert.ok(!options[1].name.includes(enemy.card.Name))
  const resolve = id => ({ action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: id } } })
  assert.throws(() => applyCommand(ended.state, 0, resolve(own.id)), { code: 'NOT_CHOICE_OWNER' })
  for (const id of [source.id, building.id, 'missing']) assert.throws(() => applyCommand(ended.state, 1, resolve(id)), { code: 'INVALID_CHOICE' })
  assert.throws(() => applyCommand(ended.state, 1, { action: 'turn.end', data: { option: 'no_penalty' } }), { code: 'CHOICE_PENDING' })
  const resolved = applyCommand(ended.state, 1, resolve(enemy.id))
  assert.equal(resolved.state.players[0].burned[0].instanceId, enemy.card.instanceId)
  assert.equal(resolved.state.players[1].burned.length, 0)
  assert.equal(resolved.state.pendingChoice, null)
  assert.equal(resolved.state.pendingTurnStart, null)
  assert.equal(resolved.state.players[1].mana, 1)
  assert.equal(resolved.state.version, 2)
  assert.ok(!JSON.stringify(resolved.events).includes(enemy.card.Name))
})

test('flipped Dedrubi and Dedrubi without another living creature skip the burn', () => {
  for (const flipped of [0, 2]) {
    const match = createMatch(input)
    match.board.push(turnUnit('Дедруби', 1, 0, 2, { flippedTurns: flipped }))
    if (flipped) match.board.push({ id: 'weakest', card: catalog[0], owner: 0, row: 2, col: 2, health: 1, maxHealth: 1, attack: 1, speed: 1, blackTokens: 0 })
    const ended = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
    assert.equal(ended.state.board.length, flipped ? 2 : 1)
    assert.ok(!ended.state.pendingChoice)
  }
})

test('Dedrubi burn resolves lethal death effects before the rest of turn start', () => {
  const match = createMatch(input)
  const bomber = turnUnit('Подрывник', 0, 3, 2, { health: 1 })
  match.board.push(turnUnit('Дедруби', 1, 0, 2), bomber)
  match.players[1].health = 3
  const ended = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(ended.state.status, 'finished')
  assert.equal(ended.state.winnerUserId, match.players[0].userId)
  assert.equal(ended.state.players[0].burned[0].Name, 'Подрывник')
  assert.ok(!ended.state.pendingChoice)
})

test('lethal Dedrubi choice cancels the remaining start-turn shield queue', () => {
  const match = createMatch(input)
  const source = turnUnit('Дедруби', 1, 0, 2)
  const bomber = turnUnit('Подрывник', 0, 3, 2, { health: 1 })
  const tied = { id: 'tied', card: catalog[0], owner: 0, row: 4, col: 2, health: 1, maxHealth: 1, attack: 1, speed: 1, blackTokens: 0 }
  match.board.push(source, bomber, tied, turnUnit('Генератор щита', 1, 1, 2))
  match.players[1].health = 3
  const ended = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(ended.state.pendingChoice.kind, 'start-turn-weakest-burn')
  const resolved = applyCommand(ended.state, 1, { action: 'choice.resolve', data: { choiceId: ended.state.pendingChoice.id, selection: { unitId: bomber.id } } })
  assert.equal(resolved.state.status, 'finished')
  assert.equal(resolved.state.winnerUserId, match.players[0].userId)
  assert.equal(resolved.state.pendingChoice, null)
  assert.equal(resolved.state.pendingTurnStart, null)
  assert.ok(!resolved.events.some(event => event.type === 'start-turn.effect'))
})

test('Dedrubi choice resumes a later private hand burn before settling the hand', () => {
  const match = createMatch(input)
  const source = turnUnit('Дедруби', 1, 0, 2)
  const handBurn = { id: 'hand-burn', card: { ...catalog[0], Name: 'Рокочущий рыцарь', Description: 'Постоянно: В начале хода сожгите 1 карту из вашей руки.' }, owner: 1, row: 0, col: 3, health: 4, maxHealth: 4, attack: 3, speed: 1, blackTokens: 0 }
  const weak = { id: 'weak', card: catalog[0], owner: 0, row: 3, col: 2, health: 1, maxHealth: 1, attack: 1, speed: 1, blackTokens: 0 }
  match.board.push(source, weak, { ...weak, id: 'weak-two', col: 3 }, handBurn)
  const ended = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  const burned = applyCommand(ended.state, 1, { action: 'choice.resolve', data: { choiceId: ended.state.pendingChoice.id, selection: { unitId: weak.id } } })
  assert.equal(burned.state.pendingChoice.kind, 'start-turn-burn')
  assert.equal(burned.state.players[1].mana, 0)
  const resolved = applyCommand(burned.state, 1, { action: 'choice.resolve', data: { choiceId: burned.state.pendingChoice.id, selection: { unitIds: [burned.state.players[1].hand[0].instanceId] } } })
  assert.equal(resolved.state.pendingTurnStart, null)
  assert.equal(resolved.state.pendingChoice, null)
  assert.equal(resolved.state.players[1].hand.length, 4)
  assert.equal(resolved.state.players[1].mana, 1)
  assert.equal(resolved.state.version, 3)
})

test('new start-turn effects reject additional unsupported text without changing the match', () => {
  for (const name of ['Дедруби', 'Аскетик', 'Зелёная']) {
    const match = createMatch(input)
    const source = turnUnit(name, 1, 0, 2)
    source.card.Description += '\nПостоянно: В начале вашего хода украдите все карты.'
    match.board.push(source)
    const before = structuredClone(match)
    assert.throws(() => applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } }, () => 0), { code: 'UNSUPPORTED_EFFECT' })
    assert.deepEqual(match, before)
  }
})

test('Ascetic start-turn gamba uses the injected roll and consumes its modifiers', () => {
  for (const roll of [1, 2, 3, 4, 5, 6]) {
    const match = createMatch(input)
    const source = turnUnit('Аскетик', 1, 0, 2)
    match.board.push(source)
    let rolls = 0
    const ended = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } }, () => { rolls++; return (roll - 1) / 6 })
    assert.equal(rolls, 1)
    assert.equal(ended.state.board.some(unit => unit.id === source.id), roll > 2)
    assert.equal(ended.state.players[1].discard.length, roll <= 2 ? 1 : 0)
    assert.equal(ended.state.version, 1)
    assert.ok(ended.events.some(event => event.type === 'start-turn.gamba.resolved' && event.roll === roll))
  }
  const match = createMatch(input)
  const source = turnUnit('Аскетик', 1, 0, 2, { item: { Name: 'Алмаз', Type: 1 } })
  match.board.push(source)
  match.players[1].nextGambaBonus = 2
  const ended = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } }, () => 0)
  assert.equal(ended.state.board.length, 1)
  assert.equal(ended.state.players[1].nextGambaBonus, 0)
  assert.ok(ended.events.some(event => event.type === 'start-turn.gamba.resolved' && event.roll === 4))
})

test('start-turn gamba resumes after a private choice and does not roll before resolution', () => {
  const match = createMatch(input)
  const shield = turnUnit('Генератор щита', 1, 0, 2)
  const ascetic = turnUnit('Аскетик', 1, 1, 2)
  match.board.push(shield, ascetic)
  let rolls = 0
  const random = () => { rolls++; return 0 }
  const ended = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } }, random)
  assert.equal(ended.state.pendingChoice.kind, 'start-turn-shield')
  assert.equal(rolls, 0)
  const resolved = applyCommand(ended.state, 1, { action: 'choice.resolve', data: { choiceId: ended.state.pendingChoice.id, selection: { unitId: ascetic.id } } }, random)
  assert.equal(rolls, 1)
  assert.equal(resolved.state.board.some(unit => unit.id === ascetic.id), false)
  assert.equal(resolved.state.pendingTurnStart, null)
  assert.equal(resolved.state.version, 2)
})

test('Green start-turn gamba heals allied creatures or damages enemy cards and player', () => {
  for (const seat of [0, 1]) for (const roll of [1, 2, 3, 4, 5, 6]) {
    const match = createMatch(input)
    match.current = 1 - seat
    const green = turnUnit('Зелёная', seat, seat === 0 ? 4 : 0, 2, { health: 2, maxHealth: 3 })
    const ally = { id: 'ally', card: catalog[0], owner: seat, row: 2, col: 1, health: 2, maxHealth: 3, attack: 1, speed: 1, blackTokens: 0 }
    const ownBuilding = { ...ally, id: 'own-building', card: { ...catalog[1], Type: 3 }, row: 1, col: 1 }
    const enemy = { ...ally, id: 'enemy', owner: 1 - seat, row: 3, col: 1 }
    const enemyBuilding = { ...enemy, id: 'enemy-building', card: { ...catalog[2], Type: 3 }, row: 3, col: 3 }
    const flippedEnemy = { ...enemy, id: 'flipped-enemy', flippedTurns: 2, row: 2, col: 3 }
    match.board.push(green, ally, ownBuilding, enemy, enemyBuilding, flippedEnemy)
    match.players[seat].health = 44
    match.players[1 - seat].health = 43
    const ended = applyCommand(match, 1 - seat, { action: 'turn.end', data: { option: 'no_penalty' } }, () => (roll - 1) / 6)
    const healing = roll % 2 === 1
    const health = id => ended.state.board.find(unit => unit.id === id).health
    assert.equal(health(green.id), healing ? 3 : 2)
    assert.equal(health(ally.id), healing ? 3 : 2)
    assert.equal(health(ownBuilding.id), 2)
    assert.equal(health(enemy.id), healing ? 2 : 1)
    assert.equal(health(enemyBuilding.id), healing ? 2 : 1)
    assert.equal(health(flippedEnemy.id), 2)
    assert.equal(ended.state.players[seat].health, healing ? 45 : 44)
    assert.equal(ended.state.players[1 - seat].health, healing ? 43 : 42)
    assert.equal(ended.state.version, 1)
    assert.ok(ended.events.some(event => event.type === 'start-turn.gamba.resolved' && event.roll === roll))
  }
})

test('Green healing gives Rose Diamond shields even at full health and credits Ame only on healing', () => {
  const match = createMatch(input)
  const green = turnUnit('Зелёная', 1, 0, 2)
  const ame = turnUnit('Аме', 1, 1, 2)
  const rose = turnUnit('Розовый Алмаз', 1, 2, 2)
  const wounded = { id: 'wounded', card: catalog[0], owner: 1, row: 1, col: 3, health: 2, maxHealth: 3, attack: 1, speed: 1, blackTokens: 0 }
  match.board.push(green, ame, rose, wounded)
  const ended = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } }, () => 0)
  assert.ok(ended.state.board.every(unit => unit.shield))
  assert.equal(ended.state.board.find(unit => unit.id === ame.id).attack, ame.attack + 1)
  assert.equal(ended.state.board.find(unit => unit.id === wounded.id).health, 3)
})

test('Green enemy damage resolves death chains and a player lethal without another pending choice', () => {
  const match = createMatch(input)
  const bomber = turnUnit('Подрывник', 0, 3, 2, { health: 1 })
  match.board.push(turnUnit('Зелёная', 1, 0, 2), bomber)
  match.players[0].health = 1
  match.players[1].health = 3
  const ended = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } }, () => 1 / 6)
  assert.equal(ended.state.board.some(unit => unit.id === bomber.id), false)
  assert.equal(ended.state.players[0].discard[0].Name, 'Подрывник')
  assert.equal(ended.state.status, 'finished')
  assert.ok(!ended.state.pendingChoice)
})

test('starts the first turn with round-one resources and preserves the four-card opening hand', () => {
  const match = createMatch(input)
  assert.equal(match.players.length, 2)
  for (const player of match.players) {
    assert.equal(player.health, 45)
    assert.equal(player.limit, 4)
    assert.equal(player.hand.length, 4)
    assert.equal(player.deck.length + player.hand.length, 30)
  }
  assert.equal(match.players[0].mana, 1)
  assert.equal(match.players[0].energy, 1)
  assert.equal(match.players[1].mana, 0)
  assert.equal(match.players[1].energy, 0)
  assert.notEqual(match.players[0].hand, match.players[1].hand)
  const cardInstances = match.players.flatMap(player => [...player.deck, ...player.hand])
  assert.equal(new Set(cardInstances.map(card => card.instanceId)).size, 60)
  assert.equal(match.version, 0)
  assert.equal(match.status, 'active')
})

test('rejects non-playable decks before constructing a match', () => {
  const invalid = { ...input, players: [...input.players.slice(0, 1), { ...input.players[1], deck: ['unknown', ...deck.slice(1)] }] }
  assert.throws(() => createMatch(invalid), { code: 'DECK_NOT_PLAYABLE' })
})

test('projects only the requesting seat hand and never publishes either deck order', () => {
  const match = createMatch(input)
  match.players[0].nextScoreAdjustment = 1
  const view = projectForPlayer(match, 0)
  assert.deepEqual(view.private.hand.map(card => card.Id), match.players[0].hand.map(card => card.Id))
  assert.equal('hand' in view.public.players[1], false)
  assert.deepEqual(view.public.board, [])
  assert.equal('log' in view.public, false)
  assert.deepEqual(view.public.players.map(player => player.handCount), match.players.map(player => player.hand.length))
  assert.equal('hand' in view.public.players[1], false)
  assert.equal(view.private.nextScoreAdjustment, 1)
  assert.equal('nextScoreAdjustment' in view.public.players[0], false)
  assert.deepEqual(Object.keys(view.private).sort(), ['burnedThisTurn', 'deckCount', 'hand', 'handLimitLocked', 'nextBurnToSave', 'nextGambaBonus', 'nextScoreAdjustment', 'pendingChoice', 'saved', 'seat'])
  match.players[0].depressiveHandLimit = { previousLimit: 6 }
  assert.equal(projectForPlayer(match, 0).private.handLimitLocked, true)
  assert.equal(projectForPlayer(match, 1).private.handLimitLocked, false)
  assert.equal(view.private.pendingChoice, null)
  assert.equal('deck' in view.private, false)
  assert.equal('deck' in view.public.players[1], false)
})

test('saved cards return to their owner hand on either seat turn without spending or marking a play', () => {
  for (const seat of [0, 1]) {
    const match = createMatch(input)
    match.current = seat
    const saved = { ...catalog[0], instanceId: 'owner-saved' }
    const enemySaved = { ...catalog[1], instanceId: 'enemy-saved' }
    match.players[seat].saved = [saved]
    match.players[1 - seat].saved = [enemySaved]
    const before = structuredClone(match.players[seat])
    assert.throws(() => applyCommand(match, 1 - seat, { action: 'card.takeSaved', data: { cardInstanceId: enemySaved.instanceId } }), { code: 'NOT_YOUR_TURN' })
    assert.throws(() => applyCommand(match, seat, { action: 'card.takeSaved', data: { cardInstanceId: enemySaved.instanceId } }), { code: 'CARD_NOT_IN_SAVED' })
    assert.throws(() => applyCommand(match, seat, { action: 'card.takeSaved', data: { cardInstanceId: saved.instanceId, mana: 999 } }), { code: 'INVALID_COMMAND' })
    const result = applyCommand(match, seat, { action: 'card.takeSaved', data: { cardInstanceId: saved.instanceId } })
    assert.deepEqual(result.state.players[seat].hand, [...before.hand, saved])
    assert.equal(result.state.players[seat].saved.length, 0)
    assert.deepEqual(result.state.players[1 - seat].saved, [enemySaved])
    assert.deepEqual([result.state.players[seat].mana, result.state.players[seat].energy, result.state.players[seat].played], [before.mana, before.energy, false])
    assert.equal(result.state.version, 1)
    assert.equal(JSON.stringify(result.events).includes(saved.instanceId), false)
    assert.deepEqual(match.players[seat], before)
    assert.throws(() => applyCommand(result.state, seat, { action: 'card.takeSaved', data: { cardInstanceId: saved.instanceId } }), { code: 'CARD_NOT_IN_SAVED' })
  }
})

test('saved-card projections allowlist owner card fields and hide the opponent pile', () => {
  const match = createMatch(input)
  match.players[0].saved = [{ ...catalog[0], instanceId: 'private-saved-id', internalSeed: 'never-expose' }]
  match.players[1].saved = [{ ...catalog[1], instanceId: 'opponent-saved-id' }]
  const owner = projectForPlayer(match, 0)
  assert.equal(owner.private.saved[0].instanceId, 'private-saved-id')
  assert.equal('internalSeed' in owner.private.saved[0], false)
  assert.equal(JSON.stringify(owner).includes('opponent-saved-id'), false)
  assert.equal(JSON.stringify(projectForPlayer(match, 1)).includes('private-saved-id'), false)
})

test('keeps private card instance ids out of public board ids, projections, and events', () => {
  const match = createMatch(input)
  const card = { ...catalog[0], instanceId: 'ci_match-1_0_13' }
  match.players[0].hand = [card]
  match.players[0].mana = card.Cost

  const result = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: card.instanceId, target: { row: 4, col: 1 }, payment: 'mana' } })
  const opponentView = projectForPlayer(result.state, 1)
  assert.notEqual(result.state.board[0].id, `unit_${card.instanceId}`)
  assert.equal(JSON.stringify(opponentView).includes(card.instanceId), false)
  assert.deepEqual(result.events, [{ type: 'card.played', cardId: card.Id, unitId: result.state.board[0].id, target: { row: 4, col: 1 } }])
})

test('hides a flipped card identity, item, and combat stats from both projections', () => {
  const match = createMatch(input)
  match.board.push({ id: 'unit-opaque', card: { ...catalog[0], instanceId: 'ci_match-1_1_9' }, item: { Id: 'secret-item', Name: 'Скрытый предмет', Type: 1, Attack: 2 }, owner: 1, row: 1, col: 1, health: 0, maxHealth: 8, attack: 7, speed: 3, shield: true, flippedTurns: 2, stunned: 1, abilityUsed: true, summoned: 2, attacks: 1, dying: false })

  for (const seat of [0, 1]) {
    const unit = projectForPlayer(match, seat).public.board[0]
    assert.deepEqual(unit.card, { Name: 'Перевёрнутая карта', Description: '', Type: -1 })
    assert.equal(unit.item, undefined)
    assert.deepEqual([unit.health, unit.maxHealth, unit.attack, unit.speed, unit.shield], [0, 0, 0, 0, undefined])
    assert.equal(unit.stunned, undefined)
    assert.equal(unit.abilityUsed, undefined)
    assert.equal(unit.summoned, undefined)
    assert.equal(unit.attacks, undefined)
    assert.equal(JSON.stringify(unit).includes('ci_match-1_1_9'), false)
    assert.equal(JSON.stringify(unit).includes(catalog[0].Name), false)
    assert.equal(JSON.stringify(unit).includes('Скрытый предмет'), false)
  }
})

test('catalog corpse trade heals and draws once when cast, with normal cost and discard', () => {
  const spell = { ...realCatalog.find(card => card.Name === 'Сдача трупа'), instanceId: 'corpse-trade' }
  const match = createMatch(input)
  match.players[0].hand = [spell]
  match.players[0].mana = spell.Cost
  match.players[0].health = 30
  const deckCount = match.players[0].deck.length
  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
  assert.equal(result.state.players[0].health, 35)
  assert.equal(result.state.players[0].hand.length, 1)
  assert.equal(result.state.players[0].deck.length, deckCount - 1)
  assert.equal(result.state.players[0].mana, 0)
  assert.equal(result.state.players[0].discard[0].instanceId, spell.instanceId)
  assert.equal(result.state.players[0].burned.length, 0)
  assert.equal(result.state.version, 1)
  assert.equal(match.players[0].health, 30)
})

test('corpse trade burn triggers in each pile burn path and a burn save suppresses it', () => {
  for (const kind of ['start-turn-burn', 'ability-conveyor', 'ability-librarian']) for (const saved of [false, true]) {
    const spell = { ...realCatalog.find(card => card.Name === 'Сдача трупа'), instanceId: 'burn-corpse' }
    const drawn = { ...catalog[2], instanceId: 'burn-drawn' }
    const filler = { ...catalog[1], instanceId: 'burn-filler' }
    const match = createMatch(input)
    match.players[0].health = 30
    match.players[0].mana = 1
    match.players[0].limit = 1
    match.players[0].nextBurnToSave = saved ? 1 : 0
    match.players[0].hand = kind === 'ability-librarian' ? [filler] : [spell, filler]
    match.players[0].deck = kind === 'ability-librarian' ? [spell, drawn] : [drawn]
    match.pendingChoice = { id: 'burn-choice', kind, owner: 0, sourceUnitId: 'source', sourceCardName: 'Source', unitIds: [spell.instanceId], count: 1, stage: kind === 'ability-conveyor' ? 'burn' : 'card', cost: 1, pile: 'deck', abilityIndex: 0 }
    if (kind === 'start-turn-burn') match.pendingTurnStart = { sources: [], sourceIndex: 0, operationIndex: 0, manaBonus: [0, 0], energyBonus: [0, 0] }
    const result = applyCommand(match, 0, { action: 'choice.resolve', data: { choiceId: 'burn-choice', selection: kind === 'start-turn-burn' ? { unitIds: [spell.instanceId] } : { unitId: spell.instanceId } } }, () => 0)
    assert.equal(result.state.players[0].health, saved ? 30 : 35, `${kind}: health`)
    assert.equal(result.state.players[0].hand.some(card => card.instanceId === drawn.instanceId), !saved, `${kind}: draw`)
    assert.equal(result.state.players[0].burned.some(card => card.instanceId === spell.instanceId), !saved)
    assert.equal(result.state.players[0].saved.some(card => card.instanceId === spell.instanceId), saved)
  }
})

test('casts a global healing spell from hand using the server card description', () => {
  const spell = { ...catalog[0], Id: 'heal-spell', Name: 'Восстановление', Type: 2, Cost: 1, Description: 'Восстановите 4 здоровья обоим игрокам.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'spell-instance' }
  match.players[0].hand = [card]
  match.players[0].health = 40
  match.players[1].health = 38
  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana' } })
  assert.equal(result.state.players[0].health, 44)
  assert.equal(result.state.players[1].health, 42)
  assert.equal(result.state.players[0].hand.length, 0)
  assert.equal(result.state.players[0].discard[0].instanceId, card.instanceId)
  assert.equal(result.state.players[0].mana, 0)
  assert.equal(result.state.players[0].played, true)
  assert.equal(result.state.version, 1)
  assert.equal(result.events[0].type, 'spell.cast')
  assert.equal(JSON.stringify(result.events).includes(card.instanceId), false)
  assert.equal(result.events[0].cardId, card.Id)
})

test('the real Auction spell keeps one injected-random creature and resolves the others deaths', () => {
  const spell = realCatalog.find(card => card.Name === 'Аукцион')
  assert.ok(spell)
  const match = createMatch(input)
  const creatures = [turnUnit('ДастАроникс', 0, 4, 0), ...[1, 2].map(index => ({ id: `auction_${index}`, card: { ...catalog[index] }, owner: 1, row: 0, col: index, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }))]
  match.board.push(...creatures)
  const card = { ...spell, instanceId: 'auction-spell' }
  match.players[0].hand = [card]
  match.players[0].mana = spell.Cost
  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana' } }, () => 0.99)
  assert.deepEqual(result.state.board.map(unit => unit.id), [creatures[2].id])
  assert.deepEqual(result.state.players[0].discard.map(item => item.instanceId), [creatures[0].card.instanceId, card.instanceId])
  assert.deepEqual(result.state.players[1].discard.map(item => item.instanceId), [creatures[1].card.instanceId])
  assert.equal(result.state.players[0].discard.at(-1).instanceId, card.instanceId)
  assert.equal(result.state.players[0].hand.length, 1)
  assert.equal(result.state.version, 1)
})

test('deck-buildable spells reach resolution or target validation instead of failing as unsupported', () => {
  const spells = realCatalog.filter(card => card.Type === 2 && !card.Tags?.includes('в разработке'))
  for (const spell of spells) {
    const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
    const card = { ...spell, instanceId: 'catalog-spell' }
    match.players[0].hand = [card]
    match.players[0].mana = 50
    try {
      applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana' } }, () => 0.5)
    } catch (error) {
      assert.notEqual(error.code, 'UNSUPPORTED_EFFECT', `${spell.Name}: ${spell.Description}`)
    }
  }
})

test('the real friendly-sacrifice spell privately destroys two allies then debuffs enemy creatures', () => {
  const spell = realCatalog.find(card => card.Name === 'Бей своих чтобы чужие боялись')
  assert.ok(spell)
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const allies = [0, 1].map(index => ({ id: `ally-${index}`, card: { ...catalog[index] }, owner: 0, row: 4, col: index, health: 5, maxHealth: 5, attack: 2, speed: 3, summoned: 0, attacks: 0, blackTokens: 0 }))
  const enemies = [0, 1].map(index => ({ id: `enemy-${index}`, card: { ...catalog[index] }, owner: 1, row: 0, col: index, health: 5, maxHealth: 5, attack: 2, speed: 3, summoned: 0, attacks: 0, blackTokens: 0 }))
  match.board.push(...allies, ...enemies)
  const card = { ...spell, instanceId: 'sacrifice-spell' }
  match.players[0].hand = [card]
  match.players[0].mana = spell.Cost
  const cast = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana' } })
  assert.equal(cast.state.pendingChoice.kind, 'spell-destroy-creatures')
  assert.equal(cast.state.pendingChoice.count, 2)
  assert.deepEqual(cast.state.pendingChoice.unitIds, allies.map(unit => unit.id))
  assert.equal(cast.state.players[0].discard.at(-1).instanceId, card.instanceId)
  const resolved = applyCommand(cast.state, 0, { action: 'choice.resolve', data: { choiceId: cast.state.pendingChoice.id, selection: { unitIds: allies.map(unit => unit.id) } } })
  assert.deepEqual(resolved.state.board.map(unit => [unit.id, unit.attack, unit.speed]), enemies.map(unit => [unit.id, 1, 6]))
  assert.equal(resolved.state.version, 2)
})

test('White Door pays, privately selects a free socket, then transfers its creature target', () => {
  const spell = realCatalog.find(card => card.Name === 'Белая дверь')
  assert.ok(spell)
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const target = { id: 'door-target', card: { ...catalog[0] }, owner: 1, row: 0, col: 0, health: 5, maxHealth: 5, attack: 2, speed: 1 }
  match.board.push(target)
  const card = { ...spell, instanceId: 'white-door-spell' }
  match.players[0].hand = [card]
  match.players[0].mana = spell.Cost
  const cast = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { unitId: target.id } } })
  assert.equal(cast.state.pendingChoice.kind, 'spell-move-target')
  assert.equal(cast.state.pendingChoice.targetUnitId, target.id)
  assert.ok(cast.state.pendingChoice.cells.some(cell => cell.row === 2 && cell.col === 2))
  const resolved = applyCommand(cast.state, 0, { action: 'choice.resolve', data: { choiceId: cast.state.pendingChoice.id, selection: { cell: { row: 2, col: 2 } } } })
  assert.deepEqual([resolved.state.board[0].row, resolved.state.board[0].col], [2, 2])
  assert.equal(resolved.state.pendingChoice, null)
  assert.equal(resolved.state.version, 2)
})

test('Bruteforce moves a selected creature only to an empty opponent home-row socket', () => {
  const spell = realCatalog.find(card => card.Name === 'Брутфорс')
  assert.ok(spell)
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const target = { id: 'bruteforce-target', card: { ...catalog[0] }, owner: 1, row: 1, col: 1, health: 5, maxHealth: 5, attack: 2, speed: 1 }
  match.board.push(target)
  const card = { ...spell, instanceId: 'bruteforce-spell' }
  match.players[0].hand = [card]
  match.players[0].mana = spell.Cost
  const cast = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { unitId: target.id } } })
  assert.equal(cast.state.pendingChoice.kind, 'spell-move-target')
  assert.equal(cast.state.pendingChoice.mode, 'opponent')
  assert.ok(cast.state.pendingChoice.cells.every(cell => cell.row === 0))
  assert.throws(() => applyCommand(cast.state, 0, { action: 'choice.resolve', data: { choiceId: cast.state.pendingChoice.id, selection: { cell: { row: 1, col: 2 } } } }), error => error.code === 'INVALID_CHOICE')
  const resolved = applyCommand(cast.state, 0, { action: 'choice.resolve', data: { choiceId: cast.state.pendingChoice.id, selection: { cell: { row: 0, col: 2 } } } })
  assert.deepEqual([resolved.state.board[0].row, resolved.state.board[0].col], [0, 2])
  assert.equal(resolved.state.version, 2)
})

test('the real gamba spell rolls server-side and damages the selected card or player', () => {
  const spell = realCatalog.find(card => card.Name === 'В следующий раз повезёт')
  assert.ok(spell)
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const target = { id: 'gamba-target', card: { ...catalog[0] }, owner: 1, row: 0, col: 0, health: 7, maxHealth: 7, attack: 2, speed: 1 }
  match.board.push(target)
  const card = { ...spell, instanceId: 'gamba-spell' }
  match.players[0].hand = [card]
  match.players[0].mana = spell.Cost
  const hit = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { unitId: target.id } } }, () => 0.5)
  assert.equal(hit.state.board[0].health, 3)
  assert.equal(hit.state.version, 1)
  const selfCast = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  selfCast.players[0].hand = [{ ...spell, instanceId: 'gamba-self' }]
  selfCast.players[0].mana = spell.Cost
  selfCast.players[0].health = 10
  const selfHit = applyCommand(selfCast, 0, { action: 'spell.cast', data: { cardInstanceId: 'gamba-self', payment: 'mana', target: { player: 'self' } } }, () => 0)
  assert.equal(selfHit.state.players[0].health, 9)
})

test('Discord Drama spends the chosen mana and doubles damage to a player only when its score passes', () => {
  const spell = realCatalog.find(card => card.Name === 'Дискорд драма')
  assert.ok(spell)
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const target = { id: 'discord-target', card: { ...catalog[0] }, owner: 1, row: 0, col: 0, health: 20, maxHealth: 20, attack: 2, speed: 1 }
  match.board.push(target)
  const card = { ...spell, instanceId: 'discord-spell' }
  match.players[0].hand = [card, ...Array.from({ length: 7 }, (_, index) => ({ ...catalog[index], instanceId: `held-${index}` }))]
  match.players[0].mana = 10
  const hit = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { unitId: target.id }, manaAmount: 3 } })
  assert.equal(hit.state.board[0].health, 17)
  assert.equal(hit.state.players[0].mana, 7)
  assert.equal(hit.state.players[0].discard.at(-1).instanceId, card.instanceId)

  const playerHit = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { player: 'opponent' }, manaAmount: 3 } })
  assert.equal(playerHit.state.players[1].health, 39)
})

test('Discord Drama rejects a player target below its score and an unaffordable mana amount before payment', () => {
  const spell = realCatalog.find(card => card.Name === 'Дискорд драма')
  assert.ok(spell)
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const card = { ...spell, instanceId: 'discord-invalid' }
  match.players[0].hand = [card]
  match.players[0].mana = 2
  assert.throws(() => applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { player: 'opponent' }, manaAmount: 1 } }), error => error.code === 'INVALID_TARGET')
  assert.throws(() => applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { player: 'opponent' }, manaAmount: 3 } }), error => error.code === 'NOT_ENOUGH_MANA')
  assert.equal(match.players[0].mana, 2)
  assert.equal(match.players[0].hand[0].instanceId, card.instanceId)
})

test('Dodep burns a chosen hand card, rolls once, then awards the selected resource', () => {
  const spell = realCatalog.find(card => card.Name === 'Додеп')
  assert.ok(spell)
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const burn = { ...catalog[0], instanceId: 'dodep-burn-card' }
  const card = { ...spell, instanceId: 'dodep-spell' }
  match.players[0].hand = [card, burn]
  match.players[0].mana = spell.Cost
  const cast = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana' } }, () => 0.5)
  assert.equal(cast.state.pendingChoice.kind, 'spell-dodep')
  assert.equal(cast.state.pendingChoice.stage, 'burn')
  assert.equal(cast.state.players[0].discard.at(-1).instanceId, card.instanceId)
  const rolled = applyCommand(cast.state, 0, { action: 'choice.resolve', data: { choiceId: cast.state.pendingChoice.id, selection: { unitId: burn.instanceId } } }, () => 0.5)
  assert.equal(rolled.state.pendingChoice.stage, 'resource')
  assert.equal(rolled.state.pendingChoice.amount, 4)
  assert.equal(rolled.state.players[0].burned.at(-1).instanceId, burn.instanceId)
  assert.equal(rolled.events.some(event => JSON.stringify(event).includes('amount')), false)
  const rewarded = applyCommand(rolled.state, 0, { action: 'choice.resolve', data: { choiceId: rolled.state.pendingChoice.id, selection: { choice: 'energy' } } })
  assert.equal(rewarded.state.players[0].energy, match.players[0].energy + 4)
  assert.equal(rewarded.state.pendingChoice, null)
  assert.equal(rewarded.state.version, 3)
})

test('Dodep finishes without rolling when its cast leaves no card in hand to burn', () => {
  const spell = realCatalog.find(card => card.Name === 'Додеп')
  assert.ok(spell)
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  match.players[0].hand = [{ ...spell, instanceId: 'dodep-empty-hand' }]
  match.players[0].mana = spell.Cost
  let rolls = 0
  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'dodep-empty-hand', payment: 'mana' } }, () => { rolls++; return 0.5 })
  assert.equal(result.state.pendingChoice, undefined)
  assert.equal(rolls, 0)
  assert.equal(result.state.players[0].discard.at(-1).instanceId, 'dodep-empty-hand')
})

test('Rose Evil spends the chosen nonlethal health amount and deals it to the selected card', () => {
  const spell = realCatalog.find(card => card.Name === 'Роза зло')
  assert.ok(spell)
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const target = { id: 'rose-target', card: { ...catalog[0] }, owner: 1, row: 0, col: 0, health: 10, maxHealth: 10, attack: 2, speed: 1 }
  match.board.push(target)
  const card = { ...spell, instanceId: 'rose-spell' }
  match.players[0].hand = [card]
  match.players[0].mana = 5
  match.players[0].health = 20
  assert.throws(() => applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { unitId: target.id }, healthAmount: 20 } }), error => error.code === 'NOT_ENOUGH_HEALTH')
  assert.equal(match.players[0].mana, 5)
  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { unitId: target.id }, healthAmount: 4 } })
  assert.equal(result.state.players[0].health, 16)
  assert.equal(result.state.players[0].mana, 4)
  assert.equal(result.state.board[0].health, 6)
  assert.equal(result.state.version, 1)
})

test('the real Steven spell stuns a living selected creature and burns itself', () => {
  const spell = realCatalog.find(card => card.Name === 'Посмотрюка я Стивен ДНД')
  assert.ok(spell)
  const match = createMatch(input)
  const target = turnUnit('ДастАроникс', 1, 0, 2)
  match.board.push(target)
  const card = { ...spell, instanceId: 'steven-spell' }
  match.players[0].hand = [card]
  match.players[0].mana = spell.Cost
  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { unitId: target.id } } })
  assert.equal(result.state.board[0].stunned, 10)
  assert.deepEqual(result.state.players[0].burned.map(item => item.instanceId), [card.instanceId])
  assert.equal(result.state.players[0].mana, 0)
  assert.equal(result.state.version, 1)
})

test('casts a simple draw spell and still resolves when the deck is empty', () => {
  const spell = { ...catalog[0], Id: 'draw-spell', Name: 'Простой добор', Type: 2, Cost: 1, Description: 'Возьмите карту.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'draw-spell-instance' }
  const drawn = { ...catalog[1], instanceId: 'drawn-card' }
  match.players[0].hand = [card]
  match.players[0].deck = [drawn]
  match.players[0].mana = 1

  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana' } })
  assert.deepEqual(result.state.players[0].hand, [drawn])
  assert.equal(result.state.players[0].discard[0].instanceId, card.instanceId)
  assert.equal(result.state.players[0].mana, 0)
  assert.equal(result.state.version, 1)

  const emptyDeck = { ...match, players: match.players.map((player, index) => index === 0 ? { ...player, hand: [card], deck: [], mana: 1 } : player) }
  const emptyResult = applyCommand(emptyDeck, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana' } })
  assert.deepEqual(emptyResult.state.players[0].hand, [])
  assert.equal(emptyResult.state.players[0].mana, 0)
})

test('catalog Dragonball rules draw four at score two and offer a private optional discard', () => {
  const spell = { ...realCatalog.find(card => card.Name === '100 правил драгонболла'), instanceId: 'dragonball-instance' }
  const match = createMatch(input)
  match.players[0].hand = [spell, { ...catalog[1], instanceId: 'already-in-hand' }]
  match.players[0].deck = catalog.slice(2, 7).map(card => ({ ...card, instanceId: `draw-${card.Id}` }))
  const cast = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
  assert.equal(cast.state.players[0].hand.length, 5)
  assert.equal(cast.state.players[0].deck.length, 1)
  assert.equal(cast.state.players[0].mana, 0)
  const choice = cast.state.pendingChoice
  assert.equal(choice.kind, 'spell-discard-hand')
  assert.equal(choice.count, 3)
  assert.equal(projectForPlayer(cast.state, 0).private.pendingChoice.options.length, 5)
  assert.equal(projectForPlayer(cast.state, 1).private.pendingChoice, null)
  assert.throws(() => applyCommand(cast.state, 0, { action: 'turn.end', data: { option: 'no_penalty' } }), { code: 'CHOICE_PENDING' })
  assert.throws(() => applyCommand(cast.state, 1, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: [] } } }), { code: 'NOT_CHOICE_OWNER' })
  for (const ids of [['absent'], choice.unitIds.slice(0, 4), [choice.unitIds[0], choice.unitIds[0]]]) {
    assert.throws(() => applyCommand(cast.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: ids } } }), { code: 'INVALID_CHOICE' })
  }
  const keep = applyCommand(cast.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: [] } } })
  assert.equal(keep.state.players[0].hand.length, 5)
  assert.equal(keep.state.pendingChoice, null)
  const ids = [choice.unitIds[0], choice.unitIds[2]]
  const discarded = applyCommand(cast.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: ids } } })
  assert.equal(discarded.state.players[0].hand.length, 3)
  assert.deepEqual(discarded.state.players[0].discard.slice(-2).map(card => card.instanceId), [...ids].reverse())
  assert.equal(discarded.state.version, 2)
  assert.equal(discarded.state.pendingChoice, null)
  assert.equal(ids.some(id => JSON.stringify(discarded.events).includes(id)), false)
})

test('catalog Dragonball score uses the pre-draw hand and consumes its threshold adjustment', () => {
  for (const adjustment of [0, 1]) {
    const spell = { ...realCatalog.find(card => card.Name === '100 правил драгонболла'), instanceId: 'dragonball-instance' }
    const match = createMatch(input)
    match.players[0].hand = [spell, ...catalog.slice(1, 3).map(card => ({ ...card, instanceId: card.Id }))]
    match.players[0].nextScoreAdjustment = adjustment
    match.players[0].deck = catalog.slice(3, 8).map(card => ({ ...card, instanceId: card.Id }))
    const cast = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
    assert.equal(cast.state.players[0].hand.length, adjustment ? 6 : 3)
    assert.equal(Boolean(cast.state.pendingChoice), Boolean(adjustment))
    assert.equal(cast.state.players[0].nextScoreAdjustment, 0)
  }
})

test('Подстава sends the paid spell to the opponent discard', () => {
  const spell = { ...realCatalog.find(card => card.Name === 'Подстава'), instanceId: 'prank-spell' }
  const match = createMatch(input)
  match.players[0].hand = [spell]
  match.players[0].mana = spell.Cost

  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })

  assert.equal(result.state.players[0].mana, 0)
  assert.deepEqual(result.state.players[0].discard, [])
  assert.equal(result.state.players[1].discard.at(-1).instanceId, spell.instanceId)
  assert.equal(result.state.players[0].hand.some(card => card.instanceId === spell.instanceId), false)
  assert.equal(result.state.players[0].played, true)
  assert.equal(result.state.version, 1)
})

test('catalog pile search spells pay once and finalize only after a private eligible selection', () => {
  for (const name of ['Разбан', 'Ого какой большой огурец']) for (const saveBurn of [false, true]) {
    const spell = { ...realCatalog.find(card => card.Name === name), instanceId: 'search-spell' }
    const match = createMatch(input)
    const pile = name === 'Разбан' ? 'burned' : 'deck'
    const selected = { ...catalog[1], Name: 'Selected card', Cost: 8, instanceId: 'search-selected' }
    const other = { ...catalog[2], Name: 'Other card', Cost: 9, instanceId: 'search-other' }
    const cheap = { ...catalog[3], Cost: 7, instanceId: 'search-cheap' }
    match.players[0].hand = [spell]
    match.players[0][pile] = [selected, other, cheap]
    match.players[0].mana = spell.Cost
    match.players[0].nextBurnToSave = saveBurn ? 1 : 0
    const cast = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
    assert.equal(cast.state.players[0].mana, 0)
    assert.equal(cast.state.players[0].hand[0].instanceId, spell.instanceId)
    assert.equal(cast.state.players[0].played, false)
    const choice = cast.state.pendingChoice
    assert.equal(choice.kind, 'spell-search-pile')
    assert.equal(projectForPlayer(cast.state, 0).private.pendingChoice.options.length, name === 'Разбан' ? 3 : 2)
    const opponent = projectForPlayer(cast.state, 1)
    assert.equal(opponent.private.pendingChoice, null)
    assert.equal(JSON.stringify(opponent).includes(selected.instanceId), false)
    const reversed = structuredClone(cast.state)
    reversed.players[0][pile].reverse()
    assert.deepEqual(projectForPlayer(cast.state, 0).private.pendingChoice.options, projectForPlayer(reversed, 0).private.pendingChoice.options)
    assert.throws(() => applyCommand(cast.state, 0, { action: 'turn.end', data: {} }), { code: 'CHOICE_PENDING' })
    assert.throws(() => applyCommand(cast.state, 1, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: selected.instanceId } } }), { code: 'NOT_CHOICE_OWNER' })
    for (const selection of [{ unitId: spell.instanceId }, { unitId: 'unknown' }, { unitId: selected.instanceId, mana: 999 }]) {
      assert.throws(() => applyCommand(cast.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection } }), { code: 'INVALID_CHOICE' })
    }
    if (pile === 'deck') assert.throws(() => applyCommand(cast.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: cheap.instanceId } } }), { code: 'INVALID_CHOICE' })
    const result = applyCommand(cast.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: selected.instanceId } } })
    assert.deepEqual(result.state.players[0].hand, [selected])
    assert.equal(result.state.players[0].mana, 0)
    assert.equal(result.state.players[0].played, true)
    assert.equal(result.state.pendingChoice, null)
    assert.equal(result.state.version, 2)
    assert.equal(JSON.stringify(result.events).includes(selected.instanceId), false)
    assert.deepEqual(result.state.players[0][pile].filter(card => card.instanceId !== spell.instanceId), [other, cheap])
    const destination = pile === 'deck' ? 'discard' : saveBurn ? 'saved' : 'burned'
    assert.equal(result.state.players[0][destination].at(-1).instanceId, spell.instanceId)
    assert.equal(result.state.players[0].burnedThisTurn, pile === 'burned' && !saveBurn)
  }
})

test('catalog pile searches with no eligible card finish normally without choosing the spell itself', () => {
  for (const name of ['Разбан', 'Ого какой большой огурец']) {
    const spell = { ...realCatalog.find(card => card.Name === name), instanceId: 'empty-search-spell' }
    const match = createMatch(input)
    match.players[0].hand = [spell]
    match.players[0].mana = spell.Cost
    match.players[0].deck = [{ ...catalog[1], Cost: 7, instanceId: 'ineligible' }]
    match.players[0].burned = []
    const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
    assert.equal(result.state.pendingChoice, undefined)
    assert.equal(result.state.players[0].hand.length, 0)
    assert.equal(result.state.players[0].mana, 0)
    assert.equal(result.state.players[0].played, true)
    assert.equal(result.state.players[0][name === 'Разбан' ? 'burned' : 'discard'][0].instanceId, spell.instanceId)
  }
})

test('Librarian candidate presentation reveals no searched deck order', () => {
  const match = createMatch(input)
  match.players[0].deck = [{ ...catalog[1], instanceId: 'search-b' }, { ...catalog[0], instanceId: 'search-a' }]
  match.pendingChoice = { id: 'librarian-private-choice', kind: 'ability-librarian', owner: 0, sourceUnitId: 'librarian', unitIds: ['search-b', 'search-a'], stage: 'card', cost: 1, pile: 'deck', abilityIndex: 0 }
  const view = projectForPlayer(match, 0).private.pendingChoice.options
  match.players[0].deck.reverse()
  assert.deepEqual(projectForPlayer(match, 0).private.pendingChoice.options, view)
})

test('Миндальная вода heals its caster from the catalog wording', () => {
  const spell = { ...catalog[0], Id: 'almond-water', Name: 'Миндальная вода', Type: 2, Cost: 1, Description: 'Восстановите себе 4 здоровья' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'almond-water-instance' }
  match.players[0].hand = [card]
  match.players[0].health = 40
  match.players[0].mana = 1

  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana' } })
  assert.equal(result.state.players[0].health, 44)
  assert.equal(result.state.players[0].mana, 0)
  assert.equal(result.state.players[0].discard[0].Id, spell.Id)
})

test('5000 участников destroys flipped cards and flips the remaining board', () => {
  const spell = { ...catalog[0], Id: 'five-thousand-spell', Name: '5000 участников', Type: 2, Cost: 1, Description: 'Уничтожьте все перевёрнутые карты. Примените переверот 2 оставшимся.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'five-thousand-instance' }
  match.players[0].hand = [card]
  match.players[0].mana = 1
  match.board.push(
    { id: 'flipped-creature', card: { ...catalog[1], Name: 'Flipped creature', Type: 0 }, owner: 1, row: 2, col: 1, health: 2, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0, flippedTurns: 1 },
    { id: 'flipped-building', card: { ...catalog[2], Name: 'Flipped building', Type: 3 }, owner: 0, row: 2, col: 2, health: 4, maxHealth: 4, attack: 0, speed: 0, blackTokens: 0, flippedTurns: 1 },
    { id: 'active-creature', card: { ...catalog[3], Name: 'Active creature', Type: 0 }, owner: 0, row: 2, col: 3, health: 4, maxHealth: 4, attack: 2, speed: 1, blackTokens: 0 },
  )

  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana' } })
  assert.deepEqual(result.state.board.map(unit => [unit.id, unit.flippedTurns]), [['active-creature', 2]])
  assert.equal(result.state.players[1].discard.some(item => item.Name === 'Flipped creature'), true)
  assert.equal(result.state.players[0].discard.some(item => item.Name === 'Flipped building'), true)
  assert.equal(result.state.players[0].discard.some(item => item.Id === spell.Id), true)
})

test('Гнилое ворьё steals the selected resource up to its printed amount and burns the spell', () => {
  const spell = { ...catalog[0], Id: 'rotten-thief', Name: 'Гнилое ворьё', Type: 2, Cost: 0, Description: 'Получите 2 маны или 4 энергии, противник теряет 2 маны или 4 энергии. \nСжигаеться' }
  for (const choice of ['mana', 'energy']) {
    const match = createMatch({ ...input, catalog: [...catalog, spell] })
    const card = { ...spell, instanceId: `rotten-${choice}` }
    match.players[0].hand = [card]
    match.players[0].mana = 3
    match.players[0].energy = 1
    match.players[1].mana = choice === 'mana' ? 1 : 3
    match.players[1].energy = 6
    assert.throws(() => applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana' } }), { code: 'INVALID_COMMAND' })
    assert.equal(match.players[0].mana, 3)
    assert.equal(match.version, 0)
    const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', choice } })
    assert.deepEqual([result.state.players[0].mana, result.state.players[1].mana], choice === 'mana' ? [4, 0] : [3, 3])
    assert.deepEqual([result.state.players[0].energy, result.state.players[1].energy], choice === 'energy' ? [5, 2] : [1, 6])
    assert.equal(result.state.players[0].burned[0].instanceId, card.instanceId)
    assert.equal(result.state.version, 1)
  }
})

test('Перепись населения grants one mana and energy per other card in hand', () => {
  const spell = { ...catalog[0], Id: 'census-spell', Name: 'Перепись населения', Type: 2, Cost: 5, Description: 'Получите ману и энергию равную количеству ваших карт в руке.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'census-instance' }
  match.players[0].hand = [card, { ...catalog[1], instanceId: 'other-1' }, { ...catalog[2], instanceId: 'other-2' }]
  match.players[0].mana = 10
  match.players[0].energy = 2
  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana' } })

  assert.deepEqual([result.state.players[0].mana, result.state.players[0].energy], [7, 4])
  assert.deepEqual(result.state.players[0].hand.map(item => item.instanceId), ['other-1', 'other-2'])
  assert.equal(result.state.players[0].discard[0].instanceId, card.instanceId)
})

test('Засадка пустыни пшеницей persists neutral tokens and pays the creature owner once on entry', () => {
  const spell = { ...catalog[0], Id: 'wheat-spell', Name: 'Засадка пустыни пшеницей', Type: 2, Cost: 5, Description: 'Положите ⚫ на каждый свободный нейтральный сокет. Если существо наступит на этот сокет, то ⚫ убирается и обладатель существа получает 1 ману.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'wheat-instance' }
  const creature = { ...catalog[1], Type: 0, Name: 'Mover' }
  const building = { ...catalog[2], Type: 3, Name: 'Neutral building' }
  match.players[0].hand = [card]
  match.players[0].mana = 5
  match.players[0].energy = 5
  match.board = [
    { id: 'mover', card: creature, owner: 0, row: 2, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1, blackTokens: 0, summoned: 0 },
    { id: 'building', card: building, owner: 1, row: 2, col: 2, health: 3, maxHealth: 3, attack: 0, speed: 0, blackTokens: 0 },
  ]
  const cast = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana' } })

  assert.equal(cast.state.wheatTokens.length, 13)
  assert.equal(cast.state.wheatTokens.some(token => token.row === 2 && token.col === 2), false)
  assert.equal(projectForPlayer(cast.state, 1).public.wheatTokens.length, 13)
  const moved = applyCommand(cast.state, 0, { action: 'unit.move', data: { unitId: 'mover', to: { row: 2, col: 1 } } })
  assert.equal(moved.state.players[0].mana, 1)
  assert.equal(moved.state.wheatTokens.some(token => token.row === 2 && token.col === 1), false)
})

test('Swoon uses the caster burn flag and exposes it only in that player private projection', () => {
  for (const burnedThisTurn of [false, true]) {
    const spell = { ...catalog[0], Id: 'swoon-spell', Name: 'Swoon', Type: 2, Cost: 3, Description: 'Убивает выбранное существо, если вы сожгли свою карту в этом ходу.' }
    const match = createMatch({ ...input, catalog: [...catalog, spell] })
    const card = { ...spell, instanceId: `swoon-${burnedThisTurn}` }
    match.players[0].hand = [card]
    match.players[0].mana = 3
    match.players[0].burnedThisTurn = burnedThisTurn
    match.board.push({ id: 'swoon-target', card: { ...catalog[1], Type: 0, Name: 'Swoon target' }, owner: 1, row: 2, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, blackTokens: 0 })

    const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { unitId: 'swoon-target' } } })
    assert.equal(result.state.board.some(unit => unit.id === 'swoon-target'), !burnedThisTurn)
    assert.equal(result.state.players[0].mana, 0)
    assert.equal(result.state.players[0].discard.some(item => item.instanceId === card.instanceId), true)
    assert.equal(result.state.players[1].discard.some(item => item.Name === 'Swoon target'), burnedThisTurn)
  }

  const spell = { ...catalog[0], Id: 'swoon-spell', Name: 'Swoon', Type: 2, Cost: 3, Description: 'Убивает выбранное существо, если вы сожгли свою карту в этом ходу.' }
  const invalidMatch = createMatch({ ...input, catalog: [...catalog, spell] })
  invalidMatch.players[0].hand = [{ ...spell, instanceId: 'swoon-invalid' }]
  invalidMatch.players[0].mana = 3
  invalidMatch.players[0].burnedThisTurn = true
  invalidMatch.board.push({ id: 'unsupported-death', card: { ...catalog[1], Type: 0, Name: 'Unsupported death', Description: 'Посмертно: Выберите карту.' }, owner: 1, row: 2, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, blackTokens: 0 })
  assert.throws(() => applyCommand(invalidMatch, 0, { action: 'spell.cast', data: { cardInstanceId: 'swoon-invalid', payment: 'mana', target: { unitId: 'unsupported-death' } } }), { code: 'UNSUPPORTED_EFFECT' })
  assert.equal(invalidMatch.players[0].mana, 3)
  assert.equal(invalidMatch.version, 0)

  const match = createMatch(input)
  match.players[0].burnedThisTurn = true
  match.players[1].burnedThisTurn = false
  const own = projectForPlayer(match, 0)
  const opponent = projectForPlayer(match, 1)
  assert.equal(own.private.burnedThisTurn, true)
  assert.equal(opponent.private.burnedThisTurn, false)
  assert.equal(Object.hasOwn(own.public.players[0], 'burnedThisTurn'), false)
})

test('Рейджбайт gives a selected creature temporary rage and kills it at its owner turn end', () => {
  const spell = { ...catalog[0], Id: 'ragebait-spell', Name: 'Рейджбайт 10 из 10', Type: 2, Cost: 2, Description: 'Дайте существу ярость, в конце хода владельца оно умирает' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'ragebait-instance' }
  const targetCard = { ...catalog[1], Type: 0, Name: 'Rage target', Description: '' }
  match.players[0].hand = [card]
  match.players[0].mana = 2
  match.players[0].played = true
  match.players[1].played = true
  match.board.push({ id: 'rage-target', card: targetCard, owner: 1, row: 2, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, blackTokens: 0 })

  const cast = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { unitId: 'rage-target' } } })
  assert.equal(cast.state.board[0].temporaryRage, true)
  assert.equal(cast.state.board[0].expiresAtTurnEnd, true)
  assert.equal(cast.state.players[0].mana, 0)
  const firstTurnEnd = applyCommand(cast.state, 0, { action: 'turn.end', data: {} })
  assert.equal(firstTurnEnd.state.board.some(unit => unit.id === 'rage-target'), true)
  const ownerTurnEnd = applyCommand(firstTurnEnd.state, 1, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(ownerTurnEnd.state.board.some(unit => unit.id === 'rage-target'), false)
  assert.equal(ownerTurnEnd.state.players[1].discard.some(item => item.Id === targetCard.Id), true)
})

test('Геймнайт draws cards and expires the opponent hand-limit increase after that turn', () => {
  const spell = { ...catalog[0], Id: 'game-night', Name: 'Геймнайт', Type: 2, Cost: 0, Description: 'Возьмите 2 карты и увеличьте лимит карт противника на 2 до конца его хода' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  match.players[0].hand = [{ ...spell, instanceId: 'ci-game-night' }]

  const cast = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'ci-game-night', payment: 'mana' } })
  assert.equal(cast.state.players[0].hand.length, 2)
  assert.equal(cast.state.players[0].deck.length, 24)
  assert.equal(cast.state.players[1].limit, 6)
  assert.deepEqual(cast.state.players[1].temporaryLimitExpirations, [1, 1])

  const seatOneTurn = applyCommand(cast.state, 0, { action: 'turn.end', data: {} })
  assert.equal(seatOneTurn.state.players[1].limit, 6)
  const seatZeroTurn = applyCommand(seatOneTurn.state, 1, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(seatZeroTurn.state.players[1].limit, 4)
  assert.deepEqual(seatZeroTurn.state.players[1].temporaryLimitExpirations, [])
})

test('rejects extra unsupported text on a draw-and-limit spell without charging', () => {
  const spell = { ...catalog[0], Id: 'game-night-extra', Name: 'Геймнайт', Type: 2, Cost: 1, Description: 'Возьмите 2 карты и увеличьте лимит карт противника на 2 до конца его хода. Нанесите 4 урона противнику.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'ci-game-night-extra' }
  match.players[0].hand = [card]
  match.players[0].mana = 1

  assert.throws(() => applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana' } }), { code: 'UNSUPPORTED_EFFECT' })
  assert.equal(match.players[0].hand[0].instanceId, card.instanceId)
  assert.equal(match.players[0].mana, 1)
  assert.equal(match.players[1].limit, 4)
  assert.equal(match.version, 0)
})

test('global spell healing preserves the Pink Diamond shield and Ame attack rewards', () => {
  const spell = { ...catalog[0], Id: 'team-heal', Name: 'Командное лечение', Type: 2, Cost: 0, Description: 'Восстановите себе и своим существам 2 здоровья.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'spell-instance' }
  match.players[0].hand = [card]
  match.board.push(
    { id: 'target', card: { ...catalog[1], Name: 'Target' }, owner: 0, row: 4, col: 2, health: 1, maxHealth: 4, attack: 1, speed: 0, blackTokens: 0 },
    { id: 'ame', card: { ...catalog[2], Name: 'Аме' }, owner: 0, row: 4, col: 1, health: 3, maxHealth: 3, attack: 1, speed: 0, blackTokens: 0 },
    { id: 'diamond', card: { ...catalog[3], Name: 'Розовый Алмаз' }, owner: 0, row: 4, col: 3, health: 3, maxHealth: 3, attack: 1, speed: 0, blackTokens: 0 },
  )
  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana' } })
  assert.equal(result.state.board[0].health, 3)
  assert.equal(result.state.board[0].shield, true)
  assert.equal(result.state.board[1].attack, 2)
})

test('does not charge a selected-target spell before a valid target is provided', () => {
  const spell = { ...catalog[0], Id: 'damage-spell', Name: 'Удар', Type: 2, Cost: 1, Description: 'Нанесите 4 урона выбранной цели.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'spell-instance' }
  match.players[0].hand = [card]
  assert.throws(() => applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana' } }), { code: 'INVALID_TARGET' })
  assert.equal(match.players[0].mana, 1)
  assert.equal(match.players[0].hand[0].instanceId, card.instanceId)
})

test('targeted flip spell validates a living creature and resolves its flip trigger', () => {
  const spell = { ...catalog[0], Id: 'flip-spell', Name: 'Портал гравитации', Type: 2, Cost: 1, Description: 'Дайте переворот 1 выбранному существу' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'flip-spell-instance' }
  const targetCard = { ...catalog[1], Name: '.Хихо' }
  match.players[0].hand = [card]
  match.players[0].mana = 1
  match.players[1].deck = [{ ...catalog[2], instanceId: 'drawn-card' }]
  match.board.push({ id: 'flip-target', card: targetCard, owner: 1, row: 4, col: 2, health: 2, maxHealth: 2, attack: 2, speed: 1, blackTokens: 0 })

  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { unitId: 'flip-target' } } })

  assert.equal(result.state.board[0].flippedTurns, 1)
  assert.deepEqual([result.state.board[0].attack, result.state.board[0].health, result.state.board[0].maxHealth, result.state.board[0].speed], [3, 3, 3, 0])
  assert.equal(result.state.players[0].mana, 0)
  assert.equal(result.state.players[1].mana, 1)
  assert.equal(result.state.players[1].hand.some(item => item.instanceId === 'drawn-card'), true)
  assert.equal(result.state.version, 1)
})

test('Ледяной шок leaves a lethally hit creature flipped in its socket for two turns', () => {
  const spell = { ...catalog[0], Id: 'ice-shock', Name: 'Ледяной шок', Type: 2, Cost: 1, Description: 'Нанесите 3 урона выбранной цели. Если это заклинание убивает цель, она остаётся в сокете ещё на 2 хода в перевёрнутом состоянии.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'ice-shock-instance' }
  const targetCard = { ...catalog[1], Id: 'ice-target', Name: 'Ice target', Type: 0, Description: '' }
  match.players[0].hand = [card]
  match.players[0].mana = 1
  match.board.push({ id: 'ice-target', card: targetCard, owner: 1, row: 2, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, blackTokens: 0 })

  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { unitId: 'ice-target' } } })
  assert.deepEqual([result.state.board.length, result.state.board[0].health, result.state.board[0].flippedTurns], [1, 0, 2])
  assert.equal(result.state.players[1].discard.some(item => item.Id === targetCard.Id), false)
  assert.equal(result.state.players[0].discard.some(item => item.Id === spell.Id), true)

  const survivingMatch = createMatch({ ...input, catalog: [...catalog, spell] })
  survivingMatch.players[0].hand = [{ ...spell, instanceId: 'ice-shock-survivor-instance' }]
  survivingMatch.players[0].mana = 1
  survivingMatch.board.push({ id: 'survivor', card: targetCard, owner: 1, row: 2, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, blackTokens: 0 })
  const nonlethal = applyCommand(survivingMatch, 0, { action: 'spell.cast', data: { cardInstanceId: 'ice-shock-survivor-instance', payment: 'mana', target: { unitId: 'survivor' } } })
  assert.deepEqual([nonlethal.state.board[0].health, nonlethal.state.board[0].flippedTurns], [2, undefined])
})

test('Знаком по ебалу privately asks its caster to save a hand card after killing a creature', () => {
  const spell = { ...catalog[0], Id: 'znak-spell', Name: 'Знаком по ебалу', Type: 2, Cost: 2, Description: 'Нанесите 1 урона выбранной цели, если "Знаком по ебалу" убивает существо, сберегите 1 карту в руке' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const spellCard = { ...spell, instanceId: 'znak-instance' }
  const savedCard = { ...catalog[2], instanceId: 'save-this-card' }
  const targetCard = { ...catalog[1], Id: 'znak-target', Name: 'Znak target', Type: 0, Description: '' }
  match.players[0].hand = [spellCard, savedCard]
  match.players[0].mana = 2
  match.board.push({ id: 'znak-target', card: targetCard, owner: 1, row: 2, col: 2, health: 1, maxHealth: 1, attack: 1, speed: 1, blackTokens: 0 })

  const cast = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: spellCard.instanceId, payment: 'mana', target: { unitId: 'znak-target' } } })
  assert.equal(cast.state.pendingChoice.kind, 'spell-save-hand')
  assert.equal(cast.state.players[0].hand.some(card => card.instanceId === savedCard.instanceId), true)
  assert.equal(cast.state.players[0].saved.length, 0)
  assert.equal(projectForPlayer(cast.state, 0).private.pendingChoice.options[0].unitId, savedCard.instanceId)
  assert.equal(projectForPlayer(cast.state, 1).private.pendingChoice, null)
  assert.equal(JSON.stringify(projectForPlayer(cast.state, 1)).includes(savedCard.instanceId), false)
  assert.equal(cast.state.pendingChoice.id.includes(spellCard.instanceId), false)

  const resolved = applyCommand(cast.state, 0, { action: 'choice.resolve', data: { choiceId: cast.state.pendingChoice.id, selection: { unitIds: [savedCard.instanceId] } } })
  assert.equal(JSON.stringify(resolved.events).includes(spellCard.instanceId), false)
  assert.equal(JSON.stringify(resolved.events).includes(savedCard.instanceId), false)
  assert.equal(resolved.state.players[0].saved[0].instanceId, savedCard.instanceId)
  assert.equal(resolved.state.players[0].hand.length, 0)
  assert.equal(resolved.state.pendingChoice, null)
})

test('Half-life 3 privately selects as many living creatures as there are flipped cards and destroys them', () => {
  const spell = { ...catalog[0], Id: 'half-life', Name: 'Half-life 3', Type: 2, Cost: 1, Description: 'Убейте столько существо, сколько перевёрнутых карт сейчас на поле.\nСжигается.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'half-life-instance' }
  match.players[0].hand = [card]
  match.players[0].mana = 1
  match.board.push(
    { id: 'flipped-one', card: catalog[1], owner: 0, row: 4, col: 0, health: 0, maxHealth: 1, attack: 1, speed: 1, blackTokens: 0, flippedTurns: 1 },
    { id: 'flipped-two', card: catalog[2], owner: 1, row: 0, col: 0, health: 0, maxHealth: 1, attack: 1, speed: 1, blackTokens: 0, flippedTurns: 2 },
    { id: 'target-one', card: catalog[3], owner: 1, row: 1, col: 1, health: 1, maxHealth: 1, attack: 1, speed: 1, blackTokens: 0 },
    { id: 'target-two', card: catalog[4], owner: 0, row: 3, col: 3, health: 1, maxHealth: 1, attack: 1, speed: 1, blackTokens: 0 },
    { id: 'target-three', card: catalog[5], owner: 1, row: 1, col: 4, health: 1, maxHealth: 1, attack: 1, speed: 1, blackTokens: 0 },
  )

  const cast = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana' } })
  assert.equal(cast.state.pendingChoice.kind, 'spell-destroy-creatures')
  assert.equal(cast.state.pendingChoice.count, 2)
  assert.equal(projectForPlayer(cast.state, 1).private.pendingChoice, null)
  assert.deepEqual(projectForPlayer(cast.state, 0).private.pendingChoice.options.map(option => option.unitId), ['target-one', 'target-two', 'target-three'])
  assert.equal(cast.state.players[0].burned[0].instanceId, card.instanceId)

  const resolved = applyCommand(cast.state, 0, { action: 'choice.resolve', data: { choiceId: cast.state.pendingChoice.id, selection: { unitIds: ['target-one', 'target-three'] } } })
  assert.deepEqual(resolved.state.board.map(unit => unit.id), ['flipped-one', 'flipped-two', 'target-two'])
  assert.deepEqual(resolved.state.players[1].discard.map(item => item.Id), [catalog[3].Id, catalog[5].Id])
  assert.equal(resolved.state.version, cast.state.version + 1)
  assert.equal(resolved.state.pendingChoice, null)
})

test('Х-Слеш variants heal their caster by the target creature health only on a kill', () => {
  for (const [name, description] of [
    ['Х-Слеш', 'Нанесите 2 урона выбранному существу. Вы восстанавливаете количество здоровья равное здоровью существа, если цель погибает.'],
    ['X-Слеш', 'Нанесите 2 урона выбранному существу. Вы восстанавливаете количество здоровья равное Здоровью существа, если цель погибает.'],
  ]) {
    const spell = { ...catalog[0], Id: `spell-${name}`, Name: name, Type: 2, Cost: 1, Description: description }
    const match = createMatch({ ...input, catalog: [...catalog, spell] })
    const card = { ...spell, instanceId: `instance-${name}` }
    const targetCard = { ...catalog[1], Id: `target-${name}`, Name: 'Slash target', Type: 0, Description: '' }
    match.players[0].hand = [card]
    match.players[0].health = 30
    match.players[0].mana = 1
    match.board.push({ id: `target-${name}`, card: targetCard, owner: 1, row: 2, col: 2, health: 2, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0 })

    const killed = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { unitId: `target-${name}` } } })
    assert.equal(killed.state.players[0].health, 32)
    assert.equal(killed.state.board.length, 0)
    assert.equal(killed.state.players[1].discard.some(item => item.Id === targetCard.Id), true)

    const survivingMatch = createMatch({ ...input, catalog: [...catalog, spell] })
    survivingMatch.players[0].hand = [{ ...spell, instanceId: `surviving-${name}` }]
    survivingMatch.players[0].health = 30
    survivingMatch.players[0].mana = 1
    survivingMatch.board.push({ id: `survivor-${name}`, card: targetCard, owner: 1, row: 2, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, blackTokens: 0 })
    const survived = applyCommand(survivingMatch, 0, { action: 'spell.cast', data: { cardInstanceId: `surviving-${name}`, payment: 'mana', target: { unitId: `survivor-${name}` } } })
    assert.equal(survived.state.players[0].health, 30)
    assert.equal(survived.state.board[0].health, 1)
  }
})

test('targeted flip spell rejects flipped targets before payment', () => {
  const spell = { ...catalog[0], Id: 'flip-spell', Name: 'Портал гравитации', Type: 2, Cost: 1, Description: 'Дайте переворот 1 выбранному существу' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'flip-spell-instance' }
  match.players[0].hand = [card]
  match.players[0].mana = 1
  match.board.push({ id: 'already-flipped', card: catalog[1], owner: 1, row: 2, col: 2, health: 2, maxHealth: 2, attack: 2, speed: 1, flippedTurns: 1, blackTokens: 0 })

  assert.throws(() => applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { unitId: 'already-flipped' } } }), { code: 'INVALID_TARGET' })
  assert.equal(match.players[0].mana, 1)
  assert.equal(match.players[0].hand[0].instanceId, card.instanceId)
  assert.equal(match.version, 0)
})

test('global burn spell burns active creatures, bypasses shields, and ignores flipped units and buildings', () => {
  const spell = { ...catalog[0], Id: 'global-burn', Name: 'Сгоревшие сервера', Type: 2, Cost: 1, Description: 'Сожгите всех существ на поле.\nСжигаеться' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'global-burn-instance' }
  match.players[0].hand = [card]
  match.players[0].mana = 1
  match.board.push(
    { id: 'shielded', card: { ...catalog[1], Id: 'shielded-card', Name: 'Shielded' }, owner: 0, row: 4, col: 1, health: 3, maxHealth: 3, attack: 1, speed: 1, shield: true, blackTokens: 0 },
    { id: 'flipped', card: { ...catalog[2], Id: 'flipped-card', Name: 'Flipped' }, owner: 1, row: 0, col: 1, health: 3, maxHealth: 3, attack: 1, speed: 1, flippedTurns: 1, blackTokens: 0 },
    { id: 'building', card: { ...catalog[3], Id: 'building-card', Name: 'Building', Type: 3 }, owner: 1, row: 0, col: 2, health: 3, maxHealth: 3, attack: 0, speed: 0, blackTokens: 0 },
  )

  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana' } })

  assert.equal(result.state.board.some(unit => unit.id === 'shielded'), false)
  assert.equal(result.state.players[0].burned.some(burned => burned.Id === 'shielded-card'), true)
  assert.equal(result.state.board.find(unit => unit.id === 'flipped').dying, undefined)
  assert.equal(result.state.board.find(unit => unit.id === 'building').dying, undefined)
  assert.equal(result.state.version, 1)
})

test('global flip spell resets each living card duration and resolves triggers for each owner', () => {
  const spell = { ...catalog[0], Id: 'global-flip', Name: 'Закрытие бункера', Type: 2, Cost: 1, Description: 'Примените переворот 2 всем картам на поле.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'global-flip-instance' }
  match.players[0].hand = [card]
  match.players[0].mana = 1
  match.players[0].deck = [{ ...catalog[2], instanceId: 'owner-draw' }]
  match.players[1].deck = [{ ...catalog[3], instanceId: 'opponent-draw' }]
  match.board.push(
    { id: 'hihho-owner', card: { ...catalog[1], Name: '.Хихо' }, owner: 0, row: 4, col: 1, health: 2, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0 },
    { id: 'hihho-opponent', card: { ...catalog[2], Name: '.Хихо' }, owner: 1, row: 0, col: 1, health: 2, maxHealth: 2, attack: 1, speed: 1, flippedTurns: 1, blackTokens: 0 },
    { id: 'building', card: { ...catalog[3], Name: 'Building', Type: 3 }, owner: 1, row: 0, col: 2, health: 3, maxHealth: 3, attack: 0, speed: 0, blackTokens: 0 },
  )

  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana' } })

  assert.deepEqual(result.state.board.map(unit => unit.flippedTurns), [2, 2, 2])
  assert.deepEqual(result.state.board.map(unit => [unit.attack, unit.health, unit.maxHealth, unit.speed]), [[2, 3, 3, 0], [2, 3, 3, 0], [0, 3, 3, 0]])
  assert.equal(result.state.players[0].hand.some(item => item.instanceId === 'owner-draw'), true)
  assert.equal(result.state.players[1].hand.some(item => item.instanceId === 'opponent-draw'), true)
  assert.equal(result.state.players[0].mana, 1)
  assert.equal(result.state.players[1].mana, 1)
})

test('Фанфик Магната heals allied targets and stuns enemy targets', () => {
  const spell = { ...catalog[0], Id: 'fanfic-spell', Name: 'Фанфик Магната', Type: 2, Cost: 1, Description: 'Восстановите 5 здоровья вашему существу, либо же наложите оглушение 1 на вражеское' }
  for (const owner of [0, 1]) {
    const match = createMatch({ ...input, catalog: [...catalog, spell] })
    const card = { ...spell, instanceId: `fanfic-${owner}` }
    match.players[0].hand = [card]
    match.players[0].mana = 1
    match.board.push({ id: `fanfic-target-${owner}`, card: catalog[1], owner, row: owner ? 2 : 4, col: 2, health: 1, maxHealth: 5, attack: 1, speed: 1, blackTokens: 0 })

    const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { unitId: `fanfic-target-${owner}` } } })
    const target = result.state.board[0]

    assert.equal(owner === 0 ? target.health : target.stunned, owner === 0 ? 5 : 1)
    assert.equal(result.state.players[0].mana, 0)
    assert.equal(result.state.version, 1)
  }
})

test('Хопиум buffs an allied creature and resolves its end-of-turn death', () => {
  const spell = { ...catalog[0], Id: 'hopium-spell', Name: 'Хопиум', Type: 2, Cost: 1, Description: 'Ваше существо получает 3 3 1, но в конце вашего хода оно умирает.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'hopium-instance' }
  const targetCard = { ...catalog[1], Id: 'hopium-target-card', Name: 'Target' }
  match.players[0].hand = [card]
  match.players[0].mana = 1
  match.board.push({ id: 'hopium-target', card: targetCard, owner: 0, row: 4, col: 2, health: 2, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0 })

  const cast = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { unitId: 'hopium-target' } } })
  assert.deepEqual([cast.state.board[0].attack, cast.state.board[0].health, cast.state.board[0].maxHealth, cast.state.board[0].speed, cast.state.board[0].expiresAtTurnEnd], [4, 5, 5, 0, true])

  const ended = applyCommand(cast.state, 0, { action: 'turn.end', data: {} })
  assert.equal(ended.state.board.some(unit => unit.id === 'hopium-target'), false)
  assert.equal(ended.state.players[0].discard.some(item => item.Id === targetCard.Id), true)
})

test('Хопиум rejects targets with unsupported death text before payment', () => {
  const spell = { ...catalog[0], Id: 'hopium-spell', Name: 'Хопиум', Type: 2, Cost: 1, Description: 'Ваше существо получает 3 3 1, но в конце вашего хода оно умирает.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'hopium-instance' }
  match.players[0].hand = [card]
  match.players[0].mana = 1
  match.board.push({ id: 'unsupported-target', card: { ...catalog[1], Description: 'Посмертно: Выберите карту.' }, owner: 0, row: 4, col: 2, health: 2, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0 })

  assert.throws(() => applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { unitId: 'unsupported-target' } } }), { code: 'UNSUPPORTED_EFFECT' })
  assert.equal(match.players[0].mana, 1)
  assert.equal(match.players[0].hand[0].instanceId, card.instanceId)
  assert.equal(match.version, 0)
})

test('direct kill spell destroys its creature target through death rules and burns itself', () => {
  const spell = { ...catalog[0], Id: 'kill-spell', Name: '@.hiho', Type: 2, Cost: 1, Description: 'Убейте существо.\nСжигается' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'kill-spell-instance' }
  const targetCard = { ...catalog[1], Id: 'kill-target-card', Name: 'Target' }
  match.players[0].hand = [card]
  match.players[0].mana = 1
  match.board.push({ id: 'kill-target', card: targetCard, owner: 1, row: 2, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, shield: true, blackTokens: 0 })

  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { unitId: 'kill-target' } } })

  assert.equal(result.state.board.some(unit => unit.id === 'kill-target'), false)
  assert.equal(result.state.players[1].discard.some(item => item.Id === targetCard.Id), true)
  assert.equal(result.state.players[0].burned.some(item => item.instanceId === card.instanceId), true)
  assert.equal(result.state.players[0].mana, 0)
})

test('Хаешка deals area damage to creatures around the selected socket and ignores buildings', () => {
  const spell = { ...catalog[0], Id: 'area-spell', Name: 'Хаешка', Type: 2, Cost: 2, Description: 'Нанесите 3 урона всем существа по площади 3х3 сокета.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  match.players[0].mana = 2
  match.players[0].hand = [{ ...spell, instanceId: 'area-instance' }]
  match.board = [
    { id: 'near-enemy', card: catalog[0], owner: 1, row: 2, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, blackTokens: 0 },
    { id: 'near-ally', card: catalog[1], owner: 0, row: 1, col: 1, health: 3, maxHealth: 3, attack: 1, speed: 1, blackTokens: 0, shield: true },
    { id: 'enemy-bomber', card: { ...catalog[4], Name: 'Подрывник' }, owner: 1, row: 2, col: 3, health: 2, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0 },
    { id: 'far-creature', card: catalog[2], owner: 1, row: 0, col: 0, health: 5, maxHealth: 5, attack: 1, speed: 1, blackTokens: 0 },
    { id: 'near-building', card: { ...catalog[3], Type: 3 }, owner: 1, row: 3, col: 2, health: 5, maxHealth: 5, attack: 0, speed: 0, blackTokens: 0 },
  ]
  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'area-instance', payment: 'mana', target: { row: 2, col: 2 } } })
  assert.equal(result.state.board.find(unit => unit.id === 'near-enemy').health, 2)
  assert.equal(result.state.board.find(unit => unit.id === 'near-ally').health, 3)
  assert.equal(result.state.board.find(unit => unit.id === 'near-ally').shield, false)
  assert.equal(result.state.board.find(unit => unit.id === 'far-creature').health, 5)
  assert.equal(result.state.board.find(unit => unit.id === 'near-building').health, 5)
  assert.equal(result.state.board.some(unit => unit.id === 'enemy-bomber'), false)
  assert.equal(result.state.players[0].health, 42)
  assert.equal(result.state.players[0].mana, 0)
  assert.equal(result.state.players[0].discard[0].instanceId, 'area-instance')
  assert.equal(result.state.version, 1)
})

test('Гастер Бластер damages creatures on the selected card row and column', () => {
  const spell = { ...catalog[0], Id: 'gaster-blaster', Name: 'Гастер Бластер', Type: 2, Cost: 0, Description: 'Наносит 6 урона по линии всем существам.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  match.players[0].hand = [{ ...spell, instanceId: 'ci-gaster-blaster' }]
  match.board.push(
    { id: 'target', card: { ...catalog[1], Name: 'Target' }, owner: 1, row: 2, col: 2, health: 10, maxHealth: 10, attack: 1, speed: 1 },
    { id: 'same-row', card: { ...catalog[2], Name: 'Same row' }, owner: 0, row: 2, col: 4, health: 10, maxHealth: 10, attack: 1, speed: 1 },
    { id: 'same-column', card: { ...catalog[3], Name: 'Same column' }, owner: 1, row: 0, col: 2, health: 10, maxHealth: 10, attack: 1, speed: 1 },
    { id: 'outside', card: { ...catalog[4], Name: 'Outside' }, owner: 0, row: 0, col: 0, health: 10, maxHealth: 10, attack: 1, speed: 1 },
    { id: 'building', card: { ...catalog[5], Name: 'Building', Type: 3 }, owner: 1, row: 2, col: 3, health: 10, maxHealth: 10, attack: 0, speed: 0 },
    { id: 'flipped', card: { ...catalog[6], Name: 'Flipped' }, owner: 1, row: 2, col: 1, health: 10, maxHealth: 10, attack: 1, speed: 1, flippedTurns: 1 },
  )

  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'ci-gaster-blaster', payment: 'mana', target: { unitId: 'target' } } })
  const health = Object.fromEntries(result.state.board.map(unit => [unit.id, unit.health]))
  assert.deepEqual(health, { target: 4, 'same-row': 4, 'same-column': 4, outside: 10, building: 10, flipped: 10 })
})

test('Лазанья buffs every non-flipped card on the selected row and column', () => {
  const spell = { ...catalog[0], Id: 'lasagna', Name: 'Лазанья', Type: 2, Cost: 0, Description: 'Даёт всем картам на линии +1⚔️❤️⚡.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  match.players[0].hand = [{ ...spell, instanceId: 'ci-lasagna' }]
  const unit = (id, type, row, col, changes = {}) => ({ id, card: { ...catalog[0], Type: type }, owner: 0, row, col, health: 5, maxHealth: 5, attack: 1, speed: 1, ...changes })
  match.board.push(unit('row-creature', 0, 2, 0), unit('column-building', 3, 0, 2), unit('flipped', 0, 2, 4, { flippedTurns: 1 }), unit('dying', 0, 2, 3, { dying: true }), unit('outside', 0, 0, 0))

  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'ci-lasagna', payment: 'mana', target: { row: 2, col: 2 } } })
  const stats = Object.fromEntries(result.state.board.map(target => [target.id, [target.attack, target.health, target.maxHealth, target.speed]]))
  assert.deepEqual(stats, {
    'row-creature': [2, 6, 6, 0], 'column-building': [2, 6, 6, 0], flipped: [1, 5, 5, 1], dying: [1, 5, 5, 1], outside: [1, 5, 5, 1],
  })
})

test('Бан burns through shields, saves the first burn for its owner, then burns the attached item', () => {
  const spell = { ...catalog[0], Id: 'ban', Name: 'Бан', Type: 2, Cost: 1, Description: 'Сожгите выбранное существо\nСжигается' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  match.players[0].hand = [{ ...spell, instanceId: 'ci-ban' }]
  match.players[0].mana = 1
  match.players[1].nextBurnToSave = 1
  const target = { ...catalog[1], Name: 'Burned target', instanceId: 'ci-target' }
  const item = { ...catalog[2], Name: 'Burning item', Type: 1, Description: 'Сжигается', instanceId: 'ci-item' }
  match.board.push({ id: 'burn-target', card: target, item, owner: 1, row: 1, col: 1, health: 5, maxHealth: 5, attack: 1, speed: 1, shield: true })

  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'ci-ban', payment: 'mana', target: { unitId: 'burn-target' } } })
  assert.deepEqual(result.state.board, [])
  assert.deepEqual(result.state.players[1].saved.map(card => card.instanceId), ['ci-target'])
  assert.deepEqual(result.state.players[1].burned.map(card => card.instanceId), ['ci-item'])
  assert.equal(result.state.players[1].burnedThisTurn, false)
  assert.deepEqual(result.state.players[0].burned.map(card => card.instanceId), ['ci-ban'])
  assert.equal(result.state.players[0].burnedThisTurn, true)
  assert.equal(result.state.players[0].mana, 0)
})

test('Бан rejects unsupported death triggers before payment', () => {
  const spell = { ...catalog[0], Id: 'ban', Name: 'Бан', Type: 2, Cost: 1, Description: 'Сожгите выбранное существо\nСжигается' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  match.players[0].hand = [{ ...spell, instanceId: 'ci-ban' }]
  match.players[0].mana = 1
  const target = { ...catalog[1], Name: 'Unsupported death', Description: 'Посмертно: выполняет неподдерживаемый эффект.', instanceId: 'ci-target' }
  match.board.push({ id: 'burn-target', card: target, owner: 1, row: 1, col: 1, health: 5, maxHealth: 5, attack: 1, speed: 1 })

  assert.throws(() => applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'ci-ban', payment: 'mana', target: { unitId: 'burn-target' } } }), { code: 'UNSUPPORTED_EFFECT' })
  assert.equal(match.players[0].hand[0].instanceId, 'ci-ban')
  assert.equal(match.players[0].mana, 1)
  assert.equal(match.board[0].health, 5)
})

test('an unsupported area-spell death effect rejects without spending the card or mana', () => {
  const spell = { ...catalog[0], Id: 'area-spell', Name: 'Хаешка', Type: 2, Cost: 2, Description: 'Нанесите 3 урона всем существа по площади 3х3 сокета.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  match.players[0].mana = 2
  match.players[0].hand = [{ ...spell, instanceId: 'area-instance' }]
  const target = { ...realCatalog.find(card => card.Name === 'Висмут Шифера'), Name: 'Unsupported Death', Description: 'Посмертно: неизвестный эффект.' }
  match.board = [{ id: 'choice-on-death', card: target, owner: 1, row: 2, col: 2, health: 2, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0 }]
  assert.throws(() => applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'area-instance', payment: 'mana', target: { row: 2, col: 2 } } }), { code: 'UNSUPPORTED_EFFECT' })
  assert.equal(match.players[0].mana, 2)
  assert.equal(match.players[0].hand[0].instanceId, 'area-instance')
  assert.equal(match.board[0].health, 2)
})

test('casts a direct-damage spell and finishes the match when the opponent falls', () => {
  const spell = { ...catalog[0], Id: 'damage-player', Name: 'Удар', Type: 2, Cost: 1, Description: 'Нанесите 4 урона противнику\nСжигаеться' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  const card = { ...spell, instanceId: 'spell-instance' }
  match.players[0].hand = [card]
  match.players[0].mana = 1
  match.players[1].health = 3
  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: 'mana' } })
  assert.equal(result.state.players[1].health, 0)
  assert.equal(result.state.status, 'finished')
  assert.equal(result.state.winnerUserId, 'user-1')
  assert.equal(result.state.endReason, 'spell')
  assert.equal(result.state.players[0].burned[0].instanceId, card.instanceId)
})

test('a targeted damage spell applies target damage and its declared self-heal in one command', () => {
  const spell = { ...catalog[0], Id: 'targeted-spell', Name: 'Ну что там с арг', Type: 2, Cost: 1, Description: 'Нанесите выбранной цели 2 урона и затем восстановите себе 2 здоровья.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  match.players[0].hand = [{ ...spell, instanceId: 'targeted-instance' }]
  match.players[0].mana = 1
  match.players[0].health = 40
  match.board = [{ id: 'target', card: catalog[0], owner: 1, row: 2, col: 2, health: 2, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0 }]
  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'targeted-instance', payment: 'mana', target: { unitId: 'target' } } })
  assert.equal(result.state.board.length, 0)
  assert.equal(result.state.players[1].discard.some(card => card.Id === catalog[0].Id), true)
  assert.equal(result.state.players[0].health, 42)
  assert.equal(result.state.players[0].mana, 0)
  assert.equal(result.state.players[0].discard[0].instanceId, 'targeted-instance')
  assert.equal(result.state.version, 1)
})

test('a selected-target damage spell can choose only the opponent player when its text allows players', () => {
  const spell = { ...catalog[0], Id: 'targeted-spell', Name: 'Ну что там с арг', Type: 2, Cost: 0, Description: 'Нанесите выбранной цели 2 урона и затем восстановите себе 2 здоровья.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  match.players[0].hand = [{ ...spell, instanceId: 'targeted-instance' }]
  match.players[0].health = 40
  match.players[1].health = 1
  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'targeted-instance', payment: 'mana', target: { player: 'opponent' } } })
  assert.equal(result.state.players[1].health, 0)
  assert.equal(result.state.players[0].health, 42)
  assert.equal(result.state.status, 'finished')
  assert.equal(result.state.winnerUserId, 'user-1')
})

test('Починка полностью лечит активных союзных существ и здания и запускает эффекты лечения', () => {
  const spell = { ...catalog[0], Id: 'repair-spell', Name: 'Починка', Type: 2, Cost: 0, Description: 'Полностью восстанавливает здоровье всех ваших существ и зданий.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  match.players[0].hand = [{ ...spell, instanceId: 'repair-instance' }]
  match.board = [
    { id: 'ally', card: { ...catalog[0], Type: 0 }, owner: 0, row: 4, col: 2, health: 1, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0 },
    { id: 'building', card: { ...catalog[1], Type: 3 }, owner: 0, row: 4, col: 3, health: 1, maxHealth: 5, attack: 0, speed: 0, summoned: 0, attacks: 0 },
    { id: 'enemy', card: { ...catalog[2], Type: 0 }, owner: 1, row: 0, col: 2, health: 1, maxHealth: 6, attack: 1, speed: 1, summoned: 0, attacks: 0 },
    { id: 'flipped', card: { ...catalog[3], Type: 3 }, owner: 0, row: 4, col: 4, health: 1, maxHealth: 6, attack: 0, speed: 0, summoned: 0, attacks: 0, flippedTurns: 1 },
    { id: 'diamond', card: { ...catalog[4], Name: 'Розовый Алмаз', Type: 3 }, owner: 0, row: 3, col: 3, health: 5, maxHealth: 5, attack: 0, speed: 0, summoned: 0, attacks: 0 },
    { id: 'ame', card: { ...catalog[5], Name: 'Аме', Type: 0 }, owner: 0, row: 3, col: 4, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0 },
  ]
  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'repair-instance', payment: 'mana' } })
  assert.deepEqual(result.state.board.map(unit => unit.health), [4, 5, 1, 1, 5, 4])
  assert.equal(result.state.board[0].shield, true)
  assert.equal(result.state.board[5].attack, 3)
  assert.equal(result.state.players[0].discard[0].instanceId, 'repair-instance')
  assert.equal(result.state.players[0].played, true)
})

test('@everyone наносит урон существам обеих сторон через общий резолвер смерти', () => {
  const spell = { ...catalog[0], Id: 'global-damage', Name: '@everyone', Type: 2, Cost: 0, Description: 'Нанесите 1 урон всем существам на поле' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  match.players[0].hand = [{ ...spell, instanceId: 'global-damage-instance' }]
  match.board = [
    { id: 'ally', card: { ...catalog[0], Name: 'Ally' }, owner: 0, row: 4, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0 },
    { id: 'enemy', card: { ...catalog[1], Name: 'Enemy' }, owner: 1, row: 0, col: 2, health: 1, maxHealth: 1, attack: 1, speed: 1, summoned: 0, attacks: 0 },
    { id: 'building', card: { ...catalog[2], Type: 3 }, owner: 1, row: 0, col: 3, health: 4, maxHealth: 4, attack: 0, speed: 0, summoned: 0, attacks: 0 },
    { id: 'flipped', card: { ...catalog[3], Name: 'Flipped' }, owner: 1, row: 0, col: 4, health: 2, maxHealth: 2, attack: 1, speed: 1, summoned: 0, attacks: 0, flippedTurns: 1 },
  ]
  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'global-damage-instance', payment: 'mana' } })
  assert.deepEqual(result.state.board.map(unit => unit.id), ['ally', 'building', 'flipped'])
  assert.equal(result.state.board[0].health, 2)
  assert.equal(result.state.board[1].health, 4)
  assert.equal(result.state.board[2].health, 2)
  assert.equal(result.state.players[1].discard.some(card => card.Name === 'Enemy'), true)
})

test('Новый видос heals its owner and burns itself using the catalog wording', () => {
  const spell = { ...catalog[0], Id: 'new-video', Name: 'Новый видос', Type: 2, Cost: 1, Description: 'Востановите 15 здоровья. Сжигаеться' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  match.players[0].hand = [{ ...spell, instanceId: 'new-video-instance' }]
  match.players[0].health = 35
  match.players[0].mana = 1
  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'new-video-instance', payment: 'mana' } })
  assert.equal(result.state.players[0].health, 45)
  assert.equal(result.state.players[0].burned[0].instanceId, 'new-video-instance')
  assert.equal(result.state.players[0].mana, 0)
})

test('Брэпси restores health and burns itself as described by the card', () => {
  const spell = { ...catalog[0], Id: 'brapsi', Name: 'Брэпси', Type: 2, Cost: 1, Description: 'Восстановите 10 здоровья и сожгите карту.\nСжигается' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  match.players[0].hand = [{ ...spell, instanceId: 'brapsi-instance' }]
  match.players[0].health = 30
  match.players[0].mana = 1
  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'brapsi-instance', payment: 'mana' } })
  assert.equal(result.state.players[0].health, 40)
  assert.equal(result.state.players[0].burned[0].instanceId, 'brapsi-instance')
  assert.equal(result.state.players[0].mana, 0)
})

test('Город без души destroys the selected building despite shield', () => {
  const spell = { ...catalog[0], Id: 'destroy-building', Name: 'Город без души', Type: 2, Cost: 1, Description: 'Уничтожьте здание.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  match.players[0].hand = [{ ...spell, instanceId: 'destroy-building-instance' }]
  match.players[0].mana = 1
  const building = { id: 'building', card: { ...catalog[1], Name: 'Fortress', Type: 3 }, owner: 1, row: 0, col: 2, health: 5, maxHealth: 5, attack: 0, speed: 0, shield: true, summoned: 0, attacks: 0 }
  match.board = [building]
  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'destroy-building-instance', payment: 'mana', target: { unitId: 'building' } } })
  assert.deepEqual(result.state.board, [])
  assert.equal(result.state.players[1].discard.some(card => card.Name === 'Fortress'), true)
  assert.equal(result.state.players[0].mana, 0)
})

test('Город без души cannot reveal or select a flipped card as a building', () => {
  const spell = { ...catalog[0], Id: 'destroy-building', Name: 'Город без души', Type: 2, Cost: 1, Description: 'Уничтожьте здание.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  match.players[0].hand = [{ ...spell, instanceId: 'ci-secret-spell' }]
  match.players[0].mana = 1
  match.board = [{ id: 'unit-opaque', card: { ...catalog[1], Type: 3, instanceId: 'ci_match-1_1_9' }, owner: 1, row: 0, col: 2, health: 5, maxHealth: 5, attack: 0, speed: 0, flippedTurns: 1, dying: false }]

  assert.throws(() => applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'ci-secret-spell', payment: 'mana', target: { unitId: 'unit-opaque' } } }), { code: 'INVALID_TARGET' })
  assert.equal(match.players[0].mana, 1)
  assert.equal(projectForPlayer(match, 0).public.board[0].card.Type, -1)
})

test('Город без души rejects an unsupported building death trigger before charging', () => {
  const spell = { ...catalog[0], Id: 'destroy-building', Name: 'Город без души', Type: 2, Cost: 1, Description: 'Уничтожьте здание.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  match.players[0].hand = [{ ...spell, instanceId: 'destroy-building-instance' }]
  match.players[0].mana = 1
  const building = { id: 'building', card: { ...catalog[1], Name: 'Fortress', Type: 3, Description: 'Посмертно: выполняет сложный эффект.' }, owner: 1, row: 0, col: 2, health: 5, maxHealth: 5, attack: 0, speed: 0, summoned: 0, attacks: 0 }
  match.board = [building]
  assert.throws(() => applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'destroy-building-instance', payment: 'mana', target: { unitId: 'building' } } }), { code: 'UNSUPPORTED_EFFECT' })
  assert.equal(match.players[0].mana, 1)
  assert.equal(match.players[0].hand[0].instanceId, 'destroy-building-instance')
  assert.equal(match.board[0].health, 5)
})

test('Кик discards the chosen unit and its item without resolving death effects', () => {
  const spell = { ...catalog[0], Id: 'kick', Name: 'Кик', Type: 2, Cost: 1, Description: 'Сбросьте выбранное существо или здание.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  match.players[0].hand = [{ ...spell, instanceId: 'kick-instance' }]
  match.players[0].mana = 1
  const target = { ...catalog[1], Id: 'doomed', Name: 'Doomed', Description: 'Посмертно: сложный неподдерживаемый эффект.' }
  const item = { ...catalog[2], Id: 'item', Name: 'Equipment', Type: 1, Description: '' }
  match.board = [{ id: 'target', card: target, item, owner: 1, row: 0, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0 }]
  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'kick-instance', payment: 'mana', target: { unitId: 'target' } } })
  assert.deepEqual(result.state.board, [])
  assert.ok(result.state.players[1].discard.some(card => card.Name === 'Doomed'))
  assert.ok(result.state.players[1].discard.some(card => card.Name === 'Equipment'))
  assert.equal(result.state.players[0].mana, 0)
})

test('Мут returns the selected card and burns its attached item by the item rule', () => {
  const spell = { ...catalog[0], Id: 'mute', Name: 'Мут', Type: 2, Cost: 1, Description: 'Верните выбранную карту обратно в руку.' }
  const match = createMatch({ ...input, catalog: [...catalog, spell] })
  match.players[0].hand = [{ ...spell, instanceId: 'mute-instance' }]
  match.players[0].mana = 1
  const target = { ...catalog[1], Id: 'returned', Name: 'Returned', Description: 'Посмертно: сложный неподдерживаемый эффект.', instanceId: 'returned-instance' }
  const item = { ...catalog[2], Id: 'burning-item', Name: 'Burning Item', Type: 1, Description: 'Сжигается', instanceId: 'burning-item-instance' }
  match.board = [{ id: 'target', card: target, item, owner: 0, row: 4, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0 }]
  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'mute-instance', payment: 'mana', target: { unitId: 'target' } } })
  assert.deepEqual(result.state.board, [])
  assert.ok(result.state.players[0].hand.some(card => card.instanceId === 'returned-instance'))
  assert.deepEqual(result.state.players[0].burned.map(card => card.instanceId), ['burning-item-instance'])
  assert.ok(result.state.players[0].discard.some(card => card.instanceId === 'mute-instance'))
  assert.equal(result.state.players[0].burnedThisTurn, true)
})

test('Рокировочка privately selects two creatures and swaps their positions', () => {
  const match = createMatch(input)
  const spell = { ...catalog[4], instanceId: 'swap-spell', Name: 'Рокировочка', Type: 2, Cost: 3, Description: 'Выберите двух существ - они меняются местами' }
  match.players[0].hand = [spell]
  match.players[0].mana = 3
  match.board.push(
    { id: 'friendly', card: { ...catalog[0], Name: 'Friendly' }, owner: 0, row: 4, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0 },
    { id: 'enemy', card: { ...catalog[1], Name: 'Enemy' }, owner: 1, row: 2, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0 },
    { id: 'doggo', card: { ...catalog[2], Name: 'Догго' }, owner: 1, row: 0, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0 },
    { id: 'turret', card: { ...catalog[3], Name: 'Турель', Type: 3 }, owner: 1, row: 1, col: 2, health: 4, maxHealth: 4, attack: 0, speed: 0, summoned: 0, attacks: 0 },
  )
  const cast = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
  const choice = cast.state.pendingChoice
  assert.equal(cast.state.players[0].mana, 0)
  assert.deepEqual(cast.state.players[0].discard.map(card => card.instanceId), ['swap-spell'])
  assert.deepEqual(choice.unitIds, ['friendly', 'enemy', 'doggo'])
  assert.equal(choice.count, 2)
  assert.equal(choice.id.includes(spell.instanceId), false)
  assert.equal(projectForPlayer(cast.state, 1).private.pendingChoice, null)
  assert.throws(() => applyCommand(cast.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: ['friendly', 'friendly'] } } }), { code: 'INVALID_CHOICE' })
  const resolved = applyCommand(cast.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: ['friendly', 'enemy'] } } })
  assert.deepEqual([resolved.state.board.find(unit => unit.id === 'friendly').row, resolved.state.board.find(unit => unit.id === 'friendly').col], [2, 2])
  assert.deepEqual([resolved.state.board.find(unit => unit.id === 'enemy').row, resolved.state.board.find(unit => unit.id === 'enemy').col], [4, 2])
  assert.equal(resolved.state.board.find(unit => unit.id === 'friendly').health, 2)
  assert.equal(resolved.state.board.find(unit => unit.id === 'doggo').attack, 3)
  assert.equal(resolved.state.version, 2)
})

test('1 апреля privately swaps creature stats and tokens without moving them', () => {
  const match = createMatch(input)
  const spell = { ...realCatalog.find(card => card.Name === '1 апреля'), instanceId: 'april-spell' }
  match.players[0].hand = [spell]
  match.players[0].mana = spell.Cost
  match.board.push(
    { id: 'first', card: { ...catalog[0], Name: 'First' }, owner: 0, row: 4, col: 1, health: 2, maxHealth: 5, attack: 1, speed: 1, energyCostReduction: 1, blackTokens: 2, typeTokens: [1, 0, 0, 0, 0, 0], temporaryAttack: 2, temporaryHealth: 1, temporaryHealthExpiresAt: 3, summoned: 0 },
    { id: 'second', card: { ...catalog[1], Name: 'Second' }, owner: 1, row: 0, col: 3, health: 4, maxHealth: 4, attack: 3, speed: 2, energyCostReduction: 0, blackTokens: 1, typeTokens: [0, 2, 0, 0, 0, 0], temporaryAttack: 0, temporaryHealth: 0, temporaryHealthExpiresAt: 0, summoned: 0 },
  )

  const cast = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
  const choice = cast.state.pendingChoice
  assert.equal(choice.kind, 'spell-swap-stats')
  assert.deepEqual(choice.unitIds, ['first', 'second'])
  assert.equal(cast.state.players[0].mana, 0)
  assert.deepEqual(cast.state.players[0].discard.map(card => card.instanceId), [spell.instanceId])
  assert.equal(projectForPlayer(cast.state, 1).private.pendingChoice, null)
  const resolved = applyCommand(cast.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: ['first', 'second'] } } })
  const first = resolved.state.board.find(unit => unit.id === 'first')
  const second = resolved.state.board.find(unit => unit.id === 'second')
  assert.deepEqual([first.attack, first.health, first.maxHealth, first.speed, first.energyCostReduction, first.blackTokens, first.temporaryAttack, first.temporaryHealth, first.temporaryHealthExpiresAt], [3, 4, 4, 2, 0, 1, 0, 0, 0])
  assert.deepEqual([first.typeTokens, second.typeTokens], [[0, 2, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0]])
  assert.deepEqual([second.attack, second.health, second.maxHealth, second.speed, second.energyCostReduction, second.blackTokens, second.temporaryAttack, second.temporaryHealth, second.temporaryHealthExpiresAt], [1, 2, 5, 1, 1, 2, 2, 1, 3])
  assert.deepEqual([first.owner, first.row, first.col, second.owner, second.row, second.col], [0, 4, 1, 1, 0, 3])
  assert.deepEqual(projectForPlayer(resolved.state, 0).public.board.map(unit => unit.typeTokens), [[0, 2, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0]])
  assert.equal(resolved.state.version, 2)
})

test('projects public board state through an allowlist', () => {
  const match = createMatch(input)
  match.board.push({
    id: 'unit-1', owner: 0, row: 4, col: 2,
    card: { Id: 'catalog-1', Name: 'Тестовое существо', Type: 0, Description: 'Открытый эффект', Secret: 'internal' },
    health: 3, maxHealth: 5, attack: 2, speed: 1, shield: true, flippedTurns: 0, stunned: 0, summoned: 1, attacks: 1,
    privateEffectCounter: 99,
  })

  const { public: view } = projectForPlayer(match, 1)

  assert.deepEqual(view.board, [{
    id: 'unit-1', owner: 0, row: 4, col: 2,
    card: { Id: 'catalog-1', Name: 'Тестовое существо', Type: 0, Description: 'Открытый эффект' },
    health: 3, maxHealth: 5, attack: 2, speed: 1, shield: true, flippedTurns: 0, stunned: 0, summoned: 1, attacks: 1,
  }])
})

test('projects the public ability-use status so the owner can hide spent actions', () => {
  const match = createMatch(input)
  match.board.push({ id: 'unit', owner: 0, row: 4, col: 2, card: { ...catalog[0], Description: 'Способность 0: Получает щит.' }, health: 1, maxHealth: 1, attack: 1, speed: 0, abilityUsed: true })
  assert.equal(projectForPlayer(match, 0).public.board[0].abilityUsed, true)
})

test('a match does not share player or board state with another match', () => {
  const first = createMatch(input)
  const second = createMatch({ ...input, matchId: 'match-2' })
  first.players[0].health = 1
  first.board.push({ id: 'unit-1' })
  assert.equal(second.players[0].health, 45)
  assert.equal(second.board.length, 0)
})

test('conceding ends the match once and gives the other seat the win', () => {
  const match = createMatch(input)
  const result = applyCommand(match, 1, { action: 'match.concede', data: {} })
  assert.equal(result.state.status, 'finished')
  assert.equal(result.state.winnerUserId, 'user-1')
  assert.equal(result.state.endReason, 'concede')
  assert.equal(result.state.version, 1)
  assert.equal(match.status, 'active')
  assert.throws(() => applyCommand(result.state, 0, { action: 'match.concede', data: {} }), { code: 'MATCH_NOT_ACTIVE' })
})

test('ending an unplayed turn starts the opponent turn and draws up to hand limit', () => {
  const match = createMatch(input)
  match.players[1].hand.pop()
  match.board.push(
    { id: 'outgoing', card: catalog[0], owner: 0, row: 4, col: 0, health: 1, maxHealth: 1, attack: 1, speed: 1, stunned: 2 },
    { id: 'incoming', card: catalog[1], owner: 1, row: 0, col: 0, health: 1, maxHealth: 1, attack: 1, speed: 1, attacks: 1, abilityUsed: true },
  )
  const result = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })

  assert.equal(result.state.current, 1)
  assert.equal(result.state.round, 1)
  assert.equal(result.state.players[0].mana, 0)
  assert.equal(result.state.players[0].energy, 0)
  assert.equal(result.state.players[1].mana, 1)
  assert.equal(result.state.players[1].energy, 1)
  assert.equal(result.state.players[1].hand.length, 4)
  assert.equal(result.state.players[1].deck.length, match.players[1].deck.length - 1)
  assert.equal(result.state.board[0].stunned, 1)
  assert.equal(result.state.board[1].attacks, 0)
  assert.equal(result.state.board[1].abilityUsed, false)
  assert.equal(result.state.version, 1)
  assert.equal(result.events[0].type, 'turn.ended')
  assert.throws(() => applyCommand(match, 1, { action: 'turn.end', data: { option: 'no_penalty' } }), { code: 'NOT_YOUR_TURN' })
})

test('the incoming player receives supported start-turn mana and energy bonuses', () => {
  const match = createMatch(input)
  match.board.push({ id: 'starter', card: { ...catalog[0], Name: 'Новое солнце', Description: 'Постоянно: В начале вашего хода Получает 2 маны и 1 энергии.' }, owner: 1, row: 0, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 0, attacks: 1, abilityUsed: true, blackTokens: 0 })
  const result = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(result.state.current, 1)
  assert.equal(result.state.players[1].mana, 3)
  assert.equal(result.state.players[1].energy, 2)
  assert.equal(result.state.board[0].attacks, 0)
  assert.equal(result.state.board[0].abilityUsed, false)
  assert.equal(result.state.version, 1)
})

test('every-turn resource loss and gain apply to the source owner when the other player starts', () => {
  const match = createMatch(input)
  match.board.push({ id: 'swish', card: { ...catalog[0], Name: 'Свищ', Description: 'Постоянно: В начале каждого хода (своего и чужого) вы теряете 2 здоровья, но получаете 2 маны и 2 энергии.' }, owner: 0, row: 4, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 0, blackTokens: 0 })
  const result = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(result.state.current, 1)
  assert.equal(result.state.players[0].health, 43)
  assert.equal(result.state.players[0].mana, 2)
  assert.equal(result.state.players[0].energy, 2)
})

test('an unimplemented start-turn choice rejects the transition without changing state', () => {
  const match = createMatch(input)
  match.board.push({ id: 'choice-start', card: { ...catalog[0], Name: 'Choice', Description: 'Постоянно: В начале хода выберите существо.' }, owner: 1, row: 0, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 0, blackTokens: 0 })
  assert.throws(() => applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } }), { code: 'UNSUPPORTED_EFFECT' })
  assert.equal(match.version, 0)
  assert.equal(match.current, 0)
})

test('a supported start-of-turn draw resolves before the regular hand-limit draw', () => {
  const match = createMatch(input)
  const before = [...match.players[1].deck]
  match.board.push({ id: 'draw-start', card: { ...catalog[0], Name: 'Black Mesa', Description: 'Постоянно: В начале хода возьмите 2 карты.' }, owner: 1, row: 0, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 0, blackTokens: 0 })
  const result = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(result.state.players[1].hand.length, 6)
  assert.deepEqual(result.state.players[1].hand.slice(4).map(card => card.Id), before.slice(0, 2).map(card => card.Id))
  assert.equal(result.state.players[1].deck.length, before.length - 2)
  assert.ok(result.events.some(event => event.type === 'start-turn.effect' && event.unitId === 'draw-start'))
})

test('turn start requires an exact private hand-limit discard on either seat', () => {
  for (const seat of [0, 1]) {
    const match = createMatch(input)
    match.current = 1 - seat
    const player = match.players[seat]
    player.hand.push(...player.deck.splice(0, 2))
    const before = structuredClone(match)
    const ended = applyCommand(match, 1 - seat, { action: 'turn.end', data: { option: 'no_penalty' } })
    assert.deepEqual(match, before)
    const choice = ended.state.pendingChoice
    assert.equal(choice?.kind, 'hand-limit-discard')
    assert.equal(choice.owner, seat)
    assert.equal(choice.count, 2)
    assert.equal(ended.state.pendingTurnStart, null)
    assert.equal(ended.state.version, 1)
    assert.equal(ended.state.players[seat].mana, Math.min(ended.state.round, 10))
    const own = projectForPlayer(ended.state, seat).private.pendingChoice
    assert.equal(own.count, 2)
    assert.deepEqual(own.options.map(option => option.unitId), player.hand.map(card => card.instanceId))
    assert.equal(projectForPlayer(ended.state, 1 - seat).private.pendingChoice, null)
    const ids = [player.hand[1].instanceId, player.hand[4].instanceId]
    const resolve = selection => ({ action: 'choice.resolve', data: { choiceId: choice.id, selection } })
    assert.throws(() => applyCommand(ended.state, 1 - seat, resolve({ unitIds: ids })), { code: 'NOT_CHOICE_OWNER' })
    for (const selection of [{ unitIds: [] }, { unitIds: ids.slice(0, 1) }, { unitIds: [...ids, player.hand[0].instanceId] }, { unitIds: [ids[0], ids[0]] }, { unitIds: [ids[0], match.players[1 - seat].hand[0].instanceId] }, { unitIds: ids, count: 2 }]) {
      assert.throws(() => applyCommand(ended.state, seat, resolve(selection)), { code: 'INVALID_CHOICE' })
    }
    for (const action of ['turn.end', 'card.play', 'spell.cast', 'card.takeSaved', 'unit.move', 'unit.attack', 'ability.use']) {
      assert.throws(() => applyCommand(ended.state, seat, { action, data: {} }), { code: 'CHOICE_PENDING' })
    }
    const resolved = applyCommand(ended.state, seat, resolve({ unitIds: ids }))
    assert.equal(resolved.state.pendingChoice, null)
    assert.equal(resolved.state.version, 2)
    assert.equal(resolved.state.players[seat].hand.length, player.limit)
    assert.deepEqual(resolved.state.players[seat].discard.map(card => card.instanceId), [...ids].reverse())
    assert.equal(resolved.state.players[seat].played, false)
    assert.equal(resolved.state.players[seat].burnedThisTurn, false)
    assert.equal(resolved.state.players[seat].deck.length, player.deck.length)
    assert.deepEqual(resolved.events, [{ type: 'choice.resolved', choiceId: choice.id, kind: 'hand-limit-discard', count: 2 }])
    assert.ok(!ids.some(id => JSON.stringify(resolved.events).includes(id)))
    assert.equal(applyCommand(resolved.state, seat, { action: 'turn.end', data: { option: 'no_penalty' } }).state.current, 1 - seat)
  }
})

test('hand-limit discard waits for the complete start-turn burn and draw queue', () => {
  const match = createMatch(input)
  match.board.push({ id: 'black-mesa', card: { ...catalog[0], Name: 'Чёрная меза', Description: 'Постоянно: В начале хода возьмите 2 карты. Если у вас лимит карт 5 и больше, сожгите 1 карту' }, owner: 1, row: 0, col: 2, health: 5, maxHealth: 5, attack: 3, speed: 2, blackTokens: 0 })
  match.players[1].limit = 5
  // Burning this card draws one more card before the mandatory discard is calculated.
  match.players[1].hand[0] = { ...realCatalog.find(card => card.Name === 'Сдача трупа'), instanceId: match.players[1].hand[0].instanceId }
  const ended = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(ended.state.pendingChoice.kind, 'start-turn-burn')
  const resumed = applyCommand(ended.state, 1, { action: 'choice.resolve', data: { choiceId: ended.state.pendingChoice.id, selection: { unitIds: [match.players[1].hand[0].instanceId] } } })
  assert.equal(resumed.state.players[1].hand.length, 6)
  assert.equal(resumed.state.pendingTurnStart, null)
  assert.equal(resumed.state.pendingChoice?.kind, 'hand-limit-discard')
  assert.equal(resumed.state.pendingChoice.count, 1)
  const resolved = applyCommand(resumed.state, 1, { action: 'choice.resolve', data: { choiceId: resumed.state.pendingChoice.id, selection: { unitIds: [resumed.state.players[1].hand[0].instanceId] } } })
  assert.equal(resolved.state.players[1].hand.length, 5)
  assert.equal(resolved.state.players[1].burned.length, 1)
  assert.equal(resolved.state.pendingChoice, null)
})

test('during-turn saved retrieval may exceed the hand limit until the owner next turn', () => {
  const match = createMatch(input)
  const saved = match.players[0].deck.shift()
  match.players[0].saved.push(saved)
  const taken = applyCommand(match, 0, { action: 'card.takeSaved', data: { cardInstanceId: saved.instanceId } })
  assert.equal(taken.state.players[0].hand.length, 5)
  assert.equal(taken.state.pendingChoice, undefined)
  const ended = applyCommand(taken.state, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(ended.state.pendingChoice, undefined)
  const next = applyCommand(ended.state, 1, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(next.state.pendingChoice?.kind, 'hand-limit-discard')
  assert.equal(next.state.pendingChoice.count, 1)
})

test('turn-start hand-limit discard can select more cards than the board has cells', () => {
  const match = createMatch(input)
  match.players[1].hand.push(...match.players[1].deck.splice(0))
  match.players[1].limit = 1
  const ended = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(ended.state.pendingChoice?.count, 29)
  const resolved = applyCommand(ended.state, 1, { action: 'choice.resolve', data: { choiceId: ended.state.pendingChoice.id, selection: { unitIds: ended.state.pendingChoice.unitIds.slice(0, 29) } } })
  assert.equal(resolved.state.players[1].hand.length, 1)
  assert.equal(resolved.state.players[1].discard.length, 29)
})

test('lethal start-turn effects do not leave a mandatory hand-limit choice', () => {
  const match = createMatch(input)
  match.players[1].hand.push(match.players[1].deck.shift())
  match.players[1].health = 1
  match.board.push({ id: 'lethal-start', card: { ...catalog[0], Name: 'Leaky', Description: 'Постоянно: В начале хода теряете 2 здоровья.' }, owner: 1, row: 0, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 0, blackTokens: 0 })
  const ended = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(ended.state.status, 'finished')
  assert.ok(!ended.state.pendingChoice)
})

test('Aqua damages the opponent from its type-three tokens and gains one on its owner end turn', () => {
  const match = createMatch(input)
  const aqua = turnUnit('Аква', 0, 4, 2, { typeTokens: [0, 0, 0, 2] })
  const opponentAqua = turnUnit('Аква', 1, 0, 2, { typeTokens: [0, 0, 0, 4] })
  match.board.push(aqua, opponentAqua)
  const opponentHealth = match.players[1].health

  const result = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })

  assert.equal(result.state.players[1].health, opponentHealth - 3)
  assert.deepEqual(result.state.board.find(unit => unit.id === aqua.id).typeTokens, [0, 0, 0, 3])
  assert.deepEqual(result.state.board.find(unit => unit.id === opponentAqua.id).typeTokens, [0, 0, 0, 4])
  assert.equal(result.state.current, 1)
  assert.ok(result.events.some(event => event.type === 'end-turn.effect' && event.unitId === aqua.id))
})

test('Aqua keeps its final type token but stops turn processing on lethal damage', () => {
  const match = createMatch(input)
  const aqua = turnUnit('Аква', 0, 4, 2, { typeTokens: [0, 0, 0, 1] })
  match.board.push(aqua)
  match.players[1].health = 2

  const result = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })

  assert.equal(result.state.status, 'finished')
  assert.equal(result.state.winnerUserId, match.players[0].userId)
  assert.equal(result.state.endReason, 'end-turn')
  assert.deepEqual(result.state.board.find(unit => unit.id === aqua.id).typeTokens, [0, 0, 0, 2])
  assert.equal(result.state.current, 0)
  assert.equal(result.state.players[0].mana, match.players[0].mana)
})

test('Bunker Spider increases movement costs only on adjacent active creatures at every turn end', () => {
  const match = createMatch(input)
  const spider = turnUnit('Бункерный паук', 1, 2, 2)
  const unit = (index, owner, row, col, speed, changes = {}) => ({ id: `test-${index}`, card: catalog[index], owner, row, col, health: 4, maxHealth: 4, attack: 2, speed, summoned: 0, attacks: 0, blackTokens: 0, ...changes })
  const allied = unit(0, 0, 1, 2, 4)
  const enemy = unit(1, 1, 3, 3, 1)
  const distant = unit(2, 0, 0, 0, 4)
  const building = unit(3, 0, 2, 1, 4, { card: { ...catalog[3], Type: 3 } })
  const flipped = unit(4, 0, 1, 1, 4, { flippedTurns: 2 })
  const dying = unit(5, 0, 2, 3, 4, { dying: true })
  match.board.push(spider, allied, enemy, distant, building, flipped, dying)

  const result = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })

  const speed = id => result.state.board.find(unit => unit.id === id).speed
  assert.equal(speed(allied.id), 5)
  assert.equal(speed(enemy.id), 2)
  assert.equal(speed(distant.id), 4)
  assert.equal(speed(building.id), 4)
  assert.equal(speed(flipped.id), 4)
  assert.equal(speed(dying.id), 4)
})

test('a card removed at turn end cannot run an every-turn start effect from the old board', () => {
  const match = createMatch(input)
  match.board.push({ id: 'expires-draw', card: { ...catalog[0], Name: 'Black Mesa', Description: 'Постоянно: В начале каждого хода возьмите 2 карты.' }, owner: 0, row: 4, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 0, blackTokens: 0, expiresAtTurnEnd: true })
  const handIds = match.players[0].hand.map(card => card.instanceId)
  const deckIds = match.players[0].deck.map(card => card.instanceId)
  const ended = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(ended.state.board.length, 0)
  assert.equal(ended.state.players[0].discard[0].Name, 'Black Mesa')
  assert.deepEqual(ended.state.players[0].hand.map(card => card.instanceId), handIds)
  assert.deepEqual(ended.state.players[0].deck.map(card => card.instanceId), deckIds)
  assert.ok(!ended.events.some(event => event.type === 'start-turn.effect'))
})

test('start-of-turn forward movement respects board occupancy and runs movement triggers', () => {
  const match = createMatch(input)
  match.board.push(
    { id: 'pogan', card: { ...catalog[0], Name: 'Погань', Description: 'Постоянно: В начале хода передвигаеться вперёд на 1 сокет' }, owner: 1, row: 3, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'doggo', card: { ...catalog[1], Name: 'Догго' }, owner: 0, row: 4, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'turret', card: { ...catalog[2], Name: 'Турель', Type: 3 }, owner: 0, row: 4, col: 1, health: 4, maxHealth: 4, attack: 0, speed: 0, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const result = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.deepEqual([result.state.board.find(unit => unit.id === 'pogan').row, result.state.board.find(unit => unit.id === 'pogan').col], [4, 2])
  assert.equal(result.state.board.find(unit => unit.id === 'pogan').health, 3)
  assert.equal(result.state.board.find(unit => unit.id === 'doggo').attack, 2)
})

test('start-of-turn hand burn waits for a private card choice and resumes the turn once', () => {
  const match = createMatch(input)
  match.board.push({ id: 'burn-start', card: { ...catalog[0], Name: 'Рокочущий рыцарь', Description: 'Постоянно: В начале хода сожгите 1 карту из вашей руки.' }, owner: 1, row: 0, col: 2, health: 4, maxHealth: 4, attack: 3, speed: 2, summoned: 0, attacks: 0, blackTokens: 0 })
  const before = match.players[1].hand[0]
  const turn = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  const choice = turn.state.pendingChoice
  assert.equal(turn.state.current, 1)
  assert.equal(choice.kind, 'start-turn-burn')
  assert.deepEqual(projectForPlayer(turn.state, 0).private.pendingChoice, null)
  assert.equal(projectForPlayer(turn.state, 1).private.pendingChoice.options[0].unitId, before.instanceId)
  assert.equal(turn.state.players[1].hand.length, 4)
  const resolved = applyCommand(turn.state, 1, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: [before.instanceId] } } })
  assert.equal(resolved.state.players[1].burned[0].instanceId, before.instanceId)
  assert.equal(resolved.state.players[1].burnedThisTurn, true)
  assert.equal(resolved.state.players[1].hand.length, 4)
  assert.equal(resolved.state.pendingChoice, null)
  assert.equal(resolved.state.pendingTurnStart, null)
  assert.equal(resolved.state.version, 2)
  assert.equal(resolved.state.current, 1)
  assert.equal(JSON.stringify(resolved.events).includes(before.instanceId), false)
  assert.deepEqual(resolved.events[0], { type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, count: 1 })
})

test('Rumbling Knight resolves its catalog hand-burn trigger alongside its crown text', () => {
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  match.board.push(turnUnit('Рокочущий рыцарь', 1, 0, 2))
  const card = match.players[1].hand[0]

  const turn = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })

  assert.equal(turn.state.pendingChoice.kind, 'start-turn-burn')
  assert.equal(turn.state.pendingChoice.count, 1)
  assert.ok(turn.state.pendingChoice.unitIds.includes(card.instanceId))
})

test('Saint Croix privately selects and freely summons the cheapest hand creature nearby', () => {
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  match.round = 2
  const source = turnUnit('Сент-круа', 1, 0, 2)
  const card = { ...realCatalog.find(candidate => !candidate.Tags?.includes('в разработке') && candidate.Type === 0 && !/Вход\s*:/iu.test(candidate.Description ?? '')), instanceId: 'sent-croix-free-creature' }
  match.players[1].hand = [card]
  match.players[1].deck = []
  match.board.push(source)

  const started = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  const cardChoice = started.state.pendingChoice
  assert.equal(cardChoice.kind, 'start-turn-sent-croix')
  assert.equal(cardChoice.stage, 'card')
  assert.deepEqual(projectForPlayer(started.state, 0).private.pendingChoice, null)
  assert.equal(projectForPlayer(started.state, 1).private.pendingChoice.options[0].unitId, card.instanceId)

  const cellChoice = applyCommand(started.state, 1, { action: 'choice.resolve', data: { choiceId: cardChoice.id, selection: { unitId: card.instanceId } } })
  assert.equal(cellChoice.state.pendingChoice.stage, 'cell')
  assert.ok(cellChoice.state.pendingChoice.cells.some(cell => cell.row === 1 && cell.col === 2))
  assert.deepEqual(projectForPlayer(cellChoice.state, 0).private.pendingChoice, null)
  assert.ok(projectForPlayer(cellChoice.state, 1).private.pendingChoice.cells.some(cell => cell.row === 1 && cell.col === 2))
  const played = applyCommand(cellChoice.state, 1, { action: 'choice.resolve', data: { choiceId: cellChoice.state.pendingChoice.id, selection: { cell: { row: 1, col: 2 } } } })

  const summoned = played.state.board.find(unit => unit.card.instanceId === card.instanceId)
  assert.ok(summoned)
  assert.deepEqual([summoned.owner, summoned.row, summoned.col], [1, 1, 2])
  assert.equal(played.state.players[1].hand.some(candidate => candidate.instanceId === card.instanceId), false)
  assert.equal(played.state.players[1].mana, 2)
  assert.equal(played.state.players[1].played, true)
  assert.equal(played.state.pendingChoice, null)
  assert.equal(played.state.pendingTurnStart, null)
})

test('every-turn burn choice stays private to its source owner when the other seat starts', () => {
  const match = createMatch({ ...input, matchId: 'start-burn-every-turn', random: () => 0.25 })
  match.board.push({ id: 'burn-every-turn', card: { ...catalog[0], Name: 'Рокочущий рыцарь', Description: 'Постоянно: В начале каждого хода сожгите 1 карту из вашей руки.' }, owner: 0, row: 4, col: 2, health: 4, maxHealth: 4, attack: 3, speed: 2, summoned: 0, attacks: 0, blackTokens: 0 })
  const card = match.players[0].hand[0]
  const ended = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(ended.state.current, 1)
  assert.equal(ended.state.pendingChoice.owner, 0)
  assert.equal(ended.state.pendingChoice.kind, 'start-turn-burn')
  assert.equal(projectForPlayer(ended.state, 1).private.pendingChoice, null)
  assert.equal(projectForPlayer(ended.state, 0).private.pendingChoice.options[0].unitId, card.instanceId)
  const resolved = applyCommand(ended.state, 0, { action: 'choice.resolve', data: { choiceId: ended.state.pendingChoice.id, selection: { unitIds: [card.instanceId] } } })
  assert.ok(resolved.state.players[0].burned.some(candidate => candidate.instanceId === card.instanceId))
  assert.equal(resolved.state.current, 1)
  assert.equal(resolved.state.pendingTurnStart, null)
})

test('Генератор щита pauses turn start for a private adjacent-creature choice', () => {
  const match = createMatch(input)
  match.board.push(
    { id: 'shield-generator', card: { ...catalog[0], Name: 'Генератор щита', Description: 'Постоянно: В начале вашего хода дайте щит выбранному существу вокруг.', Type: 3 }, owner: 1, row: 0, col: 2, health: 3, maxHealth: 3, attack: 0, speed: 0, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'shield-target', card: { ...catalog[1], Name: 'Ally' }, owner: 1, row: 1, col: 1, health: 2, maxHealth: 2, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'shield-distant', card: { ...catalog[2], Name: 'Distant' }, owner: 1, row: 2, col: 2, health: 2, maxHealth: 2, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const turn = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  const choice = turn.state.pendingChoice
  assert.equal(choice.kind, 'start-turn-shield')
  assert.deepEqual(choice.unitIds, ['shield-target'])
  assert.equal(projectForPlayer(turn.state, 0).private.pendingChoice, null)
  assert.equal(projectForPlayer(turn.state, 1).private.pendingChoice.options[0].unitId, 'shield-target')
  assert.throws(() => applyCommand(turn.state, 1, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: 'shield-distant' } } }), error => error.code === 'INVALID_CHOICE')
  const resolved = applyCommand(turn.state, 1, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: 'shield-target' } } })
  assert.equal(resolved.state.board.find(unit => unit.id === 'shield-target').shield, true)
  assert.equal(resolved.state.pendingChoice, null)
  assert.equal(resolved.state.pendingTurnStart, null)
  assert.equal(resolved.state.current, 1)
})

test('Чёрная меза draws before its conditional turn-start burn and then refills once', () => {
  const match = createMatch(input)
  const player = match.players[1]
  player.limit = 5
  const deckBefore = player.deck.length
  match.board.push({ id: 'black-mesa', card: { ...catalog[0], Name: 'Чёрная меза', Description: 'Постоянно: В начале хода возьмите 2 карты. Если у вас лимит карт 5 и больше, сожгите 1 карту', Type: 0 }, owner: 1, row: 0, col: 2, health: 5, maxHealth: 5, attack: 3, speed: 2, summoned: 0, attacks: 0, blackTokens: 0 })
  const drawnIds = player.deck.slice(0, 2).map(card => card.instanceId)
  const turn = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  const choice = turn.state.pendingChoice
  assert.equal(choice.kind, 'start-turn-burn')
  assert.equal(choice.count, 1)
  assert.equal(turn.state.players[1].hand.length, 6)
  assert.deepEqual(turn.state.players[1].hand.slice(4).map(card => card.instanceId), drawnIds)
  const burnId = choice.unitIds[0]
  const resolved = applyCommand(turn.state, 1, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: [burnId] } } })
  assert.equal(resolved.state.players[1].burned[0].instanceId, burnId)
  assert.equal(resolved.state.players[1].hand.length, 5)
  assert.equal(resolved.state.players[1].deck.length, deckBefore - 2)
  assert.equal(resolved.state.pendingTurnStart, null)
  assert.equal(resolved.state.current, 1)
})

test('a lethal every-turn trigger awards the match to the source owner', () => {
  const match = createMatch(input)
  match.current = 1
  match.players[1].played = true
  match.players[1].health = 45
  match.players[0].health = 45
  match.board.push({ id: 'drain', card: { ...catalog[0], Name: 'Drain', Description: 'Постоянно: В начале каждого хода Наносит противнику 4 урона.' }, owner: 0, row: 4, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 0, blackTokens: 0 })
  match.players[1].health = 3
  const result = applyCommand(match, 1, { action: 'turn.end', data: {} })
  assert.equal(result.state.status, 'finished')
  assert.equal(result.state.winnerUserId, 'user-1')
  assert.equal(result.state.endReason, 'start-turn')
})

test('the round advances only after seat one finishes', () => {
  const match = createMatch(input)
  const seatOneTurn = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } }).state
  const nextRound = applyCommand(seatOneTurn, 1, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(nextRound.state.current, 0)
  assert.equal(nextRound.state.round, 2)
  assert.equal(nextRound.state.players[0].mana, 2)
  assert.equal(nextRound.state.players[0].energy, 2)
  assert.equal(nextRound.state.version, 2)
})

test('an unplayed turn may discard one or two owned cards and lower hand limit once', () => {
  const match = createMatch(input)
  const discardedIds = match.players[0].hand.slice(0, 2).map(card => card.instanceId)
  const result = applyCommand(match, 0, { action: 'turn.end', data: { option: 'discard_and_decrease_limit', discardedCardInstanceIds: discardedIds } })

  assert.equal(result.state.players[0].limit, 3)
  assert.deepEqual(result.state.players[0].discard.map(card => card.instanceId), discardedIds)
  assert.equal(result.state.players[0].hand.length, 2)
  assert.equal(result.state.players[1].hand.length, 4)
  assert.equal(match.players[0].limit, 4)
})

test('an unplayed turn may increase the hand limit from round five', () => {
  const match = { ...createMatch(input), round: 5 }
  const result = applyCommand(match, 0, { action: 'turn.end', data: { option: 'increase_limit_after_round_5' } })

  assert.equal(result.state.players[0].limit, 5)
})

test('invalid no-play choices leave the authoritative match untouched', () => {
  const match = createMatch(input)
  const before = structuredClone(match)
  assert.throws(() => applyCommand(match, 0, { action: 'turn.end', data: { option: 'discard_and_decrease_limit', discardedCardInstanceIds: ['unknown'] } }), { code: 'INVALID_COMMAND' })
  assert.throws(() => applyCommand(match, 0, { action: 'turn.end', data: { option: 'increase_limit_after_round_5' } }), { code: 'INVALID_COMMAND' })
  assert.throws(() => applyCommand(match, 0, { action: 'turn.end', data: {} }), { code: 'INVALID_COMMAND' })
  assert.deepEqual(match, before)
})

test('moves an active unit one orthogonal slot and spends its effective speed', () => {
  const match = createMatch(input)
  match.players[0].energy = 2
  match.board.push({ id: 'unit-1', card: { ...catalog[0], instanceId: 'ci-unit' }, owner: 0, row: 4, col: 2, health: 1, maxHealth: 1, attack: 1, speed: 2, shield: false, summoned: 0, attacks: 0, stunned: 0, dying: false })

  const result = applyCommand(match, 0, { action: 'unit.move', data: { unitId: 'unit-1', to: { row: 3, col: 2 } } })

  assert.deepEqual([result.state.board[0].row, result.state.board[0].col], [3, 2])
  assert.equal(result.state.players[0].energy, 0)
  assert.equal(result.state.version, 1)
  assert.deepEqual(result.events, [{ type: 'unit.moved', unitId: 'unit-1', from: { row: 4, col: 2 }, to: { row: 3, col: 2 } }])
  assert.deepEqual([match.board[0].row, match.board[0].col], [4, 2])
})

test('moving a creature buffs every Doggo until the end of the active turn', () => {
  const match = createMatch(input)
  match.board.push(
    { id: 'mover', card: { ...catalog[0], Name: 'Mover' }, owner: 0, row: 4, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0 },
    { id: 'doggo', card: { ...catalog[1], Name: 'Догго', Description: 'Постоянно: Получает +1❤️⚔️⚡ за каждое движение другого существа. В конце хода сбрасывает все.' }, owner: 1, row: 3, col: 4, health: 4, maxHealth: 4, attack: 2, speed: 2, summoned: 0, attacks: 0 },
  )

  const moved = applyCommand(match, 0, { action: 'unit.move', data: { unitId: 'mover', to: { row: 3, col: 0 } } })
  const buffed = moved.state.board.find(unit => unit.id === 'doggo')
  assert.deepEqual([buffed.attack, buffed.speed, buffed.health, buffed.maxHealth, buffed.doggoBuffs], [3, 1, 5, 5, 1])

  const ended = applyCommand(moved.state, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  const reset = ended.state.board.find(unit => unit.id === 'doggo')
  assert.deepEqual([reset.attack, reset.speed, reset.health, reset.maxHealth, reset.doggoBuffs], [2, 2, 4, 4, 0])

  const expiring = createMatch(input)
  expiring.board.push({ id: 'doggo', card: { ...catalog[1], Name: 'Догго' }, owner: 1, row: 3, col: 4, health: 1, maxHealth: 3, attack: 2, speed: 3, doggoBuffs: 1 })
  const expired = applyCommand(expiring, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(expired.state.board.some(unit => unit.id === 'doggo'), false)
  assert.equal(expired.state.players[1].discard.some(card => card.Name === 'Догго'), true)
})

test('entering a Turret socket takes two damage and resolves lethal damage', () => {
  const createTurretMatch = ({ health = 5, shield = false } = {}) => {
    const match = createMatch(input)
    match.board.push(
      { id: 'mover', card: { ...catalog[0], Name: 'Mover' }, owner: 0, row: 4, col: 2, health, maxHealth: 5, attack: 1, speed: 1, shield, summoned: 0, attacks: 0 },
      { id: 'turret', card: { ...catalog[1], Name: 'Турель', Description: 'Постоянно: Если существо которое не было изначально вокруг Турели передвинеться вокруг неё - оно получит 2 урона.' }, owner: 1, row: 2, col: 2, health: 5, maxHealth: 5, attack: 0, speed: 0, summoned: 0, attacks: 0 },
    )
    return match
  }

  const match = createTurretMatch()
  const result = applyCommand(match, 0, { action: 'unit.move', data: { unitId: 'mover', to: { row: 3, col: 2 } } })
  assert.equal(result.state.board.find(unit => unit.id === 'mover').health, 3)

  const shielded = applyCommand(createTurretMatch({ shield: true }), 0, { action: 'unit.move', data: { unitId: 'mover', to: { row: 3, col: 2 } } })
  assert.equal(shielded.state.board.find(unit => unit.id === 'mover').health, 5)
  assert.equal(shielded.state.board.find(unit => unit.id === 'mover').shield, false)

  const lethal = applyCommand(createTurretMatch({ health: 1 }), 0, { action: 'unit.move', data: { unitId: 'mover', to: { row: 3, col: 2 } } })
  assert.equal(lethal.state.board.some(unit => unit.id === 'mover'), false)
  assert.equal(lethal.state.players[0].discard.some(card => card.Name === 'Mover'), true)

  const birdliMatch = createTurretMatch({ health: 1 })
  birdliMatch.board[0].card.Name = 'Бёрдли'
  const birdli = applyCommand(birdliMatch, 0, { action: 'unit.move', data: { unitId: 'mover', to: { row: 3, col: 2 } } })
  assert.equal(birdli.state.board[0].flippedTurns, 3)
  assert.equal(birdli.state.board[0].birdliDeathFlip, true)
})

test('rejects invalid unit movement without changing state or spending energy', () => {
  const match = createMatch(input)
  match.players[0].energy = 2
  match.board.push({ id: 'unit-1', card: { ...catalog[0], instanceId: 'ci-unit' }, owner: 0, row: 4, col: 2, health: 1, maxHealth: 1, attack: 1, speed: 1, shield: false, summoned: 1, attacks: 0, stunned: 0, dying: false })
  const before = structuredClone(match)

  assert.throws(() => applyCommand(match, 0, { action: 'unit.move', data: { unitId: 'unit-1', to: { row: 3, col: 2 } } }), { code: 'UNIT_CANNOT_MOVE' })
  assert.throws(() => applyCommand(match, 1, { action: 'unit.move', data: { unitId: 'unit-1', to: { row: 3, col: 2 } } }), { code: 'NOT_YOUR_TURN' })
  assert.deepEqual(match, before)
})

test('movement requires an open adjacent slot, enough energy, and no turn lock', () => {
  const match = createMatch(input)
  match.players[0].energy = 1
  match.board.push({ id: 'unit-1', card: { ...catalog.find(card => card.Type === 0), instanceId: 'ci-unit' }, owner: 0, row: 4, col: 2, health: 1, maxHealth: 1, attack: 1, speed: 2, shield: false, summoned: 0, attacks: 0, stunned: 0, dying: false })
  const move = to => applyCommand(match, 0, { action: 'unit.move', data: { unitId: 'unit-1', to } })
  const before = structuredClone(match)

  assert.throws(() => move({ row: 2, col: 2 }), { code: 'INVALID_TARGET' })
  assert.throws(() => move({ row: 3, col: 2 }), { code: 'NOT_ENOUGH_ENERGY' })
  match.movementLock = 0
  assert.throws(() => move({ row: 3, col: 2 }), { code: 'MOVEMENT_BLOCKED' })
  match.movementLock = null
  match.board.push({ ...match.board[0], id: 'blocker', owner: 1, row: 3, col: 2 })
  assert.throws(() => applyCommand(match, 0, { action: 'unit.move', data: { unitId: 'unit-1', to: { row: 3, col: 2 } } }), { code: 'INVALID_TARGET' })
  assert.deepEqual([match.board[0].row, match.board[0].col, match.players[0].energy], [before.board[0].row, before.board[0].col, before.players[0].energy])
})

test('Hoppy privately saves a flipped board card on entry without revealing its identity', () => {
  const hoppy = { ...catalog[0], Id: 'hoppy', Name: 'Hoppy', Type: 0, Cost: 1, Description: 'Вход: Сберегите выбранную перевёрнутую карту.' }
  const match = createMatch({ ...input, catalog: [...catalog, hoppy] })
  const handCard = { ...hoppy, instanceId: 'hoppy-instance' }
  const hiddenCard = { ...catalog[1], Id: 'secret-card', Name: 'Secret creature', instanceId: 'secret-instance' }
  match.players[0].hand = [handCard]
  match.players[0].mana = 1
  match.board.push({ id: 'face-down', card: hiddenCard, owner: 1, row: 1, col: 2, health: 0, maxHealth: 3, attack: 0, speed: 0, blackTokens: 0, flippedTurns: 1 })

  const played = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: handCard.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  assert.equal(played.state.pendingChoice.kind, 'entry-save-flipped')
  assert.equal(played.state.players[0].mana, 0)
  assert.equal(projectForPlayer(played.state, 0).private.pendingChoice.options[0].name, 'Перевёрнутая карта · 2, 3')
  assert.equal(projectForPlayer(played.state, 1).private.pendingChoice, null)
  assert.equal(JSON.stringify(projectForPlayer(played.state, 0)).includes('Secret creature'), false)
  assert.equal(JSON.stringify(projectForPlayer(played.state, 1)).includes('secret-instance'), false)

  const resolved = applyCommand(played.state, 0, { action: 'choice.resolve', data: { choiceId: played.state.pendingChoice.id, selection: { unitId: 'face-down' } } })
  assert.equal(resolved.state.board.some(unit => unit.id === 'face-down'), false)
  assert.equal(resolved.state.players[0].saved[0].instanceId, 'secret-instance')
  assert.equal(resolved.state.pendingChoice, null)
})

test('Depressive Jaw discards the rest of its owner hand and locks its hand limit at one', () => {
  const jaw = realCatalog.find(card => card.Name === 'Депрессивная Жопа')
  assert.ok(jaw)
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const discarded = [0, 1].map(index => ({ ...catalog[index], instanceId: `jaw-discard-${index}` }))
  match.players[0].hand = [{ ...jaw, instanceId: 'jaw-instance' }, ...discarded]
  match.players[0].mana = 10
  match.players[0].limit = 6
  match.players[0].temporaryLimitExpirations = [2]

  const result = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: 'jaw-instance', payment: 'mana', target: { row: 1, col: 2 } } })

  assert.deepEqual(result.state.players[0].discard.map(card => card.instanceId), discarded.map(card => card.instanceId))
  assert.equal(result.state.players[0].hand.length, 0)
  assert.equal(result.state.players[0].limit, 1)
  assert.deepEqual(result.state.players[0].depressiveHandLimit, { previousLimit: 5 })
})

test('Depressive Jaw takes the top discard at owner turn start before the ordinary draw', () => {
  const jaw = realCatalog.find(card => card.Name === 'Депрессивная Жопа')
  assert.ok(jaw)
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const topDiscard = { ...catalog[0], instanceId: 'jaw-top-discard' }
  match.board.push({ id: 'jaw-board', card: { ...jaw, instanceId: 'jaw-board-card' }, owner: 0, row: 1, col: 2, health: jaw.Health, maxHealth: jaw.Health, attack: jaw.Attack, speed: jaw.Speed, blackTokens: 0 })
  match.players[0].limit = 1
  match.players[0].depressiveHandLimit = { previousLimit: 6 }
  match.players[0].hand = []
  match.players[0].discard = [topDiscard]
  match.current = 1

  const result = applyCommand(match, 1, { action: 'turn.end', data: { option: 'no_penalty' } })

  assert.equal(result.state.current, 0)
  assert.equal(result.state.players[0].hand.length, 1)
  assert.equal(result.state.players[0].hand[0].instanceId, topDiscard.instanceId)
  assert.equal(result.state.players[0].discard.length, 0)
})

test('removing Depressive Jaw restores its saved hand limit', () => {
  const jaw = realCatalog.find(card => card.Name === 'Депрессивная Жопа')
  const spell = realCatalog.find(card => card.Name === 'Город без души')
  assert.ok(jaw && spell)
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  match.board.push({ id: 'jaw-board', card: { ...jaw, instanceId: 'jaw-board-card' }, owner: 0, row: 1, col: 2, health: jaw.Health, maxHealth: jaw.Health, attack: jaw.Attack, speed: jaw.Speed, blackTokens: 0 })
  match.players[0].limit = 1
  match.players[0].depressiveHandLimit = { previousLimit: 6 }
  match.players[0].hand = [{ ...spell, instanceId: 'destroy-jaw' }]
  match.players[0].mana = spell.Cost

  const result = applyCommand(match, 0, { action: 'spell.cast', data: { cardInstanceId: 'destroy-jaw', payment: 'mana', target: { unitId: 'jaw-board' } } })

  assert.equal(result.state.board.some(unit => unit.id === 'jaw-board'), false)
  assert.equal(result.state.players[0].limit, 6)
  assert.equal(result.state.players[0].depressiveHandLimit, undefined)
})

test('hand-limit lock prevents raising the limit while Depressive Jaw remains', () => {
  const match = createMatch(input)
  match.round = 5
  match.players[0].depressiveHandLimit = { previousLimit: 4 }
  match.players[0].limit = 1

  assert.throws(() => applyCommand(match, 0, { action: 'turn.end', data: { option: 'increase_limit_after_round_5' } }), { code: 'INVALID_COMMAND' })
  assert.equal(match.players[0].limit, 1)
})

test('Lazerwygs34 gains its entry stats from round 10 onward only', () => {
  const card = { ...catalog[0], Id: 'lazerwygs34', Name: 'Lazerwygs34', Type: 0, Cost: 2, Attack: 1, Health: 1, Description: 'Вход: Получает +3 ⚔️и +3❤️ если у вас 10 раунд.' }
  const makeMatch = (round) => {
    const match = createMatch({ ...input, catalog: [...catalog, card] })
    match.round = round
    match.players[0].hand = [{ ...card, instanceId: `lazer-${round}` }]
    match.players[0].mana = 2
    return match
  }
  const beforeCondition = applyCommand(makeMatch(9), 0, { action: 'card.play', data: { cardInstanceId: 'lazer-9', payment: 'mana', target: { row: 4, col: 1 } } })
  const atCondition = applyCommand(makeMatch(10), 0, { action: 'card.play', data: { cardInstanceId: 'lazer-10', payment: 'mana', target: { row: 4, col: 1 } } })

  assert.deepEqual([beforeCondition.state.board[0].attack, beforeCondition.state.board[0].health, beforeCondition.state.board[0].maxHealth], [1, 1, 1])
  assert.deepEqual([atCondition.state.board[0].attack, atCondition.state.board[0].health, atCondition.state.board[0].maxHealth], [4, 4, 4])
})

test('Turbot cancels flip on creatures and resolves creatures left at zero health', () => {
  const card = { ...realCatalog.find(candidate => candidate.Name === 'Турбот'), instanceId: 'turbot-entry' }
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  match.players[0].hand = [card]
  match.players[0].mana = card.Cost
  match.board.push(
    { id: 'flipped-ally', card: catalog[0], owner: 0, row: 4, col: 1, health: 2, maxHealth: 2, attack: 1, speed: 1, flippedTurns: 2 },
    { id: 'lethal-enemy', card: catalog[1], owner: 1, row: 0, col: 1, health: 0, maxHealth: 2, attack: 1, speed: 1, flippedTurns: 1 },
    { id: 'flipped-building', card: { ...catalog[0], Type: 3 }, owner: 1, row: 1, col: 1, health: 2, maxHealth: 2, attack: 0, speed: 0, flippedTurns: 2 },
  )

  const result = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 2 } } })

  assert.equal(result.state.board.find(unit => unit.id === 'flipped-ally').flippedTurns, 0)
  assert.equal(result.state.board.some(unit => unit.id === 'lethal-enemy'), false)
  assert.equal(result.state.board.find(unit => unit.id === 'flipped-building').flippedTurns, 2)
})

test('Yellow Diamond flips every other field card on entry', () => {
  const card = { ...realCatalog.find(candidate => candidate.Name === 'Жёлтый алмаз'), instanceId: 'yellow-diamond-entry' }
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  match.players[0].hand = [card]
  match.players[0].mana = card.Cost
  match.board.push(
    { id: 'yellow-ally', card: catalog[0], owner: 0, row: 4, col: 1, health: 2, maxHealth: 2, attack: 1, speed: 1 },
    { id: 'yellow-enemy', card: catalog[1], owner: 1, row: 0, col: 1, health: 2, maxHealth: 2, attack: 1, speed: 1 },
    { id: 'yellow-building', card: { ...catalog[0], Type: 3 }, owner: 1, row: 1, col: 1, health: 2, maxHealth: 2, attack: 0, speed: 0 },
  )

  const result = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 2 } } })

  assert.deepEqual(['yellow-ally', 'yellow-enemy', 'yellow-building'].map(id => result.state.board.find(unit => unit.id === id).flippedTurns), [2, 2, 2])
  assert.equal(result.state.board.find(unit => unit.card.instanceId === card.instanceId).flippedTurns, 0)
})

test('Aiboll entry privately chooses and destroys one building', () => {
  const card = { ...realCatalog.find(candidate => candidate.Name === 'Айболл'), instanceId: 'aiboll-entry' }
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  match.players[0].hand = [card]
  match.players[0].mana = card.Cost
  match.board.push(
    { id: 'aiboll-friendly', card: { ...catalog[0], Type: 3 }, owner: 0, row: 3, col: 0, health: 3, maxHealth: 3, attack: 0, speed: 0 },
    { id: 'aiboll-enemy', card: { ...catalog[1], Type: 3 }, owner: 1, row: 1, col: 0, health: 3, maxHealth: 3, attack: 0, speed: 0 },
    { id: 'aiboll-creature', card: catalog[2], owner: 1, row: 0, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1 },
  )

  const played = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 2 } } })

  assert.equal(played.state.pendingChoice.kind, 'entry-destroy-building')
  assert.deepEqual(played.state.pendingChoice.unitIds, ['aiboll-friendly', 'aiboll-enemy'])
  assert.equal(projectForPlayer(played.state, 1).private.pendingChoice, null)
  assert.deepEqual(projectForPlayer(played.state, 0).private.pendingChoice.options.map(option => option.unitId), ['aiboll-friendly', 'aiboll-enemy'])
  const resolved = applyCommand(played.state, 0, { action: 'choice.resolve', data: { choiceId: played.state.pendingChoice.id, selection: { unitId: 'aiboll-enemy' } } })

  assert.equal(resolved.state.board.some(unit => unit.id === 'aiboll-enemy'), false)
  assert.equal(resolved.state.board.some(unit => unit.id === 'aiboll-friendly'), true)
  assert.equal(resolved.state.board.some(unit => unit.id === 'aiboll-creature'), true)
  assert.equal(resolved.state.players[1].discard.some(discarded => discarded.Id === catalog[1].Id), true)
})

test('Asi.mp4 entry fully heals a chosen creature and flips it for two turns', () => {
  const card = { ...realCatalog.find(candidate => candidate.Name === 'Аси.mp4'), instanceId: 'asi-entry' }
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const drawn = match.players[1].deck[0].instanceId
  match.players[0].hand = [card]
  match.players[0].mana = card.Cost
  match.board.push({ id: 'asi-target', card: realCatalog.find(candidate => candidate.Name === '.Хихо'), owner: 1, row: 2, col: 1, health: 1, maxHealth: 5, attack: 2, speed: 1, flippedTurns: 0 })

  const played = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 2 } } })

  assert.equal(played.state.pendingChoice.kind, 'heal-creature')
  assert.deepEqual(played.state.pendingChoice.unitIds, ['asi-target'])
  assert.equal(projectForPlayer(played.state, 1).private.pendingChoice, null)
  const resolved = applyCommand(played.state, 0, { action: 'choice.resolve', data: { choiceId: played.state.pendingChoice.id, selection: { unitId: 'asi-target' } } })
  const target = resolved.state.board.find(unit => unit.id === 'asi-target')
  assert.deepEqual([target.health, target.maxHealth, target.attack, target.speed, target.flippedTurns], [6, 6, 3, 0, 2])
  assert.equal(resolved.state.players[1].deck.some(deckCard => deckCard.instanceId === drawn), false)
  assert.equal(resolved.state.players[1].hand.at(-1).instanceId, drawn)
  assert.equal(resolved.state.players[1].mana, 1)
})

test('entry stun effects limit private targets and apply their printed duration', () => {
  const cases = [
    { name: 'Мендор', burn: false, targets: ['stun-ally', 'unit_1'], selected: 'stun-ally', owner: 0, turns: 2 },
    { name: 'Тюшма', burn: true, targets: ['stun-ally', 'stun-enemy', 'unit_1'], selected: 'stun-enemy', owner: 1, turns: 2 },
    { name: 'Ральзей', burn: false, targets: ['stun-enemy'], selected: 'stun-enemy', owner: 1, turns: 1 },
  ]
  for (const [index, scenario] of cases.entries()) {
    const card = { ...realCatalog.find(candidate => candidate.Name === scenario.name), instanceId: `stun-entry-${index}` }
    const match = createMatch({ ...input, catalog: [...catalog, card] })
    match.players[0].hand = [card]
    match.players[0].mana = card.Cost
    match.players[0].burnedThisTurn = scenario.burn
    match.players[0].health = 40
    match.board.push(
      { id: 'stun-ally', card: catalog[1], owner: 0, row: 3, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1, stunned: 0 },
      { id: 'stun-enemy', card: catalog[2], owner: 1, row: 1, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1, stunned: 0 },
    )

    const played = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 2 } } })

    assert.ok(played.state.pendingChoice, scenario.name)
    assert.equal(played.state.pendingChoice.kind, 'entry-stun-creature', scenario.name)
    assert.deepEqual(played.state.pendingChoice.unitIds, scenario.targets, scenario.name)
    assert.equal(projectForPlayer(played.state, 1).private.pendingChoice, null, scenario.name)
    assert.equal(projectForPlayer(played.state, 0).private.pendingChoice.turns, scenario.turns, scenario.name)
    assert.equal(played.state.players[0].health, scenario.name === 'Ральзей' ? 44 : 40)
    const resolved = applyCommand(played.state, 0, { action: 'choice.resolve', data: { choiceId: played.state.pendingChoice.id, selection: { unitId: scenario.selected } } })
    assert.equal(resolved.state.board.find(unit => unit.id === scenario.selected).stunned, scenario.turns, scenario.name)
    assert.equal(resolved.state.pendingChoice, null, scenario.name)
  }
})

test('Tyushma entry does not open a target choice before a card was burned this turn', () => {
  const card = { ...realCatalog.find(candidate => candidate.Name === 'Тюшма'), instanceId: 'tyushma-no-burn' }
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  match.players[0].hand = [card]
  match.players[0].mana = card.Cost
  match.players[0].burnedThisTurn = false
  const played = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 2 } } })
  assert.equal(played.state.pendingChoice ?? null, null)
})

test('plays a creature from hand onto its home row, pays mana and marks the turn', () => {
  const match = createMatch(input)
  const card = { ...catalog[0], instanceId: 'ci-play' }
  match.players[0].hand.push(card)
  match.players[0].mana = card.Cost

  const result = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: card.instanceId, target: { row: 4, col: 1 }, payment: 'mana' } })

  assert.equal(result.state.players[0].hand.some(item => item.instanceId === card.instanceId), false)
  assert.equal(result.state.players[0].mana, 0)
  assert.equal(result.state.players[0].played, true)
  assert.deepEqual([result.state.board[0].owner, result.state.board[0].row, result.state.board[0].col, result.state.board[0].summoned], [0, 4, 1, 1])
  assert.equal(result.state.version, 1)
  assert.deepEqual(result.events, [{ type: 'card.played', cardId: card.Id, unitId: result.state.board[0].id, target: { row: 4, col: 1 } }])
  assert.equal(match.players[0].hand.some(item => item.instanceId === card.instanceId), true)
})

test('playing a creature into an occupied home slot pushes the full creature line toward the board edge', () => {
  const match = createMatch(input)
  const card = { ...catalog[0], instanceId: 'ci-push-play' }
  match.players[0].hand.push(card)
  match.players[0].mana = card.Cost
  match.board.push(
    { id: 'front', card: catalog[1], owner: 1, row: 4, col: 1, health: 2, maxHealth: 2, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'back', card: catalog[2], owner: 0, row: 3, col: 1, health: 2, maxHealth: 2, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )

  const result = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: card.instanceId, target: { row: 4, col: 1 }, payment: 'mana' } })

  assert.deepEqual(result.state.board.map(unit => [unit.id, unit.row, unit.col]), [['front', 3, 1], ['back', 2, 1], ['unit_1', 4, 1]])
  assert.equal(result.state.players[0].mana, 0)
  assert.equal(result.state.players[0].played, true)
})

test('a building that blocks a push leaves the card and mana untouched', () => {
  const match = createMatch(input)
  const card = { ...catalog[0], instanceId: 'ci-push-blocked' }
  match.players[0].hand.push(card)
  match.players[0].mana = card.Cost + 1
  match.board.push(
    { id: 'front', card: catalog[1], owner: 1, row: 4, col: 1, health: 2, maxHealth: 2, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'barrier', card: { ...catalog[2], Name: 'Barrier', Type: 3 }, owner: 0, row: 3, col: 1, health: 2, maxHealth: 2, attack: 0, speed: 0, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const before = structuredClone(match)

  assert.throws(() => applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: card.instanceId, target: { row: 4, col: 1 }, payment: 'mana' } }), { code: 'INVALID_TARGET' })
  assert.deepEqual(match, before)
})

test('resolves a self-contained entry resource gain as part of card play', () => {
  const card = { ...catalog[0], Id: 'entry-resource', Name: 'Разбойник', Type: 0, Cost: 0, Description: 'Вход: Получите 3 энергии.' }
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const instance = { ...card, instanceId: 'ci-entry-resource' }
  match.players[0].hand.push(instance)
  match.players[0].energy = 1
  const result = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: instance.instanceId, target: { row: 4, col: 1 }, payment: 'mana' } })
  assert.equal(result.state.players[0].energy, 4)
  assert.equal(result.state.players[0].hand.some(item => item.instanceId === instance.instanceId), false)
  assert.equal(result.state.board[0].card.Name, 'Разбойник')
  assert.equal(result.state.version, 1)
})

test('Hameleonew schedules one saved card for its owner when played', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Hameleonew')
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const instance = { ...card, instanceId: 'hameleonew-instance' }
  match.players[0].hand = [instance]
  match.players[0].mana = 10
  const result = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: instance.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  assert.equal(result.state.players[0].nextBurnToSave, 1)
  assert.equal(result.state.players[1].nextBurnToSave, undefined)
  assert.equal(projectForPlayer(result.state, 0).private.nextBurnToSave, 1)
  assert.equal(projectForPlayer(result.state, 1).private.nextBurnToSave, 0)
  assert.equal(result.state.players[0].hand.some(card => card.instanceId === instance.instanceId), false)
})

test('Birdli gives its owner a +2 bonus on the next gamba roll when played', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Бёрдли')
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const instance = { ...card, instanceId: 'birdli-instance' }
  match.players[0].hand = [instance]
  match.players[0].mana = 10
  const result = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: instance.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  assert.equal(result.state.players[0].nextGambaBonus, 2)
  assert.equal(result.state.players[1].nextGambaBonus, undefined)
  assert.equal(projectForPlayer(result.state, 0).private.nextGambaBonus, 2)
  assert.equal(projectForPlayer(result.state, 1).private.nextGambaBonus, 0)
})

test('Вондертян draws to eight and restores the prior hand limit after the owner next turn', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Вондертян')
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const instance = { ...card, instanceId: 'wondertian-instance' }
  match.players[0].hand = [instance, ...Array.from({ length: 2 }, (_, index) => ({ ...catalog[index], instanceId: `wonder-hand-${index}` }))]
  match.players[0].mana = 10
  const initialLimit = match.players[0].limit
  let state = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: instance.instanceId, payment: 'mana', target: { row: 4, col: 1 } } }).state
  assert.equal(state.players[0].hand.length, 8)
  assert.equal(state.players[0].limit, 8)
  state = applyCommand(state, 0, { action: 'turn.end', data: {} }).state
  assert.equal(state.players[0].limit, 8)
  state = applyCommand(state, 1, { action: 'turn.end', data: { option: 'no_penalty' } }).state
  assert.equal(state.players[0].limit, 8)
  state = applyCommand(state, 0, { action: 'turn.end', data: { option: 'no_penalty' } }).state
  assert.equal(state.players[0].limit, initialLimit)
})

test('Вондертян limit override preserves overlapping temporary limit changes and restores the base', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Вондертян')
  const gameNight = { ...catalog[0], Id: 'game-night', Name: 'Геймнайт', Type: 2, Cost: 0, Description: 'Возьмите 2 карты и увеличьте лимит карт противника на 2 до конца его хода' }
  const match = createMatch({ ...input, catalog: [...catalog, card, gameNight] })
  const instance = { ...card, instanceId: 'wondertian-overlap-instance' }
  match.players[0].hand = [instance]
  match.players[0].mana = 10
  match.players[0].limit = 6
  match.players[0].temporaryLimitExpirations = [1, 5]
  match.players[1].hand = [{ ...gameNight, instanceId: 'game-night-overlap-instance' }]
  match.players[1].mana = 10

  let state = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: instance.instanceId, payment: 'mana', target: { row: 4, col: 1 } } }).state
  assert.equal(state.players[0].temporaryLimitOverride.previous, 4)
  state = applyCommand(state, 0, { action: 'turn.end', data: {} }).state
  state = applyCommand(state, 1, { action: 'spell.cast', data: { cardInstanceId: 'game-night-overlap-instance', payment: 'mana' } }).state
  assert.equal(state.players[0].limit, 8)
  assert.deepEqual(state.players[0].temporaryLimitExpirations, [1, 5, 2, 2])
  state = applyCommand(state, 1, { action: 'turn.end', data: {} }).state
  state = applyCommand(state, 0, { action: 'turn.end', data: { option: 'no_penalty' } }).state
  assert.equal(state.players[0].limit, 5)
  assert.deepEqual(state.players[0].temporaryLimitExpirations, [5])
  assert.equal(state.players[0].temporaryLimitOverride, undefined)
})

test('Вискас entry privately offers a deck draw or an exact hand-card discard', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Вискас')
  const makeMatch = () => {
    const match = createMatch({ ...input, catalog: [...catalog, card] })
    const instance = { ...card, instanceId: 'viskas-instance' }
    const handCards = Array.from({ length: 5 }, (_, index) => ({ ...catalog[index], instanceId: `viskas-hand-${index}` }))
    match.players[0].hand = [instance, ...handCards]
    match.players[0].mana = 10
    return { match, instance, handCards }
  }

  const { match, instance, handCards } = makeMatch()
  const played = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: instance.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  assert.equal(played.state.pendingChoice.kind, 'viskas-choice')
  assert.deepEqual(projectForPlayer(played.state, 0).private.pendingChoice.choices.map(choice => choice.value.choice), ['viskas-draw', 'viskas-discard'])
  assert.equal(projectForPlayer(played.state, 1).private.pendingChoice, null)
  const discardStage = applyCommand(played.state, 0, { action: 'choice.resolve', data: { choiceId: played.state.pendingChoice.id, selection: { choice: 'viskas-discard' } } })
  assert.equal(discardStage.state.pendingChoice.stage, 'discard')
  assert.deepEqual(projectForPlayer(discardStage.state, 0).private.pendingChoice.options.map(option => option.unitId), handCards.map(handCard => handCard.instanceId))
  const discarded = applyCommand(discardStage.state, 0, { action: 'choice.resolve', data: { choiceId: discardStage.state.pendingChoice.id, selection: { unitId: handCards[0].instanceId } } })
  assert.equal(discarded.state.players[0].discard.at(-1).instanceId, handCards[0].instanceId)
  assert.equal(discarded.state.pendingChoice, null)

  const drawCase = makeMatch()
  const drawPlayed = applyCommand(drawCase.match, 0, { action: 'card.play', data: { cardInstanceId: drawCase.instance.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  const top = drawPlayed.state.players[0].deck[0].instanceId
  const drawn = applyCommand(drawPlayed.state, 0, { action: 'choice.resolve', data: { choiceId: drawPlayed.state.pendingChoice.id, selection: { choice: 'viskas-draw' } } })
  assert.equal(drawn.state.players[0].hand.at(-1).instanceId, top)
  assert.equal(drawn.state.pendingChoice, null)
})

test('beetle takes a chosen creature item on entry and reverses the donor bonuses', () => {
  const beetle = realCatalog.find(card => card.Name === 'Собирающий жук')
  assert.deepEqual(entryTargetOperation(beetle.Description), { kind: 'take-target-item' })
  const match = createMatch({ ...input, catalog: [...catalog, beetle] })
  const instance = { ...beetle, instanceId: 'beetle-instance' }
  const item = { ...catalog[0], Id: 'plain-item', Name: 'Plain item', Type: 1, Attack: 2, Health: 3, instanceId: 'item-instance' }
  const donorCard = { ...catalog[1], Name: 'Donor', Type: 0, Attack: 2, Health: 5, instanceId: 'donor-instance' }
  match.players[0].hand = [instance]
  match.players[0].mana = 10
  match.board.push({ id: 'donor', card: donorCard, item, owner: 1, row: 2, col: 2, health: 6, maxHealth: 8, attack: 4, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })
  const played = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: instance.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  assert.equal(played.state.pendingChoice.kind, 'entry-take-item')
  assert.deepEqual(played.state.pendingChoice.unitIds, ['donor'])
  const resolved = applyCommand(played.state, 0, { action: 'choice.resolve', data: { choiceId: played.state.pendingChoice.id, selection: { unitId: 'donor' } } })
  const thief = resolved.state.board.find(unit => unit.card.Name === 'Собирающий жук')
  const donor = resolved.state.board.find(unit => unit.id === 'donor')
  assert.equal(thief.item.instanceId, 'item-instance')
  assert.equal(thief.attack, beetle.Attack + item.Attack)
  assert.equal(donor.item, undefined)
  assert.equal(donor.attack, 2)
  assert.equal(donor.maxHealth, 5)
  assert.equal(donor.health, 5)
  assert.equal(resolved.state.players[1].discard.length, 0)
})

test('beetle trap transfers its item to the attacker and gains three attack only when the transfer succeeds', () => {
  const match = createMatch(input)
  const beetle = turnUnit('Собирающий жук', 1, 3, 2, { attack: 3, health: 3, maxHealth: 3 })
  const item = { ...catalog[0], Name: 'Plain item', Type: 1, Attack: 1, Health: 1, Description: '', instanceId: 'trap-item' }
  beetle.item = item
  const attacker = { id: 'attacker', card: { ...catalog[1], instanceId: 'attacker-card' }, owner: 0, row: 4, col: 2, health: 10, maxHealth: 10, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  match.board.push(attacker, beetle)
  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: attacker.id, targetUnitId: beetle.id } })
  const newAttacker = result.state.board.find(unit => unit.id === attacker.id)
  const newBeetle = result.state.board.find(unit => unit.id === beetle.id)
  assert.equal(newAttacker.item.instanceId, item.instanceId)
  assert.equal(newAttacker.attack, 2)
  assert.equal(newBeetle.item, undefined)
  assert.equal(newBeetle.maxHealth, 2)
  assert.equal(newBeetle.attack, 5)
})

test('resolves player healing and lethal opponent damage from entry effects', () => {
  const healCard = { ...catalog[0], Id: 'entry-heal', Name: 'Хиро', Type: 0, Cost: 0, Description: 'Вход: Восстанавливает вам 3 здоровья.' }
  const damageCard = { ...catalog[1], Id: 'entry-damage', Name: 'Оранжевая', Type: 0, Cost: 0, Description: 'Вход: Наносит 4 урона противнику.' }
  const match = createMatch({ ...input, catalog: [...catalog, healCard, damageCard] })
  const healInstance = { ...healCard, instanceId: 'ci-entry-heal' }
  match.players[0].hand = [healInstance]
  match.players[0].health = 40
  const healed = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: healInstance.instanceId, target: { row: 4, col: 1 }, payment: 'mana' } }).state
  assert.equal(healed.players[0].health, 43)

  const damageInstance = { ...damageCard, instanceId: 'ci-entry-damage' }
  healed.players[0].played = false
  healed.players[0].hand = [damageInstance]
  healed.players[1].health = 3
  const result = applyCommand(healed, 0, { action: 'card.play', data: { cardInstanceId: damageInstance.instanceId, target: { row: 4, col: 2 }, payment: 'mana' } })
  assert.equal(result.state.players[1].health, 0)
  assert.equal(result.state.status, 'finished')
  assert.equal(result.state.winnerUserId, 'user-1')
  assert.equal(result.state.endReason, 'entry')
})

test('an entry heal creates a private choice which only an allowed unit can resolve', () => {
  const card = { ...catalog[0], Id: 'entry-heal-target', Name: 'Булка', Type: 0, Cost: 0, Description: 'Вход: Полностью восстанавливает здоровье выбранному существу.' }
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const instance = { ...card, instanceId: 'ci-entry-choice' }
  match.players[0].hand = [instance]
  match.board.push(
    { id: 'wounded', card: { ...catalog[1], Name: 'Wounded' }, owner: 0, row: 4, col: 2, health: 1, maxHealth: 4, attack: 1, speed: 0, blackTokens: 0 },
    { id: 'pink-diamond', card: { ...catalog[2], Name: 'Розовый Алмаз' }, owner: 0, row: 4, col: 3, health: 2, maxHealth: 2, attack: 0, speed: 0, blackTokens: 0 },
  )
  const played = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: instance.instanceId, target: { row: 4, col: 1 }, payment: 'mana' } })
  const choice = played.state.pendingChoice
  assert.ok(choice)
  assert.deepEqual(choice.unitIds, ['wounded', 'pink-diamond'])
  assert.equal(projectForPlayer(played.state, 0).private.pendingChoice.options[0].unitId, 'wounded')
  assert.equal(projectForPlayer(played.state, 1).private.pendingChoice, null)
  assert.equal(played.state.board[0].health, 1)

  assert.throws(() => applyCommand(played.state, 0, { action: 'turn.end', data: {} }), { code: 'CHOICE_PENDING' })
  assert.throws(() => applyCommand(played.state, 1, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: 'wounded' } } }), { code: 'NOT_CHOICE_OWNER' })
  assert.throws(() => applyCommand(played.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: 'opponent-unit' } } }), { code: 'INVALID_CHOICE' })
  const result = applyCommand(played.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: 'wounded' } } })
  assert.equal(result.state.board[0].health, 4)
  assert.equal(result.state.board[0].shield, true)
  assert.equal(result.state.pendingChoice, null)
  assert.equal(result.state.version, 2)

})

test('rejects card play outside the home row and unsupported entry effects without charging', () => {
  const match = createMatch(input)
  const card = { ...catalog[0], instanceId: 'ci-play', Description: 'Вход: Наносит урон.' }
  match.players[0].hand.push(card)
  match.players[0].mana = 5
  const before = structuredClone(match)

  assert.throws(() => applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: card.instanceId, target: { row: 3, col: 1 }, payment: 'mana' } }), { code: 'INVALID_TARGET' })
  assert.throws(() => applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: card.instanceId, target: { row: 4, col: 1 }, payment: 'mana' } }), { code: 'UNSUPPORTED_EFFECT' })
  assert.deepEqual(match, before)
})

test('applies the existing Mкия score discount when paying to place a creature', () => {
  const match = createMatch(input)
  const card = { ...catalog[0], instanceId: 'ci-discount', Cost: 2, Description: 'Счёт 1: Постоянно: +1 к атаке.' }
  match.players[0].hand.push(card, ...catalog.slice(0, 3).map((item, index) => ({ ...item, instanceId: `ci-extra-${index}` })))
  match.players[0].mana = 0
  match.players[0].nextScoreAdjustment = 1
  match.board.push({ id: 'mkiya', card: { ...catalog[1], Name: 'Мкия', Description: 'Счёт 8: Постоянно: Все карты в вашей руке стоят на 2 меньше.' }, owner: 0, row: 4, col: 0, health: 1, maxHealth: 1, attack: 1, speed: 0, summoned: 0 })

  const result = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: card.instanceId, target: { row: 4, col: 1 }, payment: 'mana' } })

  assert.equal(result.state.players[0].mana, 0)
  assert.equal(result.state.players[0].nextScoreAdjustment, 0)
  assert.equal(result.state.board.some(unit => unit.card.instanceId === card.instanceId), true)
})

test('allows health payment only for noncreatures while Империя крови is active', () => {
  const match = createMatch(input)
  const building = { ...catalog[0], instanceId: 'ci-building', Name: 'Здание', Type: 3, Cost: 2, Description: '' }
  match.players[0].hand.push(building)
  match.players[0].health = 10
  match.players[0].mana = 0
  match.board.push({ id: 'empire', card: { ...catalog[1], Name: 'Империя крови', Type: 3 }, owner: 0, row: 2, col: 0, health: 1, maxHealth: 1, attack: 0, speed: 0, summoned: 0 })

  const result = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: building.instanceId, target: { row: 2, col: 1 }, payment: 'health' } })

  assert.equal(result.state.players[0].health, 8)
  assert.equal(result.state.players[0].mana, 0)
  const creatureMatch = createMatch(input)
  const creature = { ...catalog[0], instanceId: 'ci-creature' }
  creatureMatch.players[0].hand.push(creature)
  creatureMatch.board.push({ ...match.board[0], id: 'empire', card: { ...match.board[0].card, owner: 0 } })
  assert.throws(() => applyCommand(creatureMatch, 0, { action: 'card.play', data: { cardInstanceId: creature.instanceId, target: { row: 4, col: 1 }, payment: 'health' } }), { code: 'PAYMENT_NOT_ALLOWED' })
})

test('Gloynki buffs itself and gains stats when its owner plays a card until their turn ends', () => {
  let match = createMatch(input)
  const gloynkiCard = { ...realCatalog.find(card => card.Name === 'Глойньки'), instanceId: 'gloynki-hand' }
  const building = { ...realCatalog.find(card => card.Type === 3), instanceId: 'building-hand' }
  match.players[0].hand.push(gloynkiCard, building)
  match.players[0].mana = 20

  match = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: gloynkiCard.instanceId, target: { row: 4, col: 1 }, payment: 'mana' } }).state
  let gloynki = match.board.find(unit => unit.card.Name === 'Глойньки')
  assert.deepEqual([gloynki.attack, gloynki.health, gloynki.maxHealth, gloynki.cardPlayBuffs], [2, 2, 2, 1])

  match = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: building.instanceId, target: { row: 1, col: 1 }, payment: 'mana' } }).state
  gloynki = match.board.find(unit => unit.card.Name === 'Глойньки')
  assert.deepEqual([gloynki.attack, gloynki.health, gloynki.maxHealth, gloynki.cardPlayBuffs], [3, 3, 3, 2])

  match = applyCommand(match, 0, { action: 'turn.end', data: {} }).state
  gloynki = match.board.find(unit => unit.card.Name === 'Глойньки')
  assert.deepEqual([gloynki.attack, gloynki.health, gloynki.maxHealth, gloynki.cardPlayBuffs], [1, 1, 1, 0])
})

test('External Paradise queues private creature choices for its owner after an enemy creature play', () => {
  const match = createMatch(input)
  const card = { ...catalog[0], instanceId: 'ci-trigger' }
  match.players[0].hand.push(card)
  match.board.push(
    turnUnit('Внешний рай', 1, 1, 0),
    { id: 'ally-one', card: { ...catalog[0], Name: 'Ally One' }, owner: 1, row: 0, col: 0, health: 1, maxHealth: 1, attack: 1, speed: 1 },
    { id: 'ally-two', card: { ...catalog[0], Name: 'Ally Two' }, owner: 1, row: 0, col: 1, health: 1, maxHealth: 1, attack: 1, speed: 1 },
    { ...turnUnit('Внешний рай', 1, 1, 1), id: 'paradise-two' },
  )

  let state = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: card.instanceId, target: { row: 4, col: 1 }, payment: 'mana' } }).state
  assert.equal(state.pendingChoice.kind, 'paradise-target')
  assert.equal(state.pendingChoice.owner, 1)
  assert.deepEqual(projectForPlayer(state, 0).private.pendingChoice, null)
  assert.deepEqual(projectForPlayer(state, 1).private.pendingChoice.options.map(option => option.unitId), ['ally-one', 'ally-two'])
  assert.equal(state.queuedChoices.length, 1)
  const firstChoiceId = state.pendingChoice.id
  assert.throws(() => applyCommand(state, 0, { action: 'choice.resolve', data: { choiceId: firstChoiceId, selection: { unitId: 'ally-one' } } }), { code: 'NOT_CHOICE_OWNER' })
  assert.throws(() => applyCommand(state, 1, { action: 'choice.resolve', data: { choiceId: firstChoiceId, selection: { unitId: 'unit_1' } } }), { code: 'INVALID_CHOICE' })

  state = applyCommand(state, 1, { action: 'choice.resolve', data: { choiceId: firstChoiceId, selection: { unitId: 'ally-one' } } }).state
  assert.equal(state.board.find(unit => unit.id === 'ally-one').energyCostReduction, 1)
  assert.equal(effectiveUnitSpeed(state.board.find(unit => unit.id === 'ally-one')), 1)
  assert.equal(projectForPlayer(state, 1).public.board.find(unit => unit.id === 'ally-one').energyCostReduction, 1)
  assert.equal(state.pendingChoice.kind, 'paradise-target')
  state = applyCommand(state, 1, { action: 'choice.resolve', data: { choiceId: state.pendingChoice.id, selection: { unitId: 'ally-two' } } }).state
  assert.equal(state.board.find(unit => unit.id === 'ally-two').energyCostReduction, 1)
  assert.equal(state.pendingChoice, null)
})

test('attacks an adjacent enemy and resolves its ordinary counterattack once', () => {
  const match = createMatch(input)
  match.board.push(
    { id: 'attacker', card: { ...catalog[0], Name: 'Attacker' }, owner: 0, row: 4, col: 2, health: 7, maxHealth: 7, attack: 3, speed: 1, summoned: 0, attacks: 0 },
    { id: 'defender', card: { ...catalog[1], Name: 'Defender' }, owner: 1, row: 3, col: 2, health: 6, maxHealth: 6, attack: 2, speed: 1, summoned: 0, attacks: 0 },
  )

  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'defender' } })

  assert.equal(result.state.board.find(unit => unit.id === 'defender').health, 3)
  assert.equal(result.state.board.find(unit => unit.id === 'attacker').health, 5)
  assert.equal(result.state.board.find(unit => unit.id === 'attacker').attacks, 1)
  assert.equal(result.state.version, 1)
  assert.deepEqual(result.events, [{ type: 'unit.attacked', attackerUnitId: 'attacker', targetUnitId: 'defender' }])
  assert.equal(match.board.find(unit => unit.id === 'defender').health, 6)
})

test('PGM Peridot keeps a lethal target flipped until the target owner ends two turns', () => {
  const match = createMatch(input)
  match.board.push(
    { id: 'pgm', card: { ...catalog[0], Name: 'PGM Peridot', Description: 'Досягаемость Порыв' }, owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 3, speed: 3, summoned: 0, attacks: 0 },
    { id: 'target', card: { ...catalog[1], Name: 'Target', Type: 0 }, owner: 1, row: 3, col: 2, health: 3, maxHealth: 3, attack: 0, speed: 0, summoned: 0, attacks: 0 },
  )

  const attacked = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'pgm', targetUnitId: 'target' } }).state
  const markedTarget = attacked.board.find(unit => unit.id === 'target')
  assert.deepEqual(markedTarget && [markedTarget.health, markedTarget.flippedTurns], [0, 2])
  assert.equal(attacked.players[1].discard.some(card => card.Name === 'Target'), false)

  const firstEnd = applyCommand(attacked, 0, { action: 'turn.end', data: { option: 'no_penalty' } }).state
  const secondEnd = applyCommand(firstEnd, 1, { action: 'turn.end', data: { option: 'no_penalty' } }).state
  assert.deepEqual([secondEnd.board.find(unit => unit.id === 'target').health, secondEnd.board.find(unit => unit.id === 'target').flippedTurns], [0, 1])
  const thirdEnd = applyCommand(secondEnd, 0, { action: 'turn.end', data: { option: 'no_penalty' } }).state
  const fourthEnd = applyCommand(thirdEnd, 1, { action: 'turn.end', data: { option: 'no_penalty' } }).state

  assert.equal(fourthEnd.board.some(unit => unit.id === 'target'), false)
  assert.equal(fourthEnd.players[1].discard.some(card => card.Name === 'Target'), true)
})

test('a card that keeps its flip counters at owner turn end does not tick down', () => {
  const match = createMatch(input)
  match.board.push({ id: 'steady', card: { ...catalog[0], Name: 'Steady', Description: 'Постоянно: Не сбрасывает жетоны переворота в конце вашего хода.' }, owner: 0, row: 4, col: 0, health: 2, maxHealth: 2, attack: 1, speed: 1, flippedTurns: 2, summoned: 0, attacks: 0 })

  const result = applyCommand(match, 0, { action: 'turn.end', data: { option: 'no_penalty' } })

  assert.equal(result.state.board.find(unit => unit.id === 'steady').flippedTurns, 2)
})

test('a supported death trigger damages the opposing player before removing the creature', () => {
  const match = createMatch(input)
  match.board.push(
    { id: 'attacker', card: { ...catalog[0], Name: 'Attacker' }, owner: 0, row: 4, col: 2, health: 7, maxHealth: 7, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'bomber', card: { ...catalog[1], Name: 'Подрывник' }, owner: 1, row: 3, col: 2, health: 2, maxHealth: 2, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  match.players[0].health = 3

  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'bomber' } })

  assert.equal(result.state.players[0].health, 0)
  assert.equal(result.state.players[1].health, 45)
  assert.equal(result.state.status, 'finished')
  assert.equal(result.state.winnerUserId, 'user-2')
  assert.equal(result.state.endReason, 'death')
  assert.equal(result.state.board.some(unit => unit.id === 'bomber'), false)
})

test('a supported death heal restores its owner up to the health cap', () => {
  const match = createMatch(input)
  match.board.push(
    { id: 'attacker', card: { ...catalog[0], Name: 'Attacker' }, owner: 0, row: 4, col: 2, health: 7, maxHealth: 7, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'armadillo', card: { ...catalog[1], Name: 'Броненосец' }, owner: 1, row: 3, col: 2, health: 2, maxHealth: 2, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  match.players[1].health = 44

  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'armadillo' } })

  assert.equal(result.state.players[1].health, 45)
  assert.equal(result.state.status, 'active')
})

test('a supported crown draw resolves after the attack and draws from the attacker deck', () => {
  const match = createMatch(input)
  match.board.push(
    { id: 'attacker', card: { ...catalog[0], Name: 'Минт', Description: 'Порыв\nКоронный: Возьмите карту' }, owner: 0, row: 4, col: 2, health: 7, maxHealth: 7, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'defender', card: { ...catalog[1], Name: 'Defender' }, owner: 1, row: 3, col: 2, health: 6, maxHealth: 6, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const initialHand = match.players[0].hand.length
  const initialDeck = match.players[0].deck.length

  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'defender' } })

  assert.equal(result.state.players[0].hand.length, initialHand + 1)
  assert.equal(result.state.players[0].deck.length, initialDeck - 1)
  assert.equal(result.state.version, 1)
})

test('Джон Фараон destroys the attacked creature through its crown effect', () => {
  const match = createMatch(input)
  match.board.push(
    { id: 'pharaoh', card: { ...catalog[0], Name: 'Джон Фараон', Description: 'Коронный: Убивает существо.' }, owner: 0, row: 4, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'target', card: { ...catalog[1], Name: 'Target', Description: '' }, owner: 1, row: 3, col: 2, health: 5, maxHealth: 5, attack: 0, speed: 0, summoned: 0, attacks: 0, blackTokens: 0 },
  )

  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'pharaoh', targetUnitId: 'target' } })

  assert.equal(result.state.board.some(unit => unit.id === 'target'), false)
  assert.equal(result.state.players[1].discard.some(card => card.Name === 'Target'), true)
})

test('Джон Фараон can attack the player when its crown has no creature target', () => {
  const match = createMatch(input)
  match.board.push({ id: 'pharaoh', card: { ...catalog[0], Name: 'Джон Фараон', Description: 'Коронный: Убивает существо.' }, owner: 0, row: 0, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })

  const result = applyCommand(match, 0, { action: 'unit.attackPlayer', data: { unitId: 'pharaoh' } })

  assert.equal(result.state.players[1].health, 44)
  assert.equal(result.state.board.some(unit => unit.id === 'pharaoh'), true)
})

test('Джон Фараон does not commit a crown kill with an unsupported death effect', () => {
  const match = createMatch(input)
  match.board.push(
    { id: 'pharaoh', card: { ...catalog[0], Name: 'Джон Фараон', Description: 'Коронный: Убивает существо.' }, owner: 0, row: 4, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'target', card: { ...catalog[1], Name: 'Target', Description: 'Посмертно: Удаляет все карты.' }, owner: 1, row: 3, col: 2, health: 5, maxHealth: 5, attack: 0, speed: 0, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const before = structuredClone(match)

  assert.throws(() => applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'pharaoh', targetUnitId: 'target' } }), { code: 'UNSUPPORTED_EFFECT' })
  assert.deepEqual(match, before)
})

test('a crown kill does not activate a trap on a card that was already flipped', () => {
  const match = createMatch(input)
  match.board.push(
    { id: 'pharaoh', card: { ...catalog[0], Name: 'Жёлтый алмаз', Description: 'Досягаемость' }, item: { ...catalog[1], Name: 'Джон Фараон', Type: 1, Description: 'Коронный: Убивает существо.' }, owner: 0, row: 4, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'mine', card: { ...catalog[1], Name: 'Мина', Description: 'Ловушка: Наносит 5 урона.' }, owner: 1, row: 3, col: 2, health: 5, maxHealth: 5, attack: 0, speed: 0, summoned: 0, attacks: 0, blackTokens: 0, flippedTurns: 1 },
  )

  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'pharaoh', targetUnitId: 'mine' } })

  assert.equal(result.state.board.some(unit => unit.id === 'mine'), false)
  assert.equal(result.state.board.some(unit => unit.id === 'pharaoh'), true)
})

test('simple crown resource, health, and damage effects resolve on attacks', () => {
  const cases = [
    { name: 'Игла', description: 'Коронный: Получает 1⚫.', expected: state => state.board.find(unit => unit.id === 'attacker').blackTokens === 1 },
    { name: 'Гвоздь грёз', description: 'Коронный: Вы получаете 3 маны.', expected: state => state.players[0].mana === 4 },
    { name: 'Рагна', description: 'Коронный: Восстанавливает себе 3 здоровья.', expected: state => state.board.find(unit => unit.id === 'attacker').health === 7, health: 5 },
    { name: 'Оранжевая', description: 'Коронный: Наносит 1 урона противнику.', expected: state => state.players[1].health === 44 },
  ]
  for (const card of cases) {
    const match = createMatch(input)
    match.board.push(
      { id: 'attacker', card: { ...catalog[0], Name: card.name, Description: card.description }, owner: 0, row: 4, col: 2, health: card.health ?? 7, maxHealth: 7, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
      { id: 'defender', card: { ...catalog[1], Name: 'Defender' }, owner: 1, row: 3, col: 2, health: 6, maxHealth: 6, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    )
    const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'defender' } })
    assert.ok(card.expected(result.state), card.name)
  }
})

test('supported crown effects also resolve on direct attacks against a player', () => {
  const match = createMatch(input)
  match.board.push({ id: 'attacker', card: { ...catalog[0], Name: 'Минт', Description: 'Порыв\nКоронный: Возьмите карту' }, owner: 0, row: 0, col: 2, health: 7, maxHealth: 7, attack: 2, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })
  const initialHand = match.players[0].hand.length
  const result = applyCommand(match, 0, { action: 'unit.attackPlayer', data: { unitId: 'attacker' } })
  assert.equal(result.state.players[1].health, 43)
  assert.equal(result.state.players[0].hand.length, initialHand + 1)
})

test('a mixed crown line stays rejected without committing partial effects', () => {
  const match = createMatch(input)
  match.board.push(
    { id: 'attacker', card: { ...catalog[0], Name: 'Дюп', Description: 'Коронный: Увеличивает лимит карт на 1 а так же получает 1 ⚫ и наносит 2 урона врагу.' }, owner: 0, row: 4, col: 2, health: 7, maxHealth: 7, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'defender', card: { ...catalog[1], Name: 'Defender' }, owner: 1, row: 3, col: 2, health: 6, maxHealth: 6, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const before = structuredClone(match)
  assert.throws(() => applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'defender' } }), { code: 'UNSUPPORTED_EFFECT' })
  assert.deepEqual(match, before)
})

test('simple traps damage the attacking unit or its player', () => {
  const cases = [
    { name: 'Мина', description: 'Ловушка: Наносит 5 урона.', attackerHealth: 5, verify: result => !result.state.board.some(unit => unit.id === 'attacker') && result.state.players[0].discard.some(card => card.Name === 'Attacker') },
    { name: 'Оранжевая', description: 'Ловушка: Наносит 2 урона противнику.', attackerHealth: 7, verify: result => result.state.players[0].health === 43 && result.state.board.some(unit => unit.id === 'attacker') },
    { name: 'Оранжевая', description: 'Ловушка: Наносит 2 урона противнику.', attackerHealth: 7, playerHealth: 2, verify: result => result.state.status === 'finished' && result.state.winnerUserId === 'user-2' },
    { name: 'Джон совиный дом', description: 'Ловушка: Нападавший становится вашим существом.', attackerHealth: 7, verify: result => result.state.board.find(unit => unit.id === 'attacker').owner === 1 },
  ]
  for (const trap of cases) {
    const match = createMatch(input)
    match.board.push(
      { id: 'attacker', card: { ...catalog[0], Name: 'Attacker' }, owner: 0, row: 4, col: 2, health: trap.attackerHealth, maxHealth: 7, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
      { id: 'trap', card: { ...catalog[1], Name: trap.name, Description: trap.description }, owner: 1, row: 3, col: 2, health: 20, maxHealth: 20, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    )
    if (trap.playerHealth) match.players[0].health = trap.playerHealth
    const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'trap' } })
    assert.ok(trap.verify(result), trap.name)
  }
})

test('unsupported traps still reject the attack without changing the match', () => {
  const match = createMatch(input)
  match.board.push(
    { id: 'attacker', card: { ...catalog[0], Name: 'Attacker' }, owner: 0, row: 4, col: 2, health: 7, maxHealth: 7, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'trap', card: { ...catalog[1], Name: 'Собирающий жук', Description: 'Ловушка: Отдаёт предмет нападавшему, а так же получает +3 к атаке.' }, owner: 1, row: 3, col: 2, health: 20, maxHealth: 20, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const before = structuredClone(match)
  assert.throws(() => applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'trap' } }), { code: 'UNSUPPORTED_EFFECT' })
  assert.deepEqual(match, before)
})

test('a destroy-attacker trap joins the normal death and discard resolution', () => {
  const match = createMatch(input)
  match.board.push(
    { id: 'attacker', card: { ...catalog[0], Name: 'Attacker' }, owner: 0, row: 4, col: 2, health: 7, maxHealth: 7, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'trap', card: { ...catalog[1], Name: 'Кекич', Description: 'Ловушка: Убивает атакующее существо.' }, owner: 1, row: 3, col: 2, health: 20, maxHealth: 20, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'trap' } })
  assert.equal(result.state.board.some(unit => unit.id === 'attacker'), false)
  assert.ok(result.state.players[0].discard.some(card => card.Name === 'Attacker'))
  assert.equal(result.state.version, 1)
})

test('rejects an out-of-range attack and an exhausted attacker without changing state', () => {
  const match = createMatch(input)
  match.board.push(
    { id: 'attacker', card: { ...catalog[0] }, owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 2, speed: 1, summoned: 0, attacks: 1 },
    { id: 'defender', card: { ...catalog[1] }, owner: 1, row: 2, col: 2, health: 5, maxHealth: 5, attack: 2, speed: 1, summoned: 0 },
  )
  const before = structuredClone(match)

  assert.throws(() => applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'defender' } }), { code: 'ATTACKS_EXHAUSTED' })
  assert.throws(() => applyCommand({ ...match, board: match.board.map(unit => unit.id === 'attacker' ? { ...unit, attacks: 0 } : unit) }, 0, { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'defender' } }), { code: 'OUT_OF_RANGE' })
  assert.deepEqual(match, before)
})

test('attacks the opponent directly from their home row and applies the card attack limit', () => {
  const match = createMatch(input)
  match.board.push({ id: 'attacker', card: { ...catalog[0], Name: 'Attacker' }, owner: 0, row: 0, col: 2, health: 5, maxHealth: 5, attack: 4, speed: 1, summoned: 0, attacks: 0 })
  const result = applyCommand(match, 0, { action: 'unit.attackPlayer', data: { unitId: 'attacker' } })
  assert.equal(result.state.players[1].health, 41)
  assert.equal(result.state.board[0].attacks, 1)
  assert.equal(result.state.version, 1)
  assert.deepEqual(result.events, [{ type: 'player.attacked', attackerUnitId: 'attacker', targetSeat: 1, damage: 4 }])
})

test('rejects direct player attacks outside the opponent home row and from restricted cards', () => {
  const match = createMatch(input)
  match.board.push({ id: 'attacker', card: { ...catalog[0] }, owner: 0, row: 1, col: 2, health: 5, maxHealth: 5, attack: 2, speed: 1, summoned: 0, attacks: 0 })
  assert.throws(() => applyCommand(match, 0, { action: 'unit.attackPlayer', data: { unitId: 'attacker' } }), { code: 'INVALID_TARGET' })
  match.board[0].row = 0
  match.board[0].card.Name = 'ПатрикNope'
  assert.throws(() => applyCommand(match, 0, { action: 'unit.attackPlayer', data: { unitId: 'attacker' } }), { code: 'INVALID_TARGET' })
  assert.equal(match.players[1].health, 45)
})

test('Обсидиан пчёла ability kills itself and damages only active orthogonal creatures', () => {
  const match = createMatch(input)
  const bee = { ...catalog[0], Id: 'obsidian-bee', Name: 'Обсидиан пчёла', Description: 'Способность 0⭐: Умирает\nПосмертно: Наносит 2 урона существам рядом.' }
  match.round = 2
  match.board.push(
    { id: 'bee', card: bee, owner: 0, row: 2, col: 2, health: 1, maxHealth: 1, attack: 1, speed: 1, blackTokens: 0, summoned: 1 },
    { id: 'adjacent', card: { ...catalog[1], Name: 'Adjacent creature', Description: '' }, owner: 1, row: 2, col: 1, health: 2, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0 },
    { id: 'diagonal', card: { ...catalog[2], Name: 'Diagonal creature', Description: '' }, owner: 1, row: 1, col: 1, health: 1, maxHealth: 1, attack: 1, speed: 1, blackTokens: 0 },
    { id: 'flipped', card: { ...catalog[3], Name: 'Flipped creature', Description: '' }, owner: 1, row: 2, col: 3, health: 1, maxHealth: 1, attack: 1, speed: 1, blackTokens: 0, flippedTurns: 1 },
    { id: 'building', card: { ...catalog[4], Name: 'Building', Type: 3, Description: '' }, owner: 1, row: 1, col: 2, health: 3, maxHealth: 3, attack: 0, speed: 0, blackTokens: 0 },
  )

  const result = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'bee', abilityIndex: 0 } })
  assert.deepEqual(result.state.board.map(unit => [unit.id, unit.health]), [['diagonal', 1], ['flipped', 1], ['building', 3]])
  assert.equal(result.state.players[0].discard.some(card => card.Name === 'Обсидиан пчёла'), true)
  assert.equal(result.state.version, 1)
})

test('Обсидиан пчёла rejects an unsupported chained death before committing its ability', () => {
  const match = createMatch(input)
  const bee = { ...catalog[0], Id: 'obsidian-bee', Name: 'Обсидиан пчёла', Description: 'Способность 0⭐: Умирает\nПосмертно: Наносит 2 урона существам рядом.' }
  match.round = 2
  match.board.push(
    { id: 'bee', card: bee, owner: 0, row: 2, col: 2, health: 1, maxHealth: 1, attack: 1, speed: 1, blackTokens: 0, summoned: 1 },
    { id: 'unsupported', card: { ...catalog[1], Name: 'Unsupported death', Description: 'Посмертно: unknown effect' }, owner: 1, row: 2, col: 1, health: 2, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0 },
  )

  assert.throws(() => applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'bee', abilityIndex: 0 } }), { code: 'UNSUPPORTED_EFFECT' })
  assert.deepEqual(match.board.map(unit => unit.id), ['bee', 'unsupported'])
  assert.equal(match.version, 0)
})

test('uses a supported repeatable ability and pays its resource once', () => {
  const match = createMatch(input)
  match.players[0].mana = 1
  match.board.push({ id: 'bank', card: { ...catalog[0], Name: 'Банк ум', Description: 'Способность 1⭐🔁: Получает 1⚫.' }, owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 0, summoned: 0, blackTokens: 0, abilityUsed: false })
  const result = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'bank', abilityIndex: 0 } })
  assert.equal(result.state.players[0].mana, 0)
  assert.equal(result.state.board[0].blackTokens, 1)
  assert.equal(result.state.board[0].abilityUsed, false)
  assert.equal(result.state.version, 1)
})

test('does not charge for unsupported or unaffordable abilities', () => {
  const match = createMatch(input)
  match.board.push({ id: 'unit', card: { ...catalog[0], Name: 'Карта', Description: 'Способность 3⭐: Наносит 2 урона выбранному существу.' }, owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 0, summoned: 0, abilityUsed: false })
  assert.throws(() => applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'unit', abilityIndex: 0 } }), { code: 'UNSUPPORTED_EFFECT' })
  assert.equal(match.players[0].mana, 1)
  match.board[0].card.Description = 'Способность 3⭐: Получает щит.'
  assert.throws(() => applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'unit', abilityIndex: 0 } }), { code: 'NOT_ENOUGH_MANA' })
  assert.equal(match.board[0].shield, undefined)
})

test('a targeted heal ability creates a private paid choice and resolves once', () => {
  const match = createMatch(input)
  match.players[0].mana = 3
  match.board.push(
    { id: 'rosa', card: { ...catalog[0], Name: 'Роза Кварц', Description: 'Способность 3: Восстанавливает выбранному существу 3 здоровья и даёт щит.' }, owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'wounded', card: { ...catalog[1], Name: 'Wounded' }, owner: 1, row: 3, col: 2, health: 1, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  assert.throws(() => applyCommand(match, 1, { action: 'ability.use', data: { unitId: 'rosa', abilityIndex: 0 } }), { code: 'NOT_YOUR_TURN' })

  const used = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'rosa', abilityIndex: 0 } })
  const choice = used.state.pendingChoice
  assert.ok(choice)
  assert.deepEqual(used.events, [{ type: 'ability.used', unitId: 'rosa', abilityIndex: 0 }])
  assert.equal(used.state.players[0].mana, 0)
  assert.equal(used.state.board.find(unit => unit.id === 'rosa').abilityUsed, true)
  assert.deepEqual(choice.unitIds, ['rosa', 'wounded'])
  assert.ok(projectForPlayer(used.state, 0).private.pendingChoice.options.some(option => option.unitId === 'wounded'))
  assert.equal(projectForPlayer(used.state, 1).private.pendingChoice, null)
  assert.throws(() => applyCommand(used.state, 0, { action: 'turn.end', data: {} }), { code: 'CHOICE_PENDING' })

  const result = applyCommand(used.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: 'wounded' } } })
  assert.equal(result.state.board.find(unit => unit.id === 'wounded').health, 4)
  assert.equal(result.state.board.find(unit => unit.id === 'wounded').shield, true)
  assert.equal(result.state.pendingChoice, null)
  assert.equal(result.state.version, 2)
})

test('Pudge pays once and moves a selected creature to its forward socket', () => {
  const match = createMatch(input)
  match.players[0].mana = 4
  match.board.push(
    { id: 'pudge', card: { ...catalog[0], Name: 'Пудж', Description: 'Способность 4: Переносит выбранное существо в сокет перед собой.' }, owner: 0, row: 3, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'target', card: { ...catalog[1], Name: 'Target' }, owner: 1, row: 4, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const used = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'pudge', abilityIndex: 0 } })
  const choice = used.state.pendingChoice
  assert.equal(used.state.players[0].mana, 0)
  assert.deepEqual(choice.unitIds, ['pudge', 'target'])
  assert.equal(projectForPlayer(used.state, 1).private.pendingChoice, null)

  const result = applyCommand(used.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: 'target' } } })
  assert.deepEqual([result.state.board.find(unit => unit.id === 'target').row, result.state.board.find(unit => unit.id === 'target').col], [2, 2])
  assert.equal(result.state.pendingChoice, null)
  assert.equal(result.state.version, 2)

  const blocked = createMatch(input)
  blocked.players[0].mana = 4
  blocked.board.push(
    { id: 'pudge', card: { ...catalog[0], Name: 'Пудж', Description: 'Способность 4: Переносит выбранное существо в сокет перед собой.' }, owner: 0, row: 3, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'target', card: { ...catalog[1], Name: 'Target' }, owner: 1, row: 4, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'blocker', card: { ...catalog[2], Name: 'Blocker' }, owner: 1, row: 2, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  assert.throws(() => applyCommand(blocked, 0, { action: 'ability.use', data: { unitId: 'pudge', abilityIndex: 0 } }), { code: 'INVALID_TARGET' })
  assert.equal(blocked.players[0].mana, 4)
})

test('Abrams pays for a private move-to-cell choice and stuns adjacent creatures', () => {
  const match = createMatch(input)
  match.players[0].mana = 5
  match.board.push(
    { id: 'abrams', card: { ...catalog[0], Name: 'Абрамс', Description: 'Способность 5: Переноситься на выбранный сокет, все существа вокруг получают оглушение 1.' }, owner: 0, row: 4, col: 2, health: 6, maxHealth: 6, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'nearby', card: { ...catalog[1], Name: 'Nearby' }, owner: 1, row: 2, col: 3, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'far', card: { ...catalog[2], Name: 'Far' }, owner: 1, row: 0, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const used = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'abrams', abilityIndex: 0 } })
  const choice = used.state.pendingChoice
  assert.equal(used.state.players[0].mana, 0)
  assert.equal(choice.kind, 'ability-move-self')
  assert.ok(projectForPlayer(used.state, 0).private.pendingChoice.cells.some(cell => cell.row === 2 && cell.col === 2))
  assert.equal(projectForPlayer(used.state, 1).private.pendingChoice, null)
  assert.throws(() => applyCommand(used.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { cell: { row: 4, col: 2 } } } }), { code: 'INVALID_CHOICE' })

  const moved = applyCommand(used.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { cell: { row: 2, col: 2 } } } })
  assert.deepEqual([moved.state.board.find(unit => unit.id === 'abrams').row, moved.state.board.find(unit => unit.id === 'abrams').col], [2, 2])
  assert.equal(moved.state.board.find(unit => unit.id === 'abrams').abilityUsed, true)
  assert.equal(moved.state.board.find(unit => unit.id === 'nearby').stunned, 1)
  assert.equal(moved.state.board.find(unit => unit.id === 'far').stunned ?? 0, 0)
  assert.equal(moved.state.version, 2)
})

test('Abrams movement ability activates the same Doggo and Turret triggers as normal movement', () => {
  const match = createMatch(input)
  match.players[0].mana = 5
  match.board.push(
    { id: 'abrams', card: { ...catalog[0], Name: 'Абрамс', Description: 'Способность 5 Переноситься на выбранный сокет, все существа вокруг получают оглушение 1.' }, owner: 0, row: 4, col: 2, health: 7, maxHealth: 7, attack: 2, speed: 2, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'doggo', card: { ...catalog[1], Name: 'Догго' }, owner: 1, row: 0, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'turret', card: { ...catalog[2], Name: 'Турель', Type: 3 }, owner: 1, row: 1, col: 2, health: 4, maxHealth: 4, attack: 0, speed: 0, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const used = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'abrams', abilityIndex: 0 } })
  const moved = applyCommand(used.state, 0, { action: 'choice.resolve', data: { choiceId: used.state.pendingChoice.id, selection: { cell: { row: 2, col: 2 } } } })
  assert.equal(moved.state.board.find(unit => unit.id === 'abrams').health, 5)
  assert.equal(moved.state.board.find(unit => unit.id === 'doggo').attack, 2)
  assert.equal(moved.state.board.find(unit => unit.id === 'doggo').maxHealth, 4)
})

test('Tonatiy pays once for a private creature swap and exchanges positions', () => {
  const match = createMatch(input)
  match.players[0].mana = 5
  match.board.push(
    { id: 'tonatiy', card: { ...catalog[0], Name: 'Тонатий', Description: 'Способность 2: Меняеться местами с выбранным существом.' }, owner: 0, row: 4, col: 2, health: 6, maxHealth: 6, attack: 1, speed: 1, summoned: 0, attacks: 0 },
    { id: 'target', card: { ...catalog[1], Name: 'Target' }, owner: 1, row: 2, col: 3, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0 },
  )
  const used = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'tonatiy', abilityIndex: 0 } })
  const choice = used.state.pendingChoice
  assert.equal(used.state.players[0].mana, 3)
  assert.equal(choice.kind, 'ability-swap-self')
  assert.deepEqual(choice.unitIds, ['target'])
  assert.equal(projectForPlayer(used.state, 1).private.pendingChoice, null)
  const result = applyCommand(used.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: 'target' } } })
  assert.deepEqual([result.state.board.find(unit => unit.id === 'tonatiy').row, result.state.board.find(unit => unit.id === 'tonatiy').col], [2, 3])
  assert.deepEqual([result.state.board.find(unit => unit.id === 'target').row, result.state.board.find(unit => unit.id === 'target').col], [4, 2])
  assert.equal(result.state.version, 2)
})

test('Needle pays once for three private damage targets and resolves lethal damage once', () => {
  const match = createMatch(input)
  const needleDescription = 'Ярость\nСпособность 2⚫: Нанесите 2 урона трём выбранным разным целям.\nСпособность 2⚫: Восстановите 2 здоровья трём выбранным разным целя.'
  match.board.push(
    { id: 'needle', card: { ...catalog[0], Name: 'Игла', Description: needleDescription }, owner: 0, row: 4, col: 2, health: 6, maxHealth: 6, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 2 },
    { id: 'wounded', card: { ...catalog[1], Name: 'Wounded' }, owner: 1, row: 3, col: 2, health: 3, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'lethal', card: { ...catalog[2], Name: 'Lethal' }, owner: 1, row: 3, col: 1, health: 1, maxHealth: 1, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'building', card: { ...catalog[3], Name: 'Building', Type: 3 }, owner: 1, row: 2, col: 2, health: 3, maxHealth: 3, attack: 0, speed: 0, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const used = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'needle', abilityIndex: 0 } })
  const choice = used.state.pendingChoice
  assert.equal(used.state.board.find(unit => unit.id === 'needle').blackTokens, 0)
  assert.equal(choice.kind, 'ability-damage-targets')
  assert.equal(choice.count, 3)
  assert.equal(projectForPlayer(used.state, 1).private.pendingChoice, null)
  assert.throws(() => applyCommand(used.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: ['wounded', 'wounded', 'lethal'] } } }), { code: 'INVALID_CHOICE' })
  assert.equal(used.state.version, 1)
  const result = applyCommand(used.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: ['wounded', 'lethal', 'building'] } } })
  assert.equal(result.state.board.find(unit => unit.id === 'wounded').health, 1)
  assert.equal(result.state.board.some(unit => unit.id === 'lethal'), false)
  assert.equal(result.state.players[1].discard.some(card => card.Name === 'Lethal'), true)
  assert.equal(result.state.board.find(unit => unit.id === 'building').health, 1)
  assert.equal(result.state.pendingChoice, null)
  assert.equal(result.state.version, 2)
})

test('Needle resolves three distinct healing targets', () => {
  const match = createMatch(input)
  const description = 'Способность 2⚫: Восстановите 2 здоровья трём выбранным разным целя.'
  match.board.push(
    { id: 'needle', card: { ...catalog[0], Name: 'Игла', Description: description }, owner: 0, row: 4, col: 2, health: 6, maxHealth: 6, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 2 },
    ...['one', 'two', 'three'].map((id, index) => ({ id, card: { ...catalog[index + 1], Name: id }, owner: index === 0 ? 0 : 1, row: index ? 3 : 4, col: index, health: 1, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })),
  )
  const used = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'needle', abilityIndex: 0 } })
  const choice = used.state.pendingChoice
  const result = applyCommand(used.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: ['one', 'two', 'three'] } } })
  assert.deepEqual(result.state.board.filter(unit => ['one', 'two', 'three'].includes(unit.id)).map(unit => unit.health), [3, 3, 3])
  assert.equal(result.state.board.find(unit => unit.id === 'needle').blackTokens, 0)
})

test('Suzy pays once, privately selects a damageable card, and resolves its death', () => {
  const match = createMatch(input)
  match.players[0].mana = 5
  match.board.push(
    { id: 'suzy', card: { ...catalog[0], Name: 'Сьюзи', Description: 'Способность 5: Наносит 8 урона выбранной цели.' }, owner: 0, row: 4, col: 2, health: 4, maxHealth: 4, attack: 7, speed: 2, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'target', card: { ...catalog[1], Name: 'Target' }, owner: 1, row: 3, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const used = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'suzy', abilityIndex: 0 } })
  const choice = used.state.pendingChoice
  assert.equal(used.state.players[0].mana, 0)
  assert.equal(choice.kind, 'ability-damage-target')
  assert.deepEqual(choice.unitIds, ['target'])
  assert.equal(choice.playerTarget, false)
  assert.equal(projectForPlayer(used.state, 1).private.pendingChoice, null)

  const result = applyCommand(used.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: 'target' } } })
  assert.equal(result.state.board.some(unit => unit.id === 'target'), false)
  assert.equal(result.state.players[1].discard.some(card => card.Name === 'Target'), true)
  assert.equal(result.state.board.find(unit => unit.id === 'suzy').abilityUsed, true)
  assert.equal(result.state.version, 2)
})

test('Suzy can choose opponent health only from the opponent home row', () => {
  const match = createMatch(input)
  match.players[0].mana = 5
  match.players[1].health = 8
  match.board.push({ id: 'suzy', card: { ...catalog[0], Name: 'Сьюзи', Description: 'Способность 5: Наносит 8 урона выбранной цели.' }, owner: 0, row: 0, col: 2, health: 4, maxHealth: 4, attack: 7, speed: 2, summoned: 0, attacks: 0, blackTokens: 0 })
  const used = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'suzy', abilityIndex: 0 } })
  const choice = used.state.pendingChoice
  assert.equal(choice.playerTarget, true)
  assert.deepEqual(choice.unitIds, [])
  const outOfPosition = structuredClone(used.state)
  outOfPosition.board.find(unit => unit.id === 'suzy').row = 4
  assert.throws(() => applyCommand(outOfPosition, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { player: 'opponent' } } }), { code: 'INVALID_CHOICE' })

  const result = applyCommand(used.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { player: 'opponent' } } })
  assert.equal(result.state.players[1].health, 0)
  assert.equal(result.state.status, 'finished')
  assert.equal(result.state.winnerUserId, 'user-1')
  assert.equal(result.state.version, 2)
})

test('Backstage ability moves its selected creature and item to the correct piles', () => {
  const match = createMatch(input)
  match.players[0].mana = 5
  const building = { ...catalog[0], instanceId: 'backstage-card', Name: 'Закулисье', Description: 'Способность 5⭐: Выбранное существо отправляется наверх КД владельца.', Type: 3, Health: 4, Cost: 2 }
  const creature = { ...catalog[1], instanceId: 'target-card', Name: 'Target' }
  const item = { ...catalog[2], instanceId: 'target-item', Name: 'Target item', Type: 1 }
  match.board.push(
    { id: 'backstage', card: building, owner: 0, row: 2, col: 2, health: 4, maxHealth: 4, attack: 0, speed: 0, summoned: 0, attacks: 0, blackTokens: 5 },
    { id: 'target', card: creature, item, owner: 1, row: 3, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const used = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'backstage', abilityIndex: 0 } })
  const choice = used.state.pendingChoice
  assert.equal(used.state.players[0].mana, 0)
  assert.equal(choice.kind, 'ability-put-target-on-deck')
  assert.deepEqual(choice.unitIds, ['target'])
  assert.equal(projectForPlayer(used.state, 1).private.pendingChoice, null)

  const result = applyCommand(used.state, 0, { action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: 'target' } } })
  assert.equal(result.state.board.some(unit => unit.id === 'target'), false)
  assert.equal(result.state.players[1].deck[0].Name, 'Target')
  assert.equal(result.state.players[1].discard.at(-1).Name, 'Target item')
  assert.equal(result.state.version, 2)
})

test('Noovse locks opponent movement through the opponent turn only', () => {
  const match = createMatch(input)
  const description = 'Способность 6⭐: На следующем ходу все существа не могут передвигаться до начала вашего следующего хода.'
  match.players[0].mana = 6
  match.players[1].energy = 3
  match.board.push(
    { id: 'noovse', card: { ...catalog[0], Name: 'Noovse', Description: description }, owner: 0, row: 4, col: 2, health: 2, maxHealth: 2, attack: 2, speed: 2, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'target', card: { ...catalog[1], Name: 'Target' }, owner: 1, row: 1, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const used = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'noovse', abilityIndex: 0 } })
  assert.equal(used.state.players[0].mana, 0)
  assert.equal(used.state.movementLock, 1)
  assert.equal(projectForPlayer(used.state, 0).public.movementLock, 1)
  assert.equal(projectForPlayer(used.state, 1).public.movementLock, 1)
  assert.equal(used.state.board.find(unit => unit.id === 'noovse').abilityUsed, true)

  const opponentTurn = applyCommand(used.state, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(opponentTurn.state.current, 1)
  assert.throws(() => applyCommand(opponentTurn.state, 1, { action: 'unit.move', data: { unitId: 'target', to: { row: 1, col: 3 } } }), { code: 'MOVEMENT_BLOCKED' })
  const nextTurn = applyCommand(opponentTurn.state, 1, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(nextTurn.state.current, 0)
  assert.equal(nextTurn.state.movementLock, null)
})

test('Lucio grants temporary health to allied creatures and finalizes lethal expiry', () => {
  const match = createMatch(input)
  const description = 'Способность 10: Все ваши существа получают 10 до начала вашего следующего хода.'
  match.round = 3
  match.players[0].mana = 10
  match.board.push(
    { id: 'lucio', card: { ...catalog[0], Name: 'Лусио', Description: description }, owner: 0, row: 4, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'ally', card: { ...catalog[1], Name: 'Ally' }, owner: 0, row: 3, col: 2, health: 4, maxHealth: 4, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'enemy', card: { ...catalog[2], Name: 'Enemy' }, owner: 1, row: 2, col: 2, health: 12, maxHealth: 12, attack: 8, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const used = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'lucio', abilityIndex: 0 } })
  assert.equal(used.state.players[0].mana, 0)
  assert.deepEqual(['lucio', 'ally'].map(id => used.state.board.find(unit => unit.id === id).health), [13, 14])
  assert.deepEqual(['lucio', 'ally'].map(id => used.state.board.find(unit => unit.id === id).temporaryHealth), [10, 10])
  assert.equal(used.state.board.find(unit => unit.id === 'ally').temporaryHealthExpiresAt, 5)

  const opponentTurn = applyCommand(used.state, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  const attack = applyCommand(opponentTurn.state, 1, { action: 'unit.attack', data: { unitId: 'enemy', targetUnitId: 'ally' } })
  assert.equal(attack.state.board.find(unit => unit.id === 'ally').health, 6)
  const expired = applyCommand(attack.state, 1, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(expired.state.board.some(unit => unit.id === 'ally'), false)
  assert.equal(expired.state.players[0].discard.some(card => card.Name === 'Ally'), true)
  assert.equal(expired.state.board.find(unit => unit.id === 'lucio').health, 3)
})

test('Iceberg ability resolves either a card draw or a temporary hand limit increase', () => {
  const description = 'Постоянно: Когда вы сжигаете карту, то получает 1 ⚫\nСпособность 1 ⚫🔁: Возьмите карту или увеличьте лимит карт на 1 до конца следующего хода.'
  for (const choice of ['draw', 'limit']) {
    const match = createMatch(input)
    match.round = 3
    match.board.push({ id: 'iceberg', card: { ...catalog[0], Name: 'Айсберг', Description: description, Type: 3 }, owner: 0, row: 4, col: 2, health: 3, maxHealth: 3, attack: 0, speed: 0, summoned: 0, blackTokens: 1 })
    match.players[0].deck.unshift({ ...catalog[1], Id: 'iceberg-draw', Name: 'Drawn card' })
    const used = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'iceberg', abilityIndex: 0 } })
    assert.equal(used.state.players[0].mana, 1)
    assert.equal(used.state.board.find(unit => unit.id === 'iceberg').blackTokens, 0)
    assert.equal(used.state.pendingChoice.kind, 'ability-draw-or-limit')
    assert.equal(projectForPlayer(used.state, 1).private.pendingChoice, null)
    const resolved = applyCommand(used.state, 0, { action: 'choice.resolve', data: { choiceId: used.state.pendingChoice.id, selection: { choice } } })
    assert.equal(resolved.state.pendingChoice, null)
    if (choice === 'draw') assert.equal(resolved.state.players[0].hand.at(-1).Name, 'Drawn card')
    else {
      assert.equal(resolved.state.players[0].limit, 5)
      assert.deepEqual(resolved.state.players[0].temporaryLimitExpirations, [6])
      const opponentTurn = applyCommand(resolved.state, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
      const ownerNextTurn = applyCommand(opponentTurn.state, 1, { action: 'turn.end', data: { option: 'no_penalty' } })
      const expired = applyCommand(ownerNextTurn.state, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
      assert.equal(expired.state.players[0].limit, 4)
    }
  }
})

test('Bibi privately sacrifices an allied building for temporary attack', () => {
  const match = createMatch(input)
  const description = 'Способность 0⭐: Уничтожает ваше здание что бы дать получить +4⚔️ до конца хода.'
  match.round = 3
  match.board.push(
    { id: 'bibi', card: { ...catalog[0], Name: 'Биби', Description: description, Type: 0 }, owner: 0, row: 4, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'building', card: { ...catalog[1], Name: 'Ally building', Type: 3 }, owner: 0, row: 3, col: 2, health: 3, maxHealth: 3, attack: 0, speed: 0, summoned: 0, blackTokens: 0 },
    { id: 'enemy-building', card: { ...catalog[2], Name: 'Enemy building', Type: 3 }, owner: 1, row: 1, col: 2, health: 3, maxHealth: 3, attack: 0, speed: 0, summoned: 0, blackTokens: 0 },
  )
  const used = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'bibi', abilityIndex: 0 } })
  assert.equal(used.state.pendingChoice.kind, 'ability-sacrifice-building')
  assert.deepEqual(used.state.pendingChoice.unitIds, ['building'])
  assert.equal(projectForPlayer(used.state, 1).private.pendingChoice, null)
  const resolved = applyCommand(used.state, 0, { action: 'choice.resolve', data: { choiceId: used.state.pendingChoice.id, selection: { unitId: 'building' } } })
  assert.equal(resolved.state.board.some(unit => unit.id === 'building'), false)
  assert.equal(resolved.state.players[0].discard.some(card => card.Name === 'Ally building'), true)
  assert.equal(resolved.state.board.find(unit => unit.id === 'bibi').attack, 5)
  assert.equal(resolved.state.board.find(unit => unit.id === 'bibi').temporaryAttack, 4)
  assert.equal(projectForPlayer(resolved.state, 1).public.board.find(unit => unit.id === 'bibi').temporaryAttack, 4)
  assert.equal(resolved.state.board.find(unit => unit.id === 'enemy-building').health, 3)
  const ended = applyCommand(resolved.state, 0, { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal(ended.state.board.find(unit => unit.id === 'bibi').attack, 1)
  assert.equal(ended.state.board.find(unit => unit.id === 'bibi').temporaryAttack, 0)
})

test('Genshin fan gamba uses injected rolls for death and mana outcomes', () => {
  const description = 'Способность 0: Гамба:\r\n1-3 - умирает\r\n4-6 - получите 3 маны.'
  for (const [roll, dies, itemName, bonus] of [[0, true, null, 0], [0.5, false, null, 0], [1 / 3, false, 'Алмаз', 0], [1 / 3, false, null, 1]]) {
    const match = createMatch(input)
    match.players[0].nextGambaBonus = bonus
    match.board.push({ id: 'fan', card: { ...catalog[0], Name: 'Фанат геншина', Description: description }, ...(itemName ? { item: { ...catalog[1], Name: itemName, Type: 1 } } : {}), owner: 0, row: 4, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, blackTokens: 0 })
    const result = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'fan', abilityIndex: 0 } }, () => roll)
    assert.equal(result.state.board.some(unit => unit.id === 'fan'), !dies)
    assert.equal(result.state.players[0].discard.some(card => card.Name === 'Фанат геншина'), dies)
    assert.equal(result.state.players[0].mana, dies ? 1 : 4)
    assert.equal(result.state.players[0].nextGambaBonus, 0)
  }
})

test('Generator of fun pays for one ability draw without leaving the board', () => {
  const match = createMatch(input)
  const description = 'Невидимость\nСпособность 2⭐: Возьмите карту\nСжигается'
  match.players[0].mana = 2
  match.players[0].deck.unshift({ ...catalog[1], Id: 'generator-draw', Name: 'Drawn card' })
  match.board.push({ id: 'generator', card: { ...catalog[0], Name: 'Генератор потех', Description: description, Type: 0 }, owner: 0, row: 4, col: 2, health: 7, maxHealth: 7, attack: 2, speed: 2, summoned: 0, blackTokens: 0 })
  const result = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'generator', abilityIndex: 0 } })
  assert.equal(result.state.players[0].mana, 0)
  assert.equal(result.state.players[0].hand.at(-1).Name, 'Drawn card')
  assert.equal(result.state.players[0].deck.some(card => card.Id === 'generator-draw'), false)
  assert.equal(result.state.board.some(unit => unit.id === 'generator'), true)
  assert.equal(result.state.board.find(unit => unit.id === 'generator').abilityUsed, true)
})

test('Conveyor production resolves private discard, burn, save, and draw stages in order', () => {
  const match = createMatch(input)
  const description = 'Способность 1⭐: Сбросьте 1 карту, сожгите 1 карту, сберегите 1 карту, возьмите 1 карту.'
  match.players[0].mana = 1
  match.players[0].deck.unshift({ ...catalog[2], Id: 'conveyor-draw', Name: 'Drawn card' })
  match.board.push({ id: 'conveyor', card: { ...catalog[0], Name: 'Конвейерное производство', Description: description, Type: 3 }, owner: 0, row: 2, col: 2, health: 3, maxHealth: 3, attack: 0, speed: 0, summoned: 0, blackTokens: 0 })
  const [discarded, burned, saved] = match.players[0].hand
  const used = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'conveyor', abilityIndex: 0 } })
  assert.equal(used.state.players[0].mana, 0)
  assert.equal(used.state.board.find(unit => unit.id === 'conveyor').abilityUsed, true)
  assert.equal(used.state.pendingChoice.stage, 'discard')
  assert.equal(projectForPlayer(used.state, 1).private.pendingChoice, null)

  const discardStep = applyCommand(used.state, 0, { action: 'choice.resolve', data: { choiceId: used.state.pendingChoice.id, selection: { unitId: discarded.instanceId } } })
  assert.ok(discardStep.state.players[0].discard.some(card => card.instanceId === discarded.instanceId))
  assert.equal(discardStep.state.pendingChoice.stage, 'burn')
  const burnStep = applyCommand(discardStep.state, 0, { action: 'choice.resolve', data: { choiceId: discardStep.state.pendingChoice.id, selection: { unitId: burned.instanceId } } })
  assert.ok(burnStep.state.players[0].burned.some(card => card.instanceId === burned.instanceId))
  assert.equal(burnStep.state.players[0].burnedThisTurn, true)
  assert.equal(burnStep.state.pendingChoice.stage, 'save')
  const saveStep = applyCommand(burnStep.state, 0, { action: 'choice.resolve', data: { choiceId: burnStep.state.pendingChoice.id, selection: { unitId: saved.instanceId } } })

  assert.ok(saveStep.state.players[0].saved.some(card => card.instanceId === saved.instanceId))
  assert.equal(saveStep.state.players[0].hand.at(-1).Name, 'Drawn card')
  assert.equal(saveStep.state.players[0].deck.some(card => card.Id === 'conveyor-draw'), false)
  assert.equal(saveStep.state.pendingChoice, null)
  assert.equal(saveStep.state.version, 4)
})

test('Conveyor production rejects activation below three cards without spending mana', () => {
  const match = createMatch(input)
  match.players[0].hand.splice(2)
  match.players[0].mana = 1
  match.board.push({ id: 'conveyor', card: { ...catalog[0], Name: 'Конвейерное производство', Description: 'Способность 1⭐: Сбросьте 1 карту, сожгите 1 карту, сберегите 1 карту, возьмите 1 карту.', Type: 3 }, owner: 0, row: 2, col: 2, health: 3, maxHealth: 3, attack: 0, speed: 0, summoned: 0, blackTokens: 0 })

  assert.throws(() => applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'conveyor', abilityIndex: 0 } }), { code: 'NOT_ENOUGH_CARDS' })
  assert.equal(match.players[0].mana, 1)
  assert.equal(match.board[0].abilityUsed, undefined)
})

test('Librarian privately selects rarity and pile, then pays and burns the card on a low gamba roll', () => {
  const match = createMatch(input)
  const description = 'Способность N⭐: Если вы потратили 1 ману, то вытащите любую обычную карту, если 2 любую редкую карту, если 4 любую легендарную карту из КД, КС. \nПостоянно: Гамба: Если вы вытаскиваете карту при помощи Библиотекаря.\n1-3 - Вытащенная карта сжигается.\n4-6 - Ничего не происходит.'
  const selected = { ...catalog[0], Id: 'librarian-common', Name: 'Common target', Rarity: 0, instanceId: 'librarian-common-instance' }
  match.players[0].mana = 1
  match.players[0].nextGambaBonus = 0
  match.players[0].discard.push(selected)
  match.board.push({ id: 'librarian', card: { ...catalog[0], Name: 'Библиотекарь', Description: description }, owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 2, summoned: 0, blackTokens: 0 })

  const opened = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'librarian', abilityIndex: 0 } })
  assert.equal(opened.state.players[0].mana, 1)
  assert.equal(opened.state.board.find(unit => unit.id === 'librarian').abilityUsed, undefined)
  assert.equal(opened.state.pendingChoice.kind, 'ability-librarian')
  assert.equal(projectForPlayer(opened.state, 0).private.pendingChoice.choices.length, 1)
  assert.equal(projectForPlayer(opened.state, 1).private.pendingChoice, null)

  const chooseCost = applyCommand(opened.state, 0, { action: 'choice.resolve', data: { choiceId: opened.state.pendingChoice.id, selection: { choice: 'librarian-cost', cost: 1 } } })
  assert.deepEqual(projectForPlayer(chooseCost.state, 0).private.pendingChoice.choices.map(choice => choice.value.pile), ['deck', 'discard'])
  const choosePile = applyCommand(chooseCost.state, 0, { action: 'choice.resolve', data: { choiceId: chooseCost.state.pendingChoice.id, selection: { choice: 'librarian-pile', pile: 'discard' } } })
  assert.deepEqual(projectForPlayer(choosePile.state, 0).private.pendingChoice.options.map(option => option.unitId), [selected.instanceId])
  const resolve = applyCommand(choosePile.state, 0, { action: 'choice.resolve', data: { choiceId: choosePile.state.pendingChoice.id, selection: { unitId: selected.instanceId } } }, () => 0)

  assert.equal(resolve.state.players[0].mana, 0)
  assert.equal(resolve.state.players[0].discard.some(card => card.instanceId === selected.instanceId), false)
  assert.equal(resolve.state.players[0].burned.filter(card => card.instanceId === selected.instanceId).length, 1)
  assert.equal(resolve.state.players[0].burnedThisTurn, true)
  assert.equal(resolve.state.players[0].nextGambaBonus, 0)
  assert.equal(resolve.state.board.find(unit => unit.id === 'librarian').abilityUsed, true)
  assert.equal(resolve.state.pendingChoice, null)
  assert.equal(resolve.state.version, 4)
})

test('Librarian keeps the selected card on a high modified gamba roll', () => {
  const match = createMatch(input)
  const description = 'Способность N⭐: Если вы потратили 1 ману, то вытащите любую обычную карту, если 2 любую редкую карту, если 4 любую легендарную карту из КД, КС. \nПостоянно: Гамба: Если вы вытаскиваете карту при помощи Библиотекаря.\n1-3 - Вытащенная карта сжигается.\n4-6 - Ничего не происходит.'
  const selected = { ...catalog[0], Id: 'librarian-kept', Name: 'Kept card', Rarity: 0, instanceId: 'librarian-kept-instance' }
  match.players[0].mana = 1
  match.players[0].nextGambaBonus = 2
  match.players[0].discard.push(selected)
  match.board.push({ id: 'librarian', card: { ...catalog[0], Name: 'Библиотекарь', Description: description }, owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 2, summoned: 0, blackTokens: 0 })
  let state = applyCommand(match, 0, { action: 'ability.use', data: { unitId: 'librarian', abilityIndex: 0 } }).state
  for (const selection of [{ choice: 'librarian-cost', cost: 1 }, { choice: 'librarian-pile', pile: 'discard' }]) state = applyCommand(state, 0, { action: 'choice.resolve', data: { choiceId: state.pendingChoice.id, selection } }).state
  const result = applyCommand(state, 0, { action: 'choice.resolve', data: { choiceId: state.pendingChoice.id, selection: { unitId: selected.instanceId } } }, () => 0.5)

  assert.equal(result.state.players[0].mana, 0)
  assert.equal(result.state.players[0].hand.filter(card => card.instanceId === selected.instanceId).length, 1)
  assert.equal(result.state.players[0].burned.some(card => card.instanceId === selected.instanceId), false)
  assert.equal(result.state.players[0].nextGambaBonus, 0)
})

test('a stored next-attack splash hits the target and adjacent creatures once', () => {
  const match = createMatch(input)
  match.board.push(
    { id: 'attacker', card: { ...catalog[0], Name: 'Attacker' }, owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 2, speed: 1, summoned: 0, attacks: 0, nextAttackSplashDamage: 2 },
    { id: 'target', card: { ...catalog[1], Name: 'Target' }, owner: 1, row: 3, col: 2, health: 10, maxHealth: 10, attack: 0, speed: 1, summoned: 0 },
    { id: 'neighbor', card: { ...catalog[2], Name: 'Neighbor' }, owner: 0, row: 3, col: 1, health: 10, maxHealth: 10, attack: 0, speed: 1, summoned: 0 },
  )
  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'target' } })
  assert.equal(result.state.board.find(unit => unit.id === 'target').health, 6)
  assert.equal(result.state.board.find(unit => unit.id === 'neighbor').health, 8)
  assert.equal(result.state.board.find(unit => unit.id === 'attacker').nextAttackSplashDamage, 0)
})

test('a splash lethal resolves the neighboring creature death and its discard', () => {
  const match = createMatch(input)
  match.board.push(
    { id: 'attacker', card: { ...catalog[0], Name: 'Ghorze' }, owner: 0, row: 4, col: 2, health: 7, maxHealth: 7, attack: 1, speed: 1, summoned: 0, attacks: 0, nextAttackSplashDamage: 2, blackTokens: 0 },
    { id: 'defender', card: { ...catalog[1], Name: 'Defender' }, owner: 1, row: 3, col: 2, health: 6, maxHealth: 6, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'neighbor', card: { ...catalog[2], Name: 'Neighbor' }, owner: 1, row: 3, col: 3, health: 1, maxHealth: 1, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )

  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'defender' } })

  assert.equal(result.state.board.some(unit => unit.id === 'neighbor'), false)
  assert.ok(result.state.players[1].discard.some(card => card.Name === 'Neighbor'))
  assert.equal(result.state.board.find(unit => unit.id === 'attacker').attack, 2)
  assert.equal(result.state.board.find(unit => unit.id === 'attacker').shield, true)
})

test('equips an item from hand and applies its combat stats with the mana cost', () => {
  const match = createMatch(input)
  const item = { ...catalog[4], instanceId: 'item-1', Name: 'Тестовый предмет', Type: 1, Cost: 2, Attack: 2, Health: 1, Description: 'Постоянно: Существо получает предмет.' }
  match.players[0].hand.push(item)
  match.players[0].mana = 2
  match.board.push({ id: 'target', card: { ...catalog[0], Name: 'Target' }, owner: 0, row: 4, col: 2, health: 6, maxHealth: 6, attack: 3, speed: 1, summoned: 0 })

  const result = applyCommand(match, 0, { action: 'item.equip', data: { cardInstanceId: item.instanceId, targetUnitId: 'target', payment: 'mana' } })

  assert.equal(result.state.players[0].mana, 0)
  assert.equal(result.state.players[0].hand.some(card => card.instanceId === item.instanceId), false)
  assert.equal(result.state.board[0].attack, 5)
  assert.equal(result.state.board[0].health, 7)
  assert.equal(result.state.board[0].item.Name, item.Name)
  assert.equal(result.state.players[0].played, true)
})

test('equips the cataloged Admin crossbow and resolves its crown kill and trap', () => {
  const match = createMatch(input)
  const item = { ...catalog[4], instanceId: 'crossbow-1', Name: 'Админский арбалет', Type: 1, Cost: 7, Attack: 0, Health: 2, Description: 'Досягаемость Безопасность\nВход: Получает -10⚔️.\nКоронный и Ловушка: Убейте существо.' }
  match.players[0].hand.push(item)
  match.players[0].mana = 7
  match.board.push({ id: 'bearer', card: { ...catalog[0], Name: 'Bearer', Attack: 12 }, owner: 0, row: 4, col: 2, health: 6, maxHealth: 6, attack: 12, speed: 1, summoned: 0, attacks: 0 })

  const equipped = applyCommand(match, 0, { action: 'item.equip', data: { cardInstanceId: item.instanceId, targetUnitId: 'bearer', payment: 'mana' } })
  assert.equal(equipped.state.board[0].attack, 2)
  assert.equal(equipped.state.board[0].speed, 1)
  assert.equal(equipped.state.board[0].item.Name, item.Name)
  equipped.state.board.push({ id: 'crown-target', card: { ...catalog[1], Name: 'Crown target' }, owner: 1, row: 3, col: 2, health: 10, maxHealth: 10, attack: 0, speed: 1, summoned: 0 })

  const crowned = applyCommand(equipped.state, 0, { action: 'unit.attack', data: { unitId: 'bearer', targetUnitId: 'crown-target' } })
  assert.equal(crowned.state.board.some(unit => unit.id === 'crown-target'), false)
  assert.ok(crowned.state.players[1].discard.some(card => card.Name === 'Crown target'))

  crowned.state.current = 1
  crowned.state.board.push({ id: 'trap-attacker', card: { ...catalog[2], Name: 'Trap attacker' }, owner: 1, row: 4, col: 1, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0 })
  const trapped = applyCommand(crowned.state, 1, { action: 'unit.attack', data: { unitId: 'trap-attacker', targetUnitId: 'bearer' } })
  assert.equal(trapped.state.board.some(unit => unit.id === 'trap-attacker'), false)
  assert.ok(trapped.state.players[1].discard.some(card => card.Name === 'Trap attacker'))
})

test('Schism deals its entry damage to the selected board target', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Схизм')
  assert.ok(card)
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const target = turnUnit('ДастАроникс', 1, 0, 2, { health: 8, maxHealth: 8 })
  match.board.push(target)
  match.players[0].hand = [{ ...card, instanceId: 'schism-instance' }]
  match.players[0].mana = 10

  const entered = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: 'schism-instance', payment: 'mana', target: { row: 4, col: 2 } } })
  assert.equal(entered.state.pendingChoice.kind, 'entry-damage-target')
  assert.deepEqual(projectForPlayer(entered.state, 0).private.pendingChoice.options.map(option => option.unitId), [target.id])

  const resolved = applyCommand(entered.state, 0, { action: 'choice.resolve', data: { choiceId: entered.state.pendingChoice.id, selection: { unitId: target.id } } })
  assert.equal(resolved.state.board.find(unit => unit.id === target.id).health, 5)
  assert.equal(resolved.state.version, 2)
})

test('Wondernop saves the top card from deck, discard, and burned piles on entry', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Вондерноп')
  assert.ok(card)
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const fromDeck = { ...catalog[0], instanceId: 'wondernop-deck' }
  const fromDiscard = { ...catalog[1], instanceId: 'wondernop-discard' }
  const fromBurned = { ...catalog[2], instanceId: 'wondernop-burned' }
  match.players[0].hand = [{ ...card, instanceId: 'wondernop-entry' }]
  match.players[0].deck = [fromDeck]
  match.players[0].discard = [fromDiscard]
  match.players[0].burned = [fromBurned]
  match.players[0].mana = 10

  const result = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: 'wondernop-entry', payment: 'mana', target: { row: 4, col: 2 } } })

  assert.deepEqual(result.state.players[0].saved.map(saved => saved.instanceId), ['wondernop-deck', 'wondernop-discard', 'wondernop-burned'])
  assert.equal(result.state.players[0].deck.length + result.state.players[0].discard.length + result.state.players[0].burned.length, 0)
})

test('Achivari sacrifices a chosen allied creature and heals its owner', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Ачивари')
  assert.ok(card)
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const ally = { id: 'achivari-ally', card: catalog[0], owner: 0, row: 2, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  match.board.push(ally)
  match.players[0].hand = [{ ...card, instanceId: 'achivari-entry' }]
  match.players[0].health = 25
  match.players[0].mana = 10

  const entered = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: 'achivari-entry', payment: 'mana', target: { row: 4, col: 2 } } })
  assert.equal(entered.state.pendingChoice.kind, 'entry-sacrifice-ally-heal')
  const resolved = applyCommand(entered.state, 0, { action: 'choice.resolve', data: { choiceId: entered.state.pendingChoice.id, selection: { unitId: ally.id } } })

  assert.equal(resolved.state.board.some(unit => unit.id === ally.id), false)
  assert.equal(resolved.state.players[0].health, 30)
})

test('Vanya Vereemeev saves a chosen allied card and discards its equipment', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Ваня Веремеев')
  assert.ok(card)
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const ally = { id: 'vanya-ally', card: { ...catalog[0], instanceId: 'vanya-ally-card' }, item: { ...catalog[1], Type: 1, instanceId: 'vanya-ally-item' }, owner: 0, row: 2, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  match.board.push(ally)
  match.players[0].hand = [{ ...card, instanceId: 'vanya-entry' }]
  match.players[0].mana = 10

  const entered = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: 'vanya-entry', payment: 'mana', target: { row: 4, col: 2 } } })
  assert.equal(entered.state.pendingChoice.kind, 'entry-save-allied')
  const resolved = applyCommand(entered.state, 0, { action: 'choice.resolve', data: { choiceId: entered.state.pendingChoice.id, selection: { unitId: ally.id } } })

  assert.equal(resolved.state.board.some(unit => unit.id === ally.id), false)
  assert.equal(resolved.state.players[0].saved.some(saved => saved.instanceId === ally.card.instanceId), true)
  assert.equal(resolved.state.players[0].discard.some(discarded => discarded.instanceId === ally.item.instanceId), true)
})

test('Vkidgrannik privately returns a chosen creature to its owner hand when score is below two', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Вкидгранник')
  assert.ok(card)
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const target = { id: 'bounce-target', card: { ...catalog[0], instanceId: 'bounce-card' }, owner: 1, row: 2, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  match.board.push(target)
  match.players[0].hand = [{ ...card, instanceId: 'vkidgrannik-entry' }]
  match.players[0].mana = 10

  const entered = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: 'vkidgrannik-entry', payment: 'mana', target: { row: 4, col: 2 } } })
  assert.equal(entered.state.pendingChoice.kind, 'entry-return-creature')
  assert.ok(projectForPlayer(entered.state, 0).private.pendingChoice.options.some(option => option.unitId === target.id))
  assert.equal(projectForPlayer(entered.state, 1).private.pendingChoice, null)
  const resolved = applyCommand(entered.state, 0, { action: 'choice.resolve', data: { choiceId: entered.state.pendingChoice.id, selection: { unitId: target.id } } })

  assert.equal(resolved.state.board.some(unit => unit.id === target.id), false)
  assert.equal(resolved.state.players[1].hand.some(returned => returned.instanceId === target.card.instanceId), true)
})

test('Zab takes control of a chosen enemy building', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Заб')
  assert.ok(card)
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const building = { id: 'zab-building', card: { ...catalog[0], Name: 'Enemy building', Type: 3, instanceId: 'zab-building-card' }, owner: 1, row: 2, col: 2, health: 5, maxHealth: 5, attack: 0, speed: 0, summoned: 0, attacks: 0, blackTokens: 0 }
  match.board.push(building)
  match.players[0].hand = [{ ...card, instanceId: 'zab-entry' }]
  match.players[0].mana = 10

  const entered = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: 'zab-entry', payment: 'mana', target: { row: 4, col: 2 } } })
  assert.equal(entered.state.pendingChoice.kind, 'entry-take-enemy-building')
  assert.equal(projectForPlayer(entered.state, 1).private.pendingChoice, null)
  const resolved = applyCommand(entered.state, 0, { action: 'choice.resolve', data: { choiceId: entered.state.pendingChoice.id, selection: { unitId: building.id } } })

  assert.equal(resolved.state.board.find(unit => unit.id === building.id).owner, 0)
  const noTargetMatch = createMatch({ ...input, catalog: [...catalog, card] })
  noTargetMatch.players[0].hand = [{ ...card, instanceId: 'zab-no-target' }]
  noTargetMatch.players[0].mana = 10
  const noTarget = applyCommand(noTargetMatch, 0, { action: 'card.play', data: { cardInstanceId: 'zab-no-target', payment: 'mana', target: { row: 4, col: 2 } } })
  assert.equal(noTarget.state.pendingChoice ?? null, null)
})

test('Emptinessssss rolls its entry Gamba and damages a chosen creature by the creature count', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Emptinessssss')
  assert.ok(card)
  const makeMatch = () => {
    const match = createMatch({ ...input, catalog: [...catalog, card] })
    const target = { id: 'emptiness-target', card: { ...catalog[1], instanceId: 'emptiness-target-card' }, owner: 1, row: 2, col: 2, health: 8, maxHealth: 8, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
    match.board.push(target)
    match.players[0].hand = [{ ...card, instanceId: 'emptiness-entry' }]
    match.players[0].mana = 10
    return { match, target }
  }
  const success = makeMatch()
  const entered = applyCommand(success.match, 0, { action: 'card.play', data: { cardInstanceId: 'emptiness-entry', payment: 'mana', target: { row: 4, col: 2 } } }, () => 0)
  assert.equal(entered.state.pendingChoice.kind, 'entry-damage-target')
  assert.equal(entered.state.pendingChoice.roll, 1)
  assert.equal(entered.state.pendingChoice.amount, 2)
  const resolved = applyCommand(entered.state, 0, { action: 'choice.resolve', data: { choiceId: entered.state.pendingChoice.id, selection: { unitId: success.target.id } } })
  assert.equal(resolved.state.board.find(unit => unit.id === success.target.id).health, 6)

  const miss = makeMatch()
  const noEffect = applyCommand(miss.match, 0, { action: 'card.play', data: { cardInstanceId: 'emptiness-entry', payment: 'mana', target: { row: 4, col: 2 } } }, () => 0.8)
  assert.equal(noEffect.state.pendingChoice ?? null, null)
  assert.equal(noEffect.state.board.find(unit => unit.id === miss.target.id).health, 8)
  assert.ok(noEffect.state.log.some(entry => entry.includes('гамба 5 — без эффекта')))
})

test('Jex privately lets its owner choose each of three type tokens for a creature without tokens', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Джекс')
  assert.ok(card)
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const target = { id: 'jex-target', card: { ...catalog[1], instanceId: 'jex-target-card' }, owner: 0, row: 2, col: 2, health: 8, maxHealth: 8, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  match.board.push(target)
  match.players[0].hand = [{ ...card, instanceId: 'jex-entry' }]
  match.players[0].mana = 10
  const entered = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: 'jex-entry', payment: 'mana', target: { row: 4, col: 2 } } })
  assert.equal(entered.state.pendingChoice.kind, 'entry-type-token')
  assert.equal(projectForPlayer(entered.state, 0).private.pendingChoice.options[0].unitId, target.id)
  assert.equal(projectForPlayer(entered.state, 1).private.pendingChoice, null)
  let state = applyCommand(entered.state, 0, { action: 'choice.resolve', data: { choiceId: entered.state.pendingChoice.id, selection: { unitId: target.id } } }).state
  for (const tokenClass of [0, 0, 5]) state = applyCommand(state, 0, { action: 'choice.resolve', data: { choiceId: state.pendingChoice.id, selection: { tokenClass } } }).state
  assert.deepEqual(state.board.find(unit => unit.id === target.id).typeTokens, [2, 0, 0, 0, 0, 1])
  assert.equal(state.pendingChoice ?? null, null)
})

test('GendaBoss damages its owner and buffs existing and future allied creatures', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'ГендаБосс')
  assert.ok(card)
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const ally = { id: 'genda-ally', card: { ...catalog[1], instanceId: 'genda-ally-card' }, owner: 0, row: 3, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  match.board.push(ally)
  match.players[0].hand = [{ ...card, instanceId: 'genda-entry' }]
  match.players[0].mana = 10
  match.players[0].health = 40
  const entered = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: 'genda-entry', payment: 'mana', target: { row: 4, col: 2 } } })
  assert.equal(entered.state.players[0].health, 10)
  assert.deepEqual(entered.state.board.find(unit => unit.id === ally.id) && (({ attack, health, maxHealth, speed }) => ({ attack, health, maxHealth, speed }))(entered.state.board.find(unit => unit.id === ally.id)), { attack: 3, health: 6, maxHealth: 6, speed: 0 })
  const future = { ...catalog[2], instanceId: 'genda-future' }
  entered.state.players[0].hand.push(future)
  entered.state.players[0].mana = 10
  const next = applyCommand(entered.state, 0, { action: 'card.play', data: { cardInstanceId: future.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  assert.deepEqual((({ attack, health, maxHealth, speed }) => ({ attack, health, maxHealth, speed }))(next.state.board.find(unit => unit.card.instanceId === future.instanceId)), { attack: 3, health: 3, maxHealth: 3, speed: 0 })
})

test('John Roblox privately moves a selected building to one adjacent empty neutral socket', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Джон Роблокс')
  assert.ok(card)
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const building = { id: 'john-building', card: { ...catalog[1], Name: 'Test Building', Type: 3, instanceId: 'john-building-card' }, owner: 1, row: 2, col: 2, health: 4, maxHealth: 4, attack: 0, speed: 0, summoned: 0, attacks: 0, blackTokens: 0 }
  match.board.push(building)
  match.players[0].hand = [{ ...card, instanceId: 'john-entry' }]
  match.players[0].mana = 10
  const entered = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: 'john-entry', payment: 'mana', target: { row: 4, col: 2 } } })
  assert.equal(entered.state.pendingChoice.kind, 'entry-move-building')
  const selected = applyCommand(entered.state, 0, { action: 'choice.resolve', data: { choiceId: entered.state.pendingChoice.id, selection: { unitId: building.id } } })
  assert.equal(selected.state.pendingChoice.kind, 'spell-move-target')
  assert.ok(selected.state.pendingChoice.cells.some(cell => cell.row === 2 && cell.col === 1))
  assert.throws(() => applyCommand(selected.state, 0, { action: 'choice.resolve', data: { choiceId: selected.state.pendingChoice.id, selection: { cell: { row: 0, col: 0 } } } }), { code: 'INVALID_CHOICE' })
  const moved = applyCommand(selected.state, 0, { action: 'choice.resolve', data: { choiceId: selected.state.pendingChoice.id, selection: { cell: { row: 2, col: 1 } } } })
  assert.deepEqual({ row: moved.state.board.find(unit => unit.id === building.id).row, col: moved.state.board.find(unit => unit.id === building.id).col }, { row: 2, col: 1 })
  assert.equal(moved.state.pendingChoice ?? null, null)
})

test('Bluzk saves a chosen allied creature and offers the top deck card as a free play when its score succeeds', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Блузк')
  assert.ok(card)
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const ally = { id: 'bluzk-ally', card: { ...catalog[1], instanceId: 'bluzk-ally-card' }, owner: 0, row: 3, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  const topCard = { ...catalog[5], instanceId: 'bluzk-free-card' }
  match.board.push(ally)
  match.players[0].hand = [{ ...card, instanceId: 'bluzk-entry' }]
  match.players[0].deck = [topCard]
  match.players[0].mana = 10
  const entered = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: 'bluzk-entry', payment: 'mana', target: { row: 4, col: 2 } } })
  assert.equal(entered.state.pendingChoice.kind, 'entry-save-allied')
  assert.equal(entered.state.pendingChoice.playDeckTop, true)
  const saved = applyCommand(entered.state, 0, { action: 'choice.resolve', data: { choiceId: entered.state.pendingChoice.id, selection: { unitId: ally.id } } })
  assert.equal(saved.state.players[0].saved[0].instanceId, ally.card.instanceId)
  assert.ok(saved.state.players[0].hand.some(held => held.instanceId === topCard.instanceId))
  assert.ok(saved.state.players[0].freePlayCardIds.includes(topCard.instanceId))
  assert.equal(projectForPlayer(saved.state, 0).private.hand.find(held => held.instanceId === topCard.instanceId).freeToPlay, true)
  assert.equal(projectForPlayer(saved.state, 1).private.hand.some(held => held.instanceId === topCard.instanceId), false)
  saved.state.players[0].mana = 0
  const played = applyCommand(saved.state, 0, { action: 'card.play', data: { cardInstanceId: topCard.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  assert.ok(played.state.board.some(unit => unit.card.instanceId === topCard.instanceId))
  assert.equal(played.state.players[0].mana, 0)
  assert.equal(played.state.players[0].freePlayCardIds.includes(topCard.instanceId), false)
})

test('Bluzk does not offer the deck card when its score condition fails', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Блузк')
  assert.ok(card)
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const ally = { id: 'bluzk-score-ally', card: { ...catalog[1], instanceId: 'bluzk-score-ally-card' }, owner: 0, row: 3, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  const otherCard = { ...catalog[2], instanceId: 'bluzk-other-card' }
  const topCard = { ...catalog[5], instanceId: 'bluzk-score-top' }
  match.board.push(ally)
  match.players[0].hand = [{ ...card, instanceId: 'bluzk-score-entry' }, otherCard]
  match.players[0].deck = [topCard]
  match.players[0].mana = 10
  const entered = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: 'bluzk-score-entry', payment: 'mana', target: { row: 4, col: 2 } } })
  assert.equal(entered.state.pendingChoice.playDeckTop ?? false, false)
  const saved = applyCommand(entered.state, 0, { action: 'choice.resolve', data: { choiceId: entered.state.pendingChoice.id, selection: { unitId: ally.id } } })
  assert.equal(saved.state.players[0].deck[0].instanceId, topCard.instanceId)
  assert.equal(saved.state.players[0].freePlayCardIds.includes(topCard.instanceId), false)
})

test('free-play cards can be equipped and cast without spending mana', () => {
  const match = createMatch(input)
  const creature = { id: 'free-play-bearer', card: { ...catalog[1], instanceId: 'free-play-bearer-card' }, owner: 0, row: 4, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  const item = { ...catalog[4], Name: 'Free Item', Type: 1, Cost: 8, instanceId: 'free-item-instance', Description: '' }
  const spell = { ...realCatalog.find(candidate => candidate.Name === '100 правил драгонболла'), instanceId: 'free-spell-instance' }
  match.board.push(creature)
  match.players[0].hand = [item, spell]
  match.players[0].freePlayCardIds = [item.instanceId, spell.instanceId]
  match.players[0].mana = 0
  const equipped = applyCommand(match, 0, { action: 'item.equip', data: { cardInstanceId: item.instanceId, targetUnitId: creature.id, payment: 'mana' } })
  assert.equal(equipped.state.board.find(unit => unit.id === creature.id).item.instanceId, item.instanceId)
  assert.equal(equipped.state.players[0].mana, 0)
  const cast = applyCommand(equipped.state, 0, { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
  assert.equal(cast.state.players[0].mana, 0)
  assert.equal(cast.state.players[0].freePlayCardIds.includes(spell.instanceId), false)
})

test('Brimstone adds dealt creature combat damage to the opponent, but not absorbed damage', () => {
  const match = createMatch(input)
  const item = { ...catalog[4], instanceId: 'brimstone-1', Name: 'Бримстоун', Type: 1, Cost: 7, Attack: 1, Health: 0, Description: 'Постоянно: Существо также наносит урон и противнику' }
  match.players[0].hand.push(item)
  match.players[0].mana = 7
  match.board.push(
    { id: 'bearer', card: { ...catalog[0], Name: 'Bearer' }, owner: 0, row: 4, col: 2, health: 6, maxHealth: 6, attack: 3, speed: 1, summoned: 0, attacks: 0 },
    { id: 'target', card: { ...catalog[1], Name: 'Target' }, owner: 1, row: 3, col: 2, health: 10, maxHealth: 10, attack: 0, speed: 1, summoned: 0 },
  )
  const equipped = applyCommand(match, 0, { action: 'item.equip', data: { cardInstanceId: item.instanceId, targetUnitId: 'bearer', payment: 'mana' } })
  const hit = applyCommand(equipped.state, 0, { action: 'unit.attack', data: { unitId: 'bearer', targetUnitId: 'target' } })
  assert.equal(hit.state.board.find(unit => unit.id === 'target').health, 6)
  assert.equal(hit.state.players[1].health, 41)

  const shielded = structuredClone(equipped.state)
  shielded.board.find(unit => unit.id === 'bearer').attacks = 0
  shielded.board.find(unit => unit.id === 'target').shield = true
  const blocked = applyCommand(shielded, 0, { action: 'unit.attack', data: { unitId: 'bearer', targetUnitId: 'target' } })
  assert.equal(blocked.state.players[1].health, 45)

  const direct = structuredClone(equipped.state)
  direct.board.find(unit => unit.id === 'bearer').row = 0
  const face = applyCommand(direct, 0, { action: 'unit.attackPlayer', data: { unitId: 'bearer' } })
  assert.equal(face.state.players[1].health, 41)
})

test('Dupe item adjusts hand limit, grants its crown reward and changes the next score threshold', () => {
  const match = createMatch(input)
  const item = { ...catalog[4], instanceId: 'dupe-1', Name: 'Дюп', Type: 1, Cost: 5, Attack: 1, Health: 2, Description: 'Вход: Уменьшает лимит карт на 2.\nКоронный: Увеличивает лимит карт на 1 а так же получает 1 ⚫\nСпособность 1⚫: Увеличьте или уменьшите требование следующего счёта на 1.' }
  match.players[0].hand.push(item)
  match.players[0].mana = 5
  match.board.push(
    { id: 'bearer', card: { ...catalog[0], Name: 'Bearer' }, owner: 0, row: 4, col: 2, health: 6, maxHealth: 6, attack: 3, speed: 1, summoned: 0, attacks: 0 },
    { id: 'target', card: { ...catalog[1], Name: 'Target' }, owner: 1, row: 3, col: 2, health: 10, maxHealth: 10, attack: 0, speed: 1, summoned: 0 },
  )

  const equipped = applyCommand(match, 0, { action: 'item.equip', data: { cardInstanceId: item.instanceId, targetUnitId: 'bearer', payment: 'mana' } })
  assert.equal(equipped.state.players[0].limit, 2)
  const crowned = applyCommand(equipped.state, 0, { action: 'unit.attack', data: { unitId: 'bearer', targetUnitId: 'target' } })
  assert.equal(crowned.state.players[0].limit, 3)
  assert.equal(crowned.state.board.find(unit => unit.id === 'bearer').blackTokens, 1)
  assert.equal(projectForPlayer(crowned.state, 1).public.board.find(unit => unit.id === 'bearer').blackTokens, 1)
  assert.throws(() => applyCommand(crowned.state, 0, { action: 'ability.use', data: { unitId: 'bearer', abilityIndex: 0 } }), { code: 'INVALID_COMMAND' })
  assert.throws(() => applyCommand(crowned.state, 0, { action: 'ability.use', data: { unitId: 'bearer', abilityIndex: 0, scoreAdjustment: 0 } }), { code: 'INVALID_COMMAND' })

  const adjusted = applyCommand(crowned.state, 0, { action: 'ability.use', data: { unitId: 'bearer', abilityIndex: 0, scoreAdjustment: -1 } })
  assert.equal(adjusted.state.players[0].nextScoreAdjustment, -1)
  assert.equal(adjusted.state.board.find(unit => unit.id === 'bearer').blackTokens, 0)
  assert.equal(adjusted.state.board.find(unit => unit.id === 'bearer').abilityUsed, true)
})

test('Mace crown stuns its attacked creature and stacks the stun counter', () => {
  const match = createMatch(input)
  const item = { ...catalog[4], instanceId: 'mace-1', Name: 'Булава', Type: 1, Cost: 4, Attack: 2, Health: 0, Description: 'Коронный: Выбранное существо получает оглушение 1' }
  match.players[0].hand.push(item)
  match.players[0].mana = 4
  match.board.push(
    { id: 'bearer', card: { ...catalog[0], Name: 'Bearer' }, owner: 0, row: 4, col: 2, health: 6, maxHealth: 6, attack: 3, speed: 1, summoned: 0, attacks: 0 },
    { id: 'target', card: { ...catalog[1], Name: 'Target' }, owner: 1, row: 3, col: 2, health: 10, maxHealth: 10, attack: 0, speed: 1, summoned: 0, stunned: 2 },
  )

  const equipped = applyCommand(match, 0, { action: 'item.equip', data: { cardInstanceId: item.instanceId, targetUnitId: 'bearer', payment: 'mana' } })
  const attacked = applyCommand(equipped.state, 0, { action: 'unit.attack', data: { unitId: 'bearer', targetUnitId: 'target' } })
  assert.equal(attacked.state.board.find(unit => unit.id === 'target').stunned, 3)

  const direct = structuredClone(equipped.state)
  direct.board.find(unit => unit.id === 'bearer').row = 0
  const face = applyCommand(direct, 0, { action: 'unit.attackPlayer', data: { unitId: 'bearer' } })
  assert.equal(face.state.players[1].health, 40)
  assert.equal(face.state.board.find(unit => unit.id === 'target').stunned, 2)
})

test('Кирка ФСШ removes an attacked ally item and reverses its equipped stats without damage', () => {
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const pick = realCatalog.find(card => card.Name === 'Кирка ФСШ')
  const attacker = turnUnit('ДастАроникс', 0, 4, 2, { item: { ...pick, instanceId: 'pick-item' } })
  const targetItem = { ...catalog[0], Name: 'Plain Item', Type: 1, Description: '', Attack: 1, Health: 2, instanceId: 'plain-item' }
  const target = { id: 'pick-ally', card: { ...catalog[1], Name: 'Ally' }, item: targetItem, owner: 0, row: 4, col: 3, health: 6, maxHealth: 6, attack: 2, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  match.board.push(attacker, target)

  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: attacker.id, targetUnitId: target.id } })

  const ally = result.state.board.find(unit => unit.id === target.id)
  assert.equal(ally.item, undefined)
  assert.equal(ally.attack, 1)
  assert.equal(ally.health, 4)
  assert.equal(ally.maxHealth, 4)
  assert.equal(result.state.players[0].discard.some(card => card.instanceId === targetItem.instanceId), true)
})

test('Кирка ФСШ destroys the attacked building through the death resolver', () => {
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const attacker = turnUnit('ДастАроникс', 0, 4, 2, { item: { ...realCatalog.find(card => card.Name === 'Кирка ФСШ'), instanceId: 'pick-item' } })
  const buildingCard = { ...catalog[3], Name: 'Target building', Type: 3, Description: '', instanceId: 'target-building-card' }
  const building = { id: 'pick-building', card: buildingCard, owner: 1, row: 3, col: 2, health: 8, maxHealth: 8, attack: 0, speed: 0, blackTokens: 0 }
  match.board.push(attacker, building)

  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: attacker.id, targetUnitId: building.id } })

  assert.equal(result.state.board.some(unit => unit.id === building.id), false)
  assert.equal(result.state.players[1].discard.some(card => card.instanceId === buildingCard.instanceId), true)
})

test('Degras crown flip resolves the attacker flip trigger before the defender trap', () => {
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const attacker = turnUnit('.Хихо', 0, 4, 2, { item: { ...realCatalog.find(card => card.Name === 'Дегра'), instanceId: 'degra-item' } })
  const trap = { id: 'degra-trap', card: { ...catalog[1], Name: 'Мина', Description: 'Ловушка: Наносит 5 урона.' }, owner: 1, row: 3, col: 2, health: 5, maxHealth: 5, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  const handSize = match.players[0].hand.length
  const mana = match.players[0].mana
  match.board.push(attacker, trap)

  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: attacker.id, targetUnitId: trap.id } })

  const flipped = result.state.board.find(unit => unit.id === attacker.id)
  assert.equal(flipped.flippedTurns, 2)
  assert.equal(flipped.attack, attacker.attack + 1)
  assert.equal(flipped.health, attacker.health + 1)
  assert.equal(flipped.maxHealth, attacker.maxHealth + 1)
  assert.equal(flipped.speed, attacker.speed - 1)
  assert.equal(result.state.players[0].hand.length, handSize + 1)
  assert.equal(result.state.players[0].mana, mana + 1)
  assert.equal(result.state.board.some(unit => unit.id === trap.id), true)
})

test('Bazooka damages living, face-up creatures in all eight cells around its attack target', () => {
  const match = createMatch({ ...input, catalog: [...catalog, ...realCatalog] })
  const bazooka = realCatalog.find(card => card.Name === 'Базука')
  const attackTarget = { id: 'bazooka-target', card: { ...catalog[3], Name: 'Target building', Type: 3 }, owner: 1, row: 3, col: 2, health: 20, maxHealth: 20, attack: 0, speed: 0, blackTokens: 0 }
  const attacker = { id: 'bazooka-bearer', card: { ...catalog[0], Name: 'Bearer' }, item: { ...bazooka, instanceId: 'bazooka-item' }, owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  const ally = { id: 'bazooka-ally', card: { ...catalog[1], Name: 'Ally' }, owner: 0, row: 2, col: 1, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  const enemy = { id: 'bazooka-enemy', card: { ...catalog[2], Name: 'Enemy' }, owner: 1, row: 2, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  const lowHealth = turnUnit('ДастАроникс', 1, 4, 3, { health: 1 })
  const flipped = { id: 'bazooka-flipped', card: { ...catalog[4], Name: 'Flipped' }, owner: 0, row: 3, col: 3, health: 5, maxHealth: 5, attack: 1, speed: 1, flippedTurns: 2 }
  const building = { id: 'bazooka-building', card: { ...catalog[5], Name: 'Neighbor building', Type: 3 }, owner: 0, row: 2, col: 3, health: 5, maxHealth: 5, attack: 0, speed: 0 }
  const distant = { id: 'bazooka-distant', card: { ...catalog[6], Name: 'Distant' }, owner: 1, row: 1, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1 }
  const defenderHandSize = match.players[1].hand.length
  match.board.push(attacker, attackTarget, ally, enemy, lowHealth, flipped, building, distant)

  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: attacker.id, targetUnitId: attackTarget.id } })

  const unit = (id) => result.state.board.find(candidate => candidate.id === id)
  assert.equal(unit('bazooka-ally').health, 4)
  assert.equal(unit('bazooka-enemy').health, 4)
  assert.equal(unit('bazooka-bearer').health, 4)
  assert.equal(unit('bazooka-target').health, 19)
  assert.equal(unit('bazooka-flipped').health, 5)
  assert.equal(unit('bazooka-building').health, 5)
  assert.equal(unit('bazooka-distant').health, 5)
  assert.equal(unit(lowHealth.id), undefined)
  assert.equal(result.state.players[1].discard.some(card => card.instanceId === lowHealth.card.instanceId), true)
  assert.equal(result.state.players[1].hand.length, defenderHandSize + 1)
})

test('Magician Red crown damages the attacked creature after its shield absorbs combat damage', () => {
  const match = createMatch(input)
  const magician = realCatalog.find(card => card.Name === 'Magician Red')
  assert.ok(magician)
  const attacker = { id: 'magician-attacker', card: { ...catalog[0] }, item: { ...magician, instanceId: 'magician-item' }, owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  const target = turnUnit('ДастАроникс', 1, 3, 2, { health: 8, maxHealth: 8, shield: true })
  match.board.push(attacker, target)

  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: attacker.id, targetUnitId: target.id } })

  assert.equal(result.state.board.find(unit => unit.id === target.id).health, target.health - 1)
  assert.equal(result.state.board.find(unit => unit.id === target.id).shield, false)
})

test('Magician Red crown damage completes the death effect of the attacked creature', () => {
  const match = createMatch(input)
  const magician = realCatalog.find(card => card.Name === 'Magician Red')
  assert.ok(magician)
  const attacker = { id: 'magician-attacker', card: { ...catalog[0] }, item: { ...magician, instanceId: 'magician-item' }, owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  const target = turnUnit('ДастАроникс', 1, 3, 2, { health: 2, maxHealth: 2 })
  const previousHandSize = match.players[1].hand.length
  match.board.push(attacker, target)

  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: attacker.id, targetUnitId: target.id } })

  assert.equal(result.state.board.some(unit => unit.id === target.id), false)
  assert.equal(result.state.players[1].discard.some(card => card.instanceId === target.card.instanceId), true)
  assert.equal(result.state.players[1].hand.length, previousHandSize + 1)
})

test('Рокочущий рыцарь destroys an already damaged creature and burns its card', () => {
  const match = createMatch(input)
  const attacker = turnUnit('Рокочущий рыцарь', 0, 4, 2)
  const target = turnUnit('ДастАроникс', 1, 3, 2, { health: 6, maxHealth: 8 })
  match.board.push(attacker, target)

  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: attacker.id, targetUnitId: target.id } })

  assert.equal(result.state.board.some(unit => unit.id === target.id), false)
  assert.equal(result.state.players[1].burned.some(card => card.instanceId === target.card.instanceId), true)
  assert.equal(result.state.players[1].discard.some(card => card.instanceId === target.card.instanceId), false)
})

test('Rocking Knight does not kill a full-health creature whose shield absorbs the attack', () => {
  const match = createMatch(input)
  const attacker = turnUnit('Рокочущий рыцарь', 0, 4, 2)
  const target = turnUnit('ДастАроникс', 1, 3, 2, { shield: true })
  match.board.push(attacker, target)

  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: attacker.id, targetUnitId: target.id } })

  assert.equal(result.state.board.some(unit => unit.id === target.id), true)
  assert.equal(result.state.board.find(unit => unit.id === target.id).health, target.maxHealth)
  assert.equal(result.state.board.find(unit => unit.id === target.id).shield, false)
})

test('Вкидгранник returns itself and discards its item after a board attack', () => {
  const match = createMatch(input)
  const attacker = turnUnit('Вкидгранник', 0, 4, 2, { item: { ...catalog[1], instanceId: 'vklad-item' } })
  const target = { id: 'vklad-target', card: { ...catalog[2], Name: 'Target' }, owner: 1, row: 3, col: 2, health: 10, maxHealth: 10, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  match.board.push(attacker, target)

  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: attacker.id, targetUnitId: target.id } })

  assert.equal(result.state.board.some(unit => unit.id === attacker.id), false)
  assert.equal(result.state.players[0].hand.find(card => card.instanceId === attacker.card.instanceId).Name, 'Вкидгранник')
  assert.equal(result.state.players[0].discard.at(-1).instanceId, 'vklad-item')
  assert.equal(result.state.board.some(unit => unit.id === target.id), true)
})

test('Вкидгранник returns to hand after a direct player attack', () => {
  const match = createMatch(input)
  const attacker = turnUnit('Вкидгранник', 0, 0, 2)
  match.board.push(attacker)

  const result = applyCommand(match, 0, { action: 'unit.attackPlayer', data: { unitId: attacker.id } })

  assert.equal(result.state.board.some(unit => unit.id === attacker.id), false)
  assert.equal(result.state.players[0].hand.some(card => card.instanceId === attacker.card.instanceId), true)
})

test('Вкидгранник returns to hand before resolving its lethal counterattack death', () => {
  const match = createMatch(input)
  const attacker = turnUnit('Вкидгранник', 0, 4, 2, { health: 1 })
  const target = { id: 'vklad-lethal-target', card: { ...catalog[2], Name: 'Target' }, owner: 1, row: 3, col: 2, health: 10, maxHealth: 10, attack: 2, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  match.board.push(attacker, target)

  const result = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: attacker.id, targetUnitId: target.id } })

  assert.equal(result.state.players[0].hand.some(card => card.instanceId === attacker.card.instanceId), true)
  assert.equal(result.state.players[0].discard.some(card => card.instanceId === attacker.card.instanceId), false)
  assert.equal(result.state.board.some(unit => unit.id === attacker.id), false)
})

test('projects equipped item details through a public allowlist', () => {
  const match = createMatch(input)
  match.board.push({ id: 'unit', card: { ...catalog[0] }, owner: 0, row: 4, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, item: { Id: 'item-1', Name: 'Предмет', Type: 1, Attack: 2, Health: 1, Description: 'Открыто', Secret: 'private' } })
  assert.deepEqual(projectForPlayer(match, 1).public.board[0].item, { Name: 'Предмет', Type: 1, Attack: 2, Health: 1, Description: 'Открыто' })
})

test('rejects item targets with an existing item and unsupported item triggers without charging', () => {
  const match = createMatch(input)
  const item = { ...catalog[4], instanceId: 'item-1', Type: 1, Cost: 2, Description: 'Постоянно: Существо получает предмет.' }
  match.players[0].hand.push(item)
  match.players[0].mana = 2
  match.board.push({ id: 'target', card: { ...catalog[0] }, owner: 0, row: 4, col: 2, health: 6, maxHealth: 6, attack: 3, speed: 1, summoned: 0, item: { ...item, instanceId: 'already-equipped' } })
  assert.throws(() => applyCommand(match, 0, { action: 'item.equip', data: { cardInstanceId: item.instanceId, targetUnitId: 'target', payment: 'mana' } }), { code: 'INVALID_TARGET' })
  delete match.board[0].item
  match.players[0].hand.find(card => card.instanceId === item.instanceId).Description = 'Коронный: Наносит урон.'
  assert.throws(() => applyCommand(match, 0, { action: 'item.equip', data: { cardInstanceId: item.instanceId, targetUnitId: 'target', payment: 'mana' } }), { code: 'UNSUPPORTED_EFFECT' })
  match.players[0].hand.find(card => card.instanceId === item.instanceId).Description = 'Постоянно: Если владелец передвинется вперёд, то умирает.'
  assert.throws(() => applyCommand(match, 0, { action: 'item.equip', data: { cardInstanceId: item.instanceId, targetUnitId: 'target', payment: 'mana' } }), { code: 'UNSUPPORTED_EFFECT' })
  assert.equal(match.players[0].mana, 2)
  assert.equal(match.players[0].hand.length, 5)
})

test('Tau cannon burns itself and kills its bearer when its ability reaches five attack', () => {
  const match = createMatch(input)
  const cannon = { ...catalog[4], Name: 'Тау-пушка', Description: 'Способность 0: Получает 1\nПостоянно: Если у этого существа стат атаки 5 или более, то оно умирает а тау пушка сжигаеться.', Type: 1, Cost: 2, Attack: 0, Health: 0, instanceId: 'tau-cannon-1' }
  match.players[0].hand.push(cannon)
  match.players[0].mana = 2
  match.board.push({ id: 'bearer', card: { ...catalog[0], Name: 'Bearer', Description: '' }, owner: 0, row: 4, col: 2, health: 6, maxHealth: 6, attack: 4, speed: 1, summoned: 0, abilityUsed: false })

  const equipped = applyCommand(match, 0, { action: 'item.equip', data: { cardInstanceId: cannon.instanceId, targetUnitId: 'bearer', payment: 'mana' } })
  assert.equal(equipped.state.board.find(unit => unit.id === 'bearer').attack, 4)
  const fired = applyCommand(equipped.state, 0, { action: 'ability.use', data: { unitId: 'bearer', abilityIndex: 0 } })

  assert.equal(fired.state.board.some(unit => unit.id === 'bearer'), false)
  assert.equal(fired.state.players[0].discard.some(card => card.Name === 'Bearer'), true)
  assert.equal(fired.state.players[0].burned.filter(card => card.Name === 'Тау-пушка').length, 1)
})

test('Tau cannon passive triggers when equipping it onto a creature with five attack', () => {
  const match = createMatch(input)
  const cannon = { ...catalog[4], Name: 'Тау-пушка', Description: 'Способность 0: Получает 1\nПостоянно: Если у этого существа стат атаки 5 или более, то оно умирает а тау пушка сжигаеться.', Type: 1, Cost: 2, Attack: 0, Health: 0, instanceId: 'tau-cannon-2' }
  match.players[0].hand.push(cannon)
  match.players[0].mana = 2
  match.board.push({ id: 'bearer', card: { ...catalog[0], Name: 'Bearer' }, owner: 0, row: 4, col: 2, health: 6, maxHealth: 6, attack: 5, speed: 1, summoned: 0 })

  const equipped = applyCommand(match, 0, { action: 'item.equip', data: { cardInstanceId: cannon.instanceId, targetUnitId: 'bearer', payment: 'mana' } })

  assert.equal(equipped.state.board.some(unit => unit.id === 'bearer'), false)
  assert.equal(equipped.state.players[0].discard.some(card => card.Name === 'Bearer'), true)
  assert.equal(equipped.state.players[0].burned.filter(card => card.Name === 'Тау-пушка').length, 1)
})

test('Вискас crown offers the choice only above five cards in the hand', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Вискас')
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  match.current = 0
  match.players[0].hand = Array.from({ length: 6 }, (_, index) => ({ ...catalog[index], instanceId: `viskas-crown-hand-${index}` }))
  const viskas = { ...card, instanceId: 'viskas-crown-card' }
  match.board.push({ id: 'viskas-crown', card: viskas, owner: 0, row: 1, col: 1, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })
  match.board.push({ id: 'Target', card: { ...catalog[0], Name: 'Target', instanceId: 'target-instance' }, owner: 1, row: 2, col: 1, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })
  const attacked = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: 'viskas-crown', targetUnitId: 'Target' } })
  assert.equal(attacked.state.pendingChoice.kind, 'viskas-choice')
  assert.equal(projectForPlayer(attacked.state, 0).private.pendingChoice.choices.length, 2)
  assert.equal(projectForPlayer(attacked.state, 1).private.pendingChoice, null)

  const belowThreshold = structuredClone(match)
  belowThreshold.players[0].hand.pop()
  const noChoice = applyCommand(belowThreshold, 0, { action: 'unit.attack', data: { unitId: 'viskas-crown', targetUnitId: 'Target' } })
  assert.equal(noChoice.state.pendingChoice ?? null, null)
})

test('Indigolit resolves five repeatable one-point heals on cards or either player', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Индиголит')
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const instance = { ...card, instanceId: 'indigolit-entry' }
  match.players[0].hand = [instance]
  match.players[0].mana = 10
  match.players[0].health = 10
  match.players[1].health = 10
  const target = { id: 'heal-target', card: { ...catalog[0], instanceId: 'heal-target-card' }, owner: 0, row: 3, col: 1, health: 1, maxHealth: 10, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 }
  match.board.push(target)
  const played = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: instance.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  assert.equal(played.state.pendingChoice.kind, 'indigolit-heal')
  assert.equal(played.state.pendingChoice.remaining, 5)
  assert.deepEqual(projectForPlayer(played.state, 0).private.pendingChoice.choices.map(choice => choice.value.player), ['self', 'opponent'])
  assert.deepEqual(projectForPlayer(played.state, 0).private.pendingChoice.options.map(option => option.unitId), ['heal-target', played.state.board.find(unit => unit.card.Name === 'Индиголит').id])
  assert.equal(projectForPlayer(played.state, 1).private.pendingChoice, null)
  let state = played.state
  for (const selection of [{ unitId: 'heal-target' }, { unitId: 'heal-target' }, { player: 'self' }, { player: 'opponent' }, { unitId: 'heal-target' }]) {
    state = applyCommand(state, 0, { action: 'choice.resolve', data: { choiceId: state.pendingChoice.id, selection } }).state
  }
  assert.equal(state.board.find(unit => unit.id === 'heal-target').health, 4)
  assert.equal(state.players[0].health, 11)
  assert.equal(state.players[1].health, 11)
  assert.equal(state.pendingChoice ?? null, null)
})

test('Disappearing Guy rolls on entry, dies on 1–4, and survives on 5–6', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Исчезающий парень')
  for (const [roll, bonus, dies] of [[1, 0, true], [4, 0, true], [5, 0, false], [6, 0, false], [3, 2, false]]) {
    const match = createMatch({ ...input, catalog: [...catalog, card] })
    const instance = { ...card, instanceId: `disappearing-${roll}` }
    match.players[0].hand = [instance]
    match.players[0].mana = 10
    match.players[0].nextGambaBonus = bonus
    const result = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: instance.instanceId, payment: 'mana', target: { row: 4, col: 1 } } }, () => (roll - 1) / 6)
    assert.equal(result.state.board.some(unit => unit.card.Name === 'Исчезающий парень'), !dies)
    assert.equal(dies ? result.state.players[0].discard.some(item => item.instanceId === instance.instanceId) : true, true)
    assert.equal(result.state.players[0].nextGambaBonus, 0)
    assert.equal(result.state.pendingChoice ?? null, null)
  }
})

test('Dextergon optionally pays six health for shields on the creatures to its left and right', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Декстергон')
  const create = () => {
    const match = createMatch({ ...input, catalog: [...catalog, card] })
    const instance = { ...card, instanceId: 'dextergon-card' }
    match.players[0].hand = [instance]
    match.players[0].mana = 10
    match.players[0].health = 20
    match.board.push(
      { id: 'left', card: { ...catalog[0], Id: 'left-card', Name: 'Left' }, owner: 0, row: 4, col: 0, health: 2, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0 },
      { id: 'right', card: { ...catalog[1], Id: 'right-card', Name: 'Right' }, owner: 1, row: 4, col: 2, health: 2, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0 },
      { id: 'diagonal', card: { ...catalog[2], Id: 'diagonal-card', Name: 'Diagonal' }, owner: 0, row: 3, col: 0, health: 2, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0 },
    )
    return { match, instance }
  }
  const { match, instance } = create()
  const played = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: instance.instanceId, payment: 'mana', target: { row: 4, col: 1 }, horny: true } })
  assert.equal(played.state.players[0].health, 14)
  assert.equal(played.state.board.find(unit => unit.id === 'left').shield, true)
  assert.equal(played.state.board.find(unit => unit.id === 'right').shield, true)
  assert.notEqual(played.state.board.find(unit => unit.id === 'diagonal').shield, true)

  const ordinary = create()
  const noHorny = applyCommand(ordinary.match, 0, { action: 'card.play', data: { cardInstanceId: ordinary.instance.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  assert.equal(noHorny.state.players[0].health, 20)
  assert.notEqual(noHorny.state.board.find(unit => unit.id === 'left').shield, true)
})

test('Wismuth entry and death both search an item and building and let its owner discard one', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Висмут Шифера')
  const item = { ...catalog[0], Id: 'wismuth-item', Name: 'Searched Item', Type: 1, instanceId: 'wismuth-item-instance' }
  const building = { ...catalog[1], Id: 'wismuth-building', Name: 'Searched Building', Type: 3, instanceId: 'wismuth-building-instance' }
  const makeMatch = () => {
    const match = createMatch({ ...input, catalog: [...catalog, card, item, building] })
    for (const player of match.players) player.deck = [{ ...item }, { ...building }, ...player.deck]
    return match
  }

  const entryMatch = makeMatch()
  const instance = { ...card, instanceId: 'wismuth-entry' }
  entryMatch.players[0].hand = [instance]
  entryMatch.players[0].mana = 10
  const entered = applyCommand(entryMatch, 0, { action: 'card.play', data: { cardInstanceId: instance.instanceId, payment: 'mana', target: { row: 4, col: 1 } } }, () => 0)
  assert.equal(entered.state.pendingChoice.kind, 'wismuth-discard')
  assert.deepEqual(projectForPlayer(entered.state, 0).private.pendingChoice.options.map(option => option.unitId), ['wismuth-item-instance', 'wismuth-building-instance'])
  assert.equal(projectForPlayer(entered.state, 1).private.pendingChoice, null)
  const entryChoice = applyCommand(entered.state, 0, { action: 'choice.resolve', data: { choiceId: entered.state.pendingChoice.id, selection: { unitId: 'wismuth-item-instance' } } }, () => 0)
  assert.equal(entryChoice.state.players[0].discard.at(-1).instanceId, 'wismuth-item-instance')
  assert.equal(entryChoice.state.players[0].hand.at(-1).instanceId, 'wismuth-building-instance')

  const deathMatch = makeMatch()
  deathMatch.board.push(
    { id: 'wismuth', card: { ...card, instanceId: 'wismuth-death' }, owner: 1, row: 1, col: 1, health: 1, maxHealth: 1, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'attacker', card: { ...catalog[2], Id: 'attacker-card', Name: 'Attacker' }, owner: 0, row: 2, col: 1, health: 5, maxHealth: 5, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const died = applyCommand(deathMatch, 0, { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'wismuth' } }, () => 0)
  assert.equal(died.state.pendingChoice.kind, 'wismuth-discard')
  const deathChoice = applyCommand(died.state, 1, { action: 'choice.resolve', data: { choiceId: died.state.pendingChoice.id, selection: { unitId: 'wismuth-building-instance' } } }, () => 0)
  assert.equal(deathChoice.state.players[1].discard.at(-1).instanceId, 'wismuth-building-instance')
  assert.equal(deathChoice.state.players[1].hand.at(-1).instanceId, 'wismuth-item-instance')
})

test('Sovunya entry privately selects an unflipped board card and heals it by two', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Совунья')
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const instance = { ...card, instanceId: 'sovunya-entry' }
  match.players[0].hand = [instance]
  match.players[0].mana = 10
  match.board.push(
    { id: 'creature', card: { ...catalog[0], Id: 'sovunya-creature', Name: 'Creature' }, owner: 1, row: 1, col: 1, health: 1, maxHealth: 5, attack: 1, speed: 1, blackTokens: 0 },
    { id: 'building', card: { ...catalog[1], Id: 'sovunya-building', Name: 'Building', Type: 3 }, owner: 0, row: 0, col: 0, health: 1, maxHealth: 5, attack: 0, speed: 0, blackTokens: 0 },
    { id: 'flipped', card: { ...catalog[2], Id: 'sovunya-flipped', Name: 'Flipped' }, owner: 0, row: 0, col: 1, health: 1, maxHealth: 5, attack: 1, speed: 1, flippedTurns: 1, blackTokens: 0 },
  )
  const played = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: instance.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  assert.equal(played.state.pendingChoice.kind, 'heal-creature')
  assert.equal(played.state.pendingChoice.amount, 2)
  assert.deepEqual(projectForPlayer(played.state, 0).private.pendingChoice.options.map(option => option.unitId), ['creature', 'building'])
  assert.equal(projectForPlayer(played.state, 1).private.pendingChoice, null)
  const healed = applyCommand(played.state, 0, { action: 'choice.resolve', data: { choiceId: played.state.pendingChoice.id, selection: { unitId: 'creature' } } })
  assert.equal(healed.state.board.find(unit => unit.id === 'creature').health, 3)
  assert.equal(healed.state.board.find(unit => unit.id === 'building').health, 1)
})

test('Salubra entry heals damaged allied creatures and gains energy per creature healed', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Салюбра')
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  const instance = { ...card, instanceId: 'salubra-entry' }
  match.players[0].hand = [instance]
  match.players[0].mana = 10
  match.board.push(
    { id: 'ally', card: { ...catalog[0], Id: 'salubra-ally', Name: 'Ally' }, owner: 0, row: 3, col: 1, health: 1, maxHealth: 5, attack: 1, speed: 1, blackTokens: 0 },
    { id: 'full', card: { ...catalog[1], Id: 'salubra-full', Name: 'Full' }, owner: 0, row: 3, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, blackTokens: 0 },
    { id: 'enemy', card: { ...catalog[2], Id: 'salubra-enemy', Name: 'Enemy' }, owner: 1, row: 1, col: 1, health: 1, maxHealth: 5, attack: 1, speed: 1, blackTokens: 0 },
    { id: 'flipped', card: { ...catalog[3], Id: 'salubra-flipped', Name: 'Flipped' }, owner: 0, row: 3, col: 3, health: 1, maxHealth: 5, attack: 1, speed: 1, flippedTurns: 1, blackTokens: 0 },
    { id: 'ame', card: { ...catalog[4], Id: 'salubra-ame', Name: 'Аме' }, owner: 0, row: 3, col: 4, health: 2, maxHealth: 2, attack: 0, speed: 1, blackTokens: 0 },
    { id: 'diamond', card: { ...catalog[5], Id: 'salubra-diamond', Name: 'Розовый Алмаз' }, owner: 0, row: 3, col: 0, health: 2, maxHealth: 2, attack: 0, speed: 1, blackTokens: 0 },
  )
  const result = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: instance.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  assert.equal(result.state.board.find(unit => unit.id === 'ally').health, 4)
  assert.equal(result.state.board.find(unit => unit.id === 'ally').shield, true)
  assert.equal(result.state.board.find(unit => unit.id === 'full').health, 5)
  assert.equal(result.state.board.find(unit => unit.id === 'enemy').health, 1)
  assert.equal(result.state.board.find(unit => unit.id === 'flipped').health, 1)
  assert.equal(result.state.board.find(unit => unit.id === 'ame').attack, 1)
  assert.equal(result.state.players[0].energy, 2)
})

test('Yangusha takes an item on entry and returns its equipped item to deck top on death', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Янгуша')
  const item = { ...catalog[0], Id: 'yangusha-item', Name: 'Yangusha Item', Type: 1, Cost: 0, Description: '', instanceId: 'yangusha-item-instance' }
  const match = createMatch({ ...input, catalog: [...catalog, card, item] })
  match.current = 1
  match.players[1].hand = [{ ...card, instanceId: 'yangusha-entry' }]
  match.players[1].deck = [{ ...item }, ...match.players[1].deck]
  match.players[1].mana = 10
  const played = applyCommand(match, 1, { action: 'card.play', data: { cardInstanceId: 'yangusha-entry', payment: 'mana', target: { row: 0, col: 1 } } })
  assert.equal(played.state.players[1].hand[0].instanceId, item.instanceId)
  const equipped = applyCommand(played.state, 1, { action: 'item.equip', data: { cardInstanceId: item.instanceId, targetUnitId: 'unit_1', payment: 'mana' } })
  const state = equipped.state
  state.current = 0
  state.board.find(unit => unit.id === 'unit_1').summoned = 0
  state.board.push({ id: 'yangusha-attacker', card: { ...catalog[1], Name: 'Attacker' }, owner: 0, row: 1, col: 1, health: 5, maxHealth: 5, attack: 5, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })
  const died = applyCommand(state, 0, { action: 'unit.attack', data: { unitId: 'yangusha-attacker', targetUnitId: 'unit_1' } })
  assert.equal(died.state.board.some(unit => unit.id === 'unit_1'), false)
  assert.equal(died.state.players[1].deck[0].instanceId, item.instanceId)
  assert.equal(died.state.players[1].discard.some(card => card.instanceId === item.instanceId), false)
  assert.equal(died.state.players[1].burned.some(card => card.instanceId === item.instanceId), false)
})

test('V1 pays ten health for ranged crown healing and otherwise only heals on adjacent attacks', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'V1')
  const makeMatch = horny => {
    const match = createMatch({ ...input, catalog: [...catalog, card] })
    const instance = { ...card, instanceId: `v1-${horny}` }
    match.players[0].hand = [instance]
    match.players[0].mana = 20
    match.players[0].health = 40
    return applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: instance.instanceId, payment: 'mana', target: { row: 4, col: 2 }, ...(horny ? { horny: true } : {}) } }).state
  }
  const regular = makeMatch(false)
  const powered = makeMatch(true)
  assert.equal(regular.players[0].health, 40)
  assert.equal(powered.players[0].health, 30)
  assert.equal(powered.board.find(unit => unit.card.Name === 'V1').v1RangedCrown, true)

  for (const [match, shouldHeal] of [[regular, false], [powered, true]]) {
    const v1 = match.board.find(unit => unit.card.Name === 'V1')
    v1.health = 2
    v1.summoned = 0
    match.players[0].health = 20
    match.board.push({ id: 'v1-ranged-target', card: { ...catalog[1], Name: 'Target' }, owner: 1, row: 3, col: 3, health: 10, maxHealth: 10, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })
    const attacked = applyCommand(match, 0, { action: 'unit.attack', data: { unitId: v1.id, targetUnitId: 'v1-ranged-target' } }).state
    assert.equal(attacked.board.find(unit => unit.id === v1.id).health, shouldHeal ? 7 : 2)
    assert.equal(attacked.players[0].health, shouldHeal ? 24 : 20)
  }

  const adjacent = makeMatch(false)
  const v1 = adjacent.board.find(unit => unit.card.Name === 'V1')
  v1.health = 2
  v1.row = 3
  v1.summoned = 0
  adjacent.players[0].health = 20
  adjacent.board.push({ id: 'v1-adjacent-target', card: { ...catalog[1], Name: 'Adjacent Target' }, owner: 1, row: 2, col: 2, health: 10, maxHealth: 10, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })
  const healed = applyCommand(adjacent, 0, { action: 'unit.attack', data: { unitId: v1.id, targetUnitId: 'v1-adjacent-target' } }).state
  assert.equal(healed.board.find(unit => unit.id === v1.id).health, 7)
  assert.equal(healed.players[0].health, 24)
})

test('Yellow dies into discard on entry and credits Ilya for its resolved entry effect', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Жёлтый')
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  match.players[0].hand = [{ ...card, instanceId: 'yellow-entry' }]
  match.players[0].mana = 10
  match.board.push({ id: 'ilya-entry', card: realCatalog.find(candidate => candidate.Name === 'Илья_08'), owner: 0, row: 3, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })

  const result = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: 'yellow-entry', payment: 'mana', target: { row: 4, col: 1 } } })

  assert.equal(result.state.board.some(unit => unit.card.Name === 'Жёлтый'), false)
  assert.equal(result.state.players[0].discard[0].instanceId, 'yellow-entry')
  assert.equal(result.state.players[0].burned.some(item => item.instanceId === 'yellow-entry'), false)
  assert.equal(result.state.board.find(unit => unit.card.Name === 'Илья_08').blackTokens, 1)
})

test('Iron Nanny weakens all living enemy creatures on entry', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Железная няня')
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  match.players[0].hand = [{ ...card, instanceId: 'nanny-entry' }]
  match.players[0].mana = 10
  match.board.push(
    { id: 'enemy', card: { ...catalog[1], Name: 'Enemy' }, owner: 1, row: 2, col: 0, health: 4, maxHealth: 4, attack: 3, speed: 2, blackTokens: 0 },
    { id: 'flipped-enemy', card: { ...catalog[2], Name: 'Flipped Enemy' }, owner: 1, row: 2, col: 1, health: 4, maxHealth: 4, attack: 2, speed: 1, flippedTurns: 2, blackTokens: 0 },
    { id: 'ally', card: { ...catalog[3], Name: 'Ally' }, owner: 0, row: 3, col: 0, health: 4, maxHealth: 4, attack: 3, speed: 2, blackTokens: 0 },
    { id: 'building', card: { ...catalog[4], Name: 'Building', Type: 3 }, owner: 1, row: 2, col: 2, health: 4, maxHealth: 4, attack: 0, speed: 0, blackTokens: 0 },
    { id: 'dying-enemy', card: { ...catalog[5], Name: 'Dying Enemy' }, owner: 1, row: 2, col: 3, health: 0, maxHealth: 4, attack: 3, speed: 2, dying: true, blackTokens: 0 },
  )

  const result = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: 'nanny-entry', payment: 'mana', target: { row: 4, col: 1 } } })

  assert.deepEqual([result.state.board.find(unit => unit.id === 'enemy').attack, result.state.board.find(unit => unit.id === 'enemy').speed], [2, 3])
  assert.deepEqual([result.state.board.find(unit => unit.id === 'flipped-enemy').attack, result.state.board.find(unit => unit.id === 'flipped-enemy').speed], [1, 2])
  assert.deepEqual([result.state.board.find(unit => unit.id === 'ally').attack, result.state.board.find(unit => unit.id === 'ally').speed], [3, 2])
  assert.deepEqual([result.state.board.find(unit => unit.id === 'building').attack, result.state.board.find(unit => unit.id === 'building').speed], [0, 0])
  assert.deepEqual([result.state.board.find(unit => unit.id === 'dying-enemy').attack, result.state.board.find(unit => unit.id === 'dying-enemy').speed], [3, 2])
})

test('Barash applies its field debuff and burns when it dies', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Бараш')
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  match.players[0].hand = [{ ...card, instanceId: 'barash-entry' }]
  match.players[0].mana = 10
  match.board.push({ id: 'barash-enemy', card: { ...catalog[1], Name: 'Enemy' }, owner: 1, row: 2, col: 0, health: 4, maxHealth: 4, attack: 3, speed: 2, blackTokens: 0 })
  const played = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: 'barash-entry', payment: 'mana', target: { row: 4, col: 2 } } }).state
  assert.deepEqual([played.board.find(unit => unit.id === 'barash-enemy').attack, played.board.find(unit => unit.id === 'barash-enemy').speed], [1, 6])

  played.current = 1
  played.board.push({ id: 'barash-attacker', card: { ...catalog[0], Name: 'Attacker' }, owner: 1, row: 3, col: 2, health: 5, maxHealth: 5, attack: 10, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })
  const died = applyCommand(played, 1, { action: 'unit.attack', data: { unitId: 'barash-attacker', targetUnitId: 'unit_1' } }).state
  assert.equal(died.board.some(unit => unit.card.Name === 'Бараш'), false)
  assert.equal(died.players[0].burned.filter(item => item.instanceId === 'barash-entry').length, 1)
  assert.equal(died.players[0].discard.some(item => item.instanceId === 'barash-entry'), false)
})

test('Crazy Dummy gains two attack and rush only when its owner controls a building', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Безумный манекен')
  const makeMatch = building => {
    const match = createMatch({ ...input, catalog: [...catalog, card] })
    match.players[0].hand = [{ ...card, instanceId: `dummy-${building}` }]
    match.players[0].mana = 10
    match.players[0].energy = 10
    if (building) match.board.push({ id: 'dummy-building', card: { ...catalog[1], Name: 'Building', Type: 3 }, owner: 0, row: 2, col: 0, health: 5, maxHealth: 5, attack: 0, speed: 0, blackTokens: 0 })
    return applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: `dummy-${building}`, payment: 'mana', target: { row: 4, col: 1 } } }).state
  }
  const withoutBuilding = makeMatch(false)
  const withBuilding = makeMatch(true)
  assert.deepEqual([withoutBuilding.board.find(unit => unit.card.Name === 'Безумный манекен').attack, withoutBuilding.board.find(unit => unit.card.Name === 'Безумный манекен').summoned], [1, 1])
  assert.deepEqual([withBuilding.board.find(unit => unit.card.Name === 'Безумный манекен').attack, withBuilding.board.find(unit => unit.card.Name === 'Безумный манекен').summoned], [3, 0])
  assert.throws(() => applyCommand(withoutBuilding, 0, { action: 'unit.move', data: { unitId: 'unit_1', to: { row: 3, col: 1 } } }), { code: 'UNIT_CANNOT_MOVE' })
  const moved = applyCommand(withBuilding, 0, { action: 'unit.move', data: { unitId: 'unit_1', to: { row: 3, col: 1 } } }).state
  assert.equal(moved.board.find(unit => unit.id === 'unit_1').row, 3)
})

test('Gnome entry buffs the creatures immediately to its left and right', () => {
  const card = realCatalog.find(candidate => candidate.Name === 'Гном')
  const match = createMatch({ ...input, catalog: [...catalog, card] })
  match.players[0].hand = [{ ...card, instanceId: 'gnome-entry' }]
  match.players[0].mana = 10
  match.board.push(
    { id: 'left-creature', card: { ...catalog[1], Name: 'Left' }, owner: 1, row: 4, col: 1, health: 2, maxHealth: 5, attack: 1, speed: 1, blackTokens: 0 },
    { id: 'right-creature', card: { ...catalog[2], Name: 'Right' }, owner: 0, row: 4, col: 3, health: 3, maxHealth: 5, attack: 1, speed: 1, flippedTurns: 1, blackTokens: 0 },
  )

  const result = applyCommand(match, 0, { action: 'card.play', data: { cardInstanceId: 'gnome-entry', payment: 'mana', target: { row: 4, col: 2 } } })

  assert.deepEqual([result.state.board.find(unit => unit.id === 'left-creature').health, result.state.board.find(unit => unit.id === 'left-creature').maxHealth], [4, 7])
  assert.equal(result.state.board.find(unit => unit.id === 'right-creature').attack, 3)
})


test('buffed creatures pay at least one energy to move while originally free creatures remain free', () => {
  for (const base of [0, 1, 3]) {
    const match = createMatch(input)
    const unit = { id: 'energy-floor', card: { ...catalog[0], Speed: base }, owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 1, speed: base - 10, energyCostReduction: 3, summoned: 0, attacks: 0, blackTokens: 0 }
    match.board.push(unit)
    match.players[0].energy = 0
    const command = { action: 'unit.move', data: { unitId: unit.id, to: { row: 3, col: 2 } } }
    if (base !== 0) {
      assert.throws(() => applyCommand(match, 0, command), { code: 'NOT_ENOUGH_ENERGY' })
      assert.equal(match.board[0].row, 4)
      match.players[0].energy = 1
    }
    const result = applyCommand(match, 0, command)
    assert.equal(result.state.board[0].row, 3)
    assert.equal(result.state.players[0].energy, 0)
    assert.equal(projectForPlayer(result.state, 0).public.board[0].card.Speed, base)
  }
})
