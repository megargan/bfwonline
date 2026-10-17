import test from 'node:test'
import assert from 'node:assert/strict'
import { cardCatalog } from '@bfw/game-data'
import { createMatch, projectForPlayer } from '@bfw/game-core'
import { randomLegalDeck } from '@bfw/game-core/deck'
import { applyMatchCommand, MatchCommandError, readMatchSnapshot } from '../src/match-commands.ts'

const matchId = '9fdcc87e-11d2-4c72-9cdf-819e3d9c5c8a'
const commandId = '915c3b5b-e899-4bd7-a812-2306142ec0f8'
const users = ['owner', 'guest']
const deck = randomLegalDeck(cardCatalog, () => 0.42)

function setup({ failCommit = false } = {}) {
  let state = createMatch({ matchId, catalog: cardCatalog, players: users.map((userId, index) => ({ userId, displayName: userId, deck })), random: () => 0.25 })
  let status = 'active'
  const receipts = new Map()
  let updates = 0
  const pool = {
    async connect() {
      let stagedState = state
      let stagedStatus = status
      const stagedReceipts = new Map()
      return {
        async query(sql, values = []) {
          if (sql === 'BEGIN') return { rows: [] }
          if (sql.includes('FROM match_players mp JOIN users u')) return { rows: users.map((user_id, seat) => ({ seat, user_id, avatar_version: 0, has_avatar: false })) }
          if (sql.includes('SELECT status,version,state_json')) return { rows: [{ status, version: state.version, state_json: state }] }
          if (sql.includes('SELECT user_id,seat')) return { rows: users.map((user_id, seat) => ({ user_id, seat })) }
          if (sql.includes('SELECT actor_user_id,request_hash,applied_version')) return { rows: receipts.has(values[1]) ? [receipts.get(values[1])] : [] }
          if (sql.startsWith('UPDATE matches')) {
            stagedStatus = values[1]; stagedState = JSON.parse(values[3]); updates++
            return { rows: [] }
          }
          if (sql.startsWith('INSERT INTO match_commands')) {
            stagedReceipts.set(values[1], { actor_user_id: values[2], request_hash: values[3], applied_version: values[4] })
            return { rows: [] }
          }
          if (sql === 'COMMIT') {
            if (failCommit) throw new Error('commit failed')
            state = stagedState; status = stagedStatus
            for (const [id, receipt] of stagedReceipts) receipts.set(id, receipt)
            return { rows: [] }
          }
          if (sql === 'ROLLBACK') return { rows: [] }
          throw new Error(`unexpected SQL: ${sql}`)
        },
        release() {},
      }
    },
  }
  return { pool, get state() { return state }, get status() { return status }, receipts, get updates() { return updates } }
}

const command = (actor, changes = {}) => ({
  matchId, commandId, expectedVersion: 0, action: 'match.concede', data: {}, actorUserId: actor, ...changes,
})

test('accepted command atomically finishes once; same command ID returns its receipt', async () => {
  const fixture = setup()
  const request = command('owner')
  const accepted = await applyMatchCommand(fixture.pool, request.actorUserId, request)
  assert.equal(accepted.kind, 'applied')
  assert.equal(accepted.appliedVersion, 1)
  assert.equal(fixture.status, 'finished')
  assert.equal(fixture.state.winnerUserId, 'guest')
  const duplicate = await applyMatchCommand(fixture.pool, request.actorUserId, request)
  assert.equal(duplicate.kind, 'duplicate')
  assert.equal(duplicate.appliedVersion, 1)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
  await assert.rejects(applyMatchCommand(fixture.pool, 'owner', command('owner', { expectedVersion: 1 })), error => error.code === 'COMMAND_ID_CONFLICT')
})

test('pause rejects new commands but does not block a committed duplicate receipt', async () => {
  const fixture = setup()
  const request = command('owner')
  await assert.rejects(applyMatchCommand(fixture.pool, 'owner', request, () => false), error => error.code === 'MATCH_PAUSED')
  assert.equal(fixture.state.version, 0)
  assert.equal(fixture.receipts.size, 0)

  const accepted = await applyMatchCommand(fixture.pool, 'owner', request)
  const duplicate = await applyMatchCommand(fixture.pool, 'owner', request, () => false)
  assert.equal(accepted.kind, 'applied')
  assert.equal(duplicate.kind, 'duplicate')
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('snapshot reads require match membership', async () => {
  const state = createMatch({ matchId, catalog: cardCatalog, players: users.map(userId => ({ userId, displayName: userId, deck })), random: () => 0.25 })
  const pool = { async query(sql, values) {
    if (sql.includes('FROM match_players mp JOIN users u')) return { rows: users.map((user_id, seat) => ({ seat, user_id, avatar_version: 0, has_avatar: false })) }
    return values[1] === 'owner' ? { rows: [{ state_json: state, seat: 0 }] } : { rows: [] }
  } }
  const snapshot = await readMatchSnapshot(pool, 'owner', matchId)
  assert.equal(snapshot.mySeat, 0)
  await assert.rejects(readMatchSnapshot(pool, 'spectator', matchId), error => error.code === 'MATCH_NOT_FOUND')
})

test('rejects command ID reuse by another actor and stale commands without a write', async () => {
  const fixture = setup()
  await applyMatchCommand(fixture.pool, 'owner', command('owner'))
  await assert.rejects(applyMatchCommand(fixture.pool, 'guest', command('guest')), error => error.code === 'COMMAND_ID_CONFLICT')
  const fresh = setup()
  const stale = await applyMatchCommand(fresh.pool, 'owner', command('owner', { expectedVersion: 7, commandId: 'b156cae2-6804-4bb7-8db5-82a52e3f7ca7' }))
  assert.equal(stale.code, 'STALE_STATE_VERSION')
  assert.equal(fresh.state.version, 0)
  assert.equal(fresh.updates, 0)
})

test('does not report success or persist a command after commit failure', async () => {
  const fixture = setup({ failCommit: true })
  await assert.rejects(applyMatchCommand(fixture.pool, 'owner', command('owner')), /commit failed/)
  assert.equal(fixture.state.version, 0)
  assert.equal(fixture.status, 'active')
  assert.equal(fixture.receipts.size, 0)
})

test('Кирка ФСШ removes an ally item and commits the stat reversal exactly once', async () => {
  const fixture = setup()
  const attackerCard = { ...cardCatalog.find(item => item.Name === 'ДастАроникс'), instanceId: 'pick-attacker' }
  const pick = { ...cardCatalog.find(item => item.Name === 'Кирка ФСШ'), instanceId: 'pick-item' }
  const allyCard = { ...cardCatalog[1], Name: 'Ally', Type: 0, Description: '', instanceId: 'pick-ally' }
  const allyItem = { ...cardCatalog.find(item => item.Type === 1), Name: 'Plain Item', Description: '', Attack: 1, Health: 2, instanceId: 'pick-ally-item' }
  fixture.state.board.push(
    { id: 'pick-attacker', card: attackerCard, item: pick, owner: 0, row: 4, col: 2, health: 1, maxHealth: 1, attack: attackerCard.Attack + pick.Attack, speed: attackerCard.Speed, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'pick-ally', card: allyCard, item: allyItem, owner: 0, row: 4, col: 3, health: 6, maxHealth: 6, attack: 2, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const attack = command('owner', { action: 'unit.attack', data: { unitId: 'pick-attacker', targetUnitId: 'pick-ally' } })

  const accepted = await applyMatchCommand(fixture.pool, 'owner', attack)
  const duplicate = await applyMatchCommand(fixture.pool, 'owner', attack)

  assert.equal(accepted.kind, 'applied')
  assert.equal(duplicate.kind, 'duplicate')
  const ally = fixture.state.board.find(unit => unit.id === 'pick-ally')
  assert.equal(ally.item, undefined)
  assert.equal(ally.health, 4)
  assert.equal(ally.maxHealth, 4)
  assert.equal(ally.attack, 1)
  assert.equal(fixture.state.players[0].discard.filter(item => item.instanceId === allyItem.instanceId).length, 1)
  assert.equal(fixture.updates, 1)
})

test('Собирающий жук transfers the chosen item exactly once across a retried choice command', async () => {
  const fixture = setup()
  const beetle = { ...cardCatalog.find(item => item.Name === 'Собирающий жук'), instanceId: 'beetle-instance' }
  const donorCard = { ...cardCatalog[0], Name: 'Donor', Type: 0, Attack: 2, Health: 5, Description: '', instanceId: 'donor-instance' }
  const item = { ...cardCatalog.find(card => card.Type === 1), Name: 'Plain item', Type: 1, Attack: 2, Health: 3, Description: '', instanceId: 'beetle-item' }
  fixture.state.players[0].hand = [beetle]
  fixture.state.players[0].mana = 10
  fixture.state.board.push({ id: 'donor', card: donorCard, item, owner: 1, row: 2, col: 2, health: 6, maxHealth: 8, attack: 4, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })
  const play = command('owner', { action: 'card.play', data: { cardInstanceId: beetle.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  await applyMatchCommand(fixture.pool, 'owner', play)
  const choice = fixture.state.pendingChoice
  const resolve = command('owner', { commandId: 'beetle-choice-command', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: 'donor' } } })
  const accepted = await applyMatchCommand(fixture.pool, 'owner', resolve)
  const duplicate = await applyMatchCommand(fixture.pool, 'owner', resolve)
  assert.equal(accepted.kind, 'applied')
  assert.equal(duplicate.kind, 'duplicate')
  const thief = fixture.state.board.find(unit => unit.card.Name === 'Собирающий жук')
  const donor = fixture.state.board.find(unit => unit.id === 'donor')
  assert.equal(thief.item.instanceId, item.instanceId)
  assert.equal(thief.attack, beetle.Attack + item.Attack)
  assert.equal(donor.item, undefined)
  assert.equal(donor.attack, 2)
  assert.equal(donor.maxHealth, 5)
  assert.equal(donor.health, 5)
  assert.equal(fixture.state.players[1].discard.filter(card => card.instanceId === item.instanceId).length, 0)
  assert.equal(fixture.state.version, 2)
})

test('Собирающий жук trap transfers the item and buffs once across a retried attack command', async () => {
  const fixture = setup()
  const beetleCard = { ...cardCatalog.find(item => item.Name === 'Собирающий жук'), instanceId: 'trap-beetle-card' }
  const item = { ...cardCatalog.find(card => card.Type === 1), Name: 'Plain item', Type: 1, Attack: 1, Health: 1, Description: '', instanceId: 'trap-beetle-item' }
  const attackerCard = { ...cardCatalog[0], Name: 'Attacker', Type: 0, Attack: 1, Health: 10, Description: '', instanceId: 'trap-attacker-card' }
  fixture.state.board.push(
    { id: 'trap-attacker', card: attackerCard, owner: 0, row: 4, col: 2, health: 10, maxHealth: 10, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'trap-beetle', card: beetleCard, item, owner: 1, row: 3, col: 2, health: 3, maxHealth: 3, attack: 3, speed: beetleCard.Speed, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const attack = command('owner', { action: 'unit.attack', data: { unitId: 'trap-attacker', targetUnitId: 'trap-beetle' } })
  const accepted = await applyMatchCommand(fixture.pool, 'owner', attack)
  const duplicate = await applyMatchCommand(fixture.pool, 'owner', attack)
  assert.equal(accepted.kind, 'applied')
  assert.equal(duplicate.kind, 'duplicate')
  const attacker = fixture.state.board.find(unit => unit.id === 'trap-attacker')
  const beetle = fixture.state.board.find(unit => unit.id === 'trap-beetle')
  assert.equal(attacker.item.instanceId, item.instanceId)
  assert.equal(attacker.attack, 2)
  assert.equal(beetle.item, undefined)
  assert.equal(beetle.attack, 5)
  assert.equal(beetle.maxHealth, 2)
  assert.equal(fixture.state.version, 1)
})

test('Hameleonew burn-save state commits once and remains private to its owner', async () => {
  const fixture = setup()
  const card = { ...cardCatalog.find(item => item.Name === 'Hameleonew'), instanceId: 'hameleonew-instance' }
  fixture.state.players[0].hand = [card]
  fixture.state.players[0].mana = 10
  const request = command('owner', { action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  const accepted = await applyMatchCommand(fixture.pool, 'owner', request)
  const duplicate = await applyMatchCommand(fixture.pool, 'owner', request)
  assert.equal(accepted.kind, 'applied')
  assert.equal(duplicate.kind, 'duplicate')
  assert.equal(fixture.state.players[0].nextBurnToSave, 1)
  assert.equal(projectForPlayer(fixture.state, 0).private.nextBurnToSave, 1)
  assert.equal(projectForPlayer(fixture.state, 1).private.nextBurnToSave, 0)
  assert.equal(fixture.updates, 1)
})

test('Бёрдли gamba bonus commits once and remains private to its owner', async () => {
  const fixture = setup()
  const card = { ...cardCatalog.find(item => item.Name === 'Бёрдли'), instanceId: 'birdli-instance' }
  fixture.state.players[0].hand = [card]
  fixture.state.players[0].mana = 10
  const request = command('owner', { action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  const accepted = await applyMatchCommand(fixture.pool, 'owner', request)
  const duplicate = await applyMatchCommand(fixture.pool, 'owner', request)
  assert.equal(accepted.kind, 'applied')
  assert.equal(duplicate.kind, 'duplicate')
  assert.equal(fixture.state.players[0].nextGambaBonus, 2)
  assert.equal(projectForPlayer(fixture.state, 0).private.nextGambaBonus, 2)
  assert.equal(projectForPlayer(fixture.state, 1).private.nextGambaBonus, 0)
  assert.equal(fixture.updates, 1)
})

test('Вондертян draw and temporary hand-limit override persist once across a duplicate play', async () => {
  const fixture = setup()
  const card = { ...cardCatalog.find(item => item.Name === 'Вондертян'), instanceId: 'wondertian-instance' }
  fixture.state.players[0].hand = [card]
  fixture.state.players[0].mana = 10
  fixture.state.players[0].limit = 6
  fixture.state.players[0].temporaryLimitExpirations = [1, 5]
  const deckCount = fixture.state.players[0].deck.length
  const request = command('owner', { action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  const accepted = await applyMatchCommand(fixture.pool, 'owner', request)
  const duplicate = await applyMatchCommand(fixture.pool, 'owner', request)
  assert.equal(accepted.kind, 'applied')
  assert.equal(duplicate.kind, 'duplicate')
  assert.equal(fixture.state.players[0].hand.length, 8)
  assert.equal(fixture.state.players[0].deck.length, deckCount - 8)
  assert.equal(fixture.state.players[0].limit, 8)
  assert.deepEqual(fixture.state.players[0].temporaryLimitOverride, { previous: 4, value: 8, expiresAt: 2 })
  assert.deepEqual(fixture.state.players[0].temporaryLimitExpirations, [1, 5])
  assert.equal(fixture.updates, 1)
})

test('Degras crown flip and flip-trigger rewards commit once despite a lethal defender trap', async () => {
  const fixture = setup()
  const card = { ...cardCatalog.find(item => item.Name === '.Хихо'), instanceId: 'flip-trigger-card' }
  const degra = { ...cardCatalog.find(item => item.Name === 'Дегра'), instanceId: 'degra-item' }
  const trap = { ...cardCatalog[0], Name: 'Мина', Description: 'Ловушка: Наносит 5 урона.', instanceId: 'degra-trap' }
  const handBefore = fixture.state.players[0].hand.length
  const manaBefore = fixture.state.players[0].mana
  fixture.state.board.push(
    { id: 'flip-trigger', card, item: degra, owner: 0, row: 4, col: 2, health: 2, maxHealth: 2, attack: 2, speed: 3, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'degra-trap', card: trap, owner: 1, row: 3, col: 2, health: 5, maxHealth: 5, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const attack = command('owner', { action: 'unit.attack', data: { unitId: 'flip-trigger', targetUnitId: 'degra-trap' } })

  const accepted = await applyMatchCommand(fixture.pool, 'owner', attack)
  const duplicate = await applyMatchCommand(fixture.pool, 'owner', attack)

  assert.equal(accepted.kind, 'applied')
  assert.equal(duplicate.kind, 'duplicate')
  assert.equal(fixture.state.board.find(unit => unit.id === 'flip-trigger').flippedTurns, 2)
  assert.equal(fixture.state.players[0].hand.length, handBefore + 1)
  assert.equal(fixture.state.players[0].mana, manaBefore + 1)
  assert.equal(fixture.updates, 1)
})

test('Bazooka area crown commits its adjacent death chain exactly once', async () => {
  const fixture = setup()
  const attackerCard = { ...cardCatalog[0], instanceId: 'bazooka-bearer' }
  const bazooka = { ...cardCatalog.find(card => card.Name === 'Базука'), instanceId: 'bazooka-item' }
  const targetCard = { ...cardCatalog.find(card => card.Type === 3), Name: 'Target Building', Description: '', instanceId: 'bazooka-building' }
  const neighborCard = { ...cardCatalog.find(card => card.Name === 'ДастАроникс'), instanceId: 'bazooka-neighbor' }
  const handBefore = fixture.state.players[1].hand.length
  fixture.state.board.push(
    { id: 'bazooka-bearer', card: attackerCard, item: bazooka, owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'bazooka-target', card: targetCard, owner: 1, row: 3, col: 2, health: 20, maxHealth: 20, attack: 0, speed: 0 },
    { id: 'bazooka-neighbor', card: neighborCard, owner: 1, row: 4, col: 3, health: 1, maxHealth: 1, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const attack = command('owner', { action: 'unit.attack', data: { unitId: 'bazooka-bearer', targetUnitId: 'bazooka-target' } })

  const accepted = await applyMatchCommand(fixture.pool, 'owner', attack)
  assert.equal(accepted.kind, 'applied')
  const duplicate = await applyMatchCommand(fixture.pool, 'owner', attack)

  assert.equal(duplicate.kind, 'duplicate')
  assert.equal(fixture.state.board.some(unit => unit.id === 'bazooka-neighbor'), false)
  assert.equal(fixture.state.players[1].discard.some(card => card.instanceId === neighborCard.instanceId), true)
  assert.equal(fixture.state.players[1].hand.length, handBefore + 1)
  assert.equal(fixture.updates, 1)
})

test('Magician Red crown damage and resulting death effects commit exactly once', async () => {
  const fixture = setup()
  const attackerCard = { ...cardCatalog[0], instanceId: 'magician-bearer' }
  const item = { ...cardCatalog.find(card => card.Name === 'Magician Red'), instanceId: 'magician-red' }
  const targetCard = { ...cardCatalog.find(card => card.Name === 'ДастАроникс'), instanceId: 'magician-target' }
  const handBefore = fixture.state.players[1].hand.length
  fixture.state.board.push(
    { id: 'magician-bearer', card: attackerCard, item, owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'magician-target', card: targetCard, owner: 1, row: 3, col: 2, health: 1, maxHealth: 1, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const attack = command('owner', { action: 'unit.attack', data: { unitId: 'magician-bearer', targetUnitId: 'magician-target' } })

  const accepted = await applyMatchCommand(fixture.pool, 'owner', attack)
  assert.equal(accepted.kind, 'applied')
  const duplicate = await applyMatchCommand(fixture.pool, 'owner', attack)

  assert.equal(duplicate.kind, 'duplicate')
  assert.equal(fixture.state.board.some(unit => unit.id === 'magician-target'), false)
  assert.equal(fixture.state.players[1].discard.some(card => card.instanceId === targetCard.instanceId), true)
  assert.equal(fixture.state.players[1].hand.length, handBefore + 1)
  assert.equal(fixture.updates, 1)
})

test('Рокочущий рыцарь commits its damaged-target crown and burn exactly once', async () => {
  const fixture = setup()
  const attackerCard = { ...cardCatalog.find(item => item.Name === 'Рокочущий рыцарь'), instanceId: 'rocking-knight' }
  const targetCard = { ...cardCatalog.find(item => item.Name === 'ДастАроникс'), instanceId: 'damaged-dast' }
  fixture.state.board.push(
    { id: 'rocking-knight', card: attackerCard, owner: 0, row: 4, col: 2, health: attackerCard.Health, maxHealth: attackerCard.Health, attack: attackerCard.Attack, speed: attackerCard.Speed, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'damaged-dast', card: targetCard, owner: 1, row: 3, col: 2, health: 6, maxHealth: 8, attack: targetCard.Attack, speed: targetCard.Speed, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const attack = command('owner', { action: 'unit.attack', data: { unitId: 'rocking-knight', targetUnitId: 'damaged-dast' } })

  const accepted = await applyMatchCommand(fixture.pool, 'owner', attack)
  assert.equal(accepted.kind, 'applied')
  const duplicate = await applyMatchCommand(fixture.pool, 'owner', attack)

  assert.equal(duplicate.kind, 'duplicate')
  assert.equal(fixture.state.board.some(unit => unit.id === 'damaged-dast'), false)
  assert.equal(fixture.state.players[1].burned.filter(item => item.instanceId === targetCard.instanceId).length, 1)
  assert.equal(fixture.state.players[1].discard.some(item => item.instanceId === targetCard.instanceId), false)
  assert.equal(fixture.updates, 1)
})

test('Вкидгранник return-to-hand crown commits once and hides the returned card from its opponent', async () => {
  const fixture = setup()
  const card = { ...cardCatalog.find(item => item.Name === 'Вкидгранник'), instanceId: 'vklad-instance' }
  const equipped = { ...cardCatalog.find(item => item.Type === 1), instanceId: 'vklad-equipped-item' }
  fixture.state.board.push(
    { id: 'vklad-board', card, item: equipped, owner: 0, row: 4, col: 2, health: card.Health, maxHealth: card.Health, attack: card.Attack, speed: card.Speed, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'vklad-target', card: { ...cardCatalog[0], Name: 'Target' }, owner: 1, row: 3, col: 2, health: 10, maxHealth: 10, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const attack = command('owner', { action: 'unit.attack', data: { unitId: 'vklad-board', targetUnitId: 'vklad-target' } })

  const accepted = await applyMatchCommand(fixture.pool, 'owner', attack)
  const duplicate = await applyMatchCommand(fixture.pool, 'owner', attack)

  assert.equal(accepted.kind, 'applied')
  assert.equal(duplicate.kind, 'duplicate')
  assert.equal(fixture.state.players[0].hand.filter(item => item.instanceId === card.instanceId).length, 1)
  assert.equal(fixture.state.players[0].discard.some(discarded => discarded.instanceId === equipped.instanceId), true)
  assert.equal(fixture.state.board.some(unit => unit.id === 'vklad-board'), false)
  assert.equal(JSON.stringify(accepted.snapshots.find(entry => entry.userId === 'guest')?.snapshot).includes(card.instanceId), false)
  assert.equal(fixture.updates, 1)
})

test('turn ending commits the new active seat once and deduplicates a retry', async () => {
  const fixture = setup()
  const request = command('owner', { action: 'turn.end', data: { option: 'no_penalty' } })
  const accepted = await applyMatchCommand(fixture.pool, 'owner', request)
  assert.equal(accepted.kind, 'applied')
  assert.equal(accepted.appliedVersion, 1)
  assert.equal(fixture.state.current, 1)
  assert.equal(fixture.state.players[1].mana, 1)

  const retried = await applyMatchCommand(fixture.pool, 'owner', request)
  assert.equal(retried.kind, 'duplicate')
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.state.current, 1)
  assert.equal(fixture.updates, 1)
})

test('mandatory hand-limit choice and discard persist once across retries and stay private', async () => {
  const fixture = setup()
  const player = fixture.state.players[1]
  player.hand.push(...player.deck.splice(0, 2))
  const originalHand = [...player.hand]
  const originalDeckLength = player.deck.length
  const end = command('owner', { action: 'turn.end', data: { option: 'no_penalty' } })
  const ended = await applyMatchCommand(fixture.pool, 'owner', end)
  assert.equal(ended.kind, 'applied')
  const choice = fixture.state.pendingChoice
  assert.equal(choice.kind, 'hand-limit-discard')
  assert.equal(choice.count, 2)
  assert.equal(ended.snapshots.find(entry => entry.userId === 'owner').snapshot.private.pendingChoice, null)
  assert.deepEqual(ended.snapshots.find(entry => entry.userId === 'guest').snapshot.private.pendingChoice.options.map(option => option.unitId), originalHand.map(card => card.instanceId))
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', end)).kind, 'duplicate')
  assert.equal(fixture.state.pendingChoice.id, choice.id)
  assert.equal(fixture.updates, 1)
  const resolve = command('guest', { commandId: 'c256cae2-6804-4bb7-8db5-82a52e3f7ca8', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: originalHand.slice(0, 2).map(card => card.instanceId) } } })
  await assert.rejects(applyMatchCommand(fixture.pool, 'owner', resolve), { code: 'NOT_CHOICE_OWNER' })
  await assert.rejects(applyMatchCommand(fixture.pool, 'guest', { ...resolve, data: { ...resolve.data, selection: { unitIds: [] } } }), { code: 'INVALID_CHOICE' })
  await assert.rejects(applyMatchCommand(fixture.pool, 'guest', { ...resolve, action: 'turn.end', data: { option: 'no_penalty' } }), { code: 'CHOICE_PENDING' })
  assert.equal(fixture.updates, 1)
  const resolved = await applyMatchCommand(fixture.pool, 'guest', resolve)
  assert.equal(resolved.kind, 'applied')
  assert.equal(resolved.appliedVersion, 2)
  assert.equal(fixture.state.players[1].hand.length, 4)
  assert.equal(fixture.state.players[1].deck.length, originalDeckLength)
  assert.deepEqual(fixture.state.players[1].discard.map(card => card.instanceId), originalHand.slice(0, 2).reverse().map(card => card.instanceId))
  assert.equal(fixture.state.pendingChoice, null)
  assert.deepEqual(resolved.events, [{ type: 'choice.resolved', choiceId: choice.id, kind: 'hand-limit-discard', count: 2 }])
  const duplicate = await applyMatchCommand(fixture.pool, 'guest', resolve)
  assert.equal(duplicate.kind, 'duplicate')
  assert.equal(duplicate.snapshots[0].snapshot.private.pendingChoice, null)
  assert.equal(fixture.state.players[1].discard.length, 2)
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('Dedrubi private weakest-creature choice and its burn commit exactly once', async () => {
  const fixture = setup()
  const card = cardCatalog.find(card => card.Name === 'Дедруби')
  fixture.state.board.push(
    { id: 'dedrubi', card, owner: 1, row: 0, col: 2, health: card.Health, maxHealth: card.Health, attack: card.Attack, speed: card.Speed, blackTokens: 0 },
    { id: 'weak-own', card: { Id: 'weak-own-card', Name: 'Own', Type: 0 }, owner: 1, row: 1, col: 2, health: 1, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0 },
    { id: 'weak-enemy', card: { Id: 'weak-enemy-card', Name: 'Secret flipped enemy', Type: 0 }, owner: 0, row: 3, col: 2, health: 1, maxHealth: 2, attack: 1, speed: 1, flippedTurns: 3, blackTokens: 0 },
  )
  const end = command('owner', { action: 'turn.end', data: { option: 'no_penalty' } })
  const ended = await applyMatchCommand(fixture.pool, 'owner', end)
  assert.equal(ended.kind, 'applied')
  const choice = fixture.state.pendingChoice
  assert.equal(choice.kind, 'start-turn-weakest-burn')
  assert.equal(ended.snapshots.find(entry => entry.userId === 'owner').snapshot.private.pendingChoice, null)
  const ownChoice = ended.snapshots.find(entry => entry.userId === 'guest').snapshot.private.pendingChoice
  assert.deepEqual(ownChoice.options.map(option => option.unitId), ['weak-own', 'weak-enemy'])
  assert.ok(!JSON.stringify(ownChoice).includes('Secret flipped enemy'))
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', end)).kind, 'duplicate')
  const resolve = command('guest', { commandId: 'c256cae2-6804-4bb7-8db5-82a52e3f7ca8', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: 'weak-enemy' } } })
  await assert.rejects(applyMatchCommand(fixture.pool, 'owner', resolve), { code: 'NOT_CHOICE_OWNER' })
  await assert.rejects(applyMatchCommand(fixture.pool, 'guest', { ...resolve, data: { ...resolve.data, selection: { unitId: 'dedrubi' } } }), { code: 'INVALID_CHOICE' })
  const resolved = await applyMatchCommand(fixture.pool, 'guest', resolve)
  assert.equal(resolved.kind, 'applied')
  assert.equal(resolved.appliedVersion, 2)
  assert.equal(fixture.state.players[0].burned[0].Id, 'weak-enemy-card')
  assert.equal(fixture.state.players[1].mana, 1)
  assert.equal(fixture.state.pendingChoice, null)
  assert.equal(fixture.state.pendingTurnStart, null)
  assert.ok(!JSON.stringify(resolved.events).includes('Secret flipped enemy'))
  assert.equal((await applyMatchCommand(fixture.pool, 'guest', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].burned.length, 1)
  assert.equal(fixture.updates, 2)
})

test('Ascetic and Green turn-start gambas persist their outcomes and never reroll on retry', async () => {
  const originalRandom = Math.random
  try {
    for (const [name, random] of [['Аскетик', 0], ['Аскетик', 0.5], ['Зелёная', 0], ['Зелёная', 1 / 6]]) {
      const fixture = setup()
      const card = cardCatalog.find(card => card.Name === name)
      fixture.state.players[1].health = 40
      fixture.state.board.push({ id: 'gamba-start', card, owner: 1, row: 0, col: 2, health: card.Health, maxHealth: card.Health, attack: card.Attack, speed: card.Speed, blackTokens: 0 })
      let rolls = 0
      Math.random = () => { rolls++; return random }
      const end = command('owner', { action: 'turn.end', data: { option: 'no_penalty' } })
      const ended = await applyMatchCommand(fixture.pool, 'owner', end)
      assert.equal(ended.kind, 'applied')
      assert.equal(ended.appliedVersion, 1)
      assert.ok(ended.events.some(event => event.type === 'start-turn.gamba.resolved' && event.roll === Math.floor(random * 6) + 1))
      if (name === 'Аскетик') assert.equal(fixture.state.board.length, random ? 1 : 0)
      else assert.deepEqual(fixture.state.players.map(player => player.health), random ? [44, 40] : [45, 41])
      const before = structuredClone(fixture.state)
      assert.equal((await applyMatchCommand(fixture.pool, 'owner', end)).kind, 'duplicate')
      assert.deepEqual(fixture.state, before)
      assert.equal(rolls, 1)
      assert.equal(fixture.updates, 1)
    }
  } finally { Math.random = originalRandom }
})

test('resuming Dedrubi choice persists a later gamba exactly once', async () => {
  const fixture = setup()
  for (const [name, id, row] of [['Дедруби', 'dedrubi', 0], ['Зелёная', 'green', 1]]) {
    const card = cardCatalog.find(card => card.Name === name)
    fixture.state.board.push({ id, card, owner: 1, row, col: 2, health: card.Health, maxHealth: card.Health, attack: card.Attack, speed: card.Speed, blackTokens: 0 })
  }
  for (const col of [1, 3]) fixture.state.board.push({ id: `weak-${col}`, card: { Id: `weak-card-${col}`, Name: 'Weak', Type: 0 }, owner: 0, row: 3, col, health: 1, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0 })
  const originalRandom = Math.random
  let rolls = 0
  Math.random = () => { rolls++; return 0 }
  try {
    const end = command('owner', { action: 'turn.end', data: { option: 'no_penalty' } })
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', end)).kind, 'applied')
    assert.equal(rolls, 0)
    const resolve = command('guest', { commandId: 'c256cae2-6804-4bb7-8db5-82a52e3f7ca8', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { unitId: 'weak-1' } } })
    const resolved = await applyMatchCommand(fixture.pool, 'guest', resolve)
    assert.equal(resolved.kind, 'applied')
    assert.equal(resolved.appliedVersion, 2)
    assert.ok(resolved.events.some(event => event.type === 'start-turn.gamba.resolved'))
    assert.equal((await applyMatchCommand(fixture.pool, 'guest', resolve)).kind, 'duplicate')
    assert.equal(rolls, 1)
    assert.equal(fixture.state.players[0].burned.length, 1)
    assert.equal(fixture.updates, 2)
  } finally { Math.random = originalRandom }
})

test('catalog draw, discard retrieval, and self-save deaths apply once across spell command retries', async () => {
  for (const name of ['ДастАроникс', 'Ноэль', 'Горыныч', 'Диохазавр']) {
    const fixture = setup()
    const card = cardCatalog.find(card => card.Name === name)
    const spell = { ...cardCatalog.find(card => card.Name === 'Бан'), instanceId: 'ban-spell' }
    const oldSpell = { ...spell, instanceId: 'old-spell' }
    const oldCreature = { ...card, Type: 0, instanceId: 'old-creature' }
    fixture.state.players[0].hand = [spell]
    fixture.state.players[0].mana = 10
    fixture.state.players[1].discard = [oldCreature, oldSpell]
    fixture.state.board.push({ id: 'victim', card: { ...card, instanceId: 'victim-card' }, owner: 1, row: 3, col: 2, health: card.Health, maxHealth: card.Health, attack: card.Attack, speed: card.Speed, blackTokens: 0 })
    if (name === 'ДастАроникс') {
      const meat = cardCatalog.find(card => card.Name === 'Маринует мясо')
      fixture.state.board.push({ id: 'repeat-death', card: meat, owner: 1, row: 0, col: 2, health: meat.Health, maxHealth: meat.Health, attack: meat.Attack, speed: meat.Speed, blackTokens: 0 })
    }
    const initialHandLength = fixture.state.players[1].hand.length
    const cast = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: 'victim' } } })
    const result = await applyMatchCommand(fixture.pool, 'owner', cast)
    assert.equal(result.kind, 'applied')
    assert.equal(result.appliedVersion, 1)
    const owner = fixture.state.players[1]
    assert.equal(owner.hand.length, initialHandLength + (name === 'Диохазавр' ? 0 : name === 'Горыныч' ? 1 : 2))
    if (name === 'Горыныч') assert.equal(owner.hand.at(-1).instanceId, oldSpell.instanceId)
    if (name === 'Ноэль') assert.deepEqual(owner.hand.slice(-2).map(card => card.instanceId), ['old-spell', 'old-creature'])
    if (name === 'Диохазавр') assert.deepEqual(owner.saved.map(card => card.instanceId), ['victim-card'])
    else assert.deepEqual(owner.burned.map(card => card.instanceId), ['victim-card'])
    const before = structuredClone(fixture.state)
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', cast)).kind, 'duplicate')
    assert.deepEqual(fixture.state, before)
    assert.equal(fixture.updates, 1)
    assert.ok(!result.events.some(event => JSON.stringify(event).includes('old-spell') || JSON.stringify(event).includes('old-creature')))
    assert.equal('hand' in result.snapshots.find(entry => entry.userId === 'owner').snapshot.public.players[1], false)
  }
})

test('catalog DastAronix and Gorynych entry draws commit once and remain private', async () => {
  for (const name of ['ДастАроникс', 'Горыныч']) {
    const fixture = setup()
    const card = { ...cardCatalog.find(card => card.Name === name), instanceId: 'entry-card' }
    const spell = { ...cardCatalog.find(card => card.Name === 'Бан'), instanceId: 'deck-spell' }
    const creature = { ...card, instanceId: 'deck-creature' }
    fixture.state.players[0].hand = [card]
    fixture.state.players[0].mana = 10
    fixture.state.players[0].deck.unshift(creature, spell)
    const drawn = name === 'ДастАроникс' ? creature.instanceId : spell.instanceId
    const play = command('owner', { action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 2 } } })
    const result = await applyMatchCommand(fixture.pool, 'owner', play)
    assert.equal(result.kind, 'applied')
    assert.equal(fixture.state.players[0].mana, 10 - card.Cost)
    assert.deepEqual(fixture.state.players[0].hand.map(card => card.instanceId), [drawn])
    assert.deepEqual(result.snapshots.find(entry => entry.userId === 'owner').snapshot.private.hand.map(card => card.instanceId), [drawn])
    assert.ok(!JSON.stringify(result.snapshots.find(entry => entry.userId === 'guest').snapshot).includes(drawn))
    assert.ok(!JSON.stringify(result.events).includes(drawn))
    const before = structuredClone(fixture.state)
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', play)).kind, 'duplicate')
    assert.deepEqual(fixture.state, before)
    assert.equal(fixture.updates, 1)
  }
})

test('a failed entry-draw commit preserves the original hand, deck, mana, and receipts', async () => {
  const fixture = setup({ failCommit: true })
  const card = { ...cardCatalog.find(card => card.Name === 'ДастАроникс'), instanceId: 'entry-card' }
  fixture.state.players[0].hand = [card]
  fixture.state.players[0].mana = 10
  const before = structuredClone(fixture.state)
  const play = command('owner', { action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 2 } } })
  await assert.rejects(applyMatchCommand(fixture.pool, 'owner', play), /commit failed/)
  assert.deepEqual(fixture.state, before)
  assert.equal(fixture.receipts.size, 0)
})

test('Shield equip, absorbed attack, and owner-turn refresh persist once across retries', async () => {
  const fixture = setup()
  const item = { ...cardCatalog.find(card => card.Name === 'Щит'), instanceId: 'shield-item' }
  fixture.state.players[0].hand = [item]
  fixture.state.players[0].mana = 10
  fixture.state.board.push(
    { id: 'bearer', card: { Id: 'bearer-card', Name: 'Bearer', Type: 0 }, owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'attacker', card: { Id: 'attacker-card', Name: 'Attacker', Type: 0 }, owner: 1, row: 3, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const equip = command('owner', { action: 'item.equip', data: { cardInstanceId: item.instanceId, targetUnitId: 'bearer', payment: 'mana' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', equip)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', equip)).kind, 'duplicate')
  const end = command('owner', { commandId: 'c256cae2-6804-4bb7-8db5-82a52e3f7ca8', expectedVersion: 1, action: 'turn.end', data: {} })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', end)).kind, 'applied')
  const attack = command('guest', { commandId: 'd256cae2-6804-4bb7-8db5-82a52e3f7ca8', expectedVersion: 2, action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'bearer' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'guest', attack)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'guest', attack)).kind, 'duplicate')
  assert.equal(fixture.state.board.find(unit => unit.id === 'bearer').shield, false)
  assert.equal(fixture.state.board.find(unit => unit.id === 'bearer').health, 5 + item.Health)
  const returnTurn = command('guest', { commandId: 'e256cae2-6804-4bb7-8db5-82a52e3f7ca8', expectedVersion: 3, action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'guest', returnTurn)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'guest', returnTurn)).kind, 'duplicate')
  assert.equal(fixture.state.board.find(unit => unit.id === 'bearer').shield, true)
  assert.equal(fixture.state.board.find(unit => unit.id === 'bearer').maxHealth, 5 + item.Health)
  assert.equal(fixture.state.version, 4)
  assert.equal(fixture.updates, 4)
})

test('start-turn card draw is persisted once and a retried turn end does not draw again', async () => {
  const fixture = setup()
  const before = [...fixture.state.players[1].deck]
  fixture.state.board.push({ id: 'draw-start', card: { Id: 'draw-start-card', Name: 'Black Mesa', Description: 'Постоянно: В начале хода возьмите 2 карты.', Type: 0 }, owner: 1, row: 0, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 0, summoned: 0, attacks: 0, blackTokens: 0 })
  const request = command('owner', { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.players[1].hand.length, 6)
  assert.deepEqual(fixture.state.players[1].hand.slice(4).map(card => card.Id), before.slice(0, 2).map(card => card.Id))
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.players[1].deck.length, before.length - 2)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('start-turn burn pauses for a private choice and resumes exactly once', async () => {
  const fixture = setup()
  const player = fixture.state.players[1]
  fixture.state.board.push({ id: 'burn-start', card: { Id: 'burn-start-card', Name: 'Рокочущий рыцарь', Description: 'Постоянно: В начале хода сожгите 1 карту из вашей руки.', Type: 0 }, owner: 1, row: 0, col: 2, health: 4, maxHealth: 4, attack: 3, speed: 2, summoned: 0, attacks: 0, blackTokens: 0 })
  const card = player.hand[0]
  const end = command('owner', { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', end)).kind, 'applied')
  assert.equal(fixture.state.pendingChoice.kind, 'start-turn-burn')
  assert.ok(fixture.state.pendingTurnStart)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', end)).kind, 'duplicate')
  const snapshotPool = { async query(_sql, values) { return { rows: [{ state_json: fixture.state, seat: values[1] === 'guest' ? 1 : 0 }] } } }
  const ownerSnapshot = await readMatchSnapshot(snapshotPool, 'guest', matchId)
  const opponentSnapshot = await readMatchSnapshot(snapshotPool, 'owner', matchId)
  assert.equal(ownerSnapshot.private.pendingChoice.options[0].unitId, card.instanceId)
  assert.equal(opponentSnapshot.private.pendingChoice, null)
  const resolve = command('guest', { commandId: 'd256cae2-6804-4bb7-8db5-82a52e3f7ca8', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { unitIds: [card.instanceId] } } })
  const resolved = await applyMatchCommand(fixture.pool, 'guest', resolve)
  assert.equal(resolved.kind, 'applied')
  assert.equal(JSON.stringify(resolved.events).includes(card.instanceId), false)
  assert.ok(fixture.state.players[1].burned.some(candidate => candidate.instanceId === card.instanceId))
  assert.equal(fixture.state.pendingChoice, null)
  assert.equal(fixture.state.pendingTurnStart, null)
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
  assert.equal((await applyMatchCommand(fixture.pool, 'guest', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.players[1].burned.filter(candidate => candidate.instanceId === card.instanceId).length, 1)
})

test('Генератор щита commits a private adjacent target choice once', async () => {
  const fixture = setup()
  fixture.state.board.push(
    { id: 'shield-generator', card: { Id: 'shield-generator-card', Name: 'Генератор щита', Description: 'Постоянно: В начале вашего хода дайте щит выбранному существу вокруг.', Type: 3 }, owner: 1, row: 0, col: 2, health: 3, maxHealth: 3, attack: 0, speed: 0, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'shield-target', card: { Id: 'shield-target-card', Name: 'Ally', Type: 0 }, owner: 1, row: 1, col: 1, health: 2, maxHealth: 2, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const end = command('owner', { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', end)).kind, 'applied')
  const choiceId = fixture.state.pendingChoice.id
  const snapshotPool = { async query(_sql, values) { return { rows: [{ state_json: fixture.state, seat: values[1] === 'guest' ? 1 : 0 }] } } }
  assert.equal((await readMatchSnapshot(snapshotPool, 'guest', matchId)).private.pendingChoice.options[0].unitId, 'shield-target')
  assert.equal((await readMatchSnapshot(snapshotPool, 'owner', matchId)).private.pendingChoice, null)
  const resolve = command('guest', { commandId: 'd256cae2-6804-4bb7-8db5-82a52e3f7ca6', expectedVersion: 1, action: 'choice.resolve', data: { choiceId, selection: { unitId: 'shield-target' } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'guest', resolve)).kind, 'applied')
  assert.equal(fixture.state.board.find(unit => unit.id === 'shield-target').shield, true)
  assert.equal(fixture.state.pendingChoice, null)
  assert.equal(fixture.state.pendingTurnStart, null)
  assert.equal((await applyMatchCommand(fixture.pool, 'guest', resolve)).kind, 'duplicate')
  assert.equal(fixture.updates, 2)
})

test('Чёрная меза draw and conditional burn persist as one turn transition plus one private choice', async () => {
  const fixture = setup()
  const player = fixture.state.players[1]
  player.limit = 5
  const deckBefore = player.deck.length
  fixture.state.board.push({ id: 'black-mesa', card: { Id: 'black-mesa-card', Name: 'Чёрная меза', Description: 'Постоянно: В начале хода возьмите 2 карты. Если у вас лимит карт 5 и больше, сожгите 1 карту', Type: 0 }, owner: 1, row: 0, col: 2, health: 5, maxHealth: 5, attack: 3, speed: 2, summoned: 0, attacks: 0, blackTokens: 0 })
  const request = command('owner', { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.pendingChoice.kind, 'start-turn-burn')
  assert.equal(fixture.state.players[1].hand.length, 6)
  const burnId = fixture.state.pendingChoice.unitIds[0]
  const resolve = command('guest', { commandId: 'd256cae2-6804-4bb7-8db5-82a52e3f7ca5', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { unitIds: [burnId] } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'guest', resolve)).kind, 'applied')
  assert.equal(fixture.state.players[1].burned[0].instanceId, burnId)
  assert.equal(fixture.state.players[1].hand.length, 5)
  assert.equal(fixture.state.players[1].deck.length, deckBefore - 2)
  assert.equal(fixture.state.pendingChoice, null)
  assert.equal(fixture.state.pendingTurnStart, null)
  assert.equal((await applyMatchCommand(fixture.pool, 'guest', resolve)).kind, 'duplicate')
  assert.equal(fixture.updates, 2)
})

test('start-turn forward movement and its field triggers commit once', async () => {
  const fixture = setup()
  fixture.state.board.push(
    { id: 'pogan', card: { Id: 'pogan-card', Name: 'Погань', Description: 'Постоянно: В начале хода передвигаеться вперёд на 1 сокет', Type: 0 }, owner: 1, row: 3, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'doggo', card: { Id: 'doggo-card', Name: 'Догго', Type: 0 }, owner: 0, row: 4, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'turret', card: { Id: 'turret-card', Name: 'Турель', Type: 3 }, owner: 0, row: 4, col: 1, health: 4, maxHealth: 4, attack: 0, speed: 0, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const request = command('owner', { action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.deepEqual([fixture.state.board.find(unit => unit.id === 'pogan').row, fixture.state.board.find(unit => unit.id === 'pogan').col], [4, 2])
  assert.equal(fixture.state.board.find(unit => unit.id === 'pogan').health, 3)
  assert.equal(fixture.state.board.find(unit => unit.id === 'doggo').attack, 2)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('turn-ending rule failures keep their public code and make no database write', async () => {
  const fixture = setup()
  const request = command('guest', { action: 'turn.end', data: { option: 'no_penalty' } })
  await assert.rejects(applyMatchCommand(fixture.pool, 'guest', request), error => error instanceof MatchCommandError && error.code === 'NOT_YOUR_TURN')
  assert.equal(fixture.state.version, 0)
  assert.equal(fixture.receipts.size, 0)
  assert.equal(fixture.updates, 0)
})

test('unit movement commits once and a duplicate retry does not spend energy twice', async () => {
  const fixture = setup()
  const card = cardCatalog.find(candidate => candidate.Type === 0)
  fixture.state.players[0].energy = 1
  fixture.state.board.push({ id: 'unit-1', card, owner: 0, row: 4, col: 2, health: 1, maxHealth: 1, attack: 1, speed: 1, shield: false, summoned: 0, stunned: 0, dying: false })
  const request = command('owner', { action: 'unit.move', data: { unitId: 'unit-1', to: { row: 3, col: 2 } } })

  const accepted = await applyMatchCommand(fixture.pool, 'owner', request)
  assert.equal(accepted.kind, 'applied')
  assert.equal(accepted.appliedVersion, 1)
  assert.equal(fixture.state.players[0].energy, 0)
  assert.deepEqual([fixture.state.board[0].row, fixture.state.board[0].col], [3, 2])
  const retried = await applyMatchCommand(fixture.pool, 'owner', request)
  assert.equal(retried.kind, 'duplicate')
  assert.equal(fixture.state.players[0].energy, 0)
  assert.equal(fixture.updates, 1)
})

test('Lazerwygs34 entry stats commit at round ten and do not duplicate on retry', async () => {
  const fixture = setup()
  const card = { ...cardCatalog.find(item => item.Name === 'Lazerwygs34'), instanceId: 'ci_lazerwygs34' }
  fixture.state.round = 10
  fixture.state.players[0].hand = [card]
  fixture.state.players[0].mana = card.Cost
  const request = command('owner', { action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.deepEqual([fixture.state.board[0].attack, fixture.state.board[0].health, fixture.state.board[0].maxHealth], [4, 4, 4])
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.deepEqual([fixture.state.board[0].attack, fixture.state.board[0].health, fixture.state.board[0].maxHealth], [4, 4, 4])
})

test('Turbot unflips creatures once and removes flipped creatures at zero health', async () => {
  const fixture = setup()
  const card = { ...cardCatalog.find(item => item.Name === 'Турбот'), instanceId: 'turbot-server' }
  fixture.state.players[0].hand = [card]
  fixture.state.players[0].mana = card.Cost
  fixture.state.board.push(
    { id: 'turbot-ally', card: cardCatalog[0], owner: 0, row: 4, col: 1, health: 2, maxHealth: 2, attack: 1, speed: 1, flippedTurns: 2 },
    { id: 'turbot-lethal', card: cardCatalog[0], owner: 1, row: 0, col: 1, health: 0, maxHealth: 2, attack: 1, speed: 1, flippedTurns: 1 },
    { id: 'turbot-building', card: { ...cardCatalog[0], Type: 3 }, owner: 1, row: 1, col: 1, health: 2, maxHealth: 2, attack: 0, speed: 0, flippedTurns: 2 },
  )
  const request = command('owner', { commandId: '6cd2ae19-576a-4567-8945-9d9a3d2d36c3', action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 2 } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.board.find(unit => unit.id === 'turbot-ally').flippedTurns, 0)
  assert.equal(fixture.state.board.some(unit => unit.id === 'turbot-lethal'), false)
  assert.equal(fixture.state.board.find(unit => unit.id === 'turbot-building').flippedTurns, 2)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Yellow Diamond flips every board card once and deduplicates a retried play', async () => {
  const fixture = setup()
  const card = { ...cardCatalog.find(item => item.Name === 'Жёлтый алмаз'), instanceId: 'yellow-diamond-server' }
  fixture.state.players[0].hand = [card]
  fixture.state.players[0].mana = card.Cost
  fixture.state.board.push(
    { id: 'yellow-server-ally', card: cardCatalog[0], owner: 0, row: 4, col: 1, health: 2, maxHealth: 2, attack: 1, speed: 1 },
    { id: 'yellow-server-enemy', card: cardCatalog[0], owner: 1, row: 0, col: 1, health: 2, maxHealth: 2, attack: 1, speed: 1 },
    { id: 'yellow-server-building', card: { ...cardCatalog[0], Type: 3 }, owner: 1, row: 1, col: 1, health: 2, maxHealth: 2, attack: 0, speed: 0 },
  )
  const request = command('owner', { commandId: '791f8ce6-6c4e-40e6-bc94-03ce31d0df89', action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 2 } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.deepEqual(['yellow-server-ally', 'yellow-server-enemy', 'yellow-server-building'].map(id => fixture.state.board.find(unit => unit.id === id).flippedTurns), [2, 2, 2])
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Aiboll entry privately selects a building and deduplicates its destruction', async () => {
  const fixture = setup()
  const card = { ...cardCatalog.find(item => item.Name === 'Айболл'), instanceId: 'aiboll-server' }
  const building = { ...cardCatalog[0], Id: 'aiboll-target-building', Name: 'Target building', Description: '', Effects: [], Type: 3 }
  fixture.state.players[0].hand = [card]
  fixture.state.players[0].mana = card.Cost
  fixture.state.board.push({ id: 'aiboll-building', card: building, owner: 1, row: 1, col: 0, health: 2, maxHealth: 2, attack: 0, speed: 0 })
  const play = command('owner', { commandId: 'a89928a5-4bd8-4dae-8be2-f6896966754d', action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 2 } } })

  const appliedPlay = await applyMatchCommand(fixture.pool, 'owner', play)
  assert.equal(appliedPlay.kind, 'applied')
  assert.equal(appliedPlay.snapshots.find(snapshot => snapshot.userId === 'guest').snapshot.private.pendingChoice, null)
  assert.deepEqual(appliedPlay.snapshots.find(snapshot => snapshot.userId === 'owner').snapshot.private.pendingChoice.options.map(option => option.unitId), ['aiboll-building'])
  const resolve = command('owner', { commandId: 'd7ef10e7-63c6-493e-97cc-8b72257af8b0', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { unitId: 'aiboll-building' } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.board.some(unit => unit.id === 'aiboll-building'), false)
  assert.equal(fixture.state.players[1].discard.some(discarded => discarded.Id === building.Id), true)
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('Asi.mp4 heal and flip choice stays private and applies once on retry', async () => {
  const fixture = setup()
  const card = { ...cardCatalog.find(item => item.Name === 'Аси.mp4'), instanceId: 'asi-server' }
  const flipTrigger = cardCatalog.find(item => item.Name === '.Хихо')
  const drawn = fixture.state.players[1].deck[0].instanceId
  fixture.state.players[0].hand = [card]
  fixture.state.players[0].mana = card.Cost
  fixture.state.board.push({ id: 'asi-server-target', card: flipTrigger, owner: 1, row: 2, col: 1, health: 1, maxHealth: 5, attack: 2, speed: flipTrigger.Speed, flippedTurns: 0 })
  const play = command('owner', { commandId: '47458ec7-489a-47a2-9c30-2d97aeeef6ec', action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 2 } } })

  const appliedPlay = await applyMatchCommand(fixture.pool, 'owner', play)
  assert.equal(appliedPlay.kind, 'applied')
  assert.equal(appliedPlay.snapshots.find(snapshot => snapshot.userId === 'guest').snapshot.private.pendingChoice, null)
  assert.deepEqual(appliedPlay.snapshots.find(snapshot => snapshot.userId === 'owner').snapshot.private.pendingChoice.options.map(option => option.unitId), ['asi-server-target'])
  const resolve = command('owner', { commandId: '655bfc48-a581-4c79-b199-95334523e1a2', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { unitId: 'asi-server-target' } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.deepEqual([fixture.state.board.find(unit => unit.id === 'asi-server-target').health, fixture.state.board.find(unit => unit.id === 'asi-server-target').maxHealth, fixture.state.board.find(unit => unit.id === 'asi-server-target').attack, fixture.state.board.find(unit => unit.id === 'asi-server-target').speed, fixture.state.board.find(unit => unit.id === 'asi-server-target').flippedTurns], [6, 6, 3, 2, 2])
  assert.equal(fixture.state.players[1].deck.some(deckCard => deckCard.instanceId === drawn), false)
  assert.equal(fixture.state.players[1].hand.at(-1).instanceId, drawn)
  assert.equal(fixture.state.players[1].mana, 1)
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('Ralzey heals its owner and privately stuns an enemy once', async () => {
  const fixture = setup()
  const card = { ...cardCatalog.find(item => item.Name === 'Ральзей'), instanceId: 'ralzey-server' }
  fixture.state.players[0].health = 40
  fixture.state.players[0].hand = [card]
  fixture.state.players[0].mana = card.Cost
  fixture.state.board.push(
    { id: 'ralzey-ally', card: cardCatalog[0], owner: 0, row: 3, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1 },
    { id: 'ralzey-enemy', card: cardCatalog[0], owner: 1, row: 1, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1 },
  )
  const play = command('owner', { commandId: 'd4b07a9b-61db-4435-bf93-24a1eb319067', action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 2 } } })

  const appliedPlay = await applyMatchCommand(fixture.pool, 'owner', play)
  assert.equal(fixture.state.players[0].health, 44)
  assert.equal(appliedPlay.snapshots.find(snapshot => snapshot.userId === 'guest').snapshot.private.pendingChoice, null)
  assert.deepEqual(appliedPlay.snapshots.find(snapshot => snapshot.userId === 'owner').snapshot.private.pendingChoice.options.map(option => option.unitId), ['ralzey-enemy'])
  assert.equal(appliedPlay.snapshots.find(snapshot => snapshot.userId === 'owner').snapshot.private.pendingChoice.turns, 1)
  const resolve = command('owner', { commandId: '840465a8-4a1f-46f4-848d-b17d1377de30', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { unitId: 'ralzey-enemy' } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.board.find(unit => unit.id === 'ralzey-enemy').stunned, 1)
  assert.equal(fixture.state.board.find(unit => unit.id === 'ralzey-ally').stunned ?? 0, 0)
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('card play commits the hand, mana, board, version, and receipt as one command', async () => {
  const fixture = setup()
  const card = cardCatalog.find(candidate => candidate.Type === 0 && !candidate.Tags?.includes('в разработке') && !/Вход\s*:/iu.test(candidate.Description))
  fixture.state.players[0].hand.push({ ...card, instanceId: 'ci_play_test' })
  fixture.state.players[0].mana = card.Cost
  const request = command('owner', { action: 'card.play', data: { cardInstanceId: 'ci_play_test', target: { row: 4, col: 1 }, payment: 'mana' } })

  const accepted = await applyMatchCommand(fixture.pool, 'owner', request)
  assert.equal(accepted.kind, 'applied')
  assert.equal(fixture.state.players[0].hand.some(item => item.instanceId === 'ci_play_test'), false)
  assert.equal(fixture.state.players[0].mana, 0)
  assert.deepEqual([fixture.state.board[0].row, fixture.state.board[0].col], [4, 1])
  const retried = await applyMatchCommand(fixture.pool, 'owner', request)
  assert.equal(retried.kind, 'duplicate')
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Геймнайт persists its draw and temporary public hand-limit change once', async () => {
  const fixture = setup()
  const card = cardCatalog.find(candidate => candidate.Name === 'Геймнайт')
  assert.ok(card)
  fixture.state.players[0].hand.push({ ...card, instanceId: 'ci_game_night' })
  fixture.state.players[0].mana = card.Cost
  const request = command('owner', { commandId: '4bfe4398-0328-4258-a964-78145d1211d5', action: 'spell.cast', data: { cardInstanceId: 'ci_game_night', payment: 'mana' } })

  const accepted = await applyMatchCommand(fixture.pool, 'owner', request)
  assert.equal(accepted.kind, 'applied')
  assert.equal(fixture.state.players[0].hand.length, 6)
  assert.equal(fixture.state.players[1].limit, 6)
  assert.deepEqual(fixture.state.players[1].temporaryLimitExpirations, [1, 1])
  assert.equal(accepted.snapshots.find(snapshot => snapshot.userId === 'guest').snapshot.public.players[1].limit, 6)
  assert.equal(accepted.snapshots.find(snapshot => snapshot.userId === 'guest').snapshot.public.players[1].handCount, 4)

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].hand.length, 6)
  assert.equal(fixture.state.players[1].limit, 6)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Гастер Бластер damages its selected line once across a duplicate command retry', async () => {
  const fixture = setup()
  const spell = cardCatalog.find(card => card.Name === 'Гастер Бластер')
  assert.ok(spell)
  fixture.state.players[0].hand.push({ ...spell, instanceId: 'ci_gaster_server' })
  fixture.state.players[0].mana = spell.Cost
  fixture.state.board.push(
    { id: 'line-target', card: { ...cardCatalog[0], Name: 'Target' }, owner: 1, row: 2, col: 2, health: 10, maxHealth: 10, attack: 1, speed: 1 },
    { id: 'line-friend', card: { ...cardCatalog[1], Name: 'Friend', Type: 0 }, owner: 0, row: 2, col: 4, health: 10, maxHealth: 10, attack: 1, speed: 1 },
    { id: 'outside', card: { ...cardCatalog[2], Name: 'Outside', Type: 0 }, owner: 1, row: 0, col: 0, health: 10, maxHealth: 10, attack: 1, speed: 1 },
  )
  const request = command('owner', { commandId: 'f866abf6-85ac-41eb-a147-450e49d1e6e3', action: 'spell.cast', data: { cardInstanceId: 'ci_gaster_server', payment: 'mana', target: { unitId: 'line-target' } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.deepEqual(fixture.state.board.map(unit => unit.health), [4, 4, 10])
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.deepEqual(fixture.state.board.map(unit => unit.health), [4, 4, 10])
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Лазанья applies its row-and-column stat buff once across a duplicate retry', async () => {
  const fixture = setup()
  const spell = cardCatalog.find(card => card.Name === 'Лазанья')
  assert.ok(spell)
  fixture.state.players[0].hand.push({ ...spell, instanceId: 'ci_lasagna_server' })
  fixture.state.players[0].mana = spell.Cost
  fixture.state.board.push(
    { id: 'row-target', card: { ...cardCatalog[0], Name: 'Target', Type: 0, Speed: 1 }, owner: 1, row: 1, col: 0, health: 5, maxHealth: 5, attack: 1, speed: 1 },
    { id: 'column-building', card: { ...cardCatalog[0], Name: 'Building', Type: 3, Speed: 1 }, owner: 1, row: 3, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1 },
    { id: 'outside', card: { ...cardCatalog[0], Name: 'Outside', Type: 0 }, owner: 0, row: 0, col: 0, health: 5, maxHealth: 5, attack: 1, speed: 1 },
  )
  const request = command('owner', { commandId: '7524bd84-649e-4668-9851-624d5c13d402', action: 'spell.cast', data: { cardInstanceId: 'ci_lasagna_server', payment: 'mana', target: { row: 1, col: 2 } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.deepEqual(fixture.state.board.map(unit => [unit.attack, unit.health, unit.maxHealth, unit.speed]), [[2, 6, 6, 0], [2, 6, 6, 0], [1, 5, 5, 1]])
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.deepEqual(fixture.state.board.map(unit => [unit.attack, unit.health, unit.maxHealth, unit.speed]), [[2, 6, 6, 0], [2, 6, 6, 0], [1, 5, 5, 1]])
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Бан persists the selected creature and attached-item burns once on retry', async () => {
  const fixture = setup()
  const spell = cardCatalog.find(card => card.Name === 'Бан')
  assert.ok(spell)
  fixture.state.players[0].hand.push({ ...spell, instanceId: 'ci_ban_server' })
  fixture.state.players[0].mana = spell.Cost
  const target = { ...cardCatalog.find(card => card.Type === 0), Name: 'Burned target', Description: '', instanceId: 'ci_ban_target' }
  const item = { ...cardCatalog.find(card => card.Type === 1), Name: 'Burning item', Description: 'Сжигается', instanceId: 'ci_ban_item' }
  fixture.state.board.push({ id: 'burn-target', card: target, item, owner: 1, row: 1, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, shield: true })
  const request = command('owner', { commandId: '5ee6fb55-60cb-4ed6-b001-5376d980a51f', action: 'spell.cast', data: { cardInstanceId: 'ci_ban_server', payment: 'mana', target: { unitId: 'burn-target' } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.deepEqual(fixture.state.players[1].burned.map(card => card.instanceId), ['ci_ban_target', 'ci_ban_item'])
  assert.deepEqual(fixture.state.players[0].burned.map(card => card.instanceId), ['ci_ban_server'])
  assert.deepEqual(fixture.state.board, [])
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.deepEqual(fixture.state.players[1].burned.map(card => card.instanceId), ['ci_ban_target', 'ci_ban_item'])
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Steven stun and spell burn persist once across command retries', async () => {
  const fixture = setup()
  const spell = cardCatalog.find(card => card.Name === 'Посмотрюка я Стивен ДНД')
  assert.ok(spell)
  fixture.state.players[0].hand.push({ ...spell, instanceId: 'ci_steven_server' })
  fixture.state.players[0].mana = spell.Cost
  fixture.state.board.push({ id: 'steven-target', card: { ...cardCatalog.find(card => card.Type === 0), Name: 'Stunned', Description: '' }, owner: 1, row: 1, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1 })
  const request = command('owner', { commandId: 'a8181f4f-5e14-4828-a132-88552f31b105', action: 'spell.cast', data: { cardInstanceId: 'ci_steven_server', payment: 'mana', target: { unitId: 'steven-target' } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.board[0].stunned, 10)
  assert.deepEqual(fixture.state.players[0].burned.map(card => card.instanceId), ['ci_steven_server'])
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.board[0].stunned, 10)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Auction selects one server-random survivor and commits creature deaths once', async () => {
  const fixture = setup()
  const spell = cardCatalog.find(card => card.Name === 'Аукцион')
  assert.ok(spell)
  fixture.state.players[0].hand.push({ ...spell, instanceId: 'ci_auction_server' })
  fixture.state.players[0].mana = spell.Cost
  const creatures = [
    { id: 'auction-a', card: { ...cardCatalog.find(card => card.Type === 0), Name: 'A', Description: '', instanceId: 'auction-ca' }, owner: 0, row: 4, col: 0, health: 5, maxHealth: 5, attack: 1, speed: 1 },
    { id: 'auction-b', card: { ...cardCatalog.find(card => card.Type === 0), Name: 'B', Description: '', instanceId: 'auction-cb' }, owner: 1, row: 0, col: 0, health: 5, maxHealth: 5, attack: 1, speed: 1 },
  ]
  fixture.state.board.push(...creatures)
  const request = command('owner', { commandId: '46c80262-5834-4d0c-a567-eac370fe330b', action: 'spell.cast', data: { cardInstanceId: 'ci_auction_server', payment: 'mana' } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.board.length, 1)
  assert.ok(creatures.some(unit => unit.id === fixture.state.board[0].id))
  const killed = creatures.filter(unit => unit.id !== fixture.state.board[0].id)
  assert.deepEqual(fixture.state.players[1].discard.map(card => card.instanceId), killed.filter(unit => unit.owner === 1).map(unit => unit.card.instanceId))
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.board.length, 1)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('friendly-sacrifice choice and enemy debuffs commit once across choice retries', async () => {
  const fixture = setup()
  const spell = cardCatalog.find(card => card.Name === 'Бей своих чтобы чужие боялись')
  assert.ok(spell)
  fixture.state.players[0].hand.push({ ...spell, instanceId: 'ci_friendly_sacrifice' })
  fixture.state.players[0].mana = spell.Cost
  const units = [
    { id: 'ally-a', owner: 0 }, { id: 'ally-b', owner: 0 },
    { id: 'enemy-a', owner: 1 }, { id: 'enemy-b', owner: 1 },
  ].map(({ id, owner }, index) => ({ id, card: { ...cardCatalog[0], Name: id, Type: 0, Speed: 3, Description: '', instanceId: `card_${id}` }, owner, row: owner ? 0 : 4, col: index, health: 5, maxHealth: 5, attack: 2, speed: 3 }))
  fixture.state.board.push(...units)
  const cast = command('owner', { commandId: 'a224a13d-1878-48b8-a958-0c4c2f97c4f1', action: 'spell.cast', data: { cardInstanceId: 'ci_friendly_sacrifice', payment: 'mana' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', cast)).kind, 'applied')
  const choice = fixture.state.pendingChoice
  assert.deepEqual(choice.unitIds, ['ally-a', 'ally-b'])
  const request = command('owner', { commandId: '61640b9e-2e19-41f6-b5e2-c4c3a6e323a4', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: ['ally-a', 'ally-b'] } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.deepEqual(fixture.state.board.map(unit => [unit.id, unit.attack, unit.speed]), [['enemy-a', 1, 6], ['enemy-b', 1, 6]])
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.deepEqual(fixture.state.board.map(unit => [unit.id, unit.attack, unit.speed]), [['enemy-a', 1, 6], ['enemy-b', 1, 6]])
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('White Door target and socket choice persist once across choice retries', async () => {
  const fixture = setup()
  const spell = cardCatalog.find(card => card.Name === 'Белая дверь')
  assert.ok(spell)
  fixture.state.players[0].hand.push({ ...spell, instanceId: 'ci_white_door' })
  fixture.state.players[0].mana = spell.Cost
  fixture.state.board.push({ id: 'door-target', card: { ...cardCatalog.find(card => card.Type === 0), Name: 'Door target', Description: '' }, owner: 1, row: 0, col: 0, health: 5, maxHealth: 5, attack: 1, speed: 1 })
  const cast = command('owner', { commandId: 'a9642630-c85a-4aa4-85f6-26edaf85f847', action: 'spell.cast', data: { cardInstanceId: 'ci_white_door', payment: 'mana', target: { unitId: 'door-target' } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', cast)).kind, 'applied')
  const choice = fixture.state.pendingChoice
  const request = command('owner', { commandId: 'ca6ab217-3a5a-4a97-a7be-f811f41b23f7', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: choice.id, selection: { cell: { row: 2, col: 2 } } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.deepEqual([fixture.state.board[0].row, fixture.state.board[0].col], [2, 2])
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.deepEqual([fixture.state.board[0].row, fixture.state.board[0].col], [2, 2])
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('an unported card entry effect is rejected without persisting a receipt or spending mana', async () => {
  const fixture = setup()
  const card = { ...cardCatalog[0], instanceId: 'ci_entry_test', Description: 'Вход: Наносит урон.' }
  fixture.state.players[0].hand.push(card)
  fixture.state.players[0].mana = card.Cost
  const request = command('owner', { action: 'card.play', data: { cardInstanceId: card.instanceId, target: { row: 4, col: 1 }, payment: 'mana' } })

  await assert.rejects(applyMatchCommand(fixture.pool, 'owner', request), error => error instanceof MatchCommandError && error.code === 'UNSUPPORTED_EFFECT')
  assert.equal(fixture.state.players[0].hand.some(item => item.instanceId === card.instanceId), true)
  assert.equal(fixture.state.players[0].mana, card.Cost)
  assert.equal(fixture.state.version, 0)
  assert.equal(fixture.receipts.size, 0)
  assert.equal(fixture.updates, 0)
})

test('unit attack commits combat and deduplicates a retry', async () => {
  const fixture = setup()
  const card = cardCatalog[0]
  fixture.state.board.push(
    { id: 'attacker', card: { ...card, Name: 'Attacker', Description: '' }, owner: 0, row: 4, col: 2, health: 7, maxHealth: 7, attack: 3, speed: 1, summoned: 0, attacks: 0 },
    { id: 'defender', card: { ...card, Name: 'Defender', Description: '' }, owner: 1, row: 3, col: 2, health: 6, maxHealth: 6, attack: 2, speed: 1, summoned: 0, attacks: 0 },
  )
  const request = command('owner', { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'defender' } })

  const accepted = await applyMatchCommand(fixture.pool, 'owner', request)
  assert.equal(accepted.kind, 'applied')
  assert.equal(fixture.state.board.find(unit => unit.id === 'defender').health, 3)
  assert.equal(fixture.state.board.find(unit => unit.id === 'attacker').health, 5)
  const retried = await applyMatchCommand(fixture.pool, 'owner', request)
  assert.equal(retried.kind, 'duplicate')
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Джон Фараон crown kill commits once across command retries', async () => {
  const fixture = setup()
  fixture.state.board.push(
    { id: 'pharaoh', card: { ...cardCatalog.find(card => card.Name === 'Джон Фараон') }, owner: 0, row: 4, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'target', card: { ...cardCatalog.find(card => card.Type === 0), Name: 'Target', Description: '' }, owner: 1, row: 3, col: 2, health: 5, maxHealth: 5, attack: 0, speed: 0, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const request = command('owner', { action: 'unit.attack', data: { unitId: 'pharaoh', targetUnitId: 'target' } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.board.some(unit => unit.id === 'target'), false)
  assert.equal(fixture.state.players[1].discard.some(card => card.Name === 'Target'), true)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('PGM Peridot flips a killed creature once and turn retries do not shorten its timer twice', async () => {
  const fixture = setup()
  fixture.state.board.push(
    { id: 'pgm', card: { ...cardCatalog.find(card => card.Name === 'PGM Peridot') }, owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 3, speed: 3, summoned: 0, attacks: 0 },
    { id: 'target', card: { ...cardCatalog.find(card => card.Type === 0), Name: 'Target', Description: '' }, owner: 1, row: 3, col: 2, health: 3, maxHealth: 3, attack: 0, speed: 0, summoned: 0, attacks: 0 },
  )
  const attack = command('owner', { action: 'unit.attack', data: { unitId: 'pgm', targetUnitId: 'target' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', attack)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', attack)).kind, 'duplicate')
  assert.deepEqual([fixture.state.board.find(unit => unit.id === 'target').health, fixture.state.board.find(unit => unit.id === 'target').flippedTurns], [0, 2])

  const endOwner = command('owner', { commandId: 'bcc7c2bd-9f60-4f6d-b9d0-a4b253c84e26', expectedVersion: 1, action: 'turn.end', data: { option: 'no_penalty' } })
  await applyMatchCommand(fixture.pool, 'owner', endOwner)
  const endGuest = command('guest', { commandId: '115f9446-45ea-4fad-8ed8-f400d3f56725', expectedVersion: 2, action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'guest', endGuest)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'guest', endGuest)).kind, 'duplicate')
  assert.equal(fixture.state.board.find(unit => unit.id === 'target').flippedTurns, 1)
  assert.equal(fixture.state.version, 3)
  assert.equal(fixture.updates, 3)
})

test('V1 Horny payment and ranged crown mode persist once across a retried play', async () => {
  const fixture = setup()
  const v1 = { ...cardCatalog.find(card => card.Name === 'V1'), instanceId: 'v1-server' }
  fixture.state.players[0].hand = [v1]
  fixture.state.players[0].health = 30
  fixture.state.players[0].mana = 20
  const play = command('owner', { commandId: '61f16577-f6ec-4d75-bde0-3bf6032d8e01', action: 'card.play', data: { cardInstanceId: v1.instanceId, payment: 'mana', target: { row: 4, col: 2 }, horny: true } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', play)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', play)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].health, 20)
  assert.equal(fixture.state.board.find(unit => unit.card.Name === 'V1').v1RangedCrown, true)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Yellow entry death is persisted once with its card in discard', async () => {
  const fixture = setup()
  const yellow = { ...cardCatalog.find(card => card.Name === 'Жёлтый'), instanceId: 'yellow-server' }
  fixture.state.players[0].hand = [yellow]
  fixture.state.players[0].mana = 20
  const play = command('owner', { commandId: 'f91a0384-5ba9-44f9-9dc6-2e5ed9ca68e3', action: 'card.play', data: { cardInstanceId: yellow.instanceId, payment: 'mana', target: { row: 4, col: 2 } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', play)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', play)).kind, 'duplicate')
  assert.equal(fixture.state.board.some(unit => unit.card.Name === 'Жёлтый'), false)
  assert.equal(fixture.state.players[0].discard.filter(card => card.instanceId === yellow.instanceId).length, 1)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Iron Nanny entry debuffs persist once across a retried play', async () => {
  const fixture = setup()
  const nanny = { ...cardCatalog.find(card => card.Name === 'Железная няня'), instanceId: 'nanny-server' }
  fixture.state.players[0].hand = [nanny]
  fixture.state.players[0].mana = 20
  fixture.state.board.push({ id: 'nanny-enemy', card: { ...cardCatalog[0], Name: 'Enemy' }, owner: 1, row: 2, col: 0, health: 4, maxHealth: 4, attack: 3, speed: 2, blackTokens: 0 })
  const play = command('owner', { commandId: '0ce9a423-5237-4ba8-9f81-81dd172b1231', action: 'card.play', data: { cardInstanceId: nanny.instanceId, payment: 'mana', target: { row: 4, col: 2 } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', play)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', play)).kind, 'duplicate')
  assert.deepEqual([fixture.state.board.find(unit => unit.id === 'nanny-enemy').attack, fixture.state.board.find(unit => unit.id === 'nanny-enemy').speed], [2, 3])
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Gnome neighbour buffs persist once across a retried play', async () => {
  const fixture = setup()
  const gnome = { ...cardCatalog.find(card => card.Name === 'Гном'), instanceId: 'gnome-server' }
  fixture.state.players[0].hand = [gnome]
  fixture.state.players[0].mana = 20
  fixture.state.board.push(
    { id: 'gnome-left', card: { ...cardCatalog[0], Name: 'Left' }, owner: 1, row: 4, col: 1, health: 2, maxHealth: 5, attack: 1, speed: 1, blackTokens: 0 },
    { id: 'gnome-right', card: { ...cardCatalog[0], Name: 'Right' }, owner: 0, row: 4, col: 3, health: 3, maxHealth: 5, attack: 1, speed: 1, blackTokens: 0 },
  )
  const play = command('owner', { commandId: '627ea293-33d5-4703-9df8-7b2d92b9accb', action: 'card.play', data: { cardInstanceId: gnome.instanceId, payment: 'mana', target: { row: 4, col: 2 } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', play)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', play)).kind, 'duplicate')
  assert.deepEqual([fixture.state.board.find(unit => unit.id === 'gnome-left').health, fixture.state.board.find(unit => unit.id === 'gnome-left').maxHealth], [4, 7])
  assert.equal(fixture.state.board.find(unit => unit.id === 'gnome-right').attack, 3)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('direct player attack commits health and deduplicates a retry', async () => {
  const fixture = setup()
  fixture.state.board.push({ id: 'attacker', card: { ...fixture.state.players[0].deck[0], Name: 'Attacker', Description: '', Type: 0 }, owner: 0, row: 0, col: 2, health: 5, maxHealth: 5, attack: 4, speed: 1, summoned: 0, attacks: 0 })
  const request = command('owner', { action: 'unit.attackPlayer', data: { unitId: 'attacker' } })
  const first = await applyMatchCommand(fixture.pool, 'owner', request)
  assert.equal(first.kind, 'applied')
  assert.equal(fixture.state.players[1].health, 41)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.players[1].health, 41)
})

test('Обсидиан пчёла self-destruction resolves its death blast once across command retries', async () => {
  const fixture = setup()
  fixture.state.round = 2
  fixture.state.board.push(
    { id: 'bee', card: { ...cardCatalog.find(card => card.Name === 'Обсидиан пчёла') }, owner: 0, row: 2, col: 2, health: 1, maxHealth: 1, attack: 1, speed: 1, summoned: 1, blackTokens: 0 },
    { id: 'blast-target', card: { ...cardCatalog.find(card => card.Type === 0), Name: 'Blast target', Description: '' }, owner: 1, row: 2, col: 1, health: 2, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0 },
  )
  const request = command('owner', { action: 'ability.use', data: { unitId: 'bee', abilityIndex: 0 } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.board.some(unit => unit.id === 'bee' || unit.id === 'blast-target'), false)
  assert.equal(fixture.state.players[0].discard.some(card => card.Name === 'Обсидиан пчёла'), true)
  assert.equal(fixture.state.players[1].discard.some(card => card.Name === 'Blast target'), true)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.version, 1)
})

test('ability use commits resource and unit state once', async () => {
  const fixture = setup()
  fixture.state.players[0].mana = 1
  fixture.state.board.push({ id: 'bank', card: { ...cardCatalog[0], Name: 'Банк ум', Description: 'Способность 1⭐🔁: Получает 1⚫.' }, owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 0, summoned: 0, blackTokens: 0, abilityUsed: false })
  const request = command('owner', { action: 'ability.use', data: { unitId: 'bank', abilityIndex: 0 } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.players[0].mana, 0)
  assert.equal(fixture.state.board[0].blackTokens, 1)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.board[0].blackTokens, 1)
})

test('item equip commits hand, payment, stats, and duplicate receipt atomically', async () => {
  const fixture = setup()
  const item = { ...cardCatalog.find(card => card.Name === 'Бримстоун'), instanceId: 'ci_item_test' }
  fixture.state.players[0].hand.push(item)
  fixture.state.players[0].mana = item.Cost
  fixture.state.board.push({ id: 'target', card: { ...cardCatalog[0], Name: 'Target' }, owner: 0, row: 4, col: 2, health: 4, maxHealth: 4, attack: 2, speed: 1, summoned: 0 })
  const request = command('owner', { action: 'item.equip', data: { cardInstanceId: item.instanceId, targetUnitId: 'target', payment: 'mana' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.board[0].item.Name, item.Name)
  assert.equal(fixture.state.players[0].hand.some(card => card.instanceId === item.instanceId), false)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.board[0].attack, 3)
  assert.equal(fixture.state.version, 1)
})

test('spell cast commits healing, hand, payment, and duplicate receipt atomically', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog[0], Name: 'Восстановление', Type: 2, Cost: 1, Description: 'Восстановите 4 здоровья.' , instanceId: 'ci_spell_test' }
  fixture.state.players[0].hand.push(spell)
  fixture.state.players[0].health = 40
  fixture.state.players[0].mana = 1
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.players[0].health, 44)
  assert.equal(fixture.state.players[0].mana, 0)
  assert.equal(fixture.state.players[0].hand.some(card => card.instanceId === spell.instanceId), false)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].health, 44)
  assert.equal(fixture.state.version, 1)
})

test('simple draw spell commits the draw once across command retries', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog[0], Name: 'Простой добор', Type: 2, Cost: 1, Description: 'Возьмите карту.', instanceId: 'ci_draw_spell' }
  const drawn = { ...cardCatalog[1], instanceId: 'ci_drawn_card' }
  fixture.state.players[0].hand = [spell]
  fixture.state.players[0].deck = [drawn]
  fixture.state.players[0].mana = 1
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.deepEqual(fixture.state.players[0].hand, [drawn])
  assert.equal(fixture.state.players[0].deck.length, 0)
  assert.equal(fixture.state.players[0].discard.at(-1).instanceId, spell.instanceId)
  assert.equal(fixture.state.version, 1)
})

test('Подстава sends its spell to the opponent discard once across command retries', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog.find(card => card.Name === 'Подстава'), instanceId: 'ci_prank' }
  fixture.state.players[0].hand = [spell]
  fixture.state.players[0].mana = spell.Cost
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].mana, 0)
  assert.equal(fixture.state.players[0].discard.some(card => card.instanceId === spell.instanceId), false)
  assert.equal(fixture.state.players[1].discard.filter(card => card.instanceId === spell.instanceId).length, 1)
  assert.equal(fixture.state.players[0].hand.some(card => card.instanceId === spell.instanceId), false)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('taking an own saved card is private and receipt-backed without repeating the move', async () => {
  const fixture = setup()
  const saved = { ...cardCatalog[0], instanceId: 'ci_own_saved' }
  const enemySaved = { ...cardCatalog[1], instanceId: 'ci_guest_saved' }
  fixture.state.players[0].saved = [saved]
  fixture.state.players[1].saved = [enemySaved]
  const beforeHand = [...fixture.state.players[0].hand]
  await assert.rejects(applyMatchCommand(fixture.pool, 'owner', command('owner', { action: 'card.takeSaved', data: { cardInstanceId: enemySaved.instanceId } })), error => error.code === 'CARD_NOT_IN_SAVED')
  assert.equal(fixture.updates, 0)
  const request = command('owner', { action: 'card.takeSaved', data: { cardInstanceId: saved.instanceId } })
  const result = await applyMatchCommand(fixture.pool, 'owner', request)
  assert.equal(result.kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.deepEqual(fixture.state.players[0].hand, [...beforeHand, saved])
  assert.equal(fixture.state.players[0].saved.length, 0)
  assert.equal(fixture.state.players[0].played, false)
  const guestView = result.snapshots.find(item => item.userId === 'guest').snapshot
  assert.deepEqual(guestView.private.saved.map(card => card.instanceId), [enemySaved.instanceId])
  assert.equal(JSON.stringify(guestView).includes(saved.instanceId), false)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('catalog pile searches persist private choices and finish once across command retries', async () => {
  for (const name of ['Разбан', 'Ого какой большой огурец']) {
    const fixture = setup()
    const spell = { ...cardCatalog.find(card => card.Name === name), instanceId: 'ci_pile_search' }
    const selected = { ...cardCatalog[0], Cost: 8, instanceId: 'ci_pile_selected' }
    const other = { ...cardCatalog[1], Cost: 9, instanceId: 'ci_pile_other' }
    const pile = name === 'Разбан' ? 'burned' : 'deck'
    fixture.state.players[0].hand = [spell]
    fixture.state.players[0][pile] = [selected, other]
    fixture.state.players[0].mana = spell.Cost
    const castRequest = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
    const cast = await applyMatchCommand(fixture.pool, 'owner', castRequest)
    const choice = cast.snapshots.find(item => item.userId === 'owner').snapshot.private.pendingChoice
    assert.equal(choice.kind, 'spell-search-pile')
    assert.equal(choice.options.length, 2)
    assert.equal(cast.snapshots.find(item => item.userId === 'guest').snapshot.private.pendingChoice, null)
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', castRequest)).kind, 'duplicate')
    assert.equal(fixture.state.players[0].mana, 0)
    assert.equal(fixture.state.players[0].hand[0].instanceId, spell.instanceId)
    const resolve = command('owner', { commandId: 'ad361f25-217d-460c-9d4d-87a223f755f7', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: selected.instanceId } } })
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'applied')
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
    assert.deepEqual(fixture.state.players[0].hand, [selected])
    assert.equal(fixture.state.players[0][pile].some(card => card.instanceId === selected.instanceId), false)
    assert.equal(fixture.state.players[0][pile === 'burned' ? 'burned' : 'discard'].at(-1).instanceId, spell.instanceId)
    assert.equal(fixture.state.pendingChoice, null)
    assert.equal(fixture.state.version, 2)
    assert.equal(fixture.updates, 2)
  }
})

test('catalog corpse trade healing and draw are receipt-backed when cast or burned', async () => {
  for (const burn of [false, true]) {
    const fixture = setup()
    const spell = { ...cardCatalog.find(card => card.Name === 'Сдача трупа'), instanceId: 'ci_corpse_trade' }
    const drawn = { ...cardCatalog[0], instanceId: 'ci_corpse_draw' }
    fixture.state.players[0].health = 30
    fixture.state.players[0].mana = spell.Cost
    fixture.state.players[0].hand = [spell]
    fixture.state.players[0].deck = [drawn]
    if (burn) fixture.state.pendingChoice = { id: 'conveyor-burn', owner: 0, kind: 'ability-conveyor', sourceUnitId: 'conveyor', unitIds: [spell.instanceId], stage: 'burn' }
    const request = command('owner', burn ? { action: 'choice.resolve', data: { choiceId: 'conveyor-burn', selection: { unitId: spell.instanceId } } } : { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
    assert.equal(fixture.state.players[0].health, 35)
    assert.deepEqual(fixture.state.players[0].hand, [drawn])
    assert.equal(fixture.state.players[0][burn ? 'burned' : 'discard'][0].instanceId, spell.instanceId)
    assert.equal(fixture.state.version, 1)
    if (burn) assert.deepEqual(fixture.state.pendingChoice.unitIds, [drawn.instanceId])
  }
})

test('catalog Dragonball draw and optional discard commit once and stay private', async () => {
  for (const discard of [false, true]) {
    const fixture = setup()
    const spell = { ...cardCatalog.find(card => card.Name === '100 правил драгонболла'), instanceId: 'ci_dragonball_spell' }
    fixture.state.players[0].hand = [spell, { ...cardCatalog[0], instanceId: 'ci_original_hand' }]
    fixture.state.players[0].deck = cardCatalog.slice(1, 3).map((card, index) => ({ ...card, instanceId: `ci_dragonball_draw_${index}` }))
    fixture.state.players[0].mana = spell.Cost
    const castRequest = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
    const cast = await applyMatchCommand(fixture.pool, 'owner', castRequest)
    const choice = cast.snapshots.find(item => item.userId === 'owner').snapshot.private.pendingChoice
    assert.equal(choice.kind, 'spell-discard-hand')
    assert.equal(choice.options.length, 3)
    assert.equal(cast.snapshots.find(item => item.userId === 'guest').snapshot.private.pendingChoice, null)
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', castRequest)).kind, 'duplicate')
    const ids = discard ? [choice.options[0].unitId] : []
    const resolve = command('owner', { commandId: '672c7396-ab35-4398-a964-78145d1211d5', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: ids } } })
    const accepted = await applyMatchCommand(fixture.pool, 'owner', resolve)
    assert.equal(accepted.kind, 'applied')
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
    assert.equal(fixture.state.players[0].hand.length, discard ? 2 : 3)
    assert.equal(fixture.state.players[0].mana, 0)
    assert.equal(fixture.state.players[0].deck.length, 0)
    assert.equal(fixture.state.players[0].discard.length, discard ? 2 : 1)
    assert.equal(fixture.state.pendingChoice, null)
    assert.equal(fixture.state.version, 2)
    assert.equal(fixture.updates, 2)
  }
})

test('targeted flip commits its flip trigger only once across retries', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog[0], Name: 'Портал гравитации', Type: 2, Cost: 1, Description: 'Дайте переворот 1 выбранному существу', instanceId: 'ci_flip_spell' }
  fixture.state.players[0].hand.push(spell)
  fixture.state.players[0].mana = 1
  fixture.state.players[1].mana = 0
  const hihho = cardCatalog.find(card => card.Name === '.Хихо')
  fixture.state.board.push({ id: 'hihho', card: hihho, owner: 1, row: 2, col: 2, health: 3, maxHealth: 3, attack: 1, speed: hihho.Speed, blackTokens: 0 })
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: 'hihho' } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  const target = fixture.state.board.find(unit => unit.id === 'hihho')
  assert.equal(target.flippedTurns, 1)
  assert.deepEqual([target.attack, target.health, target.maxHealth, target.speed], [2, 4, 4, 2])
  assert.equal(fixture.state.players[0].mana, 0)
  assert.equal(fixture.state.players[1].mana, 1)
  const handCount = fixture.state.players[1].hand.length
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.players[1].hand.length, handCount)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Tau cannon ability death and burn resolve once across command retries', async () => {
  const fixture = setup()
  const cannon = { ...cardCatalog.find(card => card.Name === 'Тау-пушка'), instanceId: 'ci_tau_cannon' }
  fixture.state.players[0].hand.push(cannon)
  fixture.state.players[0].mana = cannon.Cost
  fixture.state.board.push({ id: 'bearer', card: { ...cardCatalog[0], Name: 'Bearer', Description: '' }, owner: 0, row: 4, col: 2, health: 6, maxHealth: 6, attack: 4, speed: 1, summoned: 0 })
  const equip = command('owner', { commandId: '1cb910da-75f8-4d75-8394-110a24a885a1', action: 'item.equip', data: { cardInstanceId: cannon.instanceId, targetUnitId: 'bearer', payment: 'mana' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', equip)).kind, 'applied')
  const use = command('owner', { commandId: '2db910da-75f8-4d75-8394-110a24a885a2', expectedVersion: 1, action: 'ability.use', data: { unitId: 'bearer', abilityIndex: 0 } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'applied')
  assert.equal(fixture.state.board.some(unit => unit.id === 'bearer'), false)
  assert.equal(fixture.state.players[0].discard.some(card => card.Name === 'Bearer'), true)
  assert.equal(fixture.state.players[0].burned.filter(card => card.Name === 'Тау-пушка').length, 1)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].burned.filter(card => card.Name === 'Тау-пушка').length, 1)
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('Conveyor choices stay private and each selected card commits once', async () => {
  const fixture = setup()
  const description = 'Способность 1⭐: Сбросьте 1 карту, сожгите 1 карту, сберегите 1 карту, возьмите 1 карту.'
  fixture.state.players[0].mana = 1
  fixture.state.board.push({ id: 'conveyor', card: { Id: 'conveyor-card', Name: 'Конвейерное производство', Description: description, Type: 3 }, owner: 0, row: 2, col: 2, health: 3, maxHealth: 3, attack: 0, speed: 0, summoned: 0 })
  const [discarded, burned, saved] = fixture.state.players[0].hand
  fixture.state.players[0].deck.unshift({ Id: 'conveyor-draw', Name: 'Drawn card', Type: 0, Rarity: 0, Class: 0 })
  const use = command('owner', { commandId: '3cb910da-75f8-4d75-8394-110a24a885a3', action: 'ability.use', data: { unitId: 'conveyor', abilityIndex: 0 } })
  const opened = await applyMatchCommand(fixture.pool, 'owner', use)
  const ownerChoice = opened.snapshots.find(item => item.userId === 'owner').snapshot.private.pendingChoice
  const guestChoice = opened.snapshots.find(item => item.userId === 'guest').snapshot.private.pendingChoice
  assert.equal(opened.kind, 'applied')
  assert.equal(ownerChoice.stage, 'discard')
  assert.deepEqual(ownerChoice.options.map(option => option.unitId), fixture.state.players[0].hand.map(card => card.instanceId))
  assert.equal(guestChoice, null)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'duplicate')

  const resolveStep = async (version, choice, card, commandId) => {
    const result = await applyMatchCommand(fixture.pool, 'owner', command('owner', { commandId, expectedVersion: version, action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: card.instanceId } } }))
    assert.equal(result.kind, 'applied')
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', command('owner', { commandId, expectedVersion: version, action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitId: card.instanceId } } }))).kind, 'duplicate')
    return result.snapshots.find(item => item.userId === 'owner').snapshot.private.pendingChoice
  }
  const burnChoice = await resolveStep(1, ownerChoice, discarded, '4cb910da-75f8-4d75-8394-110a24a885a4')
  assert.equal(burnChoice.stage, 'burn')
  const saveChoice = await resolveStep(2, burnChoice, burned, '5cb910da-75f8-4d75-8394-110a24a885a5')
  assert.equal(saveChoice.stage, 'save')
  assert.equal(await resolveStep(3, saveChoice, saved, '6cb910da-75f8-4d75-8394-110a24a885a6'), null)
  assert.equal(fixture.state.players[0].discard.some(card => card.instanceId === discarded.instanceId), true)
  assert.equal(fixture.state.players[0].burned.filter(card => card.instanceId === burned.instanceId).length, 1)
  assert.equal(fixture.state.players[0].saved.some(card => card.instanceId === saved.instanceId), true)
  assert.equal(fixture.state.players[0].hand.filter(card => card.Id === 'conveyor-draw').length, 1)
  assert.equal(fixture.state.version, 4)
  assert.equal(fixture.updates, 4)
})

test('Librarian search stages stay private and the selected card resolves once', async () => {
  const fixture = setup()
  const description = 'Способность N⭐: Если вы потратили 1 ману, то вытащите любую обычную карту, если 2 любую редкую карту, если 4 любую легендарную карту из КД, КС. \nПостоянно: Гамба: Если вы вытаскиваете карту при помощи Библиотекаря.\n1-3 - Вытащенная карта сжигается.\n4-6 - Ничего не происходит.'
  const selected = { Id: 'librarian-common', Name: 'Common target', Type: 0, Rarity: 0, Class: 0, instanceId: 'librarian-common-instance' }
  fixture.state.players[0].mana = 1
  fixture.state.players[0].discard.push(selected)
  fixture.state.board.push({ id: 'librarian', card: { Id: 'librarian-card', Name: 'Библиотекарь', Description: description, Type: 0 }, owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 2, summoned: 0 })
  const use = command('owner', { commandId: 'da719a28-ec9c-430a-9b74-da5890c7f001', action: 'ability.use', data: { unitId: 'librarian', abilityIndex: 0 } })
  const opened = await applyMatchCommand(fixture.pool, 'owner', use)
  const ownerChoice = opened.snapshots.find(item => item.userId === 'owner').snapshot.private.pendingChoice
  assert.equal(ownerChoice.stage, 'cost')
  assert.equal(opened.snapshots.find(item => item.userId === 'guest').snapshot.private.pendingChoice, null)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'duplicate')

  const resolve = async (version, choice, selection, commandId) => applyMatchCommand(fixture.pool, 'owner', command('owner', { commandId, expectedVersion: version, action: 'choice.resolve', data: { choiceId: choice.id, selection } }))
  const cost = await resolve(1, ownerChoice, { choice: 'librarian-cost', cost: 1 }, 'da719a28-ec9c-430a-9b74-da5890c7f002')
  const pileChoice = cost.snapshots.find(item => item.userId === 'owner').snapshot.private.pendingChoice
  assert.equal(pileChoice.stage, 'pile')
  const cardChoiceResult = await resolve(2, pileChoice, { choice: 'librarian-pile', pile: 'discard' }, 'da719a28-ec9c-430a-9b74-da5890c7f003')
  const cardChoice = cardChoiceResult.snapshots.find(item => item.userId === 'owner').snapshot.private.pendingChoice
  assert.deepEqual(cardChoice.options.map(option => option.unitId), [selected.instanceId])
  assert.equal(cardChoiceResult.snapshots.find(item => item.userId === 'guest').snapshot.private.pendingChoice, null)
  const finalCommandId = 'da719a28-ec9c-430a-9b74-da5890c7f004'
  const resolved = await resolve(3, cardChoice, { unitId: selected.instanceId }, finalCommandId)
  assert.equal(resolved.kind, 'applied')
  assert.equal((await resolve(3, cardChoice, { unitId: selected.instanceId }, finalCommandId)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].mana, 0)
  assert.equal(fixture.state.players[0].discard.some(card => card.instanceId === selected.instanceId), false)
  assert.equal(fixture.state.players[0].burned.filter(card => card.instanceId === selected.instanceId).length + fixture.state.players[0].hand.filter(card => card.instanceId === selected.instanceId).length + fixture.state.players[0].saved.filter(card => card.instanceId === selected.instanceId).length, 1)
  assert.equal(fixture.state.pendingChoice, null)
  assert.equal(fixture.state.version, 4)
})

test('global burn spell commits creature burns once across retries', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog[0], Name: 'Сгоревшие сервера', Type: 2, Cost: 1, Description: 'Сожгите всех существ на поле.\nСжигаеться', instanceId: 'ci_global_burn' }
  const targetCard = { ...cardCatalog[1], Id: 'global-burn-target', Name: 'Target', Type: 0 }
  fixture.state.players[0].hand.push(spell)
  fixture.state.players[0].mana = 1
  fixture.state.board.push({ id: 'global-target', card: targetCard, owner: 1, row: 2, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, blackTokens: 0 })
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.board.some(unit => unit.id === 'global-target'), false)
  assert.equal(fixture.state.players[1].burned.some(card => card.Id === targetCard.Id), true)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.players[1].burned.filter(card => card.Id === targetCard.Id).length, 1)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('global flip spell resets durations and applies owner triggers once across retries', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog[0], Name: 'Закрытие бункера', Type: 2, Cost: 1, Description: 'Примените переворот 2 всем картам на поле.', instanceId: 'ci_global_flip' }
  fixture.state.players[0].hand.push(spell)
  fixture.state.players[0].mana = 1
  fixture.state.players[1].mana = 0
  const targetCard = cardCatalog.find(card => card.Name === '.Хихо')
  fixture.state.board.push({ id: 'global-hihho', card: targetCard, owner: 1, row: 2, col: 2, health: 2, maxHealth: 2, attack: 1, speed: targetCard.Speed, flippedTurns: 1, blackTokens: 0 })
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  const target = fixture.state.board.find(unit => unit.id === 'global-hihho')
  assert.equal(target.flippedTurns, 2)
  assert.deepEqual([target.attack, target.health, target.maxHealth, target.speed], [2, 3, 3, 2])
  assert.equal(fixture.state.players[1].mana, 1)
  const handCount = fixture.state.players[1].hand.length
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.players[1].hand.length, handCount)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Фанфик Магната enemy stun commits once across retries', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog[0], Name: 'Фанфик Магната', Type: 2, Cost: 1, Description: 'Восстановите 5 здоровья вашему существу, либо же наложите оглушение 1 на вражеское', instanceId: 'ci_fanfic_spell' }
  fixture.state.players[0].hand.push(spell)
  fixture.state.players[0].mana = 1
  fixture.state.board.push({ id: 'fanfic-enemy', card: { ...cardCatalog[1], Type: 0 }, owner: 1, row: 2, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, blackTokens: 0 })
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: 'fanfic-enemy' } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.board[0].stunned, 1)
  assert.equal(fixture.state.players[0].mana, 0)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.board[0].stunned, 1)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Хопиум buff and end-turn death commit in two exactly-once transitions', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog[0], Name: 'Хопиум', Type: 2, Cost: 1, Description: 'Ваше существо получает 3 3 1, но в конце вашего хода оно умирает.', instanceId: 'ci_hopium' }
  const targetCard = { ...cardCatalog[1], Type: 0, Speed: 2, Id: 'hopium-target-card', Name: 'Target' }
  fixture.state.players[0].hand.push(spell)
  fixture.state.players[0].mana = 1
  fixture.state.board.push({ id: 'hopium-target', card: targetCard, owner: 0, row: 4, col: 2, health: 2, maxHealth: 2, attack: 1, speed: 2, blackTokens: 0 })
  const cast = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: 'hopium-target' } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', cast)).kind, 'applied')
  assert.deepEqual([fixture.state.board[0].attack, fixture.state.board[0].health, fixture.state.board[0].speed, fixture.state.board[0].expiresAtTurnEnd], [4, 5, 1, true])
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', cast)).kind, 'duplicate')
  assert.equal(fixture.state.board[0].attack, 4)

  const end = command('owner', { commandId: '1c36f3f8-e4f5-4808-a504-2cb25d3553c1', expectedVersion: 1, action: 'turn.end', data: {} })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', end)).kind, 'applied')
  assert.equal(fixture.state.board.some(unit => unit.id === 'hopium-target'), false)
  assert.equal(fixture.state.players[0].discard.some(card => card.Id === targetCard.Id), true)
  assert.equal(fixture.state.version, 2)
})

test('Ваня Веремеев end-turn death buff persists once across a duplicate retry', async () => {
  const fixture = setup()
  fixture.state.players[0].played = true
  const vanya = cardCatalog.find(card => card.Name === 'Ваня Веремеев')
  const ally = { ...cardCatalog[0], instanceId: 'ci_vanya_ally' }
  fixture.state.board.push(
    { id: 'vanya', card: { ...vanya, instanceId: 'ci_vanya' }, owner: 0, row: 2, col: 2, health: 1, maxHealth: 1, attack: 1, speed: 1, expiresAtTurnEnd: true, blackTokens: 0 },
    { id: 'vanya-ally', card: ally, owner: 0, row: 3, col: 3, health: 2, maxHealth: 3, attack: 2, speed: 3, blackTokens: 0 },
  )
  const request = command('owner', { action: 'turn.end', data: {} })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.deepEqual([fixture.state.board[0].attack, fixture.state.board[0].health, fixture.state.board[0].maxHealth, fixture.state.board[0].speed], [3, 3, 4, 2])
  assert.equal(fixture.state.players[0].discard.filter(card => card.instanceId === 'ci_vanya').length, 1)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.deepEqual([fixture.state.board[0].attack, fixture.state.board[0].health, fixture.state.board[0].maxHealth, fixture.state.board[0].speed], [3, 3, 4, 2])
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('@.hiho kill and spell burn commit once across retries', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog[0], Name: '@.hiho', Type: 2, Cost: 1, Description: 'Убейте существо. Сжигается', instanceId: 'ci_hiho_kill' }
  const targetCard = { ...cardCatalog[1], Id: 'hiho-target-card', Name: 'Target', Type: 0 }
  fixture.state.players[0].hand.push(spell)
  fixture.state.players[0].mana = 1
  fixture.state.board.push({ id: 'hiho-target', card: targetCard, owner: 1, row: 2, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, shield: true, blackTokens: 0 })
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: 'hiho-target' } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.board.some(unit => unit.id === 'hiho-target'), false)
  assert.equal(fixture.state.players[0].burned.filter(card => card.instanceId === spell.instanceId).length, 1)
  assert.equal(fixture.state.players[1].discard.filter(card => card.Id === targetCard.Id).length, 1)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].burned.filter(card => card.instanceId === spell.instanceId).length, 1)
  assert.equal(fixture.state.players[1].discard.filter(card => card.Id === targetCard.Id).length, 1)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Гнилое ворьё transfers the chosen resource once across retries', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog[0], Name: 'Гнилое ворьё', Type: 2, Cost: 0, Description: 'Получите 2 маны или 4 энергии, противник теряет 2 маны или 4 энергии. Сжигаеться', instanceId: 'ci_rotten_thief' }
  fixture.state.players[0].hand = [spell]
  fixture.state.players[0].mana = 1
  fixture.state.players[1].mana = 1
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', choice: 'mana' } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.deepEqual([fixture.state.players[0].mana, fixture.state.players[1].mana], [2, 0])
  assert.equal(fixture.state.players[0].burned.filter(card => card.instanceId === spell.instanceId).length, 1)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.deepEqual([fixture.state.players[0].mana, fixture.state.players[1].mana], [2, 0])
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Перепись населения gains for the remaining hand once across retries', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog.find(card => card.Name === 'Перепись населения'), instanceId: 'ci_census' }
  const others = [{ ...cardCatalog[0], instanceId: 'ci_census_other1' }, { ...cardCatalog[1], instanceId: 'ci_census_other2' }]
  fixture.state.players[0].hand = [spell, ...others]
  fixture.state.players[0].mana = spell.Cost
  fixture.state.players[0].energy = 1
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.deepEqual([fixture.state.players[0].mana, fixture.state.players[0].energy], [2, 3])
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.deepEqual([fixture.state.players[0].mana, fixture.state.players[0].energy], [2, 3])
  assert.equal(fixture.state.players[0].discard.filter(card => card.instanceId === spell.instanceId).length, 1)
  assert.equal(fixture.updates, 1)
})

test('Засадка пустыни пшеницей persists public tokens once across retries', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog.find(card => card.Name === 'Засадка пустыни пшеницей'), instanceId: 'ci_wheat_spell' }
  fixture.state.players[0].hand = [spell]
  fixture.state.players[0].mana = spell.Cost
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.wheatTokens.length, 15)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.wheatTokens.length, 15)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Swoon death is conditional and commits only once across retries', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog.find(card => card.Name === 'Swoon'), instanceId: 'ci_swoon' }
  const targetCard = { ...cardCatalog[0], Name: 'Swoon target', Type: 0, Description: '' }
  fixture.state.players[0].hand = [spell]
  fixture.state.players[0].mana = spell.Cost
  fixture.state.players[0].burnedThisTurn = true
  fixture.state.board.push({ id: 'swoon-target', card: targetCard, owner: 1, row: 2, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, blackTokens: 0 })
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: 'swoon-target' } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.board.some(unit => unit.id === 'swoon-target'), false)
  assert.equal(fixture.state.players[1].discard.filter(card => card.Name === 'Swoon target').length, 1)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.players[1].discard.filter(card => card.Name === 'Swoon target').length, 1)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Рейджбайт targets either player creature and expires through the creature owner turn', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog.find(card => card.Name === 'Рейджбайт 10 из 10'), instanceId: 'ci_ragebait' }
  const targetCard = { ...cardCatalog[0], Name: 'Rage target', Type: 0, Description: '' }
  fixture.state.players[0].hand = [spell]
  fixture.state.players[0].mana = spell.Cost
  fixture.state.players[0].played = true
  fixture.state.players[1].played = true
  fixture.state.board.push({ id: 'rage-target', card: targetCard, owner: 1, row: 2, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, blackTokens: 0 })
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: 'rage-target' } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.board[0].temporaryRage, true)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  const endOwner = command('owner', { commandId: '8c4937f8-357e-48ea-9b21-5291b4696f19', expectedVersion: 1, action: 'turn.end', data: {} })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', endOwner)).kind, 'applied')
  assert.equal(fixture.state.board.length, 1)
  const endTarget = command('guest', { commandId: 'fa32dbe9-6e43-45c8-bc9e-367525f2d1c6', expectedVersion: 2, action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'guest', endTarget)).kind, 'applied')
  assert.equal(fixture.state.board.length, 0)
  assert.equal(fixture.state.players[1].discard.filter(card => card.Name === 'Rage target').length, 1)
})

test('5000 участников destroys flipped cards and applies remaining flips exactly once', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog.find(card => card.Name === '5000 участников'), instanceId: 'ci_five_thousand' }
  fixture.state.players[0].hand = [spell]
  fixture.state.players[0].mana = spell.Cost
  fixture.state.board.push(
    { id: 'flipped', card: { ...cardCatalog[0], Name: 'Flipped creature', Description: '' }, owner: 1, row: 2, col: 1, health: 2, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0, flippedTurns: 1 },
    { id: 'active', card: { ...cardCatalog[1], Name: 'Active creature', Description: '' }, owner: 0, row: 2, col: 2, health: 4, maxHealth: 4, attack: 2, speed: 1, blackTokens: 0 },
  )
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.deepEqual(fixture.state.board.map(unit => [unit.id, unit.flippedTurns]), [['active', 2]])
  assert.equal(fixture.state.players[1].discard.some(card => card.Name === 'Flipped creature'), true)
  assert.equal(fixture.state.version, 1)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.version, 1)
})

test('Hoppy saves a hidden flipped card privately and commits the choice only once', async () => {
  const fixture = setup()
  const hoppy = { ...cardCatalog.find(card => card.Name === 'Hoppy'), instanceId: 'ci_hoppy' }
  const item = { ...cardCatalog.find(card => card.Type === 1), Id: 'hidden-item', Name: 'Hidden item', Description: '', instanceId: 'ci_hidden_item' }
  fixture.state.players[0].hand = [hoppy]
  fixture.state.players[0].mana = hoppy.Cost
  fixture.state.board.push({ id: 'face-down', card: { ...cardCatalog.find(card => card.Type === 0), Id: 'hidden-creature', Name: 'Secret creature', Description: '', instanceId: 'ci_secret_creature' }, item, owner: 1, row: 1, col: 2, health: 0, maxHealth: 3, attack: 0, speed: 0, blackTokens: 0, flippedTurns: 1 })
  const cast = command('owner', { action: 'card.play', data: { cardInstanceId: hoppy.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', cast)).kind, 'applied')
  assert.equal(fixture.state.pendingChoice.kind, 'entry-save-flipped')
  const snapshotPool = { async query(_sql, values) { return { rows: [{ state_json: fixture.state, seat: values[1] === 'guest' ? 1 : 0 }] } } }
  const ownerView = await readMatchSnapshot(snapshotPool, 'owner', fixture.state.id)
  const guestView = await readMatchSnapshot(snapshotPool, 'guest', fixture.state.id)
  assert.equal(ownerView.private.pendingChoice.options[0].name, 'Перевёрнутая карта · 2, 3')
  assert.equal(JSON.stringify(ownerView).includes('Secret creature'), false)
  assert.equal(JSON.stringify(ownerView).includes('Hidden item'), false)
  assert.equal(guestView.private.pendingChoice, null)
  assert.equal(JSON.stringify(guestView).includes('ci_secret_creature'), false)

  const resolve = command('owner', { commandId: '629f7d93-02dc-4fd8-a2c4-79b83b1d2c88', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { unitId: 'face-down' } } })
  const resolved = await applyMatchCommand(fixture.pool, 'owner', resolve)
  assert.equal(resolved.kind, 'applied')
  assert.equal(JSON.stringify(resolved.events).includes(item.instanceId), false)
  assert.equal(fixture.state.players[0].saved[0].instanceId, 'ci_secret_creature')
  assert.equal(fixture.state.players[1].discard.some(card => card.instanceId === item.instanceId), true)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.version, 2)
})

test('Half-life 3 destroys its selected creature count once and keeps the choice private', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog.find(card => card.Name === 'Half-life 3'), instanceId: 'ci_half_life' }
  fixture.state.players[0].hand = [spell]
  fixture.state.players[0].mana = spell.Cost
  fixture.state.board.push(
    { id: 'flipped', card: { ...cardCatalog[0], Name: 'Flipped card', Type: 3 }, owner: 1, row: 1, col: 1, health: 0, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0, flippedTurns: 1 },
    { id: 'target-one', card: { ...cardCatalog.find(card => card.Type === 0), Name: 'First target', Description: '' }, owner: 1, row: 2, col: 2, health: 2, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0 },
    { id: 'target-two', card: { ...cardCatalog.find(card => card.Type === 0), Name: 'Second target', Description: '' }, owner: 0, row: 3, col: 3, health: 2, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0 },
  )
  const cast = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', cast)).kind, 'applied')
  assert.equal(fixture.state.pendingChoice.kind, 'spell-destroy-creatures')
  const snapshotPool = { async query(_sql, values) { return { rows: [{ state_json: fixture.state, seat: values[1] === 'guest' ? 1 : 0 }] } } }
  assert.equal((await readMatchSnapshot(snapshotPool, 'owner', fixture.state.id)).private.pendingChoice.count, 1)
  assert.equal((await readMatchSnapshot(snapshotPool, 'guest', fixture.state.id)).private.pendingChoice, null)

  const resolve = command('owner', { commandId: '7b4ca0e6-377c-4aec-93b2-95c0dbb1c310', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { unitIds: ['target-one'] } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'applied')
  assert.deepEqual(fixture.state.board.map(unit => unit.id), ['flipped', 'target-two'])
  assert.equal(fixture.state.players[1].discard.some(card => card.Name === 'First target'), true)
  assert.equal(fixture.state.version, 2)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.version, 2)
})

test('Ледяной шок preserves a lethally hit target flipped across command retries', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog.find(card => card.Name === 'Ледяной шок'), instanceId: 'ci_ice_shock' }
  fixture.state.players[0].hand = [spell]
  fixture.state.players[0].mana = spell.Cost
  fixture.state.board.push({ id: 'ice-target', card: { ...cardCatalog[0], Name: 'Ice target', Description: '' }, owner: 1, row: 2, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, blackTokens: 0 })
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: 'ice-target' } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.deepEqual([fixture.state.board.length, fixture.state.board[0].health, fixture.state.board[0].flippedTurns], [1, 0, 2])
  assert.equal(fixture.state.players[1].discard.some(card => card.Name === 'Ice target'), false)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.board[0].flippedTurns, 2)
})

test('Знаком по ебалу exposes a private save choice and resolves it once', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog.find(card => card.Name === 'Знаком по ебалу'), instanceId: 'ci_znak' }
  const savedCard = { ...cardCatalog[0], instanceId: 'ci_saved_card' }
  fixture.state.players[0].hand = [spell, savedCard]
  fixture.state.players[0].mana = spell.Cost
  fixture.state.board.push({ id: 'znak-target', card: { ...cardCatalog[0], Name: 'Znak target', Description: '' }, owner: 1, row: 2, col: 2, health: 1, maxHealth: 1, attack: 1, speed: 1, blackTokens: 0 })
  const cast = command('owner', { commandId: '21f7795c-9a43-4a5f-b7ba-707725f49a54', action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: 'znak-target' } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', cast)).kind, 'applied')
  assert.equal(fixture.state.pendingChoice.kind, 'spell-save-hand')
  const snapshotPool = { async query(_sql, values) { return { rows: [{ state_json: fixture.state, seat: values[1] === 'guest' ? 1 : 0 }] } } }
  const ownerView = await readMatchSnapshot(snapshotPool, 'owner', fixture.state.id)
  const guestView = await readMatchSnapshot(snapshotPool, 'guest', fixture.state.id)
  assert.equal(ownerView.private.pendingChoice.options[0].unitId, savedCard.instanceId)
  assert.equal(guestView.private.pendingChoice, null)
  assert.equal(JSON.stringify(guestView).includes(savedCard.instanceId), false)
  assert.equal(fixture.state.pendingChoice.id.includes(spell.instanceId), false)

  const resolve = command('owner', { commandId: 'c371dd85-37c8-4ff2-b4fc-920dcb157f8e', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { unitIds: [savedCard.instanceId] } } })
  const resolved = await applyMatchCommand(fixture.pool, 'owner', resolve)
  assert.equal(resolved.kind, 'applied')
  assert.equal(JSON.stringify(resolved.events).includes(spell.instanceId), false)
  assert.equal(JSON.stringify(resolved.events).includes(savedCard.instanceId), false)
  assert.equal(fixture.state.players[0].saved[0].instanceId, savedCard.instanceId)
  assert.equal(fixture.state.players[0].hand.length, 0)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].saved.length, 1)
})

test('Брутфорс exposes opponent-row sockets privately and resolves the move once', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog.find(card => card.Name === 'Брутфорс'), instanceId: 'ci_bruteforce' }
  fixture.state.players[0].hand = [spell]
  fixture.state.players[0].mana = spell.Cost
  fixture.state.board.push({ id: 'bruteforce-target', card: { ...cardCatalog[0], Name: 'Bruteforce target', Description: '' }, owner: 1, row: 1, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, blackTokens: 0 })
  const cast = command('owner', { commandId: 'dbfd6e5a-b3d5-4c06-8e67-975e2b7c047c', action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: 'bruteforce-target' } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', cast)).kind, 'applied')
  assert.equal(fixture.state.pendingChoice.mode, 'opponent')
  assert.ok(fixture.state.pendingChoice.cells.every(cell => cell.row === 0))
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', cast)).kind, 'duplicate')
  const pool = { async query(_sql, values) { return { rows: [{ state_json: fixture.state, seat: values[1] === 'guest' ? 1 : 0 }] } } }
  const guestView = await readMatchSnapshot(pool, 'guest', fixture.state.id)
  assert.equal(guestView.private.pendingChoice, null)
  assert.equal(JSON.stringify(guestView.private).includes('bruteforce-target'), false)

  const resolve = command('owner', { commandId: '50a36269-4374-4ea3-acce-91f813cc0711', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { cell: { row: 0, col: 4 } } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'applied')
  assert.deepEqual([fixture.state.board[0].row, fixture.state.board[0].col], [0, 4])
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.deepEqual([fixture.state.board[0].row, fixture.state.board[0].col], [0, 4])
})

test('В следующий раз повезёт reruns return the committed gamba result without rolling again', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog.find(card => card.Name === 'В следующий раз повезёт'), instanceId: 'ci_gamba_spell' }
  fixture.state.players[0].hand = [spell]
  fixture.state.players[0].mana = spell.Cost
  fixture.state.board.push({ id: 'gamba-target', card: { ...cardCatalog[0], Name: 'Gamba target', Description: '' }, owner: 1, row: 2, col: 2, health: 7, maxHealth: 7, attack: 1, speed: 1, blackTokens: 0 })
  const originalRandom = Math.random
  let rolls = 0
  Math.random = () => { rolls++; return 0.5 }
  try {
    const request = command('owner', { commandId: '5fb85281-6f2a-4afc-b7ca-815cf0851aa0', action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: 'gamba-target' } } })
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
    assert.equal(fixture.state.board[0].health, 3)
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
    assert.equal(fixture.state.board[0].health, 3)
    assert.equal(rolls, 1)
  } finally {
    Math.random = originalRandom
  }
})

test('Дискорд драма persists chosen mana and score-doubled target damage once', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog.find(card => card.Name === 'Дискорд драма'), instanceId: 'ci_discord_drama' }
  fixture.state.players[0].hand = [spell, ...Array.from({ length: 7 }, (_, index) => ({ ...cardCatalog[index], instanceId: `ci_held_${index}` }))]
  fixture.state.players[0].mana = 10
  fixture.state.board.push({ id: 'discord-target', card: { ...cardCatalog[0], Name: 'Discord target', Description: '' }, owner: 1, row: 2, col: 2, health: 20, maxHealth: 20, attack: 1, speed: 1, blackTokens: 0 })
  const request = command('owner', { commandId: '09751cdb-318d-4b0e-9cfd-78b186180957', action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: 'discord-target' }, manaAmount: 3 } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.players[0].mana, 7)
  assert.equal(fixture.state.board[0].health, 17)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].mana, 7)
  assert.equal(fixture.state.board[0].health, 17)
})

test('Додеп keeps the gamba roll private and commits the burn and resource choice once', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog.find(card => card.Name === 'Додеп'), instanceId: 'ci_dodep_spell' }
  const burn = { ...cardCatalog[0], instanceId: 'ci_dodep_burn' }
  fixture.state.players[0].hand = [spell, burn]
  fixture.state.players[0].mana = spell.Cost
  const originalRandom = Math.random
  let rolls = 0
  Math.random = () => { rolls++; return 0.5 }
  try {
    const cast = command('owner', { commandId: 'dcdcbce0-6e52-4624-b32a-36428dbbed87', action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', cast)).kind, 'applied')
    assert.equal(fixture.state.pendingChoice.stage, 'burn')
    const burnChoice = command('owner', { expectedVersion: 1, commandId: '454a85bd-c449-4303-97a0-3ace91ca8732', action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { unitId: burn.instanceId } } })
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', burnChoice)).kind, 'applied')
    assert.equal(rolls, 1)
    assert.equal(fixture.state.pendingChoice.amount, 4)
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', burnChoice)).kind, 'duplicate')
    assert.equal(rolls, 1)
    const snapshotPool = { async query(_sql, values) { return { rows: [{ state_json: fixture.state, seat: values[1] === 'guest' ? 1 : 0 }] } } }
    const ownerView = await readMatchSnapshot(snapshotPool, 'owner', fixture.state.id)
    const guestView = await readMatchSnapshot(snapshotPool, 'guest', fixture.state.id)
    assert.equal(ownerView.private.pendingChoice.amount, 4)
    assert.equal(guestView.private.pendingChoice, null)
    assert.equal(JSON.stringify(guestView).includes('ci_dodep_burn'), false)
    const beforeEnergy = fixture.state.players[0].energy
    const reward = command('owner', { expectedVersion: 2, commandId: '498734da-bbf9-4138-995d-83a09a55ae45', action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { choice: 'energy' } } })
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', reward)).kind, 'applied')
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', reward)).kind, 'duplicate')
    assert.equal(fixture.state.players[0].energy, beforeEnergy + 4)
    assert.equal(fixture.state.pendingChoice, null)
  } finally {
    Math.random = originalRandom
  }
})

test('Роза зло spends health and deals that damage once across command retries', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog.find(card => card.Name === 'Роза зло'), instanceId: 'ci_rose_zlo' }
  fixture.state.players[0].hand = [spell]
  fixture.state.players[0].mana = spell.Cost
  fixture.state.players[0].health = 20
  fixture.state.board.push({ id: 'rose-target', card: { ...cardCatalog[0], Name: 'Rose target', Description: '' }, owner: 1, row: 2, col: 2, health: 10, maxHealth: 10, attack: 1, speed: 1, blackTokens: 0 })
  const request = command('owner', { commandId: '0eff213f-5ce9-44ac-a10d-15d0157c4a44', action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: 'rose-target' }, healthAmount: 4 } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.players[0].health, 16)
  assert.equal(fixture.state.board[0].health, 6)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].health, 16)
  assert.equal(fixture.state.board[0].health, 6)
})

test('Х-Слеш heals by a creature target health once through the server command', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog.find(card => card.Name === 'Х-Слеш'), instanceId: 'ci_x_slash' }
  fixture.state.players[0].hand = [spell]
  fixture.state.players[0].health = 30
  fixture.state.players[0].mana = spell.Cost
  fixture.state.board.push({ id: 'slash-target', card: { ...cardCatalog[0], Name: 'Slash target', Description: '' }, owner: 1, row: 2, col: 2, health: 2, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0 })
  const request = command('owner', { commandId: 'fdd71f96-952e-4ee8-a2ab-8cb6438598aa', action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: 'slash-target' } } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.players[0].health, 32)
  assert.equal(fixture.state.board.length, 0)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].health, 32)
})

test('Хаешка persists its target and area damage exactly once across command retries', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog[0], Name: 'Хаешка', Type: 2, Cost: 2, Description: 'Нанесите 3 урона всем существа по площади 3х3 сокета.', instanceId: 'ci_area_spell' }
  fixture.state.players[0].hand = [spell]
  fixture.state.players[0].mana = 2
  fixture.state.board.push({ id: 'near', card: cardCatalog[0], owner: 1, row: 2, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, blackTokens: 0 })
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { row: 2, col: 2 } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.board[0].health, 2)
  assert.equal(fixture.state.players[0].mana, 0)
  assert.equal(fixture.state.version, 1)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.board[0].health, 2)
  assert.equal(fixture.state.version, 1)
})

test('selected-target damage spell validates and persists the target exactly once', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog[0], Name: 'Нёрд реакт', Type: 2, Cost: 0, Description: 'Нанесите 1 урон выбранной цели.', instanceId: 'ci_target_spell' }
  fixture.state.players[0].hand = [spell]
  fixture.state.board.push({ id: 'selected', card: cardCatalog[0], owner: 1, row: 2, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, blackTokens: 0 })
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: 'selected' } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.board[0].health, 2)
  assert.equal(fixture.state.version, 1)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.board[0].health, 2)
  assert.equal(fixture.state.version, 1)
})

test('@everyone global damage spell persists once and duplicate commands do not repeat it', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog[0], Name: '@everyone', Type: 2, Cost: 0, Description: 'Нанесите 1 урон всем существам на поле', instanceId: 'ci_global_damage' }
  fixture.state.players[0].hand = [spell]
  fixture.state.board.push(
    { id: 'ally', card: cardCatalog[0], owner: 0, row: 4, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1, blackTokens: 0 },
    { id: 'enemy', card: cardCatalog[0], owner: 1, row: 0, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1, blackTokens: 0 },
  )
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.deepEqual(fixture.state.board.map(unit => unit.health), [2, 2])
  assert.equal(fixture.state.version, 1)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.deepEqual(fixture.state.board.map(unit => unit.health), [2, 2])
  assert.equal(fixture.state.version, 1)
})

test('Новый видос healing and burn commit once across command retries', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog[0], Name: 'Новый видос', Type: 2, Cost: 1, Description: 'Востановите 15 здоровья. Сжигаеться', instanceId: 'ci_new_video' }
  fixture.state.players[0].hand = [spell]
  fixture.state.players[0].health = 35
  fixture.state.players[0].mana = 1
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.players[0].health, 45)
  assert.deepEqual(fixture.state.players[0].burned.map(card => card.instanceId), [spell.instanceId])
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].health, 45)
  assert.deepEqual(fixture.state.players[0].burned.map(card => card.instanceId), [spell.instanceId])
  assert.equal(fixture.state.version, 1)
})

test('Брэпси healing and burn commit once across command retries', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog[0], Name: 'Брэпси', Type: 2, Cost: 1, Description: 'Восстановите 10 здоровья и сожгите карту.\nСжигается', instanceId: 'ci_brapsi' }
  fixture.state.players[0].hand = [spell]
  fixture.state.players[0].health = 30
  fixture.state.players[0].mana = 1
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.players[0].health, 40)
  assert.deepEqual(fixture.state.players[0].burned.map(card => card.instanceId), [spell.instanceId])
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].health, 40)
  assert.deepEqual(fixture.state.players[0].burned.map(card => card.instanceId), [spell.instanceId])
  assert.equal(fixture.state.version, 1)
})

test('Город без души destroys its selected building once across command retries', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog[0], Name: 'Город без души', Type: 2, Cost: 1, Description: 'Уничтожьте здание.', instanceId: 'ci_destroy_building' }
  fixture.state.players[0].hand = [spell]
  fixture.state.players[0].mana = 1
  fixture.state.board.push({ id: 'building', card: { ...cardCatalog[0], Name: 'Fortress', Description: '', Type: 3 }, owner: 1, row: 0, col: 0, health: 5, maxHealth: 5, attack: 0, speed: 0, shield: true, blackTokens: 0 })
  const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: 'building' } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.deepEqual(fixture.state.board, [])
  assert.equal(fixture.state.players[1].discard.some(card => card.Name === 'Fortress'), true)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.deepEqual(fixture.state.board, [])
  assert.equal(fixture.state.version, 1)
})

test('Кик and Мут persist selected-card transfers once across command retries', async () => {
  for (const [name, description, destination] of [
    ['Кик', 'Сбросьте выбранное существо или здание.', 'discard'],
    ['Мут', 'Верните выбранную карту обратно в руку.', 'hand'],
  ]) {
    const fixture = setup()
    const spell = { ...cardCatalog[0], Name: name, Type: 2, Cost: 0, Description: description, instanceId: `ci_${name}` }
    const target = { ...cardCatalog[0], Name: 'Transferred', Description: '', instanceId: `ci_target_${name}` }
    fixture.state.players[0].hand = [spell]
    fixture.state.board.push({ id: `target_${name}`, card: target, owner: 1, row: 0, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1, blackTokens: 0 })
    const request = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana', target: { unitId: `target_${name}` } } })
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
    assert.equal(fixture.state.board.length, 0)
    assert.ok(fixture.state.players[1][destination].some(card => card.instanceId === target.instanceId))
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
    assert.equal(fixture.state.board.length, 0)
    assert.equal(fixture.state.players[1][destination].filter(card => card.instanceId === target.instanceId).length, 1)
    assert.equal(fixture.state.version, 1)
  }
})

test('Рокировочка commits its paid private choice and both positions once', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog[0], Name: 'Рокировочка', Type: 2, Cost: 3, Description: 'Выберите двух существ - они меняются местами', instanceId: 'ci_swap_spell' }
  fixture.state.players[0].hand = [spell]
  fixture.state.players[0].mana = 3
  fixture.state.board.push(
    { id: 'friendly', card: { Id: 'friendly-card', Name: 'Friendly', Type: 0 }, owner: 0, row: 4, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'enemy', card: { Id: 'enemy-card', Name: 'Enemy', Type: 0 }, owner: 1, row: 2, col: 3, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const cast = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', cast)).kind, 'applied')
  assert.equal(fixture.state.players[0].mana, 0)
  assert.deepEqual(fixture.state.pendingChoice.unitIds, ['friendly', 'enemy'])
  assert.equal(fixture.state.pendingChoice.count, 2)
  assert.equal(fixture.state.pendingChoice.id.includes(spell.instanceId), false)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', cast)).kind, 'duplicate')
  const resolve = command('owner', { commandId: 'b356cae2-6804-4bb7-8db5-82a52e3f7cad', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { unitIds: ['friendly', 'enemy'] } } })
  const resolved = await applyMatchCommand(fixture.pool, 'owner', resolve)
  assert.equal(resolved.kind, 'applied')
  assert.equal(JSON.stringify(resolved.events).includes(spell.instanceId), false)
  assert.deepEqual([fixture.state.board.find(unit => unit.id === 'friendly').row, fixture.state.board.find(unit => unit.id === 'friendly').col], [2, 3])
  assert.deepEqual([fixture.state.board.find(unit => unit.id === 'enemy').row, fixture.state.board.find(unit => unit.id === 'enemy').col], [4, 2])
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('1 апреля swaps creature stats once across duplicate cast and choice retries', async () => {
  const fixture = setup()
  const spell = { ...cardCatalog.find(card => card.Name === '1 апреля'), instanceId: 'ci_april' }
  fixture.state.players[0].hand = [spell]
  fixture.state.players[0].mana = spell.Cost
  fixture.state.board.push(
    { id: 'first', card: { Id: 'first-card', Name: 'First', Type: 0 }, owner: 0, row: 4, col: 1, health: 2, maxHealth: 5, attack: 1, speed: 1, energyCostReduction: 1, blackTokens: 2, typeTokens: [1, 0, 0, 0, 0, 0], temporaryAttack: 2, temporaryHealth: 1, temporaryHealthExpiresAt: 3 },
    { id: 'second', card: { Id: 'second-card', Name: 'Second', Type: 0 }, owner: 1, row: 0, col: 3, health: 4, maxHealth: 4, attack: 3, speed: 2, energyCostReduction: 0, blackTokens: 1, typeTokens: [0, 2, 0, 0, 0, 0], temporaryAttack: 0, temporaryHealth: 0, temporaryHealthExpiresAt: 0 },
  )
  const cast = command('owner', { action: 'spell.cast', data: { cardInstanceId: spell.instanceId, payment: 'mana' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', cast)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', cast)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].mana, 0)
  const choice = fixture.state.pendingChoice
  assert.equal(choice.kind, 'spell-swap-stats')
  const resolve = command('owner', { commandId: 'd356cae2-6804-4bb7-8db5-82a52e3f7ca1', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: choice.id, selection: { unitIds: ['first', 'second'] } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.deepEqual([fixture.state.board[0].attack, fixture.state.board[0].health, fixture.state.board[0].maxHealth, fixture.state.board[0].blackTokens], [3, 4, 4, 1])
  assert.deepEqual([fixture.state.board[0].typeTokens, fixture.state.board[1].typeTokens], [[0, 2, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0]])
  assert.deepEqual([fixture.state.board[0].row, fixture.state.board[0].col, fixture.state.board[1].row, fixture.state.board[1].col], [4, 1, 0, 3])
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('choice resolution commits once and a duplicate does not repeat healing', async () => {
  const fixture = setup()
  fixture.state.board.push({ id: 'wounded', card: { Id: 'wounded', Name: 'Wounded', Type: 0 }, owner: 0, row: 4, col: 1, health: 1, maxHealth: 4, attack: 1, speed: 1, blackTokens: 0 })
  fixture.state.pendingChoice = { id: 'choice-1', owner: 0, kind: 'heal-creature', sourceUnitId: 'source', unitIds: ['wounded'], entryTokens: 0 }
  const request = command('owner', { action: 'choice.resolve', data: { choiceId: 'choice-1', selection: { unitId: 'wounded' } } })
  const accepted = await applyMatchCommand(fixture.pool, 'owner', request)
  assert.equal(accepted.kind, 'applied')
  assert.equal(fixture.state.board[0].health, 4)
  assert.equal(fixture.state.pendingChoice, null)
  assert.equal(fixture.state.version, 1)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.board[0].health, 4)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('a lethal death trigger and its victory commit once', async () => {
  const fixture = setup()
  fixture.state.players[0].health = 3
  fixture.state.board.push(
    { id: 'attacker', card: { Id: 'attacker-card', Name: 'Attacker', Type: 0 }, owner: 0, row: 4, col: 2, health: 7, maxHealth: 7, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'bomber', card: { Id: 'bomber-card', Name: 'Подрывник', Type: 0 }, owner: 1, row: 3, col: 2, health: 2, maxHealth: 2, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const request = command('owner', { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'bomber' } })
  const accepted = await applyMatchCommand(fixture.pool, 'owner', request)
  assert.equal(accepted.kind, 'applied')
  assert.equal(fixture.status, 'finished')
  assert.equal(fixture.state.players[0].health, 0)
  assert.equal(fixture.state.winnerUserId, 'guest')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('a crown draw is persisted once and a retry uses the original receipt', async () => {
  const fixture = setup()
  fixture.state.board.push(
    { id: 'attacker', card: { Id: 'mint-card', Name: 'Минт', Description: 'Порыв\nКоронный: Возьмите карту', Type: 0 }, owner: 0, row: 4, col: 2, health: 7, maxHealth: 7, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'defender', card: { Id: 'defender-card', Name: 'Defender', Type: 0 }, owner: 1, row: 3, col: 2, health: 6, maxHealth: 6, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const initialHand = fixture.state.players[0].hand.length
  const initialDeck = fixture.state.players[0].deck.length
  const request = command('owner', { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'defender' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.players[0].hand.length, initialHand + 1)
  assert.equal(fixture.state.players[0].deck.length, initialDeck - 1)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].hand.length, initialHand + 1)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Admin crossbow equipment commits once across command retries', async () => {
  const fixture = setup()
  const item = { ...cardCatalog.find(card => card.Name === 'Админский арбалет'), instanceId: 'ci_admin_crossbow' }
  fixture.state.players[0].hand.push(item)
  fixture.state.players[0].mana = item.Cost
  fixture.state.board.push({ id: 'crossbow-bearer', card: { ...cardCatalog[0], Name: 'Bearer', Attack: 12 }, owner: 0, row: 4, col: 2, health: 6, maxHealth: 6, attack: 12, speed: 1, summoned: 0, attacks: 0 })
  const request = command('owner', { action: 'item.equip', data: { cardInstanceId: item.instanceId, targetUnitId: 'crossbow-bearer', payment: 'mana' } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.board.find(unit => unit.id === 'crossbow-bearer').attack, 2)
  assert.equal(fixture.state.players[0].mana, 0)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.board.find(unit => unit.id === 'crossbow-bearer').attack, 2)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Mace crown stun commits once across attack command retries', async () => {
  const fixture = setup()
  const item = cardCatalog.find(card => card.Name === 'Булава')
  fixture.state.board.push(
    { id: 'mace-bearer', card: { ...cardCatalog[0], Name: 'Bearer' }, item, owner: 0, row: 4, col: 2, health: 6, maxHealth: 6, attack: 3 + item.Attack, speed: 1, summoned: 0, attacks: 0 },
    { id: 'mace-target', card: { ...cardCatalog[1], Name: 'Target', Type: 0 }, owner: 1, row: 3, col: 2, health: 10, maxHealth: 10, attack: 0, speed: 1, summoned: 0 },
  )
  const request = command('owner', { action: 'unit.attack', data: { unitId: 'mace-bearer', targetUnitId: 'mace-target' } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.board.find(unit => unit.id === 'mace-target').stunned, 1)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.board.find(unit => unit.id === 'mace-target').stunned, 1)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Dupe score-adjustment ability commits once across command retries', async () => {
  const fixture = setup()
  const card = cardCatalog.find(candidate => candidate.Name === 'Дюп')
  fixture.state.board.push({ id: 'dupe-bearer', card: { ...cardCatalog[0], Name: 'Bearer', Description: card.Description }, owner: 0, row: 4, col: 2, health: 6, maxHealth: 6, attack: 3, speed: 1, summoned: 0, blackTokens: 1 })
  const request = command('owner', { action: 'ability.use', data: { unitId: 'dupe-bearer', abilityIndex: 0, scoreAdjustment: 1 } })

  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.players[0].nextScoreAdjustment, 1)
  assert.equal(fixture.state.board[0].blackTokens, 0)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].nextScoreAdjustment, 1)
  assert.equal(fixture.state.board[0].blackTokens, 0)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('trap control transfer commits once and retries do not reapply it', async () => {
  const fixture = setup()
  fixture.state.board.push(
    { id: 'attacker', card: { Id: 'attacker-card', Name: 'Attacker', Type: 0 }, owner: 0, row: 4, col: 2, health: 7, maxHealth: 7, attack: 3, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'trap', card: { Id: 'trap-card', Name: 'Джон совиный дом', Description: 'Ловушка: Нападавший становится вашим существом.', Type: 0 }, owner: 1, row: 3, col: 2, health: 20, maxHealth: 20, attack: 0, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const request = command('owner', { action: 'unit.attack', data: { unitId: 'attacker', targetUnitId: 'trap' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'applied')
  assert.equal(fixture.state.board.find(unit => unit.id === 'attacker').owner, 1)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', request)).kind, 'duplicate')
  assert.equal(fixture.state.board.find(unit => unit.id === 'attacker').owner, 1)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('targeted ability choice, payment, and healing persist and deduplicate in two commands', async () => {
  const fixture = setup()
  fixture.state.players[0].mana = 3
  fixture.state.board.push(
    { id: 'rosa', card: { Id: 'rosa-card', Name: 'Роза Кварц', Description: 'Способность 3: Восстанавливает выбранному существу 3 здоровья и даёт щит.', Type: 0 }, owner: 0, row: 4, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'wounded', card: { Id: 'wounded-card', Name: 'Wounded', Type: 0 }, owner: 1, row: 3, col: 2, health: 1, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const use = command('owner', { action: 'ability.use', data: { unitId: 'rosa', abilityIndex: 0 } })
  const started = await applyMatchCommand(fixture.pool, 'owner', use)
  assert.equal(started.kind, 'applied')
  assert.deepEqual(started.events, [{ type: 'ability.used', unitId: 'rosa', abilityIndex: 0 }])
  assert.equal(fixture.state.players[0].mana, 0)
  assert.deepEqual(started.snapshots.find(item => item.userId === 'owner').snapshot.private.pendingChoice.options.map(option => option.unitId), ['rosa', 'wounded'])
  assert.equal(started.snapshots.find(item => item.userId === 'guest').snapshot.private.pendingChoice, null)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'duplicate')
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)

  const resolve = command('owner', { commandId: 'b156cae2-6804-4bb7-8db5-82a52e3f7ca7', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { unitId: 'wounded' } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'applied')
  assert.equal(fixture.state.board.find(unit => unit.id === 'wounded').health, 4)
  assert.equal(fixture.state.board.find(unit => unit.id === 'wounded').shield, true)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.board.find(unit => unit.id === 'wounded').health, 4)
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('Suzy opponent-health target is private and a lethal choice resolves once', async () => {
  const fixture = setup()
  fixture.state.players[0].mana = 5
  fixture.state.players[1].health = 8
  fixture.state.board.push({ id: 'suzy', card: { Id: 'suzy-card', Name: 'Сьюзи', Description: 'Способность 5: Наносит 8 урона выбранной цели.', Type: 0 }, owner: 0, row: 0, col: 2, health: 4, maxHealth: 4, attack: 7, speed: 2, summoned: 0, attacks: 0, blackTokens: 0 })
  const use = command('owner', { action: 'ability.use', data: { unitId: 'suzy', abilityIndex: 0 } })
  const started = await applyMatchCommand(fixture.pool, 'owner', use)
  const choice = fixture.state.pendingChoice
  assert.equal(started.kind, 'applied')
  assert.equal(started.snapshots.find(item => item.userId === 'owner').snapshot.private.pendingChoice.playerTarget, true)
  assert.equal(started.snapshots.find(item => item.userId === 'guest').snapshot.private.pendingChoice, null)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'duplicate')
  assert.equal(fixture.state.players[1].health, 8)

  const resolve = command('owner', { commandId: 'd156cae2-6804-4bb7-8db5-82a52e3f7ca9', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: choice.id, selection: { player: 'opponent' } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'applied')
  assert.equal(fixture.state.players[1].health, 0)
  assert.equal(fixture.state.status, 'finished')
  assert.equal(fixture.state.winnerUserId, 'owner')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('Backstage choice moves its target and attached item exactly once', async () => {
  const fixture = setup()
  fixture.state.players[0].mana = 5
  fixture.state.board.push(
    { id: 'backstage', card: { Id: 'backstage-card', Name: 'Закулисье', Description: 'Способность 5⭐: Выбранное существо отправляется наверх КД владельца.', Type: 3 }, owner: 0, row: 2, col: 2, health: 4, maxHealth: 4, attack: 0, speed: 0, summoned: 0, attacks: 0, blackTokens: 5 },
    { id: 'target', card: { Id: 'target-card', Name: 'Target', Type: 0 }, item: { Id: 'target-item', Name: 'Item', Type: 1 }, owner: 1, row: 3, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const use = command('owner', { action: 'ability.use', data: { unitId: 'backstage', abilityIndex: 0 } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'applied')
  assert.equal(fixture.state.players[0].mana, 0)
  assert.deepEqual(fixture.state.pendingChoice.unitIds, ['target'])
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'duplicate')

  const resolve = command('owner', { commandId: 'e156cae2-6804-4bb7-8db5-82a52e3f7caa', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { unitId: 'target' } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.board.some(unit => unit.id === 'target'), false)
  assert.equal(fixture.state.players[1].deck.filter(card => card.Name === 'Target').length, 1)
  assert.equal(fixture.state.players[1].discard.filter(card => card.Name === 'Item').length, 1)
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('Noovse movement lock commits once across ability command retries', async () => {
  const fixture = setup()
  fixture.state.players[0].mana = 6
  fixture.state.board.push({ id: 'noovse', card: { Id: 'noovse-card', Name: 'Noovse', Description: 'Способность 6⭐: На следующем ходу все существа не могут передвигаться до начала вашего следующего хода.', Type: 0 }, owner: 0, row: 4, col: 2, health: 2, maxHealth: 2, attack: 2, speed: 2, summoned: 0, attacks: 0, blackTokens: 0 })
  const use = command('owner', { action: 'ability.use', data: { unitId: 'noovse', abilityIndex: 0 } })
  const started = await applyMatchCommand(fixture.pool, 'owner', use)
  assert.equal(started.kind, 'applied')
  assert.equal(fixture.state.players[0].mana, 0)
  assert.equal(fixture.state.movementLock, 1)
  assert.equal(started.snapshots.every(item => item.snapshot.public.movementLock === 1), true)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'duplicate')
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Lucio temporary health commits once across ability command retries', async () => {
  const fixture = setup()
  fixture.state.players[0].mana = 10
  fixture.state.board.push(
    { id: 'lucio', card: { Id: 'lucio-card', Name: 'Лусио', Description: 'Способность 10: Все ваши существа получают 10 до начала вашего следующего хода.', Type: 0 }, owner: 0, row: 4, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, blackTokens: 0 },
    { id: 'ally', card: { Id: 'ally-card', Name: 'Ally', Type: 0 }, owner: 0, row: 3, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, blackTokens: 0 },
  )
  const use = command('owner', { action: 'ability.use', data: { unitId: 'lucio', abilityIndex: 0 } })
  const applied = await applyMatchCommand(fixture.pool, 'owner', use)
  assert.equal(applied.kind, 'applied')
  assert.equal(fixture.state.players[0].mana, 0)
  assert.equal(fixture.state.board.find(unit => unit.id === 'ally').temporaryHealth, 10)
  assert.equal(applied.snapshots.every(item => item.snapshot.public.board.find(unit => unit.id === 'ally').temporaryHealth === 10), true)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'duplicate')
  assert.equal(fixture.state.board.find(unit => unit.id === 'ally').health, 14)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Iceberg choice stays private and commits once across choice retries', async () => {
  const fixture = setup()
  const description = 'Постоянно: Когда вы сжигаете карту, то получает 1 ⚫\nСпособность 1 ⚫🔁: Возьмите карту или увеличьте лимит карт на 1 до конца следующего хода.'
  fixture.state.board.push({ id: 'iceberg', card: { Id: 'iceberg-card', Name: 'Айсберг', Description: description, Type: 3 }, owner: 0, row: 4, col: 2, health: 3, maxHealth: 3, attack: 0, speed: 0, summoned: 0, blackTokens: 1 })
  const use = command('owner', { action: 'ability.use', data: { unitId: 'iceberg', abilityIndex: 0 } })
  const opened = await applyMatchCommand(fixture.pool, 'owner', use)
  const choiceId = opened.snapshots[0].snapshot.private.pendingChoice.id
  assert.equal(opened.kind, 'applied')
  assert.equal(opened.snapshots[1].snapshot.private.pendingChoice, null)
  assert.equal(fixture.state.board.find(unit => unit.id === 'iceberg').blackTokens, 0)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'duplicate')

  const resolve = command('owner', { commandId: 'bcf5394d-f246-40ce-9845-3c6a72fc45e6', expectedVersion: 1, action: 'choice.resolve', data: { choiceId, selection: { choice: 'limit' } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'applied')
  assert.equal(fixture.state.players[0].limit, 5)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].limit, 5)
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('Bibi building sacrifice choice commits once and exposes only allied buildings', async () => {
  const fixture = setup()
  const description = 'Способность 0⭐: Уничтожает ваше здание что бы дать получить +4⚔️ до конца хода.'
  fixture.state.board.push(
    { id: 'bibi', card: { Id: 'bibi-card', Name: 'Биби', Description: description, Type: 0 }, owner: 0, row: 4, col: 2, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, blackTokens: 0 },
    { id: 'building', card: { Id: 'building-card', Name: 'Ally building', Type: 3 }, owner: 0, row: 3, col: 2, health: 3, maxHealth: 3, attack: 0, speed: 0, summoned: 0, blackTokens: 0 },
    { id: 'enemy-building', card: { Id: 'enemy-building-card', Name: 'Enemy building', Type: 3 }, owner: 1, row: 1, col: 2, health: 3, maxHealth: 3, attack: 0, speed: 0, summoned: 0, blackTokens: 0 },
  )
  const use = command('owner', { action: 'ability.use', data: { unitId: 'bibi', abilityIndex: 0 } })
  const opened = await applyMatchCommand(fixture.pool, 'owner', use)
  const ownerView = opened.snapshots.find(item => item.userId === 'owner').snapshot
  const guestView = opened.snapshots.find(item => item.userId === 'guest').snapshot
  assert.deepEqual(ownerView.private.pendingChoice.options.map(option => option.unitId), ['building'])
  assert.equal(guestView.private.pendingChoice, null)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'duplicate')

  const resolve = command('owner', { commandId: 'b98f52d6-70db-4f11-8e89-0ac87dd7fda8', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: ownerView.private.pendingChoice.id, selection: { unitId: 'building' } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'applied')
  assert.equal(fixture.state.board.find(unit => unit.id === 'bibi').attack, 5)
  assert.equal(fixture.state.board.find(unit => unit.id === 'bibi').temporaryAttack, 4)
  assert.equal(fixture.state.players[0].discard.some(card => card.Name === 'Ally building'), true)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.board.find(unit => unit.id === 'bibi').attack, 5)
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('Genshin fan gamba rolls once across ability command retries', async () => {
  const fixture = setup()
  const description = 'Способность 0: Гамба:\r\n1-3 - умирает\r\n4-6 - получите 3 маны.'
  fixture.state.board.push({ id: 'fan', card: { Id: 'fan-card', Name: 'Фанат геншина', Description: description, Type: 0 }, owner: 0, row: 4, col: 2, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, blackTokens: 0 })
  const use = command('owner', { action: 'ability.use', data: { unitId: 'fan', abilityIndex: 0 } })
  const originalRandom = Math.random
  let rolls = 0
  Math.random = () => { rolls++; return 0.5 }
  try {
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'applied')
    assert.equal(fixture.state.players[0].mana, 4)
    assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'duplicate')
    assert.equal(fixture.state.players[0].mana, 4)
    assert.equal(rolls, 1)
  } finally { Math.random = originalRandom }
})

test('Generator of fun draws once across ability command retries', async () => {
  const fixture = setup()
  const description = 'Невидимость\nСпособность 2⭐: Возьмите карту\nСжигается'
  fixture.state.players[0].mana = 2
  fixture.state.players[0].deck.unshift({ Id: 'drawn-card', Name: 'Drawn card', Type: 0, Rarity: 0, Class: 0 })
  fixture.state.board.push({ id: 'generator', card: { Id: 'generator-card', Name: 'Генератор потех', Description: description, Type: 0 }, owner: 0, row: 4, col: 2, health: 7, maxHealth: 7, attack: 2, speed: 2, summoned: 0, blackTokens: 0 })
  const use = command('owner', { action: 'ability.use', data: { unitId: 'generator', abilityIndex: 0 } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'applied')
  assert.equal(fixture.state.players[0].mana, 0)
  assert.equal(fixture.state.players[0].hand.filter(card => card.Id === 'drawn-card').length, 1)
  assert.equal(fixture.state.board.some(unit => unit.id === 'generator'), true)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].hand.filter(card => card.Id === 'drawn-card').length, 1)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Pudge movement choice commits its paid use and target transfer once', async () => {
  const fixture = setup()
  fixture.state.players[0].mana = 4
  fixture.state.board.push(
    { id: 'pudge', card: { Id: 'pudge-card', Name: 'Пудж', Description: 'Способность 4: Переносит выбранное существо в сокет перед собой.', Type: 0 }, owner: 0, row: 3, col: 2, health: 5, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'target', card: { Id: 'target-card', Name: 'Target', Type: 0 }, owner: 1, row: 4, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const use = command('owner', { action: 'ability.use', data: { unitId: 'pudge', abilityIndex: 0 } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'applied')
  assert.equal(fixture.state.players[0].mana, 0)
  assert.deepEqual(fixture.state.pendingChoice.unitIds, ['pudge', 'target'])
  assert.equal(fixture.state.version, 1)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'duplicate')

  const resolve = command('owner', { commandId: 'c256cae2-6804-4bb7-8db5-82a52e3f7ca8', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { unitId: 'target' } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'applied')
  assert.deepEqual([fixture.state.board.find(unit => unit.id === 'target').row, fixture.state.board.find(unit => unit.id === 'target').col], [2, 2])
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('Needle multi-target damage commits black-token payment and all targets once', async () => {
  const fixture = setup()
  const description = 'Ярость\nСпособность 2⚫: Нанесите 2 урона трём выбранным разным целям.\nСпособность 2⚫: Восстановите 2 здоровья трём выбранным разным целя.'
  fixture.state.board.push(
    { id: 'needle', card: { Id: 'needle-card', Name: 'Игла', Description: description, Type: 0 }, owner: 0, row: 4, col: 2, health: 6, maxHealth: 6, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 2 },
    { id: 'wounded', card: { Id: 'wounded-card', Name: 'Wounded', Type: 0 }, owner: 1, row: 3, col: 2, health: 3, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'lethal', card: { Id: 'lethal-card', Name: 'Lethal', Type: 0 }, owner: 1, row: 3, col: 1, health: 1, maxHealth: 1, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'building', card: { Id: 'building-card', Name: 'Building', Type: 3 }, owner: 1, row: 2, col: 2, health: 3, maxHealth: 3, attack: 0, speed: 0, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const use = command('owner', { action: 'ability.use', data: { unitId: 'needle', abilityIndex: 0 } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'applied')
  assert.equal(fixture.state.board.find(unit => unit.id === 'needle').blackTokens, 0)
  assert.deepEqual(fixture.state.pendingChoice.unitIds, ['needle', 'wounded', 'lethal', 'building'])
  assert.equal(fixture.state.pendingChoice.count, 3)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'duplicate')

  const resolve = command('owner', { commandId: 'e256cae2-6804-4bb7-8db5-82a52e3f7caa', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { unitIds: ['wounded', 'lethal', 'building'] } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'applied')
  assert.equal(fixture.state.board.find(unit => unit.id === 'wounded').health, 1)
  assert.equal(fixture.state.board.some(unit => unit.id === 'lethal'), false)
  assert.equal(fixture.state.players[1].discard.some(card => card.Name === 'Lethal'), true)
  assert.equal(fixture.state.board.find(unit => unit.id === 'building').health, 1)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('Abrams private move choice commits its paid use, movement, and stun once', async () => {
  const fixture = setup()
  fixture.state.players[0].mana = 5
  fixture.state.board.push(
    { id: 'abrams', card: { Id: 'abrams-card', Name: 'Абрамс', Description: 'Способность 5 Переноситься на выбранный сокет, все существа вокруг получают оглушение 1.', Type: 0 }, owner: 0, row: 4, col: 2, health: 7, maxHealth: 7, attack: 2, speed: 2, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'nearby', card: { Id: 'nearby-card', Name: 'Nearby', Type: 0 }, owner: 1, row: 2, col: 3, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'doggo', card: { Id: 'doggo-card', Name: 'Догго', Type: 0 }, owner: 1, row: 0, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'turret', card: { Id: 'turret-card', Name: 'Турель', Type: 3 }, owner: 1, row: 1, col: 2, health: 4, maxHealth: 4, attack: 0, speed: 0, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const use = command('owner', { action: 'ability.use', data: { unitId: 'abrams', abilityIndex: 0 } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'applied')
  assert.equal(fixture.state.players[0].mana, 0)
  assert.ok(fixture.state.pendingChoice.cells.some(cell => cell.row === 2 && cell.col === 2))
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'duplicate')
  const resolve = command('owner', { commandId: 'f256cae2-6804-4bb7-8db5-82a52e3f7cab', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { cell: { row: 2, col: 2 } } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'applied')
  assert.deepEqual([fixture.state.board.find(unit => unit.id === 'abrams').row, fixture.state.board.find(unit => unit.id === 'abrams').col], [2, 2])
  assert.equal(fixture.state.board.find(unit => unit.id === 'abrams').health, 5)
  assert.equal(fixture.state.board.find(unit => unit.id === 'nearby').stunned, 1)
  assert.equal(fixture.state.board.find(unit => unit.id === 'doggo').attack, 2)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('Tonatiy paid swap and target positions commit once across retries', async () => {
  const fixture = setup()
  fixture.state.players[0].mana = 2
  fixture.state.board.push(
    { id: 'tonatiy', card: { Id: 'tonatiy-card', Name: 'Тонатий', Description: 'Способность 2: Меняеться местами с выбранным существом.', Type: 0 }, owner: 0, row: 4, col: 2, health: 6, maxHealth: 6, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'target', card: { Id: 'target-card', Name: 'Target', Type: 0 }, owner: 1, row: 2, col: 3, health: 4, maxHealth: 4, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const use = command('owner', { action: 'ability.use', data: { unitId: 'tonatiy', abilityIndex: 0 } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'applied')
  assert.equal(fixture.state.players[0].mana, 0)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'duplicate')
  const resolve = command('owner', { commandId: 'a356cae2-6804-4bb7-8db5-82a52e3f7cac', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { unitId: 'target' } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'applied')
  assert.deepEqual([fixture.state.board.find(unit => unit.id === 'tonatiy').row, fixture.state.board.find(unit => unit.id === 'tonatiy').col], [2, 3])
  assert.deepEqual([fixture.state.board.find(unit => unit.id === 'target').row, fixture.state.board.find(unit => unit.id === 'target').col], [4, 2])
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('Gerson Boom ability and burn commit once across activation and target retries', async () => {
  const fixture = setup()
  const gerson = cardCatalog.find(card => card.Name === 'Герсон Бум')
  const suzie = cardCatalog.find(card => card.Name === 'Сьюзи')
  fixture.state.players[0].mana = 8
  fixture.state.board.push(
    { id: 'gerson', card: { ...gerson, instanceId: 'gerson-instance' }, owner: 0, row: 3, col: 2, health: gerson.Health, maxHealth: gerson.Health, attack: gerson.Attack, speed: gerson.Speed, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'suzie', card: { ...suzie }, owner: 0, row: 4, col: 0, health: suzie.Health, maxHealth: suzie.Health, attack: suzie.Attack, speed: suzie.Speed, summoned: 0, attacks: 0, blackTokens: 0 },
    { id: 'target', card: { ...cardCatalog[0], Id: 'target-card', Name: 'Target', Description: '' }, owner: 1, row: 2, col: 2, health: 10, maxHealth: 10, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 },
  )
  const use = command('owner', { commandId: 'e257cae2-6804-4bb7-8db5-82a52e3f7cad', action: 'ability.use', data: { unitId: 'gerson', abilityIndex: 0 } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'applied')
  assert.equal(fixture.state.players[0].mana, 0)
  assert.deepEqual(fixture.state.pendingChoice.unitIds, ['target'])
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', use)).kind, 'duplicate')
  const resolve = command('owner', { commandId: 'e257cae2-6804-4bb7-8db5-82a52e3f7cae', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { unitId: 'target' } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'applied')
  assert.equal(fixture.state.board.some(unit => unit.id === 'gerson' || unit.id === 'target'), false)
  assert.ok(fixture.state.players[0].burned.some(card => card.instanceId === 'gerson-instance'))
  assert.ok(fixture.state.players[1].discard.some(card => card.Name === 'Target'))
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('movement Doggo buffs and turn-end reset persist once across retries', async () => {
  const fixture = setup()
  fixture.state.board.push(
    { id: 'mover', card: { Id: 'mover-card', Name: 'Mover', Type: 0 }, owner: 0, row: 4, col: 0, health: 3, maxHealth: 3, attack: 1, speed: 1, summoned: 0, attacks: 0 },
    { id: 'doggo', card: { Id: 'doggo-card', Name: 'Догго', Description: 'Постоянно: Получает +1❤️⚔️⚡ за каждое движение другого существа. В конце хода сбрасывает все.', Type: 0 }, owner: 1, row: 3, col: 4, health: 2, maxHealth: 2, attack: 1, speed: 5, summoned: 0, attacks: 0 },
  )
  const move = command('owner', { action: 'unit.move', data: { unitId: 'mover', to: { row: 3, col: 0 } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', move)).kind, 'applied')
  assert.deepEqual([fixture.state.board.find(unit => unit.id === 'doggo').attack, fixture.state.board.find(unit => unit.id === 'doggo').doggoBuffs], [2, 1])
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', move)).kind, 'duplicate')
  assert.equal(fixture.state.board.find(unit => unit.id === 'doggo').doggoBuffs, 1)

  const end = command('owner', { commandId: 'd256cae2-6804-4bb7-8db5-82a52e3f7ca9', expectedVersion: 1, action: 'turn.end', data: { option: 'no_penalty' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', end)).kind, 'applied')
  assert.deepEqual([fixture.state.board.find(unit => unit.id === 'doggo').attack, fixture.state.board.find(unit => unit.id === 'doggo').doggoBuffs], [1, 0])
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', end)).kind, 'duplicate')
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('Indigolit healing choices commit once and advance the remaining count', async () => {
  const fixture = setup()
  const card = { ...cardCatalog.find(item => item.Name === 'Индиголит'), instanceId: 'indigolit-card' }
  fixture.state.players[0].hand = [card]
  fixture.state.players[0].mana = 10
  fixture.state.players[0].health = 20
  fixture.state.board.push({ id: 'wounded', card: { ...cardCatalog[0], Id: 'wounded-card', Name: 'Wounded' }, owner: 0, row: 3, col: 1, health: 1, maxHealth: 5, attack: 1, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })
  const play = command('owner', { commandId: 'ad0e19ba-7556-45bf-9c06-28a8ec275600', action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', play)).kind, 'applied')
  assert.equal(fixture.state.pendingChoice.remaining, 5)
  assert.equal(fixture.state.players[1].health, 45)
  const resolve = command('owner', { commandId: 'ad0e19ba-7556-45bf-9c06-28a8ec275601', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { player: 'self' } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'applied')
  assert.equal(fixture.state.players[0].health, 21)
  assert.equal(fixture.state.pendingChoice.remaining, 4)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].health, 21)
  assert.equal(fixture.state.version, 2)
})

test('Disappearing Guy entry gamba resolves once across a retried play', async () => {
  const fixture = setup()
  const card = { ...cardCatalog.find(item => item.Name === 'Исчезающий парень'), instanceId: 'disappearing-card' }
  fixture.state.players[0].hand = [card]
  fixture.state.players[0].mana = 10
  const play = command('owner', { commandId: 'bd0e19ba-7556-45bf-9c06-28a8ec275602', action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', play)).kind, 'applied')
  const remainingHealth = fixture.state.board.find(unit => unit.card.Name === card.Name)?.health ?? 0
  const discardCount = fixture.state.players[0].discard.filter(item => item.instanceId === card.instanceId).length
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', play)).kind, 'duplicate')
  assert.equal(fixture.state.board.find(unit => unit.card.Name === card.Name)?.health ?? 0, remainingHealth)
  assert.equal(fixture.state.players[0].discard.filter(item => item.instanceId === card.instanceId).length, discardCount)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Dextergon Horny payment and shields persist only once on a retried play', async () => {
  const fixture = setup()
  const card = { ...cardCatalog.find(item => item.Name === 'Декстергон'), instanceId: 'dextergon-horny' }
  fixture.state.players[0].hand = [card]
  fixture.state.players[0].mana = 10
  fixture.state.players[0].health = 20
  fixture.state.board.push({ id: 'ally', card: { ...cardCatalog[0], Id: 'ally-card', Name: 'Ally' }, owner: 0, row: 4, col: 0, health: 2, maxHealth: 2, attack: 1, speed: 1, blackTokens: 0 })
  const play = command('owner', { commandId: 'cd0e19ba-7556-45bf-9c06-28a8ec275603', action: 'card.play', data: { cardInstanceId: card.instanceId, payment: 'mana', target: { row: 4, col: 1 }, horny: true } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', play)).kind, 'applied')
  assert.equal(fixture.state.players[0].health, 14)
  assert.equal(fixture.state.board.find(unit => unit.id === 'ally').shield, true)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', play)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].health, 14)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Wismuth discard choice applies once when its command is retried', async () => {
  const fixture = setup()
  const wismuth = { ...cardCatalog.find(item => item.Name === 'Висмут Шифера'), instanceId: 'wismuth-server' }
  const item = { ...cardCatalog.find(item => item.Type === 1), instanceId: 'searched-item-server' }
  const building = { ...cardCatalog.find(item => item.Type === 3), instanceId: 'searched-building-server' }
  fixture.state.players[0].hand = [wismuth]
  fixture.state.players[0].mana = 20
  fixture.state.players[0].deck = [item, building]
  const play = command('owner', { commandId: '88a9a70b-4c51-4d6b-9e64-74458e886f16', action: 'card.play', data: { cardInstanceId: wismuth.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', play)).kind, 'applied')
  const choiceId = fixture.state.pendingChoice.id
  const resolve = command('owner', { commandId: 'c4676234-3f9e-463b-ae2d-69b4269228da', expectedVersion: 1, action: 'choice.resolve', data: { choiceId, selection: { unitId: item.instanceId } } })
  const resolved = await applyMatchCommand(fixture.pool, 'owner', resolve)
  assert.equal(resolved.kind, 'applied')
  assert.equal(JSON.stringify(resolved.events).includes(item.instanceId), false)
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].discard.filter(card => card.instanceId === item.instanceId).length, 1)
  assert.equal(fixture.state.players[0].hand.some(card => card.instanceId === building.instanceId), true)
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('Sovunya selected healing applies only once when its choice command is retried', async () => {
  const fixture = setup()
  const sovunya = { ...cardCatalog.find(item => item.Name === 'Совунья'), instanceId: 'sovunya-server' }
  fixture.state.players[0].hand = [sovunya]
  fixture.state.players[0].mana = 20
  fixture.state.board.push({ id: 'sovunya-target', card: { ...cardCatalog[0], Id: 'sovunya-target-card', Name: 'Target' }, owner: 1, row: 1, col: 1, health: 1, maxHealth: 5, attack: 1, speed: 1, blackTokens: 0 })
  const play = command('owner', { commandId: 'fa125685-cc16-4593-b301-e6cb9eeae70c', action: 'card.play', data: { cardInstanceId: sovunya.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', play)).kind, 'applied')
  const resolve = command('owner', { commandId: 'c3d14e86-2320-45ce-8f9a-e7061df49987', expectedVersion: 1, action: 'choice.resolve', data: { choiceId: fixture.state.pendingChoice.id, selection: { unitId: 'sovunya-target' } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', resolve)).kind, 'duplicate')
  assert.equal(fixture.state.board.find(unit => unit.id === 'sovunya-target').health, 3)
  assert.equal(fixture.state.version, 2)
  assert.equal(fixture.updates, 2)
})

test('Salubra healing and energy gain apply once on a retried card play', async () => {
  const fixture = setup()
  const salubra = { ...cardCatalog.find(item => item.Name === 'Салюбра'), instanceId: 'salubra-server' }
  fixture.state.players[0].hand = [salubra]
  fixture.state.players[0].mana = 20
  fixture.state.board.push({ id: 'salubra-target', card: { ...cardCatalog[0], Id: 'salubra-target-card', Name: 'Target' }, owner: 0, row: 3, col: 2, health: 1, maxHealth: 5, attack: 1, speed: 1, blackTokens: 0 })
  const play = command('owner', { commandId: '9a49cd39-e682-4759-ae79-971f14c9f537', action: 'card.play', data: { cardInstanceId: salubra.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', play)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', play)).kind, 'duplicate')
  assert.equal(fixture.state.board.find(unit => unit.id === 'salubra-target').health, 4)
  assert.equal(fixture.state.players[0].energy, 2)
  assert.equal(fixture.state.version, 1)
  assert.equal(fixture.updates, 1)
})

test('Yangusha returns its item to the owner deck once when the death command is retried', async () => {
  const fixture = setup()
  const yangusha = { ...cardCatalog.find(item => item.Name === 'Янгуша'), instanceId: 'yangusha-server' }
  const item = { ...cardCatalog.find(card => card.Type === 1 && !(card.Description ?? '').match(/(?:Вход|Коронный|Ловушка|Способность)\s*:/iu)), Id: 'yangusha-server-item', Name: 'Yangusha Item', Cost: 0, Description: '', instanceId: 'yangusha-item-server' }
  fixture.state.players[0].hand = [yangusha]
  fixture.state.players[0].deck = [item]
  fixture.state.players[0].mana = 20
  const play = command('owner', { commandId: '97a3b340-92ae-473a-a9a4-508d9bdcdd52', action: 'card.play', data: { cardInstanceId: yangusha.instanceId, payment: 'mana', target: { row: 4, col: 1 } } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', play)).kind, 'applied')
  const equip = command('owner', { commandId: '1628ef56-1e95-4389-ad54-54d7415e320f', expectedVersion: 1, action: 'item.equip', data: { cardInstanceId: item.instanceId, targetUnitId: 'unit_1', payment: 'mana' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'owner', equip)).kind, 'applied')
  fixture.state.current = 1
  fixture.state.board.find(unit => unit.id === 'unit_1').summoned = 0
  fixture.state.board.push({ id: 'yangusha-attacker', card: { ...cardCatalog[0], Name: 'Attacker' }, owner: 1, row: 3, col: 1, health: 5, maxHealth: 5, attack: 5, speed: 1, summoned: 0, attacks: 0, blackTokens: 0 })
  const attack = command('guest', { commandId: '415dc5a4-a2bd-4df1-8bcb-9a7ccf3c3b6e', expectedVersion: 2, action: 'unit.attack', data: { unitId: 'yangusha-attacker', targetUnitId: 'unit_1' } })
  assert.equal((await applyMatchCommand(fixture.pool, 'guest', attack)).kind, 'applied')
  assert.equal((await applyMatchCommand(fixture.pool, 'guest', attack)).kind, 'duplicate')
  assert.equal(fixture.state.players[0].deck[0].instanceId, item.instanceId)
  assert.equal(fixture.state.players[0].discard.some(card => card.instanceId === item.instanceId), false)
  assert.equal(fixture.state.version, 3)
  assert.equal(fixture.updates, 3)
})

