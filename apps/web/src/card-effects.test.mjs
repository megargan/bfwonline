import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext as runVm } from 'node:vm'
import { spellDestroysBuilding, spellTargetTransfer } from '../../../packages/game-core/src/card-effects.ts'
import { spellGlobalCreatureDamage } from '../../../packages/game-core/src/card-effects.ts'
import { stripTypeScriptTypes } from 'node:module'
import { abilityCostOnField } from '../../../packages/game-core/src/card-effects.ts'
import { gambaModifierForUnit } from '../../../packages/game-core/src/card-effects.ts'
import { spellFlipOnKill } from '../../../packages/game-core/src/card-effects.ts'
import { spellSavesHandOnCreatureKill } from '../../../packages/game-core/src/card-effects.ts'
import { spellHealsCasterOnCreatureKill } from '../../../packages/game-core/src/card-effects.ts'
import { effectiveUnitSpeed } from '../../../packages/game-core/src/card-effects.ts'
import { burnsOnDeathFromField } from '../../../packages/game-core/src/card-effects.ts'
import { effectiveUnitAttack } from '../../../packages/game-core/src/card-effects.ts'
import { globalFlipTurns } from '../../../packages/game-core/src/card-effects.ts'
import { unitMovementBlocked } from '../../../packages/game-core/src/card-effects.ts'
import { canAttackBoardCard, entryFieldFlipTurns } from '../../../packages/game-core/src/card-effects.ts'
import * as cardEffects from '../../../packages/game-core/src/card-effects.ts'
import { validateDeck } from '../../../packages/game-core/src/deck.ts'
import { randomLegalDeck } from '../../../packages/game-core/src/deck.ts'
import { applyCommand, createMatch } from '../../../packages/game-core/src/match.ts'
import { cardCatalog } from '../../../packages/game-data/src/index.ts'
import { unitCanMoveAndAttack } from '../../../packages/game-core/src/card-effects.ts'
import { creaturePushLine } from '../../../packages/game-core/src/card-effects.ts'
import { applyMovementStateTriggers } from '../../../packages/game-core/src/movement.ts'
import { entryPileDraw, takePileCard, entryResourceGain } from '../../../packages/game-core/src/card-effects.ts'
import { abilityCanTargetPlayer } from '../../../packages/game-core/src/card-effects.ts'
import { spellCanTargetPlayer, discordDramaEffect } from '../../../packages/game-core/src/card-effects.ts'
import { spellDiscardsToOpponent } from '../../../packages/game-core/src/card-effects.ts'

function testApplyMoveCommand(match, seat, command) {
  const state = structuredClone(match)
  for (const player of state.players) {
    player.deck ??= []
    player.hand ??= []
    player.discard ??= []
  }
  const unit = state.board.find(candidate => candidate.id === command.data.unitId)
  const previousRow = unit.row
  unit.row = command.data.to.row
  unit.col = command.data.to.col
  const effects = applyMovementStateTriggers(state, unit, previousRow, seat, effectiveUnitSpeed(unit), destroyed => {
    state.board.splice(state.board.indexOf(destroyed), 1)
    state.players[destroyed.owner].discard.push(destroyed.card)
  })
  state.players[seat].energy -= effectiveUnitSpeed(unit)
  return { state, effects }
}

const testLoadGameCore = async () => ({ applyCommand: testApplyMoveCommand })

test('the opponent-discard spell parser accepts only the cataloged effect', () => {
  assert.equal(spellDiscardsToOpponent('Сбросьте это заклинание в КС противника.'), true)
  assert.equal(spellDiscardsToOpponent('Сбросьте выбранную карту в КС противника.'), false)
})

test('the April spell parser accepts only the cataloged token-swap wording', () => {
  assert.equal(cardEffects.spellSwapsCreatureStats('Выберите 2 существа, они меняются ⚪ и ⚫'), true)
  assert.equal(cardEffects.spellSwapsCreatureStats('Выберите двух существ - они меняются местами'), false)
})

test('the selected-creature stun parser accepts the cataloged spell and its burn line', () => {
  assert.equal(cardEffects.targetedSpellStunTurns('Выбранное существо получает оглушение 10\r\nСжигаеться'), 10)
  assert.equal(cardEffects.targetedSpellStunTurns('Выбранное существо получает оглушение 10 и щит'), null)
})

test('the Auction parser accepts only the full cataloged effect', () => {
  assert.equal(cardEffects.spellAuctionsCreatures('Возьмите все карты существ находящихся на поле, перемешайте. После чего возьмите верхнее существо из получившейся "Колоды". Оно остаёться на сокете владельца, а все остальные умирают.'), true)
  assert.equal(cardEffects.spellAuctionsCreatures('Оставьте случайное существо, а остальные умирают.'), false)
})

test('the White Door parser accepts only its full two-step move effect', () => {
  assert.equal(cardEffects.spellMovesTargetToSocket('Перенесите цель заклинания в выбранный незанятый сокет.'), 'any')
  assert.equal(cardEffects.spellMovesTargetToSocket('Перенесите выбранное существо на любой не занятый сокет противника.'), 'opponent')
  assert.equal(cardEffects.spellMovesTargetToSocket('Перенесите существо на сокет противника.'), null)
})

test('local Auction spell uses the shared parser and keeps the injected survivor', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const spell = source.slice(source.indexOf('function spell('), source.indexOf('function finishSpell('))
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Аукцион')
  const creatures = [0, 1].map(index => ({ id: `unit-${index}`, owner: index, card: { Type: 0, Name: `Unit ${index}` }, dying: false }))
  const boardState = { value: creatures }
  const player = { hand: [card], discard: [], burned: [], nextScoreAdjustment: 0 }
  runInNewContext(stripTypeScriptTypes(`${spell}\nspell(0)`), {
    player: { value: player }, current: { value: 0 }, board: boardState, selection: { value: null }, Math: { floor: Math.floor, max: Math.max, random: () => 0.99 },
    notifyCardPlayed: () => [], applyCardPlayBuff: () => {}, refund: () => assert.fail('targetless spell must not refund'),
    spellNeedsTarget: () => false, clownTargetRequired: () => false, spellDiscardsToOpponent: () => false,
    spellAuctionsCreatures: cardEffects.spellAuctionsCreatures, spellSwapsCreatureStats: () => false,
    targetedSpellFlipTurns: () => null, targetedSpellStunTurns: () => null,
    finishSpell: index => { player.discard.push(player.hand.splice(index, 1)[0]) },
    kill: unit => { boardState.value.splice(boardState.value.indexOf(unit), 1) }, inform: () => assert.fail('spell should resolve'),
  })
  assert.deepEqual(creatures.map(unit => unit.id), ['unit-1'])
  assert.equal(player.discard[0], card)
})

test('local spell play applies the selected-creature stun and uses the normal burn finalizer', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const spell = source.slice(source.indexOf('function spell('), source.indexOf('function finishSpell('))
  const card = { Name: 'Посмотрюка я Стивен ДНД', Type: 2, Cost: 4, Description: 'Выбранное существо получает оглушение 10\r\nСжигаеться' }
  const target = { id: 'target', owner: 1, card: { Type: 0, Name: 'Target' }, stunned: 1, dying: false, flippedTurns: 0 }
  const player = { hand: [card], burned: [], discard: [], nextScoreAdjustment: 0 }
  runInNewContext(stripTypeScriptTypes(`${spell}\nspell(0,target)`), {
    player: { value: player }, current: { value: 0 }, board: { value: [target] }, target, selection: { value: null },
    notifyCardPlayed: () => [], applyCardPlayBuff: () => {}, refund: () => assert.fail('valid target must not refund'),
    spellNeedsTarget: () => true, clownTargetRequired: () => false, spellDiscardsToOpponent: () => false,
    spellSwapsCreatureStats: () => false, targetedSpellFlipTurns: () => null, targetedSpellStunTurns: cardEffects.targetedSpellStunTurns,
    globalFlipTurns: () => null, globalHealingOperation: () => null, playerHealAmount: () => null,
    finishSpell: index => { const played = player.hand.splice(index, 1)[0]; player.burned.push(played) },
    inform: () => assert.fail('valid target must resolve'),
  })
  assert.equal(target.stunned, 11)
  assert.deepEqual(player.burned, [card])
  assert.deepEqual(player.hand, [])
})

function runInNewContext(code, context = {}, options) {
  context.localMovePending ??= { value: false }
  context.localTurnStartResolved ??= { value: false }
  context.localTurnHandSize ??= { value: 0 }
  context.initialLocalTurnPending ??= { value: false }
  context.current ??= { value: 0 }
  context.applyLocalCommand ??= async () => { throw Object.assign(new Error('Use the local fallback in this isolated test'), { code: 'UNSUPPORTED_EFFECT' }) }
  context.effectsForTrigger ??= cardEffects.effectsForTrigger
  context.deathEffectPasses ??= cardEffects.deathEffectPasses
  context.targetedSpellStunTurns ??= cardEffects.targetedSpellStunTurns
  context.spellAuctionsCreatures ??= cardEffects.spellAuctionsCreatures
  context.spellSwapsCreatureStats ??= cardEffects.spellSwapsCreatureStats
  context.spellDiscardsToOpponent ??= cardEffects.spellDiscardsToOpponent
  context.swapCreatureStats ??= cardEffects.swapCreatureStats
  context.attackResolution ??= { value: {
    get depth() { return context.attackResolutionDepth ?? 0 },
    set depth(value) { context.attackResolutionDepth = value },
    pendingDeaths: context.pendingDeaths ?? [],
  } }
  context.queuePendingDeath ??= (state, unit, options, explicitlyDestroyed) => {
    const existing = state.pendingDeaths.find(item => item.unit.id === unit.id)
    if (existing) {
      existing.options.flipTurns ??= options.flipTurns
      existing.options.burn ||= options.burn
      existing.options.killer ??= options.killer
      existing.explicitlyDestroyed ||= explicitlyDestroyed
    } else state.pendingDeaths.push({ unit, options: { ...options }, explicitlyDestroyed })
  }
  return runVm(code, context, options)
}

test('every card still listed in the mechanics audit is tagged and unavailable for deck building', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const audit = readFileSync(new URL('../../../.codex-card-mechanics-audit.md', import.meta.url), 'utf8')
  const unfinished = new Set([...audit.matchAll(/^- \*\*(.*?)\*\*/gmu)].map(([, name]) => name))
  assert.equal(unfinished.size, Number(audit.match(/Эффекты требуют работы: \*\*(\d+) карт\*\*/u)?.[1]))
  assert.deepEqual(cards.filter(card => card.Tags?.includes('в разработке')).map(card => card.Name).sort(), [...unfinished].sort())
  assert.equal(cards.filter(card => !card.Tags?.includes('в разработке')).length, cards.length - unfinished.size)
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  assert.ok(app.split(/\r?\n/u).find(line => line.startsWith('const deckCards=computed(')).includes("if(card.Tags?.includes('в разработке'))return false"))
  assert.ok(app.split(/\r?\n/u).find(line => line.startsWith('function chooseLocalDeck(')).includes('if(!validateDeck(ids,cards))return'))
  assert.equal(validateDeck(cards.filter(card => !card.Tags?.includes('в разработке')).slice(0, 30).map(card => card.Id), cards), false)
  assert.ok(app.split(/\r?\n/u).find(line => line.startsWith('function addToDeck(')).includes("card.Tags?.includes('в разработке')"))
})

test('«Внешний рай» reduces selected allied creature movement energy without dropping below one', () => {
  const unit = { speed: 1, energyCostReduction: 1, shield: false, card: { Name: 'Существо' } }
  assert.equal(effectiveUnitSpeed(unit), 1)
})

test('«Загребущий рой» triggers only for its owner’s creature deaths while on the field', () => {
  const units = [
    { owner: 0, card: { Name: 'Носитель', Type: 0 }, item: { Name: 'Загребущий рой' } },
    { owner: 1, card: { Name: 'Чужой рой', Type: 0 }, dying: false },
    { owner: 0, card: { Name: 'Погибший рой', Type: 0 }, dying: true },
    { owner: 0, card: { Name: 'Здание', Type: 3 }, item: { Name: 'Загребущий рой' } },
  ]
  assert.deepEqual(cardEffects.scavengerSwarmSources(units, 0, 0), [units[0]])
  assert.deepEqual(cardEffects.scavengerSwarmSources(units, 0, 3), [])
})

test('«Загребущий рой» lets its owner choose mana or a card after a creature dies', () => {
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const choose = stripTypeScriptTypes(app.split(/\r?\n/u).find(line => line.startsWith('function chooseSwarmReward(')))
  const kill = app.slice(app.indexOf('function kill('), app.indexOf('function healCreature('))
  assert.match(kill, /queueSwarmDeathReward==='function'\)queueSwarmDeathReward\(u\)/u)
  const owner = { mana: 0, deck: [{ Name: 'Верхняя' }], hand: [] }, pendingSwarmChoice = { value: [0, 0] }
  const context = { pendingSwarmChoice, players: { value: [owner] }, draw: player => player.hand.push(player.deck.shift()), note: () => {} }
  runInNewContext(`${choose}\nchooseSwarmReward(false); chooseSwarmReward(true)`, context)
  assert.equal(owner.mana, 1)
  assert.deepEqual(owner.hand, [{ Name: 'Верхняя' }])
  assert.deepEqual(pendingSwarmChoice.value, [])
})

test('«Загребущий рой» queues a choice only when a creature dies during its owner’s turn', () => {
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const queue = stripTypeScriptTypes(app.split(/\r?\n/u).find(line => line.startsWith('function queueSwarmDeathReward(')))
  const kill = stripTypeScriptTypes(`${app.slice(app.indexOf('function kill('), app.indexOf('function healCreature('))}\n${queue}`)
  const source = { id: 'swarm', owner: 0, card: { Name: 'Носитель', Type: 0 }, item: { Name: 'Загребущий рой' }, dying: false, flippedTurns: 0 }
  const victim = { id: 'victim', owner: 0, card: { Name: 'Жертва', Type: 0, Description: '' }, dying: false, flippedTurns: 0 }
  const run = (current, type) => {
    victim.card.Type = type
    victim.dying = false
    const pendingSwarmChoice = { value: [] }
    runInNewContext(`${kill}\nkill(victim)`, {
      victim, board: { value: [source, victim] }, players: { value: [{ discard: [], burned: [], saved: [], burnedThisTurn: false }, { discard: [], burned: [], saved: [], burnedThisTurn: false }] },
      current: { value: current }, attackResolutionDepth: 0, pendingSwarmChoice,
      scavengerSwarmSources: cardEffects.scavengerSwarmSources, burnsOnDeathFromField, recordBurn: (owner, card) => owner.burned.push(card), hasBurnTrait: () => false,
      effectsForTrigger: () => [], killRewardForCard: () => null, visual: () => {}, note: () => {}, window: { setTimeout: () => {} },
    })
    return pendingSwarmChoice.value
  }
  assert.deepEqual(run(0, 0), [0])
  assert.deepEqual(run(1, 0), [])
  assert.deepEqual(run(0, 3), [])
})

test('«Знаком по ебалу» saves a hand card only when its one damage kills a creature', () => {
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolve = stripTypeScriptTypes(app.split(/\r?\n/u).find(line => line.startsWith('function resolveZnakDamage(')))
  const queue = stripTypeScriptTypes(app.split(/\r?\n/u).find(line => line.startsWith('function queueZnakSave(')))
  const save = stripTypeScriptTypes(app.split(/\r?\n/u).find(line => line.startsWith('function chooseZnakSavedCard(')))
  const calls = []
  const doomed = { card: { Type: 0 }, health: 1, dying: false }
  const survives = { card: { Type: 0 }, health: 2, dying: false }
  const building = { card: { Type: 3 }, health: 1, dying: false }
  const context = { doomed, damage: (target, amount) => { calls.push([target, amount]); target.health -= amount; if (target.health <= 0) target.dying = true } }
  assert.equal(runInNewContext(`${resolve}\nresolveZnakDamage(doomed)`, context), true)
  assert.equal(runInNewContext('resolveZnakDamage(survives)', { ...context, doomed, survives, building }), false)
  assert.equal(runInNewContext('resolveZnakDamage(building)', { ...context, doomed, survives, building }), false)
  assert.deepEqual(calls, [[doomed, 1], [survives, 1], [building, 1]])
  const spell = { Name: 'прочее' }, player = { hand: [spell], saved: [] }, pendingZnakSave = { value: 0 }
  runInNewContext(`${save}\nchooseZnakSavedCard(0)`, { players: { value: [player] }, pendingZnakSave, note: () => {} })
  assert.deepEqual(player.hand, [])
  assert.deepEqual(player.saved, [spell])
  assert.equal(pendingZnakSave.value, null)
  const pending = { value: null }, players = { value: [{ hand: [spell], saved: [] }] }, current = { value: 0 }
  const queueContext = { pendingZnakSave: pending, players, player: { value: players.value[0] }, current }
  runInNewContext(`${queue}\nqueueZnakSave(false)`, queueContext)
  assert.equal(pending.value, null)
  runInNewContext(`${queue}\nqueueZnakSave(true)`, queueContext)
  assert.equal(pending.value, 0)
  players.value[0].hand = []
  pending.value = null
  runInNewContext(`${queue}\nqueueZnakSave(true)`, queueContext)
  assert.equal(pending.value, null)
  assert.match(app, /queueZnakSave\(killed\)/u)
})

test('«Исчезающий парень» dies on entry rolls 1–4 and survives 5–6', () => {
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolve = stripTypeScriptTypes(app.split(/\r?\n/u).find(line => line.startsWith('function resolveDisappearingEntry(')))
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Исчезающий парень')
  const outcomes = []
  for (const roll of [1, 4, 5, 6]) {
    const unit = { card, owner: 0 }, context = { rollGamba: () => roll, players: { value: [{}] }, gambaModifierForUnit: () => 0, kill: target => outcomes.push(target === unit), note: () => {} }
    runInNewContext(`${resolve}\nresolveDisappearingEntry(unit)`, { ...context, unit })
  }
  assert.deepEqual(outcomes, [true, true])
  assert.match(app, /u\.card\.Name==='Исчезающий парень'\)\{resolveDisappearingEntry\(u\);return\}/u)
})

test('«Додеп» rolls its spell, burns a selected hand card, then grants the chosen resource', () => {
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = ['queueDodepReward', 'chooseDodepCard', 'chooseDodepResource'].map(name => stripTypeScriptTypes(app.split(/\r?\n/u).find(line => line.startsWith(name === 'useAbility' ? 'async function useAbility(' : `function ${name}(`)))).join('\n')
  const player = { hand: [{ Name: 'Карта' }], burned: [], saved: [], mana: 0, energy: 0 }, pendingDodep = { value: null }, events = [], notes = []
  const context = { player: { value: player }, players: { value: [player] }, current: { value: 0 }, pendingDodep, rollGamba: () => { events.push('roll'); return 4 }, recordBurn: (owner, card) => { events.push('burn'); owner.burned.push(card); return true }, note: message => notes.push(message) }
  runInNewContext(`${functions}\nqueueDodepReward(0); chooseDodepCard(0); chooseDodepResource('energy')`, context)
  assert.equal(player.energy, 4)
  assert.equal(player.mana, 0)
  assert.equal(player.burned[0].Name, 'Карта')
  assert.equal(player.hand.length, 0)
  assert.equal(pendingDodep.value, null)
  assert.deepEqual(events, ['burn', 'roll'])
  assert.match(app, /c\.Name==='Додеп'/u)
  assert.match(app.split(/\r?\n/u).find(line => line.startsWith('const spellNeedsTarget=')), /card\.Name!=='Додеп'/u)
  const manaPlayer = { hand: [{ Name: 'Плата' }], burned: [], saved: [], mana: 0, energy: 0 }, manaPending = { value: null }
  const manaContext = { players: { value: [manaPlayer] }, current: { value: 0 }, pendingDodep: manaPending, rollGamba: () => 2, recordBurn: () => true, note: () => {} }
  runInNewContext(`${functions}\nqueueDodepReward(0); chooseDodepCard(0); chooseDodepResource('mana')`, manaContext)
  assert.equal(manaPlayer.mana, 2)
  const emptyPending = { value: null }, emptyCalls = { count: 0 }
  runInNewContext(`${functions}\nqueueDodepReward(0)`, { ...manaContext, players: { value: [{ hand: [], mana: 0, energy: 0 }] }, pendingDodep: emptyPending, rollGamba: () => emptyCalls.count++ })
  assert.equal(emptyPending.value, null)
  assert.equal(emptyCalls.count, 0)
})

test('«Индиголит» resolves five independent one-point heals and permits repeating a target', () => {
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const choose = stripTypeScriptTypes(app.split(/\r?\n/u).find(line => line.startsWith('function chooseIndigolitTarget(')))
  const unit = { id: 'ally', owner: 0, card: { Name: 'Существо', Type: 0 }, health: 1, maxHealth: 5, dying: false, flippedTurns: 0 }
  const players = { value: [{ health: 10 }, { health: 10 }] }, board = { value: [unit] }, pendingIndigolit = { value: { owner: 0, remaining: 5 } }
  const healed = [], context = { pendingIndigolit, players, board, healCreature: target => { target.health++; healed.push(target.id) }, heal: player => player.health++, note: () => {}, inform: () => {} }
  runInNewContext(`${choose}\nfor(let i=0;i<4;i++)chooseIndigolitTarget('ally');chooseIndigolitTarget(undefined,1)`, context)
  assert.equal(unit.health, 5)
  assert.equal(players.value[1].health, 11)
  assert.equal(pendingIndigolit.value, null)
  assert.deepEqual(healed, ['ally', 'ally', 'ally', 'ally'])
  assert.match(app, /u\.card\.Name==='Индиголит'\)\{pendingIndigolit\.value=\{owner:effectOwner,remaining:5\}/u)
})

test('typed deck search returns the first matching card and shuffles the remaining deck', () => {
  const creature = { Type: 0, Name: 'Существо' }, item = { Type: 1, Name: 'Предмет' }, spell = { Type: 2, Name: 'Заклинание' }, secondItem = { Type: 1, Name: 'Другой предмет' }
  const deck = [creature, item, spell, secondItem]
  let rolls = 0
  assert.equal(cardEffects.takeAndShufflePileCard(deck, 1, () => { rolls++; return 0 }), item)
  assert.deepEqual(deck, [spell, secondItem, creature])
  assert.equal(rolls, 2)
  const empty = [{ Type: 0, Name: 'Существо' }]
  assert.equal(cardEffects.takeAndShufflePileCard(empty, 1, () => assert.fail('No card was found, so no shuffle should happen')), null)
  assert.deepEqual(empty, [{ Type: 0, Name: 'Существо' }])
})

test('«ИНТИВИ» takes a shuffled typed draw on death and may discard the item afterwards', () => {
  assert.deepEqual(cardEffects.effectsForTrigger('ИНТИВИ', 'death'), [{ kind: 'take-item-from-deck' }])
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const choose = stripTypeScriptTypes(app.split(/\r?\n/u).find(line => line.startsWith('function chooseIntiviDiscard(')))
  const item = { Type: 1, Name: 'Предмет' }, owner = { hand: [item], discard: [] }, pendingIntivi = { value: [{ owner: 0, card: item }] }
  runInNewContext(`${choose}\nchooseIntiviDiscard(false)`, { pendingIntivi, players: { value: [owner] }, note: () => {} })
  assert.deepEqual(owner.hand, [item])
  assert.equal(pendingIntivi.value.length, 0)
  pendingIntivi.value = [{ owner: 0, card: item }]
  runInNewContext(`${choose}\nchooseIntiviDiscard(true)`, { pendingIntivi, players: { value: [owner] }, note: () => {} })
  assert.deepEqual(owner.hand, [])
  assert.deepEqual(owner.discard, [item])
  assert.equal(pendingIntivi.value.length, 0)
  const kill = stripTypeScriptTypes(app.slice(app.indexOf('function kill('), app.indexOf('function healCreature(')))
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(entry => entry.Name === 'ИНТИВИ')
  const unit = { id: 'intivi', card, owner: 0, dying: false, flippedTurns: 0 }, deck = [{ Type: 0, Name: 'Существо' }, item, { Type: 2, Name: 'Заклинание' }]
  const player = { deck, hand: [], discard: [], burned: [], saved: [], burnedThisTurn: false }, queued = { value: [] }
  runInNewContext(`${kill}\nkill(unit)`, { unit, board: { value: [unit] }, players: { value: [player] }, current: { value: 0 }, attackResolutionDepth: 0, pendingIntivi: queued,
    burnsOnDeathFromField: () => false, recordBurn: () => true, hasBurnTrait: () => false, effectsForTrigger: cardEffects.effectsForTrigger,
    takeAndShufflePileCard: cardEffects.takeAndShufflePileCard, takePileCard, killRewardForCard: cardEffects.killRewardForCard,
    note: () => {}, visual: () => {}, window: { setTimeout: () => {} },
  })
  assert.deepEqual(player.hand, [item])
  assert.equal(queued.value.length, 1)
  assert.equal(deck.length, 2)
})

test('«Зелёная» rolls at the start of its owner turn for team healing or enemy damage', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(card => card.Name === 'Зелёная')
  assert.ok(card)
  assert.deepEqual(cardEffects.startTurnEffect(card.Description), {
    scope: 'owner-turn',
    operations: [{ kind: 'gamba-heal-allies-or-damage-enemies', amount: 1, healingRolls: [1, 3, 5] }],
  })
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolve = source.split(/\r?\n/u).find(line => line.startsWith('function resolveGreenGamba('))
  assert.ok(resolve)
  const ally = { owner: 0, card: { Type: 0 } }, enemy = { owner: 1, card: { Type: 0 } }
  const board = { value: [ally, enemy] }, heals = [], damages = [], playerHeals = [], playerHits = []
  let roll = 3
  const context = { board, rollGamba: () => roll, gambaModifierForUnit: () => 0, healCreature: (...args) => heals.push(args), heal: (...args) => playerHeals.push(args), damage: (...args) => damages.push(args), hitPlayer: (...args) => playerHits.push(args), players: { value: ['p0', 'p1'] }, note: () => {} }
  runInNewContext(`${stripTypeScriptTypes(resolve)};resolveGreenGamba({owner:0,card:{Name:'Зелёная'}},{amount:1,healingRolls:[1,3,5]})`, context)
  assert.equal(heals.length, 1)
  assert.equal(playerHeals.length, 1)
  assert.equal(damages.length, 0)
  assert.equal(playerHits.length, 0)
  roll = 2
  runInNewContext(`resolveGreenGamba({owner:0,card:{Name:'Зелёная'}},{amount:1,healingRolls:[1,3,5]})`, context)
  assert.equal(damages.length, 1)
  assert.deepEqual(playerHits[0], ['p1', 1])
})

test('«Хиро» restores three health to the entry effect owner', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(card => card.Name === 'Хиро')
  assert.ok(card)
  assert.equal(cardEffects.entryPlayerHealAmount(card.Description), 3)
  assert.equal(cardEffects.supportedEntryEffect(card.Description), true)
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  assert.match(source, /entryPlayerHealAmount\(description\)/)
  assert.match(source, /heal\(owner,playerHeal\)/)
})

test('«Фраус Бункер» discards the whole entry effect owner hand through normal discard handling', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(card => card.Name === 'Фраус Бункер')
  assert.ok(card)
  assert.equal(cardEffects.entryDiscardsEntireHand(card.Description), true)
  assert.equal(cardEffects.supportedEntryEffect(card.Description), true)
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const discard = source.split(/\r?\n/u).find(line => line.startsWith('function discardEntireHand('))
  assert.ok(discard)
  const hand = [{ Description: '' }, { Description: '' }], discarded = [], healed = [], drawn = []
  runInNewContext(`${stripTypeScriptTypes(discard)};discardEntireHand(owner)`, {
    owner: { hand, discard: discarded, burned: [] }, takeCardFromHand: cardEffects.takeCardFromHand,
    heal: amount => healed.push(amount), draw: count => drawn.push(count), recordBurn: () => assert.fail('Discard must not burn cards'),
  })
  assert.equal(hand.length, 0)
  assert.equal(discarded.length, 2)
  assert.deepEqual(healed, [])
  assert.deepEqual(drawn, [])
  assert.match(source, /entryDiscardsEntireHand\(description\)/)
})

test('«Хаешка» parses its 3×3 creature damage area despite the catalog typo', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(card => card.Name === 'Хаешка')
  assert.ok(card)
  assert.deepEqual(cardEffects.spellAreaDamage(card.Description), { amount: 3, height: 3, width: 3 })
  const center = { row: 2, col: 2 }
  const units = [
    { id: 'center', row: 2, col: 2, card: { Type: 0 } },
    { id: 'edge', row: 1, col: 3, card: { Type: 0 } },
    { id: 'outside', row: 0, col: 2, card: { Type: 0 } },
    { id: 'building', row: 2, col: 3, card: { Type: 3 } },
    { id: 'flipped', row: 3, col: 2, flippedTurns: 1, card: { Type: 0 } },
    { id: 'dying', row: 2, col: 1, dying: true, card: { Type: 0 } },
  ]
  assert.deepEqual(cardEffects.spellAreaTargets(units, center, 3, 3).map(unit => unit.id), ['center', 'edge'])
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  assert.match(source, /spellAreaDamage\(text\)/)
  assert.match(source, /spellAreaTargets\(board\.value,target,height,width\)/)
})

test('@everyone recognizes only the standalone global creature damage effect', () => {
  assert.equal(spellGlobalCreatureDamage('Нанесите 1 урон всем существам на поле'), 1)
  assert.equal(spellGlobalCreatureDamage('Нанесите 1 урон всем существам на поле и возьмите карту'), null)
})

test('Город без души requires a building target', () => {
  assert.equal(spellDestroysBuilding('Уничтожьте здание.'), true)
  assert.equal(spellDestroysBuilding('Уничтожьте здание и возьмите карту.'), false)
})

test('Кик and Мут identify only the selected-card transfer wording', () => {
  assert.equal(spellTargetTransfer('Сбросьте выбранное существо или здание.'), 'discard')
  assert.equal(spellTargetTransfer('Верните выбранную карту обратно в руку.'), 'hand')
  assert.equal(spellTargetTransfer('Верните выбранную карту обратно в руку и возьмите карту.'), null)
})

test('«Схизм» entry selects one card and deals three damage to it', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(card => card.Name === 'Схизм')
  assert.ok(card)
  assert.deepEqual(cardEffects.entryTargetOperation(card.Description), { kind: 'damage-target', amount: 3 })
  assert.equal(cardEffects.entryCanTargetPlayer(card.Description, 0, 0), true)
  assert.equal(cardEffects.entryCanTargetPlayer(card.Description, 4, 0), false)
  assert.equal(cardEffects.entryCanTargetPlayer(card.Description, 4, 1), true)
  assert.equal(cardEffects.entryCanTargetPlayer(card.Description, 0, 1), false)
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const candidates = source.split(/\r?\n/u).find(line => line.startsWith('function entryTargetCandidates('))
  assert.ok(candidates)
  const unit = { id: 'source', owner: 0, row: 0, dying: false, card: { Type: 0, Description: card.Description } }
  const target = { id: 'target', owner: 1, dying: false, card: { Type: 0 } }
  const dying = { ...target, id: 'dying', dying: true }
  const operation = cardEffects.entryTargetOperation(card.Description)
  assert.deepEqual(runInNewContext(`${stripTypeScriptTypes(candidates)};entryTargetCandidates(source,operation).map(unit=>unit.id)`, { source: unit, operation, board: { value: [unit,target,dying] } }), ['target'])
  assert.match(source, /operation\.kind==='damage-target'/)
  assert.match(source, /damage\(target,operation\.amount,\{killer:source\}\)/)
  const faceResolver = source.split(/\r?\n/u).find(line => line.startsWith('function resolveEntryPlayer('))
  assert.ok(faceResolver)
  const opponent = { health: 30 }, pending = { value: { id: 'source', resolved: false } }, selection = { value: { kind: 'entry', id: 'source' } }, finished = []
  runInNewContext(`${stripTypeScriptTypes(faceResolver)};resolveEntryPlayer('source',players.value[1],0)`, {
    board: { value: [unit] }, players: { value: [{}, opponent] }, current: { value: 0 }, selection, pendingEntryTokenGain: pending,
    entryTargetOperation: cardEffects.entryTargetOperation, entryCanTargetPlayer: cardEffects.entryCanTargetPlayer,
    unitDescription: current => current.card.Description, clownTargetRequired: () => false,
    hitPlayer: (player, amount) => { player.health -= amount }, note: () => {}, finishEntryFollowup: current => finished.push(current.id), inform: message => assert.fail(message),
  })
  assert.equal(opponent.health, 27)
  assert.equal(pending.value.resolved, true)
  assert.equal(selection.value, null)
  assert.deepEqual(finished, ['source'])
})

test('«Ветки» queues one enemy target for each non-limit draw and skips hand-limit draws', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const draw = source.split(/\r?\n/u).find(line => line.startsWith('function draw('))
  const queue = source.split(/\r?\n/u).find(line => line.startsWith('function queueBranchTargets('))
  assert.ok(draw && queue)
  const branch = { owner: 0, dying: false, flippedTurns: 0, card: { Name: 'Ветки', Type: 3 } }
  const enemy = { id: 'enemy', owner: 1, dying: false, card: { Name: 'Враг', Type: 0 } }
  const player = { deck: [{ Name: 'Карта' }], hand: [] }
  const players = { value: [player, {}] }, board = { value: [branch, enemy] }, pendingBranchTargets = { value: [] }
  const context = { players, board, pendingBranchTargets }
  runInNewContext(`${stripTypeScriptTypes(queue + '\n' + draw)};draw(players.value[0]);draw(players.value[0],true)`, context)
  assert.deepEqual(pendingBranchTargets.value, [0])
  assert.equal(player.hand.length, 1)
})

test('«Ветки» damages only the selected enemy card and consumes one queued trigger', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolve = source.split(/\r?\n/u).find(line => line.startsWith('function chooseBranchTarget('))
  const enemy = { id: 'enemy', owner: 1, card: { Name: 'Враг' } }
  const board = { value: [enemy] }, pendingBranchTargets = { value: [0] }, hits = [], notes = []
  runInNewContext(`${stripTypeScriptTypes(resolve)};chooseBranchTarget('enemy')`, { board, pendingBranchTargets, damage: (unit, amount) => hits.push([unit.id, amount]), note: value => notes.push(value) })
  assert.deepEqual(hits, [['enemy', 1]])
  assert.deepEqual(pendingBranchTargets.value, [])
})

test('«1 апреля» exchanges creature combat stats, energy reduction, tokens and tracked stat buffs', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const exchange = source.split(/\r?\n/u).find(line => line.startsWith('function swapAprilStats('))
  assert.ok(exchange)
  const first = { attack: 4, health: 7, maxHealth: 9, speed: 3, energyCostReduction: 1, blackTokens: 2, typeTokens: [1, 2], temporaryAttack: 1, temporaryHealth: 2, temporaryHealthExpiresAt: 4, doggoBuffs: 1, cardPlayBuffs: 2 }
  const second = { attack: 8, health: 3, maxHealth: 5, speed: 1, energyCostReduction: 0, blackTokens: 0, typeTokens: [3, 4], temporaryAttack: 0, temporaryHealth: 0, temporaryHealthExpiresAt: 0, doggoBuffs: 0, cardPlayBuffs: 0 }
  runInNewContext(`${stripTypeScriptTypes(exchange)};swapAprilStats(first,second)`, { first, second })
  assert.deepEqual(first, { attack: 8, health: 3, maxHealth: 5, speed: 1, energyCostReduction: 0, blackTokens: 0, typeTokens: [3, 4], temporaryAttack: 0, temporaryHealth: 0, temporaryHealthExpiresAt: 0, doggoBuffs: 0, cardPlayBuffs: 0 })
  assert.deepEqual(second, { attack: 4, health: 7, maxHealth: 9, speed: 3, energyCostReduction: 1, blackTokens: 2, typeTokens: [1, 2], temporaryAttack: 1, temporaryHealth: 2, temporaryHealthExpiresAt: 4, doggoBuffs: 1, cardPlayBuffs: 2 })
})

test('«1 апреля» only resolves after choosing a distinct living creature', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = ['swapAprilStats', 'chooseAprilTarget'].map(name => source.split(/\r?\n/u).find(line => line.startsWith(`function ${name}(`))).join('\n')
  const first = { id: 'first', owner: 0, card: { Name: 'Первое', Type: 0 }, attack: 2, health: 2, maxHealth: 4, speed: 1, energyCostReduction: 0, blackTokens: 0, typeTokens: [1] }
  const second = { id: 'second', owner: 1, card: { Name: 'Второе', Type: 0 }, attack: 4, health: 3, maxHealth: 3, speed: 2, energyCostReduction: 1, blackTokens: 2, typeTokens: [0, 3] }
  const pendingApril = { value: { index: 0, firstId: 'first' } }, completed = []
  const context = { pendingApril, board: { value: [first, second] }, finishSpell: (index, note) => completed.push([index, note]) }
  runInNewContext(`${stripTypeScriptTypes(functions)};chooseAprilTarget('first');if(pendingApril.value)chooseAprilTarget('second')`, context)
  assert.equal(first.attack, 4)
  assert.equal(second.attack, 2)
  assert.equal(pendingApril.value, null)
  assert.equal(completed.length, 1)
})

test('«Гнилое ворьё» steals up to the chosen resource amount and never takes below zero', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Гнилое ворьё')
  const resolve = source.split(/\r?\n/u).find(line => line.startsWith('function chooseRottenThief('))
  assert.ok(resolve)
  assert.equal(hasBurnTrait(card.Description), true)
  assert.match(source.split(/\r?\n/u).find(line => line.startsWith('const spellNeedsTarget=')), /card.Name!=='Гнилое ворьё'/u)
  assert.ok(source.includes("if(c.Name==='Гнилое ворьё'){pendingRottenThief.value={index:i}"))
  const player = { mana: 0, energy: 0 }, opponent = { mana: 1, energy: 6 }
  const pendingRottenThief = { value: { index: 2 } }, finished = []
  const context = { player: { value: player }, players: { value: [player, opponent] }, current: { value: 0 }, pendingRottenThief, finishSpell: (index, detail) => finished.push([index, detail]) }
  runInNewContext(`${stripTypeScriptTypes(resolve)};chooseRottenThief('mana');pendingRottenThief.value={index:3};chooseRottenThief('energy')`, context)
  assert.deepEqual([player.mana, opponent.mana, player.energy, opponent.energy], [1, 0, 4, 2])
  assert.equal(finished.length, 2)
  assert.equal(pendingRottenThief.value, null)
})

test('«Бёрдли» adds two to the owner’s next gamba only and stacks with unit modifiers', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const grant = source.split(/\r?\n/u).find(line => line.startsWith('function grantBirdliGambaBonus('))
  const roll = source.split(/\r?\n/u).find(line => line.startsWith('function rollGamba('))
  assert.ok(grant && roll)
  const owner = { nextGambaBonus: 0 }
  const values = [0, 0]
  const context = { owner, Math: { floor: Math.floor, random: () => values.shift() }, adjustGambaRoll, note: () => {} }
  runInNewContext(`${stripTypeScriptTypes(grant + '\n' + roll)};grantBirdliGambaBonus(owner);owner.first=rollGamba(owner,1);owner.second=rollGamba(owner,1)`, context)
  assert.deepEqual([owner.first, owner.second, owner.nextGambaBonus], [4, 2, 0])
  assert.match(source.split(/\r?\n/u).find(line => line.startsWith('function entry(')), /grantBirdliGambaBonus\(owner\)/u)
})

test('«Бёрдли» stays flipped for three owner turns after death, then goes to discard', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const kill = source.slice(source.indexOf('function kill('), source.indexOf('function healCreature('))
  const tick = source.split(/\r?\n/u).find(line => line.startsWith('function tickBirdliDeathFlip('))
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Бёрдли')
  const item = { Name: 'Предмет' }, unit = { id: 'birdli', card, item, owner: 0, health: 0, flippedTurns: 0, dying: false }
  const board = { value: [unit] }, owner = { discard: [], burned: [], saved: [] }
  runInNewContext(`${stripTypeScriptTypes(kill)};kill(unit)`, {
    unit, board, players: { value: [owner, {}] }, current: { value: 0 }, attackResolutionDepth: 0,
    burnsOnDeathFromField: () => false, visual: () => {}, note: () => {},
  })
  assert.equal(unit.flippedTurns, 3)
  assert.equal(unit.birdliDeathFlip, true)
  assert.deepEqual(owner.discard, [])
  for (const remaining of [2, 1]) {
    runInNewContext(`${stripTypeScriptTypes(tick)};tickBirdliDeathFlip(unit,owner)`, { unit, owner, board, note: () => {} })
    assert.equal(unit.flippedTurns, remaining)
    assert.deepEqual(owner.discard, [])
  }
  runInNewContext(`${stripTypeScriptTypes(tick)};tickBirdliDeathFlip(unit,owner)`, { unit, owner, board, note: () => {} })
  assert.deepEqual(board.value, [])
  assert.deepEqual(owner.discard, [card, item])
})

test('«Новички» gives three energy before round ten and saves a selected hand spell from round ten onward', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const death = source.split(/\r?\n/u).find(line => line.startsWith('function resolveNewcomersDeath('))
  const choose = source.split(/\r?\n/u).find(line => line.startsWith('function chooseNewcomersSpell('))
  assert.ok(death && choose)
  const spell = { Id: 'spell', Name: 'Чары', Type: 2 }, creature = { Id: 'creature', Type: 0 }
  const owner = { energy: 0, hand: [spell, creature], saved: [] }, players = { value: [owner] }, pendingNewcomers = { value: null }
  const context = { players, round: { value: 9 }, pendingNewcomers, inform: () => {}, note: () => {} }
  runInNewContext(`${stripTypeScriptTypes(death)};resolveNewcomersDeath(0)`, context)
  assert.equal(owner.energy, 3)
  context.round.value = 10
  runInNewContext(`${stripTypeScriptTypes(death)};${stripTypeScriptTypes(choose)};resolveNewcomersDeath(0);chooseNewcomersSpell(0)`, context)
  assert.deepEqual(owner.saved, [spell])
  assert.deepEqual(owner.hand, [creature])
  assert.equal(pendingNewcomers.value, null)
})

test('«Герсон Бум» ability requires allied Suzy, damages an enemy card, then burns itself', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  assert.match(source, /u\.card\.Name==='Герсон Бум'&&!board\.value\.some\(x=>x\.owner===u\.owner&&x\.card\.Name==='Сьюзи'/u)
  assert.match(source, /if\(u\.card\.Name==='Герсон Бум'\)\{if\(!target\|\|target\.owner===u\.owner\)/u)
  assert.match(source, /damage\(target,15,\{killer:u\}\);kill\(u,\{burn:true\}\)/u)
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Герсон Бум')
  assert.deepEqual(cardEffects.targetedAbilityOperation(card.Description), { kind: 'damage-target', amount: 15 })
})

test('damage abilities can target opponent health only from enemy home row unless card text restricts target', () => {
  const generic = 'Способность 3: Наносит 5 урона.'
  assert.equal(abilityCanTargetPlayer(generic, 0, true, 'Стрелок'), true)
  assert.equal(abilityCanTargetPlayer(generic, 0, false, 'Стрелок'), false)
  assert.equal(abilityCanTargetPlayer('Способность 3: Наносит 5 урона выбранному существу.', 0, true, 'Стрелок'), false)
  assert.equal(abilityCanTargetPlayer(generic, 0, true, 'Герсон Бум'), false)
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolve = source.split(/\r?\n/u).find(line => line.startsWith('function resolveAbility('))
  const canChoose = source.split(/\r?\n/u).find(line => line.startsWith('function canAbilityChoosePlayer('))
  const unit = { id: 'shooter', owner: 0, row: 4, abilityUsed: false, card: { Name: 'Стрелок' } }
  const owner = {}, opponent = { health: 20 }, players = { value: [owner, opponent] }, hit = [], spent = [], selection = { value: { kind: 'ability', id: 'shooter' } }
  const context = { unit, opponent, board: { value: [unit] }, players, enemyRow: { value: 4 }, unitDescription: () => generic, abilityDescription: () => generic,
    abilityCost: () => 3, targetedAbilityOperation: cardEffects.targetedAbilityOperation, abilityCanTargetPlayer, active: () => true,
    isRepeatableAbility: () => false, canPayAbility: () => true, payAbility: (...args) => spent.push(args), hitPlayer: (...args) => hit.push(args),
    localCoreChoice: { value: null }, clownTargetRequired: () => false, visual: () => {}, selection, note: () => {}, inform: () => {}, movementIsBlocked: () => false }
  assert.equal(runInNewContext(`${stripTypeScriptTypes(canChoose)};canAbilityChoosePlayer(opponent)`, context), true)
  assert.match(resolve, /playerTarget!==players\.value\[1-u\.owner\]\|\|!abilityCanTargetPlayer/u)
  runInNewContext(`${stripTypeScriptTypes(resolve)};resolveAbility(unit.id,-1,-1,undefined,0,opponent)`, context)
  assert.deepEqual(spent, [[unit, 3, 0]])
  assert.deepEqual(hit, [[opponent, 5]])
  assert.equal(selection.value, null)
})

test('generic damage spells may target opponent health, while card-specific damage keeps its restriction', () => {
  assert.equal(spellCanTargetPlayer('Нанесите 5 урона выбранной цели.'), true)
  assert.equal(spellCanTargetPlayer('Нанесите 5 урона выбранной карте.'), false)
  assert.equal(spellCanTargetPlayer('Нанесите 5 урона выбранному существу.'), false)
  assert.equal(spellCanTargetPlayer('Нанесите 5 урона всем существам на поле.'), false)
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  assert.match(source.split(/\r?\n/u).find(line => line.startsWith('function canChoosePlayer(')), /spellCanTargetPlayer\(card\.Description\)/u)
  assert.ok(source.includes('damageAmount!==null&&(effectCanTargetPlayer(text)||spellCanTargetPlayer(text))'))
})

test('«Рудбастер» deals 10 damage to a selected card or the opponent player', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Рудбастер')
  assert.equal(cardEffects.selectedTargetDamage(card.Description), 10)
  assert.equal(spellCanTargetPlayer(card.Description), true)
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const spell = source.slice(source.indexOf('function spell('), source.indexOf('function finishSpell('))
  const needsTarget = source.split(/\r?\n/u).find(line => line.startsWith('const spellNeedsTarget='))
  const player = { hand: [card], nextScoreAdjustment: 0 }, opponent = { health: 45 }
  const target = { id: 'target', card: { Name: 'Существо', Type: 0 }, owner: 1, health: 16, dying: false, flippedTurns: 0 }
  const context = { ...cardEffects, player: { value: player }, players: { value: [player, opponent] }, current: { value: 0 }, board: { value: [target] }, target,
    notifyCardPlayed: () => [], clownTargetRequired: () => false, damage: (unit, amount) => { unit.health -= amount },
    hitPlayer: (unit, amount) => { unit.health -= amount }, finishSpell: index => player.hand.splice(index, 1), refund: () => assert.fail('A valid target must resolve'), inform: message => assert.fail(message), coord: () => '' }
  runInNewContext(`${stripTypeScriptTypes(needsTarget)}\n${stripTypeScriptTypes(spell)}\nspell(0,target)`, context)
  assert.equal(target.health, 6)
  assert.deepEqual(player.hand, [])
  player.hand = [card]
  runInNewContext('spell(0,undefined,undefined,undefined,players.value[1])', context)
  assert.equal(opponent.health, 35)
  assert.deepEqual(player.hand, [])
})

test('«Подстава» needs no field target and sends itself to the opponent discard pile', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Подстава')
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const spell = source.slice(source.indexOf('function spell('), source.indexOf('function finishSpell('))
  const needsTarget = source.split(/\r?\n/u).find(line => line.startsWith('const spellNeedsTarget='))
  const finish = source.split(/\r?\n/u).find(line => line.startsWith('function finishSpell('))
  const player = { hand: [card], discard: [], burned: [], nextScoreAdjustment: 0 }, opponent = { discard: [] }
  const context = { ...cardEffects, player: { value: player }, enemy: { value: opponent }, players: { value: [player, opponent] }, current: { value: 0 }, board: { value: [] },
    freePlayCardId: { value: null }, pendingCrownSavedSpell: { value: null }, selection: { value: null },
    notifyCardPlayed: () => [], visual: () => {}, note: () => {}, refund: () => assert.fail('This target-free spell must not refund'), inform: message => assert.fail(message) }
  assert.equal(runInNewContext(`${stripTypeScriptTypes(needsTarget)};spellNeedsTarget(card)`, { ...cardEffects, card, board: { value: [] } }), false)
  runInNewContext(`${stripTypeScriptTypes(needsTarget)}\n${stripTypeScriptTypes(spell)}\n${stripTypeScriptTypes(finish)}\nspell(0)`, context)
  assert.deepEqual(player.hand, [])
  assert.deepEqual(player.discard, [])
  assert.deepEqual(player.burned, [])
  assert.deepEqual(opponent.discard, [card])
  assert.equal(player.played, true)
})

test('«Ого какой большой огурец» offers only deck cards costing at least eight', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Ого какой большой огурец')
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const spell = source.slice(source.indexOf('function spell('), source.indexOf('function finishSpell('))
  const needsTarget = source.split(/\r?\n/u).find(line => line.startsWith('const spellNeedsTarget='))
  const choose = source.split(/\r?\n/u).find(line => line.startsWith('function chooseHighCostCard('))
  const high = { Id: 'high', Name: 'Дорогая карта', Cost: 8 }, low = { Id: 'low', Name: 'Дешёвая карта', Cost: 7 }
  const player = { hand: [card], deck: [high, low], discard: [], nextScoreAdjustment: 0 }
  const pendingHighCostSearch = { value: null }, selection = { value: null }
  const context = { ...cardEffects, player: { value: player }, players: { value: [player, {}] }, current: { value: 0 }, board: { value: [] }, pendingHighCostSearch, selection,
    notifyCardPlayed: () => [], clownTargetRequired: () => assert.fail('The search spell does not select a target'),
    finishSpell: index => { player.discard.push(player.hand.splice(index, 1)[0]) }, refund: () => assert.fail('The search spell should resolve'), inform: () => {} }
  assert.equal(runInNewContext(`${stripTypeScriptTypes(needsTarget)};spellNeedsTarget(card)`, { ...cardEffects, card, board: { value: [] } }), false)
  runInNewContext(`${stripTypeScriptTypes(needsTarget)}\n${stripTypeScriptTypes(spell)}\n${choose ? stripTypeScriptTypes(choose) : ''}\nspell(0)`, context)
  assert.deepEqual(JSON.parse(JSON.stringify(pendingHighCostSearch.value)), { handIndex: 0, deckIndexes: [0] })
  runInNewContext('chooseHighCostCard(1)', context)
  assert.deepEqual(player.deck, [high, low])
  runInNewContext('chooseHighCostCard(0)', context)
  assert.deepEqual(player.deck, [low])
  assert.deepEqual(player.hand, [high])
  assert.deepEqual(player.discard, [card])
  assert.equal(pendingHighCostSearch.value, null)
  player.hand = [card]
  player.deck = [low]
  runInNewContext('spell(0)', context)
  assert.equal(pendingHighCostSearch.value, null)
  assert.deepEqual(player.deck, [low])
  assert.deepEqual(player.discard, [card, card])
})

test('«Разбан» returns the chosen burned card to hand and burns itself', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Разбан')
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const spell = source.slice(source.indexOf('function spell('), source.indexOf('function finishSpell('))
  const needsTarget = source.split(/\r?\n/u).find(line => line.startsWith('const spellNeedsTarget='))
  const choose = source.split(/\r?\n/u).find(line => line.startsWith('function chooseBurnedCard('))
  const first = { Id: 'burned-1', Name: 'Сожжённая карта 1' }, second = { Id: 'burned-2', Name: 'Сожжённая карта 2' }
  const player = { hand: [card], burned: [first, second], discard: [], nextScoreAdjustment: 0 }
  const pendingBurnedSearch = { value: null }, selection = { value: null }
  const context = { ...cardEffects, player: { value: player }, players: { value: [player, {}] }, current: { value: 0 }, board: { value: [] }, pendingBurnedSearch, selection,
    notifyCardPlayed: () => [], clownTargetRequired: () => assert.fail('The spell does not target a field card'),
    finishSpell: index => cardEffects.finishSpellFromHand(player.hand, player.discard, player.burned, index, () => {}, () => {}),
    refund: () => assert.fail('The spell should resolve'), inform: () => {} }
  assert.equal(runInNewContext(`${stripTypeScriptTypes(needsTarget)};spellNeedsTarget(card)`, { ...cardEffects, card, board: { value: [] } }), false)
  runInNewContext(`${stripTypeScriptTypes(needsTarget)}\n${stripTypeScriptTypes(spell)}\n${choose ? stripTypeScriptTypes(choose) : ''}\nspell(0)`, context)
  assert.deepEqual(JSON.parse(JSON.stringify(pendingBurnedSearch.value)), { handIndex: 0, burnedIndexes: [0, 1] })
  runInNewContext('chooseBurnedCard(2)', context)
  assert.deepEqual(player.burned, [first, second])
  runInNewContext('chooseBurnedCard(1)', context)
  assert.deepEqual(player.hand, [second])
  assert.deepEqual(player.burned, [first, card])
  assert.deepEqual(player.discard, [])
  assert.equal(pendingBurnedSearch.value, null)
  player.hand = [card]
  player.burned = []
  runInNewContext('spell(0)', context)
  assert.equal(pendingBurnedSearch.value, null)
  assert.deepEqual(player.hand, [])
  assert.deepEqual(player.burned, [card])
})

test('«Дискорд драма» spends its chosen mana damage and doubles player damage only when score exceeds seven', () => {
  const description = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Дискорд драма').Description
  assert.deepEqual(discordDramaEffect(description, 2, 'card', 7), { canTargetPlayer: false, damage: 2 })
  assert.deepEqual(discordDramaEffect(description, 2, 'player', 8), { canTargetPlayer: true, damage: 4 })
  assert.deepEqual(discordDramaEffect(description, 2, 'card', 8), { canTargetPlayer: true, damage: 2 })
  assert.deepEqual(discordDramaEffect(description, 2, 'player', 8, 1), { canTargetPlayer: false, damage: 2 })
})

test('«Дискорд драма» charges selected mana and resolves damage against the chosen card or enemy player', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolve = source.split(/\r?\n/u).find(line => line.startsWith('function finishDiscordDrama('))
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Дискорд драма')
  const player = { hand: [card, ...Array.from({ length: 7 }, () => ({ Type: 0 }))], mana: 8, nextScoreAdjustment: 0 }, opponent = { health: 45 }
  const target = { id: 'target', health: 9, dying: false, flippedTurns: 0 }, pendingDiscordDrama = { value: { index: 0, targetId: 'target', amount: 3, scoreMet: true } }
  const completed = [], context = { pendingDiscordDrama, player: { value: player }, players: { value: [player, opponent] }, current: { value: 0 }, board: { value: [target] }, discordDramaEffect,
    damage: (unit, amount) => { unit.health -= amount }, hitPlayer: (who, amount) => { who.health -= amount }, finishSpell: index => completed.push(index), inform: message => assert.fail(message) }
  runInNewContext(`${stripTypeScriptTypes(resolve)};finishDiscordDrama()`, context)
  assert.equal(player.mana, 5)
  assert.equal(target.health, 6)
  assert.equal(pendingDiscordDrama.value, null)
  assert.deepEqual(completed, [0])
  pendingDiscordDrama.value = { index: 0, playerTarget: 1, amount: 2, scoreMet: true }
  runInNewContext('finishDiscordDrama()', context)
  assert.equal(player.mana, 3)
  assert.equal(opponent.health, 41)
  assert.deepEqual(completed, [0, 0])
})

test('«Горящий тромбик» death queues one flipped card for its owner to burn', () => {
  assert.deepEqual(effectsForTrigger('Горящий тромбик', 'death'), [{ kind: 'burn-flipped-card' }])
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Горящий тромбик')
  assert.ok(card.Description.includes('Сжигает перевёрнутую карту'))
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = ['resolveBurnFlippedEffect', 'canChooseBurnFlipped', 'chooseBurnFlipped'].map(name => source.split(/\r?\n/u).find(line => line.startsWith(`function ${name}(`))).join('\n')
  const chosen = { id: 'chosen', card: { Name: 'Перевёрнутая карта' }, flippedTurns: 1, dying: false }
  const other = { id: 'other', card: { Name: 'Другая рубашка' }, flippedTurns: 2, dying: false }
  const pendingBurnFlipped = { value: [] }, burned = [], notes = []
  const context = { chosen, other, board: { value: [chosen, other] }, pendingBurnFlipped, kill: (target, options) => burned.push([target, options]), note: message => notes.push(message), inform: message => assert.fail(message) }
  runInNewContext(`${stripTypeScriptTypes(functions)};resolveBurnFlippedEffect(1)`, context)
  assert.deepEqual(pendingBurnFlipped.value, [1])
  assert.equal(runInNewContext('canChooseBurnFlipped(chosen)', context), true)
  runInNewContext('chooseBurnFlipped(chosen)', context)
  assert.deepEqual(pendingBurnFlipped.value, [])
  assert.deepEqual(burned.map(([unit, options]) => [unit.id, options.burn]), [['chosen', true]])
  context.board.value = [other]
  runInNewContext('resolveBurnFlippedEffect(0)', context)
  assert.deepEqual(burned.map(([unit, options]) => [unit.id, options.burn]), [['chosen', true], ['other', true]])
})

test('«Грави пушка» crown selects a free neighboring socket for the attacked card', () => {
  assert.deepEqual(effectsForTrigger('Грави пушка', 'crown'), [{ kind: 'move-target-adjacent' }])
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = ['validCrownMoveSlot', 'resolveCrownMove'].map(name => source.split(/\r?\n/u).find(line => line.startsWith(`function ${name}(`))).join('\n')
  const target = { id: 'target', card: { Name: 'Существо', Type: 0 }, owner: 1, row: 2, col: 2, health: 4, dying: false }, attacker = { id: 'attacker', card: { Name: 'Грави пушка' } }
  const pendingCrownMove = { value: { attackerId: 'attacker', targetId: target.id } }, board = { value: [target, attacker] }, completed = []
  const context = { pendingCrownMove, board, at: (row, col) => board.value.find(unit => unit.row === row && unit.col === col), movementLock: { value: null }, current: { value: 0 }, movementIsBlocked: () => false, unitMovementBlocked: () => false, target,
    note: () => {}, inform: message => assert.fail(message), coord: (row, col) => `${row},${col}` }
  assert.equal(runInNewContext(`${stripTypeScriptTypes(functions)};validCrownMoveSlot(2,3)`, context), true)
  assert.equal(runInNewContext('validCrownMoveSlot(2,4)', context), false)
  assert.equal(runInNewContext('validCrownMoveSlot(2,2)', context), false)
  runInNewContext('resolveCrownMove(2,3)', context)
  assert.deepEqual([target.row, target.col], [2,3])
  assert.equal(pendingCrownMove.value, null)
})

test('«Базука» crown damages every creature adjacent to the attacked target', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Базука')
  assert.deepEqual(effectsForTrigger(card.Name, 'crown'), [{ kind: 'damage-surrounding-creatures', amount: 1 }])
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolve = source.split(/\r?\n/u).find(line => line.startsWith('function resolveCrown('))
  const attacker = { id: 'attacker', owner: 0, row: 2, col: 1, card: { Name: 'Носитель', Type: 0 }, item: card }
  const target = { id: 'target', owner: 1, row: 2, col: 2, card: { Name: 'Цель', Type: 0 }, health: 1, dying: false }
  const adjacent = [{ id: 'ally', row: 1, col: 1 }, { id: 'enemy', row: 3, col: 3 }].map(unit => ({ ...unit, owner: 0, card: { Name: unit.id, Type: 0 }, health: 3, dying: false }))
  const outside = { id: 'outside', owner: 1, row: 0, col: 0, card: { Name: 'Вдали', Type: 0 }, health: 3, dying: false }
  const building = { id: 'building', owner: 1, row: 2, col: 3, card: { Name: 'Здание', Type: 3 }, health: 3, dying: false }
  const board = { value: [attacker, target, ...adjacent, outside, building] }, damaged = []
  runInNewContext(`${stripTypeScriptTypes(resolve)}\nresolveCrown(attacker,target)`, { attacker, target, board, rulesForCard, effectsForTrigger,
    players: { value: [{}, {}] }, unitDescription: unit => unit.card.Description || '', damage: (unit, amount, options) => damaged.push([unit.id, amount, options.killer.id]), note: () => {} })
  assert.deepEqual(damaged, [['attacker',1,'attacker'], ['ally',1,'attacker'], ['enemy',1,'attacker']])
})

test('«Громила» crown lets its owner push a surviving attacked creature sideways', () => {
  assert.deepEqual(effectsForTrigger('Громила', 'crown'), [{ kind: 'move-target-sideways' }])
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = ['validCrownMoveSlot', 'resolveCrownMove'].map(name => source.split(/\r?\n/u).find(line => line.startsWith(`function ${name}(`))).join('\n')
  const target = { id: 'target', card: { Name: 'Существо', Type: 0 }, owner: 1, row: 2, col: 2, health: 4, dying: false }, attacker = { id: 'attacker', card: { Name: 'Громила' } }
  const pendingCrownMove = { value: { attackerId: 'attacker', targetId: target.id, sideways: true } }, board = { value: [target, attacker] }
  const context = { pendingCrownMove, board, at: (row, col) => board.value.find(unit => unit.row === row && unit.col === col), movementLock: { value: null }, current: { value: 0 }, movementIsBlocked: () => false, unitMovementBlocked: () => false, inform: message => assert.fail(message), note: () => {}, coord: (row, col) => `${row},${col}` }
  assert.equal(runInNewContext(`${stripTypeScriptTypes(functions)};validCrownMoveSlot(2,1)`, context), true)
  assert.equal(runInNewContext('validCrownMoveSlot(1,2)', context), false)
  runInNewContext('resolveCrownMove(2,1)', context)
  assert.deepEqual([target.row, target.col], [2,1])
})

test('«Тулган» crown transfers the attacked creature to any empty socket', () => {
  assert.deepEqual(effectsForTrigger('Тулган', 'crown'), [{ kind: 'move-target-any' }])
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = ['validCrownMoveSlot', 'resolveCrownMove', 'resolveCrown'].map(name => source.split(/\r?\n/u).find(line => line.startsWith(`function ${name}(`))).join('\n')
  const target = { id: 'target', card: { Name: 'Существо', Type: 0 }, owner: 1, row: 2, col: 2, health: 4, dying: false, flippedTurns: 0 }
  const attacker = { id: 'attacker', owner: 0, card: { Name: 'Тулган' }, health: 1, dying: false, flippedTurns: 0 }
  const blocker = { id: 'blocker', card: { Name: 'Здание', Type: 3 }, row: 4, col: 4, dying: false }
  const pendingCrownMove = { value: null }, board = { value: [target, attacker, blocker] }, movementLock = { value: 0 }
  const context = { pendingCrownMove, board, attacker, target, movementLock, current: { value: 1 }, rulesForCard, effectsForTrigger,
    unitDescription: unit => unit.card.Description || '',
    at: (row, col) => board.value.find(unit => unit.row === row && unit.col === col), movementIsBlocked: () => true, unitMovementBlocked: () => true,
    players: { value: [{}, {}] }, note: () => {}, inform: message => assert.fail(message), coord: (row, col) => `${row},${col}` }
  runInNewContext(`${stripTypeScriptTypes(functions)};resolveCrown(attacker,target)`, context)
  assert.deepEqual(JSON.parse(JSON.stringify(pendingCrownMove.value)), { attackerId: attacker.id, targetId: target.id, anySocket: true })
  assert.equal(runInNewContext('validCrownMoveSlot(0,0)', context), true)
  assert.equal(runInNewContext('validCrownMoveSlot(4,4)', context), false)
  runInNewContext(`${stripTypeScriptTypes(functions.split('\n').slice(0,2).join('\n'))};resolveCrownMove(0,0)`, context)
  assert.deepEqual([target.row, target.col, pendingCrownMove.value], [0,0,null])
})

test('«Банхаммер» crown burns its target and the creature carrying it', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Банхаммер')
  assert.deepEqual(effectsForTrigger(card.Name, 'crown'), [{ kind: 'burn-attacker-and-target' }])
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolve = source.split(/\r?\n/u).find(line => line.startsWith('function resolveCrown('))
  const attacker = { id: 'holder', owner: 0, card: { Name: 'Носитель', Type: 0 }, item: card }
  const target = { id: 'attacked', owner: 1, health: 0, dying: false, card: { Name: 'Атакованное существо', Type: 0 } }
  const kills = []
  const context = { attacker, target, players: { value: [{}, {}] }, rulesForCard, effectsForTrigger,
    unitDescription: unit => unit.card.Description || '', kill: (unit, options) => kills.push([unit.id, options]), note: () => {} }
  runInNewContext(`${stripTypeScriptTypes(resolve)}\nresolveCrown(attacker,target)`, context)
  assert.deepEqual(kills.map(([id, options]) => [id, options.burn, options.killer?.id]), [['attacked',true,'holder'], ['holder',true,undefined]])
  kills.length = 0
  const building = { id: 'building', health: 4, dying: false, card: { Name: 'Здание', Type: 3 } }
  context.building = building
  runInNewContext('resolveCrown(attacker,building)', context)
  assert.deepEqual(kills, [])
})

test('«Заб» can capture only an enemy building and transfers its controller on entry', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Заб')
  assert.deepEqual(entryTargetOperation(card.Description), { kind: 'take-enemy-building' })
  assert.equal(cardEffects.supportedEntryEffect(card.Description), true)
  const sourceCode = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const candidates = sourceCode.split(/\r?\n/u).find(line => line.startsWith('function entryTargetCandidates('))
  const resolve = sourceCode.split(/\r?\n/u).find(line => line.startsWith('function resolveEntry('))
  const source = { id: 'zab', owner: 0, card }, enemyBuilding = { id: 'enemy', owner: 1, card: { Type: 3, Name: 'Вражеское здание' } }
  const friendlyBuilding = { id: 'friendly', owner: 0, card: { Type: 3, Name: 'Союзное здание' } }
  const board = { value: [source, enemyBuilding, friendlyBuilding] }, pendingEntryTokenGain = { value: null }, selection = { value: null }, completed = []
  const context = { source, enemyBuilding, board, current: { value: 0 }, players: { value: [{}, {}] }, entryTargetOperation, pendingEntryTokenGain, selection,
    unitDescription: unit => unit.card.Description, entryTargetCandidates: (unit, operation, owner) => runInNewContext(`${stripTypeScriptTypes(candidates)};entryTargetCandidates(source,operation,owner)`, { source: unit, operation, owner, board, entryTargetOperation }),
    finishEntryFollowup: unit => completed.push(unit), inform: () => {}, note: () => {} }
  assert.deepEqual(runInNewContext(`${stripTypeScriptTypes(candidates)};entryTargetCandidates(source,entryTargetOperation(source.card.Description),0)`, context).map(unit => unit.id), ['enemy'])
  runInNewContext(`${stripTypeScriptTypes(resolve)};resolveEntry(source.id,enemyBuilding,0)`, context)
  assert.equal(enemyBuilding.owner, 0)
  assert.equal(friendlyBuilding.owner, 0)
  assert.deepEqual(completed, [source])
})

test('«Джекс» gives three chosen type tokens only to a creature without white tokens', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Джекс')
  assert.deepEqual(entryTargetOperation(card.Description), { kind: 'give-type-tokens-if-none', count: 3 })
  assert.equal(cardEffects.hasWhiteTypeTokens({ typeTokens: [0, 0, 0, 0, 0, 0] }), false)
  assert.equal(cardEffects.hasWhiteTypeTokens({ typeTokens: [0, 1, 0, 0, 0, 0] }), true)
  assert.deepEqual(cardEffects.addTypeToken([0, 0, 0, 0, 0, 0], 2), [0, 0, 1, 0, 0, 0])
  const choose = readFileSync(new URL('./App.vue', import.meta.url), 'utf8').split(/\r?\n/u).find(line => line.startsWith('function chooseJexToken('))
  const target = { id: 'target', card: { Name: 'Цель' }, typeTokens: [0, 0, 0, 0, 0, 0], dying: false }
  const source = { id: 'jex' }, board = { value: [source, target] }, pendingJex = { value: { sourceId: 'jex', targetId: 'target', owner: 0, remaining: 3 } }, pendingEntryTokenGain = { value: null }, completed = []
  const context = { pendingJex, board, addTypeToken: cardEffects.addTypeToken, pendingEntryTokenGain, finishEntryFollowup: unit => completed.push(unit), note: () => {} }
  runInNewContext(`${stripTypeScriptTypes(choose)};chooseJexToken(0);chooseJexToken(2);chooseJexToken(2)`, context)
  assert.deepEqual(target.typeTokens, [1, 0, 2, 0, 0, 0])
  assert.equal(pendingJex.value, null)
  assert.deepEqual(completed, [source])
})

test('selected-target damage followed by self healing is parsed as one ordered effect', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Ну что там с арг')
  assert.deepEqual(cardEffects.selectedDamageAndHeal(card.Description), { damage: 2, heal: 2 })
  assert.equal(effectCanTargetPlayer(card.Description), true)
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  assert.ok(source.includes('if(damageHeal)heal(player.value,damageHeal.heal)'))
})

test('«Роза зло» identifies its selectable health cost and card-only target', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Роза зло')
  assert.deepEqual(cardEffects.healthPaymentDamage(card.Description), { target: 'card' })
  assert.equal(spellCanTargetPlayer(card.Description), false)
  const finish = readFileSync(new URL('./App.vue', import.meta.url), 'utf8').split(/\r?\n/u).find(line => line.startsWith('function finishRose('))
  const player = { health: 12, hand: [card] }, target = { id: 'target', card: { Name: 'Враг' }, health: 8, dying: false, flippedTurns: 0 }
  const pendingRose = { value: { index: 0, targetId: 'target', amount: 4 } }, hits = [], damages = [], spells = []
  const context = { pendingRose, player: { value: player }, board: { value: [target] }, hitPlayer: (who, amount) => hits.push([who, amount]), damage: (unit, amount) => damages.push([unit, amount]), finishSpell: (index, note) => spells.push([index, note]), inform: message => assert.fail(message) }
  runInNewContext(`${stripTypeScriptTypes(finish)};finishRose()`, context)
  assert.deepEqual(hits, [[player, 4]])
  assert.deepEqual(damages, [[target, 4]])
  assert.deepEqual(spells.map(([index]) => index), [0])
  assert.equal(pendingRose.value, null)

  player.health = 5
  pendingRose.value = { index: 0, targetId: 'target', amount: 5 }
  runInNewContext(`${stripTypeScriptTypes(finish)};finishRose()`, { ...context, inform: message => assert.match(message, /оставив минимум 1/u), hitPlayer: () => assert.fail('The payment must leave the player at 1 health'), damage: () => assert.fail('An invalid payment must not damage the target') })
  assert.equal(pendingRose.value.amount, 5)
})

test('«Коза» maps crown movement to the attacked creature’s home direction', () => {
  assert.deepEqual(cardEffects.effectsForTrigger('Коза', 'crown'), [{ kind: 'move-target-backward' }])
  assert.equal(cardEffects.crownBackwardRow(0, 2), 3)
  assert.equal(cardEffects.crownBackwardRow(1, 2), 1)
  assert.equal(cardEffects.crownBackwardRow(0, 4), null)
  assert.equal(cardEffects.crownBackwardRow(1, 0), null)
  const move = readFileSync(new URL('./App.vue', import.meta.url), 'utf8').split(/\r?\n/u).find(line => line.startsWith('function moveCrownTargetBackward('))
  const target = { id: 'target', owner: 0, row: 2, col: 2, health: 3, dying: false, flippedTurns: 0, card: { Name: 'Цель', Type: 0 } }, attacker = { card: { Name: 'Коза' } }
  const board = { value: [target, attacker] }, movementLock = { value: null }, current = { value: 0 }, moved = []
  const context = { crownBackwardRow: cardEffects.crownBackwardRow, target, attacker, board, movementLock, current, at: (row, col) => board.value.find(unit => unit.row === row && unit.col === col), unitMovementBlocked: () => false, movementIsBlocked: () => false, coord: (row, col) => `${row},${col}`, note: message => moved.push(message) }
  assert.equal(runInNewContext(`${stripTypeScriptTypes(move)};moveCrownTargetBackward(attacker,target)`, context), true)
  assert.equal(target.row, 3)
  assert.equal(moved.length, 1)
  target.row = 4
  assert.equal(runInNewContext(`${stripTypeScriptTypes(move)};moveCrownTargetBackward(attacker,target)`, context), false)
})

test('«Пилюля» crown damages on rolls 1, 3, 5 and heals on 2, 4, 6', () => {
  assert.deepEqual(cardEffects.effectsForTrigger('Пилюля', 'crown'), [{ kind: 'gamba-damage-or-heal-target', amount: 5, damagingRolls: [1, 3, 5] }])
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(roll => cardEffects.gambaTargetOutcome(roll)), ['damage', 'heal', 'damage', 'heal', 'damage', 'heal'])
})

test('the «Щит» item blocks reach attacks and refreshes its bearer shield on its owner turn', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Щит')
  assert.equal(canAttackBoardCard('Дальнобойный', card.Description, false, true), false)
  assert.equal(canAttackBoardCard('Обычный', card.Description, false, false), true)
  const startTurn = readFileSync(new URL('./App.vue', import.meta.url), 'utf8').split(/\r?\n/u).find(line => line.startsWith('function startTurn('))
  assert.ok(startTurn.includes("if(u.item?.Name==='Щит')u.shield=true"))
})

test('«Сент-круа» starts its owner-turn effect and offers only cheapest creatures and free neighbors', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Сент-круа')
  assert.deepEqual(startTurnEffect(card.Description), { scope: 'owner-turn', operations: [{ kind: 'play-cheapest-creature-adjacent' }] })
  const hand = [{ Type: 0, Cost: 3 }, { Type: 2, Cost: 0 }, { Type: 0, Cost: 1 }, { Type: 0, Cost: 1 }]
  assert.deepEqual(cardEffects.cheapestCreatureIndexes(hand), [2, 3])
  const occupied = [{ row: 1, col: 1 }, { row: 2, col: 1 }, { row: 3, col: 3 }]
  assert.deepEqual(cardEffects.freeAdjacentSockets(2, 2, occupied), [{ row: 1, col: 2 }, { row: 1, col: 3 }, { row: 2, col: 3 }, { row: 3, col: 1 }, { row: 3, col: 2 }])
  const source = { id: 'sent-croix', row: 2, col: 2 }, creature = { Id: 'cheap', Name: 'Самое дешёвое', Type: 0, Cost: 1 }, owner = { hand: [creature], played: false }
  const board = { value: [source, { id: 'block', row: 1, col: 1 }] }, pendingSentCroix = { value: [{ sourceId: source.id, owner: 0, cardId: creature.Id }] }, spawned = [], events = []
  const resolve = readFileSync(new URL('./App.vue', import.meta.url), 'utf8').split(/\r?\n/u).find(line => line.startsWith('function resolveSentCroixSlot('))
  const context = { pendingSentCroix, board, players: { value: [owner] }, cheapestCreatureIndexes: cardEffects.cheapestCreatureIndexes, sentCroixSockets: () => cardEffects.freeAdjacentSockets(source.row, source.col, board.value), unit: (card, row, col) => ({ card, owner: 0, row, col }), notifyCardPlayed: (...args) => events.push(['played', ...args]), entry: (...args) => events.push(['entry', ...args]), consumeNextScoreAdjustment: () => 0, startDrop: () => {}, visual: () => {}, note: () => {}, inform: message => assert.fail(message) }
  runInNewContext(`${stripTypeScriptTypes(resolve)};resolveSentCroixSlot(1,2)`, context)
  assert.deepEqual(owner.hand, [])
  assert.equal(board.value.at(-1).row, 1)
  assert.equal(owner.played, true)
  assert.deepEqual(events.map(([name]) => name), ['played', 'entry'])
})

test('«Дрон» death effect selects up to two deck cards within a shared cost limit', () => {
  assert.deepEqual(cardEffects.effectsForTrigger('Дрон', 'death'), [{ kind: 'save-deck-cards-by-cost', count: 2, totalCost: 4 }])
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  assert.ok(source.includes("if(effect.kind==='save-deck-cards-by-cost'){queueDroneSelection(u.owner,u,effect.count,effect.totalCost);continue}"))
  const functions = ['queueDroneSelection', 'toggleDroneCard', 'finishDroneSelection'].map(name => source.split(/\r?\n/u).find(line => line.startsWith(`function ${name}(`))).join('\n')
  const drone = { id: 'drone', card: { Name: 'Дрон' } }, player = { deck: [{ Name: 'Три', Cost: 3 }, { Name: 'Два', Cost: 2 }, { Name: 'Пять', Cost: 5 }, { Name: 'Один', Cost: 1 }], saved: [] }
  const players = { value: [player] }, pendingDrone = { value: [] }, notes = []
  const context = { drone, players, pendingDrone, note: message => notes.push(message), inform: message => assert.fail(message) }
  runInNewContext(`${stripTypeScriptTypes(functions)};queueDroneSelection(0,drone,2,4);toggleDroneCard(0);toggleDroneCard(1);toggleDroneCard(3);finishDroneSelection()`, context)
  assert.deepEqual(player.saved.map(card => card.Name), ['Один', 'Три'])
  assert.deepEqual(player.deck.map(card => card.Name), ['Два', 'Пять'])
  assert.equal(pendingDrone.value.length, 0)
  assert.equal(notes.length, 1)
})

test('«Джон Роблокс» moves a chosen building one orthogonal step into a free neutral socket', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Джон Роблокс')
  assert.deepEqual(entryTargetOperation(card.Description), { kind: 'move-building-one' })
  const sourceCode = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const building = { id: 'building', owner: 1, row: 2, col: 2, card: { Name: 'Здание', Type: 3 }, dying: false, flippedTurns: 0 }
  const entrant = { id: 'roblox', owner: 0, card }
  const board = { value: [entrant, building] }, pendingBuildingMove = { value: null }, pendingEntryTokenGain = { value: null }, selection = { value: null }, finished = []
  const candidateLine = sourceCode.split(/\r?\n/u).find(line => line.startsWith('function entryTargetCandidates('))
  const resolveEntry = sourceCode.split(/\r?\n/u).find(line => line.startsWith('function resolveEntry('))
  const candidates = runInNewContext(`${stripTypeScriptTypes(candidateLine)};entryTargetCandidates(entrant,entryTargetOperation(entrant.card.Description),0)`, { entrant, board, entryTargetOperation })
  assert.deepEqual(candidates.map(unit => unit.id), ['building'])
  const context = { entrant, building, board, pendingBuildingMove, pendingEntryTokenGain, selection, current: { value: 0 }, players: { value: [{}, {}] }, entryTargetOperation,
    at: (row, col) => board.value.find(unit => unit.row === row && unit.col === col), coord: (row, col) => `${row},${col}`, unitDescription: unit => unit.card.Description, entryTargetCandidates: () => [building], inform: () => {}, note: () => {},
    finishEntryFollowup: unit => finished.push(unit) }
  runInNewContext(`${stripTypeScriptTypes(resolveEntry)};resolveEntry(entrant.id,building,0)`, context)
  assert.deepEqual(JSON.parse(JSON.stringify(pendingBuildingMove.value)), { sourceId: entrant.id, targetId: building.id })
  const canMove = sourceCode.split(/\r?\n/u).find(line => line.startsWith('function validBuildingMoveSlot('))
  const resolveMove = sourceCode.split(/\r?\n/u).find(line => line.startsWith('function resolveBuildingMove('))
  assert.ok(canMove && resolveMove)
  assert.equal(runInNewContext(`${stripTypeScriptTypes(canMove)};validBuildingMoveSlot(2,3)`, context), true)
  assert.equal(runInNewContext(`${stripTypeScriptTypes(canMove)};validBuildingMoveSlot(3,3)`, context), false)
  runInNewContext(`${stripTypeScriptTypes(resolveMove)};resolveBuildingMove(2,3)`, context)
  assert.deepEqual([building.row, building.col], [2,3])
  assert.equal(pendingBuildingMove.value, null)
  assert.deepEqual(finished, [entrant])
})

test('«Внешний рай» queues a choice after an enemy creature is played and permanently reduces the chosen ally cost', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = ['queueParadiseTargets', 'chooseParadiseTarget'].map(name => source.split(/\r?\n/u).find(line => line.startsWith(`function ${name}(`))).join('\n')
  const building = { owner: 0, dying: false, flippedTurns: 0, card: { Name: 'Внешний рай', Type: 3 } }
  const ally = { id: 'ally', owner: 0, speed: 1, energyCostReduction: 0, shield: false, dying: false, card: { Name: 'Союзник', Type: 0 } }
  const enemy = { id: 'enemy', owner: 1, speed: 2, energyCostReduction: 0, shield: false, dying: false, card: { Name: 'Враг', Type: 0 } }
  const board = { value: [building, ally, enemy] }, pendingParadiseTargets = { value: [] }, notes = []
  const context = { board, pendingParadiseTargets, note: message => notes.push(message) }
  runInNewContext(`${stripTypeScriptTypes(functions)};queueParadiseTargets(1);chooseParadiseTarget('ally')`, context)
  assert.equal(ally.energyCostReduction, 1)
  assert.equal(effectiveUnitSpeed(ally), 1)
  assert.deepEqual(pendingParadiseTargets.value, [])
  assert.equal(notes.length, 1)
})

test('«ГендаБосс» takes 30 health, permanently buffs current and future friendly creatures, and burns itself', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'ГендаБосс')
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = ['applyGendaBossBuff', 'resolveGendaBossSpell', 'unit'].map(name => source.split(/\r?\n/u).find(line => line.startsWith(`function ${name}(`)))
  assert.ok(functions.every(Boolean))
  const player = { health: 45, hand: [card], burned: [], gendaBossStacks: 0 }
  const ally = { owner: 0, card: { Type: 0 }, attack: 2, health: 3, maxHealth: 3, speed: 1, dying: false }
  const building = { ...ally, card: { Type: 3 } }
  const board = { value: [ally, building] }, hit = []
  const context = { player: { value: player }, current: { value: 0 }, board, hitPlayer: (target, amount) => { target.health -= amount; hit.push(amount) },
    finishSpell: index => { const spell = player.hand.splice(index, 1)[0]; player.burned.push(spell) }, note: () => {}, players: { value: [player] }, round: { value: 1 },
    crypto: { randomUUID: () => 'future' }, effectiveCardDescription: text => text, rulesForCard: () => ({}), initialFlipTurns: () => 0 }
  runInNewContext(`${stripTypeScriptTypes(functions.join('\n'))};resolveGendaBossSpell(0)`, context)
  const futureAlly = runInNewContext("unit({Id:'future',Name:'Будущее',Description:'',Type:0,Health:2,Attack:1,Speed:2},2,2)", context)
  assert.deepEqual([ally.attack, ally.health, ally.maxHealth, ally.speed], [4, 5, 5, 0])
  assert.deepEqual([futureAlly.attack, futureAlly.health, futureAlly.maxHealth, futureAlly.speed], [3, 4, 4, 1])
  assert.equal(building.attack, 2)
  assert.deepEqual(hit, [30])
  assert.deepEqual(player.burned, [card])
  assert.equal(cardEffects.hasBurnTrait(card.Description), true)
})

test('«Hameleonew» saves the owner\'s next burned card without firing burn triggers', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = ['grantHameleonewEntry', 'recordBurn'].map(name => source.split(/\r?\n/u).find(line => line.startsWith(`function ${name}(`)))
  assert.ok(functions.every(Boolean))
  assert.match(source.split(/\r?\n/u).find(line => line.startsWith('function entry(')), /u\.card\.Name==='Hameleonew'\)grantHameleonewEntry\(owner\)/u)
  const owner = { burned: [], saved: [], nextBurnToSave: 0 }, board = [{ card: { Name: 'Айсберг' }, owner: 0, blackTokens: 0 }]
  const card = { Name: 'Сжигаемая карта' }, context = { owner, card, board: { value: board }, players: { value: [owner] }, gainBurnTriggerTokens: cardEffects.gainBurnTriggerTokens, note: () => {} }
  runInNewContext(`${stripTypeScriptTypes(functions.join('\n'))};grantHameleonewEntry(owner);recordBurn(owner,card)`, context)
  assert.deepEqual(owner.saved, [card])
  assert.deepEqual(owner.burned, [])
  assert.equal(owner.nextBurnToSave, 0)
  assert.equal(board[0].blackTokens, 0)
  assert.equal(runInNewContext('recordBurn(owner,card)', context), true)
  assert.deepEqual(owner.burned, [card])
  assert.equal(board[0].blackTokens, 1)
  const burned = [], hand = [{ Description: 'Восстановите 5 здоровья. Возьмите карту. Если вы сжигаете карту, примените её эффект.' }], saved = []
  let healing = 0, draws = 0
  cardEffects.takeCardFromHand(hand, [], burned, 0, 'burn', amount => { healing += amount }, count => { draws += count }, burnedCard => { saved.push(burnedCard); return false })
  assert.equal(hand.length, 0)
  assert.equal(burned.length, 0)
  assert.equal(saved.length, 1)
  assert.equal(healing, 0)
  assert.equal(draws, 0)
})

test('«Рокочущий рыцарь» crown destroys only a damaged creature and its kills burn exactly once', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(card => card.Name === 'Рокочущий рыцарь')
  const healthy = { id: 'healthy', card: { Name: 'Полное существо', Type: 0 }, owner: 1, health: 4, maxHealth: 4 }
  const injured = { id: 'injured', card: { Name: 'Раненое существо', Type: 0 }, owner: 1, health: 3, maxHealth: 4 }
  const building = { id: 'building', card: { Name: 'Здание', Type: 3 }, owner: 1, health: 1, maxHealth: 4 }
  const attacker = { id: 'attacker', card, owner: 0, attack: 5, health: 5 }
  assert.deepEqual(effectsForTrigger(card.Name, 'crown'), [{ kind: 'destroy-target-if-damaged', targetType: 'creature' }])
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = ['resolveCrown'].map(name => app.split(/\r?\n/u).find(line => line.startsWith(name === 'useAbility' ? 'async function useAbility(' : `function ${name}(`))).join('\n')
  const destroyed = []
  runInNewContext(stripTypeScriptTypes(`${functions}\nresolveCrown(attacker,healthy);resolveCrown(attacker,injured);resolveCrown(attacker,building)`), {
    attacker, healthy, injured, building, rulesForCard, effectsForTrigger, effectiveUnitAttack,
    targetMatchesKind: (type, expected) => expected === 'creature' ? type === 0 : type === 3,
    damage: () => {}, kill: target => destroyed.push(target), players: { value: [{health:45},{health:45}] },
    heal: () => {}, healCreature: () => {}, hitPlayer: () => {}, transferItem: () => {}, note: () => {},
    returnCardToHand: () => {}, board: { value: [attacker,healthy,injured,building] },
  })
  assert.deepEqual(destroyed, [injured])
  const killFunction = app.slice(app.indexOf('function kill('), app.indexOf('function healCreature('))
  const players = [0,1].map(() => ({ burned: [], discard: [], burnedThisTurn: false }))
  const board = [attacker,injured]
  runInNewContext(stripTypeScriptTypes(`${killFunction}\nkill(injured,{killer:attacker});kill(injured,{killer:attacker})`), {
    attacker, injured, board: { value: board }, players: { value: players }, current: { value: 0 }, attackResolutionDepth: 0,
    burnsOnDeathFromField: () => false, recordBurn: (owner, card) => owner.burned.push(card), hasBurnTrait, effectsForTrigger, killRewardForCard, takeTopDiscard,
    visual: () => {}, note: () => {}, window: { setTimeout: callback => callback() },
  })
  assert.deepEqual(players[1].burned, [injured.card])
  assert.deepEqual(players[1].discard, [])
  assert.equal(board.includes(injured), false)
})

test('«Аква» end-turn damage grows after damage, belongs to its owner and counts its type plus universal tokens', () => {
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const endEffects = app.split(/\r?\n/u).find(line => line.startsWith('function resolveEndTurnEffects(')) ?? ''
  assert.ok(endEffects, 'The game must resolve card effects at turn end')
  for (const owner of [0,1]) {
    const unit = { id: 'aqua', owner, card: { Name: 'Аква', Class: 3 }, blackTokens: 1, typeTokens: [0,4,0,2,0,0] }
    const inactive = [
      { ...unit, id: 'enemy', owner: 1-owner, typeTokens: [0,0,0,0,0,0] },
      { ...unit, id: 'flipped', flippedTurns: 2, typeTokens: [0,0,0,0,0,0] },
      { ...unit, id: 'dying', dying: true, typeTokens: [0,0,0,0,0,0] },
    ]
    const players = [{ health: 45 },{ health: 45 }]
    const context = { ...cardEffects, unit, owner, board: { value: [unit,...inactive] }, players: { value: players },
      screen: { value: 'game' }, note: () => {}, hitPlayer: (player, amount) => { player.health -= amount },
    }
    runInNewContext(stripTypeScriptTypes(`${endEffects}\nresolveEndTurnEffects(owner)`), context)
    assert.equal(players[1-owner].health, 41)
    assert.equal(players[owner].health, 45)
    assert.equal(unit.typeTokens[3], 3)
    assert.equal(unit.typeTokens[1], 4)
    assert.equal(unit.blackTokens, 1)
    assert.deepEqual(inactive.map(unit => unit.typeTokens[3]), [0,0,0])
    runInNewContext('resolveEndTurnEffects(owner)', context)
    assert.equal(players[1-owner].health, 36)
    assert.equal(unit.typeTokens[3], 4)
  }
})

test('«Бункерный паук» debuffs speed at either player turn end in all eight surrounding creature sockets', () => {
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const endEffects = app.split(/\r?\n/u).find(line => line.startsWith('function resolveEndTurnEffects('))
  for (const owner of [0,1]) {
    const spider = { id: 'spider', owner: 0, card: { Name: 'Бункерный паук', Type: 0 }, row: 2, col: 1, speed: 2 }
    const neighbors = [-1,0,1].flatMap(dr => [-1,0,1].filter(dc => dr||dc).map(dc => ({
      id: `${dr}:${dc}`, owner: dr === 1 ? 1 : 0, card: { Type: 0 }, row: 2+dr, col: 1+dc, speed: 4, attack: 2, health: 3,
    })))
    const excluded = [
      { ...neighbors[0], id: 'building', card: { Type: 3 } }, { ...neighbors[0], id: 'flipped', flippedTurns: 2 },
      { ...neighbors[0], id: 'dying', dying: true }, { ...neighbors[0], id: 'distant', row: 4 },
    ]
    const context = { ...cardEffects, owner, board: { value: [spider,...neighbors,...excluded] }, screen: { value: 'game' }, note: () => {} }
    runInNewContext(stripTypeScriptTypes(`${endEffects}\nresolveEndTurnEffects(owner)`), context)
    neighbors.forEach(unit => { assert.equal(unit.speed, 5); assert.equal(unit.attack, 2); assert.equal(unit.health, 3) })
    excluded.forEach(unit => assert.equal(unit.speed, 4))
    assert.equal(spider.speed, 2)
    runInNewContext('resolveEndTurnEffects(1-owner);resolveEndTurnEffects(owner);resolveEndTurnEffects(1-owner)', context)
    neighbors.forEach(unit => assert.equal(unit.speed, 8))
    spider.flippedTurns = 2
    neighbors.forEach(unit => { unit.speed = 4 })
    runInNewContext('resolveEndTurnEffects(owner)', context)
    neighbors.forEach(unit => assert.equal(unit.speed, 4))
  }
})

test('«Базилик» draws for off-turn movement only while its passive is active', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolver = source.split(/\r?\n/u).find(line => line.startsWith('function resolveMovementTriggers('))
  assert.ok(resolver)
  const basilisk = { id: 'basil', card: { Name: 'Базилик', Type: 0 }, owner: 0, row: 2, col: 2, health: 2, maxHealth: 2, attack: 1, speed: 1, flippedTurns: 0, dying: false }
  const other = { id: 'other', card: { Name: 'Другое существо', Type: 0 }, owner: 0, row: 3, col: 2, health: 2, maxHealth: 2, attack: 1, speed: 1, flippedTurns: 0, dying: false }
  const players = [{ hand: [], deck: ['card'], discard: [], mana: 0 }, { hand: [], deck: [], discard: [], mana: 0 }]
  const context = { ...cardEffects, applyMovementStateTriggers, basilisk, other, board: { value: [basilisk, other] }, wheatTokens: { value: [] }, current: { value: 1 }, players: { value: players }, effectiveUnitSpeed, queueBranchTargets: () => {}, kill: () => {}, note: () => {} }
  runInNewContext(`${stripTypeScriptTypes(resolver)}\nresolveMovementTriggers(basilisk); resolveMovementTriggers(other)`, context)
  assert.equal(players[0].hand.length, 1)
  assert.equal(players[1].hand.length, 0)
  context.current.value = 0
  runInNewContext(`${stripTypeScriptTypes(resolver)}\nresolveMovementTriggers(basilisk)`, context)
  basilisk.flippedTurns = 1
  context.current.value = 1
  runInNewContext(`${stripTypeScriptTypes(resolver)}\nresolveMovementTriggers(basilisk)`, context)
  assert.equal(players[0].hand.length, 1)
})

test('«Засадка пустыни пшеницей» consumes one token when a creature moves onto its socket and pays that creature owner', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolver = source.split(/\r?\n/u).find(line => line.startsWith('function resolveMovementTriggers('))
  const wheatTokens = { value: [{ row: 2, col: 3 }, { row: 2, col: 3 }] }
  const players = [{ mana: 4, deck: [], hand: [], discard: [] }, { mana: 9, deck: [], hand: [], discard: [] }]
  const building = { id: 'building', card: { Name: 'Здание', Type: 3 }, owner: 0, row: 2, col: 3, health: 1, maxHealth: 1, attack: 0, speed: 0 }
  const creature = { id: 'creature', card: { Name: 'Существо', Type: 0 }, owner: 1, row: 2, col: 3, health: 1, maxHealth: 1, attack: 0, speed: 0 }
  const board = { value: [building, creature] }
  runInNewContext(`${stripTypeScriptTypes(resolver)}\nresolveMovementTriggers(building);resolveMovementTriggers(creature)`, {
    ...cardEffects, applyMovementStateTriggers, wheatTokens, players: { value: players }, board, current: { value: 0 }, building, creature,
    effectiveUnitSpeed, queueBranchTargets: () => {}, kill: () => {}, note: () => {},
  })
  assert.equal(players[0].mana, 4)
  assert.equal(players[1].mana, 10)
  assert.deepEqual(wheatTokens.value, [{ row: 2, col: 3 }])
})

test('«Cheap Trick» destroys its wearer only when it moves toward its owner’s opponent', () => {
  for (const [owner, previousRow, row, expected] of [[0, 3, 2, true], [0, 2, 3, false], [1, 1, 2, true], [1, 2, 1, false]]) {
    const unit = { id: 'wearer', owner, row, col: 2, card: { Name: 'Носитель', Type: 0 }, item: { Name: 'Cheap Trick' }, dying: false, flippedTurns: 0, speed: 1, attack: 1, health: 1, maxHealth: 1 }
    const state = { board: [unit], players: [{ mana: 0, deck: [], hand: [], discard: [] }, { mana: 0, deck: [], hand: [], discard: [] }], wheatTokens: [] }
    let destroyed = false
    const effects = applyMovementStateTriggers(state, unit, previousRow, owner, 1, () => { destroyed = true })
    assert.equal(effects.cheapTrickDestroyed, expected)
    assert.equal(destroyed, expected)
  }
})

test('«Засадка пустыни пшеницей» can be cast without a target and marks only empty neutral sockets', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Засадка пустыни пшеницей')
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const spell = source.slice(source.indexOf('function spell('), source.indexOf('function finishSpell('))
  const needsTarget = source.split(/\r?\n/u).find(line => line.startsWith('const spellNeedsTarget='))
  const player = { hand: [card], nextScoreAdjustment: 0 }
  const board = [{ row: 2, col: 2 }]
  const wheatTokens = { value: [] }
  runInNewContext(`${stripTypeScriptTypes(needsTarget)}\n${stripTypeScriptTypes(spell)}\nspell(0)`, {
    ...cardEffects, player: { value: player }, players: { value: [player, {}] }, current: { value: 0 }, board: { value: board }, wheatTokens,
    at: (row, col) => board.find(unit => unit.row === row && unit.col === col),
    notifyCardPlayed: () => [], clownTargetRequired: () => assert.fail('This spell has no target'),
    finishSpell: index => player.hand.splice(index, 1), note: () => {},
  })
  assert.deepEqual(JSON.parse(JSON.stringify(wheatTokens.value)), [
    { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 3 }, { row: 1, col: 4 },
    { row: 2, col: 0 }, { row: 2, col: 1 }, { row: 2, col: 3 }, { row: 2, col: 4 },
    { row: 3, col: 0 }, { row: 3, col: 1 }, { row: 3, col: 2 }, { row: 3, col: 3 }, { row: 3, col: 4 },
  ])
  assert.deepEqual(player.hand, [])
})

test('«Новый видос» restores 15 health without a target and burns after casting', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Новый видос')
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const spell = source.slice(source.indexOf('function spell('), source.indexOf('function finishSpell('))
  const needsTarget = source.split(/\r?\n/u).find(line => line.startsWith('const spellNeedsTarget='))
  const player = { hand: [card], health: 35, discard: [], burned: [], nextScoreAdjustment: 0 }
  runInNewContext(`${stripTypeScriptTypes(needsTarget)}\n${stripTypeScriptTypes(spell)}\nspell(0)`, {
    ...cardEffects, player: { value: player }, players: { value: [player, {}] }, current: { value: 0 }, board: { value: [] },
    notifyCardPlayed: () => [], clownTargetRequired: () => assert.fail('The healing spell has no target'),
    refund: () => assert.fail('The healing spell should resolve without a target'),
    finishSpell: index => cardEffects.finishSpellFromHand(player.hand, player.discard, player.burned, index, () => {}, () => {}),
    heal: (owner, amount) => { owner.health = Math.min(45, owner.health + amount) }, note: () => {}, visual: () => {}, selection: { value: null },
  })
  assert.equal(player.health, 45)
  assert.deepEqual(player.hand, [])
  assert.deepEqual(player.discard, [])
  assert.deepEqual(player.burned, [card])
})

test('«Портал гравитации» flips only the selected creature for one turn', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Портал гравитации')
  assert.equal(cardEffects.targetedSpellFlipTurns(card.Description), 1)
  assert.equal(cardEffects.targetedSpellFlipTurns('Дайте переворот 1 выбранному существу и нанесите 2 урона.'), null)
  assert.equal(cardEffects.targetedSpellFlipTurns('Примените переворот 1 всем картам на поле.'), null)
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const spell = source.slice(source.indexOf('function spell('), source.indexOf('function finishSpell('))
  const needsTarget = source.split(/\r?\n/u).find(line => line.startsWith('const spellNeedsTarget='))
  const functions = `${stripTypeScriptTypes(needsTarget)}\n${stripTypeScriptTypes(spell)}`
  const target = { id: 'creature', card: { Name: 'Существо', Type: 0 }, owner: 1, flippedTurns: 0, dying: false }
  const player = { hand: [card], nextScoreAdjustment: 0 }
  let completed = 0, refunded = 0
  runInNewContext(`${functions}\nspell(0,target)`, {
    ...cardEffects, player: { value: player }, players: { value: [player, {}] }, current: { value: 0 }, board: { value: [target] }, target,
    notifyCardPlayed: () => [], clownTargetRequired: () => false,
    applyFlip: (unit, turns) => { unit.flippedTurns = turns },
    finishSpell: index => { player.hand.splice(index, 1); completed++ }, refund: () => { refunded++ }, inform: () => {},
  })
  assert.equal(target.flippedTurns, 1)
  assert.equal(completed, 1)
  target.card.Type = 3
  player.hand.push(card)
  runInNewContext(`${functions}\nspell(0,target)`, {
    ...cardEffects, player: { value: player }, players: { value: [player, {}] }, current: { value: 0 }, board: { value: [target] }, target,
    notifyCardPlayed: () => [], clownTargetRequired: () => false,
    applyFlip: (unit, turns) => { unit.flippedTurns = turns }, finishSpell: () => { completed++ }, refund: () => { refunded++ }, inform: () => {},
  })
  assert.equal(target.flippedTurns, 1)
  assert.equal(completed, 1)
  assert.equal(refunded, 1)
})

test('lethal «Аква» damage at turn end ends the game before handoff and preserves the winner', () => {
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = app.split(/\r?\n/u).filter(line => /^function (resolveEndTurnEffects|finishTurnLocally|hitPlayer)\(/u.test(line)).join('\n')
  const unit = { owner: 0, card: { Name: 'Аква' }, blackTokens: 0, typeTokens: [0,0,0,0,0,0] }
  const players = [{ health: 45 },{ health: 1 }], screen = { value: 'game' }, current = { value: 0 }, winner = { value: -1 }
  runInNewContext(stripTypeScriptTypes(`${functions}\nfinishTurnLocally()`), {
    ...cardEffects, board: { value: [unit] }, players: { value: players }, screen, current, winner, note: () => {},
    expireCardPlayBuffs: () => assert.fail('Winning must stop turn handoff'),
  })
  assert.equal(screen.value, 'winner')
  assert.equal(winner.value, 0)
  assert.equal(current.value, 0)
  assert.equal(players[1].health, 0)
  assert.equal(unit.typeTokens[3], 1)
})

test('«Разбойник» entry gives three energy to the effect owner and follows score gating for copied entries', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(card => card.Name === 'Разбойник')
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const entryFunction = app.split(/\r?\n/u).find(line => line.startsWith('function entry('))
  for (const effectOwner of [0,1]) for (const [scored, handSize, expected] of [[false,0,8],[true,0,5],[true,3,8]]) {
    const unit = { id: 'source', owner: 0, card: { ...card, Description: `${scored?'Счёт 4: ':''}${card.Description}` } }
    const players = [0,1].map(() => ({ energy: 5, mana: 2, hand: [] }))
    players[effectOwner].hand = Array.from({ length: handSize }, () => ({ Type: 0 }))
    runInNewContext(stripTypeScriptTypes(`${entryFunction}\nentry(unit,0,effectOwner)`), {
      ...cardEffects, unit, effectOwner, players: { value: players }, board: { value: [unit] }, round: { value: 1 },
      pendingEntryTokenGain: { value: null }, pendingEntryFollowupId: { value: null },
      unitDescription: unit => unit.card.Description, finishEntryFollowup: () => {}, note: () => {},
    })
    assert.equal(players[effectOwner].energy, expected)
    assert.equal(players[1-effectOwner].energy, 5)
    assert.equal(players[effectOwner].mana, 2)
    assert.equal(supportedEntryEffect(card.Description), true)
  }
})

test('«Вадим» blocks creature damage using current saved-card count and effective source attack before consuming a shield', () => {
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const damageFunction = app.split(/\r?\n/u).find(line => line.startsWith('function damage('))
  for (const owner of [0,1]) for (const [type,attack,shield,expectedHealth,expectedShield] of [
    [0,1,false,5,false], [0,2,false,5,false], [0,3,false,3,false],
    [0,2,true,5,true], [0,3,true,5,false], [3,1,false,3,false], [undefined,0,false,3,false],
  ]) {
    const target = { id: 'vadim', card: { Name: 'Вадим', Type: 0 }, owner, health: 5, maxHealth: 5, shield, flippedTurns: 0 }
    const source = type === undefined ? undefined : { card: { Name: 'Источник', Type: type }, owner: 1-owner, attack, health: 5 }
    const players = [0,1].map(() => ({ saved: [] }))
    players[owner].saved = [{ Type: 0 },{ Type: 2 }]
    const context = { ...cardEffects, target, source, board: { value: [target] }, players: { value: players },
      attackResolutionDepth: 0, note: () => {}, kill: () => assert.fail('Nonlethal damage must not kill'),
    }
    runInNewContext(stripTypeScriptTypes(`${damageFunction}\ndamage(target,2,{killer:source})`), context)
    assert.equal(target.health, expectedHealth)
    assert.equal(target.shield, expectedShield)
  }
  const target = { id: 'vadim', card: { Name: 'Вадим', Type: 0 }, owner: 0, health: 5, maxHealth: 5, shield: false }
  const source = { card: { Name: 'PT4OLKA', Type: 0 }, owner: 1, attack: 9, health: 1 }
  const players = [{ saved: [{ Type: 2 }] }, { saved: [] }]
  const context = { ...cardEffects, target, source, players: { value: players }, board: { value: [target] }, attackResolutionDepth: 0,
    note: () => {}, kill: () => assert.fail('Nonlethal damage must not kill'),
  }
  runInNewContext(stripTypeScriptTypes(`${damageFunction}\ndamage(target,2,{killer:source})`), context)
  assert.equal(target.health, 5)
  players[0].saved.pop()
  runInNewContext('damage(target,2,{killer:source})', context)
  assert.equal(target.health, 3)
})

test('«Вадим» also receives source information for creature death damage', () => {
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const damageFunction = app.split(/\r?\n/u).find(line => line.startsWith('function damage('))
  const killFunction = app.slice(app.indexOf('function kill('), app.indexOf('function healCreature('))
  for (const savedCount of [1,2]) {
    const source = { id: 'source', card: { Name: 'Обсидиан пчёла', Type: 0, Description: '' }, owner: 1, attack: 2, row: 2, col: 1 }
    const target = { id: 'vadim', card: { Name: 'Вадим', Type: 0 }, owner: 0, health: 5, shield: false, row: 2, col: 2 }
    const players = [0,1].map(() => ({ saved: [], discard: [], burned: [] }))
    players[0].saved = Array.from({ length: savedCount }, () => ({ Type: 2 }))
    runInNewContext(stripTypeScriptTypes(`${damageFunction}\n${killFunction}\nkill(source)`), {
      ...cardEffects, source, board: { value: [source,target] }, players: { value: players }, current: { value: 1 }, attackResolutionDepth: 0,
      visual: () => {}, note: () => {}, coord: () => '', window: { setTimeout: callback => callback() },
    })
    assert.equal(target.health, savedCount === 2 ? 5 : 3)
  }
})

test('«Конч», «Сэм» and «Горыныч» entry draws use the proper pile, type and end without reordering remaining cards', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const entryFunction = app.split(/\r?\n/u).find(line => line.startsWith('function entry('))
  for (const name of ['Конч','Сэм','Горыныч']) for (const effectOwner of [0,1]) for (const count of [1,0,4]) {
    const card = cards.find(card => card.Name === name)
    const pile = [{ Name: 'A', Type: 0 }, { Name: 'B', Type: 2 }, { Name: 'C', Type: 0 }, { Name: 'D', Type: 2 }].slice(0,count)
    const sourcePile = name === 'Сэм' ? 'discard' : 'deck'
    const player = { deck: [], discard: [], hand: [], saved: [] }
    player[sourcePile] = [...pile]
    const players = [0,1].map(() => ({ deck: [], discard: [], hand: [], saved: [] }))
    players[effectOwner] = player
    const unit = { id: 'source', card, owner: 0, row: 2, col: 1 }
    const tokens = { value: null }
    runInNewContext(stripTypeScriptTypes(`${entryFunction}\nentry(unit,0,effectOwner)`), {
      ...cardEffects, unit, effectOwner, board: { value: [unit] }, players: { value: players }, round: { value: 1 },
      pendingEntryTokenGain: tokens, pendingEntryFollowupId: { value: null }, unitDescription: unit => unit.card.Description,
      note: () => {}, finishEntryFollowup: () => {}, draw: () => assert.fail('Special pile draw must not draw ordinary deck top'),
    })
    const expected = name === 'Конч' ? (count ? [pile[count-1]] : []) : name === 'Сэм' ? pile.slice(0,3) : (count === 4 ? [pile[1]] : [])
    assert.deepEqual(player.hand, expected, `${name} owner=${effectOwner} count=${count}`)
    assert.deepEqual(player[sourcePile], pile.filter(card => !expected.includes(card)))
    assert.equal(players[1-effectOwner].hand.length, 0)
    assert.equal(tokens.value?.resolved, expected.length ? true : false)
    assert.equal(supportedEntryEffect(card.Description), true)
  }
})

test('«Горыныч» death takes the top available spell from owner discard and repeats without copying cards', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const killFunction = app.slice(app.indexOf('function kill('), app.indexOf('function healCreature('))
  for (const owner of [0,1]) for (const count of [0,1,2]) for (const repeats of [1,2]) {
    const target = { id: 'target', owner, card: cards.find(card => card.Name === 'Горыныч') }
    const spellA = { Name: 'Заклинание A', Type: 2 }, spellB = { Name: 'Заклинание B', Type: 2 }, creature = { Name: 'Существо', Type: 0 }
    const prior = count === 2 ? [spellA, creature, spellB] : count === 1 ? [spellA, creature] : [creature]
    const players = [0,1].map(() => ({ hand: [], discard: [], burned: [], saved: [] }))
    players[owner].discard = [...prior]
    const aura = { id: 'aura', owner, card: { Name: 'Маринует мясо', Type: 0 } }
    runInNewContext(stripTypeScriptTypes(`${killFunction}\nkill(target);kill(target)`), {
      ...cardEffects, target, board: { value: [target, ...(repeats === 2 ? [aura] : [])] }, players: { value: players }, current: { value: owner },
      attackResolutionDepth: 0, visual: () => {}, note: () => {}, window: { setTimeout: callback => callback() },
    })
    const expected = count === 2 ? (repeats === 2 ? [spellB,spellA] : [spellB]) : count === 1 ? [spellA] : []
    assert.deepEqual(players[owner].hand, expected)
    assert.deepEqual(players[owner].discard, [...prior.filter(card => !expected.includes(card)), target.card])
    assert.equal(players[1-owner].hand.length, 0)
  }
})

test('typed pile draws do not confuse top of deck with top of discard or compound entry instructions', () => {
  const first = { Name: 'A', Type: 2 }, middle = { Name: 'B', Type: 0 }, last = { Name: 'C', Type: 2 }
  for (const [source, from, expected] of [['deck','top',first], ['deck','bottom',last], ['discard','top',last], ['discard','bottom',first], ['burned','top',last], ['burned','bottom',first]]) {
    const pile = [first,middle,last]
    assert.equal(takePileCard(pile,source,from,2), expected)
    assert.deepEqual(pile, [first,middle,last].filter(card => card !== expected))
    assert.equal(takePileCard(pile,source,from,3), null)
    assert.equal(pile.length, 2)
  }
  for (const [type, name] of [[0,'существо'],[1,'предмет'],[2,'заклинание'],[3,'здание']]) {
    assert.deepEqual(entryPileDraw(`Вход: Возьмите ${name} из КС.`), { source: 'discard', from: 'top', count: 1, cardType: type })
  }
  assert.equal(entryPileDraw('Вход: Возьмите предмет и здание из КД, сбросьте что-то одно, а второе оставьте.'), null)
  assert.equal(entryPileDraw('Посмертно: Возьмите заклинание из КС.'), null)
})

test('«Вондерноп» saves the top card of each of the three listed piles on entry', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Вондерноп')
  assert.deepEqual(cardEffects.entrySavePiles(card.Description), ['deck', 'discard', 'burned'])
  assert.equal(supportedEntryEffect(card.Description), true)
  assert.equal(cardEffects.entrySavePiles('Посмертно: Вытащите по 1 карте из КД, КС и КСК и сберегите их.'), null)
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const entry = source.split(/\r?\n/u).find(line => line.startsWith('function entry('))
  for (const count of [0, 1, 2, 3]) {
    const names = ['deck', 'discard', 'burned']
    const piles = Object.fromEntries(names.map((name, index) => [name, count > index ? [{ Name: name, Type: 0 }] : []]))
    const owner = { ...piles, hand: [], saved: [] }
    const unit = { id: 'wondernop', card, owner: 0, row: 2, col: 2 }
    const players = [owner, { deck: [], discard: [], burned: [], hand: [], saved: [] }]
    runInNewContext(stripTypeScriptTypes(`${entry};entry(unit)`), {
      ...cardEffects, unit, board: { value: [unit] }, players: { value: players }, current: { value: 0 }, round: { value: 1 },
      pendingEntryTokenGain: { value: null }, pendingEntryFollowupId: { value: null }, unitDescription: currentUnit => currentUnit.card.Description,
      note: () => {}, finishEntryFollowup: () => {}, draw: () => assert.fail('Cards should be saved, not drawn to hand'),
    })
    assert.deepEqual(owner.saved.map(saved => saved.Name), names.slice(0, count))
    assert.deepEqual(names.map(name => owner[name].length), [0, 0, 0])
  }
})

test('«Манекен» cannot move or attack the player while any creature occupies a surrounding socket', async () => {
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const directStart=app.indexOf('async function direct('), directFunction=app.slice(directStart,app.indexOf('function damage(',directStart)); const functions=[directFunction,app.split(/\r?\n/u).find(line=>line.startsWith('function unitDragMode(')),app.split(/\r?\n/u).find(line=>line.startsWith('const canMove='))].join('\n')
  for (const owner of [0,1]) for (const [dr,dc,type,dying,allowed] of [
    [-1,-1,0,false,false], [-1,0,0,false,false], [-1,1,0,false,false], [0,-1,0,false,false],
    [0,1,0,false,false], [1,-1,0,false,false], [1,0,0,false,false], [1,1,0,false,false],
    [1,1,0,true,true], [1,0,3,false,true], [2,0,0,false,true],
  ]) {
    const unit = { id: 'mannequin', card: { Name: 'Манекен', Type: 0 }, owner, row: 2, col: 1, attack: 5, health: 2, speed: 0, attacks: 0 }
    const neighbor = { id: 'neighbor', card: { Type: type }, owner: 1-owner, row: 2+dr, col: 1+dc, dying, flippedTurns: 2 }
    const board = [unit, neighbor]
    const enemy = { health: 45, name: 'Противник' }
    const context = { ...cardEffects, unit, board: { value: board }, player: { value: { energy: 10 } }, enemy: { value: enemy }, enemyRow: { value: 2 }, current: { value: owner }, selection: { value: null }, localMovePending: { value: false },
      active: () => true, at: (row,col) => board.find(unit => unit.row === row && unit.col === col), unitHas: () => false,
      unitDescription: () => '', visual: () => {}, inform: () => {}, note: () => {}, coord: () => '',
      hitPlayer: (player, amount) => { player.health -= amount }, resolveCrown: () => {},
    }
    runInNewContext(stripTypeScriptTypes(functions), context)
    assert.equal(runInNewContext('canMove(unit,1,1)', context), allowed, JSON.stringify({owner,dr,dc,type,dying}))
    await runInNewContext('direct(unit)', context)
    assert.equal(enemy.health, allowed ? 40 : 45)
    assert.equal(unit.attacks, allowed ? 1 : 0)
  }
})

test('«Манекен» restriction reaches field attacks, drag previews and forced pushes', () => {
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = app.split(/\r?\n/u).filter(line => /^function (resolveMovementTriggers|attack|unitDragMode|push|canPush)\(/u.test(line)).join('\n')
  for (const blocked of [true,false]) {
    const unit = { id: 'unit', card: { Name: 'Манекен', Type: 0 }, owner: 0, row: 2, col: 1, attack: 5, health: 2, attacks: 0 }
    const building = { id: 'target', card: { Name: 'Здание', Type: 3 }, owner: 1, row: 2, col: 2, health: 10 }
    const neighbor = { id: 'neighbor', card: { Name: 'Сосед', Type: 0 }, owner: 0, row: 3, col: 0 }
    const board = [unit, building, ...(blocked ? [neighbor] : [])]
    const context = { ...cardEffects, applyMovementStateTriggers, unit, building, board: { value: board }, players: { value: [{ mana: 0, deck: [], hand: [], discard: [] }, { mana: 0, deck: [], hand: [], discard: [] }] }, wheatTokens: { value: [] }, current: { value: 0 }, selection: { value: null },
      active: () => true, unitHas: () => false, unitDescription: () => '', adjacent: () => true,
      at: (row,col) => board.find(unit => unit.row === row && unit.col === col),
      movementLock: { value: null }, attackResolutionDepth: 0, pendingDeaths: [],
      damage: (target, amount) => { target.health -= amount }, resolveCrown: () => {}, resolveTrap: () => {}, queueBranchTargets: () => {}, kill: () => {},
      visual: () => {}, inform: () => {}, note: () => {}, coord: () => '', applyDoggoBuffs: () => 0,
    }
    runInNewContext(stripTypeScriptTypes(functions), context)
    assert.equal(runInNewContext('unitDragMode(unit,2,2)', context), blocked ? null : 'attack')
    runInNewContext('attack(unit.id,2,2,building)', context)
    assert.equal(building.health, blocked ? 10 : 5)
    assert.equal(unit.attacks, blocked ? 0 : 1)
    assert.equal(runInNewContext('canPush(2,1)', context), !blocked)
    assert.equal(runInNewContext('push(2,1)', context), !blocked)
    assert.equal(unit.row, blocked ? 2 : 1)
  }
})

test('«Кик» discards and «Мут» returns field cards without death triggers, routing equipment separately', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const spellFunction = app.slice(app.indexOf('function spell('), app.indexOf('function finishSpell('))
  for (const name of ['Кик', 'Мут']) for (const owner of [0,1]) for (const type of [0,3]) for (const burns of [false,true]) {
    const spellCard = cards.find(card => card.Name === name)
    const players = [0,1].map(() => ({ hand: [], discard: [], burned: [], mana: 0 }))
    players[0].hand.push(spellCard)
    const item = { Name: 'Предмет', Description: burns ? 'Сжигается' : '' }
    const target = { id: 'target', owner, card: { Name: 'Цель', Type: type, Description: 'Посмертно: Возьмите карту.' }, item }
    const board = [target]
    let finished = 0
    runInNewContext(stripTypeScriptTypes(`${spellFunction}\nspell(0,target)`), {
      ...cardEffects, recordBurn: (owner, card) => owner.burned.push(card), target, board: { value: board }, players: { value: players }, player: { value: players[0] }, current: { value: 0 },
      notifyCardPlayed: () => [], spellNeedsTarget: () => true, clownTargetRequired: () => false,
      refund: () => assert.fail('Legal target must not refund'), inform: () => {},
      finishSpell: () => { players[0].hand.splice(0,1); finished++ },
      kill: () => assert.fail('Discard/return must not trigger death'),
    })
    assert.equal(finished, 1)
    assert.equal(board.length, 0)
    assert.deepEqual(players[owner][name === 'Мут' ? 'hand' : 'discard'].filter(card => card === target.card), [target.card])
    assert.deepEqual(players[owner][burns ? 'burned' : 'discard'].filter(card => card === item), [item])
    assert.equal(players[1-owner].hand.length + players[1-owner].discard.length + players[1-owner].burned.length, 0)
  }
})

test('mixed creature-or-building effects still require an enemy clown when available', () => {
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const clownFunction = app.split(/\r?\n/u).find(line => line.startsWith('function clownTargetRequired('))
  const clown = { id: 'clown', owner: 1, card: { Type: 0, Description: 'Клоун' } }
  const building = { id: 'building', owner: 1, card: { Type: 3, Description: '' } }
  const context = { ...cardEffects, clown, building, board: { value: [clown, building] }, unitHas: (unit, trait) => unit.card.Description.includes(trait) }
  runInNewContext(stripTypeScriptTypes(clownFunction), context)
  assert.equal(runInNewContext("clownTargetRequired(0,building,'Сбросьте выбранное существо или здание.')", context), true)
  assert.equal(runInNewContext("clownTargetRequired(0,clown,'Сбросьте выбранное существо или здание.')", context), false)
  assert.equal(runInNewContext("clownTargetRequired(0,building,'Уничтожьте здание.')", context), false)
})

test('«Кик» and «Мут» refund illegal targets and preserve all piles when an enemy clown must be selected', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const spellFunction = app.slice(app.indexOf('function spell('), app.indexOf('function finishSpell('))
  const clownFunction = app.split(/\r?\n/u).find(line => line.startsWith('function clownTargetRequired('))
  for (const name of ['Кик','Мут']) for (const invalid of ['missing','stale','flipped','dying','item','clown']) {
    const card = cards.find(card => card.Name === name)
    const player = { hand: [card], discard: [], burned: [], mana: 0 }
    const target = invalid === 'missing' ? undefined : { id: 'target', owner: 1, card: { Name: 'Цель', Type: invalid === 'item' ? 1 : 0, Description: '' }, flippedTurns: invalid === 'flipped' ? 1 : 0, dying: invalid === 'dying' }
    const clown = { id: 'clown', owner: 1, card: { Type: 0, Description: 'Клоун' } }
    const board = [...(target && invalid !== 'stale' ? [target] : []), ...(invalid === 'clown' ? [clown] : [])]
    const originalBoard = [...board]
    let refunds = 0
    runInNewContext(stripTypeScriptTypes(`${clownFunction}\n${spellFunction}\nspell(0,target)`), {
      ...cardEffects, target, board: { value: board }, current: { value: 0 }, player: { value: player },
      notifyCardPlayed: () => [], unitHas: (unit, trait) => unit.card.Description.includes(trait), spellNeedsTarget: () => true,
      refund: () => { player.mana += card.Cost; refunds++ }, inform: () => {},
      finishSpell: () => assert.fail('Illegal cast must not finish'),
    })
    assert.equal(refunds, 1)
    assert.equal(player.mana, card.Cost)
    assert.deepEqual(player.hand, [card])
    assert.deepEqual(board, originalBoard)
    assert.equal(player.discard.length + player.burned.length, 0)
  }
})

test('«Ваня Веремеев» saves an allied field card, including buildings, without firing its death', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const card = cards.find(card => card.Name === 'Ваня Веремеев')
  assert.deepEqual(entryTargetOperation(card.Description), { kind: 'save-allied-card' })
  assert.equal(supportedEntryEffect(card.Description), true)
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = app.split(/\r?\n/u).filter(line => /^function (entryTargetCandidates|resolveEntry)\(/u.test(line)).join('\n')
  for (const owner of [0, 1]) for (const type of [0, 3]) {
    const source = { id: 'source', card, owner }
    const target = { id: 'target', card: { Name: 'Цель', Type: type }, owner, item: { Name: 'Предмет' }, flippedTurns: 2 }
    const enemy = { id: 'enemy', card: { Name: 'Враг', Type: type }, owner: 1-owner }
    const players = [0, 1].map(() => ({ saved: [], discard: [] }))
    const board = [source, target, enemy]
    let resolved = 0
    runInNewContext(stripTypeScriptTypes(`${functions}\nresolveEntry(source.id,enemy);resolveEntry(source.id,target)`), {
      source, target, enemy, board: { value: board }, players: { value: players }, current: { value: owner },
      pendingEntryTokenGain: { value: { id: source.id, resolved: false } }, selection: { value: null },
      entryTargetOperation, unitDescription: unit => unit.card.Description, inform: () => {}, note: () => {},
      finishEntryFollowup: () => { resolved++ }, kill: () => assert.fail('Saving must not trigger death'),
    })
    assert.equal(resolved, 1)
    assert.deepEqual(players[owner].saved, [target.card])
    assert.deepEqual(players[owner].discard, [target.item])
    assert.deepEqual(board, [source, enemy])
  }
})

test('«Ваня Веремеев» death buffs all eight surrounding allied creature sockets and repeats with «Маринует мясо»', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const killFunction = app.slice(app.indexOf('function kill('), app.indexOf('function healCreature('))
  for (const repeats of [1, 2]) {
    const target = { id: 'dead', card: cards.find(card => card.Name === 'Ваня Веремеев'), owner: 0, row: 2, col: 1 }
    const neighbors = [-1,0,1].flatMap(dr => [-1,0,1].filter(dc => dr||dc).map(dc => ({
      id: `${dr}:${dc}`, card: { Name: 'Союзник', Type: 0 }, owner: 0, row: 2+dr, col: 1+dc,
      attack: 2, health: 3, maxHealth: 5, speed: 4, flippedTurns: 0,
    })))
    const excluded = [
      { ...neighbors[0], id: 'enemy', owner: 1 }, { ...neighbors[0], id: 'building', card: { Name: 'Здание', Type: 3 } },
      { ...neighbors[0], id: 'distant', row: 4 }, { ...neighbors[0], id: 'dying', dying: true },
    ]
    const aura = { id: 'aura', card: cards.find(card => card.Name === 'Маринует мясо'), owner: 0, row: 4, col: 2 }
    const players = [0,1].map(() => ({ hand: [], saved: [], burned: [], discard: [] }))
    const board = [target, ...neighbors, ...excluded, ...(repeats === 2 ? [aura] : [])]
    runInNewContext(stripTypeScriptTypes(`${killFunction}\nkill(target)`), {
      target, board: { value: board }, players: { value: players }, current: { value: 0 }, attackResolutionDepth: 0,
      effectsForTrigger, hasBurnTrait, burnsOnDeathFromField, recordBurn: (owner, card) => owner.burned.push(card), killRewardForCard, applyEntryNeighborBuff, applyCombatStatChanges,
      visual: () => {}, note: () => {}, window: { setTimeout: callback => callback() },
      damage: () => assert.fail('Buff must not damage neighbors'),
    })
    neighbors.forEach(unit => {
      assert.equal(unit.attack, 2+repeats); assert.equal(unit.health, 3+repeats)
      assert.equal(unit.maxHealth, 5+repeats); assert.equal(unit.speed, 4-repeats)
    })
    excluded.forEach(unit => assert.equal(unit.attack, 2))
  }
})

test('«Маринует мясо» doubles allied creature death effects without duplicating discarded cards', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const killFunction = app.slice(app.indexOf('function kill('), app.indexOf('function healCreature('))
  for (const [sourceOwner, flipped, dying, targetType, repeats] of [
    [0, 0, false, 0, 2], [1, 0, false, 0, 1], [0, 2, false, 0, 1], [0, 0, true, 0, 1], [0, 0, false, 3, 1],
  ]) {
    for (const name of ['ДастАроникс', 'Броненосец', 'Подрывник', 'Оранжевая', 'Ноэль', 'Диохазавр']) {
      const card = cards.find(card => card.Name === name)
      const aura = { id: 'aura', owner: sourceOwner, card: cards.find(card => card.Name === 'Маринует мясо'), flippedTurns: flipped, dying }
      const target = { id: 'target', owner: 0, card: { ...card, Type: targetType }, flippedTurns: 0, dying: false }
      const prior = Array.from({ length: 4 }, (_, index) => ({ Name: `Discard ${index}` }))
      const players = [0, 1].map(() => ({ hand: [], discard: [...prior], burned: [], saved: [], health: 10 }))
      const board = [aura, target]
      runInNewContext(stripTypeScriptTypes(`${killFunction}\nkill(target);kill(target)`), {
        target, board: { value: board }, players: { value: players }, current: { value: 0 }, attackResolutionDepth: 0,
        burnsOnDeathFromField, recordBurn: (owner, card) => owner.burned.push(card), hasBurnTrait, effectsForTrigger, killRewardForCard, takeTopDiscard,
        draw: player => player.hand.push({ Name: 'Drawn' }), heal: (player, amount) => { player.health += amount },
        hitPlayer: (player, amount) => { player.health -= amount },
        visual: () => {}, note: () => {}, window: { setTimeout: callback => callback() },
      })
      if (name === 'ДастАроникс') assert.equal(players[0].hand.length, repeats)
      if (name === 'Броненосец') assert.equal(players[0].health, 10 + 3 * repeats)
      if (name === 'Подрывник' || name === 'Оранжевая') assert.equal(players[1].health, 10 - 3 * repeats)
      if (name === 'Ноэль') assert.equal(players[0].hand.length, 2 * repeats)
      const zones = [...players[0].hand, ...players[0].discard, ...players[0].burned, ...players[0].saved]
      assert.equal(zones.filter(card => card === target.card).length, 1)
      if (name === 'Диохазавр') assert.equal(players[0].saved.length, 1)
    }
  }
})

test('«Маринует мясо» death repeats are fixed before a chained death removes the aura', () => {
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const killFunction = app.slice(app.indexOf('function kill('), app.indexOf('function healCreature('))
  const aura = { id: 'aura', owner: 0, card: { Name: 'Маринует мясо', Type: 0, Description: 'Клоун' } }
  const target = { id: 'target', owner: 0, card: { Name: 'Цепная смерть', Type: 0, Description: '' } }
  const victim = { id: 'victim', owner: 1, card: { Name: 'Враг', Type: 0, Description: '' } }
  const players = [0,1].map(() => ({ discard: [], burned: [], hand: [] }))
  const hits = []
  const board = [aura, target, victim]
  const context = {
    aura, target, board: { value: board }, players: { value: players }, current: { value: 0 }, attackResolutionDepth: 0,
    hasBurnTrait, burnsOnDeathFromField, recordBurn: (owner, card) => owner.burned.push(card), killRewardForCard,
    effectsForTrigger: (name, trigger) => name === target.card.Name && trigger === 'death' ? [{ kind: 'damage-all-cards', amount: 1 }] : [],
    damage: unit => { hits.push(unit.id); if (unit === aura) runInNewContext('kill(aura)', context) },
    visual: () => {}, note: () => {}, window: { setTimeout: callback => callback() },
  }
  runInNewContext(stripTypeScriptTypes(`${killFunction}\nkill(target)`), context)
  assert.deepEqual(hits, ['aura', 'victim', 'victim'])
  assert.deepEqual(players[0].discard, [target.card, aura.card])
  assert.deepEqual(board, [victim])
})

test('«Глифид-Преторианец» receives damage only from the socket directly behind, before shield consumption', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(card => card.Name === 'Глифид-Преторианец')
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const damageFunction = app.split(/\r?\n/u).find(line => line.startsWith('function damage('))
  for (const owner of [0, 1]) {
    for (const [rowOffset, colOffset, combat, flipped, shield, expectedHealth, expectedShield] of [
      [1, 0, true, 0, false, 7, false],
      [1, 0, true, 0, true, 10, false],
      [1, 1, true, 0, false, 10, false],
      [1, -1, true, 0, true, 10, true],
      [-1, 0, true, 0, false, 10, false],
      [0, 1, true, 0, true, 10, true],
      [2, 0, true, 0, false, 10, false],
      [1, 0, false, 0, false, 10, false],
      [1, 0, false, 0, true, 10, true],
      [-1, 0, true, 2, false, 10, false],
      [1, 0, false, 2, false, 10, false],
    ]) {
      const target = { card, owner, row: 2, col: 1, health: 10, maxHealth: 10, shield, flippedTurns: flipped }
      const source = { row: 2 + rowOffset * (owner === 0 ? 1 : -1), col: 1 + colOffset }
      runInNewContext(stripTypeScriptTypes(`${damageFunction}\ndamage(target,3,{killer:source,...(combat?{combatSource:source}:{})})`), {
        target, source, combat, board: { value: [target] }, incomingDamageReduction, applyUnitDamage,
        note: () => {}, kill: () => assert.fail('Nonlethal damage must not kill'), attackResolutionDepth: 0,
      })
      assert.equal(target.health, expectedHealth, JSON.stringify({ owner, rowOffset, colOffset, combat, flipped, shield }))
      assert.equal(target.shield, expectedShield)
    }
  }
})

test('«Глифид-Преторианец» protection checks both strikes and counterattacks in actual combat', () => {
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = app.split(/\r?\n/u).filter(line => /^function (attack|damage)\(/u.test(line)).join('\n')
  for (const [row, expectedAttackerHealth, expectedDefenderHealth] of [[1, 2, 3], [3, 5, 5]]) {
  const attacker = { id: 'attacker', owner: 0, card: { Name: 'Глифид-Преторианец', Type: 0 }, row, col: 1, attack: 2, health: 5, attacks: 0 }
  const defender = { id: 'defender', owner: 1, card: { Name: 'Глифид-Преторианец', Type: 0 }, row: 2, col: 1, attack: 3, health: 5 }
  runInNewContext(stripTypeScriptTypes(`${functions}\nattack(attacker.id,defender.row,defender.col,defender)`), {
    attacker, defender, board: { value: [attacker, defender] }, current: { value: 0 }, selection: { value: null },
    active: () => true, unitDescription: () => '', unitHas: () => false, adjacent: () => true,
    canAttackBoardCard, unitCanMoveAndAttack, canAttackTarget, shouldDealCombatDamage, attackDamageForCard, effectiveUnitAttack, canCounterattack, attackWasDiagonal,
    resolveAttackStages, attackResolutionDepth: 0, pendingDeaths: [],
    incomingDamageReduction, applyUnitDamage, kill: () => assert.fail('Nonlethal combat must not kill'),
    resolveCrown: () => {}, resolveTrap: () => {}, visual: () => {}, inform: () => {}, note: () => {}, coord: () => '',
  })
  assert.equal(attacker.health, expectedAttackerHealth)
  assert.equal(defender.health, expectedDefenderHealth)
  assert.equal(attacker.attacks, 1)
  }
})
import { addDistinctTarget, abilityDescription, abilityDescriptions, abilityCostResource, abilityDrawCount, applyCardEventEffect, applyStatBuff, applyTemporaryHealthBuff, applyUnitDamage, applyEntryNeighborBuff, attackDamageForCard, attackWasDiagonal, canActWhileFlipped, canAttackTarget, canBeAttackedByCombat, canCounterattack, canMoveTo, cardBurnEffect, burnGatedSpellOperation, consumeNextScoreAdjustment, countCreaturesOnField, incomingDamageReduction, ameHealingReward, effectCanTargetPlayer, effectConditionMet, effectsForTrigger, effectCanTargetEnemy, effectiveCardDescription, effectsWhenEquipped, entryDrawCount, entryHandLimitDelta, entryNeighborBuffs, entryOpponentDamage, entryTargetOperation, entryScoreConditionMet, entryScorePlayFromDeck, expireTemporaryAttack, expireTemporaryHealthBuff, temporaryHealthExpiresAtTurn, finishSpellFromHand, flipTimerTicks, forwardMoveDestination, flexibleHealOrStunEffect, globalHealingOperation, grantsRageUntilOwnerEnd, destroysFlippedThenFlipsSurvivors, hasBurnTrait, hasTemporaryRage, initialFlipTurns, isRepeatableAbility, itemGrantsShield, killRewardForCard, movementIsBlocked, mustChooseRemainingClown, mustTargetClown, opponentDamageAndHeal, playerHealAmount, removePlayedCardFromHand, resolveAttackStages, returnCardToHand, rulesForCard, resolveStartTurnStages, scoreConditionMet, scoreDiscountedCost, scoreExtraDrawCount, selectedTargetDamage, selectedDamageAndHeal, spellSelfDamage, shouldDealCombatDamage, shouldFinalizeDeath, spellCastEvent, startTurnEffect, takeCardFromHand, takeTopDiscard, targetedAbilityOperation, targetKindInDescription, targetMatchesKind, tickFlipAtOwnerEnd, winnerWhenPlayerFalls, entryTokenGain, grantEntryEffectTokens, flipTriggerEffect, resolveFlipTrigger, supportedEntryEffect, entryEffectConditionMet, entryBuffForCard, entryDebuffForCard, applyCombatStatChanges, gambaDamageOperation, adjustGambaRoll, payCardCost, refundCardCost, canUseHealthPayment } from '../../../packages/game-core/src/card-effects.ts'

test('«Ghorze» kill reward applies only to an enemy creature death', () => {
  assert.deepEqual(killRewardForCard('Ghorze', 0, 1, 0), { attack: 1, shield: true })
  assert.equal(killRewardForCard('Ghorze', 0, 0, 0), null)
  assert.equal(killRewardForCard('Ghorze', 0, 1, 3), null)
  assert.equal(killRewardForCard('Другая карта', 0, 1, 0), null)
})

test('«Админский арбалет» applies its equipped attack penalty and attack/death triggers', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Админский арбалет')
  assert.deepEqual(effectsWhenEquipped(card.Name), [{ kind: 'change-attack', amount: -10 }])
  assert.deepEqual(effectsForTrigger(card.Name, 'crown'), [{ kind: 'destroy-target', targetType: 'creature' }])
  assert.deepEqual(effectsForTrigger(card.Name, 'trap'), [{ kind: 'destroy-attacker' }])
})

test('«Коронный» effects dispatch on every attack, including face attacks', () => {
  assert.deepEqual(effectsForTrigger('Минт', 'crown'), [{ kind: 'draw', count: 1 }])
  assert.deepEqual(effectsForTrigger('Оранжевая', 'crown'), [{ kind: 'damage-player', amount: 1 }])
  assert.deepEqual(effectsForTrigger('Рагна', 'crown'), [{ kind: 'heal-attacker', amount: 3 }])
  assert.deepEqual(effectsForTrigger('Игла', 'crown'), [{ kind: 'gain-black-token', amount: 1 }])
  assert.deepEqual(effectsForTrigger('Дюп', 'crown'), [{ kind: 'increase-hand-limit', amount: 1 }, { kind: 'gain-black-token', amount: 1 }])
  assert.deepEqual(effectsForTrigger('TheVolkeR', 'crown'), [{ kind: 'play-saved-spell' }])
  assert.deepEqual(effectsForTrigger('Крипер', 'crown'), [{ kind: 'destroy-self' }])
  assert.deepEqual(effectsForTrigger('Без эффекта', 'crown'), [])
})

test('TheVolkeR lets its owner cast a saved spell for free after a crown attack', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const crown = source.split(/\r?\n/u).find(line => line.startsWith('function resolveCrown('))
  const choose = source.split(/\r?\n/u).find(line => line.startsWith('function playCrownSavedSpell('))
  const attacker = { id: 'volker', card: { Name: 'TheVolkeR' }, owner: 1 }
  const spell = { Id: 'spell', Name: 'Сохранённое заклинание', Type: 2, Description: '' }
  const creature = { Id: 'creature', Name: 'Существо', Type: 0, Description: '' }
  const player = { saved: [creature, spell], hand: [] }, players = { value: [{}, player] }, pendingCrownSavedSpell = { value: null }
  runInNewContext(stripTypeScriptTypes(`${crown};resolveCrown(attacker)`), {
    attacker, players, pendingCrownSavedSpell, rulesForCard, effectsForTrigger, note: () => {},
    draw: () => {}, heal: () => {}, healCreature: () => {}, hitPlayer: () => {}, damage: () => {}, kill: () => {},
    targetMatchesKind: () => false, transferItem: () => false, returnCardToHand: () => {}, effectiveUnitAttack: () => 0,
  })
  assert.equal(pendingCrownSavedSpell.value.owner, 1)
  assert.equal(pendingCrownSavedSpell.value.unitId, 'volker')
  const selection = { value: null }, freePlayCardId = { value: null }, current = { value: 1 }
  runInNewContext(stripTypeScriptTypes(`${choose};playCrownSavedSpell(1)`), {
    players, current, pendingCrownSavedSpell, selection, freePlayCardId, crypto: { randomUUID: () => 'free-id' },
    inform: () => {}, note: () => {},
  })
  assert.deepEqual(player.saved, [creature])
  assert.equal(player.hand.length, 1)
  assert.equal(player.hand[0].Id, 'free-id')
  assert.equal(freePlayCardId.value, 'free-id')
  assert.equal(selection.value.kind, 'hand')
  assert.equal(selection.value.index, 0)
  assert.equal(pendingCrownSavedSpell.value.owner, 1)
  assert.equal(pendingCrownSavedSpell.value.unitId, 'volker')
  assert.equal(pendingCrownSavedSpell.value.cardId, 'free-id')
  const appPlayer = { hand: player.hand, discard: [], burned: [], burnedThisTurn: false, nextScoreAdjustment: 0 }
  const finish = source.split(/\r?\n/u).find(line => line.startsWith('function finishSpell('))
  runInNewContext(stripTypeScriptTypes(`${finish};finishSpell(0)`), {
    player: { value: appPlayer }, current, pendingCrownSavedSpell, freePlayCardId, hasBurnTrait: () => false,
    finishSpellFromHand: cardEffects.finishSpellFromHand, consumeNextScoreAdjustment: cardEffects.consumeNextScoreAdjustment,
    heal: () => {}, draw: () => {}, recordBurn: () => {}, visual: () => {}, note: () => {}, selection: { value: null },
  })
  assert.equal(pendingCrownSavedSpell.value, null)
  assert.equal(freePlayCardId.value, null)
  assert.deepEqual(appPlayer.hand, [])
  assert.equal(appPlayer.discard[0].Name, spell.Name)
})

test('«Гастер» acts while flipped, moves, and does not take a counterattack after attacking', async () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Гастер')
  assert.equal(initialFlipTurns(card.Description), 2)
  assert.equal(canActWhileFlipped(card.Description), true)
  assert.deepEqual(tickFlipAtOwnerEnd(6, 2), { flippedTurns: 1, dies: false, reveals: false })
  assert.deepEqual(tickFlipAtOwnerEnd(6, 1), { flippedTurns: 0, dies: false, reveals: true })
  assert.equal(hasBurnTrait(card.Description), true)
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = ['resolveMovementTriggers', 'active', 'canMove', 'at', 'move', 'attack'].map(name => {
    if (name === 'move') { const start = source.indexOf('async function move('); return source.slice(start, source.indexOf('\nfunction resolveTrap(', start)) }
    const prefix = name === 'active' || name === 'canMove' || name === 'at' ? `const ${name}=` : `${name === 'move' ? 'async ' : ''}function ${name}(`
    return source.split(/\r?\n/u).find(line => line.startsWith(prefix))
  }).join('\n')
  const attacker = { id: 'gaster', card, owner: 0, row: 2, col: 1, attack: 6, health: 6, speed: 2, flippedTurns: 2, summoned: 0, attacks: 0, shield: false, dying: false, stunned: 0 }
  const defender = { id: 'defender', card: { Name: 'Defender', Type: 0, Description: '' }, owner: 1, row: 2, col: 2, attack: 4, health: 20, flippedTurns: 0, summoned: 0, attacks: 0, dying: false }
  const board = { value: [attacker, defender] }, player = { value: { energy: 5 } }, damageEvents = []
  const context = { attacker, defender, board, wheatTokens: { value: [] }, player, players: { value: [player.value, {}] }, current: { value: 0 }, round: { value: 3 }, movementLock: { value: null }, selection: { value: null },
    unitDescription: unit => unit.card.Description, unitHas: (unit, trait) => unit.card.Description.includes(trait), canActWhileFlipped, unitCanMoveAndAttack,
    unitMovementBlocked: () => false, movementIsBlocked: () => false, canMoveTo: cardEffects.canMoveTo, canAttackBoardCard, canAttackTarget,
    shouldDealCombatDamage: () => true, attackDamageForCard: (_name, attack) => attack, effectiveUnitAttack,
    canCounterattack: () => true, attackWasDiagonal, resolveAttackStages: cardEffects.resolveAttackStages, shouldFinalizeDeath,
    adjacent: () => true, at: (row, col) => board.value.find(unit => unit.row === row && unit.col === col), canMove: (_unit, row, col) => row === 2 && col === 0,
    movementIsBlocked: () => false, effectiveUnitSpeed: () => 2, animateUnitMove: () => {}, startDrop: () => {}, applyDoggoBuffs: () => 0, loadGameCore: testLoadGameCore, localMovePending: { value: false },
    damage: (unit, amount) => { damageEvents.push([unit.id, amount]); unit.health -= amount }, resolveCrown: () => {}, resolveTrap: () => {},
    localCoreChoice: { value: null }, visual: () => {}, note: () => {}, coord: () => '', inform: () => {}, unitDescriptionFor: () => '', Math,
    burnsOnDeathFromField: () => false, kill: () => {}, boardRef: board }
  await runInNewContext(`(async()=>{${stripTypeScriptTypes(`let attackResolutionDepth=0;const pendingDeaths=[];${functions};attack('gaster',2,2,defender);await move('gaster',2,0,false)`)}})()`, context)
  assert.deepEqual(damageEvents, [['defender', 6]])
  assert.equal(attacker.health, 6)
  assert.deepEqual([board.value[0].row, board.value[0].col, board.value[0].flippedTurns], [2, 0, 2])
  assert.equal(player.value.energy, 3)
  const kill = source.slice(source.indexOf('function kill('), source.indexOf('function healCreature('))
  const owner = { burned: [], discard: [], saved: [], burnedThisTurn: false }
  const dying = { ...attacker, id: 'dying-gaster', dying: false, flippedTurns: 2 }
  const deathBoard = { value: [dying] }
  runInNewContext(stripTypeScriptTypes(`let attackResolutionDepth=0;const pendingDeaths=[];${kill};kill(dying)`), {
    dying, board: deathBoard, players: { value: [owner, {}] }, current: { value: 0 }, hasBurnTrait, effectsForTrigger,
    burnsOnDeathFromField: () => false, killRewardForCard: () => null, recordBurn: (player, deadCard) => player.burned.push(deadCard),
    visual: () => {}, note: () => {}, window: { setTimeout: callback => callback() },
  })
  assert.deepEqual(owner.burned, [card])
  assert.deepEqual(owner.discard, [])
  assert.equal(deathBoard.value.length, 0)
})

test('«Джон» permanently gains two health per actual damage and survives a hit made lethal by that gain', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const damage = source.slice(source.indexOf('function damage('), source.indexOf('function kill('))
  const context = { incomingDamageReduction: () => 0, applyUnitDamage: cardEffects.applyUnitDamage, rulesForCard,
    hitPlayer: () => {}, note: () => {}, attackResolutionDepth: 0, kill: unit => { unit.dying = true }, pendingDeaths: [],
    board: { value: [] }, players: { value: [{ saved: [] }, {}] } }
  const john = { card: { Name: 'Джон', Type: 0 }, owner: 0, health: 3, maxHealth: 3, attack: 1, speed: 1, shield: false, flippedTurns: 0, dying: false }
  runInNewContext(stripTypeScriptTypes(`${damage};damage(john,2)`), { ...context, john })
  assert.deepEqual([john.health, john.maxHealth, john.attack, john.speed], [5, 7, 1, 1])
  const shielded = { ...john, health: 5, maxHealth: 7, shield: true }
  runInNewContext(stripTypeScriptTypes(`${damage};damage(shielded,8)`), { ...context, shielded })
  assert.deepEqual([shielded.health, shielded.maxHealth, shielded.shield], [5, 7, false])
  const reduced = { ...john, health: 3, maxHealth: 3, shield: false }
  runInNewContext(stripTypeScriptTypes(`${damage};damage(reduced,3)`), { ...context, reduced, incomingDamageReduction: () => 1 })
  assert.deepEqual([reduced.health, reduced.maxHealth], [5, 7])
  const lethal = { ...john, health: 3, maxHealth: 3, shield: false, dying: false }
  runInNewContext(stripTypeScriptTypes(`${damage};damage(lethal,5)`), { ...context, lethal })
  assert.deepEqual([lethal.health, lethal.maxHealth, lethal.dying], [8, 13, false])
})

test('«Дегра» flips after its crown and reveals after two owner turn endings', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Дегра')
  assert.equal(initialFlipTurns(card.Description), 0)
  assert.deepEqual(effectsForTrigger(card.Name, 'crown'), [{ kind: 'flip-attacker', turns: 2 }])
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = ['resolveCrown', 'applyFlip', 'tickFlippedCards'].map(name => source.split(/\r?\n/u).find(line => line.startsWith(`function ${name}(`))).join('\n')
  for (const owner of [0, 1]) {
    const attacker = { card, owner, health: 5, maxHealth: 5, attack: 4, flippedTurns: 0, dying: false }
    const context = { attacker, owner, board: { value: [attacker] }, players: { value: [{ mana: 0 }, { mana: 0 }] },
      rulesForCard, unitCanMoveAndAttack, effectsForTrigger, resolveFlipTrigger, flipTimerTicks, tickFlipAtOwnerEnd,
      unitDescription: unit => unit.card.Description, note: () => {}, coord: () => '',
      kill: () => assert.fail('Healthy Degra should reveal, not die') }
    runInNewContext(stripTypeScriptTypes(`${functions}\nresolveCrown(attacker);`), context)
    assert.equal(attacker.flippedTurns, 2)
    runInNewContext('tickFlippedCards(1-owner)', context)
    assert.equal(attacker.flippedTurns, 2)
    runInNewContext('tickFlippedCards(owner)', context)
    assert.equal(attacker.flippedTurns, 1)
    runInNewContext('tickFlippedCards(owner)', context)
    assert.equal(attacker.flippedTurns, 0)
  }
})

test('known trait spelling errors in the card catalogue resolve as canonical traits', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const predator = cards.find(card => card.Name === 'Хищник')
  const solGoodGem = cards.find(card => card.Name === 'Сол Гуд Гем')
  assert.ok(predator)
  assert.ok(solGoodGem)
  assert.match(effectiveCardDescription(predator.Description), /Невидимость/u)
  assert.match(effectiveCardDescription(solGoodGem.Description), /Безопасность/u)
  assert.equal(canBeAttackedByCombat(effectiveCardDescription(predator.Description)), true)
  assert.equal(canAttackTarget('Сол Гуд Гем', 0, 0, effectiveCardDescription(solGoodGem.Description).includes('Безопасность')), true)
})

test('global healing text resolves player, allied creature, and per-creature healing scopes', () => {
  assert.deepEqual(globalHealingOperation('Восстановите 10 здоровья обоим игрокам.'), { kind: 'heal-both-players', amount: 10 })
  assert.deepEqual(globalHealingOperation('Восстановите себе и своим существам 2 здоровья.'), { kind: 'heal-controller-and-units', amount: 2 })
  assert.deepEqual(globalHealingOperation('Восстановите 2 здоровья за каждое существо на поле'), { kind: 'heal-controller-per-creature', amount: 2 })
  assert.deepEqual(globalHealingOperation('Полностью восстанавливает здоровье всех ваших существ и зданий.'), { kind: 'heal-own-board' })
  assert.equal(globalHealingOperation('Восстановите себе 4 здоровья'), null)
})

test('direct spell healing reads an amount without confusing player and creature targets', () => {
  assert.equal(playerHealAmount('Восстановите 10 здоровья и сожгите карту.'), 10)
  assert.equal(playerHealAmount('Восстановите себе 4 здоровья'), 4)
  assert.equal(playerHealAmount('Востановите 15 здоровья. Сжигаеться'), 15)
  assert.equal(playerHealAmount('Восстановите 5 здоровья вашему существу.'), null)
  assert.equal(playerHealAmount('Восстановите 10 здоровья обоим игрокам.'), null)
  assert.equal(playerHealAmount('Восстановите 5 здоровья выбранной цели.'), null)
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const brapsi = cards.find(card => card.Name === 'Брэпси')
  assert.ok(brapsi)
  assert.equal(playerHealAmount(brapsi.Description), 10)
  assert.match(brapsi.Description, /Сжигается/u)
})

test('flexible heal-or-stun spells expose both amount and duration', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const fanfic = cards.find(card => card.Name === 'Фанфик Магната')
  assert.ok(fanfic)
  assert.deepEqual(flexibleHealOrStunEffect(fanfic.Description), { heal: 5, turns: 1 })
  assert.equal(effectCanTargetEnemy(fanfic.Description), true)
  assert.equal(targetMatchesKind(0, 'creature'), true)
  assert.equal(targetMatchesKind(3, 'creature'), false)
  assert.equal(flexibleHealOrStunEffect('Восстановите себе 4 здоровья'), null)
})

test('«Сдача трупа» applies its heal-and-draw effect when cast or burned', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const card = cards.find(item => item.Name === 'Сдача трупа')
  assert.ok(card)
  assert.deepEqual(cardBurnEffect(card.Description), { kind: 'heal-and-draw', heal: 5, draw: 1 })
  assert.equal(cardBurnEffect('Восстановите 5 здоровья и возьмите карту.'), null)
  assert.equal(hasBurnTrait(card.Description), false)
  assert.equal(spellCastEvent(card.Description), 'cast')
  assert.equal(hasBurnTrait('Сожгите существо.\nСжигается'), true)
  const empire = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Империя крови')
  assert.equal(hasBurnTrait(empire.Description), true)
  assert.equal(spellCastEvent('Сожгите существо.\nСжигается'), 'burn')
  const hiho = cards.find(item => item.Name === '@.hiho')
  assert.ok(hiho)
  assert.equal(hasBurnTrait(hiho.Description), true)
  for (const requestedEvent of ['cast', 'burn']) {
    const event = requestedEvent === 'cast' ? spellCastEvent(card.Description) : 'burn'
    let healing = 0, draws = 0
    const hand = [{ Description: card.Description }], discard = [], burned = []
    const resolve = requestedEvent === 'cast' ? finishSpellFromHand : (cardsInHand, cardsDiscard, cardsBurned, index, heal, draw) => takeCardFromHand(cardsInHand, cardsDiscard, cardsBurned, index, 'burn', heal, draw)
    assert.ok(resolve(hand, discard, burned, 0, amount => { healing += amount }, count => { draws += count }))
    assert.equal(hand.length, 0)
    assert.equal(event === 'burn' ? burned.length : discard.length, 1)
    assert.equal(healing, 5)
    assert.equal(draws, 1)
  }
  const hand = [{ Description: card.Description }]
  assert.ok(takeCardFromHand(hand, [], [], 0, 'discard', () => assert.fail(), () => assert.fail()))
})

test('temporary «Ярость» works for a granted creature until its owner-end death', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const ragebite = cards.find(card => card.Name === 'Рейджбайт 10 из 10')
  assert.ok(ragebite)
  assert.equal(grantsRageUntilOwnerEnd(ragebite.Description), true)
  assert.equal(hasTemporaryRage('Обычное существо', true), true)
  assert.equal(hasTemporaryRage('Обычное существо', false), false)
  assert.equal(hasTemporaryRage('Ярость', false), true)
})

test('the 5000 participants spell parser recognizes its flipped-card sweep text', () => {
  assert.equal(destroysFlippedThenFlipsSurvivors('Уничтожьте все перевёрнутые карты. Примените переверот 2 оставшимся.'), 2)
})

test('field-wide creature counts include face-down creatures but exclude cards already dying', () => {
  assert.equal(countCreaturesOnField([
    { type: 0, flipped: true },
    { type: 0, flipped: false },
    { type: 3, flipped: false },
    { type: 0, flipped: false, dying: true },
  ]), 2)
})

test('all catalog spells with per-creature healing use the supported global operation', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const adventure = cards.find(card => card.Name === 'Местячковое приключение')
  assert.ok(adventure)
  assert.deepEqual(globalHealingOperation(adventure.Description), { kind: 'heal-controller-per-creature', amount: 2 })
})

test('death triggers distinguish adjacent creatures from adjacent buildings', () => {
  assert.deepEqual(effectsForTrigger('Обсидиан пчёла', 'death'), [{ kind: 'damage-adjacent-creatures', amount: 2 }])
  assert.deepEqual(effectsForTrigger('Крипер', 'death'), [{ kind: 'damage-adjacent-buildings', amount: 4 }])
  assert.deepEqual(effectsForTrigger('ДастАроникс', 'death'), [{ kind: 'draw', count: 1 }])
  assert.deepEqual(effectsForTrigger('Броненосец', 'death'), [{ kind: 'heal-player', amount: 3 }])
  assert.deepEqual(effectsForTrigger('Подрывник', 'death'), [{ kind: 'damage-player', amount: 3 }])
  assert.deepEqual(effectsForTrigger('Оранжевая', 'death'), [{ kind: 'damage-player', amount: 3 }])
})

test('confirmed «Ловушка» effects dispatch when the card is attacked', () => {
  assert.deepEqual(effectsForTrigger('Кекич', 'trap'), [{ kind: 'destroy-attacker' }])
  assert.deepEqual(effectsForTrigger('Мина', 'trap'), [{ kind: 'damage-attacker', amount: 5 }])
  assert.deepEqual(effectsForTrigger('Оранжевая', 'trap'), [{ kind: 'damage-attacking-player', amount: 2 }])
  assert.deepEqual(effectsForTrigger('Джон совиный дом', 'trap'), [{ kind: 'take-control-attacker' }])
  assert.deepEqual(effectsForTrigger('Собирающий жук', 'trap'), [{ kind: 'give-item-to-attacker-and-buff', amount: 3 }])
  assert.deepEqual(effectsForTrigger('Собирающий жук', 'crown'), [])
  assert.deepEqual(entryTargetOperation('Вход: Забирает предмет у выбранного существа.'), { kind: 'take-target-item' })
  assert.deepEqual(effectsForTrigger('Вкидгранник', 'crown'), [{ kind: 'return-attacker-to-hand' }])
})

test('attack effects follow the written order: combat, «Коронный», then «Ловушка»', () => {
  const order = []
  resolveAttackStages(() => order.push('combat'), () => order.push('crown'), () => order.push('trap'), () => order.push('deaths'))
  assert.deepEqual(order, ['combat', 'crown', 'trap', 'deaths'])
})

test('lethal combat damage can be healed during trigger resolution, explicit kills cannot', () => {
  assert.equal(shouldFinalizeDeath(3, false), false)
  assert.equal(shouldFinalizeDeath(0, false), true)
  assert.equal(shouldFinalizeDeath(3, true), true)
})

test('start of turn resolves card effects and hand limit before passive resources', () => {
  const order = []
  resolveStartTurnStages(() => order.push('reset'), () => order.push('effects'), () => order.push('hand'), () => order.push('resources'))
  assert.deepEqual(order, ['reset', 'effects', 'hand', 'resources'])
})

test('simple beginning-of-turn resource effects target their controller or every turn as written', () => {
  assert.deepEqual(startTurnEffect('Постоянно: В начале хода получите 4 энергии'), {
    scope: 'owner-turn', operations: [{ kind: 'gain-energy', amount: 4 }],
  })
  assert.deepEqual(startTurnEffect('Постоянно: В начале каждого хода вы теряете 2 здоровья, но получаете 2 маны и 2 энергии.'), {
    scope: 'every-turn', operations: [
      { kind: 'damage-player', amount: 2 },
      { kind: 'gain-mana', amount: 2 },
      { kind: 'gain-energy', amount: 2 },
    ],
  })
  assert.deepEqual(startTurnEffect('Постоянно: В начале хода возьмите 2 карты. Если лимит карт 5 и больше, сожгите карту.'), {
    scope: 'owner-turn', operations: [{ kind: 'draw', count: 2 }],
  })
  assert.deepEqual(startTurnEffect('Постоянно: Наносит противнику 5 урона в начале хода.'), {
    scope: 'owner-turn', operations: [{ kind: 'damage-player', amount: 5, target: 'opponent' }],
  })
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const blueDiamond = cards.find(card => card.Name === 'Синий алмаз')
  assert.ok(blueDiamond)
  assert.deepEqual(startTurnEffect(blueDiamond.Description), {
    scope: 'owner-turn', operations: [{ kind: 'damage-player', amount: 5, target: 'opponent' }],
  })
  const pogan = cards.find(card => card.Name === 'Погань')
  assert.ok(pogan)
  assert.deepEqual(startTurnEffect(pogan.Description), {
    scope: 'owner-turn', operations: [{ kind: 'move-self-forward' }],
  })
  const shieldGenerator = cards.find(card => card.Name === 'Генератор щита')
  assert.deepEqual(startTurnEffect(shieldGenerator.Description), {
    scope: 'owner-turn', operations: [{ kind: 'shield-surrounding-creature' }],
  })
  assert.equal(startTurnEffect('Постоянно: В начале вашего хода заберите жетоны. Получите +1 ману за каждый жетон.'), null)
  assert.equal(startTurnEffect('Способность 2: Возьмите карту'), null)
})

test('«Чёрная меза» draws two cards then requires one burn only at hand limit five or more', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(card => card.Name === 'Чёрная меза')
  assert.ok(card)
  assert.deepEqual(startTurnEffect(card.Description), { scope: 'owner-turn', operations: [
    { kind: 'draw', count: 2 },
    { kind: 'burn-hand-card-if-hand-limit-at-least', minimumLimit: 5, count: 1 },
  ] })
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const startTurn = source.split(/\r?\n/u).find(line => line.startsWith('function startTurn()'))
  assert.ok(startTurn)
  for (const [limit, expectedBurns] of [[4, 0], [5, 1]]) {
    const owner = { hand: [{ Name: 'Existing' }], limit, mana: 0, energy: 0 }
    const unit = { owner: 0, dying: false, flippedTurns: 0, card }
    const pendingStartTurnBurns = { value: 0 }
    runInNewContext(`${stripTypeScriptTypes(startTurn)};startTurn()`, {
      player: { value: owner }, players: { value: [owner, {}] }, board: { value: [unit] }, current: { value: 0 }, round: { value: 1 }, screen: { value: 'game' },
      newHandCards: { value: [] }, handDrawStart: { value: 0 }, overLimit: { value: 0 }, chosenDiscard: { value: [] }, pendingStartTurnBurns, unitDescription: current => current.card.Description,
      startTurnEffect, resolveStartTurnStages: (reset, effects, hand, resources) => { reset(); effects(); hand(); resources() },
      draw: current => current.hand.push({ Name: 'Drawn' }), note: () => {},
    })
    assert.equal(pendingStartTurnBurns.value, expectedBurns)
    assert.equal(owner.hand.length, limit)
  }
})

test('«Ральзей» heals its entry effect owner and selects an enemy creature to stun', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(card => card.Name === 'Ральзей')
  assert.ok(card)
  assert.equal(cardEffects.entryPlayerHealAmount(card.Description), 4)
  assert.deepEqual(cardEffects.entryTargetOperation(card.Description), { kind: 'stun-target', turns: 1, targetOwner: 'enemy' })
  assert.equal(cardEffects.supportedEntryEffect(card.Description), true)
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const candidates = source.split(/\r?\n/u).find(line => line.startsWith('function entryTargetCandidates('))
  assert.ok(candidates)
  const unit = { id: 'ralzey', owner: 0, card }, enemy = { id: 'enemy', owner: 1, card: { Type: 0 }, dying: false, flippedTurns: 0 }
  const ally = { ...enemy, id: 'ally', owner: 0 }
  const operation = cardEffects.entryTargetOperation(card.Description)
  assert.deepEqual(runInNewContext(`${stripTypeScriptTypes(candidates)};entryTargetCandidates(source,operation).map(unit=>unit.id)`, { source: unit, operation, board: { value: [unit, enemy, ally] } }), ['enemy'])
  assert.match(source, /operation\.kind==='stun-target'/)
  assert.match(source, /target\.stunned\+=operation\.turns/)
  assert.match(source, /entryPlayerHealAmount\(description\)/)
})

test('«Мендор» lets its owner choose an allied creature to stun for two turns', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(card => card.Name === 'Мендор')
  assert.ok(card)
  assert.deepEqual(cardEffects.entryTargetOperation(card.Description), { kind: 'stun-target', turns: 2, targetOwner: 'ally' })
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const candidates = source.split(/\r?\n/u).find(line => line.startsWith('function entryTargetCandidates('))
  assert.ok(candidates)
  const unit = { id: 'mendor', owner: 0, card }, ally = { id: 'ally', owner: 0, card: { Type: 0 }, dying: false, flippedTurns: 0 }
  const enemy = { ...ally, id: 'enemy', owner: 1 }
  const operation = cardEffects.entryTargetOperation(card.Description)
  assert.deepEqual(runInNewContext(`${stripTypeScriptTypes(candidates)};entryTargetCandidates(source,operation).map(unit=>unit.id)`, { source: unit, operation, board: { value: [unit, ally, enemy] } }), ['ally'])
})

test('«Тюшма» only offers a stun target after its owner burned a card this turn', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Тюшма')
  assert.ok(card)
  const operation = cardEffects.entryTargetOperation(card.Description)
  assert.deepEqual(operation, { kind: 'stun-target', turns: 2, targetOwner: 'any', condition: 'burned-this-turn' })
  assert.equal(cardEffects.entryOperationConditionMet(operation, false), false)
  assert.equal(cardEffects.entryOperationConditionMet(operation, true), true)
})

test('«Рокочущий рыцарь» requires burning one chosen hand card at the start of its owner turn', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Рокочущий рыцарь')
  assert.deepEqual(startTurnEffect(card.Description), { scope: 'owner-turn', operations: [{ kind: 'burn-hand-card', count: 1 }] })
  const chooseHand = readFileSync(new URL('./App.vue', import.meta.url), 'utf8').split(/\r?\n/u).find(line => line.startsWith('function chooseHand('))
  const hand = [{ Name: 'Карта' }], burned = [], player = { hand, burned, burnedThisTurn: false }
  const context = { localCoreChoice: { value: null }, pendingNewcomers: { value: null }, pendingApril: { value: null }, pendingRottenThief: { value: null }, pendingCardPayment: { value: null }, pendingDiscordDrama: { value: null }, pendingCrownSavedSpell: { value: null }, ignoreHandClick: { value: false }, unplayedWarning: { value: false }, warningDiscardMode: { value: false }, pendingStartTurnBurns: { value: 1 }, recordBurn: (owner, card) => owner.burned.push(card), player: { value: player }, overLimit: { value: 1 }, note: () => {}, resolveViskassDiscard: () => false }
  runInNewContext(`${stripTypeScriptTypes(chooseHand)}; chooseHand(0)`, context)
  assert.deepEqual(burned, [{ Name: 'Карта' }])
  assert.deepEqual(hand, [])
  assert.equal(context.pendingStartTurnBurns.value, 0)
  assert.equal(context.overLimit.value, 0)
  assert.equal(player.burnedThisTurn, true)
})

test('«Вискас» chooses a hand discard or top deck draw on entry and on crown only above five cards', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Вискас')
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  assert.match(source.split(/\r?\n/u).find(line => line.startsWith('function entry(')), /queueViskassChoice\(effectOwner,description,'entry'\)/u)
  assert.match(source.split(/\r?\n/u).find(line => line.startsWith('function resolveCrown(')), /queueViskassChoice\(attacker.owner,unitDescription\(attacker\),'crown'\)/u)
  const functions = ['queueViskassChoice', 'chooseViskassOption', 'resolveViskassDiscard', 'chooseHand'].map(name => source.split(/\r?\n/u).find(line => line.startsWith(`function ${name}(`))).join('\n')
  const player = { hand: [{ Name: 'discard me' }], deck: [{ Name: 'top card' }], discard: [] }, pendingViskassChoice = { value: null }
  const context = { players: { value: [player, { hand: [], deck: [], discard: [] }] }, pendingViskassChoice, localCoreChoice: { value: null }, pendingNewcomers: { value: null }, chooseNewcomersSpell: () => {}, pendingApril: { value: null }, pendingRottenThief: { value: null }, pendingCardPayment: { value: null }, pendingDiscordDrama: { value: null }, pendingCrownSavedSpell: { value: null }, ignoreHandClick: { value: false }, scoreConditionMet, draw: owner => { const top = owner.deck.shift(); if (top) owner.hand.push(top) }, inform: () => {}, note: () => {} }
  runInNewContext(stripTypeScriptTypes(functions), context)
  assert.equal(runInNewContext(`queueViskassChoice(0, ${JSON.stringify(card.Description)}, 'entry')`, context), true)
  runInNewContext('chooseViskassOption(false)', context)
  assert.equal(player.hand[1].Name, 'top card')
  assert.equal(pendingViskassChoice.value, null)
  player.hand.push(...Array.from({ length: 3 }, (_, index) => ({ Name: `card ${index}` })))
  assert.equal(runInNewContext(`queueViskassChoice(0, ${JSON.stringify(card.Description)}, 'crown')`, context), false)
  player.hand.push({ Name: 'sixth card' })
  assert.equal(runInNewContext(`queueViskassChoice(0, ${JSON.stringify(card.Description)}, 'crown')`, context), true)
  runInNewContext('chooseViskassOption(true)', context)
  assert.equal(pendingViskassChoice.value.selectingDiscard, true)
  runInNewContext('chooseHand(0)', context)
  assert.equal(player.discard[0].Name, 'discard me')
  assert.equal(pendingViskassChoice.value, null)
})

test('«Бей своих чтобы чужие боялись» destroys two distinct allied creatures then weakens every enemy creature', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Бей своих чтобы чужие боялись')
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolver = source.split(/\r?\n/u).find(line => line.startsWith('function chooseFriendlySacrifice('))
  const spell = source.slice(source.indexOf('function spell('), source.indexOf('function finishSpell('))
  assert.ok(resolver, card.Description)
  const allies = [0,1].map(index => ({ id: `ally${index}`, owner: 0, card: { Name: `Союзник ${index}`, Type: 0 }, dying: false, attack: 3, speed: 4 }))
  const enemies = [0,1].map(index => ({ id: `enemy${index}`, owner: 1, card: { Name: `Враг ${index}`, Type: 0 }, dying: false, attack: 5, speed: 5 }))
  const board = { value: [...allies, ...enemies] }, pendingFriendlySacrifice = { value: { index: 0, chosen: [] } }, messages = []
  const context = { board, pendingFriendlySacrifice, current: { value: 0 }, player: { value: { hand: [card], nextScoreAdjustment: 0 } },
    notifyCardPlayed: () => [], applyCardPlayBuff: () => {}, spellNeedsTarget: () => true, clownTargetRequired: () => assert.fail('This allied sacrifice does not target an enemy clown.'),
    refund: () => assert.fail('Two allied creatures are available.'), inform: message => messages.push(message),
    kill: target => { target.dying = true },
    applyCombatStatChanges, finishSpell: index => { assert.equal(index, 0); pendingFriendlySacrifice.value = null },
    note: () => {} }
  runInNewContext(`${stripTypeScriptTypes(resolver)}\n${stripTypeScriptTypes(spell)}\nspell(0,allies[0]); chooseFriendlySacrifice(allies[0]); if(pendingFriendlySacrifice.value.chosen.length!==1) throw new Error('Duplicate selection changed the pending choice.'); chooseFriendlySacrifice(allies[1])`, { ...context, allies })
  assert.deepEqual(allies.map(target => target.dying), [true, true])
  assert.deepEqual(enemies.map(target => [target.attack, target.speed]), [[4,8],[4,8]])
})

test('«Брутфорс» moves a chosen creature only to an empty opponent starting-row socket', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Брутфорс')
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const spell = source.slice(source.indexOf('function spell('), source.indexOf('function finishSpell('))
  const move = source.split(/\r?\n/u).find(line => line.startsWith('function resolveSpellMove('))
  assert.match(spell, /c.Name==='Брутфорс'/u)
  assert.ok(move, card.Description)
  const target = { id: 'target', card: { Name: 'Существо', Type: 0 }, owner: 1, row: 2, col: 2, dying: false, flippedTurns: 0 }
  const blocker = { id: 'blocker', card: { Name: 'Блокер', Type: 0 }, owner: 1, row: 0, col: 1, dying: false }
  const board = { value: [target, blocker] }, pendingSpellMove = { value: { index: 0, unitId: target.id } }
  let finished = 0
  const context = { board, pendingSpellMove, enemyRow: { value: 0 }, coord: (row, col) => `${row},${col}`, finishSpell: index => { assert.equal(index, 0); finished++ }, inform: () => {} }
  runInNewContext(`${stripTypeScriptTypes(move)}\nresolveSpellMove(0,1)`, context)
  assert.deepEqual([target.row, target.col, finished], [2,2,0])
  runInNewContext(`${stripTypeScriptTypes(move)}\nresolveSpellMove(2,1)`, context)
  assert.deepEqual([target.row, target.col, finished], [2,2,0])
  runInNewContext(`${stripTypeScriptTypes(move)}\nresolveSpellMove(0,0)`, context)
  assert.deepEqual([target.row, target.col, finished, pendingSpellMove.value], [0,0,1,null])
})

test('«Белая дверь» moves a chosen creature or building to any legal empty socket', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Белая дверь')
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const choose = source.split(/\r?\n/u).find(line => line.startsWith("  if(c.Name==='Белая дверь')"))
  const move = source.split(/\r?\n/u).find(line => line.startsWith('function resolveSpellMove('))
  assert.ok(choose, card.Description)
  assert.ok(move, card.Description)
  const target = { id: 'target', card: { Name: 'Существо', Type: 0 }, owner: 1, row: 2, col: 2, dying: false, flippedTurns: 0 }
  const pendingSpellMove = { value: null }, board = { value: [target] }, player = { hand: [card], nextScoreAdjustment: 0 }
  let finished = 0
  new Function('c', 'target', 'i', 'pendingSpellMove', 'refundSpell', 'inform', choose)({ Name: card.Name }, target, 0, pendingSpellMove,
    () => assert.fail('Valid target must not refund'), () => {})
  assert.deepEqual(JSON.parse(JSON.stringify(pendingSpellMove.value)), { index: 0, unitId: target.id, mode: 'any' })
  assert.deepEqual([target.row, target.col, finished], [2,2,0])
  const context = { board, pendingSpellMove, enemyRow: { value: 0 }, coord: (row, col) => `${row},${col}`, finishSpell: index => { assert.equal(index, 0); finished++ }, inform: () => {} }
  runInNewContext(`${stripTypeScriptTypes(move)}\nresolveSpellMove(0,0)`, context)
  assert.deepEqual([target.row, target.col, finished, pendingSpellMove.value], [0,0,1,null])
  const building = { ...target, id: 'building', card: { Name: 'Здание', Type: 3 }, row: 2, col: 2 }
  const blocker = { id: 'blocker', card: { Name: 'Блокер', Type: 0 }, row: 2, col: 3, dying: false }
  board.value = [building, blocker]
  pendingSpellMove.value = { index: 0, unitId: building.id, mode: 'any' }
  runInNewContext(`${stripTypeScriptTypes(move)}\nresolveSpellMove(2,3)`, context)
  assert.deepEqual([building.row, building.col, finished], [2,2,1])
  runInNewContext(`${stripTypeScriptTypes(move)}\nresolveSpellMove(0,1)`, context)
  assert.deepEqual([building.row, building.col, finished], [2,2,1])
  assert.deepEqual(JSON.parse(JSON.stringify(pendingSpellMove.value)), { index: 0, unitId: building.id, mode: 'any' })
  runInNewContext(`${stripTypeScriptTypes(move)}\nresolveSpellMove(1,1)`, context)
  assert.deepEqual([building.row, building.col, finished, pendingSpellMove.value], [1,1,2,null])
})

test('«Аукцион» randomly keeps one field creature and destroys the others without touching buildings', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Аукцион')
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const spell = source.slice(source.indexOf('function spell('), source.indexOf('function finishSpell('))
  const creatures = Array.from({ length: 3 }, (_, index) => ({ id: `creature${index}`, card: { Name: `Creature ${index}`, Type: 0 }, owner: index % 2, row: index, col: 0, dying: false }))
  const building = { id: 'building', card: { Name: 'Building', Type: 3 }, owner: 1, row: 2, col: 2, dying: false }
  const board = { value: [...creatures, building] }, player = { hand: [card], nextScoreAdjustment: 0 }
  let finished = 0
  const context = { player: { value: player }, current: { value: 0 }, board, notifyCardPlayed: () => [], applyCardPlayBuff: () => {},
    spellNeedsTarget: () => false, clownTargetRequired: () => false, Math: { random: () => 0.5, floor: Math.floor, min: Math.min, max: Math.max },
    kill: target => { target.dying = true }, finishSpell: index => { assert.equal(index, 0); finished++ }, inform: () => {}, refund: () => assert.fail('Targetless auction should resolve') }
  runInNewContext(stripTypeScriptTypes(`${spell}\nspell(0)`), context)
  assert.deepEqual(creatures.map(target => target.dying), [true, false, true])
  assert.equal(building.dying, false)
  assert.equal(finished, 1)
})

test('«Вондертян» draws to eight and restores its temporary hand limit after overlapping changes', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Вондертян')
  assert.equal(cardEffects.entryDrawToHandSize(card.Description), 8)
  assert.equal(supportedEntryEffect(card.Description), true)
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const names = ['updateHandLimit', 'addTemporaryHandLimit', 'setTemporaryHandLimit', 'expireHandLimitEffects', 'resolveWonderTianEntry']
  const functions = names.map(name => source.split(/\r?\n/u).find(line => line.startsWith(`function ${name}(`)))
  assert.ok(functions.every(Boolean))
  const owner = { hand: Array.from({ length: 3 }, (_, index) => ({ Name: `hand${index}` })), deck: Array.from({ length: 10 }, (_, index) => ({ Name: `deck${index}` })), limit: 6, temporaryLimitExpirations: [1,5] }
  const notes = []
  const context = { current: { value: 0 }, round: { value: 1 }, draw: player => { const drawnCard = player.deck.shift(); if (drawnCard) player.hand.push(drawnCard) }, unitDescription: unit => unit.card.Description, entryDrawToHandSize: cardEffects.entryDrawToHandSize, note: message => notes.push(message),
    expireTemporaryHandLimit: cardEffects.expireTemporaryHandLimit }
  runInNewContext(stripTypeScriptTypes(functions.join('\n')), context)
  const unit = { card: { Name: 'Вондертян', Description: card.Description } }
  assert.equal(runInNewContext('resolveWonderTianEntry(unit, owner)', { ...context, unit, owner }), true)
  assert.equal(owner.hand.length, 8)
  assert.equal(owner.deck.length, 5)
  assert.equal(owner.limit, 8)
  assert.deepEqual(owner.temporaryLimitExpirations, [1,5])
  assert.equal(owner.temporaryLimitOverride.expiresAt, 2)
  runInNewContext('expireHandLimitEffects(owner,1); updateHandLimit(owner,1); addTemporaryHandLimit(owner,1,3)', { ...context, owner })
  assert.equal(owner.limit, 8)
  runInNewContext('expireHandLimitEffects(owner,2)', { ...context, owner })
  assert.equal(owner.limit, 7)
  runInNewContext('expireHandLimitEffects(owner,3)', { ...context, owner })
  assert.equal(owner.limit, 6)
  runInNewContext('expireHandLimitEffects(owner,5)', { ...context, owner })
  assert.equal(owner.limit, 5)
  assert.equal(owner.temporaryLimitExpirations.length, 0)
})

test('«Айсберг» gains one black token for each card burned by its controller while active', () => {
  const iceberg = { card: { Name: 'Айсберг' }, owner: 0, blackTokens: 0 }
  const flipped = { ...iceberg, blackTokens: 4, flippedTurns: 1 }
  const dying = { ...iceberg, blackTokens: 7, dying: true }
  assert.equal(cardEffects.gainBurnTriggerTokens([iceberg, flipped, dying], 0), 1)
  assert.deepEqual([iceberg.blackTokens, flipped.blackTokens, dying.blackTokens], [1, 4, 7])
  assert.equal(cardEffects.gainBurnTriggerTokens([iceberg], 1), 0)
  assert.equal(iceberg.blackTokens, 1)
  const recordBurn = readFileSync(new URL('./App.vue', import.meta.url), 'utf8').split(/\r?\n/u).find(line => line.startsWith('function recordBurn('))
  const owner = { burned: [] }, board = [iceberg]
  runInNewContext(`${stripTypeScriptTypes(recordBurn)};recordBurn(owner,card)`, { owner, card: { Name: 'Сожжённая карта' }, board: { value: board }, players: { value: [owner] }, gainBurnTriggerTokens: cardEffects.gainBurnTriggerTokens, note: () => {} })
  assert.deepEqual(owner.burned, [{ Name: 'Сожжённая карта' }])
  assert.equal(iceberg.blackTokens, 2)
})

test('«Айсберг» ability keeps its draw and temporary hand limit as explicit player choices', async () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Айсберг')
  assert.deepEqual(targetedAbilityOperation(card.Description), { kind: 'draw-or-increase-hand-limit', amount: 1 })
  const expirations = [3, 4]
  assert.equal(cardEffects.expireTemporaryHandLimit(expirations, 3), 1)
  assert.deepEqual(expirations, [4])
  const resolve = readFileSync(new URL('./App.vue', import.meta.url), 'utf8').split(/\r?\n/u).find(line => line.startsWith('async function resolveIcebergAbility('))
  for (const choice of ['draw', 'limit']) {
    const unit = { owner: 0, abilityUsed: false }, owner = { hand: [], limit: 4, temporaryLimitExpirations: [] }, pending = { value: { unit, index: 0 } }
    await runInNewContext(`(async()=>{${stripTypeScriptTypes(resolve)};await resolveIcebergAbility(choice)})()`, { choice, pendingIcebergAbility: pending, localCoreChoice: { value: null }, localMovePending: { value: false }, unitDescription: () => card.Description, abilityCost: () => 1, active: () => true, isRepeatableAbility: () => true, canPayAbility: () => true, payAbility: () => {}, players: { value: [owner] }, current: { value: 1 }, round: { value: 3 }, draw: () => owner.hand.push('card'), addTemporaryHandLimit: (player, amount, expiresAt) => { for (let index = 0; index < amount; index++) player.temporaryLimitExpirations.push(expiresAt); player.limit += amount }, note: () => {}, visual: () => {} })
    assert.equal(pending.value, null)
    if (choice === 'draw') assert.deepEqual(owner.hand, ['card'])
    else {
      assert.equal(owner.limit, 5)
      assert.deepEqual(owner.temporaryLimitExpirations, [7])
    }
  }
})

test('«Emptinessssss» entry gambles on damaging one creature per creature on the field', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Emptinessssss')
  assert.deepEqual(entryTargetOperation(card.Description), { kind: 'gamba-damage-each-creature', maximumRoll: 4 })
  const source = { id: 'source', owner: 0, card }, target = { id: 'target', owner: 1, card: { Type: 0 }, flippedTurns: 0, dying: false }
  const faceDown = { id: 'face-down', owner: 0, card: { Type: 0 }, flippedTurns: 1, dying: false }
  const building = { id: 'building', owner: 1, card: { Type: 3 }, dying: false }
  const board = [source, target, faceDown, building, { id: 'dying', card: { Type: 0 }, dying: true }]
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const candidates = app.split(/\r?\n/u).find(line => line.startsWith('function entryTargetCandidates('))
  const resolve = app.split(/\r?\n/u).find(line => line.startsWith('function resolveEntry('))
  const available = runInNewContext(`${stripTypeScriptTypes(candidates)};entryTargetCandidates(source,entryTargetOperation(source.card.Description))`, { source, board: { value: board }, entryTargetOperation })
  assert.deepEqual(available.map(unit => unit.id), ['target'])
  for (const [roll, expectedDamage] of [[4, 3], [5, null]]) {
    const dealt = [], ended = [], pendingEntryTokenGain = { value: null }, selection = { value: { kind: 'entry', id: source.id } }
    const rollGamba = app.split(/\r?\n/u).find(line => line.startsWith('function rollGamba('))
    runInNewContext(`${stripTypeScriptTypes(candidates)}\n${stripTypeScriptTypes(rollGamba)}\n${stripTypeScriptTypes(resolve)};resolveEntry(source.id,target,0)`, {
      source, target, board: { value: board }, players: { value: [{ nextGambaBonus: 0 }, {}] }, unitDescription: unit => unit.card.Description, entryTargetOperation, countCreaturesOnField,
      pendingEntryTokenGain, selection, adjustGambaRoll, Math: { floor: Math.floor, random: () => (roll - 1) / 6 },
      damage: (unit, amount) => dealt.push([unit, amount]), note: () => {}, finishEntryFollowup: unit => ended.push(unit),
    })
    assert.deepEqual(dealt.map(([, amount]) => amount), expectedDamage === null ? [] : [expectedDamage])
    assert.deepEqual(ended, [source])
    assert.equal(selection.value, null)
  }
})

test('«Булава» stuns the creature attacked by its equipped wearer on crown', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Булава')
  assert.deepEqual(cardEffects.effectsForTrigger(card.Name, 'crown'), [{ kind: 'stun-target', turns: 1 }])
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolve = app.split(/\r?\n/u).find(line => line.startsWith('function resolveCrown('))
  const attacker = { card: { Name: 'Носитель', Type: 0 }, item: card, owner: 0 }
  const target = { card: { Name: 'Цель', Type: 0 }, owner: 1, stunned: 0 }
  runInNewContext(`${stripTypeScriptTypes(resolve)};resolveCrown(attacker,target)`, { attacker, target, rulesForCard, effectsForTrigger: cardEffects.effectsForTrigger, note: () => {} })
  assert.equal(target.stunned, 1)
  const attack = app.split(/\r?\n/u).find(line => line.startsWith('function attack('))
  const wearer = { id: 'wearer', card: { Name: 'Носитель', Type: 0 }, item: card, owner: 0, row: 1, col: 0, attack: 1, health: 4, attacks: 0, flippedTurns: 0 }
  const defender = { id: 'defender', card: { Name: 'Цель', Type: 0 }, owner: 1, row: 1, col: 1, attack: 1, health: 4, stunned: 0, flippedTurns: 0 }
  const board = [wearer, defender]
  runInNewContext(`let attackResolutionDepth=0;const pendingDeaths=[];${stripTypeScriptTypes(attack)}\n${stripTypeScriptTypes(resolve)}\nattack('wearer',1,1,defender)`, {
    wearer, defender, board: { value: board }, current: { value: 0 }, selection: { value: null }, active: () => true, unitHas: () => false, unitDescription: () => '', adjacent: () => true,
    canAttackBoardCard, unitCanMoveAndAttack, canBeAttackedByCombat, canAttackTarget, shouldDealCombatDamage, attackDamageForCard, canCounterattack, attackWasDiagonal, effectiveUnitAttack: unit => unit.attack,
    resolveAttackStages: (combat, crown, trap, finish) => { combat(); crown(); trap(); finish() }, rulesForCard, effectsForTrigger: cardEffects.effectsForTrigger,
    burnsOnDeathFromField: () => false, damage: (unit, amount) => { unit.health -= amount }, resolveTrap: () => {}, visual: () => {}, note: () => {}, inform: () => {}, coord: () => '',
  })
  assert.equal(defender.stunned, 1)
})

test('«Бримстоун» also damages the opponent by the amount actually dealt in combat', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Бримстоун')
  const damage = readFileSync(new URL('./App.vue', import.meta.url), 'utf8').split(/\r?\n/u).find(line => line.startsWith('function damage('))
  for (const shield of [false, true]) {
    const attacker = { owner: 0, card: { Name: 'Носитель', Type: 0 }, item: card, attack: 3 }
    const target = { owner: 1, card: { Name: 'Цель', Type: 0 }, health: 5, shield, dying: false, flippedTurns: 0 }
    const players = [{ health: 45 }, { health: 45 }]
    runInNewContext(`${stripTypeScriptTypes(damage)};damage(target,3,{killer:attacker,combatSource:attacker})`, {
      target, attacker, players: { value: players }, board: { value: [attacker, target] },
      incomingDamageReduction, applyUnitDamage, rulesForCard, hitPlayer: (player, amount) => { player.health -= amount }, note: () => {},
      effectiveUnitAttack: unit => unit.attack, attackResolutionDepth: 0, kill: () => assert.fail('Nonlethal test should not kill'),
    })
    assert.equal(target.health, 5 - (shield ? 0 : 3))
    assert.equal(players[1].health, shield ? 45 : 42)
    assert.equal(target.shield, false)
  }
})

test('«Бэкфлип Кеннеди» cancels only the first legal attack against its equipped creature', () => {
  const catalog = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const item = catalog.find(card => card.Name === 'Бэкфлип Кеннеди')
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const transfer = source.split(/\r?\n/u).find(line => line.startsWith('function transferItem('))
  const attack = source.split(/\r?\n/u).find(line => line.startsWith('function attack('))
  const wearer = { id: 'wearer', card: { Name: 'Носитель', Type: 0 }, owner: 1, row: 2, col: 2, attack: 1, health: 5, maxHealth: 5, item: undefined, attacks: 0, nextAttackNegated: false, flippedTurns: 0, dying: false }
  const attacker = { id: 'attacker', card: { Name: 'Атакующий', Type: 0 }, owner: 0, row: 2, col: 1, attack: 2, health: 5, attacks: 0, flippedTurns: 0, dying: false }
  const board = [wearer, attacker], players = [{}, {}], called = { damage: 0, crown: 0, trap: 0 }
  runInNewContext(`${stripTypeScriptTypes(transfer)};transferItem(wearer,item)`, {
    wearer, item, players: { value: players }, rulesForCard, itemGrantsShield: () => false, effectsWhenEquipped: () => [], detachItem: () => {},
  })
  assert.equal(wearer.nextAttackNegated, true)
  runInNewContext(`let attackResolutionDepth=0;const pendingDeaths=[];${stripTypeScriptTypes(attack)};attack('attacker',2,2,wearer);attack('attacker',2,2,wearer)`, {
    attacker, wearer, board: { value: board }, current: { value: 0 }, selection: { value: null }, active: () => true, unitHas: (unit, trait) => unit === attacker && trait === 'Ярость',
    unitDescription: () => '', adjacent: () => true, canAttackBoardCard, unitCanMoveAndAttack, canBeAttackedByCombat, canAttackTarget,
    shouldDealCombatDamage, attackDamageForCard, canCounterattack: () => false, attackWasDiagonal, effectiveUnitAttack: unit => unit.attack,
    resolveAttackStages: (combat, crown, trap, finish) => { combat(); crown(); trap(); finish() },
    damage: (unit, amount) => { called.damage++; unit.health -= amount }, resolveCrown: () => { called.crown++ }, resolveTrap: () => { called.trap++ },
    visual: () => {}, note: () => {}, inform: () => {}, coord: () => '',
  })
  assert.equal(wearer.health, 3)
  assert.equal(attacker.attacks, 2)
  assert.deepEqual(called, { damage: 1, crown: 1, trap: 1 })
  assert.equal(wearer.nextAttackNegated, false)
})

test('«Джон Фараон» crown destroys any creature it attacks, including a safe allied target', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Джон Фараон')
  assert.deepEqual(cardEffects.effectsForTrigger(card.Name, 'crown'), [{ kind: 'destroy-target', targetType: 'creature' }])
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolve = app.split(/\r?\n/u).find(line => line.startsWith('function resolveCrown('))
  const attacker = { card, owner: 0 }, allied = { card: { Name: 'Союзник', Type: 0 }, owner: 0 }, building = { card: { Name: 'Здание', Type: 3 }, owner: 1 }
  const killed = []
  runInNewContext(`${stripTypeScriptTypes(resolve)};resolveCrown(attacker,allied);resolveCrown(attacker,building)`, {
    attacker, allied, building, rulesForCard, effectsForTrigger: cardEffects.effectsForTrigger,
    targetMatchesKind: (type, expected) => expected === 'creature' ? type === 0 : type === 3, kill: target => killed.push(target), note: () => {},
  })
  assert.deepEqual(killed, [allied])
})

test('«Геймнайт» draws two cards and raises the opponent hand limit through their turn end', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Геймнайт')
  const player = { hand: [card], nextScoreAdjustment: 0 }, opponent = { hand: [], limit: 4, temporaryLimitExpirations: [] }
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const spell = source.slice(source.indexOf('function spell('), source.indexOf('function finishSpell('))
  let draws = 0
  assert.deepEqual(cardEffects.spellDrawAndLimitEffect(card.Description), { drawCount: 2, opponentLimit: 2 })
  runInNewContext(`${stripTypeScriptTypes(spell)};spell(0)`, {
    ...cardEffects, player: { value: player }, players: { value: [player, opponent] }, current: { value: 0 }, round: { value: 2 }, board: { value: [] },
    addTemporaryHandLimit: (owner, amount, expiresAt) => { for (let index = 0; index < amount; index++) owner.temporaryLimitExpirations.push(expiresAt); owner.limit += amount },
    notifyCardPlayed: () => [], spellNeedsTarget: () => false, clownTargetRequired: () => false, refund: () => {}, applyCardPlayBuff: () => {},
    finishSpell: index => { player.hand.splice(index, 1) }, draw: () => { draws++ }, scoreExtraDrawCount: () => 0,
    optionalDiscardCount: { value: 0 }, note: () => {}, inform: () => {},
  })
  assert.equal(draws, 2)
  assert.equal(opponent.limit, 6)
  assert.deepEqual(opponent.temporaryLimitExpirations, [3, 3])
  opponent.limit = Math.max(1, opponent.limit - cardEffects.expireTemporaryHandLimit(opponent.temporaryLimitExpirations, 3))
  assert.equal(opponent.limit, 4)
  assert.deepEqual(opponent.temporaryLimitExpirations, [])
  assert.deepEqual(player.hand, [])
})

test('«Half-life 3» lets the caster choose one creature per flipped card and caps at available creatures', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Half-life 3')
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const spell = source.slice(source.indexOf('function spell('), source.indexOf('function finishSpell('))
  const choose = source.split(/\r?\n/u).find(line => line.startsWith('function chooseHalfLifeTarget('))
  for (const [flippedCount, creatureCount, expected] of [[2, 3, 2], [4, 2, 2], [0, 3, 0]]) {
    const flipped = Array.from({ length: flippedCount }, (_, index) => ({ id: `f${index}`, card: { Type: 0 }, flippedTurns: 2, dying: false }))
    const creatures = Array.from({ length: creatureCount }, (_, index) => ({ id: `c${index}`, card: { Type: 0, Name: `C${index}` }, flippedTurns: 0, dying: false }))
    const board = { value: [...flipped, ...creatures] }, pendingHalfLife = { value: null }, player = { value: { hand: [card] } }
    let finished = 0
    const context = { card, board, pendingHalfLife, player, current: { value: 0 }, players: { value: [{ hand: [card] }] },
      notifyCardPlayed: () => [], clownTargetRequired: () => false, spellNeedsTarget: () => true, globalFlipTurns: () => null,
      finishSpell: () => { finished++ }, refund: () => assert.fail('Valid target selection must not refund'),
      chooseHalfLifeTarget(target) { return runInNewContext('chooseHalfLifeTarget(target)', this.context) }, context: null,
      kill(target) { board.value.splice(board.value.indexOf(target), 1) }, inform: () => {} }
    context.context = context
    const runtime = `${choose}\n${spell}\nspell(0, flippedCount?creatures[0]:undefined); for(const target of creatures.slice(1)) if(pendingHalfLife.value) chooseHalfLifeTarget(target)`
    runInNewContext(stripTypeScriptTypes(runtime), { ...context, creatures, flippedCount })
    assert.equal(finished, 1)
    assert.equal(pendingHalfLife.value, null)
    assert.equal(board.value.filter(unit => unit.card.Type === 0 && !unit.flippedTurns).length, creatureCount - expected)
  }
})

test('ability text extraction stops before a separate ability or passive effect', () => {
  const description = 'Способность 2⚫: Нанесите 2 урона трём выбранным разным целям.\nСпособность 2⚫: Восстановите 2 здоровья трём выбранным разным целям.\nПостоянно: Не наносит урон.'
  assert.equal(abilityDescriptions(description).length, 2)
  assert.equal(abilityDescription(description), 'Способность 2⚫: Нанесите 2 урона трём выбранным разным целям.')
  assert.equal(abilityDescription(description, 1), 'Способность 2⚫: Восстановите 2 здоровья трём выбранным разным целям.')
})

test('simple repeatable draw abilities can be identified from their card text', () => {
  assert.equal(abilityDrawCount('Способность 2⭐: Возьмите карту'), 1)
  assert.equal(abilityDrawCount('Способность 3⭐: Возьмите 2 карты'), 2)
  assert.equal(abilityDrawCount('Способность 2⭐: Нанесите 3 урона выбранной цели'), null)
  assert.equal(isRepeatableAbility('Способность 1⭐🔁: Возьмите карту'), true)
  assert.equal(isRepeatableAbility('Способность 1⭐: Возьмите карту'), false)
})

test('«Генератор потех» ability draws a card through the shared ability resolver', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Генератор потех')
  assert.equal(abilityDescriptions(card.Description).length, 1)
  assert.equal(abilityDrawCount(card.Description), 1)
})

test('«Лусио» grants and removes temporary health without reducing below zero', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Лусио')
  assert.deepEqual(targetedAbilityOperation(card.Description), { kind: 'buff-allied-health', amount: 10 })
  const buffed = applyTemporaryHealthBuff({ health: 2, maxHealth: 4, temporaryHealth: 0 }, 10)
  assert.deepEqual(buffed, { health: 12, maxHealth: 14, temporaryHealth: 10 })
  assert.deepEqual(expireTemporaryHealthBuff({ ...buffed, health: 3 }), { health: 0, maxHealth: 4, temporaryHealth: 0 })
})

test('Лусио health expiry waits through the opponent turn', () => {
  assert.equal(temporaryHealthExpiresAtTurn(1, 0), false)
  assert.equal(temporaryHealthExpiresAtTurn(1, 1), true)
  assert.equal(temporaryHealthExpiresAtTurn(3, 2), false)
})

test('score conditions support exact counts and inclusive catalogue thresholds', () => {
  assert.equal(scoreConditionMet('Счёт >6: Сберегается', 6), false)
  assert.equal(scoreConditionMet('Счёт >6: Сберегается', 7), true)
  assert.equal(scoreConditionMet('Счёт 2<: Возьмите карты', 2), true)
  assert.equal(scoreConditionMet('Счёт 2<: Возьмите карты', 3), false)
  assert.equal(scoreConditionMet('Счёт 6: Получает порыв', 6), true)
  assert.equal(scoreConditionMet('Счёт 6: Получает порыв', 5), false)
  assert.equal(scoreConditionMet('Счёт <2: Вход', 1), true)
  assert.equal(scoreConditionMet('Счёт <2: Вход', 2), false)
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Алидастр')
  assert.equal(scoreConditionMet(card.Description, 7), true)
})

test('score threshold modifiers shift the requirement and preserve its comparison', () => {
  assert.equal(scoreConditionMet('Счёт ≥5: Вход', 4, -1), true)
  assert.equal(scoreConditionMet('Счёт ≥5: Вход', 5, 1), false)
  assert.equal(scoreConditionMet('Счёт 2≤: Вход', 3, 1), true)
  assert.equal(scoreConditionMet('Счёт 2≤: Вход', 2, -1), false)
  assert.equal(scoreConditionMet('Счёт 6: Вход', 7, 1), true)
  assert.equal(scoreConditionMet('Счёт 6: Вход', 6, -1), false)
})

test('score modifier is consumed only by a card with a score condition', () => {
  const player = { nextScoreAdjustment: -1 }
  assert.equal(consumeNextScoreAdjustment(player, 'Вход: Возьмите карту.'), 0)
  assert.equal(player.nextScoreAdjustment, -1)
  assert.equal(consumeNextScoreAdjustment(player, 'Счёт ≥5: Вход.'), -1)
  assert.equal(player.nextScoreAdjustment, 0)
})

test('returning a creature to hand moves its item to discard without a death effect', () => {
  const board = [{ id: 'unit', card: { Name: 'Вкидгранник' }, item: { Name: 'Предмет' } }]
  const hand = []
  const discard = []
  const returned = returnCardToHand(board, hand, discard, 'unit')
  assert.equal(returned.card.Name, 'Вкидгранник')
  assert.equal(board.length, 0)
  assert.deepEqual(hand, [{ Name: 'Вкидгранник' }])
  assert.deepEqual(discard, [{ Name: 'Предмет' }])
  assert.equal(returnCardToHand(board, hand, discard, 'missing'), null)
})

test('«Вкидгранник» entry only returns a creature when score is below two', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Вкидгранник')
  assert.equal(scoreConditionMet(card.Description, 1), true)
  assert.equal(scoreConditionMet(card.Description, 2), false)
  assert.deepEqual(entryTargetOperation(card.Description), { kind: 'return-creature-to-hand' })
})

test('«Блузк» always saves an allied creature and conditionally plays the deck top at score one or less', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Блузк')
  assert.deepEqual(entryTargetOperation(card.Description), { kind: 'save-target' })
  assert.deepEqual(entryScorePlayFromDeck(card.Description), { maximumHandCount: 1 })
  assert.equal(entryScoreConditionMet(card.Description, 1), true)
  assert.equal(entryScoreConditionMet(card.Description, 2), false)
})

test('«Мкия» score discounts hand card costs only at exactly eight cards', () => {
  const mkia = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Мкия')
  assert.equal(scoreDiscountedCost(3, mkia.Description, 7, 2), 3)
  assert.equal(scoreDiscountedCost(3, mkia.Description, 8, 2), 1)
  assert.equal(scoreDiscountedCost(1, mkia.Description, 8, 2), 0)
  assert.equal(scoreDiscountedCost(5, mkia.Description, 8, 2, 2), 1)
})

test('«100 правил драгонболла» adds three draws when score is at most two', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === '100 правил драгонболла')
  assert.equal(scoreExtraDrawCount(card.Description, 2), 3)
  assert.equal(scoreExtraDrawCount(card.Description, 3), 0)
})

test('multi-target selection rejects duplicates without losing earlier selections', () => {
  const first = addDistinctTarget(['a'], 'b')
  assert.deepEqual(first, ['a', 'b'])
  assert.equal(addDistinctTarget(first, 'a'), null)
})

test('taking the top discard card removes the most recently discarded card and handles an empty pile', () => {
  const discard = ['older', 'top']
  assert.equal(takeTopDiscard(discard), 'top')
  assert.deepEqual(discard, ['older'])
  assert.equal(takeTopDiscard([]), null)
})

test('playing a permanent card removes it from hand without putting it in discard', () => {
  const card = { Name: 'Creature', Description: '' }
  const hand = [card]
  assert.equal(removePlayedCardFromHand(hand, 0), card)
  assert.deepEqual(hand, [])
})

test('each ability on a card has its own text and operation', () => {
  const card = 'Способность 2⚫: Нанесите 2 урона трём выбранным разным целям.\nСпособность 2⚫: Восстановите 2 здоровья трём выбранным разным целям.'
  assert.equal(abilityDescriptions(card).length, 2)
  assert.deepEqual(targetedAbilityOperation(card, 0), { kind: 'damage-targets', amount: 2, count: 3 })
  assert.deepEqual(targetedAbilityOperation(card, 1), { kind: 'heal-targets', amount: 2, count: 3 })
  assert.equal(abilityCostResource(card, 0), 'black-token')
  assert.equal(abilityCostResource('Способность 3⭐: Возьмите карту', 0), 'mana')
  const bank = 'Способность 1⭐🔁: Получает 1⚫.\nСпособность 1⚫🔁: Вы получаете 1 ману.'
  assert.deepEqual(targetedAbilityOperation(bank, 0), { kind: 'gain-black-token', amount: 1 })
  assert.deepEqual(targetedAbilityOperation(bank, 1), { kind: 'gain-player-mana', amount: 1 })
  assert.equal(isRepeatableAbility(bank, 0), true)
  assert.equal(abilityCostResource(bank, 1), 'black-token')
  assert.deepEqual(targetedAbilityOperation('Способность 3: Получает щит.'), { kind: 'gain-self-shield' })
})

test('«Игла» catalogue abilities resolve as distinct three-target damage and healing', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Игла')
  assert.deepEqual(effectsForTrigger(card.Name, 'crown'), [{ kind: 'gain-black-token', amount: 1 }])
  assert.deepEqual(targetedAbilityOperation(card.Description, 0), { kind: 'damage-targets', amount: 2, count: 3 })
  assert.deepEqual(targetedAbilityOperation(card.Description, 1), { kind: 'heal-targets', amount: 2, count: 3 })
  assert.equal(abilityCostResource(card.Description, 0), 'black-token')
  assert.equal(abilityCostResource(card.Description, 1), 'black-token')
  assert.deepEqual(addDistinctTarget(['a', 'b'], 'c'), ['a', 'b', 'c'])
  assert.equal(addDistinctTarget(['a', 'b'], 'a'), null)
})

test('«Дюп» catalogue entry and crown effects are parsed for an equipped item', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Дюп')
  assert.equal(entryHandLimitDelta(card.Description), -2)
  assert.deepEqual(effectsWhenEquipped(card.Name), [])
  assert.deepEqual(effectsForTrigger(card.Name, 'crown'), [{ kind: 'increase-hand-limit', amount: 1 }, { kind: 'gain-black-token', amount: 1 }])
  assert.equal(abilityCostResource(card.Description), 'black-token')
  assert.deepEqual(targetedAbilityOperation(card.Description), { kind: 'adjust-next-score' })
})

test('catalogue movement lock and burn-gated destruction resolve for «Noovse» and «Swoon»', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const noovse = cards.find(item => item.Name === 'Noovse')
  const swoon = cards.find(item => item.Name === 'Swoon')
  assert.deepEqual(targetedAbilityOperation(noovse.Description), { kind: 'lock-movement-next-turn' })
  assert.deepEqual(burnGatedSpellOperation(swoon.Description), { kind: 'destroy-target', targetType: 'creature' })
  assert.equal(effectConditionMet(swoon.Description, true), true)
  assert.equal(effectConditionMet(swoon.Description, false), false)
})

test('common single-target ability text maps to damage, healing, stun, and destroy operations', () => {
  assert.deepEqual(targetedAbilityOperation('Способность 5⭐: Наносит 8 урона выбранной цели.'), { kind: 'damage-target', amount: 8 })
  assert.deepEqual(targetedAbilityOperation('Способность 2: Наносит 2 урона выбранному существу.'), { kind: 'damage-target', amount: 2, targetType: 'creature' })
  assert.deepEqual(targetedAbilityOperation('Способность 3: Восстанавливает выбранному существу 3 здоровья и даёт щит.'), { kind: 'heal-target', amount: 3, shield: true, targetType: 'creature' })
  assert.deepEqual(targetedAbilityOperation('Способность 3: Восстанавливает выбранному сущесвту 3 здоровья и даёт щит.'), { kind: 'heal-target', amount: 3, shield: true, targetType: 'creature' })
  assert.deepEqual(targetedAbilityOperation('Способность 2: Выбранное существо получает оглушение 1.'), { kind: 'stun-target', turns: 1 })
  assert.deepEqual(targetedAbilityOperation('Способность 2: Убивает выбранное существо.'), { kind: 'destroy-target', targetType: 'creature' })
  assert.deepEqual(targetedAbilityOperation('Способность 0⭐: Умирает'), { kind: 'destroy-self' })
  assert.deepEqual(targetedAbilityOperation('Способность 0⭐: Сбрасывается'), { kind: 'destroy-self' })
  assert.deepEqual(targetedAbilityOperation('Способность 0: Уничтожается'), { kind: 'destroy-self' })
  assert.equal(targetedAbilityOperation('Способность 2: Перенеситесь на выбранный сокет.'), null)
  assert.deepEqual(targetedAbilityOperation('Способность 5 Переноситься на выбранный сокет, все существа вокруг получают оглушение 1.'), { kind: 'move-self', stunAdjacent: 1 })
  assert.deepEqual(targetedAbilityOperation('Способность 2: Меняеться местами с выбранным существом.'), { kind: 'swap-self' })
  assert.deepEqual(targetedAbilityOperation('Способность 0: Переносится на любой не занятый сокет.'), { kind: 'move-self' })
  assert.deepEqual(targetedAbilityOperation('Способность 4: Переносит выбранное существо в сокет перед собой.'), { kind: 'move-target-front' })
  assert.deepEqual(targetedAbilityOperation('Способность 2: Сберегает выбранную карту на поле.'), { kind: 'save-target' })
  assert.deepEqual(targetedAbilityOperation('Способность 5⭐: Выбранное существо отправляется наверх КД владельца.'), { kind: 'put-target-on-deck' })
  assert.deepEqual(targetedAbilityOperation('Способность 2⚫: Нанесите 2 урона трём выбранным разным целям.\nСпособность 2⚫: Восстановите 2 здоровья трём выбранным разным целям.'), { kind: 'damage-targets', amount: 2, count: 3 })
  assert.deepEqual(targetedAbilityOperation('Способность 2⚫: Нанесите 2 урона трём выбранным разным целям.\nСпособность 2⚫: Восстановите 2 здоровья трём выбранным разным целям.', 1), { kind: 'heal-targets', amount: 2, count: 3 })
  assert.deepEqual(targetedAbilityOperation('Способность 1: Наносит 1 урона существам на линии.'), { kind: 'damage-line', amount: 1 })
  assert.deepEqual(targetedAbilityOperation('Способность 1: Наносит 1 урона противнику.'), { kind: 'damage-opponent', amount: 1 })
  assert.deepEqual(targetedAbilityOperation('Способность 0⭐: Уничтожает ваше здание что бы дать получить +4⚔️ до конца хода.'), { kind: 'sacrifice-building-for-attack', amount: 4 })
  assert.deepEqual(targetedAbilityOperation('Способность 3: Возьмите верхнюю карту из КС.'), { kind: 'take-discard-top' })
  assert.deepEqual(targetedAbilityOperation('Способность 6⭐: На следующем ходу все существа не могут передвигаться до начала вашего следующего хода.'), { kind: 'lock-movement-next-turn' })
})

test('«Биби» destroys an allied building for +4 attack until its owner ends the turn', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Биби')
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolve = source.split(/\r?\n/u).find(line => line.startsWith('function resolveAbility('))
  const unit = { id: 'bibi', owner: 0, row: 0, col: 0, abilityUsed: false, attack: 1, temporaryAttack: 0, card }
  const building = { id: 'building', owner: 0, card: { Name: 'Здание', Type: 3 }, dying: false, flippedTurns: 0 }
  const board = { value: [unit, building] }, selection = { value: { kind: 'ability' } }, paid = []
  const context = { board, players: { value: [{}, {}] }, current: { value: 0 }, movementLock: { value: null }, selection,
    localCoreChoice: { value: null },
    unitDescription: target => target.card.Description, abilityDescription: () => card.Description, abilityCost: () => 0,
    targetedAbilityOperation: () => ({ kind: 'sacrifice-building-for-attack', amount: 4 }), active: () => true,
    canPayAbility: () => true, movementIsBlocked: () => false, kill: target => { target.dying = true }, payAbility: (...args) => paid.push(args),
    isRepeatableAbility: () => false, visual: () => {}, note: () => {}, inform: () => {}, clownTargetRequired: () => false }
  runInNewContext(`${stripTypeScriptTypes(resolve)}\nresolveAbility(unit.id,0,0,building,0)`, { ...context, unit, building })
  assert.equal(building.dying, true)
  assert.deepEqual([unit.attack, unit.temporaryAttack, unit.abilityUsed, selection.value], [5,4,true,null])
  assert.equal(paid.length, 1)
  const expired = expireTemporaryAttack(unit)
  assert.deepEqual([expired.attack, expired.temporaryAttack], [1,0])
})

test('«Сьюзи» pays five mana and deals eight damage to its chosen target', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Сьюзи')
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolve = source.split(/\r?\n/u).find(line => line.startsWith('function resolveAbility('))
  const unit = { id: 'suzy', owner: 0, row: 0, abilityUsed: false, card }
  const target = { id: 'target', owner: 1, card: { Name: 'Цель', Type: 0 } }
  const board = { value: [unit, target] }, selection = { value: { kind: 'ability' } }, spent = [], dealt = []
  const context = { board, target, players: { value: [{}, {}] }, current: { value: 0 }, movementLock: { value: null }, selection,
    localCoreChoice: { value: null },
    unitDescription: item => item.card.Description, abilityDescription: cardEffects.abilityDescription, abilityCost: () => 5,
    targetedAbilityOperation: cardEffects.targetedAbilityOperation, active: () => true, isRepeatableAbility: () => false,
    canPayAbility: () => true, movementIsBlocked: () => false, clownTargetRequired: () => false,
    targetMatchesKind: cardEffects.targetMatchesKind, payAbility: (...args) => spent.push(args),
    damage: (...args) => dealt.push(args), coord: () => '0,0', visual: () => {}, note: () => {}, inform: message => assert.fail(message) }
  assert.deepEqual(cardEffects.targetedAbilityOperation(card.Description), { kind: 'damage-target', amount: 8 })
  assert.equal(cardEffects.abilityCanTargetPlayer(card.Description, 0, true, card.Name), true)
  assert.equal(cardEffects.abilityCanTargetPlayer(card.Description, 0, false, card.Name), false)
  runInNewContext(`${stripTypeScriptTypes(resolve)};resolveAbility('suzy',0,0,target)`, context)
  assert.deepEqual(spent, [[unit, 5, 0]])
  assert.equal(dealt.length, 1)
  assert.equal(dealt[0][0], target)
  assert.equal(dealt[0][1], 8)
  assert.equal(dealt[0][2].killer, unit)
  assert.equal(unit.abilityUsed, true)
  assert.equal(selection.value, null)
})

test('«Тау-пушка» gains attack from its zero-cost equipment ability', async () => {
  const cannon = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Тау-пушка')
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const useAbility = source.split(/\r?\n/u).find(line => line.startsWith('async function useAbility('))
  const unit = { id: 'host', owner: 0, card: { Name: 'Host', Description: 'Способность 1: Получает щит.' }, item: cannon, attack: 2, abilityUsed: false }
  const spent = [], checks = []
  const context = { unit, unitDescription: current => `${current.card.Description}\n${current.item.Description}`,
    abilityDescription: cardEffects.abilityDescription, abilityDescriptions: cardEffects.abilityDescriptions,
    active: () => true, isRepeatableAbility: () => false, abilityCost: () => 0, canPayAbility: () => true,
    targetedAbilityOperation: () => null, localMovePending: { value: false }, applyLocalCommand: async () => { throw Object.assign(new Error('local fallback'), { code: 'UNSUPPORTED_EFFECT' }) }, payAbility: (...args) => spent.push(args),
    resolveTauCannon: current => checks.push(current), note: () => {}, inform: message => assert.fail(message) }
  await runInNewContext(`${stripTypeScriptTypes(useAbility)};useAbility(unit,1)`, context)
  assert.equal(unit.attack, 3)
  assert.equal(unit.abilityUsed, true)
  assert.deepEqual(spent, [[unit, 0, 1]])
  assert.deepEqual(checks, [unit])
  assert.match(source, /board\.value\.forEach\(resolveTauCannon\)/u)
})

test('«Тау-пушка» burns itself and kills its host at five attack', () => {
  const resolve = readFileSync(new URL('./App.vue', import.meta.url), 'utf8').split(/\r?\n/u).find(line => line.startsWith('function resolveTauCannon('))
  assert.ok(resolve)
  const cannon = { Name: 'Тау-пушка' }, host = { id: 'host', owner: 0, card: { Name: 'Существо' }, item: cannon, attack: 4, dying: false }
  const owner = { burnedThisTurn: false }, burned = [], killed = []
  const context = { host, players: { value: [owner, {}] }, current: { value: 0 }, detachItem: unit => { unit.item = undefined; return cannon },
    recordBurn: (player, card) => { burned.push([player, card]); return true }, kill: unit => killed.push(unit), note: () => {} }
  runInNewContext(`${stripTypeScriptTypes(resolve)};resolveTauCannon(host)`, context)
  assert.equal(host.item, cannon)
  assert.equal(burned.length, 0)
  assert.equal(killed.length, 0)
  host.attack = 5
  runInNewContext(`${stripTypeScriptTypes(resolve)};resolveTauCannon(host)`, context)
  assert.equal(host.item, undefined)
  assert.deepEqual(burned, [[owner, cannon]])
  assert.deepEqual(killed, [host])
  assert.equal(owner.burnedThisTurn, true)
})

test('«Жемчуг Маши» arms +3 damage for its next creature attack', async () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Жемчуг Маши')
  assert.deepEqual(cardEffects.targetedAbilityOperation(card.Description), { kind: 'next-attack-splash', amount: 3 })
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const useAbility = source.split(/\r?\n/u).find(line => line.startsWith('async function useAbility('))
  const unit = { id: 'pearl', owner: 0, card, attack: 3, abilityUsed: false, nextAttackSplashDamage: 0 }
  const spent = [], selection = { value: { kind: 'unit' } }
  const context = { unit, unitDescription: current => current.card.Description, abilityDescription: cardEffects.abilityDescription,
    active: () => true, isRepeatableAbility: () => false, abilityCost: () => 5, canPayAbility: () => true,
    targetedAbilityOperation: cardEffects.targetedAbilityOperation, localMovePending: { value: false }, applyLocalCommand: async () => { throw Object.assign(new Error('local fallback'), { code: 'UNSUPPORTED_EFFECT' }) }, payAbility: (...args) => spent.push(args),
    visual: () => {}, selection, note: () => {}, inform: message => assert.fail(message) }
  await runInNewContext(`${stripTypeScriptTypes(useAbility)};useAbility(unit,0)`, context)
  assert.equal(unit.nextAttackSplashDamage, 3)
  assert.equal(unit.abilityUsed, true)
  assert.deepEqual(spent, [[unit, 5, 0]])
})

test('«Жемчуг Маши» deals the extra damage to the attacked creature and its horizontal neighbors once', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const attack = source.split(/\r?\n/u).find(line => line.startsWith('function attack('))
  const pearl = { id: 'pearl', owner: 0, card: { Name: 'Жемчуг Маши', Type: 0 }, row: 1, col: 2, attack: 3, attacks: 0, nextAttackSplashDamage: 3 }
  const target = { id: 'target', owner: 1, card: { Name: 'Цель', Type: 0 }, row: 2, col: 2, health: 10 }
  const left = { id: 'left', owner: 1, card: { Name: 'Слева', Type: 0 }, row: 2, col: 1, health: 10 }
  const right = { id: 'right', owner: 1, card: { Name: 'Справа', Type: 0 }, row: 2, col: 3, health: 10 }
  const board = { value: [pearl, target, left, right] }, dealt = []
  const context = { pearl, target, board, current: { value: 0 }, selection: { value: null }, active: () => true,
    unitCanMoveAndAttack: () => true, unitHas: () => false, unitDescription: () => '', adjacent: () => true,
    canAttackBoardCard: () => true, canAttackTarget: () => true, canBeAttackedByCombat: () => true,
    shouldDealCombatDamage: () => true, attackDamageForCard: (_name, attack) => attack, effectiveUnitAttack: unit => unit.attack,
    canCounterattack: () => false, attackWasDiagonal: () => false,
    resolveAttackStages: (combat, crown, trap, finish) => { combat(); crown(); trap(); finish() },
    resolveCrown: () => {}, resolveTrap: () => {}, damage: (unit, amount) => { dealt.push([unit.id, amount]); unit.health -= amount },
    visual: () => {}, note: () => {}, inform: message => assert.fail(message), coord: () => '2,2',
    burnsOnDeathFromField: () => false, shouldFinalizeDeath: () => false }
  runInNewContext(`let attackResolutionDepth=0;const pendingDeaths=[];${stripTypeScriptTypes(attack)};attack('pearl',2,2,target)`, context)
  assert.deepEqual(dealt, [['target', 3], ['target', 3], ['left', 3], ['right', 3]])
  assert.equal(pearl.nextAttackSplashDamage, 0)
  assert.equal(pearl.attacks, 1)

  const safePearl = { ...pearl, attacks: 0, nextAttackSplashDamage: 3 }
  const safeTarget = { ...target, owner: 0 }, safeLeft = { ...left, owner: 0 }, safeRight = { ...right, owner: 0 }
  const safeDealt = [], safeBoard = { value: [safePearl, safeTarget, safeLeft, safeRight] }
  runInNewContext(`let attackResolutionDepth=0;const pendingDeaths=[];${stripTypeScriptTypes(attack)};attack('pearl',2,2,target)`, {
    ...context, pearl: safePearl, target: safeTarget, board: safeBoard, shouldDealCombatDamage: () => false,
    damage: (unit, amount) => safeDealt.push([unit.id, amount]),
  })
  assert.deepEqual(safeDealt, [['target', 3], ['left', 3], ['right', 3]])
})

test('an equipped item adds its traits and ability text to its creature', () => {
  const combined = effectiveCardDescription('Обычное существо', 'Досягаемость Безопасность\nСпособность 2⭐: Наносит 3 урона выбранной цели.')
  assert.match(combined, /Досягаемость/u)
  assert.match(combined, /Безопасность/u)
  assert.deepEqual(targetedAbilityOperation(combined), { kind: 'damage-target', amount: 3 })
  assert.equal(attackDamageForCard('Обычное существо', 4, 'Пиппинс'), 0)
  assert.equal(canCounterattack('Обычное существо', true, false, false, false, false, 'Pantlessterrorist'), false)
  assert.deepEqual(effectsForTrigger('Админский арбалет', 'trap'), [{ kind: 'destroy-attacker' }])
  assert.deepEqual(effectsWhenEquipped('Дюп'), [])
  assert.deepEqual(effectsWhenEquipped('Админский арбалет'), [{ kind: 'change-attack', amount: -10 }])
  assert.deepEqual(effectsWhenEquipped('Неподтверждённый предмет'), [])
})

test('«Гном» entry maps to its left health buff and right attack buff', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Гном')
  assert.deepEqual(entryNeighborBuffs(card.Description), { left: { health: 2 }, right: { attack: 2 } })
  assert.deepEqual(applyEntryNeighborBuff({ attack: 3, health: 1, maxHealth: 4 }, { health: 2 }), { attack: 3, health: 3, maxHealth: 6 })
  assert.deepEqual(applyEntryNeighborBuff({ attack: 3, health: 1, maxHealth: 4 }, { attack: 2 }), { attack: 5, health: 1, maxHealth: 4 })
})

test('common targeted «Вход» text resolves to saving, building removal/capture, and creature healing', () => {
  assert.deepEqual(entryTargetOperation('Вход: Сберегите выбранную перевёрнутую карту.'), { kind: 'save-flipped' })
  assert.deepEqual(entryTargetOperation('Порыв\nВход: Уничтожает здание.'), { kind: 'destroy-building' })
  assert.deepEqual(entryTargetOperation('Вход: Выберите вражеское здание - теперь оно ваше.'), { kind: 'take-enemy-building' })
  assert.deepEqual(entryTargetOperation('Вход: Полностью восстанавливает здоровье выбранному существу и применяет на него Переворот 2.'), { kind: 'heal-creature', flipTurns: 2 })
  assert.equal(entryTargetOperation('Вход: Получает +2 к атаке.'), null)
})

test('simple «Вход» card draws are detected separately from later triggers', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const daestaronix = cards.find(card => card.Name === 'ДастАроникс')
  assert.ok(daestaronix)
  assert.equal(entryDrawCount(daestaronix.Description), 1)
  assert.equal(entryDrawCount('Вход: Возьмите 3 карты.\nПосмертно: Возьмите карту.'), 3)
  assert.equal(entryDrawCount('Посмертно: Возьмите карту.'), null)
})

test('«Вход» hand-limit changes are parsed from the card text', () => {
  assert.equal(entryHandLimitDelta('Вход: Уменьшает лимит карт на 2.'), -2)
  assert.equal(entryHandLimitDelta('Вход: Увеличивает лимит карт на 1.'), 1)
  assert.equal(entryHandLimitDelta('Вход: Получает 3 маны.'), null)
})

test('combined opponent damage and player healing are parsed together', () => {
  assert.deepEqual(opponentDamageAndHeal('Нанесите 4 урона противнику и восстанавливает вам 4 здоровья'), { damage: 4, heal: 4 })
  assert.equal(opponentDamageAndHeal('Нанесите 3 урона противнику'), null)
})

test('basic cards with entry, death, turn-start, and attack effects are fully mapped', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const card = (name) => cards.find(value => value.Name === name)
  const armor = card('Броненосец')
  const daestaronix = card('ДастАроникс')
  const newspark = card('Ньюспарк')
  const orange = card('Оранжевая')
  const bomber = card('Подрывник')
  assert.ok(armor && daestaronix && newspark && orange && bomber)
  assert.deepEqual(effectsForTrigger(armor.Name, 'death'), [{ kind: 'heal-player', amount: 3 }])
  assert.match(effectiveCardDescription(armor.Description), /Клоун/u)
  assert.equal(entryDrawCount(daestaronix.Description), 1)
  assert.deepEqual(effectsForTrigger(daestaronix.Name, 'death'), [{ kind: 'draw', count: 1 }])
  assert.deepEqual(startTurnEffect(newspark.Description), { scope: 'owner-turn', operations: [{ kind: 'gain-energy', amount: 4 }] })
  assert.equal(entryOpponentDamage(orange.Description)?.amount, 4)
  assert.deepEqual(effectsForTrigger(orange.Name, 'crown'), [{ kind: 'damage-player', amount: 1 }])
  assert.deepEqual(effectsForTrigger(orange.Name, 'trap'), [{ kind: 'damage-attacking-player', amount: 2 }])
  assert.deepEqual(effectsForTrigger(orange.Name, 'death'), [{ kind: 'damage-player', amount: 3 }])
  assert.deepEqual(effectsForTrigger(bomber.Name, 'death'), [{ kind: 'damage-player', amount: 3 }])
})

test('direct and saved-creature gated «Вход» damage resolves only the described amount/condition', () => {
  assert.deepEqual(entryOpponentDamage('Вход: Наносит 4 урона противнику.'), { amount: 4 })
  assert.deepEqual(entryOpponentDamage('Вход: Наносит 10 урона противнику если у вас есть минимум 3 сбережённых существа стоимостью 3 или меньше.'), {
    amount: 10, minimumSavedCreatures: 3, maximumSavedCreatureCost: 3,
  })
  assert.equal(entryOpponentDamage('Вход: Получает +2 к атаке.'), null)
})

test('flipped cards reveal when their timer ends unless they were already killed', () => {
  assert.deepEqual(tickFlipAtOwnerEnd(3, 1), { flippedTurns: 0, dies: false, reveals: true })
  assert.deepEqual(tickFlipAtOwnerEnd(0, 1), { flippedTurns: 0, dies: true, reveals: false })
  assert.deepEqual(tickFlipAtOwnerEnd(3, 2), { flippedTurns: 1, dies: false, reveals: false })
})

test('initial flip duration and exceptions are read from the card text', () => {
  assert.equal(initialFlipTurns('Переворот 5\\nПостоянно: Не сбрасывает жетоны переворота в конце вашего хода.'), 5)
  assert.equal(initialFlipTurns('Переворот 2\\nПостоянно: Может атаковать и передвигаться в состоянии переворота, не получая ответного урона.'), 2)
  assert.equal(canActWhileFlipped('Может атаковать и передвигаться в состоянии переворота, не получая ответного урона.'), true)
  assert.equal(flipTimerTicks('Не сбрасывает жетоны переворота в конце вашего хода.'), false)
  assert.equal(flipTimerTicks('Переворот 2'), true)
})

test('attack damage honours confirmed card rules', () => {
  assert.equal(attackDamageForCard('Pantlessterrorist', 5), 10)
  assert.equal(attackDamageForCard('Пиппинс', 5), 0)
  assert.equal(attackDamageForCard('Обычное существо', 5), 5)
  assert.equal(rulesForCard('Теневой ребёнок').cannotDamagePlayerDirectly, true)
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Теневой ребёнок')
  assert.deepEqual(targetedAbilityOperation(card.Description), { kind: 'move-self' })
  const app=readFileSync(new URL('./App.vue',import.meta.url),'utf8'),directStart=app.indexOf('async function direct('),direct=app.slice(directStart,app.indexOf('function damage(',directStart))
  assert.match(direct, /rulesForCard\(u\.card\.Name\)\.cannotDamagePlayerDirectly/u)
})

test('«Безопасность» permits friendly attack actions while suppressing combat damage', () => {
  assert.equal(canAttackTarget('Кирка ФСШ', 0, 0), true)
  assert.equal(canAttackTarget('Обычное существо', 0, 0, true), true)
  assert.equal(canAttackTarget('Обычное существо', 0, 0), false)
  assert.equal(canAttackTarget('Обычное существо', 0, 1), true)
  assert.equal(shouldDealCombatDamage(0, 0), false)
  assert.equal(shouldDealCombatDamage(0, 1), true)
  // The attack engine still invokes crown effects after the combat-damage branch.
  assert.deepEqual(effectsForTrigger('Джон Фараон', 'crown'), [{ kind: 'destroy-target', targetType: 'creature' }])
  assert.deepEqual(effectsForTrigger('Админский арбалет', 'crown'), [{ kind: 'destroy-target', targetType: 'creature' }])
})

test('multi-target effects reserve enough choices for every available «Клоун»', () => {
  assert.equal(mustChooseRemainingClown(false, 1, 3), false)
  assert.equal(mustChooseRemainingClown(false, 1, 1), true)
  assert.equal(mustChooseRemainingClown(false, 2, 2), true)
  assert.equal(mustChooseRemainingClown(true, 1, 1), false)
})

test('«Клоун» is mandatory for any legal enemy spell or ability target, but not ally-only effects', () => {
  assert.equal(effectCanTargetEnemy('Восстанавливает выбранному существу 3 здоровья.'), true)
  assert.equal(effectCanTargetEnemy('Наносит 2 урона выбранной вражеской карте.'), true)
  assert.equal(effectCanTargetEnemy('Даёт выбранному союзному существу щит.'), false)
})

test('«Клоун» cannot be selected for an ordinary combat attack', () => {
  assert.equal(canBeAttackedByCombat('Клоун'), false)
  assert.equal(canBeAttackedByCombat('Порыв\nДосягаемость'), true)
  assert.equal(mustTargetClown(0, 1, false, true), true)
  assert.equal(mustTargetClown(0, 1, true, true), false)
  assert.equal(mustTargetClown(0, 1, false, false), false)
  assert.equal(mustTargetClown(0, 0, false, true), true)
})

test('destruction targets respect creature/building wording', () => {
  assert.equal(targetKindInDescription('Убейте выбранное существо.'), 'creature')
  assert.equal(targetKindInDescription('Нанесите 2 урона выбранному существу.'), 'creature')
  assert.equal(targetKindInDescription('Уничтожьте выбранное здание.'), 'building')
  assert.equal(targetKindInDescription('Уничтожьте выбранную цель.'), undefined)
  assert.equal(targetMatchesKind(0, 'creature'), true)
  assert.equal(targetMatchesKind(3, 'creature'), false)
  assert.equal(targetMatchesKind(3, 'building'), true)
  assert.equal(targetMatchesKind(2, undefined), true)
})

test('effects can target a player only when the text names an unrestricted selected target', () => {
  assert.equal(effectCanTargetPlayer('Нанесите 2 урона выбранной цели.'), true)
  assert.equal(effectCanTargetPlayer('Нанесите 2 урона выбранному существу.'), false)
  assert.equal(effectCanTargetPlayer('Уничтожьте здание.'), false)
  assert.equal(effectCanTargetPlayer('Нанесите 2 урона противнику.'), false)
})

test('selected-target damage recognizes both singular and plural Russian forms', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const nerdReact = cards.find(card => card.Name === 'Нёрд реакт')
  assert.ok(nerdReact)
  assert.equal(selectedTargetDamage(nerdReact.Description), 1)
  assert.equal(selectedTargetDamage('Нанесите 4 урона выбранной цели.'), 4)
  assert.equal(selectedTargetDamage('Восстановите 4 здоровья.'), null)
})

test('Ледяной шок parses the target flip duration on a lethal hit', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const iceShock = cards.find(card => card.Name === 'Ледяной шок')
  assert.ok(iceShock)
  assert.equal(spellFlipOnKill(iceShock.Description), 2)
  assert.equal(spellFlipOnKill('Нанесите 3 урона выбранной цели.'), null)
})

test('Знаком по ебалу parses its conditional hand-save effect', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  const spell = cards.find(card => card.Name === 'Знаком по ебалу')
  assert.ok(spell)
  assert.equal(spellSavesHandOnCreatureKill(spell.Description), true)
  assert.equal(spellSavesHandOnCreatureKill('Нанесите 1 урон выбранной цели.'), false)
})

test('both Х-Слеш cards parse lethal creature-health healing without masking ordinary damage', () => {
  const cards = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8'))
  for (const name of ['Х-Слеш', 'X-Слеш']) {
    const spell = cards.find(card => card.Name === name)
    assert.ok(spell)
    assert.equal(spellHealsCasterOnCreatureKill(spell.Description), true)
    assert.equal(cardEffects.targetedSpellDamage(spell.Description)?.amount, 2)
  }
  assert.equal(spellHealsCasterOnCreatureKill('Нанесите 2 урона выбранному существу.'), false)
})

test('targeted online spell parser accepts only self-contained damage combinations', () => {
  assert.deepEqual(cardEffects.targetedSpellDamage('Нанесите 1 урон выбранной цели.'), { amount: 1, targetType: undefined, canTargetPlayer: true, heal: 0, selfDamage: 0 })
  assert.deepEqual(cardEffects.targetedSpellDamage('Нанесите выбранной цели 2 урона и затем восстановите себе 2 здоровья.'), { amount: 2, targetType: undefined, canTargetPlayer: true, heal: 2, selfDamage: 0 })
  assert.deepEqual(cardEffects.targetedSpellDamage('Нанесите 4 урона выбранной цели и получите 4 урона.'), { amount: 4, targetType: undefined, canTargetPlayer: true, heal: 0, selfDamage: 4 })
  assert.deepEqual(cardEffects.targetedSpellDamage('Нанесите 3 урона выбранному существу.'), { amount: 3, targetType: 'creature', canTargetPlayer: false, heal: 0, selfDamage: 0 })
  assert.equal(cardEffects.targetedSpellDamage('Нанесите 3 урона выбранной цели и сохраните карту.'), null)
})

test('burn-gated effects require a card to have been burned during the current turn', () => {
  const swoon = 'Убивает выбранное существо, если вы сожгли свою карту в этом ходу.'
  assert.equal(effectConditionMet(swoon, false), false)
  assert.equal(effectConditionMet(swoon, true), true)
  assert.equal(effectConditionMet('Убивает выбранное существо.', false), true)
})

test('movement locks affect only the designated player turn', () => {
  assert.equal(movementIsBlocked(1, 1), true)
  assert.equal(movementIsBlocked(1, 0), false)
  assert.equal(movementIsBlocked(null, 0), false)
  assert.deepEqual(forwardMoveDestination(0, 3, 2, false), { row: 2, col: 2 })
  assert.deepEqual(forwardMoveDestination(1, 1, 4, false), { row: 2, col: 4 })
  assert.equal(forwardMoveDestination(0, 0, 2, false), null)
  assert.equal(forwardMoveDestination(0, 3, 2, true), null)
  assert.equal(forwardMoveDestination(0, 3, 2, false, true), null)
})

test('«Банни хоп» allows adjacent diagonal movement without changing ordinary movement', () => {
  assert.equal(canMoveTo(2, 2, 1, 1), false)
  assert.equal(canMoveTo(2, 2, 1, 1, true), true)
  assert.equal(canMoveTo(2, 2, 2, 3), true)
  assert.equal(canMoveTo(2, 2, 0, 0, true), false)
})

test('counterattack is disabled by reach and trap rules, except for the audit journal', () => {
  assert.equal(canCounterattack('Обычное существо', true, false, true, false, false), true, 'reach does not suppress a counterattack after an orthogonal attack')
  assert.equal(canCounterattack('Обычное существо', true, true, true, false, false), false, 'a diagonal attack suppresses return damage when the defender has no reach')
  assert.equal(canCounterattack('Обычное существо', true, true, true, true, false), true, 'a defender with reach may return damage after a diagonal attack')
  assert.equal(canCounterattack('Обычное существо', true, true, true, false, true), true, 'the defender side journal permits return damage against a reach attacker')
  assert.equal(canCounterattack('Обычное существо', true, true, false, false, true), false, 'the journal exception applies specifically against a reach attacker')
  assert.equal(canCounterattack('Pantlessterrorist', true, false, false, false, false), false)
  assert.equal(canCounterattack('Здание', false, false, false, true, true), false)
  assert.equal(attackWasDiagonal(2, 2, 3, 3), true)
  assert.equal(attackWasDiagonal(2, 2, 2, 3), false)
})

test('a lethal self-damage or trap awards victory to the other seat', () => {
  assert.equal(winnerWhenPlayerFalls(0), 1)
  assert.equal(winnerWhenPlayerFalls(1), 0)
})

test('a permanent all-stat buff increases attack and health while reducing movement cost', () => {
  assert.deepEqual(applyStatBuff({ attack: 2, health: 3, maxHealth: 3, speed: 1 }, 1), { attack: 3, health: 4, maxHealth: 4, speed: 0 })
  const wounded = applyStatBuff({ attack: 2, health: 1, maxHealth: 3, speed: 1 }, 1)
  assert.equal(wounded.maxHealth, 4, 'a health buff raises the healing cap')
})

test('a temporary attack bonus expires without removing the creature', () => {
  const unit = { attack: 7, health: 2, temporaryAttack: 5 }
  assert.deepEqual(expireTemporaryAttack(unit), { attack: 2, health: 2, temporaryAttack: 0 })
})

test('unit damage consumes a shield once and ignores frozen or dying units', () => {
  const shielded = applyUnitDamage({ health: 4, shield: true, dying: false, flippedTurns: 0 }, 9)
  assert.deepEqual(shielded, {
    state: { health: 4, shield: false, dying: false, flippedTurns: 0 },
    absorbed: true,
    lethal: false,
  })

  const lethal = applyUnitDamage({ health: 3, shield: false, dying: false, flippedTurns: 0 }, 4)
  assert.equal(lethal.state.health, -1)
  assert.equal(lethal.lethal, true)

  const frozen = { health: 0, shield: true, dying: false, flippedTurns: 1 }
  assert.deepEqual(applyUnitDamage(frozen, 2), { state: frozen, absorbed: false, lethal: false })
})

test('«Хатсуне Мику» and «Касане Тето» adjust incoming creature damage by controller', () => {
  const allies = [
    { owner: 0, card: { Name: 'Хатсуне Мику' } },
    { owner: 0, card: { Name: 'Хатсуне Мику' }, flippedTurns: 1 },
    { owner: 0, card: { Name: 'Хатсуне Мику' }, dying: true },
    { owner: 1, card: { Name: 'Хатсуне Мику' } },
  ]
  assert.equal(incomingDamageReduction(allies, 0, 0), 1)
  assert.equal(incomingDamageReduction([...allies, { owner: 1, card: { Name: 'Касане Тето' } }], 0, 0), 0)
  assert.equal(incomingDamageReduction([{ owner: 1, card: { Name: 'Касане Тето' } }], 0, 0), -1)
  assert.equal(incomingDamageReduction([{ owner: 1, card: { Name: 'Касане Тето' } }], 0, 3), 0)
  const shielded = { health: 3, shield: true, dying: false, flippedTurns: 0 }
  assert.deepEqual(applyUnitDamage(shielded, 1, 1), { state: shielded, absorbed: false, lethal: false })
  assert.deepEqual(applyUnitDamage({ ...shielded, shield: false }, 4, 1), {
    state: { ...shielded, shield: false, health: 0 }, absorbed: false, lethal: true,
  })
  assert.deepEqual(applyUnitDamage({ ...shielded, shield: false, health: 4 }, 3, -1), {
    state: { ...shielded, shield: false, health: 0 }, absorbed: false, lethal: true,
  })
})

test('«Депрессивная Жопа» is recognized as a supported whole-hand discard entry', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(card => card.Name === 'Депрессивная Жопа')
  assert.ok(card)
  assert.equal(cardEffects.entryDiscardsEntireHand(card.Description), true)
  assert.equal(cardEffects.supportedEntryEffect(card.Description), true)
})

test('«Аме» rewards healing a wounded allied creature only', () => {
  const units = [
    { owner: 0, card: { Name: 'Аме' }, dying: false, flippedTurns: 0, attack: 2 },
    { owner: 0, card: { Name: 'Аме' }, dying: false, flippedTurns: 0, attack: 2 },
    { owner: 0, card: { Name: 'Аме' }, dying: true, flippedTurns: 0, attack: 3 },
    { owner: 1, card: { Name: 'Аме' }, dying: false, flippedTurns: 0, attack: 4 },
  ]
  assert.equal(ameHealingReward(units, 0, 2, 5, 2), 2)
  assert.equal(ameHealingReward(units, 0, 5, 5, 2), 0)
  assert.equal(ameHealingReward(units, 1, 2, 5, 1), 1)
})

test('«Безумный манекен» gets attack and haste only when its owner has a building', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Безумный манекен')
  assert.deepEqual(entryBuffForCard(card.Name, true), { attack: 2 })
  assert.equal(entryBuffForCard(card.Name, false), null)
  assert.equal(entryBuffForCard('Обычное существо', true), null)
})

test('«Банк ум» repeatable mana and token abilities resolve with the right payment', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Банк ум')
  assert.equal(abilityCostResource(card.Description, 0), 'mana')
  assert.equal(abilityCostResource(card.Description, 1), 'black-token')
  assert.equal(isRepeatableAbility(card.Description, 0), true)
  assert.equal(isRepeatableAbility(card.Description, 1), true)
  assert.deepEqual(targetedAbilityOperation(card.Description, 0), { kind: 'gain-black-token', amount: 1 })
  assert.deepEqual(targetedAbilityOperation(card.Description, 1), { kind: 'gain-player-mana', amount: 1 })
})

test('gamba rolls clamp to the nearest edge and parse variable damage spells', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'В следующий раз повезёт')
  assert.equal(adjustGambaRoll(1, -3), 1)
  assert.equal(adjustGambaRoll(6, 4), 6)
  assert.equal(adjustGambaRoll(3, 2), 5)
  assert.deepEqual(gambaDamageOperation('Гамба: Нанесите выбранной цели столько урона, сколько выпало на кубике'), { kind: 'damage-by-roll' })
  assert.deepEqual(gambaDamageOperation(card.Description), { kind: 'damage-by-roll' })
})

test('«Бараш» entry debuff is a -2 attack and speed effect', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Бараш')
  assert.deepEqual(entryDebuffForCard(card.Name), { attack: -2, speed: -2 })
  assert.equal(hasBurnTrait(card.Description), true)
  assert.equal(entryDebuffForCard('Другая карта'), null)
  assert.deepEqual(applyCombatStatChanges({ attack: 4, health: 4, maxHealth: 4, speed: 3 }, -2, -2), { attack: 2, health: 4, maxHealth: 4, speed: 7 })
  assert.deepEqual(applyCombatStatChanges({ attack: 4, health: 4, maxHealth: 4, speed: 1 }, -2, 0), { attack: 2, health: 4, maxHealth: 4, speed: 3 })
  assert.equal(applyCombatStatChanges({ attack: 0, health: 1, maxHealth: 1, speed: 1 }, 0, -5).speed, 6)
})

test('«Ачивари» entry selects an allied creature and restores 5 player health', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Ачивари')
  assert.deepEqual(entryTargetOperation(card.Description), { kind: 'sacrifice-ally-heal-player', amount: 5 })
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = stripTypeScriptTypes(['entryTargetCandidates', 'resolveEntry'].map(name => app.split(/\r?\n/u).find(line => line.startsWith(name === 'useAbility' ? 'async function useAbility(' : `function ${name}(`))).join('\n'))
  const healLine = app.split(/\r?\n/u).find(line => line.includes('function heal(p:Player'))
  const heal = stripTypeScriptTypes(healLine.slice(healLine.indexOf('function heal(p:Player')))
  const healPlayer = runInNewContext(`${heal};heal`)
  for (const owner of [0, 1]) {
    const source = { id: 'achivari', owner, card }
    const ally = { id: 'ally', owner, card: { Name: 'Союзник', Type: 0 }, dying: false, flippedTurns: 0 }
    const invalid = [
      { id: 'enemy', owner: 1-owner, card: { Name: 'Враг', Type: 0 }, dying: false, flippedTurns: 0 },
      { id: 'building', owner, card: { Name: 'Здание', Type: 3 }, dying: false, flippedTurns: 0 },
      { id: 'flipped', owner, card: { Name: 'Перевёрнутый', Type: 0 }, dying: false, flippedTurns: 1 },
      { id: 'dying', owner, card: { Name: 'Погибающий', Type: 0 }, dying: true, flippedTurns: 0 },
    ]
    const board = [source, ally, ...invalid], player = { health: 43 }
    const players = owner === 0 ? [player, {}] : [{}, player]
    const killed = [], selection = { value: { kind: 'entry', id: source.id } }, pendingEntryTokenGain = { value: { id: source.id, resolved: false } }
    let invalidSelection = false, finished = 0
    const context = { source, board: { value: board }, players: { value: players }, selection, pendingEntryTokenGain,
      entryTargetOperation: cardEffects.entryTargetOperation, unitDescription: unit => unit.card.Description,
      kill: (target, options) => killed.push([target, options.killer]), heal: healPlayer, inform: () => { invalidSelection = true }, note: () => {}, finishEntryFollowup: () => { finished++ } }
    assert.deepEqual(runInNewContext(`${functions};entryTargetCandidates(source,entryTargetOperation(source.card.Description),${owner}).map(unit=>unit.id)`, context), ['ally', 'flipped'])
    runInNewContext(`resolveEntry(source.id,${JSON.stringify(invalid[0].id)},${owner})`, context)
    assert.equal(invalidSelection, true)
    assert.equal(player.health, 43)
    assert.equal(killed.length, 0)
    runInNewContext('resolveEntry(source.id,ally,source.owner)', { ...context, ally })
    assert.equal(player.health, 45)
    assert.equal(killed.length, 1)
    assert.equal(killed[0][0], ally)
    assert.equal(killed[0][1], source)
    assert.equal(finished, 1)
    assert.equal(pendingEntryTokenGain.value.resolved, true)
  }
})

test('«Висмут Шифера» searches an item and building, lets its owner discard one, and repeats on death', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Висмут Шифера')
  assert.deepEqual(cardEffects.effectsForTrigger(card.Name, 'death'), [{ kind: 'repeat-entry-selection' }])
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const queue = app.split(/\r?\n/u).find(line => line.startsWith('function queueVismuthSelection('))
  const choose = app.split(/\r?\n/u).find(line => line.startsWith('function chooseVismuthCard('))
  assert.ok(queue)
  assert.ok(choose)
  const owner = { deck: [{ Name: 'Заклинание', Type: 2 }, { Name: 'Предмет', Type: 1 }, { Name: 'Существо', Type: 0 }, { Name: 'Здание', Type: 3 }], hand: [], discard: [] }
  const pending = { value: [] }
  const functions = stripTypeScriptTypes(`${queue}\n${choose}`)
  const context = { players: { value: [owner] }, pendingVismuthChoice: pending, takeAndShufflePileCard: (pile, type) => cardEffects.takeAndShufflePileCard(pile, type, () => 0), note: () => {}, inform: () => {} }
  runInNewContext(`${functions};queueVismuthSelection(0)`, context)
  assert.equal(pending.value.length, 1)
  assert.equal([...pending.value[0].cards].map(value => value.Name).join(','), 'Предмет,Здание')
  assert.deepEqual(owner.deck.map(value => value.Name).sort(), ['Заклинание', 'Существо'])
  runInNewContext('chooseVismuthCard(0)', context)
  assert.deepEqual(owner.discard.map(value => value.Name), ['Предмет'])
  assert.deepEqual(owner.hand.map(value => value.Name), ['Здание'])
  assert.equal(pending.value.length, 0)
  owner.deck = [{ Name: 'Только предмет', Type: 1 }, { Name: 'Существо', Type: 0 }]
  runInNewContext('queueVismuthSelection(0)', context)
  assert.deepEqual(owner.hand.map(value => value.Name), ['Здание', 'Только предмет'])
  assert.equal(pending.value.length, 0)
  owner.deck = [{ Name: 'Только здание', Type: 3 }]
  runInNewContext('queueVismuthSelection(0)', context)
  assert.deepEqual(owner.hand.map(value => value.Name), ['Здание', 'Только предмет', 'Только здание'])
  assert.equal(pending.value.length, 0)
  owner.deck = []
  runInNewContext('queueVismuthSelection(0)', context)
  assert.equal(owner.hand.length, 3)
  assert.equal(pending.value.length, 0)
  const killStart = app.indexOf('function kill(')
  const kill = stripTypeScriptTypes(app.slice(killStart, app.indexOf('\nfunction healCreature', killStart)))
  const entry = app.split(/\r?\n/u).find(line => line.startsWith('function entry('))
  assert.match(entry, /queueVismuthSelection\(effectOwner\)/u)
  const dead = { id: 'dead-vismuth', owner: 0, card, dying: false, flippedTurns: 0, Description: card.Description }
  const deathOwner = { deck: [{ Name: 'Предмет', Type: 1 }, { Name: 'Здание', Type: 3 }], hand: [], discard: [], burned: [] }
  const deathPending = { value: [] }
  const deathContext = { ...context, players: { value: [deathOwner] }, pendingVismuthChoice: deathPending, board: { value: [dead] }, current: { value: 0 }, attackResolutionDepth: 0,
    burnsOnDeathFromField: () => false, recordBurn: (player, value) => player.burned.push(value), hasBurnTrait: () => false,
    effectsForTrigger: cardEffects.effectsForTrigger, killRewardForCard: () => null, visual: () => {}, window: { setTimeout: callback => callback() } }
  runInNewContext(`${functions}\n${kill}\nkill(dead)`, { ...deathContext, dead })
  assert.equal(deathPending.value.length, 1)
  assert.equal(deathPending.value[0].owner, 0)
  assert.equal(deathPending.value[0].cards.length, 2)
})

test('«Ёжик» death effect damages and weakens a chosen target, including the opponent from their start row', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Ёжик')
  assert.deepEqual(cardEffects.effectsForTrigger(card.Name, 'death'), [{ kind: 'damage-weaken-target' }])
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const queue = app.split(/\r?\n/u).find(line => line.startsWith('function queueHedgehogTarget('))
  const choose = app.split(/\r?\n/u).find(line => line.startsWith('function chooseHedgehogTarget('))
  assert.ok(queue)
  assert.ok(choose)
  const killStart = app.indexOf('function kill(')
  const kill = stripTypeScriptTypes(app.slice(killStart, app.indexOf('\nfunction healCreature', killStart)))
  const damage = stripTypeScriptTypes(app.split(/\r?\n/u).find(line => line.startsWith('function damage(')))
  const source = { id: 'hedgehog', owner: 0, row: 0, col: 1, card, dying: false, flippedTurns: 0, health: 2, maxHealth: 2, Description: card.Description }
  const target = { id: 'target', owner: 1, row: 1, col: 1, card: { Name: 'Target', Type: 0 }, dying: false, flippedTurns: 0, health: 5, maxHealth: 5, attack: 3, speed: 2, shield: false }
  const player = { health: 10, discard: [], burned: [], hand: [], deck: [], saved: [] }, enemy = { health: 10, discard: [], burned: [], hand: [], deck: [], saved: [] }
  const players = [player, enemy], board = [source, target], pending = { value: [] }
  const context = { source, target, board: { value: board }, players: { value: players }, pendingHedgehogTargets: pending, current: { value: 0 }, attackResolutionDepth: 0,
    burnsOnDeathFromField: () => false, recordBurn: (owner, value) => owner.discard.push(value), hasBurnTrait: () => false,
    effectsForTrigger: cardEffects.effectsForTrigger, killRewardForCard: () => null, visual: () => {}, note: () => {}, inform: () => {},
    window: { setTimeout: callback => callback() }, queueHedgehogTarget: undefined,
    incomingDamageReduction: cardEffects.incomingDamageReduction, applyUnitDamage: cardEffects.applyUnitDamage,
    effectiveUnitAttack: () => 0, attackResolutionDepth: 0, queuePendingDeath: () => {}, kill: () => {}, rulesForCard: cardEffects.rulesForCard,
    damage: undefined, hitPlayer: (victim, amount) => { victim.health -= amount }, applyCombatStatChanges: cardEffects.applyCombatStatChanges }
  runInNewContext(stripTypeScriptTypes(`${queue}\n${choose}\n${kill}\n${damage}\nkill(source)`), context)
  assert.equal(pending.value.length, 1)
  assert.equal(pending.value[0].source, source)
  runInNewContext('chooseHedgehogTarget(target.id)', context)
  assert.deepEqual([target.health, target.attack, target.speed], [4, 2, 3])
  assert.equal(pending.value.length, 0)
  const playerSource = { ...source, id: 'hedgehog-2', owner: 1, row: 4 }
  runInNewContext(`queueHedgehogTarget(playerSource);chooseHedgehogTarget(undefined,0)`, { ...context, playerSource, pendingHedgehogTargets: pending })
  assert.equal(player.health, 9)
  assert.equal(pending.value.length, 0)
})

test('«Библиотекарь» selects a mana tier and a card from deck or discard, then gambles whether it burns', async () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Библиотекарь')
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = ['useAbility', 'chooseLibrarianCost', 'chooseLibrarianPile', 'chooseLibrarianCard'].map(name => app.split(/\r?\n/u).find(line => line.startsWith(name === 'useAbility' ? 'async function useAbility(' : `function ${name}(`)))
  assert.ok(functions.every(Boolean))
  const [useAbility, ...choices] = functions
  const choose = stripTypeScriptTypes(choices.join('\n'))
  for (const scenario of [
    { cost: 1, rarity: 0, pile: 'deck', roll: 5 },
    { cost: 2, rarity: 1, pile: 'discard', roll: 5 },
    { cost: 4, rarity: 2, pile: 'deck', roll: 2 },
  ]) {
    const selected = { Name: `Rare ${scenario.cost}`, Type: 2, Rarity: scenario.rarity }
    const other = { Name: 'Other', Type: 0, Rarity: 0 }
    const owner = { mana: 4, hand: [], deck: scenario.pile === 'deck' ? [other, selected, { Name: 'Rest', Type: 1, Rarity: 1 }] : [], discard: scenario.pile === 'discard' ? [other, selected] : [], burned: [], saved: [], burnedThisTurn: false }
    const unit = { id: 'librarian', owner: 0, card, abilityUsed: false }
    const pending = { value: null }
    const context = { unit, players: { value: [owner, {}] }, player: { value: owner }, board: { value: [unit] }, current: { value: 0 }, pendingLibrarianChoice: pending, selection: { value: null },
      unitDescription: value => value.card.Description, abilityDescription, abilityDescriptions, active: () => true, canActWhileFlipped, isRepeatableAbility,
      abilityCost: () => 0, canPayAbility: () => true, abilityCostResource, targetedAbilityOperation, localMovePending: { value: false }, applyLocalCommand: async () => { throw Object.assign(new Error('local fallback'), { code: 'UNSUPPORTED_EFFECT' }) }, inform: () => {}, note: () => {}, visual: () => {},
      shuffle: values => [...values].reverse(), rollGamba: () => scenario.roll, gambaModifierForUnit: () => 0,
      recordBurn: (player, value) => { player.burned.push(value); return true } }
    await runInNewContext(stripTypeScriptTypes(`${useAbility}\nuseAbility(unit);${choose}`), context)
    assert.equal(pending.value.stage, 'cost')
    runInNewContext(`chooseLibrarianCost(${scenario.cost})`, context)
    assert.equal(pending.value.stage, 'pile')
    runInNewContext(`chooseLibrarianPile('${scenario.pile}')`, context)
    assert.equal(pending.value.stage, 'card')
    runInNewContext('chooseLibrarianCard(1)', context)
    assert.equal(owner.mana, 4 - scenario.cost)
    assert.equal(unit.abilityUsed, true)
    assert.equal(pending.value, null)
    if (scenario.roll <= 3) {
      assert.deepEqual(owner.burned, [selected])
      assert.equal(owner.hand.length, 0)
      assert.equal(owner.burnedThisTurn, true)
    } else {
      assert.deepEqual(owner.hand, [selected])
      assert.equal(owner.burned.length, 0)
    }
  }
  const player = { mana: 4, deck: [], discard: [] }, pending = { value: { owner: 0, unitId: 'librarian', abilityIndex: 0, stage: 'cost' } }
  let message = ''
  const invalidChoiceContext = { pendingLibrarianChoice: pending, players: { value: [player] }, board: { value: [{ id: 'librarian', abilityUsed: false, dying: false }] }, inform: value => { message = value } }
  runInNewContext(`${choose}\nchooseLibrarianCost(1)`, invalidChoiceContext)
  assert.equal(pending.value.stage, 'cost')
  assert.equal(player.mana, 4)
  assert.equal(message, 'В КД и КС нет карт этой редкости.')
  const emptyOwner = { mana: 0, hand: [], deck: [], discard: [], burned: [], saved: [] }
  const emptyUnit = { id: 'empty-librarian', owner: 0, card, abilityUsed: false }
  const emptyPending = { value: null }
  let emptyMessage = ''
  await runInNewContext(stripTypeScriptTypes(`${useAbility}\nuseAbility(unit)`), {
    unit: emptyUnit, players: { value: [emptyOwner, {}] }, player: { value: emptyOwner }, board: { value: [emptyUnit] }, current: { value: 0 },
    pendingLibrarianChoice: emptyPending, selection: { value: null }, pendingAbilityTargets: { value: [] },
    unitDescription: value => value.card.Description, abilityDescription, abilityDescriptions, active: () => true, canActWhileFlipped, isRepeatableAbility,
    abilityCost: () => 0, canPayAbility: () => true, abilityCostResource, targetedAbilityOperation, localMovePending: { value: false }, applyLocalCommand: async () => { throw Object.assign(new Error('local fallback'), { code: 'UNSUPPORTED_EFFECT' }) }, abilityDrawCount: () => null, movementIsBlocked,
    movementLock: { value: null }, inform: value => { emptyMessage = value }, visual: () => {}, note: () => {},
  })
  assert.equal(emptyPending.value, null)
  assert.equal(emptyUnit.abilityUsed, false)
  assert.match(emptyMessage, /не хватает маны или нет карт нужной редкости/iu)
})

test('the active turn cannot end while card-effect choice dialogs are pending', () => {
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const end = app.split(/\r?\n/u).find(line => line.startsWith('function end('))
  let finished = 0
  const refs = {
    pendingIntivi: { value: [] }, pendingIndigolit: { value: null }, pendingDodep: { value: null }, pendingZnakSave: { value: null },
    pendingSwarmChoice: { value: [] }, pendingDedrubi: { value: [] }, pendingBurnFlipped: { value: [] }, pendingDiscordDrama: { value: null },
    pendingNewcomers: { value: null }, pendingCrownMove: { value: null }, pendingBuildingMove: { value: null }, pendingSpellMove: { value: null },
    pendingViskassChoice: { value: null }, pendingParadiseTargets: { value: [] }, pendingBranchTargets: { value: [] }, pendingCrownSavedSpell: { value: null },
    pendingStartTurnShields: { value: [] }, pendingFriendlySacrifice: { value: null }, pendingApril: { value: null }, pendingRottenThief: { value: null },
    pendingHalfLife: { value: null }, pendingIcebergAbility: { value: null }, pendingV1Horny: { value: null }, pendingCardPayment: { value: null },
    pendingStartTurnBurns: { value: 0 }, optionalDiscardCount: { value: 0 }, overLimit: { value: 0 }, selection: { value: null },
    player: { value: { played: true, hand: [] } }, round: { value: 1 }, finishTurn: () => { finished++ }, inform: () => {},
    localMovePending: { value: false },
    pendingConveyor: { value: null }, pendingVismuthChoice: { value: [] }, pendingLibrarianChoice: { value: null }, pendingHedgehogTargets: { value: [] },
  }
  for (const [ref, value] of [['pendingConveyor', {}], ['pendingVismuthChoice', [{}]], ['pendingLibrarianChoice', {}], ['pendingHedgehogTargets', [{}]]]) {
    refs[ref].value = value
    runInNewContext(stripTypeScriptTypes(`${end}\nend()`), refs)
    assert.equal(finished, 0, `${ref} should block ending the turn`)
    refs[ref].value = Array.isArray(refs[ref].value) ? [] : null
  }
})

test('«Хуёвый рокет джамп» parses its self-damage separately from target damage', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Хуёвый рокет джамп')
  assert.equal(selectedTargetDamage(card.Description), 4)
  assert.equal(spellSelfDamage(card.Description), 4)
  assert.equal(spellSelfDamage('Нанесите 4 урона выбранной цели.'), null)
})



test('Илья_08 token gain counts only entry effects whose score conditions pass', () => {
  const description = 'Вход: Возьмите карту.\nСчёт 6: Вход: Получает 3 3'
  assert.equal(entryTokenGain(description, 1), 1)
  assert.equal(entryTokenGain(description, 6), 2)
  assert.equal(entryTokenGain('Счёт 6: Вход: Получает 3 3', 1), 0)
  const units = [{ card: { Name: 'Илья_08' }, owner: 0, blackTokens: 0 }, { card: { Name: 'Илья_08' }, owner: 1, blackTokens: 2 }]
  assert.equal(grantEntryEffectTokens(units, 0, 2), 1)
  assert.deepEqual(units.map(unit => unit.blackTokens), [2, 2])
  assert.equal(grantEntryEffectTokens(units, 0, 3, false), 1)
  assert.deepEqual(units.map(unit => unit.blackTokens), [2, 2])
})


test('«.Хихо» gets all stats, a card, and mana whenever it is flipped', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === '.Хихо')
  assert.deepEqual(flipTriggerEffect(card.Name), { stats: 1, draw: 1, mana: 1 })
  assert.deepEqual(resolveFlipTrigger(card.Name, { attack: 2, health: 0, maxHealth: 2, speed: 3 }), { state: { attack: 3, health: 1, maxHealth: 3, speed: 2 }, draw: 1, mana: 1 })
  assert.deepEqual(flipTriggerEffect('other'), null)
})


test('entry effects can be replayed only when the engine has an operation for them', () => {
  assert.equal(supportedEntryEffect('Вход: Возьмите карту.'), true)
  assert.equal(supportedEntryEffect('Вход: Сберегите ваше существо на поле.'), true)
  assert.equal(supportedEntryEffect('Вход: Получает +1 к атаке.'), false)
  assert.equal(supportedEntryEffect('Способность: Наносит урон.'), false)
  assert.equal(entryEffectConditionMet('Счёт 6: Вход: Возьмите карту.', 5), false)
  assert.equal(entryEffectConditionMet('Счёт 6: Вход: Возьмите карту.', 6), true)
  assert.equal(entryEffectConditionMet('Вход: Возьмите карту.\nСчёт 6: Вход: Возьмите ещё карту.', 1), true)
})


test('«Алмаз» increases only its equipped creature’s gamba and respects inactive states', () => {
  const unit = { item: { Name: 'Алмаз' }, flippedTurns: 0, dying: false }
  assert.equal(gambaModifierForUnit(unit), 1)
  assert.equal(gambaModifierForUnit({ ...unit, item: undefined }), 0)
  assert.equal(gambaModifierForUnit({ ...unit, item: { Name: 'Другой предмет' } }), 0)
  assert.equal(gambaModifierForUnit({ ...unit, flippedTurns: 1 }), 0)
  assert.equal(gambaModifierForUnit({ ...unit, dying: true }), 0)
  assert.equal(adjustGambaRoll(6, gambaModifierForUnit(unit)), 6)
})

test('«Аскетик» gambles on its owner turn and dies on rolls one through two', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Аскетик')
  assert.deepEqual(startTurnEffect(card.Description), { scope: 'owner-turn', operations: [{ kind: 'gamba-destroy-self', maximumRoll: 2 }] })
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const startTurn = stripTypeScriptTypes([app.split('\n').find(line => line.startsWith('function resolveMovementTriggers(')), app.split('\n').find(line => line.startsWith('function rollGamba(')), app.split('\n').find(line => line.startsWith('function startTurn()'))].join('\n'))
  for (const roll of [1, 2, 3, 4, 5, 6]) {
    for (const item of [undefined, { Name: 'Алмаз' }]) for (const [owner, flippedTurns] of [[0, 0], [1, 0], [0, 2]]) {
      const unit = { card, owner, flippedTurns, item, dying: false }
      const player = { hand: [], limit: 0, mana: 0, energy: 0 }
      let rolls = 0
      runInNewContext(`${startTurn}; startTurn()`, {
        player: { value: player }, players: { value: [player, player] }, board: { value: [unit] },
        current: { value: 0 }, round: { value: 1 }, screen: { value: 'game' },
        newHandCards: { value: [] }, handDrawStart: { value: 0 }, overLimit: { value: 0 }, chosenDiscard: { value: [] }, pendingStartTurnBurns: { value: 0 },
        unitDescription: unit => unit.card.Description, startTurnEffect, resolveStartTurnStages, adjustGambaRoll, gambaModifierForUnit,
        Math: { ...Math, min: Math.min, max: Math.max, floor: Math.floor, random: () => { rolls++; return (roll - 1) / 6 } },
        kill: target => { target.dying = true }, note: () => {}, draw: () => {},
      })
      assert.equal(rolls, owner === 0 && flippedTurns === 0 ? 1 : 0)
      assert.equal(unit.dying, owner === 0 && flippedTurns === 0 && roll <= (item ? 1 : 2))
    }
  }
})

test('«Генератор щита» queues an owner-turn choice and shields only an unshielded creature in one of eight adjacent sockets', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Генератор щита')
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const startTurn = source.split(/\r?\n/u).filter(line => line.startsWith('function resolveMovementTriggers(') || line.startsWith('function startTurn(')).join('\n')
  const choose = source.split(/\r?\n/u).filter(line => line.startsWith('function startTurnShieldTargets(') || line.startsWith('function chooseStartTurnShield(')).join('\n')
  const generator = { id: 'building', card, owner: 0, row: 2, col: 2, dying: false, flippedTurns: 0 }
  const adjacent = { id: 'adjacent', card: { Name: 'Существо', Type: 0, Description: '' }, owner: 0, row: 1, col: 1, shield: false, dying: false, flippedTurns: 0 }
  const distant = { ...adjacent, id: 'distant', row: 0, col: 0 }
  const flipped = { ...adjacent, id: 'flipped', row: 1, col: 2, flippedTurns: 1 }
  const alreadyShielded = { ...adjacent, id: 'shielded', row: 2, col: 3, shield: true }
  const board = { value: [generator, adjacent, distant, flipped, alreadyShielded] }
  const pendingStartTurnShields = { value: [] }, player = { hand: [], limit: 0, mana: 0, energy: 0 }
  const context = { board, pendingStartTurnShields, player: { value: player }, players: { value: [player, {}] }, current: { value: 0 }, round: { value: 1 }, screen: { value: 'game' },
    newHandCards: { value: [] }, handDrawStart: { value: 0 }, overLimit: { value: 0 }, chosenDiscard: { value: [] }, pendingStartTurnBurns: { value: 0 }, unitDescription: unit => unit.card.Description,
    startTurnEffect, resolveStartTurnStages: (reset, effects, hand, resources) => { reset(); effects(); hand(); resources() },
    startTurnShieldTargets: () => { const source = board.value.find(unit => unit.id === pendingStartTurnShields.value[0]); return source ? board.value.filter(target => target.card.Type === 0 && !target.dying && !target.flippedTurns && !target.shield && Math.max(Math.abs(target.row - source.row), Math.abs(target.col - source.col)) === 1) : [] },
    chooseStartTurnShield: target => runInNewContext('chooseStartTurnShield(target)', { ...context, target }),
    draw: () => {}, note: () => {}, inform: () => {}, context: null }
  context.context = context
  runInNewContext(stripTypeScriptTypes(`${startTurn};${choose};startTurn()`), context)
  assert.deepEqual(pendingStartTurnShields.value, ['building'])
  runInNewContext(stripTypeScriptTypes('chooseStartTurnShield(adjacent)'), { ...context, adjacent })
  assert.equal(adjacent.shield, true)
  assert.deepEqual(pendingStartTurnShields.value, [])
  runInNewContext('startTurn()', context)
  assert.deepEqual(pendingStartTurnShields.value, [])
  assert.equal(runInNewContext('startTurnShieldTargets().length', context), 0)
})

test('«Акита Неру» discounts every numbered ability while active and strengthens for enemy Miku or Teto', () => {
  const akita = { owner: 0, flippedTurns: 0, dying: false, card: { Name: 'Акита Неру' } }
  const miku = { owner: 1, flippedTurns: 0, dying: false, card: { Name: 'Хатсуне Мику' } }
  const description = 'Способность 5⭐: Получает щит.\nСпособность 2⚫: Вы получаете 1 ману.'
  assert.equal(abilityCostOnField(description, 0, 0, []), 5)
  assert.equal(abilityCostOnField(description, 0, 0, [akita]), 4)
  assert.equal(abilityCostOnField(description, 1, 0, [akita]), 1)
  assert.equal(abilityCostOnField(description, 0, 1, [akita]), 5)
  assert.equal(abilityCostOnField(description, 0, 0, [{ ...akita, flippedTurns: 2 }]), 5)
  assert.equal(abilityCostOnField(description, 0, 0, [{ ...akita, dying: true }]), 5)
  assert.equal(abilityCostOnField(description, 0, 0, [akita, miku]), 2)
  assert.equal(abilityCostOnField(description, 1, 0, [akita, miku]), 0)
  assert.equal(abilityCostOnField(description, 0, 0, [akita, { ...miku, card: { Name: 'Касане Тето' } }]), 2)
  assert.equal(abilityCostOnField(description, 0, 0, [akita, { ...miku, flippedTurns: 2 }]), 2)
  assert.equal(abilityCostOnField(description, 0, 0, [akita, { ...miku, owner: 0 }]), 4)
  assert.equal(abilityCostOnField(description, 0, 0, [akita, { ...miku, dying: true }]), 4)
  assert.equal(abilityCostOnField(description, 0, 0, [akita, { ...akita }, miku]), 0)
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const paymentFunctions = app.split('\n').filter(line => /^const (abilityCost|canPayAbility|payAbility)=/u.test(line)).join('\n')
  const unit = { owner: 0, blackTokens: 2, card: { Description: description } }
  const player = { mana: 3 }
  const result = runInNewContext(stripTypeScriptTypes(`${paymentFunctions}\nconst cost=abilityCost(unit,0); const affordable=canPayAbility(unit,cost,0); if(affordable)payAbility(unit,cost,0); const tokenCost=abilityCost(unit,1); payAbility(unit,tokenCost,1); ({cost,affordable,tokenCost})`), {
    unit, player: { value: player }, board: { value: [akita, miku] },
    unitDescription: unit => unit.card.Description, abilityCostOnField, abilityCostResource,
  })
  assert.equal(result.cost, 2)
  assert.equal(result.affordable, true)
  assert.equal(player.mana, 1)
  assert.equal(result.tokenCost, 0)
  assert.equal(unit.blackTokens, 2)
})

test('«Глифид-страж» movement immediately uses its speed bonus when its shield is lost', async () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Глифид-страж')
  const unit = { id: 'guard', card, speed: card.Speed, owner: 0, row: 2, col: 2, shield: true, flippedTurns: 0, dying: false }
  assert.equal(effectiveUnitSpeed(unit), 3)
  unit.shield = false
  assert.equal(effectiveUnitSpeed(unit), 1)
  unit.shield = true
  assert.equal(effectiveUnitSpeed(unit), 3)
  assert.equal(effectiveUnitSpeed({ ...unit, shield: false, flippedTurns: 2 }), 3)
  assert.equal(effectiveUnitSpeed({ ...unit, shield: false, dying: true }), 3)
  assert.equal(effectiveUnitSpeed({ ...unit, shield: false, speed: 4 }), 2)
  assert.equal(effectiveUnitSpeed({ ...unit, shield: false, card: { Name: 'Другой' } }), 3)
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const moveStart = app.indexOf('async function move(')
  const movementFunctions = [app.split('\n').find(line => line.startsWith('function resolveMovementTriggers(')), app.slice(moveStart, app.indexOf('\nfunction resolveTrap(', moveStart)), app.split('\n').find(line => line.startsWith('function unitDragMode('))].join('\n')
  for (const [shield, energy, allowed, remaining] of [[true, 2, false, 2], [true, 3, true, 0], [false, 0, false, 0], [false, 1, true, 0], [false, 3, true, 2]]) {
    const moving = { ...unit, shield }
    const player = { energy }
    const opponent = { energy: 0 }
    const board = { value: [moving] }
    const appScript = stripTypeScriptTypes(`${movementFunctions}\nconst dragMode=unitDragMode(moving,1,2); await move('guard',1,2,false);`)
    const result = await runInNewContext(`(async()=>{${appScript}return dragMode})()`, {
      moving, player: { value: player }, players: { value: [player, opponent] }, board, wheatTokens: { value: [] }, current: { value: 0 }, round: { value: 1 },
      movementLock: { value: null }, selection: { value: null }, effectiveUnitSpeed, unitCanMoveAndAttack,
      active: () => true, canMove: () => true, at: () => undefined, movementIsBlocked, loadGameCore: testLoadGameCore, localMovePending: { value: false },
      startDrop: () => {}, applyDoggoBuffs: () => 0, localCoreChoice: { value: null }, visual: () => {}, note: () => {}, inform: () => {}, coord: () => '',
    })
    assert.equal(result, allowed ? 'move' : null)
    assert.equal(player.energy, remaining, `shield=${shield}, energy=${energy}`)
    assert.equal(board.value[0].row, allowed ? 1 : 2)
  }
})

test('«Варан» burns dying creatures from either side, including itself, but leaves items and buildings in discard', () => {
  const varanCard = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Варан')
  const varan = { id: 'varan', owner: 0, card: varanCard, flippedTurns: 0, dying: false }
  assert.equal(burnsOnDeathFromField(0, [varan]), true)
  assert.equal(burnsOnDeathFromField(3, [varan]), false)
  assert.equal(burnsOnDeathFromField(0, [{ ...varan, flippedTurns: 1 }]), false)
  assert.equal(burnsOnDeathFromField(0, [{ ...varan, dying: true }]), false)
  assert.equal(burnsOnDeathFromField(0, []), false)
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const killFunction = app.slice(app.indexOf('function kill('), app.indexOf('function healCreature('))
  for (const [owner, type, self, flippedTurns, expectedBurn] of [[0, 0, false, 0, true], [1, 0, false, 0, true], [0, 3, false, 0, false], [0, 0, true, 0, true], [0, 0, false, 2, false]]) {
    const source = { ...varan, flippedTurns }
    const item = { Name: 'Предмет', Description: '', Type: 1 }
    const target = self ? source : { id: 'target', owner, card: { Name: 'Цель', Description: '', Type: type }, item, flippedTurns: 0, dying: false }
    const players = [0, 1].map(() => ({ burned: [], discard: [], burnedThisTurn: false }))
    const board = self ? [source] : [source, target]
    runInNewContext(stripTypeScriptTypes(`${killFunction}\nkill(target); kill(target)`), {
      target, board: { value: board }, players: { value: players }, current: { value: 0 },
      attackResolutionDepth: 0, burnsOnDeathFromField, recordBurn: (owner, card) => owner.burned.push(card), hasBurnTrait, effectsForTrigger, killRewardForCard,
      visual: () => {}, note: () => {}, window: { setTimeout: callback => callback() },
    })
    assert.equal(players[owner].burned.includes(target.card), expectedBurn)
    assert.equal(players[owner].discard.includes(target.card), !expectedBurn)
    assert.equal(players[owner].burnedThisTurn, expectedBurn && owner === 0)
    assert.equal(board.includes(target), false)
    if (!self) assert.equal(players[owner].discard.includes(item), true)
    assert.equal(players[owner].burned.length + players[owner].discard.length, self ? 1 : 2)
  }
  const attacker = { id: 'attacker', owner: 1, card: { Name: 'Нападающий', Description: '', Type: 0 }, row: 2, col: 1, attack: 3, health: 1, shield: false, flippedTurns: 0, dying: false, attacks: 0 }
  const defender = { ...varan, row: 2, col: 2, health: 1, attack: 3, shield: false }
  const players = [0, 1].map(() => ({ burned: [], discard: [], burnedThisTurn: false }))
  const board = [attacker, defender]
  const combatFunctions = app.split('\n').filter(line => /^function (attack|damage|queuePendingDeath)\(/u.test(line)).join('\n')
  runInNewContext(stripTypeScriptTypes(`let attackResolutionDepth=0; const pendingDeaths=[]; ${combatFunctions}\n${killFunction}\nattack('attacker',2,2,defender)`), {
    defender, board: { value: board }, players: { value: players }, current: { value: 1 }, selection: { value: null },
    active: () => true, unitHas: () => false, adjacent: () => true, unitDescription: unit => unit.card.Description,
    canAttackBoardCard, unitCanMoveAndAttack, canBeAttackedByCombat, canAttackTarget, shouldDealCombatDamage, attackDamageForCard, canCounterattack, attackWasDiagonal, effectiveUnitAttack,
    resolveAttackStages, shouldFinalizeDeath, applyUnitDamage, incomingDamageReduction, burnsOnDeathFromField, recordBurn: (owner, card) => owner.burned.push(card), hasBurnTrait,
    effectsForTrigger, killRewardForCard, resolveCrown: () => {}, resolveTrap: () => {},
    visual: () => {}, note: () => {}, inform: () => {}, coord: () => '', window: { setTimeout: callback => callback() },
  })
  assert.equal(players[0].burned.includes(varanCard), true)
  assert.equal(players[1].burned.includes(attacker.card), true)
  assert.equal(board.length, 0)
})

test('«Розовый Алмаз» shields allied creatures on healing, including a full-health heal by the opponent', () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Розовый Алмаз')
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const healFunction = app.split('\n').find(line => line.startsWith('function healCreature('))
  for (const [type, health, auraOwner, flippedTurns, dying, healerOwner, expectedShield] of [
    [0, 1, 0, 0, false, 0, true], [0, 4, 0, 0, false, 0, true], [0, 4, 0, 0, false, 1, true],
    [0, 1, 1, 0, false, 0, false], [0, 1, 0, 2, false, 0, false], [0, 1, 0, 0, true, 0, false],
    [3, 1, 0, 0, false, 0, false],
  ]) {
    const target = { owner: 0, card: { Name: 'Цель', Type: type }, health, maxHealth: 4, shield: false, dying: false, flippedTurns: 0 }
    const source = { owner: auraOwner, card, flippedTurns, dying }
    runInNewContext(stripTypeScriptTypes(`${healFunction}\nhealCreature(target,2,healerOwner)`), {
      target, healerOwner, board: { value: [source, target] }, ameHealingReward,
    })
    assert.equal(target.health, Math.min(4, health + 2))
    assert.equal(target.shield, expectedShield)
  }
  const diamond = { owner: 0, card, health: 8, maxHealth: 8, shield: false, dying: false, flippedTurns: 0 }
  runInNewContext(stripTypeScriptTypes(`${healFunction}\nhealCreature(diamond,0); healCreature(diamond,0)`), {
    diamond, board: { value: [diamond] }, ameHealingReward,
  })
  assert.equal(diamond.shield, true)
  assert.equal(diamond.health, 8)
})

test('«PT4OLKA» uses current health for direct attacks and counterattacks despite attack buffs', async () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'PT4OLKA')
  const unit = { id: 'pt', owner: 0, card, attack: 12, health: 4, flippedTurns: 0, dying: false, attacks: 0, row: 0, col: 1 }
  assert.equal(effectiveUnitAttack(unit), 4)
  unit.health = 2
  assert.equal(effectiveUnitAttack(unit), 2)
  unit.health = 6
  assert.equal(effectiveUnitAttack(unit), 6)
  assert.equal(effectiveUnitAttack({ ...unit, health: -1 }), 0)
  assert.equal(effectiveUnitAttack({ ...unit, flippedTurns: 2 }), 12)
  assert.equal(effectiveUnitAttack({ ...unit, card: { Name: 'Другая карта' } }), 12)
  const app = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const directStart=app.indexOf('async function direct('); const directFunction=app.slice(directStart,app.indexOf('function damage(',directStart))
  const enemy = { name: 'Противник', health: 45 }
  await runInNewContext(stripTypeScriptTypes(`${directFunction}\ndirect(unit)`), {
    unit, board: { value: [unit] }, enemy: { value: enemy }, enemyRow: { value: 0 }, active: () => true, unitHas: () => false, selection: { value: null },
    rulesForCard, unitCanMoveAndAttack, attackDamageForCard, effectiveUnitAttack, hitPlayer: (player, amount) => { player.health -= amount },
    visual: () => {}, note: () => {}, inform: () => {}, coord: () => '', resolveCrown: () => {},
  })
  assert.equal(enemy.health, 39)
  const attacker = { ...unit, id: 'attacker', card: { Name: 'Другой', Type: 0 }, health: 10, attack: 2, row: 2, col: 1, attacks: 0 }
  const defender = { ...unit, owner: 1, health: 4, shield: false, row: 2, col: 2 }
  const attackFunction = app.split('\n').find(line => line.startsWith('function attack('))
  runInNewContext(stripTypeScriptTypes(`let attackResolutionDepth=0; const pendingDeaths=[]; ${attackFunction}\nattack('attacker',2,2,defender)`), {
    defender, board: { value: [attacker, defender] }, current: { value: 0 }, selection: { value: null },
    active: () => true, unitHas: () => false, adjacent: () => true, unitDescription: () => '',
    canAttackBoardCard, unitCanMoveAndAttack, canBeAttackedByCombat, canAttackTarget, shouldDealCombatDamage, attackDamageForCard, canCounterattack, attackWasDiagonal,
    resolveAttackStages, effectiveUnitAttack, burnsOnDeathFromField, recordBurn: (owner, card) => owner.burned.push(card),
    damage: (target, amount) => { target.health = applyUnitDamage(target, amount).state.health },
    resolveCrown: () => {}, resolveTrap: () => {}, visual: () => {}, note: () => {}, inform: () => {}, coord: () => '',
  })
  assert.equal(defender.health, 2)
  assert.equal(attacker.health, 8)
})

test('local direct attacks without crown effects delegate to the shared game core', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const directStart=source.indexOf('async function direct('); const directFunction=source.slice(directStart,source.indexOf('function damage(',directStart))
  const attacker = { id: 'direct-attacker', owner: 0, card: { Name: 'Plain', Type: 0 }, row: 0, col: 2, health: 4, attack: 3, attacks: 0 }
  const players = [{ health: 45 }, { health: 45 }]
  const commands = []
  const context = {
    unit: attacker, board: { value: [attacker] }, players: { value: players }, enemy: { value: players[1] }, current: { value: 0 }, round: { value: 1 },
    movementLock: { value: null }, wheatTokens: { value: [] }, selection: { value: null }, enemyRow: { value: 0 }, screen: { value: 'game' }, winner: { value: 0 },
    active: () => true, unitHas: () => false, rulesForCard: () => ({}), unitCanMoveAndAttack: () => true,
    attackDamageForCard: () => 3, effectiveUnitAttack: () => 3, winnerWhenPlayerFalls: () => 0,
    applyLocalCommand: async (action, data) => { commands.push({ action, data }); return { state: { status: 'active' } } },
    hitPlayer: () => assert.fail('eligible attacks must use game core'), visual: () => {}, note: () => {}, inform: () => assert.fail('attack should be valid'), coord: () => '', resolveCrown: () => assert.fail('no crown effect'),
  }
  await runInNewContext(stripTypeScriptTypes(`${directFunction}\ndirect(unit)`), context)
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [{ action: 'unit.attackPlayer', data: { unitId: attacker.id } }])
})

test('local attacks with core-supported crown effects delegate to the shared game core', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const attackAction = source.split(/\r?\n/u).find(line => line.startsWith('async function attackAction('))
  const attacker = { id: 'attacker', owner: 0, card: { Name: 'Минт', Type: 0 }, row: 2, col: 1, attacks: 0 }
  const target = { id: 'target', owner: 1, card: { Name: 'Target', Type: 0 }, row: 2, col: 2, attacks: 0 }
  const commands = []
  const context = {
    board: { value: [attacker, target] }, target, current: { value: 0 }, localMovePending: { value: false }, selection: { value: null },
    active: () => true, unitDescription: () => '', unitCanMoveAndAttack: () => true, canAttackBoardCard: () => true, canAttackTarget: () => true,
    adjacent: () => true, unitHas: () => false, rulesForCard: () => ({}), effectsForTrigger: () => [], scavengerSwarmSources: () => [],
    applyLocalCommand: async (action, data) => { commands.push({ action, data }); return { state: { pendingChoice: undefined } } },
    attack: () => assert.fail('ordinary attack should use game core'), unitVisual: () => {}, visual: () => {}, note: () => {}, inform: () => assert.fail('attack should be valid'), coord: () => '',
  }
  await runInNewContext(stripTypeScriptTypes(`${attackAction}\nattackAction('attacker',2,2,target)`), context)
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [{ action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'target' } }])
})

test('«Думслеер» attack bonus follows current health and preserves other attack buffs', async () => {
  const card = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Думслеер')
  const unit = { card, health: 3, attack: 7, flippedTurns: 0, dying: false, row: 0, col: 0, attacks: 0 }
  assert.equal(effectiveUnitAttack(unit), 7)
  for (const health of [2, 1, 0]) assert.equal(effectiveUnitAttack({ ...unit, health }), 11)
  assert.equal(effectiveUnitAttack({ ...unit, health: 1, flippedTurns: 1 }), 7)
  assert.equal(effectiveUnitAttack({ ...unit, health: 1, dying: true }), 7)
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const directStart=source.indexOf('async function direct('); const directFunction=source.slice(directStart,source.indexOf('function damage(',directStart))
  const enemy = { name: 'Противник', health: 45 }
  const context = { unit, board: { value: [unit] }, enemy: { value: enemy }, enemyRow: { value: 0 }, active: () => true, unitHas: () => false, selection: { value: null },
    rulesForCard, unitCanMoveAndAttack, attackDamageForCard, effectiveUnitAttack, hitPlayer: (player, amount) => { player.health -= amount },
    visual: () => {}, note: () => {}, inform: () => {}, coord: () => '', resolveCrown: () => {} }
  unit.health = 2
  await runInNewContext(stripTypeScriptTypes(`${directFunction}\ndirect(unit)`), context)
  assert.equal(enemy.health, 34)
  unit.health = 3
  unit.attacks = 0
  await runInNewContext(stripTypeScriptTypes(`${directFunction}\ndirect(unit)`), context)
  assert.equal(enemy.health, 27)
})

test('«Сникерс» suppresses combat and face damage but keeps crown effects; counterattacks deal no damage', async () => {
  assert.equal(attackDamageForCard('Минт', 8, 'Сникерс'), 0)
  assert.equal(attackDamageForCard('Минт', 8, 'Сникерс', true), 0)
  assert.equal(attackDamageForCard('Пиппинс', 8, undefined, true), 0)
  assert.equal(attackDamageForCard('Pantlessterrorist', 8, undefined, true), 8)
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const directStart = source.indexOf('async function direct(')
  const directFunction = source.slice(directStart, source.indexOf('function damage(', directStart))
  const functions = [source.split(/\r?\n/u).find(line => line.startsWith('function attack(')), directFunction, source.split(/\r?\n/u).find(line => line.startsWith('function resolveCrown('))].join('\n')
  const snickers = JSON.parse(readFileSync(new URL('../../../reference/cards.json', import.meta.url), 'utf8')).find(item => item.Name === 'Сникерс')
  const attacker = { id: 'mint', card: { Name: 'Минт', Type: 0 }, item: snickers, attack: 8, health: 10, owner: 0, row: 0, col: 0, attacks: 0, flippedTurns: 0 }
  const defender = { id: 'defender', card: { Name: 'Другой', Type: 0 }, attack: 2, health: 10, owner: 1, row: 0, col: 1, flippedTurns: 0 }
  const players = [{ health: 45, mana: 0, draws: 0 }, { health: 45, mana: 0, draws: 0 }]
  const context = { attacker, defender, board: { value: [attacker, defender] }, players: { value: players }, enemy: { value: players[1] }, enemyRow: { value: 0 }, current: { value: 0 }, selection: { value: null }, localMovePending: { value: false },
    active: () => true, unitHas: () => false, unitDescription: () => '', adjacent: () => true,
    canAttackBoardCard, unitCanMoveAndAttack, canBeAttackedByCombat, canAttackTarget, shouldDealCombatDamage, attackDamageForCard, canCounterattack, attackWasDiagonal, effectiveUnitAttack, resolveAttackStages,
    rulesForCard, effectsForTrigger, burnsOnDeathFromField, recordBurn: owner => owner.burned.push(), resolveTrap: () => {},
    draw: player => { player.draws++ }, damage: (unit, amount) => { unit.health -= amount }, hitPlayer: (player, amount) => { player.health -= amount },
    visual: () => {}, note: () => {}, inform: () => {}, coord: () => '' }
  runInNewContext(stripTypeScriptTypes(`let attackResolutionDepth=0; const pendingDeaths=[];\n${functions}\nattack('mint',0,1,defender)`), context)
  assert.equal(defender.health, 10)
  assert.equal(attacker.health, 8)
  assert.equal(players[0].draws, 1)
  attacker.attacks = 0
  await runInNewContext('direct(attacker)', context)
  assert.equal(players[1].health, 45)
})
test('creature push returns the occupied line from the target toward its free edge cell', () => {
  const board = [
    { id: 'near', card: { Type: 0, Name: 'Near' }, row: 4, col: 2 },
    { id: 'far', card: { Type: 0, Name: 'Far' }, row: 3, col: 2 },
  ]

  assert.deepEqual(creaturePushLine(board, 0, 4, 2, null)?.map(unit => unit.id), ['near', 'far'])
})

test('local ordinary turn ending delegates state transition to game core', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const finishTurn = source.split(/\r?\n/u).find(line => line.startsWith('async function finishTurn('))
  assert.ok(finishTurn)
  const calls = []
  const context = {
    localMovePending: { value: false }, localTurnStartResolved: { value: false }, localTurnHandSize: { value: 0 }, current: { value: 0 }, players: { value: [{ hand: [] }, { hand: [{}, {}] }] }, player: { value: { played: true } }, screen: { value: 'match' }, selection: { value: { kind: 'unit' } },
    applyLocalCommand: async (...args) => { calls.push(args); return { state: { status: 'active' }, events: [] } },
  }
  await runInNewContext(stripTypeScriptTypes(`${finishTurn}\nfinishTurn()`), context)
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['turn.end', {}, 0]])
  assert.equal(context.screen.value, 'handoff')
  assert.equal(context.selection.value, null)
})
test('local no-play discard sends selected hand instance IDs to game core', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const handler = source.split(/\r?\n/u).find(line => line.startsWith('function confirmWarningDiscard('))
  const player = { name: 'Local', hand: [{ Name: 'Keep' }, { Name: 'Discard' }] }
  const calls = []
  const context = {
    warningSelectedDiscards: { value: [1] }, discardAnimating: { value: false }, player: { value: player },
    window: { setTimeout: callback => callback() }, crypto: { randomUUID: () => 'discard-id' },
    note: () => {}, resetWarningState: () => {}, finishTurn: data => calls.push(data),
  }
  runInNewContext(stripTypeScriptTypes(`${handler}\nconfirmWarningDiscard()`), context)
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ option: 'discard_and_decrease_limit', discardedCardInstanceIds: ['discard-id'] }])
  assert.equal(player.hand.length, 2)
})
test('legacy end-turn fallback still applies the selected no-play option', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const applyOption = source.split(/\r?\n/u).find(line => line.startsWith('function applyLocalEndTurnOption('))
  assert.ok(applyOption)
  const player = { hand: [{ instanceId: 'keep' }, { instanceId: 'drop' }], discard: [], limit: 7 }
  const context = { player: { value: player }, updateHandLimit: (owner, amount) => { owner.limit += amount } }
  runInNewContext(stripTypeScriptTypes(`${applyOption}\napplyLocalEndTurnOption({option:'discard_and_decrease_limit',discardedCardInstanceIds:['drop']})`), context)
  assert.deepEqual(player.hand.map(card => card.instanceId), ['keep'])
  assert.deepEqual(player.discard.map(card => card.instanceId), ['drop'])
  assert.equal(player.limit, 6)
})
test('local direct attacks with core-supported crown effects delegate to game core', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const directStart=source.indexOf('async function direct('); const directFunction=source.slice(directStart,source.indexOf('function damage(',directStart))
  const attacker = { id: 'crowned', owner: 0, card: { Name: 'Crowned', Type: 0 }, row: 0, col: 2, attack: 3, attacks: 0 }
  const commands = []
  const context = {
    unit: attacker, board: { value: [attacker] }, players: { value: [{ health: 45 }, { health: 45 }] }, enemy: { value: { name: 'Enemy' } },
    current: { value: 0 }, round: { value: 1 }, movementLock: { value: null }, wheatTokens: { value: [] }, selection: { value: null }, enemyRow: { value: 0 }, screen: { value: 'game' }, winner: { value: 0 },
    localMovePending: { value: false }, active: () => true, unitHas: () => false, rulesForCard: () => ({ crown: [{ kind: 'heal-attacker', amount: 1 }] }), effectsForTrigger: () => [], unitCanMoveAndAttack: () => true,
    applyLocalCommand: async (action, data) => { commands.push({ action, data }); return { state: { status: 'active' } } }, hitPlayer: () => {}, attackDamageForCard: () => 3, effectiveUnitAttack: () => 3,
    visual: () => {}, note: () => {}, inform: () => assert.fail('attack should be valid'), coord: () => '', resolveCrown: () => assert.fail('eligible crown should use game core'),
  }
  await runInNewContext(stripTypeScriptTypes(`${directFunction}\ndirect(unit)`), context)
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [{ action: 'unit.attackPlayer', data: { unitId: attacker.id } }])
})
test('local abilities without a quick-effect parser result delegate to game core', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const useAbility = source.split(/\r?\n/u).find(line => line.startsWith('async function useAbility('))
  assert.ok(useAbility)
  const unit = { id: 'unit', owner: 0, card: { Name: 'Ability', Description: '' }, abilityUsed: false }
  const commands = []
  const context = {
    unitDescription: () => '', abilityDescription: () => '', active: () => true, canActWhileFlipped: () => false,
    abilityCost: () => 0, canPayAbility: () => true, targetedAbilityOperation: () => undefined,
    unit, localMovePending: { value: false }, applyLocalCommand: async (...args) => { commands.push(args); return { state: { pendingChoice: undefined } } },
    visual: () => {}, selection: { value: null }, note: () => {}, inform: () => assert.fail('ability should be valid'),
  }
  await runInNewContext(stripTypeScriptTypes(`${useAbility}\nuseAbility(unit)`), context)
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [['ability.use', { unitId: 'unit', abilityIndex: 0 }, 0]])
})

test('local score-adjustment abilities charge and update through game core', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const applyScoreAdjustment = source.split(/\r?\n/u).find(line => line.startsWith('async function applyScoreAdjustment('))
  assert.ok(applyScoreAdjustment)
  const unit = { id: 'scorer', owner: 0, card: { Name: 'Scorer' } }
  const commands = []
  const context = {
    scoreAdjustmentUnit: { value: { unit, index: 1 } }, selection: { value: { kind: 'unit', id: unit.id } },
    unitDescription: () => 'ability', abilityCost: () => 2, active: () => true, isRepeatableAbility: () => false, canPayAbility: () => true,
    applyLocalCommand: async (...args) => { commands.push(args) }, localMovePending: { value: false }, note: () => {}, inform: () => assert.fail('ability should be valid'),
  }
  await runInNewContext(stripTypeScriptTypes(`${applyScoreAdjustment}\napplyScoreAdjustment(-1)`), context)
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [['ability.use', { unitId: 'scorer', abilityIndex: 1, scoreAdjustment: -1 }, 0]])
  assert.equal(context.scoreAdjustmentUnit.value, null)
  assert.equal(context.selection.value, null)
})

test('local game-core choice stays attached to the match until the choice is resolved', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const applyLocalCommand = source.split(/\r?\n/u).find(line => line.startsWith('async function applyLocalCommand('))
  assert.ok(applyLocalCommand)
  const commands = []
  const context = {
    loadGameCore: async () => ({ applyCommand: (match, seat, command) => {
      commands.push({ match, seat, command })
      return { state: command.action === 'ability.use'
        ? { ...match, pendingChoice: { id: 'iceberg-choice', owner: seat, kind: 'ability-draw-or-limit', sourceUnitId: 'iceberg', unitIds: [] } }
        : { ...match, pendingChoice: null } }
    } }),
    current: { value: 0 }, round: { value: 1 }, players: { value: [{}, {}] }, board: { value: [] }, movementLock: { value: null }, wheatTokens: { value: [] },
    localCoreChoice: { value: null }, winner: { value: 0 }, screen: { value: 'game' }, winnerWhenPlayerFalls: () => 0,
  }
  await runInNewContext(stripTypeScriptTypes(`${applyLocalCommand}\n(async()=>{await applyLocalCommand('ability.use',{unitId:'iceberg',abilityIndex:0},0); await applyLocalCommand('choice.resolve',{choiceId:localCoreChoice.value.id,choice:'draw'},0)})()`), context)
  assert.equal(commands[1].match.pendingChoice.id, 'iceberg-choice')
  assert.equal(context.localCoreChoice.value, null)
})

test('local game-core retains a targeted ability choice for its UI resolver', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const applyLocalCommand = source.split(/\r?\n/u).find(line => line.startsWith('async function applyLocalCommand('))
  const useAbility = source.split(/\r?\n/u).find(line => line.startsWith('async function useAbility('))
  const resolveChoice = source.split(/\r?\n/u).find(line => line.startsWith('async function resolveLocalAbilityChoice('))
  const deck = randomLegalDeck(cardCatalog, () => 0.5)
  assert.ok(deck)
  const match = createMatch({ matchId: 'local-targeted-ability', players: [{ userId: 'one', displayName: 'One', deck }, { userId: 'two', displayName: 'Two', deck }], catalog: cardCatalog, random: () => 0.5 })
  match.round = 2
  match.players[0].mana = 10
  const suzy = cardCatalog.find(card => card.Name === 'Сьюзи')
  const targetCard = cardCatalog.find(card => card.Type === 0 && !card.Tags?.includes('в разработке'))
  match.board = [
    { id: 'attacker', card: { ...suzy, instanceId: 'suzy-on-board' }, owner: 0, row: 3, col: 2, health: suzy.Health, maxHealth: suzy.Health, attack: suzy.Attack, speed: suzy.Speed, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'target', card: { ...targetCard, instanceId: 'target-on-board' }, owner: 1, row: 2, col: 2, health: 30, maxHealth: 30, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  ]
  const context = {
    loadGameCore: async () => ({ applyCommand }),
    current: { value: 0 }, round: { value: match.round }, players: { value: match.players }, board: { value: match.board }, movementLock: { value: null }, wheatTokens: { value: [] },
    unitDescription: unit => unit.card.Description, abilityDescription: () => 'Способность 5: Наносит 8 урона выбранной цели.', active: () => true, canActWhileFlipped: () => false,
    abilityCost: () => 5, canPayAbility: () => true, targetedAbilityOperation: cardEffects.targetedAbilityOperation,
    localMovePending: { value: false }, localCoreChoice: { value: null }, selection: { value: null }, winner: { value: 0 }, screen: { value: 'game' }, winnerWhenPlayerFalls: () => 0,
    visual: () => {}, note: () => {}, inform: message => { context.message = message }, console: { error: error => assert.fail(String(error)) },
  }
  await runInNewContext(stripTypeScriptTypes(`${applyLocalCommand}\n${useAbility}\n${resolveChoice}\n(async()=>{await useAbility(board.value[0]);await resolveLocalAbilityChoice(board.value[1])})()`), context)
  assert.equal(context.localCoreChoice.value, null)
  assert.equal(context.selection.value, null)
  assert.equal(context.message, 'Выберите цель способности.')
  assert.equal(context.board.value.find(unit => unit.id === 'target').health, 22)
  assert.equal(context.players.value[0].mana, 5)
})

test('local Iceberg choice resolves against the pending game-core choice', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolveIcebergAbility = source.split(/\r?\n/u).find(line => line.startsWith('async function resolveIcebergAbility('))
  assert.ok(resolveIcebergAbility)
  const unit = { id: 'iceberg', owner: 1 }
  const commands = []
  const context = {
    pendingIcebergAbility: { value: { unit, index: 0 } }, localMovePending: { value: false },
    localCoreChoice: { value: { id: 'choice-1', kind: 'ability-draw-or-limit' } }, selection: { value: null },
    applyLocalCommand: async (...args) => { commands.push(args); context.localCoreChoice.value = null },
    note: () => {}, visual: () => {}, inform: () => assert.fail('choice should be valid'),
  }
  await runInNewContext(stripTypeScriptTypes(`${resolveIcebergAbility}\nresolveIcebergAbility('limit')`), context)
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [['choice.resolve', { choiceId: 'choice-1', choice: 'limit' }, 1]])
  assert.equal(context.pendingIcebergAbility.value, null)
})

test('local Bibi ability routes its selected building through game-core choice resolution', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolveAbility = source.split(/\r?\n/u).find(line => line.startsWith('function resolveAbility('))
  const sourceUnit = { id: 'bibi' }, building = { id: 'building', card: { Name: 'Bunker', Type: 3 } }, board = { value: [sourceUnit, building] }
  const resolved = []
  const context = {
    board, building, localCoreChoice: { value: { id: 'choice-bibi', owner: 0, kind: 'ability-sacrifice-building', sourceUnitId: 'bibi', unitIds: ['building'] } },
    unitDescription: () => '', resolveLocalAbilityChoice: async target => { resolved.push(target) },
  }
  await runInNewContext(stripTypeScriptTypes(`${resolveAbility}\nresolveAbility('bibi',0,0,building,0)`), context)
  assert.equal(resolved[0].id, 'building')
})

test('local Bibi activation keeps the server-validated building choice open', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const useAbility = source.split(/\r?\n/u).find(line => line.startsWith('async function useAbility('))
  const unit = { id: 'bibi', owner: 0, card: { Name: 'Биби' }, abilityUsed: false }
  const commands = [], selection = { value: null }, messages = []
  const context = {
    unit,
    unitDescription: () => 'ability', abilityDescription: () => 'destroy building', active: () => true, canActWhileFlipped: () => false,
    abilityCost: () => 0, canPayAbility: () => true, targetedAbilityOperation: () => ({ kind: 'sacrifice-building-for-attack', amount: 4 }),
    isRepeatableAbility: () => false, localMovePending: { value: false }, pendingAbilityTargets: { value: [] }, selection,
    applyLocalCommand: async (...args) => { commands.push(args); return { state: { pendingChoice: { kind: 'ability-sacrifice-building' } } } },
    visual: () => {}, note: () => {}, inform: message => messages.push(message),
  }
  await runInNewContext(stripTypeScriptTypes(`${useAbility}\nuseAbility(unit,0)`), context)
  assert.equal(commands[0][0], 'ability.use')
  assert.equal(selection.value.kind, 'ability')
  assert.match(messages[0], /Выберите своё здание/u)
})

test('local Bibi building selection resolves the authoritative choice without charging twice', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolveChoice = source.split(/\r?\n/u).find(line => line.startsWith('async function resolveLocalAbilityChoice('))
  assert.ok(resolveChoice)
  const target = { id: 'building', card: { Name: 'Bunker' } }, commands = []
  const context = {
    localCoreChoice: { value: { id: 'choice-bibi', owner: 0, kind: 'ability-sacrifice-building', sourceUnitId: 'bibi', unitIds: ['building'] } },
    target, localMovePending: { value: false }, selection: { value: { kind: 'ability' } }, board: { value: [target] },
    applyLocalCommand: async (...args) => { commands.push(args); context.localCoreChoice.value = null },
    note: () => {}, visual: () => {}, inform: message => assert.fail(message), console: { error: error => assert.fail(String(error)) },
  }
  await runInNewContext(stripTypeScriptTypes(`${resolveChoice}\nresolveLocalAbilityChoice(target)`), context)
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [['choice.resolve', { choiceId: 'choice-bibi', selection: { unitId: 'building' } }, 0]])
  assert.equal(context.selection.value, null)
})

test('local healing ability resolves its prevalidated ally through game-core', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolveChoice = source.split(/\r?\n/u).find(line => line.startsWith('async function resolveLocalAbilityChoice('))
  const target = { id: 'ally', card: { Name: 'Ally' } }, commands = []
  const context = {
    localCoreChoice: { value: { id: 'heal-choice', owner: 0, kind: 'ability-heal-creature', sourceUnitId: 'healer', unitIds: ['ally'], amount: 3, shield: true } },
    target, localMovePending: { value: false }, selection: { value: { kind: 'ability' } }, board: { value: [target] },
    applyLocalCommand: async (...args) => { commands.push(args); context.localCoreChoice.value = null },
    note: () => {}, visual: () => {}, inform: message => assert.fail(message), console: { error: error => assert.fail(String(error)) },
  }
  await runInNewContext(stripTypeScriptTypes(`${resolveChoice}\nresolveLocalAbilityChoice(target)`), context)
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [['choice.resolve', { choiceId: 'heal-choice', selection: { unitId: 'ally' } }, 0]])
})

test('local targeted damage ability resolves the selected target through game-core', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolveChoice = source.split(/\r?\n/u).find(line => line.startsWith('async function resolveLocalAbilityChoice('))
  const target = { id: 'enemy', card: { Name: 'Enemy' } }, commands = []
  const context = {
    localCoreChoice: { value: { id: 'damage-choice', owner: 0, kind: 'ability-damage-target', sourceUnitId: 'attacker', unitIds: ['enemy'], amount: 2 } },
    target, localMovePending: { value: false }, selection: { value: { kind: 'ability' } }, board: { value: [target] },
    applyLocalCommand: async (...args) => { commands.push(args); context.localCoreChoice.value = null },
    note: () => {}, visual: () => {}, inform: message => assert.fail(message), console: { error: error => assert.fail(String(error)) },
  }
  await runInNewContext(stripTypeScriptTypes(`${resolveChoice}\nresolveLocalAbilityChoice(target)`), context)
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [['choice.resolve', { choiceId: 'damage-choice', selection: { unitId: 'enemy' } }, 0]])
})

test('local targeted ability click resumes the pending game-core choice', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolveAbility = source.split(/\r?\n/u).find(line => line.startsWith('function resolveAbility('))
  const unit = { id: 'attacker' }, target = { id: 'enemy' }, resolutions = []
  const context = {
    board: { value: [unit, target] },
    localCoreChoice: { value: { id: 'damage-choice', kind: 'ability-damage-target', sourceUnitId: unit.id } },
    resolveLocalAbilityChoice: selected => resolutions.push(selected),
  }
  runInNewContext(`${stripTypeScriptTypes(resolveAbility)};resolveAbility('attacker',0,0,target,0)`, { ...context, target })
  assert.deepEqual(JSON.parse(JSON.stringify(resolutions)), [{ id: 'enemy' }])
})

test('local targeted ability resolves an opponent choice through game-core', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const resolveChoice = source.split(/\r?\n/u).find(line => line.startsWith('async function resolveLocalAbilityChoice('))
  const opponent = { name: 'Opponent' }, commands = []
  const context = {
    localCoreChoice: { value: { id: 'player-damage-choice', owner: 0, kind: 'ability-damage-target', sourceUnitId: 'attacker', unitIds: [], amount: 2, playerTarget: true } },
    opponent, players: { value: [{}, opponent] }, localMovePending: { value: false }, selection: { value: { kind: 'ability' } }, board: { value: [] },
    applyLocalCommand: async (...args) => { commands.push(args); context.localCoreChoice.value = null },
    note: () => {}, visual: () => {}, inform: message => assert.fail(message), console: { error: error => assert.fail(String(error)) },
  }
  await runInNewContext(stripTypeScriptTypes(`${resolveChoice}\nresolveLocalAbilityChoice(undefined,opponent)`), context)
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [['choice.resolve', { choiceId: 'player-damage-choice', selection: { player: 'opponent' } }, 0]])
})

test('a hand click cannot abandon a mandatory game-core ability target choice', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const chooseHand = source.split(/\r?\n/u).find(line => line.startsWith('function chooseHand('))
  const selection = { value: { kind: 'ability', id: 'needle', abilityIndex: 0 } }
  const context = {
    localCoreChoice: { value: { kind: 'ability-damage-targets' } }, selection,
    pendingZnakSave: { value: null }, pendingNewcomers: { value: null }, pendingApril: { value: null }, pendingRottenThief: { value: null }, pendingCardPayment: { value: null }, pendingDiscordDrama: { value: null }, pendingCrownSavedSpell: { value: null },
    resolveViskassDiscard: () => false, ignoreHandClick: { value: false }, unplayedWarning: { value: false }, warningDiscardMode: { value: false }, pendingStartTurnBurns: { value: 0 }, overLimit: { value: 0 }, optionalDiscardCount: { value: 0 },
    player: { value: { hand: [{ Type: 0, Name: 'Hand card' }] } }, inform: () => {},
  }
  runInNewContext(`${stripTypeScriptTypes(chooseHand)};chooseHand(0)`, context)
  assert.deepEqual(JSON.parse(JSON.stringify(selection.value)), { kind: 'ability', id: 'needle', abilityIndex: 0 })
})

test('local Needle damage and healing choices resolve all selected targets through game-core', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = ['applyLocalCommand', 'useAbility', 'resolveLocalAbilityChoice', 'resolveAbility'].map(name => source.split(/\r?\n/u).find(line => line.startsWith(name === 'useAbility' ? 'async function useAbility(' : name === 'resolveLocalAbilityChoice' ? 'async function resolveLocalAbilityChoice(' : `${name === 'resolveAbility' ? 'function' : 'async function'} ${name}(`)))
  const [applyLocalCommand, useAbility, resolveChoice, resolveAbility] = functions
  const needle = cardCatalog.find(card => card.Name === 'Игла')
  assert.ok(functions.every(Boolean) && needle)
  const deck = randomLegalDeck(cardCatalog, () => 0.5)
  assert.ok(deck)

  for (const abilityIndex of [0, 1]) {
    const match = createMatch({ matchId: `local-needle-${abilityIndex}`, players: [{ userId: 'one', displayName: 'One', deck }, { userId: 'two', displayName: 'Two', deck }], catalog: cardCatalog, random: () => 0.5 })
    match.round = 2
    const targets = ['one', 'two', 'three'].map((id, index) => ({
      id: `target-${id}`, card: { ...cardCatalog.find(card => card.Type === 0), instanceId: `needle-target-${id}` }, owner: index === 0 ? 0 : 1,
      row: 3, col: index, health: abilityIndex === 0 ? 5 : 1, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0,
    }))
    match.board = [
      { id: 'needle', card: { ...needle, instanceId: `needle-${abilityIndex}` }, owner: 0, row: 4, col: 2, health: needle.Health, maxHealth: needle.Health, attack: needle.Attack, speed: needle.Speed, summoned: 0, attacks: 0, blackTokens: 2 },
      ...targets,
    ]
    const context = {
      loadGameCore: async () => ({ applyCommand }), current: { value: 0 }, round: { value: 2 }, players: { value: match.players }, board: { value: match.board }, movementLock: { value: null }, wheatTokens: { value: [] },
      localCoreChoice: { value: null }, choiceKind: null, localMovePending: { value: false }, pendingAbilityTargets: { value: [] }, selection: { value: null }, winner: { value: 0 }, screen: { value: 'game' }, winnerWhenPlayerFalls: () => 0,
      unitDescription: unit => unit.card.Description ?? '', abilityDescription: (description, index) => cardEffects.abilityDescriptions(description)[index], abilityDescriptions: cardEffects.abilityDescriptions, abilityCost: () => 2,
      canPayAbility: () => true, targetedAbilityOperation: cardEffects.targetedAbilityOperation, isRepeatableAbility: () => false, active: () => true, canActWhileFlipped: () => false, movementIsBlocked: () => false, abilityDrawCount: () => null,
      addDistinctTarget: cardEffects.addDistinctTarget, clownTargetRequired: () => false, visual: () => {}, note: () => {}, inform: message => { context.message = message },
      console: { error: error => assert.fail(String(error)) }, setTimeout,
    }
    const run = `${functions.join('\n')}\n(async()=>{await useAbility(board.value[0],${abilityIndex});for(const id of ['target-one','target-two'])resolveAbility('needle',0,0,board.value.find(unit=>unit.id===id),${abilityIndex});resolveAbility('needle',0,0,board.value.find(unit=>unit.id==='target-one'),${abilityIndex});resolveAbility('needle',0,0,board.value.find(unit=>unit.id==='target-three'),${abilityIndex});await new Promise(resolve=>setTimeout(resolve,0))})()`
    await runInNewContext(stripTypeScriptTypes(run), context)
    assert.equal(context.localCoreChoice.value, null)
    assert.deepEqual(JSON.parse(JSON.stringify(context.pendingAbilityTargets.value)), [])
    assert.equal(context.message, 'Выберите разные цели.')
    assert.equal(context.board.value.find(unit => unit.id === 'needle').blackTokens, 0)
    assert.deepEqual(targets.map(target => context.board.value.find(unit => unit.id === target.id).health), [3, 3, 3])
  }
})

test('local self-movement ability preserves its legal cells in game-core', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = ['applyLocalCommand', 'useAbility', 'resolveLocalAbilityChoice', 'resolveAbility'].map(name => source.split(/\r?\n/u).find(line => line.startsWith(name === 'useAbility' ? 'async function useAbility(' : name === 'resolveLocalAbilityChoice' ? 'async function resolveLocalAbilityChoice(' : `${name === 'resolveAbility' ? 'function' : 'async function'} ${name}(`)))
  const deck = randomLegalDeck(cardCatalog, () => 0.5)
  assert.ok(deck)
  const match = createMatch({ matchId: 'local-ability-move', players: [{ userId: 'one', displayName: 'One', deck }, { userId: 'two', displayName: 'Two', deck }], catalog: cardCatalog, random: () => 0.5 })
  match.round = 2
  match.players[0].mana = 10
  const abrams = cardCatalog.find(card => card.Name === 'Абрамс')
  const adjacent = cardCatalog.find(card => card.Type === 0 && !card.Tags?.includes('в разработке'))
  match.board = [
    { id: 'abrams', card: { ...abrams, instanceId: 'abrams-board' }, owner: 0, row: 4, col: 2, health: abrams.Health, maxHealth: abrams.Health, attack: abrams.Attack, speed: abrams.Speed, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'adjacent', card: { ...adjacent, instanceId: 'adjacent-board' }, owner: 1, row: 1, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  ]
  const context = {
    loadGameCore: async () => ({ applyCommand }), current: { value: 0 }, round: { value: 2 }, players: { value: match.players }, board: { value: match.board }, movementLock: { value: null }, wheatTokens: { value: [] },
    localCoreChoice: { value: null }, choiceKind: null, localMovePending: { value: false }, pendingAbilityTargets: { value: [] }, selection: { value: null }, winner: { value: 0 }, screen: { value: 'game' }, winnerWhenPlayerFalls: () => 0,
    unitDescription: unit => unit.card.Description ?? '', abilityDescription: (description, index) => cardEffects.abilityDescriptions(description)[index], abilityDescriptions: cardEffects.abilityDescriptions, abilityCost: () => 5,
    canPayAbility: () => true, targetedAbilityOperation: cardEffects.targetedAbilityOperation, isRepeatableAbility: () => false, active: () => true, canActWhileFlipped: () => false, movementIsBlocked: () => false, abilityDrawCount: () => null,
    visual: () => {}, note: () => {}, inform: message => { context.message = message }, console: { error: error => assert.fail(String(error)) }, setTimeout,
  }
  const run = `${functions.join('\n')}\n(async()=>{await useAbility(board.value[0],0);resolveAbility('abrams',4,2,board.value[0],0);choiceKind=localCoreChoice.value.kind;resolveAbility('abrams',2,2,undefined,0);await new Promise(resolve=>setTimeout(resolve,0))})()`
  await runInNewContext(stripTypeScriptTypes(run), context)
  assert.equal(context.choiceKind, 'ability-move-self')
  assert.equal(context.localCoreChoice.value, null)
  assert.equal(context.board.value.find(unit => unit.id === 'abrams').row, 2)
  assert.equal(context.board.value.find(unit => unit.id === 'abrams').col, 2)
  assert.equal(context.board.value.find(unit => unit.id === 'adjacent').stunned, 1)
  assert.equal(context.players.value[0].mana, 5)
})

test('local front-move and put-on-deck abilities resolve through game-core choices', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const functions = ['applyLocalCommand', 'useAbility', 'resolveLocalAbilityChoice', 'resolveAbility'].map(name => source.split(/\r?\n/u).find(line => line.startsWith(name === 'useAbility' ? 'async function useAbility(' : name === 'resolveLocalAbilityChoice' ? 'async function resolveLocalAbilityChoice(' : `${name === 'resolveAbility' ? 'function' : 'async function'} ${name}(`)))
  const deck = randomLegalDeck(cardCatalog, () => 0.5)
  assert.ok(deck)
  for (const scenario of [
    { name: 'Пудж', cost: 4, sourceType: 0, sourceRow: 3, targetRow: 4, targetCol: 0, choice: 'ability-move-front', resolves: match => { const target = match.board.find(unit => unit.id === 'target'); assert.deepEqual([target.row, target.col], [2, 2]) } },
    { name: 'Закулисье', cost: 5, sourceType: 3, sourceRow: 2, targetRow: 3, targetCol: 2, choice: 'ability-put-target-on-deck', resolves: match => { assert.equal(match.board.some(unit => unit.id === 'target'), false); assert.equal(match.players[1].deck[0].instanceId, 'target-card'); assert.equal(match.players[1].discard.at(-1).instanceId, 'target-item') } },
  ]) {
    const match = createMatch({ matchId: `local-${scenario.name}`, players: [{ userId: 'one', displayName: 'One', deck }, { userId: 'two', displayName: 'Two', deck }], catalog: cardCatalog, random: () => 0.5 })
    match.round = 2
    match.players[0].mana = 20
    const ability = cardCatalog.find(card => card.Name === scenario.name)
    const creature = cardCatalog.find(card => card.Type === 0 && !card.Tags?.includes('в разработке'))
    match.board = [
      { id: 'source', card: { ...ability, instanceId: 'source-card' }, owner: 0, row: scenario.sourceRow, col: 2, health: ability.Health, maxHealth: ability.Health, attack: ability.Attack, speed: ability.Speed, summoned: 0, attacks: 0, blackTokens: 5 },
      { id: 'target', card: { ...creature, instanceId: 'target-card' }, ...(scenario.name === 'Закулисье' ? { item: { ...cardCatalog.find(card => card.Type === 1), instanceId: 'target-item' } } : {}), owner: 1, row: scenario.targetRow, col: scenario.targetCol, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    ]
    const context = {
      loadGameCore: async () => ({ applyCommand }), current: { value: 0 }, round: { value: 2 }, players: { value: match.players }, board: { value: match.board }, movementLock: { value: null }, wheatTokens: { value: [] },
      localCoreChoice: { value: null }, localMovePending: { value: false }, pendingAbilityTargets: { value: [] }, selection: { value: null }, winner: { value: 0 }, screen: { value: 'game' }, winnerWhenPlayerFalls: () => 0,
      unitDescription: unit => unit.card.Description ?? '', abilityDescription: (description, index) => cardEffects.abilityDescriptions(description)[index], abilityDescriptions: cardEffects.abilityDescriptions, abilityCost: () => scenario.cost,
      canPayAbility: () => true, targetedAbilityOperation: cardEffects.targetedAbilityOperation, isRepeatableAbility: () => false, active: () => true, canActWhileFlipped: () => false, movementIsBlocked: () => false, abilityDrawCount: () => null,
      visual: () => {}, note: () => {}, inform: () => {}, console: { error: error => assert.fail(String(error)) }, setTimeout,
    }
    await runInNewContext(stripTypeScriptTypes(`${functions.join('\n')}\n(async()=>{await useAbility(board.value[0],0);choiceKind=localCoreChoice.value?.kind??null;resolveAbility('source',0,0,board.value.find(unit=>unit.id==='target'),0);await new Promise(resolve=>setTimeout(resolve,0))})()`), context)
    assert.equal(context.choiceKind, scenario.choice)
    assert.equal(context.localCoreChoice.value, null)
    assert.equal(context.players.value[0].mana, 20 - scenario.cost)
    scenario.resolves({ board: context.board.value, players: context.players.value })
  }
})

test('local creature and building plays delegate to game core before spending locally', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const start = source.indexOf('async function play(')
  const play = source.slice(start, source.indexOf('\nfunction finishCardPayment', start))
  assert.ok(start >= 0 && play.includes('function play('))
  for (const card of [
    { Id: 'creature', instanceId: 'creature-instance', Name: 'Creature', Type: 0 },
    { Id: 'building', instanceId: 'building-instance', Name: 'Building', Type: 3 },
  ]) {
    const commands = []
    const context = {
      pendingApril: { value: null }, pendingRottenThief: { value: null }, pendingStartTurnBurns: { value: null },
      player: { value: { name: 'Local', hand: [card] } }, current: { value: 0 }, localMovePending: { value: false },
      cardCost: () => 0, canUseHealthPayment: () => false, bloodEmpireActive: () => false, spend: () => assert.fail('core should receive the card before local spending'),
      applyLocalCommand: async (...args) => { commands.push(args); return { state: { pendingChoice: undefined } } },
      board: { value: [] }, startDrop: () => {}, visual: () => {}, selection: { value: null }, note: () => {}, coord: () => 'B2',
    }
    await runInNewContext(stripTypeScriptTypes(`${play}\nplay(0,1,2)`), context)
    assert.deepEqual(JSON.parse(JSON.stringify(commands)), [['card.play', { cardInstanceId: card.instanceId, target: { row: 1, col: 2 }, payment: 'mana' }, 0]])
  }
})

test('local item equips delegate to game core before spending locally', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const start = source.indexOf('async function play(')
  const play = source.slice(start, source.indexOf('\nfunction finishCardPayment', start))
  const card = { Id: 'item', instanceId: 'item-instance', Name: 'Item', Type: 1 }
  const target = { id: 'target', card: { Name: 'Bearer', Type: 0 }, row: 2, col: 1 }
  const commands = []
  const context = {
    pendingApril: { value: null }, pendingRottenThief: { value: null }, pendingStartTurnBurns: { value: null },
    player: { value: { name: 'Local', hand: [card] } }, current: { value: 0 }, localMovePending: { value: false },
    cardCost: () => 0, canUseHealthPayment: () => false, bloodEmpireActive: () => false, spend: () => assert.fail('core should receive the item before local spending'),
    applyLocalCommand: async (...args) => { commands.push(args); return { state: { pendingChoice: undefined } } },
    visual: () => {}, selection: { value: null }, note: () => {}, coord: () => 'B2',
  }
  await runInNewContext(stripTypeScriptTypes(`${play}\nplay(0,2,1,target)`), { ...context, target })
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [['item.equip', { cardInstanceId: card.instanceId, targetUnitId: target.id, payment: 'mana' }, 0]])
})

test('local spell casts delegate selected card targets to game core before spending locally', async () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const start = source.indexOf('async function play(')
  const play = source.slice(start, source.indexOf('\nfunction finishCardPayment', start))
  const card = { Id: 'spell', instanceId: 'spell-instance', Name: 'Spell', Type: 2 }
  const target = { id: 'target', card: { Name: 'Target', Type: 0 }, row: 2, col: 1 }
  const commands = []
  const context = {
    pendingApril: { value: null }, pendingRottenThief: { value: null }, pendingStartTurnBurns: { value: null },
    player: { value: { name: 'Local', hand: [card] } }, current: { value: 0 }, players: { value: [{}, {}] }, localMovePending: { value: false },
    cardCost: () => 0, canUseHealthPayment: () => false, bloodEmpireActive: () => false, spellAreaDamage: () => null, spellLineBuff: () => null,
    spend: () => assert.fail('core should receive the spell before local spending'),
    applyLocalCommand: async (...args) => { commands.push(args); return { state: { pendingChoice: undefined } } },
    visual: () => {}, selection: { value: null }, note: () => {}, coord: () => 'B2',
  }
  await runInNewContext(stripTypeScriptTypes(`${play}\nplay(0,2,1,target)`), { ...context, target })
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [['spell.cast', { cardInstanceId: card.instanceId, payment: 'mana', target: { unitId: target.id } }, 0]])
})

test('handoff after a core turn end shows the already-resolved turn without replaying local effects', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const startTurn = source.split(/\r?\n/u).find(line => line.startsWith('function startTurn('))
  const player = { hand: [{}, {}, {}], limit: 7, name: 'Next' }
  const context = {
    localTurnStartResolved: { value: true }, localTurnHandSize: { value: 2 }, player: { value: player },
    newHandCards: { value: [] }, handDrawStart: { value: 0 }, overLimit: { value: 0 }, chosenDiscard: { value: [1] },
    pendingStartTurnBurns: { value: 2 }, screen: { value: 'handoff' }, note: () => {},
  }
  runInNewContext(stripTypeScriptTypes(`${startTurn}\nstartTurn()`), context)
  assert.equal(context.localTurnStartResolved.value, false)
  assert.deepEqual(Array.from(context.newHandCards.value), [2])
  assert.equal(context.handDrawStart.value, 2)
  assert.equal(context.overLimit.value, 0)
  assert.deepEqual(Array.from(context.chosenDiscard.value), [])
  assert.equal(context.pendingStartTurnBurns.value, 2)
  assert.equal(context.screen.value, 'game')
})

test('the first local handoff keeps createMatch opening resources instead of granting them twice', () => {
  const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
  const startTurn = source.split(/\r?\n/u).find(line => line.startsWith('function startTurn('))
  const player = { hand: [{}, {}, {}, {}], limit: 4, mana: 1, energy: 1 }
  const context = {
    initialLocalTurnPending: { value: true }, player: { value: player }, newHandCards: { value: [9] },
    handDrawStart: { value: 0 }, overLimit: { value: 0 }, chosenDiscard: { value: [1] }, screen: { value: 'handoff' },
    resolveStartTurnStages: () => assert.fail('createMatch has already prepared the opening hand and resources'),
  }
  runInNewContext(stripTypeScriptTypes(`${startTurn}\nstartTurn()`), context)
  assert.equal(player.mana, 1)
  assert.equal(player.energy, 1)
  assert.deepEqual(Array.from(context.newHandCards.value), [])
  assert.equal(context.handDrawStart.value, 4)
  assert.equal(context.overLimit.value, 0)
  assert.deepEqual(Array.from(context.chosenDiscard.value), [])
  assert.equal(context.initialLocalTurnPending.value, false)
  assert.equal(context.screen.value, 'game')
})

